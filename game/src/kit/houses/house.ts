import * as THREE from 'three';
import { ChunkBound, GameObject, register, solidMesh } from '@arc-director/kindling';
import { BoxCollider, Named } from '../../engine/components';
import { DemoMeshRenderer } from '../../engine/demo-mesh-renderer';
import { WALL_HEIGHT } from '../../world/constants';
import type { RoofStyle } from '../../world/decode-glyph-chunk';
import { natureReady } from '../../render/nature';
import { plankMat, slateMat, thatchMat, toon } from '../../render/toon';
import { Door } from '../door/door';
import type { Thing } from '../thing';
import { findBuildings } from './buildings';
import { Interior } from './interior';

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
	return solidMesh(geo, mat);
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
	return solidMesh(geo, mat);
}

/**
 * A house's roof over a wall line `halfW` × `halfD` meters from its middle (walls, window and door are
 * tiles): gables stand on the line, the roof overhangs it, thatched or in slate. With `chimney`, a house 5 m wide or
 * more has one.
 */
function createRoofMesh(halfW:number, halfD:number, style:RoofStyle = 'thatch', chimney = true):THREE.Group {
	// Own copies: the roof fades when the player walks under it.
	const wood = plankMat().clone();
	const thatch = style === 'slate' ? slateMat().clone() : thatchMat().clone();
	const g = new THREE.Group();
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

	g.userData.roofHalfW = halfW;
	g.userData.roofHalfD = halfD;
	if (!chimney || halfW < 2.5) {
		return g;
	}

	// The chimney receives shadows too, so indoor lights cannot leak through the ceiling.
	const stack = solidMesh(new THREE.BoxGeometry(0.42, 1.05, 0.42), toon(0x5a534c));
	stack.position.set(1.35, (ridgeY + eaveY) * 0.5 + 0.45, -1.05);
	const cap = solidMesh(new THREE.BoxGeometry(0.52, 0.1, 0.52), toon(0x3e3a36));
	cap.position.copy(stack.position);
	cap.position.y += 0.55;
	g.add(stack, cap);

	return g;
}

/** How much wider than its wall line a roof is: the gables at its ends stand just outside the wall boards. */
const GABLES_OUT = 0.18;

/** Each house on the chunk: its roof (sized to its wall line), its inside, its name, and its door told whose it is. */
export const house:Thing = {
	defs: ['door', 'door_flipped'],
	spawn: (world, chunk) => findBuildings([chunk]).forEach((b) => {
		const name = b.name || `House_${chunk.id}_${b.door.localX}_${b.door.localZ}`;
		const [w, d] = [b.walls.maxX - b.walls.minX + GABLES_OUT, b.walls.maxZ - b.walls.minZ];
		const meshID = `roof:${w}x${d}:${b.roof}:${b.chimney ? 'chimney' : 'bare'}`;
		register(meshID, () => (natureReady() ? createRoofMesh(w / 2, d / 2, b.roof, b.chimney) : undefined));
		const go = new GameObject(name, 'Building');
		go.transform.localPosition = { x: (b.walls.minX + b.walls.maxX) * 0.5, y: 0, z: (b.walls.minZ + b.walls.maxZ) * 0.5 };
		go.addComponent(DemoMeshRenderer, { meshID });
		go.addComponent(BoxCollider, { size: { x: 0.4, y: 1, z: 0.4 }, solid: false, isTrigger: true });
		go.addComponent(Named, { id: name });
		go.addComponent(Interior, { bounds: { ...b.inside } });
		go.addComponent(ChunkBound, { chunkID: chunk.id });
		world.add(go);
		const leaf = b.door.name ? world.findNamed(b.door.name)?.getComponent(Door) : undefined;
		if (leaf) {
			leaf.buildingID = name;
		}
	}),
};
