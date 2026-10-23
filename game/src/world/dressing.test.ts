import { BoxCollider, GameObject, Rigidbody } from '@arc-director/kindling';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatSight } from 'arc-director';
import { Named } from '../engine/components';
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
import { DRESSING_SIGHT_WORDS, planProps, PROP_IDS } from './dressingPlan';
import { cellWays } from './path';
import { solidAt, THIN_WALLS } from './thinWall';

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
			const chunk = chunks.find((c) => c.tileAtWorld(spot.x, spot.z));
			const tile = chunk?.tileAtWorld(spot.x, spot.z);
			// Against a thin wall a prop may stand in the open half of the wall's cell.
			const open = !!tile && (!tile.blocked || (THIN_WALLS.has(tile.def) && !solidAt(chunk!, spot.x, spot.z)));
			assert.ok(open, `${scene}: ${spot.prop} sits on ${tile?.def ?? 'nothing'} at ${spot.x}, ${spot.z}`);
		}
	}
	assert.deepEqual(PROP_IDS.filter((id) => !placed.has(id)), [], 'props no scene places');
});

test('in the glen, dressing blocks walking when solid, and never reaches sight', () => {
	const chunks = decode(SCENE_MAPS.glen!);
	const world = new World();
	for (const chunk of chunks) {
		spawnChunkEntities(world, chunk);
		world.addChunk(chunk);
	}
	syncDressingColliders(world);
	world.reindex();
	const npc = new GameObject('Mara', 'Person');
	npc.addComponent(Named, { id: 'Mara' });
	npc.addComponent(Rigidbody);
	npc.addComponent(BoxCollider, { size: { x: 0.45, y: 1.1, z: 0.45 }, pad: 0.36 });
	npc.transform.localPosition = { x: 24.5, y: 0, z: 5.5 };
	world.add(npc);

	const sight = lookWorld(npc, 'in the glen');
	const text = [sight.ambient ?? '', formatSight(sight), ...sight.objects.map((obj) => `${obj.id} ${(obj.tags ?? []).join(' ')}`)].join('\n');
	assert.match(text, /Cottage/);
	for (const word of DRESSING_SIGHT_WORDS) {
		assert.doesNotMatch(text, new RegExp(`\b${word}\b`, 'i'));
	}

	/** Whether a route steps from the tile east of a prop onto it. */
	const stepsOnto = (prop:string):boolean => {
		const spot = planProps(chunks).find((s) => s.prop === prop)!;
		const tile = world.tileCoordAt(spot.x, spot.z);
		const beside = world.tileCenter(tile.tx + 1, tile.tz);
		const onto = world.tileCenter(tile.tx, tile.tz);
		return cellWays(world).canPass(npc, [beside.x, beside.z], [onto.x, onto.z]) !== undefined;
	};
	assert.equal(stepsOnto('weaponRack'), false, 'a route steps onto the weapon rack');
	assert.equal(stepsOnto('bucket'), true, 'routes skip the bucket tile');
});

test('in the ruins, no route steps onto a cell a fallen column lies across', () => {
	const chunks = decode(SCENE_MAPS.ruins!);
	const world = new World();
	for (const chunk of chunks) {
		spawnChunkEntities(world, chunk);
		world.addChunk(chunk);
	}
	syncDressingColliders(world);
	world.reindex();
	const walker = new GameObject('Walker', 'Person');
	const ways = cellWays(world);
	const columns = planProps(chunks).filter((spot) => spot.prop === 'fallenColumn');
	assert.ok(columns.length > 0, 'the ruins have no fallen columns');
	for (const column of columns) {
		const along = Math.abs(Math.sin(column.yaw)) > 0.5 ? { x: 0, z: 1 } : { x: 1, z: 0 };
		const tile = world.tileCoordAt(column.x, column.z);
		for (const reach of [-1, 0, 1]) {
			const under = { tx: tile.tx + along.x * reach, tz: tile.tz + along.z * reach };
			for (const [dx, dz] of [[along.z, along.x], [-along.z, -along.x]]) {
				const beside = world.tileCenter(under.tx + dx!, under.tz + dz!);
				const middle = world.tileCenter(under.tx, under.tz);
				const onto = ways.canPass(walker, [beside.x, beside.z], [middle.x, middle.z]) !== undefined;
				assert.equal(onto, false, `a step lands on the fallen column at ${column.x}, ${column.z} (cell ${under.tx}, ${under.tz})`);
			}
		}
	}
	for (const brazier of planProps(chunks).filter((spot) => spot.prop === 'brazier')) {
		const { x, z } = world.tileCenter(world.tileCoordAt(brazier.x, brazier.z).tx, world.tileCoordAt(brazier.x, brazier.z).tz);
		const into = ways.getNeighbors([x, z]).filter((from) => ways.canPass(walker, from, [x, z]) !== undefined);
		assert.deepEqual(into, [], `a step lands in the brazier at ${brazier.x}, ${brazier.z}`);
	}
});
