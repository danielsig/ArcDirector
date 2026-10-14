/** MIDI note scheduled in beats from the loop origin. */
export type Note = {
	pitch:number;
	beat:number;
	dur:number;
	/** 0–1. Default 0.7. */
	vel?:number;
	/** If set, sustaining instruments ride from `vel` to `velTo` (no retrigger). */
	velTo?:number;
	/** Beats from note start before the ride. Default 0. */
	velRampAt?:number;
};

/** Wet room added on top of the dry signal. `mix`, `decay`, and `size` are 0–1. `tone` is a lowpass Hz. */
export type ReverbFilter = {
	kind:'reverb';
	/** Wet level. Default 0.28. */
	mix?:number;
	/** Delay feedback. Default 0.38. */
	decay?:number;
	/** How many early reflections, and how far apart. 0 is a tight booth, 1 a long hall. Default 0.5. */
	size?:number;
	/** Damping lowpass Hz. Default 2400. */
	tone?:number;
};

/** Waveshaper plus a tone lowpass. `drive` is 0–1. */
export type OverdriveFilter = {
	kind:'overdrive';
	/** How hard the curve clips. Default 0.45. */
	drive?:number;
	/** Lowpass after the clip, Hz. Default 2800. */
	tone?:number;
	/** Output level (a clipped sound is loud whatever goes in): 0.25 keeps the grit at a quarter of the volume. Default 1. */
	level?:number;
};

export type SoundFilter = ReverbFilter | OverdriveFilter;

/**
 * Built-ins: `pad`, `pluck`, `lead`, `bass`, `bell`, `drum`, `air`, `piano`.
 * Anything else must `registerInstrument` before `piece` / `playMusic`.
 */
export type Voice = {
	instrument:string;
	notes:Note[];
	gain?:number;
	/** Lowpass cutoff Hz for pad/bass/air. */
	cutoff?:number;
	/** Insert before the music bus (or the posed output). Series, first to last. */
	filters?:SoundFilter[];
};

/** Looping piece. Notes must start in `[0, loop)`. `loops` is how many times (`-1`, default, is forever). */
export type Score = {
	bpm:number;
	loop:number;
	voices:Voice[];
	gain?:number;
	id?:string;
	/** Play this many times. Omit or `-1` for forever. */
	loops?:number;
	/** `callback(fn)` marks; `beat` is in `[0, loop]` (`loop` is the end of a cycle). */
	cues?:{ beat:number; fn:()=>void }[];
	/** Insert in front of the music-bus room, after each voice's own filters. */
	filters?:SoundFilter[];
};

/**
 * `creak` is wood straining: stick-slip clicks `freq` to `freqTo` a second (slow groans, fast squeals) ringing a
 * wooden body whose lowest resonance is `cutoff` Hz, `q` sharp (a door low, a bow high).
 * `bee` and `boo` are the two syllables `speech` babbles in, each opening with a "b"; they glide from `freq` to `freqTo`.
 * `crackle` is random pops (`rate` a second) through a bandpass at `cutoff`: fire, sparks, debris.
 * `metal` is a struck bar's inharmonic partials over `freq`, ringing `dur` s: a clash, a clang.
 * `formant` is a throat's buzz at `freq` (gliding to `freqTo`) shaped into a `vowel`: grunts and shouts.
 * `rumble` is low rolling noise below `cutoff` over a sub tone at `freq`: thunder's tail, a ground crack.
 */
export type SfxKind = 'noise' | 'thump' | 'click' | 'creak' | 'pluck' | 'fm' | 'chirp' | 'bee' | 'boo' | 'crackle' | 'metal' | 'formant' | 'rumble';

/** A vowel a `formant` layer is shaped into. */
export type Vowel = 'a' | 'e' | 'i' | 'o' | 'u';

export type SfxLayer = {
	/** Type of sound. */
	kind:SfxKind;
	/** Playback duration in seconds. */
	dur:number;
	/** PLayback delay in seconds. */
	when?:number;
	/** Pitch of a sound in Hz. */
	freq?:number;
	/** End pitch the sound glides to in Hz. */
	freqTo?:number;
	/** Bandwidth for bandpass/lowpass filters. Default 0.6. */
	q?:number;
	/** Initial volume before applying any filters, cutoff, etc. Default 1. */
	gain?:number;
	/** Bandpass/lowpass Hz for noise layers. */
	cutoff?:number;
	/** Hz the cutoff sweeps to over the layer (noise, `crackle`, `rumble`). */
	cutoffTo?:number;
	/** Filter for noise layers. Default `lowpass`. */
	filter?:BiquadFilterType;
	/**
	 * Seconds the layer swells in (noise, `crackle`, `rumble`, `formant`); at most nearly half of it. Noise and
	 * `crackle` then hold and die away over the rest; unset, they start at full and die away over most of it.
	 */
	attack?:number;
	/** Seconds noise, `crackle`, `rumble` and `formant` layers die away over at their end; before that they hold. Default: all of it after the attack (`rumble`: most of it; `formant`: half). */
	release?:number;
	/** Pops a second for `crackle`, rolls a second for `rumble`, trembles a second for `formant` (the pitch wavering a few percent). */
	rate?:number;
	/** The vowel of a `formant` layer. Default `a`. */
	vowel?:Vowel;
};

export type SfxPatch = {
	layers:readonly SfxLayer[];
	gain?:number;
	/** How much each play differs (0–1): pitch by up to `vary` × 4 semitones either way, loudness by up to `vary` × 30%. */
	vary?:number;
	/** Insert before spatialization. Posed sounds do not use the music-bus room. */
	filters?:SoundFilter[];
};

/** A one-shot playing: `stop(fade)` fades it out over about `fade` s (default 0.1), however long it was meant to run. */
export type SfxHandle = { stop:(fade?:number)=>void };

export type SfxOpts = {
	x?:number;
	y?:number;
	z?:number;
	gain?:number;
	/** Override duration on every layer. */
	dur?:number;
	/** Override frequency on every layer. */
	freq?:number;
	/** Multiplies every layer's `freq` and `freqTo`: the same sound in a higher or lower voice (filters stay put, as a mouth's shape does). */
	pitch?:number;
	/** Multiplies every layer's `cutoff` and `cutoffTo` and a `formant`'s vowel: the same sound from a bigger (below 1) or smaller throat. */
	tract?:number;
	/** Mute the source past this distance (meters). Default 22. */
	hear?:number;
	/** How local the sound is. Higher falls off sooner. Default 0.16. See `distanceGain`. */
	falloff?:number;
};

export type ListenerPose = {
	x:number;
	y:number;
	z:number;
	yaw:number;
};
