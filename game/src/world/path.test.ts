import { GameObject } from '@arc-director/kindling';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findRoute, pointGoal, type Vec } from 'arc-director';
import { World } from '../engine/World';
import { BoxCollider } from '../engine/components';
import { glen_0_0 } from '../data/chunks/glen_0_0';
import { glen_0_1 } from '../data/chunks/glen_0_1';
import { glen_1_0 } from '../data/chunks/glen_1_0';
import { glen_1_1 } from '../data/chunks/glen_1_1';
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

test('off the middle of a cell, a route does not leave through what stands in that cell', () => {
	const world = new World();
	for (const file of [glen_0_0, glen_0_1, glen_1_0, glen_1_1]) {
		const chunk = decodeGlyphChunk(file).chunk;
		spawnChunkEntities(world, chunk);
		world.addChunk(chunk);
	}
	syncDressingColliders(world);
	world.reindex();
	const angler = new GameObject('Angler', 'Person');
	angler.addComponent(BoxCollider, { size: { x: 0.45, y: 1.1, z: 0.45 }, pad: 0.36 });
	const ways = cellWays(world);
	// Stood up to the east of the glen's chair, which fills the middle of cell (27.5, 24.5).
	const stood:Vec = [27.95, 24.5];
	assert.equal(ways.canPass(angler, stood, [26.5, 24.5]), undefined, 'a step west through the chair');
	assert.ok(ways.canPass(angler, stood, [28.5, 23.5]), 'no step away from the chair');
	const route = findRoute(ways, angler, stood, pointGoal([20.5, 24.5]));
	const first = route && 'points' in route ? route.points[0] : undefined;
	assert.ok(first, 'no way west around the chair');
	assert.notDeepEqual(first, [26.5, 24.5]);
	// What it stands in does not hold it: from the chair's own middle it can still step away.
	const away = ways.canPass(angler, [27.5, 24.5], [27.5, 23.5]);
	assert.ok(away && !away.blocked, 'no step off the chair');
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
