import { Component } from '../core/Component.js';
import type { LoopSrc } from './Audio.js';
import type { SfxOpts, SfxPatch } from './types.js';

let next = 0;

type PlayExtra = Pick<SfxOpts, 'gain' | 'freq' | 'freqTo' | 'dur' | 'hear' | 'falloff'>;

/** Posed SFX / loop on this GameObject. Position follows `transform`. */
export class AudioSource extends Component {
	hear = 22;
	gain = 1;
	falloff = 0.16;
	private readonly loopID = `as:${++next}`;
	private looping:LoopSrc | null = null;

	/** One-shot at this transform. */
	play(patch:SfxPatch, extra?:PlayExtra):void {
		const audio = this.gameObject.world?.audio;
		if (!audio) {
			return;
		}
		audio.playSfx(patch, { ...this.pose(), hear: this.hear, gain: this.gain, falloff: this.falloff, ...extra });
	}

	/** Looping patch or score. Follows the transform until set to `null`. */
	get loop():LoopSrc | null {
		return this.looping;
	}

	set loop(src:LoopSrc | null) {
		this.looping = src;
		if (!src) {
			this.halt();
			return;
		}
		this.syncLoop();
	}

	override onEnable():void {
		if (this.looping) {
			this.syncLoop();
		}
	}

	override lateUpdate(dt:number):void {
		if (this.looping) {
			this.syncLoop();
		}
	}

	override onDisable():void {
		this.halt();
	}

	override onDestroy():void {
		this.halt();
	}

	private pose():{ x:number; y:number; z:number } {
		const p = this.gameObject.transform.position;
		return { x: p.x, y: p.y, z: p.z };
	}

	private syncLoop():void {
		const src = this.looping;
		const audio = this.gameObject.world?.audio;
		if (!src || !audio) {
			return;
		}
		audio.playLoop(this.loopID, src, { ...this.pose(), hear: this.hear, gain: this.gain, falloff: this.falloff });
	}

	private halt():void {
		this.gameObject.world?.audio.stopLoop(this.loopID);
	}
}
