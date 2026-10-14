import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { Time } from '../core/Time.js';

/** An impact frame being shown: where the blow struck (world, a body's middle) and whether this frame is the inverted one. */
export type ImpactFrame = { at:THREE.Vector3; invert:boolean };

/**
 * The view. Besides its lens it carries what hits do to the view, all in game time: a {@link shake},
 * a {@link punch} in, and the black-and-white {@link impact} frame, which the `Renderer` draws.
 */
export class Camera extends Component {
	public fov = 50;
	public near = 0.1;
	public far = 120;
	public readonly native = new THREE.PerspectiveCamera(50, 1, 0.1, 120);

	private _shake = { amount: 0, t0: 0, seconds: 0, seed: 0 };
	private _punch = { amount: 0, t0: 0, seconds: 0 };
	private _impact = { at: new THREE.Vector3(), t0: 0, seconds: 0 };

	public override awake():void {
		this.native.name = 'Camera';
		this.syncNative();
		this.gameObject.transform.object3D.add(this.native);
	}

	/** Shakes the view up to `amount` m, dying away over `seconds`. A weaker shake does not cut a stronger one short. */
	public shake(amount:number, seconds:number):void {
		if (amount >= this.shakeAmount()) {
			this._shake = { amount, t0: Time.time, seconds, seed: Math.random() * 100 };
		}
	}

	/** Kicks the view `amount` m toward where it looks, springing back over `seconds`. */
	public punch(amount:number, seconds:number):void {
		this._punch = { amount, t0: Time.time, seconds };
	}

	/**
	 * Shows an impact frame for `seconds`: the view drops to black and white, whatever stands near
	 * `at` (world, the middle of the body struck) a white silhouette on black, with speed lines
	 * bursting out from it, inverting halfway through.
	 */
	public impact(at:THREE.Vector3, seconds:number):void {
		this._impact = { at: at.clone(), t0: Time.time, seconds };
	}

	/** The impact frame to draw now, or null. */
	public get impactFrame():ImpactFrame | null {
		const { at, t0, seconds } = this._impact;
		const t = Time.time - t0;
		return t >= 0 && t < seconds ? { at, invert: t >= seconds / 2 } : null;
	}

	public override update(dt:number):void {
		this.syncNative();
		const shake = this.shakeAmount();
		const { seed } = this._shake;
		const t = Time.time;
		this.native.position.set(
			shake * (Math.sin(t * 61 + seed) + 0.5 * Math.sin(t * 97 + seed * 2)) / 1.5,
			shake * (Math.sin(t * 53 + seed * 3) + 0.5 * Math.sin(t * 89 + seed * 5)) / 1.5,
			0,
		);
		const punch = this._punch;
		const u = punch.seconds > 0 ? (t - punch.t0) / punch.seconds : 1;
		if (u >= 0 && u < 1) {
			// In fast, back slowly.
			this.native.position.z = -punch.amount * (u < 0.15 ? u / 0.15 : (1 - (u - 0.15) / 0.85) ** 2);
		}
	}

	public override onDestroy():void {
		this.native.removeFromParent();
	}

	/** How far the shake moves the view now (m). */
	private shakeAmount():number {
		const { amount, t0, seconds } = this._shake;
		const u = seconds > 0 ? (Time.time - t0) / seconds : 1;
		return u >= 0 && u < 1 ? amount * (1 - u) ** 2 : 0;
	}

	private syncNative():void {
		this.native.fov = this.fov;
		this.native.near = this.near;
		this.native.far = this.far;
		this.native.updateProjectionMatrix();
	}
}
