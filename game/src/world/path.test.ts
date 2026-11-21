import { GameObject, stepPhysics, Rigidbody, type XZ } from '@arc-director/kindling';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findRoute, pointGoal, type Vec } from 'arc-director';
import { DemoWorld } from '../engine/demo-world';
import { BoxCollider, Lock } from '../engine/components';
import { CharacterMotor } from '../characters/CharacterMotor';
import { NPCInput } from '../characters/NPCInput';
import { GLEN_CHUNKS } from '../scenes/glen/glen-map';
import { MARKETPLACE_CHUNKS } from '../scenes/marketplace/marketplace-map';
import { COMBAT_CHUNKS } from '../scenes/combat/combat-map';
import { DUNGEON_CHUNKS } from '../scenes/dungeon/dungeon-map';
import { USE_RANGE } from '../items/pickup';
import { decodeGlyphChunk } from './decode-glyph-chunk';
import { spawnChunkEntities } from './spawn';
import { syncDressingColliders } from '../kit/props/dressing-colliders';
import { cellWays, standableNear, walkClear } from './path';
import { Door } from '../kit/door/door';

test('in the combat scene, no route ends inside a wall or a pillar, yet a pillar is reached from beside it', () => {
	const world = new DemoWorld();
	for (const file of COMBAT_CHUNKS) {
		const chunk = decodeGlyphChunk(file).chunk;
		spawnChunkEntities(world, chunk);
		world.terrain.register(chunk);
	}
	syncDressingColliders(world);
	world.reindex();
	const walker = new GameObject('Walker', 'Person');
	const ways = cellWays(world);
	const start:Vec = [25.5, 9.5];
	// Glyph rows 9 and 11, column 27: a low wall one could drop off, and a tall one. Row 8, column 23: a pillar.
	for (const [what, at] of [['low wall', [27.5, 9.5]], ['tall wall', [27.5, 11.5]], ['pillar', [23.5, 8.5]]] as const) {
		const route = findRoute(ways, walker, start, pointGoal([...at]));
		assert.ok(!route || !('points' in route), `a route ends inside the ${what}: ${JSON.stringify(route)}`);
	}
	const beside = findRoute(ways, walker, start, pointGoal([23.5, 8.5], USE_RANGE * 0.55));
	assert.ok(beside && 'points' in beside, 'no way to stand beside the pillar');
	// A spot worked out by geometry moves off the wall onto the floor beside it, and from there a route ends on it.
	const off = standableNear(world, walker, { x: 27.5, z: 9.5 });
	assert.deepEqual(world.terrain.tileCoordAt(off.x, off.z), { tx: 26, tz: 9 });
	assert.ok('points' in findRoute(ways, walker, start, pointGoal([off.x, off.z]))!);
	assert.deepEqual(standableNear(world, walker, { x: 25.3, z: 9.6 }), { x: 25.3, z: 9.6 });
});

test('off the middle of a cell, a route does not leave through what stands in that cell', () => {
	const world = new DemoWorld();
	for (const file of GLEN_CHUNKS) {
		const chunk = decodeGlyphChunk(file).chunk;
		spawnChunkEntities(world, chunk);
		world.terrain.register(chunk);
	}
	syncDressingColliders(world);
	world.reindex();
	const angler = new GameObject('Angler', 'Person');
	angler.addComponent(BoxCollider, { size: { x: 0.45, y: 1.1, z: 0.45 }, pad: 0.36 });
	const ways = cellWays(world);
	const at = (x:number, z:number) => ways.createAt([x, z]);
	// Stood up to the east of the glen's chair, which fills the middle of cell (27.5, 24.5).
	const stood = at(27.95, 24.5);
	assert.equal(ways.getPassage(angler, stood, at(26.5, 24.5)), undefined, 'a step west through the chair');
	assert.ok(ways.getPassage(angler, stood, at(28.5, 23.5)), 'no step away from the chair');
	const route = findRoute(ways, angler, stood, pointGoal([20.5, 24.5]));
	const first = route && 'points' in route ? route.points[0] : undefined;
	assert.ok(first, 'no way west around the chair');
	assert.notDeepEqual([first[0], first[1]], [26.5, 24.5]);
	// What it stands in does not hold it: from the chair's own middle it can still step away.
	const away = ways.getPassage(angler, at(27.5, 24.5), at(27.5, 23.5));
	assert.ok(away && !away.blocked, 'no step off the chair');
});

test('a stair is stepped on and off only along its climb, not from the side', () => {
	const world = new DemoWorld();
	const chunk = decodeGlyphChunk(MARKETPLACE_CHUNKS.find((file) => file.id === 'marketplace_1_0')!).chunk;
	world.terrain.register(chunk);
	const ways = cellWays(world);
	const walker = new GameObject('Walker', 'Person');
	// The shop steps: a row of stair cells, the raised floor south of them, open ground north and east.
	const at = (p:XZ) => ways.createAt([p.x, p.z]);
	const stair = at(chunk.worldCellCenter(2, 6));
	const beside = at(chunk.worldCellCenter(3, 6));
	const foot = at(chunk.worldCellCenter(2, 5));
	const landing = at(chunk.worldCellCenter(2, 7));
	assert.equal(ways.getPassage(walker, beside, stair), undefined);
	assert.equal(ways.getPassage(walker, stair, beside), undefined);
	assert.ok(ways.getPassage(walker, foot, stair));
	assert.ok(ways.getPassage(walker, landing, stair));
	const up = findRoute(ways, walker, foot, pointGoal(landing));
	assert.ok(up && 'points' in up, 'no way up the stairs from the foot');
});

test('a walk along a wall and past its corner is clear, one through the wall is not', () => {
	const world = new DemoWorld();
	for (const file of COMBAT_CHUNKS) {
		world.terrain.register(decodeGlyphChunk(file).chunk);
	}
	world.reindex();
	const walker = new GameObject('Walker', 'Person');
	walker.addComponent(BoxCollider, { size: { x: 0.45, y: 1.1, z: 0.45 }, pad: 0.36 });
	// Glyph row 8 of the combat map: a low wall from column 27 to 30, its west end a corner where it turns south. Row 7
	// above it is open floor. Each step is checked from cell center to cell center, half a meter from the wall's face;
	// a probe half a meter off the center, toward the wall, would stand on that face.
	assert.equal(world.terrain.tileAtWorld(27.5, 8.5)?.blocked, true);
	assert.equal(world.terrain.tileAtWorld(27.5, 7.5)?.blocked, false);
	assert.ok(walkClear(world, walker, { x: 24.5, z: 7.5 }, { x: 33.5, z: 7.5 }), 'stopped walking along the wall');
	assert.ok(walkClear(world, walker, { x: 26.5, z: 9.5 }, { x: 25.5, z: 6.5 }), 'stopped walking past its corner');
	assert.equal(walkClear(world, walker, { x: 25.5, z: 9.5 }, { x: 28.5, z: 9.5 }), false, 'walked through the wall');
});

test('a walker gets past an open door\'s leaf instead of pressing against it', () => {
	const world = new DemoWorld();
	for (const file of DUNGEON_CHUNKS) {
		const chunk = decodeGlyphChunk(file).chunk;
		spawnChunkEntities(world, chunk);
		world.terrain.register(chunk);
	}
	const doorGo = world.findNamed('SealedDoor')!;
	const door = doorGo.getComponent(Door)!;
	doorGo.getComponent(Lock)!.locked = false;
	door.open = true;
	door.syncCollision();
	// From the PillaredHall, north of the open leaf that sticks half a meter into it, east to the far side.
	const walker = new GameObject('Walker', 'Person');
	walker.transform.localPosition = { x: 19.5, y: 0, z: 17.5 };
	const npc = walker.addComponent(NPCInput);
	const motor = walker.addComponent(CharacterMotor);
	walker.addComponent(Rigidbody, { kinematic: true });
	walker.addComponent(BoxCollider, { size: { x: 0.45, y: 1.1, z: 0.45 }, pad: 0.36 });
	world.add(walker);
	world.reindex();
	const ways = cellWays(world);
	assert.equal(ways.getPassage(walker, ways.createAt([19.5, 17.5]), ways.createAt([19.5, 18.5])), undefined, 'the leaf is a door to open');
	const goal:Vec = [32.5, 16.5];
	const route = findRoute(ways, walker, [19.5, 17.5], pointGoal(goal, 1));
	assert.ok(route && 'points' in route, 'no way past the open door');
	const dt = 1 / 60;
	let i = 0;
	for (let t = 0; t < 10 && i < route.points.length; t += dt) {
		const q = route.points[i];
		const at = walker.transform.position;
		npc.destinationPoint = { x: q[0], z: q[1] };
		if (Math.hypot(at.x - q[0], at.z - q[1]) <= motor.arriveEpsilon) {
			i++;
			continue;
		}
		motor.update(dt);
		stepPhysics(world, dt);
		world.reindex();
	}
	const at = walker.transform.position;
	assert.ok(Math.hypot(at.x - goal[0], at.z - goal[1]) <= 1.5, `stuck at ${at.x.toFixed(2)}, ${at.z.toFixed(2)}`);
});
