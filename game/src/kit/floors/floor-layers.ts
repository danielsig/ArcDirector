import { instanced } from '@arc-director/kindling';
import * as THREE from 'three';
import type { ChunkLayer } from '../../render/build-chunk-mesh';
import { finishYMesh, makeYBuf, pushGround } from '../../render/ground-mesh';
import { addSlabs, cellSlab, type Slab } from '../../render/slabs';
import { plankMat, stoneFloorMat, stoneWallMat } from '../../render/toon';
import { TILE_HEIGHT } from '../../world/constants';
import type { Tile } from '../../world/demo-chunk';
import { PLANK_Y, STONE_Y, TERRAIN } from '../../world/terrain-kinds';
import { quad } from '../land/land-mesh';
import { floorRects } from '../walls/thin-wall';

/** Stone paving: open ground floor that is not lawn, water, stairs or boards. */
function isFlatStone(tile:Tile):boolean {
	return !tile.blocked && tile.def !== 'stairs' && tile.height <= 0 && tile.def !== 'grass' && !TERRAIN[tile.def].water && tile.def !== 'plank';
}

export const stoneFloorLayer:ChunkLayer = ({ group, terrain, chunk }) => {
	const squares = floorRects(terrain, chunk, isFlatStone).map(({ bounds: b }) => ({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, size: b.maxX - b.minX }));
	instanced(group, new THREE.PlaneGeometry(1, 1), stoneFloorMat(), squares, false, ({ x, z, size }, o) => {
		o.position.set(x, STONE_Y, z);
		o.rotation.set(-Math.PI / 2, 0, 0);
		o.scale.set(size, size, 1);
	});
};

/** Floor raised whole tile heights: a stone block per tile, walled at its sides. */
export const raisedFloorLayer:ChunkLayer = ({ group, chunk }) => {
	const blocks:Slab[] = [];
	chunk.forEachTile((tile, lx, lz) => {
		if (!tile.blocked && tile.def !== 'stairs' && tile.height > 0) {
			blocks.push(cellSlab(chunk, lx, lz, 0, tile.height * TILE_HEIGHT));
		}
	});
	const wall = stoneWallMat();
	const floor = stoneFloorMat();
	addSlabs(group, [wall, wall, floor, floor, wall, wall], blocks, true);
};

/** Board floors, up to the thin walls round them. */
export const plankFloorLayer:ChunkLayer = ({ group, terrain, chunk, levels }) => {
	const boards = makeYBuf();
	for (const { bounds } of floorRects(terrain, chunk, (tile) => tile.def === 'plank')) {
		pushGround(boards, quad(bounds), PLANK_Y, levels);
	}
	if (boards.v > 0) {
		group.add(finishYMesh(boards, plankMat(), true));
	}
};
