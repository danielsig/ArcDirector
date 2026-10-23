import type { GameObject } from '@arc-director/kindling';
import { Door, Interior, Lock, Named } from '../engine/components';
import type { World } from '../engine/World';
import { CELL_SIZE } from './constants';

/**
 * A passage: open floor between the rooms of a place (a crypt), every cell of it joined to the next. Where it opens
 * on a room is an end; a door in it, or in its wall, is one of its doors.
 */
type Passage = {
	cells:Set<string>;
	/** Each room it opens on, and its cells beside that room. */
	ends:Map<string, string[]>;
	/** Doors in it or in its walls, and the cell of it beside each. */
	doors:Map<GameObject, string>;
};

const key = (tx:number, tz:number):string => `${tx},${tz}`;
const unkey = (k:string):[number, number] => k.split(',').map(Number) as [number, number];
const STEPS:[number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** The world's passages, by cell; rebuilt when its chunks change. */
const built = new WeakMap<World, { chunks:number; byCell:Map<string, Passage> }>();

function passages(world:World):Map<string, Passage> {
	const cached = built.get(world);
	if (cached?.chunks === world.chunks.size) {
		return cached.byCell;
	}
	const byCell = new Map<string, Passage>();
	built.set(world, { chunks: world.chunks.size, byCell });
	const rooms:GameObject[] = [];
	world.forEachComponent(Interior, (box, go) => {
		if (box.room) {
			rooms.push(go);
		}
	});
	const bounds = world.chunkBounds();
	if (rooms.length === 0 || !bounds) {
		return byCell;
	}
	const roomAt = (tx:number, tz:number):string | undefined => {
		const { x, z } = world.tileCenter(tx, tz);
		const room = rooms.find((go) => {
			const b = go.getComponent(Interior)!;
			return x >= b.minX && x < b.maxX && z >= b.minZ && z < b.maxZ;
		});
		return room && (room.getComponent(Named)?.id ?? room.id);
	};
	const open = (tx:number, tz:number):boolean => {
		const { x, z } = world.tileCenter(tx, tz);
		const tile = world.tileAtWorld(x, z);
		return !!tile && !tile.blocked;
	};
	const doorsAt = new Map<string, GameObject>();
	world.forEachComponent(Door, (_door, go) => {
		const { tx, tz } = world.tileCoordAt(go.transform.position.x, go.transform.position.z);
		doorsAt.set(key(tx, tz), go);
	});
	const lo = world.tileCoordAt(bounds.minX, bounds.minZ);
	const hi = world.tileCoordAt(bounds.maxX - CELL_SIZE * 0.5, bounds.maxZ - CELL_SIZE * 0.5);
	for (let tz = lo.tz; tz <= hi.tz; tz++) {
		for (let tx = lo.tx; tx <= hi.tx; tx++) {
			if (byCell.has(key(tx, tz)) || !open(tx, tz) || roomAt(tx, tz)) {
				continue;
			}
			// One passage: every open cell outside the rooms that joins this one.
			const passage:Passage = { cells: new Set(), ends: new Map(), doors: new Map() };
			const todo = [key(tx, tz)];
			passage.cells.add(todo[0]!);
			while (todo.length > 0) {
				const at = todo.pop()!;
				byCell.set(at, passage);
				const [cx, cz] = unkey(at);
				const here = doorsAt.get(at);
				if (here) {
					passage.doors.set(here, at);
				}
				for (const [dx, dz] of STEPS) {
					const nx = cx + dx;
					const nz = cz + dz;
					const next = key(nx, nz);
					const door = doorsAt.get(next);
					if (door && !passage.doors.has(door)) {
						passage.doors.set(door, at);
					}
					if (!open(nx, nz)) {
						continue;
					}
					const room = roomAt(nx, nz);
					if (room) {
						passage.ends.set(room, [...passage.ends.get(room) ?? [], at]);
					}
					else if (!passage.cells.has(next)) {
						passage.cells.add(next);
						todo.push(next);
					}
				}
			}
		}
	}
	return byCell;
}

/** Steps (cells) from `from` to every cell of `passage`, walking inside it. */
function stepsFrom(passage:Passage, from:string):Map<string, number> {
	const steps = new Map([[from, 0]]);
	const todo = [from];
	for (let i = 0; i < todo.length; i++) {
		const at = todo[i]!;
		const [cx, cz] = unkey(at);
		for (const [dx, dz] of STEPS) {
			const next = key(cx + dx, cz + dz);
			if (passage.cells.has(next) && !steps.has(next)) {
				steps.set(next, steps.get(at)! + 1);
				todo.push(next);
			}
		}
	}
	return steps;
}

/** What is said of a door: its name, and whether it stands open, shut, or locked. */
function doorWord(go:GameObject):string {
	const name = go.getComponent(Named)?.id ?? go.id;
	const state = go.getComponent(Door)?.open ? 'open' : go.getComponent(Lock)?.locked ? 'shut and locked' : 'shut';
	return `${name} (${state})`;
}

/** Meters for a count of cells, as a whole number. */
const meters = (cells:number):number => Math.round(cells * CELL_SIZE);

/** The passage at `x`, `z`, if any: who stands there is in it. */
function passageAt(world:World, x:number, z:number):{ passage:Passage; cell:string } | undefined {
	const { tx, tz } = world.tileCoordAt(x, z);
	const cell = key(tx, tz);
	const passage = passages(world).get(cell);
	return passage && { passage, cell };
}

/**
 * Where someone at `x`, `z` stands in a passage, in words: what it joins, how far each end is along it, and each
 * door in it or its walls with how far along it is. Nothing outside every passage.
 */
export function passageWhereabouts(world:World, x:number, z:number):string | undefined {
	const at = passageAt(world, x, z);
	if (!at) {
		return undefined;
	}
	const { passage, cell } = at;
	const steps = stepsFrom(passage, cell);
	const far = (cells:string[]):number => Math.min(...cells.map((c) => steps.get(c) ?? Infinity)) + 1;
	const ends = [...passage.ends].map(([room, cells]) => ({ room, m: meters(far(cells)) })).sort((a, b) => a.m - b.m);
	const what = ends.length >= 2
		? `the passage between ${ends.map((e) => e.room).join(' and ')}`
		: ends.length === 1 ? `a passage off ${ends[0]!.room}` : 'a passage';
	const lines = [`You are in ${what}, not in a room.`];
	if (ends.length > 0) {
		lines.push(`${ends.map((e) => `${e.room} is ${e.m}m along it`).join('; ')}.`);
	}
	const doors = [...passage.doors].map(([go, beside]) => ({ go, m: meters(steps.get(beside) ?? 0) })).sort((a, b) => a.m - b.m);
	if (doors.length > 0) {
		lines.push(`Doors on it: ${doors.map((d) => `${doorWord(d.go)} ${d.m}m along it`).join('; ')}.`);
	}
	return lines.join(' ');
}

/** The doors of the passage someone at `x`, `z` stands in: always in their sight, however the passage turns. */
export function passageDoors(world:World, x:number, z:number):GameObject[] {
	return [...passageAt(world, x, z)?.passage.doors.keys() ?? []];
}
