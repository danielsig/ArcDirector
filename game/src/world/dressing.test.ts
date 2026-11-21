import { BoxCollider, GameObject, Rigidbody } from '@arc-director/kindling';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatSight } from 'arc-director';
import { Named } from '../engine/components';
import { DemoWorld } from '../engine/demo-world';
import { lookWorld } from '../director/perception';
import { GLEN_CHUNKS } from '../scenes/glen/glen-map';
import { MARKETPLACE_CHUNKS } from '../scenes/marketplace/marketplace-map';
import { COMBAT_CHUNKS } from '../scenes/combat/combat-map';
import { DUNGEON_CHUNKS } from '../scenes/dungeon/dungeon-map';
import { decodeGlyphChunk, type ChunkFile } from './decode-glyph-chunk';
import { spawnChunkEntities } from './spawn';
import { syncDressingColliders } from '../kit/props/dressing-colliders';
import { DRESSING_SIGHT_WORDS, planProps, PROP_IDS } from '../kit/props/dressing-plan';
import { cellWays } from './path';
import { solidAt } from '../kit/walls/thin-wall';

import type { DemoChunk } from './demo-chunk';
import { TERRAIN } from './terrain-kinds';

const SCENE_MAPS:Record<string, ChunkFile[]> = {
	glen: GLEN_CHUNKS,
	marketplace: MARKETPLACE_CHUNKS,
	combat: COMBAT_CHUNKS,
	dungeon: DUNGEON_CHUNKS,
};

const decode = (files:ChunkFile[]):DemoChunk[] => files.map((file) => decodeGlyphChunk(file).chunk);

test('dressing stands on open ground, and every prop is used somewhere', () => {
	const placed = new Set<string>();
	for (const [scene, files] of Object.entries(SCENE_MAPS)) {
		const { terrain } = new DemoWorld();
		decode(files).forEach((chunk) => terrain.register(chunk));
		for (const spot of planProps(terrain)) {
			placed.add(spot.prop);
			const tile = terrain.tileAtWorld(spot.x, spot.z);
			// Against a thin wall a prop may stand in the open half of the wall's cell.
			const open = !!tile && (!tile.blocked || (TERRAIN[tile.def].thin && !solidAt(terrain, spot.x, spot.z)));
			assert.ok(open, `${scene}: ${spot.prop} sits on ${tile?.def ?? 'nothing'} at ${spot.x}, ${spot.z}`);
		}
	}
	assert.deepEqual(PROP_IDS.filter((id) => !placed.has(id)), [], 'props no scene places');
});

test('in the glen, dressing blocks walking when solid, and never reaches sight', () => {
	const chunks = decode(SCENE_MAPS.glen!);
	const world = new DemoWorld();
	for (const chunk of chunks) {
		spawnChunkEntities(world, chunk);
		world.terrain.register(chunk);
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
		assert.doesNotMatch(text, new RegExp(String.raw`\b${word}\b`, 'i'));
	}

	/** Whether a route steps onto a prop's tile from any side. */
	const stepsOnto = (prop:string):boolean => {
		const spot = planProps(world.terrain).find((s) => s.prop === prop)!;
		const tile = world.terrain.tileCoordAt(spot.x, spot.z);
		const onto = world.terrain.tileCenter({ tx: tile.tx, tz: tile.tz });
		const ways = cellWays(world);
		const at = ways.createAt([onto.x, onto.z]);
		return ways.getNeighbors(at).some((from) => ways.getPassage(npc, from, at) !== undefined);
	};
	assert.equal(stepsOnto('weaponRack'), false, 'a route steps onto the weapon rack');
	assert.equal(stepsOnto('bucket'), true, 'routes skip the bucket tile');
});

test('in the combat scene, no route steps onto a cell a fallen column lies across', () => {
	const chunks = decode(SCENE_MAPS.combat!);
	const world = new DemoWorld();
	for (const chunk of chunks) {
		spawnChunkEntities(world, chunk);
		world.terrain.register(chunk);
	}
	syncDressingColliders(world);
	world.reindex();
	const walker = new GameObject('Walker', 'Person');
	const ways = cellWays(world);
	const columns = planProps(world.terrain).filter((spot) => spot.prop === 'fallenColumn');
	assert.ok(columns.length > 0, 'the combat map has no fallen columns');
	for (const column of columns) {
		const along = Math.abs(Math.sin(column.yaw)) > 0.5 ? { x: 0, z: 1 } : { x: 1, z: 0 };
		const tile = world.terrain.tileCoordAt(column.x, column.z);
		for (const reach of [-1, 0, 1]) {
			const under = { tx: tile.tx + along.x * reach, tz: tile.tz + along.z * reach };
			for (const [dx, dz] of [[along.z, along.x], [-along.z, -along.x]]) {
				const beside = world.terrain.tileCenter({ tx: under.tx + dx!, tz: under.tz + dz! });
				const middle = world.terrain.tileCenter({ tx: under.tx, tz: under.tz });
				const onto = ways.getPassage(walker, ways.createAt([beside.x, beside.z]), ways.createAt([middle.x, middle.z])) !== undefined;
				assert.equal(onto, false, `a step lands on the fallen column at ${column.x}, ${column.z} (cell ${under.tx}, ${under.tz})`);
			}
		}
	}
	for (const brazier of planProps(world.terrain).filter((spot) => spot.prop === 'brazier')) {
		const { x, z } = world.terrain.tileCenter(world.terrain.tileCoordAt(brazier.x, brazier.z));
		const at = ways.createAt([x, z]);
		const into = ways.getNeighbors(at).filter((from) => ways.getPassage(walker, from, at) !== undefined);
		assert.deepEqual(into, [], `a step lands in the brazier at ${brazier.x}, ${brazier.z}`);
	}
});
