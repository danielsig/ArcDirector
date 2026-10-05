import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { Component } from './Component.js';
import { Game } from './Game.js';
import { GameObject, resetAllocID } from './GameObject.js';
import { resetTime, Time } from './Time.js';

class Probe extends Component {
	static log:string[] = [];

	override awake():void {
		Probe.log.push('awake');
	}

	override onEnable():void {
		Probe.log.push('onEnable');
	}

	override onDisable():void {
		Probe.log.push('onDisable');
	}

	override start():void {
		Probe.log.push('start');
	}

	override fixedUpdate(dt:number):void {
		Probe.log.push('fixed');
	}

	override update(dt:number):void {
		Probe.log.push('update');
	}

	override onDestroy():void {
		Probe.log.push('onDestroy');
	}
}

class Batch extends Component {
	static log:string[] = [];

	static update(dt:number, list:Batch[]):void {
		Batch.log.push(`static:${list.length}`);
	}

	override update(dt:number):void {
		Batch.log.push('instance');
	}
}

describe('component loop', () => {
	beforeEach(() => {
		resetTime();
		resetAllocID();
		Probe.log = [];
		Batch.log = [];
	});

	it('runs awake, onEnable, start, then update', () => {
		const game = new Game();
		const go = new GameObject('probe');
		go.addComponent(new Probe());
		game.world.add(go);
		assert.deepEqual(Probe.log, ['awake', 'onEnable']);
		game.tick(0.01);
		assert.deepEqual(Probe.log, ['awake', 'onEnable', 'start', 'update']);
	});

	it('runs fixedUpdate before start on a full fixed step', () => {
		const game = new Game();
		const go = new GameObject('probe');
		go.addComponent(new Probe());
		game.world.add(go);
		game.tick(Time.fixedDeltaTime);
		assert.deepEqual(Probe.log, ['awake', 'onEnable', 'fixed', 'start', 'update']);
	});

	it('calls static update once, then instance update', () => {
		const game = new Game();
		const a = new GameObject('a');
		const b = new GameObject('b');
		a.addComponent(new Batch());
		b.addComponent(new Batch());
		game.world.add(a);
		game.world.add(b);
		game.tick(0.01);
		assert.deepEqual(Batch.log, ['static:2', 'instance', 'instance']);
	});

	it('skips update when enabled is false and fires onDisable / onEnable', () => {
		const game = new Game();
		const go = new GameObject('probe');
		const probe = go.addComponent(new Probe());
		game.world.add(go);
		probe.enabled = false;
		game.tick(0.01);
		assert.ok(!Probe.log.includes('start'));
		assert.ok(!Probe.log.includes('update'));
		assert.ok(Probe.log.includes('onDisable'));
		probe.enabled = true;
		game.tick(0.01);
		assert.ok(Probe.log.includes('onEnable'));
		assert.ok(Probe.log.includes('start'));
		assert.ok(Probe.log.includes('update'));
	});

	it('destroys at end of frame and removes from World', () => {
		const game = new Game();
		const parent = new GameObject('parent');
		const child = new GameObject('child');
		parent.addComponent(new Probe());
		child.setParent(parent);
		game.world.add(parent);
		assert.equal(game.world.objects.length, 2);
		game.destroy(parent);
		assert.ok(game.world.findByID('parent'));
		game.tick(0.01);
		assert.equal(game.world.findByID('parent'), undefined);
		assert.equal(game.world.findByID('child'), undefined);
		assert.equal(game.world.objects.length, 0);
		assert.ok(Probe.log.includes('onDestroy'));
	});

	it('remove unregisters immediately without destroying children', () => {
		const game = new Game();
		const parent = new GameObject('parent');
		const child = new GameObject('child');
		parent.addComponent(new Probe());
		child.setParent(parent);
		game.world.add(parent);
		game.world.remove(parent);
		assert.equal(game.world.findByID('parent'), undefined);
		assert.ok(game.world.findByID('child'));
		assert.equal(child.parent, parent);
		game.tick(0.01);
		assert.ok(!Probe.log.includes('onDestroy'));
		assert.ok(game.world.findByID('child'));
	});

	it('runs lateUpdate after update', () => {
		class Late extends Component {
			log:string[] = [];
			override update(dt:number):void {
				this.log.push('update');
			}
			override lateUpdate(dt:number):void {
				this.log.push('late');
			}
		}
		const game = new Game();
		const go = new GameObject('late');
		const late = go.addComponent(new Late());
		game.world.add(go);
		game.tick(0.01);
		assert.deepEqual(late.log, ['update', 'late']);
	});

	it('sorts update groups by static order', () => {
		const log:string[] = [];
		class High extends Component {
			static override order = 20;
			override update(dt:number):void {
				log.push('high');
			}
		}
		class Low extends Component {
			static override order = 5;
			override update(dt:number):void {
				log.push('low');
			}
		}
		const game = new Game();
		const a = new GameObject('a');
		a.addComponent(new High());
		const b = new GameObject('b');
		b.addComponent(new Low());
		game.world.add(a);
		game.world.add(b);
		game.tick(0.01);
		assert.deepEqual(log, ['low', 'high']);
	});
});
