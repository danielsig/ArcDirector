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
			{ kind: 'creak', dur: 0.22, freq: 6000 + rand() * 1200, freqTo: 3800, q: 1, gain: 0.2 },
			{ kind: 'creak', dur: 0.26, freq: 4600 + rand() * 800, freqTo: 3000, q: 1.4, when: 0.05, gain: 0.11 },
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
			{ kind: 'creak', dur: 0.48, freq: 420, freqTo: 160, q: 7, gain: 0.7 },
			{ kind: 'thump', dur: 0.12, freq: 90, when: 0.02, gain: 0.35 },
		],
	},
	doorClose: {
		gain: 0.95,
		layers: [
			{ kind: 'creak', dur: 0.22, freq: 240, freqTo: 140, q: 5, gain: 0.4 },
			{ kind: 'thump', dur: 0.14, freq: 78, when: 0.08, gain: 0.8 },
			{ kind: 'click', dur: 0.04, freq: 280, when: 0.16, gain: 0.35 },
		],
	},
	chestOpen: {
		gain: 0.88,
		layers: [
			{ kind: 'creak', dur: 0.28, freq: 520, freqTo: 220, q: 5, gain: 0.45 },
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
		layers: [
			{ kind: 'thump', dur: 0.11, freq: 88, gain: 0.95 },
			{ kind: 'thump', dur: 0.08, freq: 48, when: 0.02, gain: 0.7 },
			{ kind: 'click', dur: 0.05, freq: 210, cutoff: 780, gain: 0.55 },
			{ kind: 'noise', dur: 0.07, cutoff: 320, gain: 0.32 },
		],
	},
} as const satisfies Record<string, SfxPatch | readonly SfxPatch[]>;

export type SfxName = keyof typeof SFX;
