import { hash } from '@arc-director/kindling';
import * as THREE from 'three';
import { CELL_SIZE, CHUNK_SIZE } from '../world/constants';
import type { Chunk } from '../world/Chunk';
import { propParts } from './props';
import { planProps } from '../world/dressingPlan';
import { treeParts } from './trees';

export type DressingDraw = {
	geom:THREE.BufferGeometry;
	mat:THREE.Material;
	cast:boolean;
	x:number;
	y:number;
	z:number;
	rx:number;
	ry:number;
	rz:number;
	sx:number;
	sy:number;
	sz:number;
};


function inChunk(chunk:Chunk, x:number, z:number):boolean {
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const size = CHUNK_SIZE * CELL_SIZE;
	return x >= ox && x < ox + size && z >= oz && z < oz + size;
}

function drawOf(
	geom:THREE.BufferGeometry,
	mat:THREE.Material,
	x:number,
	y:number,
	z:number,
	rx = 0,
	ry = 0,
	rz = 0,
	sx = 1,
	sy = 1,
	sz = 1,
	cast = true,
):DressingDraw {
	return { geom, mat, cast, x, y, z, rx, ry, rz, sx, sy, sz };
}

/** Instanced draws for this chunk: props and trees. The road is part of the ground mesh; grass blades are `grassBatch`. */
export function dressingDraws(chunk:Chunk, chunks:Iterable<Chunk>):DressingDraw[] {
	const list = [...chunks];
	const draws:DressingDraw[] = [];
	for (const spot of planProps(list)) {
		if (!inChunk(chunk, spot.x, spot.z)) {
			continue;
		}
		const cos = Math.cos(spot.yaw);
		const sin = Math.sin(spot.yaw);
		for (const part of propParts(spot.prop)) {
			// Same turn as the mesh rotation below (Three.js yaw about +Y).
			const lx = part.x * cos + part.z * sin;
			const lz = -part.x * sin + part.z * cos;
			draws.push(drawOf(
				part.geom,
				part.mat,
				spot.x + lx,
				spot.y + part.y,
				spot.z + lz,
				part.rx,
				spot.yaw + part.ry,
				part.rz,
				1,
				1,
				1,
				part.cast,
			));
		}
	}
	for (const ent of chunk.entities) {
		if (ent.def !== 'tree') {
			continue;
		}
		const center = chunk.worldCellCenter(ent.localX, ent.localZ);
		const kind = (ent.localX + ent.localZ) % 2 === 0 ? 'oak' : 'pine';
		const variant = Math.floor(hash(center.x, center.z, 13) * 8);
		const s = 0.88 + hash(center.x, center.z, 9) * 0.28;
		const x = center.x + (hash(center.x, center.z, 11) - 0.5) * 0.2;
		const z = center.z + (hash(center.x, center.z, 12) - 0.5) * 0.2;
		const yaw = hash(center.x, center.z, 14) * Math.PI * 2;
		for (const part of treeParts(kind, variant)) {
			draws.push(drawOf(part.geom, part.mat, x, 0, z, 0, yaw, 0, s, s, s));
		}
	}
	return draws;
}
