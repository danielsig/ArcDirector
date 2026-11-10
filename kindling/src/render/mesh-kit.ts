import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Mesh-kit primitives for toon props. Geometry only: the host picks materials
 * and draws them instanced. Profiles and paths are in meters, Y up.
 */

export type ProfilePoint = { r:number; y:number };
export type PathPoint = { x:number; y:number; z:number };

/** Surface of revolution around Y. `profile` runs from bottom to top. */
export function lathe(profile:ProfilePoint[], segments = 10):THREE.BufferGeometry {
	const pts = profile.map((p) => new THREE.Vector2(Math.max(p.r, 1e-4), p.y));
	return new THREE.LatheGeometry(pts, Math.max(3, segments));
}

/** Box with rounded vertical edges, sitting on Y = 0. Width is X, depth is Z. */
export function bevelBox(width:number, height:number, depth:number, bevel:number):THREE.BufferGeometry {
	const hw = width * 0.5;
	const hd = depth * 0.5;
	const b = Math.min(Math.max(bevel, 0), hw - 1e-4, hd - 1e-4);
	const shape = new THREE.Shape();
	shape.moveTo(-hw + b, -hd);
	shape.lineTo(hw - b, -hd);
	shape.absarc(hw - b, -hd + b, b, -Math.PI / 2, 0, false);
	shape.lineTo(hw, hd - b);
	shape.absarc(hw - b, hd - b, b, 0, Math.PI / 2, false);
	shape.lineTo(-hw + b, hd);
	shape.absarc(-hw + b, hd - b, b, Math.PI / 2, Math.PI, false);
	shape.lineTo(-hw, -hd + b);
	shape.absarc(-hw + b, -hd + b, b, Math.PI, Math.PI * 1.5, false);
	const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 2 });
	geo.rotateX(-Math.PI / 2);
	return geo;
}

class Polyline extends THREE.Curve<THREE.Vector3> {
	constructor(private readonly _pts:THREE.Vector3[]) {
		super();
	}

	public override getPoint(t:number):THREE.Vector3 {
		const n = this._pts.length - 1;
		if (n <= 0) {
			return this._pts[0]?.clone() ?? new THREE.Vector3();
		}
		const f = THREE.MathUtils.clamp(t, 0, 1) * n;
		const i = Math.min(n - 1, Math.floor(f));
		return this._pts[i]!.clone().lerp(this._pts[i + 1]!, f - i);
	}
}

/** Round tube along a polyline. */
export function tube(points:PathPoint[], radius:number, radialSegments = 5):THREE.BufferGeometry {
	const pts = points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
	if (pts.length < 2) {
		pts.push(new THREE.Vector3(0, radius, 0));
	}
	const curve = new Polyline(pts);
	const segs = Math.max(1, pts.length - 1);
	return new THREE.TubeGeometry(curve, segs, radius, Math.max(3, radialSegments), false);
}

/** Ellipsoid centered on the origin. */
export function blob(rx:number, ry:number, rz:number, widthSegments = 8, heightSegments = 6):THREE.BufferGeometry {
	const geo = new THREE.SphereGeometry(1, Math.max(3, widthSegments), Math.max(2, heightSegments));
	geo.scale(rx, ry, rz);
	return geo;
}

/**
 * Flat strip along a polyline, width across the XZ side (Y is up).
 * Double-sided materials show both faces.
 */
export function ribbon(points:PathPoint[], width:number):THREE.BufferGeometry {
	const pos:number[] = [];
	const idx:number[] = [];
	const up = new THREE.Vector3(0, 1, 0);
	const side = new THREE.Vector3();
	const tan = new THREE.Vector3();
	for (let i = 0; i < points.length; i++) {
		const p = points[i]!;
		const prev = points[Math.max(0, i - 1)]!;
		const next = points[Math.min(points.length - 1, i + 1)]!;
		tan.set(next.x - prev.x, next.y - prev.y, next.z - prev.z);
		if (tan.lengthSq() < 1e-8) {
			tan.set(0, 0, 1);
		}
		tan.normalize();
		side.crossVectors(tan, up);
		if (side.lengthSq() < 1e-8) {
			side.set(1, 0, 0);
		}
		side.normalize().multiplyScalar(width * 0.5);
		pos.push(p.x + side.x, p.y + side.y, p.z + side.z, p.x - side.x, p.y - side.y, p.z - side.z);
	}
	for (let i = 0; i < points.length - 1; i++) {
		const a = i * 2;
		idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	geo.setIndex(idx);
	geo.computeVertexNormals();
	return geo;
}

/** A geometry posed in a shared frame: tilt (X, Z) first, then yaw (Y), then move. */
export type PosedPart = {
	geo:THREE.BufferGeometry;
	x?:number;
	y?:number;
	z?:number;
	rx?:number;
	ry?:number;
	rz?:number;
};

/**
 * Merge posed parts into one geometry, so a static assembly is one draw. Keeps position and normal,
 * and color when every part has it. Sources are left untouched.
 */
export function mergeParts(parts:PosedPart[]):THREE.BufferGeometry {
	const m = new THREE.Matrix4();
	const e = new THREE.Euler();
	const colored = parts.every((p) => p.geo.getAttribute('color'));
	const posed = parts.map((p) => {
		const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
		for (const name of Object.keys(g.attributes)) {
			if (name !== 'position' && name !== 'normal' && !(colored && name === 'color')) {
				g.deleteAttribute(name);
			}
		}
		if (!g.getAttribute('normal')) {
			g.computeVertexNormals();
		}
		g.applyMatrix4(m.makeRotationFromEuler(e.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0, 'YXZ')).setPosition(p.x ?? 0, p.y ?? 0, p.z ?? 0));
		return g;
	});
	const out = mergeGeometries(posed);
	for (const g of posed) {
		g.dispose();
	}
	if (!out) {
		throw new Error('mergeParts: parts have mismatched attributes');
	}
	out.computeBoundingSphere();
	return out;
}
