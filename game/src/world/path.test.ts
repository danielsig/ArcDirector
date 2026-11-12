import { GameObject, type XZ } from '@arc-director/kindling';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findRoute, pointGoal, type Vec } from 'arc-director';
import { DemoWorld } from '../engine/demo-world';
import { BoxCollider } from '../engine/components';
import { glen_0_0 } from '../data/chunks/glen-0-0';
import { glen_0_1 } from '../data/chunks/glen-0-1';
import { glen_1_0 } from '../data/chunks/glen-1-0';
import { glen_1_1 } from '../data/chunks/glen-1-1';
import { market_1_0 } from '../data/chunks/market-1-0';
import { RUINS_CHUNKS } from '../scenes/ruins/ruins-map';
import { USE_RANGE } from '../items/pickup';
import { decodeGlyphChunk } from './decode-glyph-chunk';
import { spawnChunkEntities } from './spawn';
import { syncDressingColliders } from './dressing-colliders';
import { cellWays, standableNear, walkClear } from './path';

test('in the ruins, no route ends inside a wall or a pillar, yet a pillar is reached from beside it', () => {
	const world = new DemoWorld();
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
	const world = new DemoWorld();
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
	const at = (x:number, z:number) => ways.getNearby([x, z]).at;
	// Stood up to the east of the glen's chair, which fills the middle of cell (27.5, 24.5).
	const stood = at(27.95, 24.5);
	assert.equal(ways.canTraverse(angler, stood, at(26.5, 24.5)), undefined, 'a step west through the chair');
	assert.ok(ways.canTraverse(angler, stood, at(28.5, 23.5)), 'no step away from the chair');
	const route = findRoute(ways, angler, stood, pointGoal([20.5, 24.5]));
	const first = route && 'points' in route ? route.points[0] : undefined;
	assert.ok(first, 'no way west around the chair');
	assert.notDeepEqual([first[0], first[1]], [26.5, 24.5]);
	// What it stands in does not hold it: from the chair's own middle it can still step away.
	const away = ways.canTraverse(angler, at(27.5, 24.5), at(27.5, 23.5));
	assert.ok(away && !away.blocked, 'no step off the chair');
});

test('a stair is stepped on and off only along its climb, not from the side', () => {
	const world = new DemoWorld();
	const chunk = decodeGlyphChunk(market_1_0).chunk;
	world.addChunk(chunk);
	const ways = cellWays(world);
	const walker = new GameObject('Walker', 'Person');
	// The shop steps: a row of stair cells, the raised floor south of them, open ground north and east.
	const at = (p:XZ) => ways.getNearby([p.x, p.z]).at;
	const stair = at(chunk.worldCellCenter(2, 6));
	const beside = at(chunk.worldCellCenter(3, 6));
	const foot = at(chunk.worldCellCenter(2, 5));
	const landing = at(chunk.worldCellCenter(2, 7));
	assert.equal(ways.canTraverse(walker, beside, stair), undefined);
	assert.equal(ways.canTraverse(walker, stair, beside), undefined);
	assert.ok(ways.canTraverse(walker, foot, stair));
	assert.ok(ways.canTraverse(walker, landing, stair));
	const up = findRoute(ways, walker, foot, pointGoal(landing));
	assert.ok(up && 'points' in up, 'no way up the stairs from the foot');
});

test('a walk along a wall and past its corner is clear, one through the wall is not', () => {
	const world = new DemoWorld();
	for (const file of RUINS_CHUNKS) {
		world.addChunk(decodeGlyphChunk(file).chunk);
	}
	world.reindex();
	const walker = new GameObject('Walker', 'Person');
	walker.addComponent(BoxCollider, { size: { x: 0.45, y: 1.1, z: 0.45 }, pad: 0.36 });
	// Glyph row 8 of the ruins: a low wall from column 27 to 30, its west end a corner where it turns south. Row 7
	// above it is open floor. Each step is checked from cell center to cell center, half a meter from the wall's face;
	// a probe half a meter off the center, toward the wall, would stand on that face.
	assert.equal(world.tileAtWorld(27.5, 8.5)?.blocked, true);
	assert.equal(world.tileAtWorld(27.5, 7.5)?.blocked, false);
	assert.ok(walkClear(world, walker, { x: 24.5, z: 7.5 }, { x: 33.5, z: 7.5 }), 'stopped walking along the wall');
	assert.ok(walkClear(world, walker, { x: 26.5, z: 9.5 }, { x: 25.5, z: 6.5 }), 'stopped walking past its corner');
	assert.equal(walkClear(world, walker, { x: 25.5, z: 9.5 }, { x: 28.5, z: 9.5 }), false, 'walked through the wall');
});
