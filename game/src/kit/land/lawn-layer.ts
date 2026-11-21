import type { LocalCoord, XZ } from '@arc-director/kindling';
import type * as THREE from 'three';
import type { ChunkLayer } from '../../render/build-chunk-mesh';
import { bankUV, finishYMesh, makeYBuf, pushGround, type GroundAt } from '../../render/ground-mesh';
import { SAND_TILE } from '../../render/nature';
import { meadowMat, sandMat } from '../../render/toon';
import { CELL_SIZE } from '../../world/constants';
import type { DemoChunk } from '../../world/demo-chunk';
import type { GlyphTerrain } from '../../world/GlyphTerrain';
import { GRASS_Y, TERRAIN, WATER_LOWER_Y, type TerrainDef } from '../../world/terrain-kinds';
import { wallFloorsOf } from '../walls/thin-wall';
import { BANK_BED, bankFall, bankWet, quad } from './land-mesh';
import { sandField } from './sand';

/** Squares per cell side where lawn meets water, for the sand edge to curve through. */
export const SHORE_STEPS = 8;

/** Water and lawn edges read tiles across chunk borders, and past the map's edge its edge tiles (`tileNear`), as the outskirts do. */
function isWater(terrain:GlyphTerrain, { x, z }:XZ):boolean {
	const tile = terrain.tileNear(x, z);
	return !!(tile && TERRAIN[tile.def].water);
}

/** Which of the cells beside `lx`, `lz` show water. */
export function waterSides(terrain:GlyphTerrain, chunk:DemoChunk, lx:number, lz:number):{ n:boolean; s:boolean; e:boolean; w:boolean } {
	const at = (dx:number, dz:number):boolean => isWater(terrain, chunk.worldCellCenter(lx + dx, lz + dz));
	return { n: at(0, -1), s: at(0, 1), e: at(1, 0), w: at(-1, 0) };
}

/** Cell `lx`, `lz`'s lawn: the whole cell, each corner cut off where water lies on both its sides. */
export function grassOutline(terrain:GlyphTerrain, chunk:DemoChunk, lx:number, lz:number):XZ[] {
	const x0 = chunk.worldOriginX() + lx * CELL_SIZE;
	const z0 = chunk.worldOriginZ() + lz * CELL_SIZE;
	const [x1, z1] = [x0 + CELL_SIZE, z0 + CELL_SIZE];
	const cut = CELL_SIZE * 0.52;
	const { n, s, e, w } = waterSides(terrain, chunk, lx, lz);
	const pts:XZ[] = [];
	if (n && w) {
		pts.push({ x: x0, z: z0 + cut }, { x: x0 + cut, z: z0 });
	}
	else {
		pts.push({ x: x0, z: z0 });
	}
	if (n && e) {
		pts.push({ x: x1 - cut, z: z0 }, { x: x1, z: z0 + cut });
	}
	else {
		pts.push({ x: x1, z: z0 });
	}
	if (s && e) {
		pts.push({ x: x1, z: z1 - cut }, { x: x1 - cut, z: z1 });
	}
	else {
		pts.push({ x: x1, z: z1 });
	}
	if (s && w) {
		pts.push({ x: x0 + cut, z: z1 }, { x: x0, z: z1 - cut });
	}
	else {
		pts.push({ x: x0, z: z1 });
	}
	return pts;
}

function addGrassFloor(
	group:THREE.Group,
	terrain:GlyphTerrain,
	chunk:DemoChunk,
	cells:LocalCoord[],
	waterCells:LocalCoord[],
	levels:GroundAt,
):void {
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const grass = makeYBuf();
	const sand = makeYBuf();
	const defAt = (x:number, z:number):TerrainDef | undefined => terrain.tileNear(x, z)?.def;
	const sandy = (p:XZ):number => sandField(defAt, p.x, p.z);
	const lawny = (p:XZ):number => -sandField(defAt, p.x, p.z);
	const shallow = (p:XZ):number => BANK_BED - sandField(defAt, p.x, p.z);
	// Just under the bed where it meets the water, so no seam shows.
	const bankY = (x:number, z:number):number => GRASS_Y - (GRASS_Y - WATER_LOWER_Y + 0.01) * bankFall(sandField(defAt, x, z));
	const step = CELL_SIZE / SHORE_STEPS;
	const near = (lx:number, lz:number, test:(c:XZ)=>boolean):boolean => (
		[-1, 0, 1].some((dx) => [-1, 0, 1].some((dz) => test(chunk.worldCellCenter(lx + dx, lz + dz))))
	);
	// Beside water: small squares, each split where the sand field crosses its cuts, so the sand edge curves.
	const forEachStep = (x0:number, z0:number, outline:XZ[], draw:(piece:XZ[])=>void):void => {
		for (let iz = 0; iz < SHORE_STEPS; iz++) {
			for (let ix = 0; ix < SHORE_STEPS; ix++) {
				const sx = x0 + ix * step;
				const sz = z0 + iz * step;
				draw(clipToBox(outline, sx, sz, sx + step, sz + step));
			}
		}
	};
	for (const { localX, localZ } of cells) {
		const x0 = ox + localX * CELL_SIZE;
		const z0 = oz + localZ * CELL_SIZE;
		const outline = grassOutline(terrain, chunk, localX, localZ);
		if (!near(localX, localZ, (c) => isWater(terrain, c))) {
			pushGround(grass, outline, GRASS_Y, levels);
			continue;
		}
		forEachStep(x0, z0, outline, (piece) => {
			pushGround(sand, clipBy(piece, sandy), bankY);
			pushGround(grass, clipBy(piece, lawny));
		});
	}
	// The bank goes on into the river's cells until it sinks under the bed, so the water's corners come out round.
	for (const { localX, localZ } of waterCells) {
		if (!near(localX, localZ, (c) => defAt(c.x, c.z) === 'grass')) {
			continue;
		}
		const x0 = ox + localX * CELL_SIZE;
		const z0 = oz + localZ * CELL_SIZE;
		const x1 = x0 + CELL_SIZE;
		const z1 = z0 + CELL_SIZE;
		forEachStep(x0, z0, [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }], (piece) => {
			pushGround(sand, clipBy(piece, shallow), bankY);
		});
	}
	for (const { bounds } of wallFloorsOf(terrain, chunk, (tile) => tile.def === 'grass')) {
		pushGround(grass, quad(bounds), GRASS_Y, levels);
	}
	// The bank runs across the way the sand field climbs toward the water.
	const e = 0.05;
	bankUV(sand, 0, SAND_TILE, (x, z) => bankWet(sandField(defAt, x, z)), (x, z) => (
		Math.abs(sandField(defAt, x, z + e) - sandField(defAt, x, z - e)) >= Math.abs(sandField(defAt, x + e, z) - sandField(defAt, x - e, z))
	));
	if (grass.v > 0) {
		group.add(finishYMesh(grass, meadowMat(), true));
	}
	if (sand.v > 0) {
		group.add(finishYMesh(sand, sandMat(), true));
	}
}

/**
 * The part of `pts` where `inside` is not below zero, in the same winding: one Sutherland–Hodgman step,
 * cutting each edge where `inside` crosses zero (linear between its ends, so exact for straight cuts).
 */
export function clipBy(pts:XZ[], inside:(p:XZ)=>number):XZ[] {
	const d = pts.map(inside);
	const out:XZ[] = [];
	pts.forEach((a, i) => {
		const j = (i + 1) % pts.length;
		const b = pts[j]!;
		if (d[i]! >= 0) {
			out.push(a);
		}
		if ((d[i]! > 0 && d[j]! < 0) || (d[i]! < 0 && d[j]! > 0)) {
			const t = d[i]! / (d[i]! - d[j]!);
			out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
		}
	});
	return out;
}

/** The part of convex `pts` inside the box, in the same winding. */
export function clipToBox(pts:XZ[], x0:number, z0:number, x1:number, z1:number):XZ[] {
	return [(p:XZ) => p.x - x0, (p:XZ) => x1 - p.x, (p:XZ) => p.z - z0, (p:XZ) => z1 - p.z].reduce(clipBy, pts);
}

/** The lawn, its riverbank sand, and the bank running on into the water's cells. */
export const lawnLayer:ChunkLayer = ({ group, terrain, chunk, levels, nature }) => {
	const grass = chunk.cellsWhere((tile) => tile.def === 'grass');
	const water = chunk.cellsWhere((tile) => !!TERRAIN[tile.def].water);
	if (nature && (grass.length > 0 || water.length > 0)) {
		addGrassFloor(group, terrain, chunk, grass, water, levels);
	}
};
