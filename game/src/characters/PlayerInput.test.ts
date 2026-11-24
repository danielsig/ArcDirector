import { GameObject, resetTime, TOUCH_TAP, yawToward } from '@arc-director/kindling';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { examineWorld } from '../director/perception';
import { HumanBody, Named, Vitals } from '../engine/components';
import { DemoWorld } from '../engine/demo-world';
import { Container } from '../items/item-components';
import { getDef } from '../items/defs';
import { equipItem } from '../items/equip';
import { instantiateDef } from '../items/instance';
import { slotItem, tryInsert } from '../items/inventory';
import { BridgeLever } from '../kit/bridge/bridge';
import { spawnWorldItem } from '../world/spawn-item';
import { PlayerInput } from './PlayerInput';

function person(world:DemoWorld, id:string, x:number):GameObject {
	const go = new GameObject(id, 'Person');
	go.transform.localPosition = { x, y: 0, z: 0 };
	go.addComponent(Named, { id });
	go.addComponent(Vitals);
	go.addComponent(HumanBody, { pockets: go.addComponent(Container, { size: 8 }) });
	world.add(go);
	return go;
}

function scene():{ world:DemoWorld; go:GameObject; player:PlayerInput } {
	resetTime();
	const world = new DemoWorld();
	const go = person(world, 'Player', 0);
	return { world, go, player: go.addComponent(PlayerInput) };
}

function frame(world:DemoWorld, player:PlayerInput, code = ''):void {
	if (code) {
		world.input.press(code);
	}
	player.update(0);
	world.input.endFrame();
}

const sword = () => instantiateDef(getDef('iron_sword'));

/** What the player's keys ask its character to do, kept in place of a director doing it. */
function enacted(world:DemoWorld):string[] {
	const arcs:string[] = [];
	world.enact = (arc) => {
		arcs.push(arc);
		return Promise.resolve({ status: 'ok' });
	};
	return arcs;
}

test('a tap with nothing to interact with is a click', () => {
	const { world, player } = scene();
	frame(world, player, TOUCH_TAP);
	assert.equal(world.hudMessage, 'empty hands');
});

test('a tap interacts first: it picks up what lies near, sword in hand or not', () => {
	const { world, go, player } = scene();
	const arcs = enacted(world);
	equipItem(go, sword(), world);
	spawnWorldItem(world, instantiateDef(getDef('health_potion')), 0.5, 0, 0);
	frame(world, player, TOUCH_TAP);
	assert.match(arcs[0] ?? '', /^pick_up\(item=\w+\)$/);
});

test('with a sword in hand, a tap swings at the person it lands on', () => {
	const { world, go, player } = scene();
	equipItem(go, sword(), world);
	person(world, 'Fern', 1);
	frame(world, player, TOUCH_TAP);
	assert.equal(world.hudMessage, '');
	// A swing turns to face who it is at.
	assert.ok(Math.abs(go.transform.yaw - yawToward(1, 0)) < 1e-9);
});

test('KeyE never works a person, sword in hand or not', () => {
	const { world, go, player } = scene();
	equipItem(go, sword(), world);
	person(world, 'Fern', 1);
	frame(world, player, 'KeyE');
	assert.equal(world.hudMessage, '');
});

test('toggleItem takes an item in hand, selected, and puts it back', () => {
	const { world, go, player } = scene();
	const body = go.getComponent(HumanBody)!;
	const blade = sword();
	tryInsert(go, instantiateDef(getDef('health_potion')));
	tryInsert(go, blade);
	player.toggleItem(1);
	assert.equal(slotItem(body, 'hands.right.held'), blade);
	assert.equal(player.activeItem(), blade);
	player.toggleItem(0);
	assert.equal(slotItem(body, 'hands.right.held'), null);
	assert.ok(body.pockets?.contents.includes(blade));
});

test('toggleItem only selects what cannot be held', () => {
	const { world, go, player } = scene();
	const potion = instantiateDef(getDef('health_potion'));
	tryInsert(go, sword());
	tryInsert(go, potion);
	player.toggleItem(1);
	assert.equal(player.activeItem(), potion);
	assert.equal(slotItem(go.getComponent(HumanBody)!, 'hands.right.held'), null);
	assert.equal(world.hudMessage, '');
});

test('a stick short of its rim walks slower, and past it no faster', () => {
	const { world, player } = scene();
	world.input.stickY = 0.5;
	frame(world, player);
	assert.ok(Math.abs(Math.hypot(player.moveX, player.moveZ) - 0.5) < 1e-9);
	world.input.stickX = 1;
	world.input.stickY = 1;
	frame(world, player);
	assert.ok(Math.abs(Math.hypot(player.moveX, player.moveZ) - 1) < 1e-9);
});

test('Shift rushes only a bodiless player', () => {
	const { world, player } = scene();
	world.input.keys.add('KeyW');
	world.input.keys.add('ShiftLeft');
	frame(world, player);
	assert.ok(Math.abs(Math.hypot(player.moveX, player.moveZ) - 1) < 1e-9);
	player.embodied = false;
	frame(world, player);
	assert.ok(Math.abs(Math.hypot(player.moveX, player.moveZ) - 3) < 1e-9);
});

test('the bridge lever is aimed at: KeyE looks it over, and a click with BridgeCrank in hand uses it on the lever', () => {
	const { world, go, player } = scene();
	const lever = new GameObject('BridgeLever', 'BridgeLever');
	lever.transform.localPosition = { x: 1, y: 0, z: 0 };
	lever.addComponent(Named, { id: 'BridgeLever' });
	lever.addComponent(BridgeLever, { bridge: 'Bridge' });
	world.add(lever);
	const arcs = enacted(world);
	frame(world, player, 'KeyE');
	assert.equal(world.hudMessage, examineWorld(lever));
	equipItem(go, instantiateDef(getDef('bridge_crank')), world);
	frame(world, player, 'KeyF');
	assert.deepEqual(arcs, ['use(item=BridgeCrank, target=BridgeLever)']);
});
