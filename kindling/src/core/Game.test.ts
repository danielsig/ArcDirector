import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { Component } from './Component.js';
import { Game } from './Game.js';
import { GameObject, resetAllocID } from './GameObject.js';
import { World } from './World.js';
import { resetTime, Time, MAX_DT } from './Time.js';

class Stepper extends Component {
	public fixed = 0;
	public frames = 0;
	public lastDT = -1;

	public override fixedUpdate(dt:number):void {
		this.fixed += 1;
	}

	public override update(dt:number):void {
		this.frames += 1;
		this.lastDT = dt;
	}
}

describe('Game.tick', () => {
	beforeEach(() => {
		resetTime();
		resetAllocID();
	});

	it('clamps deltaTime and advances Time.time', () => {
		const game = new Game();
		game.tick(1);
		assert.equal(Time.deltaTime, MAX_DT);
		close(Time.time, MAX_DT);
	});

	it('runs two fixed steps when dt covers them', () => {
		const game = new Game();
		const go = new GameObject('step');
		const stepper = go.addComponent(Stepper);
		game.world.add(go);
		game.tick(Time.fixedDeltaTime * 2);
		assert.equal(stepper.fixed, 2);
		assert.equal(stepper.frames, 1);
	});

	it('stands still while paused', () => {
		const game = new Game();
		const go = new GameObject('step');
		const stepper = go.addComponent(Stepper);
		game.world.add(go);
		game.paused = true;
		game.tick(Time.fixedDeltaTime * 2);
		assert.equal(Time.time, 0);
		assert.equal(stepper.frames, 0);
	});

	it('restarts the clock at a saved time with no fixed steps owed', () => {
		resetTime(100);
		const game = new Game();
		const go = new GameObject('step');
		const stepper = go.addComponent(Stepper);
		game.world.add(go);
		game.tick(Time.fixedDeltaTime * 1.5);
		assert.equal(stepper.fixed, 1);
	});

	it('scales an object’s dt by its time, stopped through a hitstop', () => {
		const game = new Game();
		const go = new GameObject('step');
		const stepper = go.addComponent(Stepper);
		game.world.add(go);
		go.timeScale = 0.5;
		game.tick(0.02);
		close(stepper.lastDT, 0.01);
		go.hitstop(0.03);
		game.tick(0.02);
		assert.equal(stepper.lastDT, 0);
		game.tick(0.02);
		close(stepper.lastDT, 0.01);
	});

	it('uses an injected World', () => {
		const world = new World();
		const game = new Game(world);
		assert.equal(game.world, world);
		assert.equal(game.renderer, null);
		assert.equal(game.canvas, null);
	});
});

function close(a:number, b:number, eps = 1e-9):void {
	assert.ok(Math.abs(a - b) < eps, `${a} !~= ${b}`);
}
