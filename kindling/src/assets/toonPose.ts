import * as THREE from 'three';
import { humanBone, restTurn } from './toonModel.js';

// Pose touches on top of a playing clip, for toon models from `scripts/buildModels.mjs`: a prop in a
// hand, the head turned toward something, an arm reaching, a bow drawn. The look and reach ones
// overwrite bone rotations the clip just set, so call them every frame after the `Animator` runs
// (in `lateUpdate`); weight 0 leaves the clip's pose alone.

export type Hand = 'left' | 'right';

/**
 * How a prop sits in a hand. Props stand up their long axis (+Y of the prop's root); the fist
 * closes around it. Angles are for a hand at rest (the T-pose: palm down, fist pointing ahead).
 */
export type Grip = {
	/** Where the hand closes, as a fraction of the prop's height (default 0.5). A prop with a `Grip` node is held there instead. */
	at?:number;
	/** Turn of the long axis (radians) from straight out of the fist toward the elbow. */
	tilt?:number;
	/** Turn about the long axis. At 0 the prop's +X points up the arm, toward the elbow (a Tripo bow's string toward the archer). */
	roll?:number;
};

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/**
 * Puts `prop` (an instance of a registered model) in `root`'s hand, as a child of the hand bone, so
 * it follows every clip. Returns false (and does nothing) when `root` has no such hand.
 */
export function holdInHand(root:THREE.Object3D, hand:Hand, prop:THREE.Object3D, grip:Grip = {}):boolean {
	const bone = humanBone(root, `${hand}Hand`);
	const turn = bone && restTurn(root, bone.name);
	if (!bone || !turn) {
		return false;
	}
	const { at = 0.5, tilt = 0, roll = 0 } = grip;
	// The hand at rest, in the root's frame (facing −Z, the model's right on +X): the arm points out
	// to its side, the fist ahead.
	const elbow = new THREE.Vector3(hand === 'left' ? 1 : -1, 0, 0);
	const axis = new THREE.Vector3(0, 0, -1).multiplyScalar(Math.cos(tilt)).addScaledVector(elbow, Math.sin(tilt));
	const side = elbow.clone().addScaledVector(axis, -elbow.dot(axis)).normalize().applyAxisAngle(axis, roll);
	const held = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, axis, new THREE.Vector3().crossVectors(side, axis)));
	const rotation = turn.clone().invert().multiply(held);

	// The grip point in the prop root's space.
	prop.position.set(0, 0, 0);
	prop.quaternion.identity();
	prop.scale.setScalar(1);
	prop.updateMatrixWorld(true);
	const gripNode = prop.getObjectByName('Grip');
	const box = new THREE.Box3().setFromObject(prop);
	const point = gripNode ? gripNode.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, THREE.MathUtils.lerp(box.min.y, box.max.y, at), 0);

	// The palm: halfway to the middle finger's knuckle, a little below the bones.
	const knuckle = humanBone(root, `${hand}MiddleProximal`)?.position ?? new THREE.Vector3();
	const down = new THREE.Vector3(0, -1, 0).applyQuaternion(turn.clone().invert());
	const palm = knuckle.clone().multiplyScalar(0.5).addScaledVector(down, 0.3 * knuckle.length());

	// Undo the character's scale, so the prop keeps its own size.
	root.updateMatrixWorld(true);
	const scale = 1 / bone.getWorldScale(new THREE.Vector3()).x;
	prop.quaternion.copy(rotation);
	prop.scale.setScalar(scale);
	prop.position.copy(palm).sub(point.multiplyScalar(scale).applyQuaternion(rotation));
	bone.add(prop);
	return true;
}

/** Turns a bone by `turn` (world space), keeping its parent where it is. */
function turnBone(bone:THREE.Object3D, turn:THREE.Quaternion):void {
	const parent = bone.parent!.getWorldQuaternion(_q2);
	const world = bone.getWorldQuaternion(_q).premultiply(turn);
	bone.quaternion.copy(parent.invert().multiply(world));
	bone.updateMatrixWorld(true);
}

/** Furthest the head turns from where the body faces before it gives up on a target behind. */
const LOOK_REACH = 1.75;
/** Most the head and neck turn away from the clip's pose. */
const LOOK_LIMIT = 1.1;

/**
 * Turns `root`'s neck and head toward `target` (world), `weight` of the way (0–1). Targets behind
 * the body fade out instead of wringing the neck.
 */
export function lookAt(root:THREE.Object3D, target:THREE.Vector3, weight:number):void {
	const head = humanBone(root, 'head');
	const turn = head && restTurn(root, head.name);
	if (!head || !turn || weight <= 0) {
		return;
	}
	const neck = humanBone(root, 'neck');
	root.updateMatrixWorld(true);
	const eye = head.getWorldPosition(new THREE.Vector3());
	const want = target.clone().sub(eye).normalize();
	// Faces ahead (−Z of the root): through the head's rest turn, then where the clip has it now.
	const face = new THREE.Vector3(0, 0, -1).applyQuaternion(turn.clone().invert()).applyQuaternion(head.getWorldQuaternion(_q));
	const body = new THREE.Vector3(0, 0, -1).applyQuaternion(root.getWorldQuaternion(_q));
	const behind = THREE.MathUtils.smoothstep(body.angleTo(want), LOOK_REACH - 0.4, LOOK_REACH);
	const amount = weight * (1 - behind);
	if (amount <= 0) {
		return;
	}
	const full = new THREE.Quaternion().setFromUnitVectors(face, want);
	const angle = 2 * Math.acos(Math.min(1, Math.abs(full.w)));
	const share = amount * Math.min(1, LOOK_LIMIT / Math.max(angle, 1e-6));
	if (neck) {
		turnBone(neck, new THREE.Quaternion().slerp(full, share * 0.4));
	}
	turnBone(head, new THREE.Quaternion().slerp(full, share * (neck ? 0.6 : 1)));
}

/**
 * Bends `root`'s arm so the hand reaches `target` (world), `weight` of the way (0–1): two-bone IK
 * from the shoulder, the elbow staying on the side the clip bent it.
 */
export function reach(root:THREE.Object3D, hand:Hand, target:THREE.Vector3, weight:number):void {
	const upper = humanBone(root, `${hand}UpperArm`);
	const lower = humanBone(root, `${hand}LowerArm`);
	const wrist = humanBone(root, `${hand}Hand`);
	if (!upper || !lower || !wrist || weight <= 0) {
		return;
	}
	root.updateMatrixWorld(true);
	const a = upper.getWorldPosition(new THREE.Vector3());
	const b = lower.getWorldPosition(new THREE.Vector3());
	const c = wrist.getWorldPosition(new THREE.Vector3());
	const t = c.clone().lerp(target, Math.min(1, weight));
	const ab = b.distanceTo(a);
	const bc = c.distanceTo(b);
	const at = THREE.MathUtils.clamp(t.distanceTo(a), 0.01, (ab + bc) * 0.999);
	const angle = (u:THREE.Vector3, v:THREE.Vector3):number => Math.acos(THREE.MathUtils.clamp(u.dot(v), -1, 1));
	const ac = c.clone().sub(a).normalize();
	const abDir = b.clone().sub(a).normalize();
	const ba = a.clone().sub(b).normalize();
	const bcDir = c.clone().sub(b).normalize();
	const law = (x:number, y:number, z:number):number => Math.acos(THREE.MathUtils.clamp((x * x - y * y - z * z) / (-2 * y * z), -1, 1));
	// Open or close the elbow to the right span, then the shoulder, both about the arm's own bend
	// axis (so the hand stays on the shoulder-to-hand line); then swing that line onto the target.
	let bend = _v.crossVectors(ac, abDir);
	if (bend.lengthSq() < 1e-8) {
		bend = _v.set(0, -1, 0).cross(ac);
	}
	bend.normalize();
	turnBone(lower, new THREE.Quaternion().setFromAxisAngle(bend, law(at, ab, bc) - angle(ba, bcDir)));
	turnBone(upper, new THREE.Quaternion().setFromAxisAngle(bend, law(bc, ab, at) - angle(ac, abDir)));
	turnBone(upper, new THREE.Quaternion().setFromUnitVectors(ac, _v2.copy(t).sub(a).normalize()));
}

/** How far each limb of a bow flexes at full draw (radians). */
const BOW_FLEX = 0.35;

/**
 * Draws a bow rigged by `scripts/buildModels.mjs` (`bow`): the string meets at `nock` (world),
 * the limbs flexing with the pull. `null` lets it go slack.
 */
export function drawBow(bow:THREE.Object3D, nock:THREE.Vector3 | null):void {
	const [grip, limbUpper, limbLower, upper, lower] = ['Grip', 'LimbUpper', 'LimbLower', 'StringUpper', 'StringLower'].map((n) => bow.getObjectByName(n));
	if (!grip || !limbUpper || !limbLower || !upper || !lower) {
		return;
	}
	// The string at rest, in the grip's frame (the rig carries no scale).
	const top = limbUpper.position.clone().add(upper.position);
	const bottom = limbLower.position.clone().add(lower.position);
	const half = top.distanceTo(bottom) / 2;
	let flex = 0;
	if (nock) {
		grip.updateMatrixWorld(true);
		const pull = grip.worldToLocal(nock.clone()).distanceTo(top.add(bottom).multiplyScalar(0.5));
		flex = Math.min(1, pull / half) * BOW_FLEX;
	}
	limbUpper.rotation.set(0, 0, flex);
	limbLower.rotation.set(0, 0, -flex);
	for (const [bone, limb, rest] of [[upper, limbUpper, new THREE.Vector3(0, -1, 0)], [lower, limbLower, new THREE.Vector3(0, 1, 0)]] as const) {
		if (!nock) {
			bone.quaternion.identity();
			bone.scale.setScalar(1);
			continue;
		}
		limb.updateMatrixWorld(true);
		const to = limb.worldToLocal(nock.clone()).sub(bone.position);
		bone.quaternion.setFromUnitVectors(rest, to.clone().normalize());
		bone.scale.set(1, to.length() / half, 1);
	}
	bow.updateMatrixWorld(true);
}
