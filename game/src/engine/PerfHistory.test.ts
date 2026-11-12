import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PerfHistory } from './PerfHistory';

describe('PerfHistory', () => {
	it('counts frames per whole second, oldest first, keeping only the last seconds', () => {
		const perf = new PerfHistory(3);
		const counts = [1, 2, 3, 4];
		counts.forEach((n, second) => {
			for (let i = 0; i < n; i++) {
				perf.frame(second * 1000 + i);
			}
		});
		perf.frame(4000);
		assert.deepEqual(perf.stats().fps, [2, 3, 4]);
	});

	it('writes a zero for each second with no frame', () => {
		const perf = new PerfHistory(5);
		perf.frame(0);
		perf.frame(3500);
		assert.deepEqual(perf.stats().fps, [1, 0, 0]);
	});

	it('averages each phase over the last whole second', () => {
		const perf = new PerfHistory();
		perf.frame(0);
		perf.add('render', 2);
		perf.add('render', 4);
		perf.add('director', 1);
		perf.frame(1000);
		assert.deepEqual(perf.stats().phaseMS, { director: 1, simulate: 0, render: 3 });
	});
});
