import { GameObject, resetTime, stepPhysics, Time, distanceXZ } from '@arc-director/kindling';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findRoute, pointGoal } from 'arc-director';
import { CharacterMotor } from '../characters/CharacterMotor';
import { NPCInput } from '../characters/NPCInput';
import { approachSpot, overWater, Seated } from '../characters/Seated';
import { glen_0_0 } from '../data/chunks/glen-0-0';
import { glen_0_1 } from '../data/chunks/glen-0-1';
import { glen_1_0 } from '../data/chunks/glen-1-0';
import { glen_1_1 } from '../data/chunks/glen-1-1';
import { DUNGEON_CHUNKS } from '../scenes/dungeon-vault/dungeon-vault-map';
import { RIVER_GLEN } from '../data/scenes';
import { Belly } from '../engine/Belly';
import { BoxCollider, Door, Furniture, HumanBody, Lock, Named, RigidBody, Vitals } from '../engine/components';
import { DemoWorld } from '../engine/demo-world';
import { Container } from '../items/item-components';
import { getDef } from '../items/defs';
import { equipItem } from '../items/equip';
import { instantiateDef } from '../items/instance';
import { findCarried, tryInsert } from '../items/inventory';
import { chestHolding, interactDoor, openDoorAhead, takeFromChest, USE_RANGE } from '../items/pickup';
import { Reading } from '../characters/Reading';
import { isFood, readPage, useItem } from '../items/use';
import type { GameHost } from '../director/adapter';
import { dropDown, FISH_VERB } from '../director/game-verbs';
import { mealProgress } from '../director/scenes/glen';
import { examineWorld, tagsOf } from '../director/perception';
import { decodeGlyphChunk, type ChunkFile } from './decode-glyph-chunk';
import { syncDressingColliders, syncFurniture } from './dressing-colliders';
import { planProps, roadLines } from './dressing-plan';
import { cellWays } from './path';
import { spawnChunkEntities } from './spawn';

function built(files:readonly ChunkFile[]):DemoWorld {
	const world = new DemoWorld();
	for (const file of files) {
		const chunk = decodeGlyphChunk(file).chunk;
		spawnChunkEntities(world, chunk);
		world.addChunk(chunk);
	}
	syncDressingColliders(world);
	syncFurniture(world);
	world.reindex();
	return world;
}

const glen = ():DemoWorld => built([glen_0_0, glen_0_1, glen_1_0, glen_1_1]);

function body(world:DemoWorld, id:string, x:number, z:number):GameObject {
	const go = new GameObject(id, 'Person');
	go.transform.localPosition = { x, y: 0, z };
	go.addComponent(Named, { id });
	go.addComponent(NPCInput);
	go.addComponent(CharacterMotor);
	go.addComponent(RigidBody, { kinematic: true });
	go.addComponent(BoxCollider, { size: { x: 0.45, y: 1.1, z: 0.45 }, pad: 0.36 });
	go.addComponent(HumanBody, { pockets: go.addComponent(Container, { size: 8 }) });
	go.addComponent(Seated);
	world.add(go);
	return go;
}

function seatNames(world:DemoWorld):string[] {
	const names:string[] = [];
	world.forEachComponent(Furniture, (_, go) => names.push(go.id));
	return names.sort();
}

test('every chair and bed in the glen can be named, by the map or by its house', () => {
	const world = glen();
	assert.deepEqual(seatNames(world), ['CottageBed', 'CottageChair', 'HutBed', 'HutChair', 'RiverChair']);
	syncFurniture(world);
	assert.equal(seatNames(world).length, 5, 'syncing again adds none');
	assert.equal(world.findByID('HutBed')?.getComponent(Furniture)?.kind, 'bed');
});

test('a chair with a basket on it is no seat', () => {
	assert.deepEqual(seatNames(built(DUNGEON_CHUNKS)), []);
});

test('only the chair on the bank looks out over the water', () => {
	const world = glen();
	assert.equal(overWater(world.findByID('RiverChair')!), true);
	assert.equal(overWater(world.findByID('HutChair')!), false);
	assert.equal(overWater(world.findByID('CottageChair')!), false);
});

test('a route home goes through a door no lock holds, and the one heading in opens it', () => {
	const world = glen();
	const door = world.findNamed('HutDoor')!;
	const angler = body(world, 'Angler', 27.5, 22.8);
	const ways = cellWays(world);
	const route = findRoute(ways, angler, [23.5, 24.5], pointGoal([23.5, 27.5]));
	assert.ok(route && 'points' in route, `no way into the hut: ${JSON.stringify(route)}`);
	assert.equal(door.getComponent(Door)?.open, false);
	angler.transform.position.x = 23.5;
	angler.transform.position.z = 25.4;
	openDoorAhead(angler, { x: 40, z: 25.4 });
	assert.equal(door.getComponent(Door)?.open, false, 'not when heading away along the wall');
	openDoorAhead(angler, { x: 23.5, z: 27.5 });
	assert.equal(door.getComponent(Door)?.open, true);
});

test('a locked door still says what it takes', () => {
	const world = glen();
	assert.equal(world.findNamed('CottageDoor')?.getComponent(Lock)?.locked, true);
	const stranger = body(world, 'Stranger', 24.5, 9.5);
	const route = findRoute(cellWays(world), stranger, [24.5, 9.5], pointGoal([25.5, 6.5]));
	assert.ok(route && 'blockers' in route, `a way through a locked door: ${JSON.stringify(route)}`);
	assert.match(route.blockers[0]!.reason, /CottageDoor is locked/);
});

test('a lock is a condition for opening, from the sides it bars, and nothing more', () => {
	const world = glen();
	const doorGo = world.findNamed('CottageDoor')!;
	const door = doorGo.getComponent(Door)!;
	const lock = doorGo.getComponent(Lock)!;
	const ways = cellWays(world);
	const keeper = body(world, 'Keeper', 25.5, 6.5);
	const leaving = findRoute(ways, keeper, [25.5, 6.5], pointGoal([24.5, 9.5]));
	assert.ok(leaving && 'points' in leaving, `no way out: ${JSON.stringify(leaving)}`);

	keeper.transform.position.x = 24.5;
	keeper.transform.position.z = 6.6;
	openDoorAhead(keeper, { x: 24.5, z: 9.5 });
	assert.equal(door.open, true, 'it opens from inside');
	assert.equal(lock.locked, true, 'and that does not unlock it');
	door.syncCollision();
	world.reindex();

	const stranger = body(world, 'Stranger', 24.5, 8.4);
	const through = findRoute(ways, stranger, [24.5, 9.5], pointGoal([25.5, 6.5]));
	assert.ok(through && 'points' in through, `the lock bars passing through an open door: ${JSON.stringify(through)}`);
	assert.equal(interactDoor(stranger, doorGo), 'closed', 'anyone can close it');
	assert.equal(door.open, false);
	door.syncCollision();
	world.reindex();

	assert.match(interactDoor(stranger, doorGo), /locked/, 'and from outside it stays barred');
	assert.equal(door.open, false);
	const barred = findRoute(ways, stranger, [24.5, 9.5], pointGoal([25.5, 6.5]));
	assert.ok(barred && 'blockers' in barred, 'a way through a door locked from this side');
	openDoorAhead(stranger, { x: 24.5, z: 6.5 });
	assert.equal(door.open, false);

	assert.equal(tryInsert(stranger, instantiateDef(getDef('brass_key'))), true);
	assert.equal(useItem(stranger, findCarried(stranger, (it) => !!it.Key)!, doorGo).reason, 'opened');
	assert.equal(door.open, true, 'its key opens it');
	assert.equal(lock.locked, true, 'and it stays locked for the next one out there');
});

/** Walks `go` along a route to within reach of `to`, under physics, as the mover steers it. Returns where it ends up. */
function walkTo(world:DemoWorld, go:GameObject, to:GameObject):{ x:number; z:number; points:number[][] } {
	const here = go.transform.position;
	const goal = to.transform.position;
	const route = findRoute(cellWays(world), go, [here.x, here.z], pointGoal([goal.x, goal.z], USE_RANGE * 0.55));
	assert.ok(route && 'points' in route, `no way to ${to.id}: ${JSON.stringify(route)}`);
	const motor = go.getComponent(CharacterMotor)!;
	const npc = go.getComponent(NPCInput)!;
	const dt = 1 / 60;
	for (const [x, z] of route.points) {
		npc.destinationPoint = { x: x!, z: z! };
		for (let t = 0; t < 4 && Math.hypot(here.x - x!, here.z - z!) > motor.arriveEpsilon; t += dt) {
			openDoorAhead(go, { x: x!, z: z! });
			world.objects.forEach((o) => o.getComponent(Door)?.syncCollision());
			motor.update(dt);
			stepPhysics(world, dt);
			world.reindex();
		}
	}
	npc.destinationPoint = null;
	return { x: here.x, z: here.z, points: route.points as number[][] };
}

for (const [house, door, chair, bed, from] of [['Cottage', 'CottageDoor', 'CottageChair', 'CottageBed', [24.5, 9.5]], ['Hut', 'HutDoor', 'HutChair', 'HutBed', [23.5, 24.5]]] as const) {
	test(`a body walks through the door of ${house} to its chair and its bed, and back out, under physics`, () => {
		const world = glen();
		const doorGo = world.findNamed(door)!;
		doorGo.getComponent(Door)!.open = true;
		doorGo.getComponent(Door)!.syncCollision();
		world.reindex();
		for (const name of [chair, bed]) {
			const go = body(world, `Walker${name}`, from[0], from[1]);
			const seat = world.findByID(name)!;
			const end = walkTo(world, go, seat);
			const off = distanceXZ(end, seat);
			assert.ok(off <= USE_RANGE * 0.55 + 0.4, `stuck at ${end.x.toFixed(2)}, ${end.z.toFixed(2)}, ${off.toFixed(2)} m off ${name}, on ${JSON.stringify(end.points)}`);
			world.remove(go);
			world.reindex();
		}
	});
}

test('a door locked from both sides still takes its key, and comes unlocked by it', () => {
	const world = built(DUNGEON_CHUNKS);
	const doorGo = world.findNamed('CryptGate')!;
	const go = body(world, 'Knight', doorGo.transform.position.x, doorGo.transform.position.z + 1);
	assert.equal(tryInsert(go, instantiateDef(getDef('iron_key'))), true);
	assert.equal(doorGo.getComponent(Door)?.opensFrom(go.transform.position), false, 'a key is used, not walked through');
	assert.equal(useItem(go, findCarried(go, (it) => !!it.Key)!, doorGo).reason, 'unlocked');
	assert.equal(doorGo.getComponent(Lock)?.locked, false);
});

test('BridgeKeeper carries one key, and the spare lies hidden by the woodpile', () => {
	const world = glen();
	const keeper = RIVER_GLEN.npcs.find((npc) => npc.id === 'BridgeKeeper')!;
	assert.ok(keeper.packLoot?.some((loot) => loot.name === 'CottageKey' && loot.defID === 'brass_key'));
	const spare = world.findNamed('SpareKey')!.transform.position;
	const pile = planProps([...world.chunks.values()]).find((spot) => spot.prop === 'woodpile')!;
	assert.ok(distanceXZ(spare, pile) < 1.2, `the spare is not by the woodpile: ${spare.x}, ${spare.z} and ${pile.x}, ${pile.z}`);
	assert.equal(world.objects.filter((go) => go.getComponent(Named)?.id === 'CottageKey').length, 0, 'only the spare lies about');
});

test('the forager starts on the T where the trail meets the road to the bridge, on the keeper\'s bank', () => {
	const chunks = [glen_0_0, glen_0_1, glen_1_0, glen_1_1].map((file) => decodeGlyphChunk(file).chunk);
	const spawn = RIVER_GLEN.npcs.find((npc) => npc.id === 'Forager')!;
	const chunk = chunks.find((c) => c.id === spawn.chunkID)!;
	const at = chunk.worldCellCenter(spawn.localX, spawn.localZ);
	const lines = roadLines(chunks);
	const meeting = lines.filter((l) => {
		const dx = Math.max(Math.min(l.a.x, l.b.x) - at.x, 0, at.x - Math.max(l.a.x, l.b.x));
		const dz = Math.max(Math.min(l.a.z, l.b.z) - at.z, 0, at.z - Math.max(l.a.z, l.b.z));
		return Math.hypot(dx, dz) < 0.51;
	});
	assert.ok(meeting.some((l) => l.a.z === l.b.z), 'no road running east and west here');
	assert.ok(meeting.some((l) => l.a.x === l.b.x), 'no road running north and south here');
	assert.ok(at.z < 20, 'not on the north bank');
});

test('someone settled holds the seat and is not solid; getting up frees both', () => {
	const world = glen();
	const seat = world.findByID('HutChair')!;
	const go = body(world, 'Angler', seat.transform.position.x + 0.6, seat.transform.position.z + 0.6);
	const seated = go.getComponent(Seated)!;
	seated.settle(seat);
	assert.equal(seat.getComponent(Furniture)?.occupant, go);
	assert.equal(go.getComponent(BoxCollider)?.enabled, false);
	assert.equal(seated.resting, true);
	assert.equal(seated.asleep, false);
	for (let i = 0; i < 100; i++) {
		seated.lateUpdate(0.02);
	}
	assert.ok(distanceXZ(go, seat) < 1e-6, 'off its seat');
	seated.stand();
	assert.equal(seated.resting, false);
	assert.equal(seated.held, true, 'still getting up');
	for (let i = 0; i < 100; i++) {
		seated.lateUpdate(0.02);
	}
	assert.equal(seated.held, false);
	assert.equal(seat.getComponent(Furniture)?.occupant, null);
	assert.equal(go.getComponent(BoxCollider)?.enabled, true);
	assert.equal(world.blocker(go, go.transform.position.x, go.transform.position.z), undefined, 'stood up inside something');
});

test('in bed it sleeps, and wakes by itself when told to', () => {
	const world = glen();
	const bed = world.findByID('HutBed')!;
	const go = body(world, 'Angler', bed.transform.position.x, bed.transform.position.z - 1);
	const seated = go.getComponent(Seated)!;
	seated.settle(bed, { seconds: 10 });
	assert.equal(seated.asleep, false, 'not until it lies down');
	for (let i = 0; i < 100; i++) {
		seated.lateUpdate(0.02);
	}
	assert.equal(seated.asleep, true);
	seated.update();
	assert.equal(seated.asleep, true, 'not yet');
	resetTime(Time.time + 11);
	seated.update();
	assert.equal(seated.asleep, false);
});

test('a bed is got into by its nearer open edge, the sleeper facing it, and left by the same edge', () => {
	const world = glen();
	const bed = world.findByID('HutBed')!;
	const { x, z } = bed.transform.position;
	const north = body(world, 'North', x, z - 1).getComponent(Seated)!;
	north.settle(bed);
	assert.equal(north.side, -1, 'the bed lies east and west, so its right is south');
	const south = body(world, 'South', x, z + 1).getComponent(Seated)!;
	south.settle(bed);
	assert.equal(south.side, -1, 'a wall stands to the south');
	for (let i = 0; i < 100; i++) {
		north.lateUpdate(0.02);
	}
	assert.equal(north.side, -1);
	north.stand();
	for (let i = 0; i < 100; i++) {
		north.lateUpdate(0.02);
	}
	const up = north.gameObject.transform.position;
	assert.ok(up.z < z - 0.5, `got up at ${up.x}, ${up.z}`);
});

test('a bed open on both sides takes whichever edge is nearer', () => {
	const world = glen();
	const bed = world.findByID('HutBed')!;
	bed.transform.localPosition = { x: 18.5, y: 0, z: 14.5 };
	const north = body(world, 'North', 18.5, 13.5).getComponent(Seated)!;
	north.settle(bed);
	assert.equal(north.side, -1);
	const south = body(world, 'South', 18.5, 15.5).getComponent(Seated)!;
	south.settle(bed);
	assert.equal(south.side, 1);
});

test('coming from the door, a body stands beside the near side of CottageBed, by the trunk, and sits on that edge', () => {
	const world = glen();
	const bed = world.findByID('CottageBed')!;
	const b = bed.transform.position;
	const go = body(world, 'Keeper', 25.5, 6.6);
	const spot = approachSpot(bed, go)!;
	assert.ok(spot.z > b.z + 0.4, `not on the near side: ${spot.x.toFixed(2)}, ${spot.z.toFixed(2)} of a bed at ${b.x.toFixed(2)}, ${b.z.toFixed(2)}`);
	go.transform.position.x = spot.x;
	go.transform.position.z = spot.z;
	const seated = go.getComponent(Seated)!;
	seated.settle(bed);
	for (let i = 0; i < 40; i++) {
		seated.lateUpdate(0.02);
	}
	assert.ok(go.transform.position.z > b.z + 0.1, `sat on the far edge: z ${go.transform.position.z.toFixed(2)}, bed at ${b.z.toFixed(2)}`);
	for (let i = 0; i < 80; i++) {
		seated.lateUpdate(0.02);
	}
	seated.stand();
	for (let i = 0; i < 100; i++) {
		seated.lateUpdate(0.02);
	}
	assert.ok(go.transform.position.z > b.z + 0.4, `got up over the far edge: z ${go.transform.position.z.toFixed(2)}`);
});

test('the side of a chair or bed a body goes to is the nearer one, unless that has no room', () => {
	const world = glen();
	const chair = world.findByID('RiverChair')!;
	const c = chair.transform.position;
	const east = body(world, 'East', c.x + 3, c.z);
	const west = body(world, 'West', c.x - 3, c.z);
	assert.ok(approachSpot(chair, east)!.x > c.x, 'not the east side, coming from the east');
	assert.ok(approachSpot(chair, west)!.x < c.x, 'not the west side, coming from the west');
	const bed = world.findByID('HutBed')!;
	const fromSouth = body(world, 'South', bed.transform.position.x, bed.transform.position.z + 0.3);
	assert.ok(approachSpot(bed, fromSouth)!.z < bed.transform.position.z, 'the south side is against the wall');
});

for (const [name, door, from] of [['CottageChair', 'CottageDoor', [24.5, 9.5]], ['CottageBed', 'CottageDoor', [24.5, 9.5]], ['HutBed', 'HutDoor', [23.5, 24.5]], ['RiverChair', 'HutDoor', [23.5, 24.5]]] as const) {
	test(`there is a walkable way to stand beside ${name}`, () => {
		const world = glen();
		const doorGo = world.findNamed(door)!;
		doorGo.getComponent(Door)!.open = true;
		doorGo.getComponent(Door)!.syncCollision();
		world.reindex();
		const go = body(world, 'Walker', from[0], from[1]);
		assert.ok(approachSpot(world.findByID(name)!, go), 'no spot beside it can be walked to');
	});
}

test('locked out, or with no way to either side, there is no spot to walk to', () => {
	const world = glen();
	const stranger = body(world, 'Stranger', 24.5, 9.5);
	assert.equal(approachSpot(world.findByID('CottageChair')!, stranger), undefined);
});

test('coming from either side, a body goes to that side of CottageBed', () => {
	const world = glen();
	const bed = world.findByID('CottageBed')!;
	const b = bed.transform.position;
	const doorGo = world.findNamed('CottageDoor')!;
	doorGo.getComponent(Door)!.open = true;
	doorGo.getComponent(Door)!.syncCollision();
	world.reindex();
	assert.ok(approachSpot(bed, body(world, 'South', 25.5, 6.5))!.z > b.z, 'not the south side');
	assert.ok(approachSpot(bed, body(world, 'North', 25.5, 4.5))!.z < b.z, 'not the north side');
});

test('the Cottage has a shelf of five books, and taking one down leaves four', () => {
	const world = glen();
	const shelf = world.findByID('CottageBookshelf')!;
	const bag = shelf.getComponent(Container)!;
	assert.deepEqual(bag.contents.map((book) => book.name), ['Almanac', 'RiverTales', 'TollBook', 'MushroomLore', 'OldSongs']);
	const go = body(world, 'Keeper', shelf.transform.position.x, shelf.transform.position.z + 1);
	assert.match(takeFromChest(go, chestHolding(shelf, 'Almanac')!), /took Almanac/);
	assert.equal(bag.contents.length, 4);
	assert.ok(findCarried(go, (it) => it.defID === 'almanac'));
});

test('someone with a book open is reading until it walks off, the sitting ends, or it falls asleep', () => {
	const world = glen();
	const go = body(world, 'Keeper', 18.5, 14.5);
	const reading = go.addComponent(Reading);
	const book = instantiateDef(getDef('almanac'));
	assert.equal(tryInsert(go, book), true);
	assert.match(useItem(go, book, null).reason, /^you read: "/);
	assert.equal(reading.active, true);
	assert.ok(tagsOf(go).includes('reading'), 'a watch can tell');
	assert.ok(findCarried(go, (it) => it.defID === 'almanac'), 'reading does not use it up');
	assert.equal(readPage(instantiateDef(getDef('silver_trout'))), undefined);
	reading.update();
	assert.equal(reading.active, true);
	resetTime(Time.time + 301);
	reading.update();
	assert.equal(reading.active, false, 'the sitting is over');
	assert.ok(!tagsOf(go).includes('reading'));
	assert.match(examineWorld(world.findNamed('FireMushroom')!), /orange cap/i);
});

test('a meal\'s orb fills by walking to the seller, then having the food, then eating it', () => {
	const world = glen();
	const eater = body(world, 'Forager', 18.5, 14.5);
	body(world, 'Angler', 27.5, 14.5);
	const goals:unknown[] = [{ until: () => false }];
	const host = { world, arc: { character: () => ({ persona: { goals } }) } } as unknown as GameHost;
	const progress = ():number => mealProgress(host, 'Forager', 'Angler', 'SilverTrout');
	assert.equal(progress(), 0, 'it has not set out');
	eater.transform.position.x = 23;
	assert.equal(progress(), 0.25, 'halfway to the seller is a quarter of the line');
	eater.transform.position.x = 27.5;
	assert.equal(progress(), 0.5, 'at the seller is half');
	assert.equal(tryInsert(eater, instantiateDef(getDef('silver_trout'))), true);
	assert.equal(progress(), 0.75, 'having it is three quarters');
	goals.length = 0;
	assert.equal(progress(), 1, 'eating it, which ends the goal, is all of it');
});

test('the three foods are food, and a potion is not', () => {
	for (const id of ['silver_trout', 'fire_mushroom', 'moon_mushroom']) {
		assert.equal(isFood(instantiateDef(getDef(id))), true, id);
	}
	assert.equal(isFood(instantiateDef(getDef('health_potion'))), false);
});

test('eating fills, takes one off the stack, and each food does its own thing', () => {
	const world = glen();
	const go = body(world, 'Forager', 18.5, 14.5);
	const feed = (id:string):string => {
		const item = instantiateDef(getDef(id));
		assert.equal(tryInsert(go, item), true);
		const held = findCarried(go, (it) => it.defID === id)!;
		const result = useItem(go, held, null);
		assert.equal(result.ok, true, result.reason);
		assert.equal(findCarried(go, (it) => it.defID === id), null, `${id} still carried`);
		return result.reason;
	};
	assert.equal(go.getComponent(Belly), undefined, 'hungry only from a meal on, or from the spawn');
	assert.match(feed('silver_trout'), /full/);
	const belly = go.getComponent(Belly)!;
	assert.equal(belly.hungry, false);
	assert.equal(belly.haste, 0);
	assert.equal(belly.luck, 0);
	feed('fire_mushroom');
	assert.equal(belly.haste, 0.25, 'a quarter faster');
	assert.deepEqual(belly.ate, ['silver_trout', 'fire_mushroom'], 'it knows what it has eaten');
	feed('moon_mushroom');
	assert.ok(belly.luck > 0, 'luckier');
	const twentyMinutes = 20 * 60;
	assert.ok(belly.fullUntil > Time.time + twentyMinutes - 1 && belly.fullUntil <= Time.time + twentyMinutes);
});

test('a hungry spawn is hungry until it eats', () => {
	const belly = new Belly();
	assert.equal(belly.hungry, true);
	belly.eat('silver_trout', 'food', 0);
	assert.equal(belly.hungry, false);
});

test('a fire mushroom makes a body walk 25% faster', () => {
	const world = glen();
	const go = body(world, 'Forager', 18.5, 14.5);
	const motor = go.getComponent(CharacterMotor)!;
	const rb = go.getComponent(RigidBody)!;
	const stride = ():number => {
		go.getComponent(NPCInput)!.destinationPoint = { x: 18.5, z: 2.5 };
		motor.update(0.02);
		return Math.hypot(rb.velocity.x, rb.velocity.z);
	};
	const usual = stride();
	assert.ok(usual > 0);
	go.addComponent(Belly).eat('fire_mushroom', 'swift', 0.25);
	assert.ok(Math.abs(stride() / usual - 1.25) < 1e-6);
});

test('fishing again from the chair it already holds keeps it there, rod out', async () => {
	const world = glen();
	const seat = world.findByID('RiverChair')!;
	const go = body(world, 'Angler', seat.transform.position.x, seat.transform.position.z);
	const seated = go.getComponent(Seated)!;
	seated.settle(seat);
	const result = await FISH_VERB.handler({ ctx: { character: go, world }, verb: 'fish' } as never);
	assert.equal(result.ok, true, result.reason);
	assert.equal(seated.seatID, 'RiverChair');
	assert.equal(seated.rod, true);
});

test('going down leaves the seat and shuts the book, and leaves the body not solid', () => {
	const world = glen();
	const seat = world.findByID('HutChair')!;
	const go = body(world, 'Angler', seat.transform.position.x, seat.transform.position.z);
	const seated = go.getComponent(Seated)!;
	seated.settle(seat);
	go.addComponent(Reading).open('almanac');
	go.addComponent(Vitals, { hp: 0, maxHP: 10 });
	dropDown({ world, arc: null } as never, go);
	assert.equal(go.getComponent(Reading)!.active, false);
	for (let i = 0; i < 100; i++) {
		seated.lateUpdate(0.02);
	}
	assert.equal(seated.held, false);
	assert.equal(seat.getComponent(Furniture)?.occupant, null);
	assert.equal(go.getComponent(BoxCollider)?.enabled, false);
});

test('a key opening a door locked from one side says opened, not unlocked', () => {
	const world = glen();
	const doorGo = world.findNamed('CottageDoor')!;
	const lock = doorGo.getComponent(Lock)!;
	const outside = body(world, 'Visitor', doorGo.transform.position.x, doorGo.transform.position.z + 1);
	assert.equal(equipItem(outside, instantiateDef(getDef('brass_key')), world), null);
	assert.equal(interactDoor(outside, doorGo), 'opened');
	assert.equal(lock.locked, true);
});

test('fishing brings a trout at even chances, and luck makes it likelier', () => {
	const world = glen();
	const seat = world.findByID('RiverChair')!;
	const go = body(world, 'Angler', seat.transform.position.x, seat.transform.position.z);
	const seated = go.getComponent(Seated)!;
	const caught:string[] = [];
	world.caught = (_, name) => caught.push(name);
	seated.settle(seat, { rod: true });
	const realRandom = Math.random;
	const bite = (roll:number):void => {
		Math.random = () => roll;
		resetTime(Time.time + 61);
		seated.lateUpdate(0.02);
	};
	try {
		seated.lateUpdate(0.02);
		Math.random = () => 0;
		seated.lateUpdate(0.02);
		assert.deepEqual(caught, [], 'no bite the moment the line goes out');
		bite(0.6);
		assert.deepEqual(caught, [], 'a 0.6 is no catch at even chances');
		bite(0.4);
		assert.deepEqual(caught, ['SilverTrout']);
		assert.ok(findCarried(go, (it) => it.defID === 'silver_trout'), 'it is in the bag');
		go.addComponent(Belly).eat('moon_mushroom', 'lucky', 0.25);
		bite(0.6);
		assert.equal(caught.length, 2, 'a 0.6 lands one with luck');
	}
	finally {
		Math.random = realRandom;
	}
});
