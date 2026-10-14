import { Component, Time } from '@arc-director/kindling';
import * as THREE from 'three';
import { Appearance, Vitals } from './components';
import { healGlint } from '../render/spellFx';

/**
 * Health trickling back (a heal's afterglow): `left` hp more, one at a time, evenly spaced until
 * `until`, each with a few sparkles. Stops for good if the character goes down.
 */
export class Regen extends Component {
	public static override saved = ['left', 'until'];
	public left = 0;
	public until = 0;
	/** When the next point comes back. */
	private _next = 0;

	/** `hp` more trickling back over the next `seconds` (added to any still to come, ending no sooner). */
	public add(hp:number, seconds:number):void {
		this.left += hp;
		this.until = Math.max(this.until, Time.time + seconds);
		this._next = Time.time + this.gap();
	}

	public override update(dt:number):void {
		if (this.left <= 0 || Time.time < this._next) {
			return;
		}
		const vitals = this.gameObject.getComponent(Vitals);
		if (!vitals || vitals.hp <= 0) {
			this.left = 0;
			return;
		}
		vitals.hp = Math.min(vitals.maxHP, vitals.hp + 1);
		this.left -= 1;
		this._next = Time.time + this.gap();
		const world = this.gameObject.world;
		if (world) {
			const p = this.gameObject.transform.position;
			const height = this.gameObject.getComponent(Appearance)?.height ?? 1.7;
			healGlint(world.native, new THREE.Vector3(p.x, p.y + height * 0.5, p.z));
		}
	}

	/** Seconds to the next point: what is left of the time, shared out over what is left of the hp. */
	private gap():number {
		return Math.max(0, this.until - Time.time) / Math.max(1, this.left);
	}
}
