import { Component } from '../core/Component.js';
import type { LoopSrc } from './Audio.js';
import type { SfxHandle, SfxOpts, SfxPatch } from './types.js';

let next = 0;

type PlayExtra = Pick<SfxOpts, 'gain' | 'freq' | 'pitch' | 'tract' | 'dur' | 'hear' | 'falloff'>;

/** Posed SFX / loop on this GameObject. Position follows `transform`. Disabled, it is silent. */
export class AudioSource extends Component {
	public hear = 22;
	public gain = 1;
	public falloff = 0.16;
	private readonly _loopID = `as:${++next}`;
	private _loop:LoopSrc | null = null;

	/** One-shot at this transform. `extra.gain` scales this source's `gain`. Returns a handle to stop it early (see `Audio.playSfx`). */
	public play(patch:SfxPatch, extra?:PlayExtra):SfxHandle | null {
		const audio = this.gameObject.world?.audio;
		if (!audio || !this.enabled) {
			return null;
		}
		return audio.playSfx(patch, {
			...this.pose(),
			hear: this.hear,
			falloff: this.falloff,
			...extra,
			gain: this.gain * (extra?.gain ?? 1),
		});
	}

	/** Looping patch or score. Follows the transform until set to `null`. */
	public get loop():LoopSrc | null {
		return this._loop;
	}

	public set loop(src:LoopSrc | null) {
		this._loop = src;
		if (!src) {
			this.halt();
			return;
		}
		this.syncLoop();
	}

	public override onEnable():void {
		if (this._loop) {
			this.syncLoop();
		}
	}

	public override lateUpdate(dt:number):void {
		if (this._loop) {
			this.syncLoop();
		}
	}

	public override onDisable():void {
		this.halt();
	}

	public override onDestroy():void {
		this.halt();
	}

	private pose():{ x:number; y:number; z:number } {
		const p = this.gameObject.transform.position;
		return { x: p.x, y: p.y, z: p.z };
	}

	private syncLoop():void {
		const src = this._loop;
		const audio = this.gameObject.world?.audio;
		if (!src || !audio) {
			return;
		}
		audio.playLoop(this._loopID, src, { ...this.pose(), hear: this.hear, gain: this.gain, falloff: this.falloff });
	}

	private halt():void {
		this.gameObject.world?.audio.stopLoop(this._loopID);
	}
}
