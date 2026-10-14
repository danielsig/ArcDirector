import * as THREE from 'three';
import { mergeParts, type PosedPart, hash } from '@arc-director/kindling';
import { WALL_HEIGHT } from '../world/constants';
import { claimFallSlot, fallFoamMat, fallMistMat, fallSheetMat, markFallLanding } from './nature';
import { PALETTE, plankMat, rockMat, thatchMat, toon, WET_SHADE } from './toon';


function planarUV(pts:THREE.Vector3[], uScale:number, vScale:number):number[] {
	const origin = pts[0];
	const uAxis = pts[1].clone().sub(origin);
	const uLen = uAxis.length();
	if (uLen < 1e-6) {
		return pts.flatMap(() => [0, 0]);
	}
	uAxis.multiplyScalar(1 / uLen);
	const rawV = pts[pts.length - 1].clone().sub(origin);
	rawV.addScaledVector(uAxis, -rawV.dot(uAxis));
	const vLen = rawV.length();
	const vAxis = vLen < 1e-6 ? new THREE.Vector3(0, 1, 0) : rawV.multiplyScalar(1 / vLen);
	const uv:number[] = [];
	for (const p of pts) {
		const d = p.clone().sub(origin);
		uv.push(d.dot(uAxis) / uScale, d.dot(vAxis) / vScale);
	}
	return uv;
}

function quadMesh(
	a:THREE.Vector3,
	b:THREE.Vector3,
	c:THREE.Vector3,
	d:THREE.Vector3,
	mat:THREE.Material,
	uScale = 2,
	vScale = 1.5,
):THREE.Mesh {
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute([
		a.x, a.y, a.z,
		b.x, b.y, b.z,
		c.x, c.y, c.z,
		d.x, d.y, d.z,
	], 3));
	geo.setAttribute('uv', new THREE.Float32BufferAttribute(planarUV([a, b, c, d], uScale, vScale), 2));
	geo.setIndex([0, 1, 2, 0, 2, 3]);
	geo.computeVertexNormals();
	const mesh = new THREE.Mesh(geo, mat);
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	return mesh;
}

function triMesh(
	a:THREE.Vector3,
	b:THREE.Vector3,
	c:THREE.Vector3,
	mat:THREE.Material,
	uScale = 1.2,
	vScale = 1.2,
):THREE.Mesh {
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute([
		a.x, a.y, a.z,
		b.x, b.y, b.z,
		c.x, c.y, c.z,
	], 3));
	geo.setAttribute('uv', new THREE.Float32BufferAttribute(planarUV([a, b, c], uScale, vScale), 2));
	geo.setIndex([0, 1, 2]);
	geo.computeVertexNormals();
	const mesh = new THREE.Mesh(geo, mat);
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	return mesh;
}

/** Props on the roof must receive shadows so indoor lights cannot leak through the ceiling. */
export function occupyRoof(mesh:THREE.Mesh):THREE.Mesh {
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	return mesh;
}

/** Roof, ceiling, chimney, and windows. Walls/door are tiles; this sits on a 6×5 footprint. */
export function createCottageMesh():THREE.Group {
	// Own copies: the roof fades when the player walks under it.
	const wood = plankMat().clone();
	const thatch = thatchMat().clone();
	const g = new THREE.Group();
	g.userData.kind = 'cottage';
	const halfW = 3;
	const halfD = 2.5;
	const over = 0.18;
	const hw = halfW + over;
	const hd = halfD + over;
	const eaveY = WALL_HEIGHT - 0.06;
	const ridgeY = eaveY + 1.01;
	const nw = new THREE.Vector3(-hw, eaveY, -hd);
	const ne = new THREE.Vector3(hw, eaveY, -hd);
	const sw = new THREE.Vector3(-hw, eaveY, hd);
	const se = new THREE.Vector3(hw, eaveY, hd);
	const rw = new THREE.Vector3(-hw, ridgeY, 0);
	const re = new THREE.Vector3(hw, ridgeY, 0);
	const roof = new THREE.Group();
	roof.name = 'roof';
	roof.add(quadMesh(sw, se, re, rw, thatch, 2, 1.45));
	roof.add(quadMesh(ne, nw, rw, re, thatch, 2, 1.45));
	roof.add(triMesh(nw, sw, rw, wood, 1.1, 1.1));
	roof.add(triMesh(se, ne, re, wood, 1.1, 1.1));
	const ceiling = new THREE.Mesh(new THREE.BoxGeometry(5.15, 0.28, 4.15), wood);
	ceiling.name = 'ceiling';
	ceiling.position.y = WALL_HEIGHT - 0.08;
	ceiling.castShadow = true;
	ceiling.receiveShadow = true;
	roof.add(ceiling);
	g.add(roof);
	g.userData.roof = roof;
	g.userData.roofHalfW = halfW;
	g.userData.roofHalfD = halfD;
	const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.05, 0.42), toon(0x5a534c));
	chimney.position.set(1.35, (ridgeY + eaveY) * 0.5 + 0.45, -1.05);
	g.add(occupyRoof(chimney));
	const cap = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.1, 0.52), toon(0x3e3a36));
	cap.position.copy(chimney.position);
	cap.position.y += 0.55;
	g.add(occupyRoof(cap));
	const glass = toon(0x1a2430);
	const shutter = toon(0x4a301c);
	const winY = 1.22;
	const east = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.58, 0.78), glass);
	east.position.set(halfW + 0.02, winY, 0);
	g.add(east);
	const west = east.clone();
	west.position.x = -halfW - 0.02;
	g.add(west);
	const north = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.58, 0.08), glass);
	north.position.set(-1.05, winY, -halfD - 0.02);
	g.add(north);
	const north2 = north.clone();
	north2.position.x = 1.05;
	g.add(north2);
	for (const pane of [east, west]) {
		const frame = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.68, 0.88), shutter);
		frame.position.copy(pane.position);
		g.add(frame);
	}
	for (const pane of [north, north2]) {
		const frame = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.68, 0.1), shutter);
		frame.position.copy(pane.position);
		g.add(frame);
	}
	return g;
}

/** Collider anchor only. The canopy is an instanced toon mesh on the chunk. */
export function createTreeMesh(kind:'oak' | 'pine'):THREE.Group {
	const g = new THREE.Group();
	g.userData.kind = 'tree';
	g.userData.tree = kind;
	return g;
}

function weldIndexed(src:THREE.BufferGeometry, quant = 1e3):THREE.BufferGeometry {
	const pos = src.getAttribute('position');
	const keyTo = new Map<string, number>();
	const unique:number[] = [];
	const index:number[] = [];
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i);
		const y = pos.getY(i);
		const z = pos.getZ(i);
		const key = `${Math.round(x * quant)},${Math.round(y * quant)},${Math.round(z * quant)}`;
		let id = keyTo.get(key);
		if (id === undefined) {
			id = unique.length / 3;
			keyTo.set(key, id);
			unique.push(x, y, z);
		}
		index.push(id);
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(unique, 3));
	geo.setIndex(index);
	return geo;
}

let rockGeo:THREE.BufferGeometry | null = null;

export function rockGeometry():THREE.BufferGeometry {
	if (rockGeo) {
		return rockGeo;
	}
	const src = new THREE.IcosahedronGeometry(0.52, 2);
	const geo = weldIndexed(src);
	src.dispose();
	const pos = geo.getAttribute('position');
	const v = new THREE.Vector3();
	for (let i = 0; i < pos.count; i++) {
		v.fromBufferAttribute(pos, i);
		const nrm = v.clone().normalize();
		nrm.x = Math.round(nrm.x * 256) / 256;
		nrm.y = Math.round(nrm.y * 256) / 256;
		nrm.z = Math.round(nrm.z * 256) / 256;
		nrm.normalize();
		let mag = 0.5;
		mag += (hash(nrm.x, nrm.y, nrm.z) - 0.5) * 0.22;
		mag += (hash(nrm.x * 2.3, nrm.y * 2.3, nrm.z * 2.3) - 0.5) * 0.1;
		if (nrm.y < -0.2) {
			mag *= 0.45 + (nrm.y + 1) * 0.4;
		}
		v.copy(nrm).multiplyScalar(mag);
		v.x *= 1.22;
		v.y *= 0.78;
		v.z *= 1.04;
		if (v.y < 0) {
			v.y *= 0.15;
		}
		pos.setXYZ(i, v.x, v.y, v.z);
	}
	let minY = Infinity;
	for (let i = 0; i < pos.count; i++) {
		minY = Math.min(minY, pos.getY(i));
	}
	for (let i = 0; i < pos.count; i++) {
		const y = pos.getY(i) - minY;
		pos.setY(i, y < 0.04 ? 0 : y);
	}
	const flat = geo.toNonIndexed();
	flat.computeVertexNormals();
	flat.computeBoundingBox();
	const box = flat.boundingBox;
	const outPos = flat.getAttribute('position');
	const nrm = flat.getAttribute('normal');
	const uv = new Float32Array(outPos.count * 2);
	const p = new THREE.Vector3();
	const n = new THREE.Vector3();
	const size = new THREE.Vector3();
	box?.getSize(size);
	const sx = Math.max(size.x, 0.2);
	const sy = Math.max(size.y, 0.2);
	const sz = Math.max(size.z, 0.2);
	for (let i = 0; i < outPos.count; i++) {
		p.fromBufferAttribute(outPos, i);
		n.fromBufferAttribute(nrm, i);
		const ax = Math.abs(n.x);
		const ay = Math.abs(n.y);
		const az = Math.abs(n.z);
		let u = 0;
		let vv = 0;
		if (ay >= ax && ay >= az) {
			u = p.x / sx;
			vv = p.z / sz;
		}
		else if (ax >= az) {
			u = p.z / sz;
			vv = p.y / sy;
		}
		else {
			u = p.x / sx;
			vv = p.y / sy;
		}
		uv[i * 2] = u + 0.5;
		uv[i * 2 + 1] = vv + 0.5;
	}
	flat.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	geo.dispose();
	flat.userData.shared = true;
	rockGeo = flat;
	return flat;
}

let wetRockGeo:THREE.BufferGeometry | null = null;

/** The rock with its lower half wet: faces centred below half its height take {@link WET_SHADE}, for {@link wetRockMat}. */
export function wetRockGeometry():THREE.BufferGeometry {
	if (wetRockGeo) {
		return wetRockGeo;
	}
	const geo = rockGeometry().clone();
	const pos = geo.getAttribute('position');
	const waterline = (geo.boundingBox?.max.y ?? 0) / 2;
	const color = new Float32Array(pos.count * 3);
	for (let i = 0; i < pos.count; i += 3) {
		const mid = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
		color.fill(mid < waterline ? WET_SHADE : 1, i * 3, i * 3 + 9);
	}
	geo.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
	geo.userData.shared = true;
	wetRockGeo = geo;
	return geo;
}

export function createBoulderMesh():THREE.Group {
	const g = new THREE.Group();
	g.userData.kind = 'boulder';
	const mesh = new THREE.Mesh(rockGeometry(), rockMat());
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	g.add(mesh);
	return g;
}

function solidMesh(geo:THREE.BufferGeometry, mat:THREE.Material, cast = true):THREE.Mesh {
	const mesh = new THREE.Mesh(geo, mat);
	mesh.castShadow = cast;
	mesh.receiveShadow = true;
	return mesh;
}

const BRIDGE_LEN = 3.28;
const BRIDGE_W = 1.72;
/** Taller than the deck, so a raised deck rests in front of it with the chains pulling down to its tip. */
const GANTRY_H = 3.7;

/**
 * Drawbridge across a three-tile river. The deck hinges on the near (-Z) bank; chains run from a
 * timber gantry over the hinge to the deck's far corners. `userData.setLift(0..1)` lowers or raises it.
 */
export function createBridgeMesh():THREE.Group {
	const deckWood = toon(PALETTE.woodLight);
	const dark = toon(PALETTE.woodDark);
	const iron = toon(PALETTE.iron, { rim: 0.35 });
	const stone = toon(PALETTE.wall, { pattern: 'stone', patternScale: 0.18, patternInk: 0.5 });
	const g = new THREE.Group();
	g.userData.kind = 'bridge';
	const half = BRIDGE_LEN * 0.5;

	// Deck: planks across, slightly uneven, on two stringers; cross-braced rails on both sides.
	// Lowered, the plank tops sit at `BRIDGE_DECK_Y`, where walkers stand.
	const hinge = new THREE.Group();
	hinge.name = 'hinge';
	hinge.position.set(0, 0.06, -half);
	const plankN = 11;
	const pitch = BRIDGE_LEN / plankN;
	const plank = new THREE.BoxGeometry(BRIDGE_W, 0.07, pitch - 0.03);
	hinge.add(solidMesh(mergeParts(Array.from({ length: plankN }, (_, i) => ({
		geo: plank,
		x: ((i * 37) % 5 - 2) * 0.012,
		y: 0.1 + ((i * 53) % 3) * 0.006,
		z: (i + 0.5) * pitch,
		ry: ((i * 29) % 5 - 2) * 0.012,
	}))), deckWood));
	const stringer = new THREE.BoxGeometry(0.12, 0.12, BRIDGE_LEN);
	const post = new THREE.BoxGeometry(0.08, 0.62, 0.08);
	const rail = new THREE.BoxGeometry(0.07, 0.07, BRIDGE_LEN - 0.04);
	const bay = (BRIDGE_LEN - 0.1) / 3;
	const brace = new THREE.BoxGeometry(0.05, Math.hypot(bay, 0.42), 0.05);
	const frame:PosedPart[] = [];
	for (const side of [-1, 1]) {
		const x = side * (BRIDGE_W * 0.5 - 0.05);
		frame.push({ geo: stringer, x, y: 0.0, z: half });
		frame.push({ geo: rail, x, y: 0.72, z: half });
		for (let p = 0; p <= 3; p++) {
			frame.push({ geo: post, x, y: 0.44, z: 0.05 + p * bay });
		}
		for (let b = 0; b < 3; b++) {
			const tilt = Math.atan2(bay, 0.42) * (b % 2 === 0 ? 1 : -1);
			frame.push({ geo: brace, x, y: 0.44, z: 0.05 + (b + 0.5) * bay, rx: tilt });
		}
	}
	hinge.add(solidMesh(mergeParts(frame), dark));
	const eye = new THREE.TorusGeometry(0.05, 0.015, 4, 8);
	eye.rotateY(Math.PI / 2);
	hinge.add(solidMesh(mergeParts([-1, 1].map((side) => ({ geo: eye, x: side * (BRIDGE_W * 0.5 - 0.05), y: 0.78, z: BRIDGE_LEN - 0.1 }))), iron, false));
	g.add(hinge);

	// Stone abutments where the deck lands, at both banks: tops just over the grass, under the stringers.
	const pier = new THREE.BoxGeometry(BRIDGE_W + 0.36, 0.6, 0.42);
	g.add(solidMesh(mergeParts([-1, 1].map((side) => ({ geo: pier, x: 0, y: -0.29, z: side * (half + 0.12) }))), stone));

	// Gantry over the hinge: two posts, a beam, a winch drum and pulleys for the chains.
	const gz = -half - 0.32;
	const gPost = new THREE.BoxGeometry(0.16, GANTRY_H, 0.16);
	const gBeam = new THREE.BoxGeometry(BRIDGE_W + 0.6, 0.16, 0.18);
	const gStrut = new THREE.BoxGeometry(0.08, 0.9, 0.08);
	const gx = BRIDGE_W * 0.5 + 0.14;
	g.add(solidMesh(mergeParts([
		{ geo: gPost, x: -gx, y: GANTRY_H * 0.5, z: gz },
		{ geo: gPost, x: gx, y: GANTRY_H * 0.5, z: gz },
		{ geo: gBeam, x: 0, y: GANTRY_H, z: gz },
		{ geo: gStrut, x: -gx + 0.24, y: GANTRY_H - 0.32, z: gz, rz: -0.6 },
		{ geo: gStrut, x: gx - 0.24, y: GANTRY_H - 0.32, z: gz, rz: 0.6 },
	]), dark));
	const drum = new THREE.CylinderGeometry(0.11, 0.11, BRIDGE_W - 0.1, 10);
	drum.rotateZ(Math.PI / 2);
	const pulley = new THREE.CylinderGeometry(0.09, 0.09, 0.06, 10);
	pulley.rotateZ(Math.PI / 2);
	const chainX = BRIDGE_W * 0.5 - 0.05;
	g.add(solidMesh(mergeParts([
		// High under the beam, clear of the walkway; the chains wind onto it over the pulleys.
		{ geo: drum, x: 0, y: GANTRY_H - 0.5, z: gz },
		{ geo: pulley, x: -chainX, y: GANTRY_H - 0.14, z: gz + 0.12 },
		{ geo: pulley, x: chainX, y: GANTRY_H - 0.14, z: gz + 0.12 },
	]), iron));

	// Chains: one unit-long bar each, re-aimed from pulley to deck tip whenever the lift changes.
	const link = new THREE.BoxGeometry(0.035, 0.035, 1);
	link.translate(0, 0, 0.5);
	const chains = [-1, 1].map((side) => {
		const chain = solidMesh(link, iron);
		chain.userData.from = new THREE.Vector3(side * chainX, GANTRY_H - 0.14, gz + 0.12);
		chain.userData.tip = new THREE.Vector3(side * chainX, 0.78, BRIDGE_LEN - 0.1);
		g.add(chain);
		return chain;
	});
	const tip = new THREE.Vector3();
	const dir = new THREE.Vector3();
	const forward = new THREE.Vector3(0, 0, 1);
	g.userData.setLift = (lift:number):void => {
		hinge.rotation.x = -Math.PI / 2 * lift;
		hinge.updateMatrix();
		for (const chain of chains) {
			tip.copy(chain.userData.tip as THREE.Vector3).applyMatrix4(hinge.matrix);
			const from = chain.userData.from as THREE.Vector3;
			chain.position.copy(from);
			dir.subVectors(tip, from);
			chain.scale.set(1, 1, Math.max(0.01, dir.length()));
			chain.quaternion.setFromUnitVectors(forward, dir.normalize());
		}
	};
	g.userData.setLift(1);
	return g;
}

const FALL_W = 1.9;
/** Water surface over the wall top: 3 cm above the stone. */
const FALL_H = WALL_HEIGHT + 0.03;
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

export function createWaterfallMesh():THREE.Group {
	const g = new THREE.Group();
	g.userData.kind = 'waterfall';
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
		g.localToWorld(landing.set(0, 0, landZ + 0.15));
		markFallLanding(slot, landing.x, landing.z);
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
	const rock = rockMat();
	for (const [x, z, s] of [[-0.95, 0.28, 0.44], [0.98, 0.18, 0.38], [0.5, 0.7, 0.3], [-0.52, 0.82, 0.34]]) {
		const m = new THREE.Mesh(rockGeometry(), rock);
		m.position.set(x, 0, z);
		m.scale.setScalar(s);
		m.castShadow = true;
		m.receiveShadow = true;
		g.add(m);
	}
	return g;
}

export function createLeverMesh():THREE.Group {
	const wood = plankMat();
	const g = new THREE.Group();
	g.userData.kind = 'lever';
	const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.05, 0.14), wood);
	post.position.y = 0.52;
	post.castShadow = true;
	g.add(post);
	const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.7), toon(0x6a3a22));
	arm.name = 'arm';
	arm.position.set(0, 0.92, 0.2);
	g.add(arm);
	g.userData.arm = arm;
	return g;
}
