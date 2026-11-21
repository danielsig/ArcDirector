import type { LocalCoord, XZ } from '@arc-director/kindling';
import type * as THREE from 'three';
import type { ChunkLayer } from '../../render/build-chunk-mesh';
import { finishYMesh, makeYBuf, pushYPoly, pushYTri, type YBuf } from '../../render/ground-mesh';
import { toonWaterMat, SURFACE_ORDER, type NatureMaps } from '../../render/nature';
import { CELL_SIZE } from '../../world/constants';
import type { DemoChunk } from '../../world/demo-chunk';
import type { GlyphTerrain } from '../../world/GlyphTerrain';
import { WATER_LOWER_Y, WATER_UPPER_Y, TERRAIN } from '../../world/terrain-kinds';
import { waterSides } from './lawn-layer';

const STILL:XZ = { x: 0, z: 0 };

/** The current at world `x`, `z`, read across chunk borders. A water tile's own glyph only: still water stays still. */
function flowAt(terrain:GlyphTerrain, x:number, z:number):XZ {
	const tile = terrain.tileNear(x, z);
	const f = tile && TERRAIN[tile.def].water ? tile.flow : undefined;
	const m = f ? Math.hypot(f.x, f.z) : 0;
	return f && m >= 1e-5 ? { x: f.x / m, z: f.z / m } : STILL;
}

function shoreAmt(terrain:GlyphTerrain, x:number, z:number):number {
	let land = 0;
	let n = 0;
	for (const dx of [-0.42, -0.18, 0, 0.18, 0.42]) {
		for (const dz of [-0.42, -0.18, 0, 0.18, 0.42]) {
			n += 1;
			const tile = terrain.tileNear(x + dx, z + dz);
			if (!tile || !TERRAIN[tile.def].water) {
				land += 1;
			}
		}
	}
	return land / n;
}

function fillWaterSheet(
	buf:YBuf,
	terrain:GlyphTerrain,
	chunk:DemoChunk,
	cells:LocalCoord[],
	y:number,
	shoreAt:(x:number, z:number)=>number,
):void {
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const cut = CELL_SIZE * 0.82;
	const waterRep = 1;
	const div = 4;
	for (const { localX, localZ } of cells) {
		const x0 = ox + localX * CELL_SIZE;
		const z0 = oz + localZ * CELL_SIZE;
		const x1 = x0 + CELL_SIZE;
		const z1 = z0 + CELL_SIZE;
		const cellF = flowAt(terrain, x0 + CELL_SIZE * 0.5, z0 + CELL_SIZE * 0.5);
		for (let iz = 0; iz < div; iz++) {
			for (let ix = 0; ix < div; ix++) {
				const xa = x0 + (x1 - x0) * (ix / div);
				const xb = x0 + (x1 - x0) * ((ix + 1) / div);
				const za = z0 + (z1 - z0) * (iz / div);
				const zb = z0 + (z1 - z0) * ((iz + 1) / div);
				const quad = [{ x: xa, z: za }, { x: xb, z: za }, { x: xb, z: zb }, { x: xa, z: zb }];
				pushYPoly(buf, quad, y, waterRep, (x, z) => cellF, shoreAt);
			}
		}
	}
	chunk.forEachTile((tile, lx, lz) => {
		if (tile.def !== 'grass') {
			return;
		}
		const x0 = ox + lx * CELL_SIZE;
		const z0 = oz + lz * CELL_SIZE;
		const x1 = x0 + CELL_SIZE;
		const z1 = z0 + CELL_SIZE;
		const { n, s, e, w } = waterSides(terrain, chunk, lx, lz);
		const nF = n ? flowAt(terrain, x0 + CELL_SIZE * 0.5, z0 - CELL_SIZE * 0.5) : undefined;
		const sF = s ? flowAt(terrain, x0 + CELL_SIZE * 0.5, z1 + CELL_SIZE * 0.5) : undefined;
		const eF = e ? flowAt(terrain, x1 + CELL_SIZE * 0.5, z0 + CELL_SIZE * 0.5) : undefined;
		const wF = w ? flowAt(terrain, x0 - CELL_SIZE * 0.5, z0 + CELL_SIZE * 0.5) : undefined;
		const cornerFlow = (a?:XZ, b?:XZ):XZ => a ?? b ?? STILL;
		const pushCorner = (pts:[number, number][], f:XZ):void => {
			pushYTri(
				buf,
				pts[0][0],
				pts[0][1],
				pts[1][0],
				pts[1][1],
				pts[2][0],
				pts[2][1],
				y,
				waterRep,
				f,
				f,
				f,
				shoreAt(pts[0][0], pts[0][1]),
				shoreAt(pts[1][0], pts[1][1]),
				shoreAt(pts[2][0], pts[2][1]),
			);
		};
		if (n && w) {
			pushCorner([[x0, z0], [x0 + cut, z0], [x0, z0 + cut]], cornerFlow(nF, wF));
		}
		if (n && e) {
			pushCorner([[x1, z0], [x1 - cut, z0], [x1, z0 + cut]], cornerFlow(nF, eF));
		}
		if (s && e) {
			pushCorner([[x1, z1], [x1, z1 - cut], [x1 - cut, z1]], cornerFlow(sF, eF));
		}
		if (s && w) {
			pushCorner([[x0, z1], [x0 + cut, z1], [x0, z1 - cut]], cornerFlow(sF, wF));
		}
	});
}

function addWater(group:THREE.Group, terrain:GlyphTerrain, chunk:DemoChunk, cells:LocalCoord[], nature:NatureMaps):void {
	const shoreAt = (x:number, z:number):number => shoreAmt(terrain, x, z);
	const lower = makeYBuf();
	const upper = makeYBuf();
	fillWaterSheet(lower, terrain, chunk, cells, WATER_LOWER_Y, shoreAt);
	fillWaterSheet(upper, terrain, chunk, cells, WATER_UPPER_Y, shoreAt);
	group.add(finishYMesh(lower, toonWaterMat(nature.water, 'lower'), true));
	const surface = finishYMesh(upper, toonWaterMat(nature.water, 'upper'), true);
	surface.renderOrder = SURFACE_ORDER;
	group.add(surface);
}

/** The river: its see-through surface over its bed, flowing, lighter toward the shore. */
export const waterLayer:ChunkLayer = ({ group, terrain, chunk, nature }) => {
	const cells = chunk.cellsWhere((tile) => !!TERRAIN[tile.def].water);
	if (nature && cells.length > 0) {
		addWater(group, terrain, chunk, cells, nature);
	}
};
