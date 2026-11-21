import { slashTrail, thrustLance } from '../../render/sword-fx';
import { dustKick, dustLine, lungeGhost } from '../../render/fight-fx';
import { THREE, MeshRenderer, aimHeld, closeHand, crouch, humanBone, move, otherHand, palmOf, placeFoot, reach, type GameObject, type Hand, type MoveTiming, HeldProps, cueAt, SWISH_PEAK, type SfxName, UP, aheadOf, frameOf, heightOf, pointOn, PoseMove } from './pose-body';

/**
 * One pose of a sword move, in the swordsman's own frame: bearings are radians right of straight
 * ahead, lengths fractions of height.
 */
type SwordPose = {
	/** The sword hand: its bearing from the body's middle, how far out from it, and how high. */
	hand:{ bearing:number; out:number; up:number };
	/** Where the blade points: its bearing and its rise above level. The flat stays as level as that allows, edges leading. */
	blade:{ bearing:number; rise:number };
	/**
	 * The back twisting right and leaning forward (radians), the hips dropping; the body lunging
	 * forward over planted feet and the sword-side foot stepping ahead (fractions of height).
	 */
	body:{ twist:number; lean:number; drop:number; lunge?:number; stride?:number };
	/** How much the other hand closes on the hilt too (0 one-handed, 1 both hands). */
	hands?:number;
};

/**
 * A sword move, slow–fast–slow ({@link move}): it anticipates into `ready` over the wind-up, strikes
 * to `strike` as the blow lands, holds, follows through and recovers to the clip. `trail` is the
 * effect it leaves: a crescent along the swing, or a thrust's burst of wind.
 */
type SwordMove = MoveTiming & { ready:SwordPose; strike:SwordPose; trail?:'crescent' | 'thrust' };

/** How far past `ready` a swing's anticipation sinks, and past `strike` its follow-through carries, as shares of the move. */
const SWING = { sink: 0.15, carry: 0.12 };

/** The guard: blade across the face, flat level, tip to the off side, knees a little bent. */
const GUARD:SwordPose = { hand: { bearing: 0.35, out: 0.3, up: 0.88 }, blade: { bearing: -1.45, rise: 0.2 }, body: { twist: 0.1, lean: 0.05, drop: 0.05 } };

/** Sword moves by verb. A guard (`block`) holds as long as {@link Sword.guard} says. */
const SWORD_MOVES:Record<string, SwordMove> = {
	// Both hands on the hilt, drawn back by the hip, then a deep lunge: the front knee bent, the back
	// leg straight out behind, the body low and leaning in, arms driving the blade straight ahead.
	stab: {
		ready: { hand: { bearing: 1.2, out: 0.17, up: 0.5 }, blade: { bearing: 0, rise: 0.15 }, body: { twist: 0.5, lean: -0.05, drop: 0.04, lunge: -0.03, stride: 0.06 }, hands: 1 },
		strike: { hand: { bearing: 0.05, out: 0.72, up: 0.55 }, blade: { bearing: 0, rise: -0.03 }, body: { twist: -0.15, lean: 0.6, drop: 0.11, lunge: 0.28, stride: 0.36 }, hands: 1 },
		...SWING,
		snap: 0.03,
		hold: 0.1,
		follow: 0.05,
		settle: 0.2,
		trail: 'thrust',
	},
	// Wound up past the sword shoulder, swept flat across to the other side.
	slice: {
		ready: { hand: { bearing: 1.5, out: 0.28, up: 0.72 }, blade: { bearing: 2.2, rise: 0.15 }, body: { twist: 0.75, lean: 0, drop: 0.03 } },
		strike: { hand: { bearing: -0.9, out: 0.34, up: 0.66 }, blade: { bearing: -1.7, rise: -0.05 }, body: { twist: -0.7, lean: 0.15, drop: 0.06 } },
		...SWING,
		snap: 0.03,
		hold: 0.1,
		follow: 0.05,
		settle: 0.3,
		trail: 'crescent',
	},
	block: { ready: GUARD, strike: GUARD, sink: 0, snap: 0, hold: 0, carry: 0, follow: 0, settle: 0.25 },
};

/**
 * Strikes played as clips (a Knight's cleave): the crescent along the blade's path from `from` to
 * `to`, starting `lead` s before the blow; whether the blow throws up dust from the ground under the
 * blade; and whether the sword lies along the two fists of a two-handed clip (how much, 0–1).
 * The clips came with their own sword, so ours, fixed in one fist, would otherwise point astray.
 * After the blow it turns to `rest` (a bearing and rise, as a pose's blade) until the clip ends.
 */
const CLIP_STRIKES:Record<string, { from:SwordPose; to:SwordPose; lead:number; dust?:boolean; hands?:number; rest?:SwordPose['blade'] }> = {
	// Two-handed, overhead and straight down in front.
	cleave: {
		from: { hand: { bearing: 0.3, out: 0.12, up: 1.05 }, blade: { bearing: 0.2, rise: 2.0 }, body: { twist: 0, lean: 0, drop: 0 } },
		to: { hand: { bearing: 0.1, out: 0.4, up: 0.5 }, blade: { bearing: 0.1, rise: -0.75 }, body: { twist: 0, lean: 0, drop: 0 } },
		lead: 0.08,
		dust: true,
		hands: 1,
		// Straight ahead, a little down.
		rest: { bearing: 0, rise: -0.2 },
	},
};
/** Seconds the sword takes to turn onto a clip's two-handed grip, and back off it after; and from the blow to its rest. */
const GRIP_EASE = 0.12;
const REST_EASE = 0.15;
/** A sword's reach from the fist: its crescent runs from `TRAIL_NEAR` to `TRAIL_FAR` along the blade (m). */
const TRAIL_NEAR = 0.35;
const TRAIL_FAR = 1.0;
/** Steps along a crescent. */
const TRAIL_STEPS = 16;
/**
 * How far the blade runs from the fist (m), how far past the tip a thrust lands when no one is there
 * (and twice that is as far as it reaches for someone), and how far behind the feet it kicks up dust.
 */
const BLADE_REACH = 0.9;
const IMPACT_REACH = 0.7;
const DUST_BEHIND = 0.1;
/** How far ahead of the sword hand (toward the guard, m) the other hand takes the hilt. */
const SECOND_GRIP = 0.09;
/** Seconds the guard takes to come up. */
const GUARD_RAISE = 0.18;
/** A held sword's own axes: the tip down its −Y, the flat facing its ±Z. */
const SWORD_TIP = new THREE.Vector3(0, -1, 0);
const SWORD_FLAT = new THREE.Vector3(0, 0, 1);

/** Stab, slice and the guard, posed by hand: the body, the sword arm, and the blade's aim, eased in and out of the clip. */
export class Sword extends PoseMove<{ move:SwordMove; t0:number; windUp:number; hold:number; target:GameObject | null; trailed:boolean; ghosted?:boolean }> {
	/**
	 * Plays the sword move for `verb` (at `target`) so the blow lands `windUp` seconds from now, and
	 * returns true. A strike that is a clip (a cleave) is {@link ClipStrike}'s: false.
	 */
	public swing(verb:string, windUp:number, target:GameObject | null):boolean {
		const move = SWORD_MOVES[verb];
		if (!move) {
			return false;
		}
		this.current = { move, t0: this.now, windUp, hold: move.hold, target, trailed: false };
		if (move.trail) {
			cueBefore(this.go, windUp, SWISH_PEAK, 'swish');
		}
		return true;
	}

	/** Raises the guard for `seconds`; 0 lowers it now. */
	public guard(seconds:number):void {
		const swing = this.current;
		const now = this.now;
		if (seconds > 0) {
			this.current = { move: SWORD_MOVES.block!, t0: now, windUp: GUARD_RAISE, hold: Math.max(0, seconds - GUARD_RAISE), target: null, trailed: true };
		}
		else if (swing?.move === SWORD_MOVES.block) {
			swing.hold = Math.min(swing.hold, Math.max(0, now - swing.t0 - swing.windUp));
		}
	}

	/** Whom the swordsman looks at while swinging. */
	public look():THREE.Vector3 | null {
		const target = this.current?.target;
		return target?.world && target.world === this.go.world ? pointOn(target, 0.8) : null;
	}

	public override update(root:THREE.Object3D, alive:boolean):void {
		const swing = this.current;
		if (!swing) {
			return;
		}
		const go = this.go;
		const sword = swing.move;
		const { phase, u, weight } = move({ ...sword, hold: swing.hold }, swing.windUp, this.now - swing.t0);
		if (!alive || phase === 'done') {
			this.current = null;
			return;
		}
		// A crescent is laid out as the strike begins, as far as the swing will carry; a thrust's wind
		// leaves the blade where it lands.
		if (!swing.trailed && sword.trail === 'crescent' && phase !== 'anticipate') {
			swing.trailed = true;
			crescent(go, mixPose(sword.ready, sword.strike, -sword.sink), mixPose(sword.ready, sword.strike, 1 + sword.carry));
		}
		const pose = mixPose(sword.ready, sword.strike, u);
		const { hand, m, ahead, right } = swordFrame(go);
		crouch(root, { twist: -m * pose.body.twist, lean: pose.body.lean, drop: pose.body.drop * heightOf(go) }, weight);
		this.lunge(root, hand, pose, weight);
		// The elbow down and out, a little back.
		reach(root, hand, handAt(go, pose), weight, UP.clone().negate().addScaledVector(right, 0.6 * m).addScaledVector(ahead, -0.3));
		const blade = go.getComponent(HeldProps)?.prop(hand);
		if (blade) {
			aimHeld(root, hand, blade, SWORD_TIP, SWORD_FLAT, bearingDir(go, pose.blade.bearing, pose.blade.rise), UP, weight);
			secondHand(go, root, hand, blade, (pose.hands ?? 0) * weight);
			if (!swing.trailed && sword.trail === 'thrust' && phase !== 'anticipate' && phase !== 'strike') {
				swing.trailed = true;
				this.thrust(root, hand, blade, swing.target);
			}
		}
		// A lunge leaves a ghost of the body where the strike began.
		if (!swing.ghosted && sword.trail === 'thrust' && phase !== 'anticipate') {
			swing.ghosted = true;
			if (go.world) {
				lungeGhost(go.world.native, root);
			}
		}
	}

	/**
	 * The legs of a lunge: the body carried `pose.body.lunge` forward, the back foot staying where it
	 * stood (its leg straightening behind) and the sword-side foot stepping `pose.body.stride` ahead,
	 * its knee bent forward.
	 */
	private lunge(root:THREE.Object3D, hand:Hand, pose:SwordPose, weight:number):void {
		const height = heightOf(this.go);
		const lunge = (pose.body.lunge ?? 0) * height;
		const stride = (pose.body.stride ?? 0) * height;
		const front = humanBone(root, `${hand}Foot`);
		const back = otherHand(hand);
		const rear = humanBone(root, `${back}Foot`);
		if (!front || !rear || (Math.abs(lunge) < 1e-4 && Math.abs(stride) < 1e-4)) {
			return;
		}
		const ahead = aheadOf(this.go, 1);
		root.updateMatrixWorld(true);
		const frontAt = front.getWorldPosition(new THREE.Vector3()).addScaledVector(ahead, stride);
		const rearAt = rear.getWorldPosition(new THREE.Vector3());
		this.body.step(root, ahead.clone().multiplyScalar(lunge * weight));
		const down = UP.clone().negate();
		placeFoot(root, hand, frontAt, weight, ahead.clone().addScaledVector(down, 0.3));
		placeFoot(root, back, rearAt, weight, ahead.clone().multiplyScalar(0.4).add(down));
	}

	/**
	 * As a thrust lands: a lance of light driven from `sword`'s blade into whoever it is aimed at (or
	 * a little past the tip), and dust kicked up behind the feet.
	 */
	private thrust(root:THREE.Object3D, hand:Hand, sword:THREE.Object3D, target:GameObject | null):void {
		const world = this.go.world;
		const fist = humanBone(root, `${hand}Hand`);
		if (!world || !fist) {
			return;
		}
		root.updateMatrixWorld(true);
		const dir = SWORD_TIP.clone().applyQuaternion(sword.getWorldQuaternion(new THREE.Quaternion()));
		const hilt = fist.getWorldPosition(new THREE.Vector3());
		const tip = hilt.clone().addScaledVector(dir, BLADE_REACH);
		const body = target?.world === world ? pointOn(target, 0.6) : null;
		const impact = body && body.distanceTo(tip) < IMPACT_REACH * 2 ? body : tip.clone().addScaledVector(dir, IMPACT_REACH);
		thrustLance(world.native, hilt, tip, impact);
		const behind = aheadOf(this.go, -1);
		dustKick(world.native, pointOn(this.go, 0).addScaledVector(behind, DUST_BEHIND), behind);
	}
}

/**
 * What a strike played as a clip (a cleave) adds: its crescent, its dust, and the sword turned to lie
 * along the grip the clip's fists hold, from the sword fist through the other fist and on out, edge
 * leading, easing on and off (from `t0` until `until`, `amount` of the way); after the `blow` it turns to the
 * strike's `rest` instead.
 */
export class ClipStrike extends PoseMove<{ t0:number; until:number; amount:number; blow:number; rest?:SwordPose['blade'] }> {
	/** Adds what the clip strike for `verb` needs: its blow lands `windUp` s from now, the clip is `seconds` long. */
	public play(verb:string, windUp:number, seconds:number):void {
		const strike = CLIP_STRIKES[verb];
		const world = this.go.world;
		if (!strike || !world) {
			return;
		}
		world.after(Math.max(0, windUp - strike.lead), () => crescent(this.go, strike.from, strike.to));
		cueBefore(this.go, windUp, SWISH_PEAK, 'swishHeavy');
		if (strike.dust) {
			world.after(windUp, () => {
				this.groundDust();
				cueAt(world, 'groundCrack', this.go);
			});
		}
		if (strike.hands) {
			const now = this.now;
			this.current = { t0: now, until: now + seconds, amount: strike.hands, blow: now + windUp, rest: strike.rest };
		}
	}

	public override update(root:THREE.Object3D, alive:boolean):void {
		const grip = this.current;
		const t = this.now;
		if (!grip || !alive || t >= grip.until) {
			this.current = null;
			return;
		}
		const { hand, right } = swordFrame(this.go);
		const other = otherHand(hand);
		const sword = this.go.getComponent(HeldProps)?.prop(hand);
		if (!sword) {
			return;
		}
		root.updateMatrixWorld(true);
		const [fist, off] = [palmOf(root, hand), palmOf(root, other)];
		if (!fist || !off) {
			return;
		}
		// The clips hold the guard in the off hand, the pommel in the sword hand.
		const along = off.sub(fist);
		if (along.lengthSq() < 1e-6) {
			return;
		}
		const on = Math.min(THREE.MathUtils.smoothstep(t, grip.t0, grip.t0 + GRIP_EASE), 1 - THREE.MathUtils.smoothstep(t, grip.until - GRIP_EASE, grip.until));
		const aim = along.normalize();
		if (grip.rest) {
			aim.lerp(bearingDir(this.go, grip.rest.bearing, grip.rest.rise), THREE.MathUtils.smoothstep(t, grip.blow, grip.blow + REST_EASE)).normalize();
		}
		aimHeld(root, hand, sword, SWORD_TIP, SWORD_FLAT, aim, right, grip.amount * on);
		// The clip's off hand only comes near; close it on the hilt.
		secondHand(this.go, root, hand, sword, grip.amount * on);
	}

	/** Dust thrown up from the ground under the blade where it is now, all along it (a cleave come down). */
	private groundDust():void {
		const world = this.go.world;
		const root = this.go.getComponent(MeshRenderer)?.mesh;
		const { hand } = swordFrame(this.go);
		const sword = this.go.getComponent(HeldProps)?.prop(hand);
		const fist = root && humanBone(root, `${hand}Hand`);
		if (!world || !root || !sword || !fist) {
			return;
		}
		root.updateMatrixWorld(true);
		const dir = SWORD_TIP.clone().applyQuaternion(sword.getWorldQuaternion(new THREE.Quaternion()));
		const hilt = fist.getWorldPosition(new THREE.Vector3());
		const ground = this.go.transform.position.y;
		const a = hilt.clone().addScaledVector(dir, TRAIL_NEAR).setY(ground);
		const b = hilt.clone().addScaledVector(dir, BLADE_REACH).setY(ground);
		dustLine(world.native, a, b);
	}
}

/** `a` blended `u` of the way to `b`. */
function mixPose(a:SwordPose, b:SwordPose, u:number):SwordPose {
	const at = (x:number | undefined, y:number | undefined):number => (x ?? 0) + ((y ?? 0) - (x ?? 0)) * u;
	const mix = <T extends Record<string, number | undefined>>(x:T, y:T):T => Object.fromEntries([...new Set([...Object.keys(x), ...Object.keys(y)])].map((k) => [k, at(x[k], y[k])])) as T;
	return { hand: mix(a.hand, b.hand), blade: mix(a.blade, b.blade), body: mix(a.body, b.body), hands: at(a.hands, b.hands) };
}

/** Plays `name` at `go` `lead` s before a blow due in `windUp` s (at once if that is already past). */
function cueBefore(go:GameObject, windUp:number, lead:number, name:SfxName):void {
	const world = go.world;
	world?.after(Math.max(0, windUp - lead), () => cueAt(world, name, go));
}

/** The sword hand (poses are for the right, mirrored for a sword in the left) and the body's frame, flat. */
function swordFrame(go:GameObject):{ hand:Hand; m:number; ahead:THREE.Vector3; right:THREE.Vector3 } {
	const held = go.getComponent(HeldProps);
	const hand:Hand = !held?.prop('right') && held?.prop('left') ? 'left' : 'right';
	const { ahead, right } = frameOf(go);
	return { hand, m: hand === 'right' ? 1 : -1, ahead, right };
}

/** A world direction at `bearing` (right of ahead, mirrored for the left hand) and `rise` above level. */
function bearingDir(go:GameObject, bearing:number, rise:number):THREE.Vector3 {
	const { m, ahead, right } = swordFrame(go);
	return ahead.multiplyScalar(Math.cos(m * bearing) * Math.cos(rise))
		.addScaledVector(right, Math.sin(m * bearing) * Math.cos(rise)).addScaledVector(UP, Math.sin(rise));
}

/** Where `pose` puts the sword hand (world). */
function handAt(go:GameObject, pose:SwordPose):THREE.Vector3 {
	return pointOn(go, pose.hand.up).addScaledVector(bearingDir(go, pose.hand.bearing, 0), pose.hand.out * heightOf(go));
}

/** The white crescent the blade cuts on its way from pose `from` to pose `to`. */
function crescent(go:GameObject, from:SwordPose, to:SwordPose):void {
	const scene = go.world?.native;
	if (!scene) {
		return;
	}
	const inner:THREE.Vector3[] = [];
	const outer:THREE.Vector3[] = [];
	for (let i = 0; i <= TRAIL_STEPS; i++) {
		const pose = mixPose(from, to, i / TRAIL_STEPS);
		const at = handAt(go, pose);
		const dir = bearingDir(go, pose.blade.bearing, pose.blade.rise);
		inner.push(at.clone().addScaledVector(dir, TRAIL_NEAR));
		outer.push(at.addScaledVector(dir, TRAIL_FAR));
	}
	slashTrail(scene, inner, outer);
}

/**
 * Closes the other hand on `sword`'s hilt, `amount` of the way (0–1): its palm on the blade's own
 * line a hand's width toward the guard from the sword hand's, the fingers shut round it.
 */
function secondHand(go:GameObject, root:THREE.Object3D, hand:Hand, sword:THREE.Object3D, amount:number):void {
	const other = otherHand(hand);
	root.updateMatrixWorld(true);
	const fist = palmOf(root, hand);
	const offPalm = palmOf(root, other);
	const offWrist = humanBone(root, `${other}Hand`);
	if (!fist || !offPalm || !offWrist || amount <= 0.01) {
		return;
	}
	// The sword's origin lies on its long axis.
	const dir = SWORD_TIP.clone().applyQuaternion(sword.getWorldQuaternion(new THREE.Quaternion()));
	const origin = sword.getWorldPosition(new THREE.Vector3());
	const onLine = origin.clone().addScaledVector(dir, fist.sub(origin).dot(dir) + SECOND_GRIP);
	// `reach` places the wrist; the palm sits this far past it.
	const wrist = onLine.sub(offPalm.sub(offWrist.getWorldPosition(new THREE.Vector3())));
	const outward = frameOf(go, other).side;
	reach(root, other, wrist, amount, UP.clone().negate().addScaledVector(outward, 0.5));
	closeHand(root, other, amount);
}
