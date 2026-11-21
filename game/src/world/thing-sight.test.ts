import { GameObject } from '@arc-director/kindling';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { Named } from '../engine/components';
import { DemoWorld } from '../engine/demo-world';
import { examineWorld, lookWorld, tagsOf } from '../director/perception';
import { SCENES } from '../scenes/scene-registry';
import { decodeGlyphChunk } from './decode-glyph-chunk';
import { spawnChunkEntities } from './spawn';
import { syncDressingColliders } from '../kit/props/dressing-colliders';
import { syncFurniture } from '../kit/furniture/furniture';

/** Scenery by the hundred, which sight leaves out. */
const SCENERY = ['tree', 'boulder', 'pillar'];

/**
 * What a mind is told of every named thing of every scene's map, as it stands at the start: its tags, how it is seen
 * from beside it, and what `examine` says. This text reaches the models, so it may change only on purpose:
 * `UPDATE_SNAPSHOTS=1` writes it anew to `thing-sight/<scene>.txt`.
 */
for (const scene of Object.values(SCENES)) {
	test(`what minds are told of the ${scene.id}'s things is unchanged`, () => {
		const world = new DemoWorld();
		for (const file of scene.chunks) {
			const chunk = decodeGlyphChunk(file).chunk;
			spawnChunkEntities(world, chunk);
			world.terrain.register(chunk);
		}
		syncDressingColliders(world);
		syncFurniture(world);
		world.reindex();
		const watcher = new GameObject('Watcher', 'Person');
		watcher.addComponent(Named, { id: 'Watcher' });
		world.add(watcher);
		const things = world.objects.filter((go) => go !== watcher && go.getComponent(Named) && !SCENERY.some((tag) => tagsOf(go).includes(tag)));
		const lines = things.map((go) => {
			const id = go.getComponent(Named)!.id;
			watcher.transform.localPosition = { x: go.transform.position.x + 0.5, y: 0, z: go.transform.position.z + 0.5 };
			const seen = lookWorld(watcher, '').objects.find((row) => row.id === id);
			const told = seen ? JSON.stringify({ ...seen, point: undefined, facing: undefined }) : 'unseen';
			return `${id} [${tagsOf(go).join(' ')}] ${told} ${examineWorld(go, watcher)}`;
		});
		const text = `${lines.sort().join('\n')}\n`;
		const file = new URL(`./thing-sight/${scene.id}.txt`, import.meta.url);
		if (process.env.UPDATE_SNAPSHOTS || !existsSync(file)) {
			mkdirSync(new URL('./thing-sight/', import.meta.url), { recursive: true });
			writeFileSync(file, text);
		}
		assert.equal(text, readFileSync(file, 'utf8'));
	});
}
