import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { separate, type Box } from './separate.ts';

const ROOM = { left: 0, top: 0, right: 1000, bottom: 800 };

function overlap(a:Box, b:Box):boolean {
	return Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y);
}

describe('separate', () => {
	it('pushes two overlapping boxes apart, each by half', () => {
		const a = { x: 100, y: 100, w: 100, h: 100 };
		const b = { x: 180, y: 100, w: 100, h: 100 };
		separate([a, b], [], ROOM, 0);
		assert.equal(overlap(a, b), false);
		assert.equal(a.x, 90);
		assert.equal(b.x, 190);
		assert.equal(a.y, 100);
	});

	it('moves only the box against a wall, the shorter way out', () => {
		const a = { x: 100, y: 100, w: 100, h: 100 };
		const wall = { x: 100, y: 190, w: 100, h: 40 };
		separate([a], [wall], ROOM, 0);
		assert.equal(overlap(a, wall), false);
		assert.deepEqual([a.x, a.y], [100, 90]);
		assert.deepEqual([wall.x, wall.y], [100, 190]);
	});

	it('settles a crowd on one spot with no overlaps, on screen', () => {
		const boxes = [0, 1, 2, 3].map((i) => ({ x: 400 + i, y: 300 + i, w: 200, h: 100 }));
		for (let frame = 0; frame < 5; frame += 1) {
			separate(boxes, [], ROOM);
		}
		boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => assert.equal(overlap(a, b), false)));
		for (const box of boxes) {
			assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= 1000 && box.y + box.h <= 800);
		}
	});

	it('leaves the whole push to the other box when one is against the edge of the screen', () => {
		const pinned = { x: 100, y: 0, w: 300, h: 190 };
		const below = { x: 200, y: 100, w: 300, h: 190 };
		separate([pinned, below], [], ROOM, 0);
		assert.equal(overlap(pinned, below), false);
		assert.deepEqual([pinned.y, below.y], [0, 190]);
	});

	it('clears three tall boxes crowded under the top of the screen', () => {
		const boxes = [{ x: 860, y: 0, w: 330, h: 190 }, { x: 900, y: 60, w: 330, h: 190 }, { x: 800, y: 110, w: 330, h: 190 }];
		const room = { left: 0, top: 0, right: 1600, bottom: 900 };
		for (let frame = 0; frame < 3; frame += 1) {
			separate(boxes, [], room);
		}
		boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => assert.equal(overlap(a, b), false)));
	});

	it('keeps a box on screen', () => {
		const a = { x: -50, y: 790, w: 100, h: 100 };
		separate([a], [], ROOM);
		assert.deepEqual([a.x, a.y], [0, 700]);
	});

	it('leaves boxes that are clear alone', () => {
		const a = { x: 0, y: 0, w: 100, h: 100 };
		const b = { x: 300, y: 300, w: 100, h: 100 };
		separate([a, b], [], ROOM);
		assert.deepEqual([a.x, a.y, b.x, b.y], [0, 0, 300, 300]);
	});
});
