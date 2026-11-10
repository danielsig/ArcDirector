import { opposite, SIDE_OFFSETS, type Bounds, type Side } from '@arc-director/kindling';
import type { DemoChunk } from './demo-chunk';

/** How far a stair's side reaches in from the cell edge. A body stops on that face. */
const SIDE = 0.16;

/** Uphill side of a stair cell: the floor at this height, else a higher flight, else away from a lower one. */
export function stairUphill(chunk:DemoChunk, lx:number, lz:number):Side {
	const self = chunk.tile(lx, lz);
	const sides:Side[] = ['north', 'south', 'east', 'west'];
	if (!self) {
		return 'north';
	}
	const next = (side:Side) => chunk.tile(lx + SIDE_OFFSETS[side].tx, lz + SIDE_OFFSETS[side].tz);
	for (const side of sides) {
		const n = next(side);
		if (n && !n.blocked && n.def !== 'stairs' && n.height >= self.height) {
			return side;
		}
	}
	for (const side of sides) {
		const n = next(side);
		if (n?.def === 'stairs' && n.height > self.height) {
			return side;
		}
	}
	for (const side of sides) {
		const n = next(side);
		if (n && (!n.blocked || n.def === 'stairs') && n.height < self.height) {
			return opposite(side);
		}
	}
	return 'north';
}

/** The two long faces of a stair cell, kept back from the foot and the landing so a body can walk on and off. */
export function stairSides(chunk:DemoChunk, lx:number, lz:number):Bounds[] {
	const up = SIDE_OFFSETS[stairUphill(chunk, lx, lz)];
	const s = chunk.cellSize;
	const x0 = chunk.worldOriginX() + lx * s;
	const z0 = chunk.worldOriginZ() + lz * s;
	const mouth = 0.3;
	const below = chunk.tile(lx - up.tx, lz - up.tz);
	const above = chunk.tile(lx + up.tx, lz + up.tz);
	let lo = 0;
	let hi = s;
	const openFoot = !below || below.def !== 'stairs';
	const openTop = !above || above.def !== 'stairs';
	if (up.tx + up.tz > 0) {
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
	if (up.tx !== 0) {
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
