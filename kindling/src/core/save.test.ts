import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Component } from './Component.js';
import { GameObject, allocID, allocSerial, resetAllocID } from './GameObject.js';
import { World } from './World.js';
import { captureWorld, diffWorld, restoreWorld } from './save.js';

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
		const save = diffWorld(fresh, captureWorld(world));

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
});
