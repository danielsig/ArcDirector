import { MeshRenderer, Time, create, drawBow, humanBone, lookAt, reach } from '@arc-director/kindling';
import { Component } from '../engine/Component';
import * as THREE from 'three';
import { Appearance, POCKET_SECONDS, SpeechBubble, Vitals } from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import { Order } from '../engine/order';
import { HeldProps } from './HeldProps';
import { NPCInput } from './NPCInput';
import { findObject } from '../director/names';

/** How far a character turns its head to someone talking (meters). */
const HEED_RANGE = 8;
/** Head turn ease per second, in and out. */
const LOOK_EASE = 4;
/** A give or take: reach out (s), hold the hand there until (s), back by `POCKET_SECONDS`. */
const REACH_OUT = 0.45;
const REACH_HOLD = 0.9;
/** A shot: part of the wind-up spent raising and drawing the bow, and the recovery after release (s). */
const RAISE = 0.35;
const RECOVER = 0.5;
/** Arrows fly this fast (m/s). */
const ARROW_SPEED = 28;
/** The arrow each bow shoots. */
const ARROWS:Record<string, string> = { short_bow: 'ShamanArrow', bone_bow: 'SkeletalArrow' };

const UP = new THREE.Vector3(0, 1, 0);

/** Where on a character to look at or hand things to: a height fraction of `Appearance`. */
function pointOn(go:GameObject, fraction:number):THREE.Vector3 {
	const p = go.transform.position;
	return new THREE.Vector3(p.x, p.y + (go.getComponent(Appearance)?.height ?? 1.7) * fraction, p.z);
}

type Shot = { t0:number; windUp:number; target:GameObject; arrow:THREE.Object3D | null; loosed:boolean };
type Flight = { arrow:THREE.Object3D; from:THREE.Vector3; to:THREE.Vector3; t0:number; seconds:number };

/**
 * Touches on top of the clip, every frame after it plays: the head turns to whoever this character
 * deals with or hears talking, the right hand reaches out to give and take, and archers draw and
 * loose their bows.
 */
export class CharacterPose extends Component {
	public static override order = Order.present - 1;

	private _look = 0;
	private readonly _lookAt = new THREE.Vector3();
	private _shot:Shot | null = null;
	private _flying:Flight[] = [];

	/** Draws the held bow at `target`, loosing the arrow `windUp` seconds from now. Without a bow it does nothing. */
	public shoot(target:GameObject, windUp:number):void {
		this.endShot();
		this._shot = { t0: Time.time, windUp, target, arrow: null, loosed: false };
	}

	public override lateUpdate(dt:number):void {
		const root = this.gameObject.getComponent(MeshRenderer)?.mesh;
		if (!root) {
			return;
		}
		const alive = (this.gameObject.getComponent(Vitals)?.hp ?? 1) > 0;
		this.updateLook(root, alive ? this.lookTarget() : null, dt);
		if (alive) {
			this.updateReach(root);
		}
		this.updateShot(root, alive);
		this.updateFlights();
	}

	public override onDestroy():void {
		this.endShot();
		for (const f of this._flying) {
			f.arrow.removeFromParent();
		}
		this._flying = [];
	}

	/** Who to look at: someone being handed something, the peer this character faces, or the nearest voice. */
	private lookTarget():THREE.Vector3 | null {
		const go = this.gameObject;
		const world = go.world;
		if (!world) {
			return null;
		}
		const shot = this._shot;
		if (shot && !shot.loosed) {
			return pointOn(shot.target, 0.7);
		}
		const toward = go.getComponent(Appearance)?.clipToward;
		if (toward?.world === world) {
			return pointOn(toward, 0.9);
		}
		const npc = go.getComponent(NPCInput);
		const peer = npc?.faceName && world.time < npc.faceUntil ? findObject(world, npc.faceName) : null;
		if (peer && peer !== go) {
			return pointOn(peer, 0.9);
		}
		let best:GameObject | null = null;
		let bestD = HEED_RANGE;
		world.forEachComponent(SpeechBubble, (bubble, other) => {
			if (other === go || world.time > bubble.until) {
				return;
			}
			const d = pointOn(other, 0).distanceTo(pointOn(go, 0));
			if (d < bestD) {
				best = other;
				bestD = d;
			}
		});
		return best ? pointOn(best, 0.9) : null;
	}

	private updateLook(root:THREE.Object3D, target:THREE.Vector3 | null, dt:number):void {
		const ease = Math.min(1, dt * LOOK_EASE);
		this._look += ((target ? 1 : 0) - this._look) * ease;
		if (target) {
			this._lookAt.lerp(target, this._look < 0.05 ? 1 : Math.min(1, dt * 8));
		}
		if (this._look > 0.01) {
			lookAt(root, this._lookAt, this._look);
		}
	}

	/** Giving or taking: out, hold, back, toward the other person or the thing picked up. */
	private updateReach(root:THREE.Object3D):void {
		const look = this.gameObject.getComponent(Appearance);
		if (!look || (look.clip !== 'give' && look.clip !== 'take')) {
			return;
		}
		const t = (this.gameObject.world?.time ?? 0) - look.clipT0;
		const weight = t < REACH_OUT
			? THREE.MathUtils.smoothstep(t, 0, REACH_OUT)
			: 1 - THREE.MathUtils.smoothstep(t, REACH_HOLD, POCKET_SECONDS);
		const self = pointOn(this.gameObject, 0.6);
		const other = look.clipToward;
		// Halfway to another person's hands; onto a thing.
		const target = other?.getComponent(Appearance) ? self.clone().lerp(pointOn(other, 0.6), 0.5)
			: other ? pointOn(other, 0).setY(other.transform.position.y + 0.15)
				: self.clone().add(new THREE.Vector3(0, 0, -0.5).applyAxisAngle(UP, this.gameObject.transform.yaw));
		reach(root, 'right', target, weight);
	}

	/** Raise and draw, hold, loose an arrow at the target, recover. */
	private updateShot(root:THREE.Object3D, alive:boolean):void {
		const shot = this._shot;
		const held = this.gameObject.getComponent(HeldProps);
		const bow = held?.prop('left');
		if (!shot || !bow || !alive) {
			if (bow) {
				raiseBow(bow, null, 0);
				drawBow(bow, null);
			}
			this.endShot();
			return;
		}
		const t = Time.time - shot.t0;
		if (t > shot.windUp + RECOVER) {
			raiseBow(bow, null, 0);
			drawBow(bow, null);
			this.endShot();
			return;
		}
		const raise = Math.max(0.1, shot.windUp * RAISE);
		const weight = t < shot.windUp
			? THREE.MathUtils.smoothstep(t, 0, raise)
			: 1 - THREE.MathUtils.smoothstep(t, shot.windUp, shot.windUp + RECOVER);
		const height = this.gameObject.getComponent(Appearance)?.height ?? 1.7;
		const chest = pointOn(this.gameObject, 0.8);
		const aim = pointOn(shot.target, 0.6).sub(chest).normalize();
		const flat = aim.clone().setY(0).normalize();
		const right = new THREE.Vector3().crossVectors(flat, UP).normalize();
		// Bow arm straight at the target; the string hand back by the chin, a little to its side.
		reach(root, 'left', chest.clone().addScaledVector(aim, 0.42 * height).addScaledVector(right, -0.05), weight);
		const drawn = t < shot.windUp ? THREE.MathUtils.smoothstep(t, raise * 0.6, raise * 1.6) : 0;
		reach(root, 'right', chest.clone().addScaledVector(aim, 0.06).addScaledVector(right, 0.06).addScaledVector(UP, 0.08 * height), weight * Math.max(drawn, 0.5));
		raiseBow(bow, flat, weight);
		const hand = humanBone(root, 'rightMiddleProximal');
		const nock = hand && drawn > 0.3 ? hand.getWorldPosition(new THREE.Vector3()) : null;
		drawBow(bow, nock);
		this.nockArrow(shot, bow, nock);
		if (!shot.loosed && t >= shot.windUp) {
			shot.loosed = true;
			this.loose(shot, bow);
		}
	}

	/** Keeps the arrow on the string while drawn, pointing past the grip. */
	private nockArrow(shot:Shot, bow:THREE.Object3D, nock:THREE.Vector3 | null):void {
		const grip = bow.getObjectByName('Grip');
		const defID = this.gameObject.getComponent(HeldProps)?.defID('left');
		if (!shot.arrow && nock && grip && defID && ARROWS[defID]) {
			shot.arrow = create(ARROWS[defID]) ?? null;
			if (shot.arrow) {
				this.gameObject.world?.native.add(shot.arrow);
			}
		}
		const arrow = shot.arrow;
		if (!arrow || shot.loosed) {
			return;
		}
		arrow.visible = !!nock && !!grip;
		if (nock && grip) {
			const toward = grip.getWorldPosition(new THREE.Vector3()).sub(nock).normalize();
			placeArrow(arrow, nock, toward);
		}
	}

	/** Lets the nocked arrow fly from the bow to the target. */
	private loose(shot:Shot, bow:THREE.Object3D):void {
		const arrow = shot.arrow;
		shot.arrow = null;
		const grip = bow.getObjectByName('Grip');
		if (!arrow || !grip) {
			arrow?.removeFromParent();
			return;
		}
		const from = grip.getWorldPosition(new THREE.Vector3());
		const to = pointOn(shot.target, 0.6);
		arrow.visible = true;
		this._flying.push({ arrow, from, to, t0: Time.time, seconds: Math.max(0.05, from.distanceTo(to) / ARROW_SPEED) });
	}

	/** Arrows in the air; each vanishes where it lands. */
	private updateFlights():void {
		this._flying = this._flying.filter((f) => {
			const u = (Time.time - f.t0) / f.seconds;
			if (u >= 1) {
				f.arrow.removeFromParent();
				return false;
			}
			placeArrow(f.arrow, f.from.clone().lerp(f.to, u), f.to.clone().sub(f.from).normalize());
			return true;
		});
	}

	private endShot():void {
		this._shot?.arrow?.removeFromParent();
		this._shot = null;
	}
}

/** How a bow sits in the hand when it is not raised: its local pose, and its grip in the hand's frame. */
type BowRest = { quaternion:THREE.Quaternion; position:THREE.Vector3; grip:THREE.Vector3 };

/**
 * Turns a held bow about its grip, `weight` of the way to upright with its string toward the archer
 * and its back toward `ahead` (flat, world); `null` puts it back the way the hand holds it.
 */
function raiseBow(bow:THREE.Object3D, ahead:THREE.Vector3 | null, weight:number):void {
	const hand = bow.parent;
	const grip = bow.getObjectByName('Grip');
	if (!hand || !grip) {
		return;
	}
	const rest = (bow.userData.rest as BowRest | undefined) ?? (bow.userData.rest = {
		quaternion: bow.quaternion.clone(),
		position: bow.position.clone(),
		grip: hand.worldToLocal(grip.getWorldPosition(new THREE.Vector3())),
	} satisfies BowRest);
	if (!ahead || weight <= 0) {
		bow.quaternion.copy(rest.quaternion);
		bow.position.copy(rest.position);
		return;
	}
	// Upright, the string (+X of the bow's root) back at the archer.
	const back = ahead.clone().negate();
	const upright = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(back, UP, new THREE.Vector3().crossVectors(back, UP)));
	const local = hand.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(upright);
	bow.quaternion.slerpQuaternions(rest.quaternion, local, weight);
	// Keep the grip in the fist.
	const toGrip = rest.grip.clone().sub(rest.position).applyQuaternion(rest.quaternion.clone().invert()).applyQuaternion(bow.quaternion);
	bow.position.copy(rest.grip).sub(toGrip);
}

/** Puts an arrow model (fletching up its +Y, head at its origin) with its tail at `tail`, flying along `dir`. */
function placeArrow(arrow:THREE.Object3D, tail:THREE.Vector3, dir:THREE.Vector3):void {
	if (arrow.userData.length === undefined) {
		arrow.quaternion.identity();
		arrow.userData.length = new THREE.Box3().setFromObject(arrow).getSize(new THREE.Vector3()).y;
	}
	arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
	arrow.position.copy(tail).addScaledVector(dir, arrow.userData.length as number);
}
