import * as THREE from 'three';
import { patchShader } from '@arc-director/kindling';
import { CELL_SIZE, CHUNK_SIZE } from '../world/constants';
import type { Chunk } from '../world/Chunk';
import { trackNature } from './nature';
import { LANDFORMS } from '../world/land';
import { showsWater } from '../world/water';

const RES = CHUNK_SIZE * 4;
const AO_MIN = 0.42;

function wallAt(chunk:Chunk, lx:number, lz:number):boolean {
	const t = chunk.tile(lx, lz);
	return !!t?.blocked && t.def !== 'water';
}

function sample(chunk:Chunk, wx:number, wz:number):number {
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const lx = Math.floor((wx - ox) / CELL_SIZE);
	const lz = Math.floor((wz - oz) / CELL_SIZE);
	const self = chunk.tile(lx, lz);
	// The top of a landform (forest floor, a trail, a clifftop) is open ground, as the outskirts past it are.
	if (self && LANDFORMS.has(self.def)) {
		return 1;
	}
	const h = self?.height ?? 0;
	let ao = 1;
	const n = wallAt(chunk, lx, lz - 1);
	const s = wallAt(chunk, lx, lz + 1);
	const e = wallAt(chunk, lx + 1, lz);
	const w = wallAt(chunk, lx - 1, lz);
	const walls = (n ? 1 : 0) + (s ? 1 : 0) + (e ? 1 : 0) + (w ? 1 : 0);
	ao -= walls * 0.11;
	if ((n && e) || (n && w) || (s && e) || (s && w)) {
		ao -= 0.1;
	}
	for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
		const nb = chunk.tile(lx + dx, lz + dz);
		if (nb && nb.height > h) {
			ao -= 0.08;
		}
	}
	if (showsWater(self?.def)) {
		ao -= 0.18;
	}
	else {
		for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
			if (showsWater(chunk.tile(lx + dx, lz + dz)?.def)) {
				ao -= 0.06;
				break;
			}
		}
	}
	return ao;
}

function splatTrees(data:Uint8Array, chunk:Chunk):void {
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const radius = 1.5;
	const texR = radius * 4;
	for (const ent of chunk.entities) {
		if (ent.def !== 'tree') {
			continue;
		}
		const tx = ox + (ent.localX + 0.5) * CELL_SIZE;
		const tz = oz + (ent.localZ + 0.5) * CELL_SIZE;
		const cx = ((tx - ox) / CELL_SIZE) * 4 - 0.5;
		const cz = ((tz - oz) / CELL_SIZE) * 4 - 0.5;
		const x0 = Math.max(0, Math.floor(cx - texR));
		const x1 = Math.min(RES - 1, Math.ceil(cx + texR));
		const z0 = Math.max(0, Math.floor(cz - texR));
		const z1 = Math.min(RES - 1, Math.ceil(cz + texR));
		for (let z = z0; z <= z1; z++) {
			for (let x = x0; x <= x1; x++) {
				const wx = ox + (x + 0.5) * CELL_SIZE / 4;
				const wz = oz + (z + 0.5) * CELL_SIZE / 4;
				const d = Math.hypot(wx - tx, wz - tz) / CELL_SIZE;
				if (d >= radius) {
					continue;
				}
				const i = (z * RES + x) * 4;
				const next = data[i] - Math.round(0.2 * (1 - d / radius) * 255);
				const v = Math.max(Math.round(AO_MIN * 255), next);
				data[i] = v;
				data[i + 1] = v;
				data[i + 2] = v;
			}
		}
	}
}

export function bakeChunkAo(chunk:Chunk):THREE.DataTexture {
	const data = new Uint8Array(RES * RES * 4);
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	for (let z = 0; z < RES; z++) {
		for (let x = 0; x < RES; x++) {
			const wx = ox + (x + 0.5) * CELL_SIZE / 4;
			const wz = oz + (z + 0.5) * CELL_SIZE / 4;
			const v = Math.round(THREE.MathUtils.clamp(sample(chunk, wx, wz), AO_MIN, 1) * 255);
			const i = (z * RES + x) * 4;
			data[i] = v;
			data[i + 1] = v;
			data[i + 2] = v;
			data[i + 3] = 255;
		}
	}
	splatTrees(data, chunk);
	const tex = new THREE.DataTexture(data, RES, RES, THREE.RGBAFormat);
	tex.magFilter = THREE.LinearFilter;
	tex.minFilter = THREE.LinearFilter;
	tex.wrapS = THREE.ClampToEdgeWrapping;
	tex.wrapT = THREE.ClampToEdgeWrapping;
	tex.needsUpdate = true;
	return tex;
}

export function injectAo(
	mat:THREE.Material,
	tex:THREE.DataTexture,
	originX:number,
	originZ:number,
	size:number,
):void {
	const uAoMap = { value: tex };
	const uAoOrigin = { value: new THREE.Vector2(originX, originZ) };
	const uAoSize = { value: size };
	patchShader(mat, 'ao', (shader) => {
		shader.uniforms.uAoMap = uAoMap;
		shader.uniforms.uAoOrigin = uAoOrigin;
		shader.uniforms.uAoSize = uAoSize;
		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			`#include <common>
			varying vec3 vAoWorld;`,
		);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <project_vertex>',
			`#include <project_vertex>
			#ifdef USE_INSTANCING
			vAoWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
			#else
			vAoWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
			#endif`,
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			`#include <common>
			uniform sampler2D uAoMap;
			uniform vec2 uAoOrigin;
			uniform float uAoSize;
			varying vec3 vAoWorld;
			float aoMul() {
				vec2 uv = (vAoWorld.xz - uAoOrigin) / uAoSize;
				float ao = texture2D(uAoMap, uv).r;
				return mix(ao, 1.0, smoothstep(0.2, 1.4, vAoWorld.y));
			}`,
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			/vec3 outgoingLight = ([^;]+);/,
			'vec3 outgoingLight = ($1) * aoMul();',
		);
	});
}

export function attachChunkAo(group:THREE.Group, chunk:Chunk):void {
	const tex = bakeChunkAo(chunk);
	group.userData.aoMap = tex;
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const size = CHUNK_SIZE * CELL_SIZE;
	group.traverse((node) => {
		const mesh = node as THREE.Mesh;
		if (!mesh.isMesh) {
			return;
		}
		const wrap = (m:THREE.Material):THREE.Material => {
			const c = m.clone();
			c.onBeforeCompile = m.onBeforeCompile;
			const key = m.customProgramCacheKey.bind(m);
			c.customProgramCacheKey = () => key();
			c.userData = { ...m.userData, shared: false };
			if (m.userData.uTime) {
				c.userData.uTime = m.userData.uTime;
			}
			injectAo(c, tex, ox, oz, size);
			trackNature(c);
			return c;
		};
		if (Array.isArray(mesh.material)) {
			mesh.material = mesh.material.map(wrap);
		}
		else {
			mesh.material = wrap(mesh.material);
		}
	});
}
