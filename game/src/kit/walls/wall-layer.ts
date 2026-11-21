import { hash, NEIGHBORS4, SIDE_OFFSETS } from '@arc-director/kindling';
import type { ChunkLayer } from '../../render/build-chunk-mesh';
import { addSlabs, cellSlab, runSlab, type Slab } from '../../render/slabs';
import { stoneWallMat } from '../../render/toon';
import { CELL_SIZE, MOON_WINDOW, TILE_HEIGHT, WALL_HEIGHT } from '../../world/constants';
import type { DemoChunk } from '../../world/demo-chunk';
import type { GlyphTerrain } from '../../world/GlyphTerrain';
import { WATER_UPPER_Y, TERRAIN } from '../../world/terrain-kinds';
import { wallSide } from './thin-wall';

/** Stone walls: a block per tile (a ruin's as high as its tile, give or take a course), moon windows cut through them, and their feet where they stand in water. */
export const wallLayer:ChunkLayer = ({ group, terrain, chunk }) => {
	const windows = moonWindowWalls(terrain, chunk);
	const stone:Slab[] = [...windows.values()].flat();
	for (const { localX, localZ } of chunk.cellsWhere((tile) => tile.blocked && tile.def !== 'water' && tile.def !== 'stairs' && !TERRAIN[tile.def].thin && !TERRAIN[tile.def].land)) {
		if (!windows.has(localZ * chunk.size + localX)) {
			stone.push(cellSlab(chunk, localX, localZ, 0, wallHeight(chunk, localX, localZ)));
		}
	}
	// The foot of a wall that stands in the river, from the water up into the courses.
	const half = CELL_SIZE / 2;
	chunk.forEachTile((tile, lx, lz) => {
		if (!tile.blocked || TERRAIN[tile.def].water || TERRAIN[tile.def].thin || TERRAIN[tile.def].land) {
			return;
		}
		const c = chunk.worldCellCenter(lx, lz);
		for (const [dx, dz] of NEIGHBORS4) {
			const n = terrain.tileNear(c.x + dx * CELL_SIZE, c.z + dz * CELL_SIZE);
			if (!n || !TERRAIN[n.def].water) {
				continue;
			}
			const y0 = n.height * TILE_HEIGHT + WATER_UPPER_Y;
			const face = dx !== 0 ? c.x + dx * half : c.z + dz * half;
			stone.push(dx !== 0
				? { minX: face - 0.04, maxX: face + 0.04, minY: y0, maxY: 0.04, minZ: c.z - half, maxZ: c.z + half }
				: { minX: c.x - half, maxX: c.x + half, minY: y0, maxY: 0.04, minZ: face - 0.04, maxZ: face + 0.04 });
		}
	});
	addSlabs(group, stoneWallMat(), stone, true);
};

/** The wall behind each moon window, keyed by cell: stone round its opening, cut right through the cell. */
function moonWindowWalls(terrain:GlyphTerrain, chunk:DemoChunk):Map<number, Slab[]> {
	const out = new Map<number, Slab[]>();
	const { width, height, y } = MOON_WINDOW;
	const half = CELL_SIZE / 2;
	for (const ent of chunk.entities) {
		const side = ent.def === 'moon_window' ? wallSide(terrain, chunk.tileCoord(ent.localX, ent.localZ)) : undefined;
		if (!side) {
			continue;
		}
		const { tx: dx, tz: dz } = SIDE_OFFSETS[side];
		const lx = ent.localX + dx;
		const lz = ent.localZ + dz;
		if (!chunk.tile(lx, lz)) {
			// The wall is in the next chunk, which draws it whole.
			continue;
		}
		const floor = (chunk.tile(ent.localX, ent.localZ)?.height ?? 0) * TILE_HEIGHT;
		const y0 = floor + y - height / 2;
		const y1 = floor + y + height / 2;
		const top = wallHeight(chunk, lx, lz);
		const slab = (u0:number, u1:number, b:number, t:number):Slab => runSlab(chunk.worldCellCenter(lx, lz), dx !== 0 ? 'z' : 'x', u0, u1, b, t, CELL_SIZE);
		out.set(lz * chunk.size + lx, [
			slab(-half, half, 0, y0),
			slab(-half, half, y1, top),
			slab(-half, -width / 2, y0, y1),
			slab(width / 2, half, y0, y1),
		]);
	}
	return out;
}

/** A ruined wall stands as high as its tile, give or take a broken course; every other wall is full height. */
function wallHeight(chunk:DemoChunk, lx:number, lz:number):number {
	const tile = chunk.tile(lx, lz);
	if (tile?.def !== 'ruin_wall') {
		return WALL_HEIGHT;
	}
	const courses = Math.round(hash(chunk.worldOriginX() + lx, chunk.worldOriginZ() + lz, 5) * 2) - 1;
	return Math.max(TILE_HEIGHT / 2, tile.height * TILE_HEIGHT + (courses * TILE_HEIGHT) / 4);
}
