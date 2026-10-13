/** A quaternion as `[x, y, z, w]`. */
export type Quat = [number, number, number, number];

/** A rig's rest pose: bones in parent-first order, each with its parent and local rest rotation. */
export type RigRest = {
	order:string[];
	parent:Map<string, string | undefined>;
	rest:Map<string, Quat>;
};

/** Quaternion product a·b. */
export function qmul(a:Quat, b:Quat):Quat {
	return [
		a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
		a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
		a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
		a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
	];
}

/** Inverse of a unit quaternion. */
export function qinv(q:Quat):Quat {
	return [-q[0], -q[1], -q[2], q[3]];
}

const IDENTITY:Quat = [0, 0, 0, 1];

/** World rotations of every bone, from local ones. */
function worldOf(rig:RigRest, local:(bone:string)=>Quat):Map<string, Quat> {
	const world = new Map<string, Quat>();
	for (const bone of rig.order) {
		const parent = rig.parent.get(bone);
		const parentWorld = parent ? world.get(parent) : undefined;
		world.set(bone, parentWorld ? qmul(parentWorld, local(bone)) : local(bone));
	}
	return world;
}

/**
 * Retargets poses between two rigs in the same rest pose (a T-pose) whose bones differ in rest
 * orientation, and possibly in names and count (each Tripo body is rigged a little differently;
 * some are not Mixamo at all). Each bone keeps its world-space turn away from rest, then local
 * rotations are rebuilt down the target's hierarchy. `source` names the source bone that drives a
 * target bone (default: the same name); a target bone without one (a pelvis or twist bone) turns
 * with its parent. Returns a function from one source pose (local rotations; missing bones are at
 * rest) to the target's local rotations.
 */
export function poseRetargeter(
	from:RigRest,
	to:RigRest,
	source:(toBone:string)=>string | undefined = (b) => b,
):(local:(bone:string)=>Quat | undefined)=>Map<string, Quat> {
	const fromRest = worldOf(from, (b) => from.rest.get(b) ?? IDENTITY);
	const toRest = worldOf(to, (b) => to.rest.get(b) ?? IDENTITY);
	return (local) => {
		const fromWorld = worldOf(from, (b) => local(b) ?? from.rest.get(b) ?? IDENTITY);
		const toWorld = new Map<string, Quat>();
		const deltas = new Map<string, Quat>();
		const out = new Map<string, Quat>();
		for (const bone of to.order) {
			const src = source(bone);
			const w = src ? fromWorld.get(src) : undefined;
			const r = src ? fromRest.get(src) : undefined;
			const parent = to.parent.get(bone);
			const delta = w && r ? qmul(w, qinv(r)) : (parent && deltas.get(parent)) || IDENTITY;
			deltas.set(bone, delta);
			const world = qmul(delta, toRest.get(bone) ?? IDENTITY);
			toWorld.set(bone, world);
			const parentWorld = parent ? toWorld.get(parent) : undefined;
			out.set(bone, parentWorld ? qmul(qinv(parentWorld), world) : world);
		}
		return out;
	};
}
