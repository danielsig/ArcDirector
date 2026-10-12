import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { bevelBox, blob, lathe, mergeParts, ribbon, tube } from './meshKit.js';

describe('mesh kit', () => {
	it('revolves a profile around Y', () => {
		const geo = lathe([{ r: 0.2, y: 0 }, { r: 0.4, y: 1 }], 8);
		assert.ok(geo.getAttribute('position').count > 8);
		geo.dispose();
	});

	it('builds a beveled box taller than a single quad', () => {
		const geo = bevelBox(1, 0.4, 0.6, 0.05);
		assert.ok(geo.getAttribute('position').count > 8);
		geo.computeBoundingBox();
		const box = geo.boundingBox!;
		assert.ok(box.max.y - box.min.y > 0.3);
		assert.ok(box.max.x - box.min.x > 0.8);
		geo.dispose();
	});

	it('runs a tube along the path', () => {
		const geo = tube([{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }], 0.05, 4);
		geo.computeBoundingBox();
		const box = geo.boundingBox!;
		assert.ok(box.max.y - box.min.y > 0.8);
		geo.dispose();
	});

	it('scales a blob on each axis', () => {
		const geo = blob(2, 0.5, 1, 6, 4);
		geo.computeBoundingBox();
		const box = geo.boundingBox!;
		assert.ok(box.max.x - box.min.x > 3);
		assert.ok(box.max.y - box.min.y < 1.2);
		geo.dispose();
	});

	it('stitches a ribbon between points', () => {
		const geo = ribbon([{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }], 0.2);
		assert.equal(geo.getIndex()?.count, 12);
		geo.dispose();
	});
	it('merges posed parts into one geometry', () => {
		const box = new THREE.BoxGeometry(1, 1, 1);
		const geo = mergeParts([{ geo: box }, { geo: box, x: 3 }]);
		geo.computeBoundingBox();
		assert.equal(geo.getAttribute('uv'), undefined);
		assert.ok(geo.boundingBox!.max.x > 3);
		geo.dispose();
		box.dispose();
	});
});
