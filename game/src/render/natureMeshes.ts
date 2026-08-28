import * as THREE from 'three';
import { WALL_HEIGHT } from '../world/constants';
import {
	getNature,
	natureDepthMat,
	natureMat,
	waterfallFoamMat,
	waterfallSheetMat,
	waterfallSplashMat,
} from './nature';

function std(color:number):THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({
		color,
		roughness: 0.9,
		metalness: 0.04,
	});
}

function shadeMat(map:THREE.Texture, extras:THREE.MeshStandardMaterialParameters = {}):THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({
		map,
		roughness: 0.92,
		metalness: 0,
		side: THREE.DoubleSide,
		shadowSide: THREE.DoubleSide,
		...extras,
	});
}

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
	const n = getNature();
	const wood = shadeMat(n.wood);
	const thatchMap = n.thatch.clone();
	thatchMap.wrapS = THREE.RepeatWrapping;
	thatchMap.wrapT = THREE.RepeatWrapping;
	thatchMap.needsUpdate = true;
	const thatch = shadeMat(thatchMap);
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
	const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.05, 0.42), std(0x5a534c));
	chimney.position.set(1.35, (ridgeY + eaveY) * 0.5 + 0.45, -1.05);
	g.add(occupyRoof(chimney));
	const cap = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.1, 0.52), std(0x3e3a36));
	cap.position.copy(chimney.position);
	cap.position.y += 0.55;
	g.add(occupyRoof(cap));
	const glass = std(0x1a2430);
	const shutter = std(0x4a301c);
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

function contentUV(map:THREE.Texture):{ u0:number; v0:number; u1:number; v1:number } {
	const uv = map.userData.contentUV as { u0:number; v0:number; u1:number; v1:number } | undefined;
	if (uv) {
		return uv;
	}
	return { u0: 0, v0: 0, u1: 1, v1: 1 };
}

function cutoutBillboard(map:THREE.Texture, height:number):THREE.PlaneGeometry {
	const { u0, v0, u1, v1 } = contentUV(map);
	const img = map.image as { width:number; height:number } | undefined;
	const srcW = img?.width ?? 1;
	const srcH = img?.height ?? 1;
	const aspect = ((u1 - u0) * srcW) / Math.max((v1 - v0) * srcH, 1e-6);
	const geo = new THREE.PlaneGeometry(height * aspect, height);
	const uv = geo.getAttribute('uv');
	for (let i = 0; i < uv.count; i++) {
		uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
	}
	uv.needsUpdate = true;
	return geo;
}

export function createTreeMesh(kind:'oak' | 'pine'):THREE.Group {
	const n = getNature();
	const map = kind === 'pine' ? n.pine : n.oak;
	const mat = natureMat(map, { alpha: true, wind: true });
	const depth = natureDepthMat(map, { wind: true });
	const height = kind === 'pine' ? 3.6 : 3.1;
	const base = cutoutBillboard(map, height);
	const y = height * 0.5 - 0.06;
	const g = new THREE.Group();
	g.userData.kind = 'tree';
	const sides = 4;
	for (let i = 0; i < sides; i++) {
		const geo = i === 0 ? base : base.clone();
		if (i > 0) {
			geo.rotateY((i * Math.PI) / sides);
		}
		const mesh = new THREE.Mesh(geo, mat);
		mesh.position.y = y;
		mesh.castShadow = true;
		mesh.customDepthMaterial = depth;
		g.add(mesh);
	}
	return g;
}

function hash01(x:number, y:number, z:number):number {
	const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
	return n - Math.floor(n);
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
let boulderShared:THREE.MeshStandardMaterial | null = null;
let boulderSharedSrc:THREE.Texture | null = null;

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
		mag += (hash01(nrm.x, nrm.y, nrm.z) - 0.5) * 0.22;
		mag += (hash01(nrm.x * 2.3, nrm.y * 2.3, nrm.z * 2.3) - 0.5) * 0.1;
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

export function boulderMat(src:THREE.Texture):THREE.MeshStandardMaterial {
	if (boulderShared && boulderSharedSrc === src) {
		return boulderShared;
	}
	const map = src.clone();
	map.wrapS = THREE.ClampToEdgeWrapping;
	map.wrapT = THREE.ClampToEdgeWrapping;
	const uv = src.userData.contentUV as { u0:number; v0:number; u1:number; v1:number } | undefined;
	const u0 = uv?.u0 ?? 0;
	const v0 = uv?.v0 ?? 0;
	const u1 = uv?.u1 ?? 1;
	const v1 = uv?.v1 ?? 1;
	const du = u1 - u0;
	const dv = v1 - v0;
	map.offset.set(u0 + du * 0.22, v0 + dv * 0.22);
	map.repeat.set(du * 0.56, dv * 0.56);
	map.needsUpdate = true;
	const mat = new THREE.MeshStandardMaterial({
		map,
		roughness: 0.92,
		metalness: 0,
		side: THREE.FrontSide,
	});
	mat.userData.shared = true;
	boulderShared = mat;
	boulderSharedSrc = src;
	return mat;
}

export function disposeSharedNatureMeshes():void {
	rockGeo?.dispose();
	rockGeo = null;
	if (boulderShared) {
		boulderShared.map?.dispose();
		boulderShared.dispose();
		boulderShared = null;
		boulderSharedSrc = null;
	}
}

export function createBoulderMesh():THREE.Group {
	const n = getNature();
	const g = new THREE.Group();
	g.userData.kind = 'boulder';
	const mesh = new THREE.Mesh(rockGeometry(), boulderMat(n.boulder));
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	g.add(mesh);
	return g;
}

export function createBridgeMesh():THREE.Group {
	const n = getNature();
	const wood = natureMat(n.wood, { color: 0xc4a06a, roughness: 0.82 });
	const dark = natureMat(n.wood, { color: 0x6a4a2a, roughness: 0.9 });
	const iron = std(0x3a3a42);
	const g = new THREE.Group();
	g.userData.kind = 'bridge';
	const deckLen = 3.28;
	const deckW = 1.72;
	const hinge = new THREE.Group();
	hinge.name = 'hinge';
	hinge.position.set(0, 0.04, -deckLen * 0.5);
	const plankN = 8;
	const plankPitch = deckLen / plankN;
	for (let i = 0; i < plankN; i++) {
		const plank = new THREE.Mesh(new THREE.BoxGeometry(deckW - 0.1, 0.09, plankPitch - 0.035), wood);
		plank.position.set((i % 2 === 0 ? -0.012 : 0.012), 0.1, (i + 0.5) * plankPitch);
		plank.castShadow = true;
		plank.receiveShadow = true;
		hinge.add(plank);
	}
	for (const x of [-deckW * 0.5 + 0.06, deckW * 0.5 - 0.06]) {
		const beam = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, deckLen + 0.04), dark);
		beam.position.set(x, 0.05, deckLen * 0.5);
		beam.castShadow = true;
		hinge.add(beam);
		const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.42, deckLen - 0.08), wood);
		rail.position.set(x, 0.36, deckLen * 0.5);
		rail.castShadow = true;
		hinge.add(rail);
		for (let p = 0; p < 4; p++) {
			const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.5, 0.09), dark);
			post.position.set(x, 0.32, 0.28 + p * ((deckLen - 0.5) / 3));
			hinge.add(post);
		}
	}
	for (let i = 1; i < plankN; i += 2) {
		const tie = new THREE.Mesh(new THREE.BoxGeometry(deckW - 0.02, 0.07, 0.1), dark);
		tie.position.set(0, 0.03, i * plankPitch);
		hinge.add(tie);
	}
	g.add(hinge);
	g.userData.hinge = hinge;
	for (const side of [-1, 1]) {
		const z = side * (deckLen * 0.5 + 0.18);
		const sill = new THREE.Mesh(new THREE.BoxGeometry(deckW + 0.22, 0.22, 0.28), dark);
		sill.position.set(0, 0.08, z);
		sill.castShadow = true;
		sill.receiveShadow = true;
		g.add(sill);
		for (const x of [-deckW * 0.48, deckW * 0.48]) {
			const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.85, 0.16), wood);
			post.position.set(x, 0.42, z);
			post.castShadow = true;
			g.add(post);
			const band = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.18), iron);
			band.position.set(x, 0.72, z);
			g.add(band);
		}
	}
	return g;
}

function fallCurtain(width:number, height:number):THREE.BufferGeometry {
	const geo = new THREE.PlaneGeometry(width, height, 8, 24);
	const pos = geo.getAttribute('position');
	const v = new THREE.Vector3();
	for (let i = 0; i < pos.count; i++) {
		v.fromBufferAttribute(pos, i);
		const t = (v.y + height * 0.5) / height;
		const fall = 1 - t;
		v.z += fall * fall * 0.48;
		v.x *= 0.72 + fall * 0.38;
		pos.setXYZ(i, v.x, v.y, v.z);
	}
	geo.computeVertexNormals();
	return geo;
}

export function createWaterfallMesh():THREE.Group {
	const n = getNature();
	const g = new THREE.Group();
	g.userData.kind = 'waterfall';
	const height = 2.48;
	const sheets:[number, number, number, { speed:number; shift:number; mist?:boolean }][] = [
		[2.05, 0.04, height, { speed: 1.15, shift: 0 }],
		[1.72, 0.16, height * 0.96, { speed: 1.85, shift: 1.7 }],
		[1.38, 0.28, height * 0.9, { speed: 2.35, shift: 3.1, mist: true }],
	];
	for (const [w, z, h, opts] of sheets) {
		const mesh = new THREE.Mesh(fallCurtain(w, h), waterfallSheetMat(opts));
		mesh.position.set(0, h * 0.5 - 0.06, z);
		mesh.castShadow = false;
		mesh.frustumCulled = false;
		g.add(mesh);
	}
	const crest = new THREE.Mesh(new THREE.PlaneGeometry(1.85, 0.42, 4, 2), waterfallSheetMat({ speed: 0.85, shift: 0.4 }));
	crest.rotation.x = -0.72;
	crest.position.set(0, height - 0.12, -0.06);
	crest.castShadow = false;
	g.add(crest);
	const foam = new THREE.Mesh(new THREE.CircleGeometry(1.05, 28), waterfallFoamMat());
	foam.rotation.x = -Math.PI / 2;
	foam.position.set(0.05, 0.06, 0.72);
	g.add(foam);
	const splash = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.18, 0.22), waterfallSplashMat(), 22);
	splash.frustumCulled = false;
	const dummy = new THREE.Object3D();
	for (let i = 0; i < 22; i++) {
		const a = (i / 22) * Math.PI * 2;
		const r = 0.22 + (i % 5) * 0.12;
		dummy.position.set(Math.cos(a) * r * 0.85, 0.04, 0.55 + Math.sin(a) * r * 0.45);
		dummy.rotation.set(0, a * 0.3, 0);
		dummy.scale.setScalar(0.55 + (i % 4) * 0.2);
		dummy.updateMatrix();
		splash.setMatrixAt(i, dummy.matrix);
	}
	splash.instanceMatrix.needsUpdate = true;
	g.add(splash);
	const rock = boulderMat(n.boulder);
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
	const n = getNature();
	const wood = natureMat(n.wood);
	const g = new THREE.Group();
	g.userData.kind = 'lever';
	const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.05, 0.14), wood);
	post.position.y = 0.52;
	post.castShadow = true;
	g.add(post);
	const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.7), std(0x6a3a22));
	arm.name = 'arm';
	arm.position.set(0, 0.92, 0.2);
	g.add(arm);
	g.userData.arm = arm;
	return g;
}
