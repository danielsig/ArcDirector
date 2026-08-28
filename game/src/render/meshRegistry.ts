import * as THREE from 'three';
import { chestMaterial, flameMaterial, getSheet, sheetReady, spriteMaterial, unlitSpriteMaterial } from './spritesheet';
import { animIDFromMeshID, getHumanAnims, hasHumanAnims, pickClockMaps } from './humanAnims';
import { getSwordMaps, swordsReady } from './swordAnims';
import { natureReady } from './nature';
import {
	createBoulderMesh,
	createBridgeMesh,
	createCottageMesh,
	createLeverMesh,
	createTreeMesh,
	createWaterfallMesh,
} from './natureMeshes';

function std(color:number, extras:THREE.MeshStandardMaterialParameters = {}):THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({
		color,
		roughness: 0.88,
		metalness: 0.04,
		shadowSide: THREE.FrontSide,
		...extras,
	});
}

export const HUMAN_PLANE_W = 0.78;
export const HUMAN_PLANE_H = 1.22;

function spritePlane(w:number, h:number):THREE.PlaneGeometry {
	const geo = new THREE.PlaneGeometry(w, h);
	const pos = geo.getAttribute('position');
	const nrm = geo.getAttribute('normal');
	const n = new THREE.Vector3();
	for (let i = 0; i < pos.count; i++) {
		n.set(pos.getX(i), pos.getY(i), 0).normalize();
		if(n.y < 0) {
			n.y = 0.05;
			n.z = 0.1;
		} else {
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
export const HUMAN_SPRITE_SIZE = 1.25;
export const PLAYER_SPRITE_SIZE = 1.12;
/** Player-only X squeeze; hat-wide frames read chubby at square pixels. */
export const PLAYER_SPRITE_SLIM = 0.82;

export function meshReady(meshID:string):boolean {
	if (meshID === 'human' || meshID.startsWith('human_')) {
		return hasHumanAnims(animIDFromMeshID(meshID));
	}
	if (
		meshID === 'tree_oak' || meshID === 'tree_pine' || meshID === 'boulder'
		|| meshID === 'bridge' || meshID === 'waterfall' || meshID === 'mill_lever'
		|| meshID === 'cottage'
	) {
		return natureReady();
	}
	if (
		meshID === 'torch' || meshID === 'chest'
		|| meshID.startsWith('item_')
	) {
		return sheetReady();
	}
	return true;
}

export function createHumanMesh(animID = 'player'):THREE.Group {
	const anims = getHumanAnims(animID);
	const g = new THREE.Group();
	g.userData.kind = 'human';
	g.userData.animID = animID;

	const caster = new THREE.Mesh(
		new THREE.CylinderGeometry(0.18, 0.22, 1.05, 8),
		std(0x000000, { colorWrite: false, depthWrite: false }),
	);
	caster.name = 'shadowCaster';
	caster.position.y = 0.525;
	caster.castShadow = true;
	caster.receiveShadow = false;
	caster.frustumCulled = false;
	g.add(caster);

	const start = pickClockMaps(anims.clock, 6, false, 0, 8);
	const sprite = new THREE.Mesh(
		spritePlane(HUMAN_PLANE_W, HUMAN_PLANE_H),
		spriteMaterial(start.map, start.nrm),
	);
	sprite.name = 'sprite';
	sprite.position.y = 0.61;
	sprite.castShadow = false;
	sprite.receiveShadow = true;
	g.add(sprite);
	g.userData.sprite = sprite;
	addHeldSprite(sprite, 'heldLeft');
	addHeldSprite(sprite, 'heldRight');
	return g;
}

function addHeldSprite(sprite:THREE.Mesh, name:string):void {
	const maps = getSwordMaps(6);
	if (!maps) {
		return;
	}
	const held = new THREE.Mesh(
		spritePlane(1, 1),
		spriteMaterial(maps.map, maps.nrm),
	);
	held.name = name;
	held.visible = false;
	held.castShadow = false;
	held.receiveShadow = false;
	held.renderOrder = 1;
	(held.material as THREE.MeshLambertMaterial).depthWrite = false;
	sprite.add(held);
}

export function ensureHeldSprites(sprite:THREE.Mesh):void {
	if (sprite.getObjectByName('heldLeft') || !swordsReady()) {
		return;
	}
	addHeldSprite(sprite, 'heldLeft');
	addHeldSprite(sprite, 'heldRight');
}

function addTorchHolster(g:THREE.Group):void {
	const iron = std(0x8a7060, { roughness: 0.7, metalness: 0.18 });
	const wood = std(0x7a4e2a, { roughness: 0.9, metalness: 0 });
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

function itemProp(meshID:string):THREE.Group {
	const sheet = getSheet();
	const g = new THREE.Group();
	g.userData.kind = 'item';
	const maps = sheet.items[meshID] ?? sheet.items['item_key'];
	const img = maps.map.image as HTMLCanvasElement;
	const aspect = img.height > 0 ? img.width / img.height : 1;
	const h = ITEM_HEIGHT[meshID] ?? 0.36;
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
		std(0x000000, { colorWrite: false, depthWrite: false }),
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
	const frameMat = std(0x3a2416);
	const leafMat = std(0x6b3f22);
	const post = new THREE.BoxGeometry(0.12, 2.22, 0.12);
	const left = new THREE.Mesh(post, frameMat);
	left.position.set(0, 1.11, -0.47);
	left.castShadow = true;
	g.add(left);
	const right = new THREE.Mesh(post, frameMat);
	right.position.set(0, 1.11, 0.47);
	right.castShadow = true;
	g.add(right);
	const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1), frameMat);
	lintel.position.set(0, 2.16, 0);
	lintel.castShadow = true;
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
		new THREE.BoxGeometry(0.14, 2.35, 0.98),
		std(0x000000, { colorWrite: false }),
	);
	occ.name = 'doorOccluder';
	occ.position.y = 1.175;
	occ.castShadow = true;
	occ.receiveShadow = false;
	g.add(occ);
	g.userData.hinge = hinge;
	return g;
}

function createHearthMesh():THREE.Group {
	const g = new THREE.Group();
	g.userData.kind = 'hearth';
	const base = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.28, 0.85), std(0x4a4540));
	base.position.y = 0.14;
	base.castShadow = true;
	base.receiveShadow = true;
	g.add(base);
	const pit = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.12, 0.52), std(0x2a1810, { emissive: 0x3a1808, emissiveIntensity: 0.45 }));
	pit.position.y = 0.3;
	g.add(pit);
	const rim = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.16, 0.7), std(0x5a5248));
	rim.position.y = 0.36;
	rim.castShadow = true;
	g.add(rim);
	return g;
}

function createCotMesh():THREE.Group {
	const g = new THREE.Group();
	g.userData.kind = 'cot';
	const frame = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.12, 0.62), std(0x6b4423));
	frame.position.y = 0.18;
	frame.castShadow = true;
	frame.receiveShadow = true;
	g.add(frame);
	const cloth = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.08, 0.52), std(0x8a7a62));
	cloth.position.y = 0.26;
	g.add(cloth);
	const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.36), std(0xc4b89a));
	pillow.position.set(-0.42, 0.32, 0);
	g.add(pillow);
	return g;
}

function createStallMesh():THREE.Group {
	const g = new THREE.Group();
	g.userData.kind = 'stall';
	const wood = std(0x6b4423);
	const post = std(0x4a301c);
	const canvas = std(0xd45a3a, { roughness: 0.95 });
	const stripe = std(0xf0e0a8, { roughness: 0.95 });
	const cloth = std(0xc43a32, { roughness: 0.98, side: THREE.DoubleSide });
	const top = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.08, 0.64), wood);
	top.position.set(0, 0.5, -0.12);
	top.castShadow = true;
	top.receiveShadow = true;
	g.add(top);
	for (const x of [-0.46, 0.46]) {
		for (const z of [-0.34, 0.16]) {
			const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.5, 0.07), wood);
			leg.position.set(x, 0.25, z);
			leg.castShadow = true;
			g.add(leg);
		}
	}
	for (const x of [-0.52, 0.52]) {
		const pole = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.42, 0.07), post);
		pole.position.set(x, 0.71, 0.22);
		pole.castShadow = true;
		g.add(pole);
		const poleF = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.22, 0.07), post);
		poleF.position.set(x, 0.66, -0.48);
		poleF.castShadow = true;
		g.add(poleF);
	}
	const awning = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.05, 1.05), canvas);
	awning.position.set(0, 1.38, -0.12);
	awning.rotation.x = -0.22;
	awning.castShadow = true;
	awning.receiveShadow = true;
	g.add(awning);
	const band = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.14), stripe);
	band.position.set(0, 1.32, -0.58);
	band.castShadow = true;
	g.add(band);
	const band2 = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 0.12), stripe);
	band2.position.set(0, 1.4, 0.28);
	g.add(band2);
	const skirt = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.38, 0.04), cloth);
	skirt.position.set(0, 1.12, -0.62);
	skirt.castShadow = true;
	g.add(skirt);
	return g;
}

const sharedProps = new Set([
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

export function createMesh(meshID:string, color?:number):THREE.Object3D {
	if (meshID === 'human' || meshID.startsWith('human_')) {
		return createHumanMesh(animIDFromMeshID(meshID));
	}
	if (sharedProps.has(meshID)) {
		return cloneProp(meshID, () => buildMesh(meshID, color));
	}
	return buildMesh(meshID, color);
}

function buildMesh(meshID:string, color?:number):THREE.Object3D {
	switch (meshID) {
		case 'torch':
			return createTorchMesh();
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
		case 'mill_lever':
			return createLeverMesh();
		case 'hearth':
			return createHearthMesh();
		case 'cot':
			return createCotMesh();
		case 'stall':
			return createStallMesh();
		default: {
			if (meshID.startsWith('item_')) {
				return itemProp(meshID);
			}
			const cube = new THREE.Mesh(
				new THREE.BoxGeometry(0.4, 0.4, 0.4),
				std(color ?? 0x888888),
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
