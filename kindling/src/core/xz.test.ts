import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GameObject } from './GameObject.js';
import { distanceXZ } from './xz.js';

describe('distanceXZ', () => {
	it('measures between points, GameObjects or one of each, ignoring height', () => {
		const a = new GameObject('a');
		const b = new GameObject('b');
		b.transform.position.x = 3;
		b.transform.position.y = 10;
		b.transform.position.z = 4;
		assert.equal(distanceXZ({ x: 0, z: 0 }, { x: 3, z: 4 }), 5);
		assert.equal(distanceXZ(a, b), 5);
		assert.equal(distanceXZ(a, { x: 3, z: 4 }), 5);
		assert.equal(distanceXZ(b.transform.position, a), 5);
	});
});
