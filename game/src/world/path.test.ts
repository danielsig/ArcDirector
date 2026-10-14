import { GameObject } from '@arc-director/kindling';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findRoute, pointGoal, type Vec } from 'arc-director';
import { World } from '../engine/World';
import { RUINS_CHUNKS } from '../data/chunks/ruins';
import { USE_RANGE } from '../items/pickup';
import { decodeGlyphChunk } from './decodeGlyphChunk';
import { spawnChunkEntities } from './spawn';
import { syncDressingColliders } from './dressingColliders';
import { cellSteps, standableNear } from './path';

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
	const graph = cellSteps(world, walker);
	const start:Vec = [9.5, 9.5];
	// Glyph rows 9 and 11, column 11: a low wall one could drop off, and a tall one. Row 8, column 7: a pillar.
	for (const [what, at] of [['low wall', [11.5, 9.5]], ['tall wall', [11.5, 11.5]], ['pillar', [7.5, 8.5]]] as const) {
		const route = findRoute(graph, start, pointGoal([...at]));
		assert.ok(!route || !('points' in route), `a route ends inside the ${what}: ${JSON.stringify(route)}`);
	}
	const beside = findRoute(graph, start, pointGoal([7.5, 8.5], USE_RANGE * 0.55));
	assert.ok(beside && 'points' in beside, 'no way to stand beside the pillar');
	// A spot worked out by geometry moves off the wall onto the floor beside it, and from there a route ends on it.
	const off = standableNear(world, walker, { x: 11.5, z: 9.5 });
	assert.deepEqual(world.tileCoordAt(off.x, off.z), { tx: 10, tz: 9 });
	assert.ok('points' in findRoute(graph, start, pointGoal([off.x, off.z]))!);
	assert.deepEqual(standableNear(world, walker, { x: 9.3, z: 9.6 }), { x: 9.3, z: 9.6 });
});
