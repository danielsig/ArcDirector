import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { toonClip } from '../assets/toonModel.js';
import { MeshRenderer } from './MeshRenderer.js';

/**
 * Plays clips on this object's toon model (`MeshRenderer` with a {@link registerToonModel} mesh).
 * Set `clip` to cross-fade to another one; unknown names keep the current clip. {@link playOnce}
 * plays a move (a sword chop) over it once, then fades back. Every frame starts from the clip's
 * pose, so code that turns bones after it (in `lateUpdate`) adds to that pose instead of piling up,
 * even on a held last frame (three's mixer skips bones whose clip value did not change).
 */
export class Animator extends Component {
	public static override order = 10;

	/** The clip to play. */
	public clip = 'idle';
	/** Repeat the clip; off plays it once and holds the last pose (falling down). Read when `clip` changes. */
	public loop = true;
	/** Cross-fade seconds when `clip` changes. */
	public fade = 0.25;
	/** Playback rate. */
	public speed = 1;

	private _root:THREE.Object3D | null = null;
	private _mixer:THREE.AnimationMixer | null = null;
	private _action:THREE.AnimationAction | null = null;
	private _playing:string | null = null;
	/** A move playing over `clip` until its `to` time. */
	private _once:{ action:THREE.AnimationAction; to:number } | null = null;
	private _pendingOnce:{ name:string; from:number; to:number | undefined; rate:number } | null = null;
	/** The model's bones, and their pose as the mixer left it last frame (rotation, then position, per bone). */
	private _bones:THREE.Bone[] = [];
	private _pose:Float32Array | null = null;

	/**
	 * Plays `name` once over the current clip: from `from` to `to` seconds of it (default: all of
	 * it) at `rate`, then fades back. Starts on the next update; a new move replaces one playing.
	 */
	public playOnce(name:string, options:{ from?:number; to?:number; rate?:number } = {}):void {
		this._pendingOnce = { name, from: options.from ?? 0, to: options.to, rate: options.rate ?? 1 };
	}

	public override update(dt:number):void {
		const root = this.gameObject.getComponent(MeshRenderer)?.mesh ?? null;
		if (root !== this._root) {
			this._mixer?.stopAllAction();
			this._root = root;
			this._mixer = root ? new THREE.AnimationMixer(root) : null;
			this._action = null;
			this._playing = null;
			this._once = null;
			this._bones = [];
			root?.traverse((obj) => {
				if ((obj as THREE.Bone).isBone) {
					this._bones.push(obj as THREE.Bone);
				}
			});
			this._pose = null;
		}
		if (!this._mixer || !this._root) {
			return;
		}
		// Undo last frame's posing by code: the mixer only rewrites bones whose value changed.
		const pose = this._pose;
		if (pose) {
			this._bones.forEach((bone, i) => {
				bone.quaternion.fromArray(pose, i * 7);
				bone.position.fromArray(pose, i * 7 + 4);
			});
		}
		if (this._playing !== this.clip) {
			this._playing = this.clip;
			const clip = toonClip(this._root, this.clip);
			if (clip) {
				const next = this._mixer.clipAction(clip).reset();
				next.setLoop(this.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
				next.clampWhenFinished = !this.loop;
				next.play();
				if (this._action && this._action !== next) {
					this._action.crossFadeTo(next, this.fade, false);
				}
				this._action = next;
			}
		}
		this.updateOnce(this._root, this._mixer);
		this._mixer.timeScale = this.speed;
		this._mixer.update(dt);
		this._pose ??= new Float32Array(this._bones.length * 7);
		this._bones.forEach((bone, i) => {
			bone.quaternion.toArray(this._pose!, i * 7);
			bone.position.toArray(this._pose!, i * 7 + 4);
		});
	}

	private updateOnce(root:THREE.Object3D, mixer:THREE.AnimationMixer):void {
		const pending = this._pendingOnce;
		this._pendingOnce = null;
		if (pending) {
			const clip = toonClip(root, pending.name);
			if (clip) {
				this._once?.action.fadeOut(this.fade);
				const action = mixer.clipAction(clip).reset();
				action.setLoop(THREE.LoopOnce, 1);
				action.clampWhenFinished = true;
				action.time = pending.from;
				// Speed is per move; the mixer's `speed` still scales it.
				action.timeScale = pending.rate;
				action.play().fadeIn(this.fade);
				this._action?.fadeOut(this.fade);
				this._once = { action, to: Math.min(pending.to ?? clip.duration, clip.duration) };
			}
		}
		const once = this._once;
		if (once && once.action.time >= once.to - 1e-3) {
			once.action.fadeOut(this.fade);
			this._action?.reset().fadeIn(this.fade).play();
			this._once = null;
		}
	}

	public override onDestroy():void {
		this._mixer?.stopAllAction();
	}
}
