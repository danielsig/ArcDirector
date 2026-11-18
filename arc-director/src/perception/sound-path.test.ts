import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { HostWorld, Vec } from '../world/world-types.js';
import { Axes } from '../world/axes.js';
import { clarityAt } from './hearing.js';
import { DEFAULT_SOUND_WAYS, soundPath } from './sound-path.js';

/** A 1 m grid: `walls` are cells, which let `through` of a sound pass; nodes are open cell centers, 8 around each. */
function gridWorld(walls:string[], through = 0, rays = false):HostWorld<unknown> {
	const solid = new Set(walls);
	const open = (x:number, y:number):boolean => !solid.has(`${x},${y}`);
	/** How far along a-b the first wall cell is (a grid march), if any. */
	const march = (a:Vec, b:Vec):number | undefined => {
		const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
		for (let t = 0; t <= length; t += 0.02) {
			const x = a[0] + ((b[0] - a[0]) * t) / length;
			const y = a[1] + ((b[1] - a[1]) * t) / length;
			if (!open(Math.floor(x), Math.floor(y))) {
				return t;
			}
		}
		return undefined;
	};
	const around = (p:Vec):Vec[] => {
		const [cx, cy] = [Math.floor(p[0]), Math.floor(p[1])];
		return [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => [cx + dx, cy + dy]))
			.filter(([x, y]) => (x !== cx || y !== cy) && open(x, y))
			.map(([x, y]) => [x + 0.5, y + 0.5]);
	};
	return {
		find: () => undefined,
		geometry: {
			axes: Axes.Plane,
			getPose: () => undefined,
			...rays ? { castRay: (what, a, b) => { const hit = march(a, b); return hit === undefined ? undefined : { distance: hit }; } } : {},
			getClarity: (what, a, b, hit) => (hit || march(a, b) !== undefined ? through : 1),
		},
		routes: { getNeighbors: around, steerToward: () => true },
	};
}

const levelAt = (length:number):number => Math.min(1, clarityAt(length));
const cells = (x0:number, y0:number, x1:number, y1:number):string[] => {
	const out:string[] = [];
	for (let x = x0; x <= x1; x++) {
		for (let y = y0; y <= y1; y++) {
			out.push(`${x},${y}`);
		}
	}
	return out;
};

describe('soundPath', () => {
	it('hears a clear straight line as it is, with no search', () => {
		const path = soundPath(gridWorld([]), 'sound', [0.5, 0.5], [10.5, 0.5], levelAt);
		assert.ok(path);
		assert.equal(path.level, levelAt(10));
		assert.equal(path.from, undefined);
	});

	it('bends round a building corner, heard from the corner', () => {
		const path = soundPath(gridWorld(cells(0, 0, 20, 20)), 'sound', [-3.5, 6.5], [6.5, -3.5], levelAt);
		assert.ok(path && path.level > 0.3, `heard at ${path?.level}`);
		assert.equal(path.through, 1);
		assert.ok(path.from && Math.hypot(path.from[0], path.from[1]) < 1.5, `from ${path.from}`);
	});

	it('takes the way round a wall that passes a little, over the way through it', () => {
		const walls = [...cells(-30, 0, 30, 0), ...cells(0, 3, 0, 12)];
		const path = soundPath(gridWorld(walls, 0.1), 'sound', [-5.5, 7.5], [5.5, 7.5], levelAt);
		assert.ok(path && path.level > 0.2, `heard at ${path?.level}`);
		assert.equal(path.through, 1);
		assert.ok(path.from);
	});

	it('hears nothing from a shut room whose walls stop sound, and muffled through walls that pass some', () => {
		const room = [...cells(-6, -6, 6, -6), ...cells(-6, 6, 6, 6), ...cells(-6, -6, -6, 6), ...cells(6, -6, 6, 6)];
		assert.equal(soundPath(gridWorld(room), 'sound', [-15.5, 0.5], [0.5, 0.5], levelAt), undefined);
		const muffled = soundPath(gridWorld(room, 0.5), 'sound', [-15.5, 0.5], [0.5, 0.5], levelAt);
		assert.ok(muffled);
		assert.equal(muffled.through, 0.5);
		assert.equal(muffled.from, undefined);
	});

	it('takes no bend with reflections 0', () => {
		const ways = { ...DEFAULT_SOUND_WAYS, reflections: 0 };
		assert.equal(soundPath(gridWorld(cells(0, 0, 20, 20)), 'sound', [-3.5, 6.5], [6.5, -3.5], levelAt, ways), undefined);
	});

	it('seeds the search with rays where the world has castRay', () => {
		const path = soundPath(gridWorld(cells(0, 0, 20, 20), 0, true), 'sound', [-3.5, 6.5], [6.5, -3.5], levelAt);
		assert.ok(path && path.level > 0.3, `heard at ${path?.level}`);
	});
});
