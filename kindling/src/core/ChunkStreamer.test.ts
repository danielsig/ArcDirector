import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { Camera } from '../render/Camera.js';
import { Chunk } from './Chunk.js';
import { ChunkBound, ChunkStreamer, StreamingAnchor } from './ChunkStreamer.js';
import { GameObject } from './GameObject.js';
import { Terrain } from './Terrain.js';
import { World } from './World.js';

/** Four 4×4 chunks of 1 m tiles in a row along +X; each spawns one bound crate. */
function scene():{ world:World; streamer:ChunkStreamer; anchor:GameObject; spawns:string[] } {
	const spawns:string[] = [];
	class Ground extends Terrain {
		protected override spawn(chunk:Chunk):void {
			spawns.push(chunk.id);
			const crate = new GameObject(`crate_${chunk.id}`);
			crate.addComponent(ChunkBound).chunkID = chunk.id;
			const c = chunk.worldCellCenter(1, 1);
			crate.transform.position.x = c.x;
			crate.transform.position.z = c.z;
			this.world.add(crate);
		}
	}
	class StreamWorld extends World {
		public override readonly terrain:Ground = new Ground(this);
	}
	const world = new StreamWorld();
	world.terrain.tileSize = 1;
	world.terrain.chunkSize = 4;
	[0, 1, 2, 3].forEach((cx) => world.terrain.register(new Chunk(`c${cx}`, { cx, cz: 0 }, 4, 1, Array.from({ length: 16 }, (element, i) => cx * 100 + i))));
	const host = new GameObject('Streamer');
	const streamer = host.addComponent(ChunkStreamer);
	world.add(host);
	const anchor = new GameObject('Anchor');
	const a = anchor.addComponent(StreamingAnchor);
	a.viewRadius = 2;
	a.hysteresis = 3;
	anchor.transform.position.x = 2;
	anchor.transform.position.z = 2;
	world.add(anchor);
	return { world, streamer, anchor, spawns };
}

function loaded(world:World):string[] {
	return [...world.terrain.loaded].map((c) => c.id).sort();
}

describe('Chunk', () => {
	it('maps world points to tiles and edges', () => {
		const chunk = new Chunk('c', { cx: 1, cz: -1 }, 4, 2, Array.from({ length: 16 }, (element, i) => i));
		assert.equal(chunk.worldOriginX(), 8);
		assert.equal(chunk.worldOriginZ(), -8);
		assert.equal(chunk.tileAtWorld(11, -3), 9);
		assert.equal(chunk.tileAtWorld(7.9, -3), undefined);
		assert.deepEqual(chunk.worldCellCenter(0, 3), { x: 9, z: -1 });
		assert.equal(chunk.distanceTo(10, -4), 0);
		assert.equal(chunk.distanceTo(19, -4), 3);
		const seen:number[] = [];
		chunk.forEachTile((tile, localX, localZ) => {
			assert.equal(tile, localZ * 4 + localX);
			seen.push(tile);
		});
		assert.equal(seen.length, 16);
	});
});

describe('ChunkStreamer', () => {
	it('loads near anchors, parks far chunk objects, and brings the same ones back', () => {
		const { world, streamer, anchor, spawns } = scene();
		streamer.stream();
		assert.deepEqual(loaded(world), ['c0', 'c1']);
		assert.equal(world.terrain.tileAtWorld(12.5, 0.5), 300, 'a chunk not loaded still has its tiles');
		const crate = world.findByID('crate_c0')!;

		anchor.transform.position.x = 12;
		streamer.stream();
		assert.deepEqual(loaded(world), ['c1', 'c2', 'c3'], 'c1 is held by hysteresis');
		assert.equal(world.findByID('crate_c0'), undefined);

		anchor.transform.position.x = 2;
		streamer.stream();
		assert.equal(world.findByID('crate_c0'), crate);
		assert.deepEqual(spawns, ['c0', 'c1', 'c2', 'c3'], 'spawn runs once per chunk');
	});

	it('uses each anchor\'s own radius', () => {
		const { world, streamer } = scene();
		const far = new GameObject('Far');
		far.addComponent(StreamingAnchor).viewRadius = 0;
		far.transform.position.x = 14;
		world.add(far);
		streamer.stream();
		assert.deepEqual(loaded(world), ['c0', 'c1', 'c3']);
	});

	it('loads every chunk a camera could show, out to its fog', () => {
		const { world, streamer, anchor } = scene();
		anchor.getComponent(StreamingAnchor)!.enabled = false;
		world.native.fog = new THREE.Fog(0, 1, 4);
		const eye = new GameObject('Eye');
		eye.addComponent(Camera, { fov: 90 });
		world.add(eye);
		streamer.stream();
		assert.deepEqual(loaded(world), ['c0', 'c1'], 'fog at 4 m, widened to the corners of a square 90° view: about 6.9 m');
	});

	it('changes nothing without anchors, and loadAll brings everything in', () => {
		const { world, streamer, anchor } = scene();
		anchor.getComponent(StreamingAnchor)!.enabled = false;
		streamer.stream();
		assert.equal(world.terrain.loaded.size, 0);
		world.terrain.loadAll();
		assert.deepEqual(loaded(world), ['c0', 'c1', 'c2', 'c3']);
		assert.ok(world.findByID('crate_c3'));
	});
});
