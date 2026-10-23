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
 * from the shoulder, the elbow bending toward `elbow` (a world direction; default: the side the clip
 * bent it). The arm keeps its length: a target out of reach gets the hand pointed at it.
 */
export function reach(root:THREE.Object3D, hand:Hand, target:THREE.Vector3, weight:number, elbow:THREE.Vector3 | null = null):void {
	limb(root, `${hand}UpperArm`, `${hand}LowerArm`, `${hand}Hand`, target, weight, elbow);
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
	bone.quaternion.copy(bone.parent.getWorldQuaternion(_q2).invert().multiply(now));
	bone.updateMatrixWorld(true);
}

/**
 * Turns `root`'s hand, `weight` of the way (0–1), so the `prop` it holds points its own `axis` along
 * `point` (world) with its own `side` as near `facing` as that allows (a sword: tip ahead, flat
 * level). The prop turns with the hand, about the wrist; the arm stays as it is.
 */
export function aimHeld(root:THREE.Object3D, hand:Hand, prop:THREE.Object3D, axis:THREE.Vector3, side:THREE.Vector3, point:THREE.Vector3, facing:THREE.Vector3, weight:number):void {
	const bone = humanBone(root, `${hand}Hand`);
	if (!bone?.parent || weight <= 0) {
		return;
	}
	root.updateMatrixWorld(true);
	const basis = (along:THREE.Vector3, across:THREE.Vector3):THREE.Quaternion => {
		const x = along.clone().normalize();
		const y = across.clone().addScaledVector(x, -across.dot(x)).normalize();
		return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, new THREE.Vector3().crossVectors(x, y)));
	};
	const held = prop.getWorldQuaternion(new THREE.Quaternion());
	const now = basis(axis.clone().applyQuaternion(held), side.clone().applyQuaternion(held));
	const turn = basis(point, facing).multiply(now.invert());
	turnBone(bone, new THREE.Quaternion().slerp(turn, Math.min(1, weight)));
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

/**
 * Two-bone IK: turns `upper` and `lower` so the end joint reaches `target` (world), `weight` of
 * the way. The middle joint bends toward `pole` (a world direction), or the way the clip bent it.
 */
function limb(root:THREE.Object3D, upperName:string, lowerName:string, endName:string, target:THREE.Vector3, weight:number, pole:THREE.Vector3 | null):void {
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
	// Where the middle joint goes: on the circle the two lengths allow, toward the pole.
	const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
	const bendTo = (pole ?? b.clone().sub(a)).clone();
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
	const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(root.getWorldQuaternion(_q)).setY(0).normalize();
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
		f.foot.quaternion.copy(f.foot.parent!.getWorldQuaternion(_q).invert().multiply(f.turn));
		f.foot.updateMatrixWorld(true);
	}
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

/** The middle of `root`'s `hand` palm (halfway from the wrist to the middle knuckle, where a grip runs), world; null without the bones. */
export function palmOf(root:THREE.Object3D, hand:Hand):THREE.Vector3 | null {
	const wrist = humanBone(root, `${hand}Hand`);
	const knuckle = humanBone(root, `${hand}MiddleProximal`);
	return wrist && knuckle ? wrist.getWorldPosition(new THREE.Vector3()).lerp(knuckle.getWorldPosition(new THREE.Vector3()), 0.5) : null;
}
