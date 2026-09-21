import type { SfxPatch } from '@arc-director/kindling';

export const SFX = {
	stepStone: {
		gain: 0.7,
		layers: [
			{ kind: 'thump', dur: 0.07, freq: 92, gain: 0.55 },
			{ kind: 'noise', dur: 0.05, cutoff: 620, q: 0.8, gain: 0.45 },
		],
	},
	stepDirt: {
		gain: 0.62,
		layers: [
			{ kind: 'thump', dur: 0.08, freq: 70, gain: 0.4 },
			{ kind: 'noise', dur: 0.07, cutoff: 380, gain: 0.5 },
		],
	},
	stepWood: {
		gain: 0.66,
		layers: [
			{ kind: 'click', dur: 0.035, freq: 420, cutoff: 1800, gain: 0.4 },
			{ kind: 'thump', dur: 0.06, freq: 110, gain: 0.45 },
		],
	},
	talk: {
		gain: 0.85,
		layers: [{ kind: 'murmur', dur: 0.9, freq: 160, gain: 1 }],
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
} as const satisfies Record<string, SfxPatch>;

export type SfxName = keyof typeof SFX;
