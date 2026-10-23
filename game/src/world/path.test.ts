import { GameObject } from '@arc-director/kindling';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findRoute, pointGoal, type Vec } from 'arc-director';
import { World } from '../engine/World';
import { market_1_0 } from '../data/chunks/market_1_0';
import { RUINS_CHUNKS } from '../data/chunks/ruins';
import { USE_RANGE } from '../items/pickup';
import { decodeGlyphChunk } from './decodeGlyphChunk';
import { spawnChunkEntities } from './spawn';
import { syncDressingColliders } from './dressingColliders';
import { cellWays, standableNear } from './path';

// A brazier's flame loads its picture through Three, which needs document. These tests never draw.
if (!('document' in globalThis)) {
	const image = { addEventListener():void {}, removeEventListener():void {} };
	Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElementNS: () => image } });
}

test('in the ruins, no route ends inside a wall or a pillar, yet a pillar is reached from beside it', () => {
	const world = new World();
	for (const file of RUINS_CHUNKS) {
		const chunk = decodeGlyphChunk(file).chunk;
		spawnChunkEntities(world, chunk);
		world.addChunk(chunk);
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
	assert.deepEqual(world.tileCoordAt(off.x, off.z), { tx: 26, tz: 9 });
	assert.ok('points' in findRoute(ways, walker, start, pointGoal([off.x, off.z]))!);
	assert.deepEqual(standableNear(world, walker, { x: 25.3, z: 9.6 }), { x: 25.3, z: 9.6 });
});

test('a stair is a neighbour only along its climb, not from the side', () => {
	const world = new World();
	const chunk = decodeGlyphChunk(market_1_0).chunk;
	world.addChunk(chunk);
	const ways = cellWays(world);
	const walker = new GameObject('Walker', 'Person');
	// The shop steps: a row of stair cells, the raised floor south of them, open ground north and east.
	const stair = chunk.worldCellCenter(2, 6);
	const beside = chunk.worldCellCenter(3, 6);
	const foot = chunk.worldCellCenter(2, 5);
	const landing = chunk.worldCellCenter(2, 7);
	const has = (from:{ x:number; z:number }, to:{ x:number; z:number }) => ways.getNeighbors([from.x, from.z]).some(([x, z]) => x === to.x && z === to.z);
	assert.equal(has(beside, stair), false);
	assert.equal(has(stair, beside), false);
	assert.equal(has(foot, stair), true);
	assert.equal(has(landing, stair), true);
	assert.equal(ways.canPass(walker, [beside.x, beside.z], [stair.x, stair.z]), undefined);
	assert.ok(ways.canPass(walker, [foot.x, foot.z], [stair.x, stair.z]));
	const up = findRoute(ways, walker, [foot.x, foot.z], pointGoal([landing.x, landing.z]));
	assert.ok(up && 'points' in up, 'no way up the stairs from the foot');
});
