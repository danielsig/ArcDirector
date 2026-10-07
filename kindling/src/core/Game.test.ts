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

	public override fixedUpdate(dt:number):void {
		this.fixed += 1;
	}

	public override update(dt:number):void {
		this.frames += 1;
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
