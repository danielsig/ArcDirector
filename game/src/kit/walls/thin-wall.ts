import { inBounds, SIDE_OFFSETS, SIDES, yawToward, type Bounds, type Side, type TileCoord } from '@arc-director/kindling';
import { CELL_SIZE } from '../../world/constants';
import type { DemoChunk, Tile } from '../../world/demo-chunk';
import type { GlyphTerrain } from '../../world/GlyphTerrain';
import { TERRAIN } from '../../world/terrain-kinds';

/**
 * Thin walls: a wall one board thick down the middle of its cell, not a solid block. Which sides it runs out
 * to comes from its neighbors, so one map glyph gives all 16 shapes (a post, an end, a run, a corner, a T, a
 * cross). The wall line goes through cell centers, so doors, routes and sight stay on the grid: the cell is
 * still `blocked`, and only bodies (`TerrainSample.solids`) and the floor see how thin the wall is.
 */

/** A timber wall's thickness, in meters. */
export const WALL_THICKNESS = 0.16;

/** The opening of a `window` tile: its width along the wall, and its sill and head heights. */
export const WINDOW = { width: 0.64, sill: 0.95, top: 1.8 } as const;

/** The tile a side over from `at`. */
const beside = (at:TileCoord, side:Side):TileCoord => ({ tx: at.tx + SIDE_OFFSETS[side].tx, tz: at.tz + SIDE_OFFSETS[side].tz });

/** Whether a wall runs on into this tile: any wall but water, or a doorway. */
function joinsWall(terrain:GlyphTerrain, at:TileCoord):boolean {
	const tile = terrain.tileAt(at);
	return !!tile && ((tile.blocked && tile.def !== 'water') || terrain.entitiesAt(at).some((e) => e.def.startsWith('door')));
}

/** The sides a thin wall runs out to from the middle of its tile, its neighbors read across chunk borders. */
export function wallSides(terrain:GlyphTerrain, at:TileCoord):Side[] {
	return SIDES.filter((side) => joinsWall(terrain, beside(at, side)));
}

/** A run straight through the tile (west–east or north–south), as a window needs; else `undefined`. */
export function straightRun(terrain:GlyphTerrain, at:TileCoord):'x' | 'z' | undefined {
	const sides = wallSides(terrain, at).join(' ');
	return sides === 'east west' ? 'x' : sides === 'north south' ? 'z' : undefined;
}

/** The wall's solid boxes, world XZ: an arm from the middle out to each side it runs to (a post when none). */
export function thinWallBoxes(terrain:GlyphTerrain, at:TileCoord):Bounds[] {
	const c = terrain.tileCenter(at);
	const t = WALL_THICKNESS / 2;
	const r = CELL_SIZE / 2;
	const arms = wallSides(terrain, at).map((side) => SIDE_OFFSETS[side]);
	return (arms.length > 0 ? arms : [{ tx: 0, tz: 0 }]).map(({ tx: dx, tz: dz }) => ({
		minX: c.x + (dx < 0 ? -r : -t),
		maxX: c.x + (dx > 0 ? r : t),
		minZ: c.z + (dz < 0 ? -r : -t),
		maxZ: c.z + (dz > 0 ? r : t),
	}));
}

/** Whether world `x`, `z` is inside something solid on the grid: a thin wall's boards, or any other blocked tile. */
export function solidAt(terrain:GlyphTerrain, x:number, z:number):boolean {
	const tile = terrain.tileAtWorld(x, z);
	return !!tile?.blocked && (!TERRAIN[tile.def].thin || thinWallBoxes(terrain, terrain.tileCoordAt(x, z)).some((b) => inBounds(b, x, z)));
}

/** The side of a tile a wall stands on (east, west, south, then north), read across chunk borders, for what is set against it; none when open all round. */
export function wallSide(terrain:GlyphTerrain, at:TileCoord):Side | undefined {
	return (['east', 'west', 'south', 'north'] as const).find((side) => terrain.tileAt(beside(at, side))?.blocked);
}

/** How far off a wall's face what hangs on it stands, in meters. */
const WALL_GAP = 0.12;

/** Where what hangs on the wall beside `at` stands, from the cell's center, and its yaw facing out from the wall; zeros when no wall is beside it. */
export function wallOffset(terrain:GlyphTerrain, at:TileCoord):{ x:number; z:number; yaw:number } {
	const side = wallSide(terrain, at);
	if (!side) {
		return { x: 0, z: 0, yaw: 0 };
	}
	const { tx: dx, tz: dz } = SIDE_OFFSETS[side];
	const out = CELL_SIZE / 2 + wallFaceInset(terrain.tileAt(beside(at, side))) - WALL_GAP;
	return { x: dx * out, z: dz * out, yaw: yawToward(-dx, -dz) };
}

/** One quarter of a thin-wall cell's floor, world XZ, and the floor tile it continues. */
export type FloorQuarter = { tile:Tile; bounds:Bounds };

/**
 * The floor either side of a thin wall: each quarter of the cell continues the open floor beside it (the cell
 * corner-wise first, then either side), so the room's boards run up to the wall inside and the lawn outside.
 */
export function wallFloors(terrain:GlyphTerrain, at:TileCoord):FloorQuarter[] {
	const c = terrain.tileCenter(at);
	const r = CELL_SIZE / 2;
	const out:FloorQuarter[] = [];
	for (const qz of [-1, 1]) {
		for (const qx of [-1, 1]) {
			const open = [[qx, qz], [qx, 0], [0, qz]]
				.map(([dx, dz]) => terrain.tileAt({ tx: at.tx + dx!, tz: at.tz + dz! }))
				.find((tile) => tile && !tile.blocked);
			if (open) {
				const bounds = {
					minX: Math.min(c.x, c.x + qx * r),
					maxX: Math.max(c.x, c.x + qx * r),
					minZ: Math.min(c.z, c.z + qz * r),
					maxZ: Math.max(c.z, c.z + qz * r),
				};
				out.push({ tile: open, bounds });
			}
		}
	}
	return out;
}

/** How far past its cell's edge a wall's face stands: none for a solid block, nearly half a cell for a thin wall. */
export function wallFaceInset(tile:Tile | undefined):number {
	return tile && TERRAIN[tile.def].thin ? CELL_SIZE / 2 - WALL_THICKNESS / 2 : 0;
}

/** The floor quarters under this chunk's thin walls whose floor is one `keep` takes. */
export function wallFloorsOf(terrain:GlyphTerrain, chunk:DemoChunk, keep:(tile:Tile)=>boolean):FloorQuarter[] {
	const out:FloorQuarter[] = [];
	chunk.forEachTile((tile, lx, lz) => {
		if (TERRAIN[tile.def].thin) {
			out.push(...wallFloors(terrain, chunk.tileCoord(lx, lz)).filter((q) => keep(q.tile)));
		}
	});
	return out;
}

/** The floor `keep` takes in a chunk, as world rects with their tiles: whole tiles, and the quarters of thin-wall tiles that continue it. */
export function floorRects(terrain:GlyphTerrain, chunk:DemoChunk, keep:(tile:Tile)=>boolean):FloorQuarter[] {
	const whole = chunk.cellsWhere(keep).map(({ localX, localZ }) => {
		const { x, z } = chunk.worldCellCenter(localX, localZ);
		const r = CELL_SIZE / 2;
		return { tile: chunk.tile(localX, localZ)!, bounds: { minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r } };
	});
	return [...whole, ...wallFloorsOf(terrain, chunk, keep)];
}
