import * as THREE from 'three';
import { bevelBox, blob, lathe, ribbon as strip, tube } from '@arc-director/kindling';
import { toon } from './toon';

/**
 * Handheld market goods as toon meshes, the same path as the fire mushroom:
 * a body the pickup pulse can scale, and materials the highlight can light.
 * Every part locks its color so a single item tint cannot flatten the model.
 */

function part(geo:THREE.BufferGeometry, mat:THREE.Material):THREE.Mesh {
	const mesh = new THREE.Mesh(geo, mat);
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	mesh.userData.lockColor = true;
	return mesh;
}

function group(parts:THREE.Object3D[], shine:THREE.Material[]):THREE.Group {
	const g = new THREE.Group();
	g.userData.kind = 'item';
	const body = new THREE.Group();
	body.name = 'body';
	for (const piece of parts) {
		body.add(piece);
	}
	g.add(body);
	g.userData.body = body;
	g.userData.shine = shine;
	return g;
}

/** Tip a standing tool onto the counter, sit it on the ground, and bake that pose into the vertices. */
function rest(g:THREE.Group, axis:'x' | 'z'):THREE.Group {
	const body = g.userData.body as THREE.Object3D;
	const tip = new THREE.Quaternion().setFromAxisAngle(
		axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1),
		Math.PI / 2,
	);
	// After the tip the length runs toward the camera; yaw it so it lies across the counter.
	if (axis === 'x') {
		tip.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
	}
	body.quaternion.copy(tip);
	g.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(body);
	body.position.y -= box.min.y;
	g.updateMatrixWorld(true);
	body.traverse((obj) => {
		if (!(obj instanceof THREE.Mesh)) {
			return;
		}
		obj.geometry.applyMatrix4(obj.matrixWorld);
		obj.position.set(0, 0, 0);
		obj.rotation.set(0, 0, 0);
		obj.scale.set(1, 1, 1);
		obj.updateMatrix();
	});
	body.position.set(0, 0, 0);
	body.rotation.set(0, 0, 0);
	body.updateMatrix();
	return g;
}

function loaf():THREE.Group {
	const crust = toon(0xc4893a);
	const crumb = toon(0x8a5a28);
	const body = part(blob(0.15, 0.065, 0.085, 10, 8), crust);
	body.position.y = 0.065;
	const slash = (x:number, rz:number):THREE.Mesh => {
		const cut = part(new THREE.BoxGeometry(0.08, 0.01, 0.012), crumb);
		cut.position.set(x, 0.125, 0);
		cut.rotation.z = rz;
		return cut;
	};
	return group([body, slash(-0.03, -0.45), slash(0.035, 0.4)], [crust, crumb]);
}

function bun():THREE.Group {
	const crust = toon(0xe0b060);
	const crumb = toon(0xc48a40);
	const body = part(blob(0.07, 0.05, 0.07, 10, 8), crust);
	body.position.y = 0.05;
	const score = (rz:number):THREE.Mesh => {
		const cut = part(new THREE.BoxGeometry(0.07, 0.008, 0.01), crumb);
		cut.position.y = 0.095;
		cut.rotation.z = rz;
		return cut;
	};
	return group([body, score(0.4), score(-0.4)], [crust, crumb]);
}

function pie():THREE.Group {
	const crust = toon(0xd4a05a);
	const berry = toon(0xa03048);
	const base = part(new THREE.CylinderGeometry(0.12, 0.11, 0.04, 14), crust);
	base.position.y = 0.02;
	const filling = part(new THREE.CylinderGeometry(0.09, 0.09, 0.018, 12), berry);
	filling.position.y = 0.042;
	const rim = part(new THREE.TorusGeometry(0.105, 0.014, 5, 14), crust);
	rim.rotation.x = Math.PI / 2;
	rim.position.y = 0.045;
	return group([base, filling, rim], [crust, berry]);
}

function cake():THREE.Group {
	const sponge = toon(0xc47a48);
	const icing = toon(0xf3efe4);
	const berry = toon(0xc43048);
	const base = part(new THREE.CylinderGeometry(0.09, 0.1, 0.1, 12), sponge);
	base.position.y = 0.05;
	const top = part(new THREE.CylinderGeometry(0.095, 0.09, 0.035, 12), icing);
	top.position.y = 0.11;
	const cherry = part(new THREE.SphereGeometry(0.026, 8, 6), berry);
	cherry.position.y = 0.148;
	return group([base, top, cherry], [sponge, icing, berry]);
}

function scarf():THREE.Group {
	const wool = toon(0xb03a4a, { side: THREE.DoubleSide });
	const cream = toon(0xf0e6d0);
	const cloth = part(strip([
		{ x: -0.14, y: 0.02, z: 0.02 },
		{ x: -0.05, y: 0.12, z: 0 },
		{ x: 0.06, y: 0.125, z: 0.02 },
		{ x: 0.15, y: 0.02, z: 0 },
	], 0.08), wool);
	const fringe = (x:number, z:number):THREE.Mesh => {
		const tassel = part(new THREE.BoxGeometry(0.012, 0.04, 0.01), cream);
		tassel.position.set(x, 0.02, z);
		return tassel;
	};
	return group([
		cloth,
		fringe(-0.14, -0.02),
		fringe(-0.14, 0.02),
		fringe(0.15, -0.02),
		fringe(0.15, 0.02),
	], [wool, cream]);
}

function hood():THREE.Group {
	const wool = toon(0x6a3058);
	const band = toon(0xc4a0a8);
	const cowl = part(lathe([
		{ r: 0.04, y: 0.02 },
		{ r: 0.11, y: 0.04 },
		{ r: 0.125, y: 0.12 },
		{ r: 0.07, y: 0.2 },
		{ r: 0.025, y: 0.24 },
	], 12), wool);
	const brim = part(new THREE.TorusGeometry(0.1, 0.014, 5, 12), band);
	brim.rotation.x = Math.PI / 2;
	brim.position.y = 0.05;
	return group([cowl, brim], [wool, band]);
}

function ribbonSpool():THREE.Group {
	const wood = toon(0x8a5a32);
	const silk = toon(0xd45078, { side: THREE.DoubleSide });
	const spool = part(lathe([
		{ r: 0.025, y: 0 },
		{ r: 0.065, y: 0.01 },
		{ r: 0.04, y: 0.02 },
		{ r: 0.04, y: 0.07 },
		{ r: 0.065, y: 0.08 },
		{ r: 0.025, y: 0.09 },
	], 12), wood);
	spool.rotation.z = Math.PI / 2;
	spool.position.y = 0.065;
	const tail = part(strip([
		{ x: 0.02, y: 0.07, z: 0 },
		{ x: 0.1, y: 0.035, z: 0.02 },
		{ x: 0.16, y: 0.012, z: 0 },
	], 0.035), silk);
	return group([spool, tail], [wood, silk]);
}

function bowl():THREE.Group {
	const clay = toon(0xc4885a);
	const glaze = toon(0x4a6a88);
	const dish = part(lathe([
		{ r: 0.02, y: 0 },
		{ r: 0.07, y: 0.012 },
		{ r: 0.11, y: 0.05 },
		{ r: 0.12, y: 0.09 },
		{ r: 0.09, y: 0.1 },
		{ r: 0.06, y: 0.04 },
		{ r: 0.02, y: 0.03 },
	], 12), clay);
	const rim = part(new THREE.TorusGeometry(0.105, 0.012, 5, 12), glaze);
	rim.rotation.x = Math.PI / 2;
	rim.position.y = 0.09;
	return group([dish, rim], [clay, glaze]);
}

function jug():THREE.Group {
	const clay = toon(0xc47a4a);
	const hole = toon(0x000000, { outline: false });
	const body = part(lathe([
		{ r: 0.02, y: 0 },
		{ r: 0.08, y: 0.012 },
		{ r: 0.095, y: 0.08 },
		{ r: 0.06, y: 0.16 },
		{ r: 0.032, y: 0.2 },
		{ r: 0.048, y: 0.24 },
		{ r: 0.02, y: 0.25 },
	], 12), clay);
	// The lip's closing cone faces inward, so culling shows the world through the mouth.
	const mouth = part(new THREE.CircleGeometry(0.044, 12).rotateX(-Math.PI / 2), hole);
	mouth.position.y = 0.242;
	mouth.castShadow = false;
	const handle = part(tube([
		{ x: 0.06, y: 0.08, z: 0 },
		{ x: 0.13, y: 0.13, z: 0 },
		{ x: 0.11, y: 0.2, z: 0 },
		{ x: 0.035, y: 0.2, z: 0 },
	], 0.012, 5), clay);
	return group([body, handle, mouth], [clay]);
}

function knife():THREE.Group {
	const wood = toon(0x6b3a22);
	const iron = toon(0xc5ced6);
	const handle = part(bevelBox(0.036, 0.1, 0.028, 0.008), wood);
	const guard = part(new THREE.BoxGeometry(0.07, 0.012, 0.018), iron);
	guard.position.y = 0.108;
	const blade = part(new THREE.BoxGeometry(0.026, 0.24, 0.008), iron);
	blade.position.y = 0.23;
	return rest(group([handle, guard, blade], [wood, iron]), 'x');
}

function cleaver():THREE.Group {
	const wood = toon(0x5a321c);
	const iron = toon(0xb0b8c0);
	const handle = part(bevelBox(0.038, 0.09, 0.03, 0.008), wood);
	const blade = part(new THREE.BoxGeometry(0.15, 0.14, 0.012), iron);
	blade.position.set(0.035, 0.17, 0);
	return rest(group([handle, blade], [wood, iron]), 'x');
}

function shears():THREE.Group {
	const iron = toon(0x9aa3ac);
	const grip = toon(0x3a3e44);
	const blade = (rz:number, z:number):THREE.Mesh => {
		const geo = new THREE.BoxGeometry(0.026, 0.16, 0.005);
		geo.translate(0, 0.08, 0);
		const m = part(geo, iron);
		m.position.set(0, 0.07, z);
		m.rotation.z = rz;
		return m;
	};
	const loop = (x:number):THREE.Mesh => {
		const m = part(new THREE.TorusGeometry(0.026, 0.007, 6, 8), grip);
		m.position.set(x, 0.04, 0);
		return m;
	};
	return rest(group([
		blade(-0.18, 0.004),
		blade(0.18, -0.004),
		loop(-0.028),
		loop(0.028),
	], [iron, grip]), 'x');
}

function hook():THREE.Group {
	const wood = toon(0x6b4423);
	const iron = toon(0x8a9098);
	const handle = part(bevelBox(0.036, 0.1, 0.03, 0.008), wood);
	const curve = part(tube([
		{ x: 0, y: 0.1, z: 0 },
		{ x: 0, y: 0.26, z: 0 },
		{ x: 0.07, y: 0.32, z: 0 },
		{ x: 0.11, y: 0.24, z: 0 },
	], 0.011, 5), iron);
	return rest(group([handle, curve], [wood, iron]), 'x');
}

// Fruit: an apple, a pear and a plum, each with its stem, and a leaf on the apple.

function apple():THREE.Group {
	const skin = toon(0xc23b3a);
	const stem = toon(0x5a3a1e);
	const leafMat = toon(0x4a8a3a, { side: THREE.DoubleSide });
	const body = part(lathe([
		{ r: 0.03, y: 0.015 },
		{ r: 0.075, y: 0.03 },
		{ r: 0.085, y: 0.08 },
		{ r: 0.06, y: 0.13 },
		{ r: 0.025, y: 0.145 },
	], 12), skin);
	const stalk = part(tube([{ x: 0, y: 0.12, z: 0 }, { x: 0.01, y: 0.175, z: 0.01 }], 0.006, 5), stem);
	const leaf = part(strip([{ x: 0.012, y: 0.16, z: 0.01 }, { x: 0.045, y: 0.175, z: 0.025 }, { x: 0.07, y: 0.165, z: 0.03 }], 0.03), leafMat);
	return group([body, stalk, leaf], [skin, stem, leafMat]);
}

function pear():THREE.Group {
	const skin = toon(0xb8c44a);
	const stem = toon(0x5a3a1e);
	const body = part(lathe([
		{ r: 0.03, y: 0 },
		{ r: 0.07, y: 0.02 },
		{ r: 0.078, y: 0.06 },
		{ r: 0.05, y: 0.12 },
		{ r: 0.035, y: 0.16 },
		{ r: 0.015, y: 0.19 },
	], 12), skin);
	const stalk = part(tube([{ x: 0, y: 0.18, z: 0 }, { x: 0.015, y: 0.23, z: 0 }], 0.005, 5), stem);
	return group([body, stalk], [skin, stem]);
}

function plum():THREE.Group {
	const skin = toon(0x5a2a6a);
	const bloom = toon(0x8a5a9a, { outline: false });
	const body = part(blob(0.055, 0.06, 0.055, 10, 8), skin);
	body.position.y = 0.06;
	const crease = part(new THREE.BoxGeometry(0.004, 0.09, 0.04), bloom);
	crease.position.set(0.05, 0.06, 0);
	return group([body, crease], [skin, bloom]);
}

// The apothecary's shelf: a corked vial, a round tin, a tied bundle of lavender and a bar of soap.

function tonic():THREE.Group {
	const glass = toon(0x4ac27a, { rim: 0.5 });
	const cork = toon(0xc4a06a);
	const label = toon(0xf0e6d0, { outline: false });
	const vial = part(lathe([
		{ r: 0.03, y: 0 },
		{ r: 0.045, y: 0.01 },
		{ r: 0.045, y: 0.1 },
		{ r: 0.018, y: 0.14 },
		{ r: 0.018, y: 0.18 },
		{ r: 0.024, y: 0.19 },
	], 10), glass);
	const stopper = part(new THREE.CylinderGeometry(0.016, 0.014, 0.035, 8), cork);
	stopper.position.y = 0.2;
	const tag = part(new THREE.BoxGeometry(0.05, 0.035, 0.004), label);
	tag.position.set(0, 0.06, 0.046);
	return group([vial, stopper, tag], [glass, cork, label]);
}

function salve():THREE.Group {
	const tin = toon(0xb8a060, { rim: 0.4 });
	const lid = toon(0x8a7a48, { rim: 0.4 });
	const body = part(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 14), tin);
	body.position.y = 0.02;
	const top = part(new THREE.CylinderGeometry(0.058, 0.058, 0.014, 14), lid);
	top.position.y = 0.047;
	const knob = part(new THREE.SphereGeometry(0.01, 6, 5), lid);
	knob.position.y = 0.06;
	return group([body, top, knob], [tin, lid]);
}

function lavender():THREE.Group {
	const stemMat = toon(0x6a8a4a);
	const flower = toon(0x8a6ac8);
	const twine = toon(0xd2a868);
	const stems:THREE.Object3D[] = [];
	const heads:THREE.Object3D[] = [];
	for (let i = 0; i < 5; i++) {
		const a = (i / 5) * Math.PI * 2;
		const x = Math.cos(a) * 0.012;
		const z = Math.sin(a) * 0.012;
		const lean = 0.05 + (i % 2) * 0.02;
		stems.push(part(tube([{ x, y: 0.005, z }, { x: x * 4 + lean * Math.cos(a), y: 0.15, z: z * 4 + lean * Math.sin(a) }], 0.004, 4), stemMat));
		const head = part(blob(0.012, 0.03, 0.012, 6, 5), flower);
		head.position.set(x * 4 + lean * Math.cos(a), 0.165, z * 4 + lean * Math.sin(a));
		heads.push(head);
	}
	const tie = part(new THREE.TorusGeometry(0.02, 0.005, 5, 10), twine);
	tie.rotation.x = Math.PI / 2;
	tie.position.y = 0.05;
	return group([...stems, ...heads, tie], [stemMat, flower, twine]);
}

function soap():THREE.Group {
	const bar = toon(0xe8d8b8);
	const stamp = toon(0xc4a070, { outline: false });
	const body = part(bevelBox(0.09, 0.035, 0.06, 0.01), bar);
	body.position.y = 0.0175;
	const mark = part(new THREE.CylinderGeometry(0.018, 0.018, 0.003, 10), stamp);
	mark.position.y = 0.036;
	return group([body, mark], [bar, stamp]);
}

// The toymaker's counter: a horse on wheels, a rag doll, a whistle and a top.

function woodenHorse():THREE.Group {
	const wood = toon(0xa86a38, { pattern: 'plank', patternScale: 0.04, patternInk: 0.3 });
	const dark = toon(0x4a2e18);
	const red = toon(0xc84a3a);
	const body = part(blob(0.09, 0.045, 0.04, 10, 7), wood);
	body.position.y = 0.11;
	const neck = part(new THREE.BoxGeometry(0.035, 0.09, 0.03), wood);
	neck.position.set(0.075, 0.165, 0);
	neck.rotation.z = -0.4;
	const head = part(blob(0.045, 0.028, 0.028, 8, 6), wood);
	head.position.set(0.115, 0.205, 0);
	const mane = part(new THREE.BoxGeometry(0.05, 0.07, 0.01), dark);
	mane.position.set(0.065, 0.175, 0);
	mane.rotation.z = -0.4;
	const legs = [[-0.05, -0.02], [-0.05, 0.02], [0.05, -0.02], [0.05, 0.02]].map(([x, z]) => {
		const leg = part(new THREE.BoxGeometry(0.02, 0.07, 0.016), wood);
		leg.position.set(x!, 0.06, z!);
		return leg;
	});
	const axle = part(new THREE.CylinderGeometry(0.004, 0.004, 0.08, 5).rotateX(Math.PI / 2), dark);
	axle.position.set(0, 0.02, 0);
	const wheels = [[-0.05, -0.04], [-0.05, 0.04], [0.05, -0.04], [0.05, 0.04]].map(([x, z]) => {
		const wheel = part(new THREE.CylinderGeometry(0.02, 0.02, 0.008, 10).rotateX(Math.PI / 2), red);
		wheel.position.set(x!, 0.02, z!);
		return wheel;
	});
	const tail = part(tube([{ x: -0.085, y: 0.12, z: 0 }, { x: -0.11, y: 0.09, z: 0.005 }], 0.008, 4), dark);
	return group([body, neck, head, mane, ...legs, axle, ...wheels, tail], [wood, dark, red]);
}

function doll():THREE.Group {
	const cloth = toon(0xd89a7a);
	const dress = toon(0x3a6ac8);
	const hair = toon(0xc8a050);
	const face = toon(0x3a2a1e, { outline: false });
	const skirt = part(lathe([
		{ r: 0.02, y: 0.06 },
		{ r: 0.05, y: 0 },
		{ r: 0.05, y: 0.008 },
		{ r: 0.028, y: 0.075 },
	], 10), dress);
	const torso = part(new THREE.CylinderGeometry(0.022, 0.028, 0.045, 8), dress);
	torso.position.y = 0.095;
	const head = part(new THREE.SphereGeometry(0.03, 10, 8), cloth);
	head.position.y = 0.145;
	const locks = part(lathe([{ r: 0.026, y: 0.135 }, { r: 0.034, y: 0.15 }, { r: 0.02, y: 0.178 }, { r: 0.002, y: 0.18 }], 10), hair);
	const arms = [-1, 1].map((s) => {
		const arm = part(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 6), cloth);
		arm.position.set(s * 0.03, 0.1, 0.005);
		arm.rotation.z = s * 0.9;
		return arm;
	});
	const eyes = [-1, 1].map((s) => {
		const eye = part(new THREE.SphereGeometry(0.004, 5, 4), face);
		eye.position.set(s * 0.01, 0.15, 0.027);
		return eye;
	});
	return group([skirt, torso, head, locks, ...arms, ...eyes], [cloth, dress, hair, face]);
}

function whistle():THREE.Group {
	const wood = toon(0xc8a050);
	const dark = toon(0x5a3a1e, { outline: false });
	const body = part(new THREE.CylinderGeometry(0.014, 0.012, 0.11, 8), wood);
	const holes = [-0.03, -0.01, 0.01, 0.03].map((x) => {
		const hole = part(new THREE.CylinderGeometry(0.004, 0.004, 0.004, 6), dark);
		hole.position.set(x, 0.015, 0);
		return hole;
	});
	const mouth = part(new THREE.BoxGeometry(0.03, 0.012, 0.02), wood);
	mouth.position.set(0.065, 0, 0);
	const g = group([body, ...holes, mouth], [wood, dark]);
	// Lying along X on the counter: the cylinder stands up its Y.
	body.rotation.z = Math.PI / 2;
	for (const piece of [body, mouth, ...holes]) {
		piece.position.y += 0.014;
	}
	return g;
}

function spinningTop():THREE.Group {
	const paint = toon(0xc84a3a);
	const stripe = toon(0xf0e0a8);
	const wood = toon(0x8a5a32);
	const cone = part(lathe([
		{ r: 0.002, y: 0 },
		{ r: 0.03, y: 0.03 },
		{ r: 0.05, y: 0.055 },
		{ r: 0.045, y: 0.075 },
		{ r: 0.02, y: 0.09 },
		{ r: 0.012, y: 0.1 },
	], 12), paint);
	const ring = part(new THREE.TorusGeometry(0.047, 0.006, 5, 14), stripe);
	ring.rotation.x = Math.PI / 2;
	ring.position.y = 0.06;
	const handle = part(new THREE.CylinderGeometry(0.008, 0.01, 0.04, 7), wood);
	handle.position.y = 0.115;
	return group([cone, ring, handle], [paint, stripe, wood]);
}

const GOODS:Record<string, ()=>THREE.Group> = {
	item_apple: apple,
	item_pear: pear,
	item_plum: plum,
	item_tonic: tonic,
	item_salve: salve,
	item_lavender: lavender,
	item_soap: soap,
	item_wooden_horse: woodenHorse,
	item_doll: doll,
	item_whistle: whistle,
	item_spinning_top: spinningTop,
	item_loaf: loaf,
	item_bun: bun,
	item_pie: pie,
	item_cake: cake,
	item_scarf: scarf,
	item_hood: hood,
	item_ribbon: ribbonSpool,
	item_bowl: bowl,
	item_jug: jug,
	item_knife: knife,
	item_cleaver: cleaver,
	item_shears: shears,
	item_hook: hook,
};

export function isGoodsMesh(meshID:string):boolean {
	return meshID in GOODS;
}

/** A fresh prop for `meshID`, or undefined when it is not a market good. */
export function goodsMesh(meshID:string):THREE.Group | undefined {
	return GOODS[meshID]?.();
}
