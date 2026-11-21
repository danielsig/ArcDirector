import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Component } from './Component.js';
import { GameObject, allocID, allocSerial, resetAllocID } from './GameObject.js';
import { Chunk } from './Chunk.js';
import { ChunkBound } from './ChunkStreamer.js';
import { Terrain } from './Terrain.js';
import { World } from './World.js';
import { captureWorld, restoreWorld, saveWorld } from './save.js';

class Door extends Component {
	public static override saved = ['open'];
	public open = false;
	public leaf = 'oak';
}

class Bag extends Component {
	public static override saved = ['contents'];
	public contents:string[] = [];
}

/** The same scene every time: a door, a crate with two bags, and a coin. */
function scene():World {
	resetAllocID();
	const world = new World();
	const door = new GameObject('Door');
	door.addComponent(Door);
	world.add(door);
	const crate = new GameObject('Crate');
	crate.addComponent(Bag).contents = ['Rope'];
	crate.addComponent(Bag);
	world.add(crate);
	world.add(new GameObject(allocID('coin')));
	return world;
}

function spawnDrop(world:World, recipe:unknown):GameObject {
	const go = new GameObject((recipe as { id:string }).id);
	go.recipe = recipe;
	world.add(go);
	return go;
}

describe('save', () => {
	it('keeps only what changed, and rebuilds a fresh scene from it', () => {
		const world = scene();
		const fresh = captureWorld(world);
		world.findByID('Door')!.getComponent(Door)!.open = true;
		world.findByID('Door')!.getComponent(Door)!.leaf = 'pine';
		world.findByID('Crate')!.transform.position.x = 3;
		world.findByID('Crate')!.components()[2]!.loadState({ contents: ['Lamp'] });
		world.remove(world.findByID('coin_1')!);
		spawnDrop(world, { id: allocID('drop') });
		const save = saveWorld(world, fresh);

		assert.deepEqual(save.changed.Door, { components: { Door: { open: true } } });
		assert.deepEqual(save.changed.Crate?.components['Bag#1'], { contents: ['Lamp'] });
		assert.equal(save.changed.Crate?.components.Bag, undefined);
		assert.deepEqual(save.removed, ['coin_1']);
		assert.deepEqual(save.changed.drop_2?.recipe, { id: 'drop_2' });

		const again = scene();
		restoreWorld(again, JSON.parse(JSON.stringify(save)), (recipe) => spawnDrop(again, recipe));
		assert.equal(again.findByID('Door')!.getComponent(Door)!.open, true);
		assert.equal(again.findByID('Door')!.getComponent(Door)!.leaf, 'oak');
		assert.equal(again.findByID('Crate')!.transform.position.x, 3);
		assert.deepEqual(again.findByID('Crate')!.getComponent(Bag)!.contents, ['Rope']);
		assert.equal(again.findByID('coin_1'), undefined);
		assert.ok(again.findByID('drop_2'));
		assert.equal(allocSerial(), 3);
	});

	/** Two 2×2 chunks side by side; each spawns a door of its own the first time it loads. */
	function chunked():World {
		resetAllocID();
		class Ground extends Terrain {
			protected override spawn(chunk:Chunk):void {
				const door = new GameObject(`door_${chunk.id}`);
				door.addComponent(Door);
				door.addComponent(ChunkBound).chunkID = chunk.id;
				this.world.add(door);
			}
		}
		class ChunkWorld extends World {
			public override readonly terrain:Ground = new Ground(this);
		}
		const world = new ChunkWorld();
		world.terrain.tileSize = 1;
		world.terrain.chunkSize = 2;
		world.terrain.register(new Chunk('a', { cx: 0, cz: 0 }, 2, 1, [0, 0, 0, 0]));
		world.terrain.register(new Chunk('b', { cx: 1, cz: 0 }, 2, 1, [0, 0, 0, 0]));
		return world;
	}

	it('saves each chunk against its own first load: parked ones too, never-loaded ones not at all', () => {
		const world = chunked();
		const fresh = captureWorld(world);
		const [a, b] = world.terrain.chunks;
		world.terrain.load(a!);
		world.findByID('door_a')!.getComponent(Door)!.open = true;
		const drop = new GameObject(allocID('drop'));
		drop.recipe = { id: drop.id };
		drop.addComponent(ChunkBound).chunkID = 'a';
		world.add(drop);
		world.terrain.unload(a!);
		assert.equal(world.findByID('door_a'), undefined, 'parked');
		const save = saveWorld(world, fresh);
		assert.deepEqual(save.chunks.a?.changed.door_a, { components: { Door: { open: true } } });
		assert.deepEqual(save.chunks.a?.changed.drop_1?.recipe, { id: 'drop_1' });
		assert.equal(save.chunks.b, undefined);

		const again = chunked();
		const stored = JSON.parse(JSON.stringify(save)) as typeof save;
		restoreWorld(again, stored, (recipe) => spawnDrop(again, recipe));
		assert.equal(again.findByID('door_a'), undefined, 'a chunk slice waits for its chunk to load');
		assert.deepEqual(saveWorld(again, {}).chunks, stored.chunks, 'a save before it loads keeps the slice');
		again.terrain.load(again.terrain.chunks[0]!);
		assert.equal(again.findByID('door_a')!.getComponent(Door)!.open, true);
		assert.ok(again.findByID('drop_1'));
		assert.deepEqual(saveWorld(again, {}).chunks.a?.changed.door_a, { components: { Door: { open: true } } }, 'its fresh state was taken first');
	});
});
