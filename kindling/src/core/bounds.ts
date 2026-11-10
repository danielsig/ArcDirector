/** An axis-aligned box on the ground, world meters: a chunk, a collider's footprint, a thin wall's board. */
export type Bounds = { minX:number; maxX:number; minZ:number; maxZ:number };

/** Whether `x`, `z` is in `box`: from `min` up to, not at, `max`, so two boxes that share an edge never both hold a point on it. */
export function inBounds(box:Bounds, x:number, z:number):boolean {
	return x >= box.minX && x < box.maxX && z >= box.minZ && z < box.maxZ;
}
