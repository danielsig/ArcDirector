import { resetTime, stepPhysics, yawToForward, type GameObject } from '@arc-director/kindling';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ArcDirector, showNamingText, type ArcResult, type ServingSpot } from 'arc-director';
import { CharacterMotor } from '../../characters/CharacterMotor';
import { NPCInput } from '../../characters/NPCInput';
import { MARKETPLACE } from './marketplace-scene';
import type { GameHost } from '../../director/adapter';
import type { CharacterCtx } from '../../director/game-types';
import { gameWorld } from '../../director/game-world';
import { DemoWorld } from '../../engine/demo-world';
import { decodeGlyphChunk } from '../../world/decode-glyph-chunk';
import { syncDressingColliders } from '../../kit/props/dressing-colliders';
import { spawnChunkEntities, spawnNPC, type NPCSpawnDef } from '../../world/spawn';
import { bodyOf, mindsOf } from '../scene';
import { REST_VERBS } from '../../director/game-verbs';
import { kernelsOf } from '../../director/kernels';
import { Seated } from '../../characters/Seated';
import { findCarried, tryInsert } from '../../items/inventory';
import { getDef } from '../../items/defs';
import { instantiateDef } from '../../items/instance';
import { useItem } from '../../items/use';

const DT = 1 / 30;

/** Two hawkers facing north on the south square, no stall of their own: one serves a pace ahead and one to its right, one by default. */
const HAWKERS:{ id:string; cell:[number, number]; spot?:ServingSpot }[] = [
	{ id: 'Hawker', cell: [10, 24], spot: { ahead: 1, aside: 1 } },
	{ id: 'Peddler', cell: [3, 24] },
];

type Marketplace = { world:DemoWorld; director:ArcDirector<CharacterCtx, GameObject>; spawn:(opts:Omit<NPCSpawnDef, 'cell'>, x:number, z:number)=>GameObject };

/** The marketplace's map, its sellers where the scene puts them, the hawkers, and a director that walks anyone. */
function marketplace():Marketplace {
	resetTime(0);
	const world = new DemoWorld();
	const decoded = MARKETPLACE.chunks.map(decodeGlyphChunk);
	for (const { chunk } of decoded) {
		spawnChunkEntities(world, chunk);
		world.terrain.register(chunk);
	}
	syncDressingColliders(world);
	// At the middle of the cell that world point `x`, `z` is in.
	const spawn = (opts:Omit<NPCSpawnDef, 'cell'>, x:number, z:number):GameObject => {
		const { tx, tz } = world.terrain.tileCoordAt(x, z);
		const go = spawnNPC(world, { ...opts, cell: [tx, tz] });
		world.reindex();
		return go;
	};
	for (const member of MARKETPLACE.cast.filter((m) => m.of === 'Sellers')) {
		spawnNPC(world, bodyOf(member));
	}
	for (const { id, cell } of HAWKERS) {
		spawnNPC(world, { id, meshID: 'Merchant', cell, yaw: 0, marketplaceNPC: { kind: 'vendor', wants: [] } });
	}
	world.reindex();
	const director = new ArcDirector<CharacterCtx, GameObject>()
		.withVerbs((v) => v.addStock())
		.withRPG(REST_VERBS)
		.withRequirements(MARKETPLACE.requirements ?? [])
		.withWorld(gameWorld({ world, hooks: {} } as unknown as GameHost))
		.withKernels((ctx) => kernelsOf(world, ctx.character))
		.withContext((id) => {
			const go = world.findNamed(id);
			return go && { world, character: go, npc: go.getComponent(NPCInput)! };
		});
	for (const unit of mindsOf(MARKETPLACE.cast, 'Sellers')) {
		director.addCharacter({ id: unit.id, crowd: unit.crowd, servingSpot: unit.servingSpot, offers: unit.offers, kit: { verbs: ['wait'] } });
	}
	for (const { id, spot } of HAWKERS) {
		director.addCharacter({ id, crowd: 'line', servingSpot: spot, kit: { verbs: ['wait'] } });
	}
	return { world, director, spawn };
}

/** A shopper at `x`, `z`, sent to `vendor`; its walk's result once it ends. */
function shopper(m:Marketplace, id:string, x:number, z:number, vendor:string):{ go:GameObject; done:()=>ArcResult | undefined } {
	const go = m.spawn({ id, meshID: 'Scout', marketplaceNPC: { kind: 'customer', wants: [], leaveGate: 'WestGate' } }, x, z);
	let result:ArcResult | undefined;
	m.director.addCharacter({ id, kit: { verbs: ['go_to'] } });
	void m.director.character(id)!.perform({ verb: 'go_to', args: { target: vendor } }).then((r) => {
		result = r;
	});
	return { go, done: () => result };
}

/** Ticks the director, the motors and physics until `until` holds, or a minute passes. */
async function run(m:Marketplace, until:()=>boolean):Promise<void> {
	for (let t = 0; t < 60 && !until(); t += DT) {
		m.director.tick(DT);
		m.world.forEachComponent(CharacterMotor, (motor) => motor.update(DT));
		stepPhysics(m.world, DT);
		m.world.reindex();
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

/** Where `vendor` serves `spot` (default just clear of its edge, half a pace each for a body with no size), by the pose the game gives it, and which way it faces. */
function spotOf(m:Marketplace, vendor:string, spot:ServingSpot = {}):{ point:[number, number]; facing:[number, number] } {
	const pose = gameWorld({ world: m.world, hooks: {} } as unknown as GameHost).geometry!.getPose(m.world.findNamed(vendor)!)!;
	const [fx, fz] = pose.facing!;
	// Its right on the ground, north −Z and east +X.
	const [rx, rz] = [-fz, fx];
	const [ahead, aside] = [spot.ahead ?? (pose.size ?? 0.5) + 0.5, spot.aside ?? 0];
	return { point: [pose.point[0] + fx * ahead + rx * aside, pose.point[1] + fz * ahead + rz * aside], facing: [fx, fz] };
}

/** How far `go` stands from `vendor`'s spot, how far in front of `vendor`, and how squarely it faces `vendor` (1 head on). */
function standing(m:Marketplace, go:GameObject, vendor:string, spot?:ServingSpot):{ off:number; ahead:number; facingVendor:number; at:string } {
	const { point, facing } = spotOf(m, vendor, spot);
	const p = go.transform.position;
	const v = m.world.findNamed(vendor)!.transform.position;
	const look = yawToForward(go.transform.yaw);
	const [tx, tz] = [v.x - p.x, v.z - p.z];
	return {
		off: Math.hypot(p.x - point[0], p.z - point[1]),
		ahead: (p.x - v.x) * facing[0] + (p.z - v.z) * facing[1],
		facingVendor: (look.x * tx + look.z * tz) / Math.hypot(tx, tz),
		at: `${p.x.toFixed(2)}, ${p.z.toFixed(2)}`,
	};
}

/**
 * Where each seller's buyer should stand, measured on the map: its counter's front (a stall's 1.396 m before its seller,
 * the Apothecary's 1.946 m, the Toymaker's 2.346 m), plus a body's half width (0.225 m) and a hand (0.08 m).
 */
const STALL:ServingSpot = { ahead: 1.7 };
const SPOTS:Record<string, ServingSpot> = { Baker: STALL, Weaver: STALL, Potter: STALL, Cutler: STALL, SushiChef: STALL, Apothecary: { ahead: 2.25 }, Toymaker: { ahead: 2.65, aside: 1 } };

/** Where a shopper sets off for each seller: across its square, or for a shop, the square outside its door. */
const FROM:Record<string, [number, number]> = {
	Baker: [12.5, 9.5],
	Weaver: [3.5, 9.5],
	Apothecary: [20.5, 10.5],
	Potter: [12.5, 21.5],
	Cutler: [6.5, 20.5],
	SushiChef: [12.5, 21.5],
	Toymaker: [22.5, 22.5],
};

for (const [vendor, from] of Object.entries(FROM)) {
	test(`a shopper sent to ${vendor} stands at the serving spot before the counter, facing ${vendor}`, async () => {
		const m = marketplace();
		const buyer = shopper(m, 'Mira', ...from, vendor);
		await run(m, () => buyer.done() !== undefined);
		assert.equal(buyer.done()?.status, 'ok', String(buyer.done()?.reason));
		const at = standing(m, buyer.go, vendor, SPOTS[vendor]);
		assert.ok(at.off < 0.4, `${at.off.toFixed(2)} m from the spot, at ${at.at}`);
		assert.ok(at.ahead > SPOTS[vendor].ahead! - 0.4, `in front of the counter: ${at.ahead.toFixed(2)} m ahead`);
		assert.ok(at.facingVendor > 0.85, `facing ${vendor}: ${at.facingVendor.toFixed(2)}`);
		m.director.dispose();
	});
}

test('a second shopper waits a pace behind the first, and moves up once the first is gone', async () => {
	const m = marketplace();
	const first = shopper(m, 'Mira', 12.5, 9.5, 'Baker');
	const second = shopper(m, 'Tomas', 5.5, 9.5, 'Baker');
	// A pace behind the spot; two while Mira comes round to the line's back, out of her way.
	const places = [1, 2].map((paces) => spotOf(m, 'Baker', { ahead: SPOTS.Baker.ahead! + paces }).point);
	let queued = false;
	await run(m, () => {
		const p = second.go.transform.position;
		queued ||= places.some(([x, z]) => Math.hypot(p.x - x, p.z - z) < 0.3);
		return first.done() !== undefined;
	});
	assert.equal(first.done()?.status, 'ok');
	assert.ok(queued, 'Tomas waited in line behind the spot while Mira was served');
	m.world.remove(first.go);
	m.director.removeCharacter('Mira');
	m.world.reindex();
	await run(m, () => second.done() !== undefined);
	assert.equal(second.done()?.status, 'ok');
	const at = standing(m, second.go, 'Baker', SPOTS.Baker);
	assert.ok(at.off < 0.4 && at.facingVendor > 0.85, `Tomas at the spot facing Baker: ${JSON.stringify(at)}`);
	m.director.dispose();
});

for (const { id, spot } of HAWKERS) {
	test(`a shopper sent to ${id} stands ${spot ? 'at its spot, to its right' : 'a pace in front, by default'}, facing it`, async () => {
		const m = marketplace();
		const { x, z } = m.world.findNamed(id)!.transform.position;
		const buyer = shopper(m, 'Mira', x + 3, z - 4, id);
		await run(m, () => buyer.done() !== undefined);
		assert.equal(buyer.done()?.status, 'ok', String(buyer.done()?.reason));
		const at = standing(m, buyer.go, id, spot);
		assert.ok(at.off < 0.4, `${at.off.toFixed(2)} m from the spot, at ${at.at}`);
		assert.ok(Math.hypot(m.world.findNamed(id)!.transform.position.x - x, m.world.findNamed(id)!.transform.position.z - z) < 0.05, 'never pushed');
		assert.ok(at.facingVendor > 0.6, `facing ${id}: ${at.facingVendor.toFixed(2)}`);
		m.director.dispose();
	});
}

test('a shopper orders sushi only sitting at its bench, and eats it only sitting there', async () => {
	const m = marketplace();
	const bench = m.world.findNamed('SushiStallBench')!;
	const { x, z } = bench.transform.position;
	m.spawn({ id: 'Mira', meshID: 'Scout', wallet: 10, marketplaceNPC: { kind: 'customer', wants: ['Sushi'], leaveGate: 'WestGate' } }, x, z - 3);
	m.director.addCharacter({ id: 'Mira', kit: { verbs: ['offer', 'sit', 'use'] } });
	const mira = m.director.character('Mira')!;
	const go = m.world.findNamed('Mira')!;
	// A roll in hand from before: not to be eaten standing.
	tryInsert(go, instantiateDef(getDef('sushi')));
	const eat = { verb: 'use', args: { item: 'Sushi' } };
	assert.equal(showNamingText((await mira.perform(eat)).reason ?? ''), 'sit down to eat it');
	const order = { verb: 'offer', args: { to: 'SushiChef', give: { gold: 6 }, get: { Sushi: 1 } } };
	assert.equal(showNamingText((await mira.perform(order)).reason ?? ''), 'sit at SushiStallBench to order');
	let sat:ArcResult | undefined;
	void mira.perform({ verb: 'sit', args: { target: 'SushiStallBench' } }).then((r) => {
		sat = r;
	});
	await run(m, () => sat !== undefined);
	assert.equal(sat?.status, 'ok', String(sat?.reason));
	assert.equal(go.getComponent(Seated)?.seatID, bench.id);
	// A frame later, as the game's clock would have it: tags are read once a frame.
	resetTime(1);
	let bought:ArcResult | undefined;
	void mira.perform(order).then((r) => {
		bought = r;
	});
	await run(m, () => bought !== undefined);
	assert.equal(bought?.status, 'ok', String(bought?.reason));
	const sushi = findCarried(go, (it) => it.defID === 'sushi')!;
	assert.equal(sushi.count, 2, 'it has bought another');
	assert.equal(showNamingText((await mira.perform(eat)).reason ?? ''), 'ate; you are full', 'and may eat it where it sits');
	m.director.dispose();
});
