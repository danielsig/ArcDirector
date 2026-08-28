import { CELL_SIZE, CHUNK_SIZE } from '../world/constants';
import type { Chunk } from '../world/Chunk';

export type Flow = { x:number; z:number };

const ZERO:Flow = { x: 0, z: 0 };

function mag(f:Flow):number {
	return Math.hypot(f.x, f.z);
}

function norm(f:Flow):Flow {
	const m = mag(f);
	if (m < 1e-5) {
		return ZERO;
	}
	return { x: f.x / m, z: f.z / m };
}

function glyphAt(chunk:Chunk, lx:number, lz:number):Flow {
	const tile = chunk.tile(lx, lz);
	if (!tile || tile.def !== 'water' || !tile.flow) {
		return ZERO;
	}
	return tile.flow;
}

function isWater(chunk:Chunk, lx:number, lz:number):boolean {
	return chunk.tile(lx, lz)?.def === 'water';
}

/** This tile's glyph only. Still water stays still; current does not leak into the pond. */
function cellFlow(chunk:Chunk, lx:number, lz:number):Flow {
	if (!isWater(chunk, lx, lz)) {
		return ZERO;
	}
	return norm(glyphAt(chunk, lx, lz));
}

export type WaterFlowField = {
	sample(x:number, z:number):Flow;
	atCell(lx:number, lz:number):Flow;
};

export function createWaterFlowField(chunk:Chunk):WaterFlowField {
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const cells:Flow[] = [];
	for (let lz = 0; lz < CHUNK_SIZE; lz++) {
		for (let lx = 0; lx < CHUNK_SIZE; lx++) {
			cells.push(cellFlow(chunk, lx, lz));
		}
	}

	function cellSample(lx:number, lz:number):Flow {
		if (lx < 0 || lz < 0 || lx >= CHUNK_SIZE || lz >= CHUNK_SIZE) {
			return ZERO;
		}
		return cells[lz * CHUNK_SIZE + lx];
	}

	return {
		sample(x, z) {
			const lx = Math.floor((x - ox) / CELL_SIZE);
			const lz = Math.floor((z - oz) / CELL_SIZE);
			return cellSample(lx, lz);
		},
		atCell(lx, lz) {
			return cellSample(lx, lz);
		},
	};
}
