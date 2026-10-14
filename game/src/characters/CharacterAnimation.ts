import { Animator, Component, MeshRenderer, Time, toonClip, type GameObject } from '@arc-director/kindling';
import * as THREE from 'three';
import { Appearance, Celebrating, HurtFlash, RigidBody, SpeechBubble, Vitals } from '../engine/components';
import { Order } from '../engine/order';
import { characterModel } from '../render/characterModels';
import { CharacterPose } from './CharacterPose';
import { HeldProps } from './HeldProps';

/**
 * Speed (m/s) at which `walk` plays at rate 1. Playback rate is `speed / WALK_PACE`, so a smaller
 * pace plays the walk faster. Footsteps use the same number: see {@link WALK_STRIDE}.
 */
export const WALK_PACE = 1.2;
/**
 * Meters between foot plants. `walk` is 7/3 s and plants four times, so one plant every 7/12 s at
 * rate 1; the gap is that time times {@link WALK_PACE}. The first plant of a fresh clip is halfway.
 */
export const WALK_STRIDE = (7 / 12) * WALK_PACE;
/** Standing clips: each plays through once, then another, picked at random, fades in. Hands stay free of the body, so held gear does not clip. */
const IDLES = ['standing_relax', 'look_around'];
/** Feminine models also stand legs together (`idle`) and, with nothing in hand, hands on hips. */
const HANDS_ON_HIPS = 'wait';
const FEMININE_IDLES = [...IDLES, 'idle', HANDS_ON_HIPS];

/** Ways to drop dead, one picked at random per death; each ends lying down and holds there. */
const DEATHS = ['fall', 'defeat_03'];

/** Blinks per second while hurt, and the two reds it blinks between: [color, glow]. */
const HURT_BLINK = 14;
const HURT_REDS:[number, number][] = [[0xff3020, 0x5a0800], [0xff8a6a, 0x2a0400]];
/** Red copies of each material, one per blink step, shared by every hurt character. */
const hurtMaterials = new Map<THREE.Material, THREE.Material[]>();

function hurtMaterial(base:THREE.Material, step:number):THREE.Material {
	let reds = hurtMaterials.get(base);
	if (!reds) {
		reds = HURT_REDS.map(([color, glow]) => {
			const red = base.clone() as THREE.MeshToonMaterial;
			red.color?.setHex(color);
			red.emissive?.setHex(glow);
			return red;
		});
		hurtMaterials.set(base, reds);
	}
	return reds[step % reds.length]!;
}

/** Blinks a model red while hurt (`step` ≥ 0), or restores its own materials (`step` < 0). */
function paintHurt(root:THREE.Object3D, step:number):void {
	root.traverse((obj) => {
		const mesh = obj as THREE.Mesh;
		if (!mesh.isMesh) {
			return;
		}
		const base = (mesh.userData.baseMaterial ??= mesh.material) as THREE.Material;
		mesh.material = step < 0 ? base : hurtMaterial(base, step);
	});
}

/**
 * Attack verbs with a move: the clip, where in it to start and stop (seconds), and the moment the
 * blow lands, which is timed to the end of the attack's wind-up.
 */
const STRIKES:Record<string, { clip:string; from:number; hit:number; to:number }> = {
	// Heavy knights: the two-handed chop (Tripo's `slash` is the same clip).
	cleave: { clip: 'chop', from: 0.7, hit: 2.05, to: 3.4 },
};

/** A hand gesture over the clip when a line starts: a wave for greetings, else a hand held out. */
const GREETING = /^\W*(hello|hi|hey|greetings|well met|good (morning|day|evening)|welcome)\b/i;
const GESTURES = {
	greet: { clip: 'greet_01', from: 0, to: 2 },
	talk: { clip: 'agree', from: 0, to: 2.4 },
};

/**
 * Picks the 3D character's clip from what it is doing: down (one of {@link DEATHS}), hurt, moving, or standing (one of
 * {@link IDLES} after another). Moving plays `walk` at a rate that follows speed (about 2.8× at
 * full speed); a new line of speech adds a
 * gesture, an attack its move. Giving, taking and looking are {@link CharacterPose}'s.
 */
export class CharacterAnimation extends Component {
	public static override order = Order.hurt + 1;

	/** Whether the model wears the hurt reds now. */
	private _painted = false;
	/** When the line last gestured at began (`SpeechBubble.timestamp`). */
	private _gestured = 0;
	/** The standing clip, and when (`Time.time`) it has played through; 0 while not standing. */
	private _idle = '';
	private _idleUntil = 0;
	/** How this character fell, while dead; '' while alive. */
	private _death = '';

	/**
	 * Starts the move for fight `verb` so it lands `windUp` seconds from now: a clip, a bow drawn at
	 * `target` for `shoot`, a sword move (stab, slice), or a spell cast at `target` (hex, smite,
	 * heal). Verbs without one do nothing.
	 */
	public strike(verb:string, windUp:number, target?:GameObject):void {
		const pose = this.gameObject.getComponent(CharacterPose);
		if (verb === 'shoot' && target) {
			pose?.shoot(target, windUp);
			return;
		}
		if (pose?.swing(verb, windUp, target ?? null) || (target && pose?.cast(verb, windUp, target))) {
			return;
		}
		const move = STRIKES[verb];
		if (!move) {
			return;
		}
		const rate = (move.hit - move.from) / Math.max(windUp, 0.1);
		this.gameObject.getComponent(Animator)?.playOnce(move.clip, { from: move.from, to: move.to, rate });
		pose?.clipStrike(verb, windUp, (move.to - move.from) / rate);
	}

	public override update(dt:number):void {
		const animator = this.gameObject.getComponent(Animator);
		if (!animator) {
			return;
		}
		const rb = this.gameObject.getComponent(RigidBody);
		const speed = rb?.speed ?? 0;
		const pose = this.gameObject.getComponent(Appearance)?.clip ?? 'auto';
		const hurt = this.gameObject.getComponent(HurtFlash)?.active === true;
		const root = this.gameObject.getComponent(MeshRenderer)?.mesh;
		if (root && (hurt || this._painted)) {
			paintHurt(root, hurt ? Math.floor(Time.time * HURT_BLINK) : -1);
			this._painted = hurt;
		}
		let clip = '';
		let loop = true;
		let rate = 1;
		const dead = (this.gameObject.getComponent(Vitals)?.hp ?? 1) <= 0;
		this._death = dead ? this._death || DEATHS[Math.floor(Math.random() * DEATHS.length)]! : '';
		if (dead) {
			clip = this._death;
			loop = false;
		}
		else if (hurt) {
			clip = 'hit_to_body_01';
			loop = false;
		}
		else if (this.gameObject.getComponent(Celebrating)?.enabled) {
			clip = this.gameObject.getComponent(Celebrating)!.style;
		}
		else if (rb?.walking || pose === 'walk') {
			clip = 'walk';
			rate = Math.max(speed, 1) / WALK_PACE;
		}
		const standing = !clip;
		animator.loop = loop;
		animator.clip = standing ? this.idle(root) : clip;
		animator.speed = rate;
		if (!standing) {
			this._idleUntil = 0;
		}
		this.gesture(animator, standing);
	}

	/**
	 * The standing clip: a fresh pick from {@link IDLES} on standing still, and each time the last one
	 * has played through (or at once when hands on hips would put them through something held).
	 */
	private idle(root:THREE.Object3D | null | undefined):string {
		const held = this.gameObject.getComponent(HeldProps);
		const holding = !!(held?.prop('left') ?? held?.prop('right'));
		if (Time.time >= this._idleUntil || (holding && this._idle === HANDS_ON_HIPS)) {
			const feminine = characterModel(root?.userData.meshID as string)?.feminine;
			const others = (feminine ? FEMININE_IDLES : IDLES).filter((c) => c !== this._idle && !(holding && c === HANDS_ON_HIPS));
			this._idle = others[Math.floor(Math.random() * others.length)]!;
			this._idleUntil = Time.time + ((root && toonClip(root, this._idle)?.duration) || 10);
		}
		return this._idle;
	}

	/** Once per new line, while standing: a wave or a hand held out. */
	private gesture(animator:Animator, standing:boolean):void {
		const bubble = this.gameObject.getComponent(SpeechBubble);
		if (!bubble || bubble.timestamp === this._gestured) {
			return;
		}
		this._gestured = bubble.timestamp;
		if (standing && bubble.text) {
			const move = GREETING.test(bubble.text) ? GESTURES.greet : GESTURES.talk;
			animator.playOnce(move.clip, { from: move.from, to: move.to });
		}
	}
}
