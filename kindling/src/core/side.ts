import type { TileCoord } from './tile-coord.js';

/** A side of a tile, or a way across the map. North is -Z, where yaw 0 faces (`yawToForward`). */
export type Side = 'north' | 'east' | 'south' | 'west';

/** Clockwise from north, seen from above. */
export const SIDES:readonly Side[] = ['north', 'east', 'south', 'west'];

/** One tile toward each side: add it to a `TileCoord`. */
export const SIDE_OFFSETS:Readonly<Record<Side, TileCoord>> = {
	north: { tx: 0, tz: -1 },
	east: { tx: 1, tz: 0 },
	south: { tx: 0, tz: 1 },
	west: { tx: -1, tz: 0 },
};

/** One step to each of the four sides as `[dx, dz]`: east, west, south, north. */
export const NEIGHBORS4:readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function opposite(side:Side):Side {
	return SIDES[(SIDES.indexOf(side) + 2) % 4]!;
}
