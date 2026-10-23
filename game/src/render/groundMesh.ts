import * as THREE from 'three';
import { hash } from '@arc-director/kindling';
import { CELL_SIZE } from '../world/constants';
import { CLIFF_TILE, GRASS_UV_REP, GRASS_Y } from './nature';
import type { Flow } from './waterFlow';

/** Flat ground and water sheets, built triangle by triangle (with water's `flow` and `shore` attributes). */

export type YBuf = { pos:number[]; nrm:number[]; uv:number[]; flow:number[]; shore:number[]; idx:number[]; v:number };

export function makeYBuf():YBuf {
	return { pos: [], nrm: [], uv: [], flow: [], shore: [], idx: [], v: 0 };
}

const edge = new THREE.Vector3();
const edge2 = new THREE.Vector3();

/** A sheet's height: level, or a height field over world XZ (a sloping bank). */
export type Height = number | ((x:number, z:number)=>number);

export function pushYTri(
	buf:YBuf,
	ax:number,
	az:number,
	bx:number,
	bz:number,
	cx:number,
	cz:number,
	y:Height,
	rep:number,
	fa?:Flow,
	fb?:Flow,
	fc?:Flow,
	sa?:number,
	sb?:number,
	sc?:number,
):void {
	const [ya, yb, yc] = typeof y === 'number' ? [y, y, y] : [y(ax, az), y(bx, bz), y(cx, cz)];
	buf.pos.push(ax, ya, az, bx, yb, bz, cx, yc, cz);
	// Face normal, upward; +Y on the level (and for a sliver too thin to have one).
	const n = edge.set(cx - ax, yc - ya, cz - az).cross(edge2.set(bx - ax, yb - ya, bz - az));
	if (n.lengthSq() < 1e-12) {
		n.set(0, 1, 0);
	}
	n.normalize().multiplyScalar(Math.sign(n.y) || 1);
	buf.nrm.push(n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z);
	buf.uv.push(ax / rep, az / rep, bx / rep, bz / rep, cx / rep, cz / rep);
	if (fa && fb && fc) {
		buf.flow.push(fa.x, fa.z, fb.x, fb.z, fc.x, fc.z);
	}
	if (sa !== undefined && sb !== undefined && sc !== undefined) {
		buf.shore.push(sa, sb, sc);
	}
	buf.idx.push(buf.v, buf.v + 1, buf.v + 2);
	buf.v += 3;
}

export function pushYPoly(
	buf:YBuf,
	pts:{ x:number; z:number }[],
	y:Height,
	rep:number,
	flowAt?:(x:number, z:number)=>Flow,
	shoreAt?:(x:number, z:number)=>number,
):void {
	if (pts.length < 3) {
		return;
	}
	const at = (x:number, z:number):Flow | undefined => flowAt?.(x, z);
	const sh = (x:number, z:number):number | undefined => shoreAt?.(x, z);
	const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
	const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
	for (let i = 0; i < pts.length; i++) {
		const a = pts[i];
		const b = pts[(i + 1) % pts.length];
		pushYTri(buf, cx, cz, b.x, b.z, a.x, a.z, y, rep, at(cx, cz), at(b.x, b.z), at(a.x, a.z), sh(cx, cz), sh(b.x, b.z), sh(a.x, a.z));
	}
}

export function finishYMesh(buf:YBuf, mat:THREE.Material, shadows:boolean):THREE.Mesh {
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
	geo.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nrm, 3));
	geo.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
	if (buf.flow.length === buf.v * 2) {
		geo.setAttribute('flow', new THREE.Float32BufferAttribute(buf.flow, 2));
	}
	if (buf.shore.length === buf.v) {
		geo.setAttribute('shore', new THREE.Float32BufferAttribute(buf.shore, 1));
	}
	geo.setIndex(buf.idx);
	const mesh = new THREE.Mesh(geo, mat);
	mesh.receiveShadow = shadows;
	return mesh;
}

export type Point = { x:number; z:number };

/** Every surface already drawn at `x, z`, earth included. The lowest is the earth; the highest under a new top is the layer it sits on. */
export type GroundAt = (x:number, z:number)=>number[];

/** Where a skirt of `top` ends. An edge on the cell corners stops on the layer under it; any other edge goes down to the earth. */
function skirtBottom(levels:number[], top:number, corners:boolean):number {
	if (levels.length === 0) {
		return top;
	}
	let cover = -Infinity;
	let earth = Infinity;
	let under = -Infinity;
	for (const y of levels) {
		cover = Math.max(cover, y);
		earth = Math.min(earth, y);
		if (y < top - 0.004) {
			under = Math.max(under, y);
		}
	}
	if (cover >= top - 0.004) {
		return top;
	}
	if (corners) {
		return under === -Infinity ? top : under;
	}
	return earth;
}

/** An outline on the ground at height `y` (level, or a height field), its corners in order (NW, NE, SE, SW for a cell): two triangles for a quad, else a fan. */
export function pushGround(buf:YBuf, pts:Point[], y:Height = GRASS_Y, ground?:GroundAt):void {
	if (ground && typeof y === 'number') {
		drawGroundSurface(buf, pts, y, ground);
		return;
	}
	if (pts.length === 4) {
		// CCW from +Y so Lambert/sun hit the top face.
		pushYTri(buf, pts[0].x, pts[0].z, pts[2].x, pts[2].z, pts[1].x, pts[1].z, y, GRASS_UV_REP);
		pushYTri(buf, pts[0].x, pts[0].z, pts[3].x, pts[3].z, pts[2].x, pts[2].z, y, GRASS_UV_REP);
	}
	else {
		pushYPoly(buf, pts, y, GRASS_UV_REP);
	}
}

/**
 * A closed outline at `top`. Each edge skirts down to the earth just outside it, unless both of its ends sit on a
 * cell's corners, in which case it stops on the surface drawn under it. A long edge splits where its two halves meet
 * different ground, so a corner steps. Where the outside is already at `top`, there is no skirt.
 */
export function drawGroundSurface(buf:YBuf, ring:Point[], top:number, ground:GroundAt):void {
	if (ring.length < 3) {
		return;
	}
	// Both ends of the edge are on a cell corner when each is at most this far from one, in manhattan distance.
	const nearCorner = 0.05;
	const atCorner = (p:Point):boolean => {
		const x0 = Math.floor(p.x / CELL_SIZE) * CELL_SIZE;
		const z0 = Math.floor(p.z / CELL_SIZE) * CELL_SIZE;
		for (const cx of [x0, x0 + CELL_SIZE]) {
			for (const cz of [z0, z0 + CELL_SIZE]) {
				if (Math.abs(p.x - cx) + Math.abs(p.z - cz) <= nearCorner) {
					return true;
				}
			}
		}
		return false;
	};
	const pts:(Point & { skirt:number })[] = [];
	for (let i = 0; i < ring.length; i++) {
		const a = ring[i]!;
		const b = ring[(i + 1) % ring.length]!;
		const dx = b.x - a.x;
		const dz = b.z - a.z;
		const len = Math.hypot(dx, dz);
		const nx = len > 1e-4 ? dz / len : 0;
		const nz = len > 1e-4 ? -dx / len : 0;
		const corners = atCorner(a) && atCorner(b);
		const hAt = (t:number):number => skirtBottom(ground(a.x + dx * t + nx * 0.02, a.z + dz * t + nz * 0.02), top, corners);
		const mid = len > 0.6;
		const h0 = hAt(mid ? 0.25 : 0.5);
		const h1 = mid ? hAt(0.75) : h0;
		pts.push({ x: a.x, z: a.z, skirt: h0 });
		if (Math.abs(h0 - h1) >= 0.004) {
			pts.push({ x: a.x + dx * 0.5, z: a.z + dz * 0.5, skirt: h1 });
		}
	}
	const vert = (x:number, y:number, z:number, nx:number, ny:number, nz:number, u:number, v:number):number => {
		buf.pos.push(x, y, z);
		buf.nrm.push(nx, ny, nz);
		buf.uv.push(u, v);
		return buf.v++;
	};
	const ix = pts.map((p) => vert(p.x, top, p.z, 0, 1, 0, p.x / GRASS_UV_REP, p.z / GRASS_UV_REP));
	const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
	const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
	const ci = vert(cx, top, cz, 0, 1, 0, cx / GRASS_UV_REP, cz / GRASS_UV_REP);
	for (let i = 0; i < pts.length; i++) {
		buf.idx.push(ci, ix[(i + 1) % pts.length]!, ix[i]!);
	}
	for (let i = 0; i < pts.length; i++) {
		const j = (i + 1) % pts.length;
		const a = pts[i]!;
		const b = pts[j]!;
		const drop = top - a.skirt;
		if (drop < 0.004) {
			continue;
		}
		const dx = b.x - a.x;
		const dz = b.z - a.z;
		const len = Math.hypot(dx, dz);
		if (len < 1e-4) {
			continue;
		}
		const nx = dz / len;
		const nz = -dx / len;
		const tb = vert(b.x, top, b.z, nx, 0, nz, b.x / GRASS_UV_REP, b.z / GRASS_UV_REP);
		const ta = vert(a.x, top, a.z, nx, 0, nz, a.x / GRASS_UV_REP, a.z / GRASS_UV_REP);
		const bb = vert(b.x, a.skirt, b.z, nx, 0, nz, b.x / GRASS_UV_REP, b.z / GRASS_UV_REP);
		const ba = vert(a.x, a.skirt, a.z, nx, 0, nz, a.x / GRASS_UV_REP, a.z / GRASS_UV_REP);
		buf.idx.push(ta, tb, bb, ta, bb, ba);
	}
}

/**
 * Lays riverbank sand's picture across its bank, dry at the picture's top to wet at its bottom, over the triangles `buf`
 * has pushed since vertex `from`. `wetAt` is how far down the bank a point is (0 the dry top, 1 at the water);
 * `alongX` whether the bank runs along X there (else along Z), asked once per triangle, so the picture runs along
 * the bank, a copy every `tile` meters.
 */
export function bankUV(buf:YBuf, from:number, tile:number, wetAt:(x:number, z:number)=>number, alongX:(x:number, z:number)=>boolean):void {
	for (let v = from; v + 2 < buf.v; v += 3) {
		const p = buf.pos;
		const x = (p[v * 3]! + p[v * 3 + 3]! + p[v * 3 + 6]!) / 3;
		const z = (p[v * 3 + 2]! + p[v * 3 + 5]! + p[v * 3 + 8]!) / 3;
		const byX = alongX(x, z);
		for (let k = v; k < v + 3; k++) {
			const vx = p[k * 3]!;
			const vz = p[k * 3 + 2]!;
			buf.uv[k * 2] = (byX ? vx : vz) / tile;
			buf.uv[k * 2 + 1] = 1 - THREE.MathUtils.clamp(wetAt(vx, vz), 0, 1);
		}
	}
}

/** A world XZ box, meters. */
export type Box = { minX:number; maxX:number; minZ:number; maxZ:number };

/**
 * Both water sheets over a box: `lower` the bed at `bedY`, `upper` the current lines at `linesY`, flowing with `flow`.
 * `land` says what is not water, so the banks get their edge line wherever the box meets it. Half-meter quads across
 * the box, so a narrow river is deep between its banks; longer ones down a long box.
 */
export function pushWaterBox(lower:YBuf, upper:YBuf, box:Box, bedY:number, linesY:number, flow:Flow, land:(x:number, z:number)=>boolean):void {
	const shore = (x:number, z:number):number => [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]
		.filter(([dx, dz]) => land(x + dx!, z + dz!)).length / 4;
	const quads = (span:number):number => Math.max(1, Math.round(span / (span > 4 ? 2 : 0.5)));
	const nx = quads(box.maxX - box.minX);
	const nz = quads(box.maxZ - box.minZ);
	for (let iz = 0; iz < nz; iz++) {
		for (let ix = 0; ix < nx; ix++) {
			const x0 = box.minX + ((box.maxX - box.minX) * ix) / nx;
			const x1 = box.minX + ((box.maxX - box.minX) * (ix + 1)) / nx;
			const z0 = box.minZ + ((box.maxZ - box.minZ) * iz) / nz;
			const z1 = box.minZ + ((box.maxZ - box.minZ) * (iz + 1)) / nz;
			for (const [buf, y] of [[lower, bedY], [upper, linesY]] as const) {
				// CCW from +Y, as `pushGround`.
				pushYTri(buf, x0, z0, x1, z1, x1, z0, y, 1, flow, flow, flow, shore(x0, z0), shore(x1, z1), shore(x1, z0));
				pushYTri(buf, x0, z0, x0, z1, x1, z1, y, 1, flow, flow, flow, shore(x0, z0), shore(x0, z1), shore(x1, z1));
			}
		}
	}
}

/**
 * A flat rock face standing on the line `a`–`b`, from `y0` up to `y1`, facing away from the high side (`into`, a
 * unit XZ vector toward it), painted with the cliff picture in meters across (`x + z`) and up from its foot.
 */
export function pushRockFace(pos:number[], uv:number[], idx:number[], a:Point, b:Point, y0:number, y1:number, into:Point):void {
	// Face away from the high side: (b - a) × up must point against `into`.
	if (-(b.z - a.z) * into.x + (b.x - a.x) * into.z > 0) {
		[a, b] = [b, a];
	}
	const len = Math.hypot(b.x - a.x, b.z - a.z);
	const n = Math.max(1, Math.ceil(len / 2));
	const m = Math.max(1, Math.ceil((y1 - y0) / 4));
	const first = pos.length / 3;
	for (let j = 0; j <= m; j++) {
		const y = y0 + ((y1 - y0) * j) / m;
		for (let i = 0; i <= n; i++) {
			const t = i / n;
			const x = a.x + (b.x - a.x) * t;
			const z = a.z + (b.z - a.z) * t;
			// Meters across (one face runs along X or Z) and up from the foot, in pictures.
			pos.push(x, y, z);
			uv.push((x + z) / CLIFF_TILE.across, (y - y0) / CLIFF_TILE.up);
		}
	}
	for (let j = 0; j < m; j++) {
		for (let i = 0; i < n; i++) {
			const p = first + j * (n + 1) + i;
			idx.push(p, p + 1, p + n + 2, p, p + n + 2, p + n + 1);
		}
	}
}

/** One mesh of every rock face pushed. */
export function finishRock(pos:number[], uv:number[], idx:number[], mat:THREE.Material):THREE.Mesh | undefined {
	if (idx.length === 0) {
		return undefined;
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	geo.setIndex(idx);
	geo.computeVertexNormals();
	const mesh = new THREE.Mesh(geo, mat);
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	return mesh;
}
