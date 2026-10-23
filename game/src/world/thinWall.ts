import type { ChunkBounds } from '@arc-director/kindling';
import { CELL_SIZE } from './constants';
import type { Chunk, Tile } from './Chunk';

/**
 * Thin walls: a wall one board thick down the middle of its cell, not a solid block. Which sides it runs out
 * to comes from its neighbours, so one map glyph gives all 16 shapes (a post, an end, a run, a corner, a T, a
 * cross). The wall line goes through cell centres, so doors, routes and sight stay on the grid: the cell is
 * still `blocked`, and only bodies (`TerrainSample.solids`) and the floor see how thin the wall is.
 */

/** Tile defs drawn and collided as thin walls. */
export const THIN_WALLS = new Set(['wood_wall', 'window']);

/** A timber wall's thickness, in meters. */
export const WALL_THICKNESS = 0.16;

/** The opening of a `window` tile: its width along the wall, and its sill and head heights. */
export const WINDOW = { width: 0.64, sill: 0.95, top: 1.8 } as const;

/** North, east, south, west. */
const SIDES = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;

export type Side = (typeof SIDES)[number];

/** Whether a wall runs on into this cell: any wall but water, or a doorway. */
function joinsWall(chunk:Chunk, lx:number, lz:number):boolean {
	const tile = chunk.tile(lx, lz);
	return !!tile && ((tile.blocked && tile.def !== 'water')
		|| chunk.entities.some((e) => e.def.startsWith('door') && e.localX === lx && e.localZ === lz));
}

/** The sides a thin wall runs out to from the middle of its cell. */
export function wallSides(chunk:Chunk, lx:number, lz:number):Side[] {
	return SIDES.filter(([dx, dz]) => joinsWall(chunk, lx + dx, lz + dz));
}

/** A run straight through the cell (west–east or north–south), as a window needs; else `undefined`. */
export function straightRun(chunk:Chunk, lx:number, lz:number):'x' | 'z' | undefined {
	const sides = wallSides(chunk, lx, lz).map(([dx, dz]) => `${dx},${dz}`).sort().join(' ');
	return sides === '-1,0 1,0' ? 'x' : sides === '0,-1 0,1' ? 'z' : undefined;
}

const cache = new WeakMap<Chunk, Map<number, ChunkBounds[]>>();

/** The wall's solid boxes, world XZ: an arm from the middle out to each side it runs to (a post when none). */
export function thinWallBoxes(chunk:Chunk, lx:number, lz:number):ChunkBounds[] {
	let byCell = cache.get(chunk);
	if (!byCell) {
		byCell = new Map();
		cache.set(chunk, byCell);
	}
	const key = lz * chunk.size + lx;
	let boxes = byCell.get(key);
	if (!boxes) {
		const c = chunk.worldCellCenter(lx, lz);
		const t = WALL_THICKNESS / 2;
		const r = CELL_SIZE / 2;
		const sides:readonly (readonly [number, number])[] = wallSides(chunk, lx, lz);
		boxes = (sides.length > 0 ? sides : [[0, 0] as const]).map(([dx, dz]) => ({
			minX: c.x + (dx < 0 ? -r : -t),
			maxX: c.x + (dx > 0 ? r : t),
			minZ: c.z + (dz < 0 ? -r : -t),
			maxZ: c.z + (dz > 0 ? r : t),
		}));
		byCell.set(key, boxes);
	}
	return boxes;
}

/** Whether world `x`, `z` is inside something solid on the grid: a thin wall's boards, or any other blocked tile. */
export function solidAt(chunk:Chunk, x:number, z:number):boolean {
	const tile = chunk.tileAtWorld(x, z);
	if (!tile?.blocked) {
		return false;
	}
	if (!THIN_WALLS.has(tile.def)) {
		return true;
	}
	const { localX, localZ } = chunk.worldToLocal(x, z);
	return thinWallBoxes(chunk, localX, localZ).some((b) => x >= b.minX && x < b.maxX && z >= b.minZ && z < b.maxZ);
}

/** The side of a cell a wall stands on (east, west, south, then north), for what is set against it; none when open all round. */
export function wallSide(chunk:Chunk, lx:number, lz:number):readonly [number, number] | undefined {
	return ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).find(([dx, dz]) => chunk.tile(lx + dx, lz + dz)?.blocked);
}

/** One quarter of a thin-wall cell's floor, world XZ, and the floor tile it continues. */
export type FloorQuarter = { tile:Tile; x0:number; z0:number; x1:number; z1:number };

/**
 * The floor either side of a thin wall: each quarter of the cell continues the open floor beside it (the cell
 * corner-wise first, then either side), so the room's boards run up to the wall inside and the lawn outside.
 */
export function wallFloors(chunk:Chunk, lx:number, lz:number):FloorQuarter[] {
	const c = chunk.worldCellCenter(lx, lz);
	const r = CELL_SIZE / 2;
	const out:FloorQuarter[] = [];
	for (const qz of [-1, 1]) {
		for (const qx of [-1, 1]) {
			const open = [[qx, qz], [qx, 0], [0, qz]]
				.map(([dx, dz]) => chunk.tile(lx + dx!, lz + dz!))
				.find((tile) => tile && !tile.blocked);
			if (open) {
				out.push({ tile: open, x0: Math.min(c.x, c.x + qx * r), z0: Math.min(c.z, c.z + qz * r), x1: Math.max(c.x, c.x + qx * r), z1: Math.max(c.z, c.z + qz * r) });
			}
		}
	}
	return out;
}

/** How far past its cell's edge a wall's face stands: none for a solid block, nearly half a cell for a thin wall. */
export function wallFaceInset(def:string | undefined):number {
	return def && THIN_WALLS.has(def) ? CELL_SIZE / 2 - WALL_THICKNESS / 2 : 0;
}
