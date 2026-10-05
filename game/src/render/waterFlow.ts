import type { Chunk, Tile } from '../world/Chunk';

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
	return tile?.def === 'water' && tile.flow ? norm(tile.flow) : ZERO;
}

export type WaterFlowField = {
	sample(x:number, z:number):Flow;
};

export function createWaterFlowField(chunk:Chunk):WaterFlowField {
	const cells = chunk.tiles.map(tileFlow);
	return {
		sample(x, z) {
			const { localX, localZ } = chunk.worldToLocal(x, z);
			return chunk.tile(localX, localZ) ? cells[localZ * chunk.size + localX] : ZERO;
		},
	};
}
