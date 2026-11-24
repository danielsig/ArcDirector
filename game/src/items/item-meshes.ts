import * as THREE from 'three';
import { lathe, mergeParts, type PosedPart } from '@arc-director/kindling';
import { flameMaterial, getSheet, sheetReady, spriteMaterial } from '../render/spritesheet';
import { toon } from '../render/toon';
import { goodsMesh, isGoodsMesh } from './goods';

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

/** Whether an item's mesh can be built: the sprite sheet's once it has loaded. */
export function meshReady(meshID:string):boolean {
	return isGoodsMesh(meshID) || (meshID !== 'held_torch' && !meshID.startsWith('item_')) || sheetReady();
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
 * A torch to carry, standing up its +Y (for `holdInHand`): stick, pitch-soaked wrap, two
 * crossed flame cards (`userData.flame`, hidden until lit), so it reads from any side without
 * turning to the camera, and a `Grip` node where the fist closes, low on the stick.
 */
function heldTorchMesh():THREE.Group {
	const g = new THREE.Group();
	const { stick, wrap } = torchWood();
	g.add(stick, wrap, Object.assign(new THREE.Object3D().translateY(0.24), { name: 'Grip' }));
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

/** A trout as it comes off the river, off the fire, or out of it too late: its skin, its fins. */
interface TroutLook {
	skin:(g:CanvasRenderingContext2D, w:number, h:number)=>void;
	fin:number;
}

/** Strokes `n` lines down the skin picture, each from `x` at its top, slanting by `lean` (pixels across per down). */
function slashes(g:CanvasRenderingContext2D, w:number, h:number, n:number, lean:number):void {
	for (let i = 0; i < n; i++) {
		const x = (i + 0.5) * w / n;
		g.beginPath();
		g.moveTo(x, 0);
		g.lineTo(x + lean * h, h);
		g.stroke();
	}
}

/**
 * Skins as pictures wrapped round the body: across is round the girth (the upper flank at 0 and the edges, the back
 * at a quarter, the lower flank at half, the belly at three quarters), down is from the nose to the tail.
 */
const TROUT_LOOKS:Record<string, TroutLook> = {
	item_trout: {
		fin: 0x8a9aa6,
		skin: (g, w, h) => {
			const round = g.createLinearGradient(0, 0, w, 0);
			[[0, '#c8d4dc'], [0.25, '#4a5a68'], [0.5, '#c8d4dc'], [0.75, '#f2f4f0'], [1, '#c8d4dc']].forEach(([at, color]) => round.addColorStop(at as number, color as string));
			g.fillStyle = round;
			g.fillRect(0, 0, w, h);
			// The rosy line down each flank, and dark spots over the back.
			g.fillStyle = 'rgba(216, 128, 140, 0.55)';
			[0, w / 2 - 3, w - 3].forEach((x) => g.fillRect(x, h * 0.15, 6, h * 0.8));
			g.fillStyle = '#26303a';
			for (let i = 0; i < 26; i++) {
				g.beginPath();
				g.arc(w * (0.12 + 0.26 * ((i * 0.618) % 1)), h * (0.1 + 0.85 * ((i * 0.381) % 1)), 1.4, 0, Math.PI * 2);
				g.fill();
			}
		},
	},
	item_trout_cooked: {
		fin: 0x8a4a20,
		skin: (g, w, h) => {
			const round = g.createLinearGradient(0, 0, w, 0);
			[[0, '#d89a50'], [0.25, '#8a5428'], [0.5, '#d89a50'], [0.75, '#eec080'], [1, '#d89a50']].forEach(([at, color]) => round.addColorStop(at as number, color as string));
			g.fillStyle = round;
			g.fillRect(0, 0, w, h);
			// Charred marks where the skin met the hottest of the flames.
			g.strokeStyle = 'rgba(58, 30, 12, 0.85)';
			g.lineWidth = 3;
			slashes(g, w, h, 9, 0.5);
		},
	},
	item_trout_burnt: {
		fin: 0x141010,
		skin: (g, w, h) => {
			g.fillStyle = '#2a2420';
			g.fillRect(0, 0, w, h);
			g.fillStyle = '#4a3c30';
			for (let i = 0; i < 18; i++) {
				g.beginPath();
				g.arc(w * ((i * 0.618) % 1), h * ((i * 0.381) % 1), 3 + (i % 3) * 2, 0, Math.PI * 2);
				g.fill();
			}
			// Cracks in the char, still glowing.
			g.strokeStyle = 'rgba(200, 80, 24, 0.8)';
			g.lineWidth = 1;
			slashes(g, w, h, 5, -0.7);
		},
	},
};

const troutSkins = new Map<string, THREE.CanvasTexture>();

/** `meshID`'s skin picture, drawn once and shared. */
function troutSkin(meshID:string):THREE.CanvasTexture {
	let tex = troutSkins.get(meshID);
	if (!tex) {
		const canvas = document.createElement('canvas');
		canvas.width = 128;
		canvas.height = 64;
		TROUT_LOOKS[meshID]!.skin(canvas.getContext('2d')!, canvas.width, canvas.height);
		tex = new THREE.CanvasTexture(canvas);
		tex.colorSpace = THREE.SRGBColorSpace;
		tex.userData.shared = true;
		troutSkins.set(meshID, tex);
	}
	return tex;
}

/**
 * A trout lying on its side, nose to +X: an oval body, a fanned tail and an eye. Raw, cooked and burnt share the
 * shape and differ in skin. Skewered on a spit it lies the same way, along it.
 */
function trout(meshID:string):THREE.Group {
	const look = TROUT_LOOKS[meshID]!;
	// The sphere's poles turned to nose and tail, so its picture wraps round the girth.
	const skin = toon(0xffffff, { map: troutSkin(meshID) });
	const body = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 10).rotateZ(-Math.PI / 2).scale(0.13, 0.035, 0.05), skin);
	const finMat = toon(look.fin, { side: THREE.DoubleSide });
	const fan = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(-0.075, 0.048), new THREE.Vector2(-0.058, 0), new THREE.Vector2(-0.075, -0.048)]);
	const tail = new THREE.Mesh(new THREE.ShapeGeometry(fan).rotateX(-Math.PI / 2).translate(-0.115, 0, 0), finMat);
	const eyeMat = toon(0x101418, { outline: false });
	const eye = new THREE.Mesh(new THREE.SphereGeometry(0.009, 6, 4).translate(0.095, 0.022, 0.01), eyeMat);
	const parts = new THREE.Group();
	parts.name = 'body';
	parts.position.y = 0.035;
	for (const part of [body, tail, eye]) {
		part.castShadow = true;
		part.userData.lockColor = true;
		parts.add(part);
	}
	const g = new THREE.Group();
	g.userData.kind = 'item';
	g.add(parts);
	g.userData.body = parts;
	g.userData.shine = [skin, finMat, eyeMat];
	return g;
}

function itemProp(meshID:string):THREE.Group {
	const h = ITEM_HEIGHT[meshID] ?? 0.36;
	if (meshID === 'item_mushroom') {
		return fireMushroom();
	}
	if (meshID in TROUT_LOOKS) {
		return trout(meshID);
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

/** An item's mesh, or a gray cube for an id nothing knows. */
export function createMesh(meshID:string):THREE.Object3D {
	switch (meshID) {
		case 'held_torch':
			return heldTorchMesh();
		case 'fishing_rod':
			return fishingRodMesh();
		default: {
			if (meshID.startsWith('item_')) {
				return itemProp(meshID);
			}
			const cube = new THREE.Mesh(
				new THREE.BoxGeometry(0.4, 0.4, 0.4),
				toon(0x888888),
			);
			cube.position.y = 0.2;
			cube.castShadow = true;
			return cube;
		}
	}
}
