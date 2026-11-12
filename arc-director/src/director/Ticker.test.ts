import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { ArcDirector } from './ArcDirector.js';
import { Ticker } from './Ticker.js';

describe('Ticker', () => {
	let wall = 0;
	/** Lets `ms` of wall time pass, and the timers that come due in it fire. */
	const pass = (ms:number):void => {
		for (let t = 0; t < ms; t += 10) {
			wall += 10;
			mock.timers.tick(10);
		}
	};
	beforeEach(() => {
		wall = 1000;
		mock.method(performance, 'now', () => wall);
		mock.timers.enable({ apis: ['setInterval'] });
	});
	afterEach(() => {
		mock.timers.reset();
		mock.restoreAll();
	});

	it('ticks a director at its interval, by wall time times timeScale', async () => {
		const director = await new ArcDirector().addFakeInference().connect();
		const at:string[] = [];
		using ticker = new Ticker({ tick: (dt) => {
			director.tick(dt);
			at.push(director.time.toFixed(2));
		} }, { interval: 0.1 });
		pass(300);
		ticker.timeScale = 0;
		pass(200);
		ticker.timeScale = 0.5;
		pass(200);
		assert.deepEqual(at, ['0.10', '0.20', '0.30', '0.30', '0.30', '0.35', '0.40'], 'paused at 0, then half speed');
		director.dispose();
	});

	it('stops on stop, and at the end of its using scope', () => {
		let ticks = 0;
		const director = { tick: () => ticks++ };
		const stopped = new Ticker(director);
		assert.equal(stopped.running, true, 'running once made');
		stopped.stop();
		let scoped:Ticker;
		{
			using ticker = new Ticker(director);
			scoped = ticker;
		}
		pass(1000);
		assert.deepEqual([stopped.running, scoped.running, ticks], [false, false, 0]);
	});
});
