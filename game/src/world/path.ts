import { isOpen, Medium, type Passage, type RouteWorld, type Vec, type WorldGeometry } from 'arc-director';
import { SIDE_OFFSETS, distanceXZ, type GameObject, type TileCoord, type XZ } from '@arc-director/kindling';
import { Barrier, HumanBody } from '../engine/components';
import type { DemoWorld } from '../engine/demo-world';
import { CELL_SIZE } from './constants';
import { stairUphill } from './stairs';

/** A step onto a cell another body stands on costs this many times its length, so routes go around people when they can. */
const OCCUPANT_WEIGHT = 8;
/** Light and sound go over what stands lower than this, in meters: a counter, a chest, a fallen column. */
const EYE_HEIGHT = 1.5;

/** The eight steps to the cells around one, clockwise from east. */
const NEIGHBORS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

/** A point on the grid that knows the cell it lies in. */
export type Cell = Vec & TileCoord;

/** The middle of cell `tx`, `tz`. */
function centerOf(world:DemoWorld, { tx, tz }:TileCoord):Cell {
	const { x, z } = world.tileCenter(tx, tz);
	return Object.assign([x, z], { tx, tz });
}

function characterIn(world:DemoWorld, tx:number, tz:number, except?:GameObject):GameObject | undefined {
	return world.objectsInTile(tx, tz).find((go) => go !== except && go.getComponent(HumanBody)?.enabled);
}

/** Whether `body` would run into anything standing in the middle of cell `tx`, `tz`. */
function blockedCell(world:DemoWorld, body:GameObject, tx:number, tz:number):boolean {
	const { x, z } = world.tileCenter(tx, tz);
	return world.blocker(body, x, z) !== undefined;
}

/**
 * A stair is a step only along its climb. The sides are solid, so a route that aims at them leaves a body stuck
 * against the face.
 */
function alongClimb(world:DemoWorld, from:TileCoord, to:TileCoord):boolean {
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
		const up = SIDE_OFFSETS[stairUphill(chunk, localX, localZ)];
		return (dx === up.tx && dz === up.tz) || (dx === -up.tx && dz === -up.tz);
	};
	return along(from.tx, from.tz) && along(to.tx, to.tz);
}

/**
 * The passage `body` has from `a` into the next cell, to `b`: none where it would run into something standing there,
 * or squeeze past a corner it would run into. What stops it there and can be cleared (a `Barrier` that
 * {@link Barrier.standsInWay}) says how.
 */
function walk(world:DemoWorld, body:GameObject, a:Cell, b:Cell):Passage | undefined {
	if (!alongClimb(world, a, b)) {
		return undefined;
	}
	if (b.tx !== a.tx && b.tz !== a.tz && (blockedCell(world, body, b.tx, a.tz) || blockedCell(world, body, a.tx, b.tz))) {
		return undefined;
	}
	const hit = world.blocker(body, b[0], b[1], { from: { x: a[0], z: a[1] } });
	if (hit) {
		const barrier = hit === 'terrain' ? undefined : hit.getComponent(Barrier) ?? hit.parent?.getComponent(Barrier);
		if (!barrier?.standsInWay) {
			return undefined;
		}
		return barrier.opensFrom({ x: a[0], z: a[1] }) ? {} : { blocked: barrier.whyBlocked(body) };
	}
	return characterIn(world, b.tx, b.tz, body) ? { weight: OCCUPANT_WEIGHT } : {};
}

/** Whether cell `tx`, `tz` stops `what`: solid ground but water, whatever stands there taller than the eyes, and, for light, a body. */
function stops(world:DemoWorld, what:Medium, tx:number, tz:number):boolean {
	const { x, z } = world.tileCenter(tx, tz);
	const hit = world.blocker(null, x, z, { above: EYE_HEIGHT });
	return (hit === 'terrain' ? world.tileAtWorld(x, z)?.def !== 'water' : !!hit) || (what === Medium.Light && !!characterIn(world, tx, tz));
}

/**
 * Grid DDA from `a` to `b`: each step from one cell to the next, to `pass`, with the corner cells of a diagonal step,
 * until one does not pass.
 */
function alongLine(world:DemoWorld, a:XZ, b:XZ, pass:(from:TileCoord, to:TileCoord, corners:TileCoord[])=>boolean):boolean {
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
	let from = start;
	while (from.tx !== end.tx || from.tz !== end.tz) {
		let to:TileCoord;
		let corners:TileCoord[] = [];
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
export function lineClear(world:DemoWorld, what:Medium, a:XZ, b:XZ):boolean {
	const end = world.tileCoordAt(b.x, b.z);
	const solid = ({ tx, tz }:TileCoord) => stops(world, what, tx, tz);
	return alongLine(world, a, b, (from, to, corners) => !corners.some(solid) && ((to.tx === end.tx && to.tz === end.tz) || !solid(to)));
}

/** Whether `body` could walk straight from `a` to `b`, every step open: no wall, no web, no shut door on the line. */
export function walkClear(world:DemoWorld, body:GameObject, a:XZ, b:XZ):boolean {
	return alongLine(world, a, b, (from, to) => isOpen(walk(world, body, centerOf(world, from), centerOf(world, to))));
}

/**
 * The game's grid as ArcDirector walks and looks across it: a cell's eight neighbors, the step a body takes to one,
 * and what light and sound get across. A body steps where it would run into nothing, and onto or off a stair only
 * along its climb; light and sound go straight over what stands lower than the eyes, and light stops at bodies.
 */
export function cellWays(world:DemoWorld):Required<RouteWorld<GameObject, Cell> & Pick<WorldGeometry<GameObject>, 'getClarity'>> {
	return {
		createAt: ([x, z]) => Object.assign([x, z], world.tileCoordAt(x, z)),
		getNeighbors: ({ tx, tz }) => NEIGHBORS.map(([dx, dz]) => centerOf(world, { tx: tx + dx, tz: tz + dz })),
		getPassage: (body, a, b) => walk(world, body, a, b),
		getClarity: (what, a, b) => (lineClear(world, what, { x: a[0], z: a[1] }, { x: b[0], z: b[1] }) ? 1 : what === Medium.Sound ? THROUGH_WALL : 0),
	};
}

/** What a wall leaves of a sound heard through it, muffled. */
const THROUGH_WALL = 0.5;

/** Whether a route can bring `body` to `x`, `z`: it has an open step onto it from around it. */
export function canStand(world:DemoWorld, body:GameObject, x:number, z:number):boolean {
	const ways = cellWays(world);
	const at = ways.createAt([x, z]);
	return ways.getNeighbors(at).some((from) => isOpen(walk(world, body, from, at)));
}

/** How many rings of cells around a point `standableNear` searches. */
const STANDABLE_RINGS = 2;

/**
 * `point`, or, when `body` has no open step onto it (a wall, a pillar, a ledge), the nearest cell center around it
 * that it has. For spots worked out by geometry (a rank line, a guard's screen), which may fall in a wall.
 * `point` when none is near.
 */
export function standableNear(world:DemoWorld, body:GameObject, point:XZ):XZ {
	const standable = (x:number, z:number) => canStand(world, body, x, z);
	if (standable(point.x, point.z)) {
		return point;
	}
	const { tx, tz } = world.tileCoordAt(point.x, point.z);
	for (let ring = 1; ring <= STANDABLE_RINGS; ring++) {
		let best:XZ | undefined;
		for (let dz = -ring; dz <= ring; dz++) {
			for (let dx = -ring; dx <= ring; dx++) {
				const c = world.tileCenter(tx + dx, tz + dz);
				const closer = !best || distanceXZ(c, point) < distanceXZ(best, point);
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
