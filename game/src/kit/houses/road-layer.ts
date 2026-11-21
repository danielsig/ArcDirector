import type { XZ } from '@arc-director/kindling';
import type { ChunkLayer } from '../../render/build-chunk-mesh';
import { finishYMesh, makeYBuf, pushGround } from '../../render/ground-mesh';
import { dirtMat } from '../../render/toon';
import { CELL_SIZE } from '../../world/constants';
import { clipBy, clipToBox, grassOutline, SHORE_STEPS } from '../land/lawn-layer';
import { roadInside, ROAD_HALF_WIDTH, ROAD_Y, segmentDistance } from './roads';

/**
 * The road over this chunk's lawn: everything within {@link ROAD_HALF_WIDTH} of its center lines, the lines
 * blended so inside corners curve. Outside corners and dead ends come out round. Drawn only on lawn, so
 * it stops square at a door or bridge it runs into.
 */
export const roadLayer:ChunkLayer = ({ group, terrain, chunk, levels, covers }) => {
	const lines = terrain.plan.roads;
	if (lines.length === 0) {
		return;
	}
	const inside = (p:XZ):number => roadInside(lines, p.x, p.z);
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const step = CELL_SIZE / SHORE_STEPS;
	const reach = CELL_SIZE * Math.SQRT1_2 + ROAD_HALF_WIDTH;
	const buf = makeYBuf();
	const polys:XZ[][] = [];
	chunk.forEachTile((tile, lx, lz) => {
		const x0 = ox + lx * CELL_SIZE;
		const z0 = oz + lz * CELL_SIZE;
		const center = { x: x0 + CELL_SIZE / 2, z: z0 + CELL_SIZE / 2 };
		if (tile.def !== 'grass' || !lines.some((l) => segmentDistance(center, l.a, l.b) < reach)) {
			return;
		}
		const outline = grassOutline(terrain, chunk, lx, lz);
		for (let iz = 0; iz < SHORE_STEPS; iz++) {
			for (let ix = 0; ix < SHORE_STEPS; ix++) {
				const sx = x0 + ix * step;
				const sz = z0 + iz * step;
				const poly = clipBy(clipToBox(outline, sx, sz, sx + step, sz + step), inside);
				if (poly.length >= 3) {
					covers.add(poly, ROAD_Y);
					polys.push(poly);
				}
			}
		}
	});
	for (const poly of polys) {
		pushGround(buf, poly, ROAD_Y, levels);
	}
	if (buf.v > 0) {
		group.add(finishYMesh(buf, dirtMat(), true));
	}
};
