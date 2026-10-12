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

/** `bee` and `boo` are the two syllables `speech` babbles in, each opening with a "b"; they glide from `freq` to `freqTo`. */
export type SfxKind = 'noise' | 'thump' | 'click' | 'creak' | 'pluck' | 'fm' | 'chirp' | 'bee' | 'boo';

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
	/** Filter for noise layers. Default `lowpass`. */
	filter?:BiquadFilterType;
};

export type SfxPatch = {
	layers:readonly SfxLayer[];
	gain?:number;
	/** Insert before spatialization. Posed sounds do not use the music-bus room. */
	filters?:SoundFilter[];
};

export type SfxOpts = {
	x?:number;
	y?:number;
	z?:number;
	gain?:number;
	/** Override duration on every layer. */
	dur?:number;
	/** Override frequency on every layer. */
	freq?:number;
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
