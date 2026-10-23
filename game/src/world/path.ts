import type { PathStep, RouteWorld, Vec } from 'arc-director';
import type { GameObject } from '@arc-director/kindling';
import { Barrier, HumanBody } from '../engine/components';
import type { World } from '../engine/World';
import { CELL_SIZE } from './constants';
import { stairUphill } from './stairs';

/** A step onto a cell another body stands on costs this many times its length, so routes go around people when they can. */
const OCCUPANT_COST = 8;
/** Light and sound go over what stands lower than this, in meters: a counter, a chest, a fallen column. */
const EYE_HEIGHT = 1.5;

/** The eight steps to the cells around one, clockwise from east. */
const NEIGHBOURS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

function characterIn(world:World, tx:number, tz:number, except?:GameObject):GameObject | undefined {
	return world.objectsInTile(tx, tz).find((go) => go !== except && go.getComponent(HumanBody)?.enabled);
}

/** Whether `body` would run into anything standing in the middle of cell `tx`, `tz`. */
function blockedCell(world:World, body:GameObject, tx:number, tz:number):boolean {
	const { x, z } = world.tileCenter(tx, tz);
	return world.blocker(body, x, z) !== undefined;
}

/**
 * A stair is a step only along its climb. The sides are solid, so a route that aims at them leaves a body stuck
 * against the face.
 */
function alongClimb(world:World, a:Vec, b:Vec):boolean {
	const from = world.tileCoordAt(a[0], a[1]);
	const to = world.tileCoordAt(b[0], b[1]);
	const dx = to.tx - from.tx;
	const dz = to.tz - from.tz;
	const along = (tx:number, tz:number):boolean => {
		const { x, z } = world.tileCenter(tx, tz);
		const chunk = world.chunkAtWorld(x, z);
		const tile = chunk?.tileAtWorld(x, z);
		if (!chunk || tile?.def !== 'stairs' || tile.blocked) {
			return true;
		}
		const { localX, localZ } = chunk.worldToLocal(x, z);
		const up = stairUphill(chunk, localX, localZ);
		return (dx === up.dx && dz === up.dz) || (dx === -up.dx && dz === -up.dz);
	};
	return along(from.tx, from.tz) && along(to.tx, to.tz);
}

/**
 * The step `body` takes from `a` into the next cell, to `b`: none where it would run into something standing there,
 * or squeeze past a corner it would run into. What stops it there and can be cleared (a `Barrier`) says how.
 */
function walk(world:World, body:GameObject, a:Vec, b:Vec):PathStep | undefined {
	if (!alongClimb(world, a, b)) {
		return undefined;
	}
	const from = world.tileCoordAt(a[0], a[1]);
	const to = world.tileCoordAt(b[0], b[1]);
	if (to.tx !== from.tx && to.tz !== from.tz && (blockedCell(world, body, to.tx, from.tz) || blockedCell(world, body, from.tx, to.tz))) {
		return undefined;
	}
	const hit = world.blocker(body, b[0], b[1], { from: { x: a[0], z: a[1] } });
	if (hit) {
		const barrier = hit === 'terrain' ? undefined : hit.getComponent(Barrier);
		return barrier && { blocked: barrier.whyBlocked(body) };
	}
	return characterIn(world, to.tx, to.tz, body) ? { cost: OCCUPANT_COST * Math.hypot(b[0] - a[0], b[1] - a[1]) } : {};
}

/** Whether cell `tx`, `tz` stops `what`: solid ground but water, whatever stands there taller than the eyes, and, for light, a body. */
function stops(world:World, what:'light' | 'sound', tx:number, tz:number):boolean {
	const { x, z } = world.tileCenter(tx, tz);
	const hit = world.blocker(null, x, z, { above: EYE_HEIGHT });
	return (hit === 'terrain' ? world.tileAtWorld(x, z)?.def !== 'water' : !!hit) || (what === 'light' && !!characterIn(world, tx, tz));
}

type Cell = { tx:number; tz:number };

/**
 * Grid DDA from `a` to `b`: each step from one cell to the next, to `pass`, with the corner cells of a diagonal step,
 * until one does not pass.
 */
function alongLine(world:World, a:{ x:number; z:number }, b:{ x:number; z:number }, pass:(from:Cell, to:Cell, corners:Cell[])=>boolean):boolean {
	const start = world.tileCoordAt(a.x, a.z);
	const end = world.tileCoordAt(b.x, b.z);
	const dx = b.x - a.x;
	const dz = b.z - a.z;
	const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
	const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
	const tDeltaX = stepX === 0 ? Infinity : Math.abs(CELL_SIZE / dx);
	const tDeltaZ = stepZ === 0 ? Infinity : Math.abs(CELL_SIZE / dz);
	let tMaxX = stepX === 0
		? Infinity
		: ((stepX > 0 ? start.tx + 1 : start.tx) * CELL_SIZE - a.x) / dx;
	let tMaxZ = stepZ === 0
		? Infinity
		: ((stepZ > 0 ? start.tz + 1 : start.tz) * CELL_SIZE - a.z) / dz;
	let from:Cell = { tx: start.tx, tz: start.tz };
	while (from.tx !== end.tx || from.tz !== end.tz) {
		let to:Cell;
		let corners:Cell[] = [];
		if (tMaxX < tMaxZ) {
			to = { tx: from.tx + stepX, tz: from.tz };
			tMaxX += tDeltaX;
		}
		else if (tMaxZ < tMaxX) {
			to = { tx: from.tx, tz: from.tz + stepZ };
			tMaxZ += tDeltaZ;
		}
		else {
			to = { tx: from.tx + stepX, tz: from.tz + stepZ };
			corners = [{ tx: from.tx + stepX, tz: from.tz }, { tx: from.tx, tz: from.tz + stepZ }];
			tMaxX += tDeltaX;
			tMaxZ += tDeltaZ;
		}
		if (!pass(from, to, corners)) {
			return false;
		}
		from = to;
	}
	return true;
}

/** Whether `what` goes straight from `a` to `b`. Their own cells never stop it, so no one hides themselves or the one looking. */
export function lineClear(world:World, what:'light' | 'sound', a:{ x:number; z:number }, b:{ x:number; z:number }):boolean {
	const end = world.tileCoordAt(b.x, b.z);
	const solid = ({ tx, tz }:Cell) => stops(world, what, tx, tz);
	return alongLine(world, a, b, (_, to, corners) => !corners.some(solid) && ((to.tx === end.tx && to.tz === end.tz) || !solid(to)));
}

/** Whether `body` could walk straight from `a` to `b`, every step open: no wall, no web, no shut door on the line. */
export function walkClear(world:World, body:GameObject, a:{ x:number; z:number }, b:{ x:number; z:number }):boolean {
	const centre = ({ tx, tz }:Cell):Vec => {
		const { x, z } = world.tileCenter(tx, tz);
		return [x, z];
	};
	return alongLine(world, a, b, (from, to) => {
		const step = walk(world, body, centre(from), centre(to));
		return !!step && !step.blocked;
	});
}

/**
 * The game's grid as ArcDirector walks and looks across it: a cell's eight neighbours, and what gets from one point
 * to another. A stair is a neighbour only along its climb, not off the sides. A body steps where it would run into
 * nothing; light and sound go straight over what stands lower than the eyes, and light stops at bodies.
 */
export function cellWays(world:World):RouteWorld<GameObject> {
	return {
		getNeighbors: (point) => {
			const { tx, tz } = world.tileCoordAt(point[0], point[1]);
			return NEIGHBOURS.flatMap(([dx, dz]) => {
				const { x, z } = world.tileCenter(tx + dx, tz + dz);
				const next:Vec = [x, z];
				return alongClimb(world, point, next) ? [next] : [];
			});
		},
		canPass: (what, a, b) => {
			if (what === 'light' || what === 'sound') {
				return lineClear(world, what, { x: a[0], z: a[1] }, { x: b[0], z: b[1] }) ? {} : undefined;
			}
			return walk(world, what, a, b);
		},
	};
}

/** How many rings of cells around a point `standableNear` searches. */
const STANDABLE_RINGS = 2;

/**
 * `point`, or, when `body` has no open step onto it (a wall, a pillar, a ledge), the nearest cell centre around it
 * that it has. For spots worked out by geometry (a rank line, a guard's screen), which may fall in a wall.
 * `point` when none is near.
 */
export function standableNear(world:World, body:GameObject, point:{ x:number; z:number }):{ x:number; z:number } {
	const ways = cellWays(world);
	const standable = (x:number, z:number) => ways.getNeighbors([x, z]).some((from) => {
		const step = ways.canPass(body, from, [x, z]);
		return !!step && !step.blocked;
	});
	if (standable(point.x, point.z)) {
		return point;
	}
	const { tx, tz } = world.tileCoordAt(point.x, point.z);
	for (let ring = 1; ring <= STANDABLE_RINGS; ring++) {
		let best:{ x:number; z:number } | undefined;
		for (let dz = -ring; dz <= ring; dz++) {
			for (let dx = -ring; dx <= ring; dx++) {
				const c = world.tileCenter(tx + dx, tz + dz);
				const closer = !best || Math.hypot(c.x - point.x, c.z - point.z) < Math.hypot(best.x - point.x, best.z - point.z);
				if (Math.max(Math.abs(dx), Math.abs(dz)) === ring && closer && standable(c.x, c.z)) {
					best = c;
				}
			}
		}
		if (best) {
			return best;
		}
	}
	return point;
}
