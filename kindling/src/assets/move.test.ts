import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { move } from './move.js';

const timing = { sink: 0.15, snap: 0.05, hold: 0.1, carry: 0.12, follow: 0.05, settle: 0.2 };

describe('move', () => {
	it('anticipates, strikes on the blow, holds, follows and settles out', () => {
		assert.equal(move(timing, 1, 0).phase, 'anticipate');
		assert.ok(Math.abs(move(timing, 1, 0).weight) < 1e-9, 'starts out of the move');
		assert.equal(move(timing, 1, 0.5).phase, 'anticipate');
		assert.ok(move(timing, 1, 0.94).u < 0, 'sinks past ready before the strike');
		assert.equal(move(timing, 1, 0.97).phase, 'strike');
		assert.deepEqual(move(timing, 1, 1.05), { phase: 'impact', u: 1, weight: 1 });
		const follow = move(timing, 1, 1.12);
		assert.equal(follow.phase, 'follow');
		assert.ok(follow.u > 1, 'carries past the strike');
		assert.equal(move(timing, 1, 1.3).phase, 'settle');
		assert.equal(move(timing, 1, 1.4).weight, 0);
		assert.equal(move(timing, 1, 1.4).phase, 'done');
	});

	it('snaps in at most half a short wind-up', () => {
		assert.equal(move(timing, 0.06, 0.02).phase, 'anticipate');
		assert.equal(move(timing, 0.06, 0.04).phase, 'strike');
	});
});
