import * as THREE from 'three';
import { NEIGHBORS4, patchShader, type TileCoord } from '@arc-director/kindling';
import { CELL_SIZE, CHUNK_SIZE } from '../world/constants';
import type { DemoChunk, Tile } from '../world/demo-chunk';
import type { GlyphTerrain } from '../world/GlyphTerrain';
import { trackNature } from './nature';
import { TERRAIN } from '../world/terrain-kinds';

const RES = CHUNK_SIZE * 4;
const AO_MIN = 0.42;

/** How the ground of a tile is shaded by the tiles round it, read across chunk borders. */
function sample(terrain:GlyphTerrain, { tx, tz }:TileCoord):number {
	const tile = (dx:number, dz:number):Tile | undefined => terrain.tileAt({ tx: tx + dx, tz: tz + dz });
	const wallAt = (dx:number, dz:number):boolean => {
		const t = tile(dx, dz);
		return !!t?.blocked && t.def !== 'water';
	};
	const self = tile(0, 0);
	// The top of a landform (forest floor, a trail, a clifftop) is open ground, as the outskirts past it are.
	if (self && TERRAIN[self.def].land) {
		return 1;
	}
	const h = self?.height ?? 0;
	let ao = 1;
	const n = wallAt(0, -1);
	const s = wallAt(0, 1);
	const e = wallAt(1, 0);
	const w = wallAt(-1, 0);
	const walls = (n ? 1 : 0) + (s ? 1 : 0) + (e ? 1 : 0) + (w ? 1 : 0);
	ao -= walls * 0.11;
	if ((n && e) || (n && w) || (s && e) || (s && w)) {
		ao -= 0.1;
	}
	for (const [dx, dz] of NEIGHBORS4) {
		const nb = tile(dx, dz);
		if (nb && nb.height > h) {
			ao -= 0.08;
		}
	}
	if (self && TERRAIN[self.def].water) {
		ao -= 0.18;
	}
	else {
		for (const [dx, dz] of NEIGHBORS4) {
			const nb = tile(dx, dz);
			if (nb && TERRAIN[nb.def].water) {
				ao -= 0.06;
				break;
			}
		}
	}
	return ao;
}

/** The shade under trees, those of the chunks round it too. */
function splatTrees(data:Uint8Array, chunk:DemoChunk, terrain:GlyphTerrain):void {
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const radius = 1.5;
	const texR = radius * 4;
	const near = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dz) => terrain.chunkAt(chunk.origin.cx + dx, chunk.origin.cz + dz)));
	for (const { x: tx, z: tz } of near.flatMap((c) => c?.entities.filter((e) => e.def === 'tree').map((e) => c.worldCellCenter(e.localX, e.localZ)) ?? [])) {
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

export function bakeChunkAo(chunk:DemoChunk, terrain:GlyphTerrain):THREE.DataTexture {
	const data = new Uint8Array(RES * RES * 4);
	// A tile's shade fills its 4 × 4 texels.
	for (let lz = 0; lz < CHUNK_SIZE; lz++) {
		for (let lx = 0; lx < CHUNK_SIZE; lx++) {
			const v = Math.round(THREE.MathUtils.clamp(sample(terrain, chunk.tileCoord(lx, lz)), AO_MIN, 1) * 255);
			for (let z = lz * 4; z < lz * 4 + 4; z++) {
				for (let x = lx * 4; x < lx * 4 + 4; x++) {
					const i = (z * RES + x) * 4;
					data.fill(v, i, i + 3);
					data[i + 3] = 255;
				}
			}
		}
	}
	splatTrees(data, chunk, terrain);
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

export function attachChunkAo(group:THREE.Group, chunk:DemoChunk, terrain:GlyphTerrain):void {
	const tex = bakeChunkAo(chunk, terrain);
	group.userData.aoMap = tex;
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const size = CHUNK_SIZE * CELL_SIZE;
	// One AO copy per material, shared by every mesh of the chunk drawn with it.
	const clones = new Map<THREE.Material, THREE.Material>();
	group.traverse((node) => {
		const mesh = node as THREE.Mesh;
		if (!mesh.isMesh) {
			return;
		}
		const wrap = (m:THREE.Material):THREE.Material => {
			let c = clones.get(m);
			if (!c) {
				c = m.clone();
				c.onBeforeCompile = m.onBeforeCompile;
				const key = m.customProgramCacheKey.bind(m);
				c.customProgramCacheKey = () => key();
				c.userData = { ...m.userData, shared: false };
				injectAo(c, tex, ox, oz, size);
				trackNature(c);
				clones.set(m, c);
			}
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
