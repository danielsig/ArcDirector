import { Animator, Component, MeshRenderer, Time } from '@arc-director/kindling';
import * as THREE from 'three';
import { Appearance, HurtFlash, RigidBody, SpeechBubble, Vitals } from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import { Order } from '../engine/order';
import { CharacterPose } from './CharacterPose';

/** Speed (m/s) at which `walk` plays at normal rate; faster movement plays it faster. */
const WALK_PACE = 1.2;
/** Below this the character stands. */
const MOVING = 0.35;

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
 * Picks the 3D character's clip from what it is doing: down, hurt, moving, or standing. Moving
 * plays `walk` at a rate that follows speed (about 2.8× at full speed); a new line of speech adds a
 * gesture, an attack its move. Giving, taking and looking are {@link CharacterPose}'s.
 */
export class CharacterAnimation extends Component {
	public static override order = Order.hurt + 1;

	/** Whether the model wears the hurt reds now. */
	private _painted = false;
	/** When the line last gestured at began (`SpeechBubble.timestamp`). */
	private _gestured = 0;

	/**
	 * Starts the move for attack `verb` so its blow lands `windUp` seconds from now: a clip, or for
	 * `shoot` a bow drawn at `target`. Verbs without one do nothing.
	 */
	public strike(verb:string, windUp:number, target?:GameObject):void {
		if (verb === 'shoot' && target) {
			this.gameObject.getComponent(CharacterPose)?.shoot(target, windUp);
			return;
		}
		const move = STRIKES[verb];
		if (!move) {
			return;
		}
		const rate = (move.hit - move.from) / Math.max(windUp, 0.1);
		this.gameObject.getComponent(Animator)?.playOnce(move.clip, { from: move.from, to: move.to, rate });
	}

	public override update(dt:number):void {
		const animator = this.gameObject.getComponent(Animator);
		if (!animator) {
			return;
		}
		const rb = this.gameObject.getComponent(RigidBody);
		const speed = rb ? Math.hypot(rb.velocity.x, rb.velocity.z) : 0;
		const pose = this.gameObject.getComponent(Appearance)?.clip ?? 'auto';
		const hurt = this.gameObject.getComponent(HurtFlash)?.active === true;
		const root = this.gameObject.getComponent(MeshRenderer)?.mesh;
		if (root && (hurt || this._painted)) {
			paintHurt(root, hurt ? Math.floor(Time.time * HURT_BLINK) : -1);
			this._painted = hurt;
		}
		let clip = 'idle';
		let loop = true;
		let rate = 1;
		if ((this.gameObject.getComponent(Vitals)?.hp ?? 1) <= 0) {
			clip = 'fall';
			loop = false;
		}
		else if (hurt) {
			clip = 'hit_to_body_01';
			loop = false;
		}
		else if (speed > MOVING || pose === 'walk') {
			clip = 'walk';
			rate = Math.max(speed, 1) / WALK_PACE;
		}
		animator.loop = loop;
		animator.clip = clip;
		animator.speed = rate;
		this.gesture(animator, clip === 'idle');
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
