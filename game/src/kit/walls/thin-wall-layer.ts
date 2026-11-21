import { ToonMaterial } from '@arc-director/kindling';
import * as THREE from 'three';
import type { ChunkLayer } from '../../render/build-chunk-mesh';
import { addSlabs, runSlab, type Slab } from '../../render/slabs';
import { PALETTE, plankMat } from '../../render/toon';
import { CELL_SIZE, WALL_HEIGHT } from '../../world/constants';
import { straightRun, thinWallBoxes, WALL_THICKNESS, WINDOW } from './thin-wall';
import { TERRAIN } from '../../world/terrain-kinds';

/**
 * Window glass. It writes depth, so ink outlines see a flat pane and nothing is inked through it; drawn after
 * every other see-through thing ({@link GLASS_ORDER}), so a flame behind the window still shows.
 */
const glassMat = new ToonMaterial({ color: 0xcfe4ee, transparent: true, opacity: 0.22, side: THREE.DoubleSide, outline: false });
glassMat.userData.shared = true;
const GLASS_ORDER = 10;

/**
 * Thin walls, from the same boxes bodies collide with. A window (in a straight run) is the wall around its
 * opening: jambs, a sill wall below and a header above, a dark frame and muntins in a cross, and glass that
 * casts no shadow, so sun and firelight both come through.
 */
export const thinWallLayer:ChunkLayer = ({ group, terrain, chunk }) => {
	const walls:Slab[] = [];
	const frames:Slab[] = [];
	const panes:Slab[] = [];
	const { width, sill, top } = WINDOW;
	const half = CELL_SIZE / 2;
	const w = width / 2;
	const bar = 0.05;
	chunk.forEachTile((tile, lx, lz) => {
		if (!TERRAIN[tile.def].thin) {
			return;
		}
		const run = tile.def === 'window' ? straightRun(terrain, chunk.tileCoord(lx, lz)) : undefined;
		if (!run) {
			walls.push(...thinWallBoxes(terrain, chunk.tileCoord(lx, lz)).map((b) => ({ ...b, minY: 0, maxY: WALL_HEIGHT })));
			return;
		}
		const c = chunk.worldCellCenter(lx, lz);
		const slab = (u0:number, u1:number, y0:number, y1:number, depth:number):Slab => runSlab(c, run, u0, u1, y0, y1, depth);
		walls.push(
			slab(-half, -w, 0, WALL_HEIGHT, WALL_THICKNESS),
			slab(w, half, 0, WALL_HEIGHT, WALL_THICKNESS),
			slab(-w, w, 0, sill, WALL_THICKNESS),
			slab(-w, w, top, WALL_HEIGHT, WALL_THICKNESS),
		);
		const frame = WALL_THICKNESS + 0.04;
		frames.push(
			slab(-w, -w + bar, sill, top, frame),
			slab(w - bar, w, sill, top, frame),
			slab(-w - 0.04, w + 0.04, sill - 0.03, sill + bar, frame + 0.06),
			slab(-w, w, top - bar, top, frame),
			// The cross: one upright and one rail, through the middle of the glass.
			slab(-0.018, 0.018, sill, top, 0.04),
			slab(-w, w, (sill + top) / 2 - 0.018, (sill + top) / 2 + 0.018, 0.04),
		);
		panes.push(slab(-w, w, sill, top, 0.01));
	});
	addSlabs(group, plankMat(), walls, true);
	addSlabs(group, plankMat(PALETTE.woodDark), frames, true);
	const glass = addSlabs(group, glassMat, panes, false);
	if (glass) {
		glass.renderOrder = GLASS_ORDER;
	}
};
