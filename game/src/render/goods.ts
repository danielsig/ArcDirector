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
	const body = part(lathe([
		{ r: 0.02, y: 0 },
		{ r: 0.08, y: 0.012 },
		{ r: 0.095, y: 0.08 },
		{ r: 0.06, y: 0.16 },
		{ r: 0.032, y: 0.2 },
		{ r: 0.048, y: 0.24 },
		{ r: 0.02, y: 0.25 },
	], 12), clay);
	const handle = part(tube([
		{ x: 0.06, y: 0.08, z: 0 },
		{ x: 0.13, y: 0.13, z: 0 },
		{ x: 0.11, y: 0.2, z: 0 },
		{ x: 0.035, y: 0.2, z: 0 },
	], 0.012, 5), clay);
	return group([body, handle], [clay]);
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

const GOODS:Record<string, ()=>THREE.Group> = {
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
