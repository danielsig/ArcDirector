import { inBounds, SIDE_OFFSETS, SIDES, type Bounds, type Side } from '@arc-director/kindling';
import { CELL_SIZE } from './constants';
import type { DemoChunk, Tile } from './demo-chunk';

/**
 * Thin walls: a wall one board thick down the middle of its cell, not a solid block. Which sides it runs out
 * to comes from its neighbors, so one map glyph gives all 16 shapes (a post, an end, a run, a corner, a T, a
 * cross). The wall line goes through cell centers, so doors, routes and sight stay on the grid: the cell is
 * still `blocked`, and only bodies (`TerrainSample.solids`) and the floor see how thin the wall is.
 */

/** Tile defs drawn and collided as thin walls. */
export const THIN_WALLS = new Set(['wood_wall', 'window']);

/** A timber wall's thickness, in meters. */
export const WALL_THICKNESS = 0.16;

/** The opening of a `window` tile: its width along the wall, and its sill and head heights. */
export const WINDOW = { width: 0.64, sill: 0.95, top: 1.8 } as const;

/** Whether a wall runs on into this cell: any wall but water, or a doorway. */
function joinsWall(chunk:DemoChunk, lx:number, lz:number):boolean {
	const tile = chunk.tile(lx, lz);
	return !!tile && ((tile.blocked && tile.def !== 'water')
		|| chunk.entities.some((e) => e.def.startsWith('door') && e.localX === lx && e.localZ === lz));
}

/** The sides a thin wall runs out to from the middle of its cell. */
export function wallSides(chunk:DemoChunk, lx:number, lz:number):Side[] {
	return SIDES.filter((side) => joinsWall(chunk, lx + SIDE_OFFSETS[side].tx, lz + SIDE_OFFSETS[side].tz));
}

/** A run straight through the cell (west–east or north–south), as a window needs; else `undefined`. */
export function straightRun(chunk:DemoChunk, lx:number, lz:number):'x' | 'z' | undefined {
	const sides = wallSides(chunk, lx, lz).join(' ');
	return sides === 'east west' ? 'x' : sides === 'north south' ? 'z' : undefined;
}

const cache = new WeakMap<DemoChunk, Map<number, Bounds[]>>();

/** The wall's solid boxes, world XZ: an arm from the middle out to each side it runs to (a post when none). */
export function thinWallBoxes(chunk:DemoChunk, lx:number, lz:number):Bounds[] {
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
		const arms = wallSides(chunk, lx, lz).map((side) => SIDE_OFFSETS[side]);
		boxes = (arms.length > 0 ? arms : [{ tx: 0, tz: 0 }]).map(({ tx: dx, tz: dz }) => ({
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
export function solidAt(chunk:DemoChunk, x:number, z:number):boolean {
	const tile = chunk.tileAtWorld(x, z);
	if (!tile?.blocked) {
		return false;
	}
	if (!THIN_WALLS.has(tile.def)) {
		return true;
	}
	const { localX, localZ } = chunk.worldToLocal(x, z);
	return thinWallBoxes(chunk, localX, localZ).some((b) => inBounds(b, x, z));
}

/** The side of a cell a wall stands on (east, west, south, then north), for what is set against it; none when open all round. */
export function wallSide(chunk:DemoChunk, lx:number, lz:number):Side | undefined {
	return (['east', 'west', 'south', 'north'] as const).find((side) => chunk.tile(lx + SIDE_OFFSETS[side].tx, lz + SIDE_OFFSETS[side].tz)?.blocked);
}

/** One quarter of a thin-wall cell's floor, world XZ, and the floor tile it continues. */
export type FloorQuarter = { tile:Tile; bounds:Bounds };

/**
 * The floor either side of a thin wall: each quarter of the cell continues the open floor beside it (the cell
 * corner-wise first, then either side), so the room's boards run up to the wall inside and the lawn outside.
 */
export function wallFloors(chunk:DemoChunk, lx:number, lz:number):FloorQuarter[] {
	const c = chunk.worldCellCenter(lx, lz);
	const r = CELL_SIZE / 2;
	const out:FloorQuarter[] = [];
	for (const qz of [-1, 1]) {
		for (const qx of [-1, 1]) {
			const open = [[qx, qz], [qx, 0], [0, qz]]
				.map(([dx, dz]) => chunk.tile(lx + dx!, lz + dz!))
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
export function wallFaceInset(def:string | undefined):number {
	return def && THIN_WALLS.has(def) ? CELL_SIZE / 2 - WALL_THICKNESS / 2 : 0;
}
