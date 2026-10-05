import type { Vec } from './types.js';

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

/**
 * Two orthonormal axes of the ground: the line in 1D (second axis zero), the plane in 2D, and the plane
 * across `up` in 3D.
 */
export function groundAxes(dims:number, up:Vec = [0, 1, 0]):[Vec, Vec] {
	if (dims <= 1) {
		return [[1], [0]];
	}
	if (dims === 2) {
		return [[1, 0], [0, 1]];
	}
	const u = unit(up) ?? [0, 1, 0];
	const seed = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
	const a = unit(sub(seed, u.map((v) => v * dot(seed, u))))!;
	const b = [u[1] * a[2] - u[2] * a[1], u[2] * a[0] - u[0] * a[2], u[0] * a[1] - u[1] * a[0]];
	return [a, b];
}
