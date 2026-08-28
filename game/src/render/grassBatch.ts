import * as THREE from 'three';
import type { World } from '../engine/World';
import { CELL_SIZE, CHUNK_SIZE, TILE_HEIGHT } from '../world/constants';
import { getNature, grassLookMat, natureDepthMat, WIND_GRASS, GRASS_CLIP_MAX_Y, type NatureMaps } from './nature';

const PER_CELL = 7;
const BLADE_W = 2.15;
const BLADE_H = 0.55;

let host:THREE.Scene | null = null;
let batch:THREE.InstancedMesh | null = null;
let mask:THREE.DataTexture | null = null;
let bladeGeo:THREE.PlaneGeometry | null = null;
let stamp = '';
let capacity = 0;

function cellHash(x:number, z:number, salt:number):number {
	const n = Math.sin(x * 127.1 + z * 311.7 + salt * 74.7) * 43758.5453;
	return n - Math.floor(n);
}

function contentUV(map:THREE.Texture):{ u0:number; v0:number; u1:number; v1:number } {
	const uv = map.userData.contentUV as { u0:number; v0:number; u1:number; v1:number } | undefined;
	if (uv) {
		return uv;
	}
	return { u0: 0, v0: 0, u1: 1, v1: 1 };
}

function bladeGeometry(map:THREE.Texture):THREE.PlaneGeometry {
	if (bladeGeo) {
		return bladeGeo;
	}
	const geo = new THREE.PlaneGeometry(BLADE_W, BLADE_H);
	geo.translate(0, BLADE_H * 0.5 - 0.04, 0);
	const { u0, v0, u1, v1 } = contentUV(map);
	const uv = geo.getAttribute('uv');
	for (let i = 0; i < uv.count; i++) {
		uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
	}
	uv.needsUpdate = true;
	geo.userData.shared = true;
	bladeGeo = geo;
	return geo;
}

function chunkStamp(world:World):string {
	let s = '';
	for (const chunk of world.chunks.values()) {
		s += chunk.id;
		s += ';';
	}
	return s;
}

function worldClipMask(world:World):{
	tex:THREE.DataTexture;
	originX:number;
	originZ:number;
	sizeX:number;
	sizeZ:number;
} | null {
	let minCX = 0;
	let minCZ = 0;
	let maxCX = 0;
	let maxCZ = 0;
	let first = true;
	for (const chunk of world.chunks.values()) {
		if (first) {
			minCX = maxCX = chunk.origin.cx;
			minCZ = maxCZ = chunk.origin.cz;
			first = false;
		}
		else {
			minCX = Math.min(minCX, chunk.origin.cx);
			minCZ = Math.min(minCZ, chunk.origin.cz);
			maxCX = Math.max(maxCX, chunk.origin.cx);
			maxCZ = Math.max(maxCZ, chunk.origin.cz);
		}
	}
	if (first) {
		return null;
	}
	const tilesX = (maxCX - minCX + 1) * CHUNK_SIZE;
	const tilesZ = (maxCZ - minCZ + 1) * CHUNK_SIZE;
	const data = new Uint8Array(tilesX * tilesZ * 4);
	for (const chunk of world.chunks.values()) {
		const ox = (chunk.origin.cx - minCX) * CHUNK_SIZE;
		const oz = (chunk.origin.cz - minCZ) * CHUNK_SIZE;
		for (let lz = 0; lz < CHUNK_SIZE; lz++) {
			for (let lx = 0; lx < CHUNK_SIZE; lx++) {
				const tile = chunk.tile(lx, lz);
				const grass = tile?.def === 'grass';
				const keep = grass ? 255 : 0;
				let top = 0;
				if (!grass) {
					const h = (tile?.height ?? 0) * TILE_HEIGHT;
					top = h > 0.05
						? Math.max(1, Math.min(255, Math.round((h / GRASS_CLIP_MAX_Y) * 255)))
						: 255;
				}
				const i = ((oz + lz) * tilesX + (ox + lx)) * 4;
				data[i] = keep;
				data[i + 1] = top;
				data[i + 2] = keep;
				data[i + 3] = 255;
			}
		}
	}
	const tex = new THREE.DataTexture(data, tilesX, tilesZ);
	tex.minFilter = THREE.NearestFilter;
	tex.magFilter = THREE.NearestFilter;
	tex.wrapS = THREE.ClampToEdgeWrapping;
	tex.wrapT = THREE.ClampToEdgeWrapping;
	tex.flipY = false;
	tex.needsUpdate = true;
	return {
		tex,
		originX: minCX * CHUNK_SIZE * CELL_SIZE,
		originZ: minCZ * CHUNK_SIZE * CELL_SIZE,
		sizeX: tilesX * CELL_SIZE,
		sizeZ: tilesZ * CELL_SIZE,
	};
}

function bindClip(
	mesh:THREE.InstancedMesh,
	tex:THREE.DataTexture,
	originX:number,
	originZ:number,
	sizeX:number,
	sizeZ:number,
):void {
	mesh.userData.clipMask = tex;
	const bind = (mat:THREE.Material | THREE.Material[] | undefined):void => {
		if (!mat) {
			return;
		}
		const list = Array.isArray(mat) ? mat : [mat];
		for (const m of list) {
			if (!m.userData.uGrassClip) {
				continue;
			}
			(m.userData.uGrassClip as { value:THREE.Texture }).value = tex;
			(m.userData.uClipOrigin as { value:THREE.Vector2 }).value.set(originX, originZ);
			(m.userData.uClipSize as { value:THREE.Vector2 }).value.set(sizeX, sizeZ);
			if (m.userData.uClipMaxY) {
				(m.userData.uClipMaxY as { value:number }).value = GRASS_CLIP_MAX_Y;
			}
		}
	};
	bind(mesh.material);
	bind(mesh.customDepthMaterial);
}

function countBlades(world:World):number {
	let n = 0;
	for (const chunk of world.chunks.values()) {
		for (const tile of chunk.tiles) {
			if (tile.def === 'grass') {
				n += PER_CELL;
			}
		}
	}
	return n;
}

function fillInstances(mesh:THREE.InstancedMesh, world:World):number {
	const dummy = new THREE.Object3D();
	let n = 0;
	for (const chunk of world.chunks.values()) {
		const ox = chunk.worldOriginX();
		const oz = chunk.worldOriginZ();
		for (let lz = 0; lz < CHUNK_SIZE; lz++) {
			for (let lx = 0; lx < CHUNK_SIZE; lx++) {
				if (chunk.tile(lx, lz)?.def !== 'grass') {
					continue;
				}
				const gx = chunk.origin.cx * CHUNK_SIZE + lx;
				const gz = chunk.origin.cz * CHUNK_SIZE + lz;
				for (let t = 0; t < PER_CELL; t++) {
					const hx = cellHash(gx, gz, t * 3 + 1);
					const hz = cellHash(gx, gz, t * 3 + 2);
					const hs = cellHash(gx, gz, t * 3 + 3);
					dummy.position.set(
						ox + (lx + 0.08 + hx * 0.84) * CELL_SIZE,
						0,
						oz + (lz + 0.08 + hz * 0.84) * CELL_SIZE,
					);
					dummy.rotation.set(0, hs * Math.PI * 2, 0);
					const scl = 1.12 + hx * 0.38;
					dummy.scale.set(scl, 1.15 + hz * 0.3, scl);
					dummy.updateMatrix();
					mesh.setMatrixAt(n, dummy.matrix);
					n += 1;
				}
			}
		}
	}
	return n;
}

function dropBatch():void {
	if (batch && host) {
		host.remove(batch);
	}
	batch?.dispose();
	batch = null;
	mask?.dispose();
	mask = null;
	capacity = 0;
}

export function syncGrassBatch(scene:THREE.Scene, world:World):void {
	let nature:NatureMaps;
	try {
		nature = getNature();
	}
	catch {
		return;
	}
	const next = chunkStamp(world);
	if (next === stamp && batch) {
		return;
	}
	stamp = next;
	host = scene;
	const total = countBlades(world);
	if (total === 0) {
		dropBatch();
		return;
	}
	const clip = worldClipMask(world);
	if (!clip) {
		dropBatch();
		return;
	}
	if (!batch || capacity < total) {
		dropBatch();
		mask = clip.tex;
		const mat = grassLookMat(nature.blade, {
			alpha: true,
			wind: true,
			windAmount: WIND_GRASS,
			clipWater: true,
		});
		const depth = natureDepthMat(nature.blade, {
			wind: true,
			windAmount: WIND_GRASS,
			clipWater: true,
		});
		batch = new THREE.InstancedMesh(bladeGeometry(nature.blade), mat, total);
		batch.name = 'grassBlades';
		batch.castShadow = false;
		batch.receiveShadow = true;
		batch.customDepthMaterial = depth;
		batch.frustumCulled = false;
		capacity = total;
		host = scene;
	}
	else {
		mask?.dispose();
		mask = clip.tex;
	}
	if (!batch) {
		return;
	}
	const n = fillInstances(batch, world);
	batch.count = n;
	batch.instanceMatrix.needsUpdate = true;
	bindClip(batch, clip.tex, clip.originX, clip.originZ, clip.sizeX, clip.sizeZ);
	if (!batch.parent) {
		scene.add(batch);
	}
}

export function disposeGrassBatch():void {
	dropBatch();
	bladeGeo?.dispose();
	bladeGeo = null;
	stamp = '';
	host = null;
}

if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		disposeGrassBatch();
	});
}
