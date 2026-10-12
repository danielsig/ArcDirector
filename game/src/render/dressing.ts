import * as THREE from 'three';
import { CELL_SIZE, CHUNK_SIZE } from '../world/constants';
import type { Chunk } from '../world/Chunk';
import { dirtMat } from './toon';
import { propParts } from './props';
import { findDoor, planProps, roadCells } from '../world/dressingPlan';
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


const roadGeo = new THREE.PlaneGeometry(0.92, CELL_SIZE + 0.04);
roadGeo.userData.shared = true;

function hash01(x:number, z:number, salt:number):number {
	const n = Math.sin(x * 127.1 + z * 311.7 + salt * 74.7) * 43758.5453;
	return n - Math.floor(n);
}

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

/** Instanced draws for this chunk: props, the dirt path, and trees. Grass blades are `grassBatch`. */
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
	const door = findDoor(list);
	const road = door ? roadCells(list, door) : [];
	const roadHere = road.filter((cell) => inChunk(chunk, cell.x, cell.z));
	const dirt = dirtMat();
	for (const cell of roadHere) {
		// Lay each tile along its run; a corner fills the whole cell.
		const i = road.indexOf(cell);
		const prev = road[i - 1] ?? (door ? { x: door.x, z: door.z } : cell);
		const next = road[i + 1] ?? cell;
		const inX = prev.x !== cell.x || (next.x !== cell.x && prev.z === cell.z);
		const corner = (prev.x !== cell.x) !== (next.x !== cell.x) && road[i + 1] !== undefined;
		const width = corner ? (CELL_SIZE + 0.04) / 0.92 : 1;
		draws.push(drawOf(roadGeo, dirt, cell.x, 0.03, cell.z, -Math.PI / 2, inX ? Math.PI / 2 : 0, 0, width, 1, 1, false));
	}
	for (const ent of chunk.entities) {
		if (ent.def !== 'tree') {
			continue;
		}
		const center = chunk.worldCellCenter(ent.localX, ent.localZ);
		const kind = (ent.localX + ent.localZ) % 2 === 0 ? 'oak' : 'pine';
		const variant = Math.floor(hash01(center.x, center.z, 13) * 8);
		const s = 0.88 + hash01(center.x, center.z, 9) * 0.28;
		const x = center.x + (hash01(center.x, center.z, 11) - 0.5) * 0.2;
		const z = center.z + (hash01(center.x, center.z, 12) - 0.5) * 0.2;
		const yaw = hash01(center.x, center.z, 14) * Math.PI * 2;
		for (const part of treeParts(kind, variant)) {
			draws.push(drawOf(part.geom, part.mat, x, 0, z, 0, yaw, 0, s, s, s));
		}
	}
	return draws;
}
