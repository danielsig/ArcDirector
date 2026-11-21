import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Chunk } from './Chunk.js';
import { canOccupy } from './physics.js';
import { Terrain, type TileSpec } from './Terrain.js';
import { World } from './World.js';

const meadow:TileSpec<string> = { surface: 'meadow', height: 0, deck: 0.01, blocked: false };
const river:TileSpec<string> = { surface: 'water', height: 0, deck: -0.1, blocked: true, wade: true };

/** A 2×2 chunk of `tiles` (row by row) at chunk coordinate `cx`, 0. */
const chunk = (id:string, cx:number, tiles:TileSpec<string>[]):Chunk => new Chunk(id, { cx, cz: 0 }, 2, 1, tiles);

function ground():Terrain<string> {
	const terrain = new Terrain<string>(new World());
	terrain.tileSize = 1;
	terrain.chunkSize = 2;
	terrain.tileHeight = 0.7;
	return terrain;
}

describe('Terrain', () => {
	it('finds chunks and tiles by world point, and their box', () => {
		const terrain = ground();
		const a = chunk('a', -1, [meadow, meadow, meadow, river]);
		terrain.register(a);
		terrain.register(chunk('b', 1, []));
		assert.deepEqual(terrain.chunkCoordAt(-0.5, 1.5), { cx: -1, cz: 0 });
		assert.equal(terrain.chunkAtWorld(-0.5, 1.5), a);
		assert.equal(terrain.tileAtWorld(-0.5, 1.5), river);
		assert.equal(terrain.chunkAtWorld(0.5, 1.5), undefined);
		assert.equal(terrain.tileNear(-0.5, 9), river, 'past the edge, the edge tile');
		assert.equal(terrain.tileNear(-0.5, 1.5), river);
		assert.deepEqual(terrain.bounds(), { minX: -2, minZ: 0, maxX: 4, maxZ: 2 });
		assert.deepEqual(terrain.tileCoordAt(-0.5, 1.5), { tx: -1, tz: 1 });
		assert.deepEqual(terrain.tileCenter({ tx: -1, tz: 1 }), { x: -0.5, z: 1.5 });
		assert.throws(() => terrain.register(new Chunk('c', { cx: 3, cz: 0 }, 4, 1, [])));
	});

	it('fetches a chunk it has not got once, and remembers a miss', () => {
		const asked:string[] = [];
		class Fetching extends Terrain<string> {
			protected override fetch(cx:number, cz:number):Chunk | undefined {
				asked.push(`${cx},${cz}`);
				return cx === 0 ? chunk('a', 0, [meadow, meadow, meadow, meadow]) : undefined;
			}
		}
		const terrain = new Fetching(new World());
		terrain.tileSize = 1;
		terrain.chunkSize = 2;
		assert.equal(terrain.tileAtWorld(0.5, 0.5), meadow);
		assert.equal(terrain.tileAtWorld(1.5, 0.5), meadow);
		assert.equal(terrain.tileAtWorld(5, 0.5), undefined);
		assert.equal(terrain.tileAtWorld(5, 0.5), undefined);
		assert.deepEqual(asked, ['0,0', '2,0']);
		assert.equal(terrain.loaded.size, 0, 'its objects are not loaded');
	});

	it('samples feet on the deck, on a cover where it answers, and wading in a river', () => {
		const terrain = ground();
		terrain.register(chunk('a', 0, [meadow, { ...meadow, height: 1 }, river, river]));
		assert.equal(terrain.sample(0.5, 0.5)?.worldY, 0.01);
		assert.ok(Math.abs(terrain.sample(1.5, 0.5)!.worldY - 0.71) < 1e-9);
		const water = terrain.sample(0.5, 1.5)!;
		assert.deepEqual([water.surface, water.worldY, water.blocked, water.wade], ['water', -0.1, true, true]);
		const deck = { bounds: { minX: 0, maxX: 1, minZ: 1, maxZ: 2 }, sample: () => 0.04 };
		terrain.addCover(deck);
		assert.deepEqual([terrain.sample(0.5, 1.5)!.worldY, terrain.sample(0.5, 1.5)!.blocked, terrain.sample(1.5, 1.5)!.blocked], [0.04, false, true]);
		terrain.removeCover(deck);
		assert.equal(terrain.sample(0.5, 1.5)!.blocked, true);
		assert.equal(terrain.sample(5, 5), undefined);
	});

	it('lets a body in a river wade on and out, and none walk in', () => {
		const terrain = ground();
		terrain.register(chunk('a', 0, [meadow, meadow, river, river]));
		const [bank, water] = [terrain.sample(0.5, 0.5), terrain.sample(0.5, 1.5)];
		assert.equal(canOccupy(bank, water), false);
		assert.equal(canOccupy(water, terrain.sample(1.5, 1.5)), true);
		assert.equal(canOccupy(water, bank), true);
	});

	it('moves the revisions a changed tile reaches, out to the larger of the old and the new tile\'s reach', () => {
		const terrain = ground();
		const four = [meadow, meadow, meadow, meadow];
		const [a, b, c] = [chunk('a', 0, [...four]), chunk('b', 1, [...four]), chunk('c', 2, [...four])];
		[a, b, c].forEach((ch) => terrain.register(ch));
		const before = [a, b, c].map((ch) => terrain.revision(ch));
		const moved = ():boolean[] => [a, b, c].map((ch, i) => terrain.revision(ch) !== before[i]);
		terrain.setTile({ tx: 0, tz: 0 }, { ...meadow, blocked: true, deck: undefined });
		assert.deepEqual(moved(), [true, true, false], 'two tiles reach the next chunk, not the one after');
		assert.equal(terrain.sample(0.5, 0.5)?.blocked, true);
		before.splice(0, 3, ...[a, b, c].map((ch) => terrain.revision(ch)));
		terrain.setTile({ tx: 0, tz: 0 }, { ...meadow, blocked: true, deck: undefined, reach: 4 });
		assert.deepEqual(moved(), [true, true, true], 'a tall tile reaches farther');
		before.splice(0, 3, ...[a, b, c].map((ch) => terrain.revision(ch)));
		terrain.setTile({ tx: 0, tz: 0 }, meadow);
		assert.deepEqual(moved(), [true, true, true], 'and so does taking it down');
		assert.ok(terrain.revision() > 0);
	});

	it('takes the solids a subclass names inside a tile', () => {
		class Walled extends Terrain<string> {
			protected override solidsOf():{ minX:number; maxX:number; minZ:number; maxZ:number }[] {
				return [{ minX: 0.4, maxX: 0.6, minZ: 0, maxZ: 1 }];
			}
		}
		const terrain = new Walled(new World());
		terrain.tileSize = 1;
		terrain.chunkSize = 2;
		terrain.register(chunk('a', 0, [meadow, meadow, meadow, meadow]));
		assert.deepEqual(terrain.sample(0.5, 0.5)?.solids, [{ minX: 0.4, maxX: 0.6, minZ: 0, maxZ: 1 }]);
	});

	it('climbs a stair toward the open floor, found across a chunk border, in four steps between its side strips', () => {
		const terrain = ground();
		const stair:TileSpec<string> = { surface: 'floor', height: 1, blocked: false, climb: {} };
		terrain.register(chunk('a', 0, [meadow, stair, meadow, meadow]));
		terrain.register(chunk('b', 1, [{ ...meadow, height: 1 }, meadow, meadow, meadow]));
		assert.equal(terrain.climbAt({ tx: 1, tz: 0 }), 'east');
		assert.deepEqual(terrain.flightsAt({ tx: 1, tz: 0 }), [{ foot: { x: 0, z: 0.5 }, head: { x: 1, z: 0.5 } }]);
		const y = (x:number) => terrain.sample(x, 0.5)!.worldY;
		assert.deepEqual([y(1.1), y(1.3), y(1.6), y(1.9)].map((h) => Math.round(h * 1000) / 1000), [0.175, 0.35, 0.525, 0.7]);
		assert.equal(terrain.sample(1.5, 0.5)!.climbable, true);
		assert.deepEqual(terrain.sample(1.5, 0.5)!.solids, [
			{ minX: 1.3, maxX: 1.7, minZ: 0, maxZ: 0.16 },
			{ minX: 1.3, maxX: 1.7, minZ: 0.84, maxZ: 1 },
		]);
		assert.deepEqual(terrain.climbEnds({ tx: 1, tz: 0 }), ['east', 'west']);
		assert.deepEqual(terrain.climbEnds({ tx: 0, tz: 0 }), ['north', 'east', 'south', 'west'], 'a tile that does not climb');
	});

	it('climbs a corner on its higher flight, with an L of strips and plain ground in the rest', () => {
		const terrain = ground();
		terrain.stairMouth = 0.1;
		const corner:TileSpec<string> = { surface: 'floor', height: 1, blocked: false, climb: { flights: [
			{ foot: { x: 0, z: 0.5 }, head: { x: 0.5, z: 0.5 }, to: 0.5 },
			{ foot: { x: 0.5, z: 0.5 }, head: { x: 0.5, z: 0 }, from: 0.5 },
		] } };
		terrain.register(chunk('a', 0, [corner, meadow, meadow, meadow]));
		assert.ok(Math.abs(terrain.sample(0.25, 0.25)!.worldY - 0.875 * 0.7) < 1e-9, 'the north-west quarter is on the second flight');
		assert.equal(terrain.sample(0.75, 0.75)!.worldY, 0, 'the south-east quarter is the foot');
		const solids = terrain.sample(0.5, 0.5)!.solids!.map((b) => [b.minX, b.maxX, b.minZ, b.maxZ].map((v) => Math.round(v * 100) / 100));
		assert.deepEqual(solids, [[0.1, 0.4, 0.84, 1], [0.84, 1, 0.1, 0.4]]);
		assert.equal(terrain.climbEnds({ tx: 0, tz: 0 }).length, 4);
	});

	it('steps over a low single step, and slopes smoothly with no steps', () => {
		const terrain = ground();
		const step:TileSpec<string> = { surface: 'floor', height: 1, blocked: false, climb: { rise: 0.175, flights: [{ foot: { x: 0.5, z: 0.5 }, head: { x: 1, z: 0.5 }, steps: 1 }] } };
		const slope:TileSpec<string> = { surface: 'floor', height: 1, blocked: false, climb: { steps: 0 } };
		terrain.register(chunk('a', 0, [step, { ...meadow, height: 1 }, slope, { ...meadow, height: 1 }]));
		assert.ok(Math.abs(terrain.sample(0.25, 0.5)!.worldY - 0.525) < 1e-9, 'west of the step, a quarter height down');
		assert.ok(Math.abs(terrain.sample(0.75, 0.5)!.worldY - 0.7) < 1e-9);
		assert.equal(terrain.sample(0.5, 0.5)!.solids, undefined);
		assert.equal(terrain.climbEnds({ tx: 0, tz: 0 }).length, 4);
		assert.ok(Math.abs(terrain.sample(0.25, 1.5)!.worldY - 0.175) < 1e-9, 'a quarter up the slope');
	});
});
