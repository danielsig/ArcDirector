import type { XZ } from './xz.js';

/** An axis-aligned box on the ground, world meters: a chunk, a collider's footprint, a thin wall's board. */
export interface Bounds { minX:number; maxX:number; minZ:number; maxZ:number }

/** The box round `points`, `pad` wider on every side. */
export function boundsOf(points:Iterable<XZ>, pad = 0):Bounds {
	const box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
	for (const { x, z } of points) {
		box.minX = Math.min(box.minX, x - pad);
		box.maxX = Math.max(box.maxX, x + pad);
		box.minZ = Math.min(box.minZ, z - pad);
		box.maxZ = Math.max(box.maxZ, z + pad);
	}
	return box;
}

/** Whether `x`, `z` is in `box`: from `min` up to, not at, `max`, so two boxes that share an edge never both hold a point on it. */
export function inBounds(box:Bounds, x:number, z:number):boolean {
	return x >= box.minX && x < box.maxX && z >= box.minZ && z < box.maxZ;
}
