import * as THREE from 'three';
import { humanBone, restTurn } from './toon-model.js';

// Pose touches on top of a playing clip, for toon models from `scripts/build-models.mjs`: a prop in a
// hand, the head turned toward something, an arm reaching, a bow drawn. The look and reach ones
// overwrite bone rotations the clip just set, so call them every frame after the `Animator` runs
// (in `lateUpdate`); weight 0 leaves the clip's pose alone.

export type Hand = 'left' | 'right';

/** The hand that `hand` is not. */
export function otherHand(hand:Hand):Hand {
	return hand === 'right' ? 'left' : 'right';
}

/**
 * How a prop sits in the right hand (the left holds it mirrored): `handle`, where on the prop the fist closes, in the
 * prop's own space (default: its `Grip` node, else its origin), and `turn`, the prop's turn with the hand at rest (the
 * T-pose, in the body's frame: x right, y up, z back).
 */
export interface Grip {
	handle?:THREE.Vector3;
	turn:THREE.Quaternion;
}

/**
 * Where a held prop goes: its handle `at` and its `turn`, and the point the elbow bends toward (unset: the way the clip
 * bent it). In world space for {@link holdAt}; a host may author them in a body's own frame and place them.
 */
export interface HeldPose {
	at:THREE.Vector3;
	turn:THREE.Quaternion;
	elbow?:THREE.Vector3;
}

/** A turn of `x`, `y` and `z` degrees about those axes, in `THREE.Euler`'s order: how grips and held poses are written. */
export function degrees(x:number, y:number, z:number):THREE.Quaternion {
	const d = THREE.MathUtils.DEG2RAD;
	return new THREE.Quaternion().setFromEuler(new THREE.Euler(x * d, y * d, z * d));
}

/** `turn` (in a body's frame) as the left hand holds what the right holds turned so: mirrored across the body's middle. */
export function mirrored(turn:THREE.Quaternion):THREE.Quaternion {
	return new THREE.Quaternion(turn.x, -turn.y, -turn.z, turn.w);
}

const worldTurn = new THREE.Quaternion();
const parentTurn = new THREE.Quaternion();

/**
 * Puts `prop` (an instance of a registered model) in `root`'s hand as `grip` says, as a child of the hand bone, so it
 * follows every clip. Returns false (and does nothing) when `root` has no such hand.
 */
export function holdInHand(root:THREE.Object3D, hand:Hand, prop:THREE.Object3D, grip:Grip):boolean {
	const bone = humanBone(root, `${hand}Hand`);
	const turn = bone && restTurn(root, bone.name);
	const fist = fistOf(root, hand);
	if (!bone || !turn || !fist) {
		return false;
	}
	prop.updateMatrixWorld(true);
	const node = prop.getObjectByName('Grip');
	const handle = grip.handle?.clone() ?? (node ? prop.worldToLocal(node.getWorldPosition(new THREE.Vector3())) : new THREE.Vector3());
	prop.quaternion.copy(turn.clone().invert().multiply(hand === 'right' ? grip.turn : mirrored(grip.turn)));
	// Undo the character's scale, so the prop keeps its own size.
	root.updateMatrixWorld(true);
	prop.scale.setScalar(1 / bone.getWorldScale(new THREE.Vector3()).x);
	prop.position.copy(fist).sub(handle.multiply(prop.scale).applyQuaternion(prop.quaternion));
	bone.add(prop);
	return true;
}

/**
 * Holds `prop`, put in `root`'s `hand` by {@link holdInHand}, as `pose` says (world), `weight` of the way (0–1) from
 * where the clip has it: the hand takes the turn that carries the prop so, the forearm turning about itself as far as
 * the hand turns about it, and the arm reaches ({@link reach}) to put the handle at `pose.at`.
 */
export function holdAt(root:THREE.Object3D, hand:Hand, prop:THREE.Object3D, pose:HeldPose, weight:number):void {
	const upper = humanBone(root, `${hand}UpperArm`);
	const lower = humanBone(root, `${hand}LowerArm`);
	const bone = humanBone(root, `${hand}Hand`);
	const lowerRest = lower && restTurn(root, lower.name);
	const handRest = bone && restTurn(root, bone.name);
	const fist = fistOf(root, hand);
	if (!upper || !lower || !bone || !lowerRest || !handRest || !fist || weight <= 0) {
		return;
	}
	root.updateMatrixWorld(true);
	const w = Math.min(1, weight);
	// The hand's turn that carries the prop so: the prop's, less its turn in the hand.
	const want = pose.turn.clone().multiply(prop.quaternion.clone().invert());
	const wrist = pose.at.clone().sub(fist.multiplyScalar(bone.getWorldScale(new THREE.Vector3()).x).applyQuaternion(want));
	const shoulder = upper.getWorldPosition(new THREE.Vector3());
	reach(root, hand, wrist, w, pose.elbow ? pose.elbow.clone().sub(shoulder) : null);
	const now = bone.getWorldQuaternion(new THREE.Quaternion());
	const goal = now.clone().slerp(want, w);
	// Its turn from a straight wrist, about the forearm, goes to the forearm.
	const straight = lower.getWorldQuaternion(new THREE.Quaternion()).multiply(lowerRest.clone().invert().multiply(handRest));
	const turn = goal.clone().multiply(straight.invert());
	const along = bone.getWorldPosition(new THREE.Vector3()).sub(lower.getWorldPosition(new THREE.Vector3())).normalize();
	const onto = along.multiplyScalar(along.dot(new THREE.Vector3(turn.x, turn.y, turn.z)));
	turnBone(lower, new THREE.Quaternion(onto.x, onto.y, onto.z, turn.w).normalize());
	turnBone(bone, goal.multiply(bone.getWorldQuaternion(now).invert()));
}

/** Where `root`'s `hand` closes round a handle, in the hand bone's own space: just short of the middle knuckle, a little below the bones. */
function fistOf(root:THREE.Object3D, hand:Hand):THREE.Vector3 | null {
	const bone = humanBone(root, `${hand}Hand`);
	const turn = bone && restTurn(root, bone.name);
	const knuckle = humanBone(root, `${hand}MiddleProximal`)?.position;
	if (!turn || !knuckle) {
		return null;
	}
	const down = new THREE.Vector3(0, -1, 0).applyQuaternion(turn.clone().invert());
	return knuckle.clone().multiplyScalar(0.65).addScaledVector(down, 0.1 * knuckle.length());
}

/** Turns a bone by `turn` (world space), keeping its parent where it is. */
function turnBone(bone:THREE.Object3D, turn:THREE.Quaternion):void {
	const parent = bone.parent!.getWorldQuaternion(parentTurn);
	const world = bone.getWorldQuaternion(worldTurn).premultiply(turn);
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
	const face = new THREE.Vector3(0, 0, -1).applyQuaternion(turn.clone().invert()).applyQuaternion(head.getWorldQuaternion(worldTurn));
	const body = new THREE.Vector3(0, 0, -1).applyQuaternion(root.getWorldQuaternion(worldTurn));
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
 * from the shoulder, the elbow bending toward `elbow` (a world direction; default: the side the clip
 * bent it). The arm keeps its length: a target out of reach gets the hand pointed at it. Partway, the elbow
 * swings out round the body, never through it.
 */
export function reach(root:THREE.Object3D, hand:Hand, target:THREE.Vector3, weight:number, elbow:THREE.Vector3 | null = null):void {
	const shoulder = humanBone(root, `${hand}UpperArm`);
	const neck = humanBone(root, 'neck');
	root.updateMatrixWorld(true);
	const out = shoulder && neck ? shoulder.getWorldPosition(new THREE.Vector3()).sub(neck.getWorldPosition(new THREE.Vector3())).setY(0).normalize() : null;
	limb(root, `${hand}UpperArm`, `${hand}LowerArm`, `${hand}Hand`, target, weight, elbow, out);
}

/**
 * Bends `root`'s leg so its `side` foot (the ankle) reaches `target` (world), `weight` of the way
 * (0–1), the knee bending toward `knee` (a world direction) or the way the clip bent it. For lunges
 * and steps the clip does not take.
 */
export function placeFoot(root:THREE.Object3D, side:Hand, target:THREE.Vector3, weight:number, knee:THREE.Vector3 | null = null):void {
	limb(root, `${side}UpperLeg`, `${side}LowerLeg`, `${side}Foot`, target, weight, knee);
}

/**
 * Turns `root`'s `side` foot, `weight` of the way (0–1), back to how it sits at rest under the body (sole flat, toes
 * ahead), whatever the leg is doing: for feet planted after `placeFoot`. The leg stays as it is.
 */
export function restFoot(root:THREE.Object3D, side:Hand, weight:number):void {
	const bone = humanBone(root, `${side}Foot`);
	const turn = bone && restTurn(root, bone.name);
	if (!bone || !turn || weight <= 0) {
		return;
	}
	root.updateMatrixWorld(true);
	const want = root.getWorldQuaternion(new THREE.Quaternion()).multiply(turn);
	const now = bone.getWorldQuaternion(new THREE.Quaternion());
	turnBone(bone, now.clone().slerp(want, weight).multiply(now.invert()));
}

/**
 * Turns `root`'s hand, `weight` of the way (0–1), so its fingers point along `point` and its palm
 * faces `palm` (world directions; `palm` need not be square to `point`). The arm stays as it is.
 */
export function orientHand(root:THREE.Object3D, hand:Hand, point:THREE.Vector3, palm:THREE.Vector3, weight:number):void {
	const bone = humanBone(root, `${hand}Hand`);
	const turn = bone && restTurn(root, bone.name);
	if (!bone?.parent || !turn || weight <= 0) {
		return;
	}
	root.updateMatrixWorld(true);
	const rootTurn = root.getWorldQuaternion(new THREE.Quaternion());
	// At rest (the T-pose, in the root's frame: facing −Z, the right side on +X) the fingers point
	// out along the arm and the palm faces down.
	const basis = (along:THREE.Vector3, facing:THREE.Vector3):THREE.Matrix4 => {
		const x = along.clone().normalize();
		const y = facing.clone().addScaledVector(x, -facing.dot(x)).normalize();
		return new THREE.Matrix4().makeBasis(x, y, new THREE.Vector3().crossVectors(x, y));
	};
	const rest = basis(new THREE.Vector3(hand === 'left' ? -1 : 1, 0, 0).applyQuaternion(rootTurn), new THREE.Vector3(0, -1, 0).applyQuaternion(rootTurn));
	const want = basis(point, palm);
	const swing = new THREE.Quaternion().setFromRotationMatrix(want.multiply(rest.transpose()));
	const goal = swing.multiply(rootTurn).multiply(turn);
	const now = bone.getWorldQuaternion(new THREE.Quaternion()).slerp(goal, Math.min(1, weight));
	bone.quaternion.copy(bone.parent.getWorldQuaternion(parentTurn).invert().multiply(now));
	bone.updateMatrixWorld(true);
}

/** A full fist: how far each finger joint curls (radians), knuckle first. */
const FIST = [1.35, 1.55, 1.0];
const FINGERS = ['Index', 'Middle', 'Ring', 'Little'];

/**
 * Curls `root`'s fingers toward the palm, `amount` of a full fist (0–1: 1 closes round a handle,
 * about 0.6 hooks a bowstring), from wherever the clip and `orientHand` left the hand.
 */
export function closeHand(root:THREE.Object3D, hand:Hand, amount:number):void {
	const bone = humanBone(root, `${hand}Hand`);
	const turn = bone && restTurn(root, bone.name);
	if (!bone || !turn || amount <= 0) {
		return;
	}
	root.updateMatrixWorld(true);
	// The hand's own frame now: its turn away from rest, applied to the rest fingers and palm.
	const rootTurn = root.getWorldQuaternion(new THREE.Quaternion());
	const away = bone.getWorldQuaternion(new THREE.Quaternion()).multiply(rootTurn.clone().multiply(turn).invert());
	const point = new THREE.Vector3(hand === 'left' ? -1 : 1, 0, 0).applyQuaternion(rootTurn).applyQuaternion(away);
	const palm = new THREE.Vector3(0, -1, 0).applyQuaternion(rootTurn).applyQuaternion(away);
	const axis = new THREE.Vector3().crossVectors(point, palm).normalize();
	for (const finger of FINGERS) {
		['Proximal', 'Intermediate', 'Distal'].forEach((joint, i) => {
			const knuckle = humanBone(root, `${hand}${finger}${joint}`);
			if (knuckle) {
				turnBone(knuckle, new THREE.Quaternion().setFromAxisAngle(axis, FIST[i]! * Math.min(1, amount)));
			}
		});
	}
}

/** How far an arm partway to its pose bends its elbow out from the body (at the halfway point, against a unit pole). */
const SWING_OUT = 0.8;

/**
 * Two-bone IK: turns `upper` and `lower` so the end joint reaches `target` (world), `weight` of
 * the way. The middle joint bends toward `pole` (a world direction), or the way the clip bent it.
 */
function limb(root:THREE.Object3D, upperName:string, lowerName:string, endName:string, target:THREE.Vector3, weight:number, pole:THREE.Vector3 | null, out:THREE.Vector3 | null = null):void {
	const upper = humanBone(root, upperName);
	const lower = humanBone(root, lowerName);
	const end = humanBone(root, endName);
	if (!upper || !lower || !end || weight <= 0) {
		return;
	}
	root.updateMatrixWorld(true);
	const a = upper.getWorldPosition(new THREE.Vector3());
	const b = lower.getWorldPosition(new THREE.Vector3());
	const c = end.getWorldPosition(new THREE.Vector3());
	const t = c.clone().lerp(target, Math.min(1, weight));
	const l1 = b.distanceTo(a);
	const l2 = c.distanceTo(b);
	const toT = t.clone().sub(a);
	const dir = toT.lengthSq() > 1e-10 ? toT.normalize() : c.clone().sub(a).normalize();
	const d = THREE.MathUtils.clamp(t.distanceTo(a), Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.999);
	// Where the middle joint goes: on the circle the two lengths allow, toward the pole, as far as `weight` turns it from
	// the way the clip bent it.
	const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
	const bent = b.clone().sub(a).normalize();
	const w = Math.min(1, weight);
	const bendTo = pole ? bent.lerp(pole.clone().normalize(), w) : bent;
	// Halfway between the two, it bends out the most (`out`, away from the body).
	if (out) {
		bendTo.addScaledVector(out, SWING_OUT * 4 * w * (1 - w));
	}
	bendTo.addScaledVector(dir, -bendTo.dot(dir));
	if (bendTo.lengthSq() < 1e-8) {
		bendTo.set(0, -1, 0).addScaledVector(dir, -dir.y);
		if (bendTo.lengthSq() < 1e-8) {
			bendTo.set(0, 0, 1);
		}
	}
	bendTo.normalize();
	const joint = a.clone().addScaledVector(dir, l1 * cosA).addScaledVector(bendTo, l1 * Math.sqrt(1 - cosA * cosA));
	turnBone(upper, new THREE.Quaternion().setFromUnitVectors(b.clone().sub(a).normalize(), joint.clone().sub(a).normalize()));
	const b2 = lower.getWorldPosition(new THREE.Vector3());
	const c2 = end.getWorldPosition(new THREE.Vector3());
	const reached = a.clone().addScaledVector(dir, d);
	turnBone(lower, new THREE.Quaternion().setFromUnitVectors(c2.sub(b2).normalize(), reached.sub(b2).normalize()));
}

/**
 * How a body bends: hips lowered (m); the back leaning forward and twisting to its left, and the
 * whole stance turning to its left, feet pivoting where they stand (radians).
 */
export type Bend = { drop?:number; lean?:number; twist?:number; turn?:number };

/** The back's bones, hips up; they share a lean and a twist. */
const BACK = ['spine', 'chest', 'upperChest'];

/**
 * Bends `root` by `bend`, `weight` of the way (0–1): the stance turning, hips down and back, the
 * back leaning and turning, knees bending forward so the feet stay where the clip put them (pivoted
 * with the stance). Call before `reach`, so
 * the arm reaches from where the bend put the shoulder.
 */
export function crouch(root:THREE.Object3D, bend:Bend, weight:number):void {
	const hips = humanBone(root, 'hips');
	if (!hips?.parent || weight <= 0) {
		return;
	}
	const { drop = 0, lean = 0, twist = 0, turn = 0 } = bend;
	root.updateMatrixWorld(true);
	const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(root.getWorldQuaternion(worldTurn)).setY(0).normalize();
	const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
	const feet = (['left', 'right'] as const).map((side) => {
		const foot = humanBone(root, `${side}Foot`);
		return foot && { side, foot, at: foot.getWorldPosition(new THREE.Vector3()), turn: foot.getWorldQuaternion(new THREE.Quaternion()) };
	});
	// Hips down, and back a little to keep the weight over the feet.
	const pivot = hips.getWorldPosition(new THREE.Vector3());
	const at = pivot.clone().addScaledVector(new THREE.Vector3(0, -1, 0), drop * weight).addScaledVector(forward, -0.35 * drop * weight);
	hips.position.copy(hips.parent.worldToLocal(at));
	hips.updateMatrixWorld(true);
	// The stance turns about the hips; the feet pivot with it.
	const stance = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn * weight);
	if (turn) {
		turnBone(hips, stance);
		for (const f of feet) {
			if (f) {
				f.at.sub(pivot).applyQuaternion(stance).add(pivot);
				f.turn.premultiply(stance);
			}
		}
		forward.applyQuaternion(stance);
		right.applyQuaternion(stance);
	}
	const back = BACK.map((name) => humanBone(root, name)).filter((bone):bone is THREE.Object3D => !!bone);
	turnBone(hips, new THREE.Quaternion().setFromAxisAngle(right, -0.25 * lean * weight));
	for (const bone of back) {
		turnBone(bone, new THREE.Quaternion().setFromAxisAngle(right, (-0.75 * lean * weight) / back.length)
			.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (twist * weight) / back.length)));
	}
	for (const f of feet) {
		if (!f) {
			continue;
		}
		limb(root, `${f.side}UpperLeg`, `${f.side}LowerLeg`, `${f.side}Foot`, f.at, 1, forward);
		f.foot.quaternion.copy(f.foot.parent!.getWorldQuaternion(parentTurn).invert().multiply(f.turn));
		f.foot.updateMatrixWorld(true);
	}
}

/** How far each limb of a bow flexes at full draw (radians). */
const BOW_FLEX = 0.35;

/**
 * Draws a bow rigged by `scripts/build-models.mjs` (`bow`): the string meets at `nock` (world),
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

/** The middle of `root`'s `hand` palm (halfway from the wrist to the middle knuckle, where a grip runs), world; null without the bones. */
export function palmOf(root:THREE.Object3D, hand:Hand):THREE.Vector3 | null {
	const wrist = humanBone(root, `${hand}Hand`);
	const knuckle = humanBone(root, `${hand}MiddleProximal`);
	return wrist && knuckle ? wrist.getWorldPosition(new THREE.Vector3()).lerp(knuckle.getWorldPosition(new THREE.Vector3()), 0.5) : null;
}
