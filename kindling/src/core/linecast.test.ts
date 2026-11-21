import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BoxCollider } from './BoxCollider.js';
import { Chunk } from './Chunk.js';
import { GameObject } from './GameObject.js';
import type { TileSpec } from './Terrain.js';
import { World } from './World.js';

const floor:TileSpec<string> = { surface: 'floor', height: 0, deck: 0, blocked: false };
const river:TileSpec<string> = { surface: 'water', height: 0, deck: -0.1, blocked: true, wade: true };
const wall:TileSpec<string> = { surface: 'rock', height: 0, blocked: true };

/** One row of 1 m tiles along +X, from x = 0, in a chunk 8 tiles a side (the rest floor). */
function row(tiles:TileSpec<string>[]):World {
	const world = new World();
	world.terrain.tileSize = 1;
	world.terrain.chunkSize = 8;
	world.terrain.register(new Chunk('a', { cx: 0, cz: 0 }, 8, 1, Array.from({ length: 64 }, (element, i) => (i < 8 ? tiles[i] ?? floor : floor))));
	return world;
}

function post(world:World, x:number, size:{ x:number; y:number; z:number }, shape?:'cylinder'):GameObject {
	const go = new GameObject(`post${x}`);
	go.transform.position.x = x;
	go.transform.position.z = 0.5;
	go.addComponent(BoxCollider, { size, shape });
	world.add(go);
	world.reindex();
	return go;
}

const eye = (x:number, y = 1.5) => ({ x, y, z: 0.5 });

describe('linecast', () => {
	it('passes over a river at eye height, and stops at the face of a block it does not see over', () => {
		const world = row([floor, river, floor, wall, floor]);
		assert.equal(world.linecast(eye(0.5), eye(2.5)), undefined);
		const hit = world.linecast(eye(0.5), eye(4.5))!;
		assert.equal(hit.hit, 'terrain');
		assert.equal(hit.t, 0.625, 'at x = 3');
		assert.equal(world.linecast(eye(0.5, 2.5), eye(4.5, 2.5)), undefined, 'over its top, 2 m by default');
		world.terrain.blockHeight = 3;
		assert.ok(world.linecast(eye(0.5, 2.5), eye(4.5, 2.5)));
		assert.equal(world.linecast(eye(3.5), eye(5.5)), undefined, 'not from inside it');
	});

	it('hits a box from its foot up to its top, and an upright cylinder', () => {
		const world = row([]);
		const box = post(world, 2.5, { x: 0.4, y: 2, z: 0.4 });
		assert.equal(world.linecast(eye(0.5), eye(4.5))?.hit, box);
		assert.equal(world.linecast(eye(0.5, 2.1), eye(4.5, 2.1)), undefined, 'above it');
		const log = post(world, 1.5, { x: 0.4, y: 1, z: 0.4 }, 'cylinder');
		assert.equal(world.linecast(eye(0.5, 0.5), eye(4.5, 0.5))?.hit, log);
		assert.ok(Math.abs(world.linecast(eye(0.5, 0.5), eye(4.5, 0.5))!.point.x - 1.3) < 1e-9, 'at its round side');
		assert.equal(world.linecast(eye(0.5, 0.5), eye(4.5, 0.5), { filter: (go) => go !== log })?.hit, box);
		assert.equal(world.linecast(eye(2.5), eye(6.5)), undefined, 'a line from inside a body passes out of it');
		assert.equal(world.linecast(eye(6.5), eye(2.5)), undefined, 'and into one whose inside it ends in');
	});

	it('hits the ground where the line dips under a raised floor', () => {
		const world = row([floor, floor, { ...floor, height: 1 }, floor]);
		world.terrain.tileHeight = 0.7;
		const hit = world.linecast(eye(0.5, 0.5), eye(3.5, 0.5))!;
		assert.deepEqual([hit.hit, hit.point.x], ['terrain', 2]);
		assert.equal(world.linecast(eye(0.5), eye(3.5)), undefined);
	});
});
