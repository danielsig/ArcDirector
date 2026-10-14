import type { SfxLayer, SfxPatch } from '@arc-director/kindling';

/** Seeded random in [0, 1), so each take is the same every load. */
function seeded(seed:number):()=>number {
	let s = seed * 2654435761 >>> 0;
	return () => {
		s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x6d2b79f5 >>> 0;
		return s / 4294967296;
	};
}

/** Tiny crackles of bent and snapping blades between `from` and `to` seconds: dense early, thinning out, quieter as they go. */
function crackles(rand:()=>number, count:number, from:number, to:number, loud:number):SfxLayer[] {
	return Array.from({ length: count }, (_, i) => {
		const t = i / count;
		const snap = rand() < 0.2;
		return {
			kind: 'noise',
			when: from + (to - from) * Math.pow(t, 1.8) + rand() * 0.006,
			dur: snap ? 0.004 + rand() * 0.003 : 0.008 + rand() * 0.018,
			cutoff: 2800 + rand() * 5700,
			q: snap ? 4 : 1.4 + rand() * 1.2,
			filter: 'bandpass',
			gain: loud * (snap ? 0.8 : 1) * Math.pow(1 - t, 1.2) * (0.75 + rand() * 0.5),
		};
	});
}

/**
 * One take of a step through grass: a crunch, not a swish. A dense cluster of crackles as the
 * foot lands, with a few sharp blade snaps; two quiet swishes underneath keep it rustling; a
 * soft low press gives it weight; and a smaller rustle follows as the foot lifts out.
 */
function grassStep(seed:number):SfxPatch {
	const rand = seeded(seed + 1);
	return {
		gain: 0.45,
		layers: [
			{ kind: 'noise', dur: 0.06, cutoff: 700, gain: 0.14 },
			{ kind: 'noise', dur: 0.22, cutoff: 6000 + rand() * 1200, cutoffTo: 3800, filter: 'bandpass', q: 1, attack: 0.04, gain: 0.2 },
			{ kind: 'noise', dur: 0.26, cutoff: 4600 + rand() * 800, cutoffTo: 3000, filter: 'bandpass', q: 1.4, attack: 0.04, when: 0.05, gain: 0.11 },
			...crackles(rand, 16 + Math.floor(rand() * 7), 0, 0.2, 0.55),
			...crackles(rand, 5 + Math.floor(rand() * 3), 0.2 + rand() * 0.04, 0.32, 0.22),
		],
	};
}

const GRASS_TAKES = Array.from({ length: 6 }, (_, i) => grassStep(i));

/** Sound effects by name. A list holds several takes of one sound; `cueAt` picks one each time. */
export const SFX = {
	/**
	 * Hard shoes on stone: heel then toe. Each is a very short burst of bright noise (no tone, or
	 * it beeps), the heel with a dull knock in the stone under it, the toe lighter and quicker.
	 */
	stepStone: {
		gain: 0.6,
		layers: [
			{ kind: 'noise', dur: 0.022, cutoff: 2800, q: 0.6, filter: 'lowpass', gain: 0.6 },
			{ kind: 'noise', dur: 0.015, cutoff: 5000, filter: 'highpass', gain: 0.3 },
			{ kind: 'noise', dur: 0.04, cutoff: 260, gain: 0.35 },
			{ kind: 'noise', dur: 0.016, cutoff: 3400, when: 0.05, q: 0.6, filter: 'bandpass', gain: 0.35 },
			{ kind: 'noise', dur: 0.01, cutoff: 5500, when: 0.05, filter: 'highpass', gain: 0.18 },
		],
	},
	/** Stepping through grass: several takes of a crunch, one picked per step (see `grassStep`). */
	stepGrass: GRASS_TAKES,
	/** Boards and bridges: a hollow, low thump with a dull knock. */
	stepWood: {
		gain: 0.5,
		layers: [
			{ kind: 'thump', dur: 0.09, freq: 180, gain: 0.3 },
			{ kind: 'thump', dur: 0.2, when: 0.05, freq: 70, gain: 0.1 },
			{ kind: 'noise', dur: 0.07, cutoff: 400, gain: 0.3 },
			{ kind: 'noise', dur: 0.2, cutoff: 200, q: 0.6, filter: 'bandpass', gain: 0.2 },
			{ kind: 'click', dur: 0.015, freq: 320, cutoff: 1400, gain: 0.15 },
		],
	},
	doorOpen: {
		gain: 0.9,
		layers: [
			{ kind: 'creak', dur: 0.62, freq: 38, freqTo: 22, cutoff: 260, q: 5, gain: 0.8 },
			{ kind: 'creak', dur: 0.4, when: 0.12, freq: 70, freqTo: 45, cutoff: 480, q: 7, gain: 0.35 },
			{ kind: 'thump', dur: 0.12, freq: 90, when: 0.02, gain: 0.35 },
		],
	},
	doorClose: {
		gain: 0.95,
		layers: [
			{ kind: 'creak', dur: 0.24, freq: 45, freqTo: 30, cutoff: 280, q: 5, gain: 0.5 },
			{ kind: 'thump', dur: 0.14, freq: 78, when: 0.08, gain: 0.8 },
			{ kind: 'click', dur: 0.04, freq: 280, when: 0.16, gain: 0.35 },
		],
	},
	chestOpen: {
		gain: 0.88,
		layers: [
			{ kind: 'creak', dur: 0.32, freq: 60, freqTo: 38, cutoff: 420, q: 6, gain: 0.55 },
			{ kind: 'thump', dur: 0.1, freq: 120, gain: 0.4 },
			{ kind: 'click', dur: 0.05, freq: 880, when: 0.12, cutoff: 2400, gain: 0.5 },
		],
	},
	chestClose: {
		gain: 0.9,
		layers: [
			{ kind: 'thump', dur: 0.16, freq: 95, gain: 0.75 },
			{ kind: 'noise', dur: 0.08, cutoff: 500, gain: 0.35 },
		],
	},
	unlock: {
		gain: 0.8,
		layers: [
			{ kind: 'click', dur: 0.04, freq: 1400, cutoff: 3000, gain: 0.55 },
			{ kind: 'click', dur: 0.05, freq: 900, when: 0.06, cutoff: 2200, gain: 0.45 },
			{ kind: 'fm', dur: 0.18, freq: 740, when: 0.04, gain: 0.22 },
		],
	},
	take: {
		gain: 0.75,
		layers: [
			{ kind: 'chirp', dur: 0.12, freq: 380, freqTo: 720, gain: 0.45 },
			{ kind: 'pluck', dur: 0.22, freq: 392, gain: 0.55 },
		],
	},
	give: {
		gain: 0.78,
		layers: [
			{ kind: 'pluck', dur: 0.2, freq: 330, gain: 0.5 },
			{ kind: 'pluck', dur: 0.24, freq: 494, when: 0.07, gain: 0.55 },
			{ kind: 'chirp', dur: 0.1, freq: 520, freqTo: 340, when: 0.05, gain: 0.25 },
		],
	},
	drop: {
		gain: 0.85,
		layers: [
			{ kind: 'thump', dur: 0.16, freq: 68, gain: 0.8 },
			{ kind: 'noise', dur: 0.1, cutoff: 340, gain: 0.4 },
			{ kind: 'click', dur: 0.03, freq: 180, when: 0.02, gain: 0.25 },
		],
	},
	river: {
		gain: 0.26,
		layers: [
			{ kind: 'noise', dur: 1, cutoff: 1200, q: 1.25, gain: 0.28, filter: 'bandpass' },
			{ kind: 'noise', dur: 1, cutoff: 2700, q: 1.7, gain: 0.36, filter: 'bandpass' },
			{ kind: 'noise', dur: 1, cutoff: 6200, q: 0.8, gain: 0.14, filter: 'highpass' },
		],
	},
	falls: {
		gain: 0.82,
		layers: [
			{ kind: 'noise', dur: 1, cutoff: 95, q: 0.35, gain: 0.75 },
			{ kind: 'noise', dur: 1, cutoff: 310, q: 0.65, gain: 0.62, filter: 'bandpass' },
			{ kind: 'noise', dur: 1, cutoff: 1600, q: 0.75, gain: 0.42, filter: 'bandpass' },
			{ kind: 'noise', dur: 1, cutoff: 3800, q: 0.55, gain: 0.3, filter: 'highpass' },
		],
	},
	hit: {
		gain: 0.88,
		layers: [
			{ kind: 'thump', dur: 0.09, freq: 78, gain: 0.85 },
			{ kind: 'noise', dur: 0.08, cutoff: 1400, gain: 0.4 },
			{ kind: 'click', dur: 0.04, freq: 520, when: 0.02, cutoff: 2200, gain: 0.35 },
		],
	},
	knock: {
		gain: 1,
		vary: 0.15,
		layers: [
			{ kind: 'thump', dur: 0.11, freq: 88, gain: 0.95 },
			{ kind: 'thump', dur: 0.08, freq: 48, when: 0.02, gain: 0.7 },
			{ kind: 'click', dur: 0.05, freq: 210, cutoff: 780, gain: 0.55 },
			{ kind: 'noise', dur: 0.07, cutoff: 320, gain: 0.32 },
		],
	},
	/** A blade cutting the air: a band of noise sweeping up as it swells and dies, a thin hiss riding on top. Loudest {@link SWISH_PEAK} s in. */
	swish: {
		gain: 1,
		vary: 0.25,
		layers: [
			{ kind: 'noise', dur: 0.22, cutoff: 900, cutoffTo: 3200, filter: 'bandpass', q: 1.6, attack: 0.12, gain: 0.9 },
			{ kind: 'noise', dur: 0.16, when: 0.05, cutoff: 4000, cutoffTo: 6500, filter: 'bandpass', q: 2.5, attack: 0.07, gain: 0.35 },
		],
	},
	/** A two-handed blade coming down: a longer, lower swish with weight under it. Loudest {@link SWISH_PEAK} s in too. */
	swishHeavy: {
		gain: 1.1,
		vary: 0.2,
		layers: [
			{ kind: 'noise', dur: 0.24, cutoff: 380, cutoffTo: 1900, filter: 'bandpass', q: 1.2, attack: 0.12, gain: 1 },
			{ kind: 'noise', dur: 0.2, when: 0.04, cutoff: 2600, cutoffTo: 4800, filter: 'bandpass', q: 2, attack: 0.08, gain: 0.3 },
			{ kind: 'rumble', dur: 0.3, freq: 70, cutoff: 200, rate: 12, attack: 0.1, gain: 0.35 },
		],
	},
	/**
	 * Blade on blade: a sharp tick, three thin bright rings that die fast (no low body, or it turns
	 * into a struck pipe), the edges scraping apart, and a spit of sparks.
	 */
	clash: {
		gain: 0.75,
		vary: 0.3,
		layers: [
			{ kind: 'noise', dur: 0.012, cutoff: 4000, filter: 'highpass', gain: 0.9 },
			{ kind: 'metal', dur: 0.32, freq: 1850, gain: 0.35 },
			{ kind: 'metal', dur: 0.22, freq: 2630, gain: 0.25 },
			{ kind: 'metal', dur: 0.16, freq: 3720, gain: 0.18 },
			{ kind: 'noise', dur: 0.18, cutoff: 7500, cutoffTo: 3600, filter: 'bandpass', q: 3, attack: 0.005, gain: 0.5 },
			{ kind: 'crackle', dur: 0.1, rate: 300, cutoff: 6500, q: 1.2, gain: 0.35 },
		],
	},
	/** A blade cleaving into stone: a crack, a heavy thud, the ground grumbling, and grit and chips falling. */
	groundCrack: {
		gain: 0.85,
		vary: 0.15,
		layers: [
			{ kind: 'noise', dur: 0.05, cutoff: 2500, filter: 'bandpass', q: 0.7, gain: 0.9 },
			{ kind: 'thump', dur: 0.25, freq: 70, gain: 0.9 },
			{ kind: 'rumble', dur: 0.7, freq: 48, cutoff: 220, cutoffTo: 90, rate: 9, gain: 0.55 },
			{ kind: 'crackle', dur: 0.5, when: 0.03, rate: 90, cutoff: 1800, cutoffTo: 900, q: 0.7, gain: 0.6 },
		],
	},
	/** A body hitting the ground: a dull thud, a scuff, and a little grit. */
	bodyFall: {
		gain: 0.8,
		vary: 0.2,
		layers: [
			{ kind: 'thump', dur: 0.2, freq: 60, gain: 0.9 },
			{ kind: 'noise', dur: 0.15, cutoff: 400, gain: 0.45 },
			{ kind: 'crackle', dur: 0.4, when: 0.05, rate: 60, cutoff: 1500, q: 0.7, gain: 0.35 },
		],
	},
	/** A bow being drawn: its limbs creaking high and tighter as the string comes back, a thin squeak of strain over it. */
	bowDraw: {
		gain: 0.9,
		vary: 0.15,
		layers: [
			{ kind: 'creak', dur: 0.55, freq: 110, freqTo: 230, cutoff: 1300, q: 7, gain: 0.6 },
			{ kind: 'creak', dur: 0.45, when: 0.08, freq: 180, freqTo: 340, cutoff: 2400, q: 9, gain: 0.25 },
		],
	},
	/** A bow loosed: the string's low twang, the knock of the limbs, the arrow hissing away. */
	bowRelease: {
		gain: 1,
		vary: 0.15,
		layers: [
			{ kind: 'pluck', dur: 0.35, freq: 98, gain: 0.7 },
			{ kind: 'thump', dur: 0.06, freq: 160, gain: 0.4 },
			{ kind: 'noise', dur: 0.14, cutoff: 2500, cutoffTo: 5200, filter: 'bandpass', q: 1.5, attack: 0.02, gain: 0.35 },
		],
	},
	/** An arrow striking someone: a short, hard thunk. */
	arrowHit: {
		gain: 0.75,
		vary: 0.2,
		layers: [
			{ kind: 'thump', dur: 0.08, freq: 140, gain: 0.8 },
			{ kind: 'click', dur: 0.03, freq: 900, cutoff: 2600, gain: 0.5 },
			{ kind: 'noise', dur: 0.05, cutoff: 1800, gain: 0.3 },
		],
	},
	/** An arrow going into the ground: a light thud and a spit of dirt. */
	arrowMiss: {
		gain: 0.55,
		vary: 0.25,
		layers: [
			{ kind: 'thump', dur: 0.06, freq: 200, gain: 0.5 },
			{ kind: 'click', dur: 0.025, freq: 600, cutoff: 2000, gain: 0.35 },
			{ kind: 'crackle', dur: 0.12, rate: 120, cutoff: 1600, gain: 0.35 },
		],
	},
	/** Fire gathering on a staff, played stretched over the whole cast: a roar and a rumble swelling, flames crackling up through it. */
	fireCast: {
		gain: 0.55,
		layers: [
			{ kind: 'rumble', dur: 1.2, freq: 60, cutoff: 300, cutoffTo: 700, rate: 7, attack: 1, release: 0.2, gain: 0.5 },
			{ kind: 'noise', dur: 1.2, cutoff: 400, cutoffTo: 1400, filter: 'bandpass', q: 0.8, attack: 1, release: 0.2, gain: 0.6 },
			{ kind: 'crackle', dur: 1.2, rate: 50, cutoff: 2600, attack: 0.8, release: 0.2, gain: 0.45 },
		],
	},
	/** A fireball thrown: a roaring whoosh and a trail of crackles. */
	fireThrow: {
		gain: 1.3,
		vary: 0.2,
		layers: [
			{ kind: 'noise', dur: 0.45, cutoff: 600, cutoffTo: 2400, filter: 'bandpass', q: 1, attack: 0.08, gain: 0.8 },
			{ kind: 'crackle', dur: 0.4, rate: 70, cutoff: 2400, gain: 0.4 },
		],
	},
	/** A fireball bursting: a deep boom, a whump of air closing, flames crackling and a rumbling tail. */
	fireHit: {
		gain: 0.85,
		vary: 0.2,
		layers: [
			{ kind: 'thump', dur: 0.3, freq: 75, gain: 1 },
			{ kind: 'noise', dur: 0.35, cutoff: 1600, cutoffTo: 300, gain: 0.8 },
			{ kind: 'crackle', dur: 0.7, rate: 80, cutoff: 2200, cutoffTo: 1200, gain: 0.55 },
			{ kind: 'rumble', dur: 0.6, freq: 50, cutoff: 200, gain: 0.4 },
		],
	},
	/** Lightning gathering on a staff, stretched over the whole cast: sparks snapping faster and a mains-like buzz rising. */
	sparkCast: {
		gain: 1.1,
		layers: [
			{ kind: 'crackle', dur: 1.2, rate: 160, cutoff: 4500, q: 1.2, attack: 0.9, release: 0.2, gain: 0.55 },
			{ kind: 'noise', dur: 1.2, cutoff: 240, filter: 'bandpass', q: 14, attack: 0.9, release: 0.2, gain: 0.5 },
		],
	},
	/** A bolt striking: a sharp crack, a burst of snapping sparks, a thump, and thunder rolling away. */
	thunder: {
		gain: 0.9,
		vary: 0.2,
		layers: [
			{ kind: 'noise', dur: 0.08, cutoff: 6000, filter: 'highpass', gain: 1 },
			{ kind: 'crackle', dur: 0.35, rate: 400, cutoff: 5000, cutoffTo: 2000, gain: 0.8 },
			{ kind: 'thump', dur: 0.2, freq: 90, gain: 0.7 },
			{ kind: 'rumble', dur: 1.6, freq: 45, cutoff: 260, cutoffTo: 80, rate: 4, attack: 0.15, gain: 0.8 },
		],
	},
	/**
	 * A heal gathering, stretched over the whole cast: a choir's soft "ahh" on an A major chord, each part
	 * two voices a little apart, wavering gently, swelling in and blooming in a small room. One held
	 * chord, no tune.
	 */
	healCast: {
		gain: 0.9,
		filters: [{ kind: 'reverb', mix: 0.35, decay: 0.45, size: 0.7 }],
		layers: [220, 277.2, 329.6, 440].flatMap((hz, i) => [0, 1].map((twin) => ({
			kind: 'formant' as const,
			dur: 1.2,
			freq: hz * (twin ? 1.006 : 1),
			vowel: 'a' as const,
			attack: 1,
			release: 0.25,
			rate: 4.5 + i * 0.4 + twin * 0.7,
			gain: twin ? 0.12 : 0.16,
		}))),
	},
	/**
	 * A heal taking: a warm puff of air, the choir opening onto the cast's chord an octave up and
	 * dying away, and a shower of little bells over it, too quick and thick to be a tune.
	 */
	healLand: {
		gain: 0.7,
		vary: 0.1,
		filters: [{ kind: 'reverb', mix: 0.4, decay: 0.5, size: 0.8 }],
		layers: [
			{ kind: 'noise', dur: 0.4, cutoff: 500, cutoffTo: 1600, filter: 'bandpass', q: 1, attack: 0.08, gain: 0.8 },
			...[440, 554.4, 659.3].flatMap((hz, i) => [0, 1].map((twin) => ({
				kind: 'formant' as const,
				dur: 1.4,
				freq: hz * (twin ? 1.006 : 1),
				vowel: 'a' as const,
				attack: 0.08,
				release: 1.1,
				rate: 5 + i * 0.5 + twin * 0.6,
				gain: twin ? 0.1 : 0.13,
			}))),
			// The bells: notes of the chord high up, scattered over half a second, fading as they go.
			...([[1760, 0.04], [2637, 0.09], [2217, 0.13], [3520, 0.18], [1976, 0.22], [2960, 0.27], [2217, 0.33], [3520, 0.4], [2637, 0.47], [1760, 0.55]] as const)
				.map(([hz, when], i) => ({ kind: 'fm' as const, dur: 0.5, when, freq: hz, gain: 0.5 - i * 0.035 })),
		],
	},
	/** A spell cut short: a hiss falling away and a last few crackles. */
	fizzle: {
		gain: 0.9,
		vary: 0.2,
		layers: [
			{ kind: 'noise', dur: 0.3, cutoff: 3000, cutoffTo: 600, filter: 'bandpass', q: 1, attack: 0.01, gain: 0.6 },
			{ kind: 'crackle', dur: 0.25, rate: 60, cutoff: 2000, gain: 0.4 },
		],
	},
	/**
	 * Voices (`hurt`, `deathCry`) are made for a 360 Hz speaker; `cueVoice` scales them to each one's own.
	 * Struck: a short, high, ragged yelp. The voice cracks up high and falls; most of it is air
	 * rushing through the same mouth shape (noise at the "ah" formants) with a hiss of breath on top.
	 */
	hurt: {
		gain: 1,
		vary: 0.35,
		layers: [
			// A sharp gasp, the voice jerking up into the cry, then the strained cry itself breaking
			// and trembling as it falls.
			{ kind: 'noise', dur: 0.035, cutoff: 2600, filter: 'highpass', attack: 0.01, gain: 0.3 },
			{ kind: 'formant', dur: 0.05, when: 0.02, freq: 300, freqTo: 440, vowel: 'a', attack: 0.008, gain: 0.35 },
			{ kind: 'formant', dur: 0.19, when: 0.06, freq: 440, freqTo: 250, vowel: 'a', attack: 0.01, rate: 9, gain: 0.45 },
			{ kind: 'noise', dur: 0.225, when: 0.02, cutoff: 1150, cutoffTo: 800, filter: 'bandpass', q: 3, attack: 0.012, gain: 0.5 },
			{ kind: 'noise', dur: 0.2, when: 0.02, cutoff: 2900, cutoffTo: 2200, filter: 'bandpass', q: 4, attack: 0.012, gain: 0.35 },
			{ kind: 'noise', dur: 0.15, when: 0.02, cutoff: 4500, filter: 'highpass', attack: 0.01, gain: 0.12 },
		],
	},
	/**
	 * Struck down: a long scream that breaks high and sinks, as much breath as voice, then a gasping
	 * exhale and a last groan.
	 */
	deathCry: {
		gain: 1,
		vary: 0.3,
		layers: [
			// A gasp, the voice wrenched up into a scream that shakes and sinks, then a sobbing
			// exhale and a last trembling groan.
			{ kind: 'noise', dur: 0.09, cutoff: 2400, filter: 'highpass', attack: 0.01, gain: 0.3 },
			{ kind: 'formant', dur: 0.2, when: 0.05, freq: 320, freqTo: 500, vowel: 'a', attack: 0.01, gain: 0.35 },
			{ kind: 'formant', dur: 0.9, when: 0.22, freq: 500, freqTo: 170, vowel: 'a', attack: 0.02, rate: 7, gain: 0.45 },
			{ kind: 'noise', dur: 1, when: 0.05, cutoff: 1250, cutoffTo: 700, filter: 'bandpass', q: 3, attack: 0.04, gain: 0.55 },
			{ kind: 'noise', dur: 0.9, when: 0.05, cutoff: 3100, cutoffTo: 2000, filter: 'bandpass', q: 4, attack: 0.04, gain: 0.35 },
			{ kind: 'noise', dur: 0.7, when: 0.05, cutoff: 5000, filter: 'highpass', attack: 0.03, gain: 0.12 },
			{ kind: 'noise', dur: 0.55, when: 1.05, cutoff: 700, cutoffTo: 400, filter: 'bandpass', q: 2, attack: 0.08, gain: 0.3 },
			{ kind: 'formant', dur: 0.55, when: 1.1, freq: 140, freqTo: 95, vowel: 'o', attack: 0.06, rate: 5, gain: 0.2 },
		],
	},
	/** A brazier burning (a loop): a low roar of flame with a crackle of wood through it. */
	brazier: {
		gain: 0.15,
		layers: [
			{ kind: 'noise', dur: 1, cutoff: 500, gain: 0.4 },
			{ kind: 'crackle', dur: 1, rate: 25, cutoff: 2200, q: 0.8, gain: 0.9 },
		],
	},
} as const satisfies Record<string, SfxPatch | readonly SfxPatch[]>;

/** Seconds into a swish that it is loudest: play it that long before the blow. */
export const SWISH_PEAK = 0.12;

export type SfxName = keyof typeof SFX;
