import { boundsOf, distanceXZ, NEIGHBORS4, type Cover, type XZ } from '@arc-director/kindling';
import { CELL_SIZE } from '../../world/constants';
import type { GlyphTerrain } from '../../world/GlyphTerrain';
import { findBuildings, type DoorAnchor } from './buildings';

/** The cobbled roads: from each house's door, and each trail's head, to the nearest bridge. */

export function lawnAt(terrain:GlyphTerrain, x:number, z:number):boolean {
	const tile = terrain.tileAtWorld(x, z);
	return !!tile && !tile.blocked && tile.def === 'grass';
}

/** The lawn tile in front of the bridge span nearest `from`. */
function bridgeApproach(terrain:GlyphTerrain, from:XZ):XZ | undefined {
	let best:XZ | undefined;
	let bestD = Infinity;
	for (const chunk of terrain.chunks) {
		for (const ent of chunk.entities) {
			if (ent.def !== 'bridge_span') {
				continue;
			}
			const span = chunk.worldCellCenter(ent.localX, ent.localZ);
			for (const [dx, dz] of NEIGHBORS4) {
				const c = { x: span.x + dx * CELL_SIZE, z: span.z + dz * CELL_SIZE };
				const d = distanceXZ(c, from);
				if (d < bestD && lawnAt(terrain, c.x, c.z)) {
					best = c;
					bestD = d;
				}
			}
		}
	}
	return best;
}

/** Straight run of cells from `a` to `b` along one axis, both ends included; empty if any is not lawn. */
function run(terrain:GlyphTerrain, a:XZ, b:XZ):XZ[] {
	const steps = Math.round((Math.abs(b.x - a.x) + Math.abs(b.z - a.z)) / CELL_SIZE);
	const sx = Math.sign(b.x - a.x) * CELL_SIZE;
	const sz = Math.sign(b.z - a.z) * CELL_SIZE;
	const cells:XZ[] = [];
	for (let i = 0; i <= steps; i++) {
		const c = { x: a.x + sx * i, z: a.z + sz * i };
		if (!lawnAt(terrain, c.x, c.z)) {
			return [];
		}
		cells.push(c);
	}
	return cells;
}

/**
 * Path from the door: out from the house, turn halfway, then on to the bridge (an L, never a
 * staircase). Without a reachable bridge it runs straight out until the lawn ends.
 */
export function roadCells(terrain:GlyphTerrain, door:DoorAnchor):XZ[] {
	const start = { x: door.x + door.dx * CELL_SIZE, z: door.z + door.dz * CELL_SIZE };
	const target = bridgeApproach(terrain, start);
	if (target && door.dx === 0 && Math.sign(target.z - start.z) === door.dz) {
		const half = Math.round((target.z - start.z) / 2 / CELL_SIZE) * CELL_SIZE;
		for (const shift of [0, CELL_SIZE, -CELL_SIZE, 2 * CELL_SIZE, -2 * CELL_SIZE]) {
			const elbow = { x: start.x, z: start.z + half + shift };
			const turn = { x: target.x, z: elbow.z };
			const legs = [run(terrain, start, elbow), run(terrain, elbow, turn), run(terrain, turn, target)];
			if (legs.every((leg) => leg.length > 0)) {
				return [...legs[0]!, ...legs[1]!.slice(1), ...legs[2]!.slice(1)];
			}
		}
	}
	const cells:XZ[] = [];
	for (let c = start; cells.length < 24 && lawnAt(terrain, c.x, c.z); c = { x: c.x + door.dx * CELL_SIZE, z: c.z + door.dz * CELL_SIZE }) {
		cells.push(c);
	}
	return cells;
}

/** A straight stretch of road center line, from `a` to `b` (the same point for a lone cell). */
export type RoadLine = { a:XZ; b:XZ };

/**
 * Each house's door and its road (`roadCells`), then each trailhead (a `trail` tile, `out` toward the open lawn) and
 * its road: straight out across the lawn until it meets another road.
 */
function roadsOf(terrain:GlyphTerrain):{ door:DoorAnchor; cells:XZ[] }[] {
	const roads = findBuildings(terrain.chunks).map(({ out }) => ({ door: out, cells: roadCells(terrain, out) }));
	const key = (c:XZ):string => `${Math.round(c.x)},${Math.round(c.z)}`;
	for (const head of trailheads(terrain)) {
		const taken = new Set(roads.flatMap((r) => r.cells).map(key));
		const cells:XZ[] = [];
		for (let c = { x: head.x + head.dx * CELL_SIZE, z: head.z + head.dz * CELL_SIZE }; lawnAt(terrain, c.x, c.z) && !taken.has(key(c)); c = { x: c.x + head.dx * CELL_SIZE, z: c.z + head.dz * CELL_SIZE }) {
			cells.push(c);
		}
		roads.push({ door: head, cells });
	}
	return roads;
}

/** Where each `trail` tile leads in: its cell, and the way to the open ground beside it. */
function trailheads(terrain:GlyphTerrain):DoorAnchor[] {
	const out:DoorAnchor[] = [];
	for (const chunk of terrain.chunks) {
		chunk.forEachTile((tile, lx, lz) => {
			if (tile.def !== 'trail') {
				return;
			}
			const c = chunk.worldCellCenter(lx, lz);
			const open = NEIGHBORS4.find(([dx, dz]) => lawnAt(terrain, c.x + dx * CELL_SIZE, c.z + dz * CELL_SIZE));
			if (open) {
				out.push({ x: c.x, z: c.z, dx: open[0], dz: open[1] });
			}
		});
	}
	return out;
}

/** Every road cell, from every door. */
export function allRoadCells(terrain:GlyphTerrain):XZ[] {
	return roadsOf(terrain).flatMap((road) => road.cells);
}

/**
 * The roads as straight center lines: each road cell joins its road neighbors, a road's first cell runs on to
 * its door and any cell beside a bridge span on to the span, and every straight run is one line. Turns,
 * T-junctions (where roads meet), crossings and dead ends all follow from the lines; the edge of the cell is
 * where a door or span link stops.
 */
export function roadLines(terrain:GlyphTerrain):RoadLine[] {
	const roads = roadsOf(terrain);
	const key = (x:number, z:number):string => `${Math.round(x * 2)},${Math.round(z * 2)}`;
	const byKey = new Map(roads.flatMap((r) => r.cells).map((c) => [key(c.x, c.z), c] as const));
	const cells = [...byKey.values()];
	const spans = new Set(terrain.chunks.flatMap((chunk) => chunk.entities
		.filter((e) => e.def === 'bridge_span')
		.map((e) => chunk.worldCellCenter(e.localX, e.localZ))
		.map((c) => key(c.x, c.z))));
	/** How far the road runs from cell `c` toward `d`: a whole cell to another road cell, half to a door or span, else none. */
	const reach = (c:XZ, [dx, dz]:readonly [number, number]):number => {
		const x = c.x + dx * CELL_SIZE;
		const z = c.z + dz * CELL_SIZE;
		if (byKey.has(key(x, z))) {
			return CELL_SIZE;
		}
		const toDoor = roads.some(({ door, cells: own }) => own[0] && key(own[0].x, own[0].z) === key(c.x, c.z) && dx === -door.dx && dz === -door.dz);
		return toDoor || spans.has(key(x, z)) ? CELL_SIZE / 2 : 0;
	};
	const lines:RoadLine[] = [];
	for (const c of cells) {
		let alone = true;
		for (const u of [[1, 0], [0, 1]] as const) {
			const back = [-u[0], -u[1]] as const;
			if (reach(c, u) === 0 && reach(c, back) === 0) {
				continue;
			}
			alone = false;
			if (reach(c, back) === CELL_SIZE) {
				// Not where this run starts.
				continue;
			}
			let end = c;
			while (reach(end, u) === CELL_SIZE) {
				end = byKey.get(key(end.x + u[0] * CELL_SIZE, end.z + u[1] * CELL_SIZE))!;
			}
			const from = reach(c, back);
			const to = reach(end, u);
			lines.push({
				a: { x: c.x - u[0] * from, z: c.z - u[1] * from },
				b: { x: end.x + u[0] * to, z: end.z + u[1] * to },
			});
		}
		if (alone) {
			lines.push({ a: c, b: c });
		}
	}
	return lines;
}

/** Road height: a clear step above the lawn. The mesh and the feet use this. */
export const ROAD_Y = 0.04;
/** Half the road's width, in meters. */
export const ROAD_HALF_WIDTH = 0.46;
/** How round the road's inside corners are. */
export const ROAD_FILLET = 0.35;

function smoothMin(a:number, b:number, k:number):number {
	const h = Math.max(k - Math.abs(a - b), 0) / k;
	return Math.min(a, b) - (h * h * k) / 4;
}

export function segmentDistance(p:XZ, a:XZ, b:XZ):number {
	const dx = b.x - a.x;
	const dz = b.z - a.z;
	const len2 = dx * dx + dz * dz;
	const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2)) : 0;
	return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
}

/** Signed meters inside the cobbled road: positive on the stones, the same test the mesh is clipped with. */
export function roadInside(lines:RoadLine[], x:number, z:number):number {
	return ROAD_HALF_WIDTH - lines.reduce((d, l) => smoothMin(d, segmentDistance({ x, z }, l.a, l.b), ROAD_FILLET), Infinity);
}

/** The cobbled roads as one surface feet rest on, a clear step above the lawn; none on a map with no road. */
export function roadCover(terrain:GlyphTerrain, lines:RoadLine[]):Cover | undefined {
	if (lines.length === 0) {
		return undefined;
	}
	return {
		bounds: boundsOf(lines.flatMap((l) => [l.a, l.b]), ROAD_HALF_WIDTH + ROAD_FILLET),
		sample: (x, z) => (terrain.tileAtWorld(x, z)?.def === 'grass' && roadInside(lines, x, z) >= 0 ? ROAD_Y : undefined),
	};
}
