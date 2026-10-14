import { AudioSource } from './AudioSource.js';
import { speech, voiceFor, type SpeechVoice } from './speech.js';
import type { SfxPatch } from './types.js';

/**
 * An `AudioSource` that can also talk out loud. Whatever `voice` leaves out comes from
 * `voiceFor(id)`, so every speaker sounds a little different with no voice set at all.
 */
export class Speaker extends AudioSource {
	public voice:SpeechVoice = {};

	/** This speaker's speaking pitch in Hz (its `voice`, else `voiceFor(id)`'s): scale a cry by it to make it this voice's. */
	public get pitch():number {
		return this.voice.pitch ?? voiceFor(this.gameObject.id).pitch ?? 220;
	}

	/** The babble for `text` in this speaker's voice, lasting `seconds` if given (see `speech`). */
	public line(text:string, seconds?:number):SfxPatch {
		return speech(text, { ...voiceFor(this.gameObject.id), ...this.voice }, seconds);
	}

	/** Babble `text`, or a `line` already made, at this transform. */
	public say(line:string | SfxPatch):void {
		this.play(typeof line === 'string' ? this.line(line) : line);
	}
}
