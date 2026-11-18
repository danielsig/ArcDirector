import type { Vec } from '../world/world-types.js';
import { distance } from '../world/vec.js';
import type { Axes } from '../world/axes.js';
import { Bearing, type BearingMode } from './perception-types.js';
import { bearingPhrase, bearingText, DEFAULT_SIGHT, formatMeasure, quantizeDistance } from './sight.js';

/**
 * A sound something makes: its name in plain words (`footsteps`, `bush-thrashing sounds`, `a jetpack roar`), how loud
 * it is at its source, 0–1, and for one that goes on, how many `seconds` it lasts and how it `fade`s over them: 0
 * steady, 1 dying away evenly to nothing, more sooner. Without `seconds` it is heard once, as it is made.
 */
export type Sound = { name:string; loudness:number; seconds?:number; fade?:number };

/** Where a sound is: a character or thing the world places (it moves with it), or a point. */
export type SoundSource = { id?:string; point:Vec };

/**
 * How clearly a listener hears a source, which a sound's loudness is multiplied by: the numbers of the default curve,
 * or the game's own, 0–1. `max`: how far a sound of loudness 1 carries, and nothing farther. `falloff`: how it drops
 * with distance, 2 the inverse square of sound spreading out, 1 slower, 0 not at all. What walls leave of it is the
 * world's `getClarity('sound')`; a sound heard through one is `muffled`.
 */
export type HearingRange = { max:number; falloff:number } | ((listenerID:string, source:SoundSource)=>number);

export const DEFAULT_HEARING:Readonly<{ max:number; falloff:number }> = { max: 40, falloff: 2 };

/** How loud a sound must be at a listener to be heard at all. */
export const AUDIBLE = 0.05;
/** From here it ends in `!`, and wakes the mind. */
export const LOUD = 0.5;
/** From here it is heard `LOUDLY`: close to its source. */
const LOUDLY = 0.85;

/** How loud a line said plainly is: heard 16 paces off by the default curve, its words made out to 8. */
export const SPEAKING = 0.16;
/** From here a line's words are made out, in silence; under it, or through anything, it is muffled. */
export const WORDS = 0.2;

/**
 * How clearly the default curve carries a sound `at` that far: past 1 near its source (a sound is louder close up than
 * its loudness, which is what it is heard at as far as a sound of loudness 1 carries to `max`), none past `max`.
 */
export function clarityAt(at:number, { max, falloff }:{ max:number; falloff:number } = DEFAULT_HEARING):number {
	return at > max ? 0 : (max * AUDIBLE ** (1 / falloff) / Math.max(at, 1e-6)) ** falloff;
}

/** How loud `sound` still is `since` seconds after it was made: its fade over its seconds. */
export function loudnessAfter(sound:Sound, since:number):number {
	const { seconds = 0, fade = 0 } = sound;
	if (seconds <= 0 || fade <= 0) {
		return sound.loudness;
	}
	return sound.loudness * Math.max(0, 1 - since / seconds) ** fade;
}

/** How far a sound of `loudness` is heard by the default curve: where it drops to {@link AUDIBLE}. */
export function reachOf(loudness:number, { max, falloff }:{ max:number; falloff:number } = DEFAULT_HEARING):number {
	return falloff > 0 ? max * Math.min(1, loudness) ** (1 / falloff) : (loudness >= AUDIBLE ? max : 0);
}

/** The loudness heard as far as `reach` by the default curve: what a game gives a sound it wants heard that far. */
export function loudnessFor(reach:number, { max, falloff }:{ max:number; falloff:number } = DEFAULT_HEARING):number {
	return Math.min(1, reach / max) ** falloff;
}

/**
 * What a listener at `listener` (facing `facing`, in checked `axes`, standing along `up` if not the world's) makes of
 * `sound` from `from`, its bearing told as `bearing` says (default `BearingMode.Relative`), heard at
 * `level` (its loudness there, 0–1): `You hear footsteps LOUDLY 1 pace behind you!`, `You hear muffled bush-thrashing
 * sounds 10 paces in front of you.` From {@link LOUD} it ends in `!`; distances as sight gives them. A sound that came
 * round things is told from `via`, the last bend it came round, `length` off: `You hear footsteps 12 paces off, round a
 * corner to your right.`
 */
export function heardText(sound:Sound, level:number, listener:Vec, from:Vec, opts:{ facing?:Vec; axes?:Axes; up?:Vec; bearing?:BearingMode; muffled?:boolean; unitName?:string; closeness?:number; via?:Vec; length?:number } = {}):string {
	const { axes } = opts;
	const where = (axes && bearingText({ point: listener, facing: opts.facing, up: opts.up }, { point: opts.via ?? from }, axes, opts.bearing)) || bearingPhrase(Bearing.Away);
	const measure = formatMeasure(quantizeDistance(opts.length ?? distance(listener, from), opts.closeness ?? DEFAULT_SIGHT.closeness), opts.unitName ?? DEFAULT_SIGHT.unitName);
	const name = `${opts.muffled ? 'muffled ' : ''}${sound.name}${level >= LOUDLY ? ' LOUDLY' : ''}`;
	return `You hear ${name} ${measure} ${opts.via ? `off, round a corner ${where}` : where}${level >= LOUD ? '!' : '.'}`;
}

/** How loud a level sounds, in steps: 0 heard, 1 loud (`!`), 2 `LOUDLY`. A sound is told again only when it climbs one. */
export function loudnessStep(level:number):number {
	return level >= LOUDLY ? 2 : level >= LOUD ? 1 : 0;
}

/**
 * A verb's sound as its help tells it: `heard as footsteps up to 15 paces`, the words a listener hears it in. With the
 * game's own curve no distance can be worked out, so it says how loud instead.
 */
export function noiseHelp(sound:Sound, range:HearingRange = DEFAULT_HEARING, unitName = DEFAULT_SIGHT.unitName):string {
	return typeof range === 'function'
		? `heard as ${sound.name}, ${sound.loudness >= LOUD ? 'loud' : 'quiet'}`
		: `heard as ${sound.name} up to ${formatMeasure(Math.round(reachOf(sound.loudness, range)), unitName)}`;
}

/** Hears every sound as it is made, and each tick while it goes on, for whatever has no mind: what made it, and how loud it is at any character now (0 unheard). */
export type SoundListener = (from:string | Vec, sound:Sound, heardBy:(listenerID:string)=>number)=>void;
