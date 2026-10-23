import { MeshRenderer, Time, aimHeld, ease, move, type MoveTiming, type SfxHandle, closeHand, create, crouch, palmOf, drawBow, humanBone, lookAt, orientHand, placeFoot, reach, type Hand, Component, type GameObject } from '@arc-director/kindling';
import * as THREE from 'three';
import { Appearance, POSE_SECONDS, SpeechBubble, Vitals } from '../engine/components';
import { Order } from '../engine/order';
import { HeldProps, turnAboutGrip } from './HeldProps';
import { slashTrail, thrustLance } from '../render/swordFx';
import { dustKick, dustLine, lungeGhost } from '../render/fightFx';
import { chargeGlint, fireball, FIREBALL_SPEED, healLight, lightning, missPoint, RELEASE_GRACE, type Cast, type Outcome, type Stance } from '../render/spellFx';
import { NPCInput } from './NPCInput';
import { cueAt, cueAtPoint } from '../audio/cue';
import { SWISH_PEAK, type SfxName } from '../audio/sfx';
import { findObject } from '../director/names';

/** How far a character turns its head to someone talking (meters). */
const HEED_RANGE = 8;
/** Head turn ease per second, in and out. */
const LOOK_EASE = 4;
/** A give or take, as shares of its `POSE_SECONDS`: the hand is out by `REACH_OUT`, held there until `REACH_HOLD`, back at the end. */
const REACH_OUT = 0.28;
const REACH_HOLD = 0.56;
/**
 * Taking a thing, as fractions of height: below `TAKE_LOW` the body bends for it (fully at the
 * floor), down by up to `TAKE_DROP` and forward by up to `TAKE_LEAN` radians; then the feet step in
 * (up to `TAKE_STEP` m) as far as the arm still falls short. The back turns up to `TAKE_TWIST` radians toward a thing off to the side.
 */
const TAKE_LOW = 0.55;
const TAKE_DROP = 0.32;
const TAKE_LEAN = 1.1;
const TAKE_STEP = 0.8;
const TAKE_TWIST = 0.8;
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
/** Draw length (anchor to bow hand) and the follow-through, as fractions of height. */
const SHOT_DRAW_LENGTH = 0.4;
const SHOT_FOLLOW_BACK = 0.04;
/** Arrows fly this fast (m/s). */
const ARROW_SPEED = 28;
/** Seconds an arrow that missed stays stuck in the ground where it fell. */
const ARROW_STUCK = 1.5;
/** The arrow each bow shoots. */
const ARROWS:Record<string, string> = { short_bow: 'ShamanArrow', bone_bow: 'SkeletalArrow' };

const UP = new THREE.Vector3(0, 1, 0);

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

/** Sword moves by verb. A guard (`block`) holds as long as {@link CharacterPose.guard} says. */
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
/**
 * A dodge: the body snaps aside as the blow or shot arrives, holds, drifts a little further and eases
 * back. It starts up to `DODGE_LEAD` s before the blow; the sidestep and drop are shares of the
 * body's height, the lean (back, away from the attacker) and twist in radians.
 */
const DODGE:MoveTiming = { sink: 0, snap: 0.07, hold: 0.14, carry: 0.15, follow: 0.12, settle: 0.4 };
const DODGE_LEAD = 0.16;
const DODGE_STEP = 0.24;
const DODGE_DROP = 0.07;
const DODGE_LEAN = 0.35;
const DODGE_TWIST = 0.45;
/** A held sword's own axes: the tip down its −Y, the flat facing its ±Z. */
const SWORD_TIP = new THREE.Vector3(0, -1, 0);
const SWORD_FLAT = new THREE.Vector3(0, 0, 1);

/**
 * Spells by verb: the effect each plays from the staff's head (or the casting hand), how fast it
 * flies to the target once loosed (m/s; none strikes at once), and how the right hand holds the staff
 * while the spell gathers: ahead of the shoulder (`out`) and above it (`up`, fractions of height),
 * the head pointing at the target and `rise` up (1 is 45°), or held high and upright for a heal.
 * Its sounds: gathering, as it is loosed (at the caster), and where it lands on a hit or a miss.
 */
const SPELLS:Record<string, { fx:(scene:THREE.Object3D, cast:Cast)=>void; speed?:number; out:number; up:number; rise:number; sound:SpellSounds }> = {
	hex: { fx: fireball, speed: FIREBALL_SPEED, out: 0.3, up: 0.05, rise: 0.4, sound: { gather: 'fireCast', loose: 'fireThrow', hit: 'fireHit', miss: 'fireHit' } },
	smite: { fx: lightning, out: 0.32, up: 0, rise: 0.2, sound: { gather: 'sparkCast', hit: 'thunder', miss: 'thunder' } },
	heal: { fx: healLight, out: 0.2, up: 0.2, rise: 3, sound: { gather: 'healCast', hit: 'healLand', miss: 'fizzle' } },
};
type SpellSounds = { gather:SfxName; loose?:SfxName; hit:SfxName; miss:SfxName };
/** Seconds the casting arm takes to come up (at most half the cast), holds on after the spell lands, and takes to go back down. */
const CAST_RAISE = 0.35;
const CAST_HOLD = 0.15;
const CAST_LOWER = 0.4;
/** A held staff's own axes: its head up its +Y, its side along ±X. */
const STAFF_HEAD = new THREE.Vector3(0, 1, 0);
const STAFF_SIDE = new THREE.Vector3(1, 0, 0);

/** `a` blended `u` of the way to `b`. */
function mixPose(a:SwordPose, b:SwordPose, u:number):SwordPose {
	const at = (x:number | undefined, y:number | undefined):number => (x ?? 0) + ((y ?? 0) - (x ?? 0)) * u;
	const mix = <T extends Record<string, number | undefined>>(x:T, y:T):T => Object.fromEntries([...new Set([...Object.keys(x), ...Object.keys(y)])].map((k) => [k, at(x[k], y[k])])) as T;
	return { hand: mix(a.hand, b.hand), blade: mix(a.blade, b.blade), body: mix(a.body, b.body), hands: at(a.hands, b.hands) };
}

/** Where a character stands, and how tall it is. */
function stanceOf(go:GameObject):Stance {
	return { feet: pointOn(go, 0), height: go.getComponent(Appearance)?.height ?? 1.7 };
}

/**
 * Where on a character to look at or hand things to: a height fraction of `Appearance`. A spot on
 * the ground stands in for someone of the usual height standing there.
 */
function pointOn(at:GameObject | THREE.Vector3, fraction:number):THREE.Vector3 {
	const p = at instanceof THREE.Vector3 ? at : at.transform.position;
	const height = at instanceof THREE.Vector3 ? 1.7 : at.getComponent(Appearance)?.height ?? 1.7;
	return new THREE.Vector3(p.x, p.y + height * fraction, p.z);
}

/**
 * A shot under way, at a character or at a spot on the ground (where its arrow lands); `outcome`
 * is how it turned out, once the attack says (see {@link CharacterPose.resolve}), and `firedAt`
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
type Swing = { move:SwordMove; t0:number; windUp:number; hold:number; target:GameObject | null; trailed:boolean; ghosted?:boolean };
/** A spell under way; `gathering` is its gathering sound, playing until it is settled. */
type Casting = { spell:(typeof SPELLS)[string]; t0:number; windUp:number; target:GameObject; outcome?:Outcome; gathering?:SfxHandle | null };
/** A dodge under way: its timing, the way the body goes (`aside`, level, unit) and the way it leans (`away` from the attacker). */
type Dodge = { t0:number; windUp:number; aside:THREE.Vector3; away:THREE.Vector3; ghosted:boolean };
type Flight = { arrow:THREE.Object3D; from:THREE.Vector3; to:THREE.Vector3; t0:number; seconds:number; hit:boolean };

/**
 * Touches on top of the clip, every frame after it plays: the head turns to whoever this character
 * deals with or hears talking, the right hand reaches out to give and take, archers draw and loose
 * their bows, swordsmen stab, slice and guard, and casters raise their staffs to cast.
 */
export class CharacterPose extends Component {
	public static override order = Order.present - 1;

	/** This character's own clock (s): game time that stands still through a hitstop, so its moves hold too. */
	private _now = 0;
	private _look = 0;
	private readonly _lookAt = new THREE.Vector3();
	private _shot:Shot | null = null;
	private _swing:Swing | null = null;
	private _dodge:Dodge | null = null;
	/** The sword along a two-handed clip's grip: from when, until when, and how much. */
	private _grip:{ t0:number; until:number; amount:number; blow:number; rest?:SwordPose['blade'] } | null = null;
	/** How far the bow is up (0 at the carry, 1 drawn); eased, so a shot never snaps. */
	private _raised = 0;
	private _flying:Flight[] = [];
	private _cast:Casting | null = null;
	/** Where the spell under way leaves from, as of the last pose (a staff's head). */
	private readonly _castFrom = new THREE.Vector3();
	/** Whether the model stands stepped in toward a thing it takes (its root moved), to undo after. */
	private _stepped = false;
	/** The take under way (its `Appearance.clipT0`) and the point it reaches for. */
	private _takeT0 = -1;
	private readonly _takeAt = new THREE.Vector3();

	/**
	 * Dodges a blow from `from` (world XZ) that misses, arriving `delay` s from now: a sidestep to a
	 * random side and a lean away, leaving a ghost where the body stood, with a whoosh.
	 */
	public dodge(from:{ x:number; z:number }, delay:number):void {
		const p = this.gameObject.transform.position;
		const away = new THREE.Vector3(p.x - from.x, 0, p.z - from.z);
		if (away.lengthSq() < 1e-6) {
			away.copy(this.ahead(-1));
		}
		away.normalize();
		const aside = new THREE.Vector3(-away.z, 0, away.x).multiplyScalar(Math.random() < 0.5 ? 1 : -1);
		const windUp = Math.max(DODGE.snap * 2, Math.min(delay, DODGE_LEAD));
		this._dodge = { t0: this._now + Math.max(0, delay - windUp), windUp, aside, away, ghosted: false };
	}

	/**
	 * Draws the held bow at `target` (a character, or a spot on the ground), loosing the arrow
	 * `windUp` seconds from now. A `held` draw stays drawn after that until {@link resolve}d.
	 * Without a bow it does nothing.
	 */
	public shoot(target:GameObject | THREE.Vector3, windUp:number, held = false):void {
		this.endShot();
		this._shot = { t0: this._now, windUp, target, held, arrow: null, loosed: false };
		if (this.gameObject.getComponent(HeldProps)?.prop('left')) {
			cueAt(this.gameObject.world, 'bowDraw', this.gameObject);
		}
	}

	/** Turns the shot being drawn on `target` instead; once loosed it is too late. */
	public aimShot(target:GameObject | THREE.Vector3):void {
		if (this._shot && !this._shot.loosed && this._shot.outcome === undefined) {
			this._shot.target = target;
		}
	}

	/**
	 * Plays the sword move for `verb` (at `target`) so the blow lands `windUp` seconds from now, and
	 * returns true. A strike that is a clip (a cleave) only gets its crescent here: false.
	 */
	public swing(verb:string, windUp:number, target:GameObject | null):boolean {
		const move = SWORD_MOVES[verb];
		if (!move) {
			return false;
		}
		this._swing = { move, t0: this._now, windUp, hold: move.hold, target, trailed: false };
		if (move.trail) {
			this.cueBefore(windUp, SWISH_PEAK, 'swish');
		}
		return true;
	}

	/**
	 * What a strike played as a clip adds (a cleave, its blow `windUp` s from now, the clip `seconds`
	 * long): its crescent, its dust, and the sword lying along both fists throughout.
	 */
	public clipStrike(verb:string, windUp:number, seconds:number):void {
		const strike = CLIP_STRIKES[verb];
		const world = this.gameObject.world;
		if (!strike || !world) {
			return;
		}
		world.after(Math.max(0, windUp - strike.lead), () => this.crescent(strike.from, strike.to));
		this.cueBefore(windUp, SWISH_PEAK, 'swishHeavy');
		if (strike.dust) {
			world.after(windUp, () => {
				this.groundDust();
				cueAt(world, 'groundCrack', this.gameObject);
			});
		}
		if (strike.hands) {
			this._grip = { t0: this._now, until: this._now + seconds, amount: strike.hands, blow: this._now + windUp, rest: strike.rest };
		}
	}

	/**
	 * Casts the spell for `verb` at `target` (this character, healing itself) so it lands `windUp`
	 * seconds from now, and returns true: the staff comes up and the spell plays from its head. Any
	 * other verb does nothing: false.
	 */
	public cast(verb:string, windUp:number, target:GameObject):boolean {
		const spell = SPELLS[verb];
		const world = this.gameObject.world;
		if (!spell || !world) {
			return false;
		}
		const go = this.gameObject;
		const alive = ():boolean => (go.getComponent(Vitals)?.hp ?? 1) > 0;
		const casting:Casting = { spell, t0: this._now, windUp, target };
		// One spell at a time: one still unsettled is cut short, and its effect goes.
		if (this._cast) {
			this._cast.outcome ??= 'cut';
			this._cast.gathering?.stop();
		}
		this._cast = casting;
		this._castFrom.copy(this.castFrom());
		// Its gathering sound runs the whole cast, and stops as it is loosed or cut short.
		casting.gathering = cueAt(world, spell.sound.gather, go, undefined, windUp + RELEASE_GRACE);
		spell.fx(world.native, {
			from: () => (alive() ? this._castFrom.clone() : null),
			caster: () => (alive() ? stanceOf(go) : null),
			target: () => stanceOf(target),
			seconds: windUp,
			outcome: () => casting.outcome,
		});
		return true;
	}

	/**
	 * How the shot or spell under way turned out, told as its blow is settled: it flies at the
	 * target on a hit (or a block), wide of it on a miss, and not at all when cut short (the bow
	 * lowers, the spell dies out). Untold, it counts as cut once its wind-up is over by
	 * {@link RELEASE_GRACE}.
	 */
	public resolve(outcome:Outcome):void {
		const shot = this._shot;
		if (shot && !shot.loosed && shot.outcome === undefined) {
			this.cueShot(shot.target, outcome);
			shot.outcome = outcome;
			shot.firedAt = this._now - shot.t0;
		}
		const cast = this._cast;
		if (cast && cast.outcome === undefined) {
			cast.gathering?.stop();
			this.cueSpell(cast, outcome);
			cast.outcome = outcome;
		}
	}

	/** Plays `name` here `lead` s before a blow due in `windUp` s (at once if that is already past). */
	private cueBefore(windUp:number, lead:number, name:SfxName):void {
		const world = this.gameObject.world;
		world?.after(Math.max(0, windUp - lead), () => cueAt(world, name, this.gameObject));
	}

	/** A shot loosed (or not): the bow's twang now, then the arrow striking `target` or the ground by them once it gets there. */
	private cueShot(target:GameObject | THREE.Vector3, outcome:Outcome):void {
		const world = this.gameObject.world;
		if (!world || outcome === 'cut') {
			return;
		}
		cueAt(world, 'bowRelease', this.gameObject);
		world.after(this.flightTime(), () => cueAtPoint(world, outcome === 'hit' ? 'arrowHit' : 'arrowMiss', pointOn(target, 0.5)));
	}

	/** A spell loosed (or cut short): its sound as it goes, then where it lands once it gets there; a fizzle when cut. */
	private cueSpell(cast:Casting, outcome:Outcome):void {
		const world = this.gameObject.world;
		if (!world) {
			return;
		}
		const sound = cast.spell.sound;
		if (outcome === 'cut') {
			cueAt(world, 'fizzle', this.gameObject);
			return;
		}
		if (sound.loose) {
			cueAt(world, sound.loose, this.gameObject);
		}
		world.after(this.flightTime(), () => cueAtPoint(world, outcome === 'hit' ? sound.hit : sound.miss, pointOn(cast.target, 0.5)));
	}

	/** Seconds the shot or spell under way will take to reach its target once loosed: 0 for a blow, a bolt or a heal. */
	public flightTime():number {
		const from = pointOn(this.gameObject, 0.6);
		const shot = this._shot;
		if (shot && !shot.loosed) {
			return from.distanceTo(pointOn(shot.target, 0.6)) / ARROW_SPEED;
		}
		const speed = this._cast?.spell.speed;
		return this._cast && speed ? from.distanceTo(pointOn(this._cast.target, 0.55)) / speed : 0;
	}

	/** Raises the guard for `seconds`; 0 lowers it now. */
	public guard(seconds:number):void {
		const swing = this._swing;
		if (seconds > 0) {
			this._swing = { move: SWORD_MOVES.block!, t0: this._now, windUp: GUARD_RAISE, hold: Math.max(0, seconds - GUARD_RAISE), target: null, trailed: true };
		}
		else if (swing?.move === SWORD_MOVES.block) {
			swing.hold = Math.min(swing.hold, Math.max(0, this._now - swing.t0 - swing.windUp));
		}
	}

	public override lateUpdate(dt:number):void {
		this._now += dt;
		const root = this.gameObject.getComponent(MeshRenderer)?.mesh;
		if (!root) {
			return;
		}
		const alive = (this.gameObject.getComponent(Vitals)?.hp ?? 1) > 0;
		// Body first, then arms, then the head, so the head still turns to the target after the stance.
		this.updateShot(root, alive, dt);
		// Reach first: it puts back a step it took, which a lunge then takes again.
		if (alive) {
			this.updateReach(root);
		}
		this.updateSwing(root, alive);
		this.updateDodge(root, alive);
		this.updateGrip(root, alive);
		this.updateCast(root, alive);
		this.updateLook(root, alive ? this.lookTarget() : null, dt);
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
		if (this._swing?.target?.world === world) {
			return pointOn(this._swing.target, 0.8);
		}
		const toward = go.getComponent(Appearance)?.clipToward;
		if (toward?.world === world) {
			return pointOn(toward, 0.9);
		}
		const npc = go.getComponent(NPCInput);
		const peer = npc?.faceName && Time.time < npc.faceUntil ? findObject(world, npc.faceName) : null;
		if (peer && peer !== go) {
			return pointOn(peer, 0.9);
		}
		let best:GameObject | null = null;
		let bestD = HEED_RANGE;
		world.forEachComponent(SpeechBubble, (bubble, other) => {
			if (other === go || Time.time > bubble.until) {
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

	/** Giving or taking: out, hold, back, toward the other person's hands or the thing picked up. */
	private updateReach(root:THREE.Object3D):void {
		const look = this.gameObject.getComponent(Appearance);
		if (!look || (look.clip !== 'give' && look.clip !== 'take')) {
			this.step(root, null);
			return;
		}
		const u = (Time.time - look.clipT0) / POSE_SECONDS[look.clip];
		const weight = u < REACH_OUT
			? THREE.MathUtils.smoothstep(u, 0, REACH_OUT)
			: 1 - THREE.MathUtils.smoothstep(u, REACH_HOLD, 1);
		const other = look.clipToward;
		if (other?.getComponent(Appearance)) {
			// Hands meet halfway.
			reach(root, 'right', pointOn(this.gameObject, 0.6).lerp(pointOn(other, 0.6), 0.5), weight);
			return;
		}
		// Where the thing was when the take began: picking it up takes it out of the world.
		if (this._takeT0 !== look.clipT0) {
			this._takeT0 = look.clipT0;
			const thing = other?.getComponent(MeshRenderer)?.mesh;
			this._takeAt.copy(thing ? topOf(thing) : pointOn(this.gameObject, 0.6).add(this.ahead(0.5)));
		}
		this.takeFrom(root, this._takeAt, weight);
	}

	/**
	 * Reaches for a thing the way a body can: bends down for it if it is low, turns the back toward it,
	 * steps in if it is still too far, then reaches with the nearer hand.
	 */
	private takeFrom(root:THREE.Object3D, target:THREE.Vector3, weight:number):void {
		const go = this.gameObject;
		const height = go.getComponent(Appearance)?.height ?? 1.7;
		const p = go.transform.position;
		const ahead = this.ahead(1);
		const to = new THREE.Vector3(target.x - p.x, 0, target.z - p.z);
		const away = to.length();
		// Positive when the thing is to the left.
		const side = away > 1e-3 ? Math.atan2(ahead.x * to.z - ahead.z * to.x, ahead.x * to.x + ahead.z * to.z) * -1 : 0;
		const low = THREE.MathUtils.clamp((TAKE_LOW * height - (target.y - p.y)) / (TAKE_LOW * height), 0, 1);
		const hand:Hand = side > 0.4 ? 'left' : 'right';
		this.step(root, null);
		crouch(root, { drop: low * TAKE_DROP * height, lean: low * TAKE_LEAN, twist: THREE.MathUtils.clamp(side, -TAKE_TWIST, TAKE_TWIST) }, weight);
		// Step in as far as the bent body's arm still falls short.
		const stepIn = away > 1e-3 ? Math.min(TAKE_STEP, shortfall(root, hand, target, to.clone().normalize())) : 0;
		if (stepIn > 0) {
			this.step(root, to.normalize().multiplyScalar(stepIn * weight));
		}
		reach(root, hand, target, weight);
	}

	/** Shifts the model `offset` (world, flat) from where the character stands; `null` puts it back. */
	private step(root:THREE.Object3D, offset:THREE.Vector3 | null):void {
		if (!offset) {
			if (this._stepped) {
				root.position.set(0, 0, 0);
				this._stepped = false;
			}
			return;
		}
		const parent = root.parent;
		if (!parent) {
			return;
		}
		parent.updateMatrixWorld(true);
		const at = parent.getWorldPosition(new THREE.Vector3()).add(offset);
		root.position.copy(parent.worldToLocal(at));
		root.updateMatrixWorld(true);
		this._stepped = true;
	}

	/** `meters` ahead of where the character faces, flat. */
	private ahead(meters:number):THREE.Vector3 {
		const yaw = this.gameObject.transform.yaw;
		return new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)).multiplyScalar(meters);
	}

	/**
	 * Side-on, the bow comes up drawn along the line from the jaw to the target, holds, looses (the
	 * string hand following through), and settles back.
	 */
	private updateShot(root:THREE.Object3D, alive:boolean, dt:number):void {
		const shot = this._shot;
		const bow = this.gameObject.getComponent(HeldProps)?.prop('left');
		if (!shot || !bow) {
			if (bow) {
				raiseBow(bow, null, 0);
				drawBow(bow, null);
			}
			this._raised = 0;
			this.endShot();
			return;
		}
		const t = this._now - shot.t0;
		// Cut short (or never told, unless held), the bow lowers with the arrow unloosed.
		const cut = !shot.loosed && (shot.outcome === 'cut' || (shot.outcome === undefined && !shot.held && t >= shot.windUp + RELEASE_GRACE));
		const loosed = shot.loosed || shot.outcome === 'hit' || shot.outcome === 'miss';
		const fired = shot.firedAt ?? shot.windUp;
		const up = alive && !cut && (!loosed || t < fired + SHOT_FOLLOW);
		this._raised = up
			? Math.min(1, this._raised + dt / Math.min(SHOT_DRAW, shot.windUp / 2))
			: Math.max(0, this._raised - dt / SHOT_RECOVER);
		if (!up && this._raised <= 0) {
			raiseBow(bow, null, 0);
			drawBow(bow, null);
			this.endShot();
			return;
		}
		const weight = THREE.MathUtils.smoothstep(this._raised, 0, 1);
		const height = this.gameObject.getComponent(Appearance)?.height ?? 1.7;
		crouch(root, { turn: -SHOT_SIDE_ON }, weight);

		// The arrow's line: from the anchor by the jaw to the target.
		const head = humanBone(root, 'head');
		if (!head) {
			return;
		}
		root.updateMatrixWorld(true);
		const toward = pointOn(shot.target, 0.6);
		const flat = toward.clone().sub(pointOn(this.gameObject, 0)).setY(0).normalize();
		const right = new THREE.Vector3().crossVectors(flat, UP);
		const anchor = head.getWorldPosition(new THREE.Vector3()).addScaledVector(right, 0.035 * height).addScaledVector(flat, 0.02 * height);
		const aim = toward.clone().sub(anchor).normalize();
		const grip = anchor.clone().addScaledVector(aim, SHOT_DRAW_LENGTH * height);
		const follow = loosed ? THREE.MathUtils.smoothstep(t, fired, fired + SHOT_FOLLOW) : 0;
		const hand = anchor.clone().addScaledVector(aim, -SHOT_FOLLOW_BACK * height * follow);

		// Bow arm straight along the line, elbow turned down, the fist closed upright round the handle
		// (thumb up, palm in). The string hand at the anchor, its elbow back, a little low and out so
		// the forearm clears the face, its palm toward the cheek.
		reach(root, 'left', grip, weight, new THREE.Vector3(0, -1, 0));
		orientHand(root, 'left', aim, right, weight);
		reach(root, 'right', hand, weight, aim.clone().negate().addScaledVector(UP, -0.15).addScaledVector(right, 0.5));
		orientHand(root, 'right', aim, right.clone().negate(), weight);
		// Fingers hooked on the string while drawn, opening as it goes.
		closeHand(root, 'right', 0.6 * weight * (1 - follow));
		raiseBow(bow, flat, weight);
		const fingers = humanBone(root, 'rightMiddleProximal');
		const nock = !loosed && !cut && weight > 0.05 && fingers ? fingers.getWorldPosition(new THREE.Vector3()) : null;
		drawBow(bow, nock);
		this.nockArrow(shot, bow, nock);
		if (loosed && !shot.loosed) {
			shot.loosed = true;
			this.loose(shot, bow);
		}
	}

	/** The casting arm while a spell gathers: the hand ahead of the shoulder, the staff's head toward the target (or high). */
	private updateCast(root:THREE.Object3D, alive:boolean):void {
		const cast = this._cast;
		if (!cast) {
			return;
		}
		const t = this._now - cast.t0;
		const end = cast.windUp + CAST_HOLD;
		if (!alive || t > end + CAST_LOWER) {
			cast.gathering?.stop();
			this._cast = null;
			return;
		}
		const shoulder = humanBone(root, 'rightUpperArm');
		if (!shoulder) {
			return;
		}
		const go = this.gameObject;
		const height = go.getComponent(Appearance)?.height ?? 1.7;
		const weight = Math.min(
			ease.inOutSine(Math.min(1, t / Math.min(CAST_RAISE, cast.windUp / 2))),
			1 - ease.inOutSine(THREE.MathUtils.clamp((t - end) / CAST_LOWER, 0, 1)),
		);
		const toward = pointOn(cast.target, 0).sub(pointOn(go, 0)).setY(0);
		const ahead = toward.lengthSq() > 0.01 ? toward.normalize() : this.ahead(1);
		const right = new THREE.Vector3().crossVectors(ahead, UP);
		const { spell } = cast;
		root.updateMatrixWorld(true);
		const hand = shoulder.getWorldPosition(new THREE.Vector3()).addScaledVector(ahead, spell.out * height).addScaledVector(UP, spell.up * height);
		reach(root, 'right', hand, weight, UP.clone().negate().addScaledVector(right, 0.6));
		const staff = go.getComponent(HeldProps)?.prop('right');
		if (staff) {
			aimHeld(root, 'right', staff, STAFF_HEAD, STAFF_SIDE, ahead.clone().addScaledVector(UP, spell.rise).normalize(), right, weight);
		}
		this._castFrom.copy(this.castFrom());
	}

	/** Where a spell leaves from: the head of the staff in the right hand, or the hand itself. */
	private castFrom():THREE.Vector3 {
		const root = this.gameObject.getComponent(MeshRenderer)?.mesh;
		return this.gameObject.getComponent(HeldProps)?.tip('right')
			?? (root && palmOf(root, 'right'))
			?? pointOn(this.gameObject, 0.6);
	}

	/** A sword move under way: the body, the sword arm, and the blade's aim, eased in and out of the clip. */
	private updateSwing(root:THREE.Object3D, alive:boolean):void {
		const swing = this._swing;
		if (!swing) {
			return;
		}
		const sword = swing.move;
		const { phase, u, weight } = move({ ...sword, hold: swing.hold }, swing.windUp, this._now - swing.t0);
		if (!alive || phase === 'done') {
			this._swing = null;
			return;
		}
		// A crescent is laid out as the strike begins, as far as the swing will carry; a thrust's wind
		// leaves the blade where it lands.
		if (!swing.trailed && sword.trail === 'crescent' && phase !== 'anticipate') {
			swing.trailed = true;
			this.crescent(mixPose(sword.ready, sword.strike, -sword.sink), mixPose(sword.ready, sword.strike, 1 + sword.carry));
		}
		const pose = mixPose(sword.ready, sword.strike, u);
		const height = this.gameObject.getComponent(Appearance)?.height ?? 1.7;
		const { hand, m, ahead, right } = this.swordFrame();
		crouch(root, { twist: -m * pose.body.twist, lean: pose.body.lean, drop: pose.body.drop * height }, weight);
		this.lunge(root, hand, pose, weight);
		// The elbow down and out, a little back.
		reach(root, hand, this.handAt(pose), weight, UP.clone().negate().addScaledVector(right, 0.6 * m).addScaledVector(ahead, -0.3));
		const blade = this.gameObject.getComponent(HeldProps)?.prop(hand);
		if (blade) {
			aimHeld(root, hand, blade, SWORD_TIP, SWORD_FLAT, this.bladeDir(pose), UP, weight);
			this.secondHand(root, hand, blade, (pose.hands ?? 0) * weight);
			if (!swing.trailed && sword.trail === 'thrust' && phase !== 'anticipate' && phase !== 'strike') {
				swing.trailed = true;
				this.thrust(root, hand, blade, swing.target);
			}
		}
		// A lunge leaves a ghost of the body where the strike began.
		if (!swing.ghosted && sword.trail === 'thrust' && phase !== 'anticipate') {
			swing.ghosted = true;
			const world = this.gameObject.world;
			if (world) {
				lungeGhost(world.native, root);
			}
		}
	}

	/** A dodge under way: the body stepped aside, dropped a little, leaning back from the blow and turning off it. */
	private updateDodge(root:THREE.Object3D, alive:boolean):void {
		const dodge = this._dodge;
		if (!dodge) {
			return;
		}
		const t = this._now - dodge.t0;
		if (t < 0) {
			return;
		}
		const { phase, u, weight } = move(DODGE, dodge.windUp, t);
		if (!alive || phase === 'done') {
			this._dodge = null;
			if (!alive) {
				this.step(root, null);
			}
			return;
		}
		const world = this.gameObject.world;
		// As it snaps aside: a ghost of the body where it stood, and the whoosh of it going.
		if (!dodge.ghosted && phase !== 'anticipate' && world) {
			dodge.ghosted = true;
			lungeGhost(world.native, root);
			cueAt(world, 'swish', this.gameObject);
		}
		const height = this.gameObject.getComponent(Appearance)?.height ?? 1.7;
		const ahead = this.ahead(1);
		// Lean back from a blow in front, forward from one behind; twist toward the side it goes.
		const facing = -ahead.dot(dodge.away);
		const right = new THREE.Vector3().crossVectors(ahead, UP);
		const twist = DODGE_TWIST * Math.sign(right.dot(dodge.aside) || 1);
		const amount = u * weight;
		crouch(root, { lean: -DODGE_LEAN * facing * u, drop: DODGE_DROP * height * u, twist: twist * u }, weight);
		this.step(root, dodge.aside.clone().multiplyScalar(DODGE_STEP * height * amount));
	}

	/**
	 * The legs of a lunge: the body carried `pose.body.lunge` forward, the back foot staying where it
	 * stood (its leg straightening behind) and the sword-side foot stepping `pose.body.stride` ahead,
	 * its knee bent forward.
	 */
	private lunge(root:THREE.Object3D, hand:Hand, pose:SwordPose, weight:number):void {
		const height = this.gameObject.getComponent(Appearance)?.height ?? 1.7;
		const lunge = (pose.body.lunge ?? 0) * height;
		const stride = (pose.body.stride ?? 0) * height;
		const front = humanBone(root, `${hand}Foot`);
		const back:Hand = hand === 'right' ? 'left' : 'right';
		const rear = humanBone(root, `${back}Foot`);
		if (!front || !rear || (Math.abs(lunge) < 1e-4 && Math.abs(stride) < 1e-4)) {
			return;
		}
		const ahead = this.ahead(1);
		root.updateMatrixWorld(true);
		const frontAt = front.getWorldPosition(new THREE.Vector3()).addScaledVector(ahead, stride);
		const rearAt = rear.getWorldPosition(new THREE.Vector3());
		this.step(root, ahead.clone().multiplyScalar(lunge * weight));
		const down = UP.clone().negate();
		placeFoot(root, hand, frontAt, weight, ahead.clone().addScaledVector(down, 0.3));
		placeFoot(root, back, rearAt, weight, ahead.clone().multiplyScalar(0.4).add(down));
	}

	/**
	 * Through a two-handed clip strike, the sword turned to lie along the grip the clip's fists hold:
	 * from the sword fist through the other fist and on out, edge leading, easing on and off; after the
	 * blow it turns to the strike's rest instead.
	 */
	private updateGrip(root:THREE.Object3D, alive:boolean):void {
		const grip = this._grip;
		const t = this._now;
		if (!grip || !alive || t >= grip.until) {
			this._grip = null;
			return;
		}
		const { hand, right } = this.swordFrame();
		const other:Hand = hand === 'right' ? 'left' : 'right';
		const sword = this.gameObject.getComponent(HeldProps)?.prop(hand);
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
			aim.lerp(this.bearingDir(grip.rest.bearing, grip.rest.rise), THREE.MathUtils.smoothstep(t, grip.blow, grip.blow + REST_EASE)).normalize();
		}
		aimHeld(root, hand, sword, SWORD_TIP, SWORD_FLAT, aim, right, grip.amount * on);
		// The clip's off hand only comes near; close it on the hilt.
		this.secondHand(root, hand, sword, grip.amount * on);
	}

	/** Dust thrown up from the ground under the blade where it is now, all along it (a cleave come down). */
	private groundDust():void {
		const world = this.gameObject.world;
		const root = this.gameObject.getComponent(MeshRenderer)?.mesh;
		const { hand } = this.swordFrame();
		const sword = this.gameObject.getComponent(HeldProps)?.prop(hand);
		const fist = root && humanBone(root, `${hand}Hand`);
		if (!world || !root || !sword || !fist) {
			return;
		}
		root.updateMatrixWorld(true);
		const dir = SWORD_TIP.clone().applyQuaternion(sword.getWorldQuaternion(new THREE.Quaternion()));
		const hilt = fist.getWorldPosition(new THREE.Vector3());
		const ground = this.gameObject.transform.position.y;
		const a = hilt.clone().addScaledVector(dir, TRAIL_NEAR).setY(ground);
		const b = hilt.clone().addScaledVector(dir, BLADE_REACH).setY(ground);
		dustLine(world.native, a, b);
	}

	/**
	 * Closes the other hand on `sword`'s hilt, `amount` of the way (0–1): its palm on the blade's own
	 * line a hand's width toward the guard from the sword hand's, the fingers shut round it.
	 */
	private secondHand(root:THREE.Object3D, hand:Hand, sword:THREE.Object3D, amount:number):void {
		const other:Hand = hand === 'right' ? 'left' : 'right';
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
		const outward = new THREE.Vector3().crossVectors(this.ahead(1), UP).multiplyScalar(hand === 'right' ? -1 : 1);
		reach(root, other, wrist, amount, UP.clone().negate().addScaledVector(outward, 0.5));
		closeHand(root, other, amount);
	}

	/** The sword hand (poses are for the right, mirrored for a sword in the left) and the body's frame, flat. */
	private swordFrame():{ hand:Hand; m:number; ahead:THREE.Vector3; right:THREE.Vector3 } {
		const held = this.gameObject.getComponent(HeldProps);
		const hand:Hand = !held?.prop('right') && held?.prop('left') ? 'left' : 'right';
		const ahead = this.ahead(1);
		return { hand, m: hand === 'right' ? 1 : -1, ahead, right: new THREE.Vector3().crossVectors(ahead, UP) };
	}

	/** A world direction at `bearing` (right of ahead, mirrored for the left hand) and `rise` above level. */
	private bearingDir(bearing:number, rise:number):THREE.Vector3 {
		const { m, ahead, right } = this.swordFrame();
		return ahead.multiplyScalar(Math.cos(m * bearing) * Math.cos(rise))
			.addScaledVector(right, Math.sin(m * bearing) * Math.cos(rise)).addScaledVector(UP, Math.sin(rise));
	}

	/** Where `pose` puts the sword hand (world). */
	private handAt(pose:SwordPose):THREE.Vector3 {
		const height = this.gameObject.getComponent(Appearance)?.height ?? 1.7;
		return pointOn(this.gameObject, pose.hand.up).addScaledVector(this.bearingDir(pose.hand.bearing, 0), pose.hand.out * height);
	}

	/** Which way `pose` points the blade (world). */
	private bladeDir(pose:SwordPose):THREE.Vector3 {
		return this.bearingDir(pose.blade.bearing, pose.blade.rise);
	}

	/** The white crescent the blade cuts on its way from pose `from` to pose `to`. */
	private crescent(from:SwordPose, to:SwordPose):void {
		const scene = this.gameObject.world?.native;
		if (!scene) {
			return;
		}
		const inner:THREE.Vector3[] = [];
		const outer:THREE.Vector3[] = [];
		for (let i = 0; i <= TRAIL_STEPS; i++) {
			const pose = mixPose(from, to, i / TRAIL_STEPS);
			const at = this.handAt(pose);
			const dir = this.bladeDir(pose);
			inner.push(at.clone().addScaledVector(dir, TRAIL_NEAR));
			outer.push(at.addScaledVector(dir, TRAIL_FAR));
		}
		slashTrail(scene, inner, outer);
	}

	/**
	 * As a thrust lands: a lance of light driven from `sword`'s blade into whoever it is aimed at (or
	 * a little past the tip), and dust kicked up behind the feet.
	 */
	private thrust(root:THREE.Object3D, hand:Hand, sword:THREE.Object3D, target:GameObject | null):void {
		const world = this.gameObject.world;
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
		const behind = this.ahead(-1);
		dustKick(world.native, pointOn(this.gameObject, 0).addScaledVector(behind, DUST_BEHIND), behind);
	}

	/** Keeps the arrow on the string while drawn, pointing past the grip. */
	private nockArrow(shot:Shot, bow:THREE.Object3D, nock:THREE.Vector3 | null):void {
		const grip = bow.getObjectByName('Grip');
		const defID = this.gameObject.getComponent(HeldProps)?.defID('left');
		if (!shot.arrow && nock && grip && defID && ARROWS[defID]) {
			shot.arrow = create(ARROWS[defID]) ?? null;
			const world = this.gameObject.world;
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
			if (u >= 1 && !f.hit && u * f.seconds < f.seconds + ARROW_STUCK) {
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

	private endShot():void {
		this._shot?.arrow?.removeFromParent();
		this._shot = null;
	}
}

/**
 * Turns a held bow about its grip, `weight` of the way from how it hangs now (`HeldProps` sets that
 * each frame) to upright with its string toward the archer and its back toward `ahead` (flat,
 * world). Both ends stand upright, so the bow never swings flat on the way. `null` leaves it hanging.
 */
function raiseBow(bow:THREE.Object3D, ahead:THREE.Vector3 | null, weight:number):void {
	if (!ahead || weight <= 0) {
		return;
	}
	const back = ahead.clone().negate();
	const upright = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(back, UP, new THREE.Vector3().crossVectors(back, UP)));
	turnAboutGrip(bow, bow.getWorldQuaternion(new THREE.Quaternion()).slerp(upright, weight));
}

function shortfall(root:THREE.Object3D, hand:Hand, target:THREE.Vector3, toward:THREE.Vector3):number {
	const [shoulder, elbow, wrist, knuckle] = ['UpperArm', 'LowerArm', 'Hand', 'MiddleProximal'].map((b) => humanBone(root, `${hand}${b}`));
	if (!shoulder || !elbow || !wrist) {
		return 0;
	}
	root.updateMatrixWorld(true);
	const at = (bone:THREE.Object3D):THREE.Vector3 => bone.getWorldPosition(new THREE.Vector3());
	const arm = 0.97 * (at(shoulder).distanceTo(at(elbow)) + at(elbow).distanceTo(at(wrist)) + (knuckle ? at(wrist).distanceTo(at(knuckle)) : 0));
	const d = target.clone().sub(at(shoulder));
	if (d.length() <= arm) {
		return 0;
	}
	// The least s with |d − s·toward| = arm; the nearest pass when the arm can never get there.
	const along = d.dot(toward);
	const gap = along * along - d.lengthSq() + arm * arm;
	return Math.max(0, gap >= 0 ? along - Math.sqrt(gap) : along);
}

/** The middle of a thing's top, where a hand takes it (into an open chest, off the floor). */
function topOf(thing:THREE.Object3D):THREE.Vector3 {
	// Not an open lid standing up over it.
	const box = new THREE.Box3();
	thing.traverse((part) => {
		if ((part as THREE.Mesh).isMesh && part.name !== 'lid' && part.parent?.name !== 'lid') {
			box.expandByObject(part, true);
		}
	});
	const at = box.getCenter(new THREE.Vector3());
	at.y = box.max.y - Math.min(0.08, (box.max.y - box.min.y) * 0.3);
	return at;
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
