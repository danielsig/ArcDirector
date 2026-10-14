import * as THREE from 'three';
import { ToonMaterial, hash } from '@arc-director/kindling';
import type { World } from '../engine/World';
import { CELL_SIZE, CHUNK_SIZE } from '../world/constants';
import { windSway } from './nature';
import { grassCleared } from '../world/dressingPlan';
import { sandAt } from '../world/water';

/**
 * Grass blades over every lawn tile: one instanced mesh of painted tufts for the whole world.
 * Tapered, curved blades shade from the lawn's dark green at the root to sunlit tips, with
 * upward normals so they light like the ground they grow from. No ink, no shadows cast.
 */

const TUFTS_PER_CELL = 5;
const BLADES = 7;
const ROOT = new THREE.Color(0x2b5d22);
const TIP = new THREE.Color(0x7fa845);

let host:THREE.Scene | null = null;
let batch:THREE.InstancedMesh | null = null;
let tuftGeo:THREE.BufferGeometry | null = null;
let bladeMat:ToonMaterial | null = null;
let stamp = '';

/** One clump of blades leaning out from its root, each in two curved segments to a point. */
function tuftGeometry():THREE.BufferGeometry {
	const pos:number[] = [];
	const nrm:number[] = [];
	const col:number[] = [];
	const color = new THREE.Color();
	for (let b = 0; b < BLADES; b++) {
		const a = (b / BLADES) * Math.PI * 2 + hash(b, 1, 2) * 0.8;
		const dx = Math.cos(a);
		const dz = Math.sin(a);
		const root = 0.02 + hash(b, 3, 4) * 0.06;
		const h = 0.26 + hash(b, 5, 6) * 0.18;
		const lean = 0.08 + hash(b, 7, 8) * 0.1;
		const w = 0.05;
		const tint = (hash(b, 9, 10) - 0.5) * 0.15;
		// Across the blade, perpendicular to its lean.
		const sx = -dz * w * 0.5;
		const sz = dx * w * 0.5;
		const at = (t:number, side:number, taper:number):[number, number, number] => [
			dx * (root + lean * t * t) + sx * side * taper,
			h * t,
			dz * (root + lean * t * t) + sz * side * taper,
		];
		const b0 = at(0, -1, 1);
		const b1 = at(0, 1, 1);
		const m0 = at(0.55, -1, 0.65);
		const m1 = at(0.55, 1, 0.65);
		const tip = at(1, 0, 0);
		const shade = [0, 0, 0.55, 0.55, 1];
		const verts = [b0, b1, m1, b0, m1, m0, m0, m1, tip];
		const shades = [shade[0], shade[1], shade[3], shade[0], shade[3], shade[2], shade[2], shade[3], shade[4]];
		verts.forEach((v, i) => {
			pos.push(v[0], v[1], v[2]);
			nrm.push(dx * 0.15, 1, dz * 0.15);
			color.copy(ROOT).lerp(TIP, THREE.MathUtils.clamp(shades[i]! + tint, 0, 1));
			col.push(color.r, color.g, color.b);
		});
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
	geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
	geo.computeBoundingSphere();
	return geo;
}

function chunkStamp(world:World):string {
	let s = '';
	for (const chunk of world.chunks.values()) {
		s += `${chunk.id};`;
	}
	return s;
}

/** Tuft transforms: a few per lawn tile, kept off paths, riverbank sand and the ground props stand on. */
function tuftMatrices(world:World):THREE.Matrix4[] {
	const dummy = new THREE.Object3D();
	const out:THREE.Matrix4[] = [];
	const chunks = [...world.chunks.values()];
	const defAt = (x:number, z:number):string | undefined => world.tileAtWorld(x, z)?.def;
	for (const chunk of chunks) {
		const ox = chunk.worldOriginX();
		const oz = chunk.worldOriginZ();
		chunk.forEachTile((tile, lx, lz) => {
			if (tile.def !== 'grass') {
				return;
			}
			const center = chunk.worldCellCenter(lx, lz);
			if (grassCleared(chunks, center.x, center.z)) {
				return;
			}
			const gx = chunk.origin.cx * CHUNK_SIZE + lx;
			const gz = chunk.origin.cz * CHUNK_SIZE + lz;
			for (let t = 0; t < TUFTS_PER_CELL; t++) {
				const hx = hash(gx, gz, t * 3 + 1);
				const hz = hash(gx, gz, t * 3 + 2);
				const hs = hash(gx, gz, t * 3 + 3);
				const x = ox + (lx + 0.1 + hx * 0.8) * CELL_SIZE;
				const z = oz + (lz + 0.1 + hz * 0.8) * CELL_SIZE;
				if (sandAt(defAt, x, z)) {
					continue;
				}
				dummy.position.set(x, 0, z);
				dummy.rotation.set(0, hs * Math.PI * 2, 0);
				const s = 0.8 + hs * 0.45;
				dummy.scale.set(s, s * (0.85 + hx * 0.3), s);
				dummy.updateMatrix();
				out.push(dummy.matrix.clone());
			}
		});
	}
	return out;
}

function dropBatch():void {
	if (batch && host) {
		host.remove(batch);
	}
	batch?.dispose();
	batch = null;
}

export function syncGrassBatch(scene:THREE.Scene, world:World):void {
	const next = chunkStamp(world);
	if (next === stamp && batch) {
		return;
	}
	stamp = next;
	host = scene;
	dropBatch();
	const matrices = tuftMatrices(world);
	if (matrices.length === 0) {
		return;
	}
	tuftGeo ??= tuftGeometry();
	if (!bladeMat) {
		bladeMat = new ToonMaterial({
			vertexColors: true,
			side: THREE.DoubleSide,
			outline: false,
		});
		windSway(bladeMat, 0.35);
	}
	batch = new THREE.InstancedMesh(tuftGeo, bladeMat, matrices.length);
	batch.name = 'grassBlades';
	batch.castShadow = false;
	batch.receiveShadow = true;
	matrices.forEach((m, i) => batch!.setMatrixAt(i, m));
	batch.instanceMatrix.needsUpdate = true;
	batch.computeBoundingSphere();
	scene.add(batch);
}

export function disposeGrassBatch():void {
	dropBatch();
	tuftGeo?.dispose();
	tuftGeo = null;
	bladeMat?.dispose();
	bladeMat = null;
	stamp = '';
	host = null;
}

if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		disposeGrassBatch();
	});
}
