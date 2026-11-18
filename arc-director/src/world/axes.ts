import { add, cross, dot, unit } from './vec.js';
import type { Vec } from './world-types.js';

/**
 * Which way is which in the game's world, as directions in its own coordinates (any length): `forward` is north and
 * where a thing faces at rest, `right` east, `up` up. 3D gives `forward` and `up`, and `right` or `handed` (right-handed,
 * `right` is `forward × up`; left-handed, `up × forward`); 2D gives `forward` and `right`; 1D `forward` alone. Checked as
 * the world is wired (`withWorld`): at right angles, or it throws. Presets for common engines: {@link Axes}.
 */
export type Axes = { forward:Vec; right?:Vec; up?:Vec; handed?:'left' | 'right' };

/** Flat 2D: ahead down the second coordinate, right up the first. */
const FLAT:Axes = { forward: [0, -1], right: [1, 0] };

/** The axes of common engines, and of 2D games. */
export const Axes = Object.freeze({
	/** Unity: +Z forward, +Y up, +X right; left-handed. */
	Unity: { forward: [0, 0, 1], up: [0, 1, 0], handed: 'left' },
	/** Unreal: +X forward, +Z up, +Y right; left-handed. */
	Unreal: { forward: [1, 0, 0], up: [0, 0, 1], handed: 'left' },
	/** Godot: −Z forward (`Vector3.FORWARD`), +Y up, +X right; right-handed. */
	Godot: { forward: [0, 0, -1], up: [0, 1, 0], handed: 'right' },
	/** Three.js, and Kindling: −Z forward, +Y up, +X right; right-handed. */
	ThreeJS: { forward: [0, 0, -1], up: [0, 1, 0], handed: 'right' },
	/** The ground of a Y-up world as 2D `[x, z]`: −Z ahead, +X right. The same axes as {@link Axes.Screen}: +Z is south. */
	Plane: FLAT,
	/** Screen `[x, y]`, y down: up the screen ahead, +X right. The same axes as {@link Axes.Plane}: +Y is down the screen. */
	Screen: FLAT,
} satisfies Record<string, Axes>);

/** How far from right angles, or from `forward × up`, rounding may leave the axes. */
const TOLERANCE = 1e-4;

/**
 * `axes` at length 1, with `right` filled in (2D and 3D) and `handed` (3D): what every other function here takes.
 * Throws when they say too little or are not at right angles. Cheap enough to check on each use, so nothing is cached.
 */
export function checkAxes(axes:Axes | undefined):Axes {
	if (!axes) {
		throw new Error('withWorld: geometry needs axes: Axes.Unity, Axes.Unreal, Axes.Godot, Axes.ThreeJS, Axes.Plane, Axes.Screen, or your own');
	}
	return check(axes);
}

function check({ forward, right, up, handed }:Axes):Axes {
	const fail = (why:string):never => {
		throw new Error(`withWorld: axes ${why}`);
	};
	const f = unit(forward) ?? fail('need a forward');
	if ([right, up].some((v) => v && v.length !== f.length && f.length > 1)) {
		fail('must all have as many numbers');
	}
	if (f.length === 1) {
		return { forward: f };
	}
	const r = right && (unit(right) ?? fail('right has no length'));
	if (f.length === 2) {
		if (!r) {
			return fail('in 2D need forward and right');
		}
		return Math.abs(dot(f, r)) > TOLERANCE ? fail('must be at right angles: forward and right are not') : { forward: f, right: r };
	}
	const u = (up && unit(up)) ?? fail('in 3D need forward and up');
	if (Math.abs(dot(f, u)) > TOLERANCE) {
		fail('must be at right angles: forward and up are not');
	}
	const rightHanded = cross(f, u);
	const leftHanded = cross(u, f);
	if (!r) {
		return handed ? { forward: f, right: handed === 'right' ? rightHanded : leftHanded, up: u, handed } : fail('in 3D need right or handed');
	}
	const near = (a:Vec):boolean => a.every((v, i) => Math.abs(v - r[i]) <= TOLERANCE);
	const hand = near(rightHanded) ? 'right' : near(leftHanded) ? 'left' : fail('must be at right angles: right is not forward × up in either order');
	return handed && handed !== hand ? fail(`are ${hand}-handed by their right, not ${handed}-handed`) : { forward: f, right: r, up: u, handed: hand };
}

/**
 * The right hand of one facing `facing`, in checked `axes`' handedness, standing along `up` (a {@link Pose}'s, else
 * the world's): undefined in 1D, or facing straight along `up`.
 */
export function rightOf(facing:Vec, axes:Axes, up = axes.up):Vec | undefined {
	const { forward, right, handed } = axes;
	if (facing.length === 2 && right) {
		// Turned from `forward` as far as `facing` is, its right is turned from `right` alike.
		return unit(add(right.map((v) => v * dot(facing, forward)), forward, -dot(facing, right)));
	}
	return facing.length === 3 && up ? unit(handed === 'left' ? cross(up, facing) : cross(facing, up)) : undefined;
}

/** The ahead, right and up of one facing `facing` in checked `axes` (as many as they have), standing along `up`. */
function frameOf(facing:Vec, axes:Axes, up = axes.up):Vec[] {
	const ahead = unit(facing) ?? axes.forward;
	if (ahead.length === 1) {
		return [ahead];
	}
	const right = rightOf(ahead, axes, up) ?? axes.right!;
	return ahead.length === 2 ? [ahead, right] : [ahead, right, axes.handed === 'left' ? cross(ahead, right) : cross(right, ahead)];
}

/**
 * `dir` as one facing `facing` sees it, told in checked `axes` as if it faced `forward` at rest (Unity's
 * `InverseTransformDirection`): straight ahead comes back as `forward`, its right as `right`. `up` is its own, if not the
 * world's.
 */
export function toLocal(dir:Vec, facing:Vec, axes:Axes, up = axes.up):Vec {
	const seen = frameOf(facing, axes, up);
	return frameOf(axes.forward, axes).reduce((sum, axis, i) => add(sum, axis, dot(dir, seen[i])), axes.forward.map(() => 0));
}

/** Two axes of the ground in checked `axes`, east (`right`) and north (`forward`): the line in 1D (second axis zero). */
export function groundAxes(axes:Axes):[Vec, Vec] {
	return axes.right ? [axes.right, axes.forward] : [axes.forward, axes.forward.map(() => 0)];
}
