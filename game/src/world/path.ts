import { isOpen, Medium, type Passage, type RouteWorld, type Vec, type WorldGeometry } from 'arc-director';
import { opposite, Rigidbody, SIDE_OFFSETS, SIDES, distanceXZ, tilesAlong, type GameObject, type TileCoord, type XZ } from '@arc-director/kindling';
import { Barrier, HumanBody } from '../engine/components';
import type { DemoWorld } from '../engine/demo-world';

/** A step onto a cell another body stands on costs this many times its length, so routes go around people when they can. */
const OCCUPANT_WEIGHT = 8;
/** Light and sound go from eye to eye, this high over the ground (meters), so over a counter, a chest, a fallen column. */
const EYE_HEIGHT = 1.5;

/** The eight steps to the cells around one, clockwise from east. */
const NEIGHBORS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

/** A point on the grid that knows the cell it lies in. */
export type Cell = Vec & TileCoord;

/** The middle of cell `tx`, `tz`. */
function centerOf(world:DemoWorld, { tx, tz }:TileCoord):Cell {
	const { x, z } = world.terrain.tileCenter({ tx, tz });
	return Object.assign([x, z], { tx, tz });
}

function characterIn(world:DemoWorld, tx:number, tz:number, except?:GameObject):GameObject | undefined {
	return world.objectsInTile(tx, tz).find((go) => go !== except && go.getComponent(HumanBody)?.enabled);
}

/** Whether `body` would run into anything standing in the middle of cell `tx`, `tz`. */
function blockedCell(world:DemoWorld, body:GameObject, tx:number, tz:number):boolean {
	const { x, z } = world.terrain.tileCenter({ tx, tz });
	return world.blocker(body, x, z) !== undefined;
}

/**
 * A step into or out of a stair goes through one of its ends (`climbEnds`). The sides are solid, so a route that aims
 * at them leaves a body stuck against the face; a diagonal step goes through no one side, so only between open tiles.
 */
function alongClimb(world:DemoWorld, from:TileCoord, to:TileCoord):boolean {
	const out = SIDES.find((s) => SIDE_OFFSETS[s].tx === to.tx - from.tx && SIDE_OFFSETS[s].tz === to.tz - from.tz);
	const [start, end] = [world.terrain.climbEnds(from), world.terrain.climbEnds(to)];
	return out ? start.includes(out) && end.includes(opposite(out)) : start.length === 4 && end.length === 4;
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

/**
 * Whether `what` goes straight from eye to eye between `a` and `b` (`World.linecast`): over water and whatever stands
 * lower than the eyes, never through a wall. Light stops at a body; sound, and a shot, go past one. Nothing moving
 * but a body is in the way.
 */
export function inLineOfSight(world:DemoWorld, what:Medium, a:XZ, b:XZ):boolean {
	const eye = ({ x, z }:XZ) => ({ x, y: (world.terrain.sample(x, z)?.worldY ?? 0) + EYE_HEIGHT, z });
	const inWay = (go:GameObject) => !go.getComponent(Rigidbody) || (what === Medium.Light && !!go.getComponent(HumanBody)?.enabled);
	return !world.linecast(eye(a), eye(b), { filter: inWay });
}

/** Whether `body` could walk straight from `a` to `b`, every step open: no wall, no web, no shut door on the line. */
export function walkClear(world:DemoWorld, body:GameObject, a:XZ, b:XZ):boolean {
	let from:TileCoord | undefined;
	let clear = true;
	tilesAlong(world.terrain, a, b, (to) => {
		clear = !from || isOpen(walk(world, body, centerOf(world, from), centerOf(world, to)));
		from = to;
		return clear;
	});
	return clear;
}

/**
 * The game's grid as ArcDirector walks and looks across it: a cell's eight neighbors, the step a body takes to one,
 * and what light and sound get across. A body steps where it would run into nothing, and onto or off a stair only
 * along its climb; light and sound go straight over what stands lower than the eyes, and light stops at bodies.
 */
export function cellWays(world:DemoWorld):Required<RouteWorld<GameObject, Cell> & Pick<WorldGeometry<GameObject>, 'getClarity'>> {
	return {
		createAt: ([x, z]) => Object.assign([x, z], world.terrain.tileCoordAt(x, z)),
		getNeighbors: ({ tx, tz }) => NEIGHBORS.map(([dx, dz]) => centerOf(world, { tx: tx + dx, tz: tz + dz })),
		getPassage: (body, a, b) => walk(world, body, a, b),
		getClarity: (what, a, b) => (inLineOfSight(world, what, { x: a[0], z: a[1] }, { x: b[0], z: b[1] }) ? 1 : what === Medium.Sound ? THROUGH_WALL : 0),
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
	const { tx, tz } = world.terrain.tileCoordAt(point.x, point.z);
	for (let ring = 1; ring <= STANDABLE_RINGS; ring++) {
		let best:XZ | undefined;
		for (let dz = -ring; dz <= ring; dz++) {
			for (let dx = -ring; dx <= ring; dx++) {
				const c = world.terrain.tileCenter({ tx: tx + dx, tz: tz + dz });
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
