import type { GameObject } from './GameObject.js';

/** A point or direction on the ground, in world meters. A `Transform.position` is one too (its `y` is ignored). */
export interface XZ { x:number; z:number }

/** Straight-line distance on the ground between two points or GameObjects (a GameObject counts at its position). */
export function distanceXZ(a:XZ | GameObject, b:XZ | GameObject):number {
	const from = groundOf(a);
	const to = groundOf(b);
	return Math.hypot(from.x - to.x, from.z - to.z);
}

/** A point as it is; a GameObject (it has no `x`) at its position. */
function groundOf(at:XZ | GameObject):XZ {
	return 'x' in at ? at : at.transform.position;
}
