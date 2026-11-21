import { NEIGHBORS4 } from '@arc-director/kindling';
import type { ChunkLayer } from '../../render/build-chunk-mesh';
import { addSlabs, cellSlab, runSlab, type Slab } from '../../render/slabs';
import { PALETTE, plankMat } from '../../render/toon';
import { CELL_SIZE } from '../../world/constants';
import { DECK_TOP } from '../../world/terrain-kinds';

const RAIL_Y = 0.62;
const POST = 0.09;

/** Footbridge decks over water, with a rail along every edge that faces open water, on a post at each end. */
export const footbridgeLayer:ChunkLayer = ({ group, terrain, chunk }) => {
	const decks = chunk.cellsWhere((tile) => tile.def === 'bridge');
	addSlabs(group, plankMat(), decks.map(({ localX, localZ }) => cellSlab(chunk, localX, localZ, DECK_TOP - 0.12, DECK_TOP)), true);
	const fence:Slab[] = [];
	for (const { localX, localZ } of decks) {
		const c = chunk.worldCellCenter(localX, localZ);
		for (const [dx, dz] of NEIGHBORS4) {
			if (terrain.tileAt(chunk.tileCoord(localX + dx, localZ + dz))?.def !== 'water') {
				continue;
			}
			const edge = { x: c.x + dx * 0.45 * CELL_SIZE, z: c.z + dz * 0.45 * CELL_SIZE };
			const run = dz !== 0 ? 'x' : 'z';
			fence.push(runSlab(edge, run, -CELL_SIZE / 2, CELL_SIZE / 2, RAIL_Y - 0.04, RAIL_Y + 0.04, 0.08));
			for (const t of [-0.42, 0.42]) {
				const post = run === 'x' ? { x: edge.x + t, z: edge.z } : { x: edge.x, z: edge.z + t };
				fence.push(runSlab(post, 'x', -POST / 2, POST / 2, 0, RAIL_Y + 0.08, POST));
			}
		}
	}
	addSlabs(group, plankMat(PALETTE.woodDark), fence, true);
};
