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
};

export type SfxKind = 'noise' | 'thump' | 'click' | 'creak' | 'pluck' | 'fm' | 'chirp' | 'murmur';

export type SfxLayer = {
	kind:SfxKind;
	dur:number;
	when?:number;
	freq?:number;
	freqTo?:number;
	q?:number;
	gain?:number;
	/** Bandpass/lowpass Hz for noise layers. */
	cutoff?:number;
	/** Filter for looping noise beds. Default `lowpass`. */
	filter?:BiquadFilterType;
};

export type SfxPatch = {
	layers:readonly SfxLayer[];
	gain?:number;
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
	/** Murmur/chirp end pitch. Talk questions rise here. */
	freqTo?:number;
	/** Mute the source past this distance (meters). Default 22. */
	hear?:number;
	/** Inverse-square coefficient: gain is `1 / (1 + (dist * falloff)²)`. Default 0.16. */
	falloff?:number;
};

export type ListenerPose = {
	x:number;
	y:number;
	z:number;
	yaw:number;
};
