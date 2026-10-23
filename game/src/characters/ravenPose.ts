import type * as THREE from 'three';
import { PROP_MODELS } from '../render/characterModels';

/** Wing beats per second in flight. */
const FLAP_HZ = 5;

/** How high the feet are above the model's lowest point, the hanging tail tip (m); the rig sinks this much so it stands on them. */
const FEET = 0.19 * PROP_MODELS.Raven;

/**
 * Bone turns (radians, file frame: the bird faces +Z, its left wing along +X) for one pose, and how
 * wide the tail fans (1 = spread as built; less squeezes the feathers together).
 */
export type Pose = { body:number; head:[number, number]; tail:number; fan:number; wing:[number, number, number]; tip:[number, number, number] };

/** Leaning forward over its feet, wings folded against the body, tail feathers together. */
export const FOLDED:Pose = { body: 0.35, head: [0, 0], tail: 0, fan: 0.26, wing: [-0.44, -0.74, -0.98], tip: [0.91, 0.22, -1.72] };

/** `u` (0–1) of the way through a flight at game time `now`: beats hard rising and landing, glides on the way. */
export function flightPose(u:number, now:number):Pose {
	const beat = 0.35 + 0.65 * Math.abs(Math.cos(Math.PI * u));
	const ph = now * FLAP_HZ * Math.PI * 2;
	const open = Math.min(1, u * 8, (1 - u) * 8);
	return {
		body: FOLDED.body * (1 - open) + 0.35 * open,
		head: [-0.25 * open, 0],
		tail: -0.15 * open,
		fan: FOLDED.fan + (1 - FOLDED.fan) * open,
		wing: [FOLDED.wing[0] * (1 - open), FOLDED.wing[1] * (1 - open), FOLDED.wing[2] * (1 - open) + Math.sin(ph) * 0.9 * beat * open],
		tip: [FOLDED.tip[0] * (1 - open), FOLDED.tip[1] * (1 - open), FOLDED.tip[2] * (1 - open) + Math.sin(ph - 0.7) * 0.5 * beat * open],
	};
}

/** `u` of the way through two quick jabs at the ground, leaning over its feet. */
export function peckPose(u:number):Pose {
	const jab = Math.max(0, Math.sin(Math.PI * 2 * u));
	return { ...FOLDED, body: FOLDED.body + 0.55 * jab, head: [0.6 * jab, 0], tail: -0.3 * jab };
}

/** `u` of the way through a hop: wings lift a little, tail up. */
export function hopPose(u:number):Pose {
	const bump = Math.sin(Math.PI * u);
	return { ...FOLDED, wing: [FOLDED.wing[0] - 0.25 * bump, FOLDED.wing[1], FOLDED.wing[2] + 0.3 * bump], tail: 0.25 * bump };
}

/** `u` of the way through a glance `yaw` radians aside and back. */
export function lookPose(u:number, yaw:number):Pose {
	const bump = Math.sin(Math.PI * u);
	return { ...FOLDED, head: [-0.15 * bump, yaw * bump] };
}

/** Sets the rig's bones (`buildModels.mjs` `bird`); the right side mirrors the left. `Legs` never turn. */
export function applyPose(root:THREE.Object3D, pose:Pose):void {
	root.position.y = -FEET;
	const set = (name:string, x:number, y:number, z:number):void => {
		root.getObjectByName(name)?.rotation.set(x, y, z);
	};
	set('Body', pose.body, 0, 0);
	set('Head', pose.head[0], pose.head[1], 0);
	set('Tail', pose.tail, 0, 0);
	root.getObjectByName('Tail')?.scale.set(pose.fan, 1, 1);
	set('WingL', pose.wing[0], pose.wing[1], pose.wing[2]);
	set('WingR', pose.wing[0], -pose.wing[1], -pose.wing[2]);
	set('WingTipL', pose.tip[0], pose.tip[1], pose.tip[2]);
	set('WingTipR', pose.tip[0], -pose.tip[1], -pose.tip[2]);
}
