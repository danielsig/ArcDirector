import { Door, HumanBody, Named } from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';
import { CELL_SIZE, CHUNK_SIZE } from './constants';
import { waterOpenAt } from './water';

const PATH_CAP = 2048;
const SNAP_CAP = 24;
/** Step cost onto a cell another body occupies. Empty floor is 1. */
const OCCUPANT_COST = 8;

/** Props that sit on walkable floor but occupy the cell for motors. */
const CELL_PROPS = new Set(['tree', 'boulder', 'stall']);

const N4 = [
	{ gx: 1, gz: 0 },
	{ gx: -1, gz: 0 },
	{ gx: 0, gz: 1 },
	{ gx: 0, gz: -1 },
];

function cellOf(x:number, z:number):{ gx:number; gz:number } {
	return { gx: Math.floor(x / CELL_SIZE), gz: Math.floor(z / CELL_SIZE) };
}

function cellCenter(gx:number, gz:number):{ x:number; z:number } {
	return { x: (gx + 0.5) * CELL_SIZE, z: (gz + 0.5) * CELL_SIZE };
}

function cellKey(gx:number, gz:number):string {
	return `${gx}:${gz}`;
}

function ignoreNames(ignore?:readonly string[]):Set<string> | null {
	if (!ignore || ignore.length === 0) {
		return null;
	}
	return new Set(ignore);
}

function bodyIgnored(go:GameObject, ignore:Set<string> | null):boolean {
	if (!ignore) {
		return false;
	}
	if (ignore.has(go.id) || ignore.has(go.name)) {
		return true;
	}
	const named = go.getComponent(Named)?.id;
	return !!named && ignore.has(named);
}

function hardObstacles(world:World):Set<string> {
	const out = new Set<string>();
	for (const chunk of world.chunks.values()) {
		const ox = chunk.origin.cx * CHUNK_SIZE;
		const oz = chunk.origin.cz * CHUNK_SIZE;
		for (const ent of chunk.entities) {
			if (!CELL_PROPS.has(ent.def)) {
				continue;
			}
			out.add(cellKey(ox + ent.localX, oz + ent.localZ));
		}
	}
	world.forEachComponent(Door, (door, go) => {
		if (door.open) {
			return;
		}
		const c = cellOf(go.transform.position.x, go.transform.position.z);
		out.add(cellKey(c.gx, c.gz));
	});
	return out;
}

function occupantCells(world:World, ignore?:readonly string[]):Set<string> {
	const skip = ignoreNames(ignore);
	const out = new Set<string>();
	world.forEachComponent(HumanBody, (_body, go) => {
		if (bodyIgnored(go, skip)) {
			return;
		}
		const c = cellOf(go.transform.position.x, go.transform.position.z);
		out.add(cellKey(c.gx, c.gz));
	});
	return out;
}

function mergeSets(a:Set<string>, b:Set<string>):Set<string> {
	const out = new Set(a);
	for (const k of b) {
		out.add(k);
	}
	return out;
}

function blocked(world:World, gx:number, gz:number, occ:Set<string>):boolean {
	if (occ.has(cellKey(gx, gz))) {
		return true;
	}
	const p = cellCenter(gx, gz);
	const tile = world.tileAtWorld(p.x, p.z);
	if (!tile) {
		return true;
	}
	if (tile.def === 'water' && waterOpenAt(world, p.x, p.z)) {
		return false;
	}
	return tile.blocked;
}

export function cellWalkable(
	world:World,
	x:number,
	z:number,
	ignore?:readonly string[],
):boolean {
	const c = cellOf(x, z);
	return !blocked(world, c.gx, c.gz, mergeSets(hardObstacles(world), occupantCells(world, ignore)));
}

function snapGoal(
	world:World,
	gx:number,
	gz:number,
	occ:Set<string>,
	start:{ gx:number; gz:number },
):{ gx:number; gz:number } | null {
	if (!blocked(world, gx, gz, occ) || (gx === start.gx && gz === start.gz)) {
		return { gx, gz };
	}
	const seen = new Set<string>([cellKey(gx, gz)]);
	const q:{ gx:number; gz:number }[] = [{ gx, gz }];
	let visits = 0;
	while (q.length > 0 && visits < SNAP_CAP) {
		visits += 1;
		const cur = q.shift()!;
		for (const d of N4) {
			const nx = cur.gx + d.gx;
			const nz = cur.gz + d.gz;
			const nk = cellKey(nx, nz);
			if (seen.has(nk)) {
				continue;
			}
			seen.add(nk);
			if (!blocked(world, nx, nz, occ)) {
				return { gx: nx, gz: nz };
			}
			q.push({ gx: nx, gz: nz });
		}
	}
	return null;
}

function reconstruct(
	came:Map<string, string>,
	startKey:string,
	goalKey:string,
):{ x:number; z:number }[] | null {
	const chain:string[] = [goalKey];
	let cur = goalKey;
	while (cur !== startKey) {
		const prev = came.get(cur);
		if (!prev) {
			return null;
		}
		chain.push(prev);
		cur = prev;
	}
	chain.reverse();
	const out:{ x:number; z:number }[] = [];
	for (let i = 1; i < chain.length; i++) {
		const [gx, gz] = chain[i].split(':').map(Number);
		out.push(cellCenter(gx, gz));
	}
	return out;
}

/**
 * A* on the 4-connected tile graph. Waypoints are cell centers after the start
 * cell. Empty array means start and goal share a cell (steer to the exact point).
 *
 * Closed doors, walls, water, and props are impassable. Other bodies (including
 * the player) are soft: stepping onto their cell costs 8 instead of 1, so A*
 * goes around occupied bodies when a detour exists and through them when it does not.
 * `ignore` is the mover — they are not occupancy on their own cell.
 */
export function findPath(
	world:World,
	x0:number,
	z0:number,
	tx:number,
	tz:number,
	ignore?:readonly string[],
):{ x:number; z:number }[] | null {
	const hard = hardObstacles(world);
	const occupied = occupantCells(world, ignore);
	const start = cellOf(x0, z0);
	const snapped = snapGoal(world, cellOf(tx, tz).gx, cellOf(tx, tz).gz, hard, start);
	if (!snapped) {
		return null;
	}
	const goal = snapped;
	if (start.gx === goal.gx && start.gz === goal.gz) {
		return [];
	}
	const startKey = cellKey(start.gx, start.gz);
	const goalKey = cellKey(goal.gx, goal.gz);
	const heuristic = (gx:number, gz:number):number => (
		Math.abs(goal.gx - gx) + Math.abs(goal.gz - gz)
	);
	const gScore = new Map<string, number>([[startKey, 0]]);
	const came = new Map<string, string>();
	const open:{ gx:number; gz:number; f:number }[] = [{
		gx: start.gx,
		gz: start.gz,
		f: heuristic(start.gx, start.gz),
	}];
	let visits = 0;
	while (open.length > 0 && visits < PATH_CAP) {
		visits += 1;
		let best = 0;
		for (let i = 1; i < open.length; i++) {
			if (open[i].f < open[best].f) {
				best = i;
			}
		}
		const cur = open.splice(best, 1)[0];
		const curKey = cellKey(cur.gx, cur.gz);
		const g = gScore.get(curKey) ?? Infinity;
		if (cur.f > g + heuristic(cur.gx, cur.gz)) {
			continue;
		}
		if (curKey === goalKey) {
			return reconstruct(came, startKey, goalKey);
		}
		for (const d of N4) {
			const nx = cur.gx + d.gx;
			const nz = cur.gz + d.gz;
			const nk = cellKey(nx, nz);
			if (nk !== startKey && blocked(world, nx, nz, hard)) {
				continue;
			}
			const step = occupied.has(nk) && nk !== startKey ? OCCUPANT_COST : 1;
			const tentative = g + step;
			if (tentative >= (gScore.get(nk) ?? Infinity)) {
				continue;
			}
			came.set(nk, curKey);
			gScore.set(nk, tentative);
			open.push({ gx: nx, gz: nz, f: tentative + heuristic(nx, nz) });
		}
	}
	return null;
}

/** Meters along the same A* `go_to` uses. `undefined` = no path; `0` = same cell. */
export function walkDistance(
	world:World,
	x0:number,
	z0:number,
	tx:number,
	tz:number,
	ignore?:readonly string[],
):number | undefined {
	const path = findPath(world, x0, z0, tx, tz, ignore);
	if (!path) {
		return undefined;
	}
	return path.length * CELL_SIZE;
}

/** Grid DDA. Start and end cells are open so occupants do not occlude themselves. */
export function lineClear(
	world:World,
	x0:number,
	z0:number,
	x1:number,
	z1:number,
	ignoreBodies = false,
):boolean {
	const occ = ignoreBodies
		? hardObstacles(world)
		: mergeSets(hardObstacles(world), occupantCells(world));
	const a = cellOf(x0, z0);
	const b = cellOf(x1, z1);
	if (a.gx === b.gx && a.gz === b.gz) {
		return true;
	}
	const dx = x1 - x0;
	const dz = z1 - z0;
	const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
	const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
	const tDeltaX = stepX === 0 ? Infinity : Math.abs(CELL_SIZE / dx);
	const tDeltaZ = stepZ === 0 ? Infinity : Math.abs(CELL_SIZE / dz);
	let tMaxX = stepX === 0
		? Infinity
		: ((stepX > 0 ? a.gx + 1 : a.gx) * CELL_SIZE - x0) / dx;
	let tMaxZ = stepZ === 0
		? Infinity
		: ((stepZ > 0 ? a.gz + 1 : a.gz) * CELL_SIZE - z0) / dz;
	let gx = a.gx;
	let gz = a.gz;
	while (gx !== b.gx || gz !== b.gz) {
		if (tMaxX < tMaxZ) {
			gx += stepX;
			tMaxX += tDeltaX;
		}
		else if (tMaxZ < tMaxX) {
			gz += stepZ;
			tMaxZ += tDeltaZ;
		}
		else {
			if (
				blocked(world, gx + stepX, gz, occ)
				|| blocked(world, gx, gz + stepZ, occ)
			) {
				return false;
			}
			gx += stepX;
			gz += stepZ;
			tMaxX += tDeltaX;
			tMaxZ += tDeltaZ;
		}
		if ((gx !== b.gx || gz !== b.gz) && blocked(world, gx, gz, occ)) {
			return false;
		}
	}
	return true;
}

/** First A* waypoint toward `tx,tz`, the destination if already in that cell, or null. */
export function pathStep(
	world:World,
	x0:number,
	z0:number,
	tx:number,
	tz:number,
	ignore?:readonly string[],
):{ x:number; z:number } | null {
	const path = findPath(world, x0, z0, tx, tz, ignore);
	if (!path) {
		return null;
	}
	return path[0] ?? { x: tx, z: tz };
}
