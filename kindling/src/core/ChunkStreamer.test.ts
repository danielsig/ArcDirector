import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Chunk } from './Chunk.js';
import { ChunkBound, ChunkStreamer, StreamingAnchor } from './ChunkStreamer.js';
import { GameObject } from './GameObject.js';
import { World } from './World.js';

/** Four 4×4 chunks of 1 m tiles in a row along +X; each spawns one bound crate. */
function scene():{ world:World; streamer:ChunkStreamer; anchor:GameObject; spawns:string[] } {
	const world = new World();
	world.tileSize = 1;
	world.chunkSize = 4;
	const spawns:string[] = [];
	class Streamer extends ChunkStreamer {
		public override spawn(chunk:Chunk):void {
			spawns.push(chunk.id);
			const crate = new GameObject(`crate_${chunk.id}`);
			crate.addComponent(ChunkBound).chunkID = chunk.id;
			const c = chunk.worldCellCenter(1, 1);
			crate.transform.position.x = c.x;
			crate.transform.position.z = c.z;
			world.add(crate);
		}
	}
	const host = new GameObject('Streamer');
	const streamer = host.addComponent(Streamer);
	streamer.chunks = [0, 1, 2, 3].map((cx) => new Chunk(`c${cx}`, { cx, cz: 0 }, 4, 1, Array.from({ length: 16 }, (element, i) => cx * 100 + i)));
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
	return [...world.chunks.values()].map((c) => c.id).sort();
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

describe('World chunks', () => {
	it('finds loaded chunks and tiles by world point', () => {
		const world = new World();
		world.tileSize = 1;
		world.chunkSize = 4;
		const chunk = new Chunk('c', { cx: -1, cz: 0 }, 4, 1, Array.from({ length: 16 }, (element, i) => i));
		world.addChunk(chunk);
		assert.deepEqual(world.chunkCoordAt(-0.5, 3.5), { cx: -1, cz: 0 });
		assert.equal(world.chunkAtWorld(-0.5, 3.5), chunk);
		assert.equal(world.tileAtWorld(-0.5, 3.5), 15);
		assert.equal(world.chunkAtWorld(0.5, 3.5), undefined);
		world.addChunk(new Chunk('d', { cx: 1, cz: 2 }, 4, 1, []));
		assert.deepEqual(world.chunkBounds(), { minX: -4, minZ: 0, maxX: 8, maxZ: 12 });
		assert.deepEqual(world.tileCoordAt(-0.5, 3.5), { tx: -1, tz: 3 });
		assert.deepEqual(world.tileCenter(-1, 3), { x: -0.5, z: 3.5 });
		world.removeChunk(chunk);
		assert.equal(world.chunks.size, 1);
		assert.equal(new World().chunkBounds(), undefined);
	});

	it('rejects a chunk whose size does not match the world', () => {
		const world = new World();
		world.chunkSize = 4;
		assert.throws(() => world.addChunk(new Chunk('c', { cx: 0, cz: 0 }, 8, 1, [])));
	});
});

describe('ChunkStreamer', () => {
	it('loads near anchors, parks far chunk objects, and brings the same ones back', () => {
		const { world, streamer, anchor, spawns } = scene();
		streamer.stream();
		assert.deepEqual(loaded(world), ['c0', 'c1']);
		assert.deepEqual(world.chunkBounds(), { minX: 0, minZ: 0, maxX: 8, maxZ: 4 });
		assert.deepEqual(streamer.bounds(), { minX: 0, minZ: 0, maxX: 16, maxZ: 4 }, 'the whole scene, loaded or not');
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

	it('changes nothing without anchors, and loadAll brings everything in', () => {
		const { world, streamer, anchor } = scene();
		anchor.getComponent(StreamingAnchor)!.enabled = false;
		streamer.stream();
		assert.equal(world.chunks.size, 0);
		streamer.loadAll();
		assert.deepEqual(loaded(world), ['c0', 'c1', 'c2', 'c3']);
		assert.ok(world.findByID('crate_c3'));
	});
});
