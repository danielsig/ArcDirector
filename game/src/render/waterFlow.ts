import type { Tile } from '../world/Chunk';
import { showsWater } from '../world/water';

export type Flow = { x:number; z:number };

const ZERO:Flow = { x: 0, z: 0 };

function norm(f:Flow):Flow {
	const m = Math.hypot(f.x, f.z);
	if (m < 1e-5) {
		return ZERO;
	}
	return { x: f.x / m, z: f.z / m };
}

/** This tile's glyph only. Still water stays still; current does not leak into the pond. */
function tileFlow(tile:Tile | undefined):Flow {
	return showsWater(tile?.def) && tile?.flow ? norm(tile.flow) : ZERO;
}

export type WaterFlowField = {
	sample(x:number, z:number):Flow;
};

/** Flow by world position, read across chunk borders so the current does not stop at a seam. */
export function createWaterFlowField(terrain:{ tileAtWorld(x:number, z:number):Tile | undefined }):WaterFlowField {
	return {
		sample: (x, z) => tileFlow(terrain.tileAtWorld(x, z)),
	};
}
