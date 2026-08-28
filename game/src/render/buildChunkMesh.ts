import * as THREE from 'three';
import { CELL_SIZE, CHUNK_SIZE, TILE_HEIGHT, WALL_HEIGHT } from '../world/constants';
import type { Chunk } from '../world/Chunk';
import {
	applyWorldBrickUVs,
	insetBoxTopUVs,
	insetPlaneUVs,
	rockFlip,
	rockRunVariant,
	rockVariant,
} from './rocksAtlas';
import { getSheet, tileMaterial } from './spritesheet';
import type { SpriteMaps } from './spritesheet';
import { getNature, grassLookMat, natureMat, toonWaterMat, GRASS_UV_REP, GRASS_Y, WATER_LOWER_Y, WATER_UPPER_Y } from './nature';
import { boulderMat, rockGeometry } from './natureMeshes';
import { createWaterFlowField, type Flow } from './waterFlow';
import { attachChunkAo } from './bakeAo';

const FLOOR_SALT = 11;
const WALL_SALT = 29;
const STAIR_SALT = 47;
export const CHUNK_MESH_REV = 66;

function cellX(chunk:Chunk, lx:number):number {
	return chunk.origin.cx * CHUNK_SIZE + lx;
}

function cellZ(chunk:Chunk, lz:number):number {
	return chunk.origin.cz * CHUNK_SIZE + lz;
}

function mapsToMat(maps:SpriteMaps, extras:THREE.MeshStandardMaterialParameters = {}):THREE.MeshStandardMaterial {
	return tileMaterial(maps.map, {
		normalMap: maps.nrm,
		normalScale: new THREE.Vector2(1.85, 1.85),
		...extras,
	});
}

function stairUphill(chunk:Chunk, lx:number, lz:number):{ dx:number; dz:number } {
	const self = chunk.tile(lx, lz);
	const dirs = [
		{ dx: 0, dz: -1 },
		{ dx: 0, dz: 1 },
		{ dx: 1, dz: 0 },
		{ dx: -1, dz: 0 },
	];
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
		if (n?.def === 'stairs') {
			return d;
		}
	}
	for (const d of dirs) {
		const n = chunk.tile(lx + d.dx, lz + d.dz);
		if (n && !n.blocked && n.height < self.height) {
			return { dx: -d.dx, dz: -d.dz };
		}
	}
	return { dx: 0, dz: -1 };
}

function addStairs(group:THREE.Group, chunk:Chunk, wallMats:THREE.Material[]):void {
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const steps = 4;
	const stepLen = CELL_SIZE / steps;
	const geoms = new Map<string, THREE.BoxGeometry>();
	const geomAt = (sx:number, sy:number, sz:number):THREE.BoxGeometry => {
		const key = `${sx},${sy},${sz}`;
		let geom = geoms.get(key);
		if (!geom) {
			geom = new THREE.BoxGeometry(sx, sy, sz);
			geoms.set(key, geom);
		}
		return geom;
	};

	for (let lz = 0; lz < CHUNK_SIZE; lz++) {
		for (let lx = 0; lx < CHUNK_SIZE; lx++) {
			const tile = chunk.tile(lx, lz);
			if (!tile || tile.def !== 'stairs') {
				continue;
			}
			const uphill = stairUphill(chunk, lx, lz);
			const top = tile.height * TILE_HEIGHT;
			const alongZ = uphill.dx === 0;
			const variant = rockRunVariant(cellX(chunk, lx), cellZ(chunk, lz), STAIR_SALT, wallMats.length);
			const mat = wallMats[variant];
			for (let i = 0; i < steps; i++) {
				const h = ((i + 1) / steps) * top;
				const sx = alongZ ? CELL_SIZE : stepLen;
				const sz = alongZ ? stepLen : CELL_SIZE;
				const mesh = new THREE.Mesh(geomAt(sx, h, sz), mat);
				mesh.castShadow = true;
				mesh.receiveShadow = true;
				let x = ox + (lx + 0.5) * CELL_SIZE;
				let z = oz + (lz + 0.5) * CELL_SIZE;
				const along = uphill.dx + uphill.dz < 0
					? CELL_SIZE - (i + 0.5) * stepLen
					: (i + 0.5) * stepLen;
				if (alongZ) {
					z = oz + lz * CELL_SIZE + along;
				}
				else {
					x = ox + lx * CELL_SIZE + along;
				}
				mesh.position.set(x, h * 0.5, z);
				group.add(mesh);
			}
		}
	}
}

function addFlatFloors(
	group:THREE.Group,
	chunk:Chunk,
	mats:THREE.Material[],
	geom:THREE.BufferGeometry,
	geomFlip:THREE.BufferGeometry,
):void {
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const n = mats.length;
	const dummy = new THREE.Object3D();
	type Cell = { lx:number; lz:number };
	const buckets:Cell[][] = [];
	for (let i = 0; i < n * 2; i++) {
		buckets.push([]);
	}
	for (let lz = 0; lz < CHUNK_SIZE; lz++) {
		for (let lx = 0; lx < CHUNK_SIZE; lx++) {
			const tile = chunk.tile(lx, lz);
			if (!tile || tile.blocked || tile.def === 'stairs' || tile.height > 0) {
				continue;
			}
			if (tile.def === 'grass' || tile.def === 'water') {
				continue;
			}
			const gx = cellX(chunk, lx);
			const gz = cellZ(chunk, lz);
			const v = rockVariant(gx, gz, FLOOR_SALT, n);
			const flip = rockFlip(gx, gz, FLOOR_SALT) ? 1 : 0;
			buckets[v * 2 + flip].push({ lx, lz });
		}
	}
	for (let b = 0; b < buckets.length; b++) {
		const cells = buckets[b];
		if (cells.length === 0) {
			continue;
		}
		const v = (b / 2) | 0;
		const flipped = (b & 1) === 1;
		const mesh = new THREE.InstancedMesh(flipped ? geomFlip : geom, mats[v], cells.length);
		mesh.receiveShadow = true;
		mesh.castShadow = false;
		for (let i = 0; i < cells.length; i++) {
			const { lx, lz } = cells[i];
			dummy.position.set(
				ox + (lx + 0.5) * CELL_SIZE,
				0.002,
				oz + (lz + 0.5) * CELL_SIZE,
			);
			dummy.rotation.set(-Math.PI / 2, 0, 0);
			dummy.scale.set(1, 1, 1);
			dummy.updateMatrix();
			mesh.setMatrixAt(i, dummy.matrix);
		}
		mesh.instanceMatrix.needsUpdate = true;
		group.add(mesh);
	}
}

function addRaisedFloors(
	group:THREE.Group,
	chunk:Chunk,
	floorMats:THREE.Material[],
	wallMats:THREE.Material[],
):void {
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const geoms = new Map<number, THREE.BoxGeometry>();
	for (let lz = 0; lz < CHUNK_SIZE; lz++) {
		for (let lx = 0; lx < CHUNK_SIZE; lx++) {
			const tile = chunk.tile(lx, lz);
			if (!tile || tile.blocked || tile.def === 'stairs' || tile.height <= 0) {
				continue;
			}
			const h = tile.height * TILE_HEIGHT;
			let geom = geoms.get(h);
			if (!geom) {
				geom = new THREE.BoxGeometry(CELL_SIZE, h, CELL_SIZE);
				insetBoxTopUVs(geom);
				geoms.set(h, geom);
			}
			const gx = cellX(chunk, lx);
			const gz = cellZ(chunk, lz);
			const floorMat = floorMats[rockVariant(gx, gz, FLOOR_SALT, floorMats.length)];
			const wallMat = wallMats[rockRunVariant(gx, gz, WALL_SALT, wallMats.length)];
			const mesh = new THREE.Mesh(geom, [
				wallMat,
				wallMat,
				floorMat,
				floorMat,
				wallMat,
				wallMat,
			]);
			mesh.receiveShadow = true;
			mesh.castShadow = true;
			mesh.position.set(
				ox + (lx + 0.5) * CELL_SIZE,
				h * 0.5,
				oz + (lz + 0.5) * CELL_SIZE,
			);
			group.add(mesh);
		}
	}
}

function addWalls(group:THREE.Group, chunk:Chunk, mats:THREE.Material[]):void {
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const n = mats.length;
	const dummy = new THREE.Object3D();
	const geom = new THREE.BoxGeometry(CELL_SIZE, WALL_HEIGHT, CELL_SIZE);
	const buckets:{ lx:number; lz:number }[][] = [];
	for (let i = 0; i < n; i++) {
		buckets.push([]);
	}
	for (let lz = 0; lz < CHUNK_SIZE; lz++) {
		for (let lx = 0; lx < CHUNK_SIZE; lx++) {
			if (!chunk.tile(lx, lz)?.blocked) {
				continue;
			}
			if (chunk.tile(lx, lz)?.def === 'water' || chunk.tile(lx, lz)?.def === 'wood_wall') {
				continue;
			}
			const v = rockRunVariant(cellX(chunk, lx), cellZ(chunk, lz), WALL_SALT, n);
			buckets[v].push({ lx, lz });
		}
	}
	for (let v = 0; v < n; v++) {
		const cells = buckets[v];
		if (cells.length === 0) {
			continue;
		}
		const mesh = new THREE.InstancedMesh(geom, mats[v], cells.length);
		mesh.receiveShadow = true;
		mesh.castShadow = true;
		for (let i = 0; i < cells.length; i++) {
			const { lx, lz } = cells[i];
			dummy.position.set(
				ox + (lx + 0.5) * CELL_SIZE,
				WALL_HEIGHT * 0.5,
				oz + (lz + 0.5) * CELL_SIZE,
			);
			dummy.rotation.set(0, 0, 0);
			dummy.scale.set(1, 1, 1);
			dummy.updateMatrix();
			mesh.setMatrixAt(i, dummy.matrix);
		}
		mesh.instanceMatrix.needsUpdate = true;
		group.add(mesh);
	}
}

function addWoodWalls(group:THREE.Group, chunk:Chunk):void {
	let nature;
	try {
		nature = getNature();
	}
	catch {
		return;
	}
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const mat = new THREE.MeshStandardMaterial({
		map: nature.wood,
		roughness: 0.92,
		metalness: 0,
		side: THREE.FrontSide,
		shadowSide: THREE.DoubleSide,
	});
	const geom = new THREE.BoxGeometry(CELL_SIZE * 1.04, WALL_HEIGHT, CELL_SIZE * 1.04);
	for (let lz = 0; lz < CHUNK_SIZE; lz++) {
		for (let lx = 0; lx < CHUNK_SIZE; lx++) {
			if (chunk.tile(lx, lz)?.def !== 'wood_wall') {
				continue;
			}
			const mesh = new THREE.Mesh(geom, mat);
			mesh.position.set(
				ox + (lx + 0.5) * CELL_SIZE,
				WALL_HEIGHT * 0.5,
				oz + (lz + 0.5) * CELL_SIZE,
			);
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			group.add(mesh);
		}
	}
}

function addPlankFloors(group:THREE.Group, chunk:Chunk):void {
	let nature;
	try {
		nature = getNature();
	}
	catch {
		return;
	}
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const mat = natureMat(nature.wood);
	const geom = new THREE.PlaneGeometry(CELL_SIZE, CELL_SIZE);
	const dummy = new THREE.Object3D();
	const cells:{ lx:number; lz:number }[] = [];
	for (let lz = 0; lz < CHUNK_SIZE; lz++) {
		for (let lx = 0; lx < CHUNK_SIZE; lx++) {
			if (chunk.tile(lx, lz)?.def === 'plank') {
				cells.push({ lx, lz });
			}
		}
	}
	if (cells.length === 0) {
		return;
	}
	const mesh = new THREE.InstancedMesh(geom, mat, cells.length);
	mesh.receiveShadow = true;
	for (let i = 0; i < cells.length; i++) {
		const { lx, lz } = cells[i];
		dummy.position.set(
			ox + (lx + 0.5) * CELL_SIZE,
			0.03,
			oz + (lz + 0.5) * CELL_SIZE,
		);
		dummy.rotation.set(-Math.PI / 2, 0, 0);
		dummy.scale.set(1, 1, 1);
		dummy.updateMatrix();
		mesh.setMatrixAt(i, dummy.matrix);
	}
	mesh.instanceMatrix.needsUpdate = true;
	group.add(mesh);
}

function cellHash(x:number, z:number, salt:number):number {
	const n = Math.sin(x * 127.1 + z * 311.7 + salt * 74.7) * 43758.5453;
	return n - Math.floor(n);
}

type YBuf = { pos:number[]; nrm:number[]; uv:number[]; flow:number[]; shore:number[]; idx:number[]; v:number };

function makeYBuf():YBuf {
	return { pos: [], nrm: [], uv: [], flow: [], shore: [], idx: [], v: 0 };
}

function pushYTri(
	buf:YBuf,
	ax:number,
	az:number,
	bx:number,
	bz:number,
	cx:number,
	cz:number,
	y:number,
	rep:number,
	fa?:Flow,
	fb?:Flow,
	fc?:Flow,
	sa?:number,
	sb?:number,
	sc?:number,
):void {
	buf.pos.push(ax, y, az, bx, y, bz, cx, y, cz);
	buf.nrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
	buf.uv.push(ax / rep, az / rep, bx / rep, bz / rep, cx / rep, cz / rep);
	if (fa && fb && fc) {
		buf.flow.push(fa.x, fa.z, fb.x, fb.z, fc.x, fc.z);
	}
	if (sa !== undefined && sb !== undefined && sc !== undefined) {
		buf.shore.push(sa, sb, sc);
	}
	buf.idx.push(buf.v, buf.v + 1, buf.v + 2);
	buf.v += 3;
}

function pushYPoly(
	buf:YBuf,
	pts:{ x:number; z:number }[],
	y:number,
	rep:number,
	flowAt?:(x:number, z:number) => Flow,
	shoreAt?:(x:number, z:number) => number,
):void {
	if (pts.length < 3) {
		return;
	}
	const at = (x:number, z:number):Flow | undefined => flowAt?.(x, z);
	const sh = (x:number, z:number):number | undefined => shoreAt?.(x, z);
	if (pts.length === 3) {
		pushYTri(
			buf,
			pts[0].x,
			pts[0].z,
			pts[1].x,
			pts[1].z,
			pts[2].x,
			pts[2].z,
			y,
			rep,
			at(pts[0].x, pts[0].z),
			at(pts[1].x, pts[1].z),
			at(pts[2].x, pts[2].z),
			sh(pts[0].x, pts[0].z),
			sh(pts[1].x, pts[1].z),
			sh(pts[2].x, pts[2].z),
		);
		return;
	}
	const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
	const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
	for (let i = 0; i < pts.length; i++) {
		const a = pts[i];
		const b = pts[(i + 1) % pts.length];
		pushYTri(buf, cx, cz, b.x, b.z, a.x, a.z, y, rep, at(cx, cz), at(b.x, b.z), at(a.x, a.z), sh(cx, cz), sh(b.x, b.z), sh(a.x, a.z));
	}
}

function finishYMesh(buf:YBuf, mat:THREE.Material, shadows:boolean):THREE.Mesh {
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
	geo.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nrm, 3));
	geo.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
	if (buf.flow.length === buf.v * 2) {
		geo.setAttribute('flow', new THREE.Float32BufferAttribute(buf.flow, 2));
	}
	if (buf.shore.length === buf.v) {
		geo.setAttribute('shore', new THREE.Float32BufferAttribute(buf.shore, 1));
	}
	geo.setIndex(buf.idx);
	const mesh = new THREE.Mesh(geo, mat);
	mesh.receiveShadow = shadows;
	return mesh;
}

function isWater(chunk:Chunk, lx:number, lz:number):boolean {
	return chunk.tile(lx, lz)?.def === 'water';
}

function isWaterWorld(chunk:Chunk, x:number, z:number):boolean {
	return chunk.tileAtWorld(x, z)?.def === 'water';
}

function shoreAmt(chunk:Chunk, x:number, z:number):number {
	let land = 0;
	let n = 0;
	for (const dx of [-0.42, -0.18, 0, 0.18, 0.42]) {
		for (const dz of [-0.42, -0.18, 0, 0.18, 0.42]) {
			n += 1;
			if (!isWaterWorld(chunk, x + dx, z + dz)) {
				land += 1;
			}
		}
	}
	return land / n;
}

function grassOutline(
	chunk:Chunk,
	lx:number,
	lz:number,
	x0:number,
	z0:number,
	x1:number,
	z1:number,
):{ x:number; z:number }[] {
	const cut = CELL_SIZE * 0.52;
	const n = isWater(chunk, lx, lz - 1);
	const s = isWater(chunk, lx, lz + 1);
	const e = isWater(chunk, lx + 1, lz);
	const w = isWater(chunk, lx - 1, lz);
	const pts:{ x:number; z:number }[] = [];
	if (n && w) {
		pts.push({ x: x0, z: z0 + cut }, { x: x0 + cut, z: z0 });
	}
	else {
		pts.push({ x: x0, z: z0 });
	}
	if (n && e) {
		pts.push({ x: x1 - cut, z: z0 }, { x: x1, z: z0 + cut });
	}
	else {
		pts.push({ x: x1, z: z0 });
	}
	if (s && e) {
		pts.push({ x: x1, z: z1 - cut }, { x: x1 - cut, z: z1 });
	}
	else {
		pts.push({ x: x1, z: z1 });
	}
	if (s && w) {
		pts.push({ x: x0 + cut, z: z1 }, { x: x0, z: z1 - cut });
	}
	else {
		pts.push({ x: x0, z: z1 });
	}
	return pts;
}

function addGrassFloor(
	group:THREE.Group,
	chunk:Chunk,
	cells:{ lx:number; lz:number }[],
	mat:THREE.Material,
):void {
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const buf = makeYBuf();
	const y = GRASS_Y;
	const rep = GRASS_UV_REP;
	for (const { lx, lz } of cells) {
		const x0 = ox + lx * CELL_SIZE;
		const z0 = oz + lz * CELL_SIZE;
		const pts = grassOutline(chunk, lx, lz, x0, z0, x0 + CELL_SIZE, z0 + CELL_SIZE);
		if (pts.length === 4) {
			// Outline is NW,NE,SE,SW. CCW from +Y so Lambert/sun hit the top face.
			pushYTri(buf, pts[0].x, pts[0].z, pts[2].x, pts[2].z, pts[1].x, pts[1].z, y, rep);
			pushYTri(buf, pts[0].x, pts[0].z, pts[3].x, pts[3].z, pts[2].x, pts[2].z, y, rep);
		}
		else {
			pushYPoly(buf, pts, y, rep);
		}
	}
	group.add(finishYMesh(buf, mat, true));
}

function addBankRocks(group:THREE.Group, chunk:Chunk, cells:{ lx:number; lz:number }[], nature:ReturnType<typeof getNature>):void {
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const dummy = new THREE.Object3D();
	const max = cells.length * 4;
	const mesh = new THREE.InstancedMesh(rockGeometry(), boulderMat(nature.boulder), max);
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	mesh.frustumCulled = false;
	let n = 0;
	const dirs = [
		{ dx: 0, dz: -1 },
		{ dx: 0, dz: 1 },
		{ dx: -1, dz: 0 },
		{ dx: 1, dz: 0 },
	];
	const falls = new Set(
		chunk.entities.filter((e) => e.def === 'waterfall').map((e) => `${e.localX},${e.localZ}`),
	);
	for (const { lx, lz } of cells) {
		if (falls.has(`${lx},${lz}`)) {
			continue;
		}
		const gx = cellX(chunk, lx);
		const gz = cellZ(chunk, lz);
		const banks = dirs.filter((d) => chunk.tile(lx + d.dx, lz + d.dz)?.def === 'grass');
		let count = 0;
		if (banks.length > 0) {
			count = 1 + (cellHash(gx, gz, 5) > 0.45 ? 1 : 0);
		}
		else {
			count = 0;
		}
		for (let i = 0; i < count && n < max; i++) {
			const d = banks[Math.floor(cellHash(gx, gz, 17 + i * 4) * banks.length) % banks.length];
			const along = 0.16 + cellHash(gx, gz, 23 + i * 7) * 0.68;
			const ontoGrass = 0.32 + cellHash(gx, gz, 29 + i * 13) * 0.22;
			const glx = lx + d.dx;
			const glz = lz + d.dz;
			const u = d.dx === 0 ? along : (d.dx > 0 ? ontoGrass : 1 - ontoGrass);
			const v = d.dz === 0 ? along : (d.dz > 0 ? ontoGrass : 1 - ontoGrass);
			const x = ox + (glx + u) * CELL_SIZE;
			const z = oz + (glz + v) * CELL_SIZE;
			const yaw = cellHash(gx, gz, 83 + i) * Math.PI * 2;
			const scl = 0.68 + cellHash(gx, gz, 97 + i * 3) * 0.42;
			dummy.position.set(x, GRASS_Y, z);
			dummy.rotation.set(0, yaw, 0);
			dummy.scale.setScalar(scl);
			dummy.updateMatrix();
			mesh.setMatrixAt(n, dummy.matrix);
			n += 1;
		}
	}
	if (n === 0) {
		mesh.dispose();
		return;
	}
	mesh.count = n;
	mesh.instanceMatrix.needsUpdate = true;
	group.add(mesh);
}

function fillWaterSheet(
	buf:YBuf,
	chunk:Chunk,
	cells:{ lx:number; lz:number }[],
	y:number,
	flowAt:(x:number, z:number) => Flow,
	shoreAt:(x:number, z:number) => number,
):void {
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const cut = CELL_SIZE * 0.82;
	const waterRep = 1;
	const div = 4;
	for (const { lx, lz } of cells) {
		const x0 = ox + lx * CELL_SIZE;
		const z0 = oz + lz * CELL_SIZE;
		const x1 = x0 + CELL_SIZE;
		const z1 = z0 + CELL_SIZE;
		const cellF = flowAt(x0 + CELL_SIZE * 0.5, z0 + CELL_SIZE * 0.5);
		for (let iz = 0; iz < div; iz++) {
			for (let ix = 0; ix < div; ix++) {
				const xa = x0 + (x1 - x0) * (ix / div);
				const xb = x0 + (x1 - x0) * ((ix + 1) / div);
				const za = z0 + (z1 - z0) * (iz / div);
				const zb = z0 + (z1 - z0) * ((iz + 1) / div);
				const quad = [{ x: xa, z: za }, { x: xb, z: za }, { x: xb, z: zb }, { x: xa, z: zb }];
				pushYPoly(buf, quad, y, waterRep, (_x, _z) => cellF, shoreAt);
			}
		}
	}
	for (let lz = 0; lz < CHUNK_SIZE; lz++) {
		for (let lx = 0; lx < CHUNK_SIZE; lx++) {
			if (chunk.tile(lx, lz)?.def !== 'grass') {
				continue;
			}
			const x0 = ox + lx * CELL_SIZE;
			const z0 = oz + lz * CELL_SIZE;
			const x1 = x0 + CELL_SIZE;
			const z1 = z0 + CELL_SIZE;
			const n = isWater(chunk, lx, lz - 1);
			const s = isWater(chunk, lx, lz + 1);
			const e = isWater(chunk, lx + 1, lz);
			const w = isWater(chunk, lx - 1, lz);
			const nF = n ? flowAt(x0 + CELL_SIZE * 0.5, z0 - CELL_SIZE * 0.5) : undefined;
			const sF = s ? flowAt(x0 + CELL_SIZE * 0.5, z1 + CELL_SIZE * 0.5) : undefined;
			const eF = e ? flowAt(x1 + CELL_SIZE * 0.5, z0 + CELL_SIZE * 0.5) : undefined;
			const wF = w ? flowAt(x0 - CELL_SIZE * 0.5, z0 + CELL_SIZE * 0.5) : undefined;
			const cornerFlow = (a?:Flow, b?:Flow):Flow => a ?? b ?? { x: 0, z: 0 };
			const pushCorner = (pts:[number, number][], f:Flow):void => {
				pushYTri(
					buf,
					pts[0][0],
					pts[0][1],
					pts[1][0],
					pts[1][1],
					pts[2][0],
					pts[2][1],
					y,
					waterRep,
					f,
					f,
					f,
					shoreAt(pts[0][0], pts[0][1]),
					shoreAt(pts[1][0], pts[1][1]),
					shoreAt(pts[2][0], pts[2][1]),
				);
			};
			if (n && w) {
				pushCorner([[x0, z0], [x0 + cut, z0], [x0, z0 + cut]], cornerFlow(nF, wF));
			}
			if (n && e) {
				pushCorner([[x1, z0], [x1 - cut, z0], [x1, z0 + cut]], cornerFlow(nF, eF));
			}
			if (s && e) {
				pushCorner([[x1, z1], [x1, z1 - cut], [x1 - cut, z1]], cornerFlow(sF, eF));
			}
			if (s && w) {
				pushCorner([[x0, z1], [x0 + cut, z1], [x0, z1 - cut]], cornerFlow(sF, wF));
			}
		}
	}
}

function addWater(group:THREE.Group, chunk:Chunk, cells:{ lx:number; lz:number }[], nature:ReturnType<typeof getNature>):void {
	const field = createWaterFlowField(chunk);
	const flowAt = (x:number, z:number):Flow => field.sample(x, z);
	const shoreAt = (x:number, z:number):number => shoreAmt(chunk, x, z);
	const lower = makeYBuf();
	const upper = makeYBuf();
	fillWaterSheet(lower, chunk, cells, WATER_LOWER_Y, flowAt, shoreAt);
	fillWaterSheet(upper, chunk, cells, WATER_UPPER_Y, flowAt, shoreAt);
	group.add(finishYMesh(lower, toonWaterMat(nature.water, 'lower'), true));
	group.add(finishYMesh(upper, toonWaterMat(nature.water, 'upper'), true));
	addBankRocks(group, chunk, cells, nature);
}

function addGrassAndWater(group:THREE.Group, chunk:Chunk):void {
	let nature;
	try {
		nature = getNature();
	}
	catch {
		return;
	}
	const grassCells:{ lx:number; lz:number }[] = [];
	const waterCells:{ lx:number; lz:number }[] = [];
	for (let lz = 0; lz < CHUNK_SIZE; lz++) {
		for (let lx = 0; lx < CHUNK_SIZE; lx++) {
			const tile = chunk.tile(lx, lz);
			if (tile?.def === 'grass') {
				grassCells.push({ lx, lz });
			}
			else if (tile?.def === 'water') {
				waterCells.push({ lx, lz });
			}
		}
	}
	if (grassCells.length > 0) {
		addGrassFloor(group, chunk, grassCells, grassLookMat(nature.grass));
	}
	if (waterCells.length > 0) {
		addWater(group, chunk, waterCells, nature);
	}
}

export function buildChunkMesh(chunk:Chunk):THREE.Group {
	const group = new THREE.Group();
	group.name = `chunk_${chunk.id}`;
	const sheet = getSheet();
	const floorMats = sheet.floorTiles.map((m) => mapsToMat(m, {
		polygonOffset: true,
		polygonOffsetFactor: 1,
		polygonOffsetUnits: 1,
	}));
	const wallMats = sheet.wallTiles.map((m) => {
		const mat = mapsToMat(m);
		applyWorldBrickUVs(mat);
		return mat;
	});

	const floorGeom = new THREE.PlaneGeometry(CELL_SIZE, CELL_SIZE);
	insetPlaneUVs(floorGeom);
	const floorGeomFlip = floorGeom.clone();
	const uv = floorGeomFlip.getAttribute('uv');
	for (let i = 0; i < uv.count; i++) {
		uv.setX(i, 1 - uv.getX(i));
	}
	uv.needsUpdate = true;

	addFlatFloors(group, chunk, floorMats, floorGeom, floorGeomFlip);
	addRaisedFloors(group, chunk, floorMats, wallMats);
	addWalls(group, chunk, wallMats);
	addWoodWalls(group, chunk);
	addPlankFloors(group, chunk);
	addStairs(group, chunk, wallMats);
	addGrassAndWater(group, chunk);
	attachChunkAo(group, chunk);

	return group;
}
