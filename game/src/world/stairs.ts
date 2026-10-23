import type { ChunkBounds } from '@arc-director/kindling';
import type { Chunk } from './Chunk';

/** How far a stair's side reaches in from the cell edge. A body stops on that face. */
const SIDE = 0.16;

/** Uphill neighbor of a stair cell: the floor at this height, else a higher flight, else away from a lower one. */
export function stairUphill(chunk:Chunk, lx:number, lz:number):{ dx:number; dz:number } {
	const self = chunk.tile(lx, lz);
	const dirs = [{ dx: 0, dz: -1 }, { dx: 0, dz: 1 }, { dx: 1, dz: 0 }, { dx: -1, dz: 0 }];
	if (!self) {
		return { dx: 0, dz: -1 };
	}
	for (const d of dirs) {
		const n = chunk.tile(lx + d.dx, lz + d.dz);
		if (n && !n.blocked && n.def !== 'stairs' && n.height >= self.height) {
			return d;
		}
	}
	for (const d of dirs) {
		const n = chunk.tile(lx + d.dx, lz + d.dz);
		if (n?.def === 'stairs' && n.height > self.height) {
			return d;
		}
	}
	for (const d of dirs) {
		const n = chunk.tile(lx + d.dx, lz + d.dz);
		if (n && (!n.blocked || n.def === 'stairs') && n.height < self.height) {
			return { dx: -d.dx, dz: -d.dz };
		}
	}
	return { dx: 0, dz: -1 };
}

/** The two long faces of a stair cell, kept back from the foot and the landing so a body can walk on and off. */
export function stairSides(chunk:Chunk, lx:number, lz:number):ChunkBounds[] {
	const up = stairUphill(chunk, lx, lz);
	const s = chunk.cellSize;
	const x0 = chunk.worldOriginX() + lx * s;
	const z0 = chunk.worldOriginZ() + lz * s;
	const mouth = 0.3;
	const below = chunk.tile(lx - up.dx, lz - up.dz);
	const above = chunk.tile(lx + up.dx, lz + up.dz);
	let lo = 0;
	let hi = s;
	const openFoot = !below || below.def !== 'stairs';
	const openTop = !above || above.def !== 'stairs';
	if (up.dx + up.dz > 0) {
		if (openFoot) {
			lo = mouth;
		}
		if (openTop) {
			hi = s - mouth;
		}
	}
	else {
		if (openTop) {
			lo = mouth;
		}
		if (openFoot) {
			hi = s - mouth;
		}
	}
	if (lo >= hi) {
		return [];
	}
	if (up.dx !== 0) {
		return [
			{ minX: x0 + lo, maxX: x0 + hi, minZ: z0, maxZ: z0 + SIDE },
			{ minX: x0 + lo, maxX: x0 + hi, minZ: z0 + s - SIDE, maxZ: z0 + s },
		];
	}
	return [
		{ minX: x0, maxX: x0 + SIDE, minZ: z0 + lo, maxZ: z0 + hi },
		{ minX: x0 + s - SIDE, maxX: x0 + s, minZ: z0 + lo, maxZ: z0 + hi },
	];
}
