import * as THREE from 'three';
import { mergeParts, type PosedPart } from '@arc-director/kindling';
import { BOULDER_SIZE, WALL_HEIGHT } from '../world/constants';
import type { RoofStyle, Wake } from '../world/decodeGlyphChunk';
import { claimFallSlot, claimRockSlot, getNature, markRock, fallFoamMat, fallMistMat, fallSheetMat, markFallLanding, WATER_UPPER_Y } from './nature';
import { PALETTE, plankMat, riverRockMat, slateMat, thatchMat, tileMat, toon } from './toon';


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

/**
 * A house's roof and ceiling over a wall line `halfW` × `halfD` meters from its middle (walls, window and door are
 * tiles): gables stand on the line, the roof overhangs it, thatched or in slate. With `chimney`, a house 5 m wide or
 * more has one.
 */
export function createRoofMesh(halfW:number, halfD:number, style:RoofStyle = 'thatch', chimney = true):THREE.Group {
	// Own copies: the roof fades when the player walks under it.
	const wood = plankMat().clone();
	const thatch = style === 'slate' ? slateMat().clone() : thatchMat().clone();
	const g = new THREE.Group();
	g.userData.kind = 'house';
	const hw = halfW + 0.3;
	const hd = halfD + 0.45;
	const eaveY = WALL_HEIGHT;
	// The same pitch on any house.
	const ridgeY = eaveY + halfD * 0.5;
	const eave = (x:number, z:number):THREE.Vector3 => new THREE.Vector3(x, eaveY, z);
	const ridge = (x:number):THREE.Vector3 => new THREE.Vector3(x, ridgeY, 0);

	const roof = new THREE.Group();
	roof.name = 'roof';
	// roof top
	roof.add(quadMesh(eave(-hw, hd), eave(hw, hd), ridge(hw), ridge(-hw), thatch, 2, 1.45));
	roof.add(quadMesh(eave(hw, -hd), eave(-hw, -hd), ridge(-hw), ridge(hw), thatch, 2, 1.45));
	// roof sides
	roof.add(triMesh(eave(-halfW, -hd), eave(-halfW, hd), ridge(-halfW), wood, 1, 1));
	roof.add(triMesh(eave(halfW, hd), eave(halfW, -hd), ridge(halfW), wood, 1, 1));

	g.add(roof);


	g.userData.roof = roof;
	g.userData.roofHalfW = halfW;
	g.userData.roofHalfD = halfD;
	if (!chimney || halfW < 2.5) {
		return g;
	}

	// chimney
	const stack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.05, 0.42), toon(0x5a534c));
	stack.position.set(1.35, (ridgeY + eaveY) * 0.5 + 0.45, -1.05);
	g.add(occupyRoof(stack));
	const cap = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.1, 0.52), toon(0x3e3a36));
	cap.position.copy(stack.position);
	cap.position.y += 0.55;
	g.add(occupyRoof(cap));

	return g;
}

/** Collider anchor only. The canopy is an instanced toon mesh on the chunk. */
export function createTreeMesh(kind:'oak' | 'pine'):THREE.Group {
	const g = new THREE.Group();
	g.userData.kind = 'tree';
	g.userData.tree = kind;
	return g;
}

/** Meters across a boulder of size 1: a map's `o` boulder, or one out in the land past the map. */
export const BOULDER_ACROSS = 1.15;

let boulders = 0;

/**
 * A boulder: the boulder models in turn, each {@link BOULDER_ACROSS} across. One with a `wake` stands in water: on
 * the riverbed, a little bigger so as much shows, wet where the water laps it, and rippling the water round it
 * (see `EntityLegend.wake`).
 */
export function createBoulderMesh(wake?:Wake):THREE.Group {
	const inWater = wake !== undefined;
	const g = new THREE.Group();
	g.userData.kind = 'boulder';
	const all = getNature().boulders;
	const piece = all[boulders++ % all.length]!;
	const mesh = new THREE.Mesh(piece.geom, inWater ? riverRockMat(piece.map) : tileMat(piece.map));
	mesh.scale.setScalar((inWater ? 1.2 : 1) * BOULDER_ACROSS / piece.across);
	if (inWater) {
		// Sunk 17 cm under the surface at the smallest size a map gives it (`BOULDER_SIZE`); bigger ones settle deeper.
		mesh.position.y = (WATER_UPPER_Y - 0.17) / BOULDER_SIZE.min;
		// Tell the river where it stands every frame, so it ripples round it (never culled, so ripples near
		// the edge of view keep going).
		mesh.frustumCulled = false;
		const slot = claimRockSlot();
		const at = new THREE.Vector3();
		const size = new THREE.Vector3();
		mesh.onBeforeRender = () => {
			g.getWorldPosition(at);
			g.getWorldScale(size);
			const radius = 0.34 * mesh.scale.x * piece.across * size.x;
			// About the waterline's width: a dome is a little narrower there than at its foot.
			markRock(slot, at.x, at.z, radius, wake);
		};
	}
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
