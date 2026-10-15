import * as THREE from 'three';
import { chestMaterial, flameMaterial, getSheet, sheetReady, spriteMaterial, unlitSpriteMaterial } from './spritesheet';
import { natureReady } from './nature';
import {
	createBoulderMesh,
	createBridgeMesh,
	createCottageMesh,
	createLeverMesh,
	createTreeMesh,
	createWaterfallMesh,
} from './natureMeshes';
import { bevelBox, lathe, mergeParts, tube, type PosedPart } from '@arc-director/kindling';
import { PALETTE, toon } from './toon';
import { columnParts, type PropPart } from './props';
import { goodsMesh, isGoodsMesh } from './goods';
import { waresForMesh } from '../items/wares';


function spritePlane(w:number, h:number):THREE.PlaneGeometry {
	const geo = new THREE.PlaneGeometry(w, h);
	const pos = geo.getAttribute('position');
	const nrm = geo.getAttribute('normal');
	const n = new THREE.Vector3();
	for (let i = 0; i < pos.count; i++) {
		n.set(pos.getX(i), pos.getY(i), 0).normalize();
		if (n.y < 0) {
			n.y = 0.05;
			n.z = 0.1;
		}
		else {
			n.y *= 0.5;
			n.z = 0.3;
		}
		n.normalize();
		nrm.setXYZ(i, n.x, n.y, n.z);
	}
	nrm.needsUpdate = true;
	geo.computeTangents();
	return geo;
}

export function meshReady(meshID:string):boolean {
	if (
		meshID === 'tree_oak' || meshID === 'tree_pine' || meshID === 'boulder'
		|| meshID === 'bridge' || meshID === 'waterfall' || meshID === 'bridge_lever'
		|| meshID === 'cottage'
	) {
		return natureReady();
	}
	if (isGoodsMesh(meshID)) {
		return true;
	}
	if (
		meshID === 'torch' || meshID === 'torch_stand' || meshID === 'chest' || meshID === 'held_torch'
		|| meshID.startsWith('item_')
	) {
		return sheetReady();
	}
	return true;
}

function addTorchHolster(g:THREE.Group):void {
	const iron = toon(0x8a7060);
	const wood = toon(0x7a4e2a);
	const y = 0.04;
	const rig = new THREE.Group();
	rig.name = 'holsterRig';

	const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.086, 0.12, 8), iron);
	sleeve.position.y = y;
	sleeve.castShadow = true;
	sleeve.receiveShadow = false;
	rig.add(sleeve);

	const ringGeo = new THREE.TorusGeometry(0.092, 0.024, 6, 12);
	const ringLo = new THREE.Mesh(ringGeo, iron);
	ringLo.rotation.x = Math.PI / 2;
	ringLo.position.y = y - 0.055;
	ringLo.castShadow = true;
	ringLo.receiveShadow = false;
	rig.add(ringLo);
	const ringHi = new THREE.Mesh(ringGeo, iron);
	ringHi.rotation.x = Math.PI / 2;
	ringHi.position.y = y + 0.055;
	ringHi.castShadow = true;
	ringHi.receiveShadow = false;
	rig.add(ringHi);

	const armLen = 0.14;
	const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.05, armLen, 8), wood);
	arm.rotation.x = Math.PI / 2;
	arm.position.set(0, y, armLen * 0.5);
	arm.castShadow = true;
	arm.receiveShadow = false;
	rig.add(arm);

	const plate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.055), iron);
	plate.position.set(0, y, 0.128);
	plate.castShadow = true;
	plate.receiveShadow = false;
	rig.add(plate);

	const woodBack = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.03), wood);
	woodBack.position.set(0, y, 0.096);
	woodBack.castShadow = true;
	woodBack.receiveShadow = false;
	rig.add(woodBack);

	g.add(rig);
}

export function createTorchMesh():THREE.Group {
	const sheet = getSheet();
	const g = new THREE.Group();
	g.userData.kind = 'torch';

	const stick = new THREE.Mesh(
		new THREE.PlaneGeometry(0.16, 0.42),
		unlitSpriteMaterial(sheet.torchStick),
	);
	stick.name = 'stick';
	stick.position.y = 0.02;
	stick.castShadow = false;
	g.add(stick);

	const flame = new THREE.Mesh(
		new THREE.PlaneGeometry(0.28, 0.38),
		flameMaterial(sheet.flame[0]),
	);
	flame.name = 'flame';
	flame.position.y = 0.4;
	flame.castShadow = false;
	flame.renderOrder = 2;
	g.add(flame);
	g.userData.flame = flame;
	addTorchHolster(g);
	return g;
}

/**
 * A torch on a pole, standing on the floor: iron foot, wooden pole, iron cup, and the wall torch's flame. Unlit, like
 * the wall torch's stick: its own light burns a hand over the cup and would wash it white. Casts no shadow either, or
 * the cup would shade the floor around it.
 */
function createStandingTorchMesh():THREE.Group {
	const g = new THREE.Group();
	g.userData.kind = 'torch';
	const iron = new THREE.MeshBasicMaterial({ color: 0x2e2620 });
	const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.08, 8).translate(0, 0.04, 0), iron);
	const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.34, 7).translate(0, 0.75, 0), new THREE.MeshBasicMaterial({ color: 0x4a2e18 }));
	const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.06, 0.12, 8).translate(0, 1.48, 0), iron);
	g.add(foot, pole, cup);

	const flame = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.38), flameMaterial(getSheet().flame[0]));
	flame.name = 'flame';
	flame.position.y = 1.7;
	flame.renderOrder = 2;
	g.add(flame);
	g.userData.flame = flame;
	return g;
}

function barrelLidGeometry(radius:number, width:number, segs = 12):THREE.BufferGeometry {
	const pos:number[] = [];
	const uv:number[] = [];
	const idx:number[] = [];
	const hw = width * 0.5;
	for (let i = 0; i <= segs; i++) {
		const t = i / segs;
		const ang = Math.PI * t;
		const y = Math.sin(ang) * radius;
		const z = Math.cos(ang) * radius;
		pos.push(-hw, y, z, hw, y, z);
		uv.push(0, 1 - t, 1, 1 - t);
	}
	for (let i = 0; i < segs; i++) {
		const a = i * 2;
		idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	geo.setIndex(idx);
	geo.computeVertexNormals();
	return geo;
}

export function createChestMesh():THREE.Group {
	const faces = getSheet().chest;
	const nrm = getSheet().chestN;
	const met = getSheet().chestM;
	const g = new THREE.Group();
	g.userData.kind = 'chest';

	const width = 0.68;
	const depth = 0.44;
	const bodyH = 0.26;
	const radius = depth * 0.5;

	const body = new THREE.Mesh(
		new THREE.BoxGeometry(width, bodyH, depth),
		[
			chestMaterial(faces.right, { normalMap: nrm.right, metalnessMap: met.right }),
			chestMaterial(faces.left, { normalMap: nrm.left, metalnessMap: met.left }),
			chestMaterial(faces.bottom, { normalMap: nrm.bottom, metalnessMap: met.bottom }),
			chestMaterial(faces.bottom, { normalMap: nrm.bottom, metalnessMap: met.bottom }),
			chestMaterial(faces.back, { normalMap: nrm.back, metalnessMap: met.back }),
			chestMaterial(faces.front, { normalMap: nrm.front, metalnessMap: met.front }),
		],
	);
	body.position.y = bodyH * 0.5;
	body.castShadow = true;
	body.receiveShadow = false;
	g.add(body);

	const lid = new THREE.Mesh(barrelLidGeometry(radius, width), chestMaterial(faces.lid, { normalMap: nrm.lid, metalnessMap: met.lid }));
	lid.name = 'lid';
	lid.position.y = bodyH - 0.004;
	lid.castShadow = true;
	lid.receiveShadow = false;
	g.add(lid);

	const endGeo = new THREE.PlaneGeometry(depth, radius);
	const endL = new THREE.Mesh(endGeo, chestMaterial(faces.lidEndL, { alpha: true, normalMap: nrm.lidEndL, metalnessMap: met.lidEndL }));
	endL.position.set(-width * 0.5 + 0.001, bodyH + radius * 0.5 - 0.004, 0);
	endL.rotation.y = -Math.PI / 2;
	g.add(endL);
	const endR = new THREE.Mesh(endGeo, chestMaterial(faces.lidEndR, { alpha: true, normalMap: nrm.lidEndR, metalnessMap: met.lidEndR }));
	endR.position.set(width * 0.5 - 0.001, bodyH + radius * 0.5 - 0.004, 0);
	endR.rotation.y = Math.PI / 2;
	g.add(endR);

	return g;
}

const ITEM_HEIGHT:Record<string, number> = {
	'item_key': 0.42,
	'item_bomb': 0.36,
	'item_sword': 0.52,
	'item_torch': 0.5,
	'item_potion': 0.28,
	'item_glove': 0.34,
	'item_shield': 0.38,
	'item_pack': 0.36,
};

function itemTorchProp(h:number):THREE.Group {
	const sheet = getSheet();
	const g = new THREE.Group();
	g.userData.kind = 'item';
	const stickImg = sheet.torchStick.image as HTMLCanvasElement | undefined;
	const aspect = stickImg && stickImg.height > 0 ? stickImg.width / stickImg.height : 0.68;
	const stickH = h * 0.72;
	const stick = new THREE.Mesh(
		spritePlane(stickH * aspect, stickH),
		unlitSpriteMaterial(sheet.torchStick),
	);
	stick.name = 'sprite';
	stick.position.y = stickH * 0.5 + 0.02;
	stick.castShadow = false;
	g.add(stick);
	const fh = stickH * 0.9;
	const flame = new THREE.Mesh(
		spritePlane(fh * 0.88, fh),
		flameMaterial(sheet.flame[0]),
	);
	flame.name = 'flame';
	flame.position.set(0, stickH * 0.52, 0.01);
	flame.castShadow = false;
	flame.renderOrder = 2;
	flame.visible = false;
	stick.add(flame);
	const blob = new THREE.Mesh(
		new THREE.CylinderGeometry(0.1, 0.12, 0.04, 8),
		toon(0x000000, { colorWrite: false, depthWrite: false }),
	);
	blob.position.y = 0.02;
	blob.castShadow = true;
	blob.receiveShadow = false;
	g.add(blob);
	g.userData.sprite = stick;
	g.userData.flame = flame;
	g.userData.itemH = stickH;
	return g;
}

/**
 * A torch to carry, standing up its +Y (for `holdInHand`): stick, pitch-soaked wrap, and two
 * crossed flame cards (`userData.flame`, hidden until lit), so it reads from any side without
 * turning to the camera.
 */
function heldTorchMesh():THREE.Group {
	const g = new THREE.Group();
	const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.5, 6).translate(0, 0.25, 0), toon(0x7a4e2a));
	const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.03, 0.1, 7).translate(0, 0.49, 0), toon(0x3a2a1e));
	stick.castShadow = true;
	wrap.castShadow = true;
	g.add(stick, wrap);
	const mat = flameMaterial(getSheet().flame[0]!);
	const flame = new THREE.Group();
	for (const turn of [0, Math.PI / 2]) {
		const card = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.3), mat);
		card.rotation.y = turn;
		card.renderOrder = 2;
		flame.add(card);
	}
	flame.position.y = 0.66;
	flame.visible = false;
	g.add(flame);
	g.userData.flame = flame;
	g.userData.flameMaterial = mat;
	return g;
}

function fireMushroom():THREE.Group {
	const g = new THREE.Group();
	g.userData.kind = 'item';
	const body = new THREE.Group();
	body.name = 'body';

	const stemMat = toon(0xf0d0a4);
	const stem = new THREE.Mesh(lathe([
		{ r: 0.05, y: 0 },
		{ r: 0.07, y: 0.06 },
		{ r: 0.078, y: 0.16 },
		{ r: 0.055, y: 0.22 },
	], 10), stemMat);
	stem.castShadow = true;
	stem.receiveShadow = true;
	stem.userData.lockColor = true;
	body.add(stem);

	const capMat = toon(0xe07030);
	const cap = new THREE.Mesh(lathe([
		{ r: 0.06, y: 0.18 },
		{ r: 0.22, y: 0.22 },
		{ r: 0.26, y: 0.28 },
		{ r: 0.2, y: 0.36 },
		{ r: 0.1, y: 0.42 },
		{ r: 0.02, y: 0.46 },
	], 14), capMat);
	cap.castShadow = true;
	cap.receiveShadow = true;
	body.add(cap);

	const spotMat = toon(0xffe6b0, { outline: false });
	const sources = [
		[0.1, 0.4, 0.05],
		[-0.08, 0.42, 0.08],
		[0.02, 0.44, -0.09],
		[-0.11, 0.36, -0.04],
		[0.13, 0.34, -0.02],
	].map(([x, y, z]) => new THREE.SphereGeometry(0.036, 6, 4).translate(x ?? 0, y ?? 0, z ?? 0));
	const spots = new THREE.Mesh(mergeParts(sources.map((geo):PosedPart => ({ geo }))), spotMat);
	for (const geo of sources) {
		geo.dispose();
	}
	spots.userData.lockColor = true;
	body.add(spots);

	g.add(body);
	g.userData.body = body;
	g.userData.shine = [capMat, stemMat, spotMat];
	return g;
}

function itemProp(meshID:string):THREE.Group {
	const h = ITEM_HEIGHT[meshID] ?? 0.36;
	if (meshID === 'item_mushroom') {
		return fireMushroom();
	}
	const ware = goodsMesh(meshID);
	if (ware) {
		return ware;
	}
	if (meshID === 'item_torch') {
		return itemTorchProp(h);
	}
	const sheet = getSheet();
	const g = new THREE.Group();
	g.userData.kind = 'item';
	const maps = sheet.items[meshID] ?? sheet.items['item_key'];
	const img = maps.map.image as HTMLCanvasElement;
	const aspect = img.height > 0 ? img.width / img.height : 1;
	const sprite = new THREE.Mesh(
		spritePlane(h * aspect, h),
		spriteMaterial(maps.map, maps.nrm, maps.met),
	);
	sprite.name = 'sprite';
	sprite.position.y = h * 0.5 + 0.02;
	sprite.castShadow = false;
	sprite.receiveShadow = true;
	g.add(sprite);
	const blob = new THREE.Mesh(
		new THREE.CylinderGeometry(0.1, 0.12, 0.04, 8),
		toon(0x000000, { colorWrite: false, depthWrite: false }),
	);
	blob.position.y = 0.02;
	blob.castShadow = true;
	blob.receiveShadow = false;
	g.add(blob);
	g.userData.sprite = sprite;
	g.userData.itemH = h;
	return g;
}

export const DOOR_LEAF_W = 0.86;
export const DOOR_LEAF_T = 0.1;
export const DOOR_LEAF_H = 2.12;

export function createDoorMesh():THREE.Group {
	const g = new THREE.Group();
	g.userData.kind = 'door';
	const frameMat = toon(0x3a2416);
	const leafMat = toon(0x6b3f22);
	const post = new THREE.BoxGeometry(0.12, 2.22, 0.12);
	const left = new THREE.Mesh(post, frameMat);
	left.position.set(0, 1.11, -0.47);
	left.castShadow = true;
	left.receiveShadow = true;
	g.add(left);
	const right = new THREE.Mesh(post, frameMat);
	right.position.set(0, 1.11, 0.47);
	right.castShadow = true;
	right.receiveShadow = true;
	g.add(right);
	const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1), frameMat);
	lintel.position.set(0, 2.16, 0);
	lintel.castShadow = true;
	lintel.receiveShadow = true;
	g.add(lintel);

	const hinge = new THREE.Group();
	hinge.name = 'hinge';
	hinge.position.set(0, 0, -DOOR_LEAF_W * 0.5);
	const leaf = new THREE.Mesh(
		new THREE.BoxGeometry(DOOR_LEAF_T, DOOR_LEAF_H, DOOR_LEAF_W),
		leafMat,
	);
	leaf.position.set(-DOOR_LEAF_T * 0.5, DOOR_LEAF_H * 0.5, DOOR_LEAF_W * 0.5);
	leaf.castShadow = true;
	leaf.receiveShadow = true;
	hinge.add(leaf);
	g.add(hinge);
	const occ = new THREE.Mesh(
		new THREE.PlaneGeometry(0.98, DOOR_LEAF_H),
		toon(0x000000, { colorWrite: false, side: THREE.DoubleSide }),
	);
	occ.name = 'doorOccluder';
	occ.rotation.y = Math.PI / 2;
	occ.position.y = DOOR_LEAF_H * 0.5;
	occ.castShadow = true;
	occ.receiveShadow = false;
	g.add(occ);
	g.userData.hinge = hinge;
	return g;
}

function createHearthMesh():THREE.Group {
	const g = new THREE.Group();
	g.userData.kind = 'hearth';
	const base = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.28, 0.85), toon(0x4a4540));
	base.position.y = 0.14;
	base.castShadow = true;
	base.receiveShadow = true;
	g.add(base);
	const pit = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.12, 0.52), toon(0x2a1810, { emissive: 0x3a1808, emissiveIntensity: 0.45 }));
	pit.position.y = 0.3;
	g.add(pit);
	const rim = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.16, 0.7), toon(0x5a5248));
	rim.position.y = 0.36;
	rim.castShadow = true;
	g.add(rim);
	return g;
}

function createCotMesh():THREE.Group {
	const g = new THREE.Group();
	g.userData.kind = 'cot';
	const frame = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.12, 0.62), toon(0x6b4423));
	frame.position.y = 0.18;
	frame.castShadow = true;
	frame.receiveShadow = true;
	g.add(frame);
	const cloth = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.08, 0.52), toon(0x8a7a62));
	cloth.position.y = 0.26;
	g.add(cloth);
	const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.36), toon(0xc4b89a));
	pillow.position.set(-0.42, 0.32, 0);
	g.add(pillow);
	return g;
}

/** Per-mesh stall look. `bench` adds a seat behind the counter (restaurant stalls). */
type StallStyle = { canvas:number; stripe:number; bench?:boolean };

const STALL_STYLES:Record<string, StallStyle> = {
	stall: { canvas: 0xd45a3a, stripe: 0xf0e0a8 },
	stall_baker: { canvas: 0xd45a3a, stripe: 0xf0e0a8 },
	stall_pink: { canvas: 0xc45a8a, stripe: 0xf5d4dc },
	stall_weaver: { canvas: 0xc45a8a, stripe: 0xf5d4dc },
	stall_yellow: { canvas: 0xe8c040, stripe: 0xfff3c0 },
	stall_potter: { canvas: 0xe8c040, stripe: 0xfff3c0 },
	stall_blue: { canvas: 0x4a7ec8, stripe: 0xe8f0f8 },
	stall_cutler: { canvas: 0x4a7ec8, stripe: 0xe8f0f8 },
	stall_green: { canvas: 0x5aaa5a, stripe: 0xd8f0c8 },
};

function stallStyle(meshID:string):StallStyle {
	return STALL_STYLES[meshID] ?? STALL_STYLES.stall;
}

function isStallMesh(meshID:string):boolean {
	return meshID === 'stall' || meshID.startsWith('stall_');
}

/** Uniform scale on the whole stall mesh. */
export const STALL_SCALE = 1.1;
const STALL_W = 1.5;
const STALL_D = 0.6;
const COUNTER_Z = 0.12;
const COUNTER_H = 0.86;

/** The counter solid, in meters. `z` is the local offset toward the customer (+Z). */
export const STALL_COUNTER = {
	w: (STALL_W + 0.14) * STALL_SCALE,
	h: COUNTER_H * STALL_SCALE,
	d: (STALL_D + 0.12) * STALL_SCALE,
	z: COUNTER_Z * STALL_SCALE,
};
const BACK_Z = -0.5;
const FRONT_Z = 0.62;
const BACK_H = 2.0;
const FRONT_H = 1.62;
/** How far the awning reaches past the posts on each side, over the merchant and the customer. */
const EAVE = 0.6;
const ROOF_BACK_Z = BACK_Z - EAVE;
const ROOF_FRONT_Z = FRONT_Z + EAVE;

/** Awning height over the back and front posts, continued as one plane past both. */
function roofPlaneY(z:number):number {
	return BACK_H + 0.04 + (FRONT_H + 0.02 - BACK_H) * (z - BACK_Z) / (FRONT_Z + 0.08 - BACK_Z);
}

/** How far the canvas sags at its middle. */
const AWNING_SAG = 0.12;

/** Across-stall depth along the awning, 0 at the back edge and 1 at the front edge. */
function roofV(z:number):number {
	return (z - ROOF_BACK_Z) / (ROOF_FRONT_Z - ROOF_BACK_Z);
}

/** Centre Y of a 6 cm cross beam at `z`, clear of the canvas where it sags lowest. */
function beamY(z:number):number {
	return roofPlaneY(z) - AWNING_SAG * Math.sin(Math.PI * roofV(z)) - 0.06;
}

/**
 * Striped canvas from past the back posts (over the merchant) down past the front posts,
 * sagging between its edges, with a valance of rounded tongues, one per stripe, on both edges.
 */
function stripedAwning(paint:StallStyle):THREE.BufferGeometry {
	const stripes = 7;
	const width = STALL_W + 0.24;
	const nu = 3;
	const nz = 8;
	const valance = 0.22;
	const pos:number[] = [];
	const col:number[] = [];
	const idx:number[] = [];
	const colors = [new THREE.Color(paint.canvas), new THREE.Color(paint.stripe)];
	const roofZ = (v:number):number => ROOF_BACK_Z + (ROOF_FRONT_Z - ROOF_BACK_Z) * v;
	const roofY = (u:number, v:number):number => roofPlaneY(roofZ(v)) - AWNING_SAG * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
	for (let s = 0; s < stripes; s++) {
		const c = colors[s % 2]!;
		const base = pos.length / 3;
		const rows:number[][] = [];
		const vertex = (x:number, y:number, z:number):number => {
			pos.push(x, y, z);
			col.push(c.r, c.g, c.b);
			return pos.length / 3 - 1 - base;
		};
		const valanceRow = (v:number, t:number, z:number):number[] => Array.from({ length: nu + 1 }, (_, i) => {
			const u = (s + i / nu) / stripes;
			const tongue = t < 1 ? 1 : 0.5 + 0.5 * Math.sin(Math.PI * (i / nu));
			return vertex((u - 0.5) * width, roofY(u, v) - valance * t * tongue, z);
		});
		rows.push(valanceRow(0, 1, ROOF_BACK_Z - 0.005), valanceRow(0, 0.5, ROOF_BACK_Z - 0.005));
		for (let j = 0; j <= nz; j++) {
			const v = j / nz;
			rows.push(Array.from({ length: nu + 1 }, (_, i) => {
				const u = (s + i / nu) / stripes;
				return vertex((u - 0.5) * width, roofY(u, v), roofZ(v));
			}));
		}
		rows.push(valanceRow(1, 0.5, ROOF_FRONT_Z + 0.005), valanceRow(1, 1, ROOF_FRONT_Z + 0.005));
		for (let j = 0; j < rows.length - 1; j++) {
			for (let i = 0; i < nu; i++) {
				const a = base + rows[j]![i]!;
				const b = base + rows[j]![i + 1]!;
				const d = base + rows[j + 1]![i]!;
				const e = base + rows[j + 1]![i + 1]!;
				idx.push(a, d, b, b, d, e);
			}
		}
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
	geo.setIndex(idx);
	geo.computeVertexNormals();
	return geo;
}

function box(w:number, h:number, d:number):THREE.BoxGeometry {
	return new THREE.BoxGeometry(w, h, d);
}

/**
 * Market stall facing +Z (the customer): a plank counter, corner posts,
 * and a striped, scalloped awning. `items` are mesh ids on the counter.
 * Omit them and the stall shows its own stock.
 */
function createStallMesh(meshID = 'stall', items?:readonly string[]):THREE.Group {
	const g = new THREE.Group();
	g.userData.kind = 'stall';
	const style = stallStyle(meshID);
	const boards = toon(PALETTE.wood, { pattern: 'plank', patternScale: 0.1, patternInk: 0.4 });
	const dark = toon(PALETTE.woodDark);
	const canvas = toon(0xffffff, { vertexColors: true, side: THREE.DoubleSide, rim: 0.15 });
	const add = (geo:THREE.BufferGeometry, mat:THREE.Material):void => {
		const mesh = new THREE.Mesh(geo, mat);
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		g.add(mesh);
	};
	const hw = STALL_W * 0.5;
	const cz = COUNTER_Z;
	add(mergeParts([
		{ geo: box(STALL_W, 0.8, 0.05), y: 0.4, z: cz + STALL_D * 0.5 },
		{ geo: box(0.05, 0.8, STALL_D), x: -hw, y: 0.4, z: cz },
		{ geo: box(0.05, 0.8, STALL_D), x: hw, y: 0.4, z: cz },
		{ geo: box(STALL_W + 0.14, 0.06, STALL_D + 0.12), y: COUNTER_H - 0.03, z: cz },
		// A bench seat on the merchant's side, or a closed panel like the customer's side.
		style.bench
			? { geo: box(STALL_W - 0.1, 0.04, 0.3), y: 0.55, z: BACK_Z + 0.2 }
			: { geo: box(STALL_W, 0.8, 0.05), y: 0.4, z: cz - STALL_D * 0.5 },
	]), boards);
	const backPost = box(0.08, BACK_H, 0.08);
	const frontPost = box(0.08, FRONT_H, 0.08);
	const px = hw + 0.06;
	// Eave beam under the awning past a row of posts, held by a diagonal brace off each post.
	const eave = (postZ:number, postH:number, eaveZ:number):PosedPart[] => {
		const eaveY = beamY(eaveZ);
		const braceY = postH - 0.5;
		const brace = box(0.05, Math.hypot(eaveZ - postZ, eaveY - braceY), 0.05);
		const rx = Math.atan2(eaveZ - postZ, eaveY - braceY);
		return [
			{ geo: box(STALL_W + 0.2, 0.06, 0.06), y: eaveY, z: eaveZ },
			...[-px, px].map((x) => ({ geo: brace, x, y: (braceY + eaveY) * 0.5, z: (postZ + eaveZ) * 0.5, rx })),
		];
	};
	add(mergeParts([
		{ geo: backPost, x: -px, y: BACK_H * 0.5, z: BACK_Z },
		{ geo: backPost, x: px, y: BACK_H * 0.5, z: BACK_Z },
		{ geo: frontPost, x: -px, y: FRONT_H * 0.5, z: FRONT_Z },
		{ geo: frontPost, x: px, y: FRONT_H * 0.5, z: FRONT_Z },
		{ geo: box(STALL_W + 0.2, 0.06, 0.06), y: beamY(BACK_Z), z: BACK_Z },
		{ geo: box(STALL_W + 0.2, 0.06, 0.06), y: beamY(FRONT_Z), z: FRONT_Z },
		...(style.bench ? [-hw + 0.1, hw - 0.1].map((x) => ({ geo: box(0.05, 0.55, 0.05), x, y: 0.28, z: BACK_Z + 0.2 })) : []),
		...eave(BACK_Z, BACK_H, ROOF_BACK_Z + 0.08),
		...eave(FRONT_Z, FRONT_H, ROOF_FRONT_Z - 0.08),
	]), dark);
	add(stripedAwning(style), canvas);
	placeWares(g, items ?? waresForMesh(meshID));
	g.scale.setScalar(STALL_SCALE);
	return g;
}

/** Goods on the counter, in the stall's local frame (before the stall scale). */
function placeWares(g:THREE.Group, ids:readonly string[]):void {
	const n = ids.length;
	if (n === 0) {
		return;
	}
	const span = Math.min(1.15, 0.36 * (n - 1));
	ids.forEach((id, i) => {
		const ware = goodsMesh(id);
		if (!ware) {
			return;
		}
		const x = n === 1 ? 0 : -span / 2 + (span * i) / (n - 1);
		ware.position.set(x, 0.86, 0.2);
		ware.rotation.y = (i - (n - 1) / 2) * 0.4;
		g.add(ware);
	});
}

/**
 * A web strung across a corridor, in its XY plane: a pale sheet behind spokes from the middle to the walls and
 * a few rings. Wide enough to meet both walls of a one-cell passage.
 */
function createCobwebMesh():THREE.Group {
	const g = new THREE.Group();
	const silk = toon(0xe8e6ee, { rim: 0.4 });
	const sheetMat = toon(0xd8d6e0, { transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, outline: false });
	const center = { x: 0.05, y: 1.15 };
	const spokes = 9;
	const ends = Array.from({ length: spokes }, (_, i) => {
		const a = (i / spokes) * Math.PI * 2 + 0.2;
		return { x: Math.max(-0.5, Math.min(0.5, Math.cos(a) * 0.9)), y: Math.max(0.02, Math.min(2.3, center.y + Math.sin(a) * 1.3)) };
	});
	const parts:PosedPart[] = ends.map((end) => ({ geo: tube([{ x: center.x, y: center.y, z: 0 }, { x: end.x, y: end.y, z: 0 }], 0.008, 3) }));
	for (const t of [0.3, 0.55, 0.8]) {
		const ring = ends.map((end) => ({ x: center.x + (end.x - center.x) * t, y: center.y + (end.y - center.y) * t, z: 0 }));
		parts.push({ geo: tube([...ring, ring[0]!], 0.006, 3) });
	}
	const strands = new THREE.Mesh(mergeParts(parts), silk);
	g.add(strands);
	const sheet = new THREE.Mesh(new THREE.PlaneGeometry(1, 2.3), sheetMat);
	sheet.position.y = 1.15;
	g.add(sheet);
	return g;
}

/** An upright carved stone, its words cut in rows on the face toward +Z. */
function createTabletMesh():THREE.Group {
	const g = new THREE.Group();
	const stone = toon(PALETTE.wall, { pattern: 'stone', patternScale: 0.2, patternInk: 0.4 });
	const carving = toon(0x2a2622, { outline: false });
	const slab = new THREE.Mesh(bevelBox(0.7, 1.15, 0.16, 0.04), stone);
	slab.castShadow = true;
	slab.receiveShadow = true;
	g.add(slab);
	const base = new THREE.Mesh(bevelBox(0.86, 0.14, 0.3, 0.03), stone);
	base.castShadow = true;
	g.add(base);
	const rows = [0.95, 0.83, 0.71, 0.59, 0.47, 0.35];
	g.add(new THREE.Mesh(mergeParts(rows.map((y, i) => ({ geo: new THREE.BoxGeometry(0.5 - (i % 3) * 0.08, 0.035, 0.01), y, z: 0.082 }))), carving));
	return g;
}

/** Prop parts as one object of its own, for things that stand in the world (a pillar for cover). */
function partsMesh(parts:PropPart[]):THREE.Group {
	const g = new THREE.Group();
	for (const part of parts) {
		const mesh = new THREE.Mesh(part.geom, part.mat);
		mesh.position.set(part.x, part.y, part.z);
		mesh.rotation.set(part.rx, part.ry, part.rz, 'YXZ');
		mesh.castShadow = part.cast;
		mesh.receiveShadow = true;
		g.add(mesh);
	}
	return g;
}

const sharedProps = new Set([
	'pillar',
	'pillar_broken',
	'tree_oak',
	'tree_pine',
	'boulder',
	'stall',
]);
const propTemplates = new Map<string, THREE.Object3D>();

function copyDepthMats(src:THREE.Object3D, dst:THREE.Object3D):void {
	const sm = src as THREE.Mesh;
	const dm = dst as THREE.Mesh;
	if (sm.customDepthMaterial) {
		dm.customDepthMaterial = sm.customDepthMaterial;
	}
	const n = Math.min(src.children.length, dst.children.length);
	for (let i = 0; i < n; i++) {
		copyDepthMats(src.children[i], dst.children[i]);
	}
}

function cloneProp(meshID:string, build:()=>THREE.Object3D):THREE.Object3D {
	let template = propTemplates.get(meshID);
	if (!template) {
		template = build();
		propTemplates.set(meshID, template);
	}
	const inst = template.clone(true);
	copyDepthMats(template, inst);
	return inst;
}

export function createMesh(meshID:string, color?:number, items?:readonly string[]):THREE.Object3D {
	if (items !== undefined && isStallMesh(meshID)) {
		return createStallMesh(meshID, items);
	}
	if (sharedProps.has(meshID) || isStallMesh(meshID)) {
		return cloneProp(meshID, () => buildMesh(meshID, color));
	}
	return buildMesh(meshID, color);
}

function buildMesh(meshID:string, color?:number):THREE.Object3D {
	if (isStallMesh(meshID)) {
		return createStallMesh(meshID);
	}
	switch (meshID) {
		case 'torch':
			return createTorchMesh();
		case 'torch_stand':
			return createStandingTorchMesh();
		case 'chest':
			return createChestMesh();
		case 'door':
			return createDoorMesh();
		case 'cottage':
			return createCottageMesh();
		case 'tree_oak':
			return createTreeMesh('oak');
		case 'tree_pine':
			return createTreeMesh('pine');
		case 'boulder':
			return createBoulderMesh();
		case 'bridge':
			return createBridgeMesh();
		case 'waterfall':
			return createWaterfallMesh();
		case 'bridge_lever':
			return createLeverMesh();
		case 'hearth':
			return createHearthMesh();
		case 'cot':
			return createCotMesh();
		case 'held_torch':
			return heldTorchMesh();
		case 'cobweb':
			return createCobwebMesh();
		case 'stone_tablet':
			return createTabletMesh();
		case 'pillar':
			return partsMesh(columnParts(false));
		case 'pillar_broken':
			return partsMesh(columnParts(true));
		default: {
			if (meshID.startsWith('item_')) {
				return itemProp(meshID);
			}
			const cube = new THREE.Mesh(
				new THREE.BoxGeometry(0.4, 0.4, 0.4),
				toon(color ?? 0x888888),
			);
			cube.position.y = 0.2;
			cube.castShadow = true;
			return cube;
		}
	}
}

if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		propTemplates.clear();
	});
}
