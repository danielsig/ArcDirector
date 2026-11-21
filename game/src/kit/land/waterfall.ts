import * as THREE from 'three';
import { BoxCollider } from '../../engine/components';
import { WALL_HEIGHT } from '../../world/constants';
import { claimFallSlot, getNature, fallFoamMat, fallMistMat, fallSheetMat, markFallLanding, natureReady } from '../../render/nature';
import { riverRockMat } from '../../render/toon';
import { spawnProp, type Thing } from '../thing';
import { WATER_UPPER_Y } from '../../world/terrain-kinds';

const FALL_W = 1.9;
/** Where the sheet starts: on the surface of the river up on the cliff (a cliff is a wall high), just over its current lines. */
const FALL_H = WALL_HEIGHT + WATER_UPPER_Y + 0.01;
/** The wall's face in this prop's frame (spawn puts the origin just in front of it). */
const WALL_FACE_Z = -0.04;
/** How far back over the wall top the water starts. */
const FALL_BACK = 0.36;
/** Outward throw: z grows with the square root of the drop, so the sheet leaves the edge level and clears the stone. */
const FALL_THROW = 0.36;

/**
 * One continuous sheet: level on the wall top, over the edge on a thrown-stream curve, then
 * nearly straight down, widening a little. Normals follow the curve (up on top, out on the face).
 * `uv.y` runs 1 (back of the wall top) to 0 (pool) by length along it.
 */
function fallSheet():THREE.BufferGeometry {
	const profile:{ z:number; y:number }[] = [];
	for (let i = 0; i <= 4; i++) {
		profile.push({ z: WALL_FACE_Z - FALL_BACK * (1 - i / 4), y: FALL_H });
	}
	const drops = 30;
	for (let i = 1; i <= drops; i++) {
		const d = (i / drops) ** 1.6;
		profile.push({ z: WALL_FACE_Z + FALL_THROW * Math.sqrt(d), y: FALL_H * (1 - d) });
	}
	const along = [0];
	for (let k = 1; k < profile.length; k++) {
		along.push(along[k - 1]! + Math.hypot(profile[k]!.z - profile[k - 1]!.z, profile[k]!.y - profile[k - 1]!.y));
	}
	const total = along[along.length - 1]!;
	const cols = 10;
	const pos:number[] = [];
	const nrm:number[] = [];
	const uv:number[] = [];
	profile.forEach((p, k) => {
		const prev = profile[Math.max(0, k - 1)]!;
		const next = profile[Math.min(profile.length - 1, k + 1)]!;
		const tz = next.z - prev.z;
		const ty = next.y - prev.y;
		const tl = Math.hypot(tz, ty) || 1;
		const width = FALL_W * (1 + 0.15 * Math.max(0, 1 - p.y / FALL_H));
		for (let i = 0; i <= cols; i++) {
			const u = i / cols;
			pos.push((u - 0.5) * width, p.y, p.z);
			nrm.push(0, tz / tl, -ty / tl);
			uv.push(u, 1 - along[k]! / total);
		}
	});
	const idx:number[] = [];
	const row = cols + 1;
	for (let k = 0; k < profile.length - 1; k++) {
		for (let i = 0; i < cols; i++) {
			const a = k * row + i;
			idx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
		}
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
	geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	geo.setIndex(idx);
	geo.computeBoundingSphere();
	return geo;
}

function createWaterfallMesh():THREE.Group {
	const g = new THREE.Group();
	const sheet = new THREE.Mesh(fallSheet(), fallSheetMat());
	sheet.castShadow = false;
	sheet.receiveShadow = true;
	g.add(sheet);
	const landZ = WALL_FACE_Z + FALL_THROW;
	// Foam puffs in a half ring where the sheet lands.
	const puffs = 15;
	const foam = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.2, 1), fallFoamMat(), puffs);
	foam.castShadow = false;
	const dummy = new THREE.Object3D();
	for (let i = 0; i < puffs; i++) {
		const t = i / (puffs - 1);
		const a = Math.PI * (0.05 + 0.9 * t);
		const r = 0.62 + ((i * 37) % 7) * 0.05;
		dummy.position.set(Math.cos(a) * r * 1.35, 0.06 + ((i * 13) % 3) * 0.04, landZ + Math.sin(a) * r * 0.5);
		dummy.scale.setScalar(0.65 + ((i * 29) % 5) * 0.14);
		dummy.updateMatrix();
		foam.setMatrixAt(i, dummy.matrix);
	}
	foam.instanceMatrix.needsUpdate = true;
	foam.computeBoundingSphere();
	g.add(foam);
	// Tell the river where this fall lands every frame (never culled, so rings keep going off-screen).
	foam.frustumCulled = false;
	const slot = claimFallSlot();
	const landing = new THREE.Vector3();
	foam.onBeforeRender = () => {
		markFallLanding(slot, g.localToWorld(landing.set(0, 0, landZ + 0.15)));
	};
	// Spray mist rising from the landing, drawn after the water so it veils the foot of the fall.
	const mists = 12;
	const mist = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.3, 1), fallMistMat(), mists);
	mist.castShadow = false;
	mist.renderOrder = 2;
	// Puffs rise past their resting bounds in the shader.
	mist.frustumCulled = false;
	for (let i = 0; i < mists; i++) {
		dummy.position.set(((i * 41) % 11 - 5) * 0.17, 0.12, landZ + ((i * 23) % 5 - 1) * 0.12);
		dummy.scale.setScalar(0.8 + ((i * 17) % 4) * 0.15);
		dummy.updateMatrix();
		mist.setMatrixAt(i, dummy.matrix);
	}
	mist.instanceMatrix.needsUpdate = true;
	mist.computeBoundingSphere();
	g.add(mist);
	// Rocks at its foot, meters across, wet where the water stands.
	[[-0.95, 0.28, 0.55], [0.98, 0.18, 0.48], [0.5, 0.7, 0.38], [-0.52, 0.82, 0.42]].forEach(([x, z, across], i) => {
		const rocks = getNature().rocks;
		const piece = rocks[i % rocks.length]!;
		const m = new THREE.Mesh(piece.geom, riverRockMat(piece.map));
		m.position.set(x!, 0, z!);
		m.scale.setScalar(across! / piece.across);
		m.castShadow = true;
		m.receiveShadow = true;
		g.add(m);
	});
	return g;
}

/** Water falling down the face in front of its cell, from the river up on the cliff. Nothing stops at it. */
export const waterfall:Thing = {
	defs: ['waterfall'],
	spawn: (world, chunk, ents) => ents.forEach((ent) => {
		const falls = spawnProp(chunk, ent, 'waterfall', 0.2, Math.PI / 2);
		falls.transform.position.x -= 0.46;
		falls.transform.position.z += 0.48;
		falls.transform.position.y = 0;
		const col = falls.getComponent(BoxCollider)!;
		col.solid = false;
		col.isTrigger = true;
		world.add(falls);
	}),
	meshes: { waterfall: () => (natureReady() ? createWaterfallMesh() : undefined) },
};
