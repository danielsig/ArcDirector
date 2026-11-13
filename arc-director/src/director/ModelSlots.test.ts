import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { ModelSlots, URGENT } from './ModelSlots.js';

/** Work that runs until its gate opens, noting when it started. */
function gated(started:string[], name:string):{ work:()=>Promise<string>; open:()=>void } {
	let open = ():void => undefined;
	const gate = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { work: async () => {
		started.push(name);
		await gate;
		return name;
	}, open: () => open() };
}

describe('ModelSlots', () => {
	it('runs the highest priority first, first come first within one, as slots free', async () => {
		const slots = new ModelSlots(1, 0);
		const started:string[] = [];
		const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((name) => gated(started, name));
		const done = [slots.run(0.2, a.work), slots.run(0.2, b.work), slots.run(0.9, c.work), slots.run(0.9, d.work)];
		await sleep(1);
		assert.deepEqual(started, ['c']);
		for (const gate of [c, d, a, b]) {
			gate.open();
			await sleep(1);
		}
		assert.deepEqual(started, ['c', 'd', 'a', 'b']);
		assert.deepEqual(await Promise.all(done), ['a', 'b', 'c', 'd']);
	});

	it('drops a lease whose signal aborts while it waits', async () => {
		const slots = new ModelSlots(1, 0);
		const started:string[] = [];
		const a = gated(started, 'a');
		const stop = new AbortController();
		const running = slots.run(0.5, a.work);
		const waiting = slots.run(0.5, gated(started, 'b').work, stop.signal);
		stop.abort(new Error('stopped'));
		await assert.rejects(waiting, /stopped/);
		a.open();
		await running;
		assert.deepEqual(started, ['a']);
	});

	it('holds new leases for a wave while one still runs, but never an urgent one', async () => {
		const slots = new ModelSlots(3, 0.05);
		const started:string[] = [];
		const [a, b, c, u] = ['a', 'b', 'c', 'u'].map((name) => gated(started, name));
		void slots.run(0.5, a.work);
		void slots.run(0.5, b.work);
		await sleep(1);
		b.open();
		await sleep(1);
		void slots.run(0.5, c.work);
		void slots.run(URGENT, u.work);
		await sleep(10);
		assert.deepEqual(started, ['a', 'b', 'u'], 'c waits while a still generates');
		await sleep(60);
		assert.deepEqual(started, ['a', 'b', 'u', 'c'], 'past batchWait it starts anyway');
		for (const gate of [a, c, u]) {
			gate.open();
		}
	});
});
