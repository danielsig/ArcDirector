import * as THREE from 'three';
import { chestMaterial, flameMaterial, getSheet, sheetReady, spriteMaterial, unlitSpriteMaterial } from './spritesheet';
import { natureReady } from './nature';
import {
	createBoulderMesh,
	createBridgeMesh,
	createRoofMesh,
	createLeverMesh,
	createTreeMesh,
	createWaterfallMesh,
} from './natureMeshes';
import { bevelBox, lathe, mergeParts, tube, type PosedPart } from '@arc-director/kindling';
import { moonlitStoneMat, PALETTE, plankMat, toon } from './toon';
import { CELL_SIZE, MOON_BLUE, MOON_WINDOW } from '../world/constants';
import { columnParts, type PropPart } from './props';
import { goodsMesh, isGoodsMesh } from './goods';
import { waresForMesh } from '../items/wares';
import type { RoofStyle, Wake } from '../world/decodeGlyphChunk';


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

const ROOF = 'roof:';

const RIVER_BOULDER = 'river_boulder:';

/** The mesh of a boulder standing in water, its ripples trailing along `wake` (none: the current's, or all round). */
export function riverBoulderMeshID(wake:Wake = { x: 0, z: 0 }):string {
	return `${RIVER_BOULDER}${wake.x},${wake.z},${wake.spread ?? 1}`;
}

/** The mesh of a house's roof over a wall line `w` × `d` meters (X × Z), in `style`, with or without a chimney. */
export function roofMeshID(w:number, d:number, style:RoofStyle = 'thatch', chimney = true):string {
	return `${ROOF}${w}x${d}:${style}:${chimney ? 'chimney' : 'bare'}`;
}

/** A fishing rod 2.2 m long, butt at the origin, up +Y: a cork grip, a little reel, a cane tapering to the tip. */
function fishingRodMesh():THREE.Object3D {
	const g = new THREE.Group();
	const cane = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.016, 1.9, 6).translate(0, 1.25, 0), toon(0x6b4a2a));
	const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.32, 8).translate(0, 0.16, 0), toon(0xc49a62));
	const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 10).rotateZ(Math.PI / 2).translate(0.04, 0.36, 0), toon(0x3a3a42));
	for (const part of [cane, cork, reel]) {
		part.castShadow = true;
		g.add(part);
	}
	return g;
}

export function meshReady(meshID:string):boolean {
	if (
		meshID === 'tree_oak' || meshID === 'tree_pine' || meshID === 'boulder' || meshID.startsWith(RIVER_BOULDER)
		|| meshID === 'bridge' || meshID === 'waterfall' || meshID === 'bridge_lever'
		|| meshID.startsWith(ROOF)
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

/**
 * A half disc standing up in its XY plane, flat edge on y = 0: a barrel lid's end. Its texture spans it whole, the
 * bottom of the picture along the flat edge and the top at the crown.
 */
function halfDiscGeometry(radius:number, segs = 12):THREE.BufferGeometry {
	const pos:number[] = [0, 0, 0];
	const uv:number[] = [0.5, 0];
	const idx:number[] = [];
	for (let i = 0; i <= segs; i++) {
		const ang = Math.PI * (i / segs);
		const x = Math.cos(ang) * radius;
		const y = Math.sin(ang) * radius;
		pos.push(x, y, 0);
		uv.push((x / radius + 1) / 2, y / radius);
		if (i > 0) {
			idx.push(0, i, i + 1);
		}
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	geo.setIndex(idx);
	geo.computeVertexNormals();
	return geo;
}

/** The dark wood inside a chest, its rim, and nothing (the open top of its body). Shared by every chest. */
let chestInside:{ wood:THREE.Material; rim:THREE.Material; none:THREE.Material } | null = null;

export function createChestMesh():THREE.Group {
	const faces = getSheet().chest;
	const nrm = getSheet().chestN;
	const met = getSheet().chestM;
	chestInside ??= {
		wood: toon(0x2a1a10, { side: THREE.BackSide }),
		rim: toon(0x4a3b2c),
		none: new THREE.MeshBasicMaterial({ visible: false }),
	};
	const g = new THREE.Group();
	g.userData.kind = 'chest';

	const width = 0.68;
	const depth = 0.44;
	const bodyH = 0.26;
	const radius = depth * 0.5;
	/** How thick its walls are, as seen down into it open. */
	const wall = 0.035;

	// The body: four sides and a bottom outside, no top, so an open chest shows its hollow.
	const body = new THREE.Mesh(
		new THREE.BoxGeometry(width, bodyH, depth),
		[
			chestMaterial(faces.right, { normalMap: nrm.right, metalnessMap: met.right }),
			chestMaterial(faces.left, { normalMap: nrm.left, metalnessMap: met.left }),
			chestInside.none,
			chestMaterial(faces.bottom, { normalMap: nrm.bottom, metalnessMap: met.bottom }),
			chestMaterial(faces.back, { normalMap: nrm.back, metalnessMap: met.back }),
			chestMaterial(faces.front, { normalMap: nrm.front, metalnessMap: met.front }),
		],
	);
	body.position.y = bodyH * 0.5;
	body.castShadow = true;
	body.receiveShadow = false;
	g.add(body);

	// Inside: its walls and floor seen from within (the box's back faces), open at the top.
	const innerH = bodyH - wall;
	const inner = new THREE.Mesh(new THREE.BoxGeometry(width - wall * 2, innerH, depth - wall * 2), chestInside.wood);
	inner.position.y = wall + innerH * 0.5;
	g.add(inner);
	// The rim: the tops of its walls, between the outside and the hollow.
	const rimH = 0.01;
	const rims:[number, number, number, number][] = [
		[width, wall, 0, (depth - wall) * 0.5],
		[width, wall, 0, -(depth - wall) * 0.5],
		[wall, depth - wall * 2, (width - wall) * 0.5, 0],
		[wall, depth - wall * 2, -(width - wall) * 0.5, 0],
	];
	for (const [w, d, x, z] of rims) {
		const rim = new THREE.Mesh(new THREE.BoxGeometry(w, rimH, d), chestInside.rim);
		rim.position.set(x, bodyH - rimH * 0.5, z);
		g.add(rim);
	}

	// The lid and its two ends hang from a hinge along the back (+Z; the front is −Z), so opening swings them up as one.
	const hinge = new THREE.Group();
	hinge.name = 'lid';
	hinge.position.set(0, bodyH, radius);
	g.add(hinge);

	const lidGeo = barrelLidGeometry(radius, width);
	const lid = new THREE.Mesh(lidGeo, chestMaterial(faces.lid, { normalMap: nrm.lid, metalnessMap: met.lid }));
	lid.position.z = -radius;
	lid.castShadow = true;
	lid.receiveShadow = false;
	hinge.add(lid);
	// Its underside, plain dark wood, for when it stands open.
	const under = new THREE.Mesh(lidGeo, chestInside.wood);
	under.position.z = -radius;
	hinge.add(under);

	// Its ends: half discs that follow the lid's curve, the lid-end picture on each.
	const endGeo = halfDiscGeometry(radius);
	for (const [side, map, normalMap, metalnessMap] of [
		[-1, faces.lidEndL, nrm.lidEndL, met.lidEndL],
		[1, faces.lidEndR, nrm.lidEndR, met.lidEndR],
	] as const) {
		const end = new THREE.Mesh(endGeo, chestMaterial(map, { normalMap, metalnessMap }));
		end.material.side = THREE.DoubleSide;
		end.position.set(side * width * 0.5, 0, -radius);
		end.rotation.y = side * Math.PI / 2;
		end.castShadow = true;
		hinge.add(end);
	}

	return g;
}

const ITEM_HEIGHT:Record<string, number> = {
	'item_key': 0.42,
	'item_bomb': 0.36,
	'item_sword': 0.52,
	'item_potion': 0.28,
	'item_glove': 0.34,
	'item_shield': 0.38,
	'item_pack': 0.36,
};

/**
 * A torch's wood, standing up its +Y: the stick, and the pitch-soaked wrap at its head, `girth` times as thick as a
 * carried one. Fresh materials each.
 */
function torchWood(girth = 1):{ stick:THREE.Mesh; wrap:THREE.Mesh } {
	const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.018 * girth, 0.024 * girth, 0.5, 6).translate(0, 0.25, 0), toon(0x7a4e2a));
	const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.036 * girth, 0.03 * girth, 0.1, 7).translate(0, 0.49, 0), toon(0x3a2a1e));
	stick.castShadow = true;
	wrap.castShadow = true;
	return { stick, wrap };
}

/**
 * A torch to pick up, standing on its foot: the carried torch's wood, twice as thick so it reads from up high.
 * A 3D item (`userData.body`): pointed at, it pulses and glows like the others.
 */
function itemTorchProp():THREE.Group {
	const g = new THREE.Group();
	g.userData.kind = 'item';
	const { stick, wrap } = torchWood(2);
	const body = new THREE.Group();
	body.name = 'body';
	body.add(stick, wrap);
	g.add(body);
	g.userData.body = body;
	g.userData.shine = [stick.material, wrap.material];
	return g;
}

/**
 * A torch to carry, standing up its +Y (for `holdInHand`): stick, pitch-soaked wrap, and two
 * crossed flame cards (`userData.flame`, hidden until lit), so it reads from any side without
 * turning to the camera.
 */
function heldTorchMesh():THREE.Group {
	const g = new THREE.Group();
	const { stick, wrap } = torchWood();
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
		return itemTorchProp();
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

export function createDoorMesh(flipped = false):THREE.Group {
	const g = new THREE.Group();
	g.userData.kind = 'door';
	const frameMat = toon(0x3a2416);
	const leafMat = toon(0x6b3f22);
	const lintelMat = plankMat();
	const post = new THREE.BoxGeometry(0.12, 2.22, 0.12);
	const left = new THREE.Mesh(post, frameMat);
	left.position.set(0, 1, -0.47);
	left.castShadow = true;
	left.receiveShadow = true;
	g.add(left);
	const right = new THREE.Mesh(post, frameMat);
	right.position.set(0, 1, 0.47);
	right.castShadow = true;
	right.receiveShadow = true;
	g.add(right);
	const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.35, 1), lintelMat);
	lintel.position.set(0, 2.28, 0);
	lintel.castShadow = true;
	lintel.receiveShadow = true;
	g.add(lintel);

	const sign = flipped ? 1 : -1;
	const hinge = new THREE.Group();
	hinge.name = 'hinge';
	hinge.position.set(0, 0, DOOR_LEAF_W * 0.5 * sign);
	const leaf = new THREE.Mesh(
		new THREE.BoxGeometry(DOOR_LEAF_T, DOOR_LEAF_H, DOOR_LEAF_W),
		leafMat,
	);
	leaf.position.set(DOOR_LEAF_T * 0.5 * sign, DOOR_LEAF_H * 0.5, DOOR_LEAF_W * 0.5);
	leaf.castShadow = true;
	leaf.receiveShadow = true;
	hinge.add(leaf);
	g.add(hinge);
	const occH = DOOR_LEAF_H - 0.06;
	const occ = new THREE.Mesh(
		new THREE.PlaneGeometry(0.98, occH),
		toon(0x000000, { colorWrite: false, side: THREE.DoubleSide }),
	);
	occ.name = 'doorOccluder';
	occ.rotation.y = Math.PI / 2 * -sign;
	// Above the floor, so the sheet does not slice the threshold.
	occ.position.y = 0.06 + occH * 0.5;
	occ.castShadow = true;
	occ.receiveShadow = false;
	g.add(occ);
	g.userData.hinge = hinge;
	return g;
}

/** How far a gate's leaves swing: each on its own pier, flat against the wall outside when open. */
const GATE_LEAF_W = 0.44;
const GATE_H = 2.1;

/** One barred iron leaf of a gate, hung on a hinge at its own `z` edge: frame, bars, and spear tips along the top. */
function gateLeaf(hingeZ:number, sign:number):THREE.Group {
	const iron = toon(PALETTE.iron, { rim: 0.35 });
	const hinge = new THREE.Group();
	hinge.position.set(0, 0, hingeZ);
	const bar = 0.022;
	const z = (t:number):number => sign * t;
	const parts:PosedPart[] = [
		{ geo: box(0.04, GATE_H, 0.04), y: GATE_H * 0.5, z: z(0.02) },
		{ geo: box(0.04, GATE_H, 0.04), y: GATE_H * 0.5, z: z(GATE_LEAF_W - 0.02) },
		{ geo: box(0.035, 0.05, GATE_LEAF_W), y: 0.12, z: z(GATE_LEAF_W * 0.5) },
		{ geo: box(0.035, 0.05, GATE_LEAF_W), y: GATE_H - 0.32, z: z(GATE_LEAF_W * 0.5) },
		{ geo: box(0.035, 0.05, GATE_LEAF_W), y: 1.0, z: z(GATE_LEAF_W * 0.5) },
	];
	for (let i = 1; i <= 3; i++) {
		const t = (GATE_LEAF_W * i) / 4;
		parts.push({ geo: box(bar, GATE_H - 0.2, bar), y: (GATE_H - 0.2) * 0.5 + 0.1, z: z(t) });
		parts.push({ geo: new THREE.ConeGeometry(0.03, 0.12, 4), y: GATE_H - 0.04, z: z(t) });
	}
	const leaf = new THREE.Mesh(mergeParts(parts), iron);
	leaf.castShadow = true;
	leaf.receiveShadow = true;
	hinge.add(leaf);
	return hinge;
}

/**
 * A gate in a town wall, its passage along X: two stone piers with caps, an iron arch between them with a finial
 * on top, and a pair of barred leaves (`hinge`, `hinge2`) that swing out to lie flat against the wall when open.
 */
function createGateMesh():THREE.Group {
	const g = new THREE.Group();
	g.userData.kind = 'door';
	const stone = toon(PALETTE.wall, { pattern: 'stone', patternScale: 0.18, patternInk: 0.5 });
	const iron = toon(PALETTE.iron, { rim: 0.35 });
	const pierZ = 0.5 + 0.17;
	const piers:PosedPart[] = [-1, 1].flatMap((s) => [
		{ geo: box(0.44, 2.5, 0.34), y: 1.25, z: s * pierZ },
		{ geo: bevelBox(0.56, 0.14, 0.46, 0.03), y: 2.57, z: s * pierZ },
		{ geo: new THREE.ConeGeometry(0.2, 0.22, 4), y: 2.75, z: s * pierZ, ry: Math.PI / 4 },
	]);
	const masonry = new THREE.Mesh(mergeParts(piers), stone);
	masonry.castShadow = true;
	masonry.receiveShadow = true;
	g.add(masonry);
	// The arch: a half ring over the opening, between the pier caps, with a lantern hook at its crown.
	const arch = Array.from({ length: 9 }, (_, i) => {
		const a = (i / 8) * Math.PI;
		return { x: 0, y: 2.3 + Math.sin(a) * 0.5, z: -Math.cos(a) * 0.52 };
	});
	const ironwork = new THREE.Mesh(mergeParts([
		{ geo: tube(arch, 0.03, 6) },
		{ geo: tube([{ x: 0, y: 2.8, z: 0 }, { x: 0, y: 3.02, z: 0 }], 0.02, 5) },
		{ geo: new THREE.ConeGeometry(0.05, 0.14, 4), y: 3.08 },
	]), iron);
	ironwork.castShadow = true;
	g.add(ironwork);
	const left = gateLeaf(-0.5, 1);
	left.name = 'hinge';
	g.add(left);
	const right = gateLeaf(0.5, -1);
	right.name = 'hinge2';
	g.add(right);
	g.userData.hinge = left;
	g.userData.hinge2 = right;
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
export type StallStyle = { canvas:number; stripe:number; bench?:boolean; shelf?:boolean };

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
	stall_fruit: { canvas: 0x5aaa5a, stripe: 0xd8f0c8 },
};

/** Per-mesh shop counter look: the boards, the front panels' paint, and what lines the front. */
export type CounterStyle = { wood:number; shelf?:boolean; bench?:boolean };

const COUNTER_STYLES:Record<string, CounterStyle> = {
	counter_apothecary: { wood: 0x3e2a1e, shelf: true, bench: true },
	counter_toys: { wood: 0xc49a5a, shelf: true },
};

export function getPostStyle(meshID:string):StallStyle | CounterStyle {
	return STALL_STYLES[meshID] ?? COUNTER_STYLES[meshID] ?? STALL_STYLES.stall;
}

/** A seller's post: a stall in the square, or a counter indoors. Both lay the seller's wares out. */
function isPostMesh(meshID:string):boolean {
	return meshID === 'stall' || meshID.startsWith('stall_') || meshID.startsWith('counter_');
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
const BACK_Z = -0.3;
const FRONT_Z = 0.7;
const BACK_H = 1.92;
const FRONT_H = 2.3;
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
	const style = STALL_STYLES[meshID] ?? STALL_STYLES.stall;
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
		{ geo: box(STALL_W, 0.8, 0.05), y: 0.4, z: cz - STALL_D * 0.5 },
		{ geo: box(0.05, 0.8, STALL_D), x: -hw, y: 0.4, z: cz },
		{ geo: box(0.05, 0.8, STALL_D), x: hw, y: 0.4, z: cz },
		{ geo: box(STALL_W + 0.14, 0.06, STALL_D + 0.12), y: COUNTER_H - 0.03, z: cz },
		style.bench // A bench for customers
			? { geo: box(STALL_W + 0.05, 0.04, 0.35), y: 0.4, z: FRONT_Z - 0.15 }
			: { geo: box(STALL_W, 0.8, 0.05), y: 0.4, z: cz + STALL_D * 0.5 },
		...style.shelf // A shelf behind the counter
			? [ { geo: box(STALL_W + 0.05, 0.04, 0.2), y: 0.6, z: cz - STALL_D * 0.5 - 0.1 } ]
			: [],
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

/** A shop counter's mesh (a `counter_*` look) `width` meters long. */
export function counterMeshID(look:string, width:number):string {
	return `${look}:${Math.round(width * 100) / 100}`;
}

/**
 * A shop counter's mesh (a `counter_*` look) `width` meters long. `items` are mesh ids on the counter.
 * Omit them and the counter shows its own stock.
 */
function createCounterMesh(meshID:string, items?:readonly string[]):THREE.Group {
	const g = new THREE.Group();
	g.userData.kind = 'stall';
	const [look = meshID, length] = meshID.split(':');
	const width = length ? Number(length) / STALL_SCALE : STALL_W;
	const style = COUNTER_STYLES[look] ?? { wood: PALETTE.wood, panel: PALETTE.woodDark, trim: 0xb08a3a };
	const boards = toon(style.wood, { pattern: 'plank', patternScale: 0.1, patternInk: 0.4 });
	const add = (geo:THREE.BufferGeometry, mat:THREE.Material):void => {
		const mesh = new THREE.Mesh(geo, mat);
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		g.add(mesh);
	};
	const cz = COUNTER_Z;
	// The body: a closed box under a thick top that overhangs on the customer's side.
	add(mergeParts([
		{ geo: bevelBox(width + 0.16, 0.08, STALL_D + 0.16, 0.02), y: COUNTER_H - 0.04, z: cz + 0.02 },
		...style.bench // A bench for customers
			? [
				// the counter
				{ geo: box(width, 0.8, 0.05), y: 0.4, z: cz - STALL_D * 0.5 },
				{ geo: box(0.05, 0.8, STALL_D), x: -width * 0.5, y: 0.4, z: cz },
				{ geo: box(0.05, 0.8, STALL_D), x: width * 0.5, y: 0.4, z: cz },
				// the bench
				{ geo: box(width + 0.05, 0.4, 0.35), y: 0.2, z: FRONT_Z - 0.15 },
			]
			: [ { geo: box(width, COUNTER_H - 0.08, STALL_D), y: (COUNTER_H - 0.08) * 0.5, z: cz } ],
		...style.shelf // A shelf behind the counter
			? [ { geo: box(width, 0.04, 0.2), y: 0.6, z: cz - STALL_D * 0.5 - 0.1 } ]
			: [],
	]), boards);
	placeWares(g, items ?? waresForMesh(look));
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

/**
 * A barred window cut through its wall (the chunk mesh cuts the opening), its face toward +Z: iron bars across the
 * opening on the wall face, casting the moonlight's shadow, the opening's stone aglow with it, and a wall's thickness
 * back, night sky. Bars and sky unlit: the moonlight behind the bars would leave their faces dark. Centred on the opening; it sits on the wall face.
 */
function createMoonWindowMesh():THREE.Group {
	const g = new THREE.Group();
	const { width, height } = MOON_WINDOW;
	const sky = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ color: MOON_BLUE }));
	sky.position.z = 0.01 - CELL_SIZE;
	g.add(sky);
	// Lining the cut stone a hair in, so it glows where no light can be kept to: a lamp would light the wall round it.
	const lining = moonlitStoneMat();
	const inset = 0.004;
	for (const [across, along, x, y, rx, ry] of [
		[width, CELL_SIZE, 0, -height / 2 + inset, -Math.PI / 2, 0],
		[width, CELL_SIZE, 0, height / 2 - inset, Math.PI / 2, 0],
		[CELL_SIZE, height, -width / 2 + inset, 0, 0, Math.PI / 2],
		[CELL_SIZE, height, width / 2 - inset, 0, 0, -Math.PI / 2],
	] as const) {
		const face = new THREE.Mesh(new THREE.PlaneGeometry(across, along), lining);
		face.position.set(x, y, -CELL_SIZE / 2);
		face.rotation.set(rx, ry, 0);
		// The bars' shadows fall on it.
		face.receiveShadow = true;
		g.add(face);
	}
	// Set a little into the opening, their ends sunk in the stone above and below.
	const bars = 5;
	const end = height / 2 + 0.04;
	const parts:PosedPart[] = Array.from({ length: bars }, (_, i) => {
		const x = -width / 2 + ((i + 1) * width) / (bars + 1);
		return { geo: tube([{ x, y: -end, z: -0.08 }, { x, y: end, z: -0.08 }], 0.018, 6) };
	});
	const iron = new THREE.Mesh(mergeParts(parts), new THREE.MeshBasicMaterial({ color: 0x2a2622 }));
	iron.castShadow = true;
	g.add(iron);
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

/** A seller's post with `items` on it: a counter indoors, else a stall. */
function createPostMesh(meshID:string, items?:readonly string[]):THREE.Group {
	return meshID.startsWith('counter_') ? createCounterMesh(meshID, items) : createStallMesh(meshID, items);
}

export function createMesh(meshID:string, color?:number, items?:readonly string[]):THREE.Object3D {
	if (items !== undefined && isPostMesh(meshID)) {
		return createPostMesh(meshID, items);
	}
	if (sharedProps.has(meshID) || isPostMesh(meshID)) {
		return cloneProp(meshID, () => buildMesh(meshID, color));
	}
	return buildMesh(meshID, color);
}

function buildMesh(meshID:string, color?:number):THREE.Object3D {
	if (isPostMesh(meshID)) {
		return createPostMesh(meshID);
	}
	switch (meshID) {
		case 'torch':
			return createTorchMesh();
		case 'torch_stand':
			return createStandingTorchMesh();
		case 'chest':
			return createChestMesh();
		case 'door':
			return createDoorMesh(false);
		case 'door_flipped':
			return createDoorMesh(true);
		case 'gate':
			return createGateMesh();
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
		case 'fishing_rod':
			return fishingRodMesh();
		case 'cobweb':
			return createCobwebMesh();
		case 'stone_tablet':
			return createTabletMesh();
		case 'moon_window':
			return createMoonWindowMesh();
		case 'pillar':
			return partsMesh(columnParts(false));
		case 'pillar_broken':
			return partsMesh(columnParts(true));
		default: {
			if (meshID.startsWith(ROOF)) {
				const [size, style, chimney] = meshID.slice(ROOF.length).split(':');
				const [w, d] = size!.split('x').map(Number);
				return createRoofMesh(w! / 2, d! / 2, style as RoofStyle, chimney !== 'bare');
			}
			if (meshID.startsWith(RIVER_BOULDER)) {
				const [x, z, spread] = meshID.slice(RIVER_BOULDER.length).split(',').map(Number);
				return createBoulderMesh({ x: x!, z: z!, spread });
			}
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
