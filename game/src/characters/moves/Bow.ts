import { chargeGlint, missPoint, RELEASE_GRACE, type Outcome } from '../../render/spell-fx';
import { THREE, Time, closeHand, create, drawBow, holdAt, humanBone, orientHand, reach, crouch, type GameObject, HeldProps, cueAt, cueAtPoint, UP, heightOf, pointOn, PoseMove } from './pose-body';

/**
 * A shot, archer already holding the arrow: the bow comes up drawn in `SHOT_DRAW` s (at most half
 * the wind-up), holds, and after release the archer holds the follow-through for `SHOT_FOLLOW` s
 * (the string hand drifting back) before lowering the bow over `SHOT_RECOVER` s. A new shot picks
 * up from wherever the last one's raise or lower is.
 */
const SHOT_DRAW = 0.6;
const SHOT_FOLLOW = 0.3;
const SHOT_RECOVER = 0.7;
/** The archer stands side-on, turned this far right (radians) so the bow shoulder leads. */
const SHOT_SIDE_ON = 1.25;
/** Draw length (anchor to the bow's grip) and the follow-through, as fractions of height. */
const SHOT_DRAW_LENGTH = 0.44;
const SHOT_FOLLOW_BACK = 0.04;
/** Arrows fly this fast (m/s). */
const ARROW_SPEED = 28;
/** Seconds an arrow that missed stays stuck in the ground where it fell. */
const ARROW_STUCK = 1.5;
/** The arrow each bow shoots. */
const ARROWS:Record<string, string> = { short_bow: 'ShamanArrow', bone_bow: 'SkeletalArrow' };

/**
 * A shot under way, at a character or at a spot on the ground (where its arrow lands); `outcome`
 * is how it turned out, once the attack says (see {@link Bow.resolve}), and `firedAt`
 * when (seconds into the shot). A `held` shot stays drawn past its wind-up until told.
 */
type Shot = {
	t0:number;
	windUp:number;
	target:GameObject | THREE.Vector3;
	held:boolean;
	arrow:THREE.Object3D | null;
	loosed:boolean;
	outcome?:Outcome;
	firedAt?:number;
};
type Flight = { arrow:THREE.Object3D; from:THREE.Vector3; to:THREE.Vector3; t0:number; seconds:number; hit:boolean };

/**
 * The bow in the left hand: side-on, it comes up drawn along the line from the jaw to the target, holds, looses (the
 * string hand following through) and settles back; and its arrows in the air.
 */
export class Bow extends PoseMove<Shot> {
	/** How far the bow is up (0 at the carry, 1 drawn); eased, so a shot never snaps. */
	private _raised = 0;
	private _flying:Flight[] = [];

	/**
	 * Draws the held bow at `target` (a character, or a spot on the ground), loosing the arrow
	 * `windUp` seconds from now. A `held` draw stays drawn after that until {@link resolve}d.
	 * Without a bow it does nothing.
	 */
	public shoot(target:GameObject | THREE.Vector3, windUp:number, held = false):void {
		this.endShot();
		this.current = { t0: this.now, windUp, target, held, arrow: null, loosed: false };
		if (this.go.getComponent(HeldProps)?.prop('left')) {
			cueAt(this.go.world, 'bowDraw', this.go);
		}
	}

	/** Turns the shot being drawn on `target` instead; once loosed it is too late. */
	public aim(target:GameObject | THREE.Vector3):void {
		if (this.current && !this.current.loosed && this.current.outcome === undefined) {
			this.current.target = target;
		}
	}

	/** How the shot being drawn turned out (see `CharacterPose.resolve`): the bow's twang now, then the arrow striking. */
	public resolve(outcome:Outcome):void {
		const shot = this.current;
		if (!shot || shot.loosed || shot.outcome !== undefined) {
			return;
		}
		const world = this.go.world;
		if (world && outcome !== 'cut') {
			cueAt(world, 'bowRelease', this.go);
			world.after(this.flightTime() ?? 0, () => cueAtPoint(world, outcome === 'hit' ? 'arrowHit' : 'arrowMiss', pointOn(shot.target, 0.5)));
		}
		shot.outcome = outcome;
		shot.firedAt = this.now - shot.t0;
	}

	/** Seconds the arrow being drawn will take to reach its target once loosed; null with none drawn. */
	public flightTime():number | null {
		const shot = this.current;
		return shot && !shot.loosed ? pointOn(this.go, 0.6).distanceTo(pointOn(shot.target, 0.6)) / ARROW_SPEED : null;
	}

	/** What the archer looks at while drawing. */
	public look():THREE.Vector3 | null {
		const shot = this.current;
		return shot && !shot.loosed ? pointOn(shot.target, 0.7) : null;
	}

	public override update(root:THREE.Object3D, alive:boolean, dt:number):void {
		this.updateFlights();
		const shot = this.current;
		const bow = this.go.getComponent(HeldProps)?.prop('left');
		if (!shot || !bow) {
			if (bow) {
				drawBow(bow, null);
			}
			this._raised = 0;
			this.endShot();
			return;
		}
		const t = this.now - shot.t0;
		// Cut short (or never told, unless held), the bow lowers with the arrow unloosed.
		const cut = !shot.loosed && (shot.outcome === 'cut' || (shot.outcome === undefined && !shot.held && t >= shot.windUp + RELEASE_GRACE));
		const loosed = shot.loosed || shot.outcome === 'hit' || shot.outcome === 'miss';
		const fired = shot.firedAt ?? shot.windUp;
		const up = alive && !cut && (!loosed || t < fired + SHOT_FOLLOW);
		this._raised = up
			? Math.min(1, this._raised + dt / Math.min(SHOT_DRAW, shot.windUp / 2))
			: Math.max(0, this._raised - dt / SHOT_RECOVER);
		if (!up && this._raised <= 0) {
			drawBow(bow, null);
			this.endShot();
			return;
		}
		const weight = THREE.MathUtils.smoothstep(this._raised, 0, 1);
		const height = heightOf(this.go);
		crouch(root, { turn: -SHOT_SIDE_ON }, weight);

		// The arrow's line: from the anchor by the jaw to the target.
		const head = humanBone(root, 'head');
		if (!head) {
			return;
		}
		root.updateMatrixWorld(true);
		const toward = pointOn(shot.target, 0.6);
		const flat = toward.clone().sub(pointOn(this.go, 0)).setY(0).normalize();
		const right = new THREE.Vector3().crossVectors(flat, UP);
		const anchor = head.getWorldPosition(new THREE.Vector3()).addScaledVector(right, 0.035 * height).addScaledVector(flat, 0.02 * height);
		const aim = toward.clone().sub(anchor).normalize();
		const grip = anchor.clone().addScaledVector(aim, SHOT_DRAW_LENGTH * height);
		const follow = loosed ? THREE.MathUtils.smoothstep(t, fired, fired + SHOT_FOLLOW) : 0;
		const hand = anchor.clone().addScaledVector(aim, -SHOT_FOLLOW_BACK * height * follow);

		// Bow arm straight along the line, elbow turned down, the bow upright with its string toward the archer and its
		// back toward the target. The string hand at the anchor, its elbow back, a little low and out so the forearm clears
		// the face, its palm toward the cheek.
		holdAt(root, 'left', bow, { at: grip, turn: new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(flat.z, -flat.x)), elbow: grip.clone().sub(UP) }, weight);
		reach(root, 'right', hand, weight, aim.clone().negate().addScaledVector(UP, -0.15).addScaledVector(right, 0.5));
		orientHand(root, 'right', aim, right.clone().negate(), weight);
		// Fingers hooked on the string while drawn, opening as it goes.
		closeHand(root, 'right', 0.6 * weight * (1 - follow));
		const fingers = humanBone(root, 'rightMiddleProximal');
		const nock = !loosed && !cut && weight > 0.05 && fingers ? fingers.getWorldPosition(new THREE.Vector3()) : null;
		drawBow(bow, nock);
		this.nockArrow(shot, bow, nock);
		if (loosed && !shot.loosed) {
			shot.loosed = true;
			this.loose(shot, bow);
		}
	}

	/** Drops the shot, its nocked arrow and every arrow still in the air. */
	public override dispose():void {
		this.endShot();
		this._flying.forEach((f) => f.arrow.removeFromParent());
		this._flying = [];
	}

	private endShot():void {
		this.current?.arrow?.removeFromParent();
		this.current = null;
	}

	/** Keeps the arrow on the string while drawn, pointing past the grip. */
	private nockArrow(shot:Shot, bow:THREE.Object3D, nock:THREE.Vector3 | null):void {
		const grip = bow.getObjectByName('Grip');
		const defID = this.go.getComponent(HeldProps)?.item('left')?.defID;
		if (!shot.arrow && nock && grip && defID && ARROWS[defID]) {
			shot.arrow = create(ARROWS[defID]) ?? null;
			const world = this.go.world;
			if (shot.arrow && world) {
				world.native.add(shot.arrow);
				chargeGlint(world.native, () => (shot.arrow?.parent && shot.arrow.visible && !shot.loosed ? shot.arrow.position.clone() : null));
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

	/** Lets the nocked arrow fly from the bow to the target (wide of them on a miss), or into the ground at the spot. */
	private loose(shot:Shot, bow:THREE.Object3D):void {
		const arrow = shot.arrow;
		shot.arrow = null;
		const grip = bow.getObjectByName('Grip');
		if (!arrow || !grip) {
			arrow?.removeFromParent();
			return;
		}
		const from = grip.getWorldPosition(new THREE.Vector3());
		const spot = shot.target instanceof THREE.Vector3 ? shot.target : null;
		const hit = !spot && shot.outcome === 'hit';
		const to = spot?.clone() ?? (hit ? pointOn(shot.target, 0.6) : missPoint(from, pointOn(shot.target, 0)));
		arrow.visible = true;
		this._flying.push({ arrow, from, to, t0: Time.time, seconds: Math.max(0.05, from.distanceTo(to) / ARROW_SPEED), hit });
	}

	/** Arrows in the air; each vanishes into whoever it hits (the hit's own feel bursts there), or sticks a while where it fell. */
	private updateFlights():void {
		this._flying = this._flying.filter((f) => {
			const u = (Time.time - f.t0) / f.seconds;
			const way = f.to.clone().sub(f.from).normalize();
			if (u >= 1 && !f.hit && Time.time - f.t0 < f.seconds + ARROW_STUCK) {
				// Where its flight ended: the head in the ground.
				placeArrow(f.arrow, f.to, way);
				return true;
			}
			if (u >= 1) {
				f.arrow.removeFromParent();
				return false;
			}
			placeArrow(f.arrow, f.from.clone().lerp(f.to, u), way);
			return true;
		});
	}
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
