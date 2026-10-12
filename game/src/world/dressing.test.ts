import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatSight } from 'arc-director';
import { Named } from '../engine/components';
import { GameObject } from '../engine/GameObject';
import { World } from '../engine/World';
import { lookWorld } from '../director/perception';
import { glen_0_0 } from '../data/chunks/glen_0_0';
import { glen_0_1 } from '../data/chunks/glen_0_1';
import { glen_1_0 } from '../data/chunks/glen_1_0';
import { glen_1_1 } from '../data/chunks/glen_1_1';
import { market_0_0 } from '../data/chunks/market_0_0';
import { market_0_1 } from '../data/chunks/market_0_1';
import { market_1_0 } from '../data/chunks/market_1_0';
import { market_1_1 } from '../data/chunks/market_1_1';
import { RUINS_CHUNKS } from '../data/chunks/ruins';
import { DUNGEON_CHUNKS } from '../data/chunks/dungeon';
import { decodeGlyphChunk, type ChunkFile } from './decodeGlyphChunk';
import { spawnChunkEntities } from './spawn';
import { syncDressingColliders } from './dressingColliders';
import { DRESSING_SIGHT_WORDS, grassCleared, planProps, PROP_IDS } from './dressingPlan';
import { cellSteps } from './path';

import type { Chunk } from './Chunk';

const SCENE_MAPS:Record<string, ChunkFile[]> = {
	glen: [glen_0_0, glen_0_1, glen_1_0, glen_1_1],
	marketplace: [market_0_0, market_0_1, market_1_0, market_1_1],
	ruins: RUINS_CHUNKS,
	dungeon: DUNGEON_CHUNKS,
};

const decode = (files:ChunkFile[]):Chunk[] => files.map((file) => decodeGlyphChunk(file).chunk);

test('dressing stands on open ground, and every prop is used somewhere', () => {
	const placed = new Set<string>();
	for (const [scene, files] of Object.entries(SCENE_MAPS)) {
		const chunks = decode(files);
		for (const spot of planProps(chunks)) {
			placed.add(spot.prop);
			const tile = chunks.map((chunk) => chunk.tileAtWorld(spot.x, spot.z)).find(Boolean);
			assert.ok(tile && !tile.blocked, `${scene}: ${spot.prop} sits on ${tile?.def ?? 'nothing'} at ${spot.x}, ${spot.z}`);
		}
	}
	assert.deepEqual(PROP_IDS.filter((id) => !placed.has(id)), [], 'props no scene places');
});

test('in the glen, dressing clears paths, blocks walking when solid, and never reaches sight', () => {
	const chunks = decode(SCENE_MAPS.glen!);
	const span = chunks.flatMap((chunk) => chunk.entities.filter((e) => e.def === 'bridge_span').map((e) => chunk.worldCellCenter(e.localX, e.localZ)))
		.sort((a, b) => a.z - b.z)[0];
	assert.ok(span && grassCleared(chunks, span.x, span.z - 1), 'the cottage path reaches the bridge');

	const world = new World();
	for (const chunk of chunks) {
		spawnChunkEntities(world, chunk);
		world.addChunk(chunk);
	}
	syncDressingColliders(world);
	world.reindex();
	const npc = new GameObject('Mara', 'Person');
	npc.addComponent(Named, { id: 'Mara' });
	npc.transform.localPosition = { x: 24.5, y: 0, z: 5.5 };
	world.add(npc);

	const sight = lookWorld(npc, 'in the glen');
	const text = [sight.ambient ?? '', formatSight(sight), ...sight.objects.map((obj) => `${obj.id} ${(obj.tags ?? []).join(' ')}`)].join('\n');
	assert.match(text, /Cottage/);
	for (const word of DRESSING_SIGHT_WORDS) {
		assert.doesNotMatch(text, new RegExp(`\b${word}\b`, 'i'));
	}

	/** Whether the path graph steps from the tile east of a prop onto it. */
	const stepsOnto = (prop:string):boolean => {
		const spot = planProps(chunks).find((s) => s.prop === prop)!;
		const tile = world.tileCoordAt(spot.x, spot.z);
		const beside = world.tileCenter(tile.tx + 1, tile.tz);
		return cellSteps(world, npc)([beside.x, beside.z]).some((step) => {
			const at = world.tileCoordAt(step.point[0], step.point[1]);
			return at.tx === tile.tx && at.tz === tile.tz;
		});
	};
	assert.equal(stepsOnto('weaponRack'), false, 'the path graph steps onto the weapon rack');
	assert.equal(stepsOnto('bucket'), true, 'the path graph skips the bucket tile');
});
