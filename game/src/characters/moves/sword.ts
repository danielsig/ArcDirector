import { slashTrail, thrustLance } from '../../render/sword-fx';
import { dustKick, dustLine, lungeGhost } from '../../render/fight-fx';
import { THREE, closeHand, crouch, holdAt, humanBone, move, otherHand, palmOf, placeFoot, reach, type GameObject, type Hand, type HeldPose, type MoveTiming, HeldProps, cueAt, SWISH_PEAK, type SfxName, UP, aheadOf, frameOf, heightOf, degrees, heldPose, inWorld, isWalking, pointOn, spotBy, turnBy, PoseMove } from './pose-body';

/** One pose of a sword move: the sword as {@link heldPose} writes it, and the body. */
interface SwordPose extends HeldPose {
	/**
	 * The back twisting right and leaning forward (radians), the hips dropping; the body lunging
	 * forward over planted feet and the sword-side foot stepping ahead (fractions of height).
	 */
	body:{ twist:number; lean:number; drop:number; lunge?:number; stride?:number };
	/** How much the other hand closes on the hilt too (0 one-handed, 1 both hands). */
	hands?:number;
	/** Where the other wrist goes when it is not on the hilt (held out for balance), as `at`; unset, the clip has it. */
	off?:THREE.Vector3;
}

/**
 * A sword move, slow–fast–slow ({@link move}): it anticipates into `ready` over the wind-up, strikes
 * to `strike` as the blow lands, holds, follows through and recovers to the clip. `trail` is the
 * effect it leaves: a crescent traced by the blade through the strike and follow-through, or a thrust's burst of wind. A swing passes `through` its poses on the way, evenly spaced
 * halfway there, when it has one. With `cocked`, the end of the wind-up turns into that pose, and the swing starts there.
 */
interface SwordMove extends MoveTiming {
	ready:SwordPose;
	cocked?:SwordPose;
	through?:SwordPose[];
	strike:SwordPose;
	trail?:'crescent' | 'thrust';
}

/** How far past `ready` a swing's anticipation sinks, and past `strike` its follow-through carries, as shares of the move. */
const SWING = { sink: 0.15, carry: 0.12 };

/** The guard: blade across the face, flat level, tip to the off side, knees a little bent. */
const GUARD:SwordPose = { ...heldPose([0.029, 0.82, -0.208], [-88.6, 11.4, -97.1], [0.182, 0.802, -0.115]), body: { twist: 0.1, lean: 0.05, drop: 0.05 } };

/** Sword moves by verb. A guard (`block`) holds as long as {@link Sword.guard} says. */
export const SWORD_MOVES:Record<string, SwordMove> = {
	// Both hands on the hilt, drawn back by the hip, then a deep lunge: the front knee bent, the back
	// leg straight out behind, the body low and leaning in, arms driving the blade straight ahead.
	stab: {
		ready: { ...heldPose([0.16, 0.524, -0.087], [-81.4, 0, 180], [0.13, 0.52, 0.06]), body: { twist: 0.5, lean: -0.05, drop: 0.04, lunge: -0.03, stride: 0.06 }, hands: 1 },
		strike: { ...heldPose([0.053, 0.561, -0.625], [-91.7, 0, 180], [0.03, 0.588, -0.452]), body: { twist: -0.15, lean: 0.6, drop: 0.11, lunge: 0.28, stride: 0.36 }, hands: 1 },
		...SWING,
		snap: 0.03,
		hold: 0.1,
		follow: 0.05,
		settle: 0.2,
		trail: 'thrust',
	},
	// Drawn back, the arm an L: the upper arm level out from the shoulder, toward the back and right, the forearm straight
	// up, the wrist straight, the blade up and back over the shoulder; then the wrist alone cocks it straight away from
	// the hip, and it sweeps flat round to the other side.
	slice: {
		ready: { ...heldPose([0.334, 0.843, 0.299], [-77.5, -46.8, 73.7], [0.189, 0.761, 0.191]), off: new THREE.Vector3(-0.23, 0.78, -0.223), body: { twist: 0.75, lean: 0.055, drop: 0.03 } },
		cocked: { ...heldPose([0.334, 0.843, 0.299], [-75.5, -40, 81.8], [0.189, 0.761, 0.191]), off: new THREE.Vector3(-0.23, 0.78, -0.223), body: { twist: 0.75, lean: 0.055, drop: 0.03 } },
		// The torso tilts back from the hips throughout, so the cut runs level, not down.
		// Round the right side, the blade out to the side and then to the front and right, then straight ahead (the arm
		// reaching out, the other hand drawing back), then to the front and left: no two poses more than 90° apart, the
		// elbow leading the hand round.
		through: [
			{ ...heldPose([0.283, 0.833, 0.199], [-139.6, -24.4, 59.7], [0.197, 0.732, 0.092]), off: new THREE.Vector3(-0.25, 0.767, -0.192), body: { twist: 0.625, lean: 0.055, drop: 0.034 } },
			{ ...heldPose([0.231, 0.822, 0.098], [169, -0.3, 62.7], [0.204, 0.703, -0.007]), off: new THREE.Vector3(-0.269, 0.753, -0.16), body: { twist: 0.5, lean: 0.055, drop: 0.037 } },
			{ ...heldPose([0.258, 0.76, -0.097], [-153.7, -48.4, 89.3], [0.116, 0.698, -0.118]), off: new THREE.Vector3(-0.293, 0.727, -0.092), body: { twist: 0.25, lean: 0.055, drop: 0.043 } },
			{ ...heldPose([0.131, 0.699, -0.27], [-87.2, -0.7, 165.7], [0.002, 0.694, -0.126]), off: new THREE.Vector3(-0.299, 0.7, -0.021), body: { twist: 0, lean: 0.055, drop: 0.05 } },
			{ ...heldPose([-0.078, 0.674, -0.31], [-88.8, -1.2, -135], [-0.092, 0.678, -0.113]), off: new THREE.Vector3(-0.227, 0.59, 0.104), body: { twist: -0.35, lean: 0.055, drop: 0.055 } },
		],
		strike: { ...heldPose([-0.274, 0.649, -0.199], [-89.6, -2.8, -82.6], [-0.115, 0.663, -0.119]), off: new THREE.Vector3(-0.12, 0.48, 0.16), body: { twist: -0.7, lean: 0.055, drop: 0.06 } },
		...SWING,
		// The cock is its anticipation: no sinking past the wind-up.
		sink: 0,
		snap: 0.03,
		hold: 0.1,
		follow: 0.05,
		settle: 0.3,
		trail: 'crescent',
	},
	block: { ready: GUARD, strike: GUARD, sink: 0, snap: 0, hold: 0, carry: 0, follow: 0, settle: 0.25 },
};

/**
 * Strikes played as clips (a Knight's cleave): the crescent the blade traces from `lead` s before the blow until
 * `TRACE_AFTER` s after; whether the blow throws up dust from the ground under the blade; and whether the sword lies
 * along the two fists of a two-handed clip (how much, 0–1). The clips came with their own sword, so ours, fixed in one
 * fist, would otherwise point astray. After the blow it turns to `rest` (in the body's frame, as a pose's turn) until
 * the clip ends.
 */
const CLIP_STRIKES:Record<string, { lead:number; dust?:boolean; hands?:number; rest?:THREE.Quaternion }> = {
	// Two-handed, overhead and straight down in front.
	cleave: {
		lead: 0.06,
		dust: true,
		hands: 1,
		// Straight ahead, a little down.
		rest: degrees(78.5, 60, 0),
	},
};
/** Seconds the sword takes to turn onto a clip's two-handed grip, and back off it after; and from the blow to its rest. */
const GRIP_EASE = 0.12;
const REST_EASE = 0.15;
/**
 * Where a crescent's inner edge runs, as a share of the sword's length up from its tip (its outer edge is the tip);
 * the steps it takes between two frames, swept round the body; and how long a clip's crescent goes on after the blow (s).
 */
const BLADE_INNER = 0.5;
const TRACE_STEPS = 12;
const TRACE_AFTER = 0.05;
/**
 * How far past the tip a thrust lands when no one is there (m; twice that is as far as it reaches for someone), and
 * how far behind the feet it kicks up dust.
 */
const IMPACT_REACH = 0.7;
const DUST_BEHIND = 0.1;
/** How far ahead of the sword hand (toward the guard, m) the other hand takes the hilt. */
const SECOND_GRIP = 0.09;
/** How far apart the feet stand, a sword in hand (fraction of height); how fast that eases in and out (per second). */
const STANCE = 0.18;
const STANCE_EASE = 5;
/** Longest a swing waits at its wind-up for the hand to get there (s); how near counts as there (fraction of height, radians). */
const WINDUP_WAIT = 0.3;
const WINDUP_NEAR = 0.06;
const WINDUP_TURN = 25 * Math.PI / 180;
/** A hand that moved less than this in a frame has come to rest (fraction of height, radians). */
const WINDUP_STILL = 0.003;
const WINDUP_STILL_TURN = Math.PI / 180;
/** Seconds the guard takes to come up. */
const GUARD_RAISE = 0.18;
/** Which way a held sword's blade runs from the hilt: down its own −Y. */
const SWORD_TIP = new THREE.Vector3(0, -1, 0);

/** Stab, slice and the guard, posed by hand: the body, and the sword where each pose holds it, eased in and out of the clip. */
export class Sword extends PoseMove<{ move:SwordMove; t0:number; windUp:number; hold:number; target:GameObject | null; trailed:boolean; ghosted?:boolean; trace:Trace; swung?:boolean; waited?:number; arrived?:boolean; last?:HeldPose }> {
	/** How far the wider stance is in (0–1). */
	private _stance = 0;

	/**
	 * Plays the sword move for `verb` (at `target`) so the blow lands `windUp` seconds from now, and
	 * returns true. A strike that is a clip (a cleave) is {@link ClipStrike}'s: false.
	 */
	public swing(verb:string, windUp:number, target:GameObject | null):boolean {
		const move = SWORD_MOVES[verb];
		if (!move) {
			return false;
		}
		this.current = { move, t0: this.now, windUp, hold: move.hold, target, trailed: false, trace: newTrace() };
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
			this.current = { move: SWORD_MOVES.block!, t0: now, windUp: GUARD_RAISE, hold: Math.max(0, seconds - GUARD_RAISE), target: null, trailed: true, trace: newTrace() };
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

	public override update(root:THREE.Object3D, alive:boolean, dt:number):void {
		this.stance(root, alive, dt);
		const swing = this.current;
		if (!swing) {
			return;
		}
		const go = this.go;
		const sword = swing.move;
		// The swing waits at the wind-up until the hand has really got there, at most `WINDUP_WAIT`: the time stands still.
		const late = this.now - swing.t0 - (swing.windUp - Math.min(sword.snap, swing.windUp / 2));
		if (!swing.swung && late >= 0) {
			swing.waited = (swing.waited ?? 0) + late;
			swing.swung = swing.arrived === true || swing.waited >= WINDUP_WAIT;
			swing.t0 += swing.swung ? 0 : late;
		}
		const { phase, u, weight } = move({ ...sword, hold: swing.hold }, swing.windUp, this.now - swing.t0);
		if (!alive || phase === 'done') {
			this.current = null;
			return;
		}
		const { hand, m } = swordFrame(go);
		const pose = phase === 'anticipate' && sword.cocked ? mixPose(sword.ready, sword.cocked, THREE.MathUtils.smoothstep(weight, 0.7, 1)) : poseAt(sword, u);
		crouch(root, { twist: -m * pose.body.twist, lean: pose.body.lean, drop: pose.body.drop * heightOf(go) }, weight);
		this.lunge(root, hand, pose, weight);
		if (pose.off && !pose.hands) {
			// The other hand out for balance, its elbow down and out.
			reach(root, otherHand(hand), spotBy(go, hand, pose.off), weight, UP.clone().negate().addScaledVector(frameOf(go, hand).side, -0.5));
		}
		const blade = go.getComponent(HeldProps)?.prop(hand);
		if (!blade) {
			return;
		}
		const held = inWorld(go, hand, pose);
		holdAt(root, hand, blade, held, weight);
		if (!swing.swung) {
			// Got to the wind-up: the sword's handle and turn near the pose's, as the hand really is, or come to rest short
			// of it (whatever else poses the arm holds it there).
			const windUp = inWorld(go, hand, sword.cocked ?? sword.ready);
			const now = { at: palmOf(root, hand) ?? windUp.at, turn: blade.getWorldQuaternion(new THREE.Quaternion()) };
			const last = swing.last;
			swing.last = now;
			swing.arrived = (now.at.distanceTo(windUp.at) < WINDUP_NEAR * heightOf(go) && now.turn.angleTo(windUp.turn) < WINDUP_TURN)
				|| (!!last && now.at.distanceTo(last.at) < WINDUP_STILL * heightOf(go) && now.turn.angleTo(last.turn) < WINDUP_STILL_TURN);
		}
		secondHand(go, root, hand, blade, (pose.hands ?? 0) * weight);
		if (sword.trail === 'crescent') {
			// Where the sword really is, whatever else poses the arm too.
			traceBlade(go, hand, swing.trace, phase === 'strike' || phase === 'impact' || phase === 'follow');
		}
		// A thrust's wind leaves the blade where it lands.
		if (!swing.trailed && sword.trail === 'thrust' && phase !== 'anticipate' && phase !== 'strike') {
			swing.trailed = true;
			this.thrust(hand, swing.target);
		}
		// A lunge leaves a ghost of the body where the strike began.
		if (!swing.ghosted && sword.trail === 'thrust' && phase !== 'anticipate') {
			swing.ghosted = true;
			if (go.world) {
				lungeGhost(go.world.native, root);
			}
		}
	}

	/** Standing with a sword in hand, the feet `STANCE` apart whatever the clip has, about where it has them, easing in and out as it stops and walks. */
	private stance(root:THREE.Object3D, alive:boolean, dt:number):void {
		const go = this.go;
		const { hand } = swordFrame(go);
		const armed = alive && !isWalking(go) && !!go.getComponent(HeldProps)?.item(hand)?.Blade;
		this._stance += ((armed ? 1 : 0) - this._stance) * Math.min(1, dt * STANCE_EASE);
		if (this._stance < 0.01) {
			return;
		}
		root.updateMatrixWorld(true);
		const [left, right] = [humanBone(root, 'leftFoot'), humanBone(root, 'rightFoot')];
		if (!left || !right) {
			return;
		}
		const across = frameOf(go).right;
		const [l, r] = [left.getWorldPosition(new THREE.Vector3()), right.getWorldPosition(new THREE.Vector3())];
		// Each foot moved along the body's left–right line only, so the gap between them comes to the stance's.
		const widen = (STANCE * heightOf(go) - r.clone().sub(l).dot(across)) / 2;
		placeFoot(root, 'right', r.addScaledVector(across, widen), this._stance, aheadOf(go, 1));
		placeFoot(root, 'left', l.addScaledVector(across, -widen), this._stance, aheadOf(go, 1));
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
	private thrust(hand:Hand, target:GameObject | null):void {
		const world = this.go.world;
		const held = this.go.getComponent(HeldProps);
		const [inner, tip] = [held?.along(hand, BLADE_INNER), held?.along(hand, 0)];
		if (!world || !inner || !tip) {
			return;
		}
		const dir = tip.clone().sub(inner).normalize();
		const body = target?.world === world ? pointOn(target, 0.6) : null;
		const impact = body && body.distanceTo(tip) < IMPACT_REACH * 2 ? body : tip.clone().addScaledVector(dir, IMPACT_REACH);
		thrustLance(world.native, inner, tip, impact);
		const behind = aheadOf(this.go, -1);
		dustKick(world.native, pointOn(this.go, 0).addScaledVector(behind, DUST_BEHIND), behind);
	}
}

/**
 * What a strike played as a clip (a cleave) adds: its crescent, its dust, and the sword turned to lie
 * along the grip the clip's fists hold, from the sword fist through the other fist and on out,
 * easing on and off (from `t0` until `until`, `amount` of the way); after the `blow` it turns to the
 * strike's `rest` instead.
 */
export class ClipStrike extends PoseMove<{ t0:number; until:number; amount:number; blow:number; lead:number; rest?:THREE.Quaternion; trace:Trace }> {
	/** Adds what the clip strike for `verb` needs: its blow lands `windUp` s from now, the clip is `seconds` long. */
	public play(verb:string, windUp:number, seconds:number):void {
		const strike = CLIP_STRIKES[verb];
		const world = this.go.world;
		if (!strike || !world) {
			return;
		}
		cueBefore(this.go, windUp, SWISH_PEAK, 'swishHeavy');
		if (strike.dust) {
			world.after(windUp, () => {
				this.groundDust();
				cueAt(world, 'groundCrack', this.go);
			});
		}
		if (strike.hands) {
			const now = this.now;
			this.current = { t0: now, until: now + seconds, amount: strike.hands, blow: now + windUp, lead: strike.lead, rest: strike.rest, trace: newTrace() };
		}
	}

	public override update(root:THREE.Object3D, alive:boolean):void {
		const grip = this.current;
		const t = this.now;
		if (!grip || !alive || t >= grip.until) {
			this.current = null;
			return;
		}
		const { hand } = swordFrame(this.go);
		const sword = this.go.getComponent(HeldProps)?.prop(hand);
		root.updateMatrixWorld(true);
		const [fist, off] = [palmOf(root, hand), palmOf(root, otherHand(hand))];
		if (!sword || !fist || !off) {
			return;
		}
		// The clips hold the guard in the off hand, the pommel in the sword hand.
		const along = off.sub(fist);
		if (along.lengthSq() < 1e-6) {
			return;
		}
		const on = Math.min(THREE.MathUtils.smoothstep(t, grip.t0, grip.t0 + GRIP_EASE), 1 - THREE.MathUtils.smoothstep(t, grip.until - GRIP_EASE, grip.until));
		const held = sword.getWorldQuaternion(new THREE.Quaternion());
		const turn = new THREE.Quaternion().setFromUnitVectors(SWORD_TIP.clone().applyQuaternion(held), along.normalize()).multiply(held);
		if (grip.rest) {
			turn.slerp(turnBy(hand, grip.rest, aheadOf(this.go, 1)), THREE.MathUtils.smoothstep(t, grip.blow, grip.blow + REST_EASE));
		}
		holdAt(root, hand, sword, { at: fist, turn }, grip.amount * on);
		traceBlade(this.go, hand, grip.trace, t >= grip.blow - grip.lead && t <= grip.blow + TRACE_AFTER);
		// The clip's off hand comes near the hilt; it only closes on it, its arm as the clip has it.
		closeHand(root, otherHand(hand), grip.amount * on);
	}

	/** Dust thrown up from the ground under the blade where it is now, all along it (a cleave come down). */
	private groundDust():void {
		const world = this.go.world;
		const { hand } = swordFrame(this.go);
		const held = this.go.getComponent(HeldProps);
		const [a, b] = [held?.along(hand, BLADE_INNER), held?.along(hand, 0)];
		if (world && a && b) {
			const ground = this.go.transform.position.y;
			dustLine(world.native, a.setY(ground), b.setY(ground));
		}
	}
}

/** Where `move` is `u` of the way from its ready (or cocked) pose to its strike, through its poses on the way, evenly spaced. */
function poseAt(move:SwordMove, u:number):SwordPose {
	const poses = [move.cocked ?? move.ready, ...move.through ?? [], move.strike];
	const at = u * (poses.length - 1);
	const i = THREE.MathUtils.clamp(Math.floor(at), 0, poses.length - 2);
	return mixPose(poses[i]!, poses[i + 1]!, at - i);
}

/** `a` blended `u` of the way to `b` (past either end too). */
function mixPose(a:SwordPose, b:SwordPose, u:number):SwordPose {
	const at = (x:number | undefined, y:number | undefined):number => (x ?? 0) + ((y ?? 0) - (x ?? 0)) * u;
	const mix = <T extends Record<string, number | undefined>>(x:T, y:T):T => Object.fromEntries([...new Set([...Object.keys(x), ...Object.keys(y)])].map((k) => [k, at(x[k], y[k])])) as T;
	return { at: round(a.at, b.at, u), turn: new THREE.Quaternion().slerpQuaternions(a.turn, b.turn, u), elbow: either(a.elbow, b.elbow, u), off: either(a.off, b.off, u), body: mix(a.body, b.body), hands: at(a.hands, b.hands) };
}

/** `x` blended `u` of the way to `y` when both are set, else whichever is on its side of the way. */
function either(x:THREE.Vector3 | undefined, y:THREE.Vector3 | undefined, u:number):THREE.Vector3 | undefined {
	return x && y ? round(x, y, u) : u <= 0 ? x : y;
}

/** `a` blended `u` of the way to `b` round the body, as a swing sweeps: its bearing from the body's middle, its reach out from it and its height. */
function round(a:THREE.Vector3, b:THREE.Vector3, u:number):THREE.Vector3 {
	const [from, to] = [a, b].map((v) => Math.atan2(v.x, -v.z));
	const bearing = from! + u * Math.atan2(Math.sin(to! - from!), Math.cos(to! - from!));
	const out = THREE.MathUtils.lerp(Math.hypot(a.x, a.z), Math.hypot(b.x, b.z), u);
	return new THREE.Vector3(out * Math.sin(bearing), THREE.MathUtils.lerp(a.y, b.y, u), -out * Math.cos(bearing));
}

/** Plays `name` at `go` `lead` s before a blow due in `windUp` s (at once if that is already past). */
function cueBefore(go:GameObject, windUp:number, lead:number, name:SfxName):void {
	const world = go.world;
	world?.after(Math.max(0, windUp - lead), () => cueAt(world, name, go));
}

/** The sword hand (poses are for the right, mirrored for a sword in the left), and 1 for the right or −1 for the left. */
function swordFrame(go:GameObject):{ hand:Hand; m:number } {
	const held = go.getComponent(HeldProps);
	const hand:Hand = !held?.prop('right') && held?.prop('left') ? 'left' : 'right';
	return { hand, m: hand === 'right' ? 1 : -1 };
}

/** A white crescent a blade traces: its edges so far, whether it is shown yet, and whether it grew since last drawn. */
interface Trace { inner:THREE.Vector3[]; outer:THREE.Vector3[]; shown:boolean; grew:boolean }

function newTrace():Trace {
	return { inner: [], outer: [], shown: false, grew: false };
}

/**
 * Adds where `go`'s blade in `hand` really is now to `trace` while `on`, its crescent growing behind the blade in
 * steps round the body from where it was a frame ago, as a swing sweeps. Before it is `on` it keeps only the last
 * place, where the crescent starts; once it is off, the crescent fades.
 */
function traceBlade(go:GameObject, hand:Hand, trace:Trace, on:boolean):void {
	const props = go.getComponent(HeldProps);
	const [inner, tip] = [props?.along(hand, BLADE_INNER), props?.along(hand, 0)];
	const scene = go.world?.native;
	if (!inner || !tip || !scene || (trace.shown && !on)) {
		return;
	}
	const [a, b] = [trace.inner.at(-1), trace.outer.at(-1)];
	// A blade held still adds nothing: the crescent would bunch up where it stops.
	if (on && a && b && inner.distanceTo(a) + tip.distanceTo(b) < 0.02) {
		trace.grew = true;
		return;
	}
	if (!on) {
		trace.inner.length = trace.outer.length = 0;
	}
	else if (!trace.shown) {
		trace.shown = true;
		slashTrail(scene, trace.inner, trace.outer, () => {
			const grew = trace.grew;
			trace.grew = false;
			return grew;
		});
	}
	const base = go.transform.position;
	const sweep = (from:THREE.Vector3, to:THREE.Vector3, k:number):THREE.Vector3 => round(from.clone().sub(base), to.clone().sub(base), k).add(base);
	for (let i = 1; on && a && b && i < TRACE_STEPS; i++) {
		trace.inner.push(sweep(a, inner, i / TRACE_STEPS));
		trace.outer.push(sweep(b, tip, i / TRACE_STEPS));
	}
	trace.inner.push(inner);
	trace.outer.push(tip);
	trace.grew = on;
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
