import type { Vec } from './world-types.js';

export function sub(a:Vec, b:Vec):Vec {
	return a.map((v, i) => v - (b[i] ?? 0));
}

export function add(a:Vec, b:Vec, scale = 1):Vec {
	return a.map((v, i) => v + (b[i] ?? 0) * scale);
}

export function dot(a:Vec, b:Vec):number {
	let sum = 0;
	for (let i = 0; i < a.length; i++) {
		sum += a[i] * (b[i] ?? 0);
	}
	return sum;
}

export function length(a:Vec):number {
	return Math.sqrt(dot(a, a));
}

export function distance(a:Vec, b:Vec):number {
	return length(sub(a, b));
}

/** The 3D cross product: across both, right-handed. */
export function cross(a:Vec, b:Vec):Vec {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** `a` scaled to length 1, or `undefined` when it has none. */
export function unit(a:Vec):Vec | undefined {
	const len = length(a);
	return len > 1e-9 ? a.map((v) => v / len) : undefined;
}

/** Cosine between `dir` and the way from `from` to `to`, -1 … 1. Same point: 1. */
export function cosToward(dir:Vec, from:Vec, to:Vec):number {
	const way = unit(sub(to, from));
	const d = unit(dir);
	return way && d ? Math.max(-1, Math.min(1, dot(d, way))) : 1;
}

export function centroid(points:Vec[]):Vec | undefined {
	if (points.length === 0) {
		return undefined;
	}
	const sum = points.reduce((acc, p) => add(acc, p), points[0].map(() => 0));
	return sum.map((v) => v / points.length);
}

/** Two unit directions at right angles to 3D `axis` and to each other. */
export function perpendiculars(axis:Vec):[Vec, Vec] {
	const u = unit(axis) ?? [0, 1, 0];
	const seed = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
	const a = unit(sub(seed, u.map((v) => v * dot(seed, u))))!;
	return [a, cross(u, a)];
}
