import { Component } from '../core/Component.js';
import { speech, voiceFor, type SpeechVoice } from './speech.js';
import type { SfxPatch } from './types.js';

/**
 * Lets this GameObject talk out loud. Whatever `voice` leaves out comes from `voiceFor(id)`,
 * so every speaker sounds a little different with no voice set at all.
 */
export class Speaker extends Component {
	public voice:SpeechVoice = {};

	/** The babble for `text` in this speaker's voice, lasting `seconds` if given (see `speech`). */
	public line(text:string, seconds?:number):SfxPatch {
		return speech(text, { ...voiceFor(this.gameObject.id), ...this.voice }, seconds);
	}

	/** Babble `text`, or a `line` already made, at this transform. */
	public say(line:string | SfxPatch):void {
		const go = this.gameObject;
		const audio = go.world?.audio;
		if (!audio) {
			return;
		}
		const p = go.transform.position;
		audio.playSfx(typeof line === 'string' ? this.line(line) : line, { x: p.x, y: p.y, z: p.z });
	}
}
