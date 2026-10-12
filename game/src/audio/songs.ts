import type { Audio, Score } from '@arc-director/kindling';
import type { Dyn } from '@arc-director/kindling/score';
import { cello, choir, flute, guitar, koto, twelveString } from './hostInstruments';
import MIGHT_TRACK from './herosMight.mp3';
import TALE_TRACK from './herosTale.mp3';
import { bar, piece, reverb, stack, track } from '@arc-director/kindling/score';
import { f, mf, mp, p, pp } from '@arc-director/kindling/score';

export { MENU_SONG_ORCH } from './mainMenuSong';

/** Bass, tenor, alto, soprano. */
type Voicing = [string, string, string, string];

/**
 * Chromatic lament ground in D minor, one chord per 3/4 bar, voice-led like a chorale:
 * the bass falls a half step at a time from tonic to dominant, then cadences home.
 */
const GROUND:Voicing[] = [
	['d3', 'a3', 'd4', 'f4'], // i
	['c#3', 'a3', 'e4', 'g4'], // V6/5
	['c3', 'a3', 'd4', 'f#4'], // V4/2 of iv
	['b2', 'g3', 'd4', 'g4'], // IV6
	['bb2', 'g3', 'd4', 'g4'], // iv6
	['a2', 'a3', 'd4', 'f4'], // cadential 6/4
	['a2', 'g3', 'c#4', 'e4'], // V7
	['d3', 'f3', 'a3', 'd4'], // i
];

/** Descants over the ground, one bar each. Chord tones on the beat, passing tones between. */
const DESCANT = {
	plain: [
		'd5:2 f5:1',
		'e5:2 c#5:1',
		'd5:1 c5:1 a4:1',
		'b4:2 d5:1',
		'bb4:1 a4:1 g4:1',
		'f4:1 a4:1 d5:1',
		'e5:1 d5:1 c#5:1',
		'd5:3',
	],
	florid: [
		'd5:.5 e5:.5 f5:.5 e5:.5 f5:.5 a5:.5',
		'g5:.5 f5:.5 e5:.5 c#5:.5 e5:.5 g5:.5',
		'f#5:.5 e5:.5 d5:.5 c5:.5 a4:.5 c5:.5',
		'b4:.5 d5:.5 g5:.5 d5:.5 b4:.5 d5:.5',
		'bb4:.5 d5:.5 g5:1 bb5:.5 g5:.5',
		'f5:.5 e5:.5 d5:.5 f5:.5 a5:.5 f5:.5',
		'e5:.5 g5:.5 c#5:.5 e5:.5 a4:.5 c#5:.5',
		'd5:3',
	],
};

/**
 * The middle episode, not a variation: the ground stops. A circle of fifths walks down through
 * D minor, then F major turns back onto a dominant pedal that sets up the climax.
 */
const EPISODE:Voicing[] = [
	['d3', 'a3', 'd4', 'f4'], // i
	['g2', 'bb3', 'd4', 'g4'], // iv
	['c3', 'c4', 'e4', 'g4'], // VII
	['f2', 'c4', 'f4', 'a4'], // III
	['bb2', 'd4', 'f4', 'bb4'], // VI
	['e3', 'd4', 'g4', 'bb4'], // iiø7
	['a2', 'c#4', 'e4', 'a4'], // V
	['d3', 'd4', 'f4', 'a4'], // i
	['f2', 'c4', 'f4', 'a4'], // III
	['bb2', 'd4', 'f4', 'bb4'], // VI
	['g2', 'd4', 'g4', 'bb4'], // iv
	['a3', 'c#4', 'e4', 'a4'], // V
	['a2', 'd4', 'f4', 'a4'], // cadential 6/4
	['a2', 'c#4', 'e4', 'g4'], // V7
	['a2', 'd4', 'f4', 'a4'], // cadential 6/4
	['a2', 'c#4', 'e4', 'g4'], // V7
];

/** Cello song over the episode, one bar per chord. */
const EPISODE_TUNE = [
	'f4:2 e4:.5 d4:.5',
	'd4:1 bb3:1 g3:1',
	'e4:2 d4:.5 c4:.5',
	'c4:1 a3:1 f3:1',
	'd4:2 c4:.5 bb3:.5',
	'bb3:1 g3:1 e3:1',
	'c#4:2 e4:1',
	'd4:3',
	'c4:1 f4:1 a4:1',
	'bb4:2 a4:.5 g4:.5',
	'g4:1 d4:1 bb3:1',
	'c#4:1 e4:1 a4:1',
	'f4:2 e4:.5 d4:.5',
	'c#4:2 e4:1',
	'f4:1 a4:1 d5:1',
	'c#5:1 a4:1 g4:1',
];

/** One volume per instrument; the flags pick what each instrument plays on top of the ground. */
type Variation = {
	cello:Dyn;
	choir?:Dyn;
	guitar?:Dyn;
	/** Cello-suite string crossing through the chord. */
	crossing?:boolean;
	/** Choir sings the chorale under its line. */
	chorale?:boolean;
	descant?:keyof typeof DESCANT;
	/** Solo cello line, one bar each. */
	tune?:string[];
};

/**
 * Each pitch rings until it is plucked again, like an open string under the fingers.
 * `.` skips a step; `d3+d4` plucks both at once.
 */
function fingers(picks:string[], step:number):string[] {
	const total = picks.length * step;
	const hits = new Map<string, number[]>();
	picks.forEach((pick, i) => {
		for (const pitch of pick === '.' ? [] : pick.split('+')) {
			hits.set(pitch, [...(hits.get(pitch) ?? []), i * step]);
		}
	});
	return [...hits].map(([pitch, at]) => {
		const out:string[] = [];
		let beat = 0;
		at.forEach((start, k) => {
			if (start > beat) {
				out.push(`r:${start - beat}`);
			}
			beat = at[k + 1] ?? total;
			out.push(`${pitch}:${beat - start}`);
		});
		return out.join(' ');
	});
}

function octave(pitch:string, by:number):string {
	return pitch.replace(/\d+$/, (o) => String(Number(o) + by));
}

/** Well-Tempered prelude figure on the twelve-string: bass, then the upper voices an octave up. */
function broken([b, t, a, s]:Voicing):string[] {
	const beat = [b, octave(t, 1), octave(s, 1), octave(a, 1)];
	return fingers([...beat, ...beat, ...beat], 0.25);
}

/** Cello-suite bariolage: up through the chord and back, twice a bar. */
function bariolage([b, t, a, s]:Voicing):string {
	return [b, t, a, s, a, t, b, t, a, s, a, t].map((n) => `${n}:.25`).join(' ');
}

/**
 * A passacaglia in D minor after Bach: a chromatic lament ground under four variations, with
 * a free episode before the climax. Well-Tempered broken chords, cello string crossing with a
 * descant, the episode, a florid full climax, then the strings sinking home.
 */
function dungeonTheme():Score {
	const strings = track(cello, { gain: 0.5, dynamic: mp });
	const voices = track(choir, { gain: 0.5, dynamic: p });
	const twelve = track(twelveString, { gain: 0.72, dynamic: p });

	const variation = (v:Variation, chords = GROUND) => chords.map((chord, i) => {
		const [b, t, a, s] = chord;
		return bar(
			3,
			strings(`${b}:3`, v.cello),
			strings(`${octave(b, -1)}:3`),
			...(v.crossing ? [strings(bariolage(chord))] : []),
			...(v.tune ? [strings(v.tune[i]!)] : []),
			...(v.choir && v.chorale ? [voices(stack([t, a, s], 3), v.choir)] : []),
			...(v.choir && v.descant ? [voices(DESCANT[v.descant][i]!, v.choir)] : []),
			...(v.guitar ? broken(chord).map((line) => twelve(line, v.guitar!)) : []),
		);
	});

	return piece({ bpm: 60, gain: 0.9, id: 'dungeon_vault', filters: [reverb({ mix: 0.36, decay: 0.52, tone: 1900 })] }, [
		// I. The twelve-string breaks the chords.
		...variation({ cello: pp, choir: p, chorale: true, guitar: mp }),
		// II. Cello string crossing and a descant.
		...variation({ cello: mf, crossing: true, choir: mf, descant: 'plain', guitar: p }),
		// Episode: the ground breaks off; a cello sings down the circle of fifths onto the dominant.
		...variation({ cello: mp, tune: EPISODE_TUNE, choir: pp, chorale: true, guitar: p }, EPISODE),
		// III. Everything: florid descant over the full chorale.
		...variation({ cello: f, crossing: true, choir: mf, chorale: true, descant: 'florid', guitar: mf }),
		// IV. Only the strings and the ground, sinking home.
		...variation({ cello: mp, choir: pp, chorale: true, guitar: p }),
	]);
}

/** Strings struck one after another from the first, every one ringing to the end of the bar. */
function roll(pitches:readonly string[], beats:number, step:number):string[] {
	return pitches.map((pitch, i) => `${i ? `r:${i * step} ` : ''}${pitch}:${beats - i * step}`);
}

/** Ryo, the bright gagaku pentatonic (the major pentatonic), on D: D E F♯ A B across thirteen strings. */
const RYO = ['d3', 'e3', 'f#3', 'a3', 'b3', 'd4', 'e4', 'f#4', 'a4', 'b4', 'd5', 'e5', 'f#5'];

const SWEEP = 0.05;

/** Sararin: a sweep across the koto from one string to another (`a5>d3`), each left ringing. */
function sweep(span:string, beats:number):string[] {
	const [from, to] = span.split('>').map((pitch) => RYO.indexOf(pitch));
	if (from === undefined || to === undefined || from < 0 || to < 0) {
		throw new Error(`sweep ${span}: both ends must be koto strings`);
	}
	const run = RYO.slice(Math.min(from, to), Math.max(from, to) + 1);
	return roll(from > to ? run.reverse() : run, beats, SWEEP);
}

/** A rocking koto figure: a high string, then two below it, `times` over. */
function rock(high:string, low:string, mid:string, times:number):string {
	return Array<string>(times).fill(`${high} ${low} ${mid} ${low}`).join(' ');
}

/** Koto picks (see `fingers`) spread evenly over a bar. */
function spread(picks:string, beats:number):string[] {
	const steps = picks.split(' ');
	return fingers(steps, beats / steps.length);
}

/** Koto voicings on the ryo strings: low, middle, octave, top. With no G or C♯ string, G rings as a G6 and A as an open fifth. */
const KOTO_CHORDS:Record<string, Voicing> = {
	D: ['d3', 'a3', 'd4', 'f#4'],
	G: ['b3', 'd4', 'e4', 'b4'],
	A: ['a3', 'e4', 'a4', 'b4'],
	Bm: ['b3', 'f#4', 'b4', 'd5'],
	Em: ['e3', 'b3', 'e4', 'b4'],
};

/** How the koto plays a chord: a few plucks, a rocking eighth-note figure, or rushing sixteenths. */
const FIGURES = {
	pluck: ([b, t, a]:Voicing) => `${b}+${a} . . . ${t} . . .`,
	rock: ([, t, a, s]:Voicing) => rock(s, t, a, 2),
	rush: ([, t, a, s]:Voicing) => rock(s, t, a, 4),
};

/** Open-position guitar chords: bass, alternate bass, two treble strings. */
const GUITAR_CHORDS:Record<string, Voicing> = {
	D: ['d3', 'a3', 'd4', 'f#4'],
	G: ['g2', 'd3', 'b3', 'g4'],
	A: ['a2', 'e3', 'c#4', 'e4'],
	Bm: ['b2', 'f#3', 'd4', 'f#4'],
	Em: ['e2', 'b2', 'g3', 'e4'],
};

/** Country boom-chick: the bass on one and three, a short strum on two and four. */
function boomChick([b, t, a, s]:Voicing):string[] {
	return [`${b}:1 r:1 ${t}:1 r:1`, `r:1 ${a}:.4 r:1.6 ${a}:.4`, `r:1.03 ${s}:.37 r:1.63 ${s}:.37`];
}

/** One 4/4 bar of the glen theme: its chord, the flute's tune, and a koto sweep in place of the figure. */
type GlenBar = [chord:string, tune?:string, sweep?:string];

/** What plays in a pass: the koto's figure and touch, and whether the flute and the guitar join. */
type GlenPass = { koto:keyof typeof FIGURES; touch:Dyn; flute?:boolean; guitar?:boolean };

/** One sweep up the whole koto, then straight into the theme. */
const GLEN_INTRO:GlenBar[] = [['D', undefined, 'd3>f#5']];

/** The theme leaps like an overworld call, settles on A, climbs to the top B, and comes home. */
const GLEN_THEME:GlenBar[] = [
	['D', 'd5:1.5 a4:.5 d5:1 f#5:1'],
	['G', 'g5:1.5 f#5:.5 e5:1 d5:1'],
	['D', 'f#5:1 e5:.5 d5:.5 a4:2'],
	['A', 'e5:3 r:1'],
	['Bm', 'f#5:1.5 d5:.5 b4:1 d5:1'],
	['G', 'g5:1.5 a5:.5 b5:1 g5:1'],
	['A', 'a5:1 f#5:.5 e5:.5 c#5:1 e5:1'],
	['D', 'd5:3 r:1'],
];

/** The bridge starts on G and climbs in two waves to C♯, leaning into the summit. */
const GLEN_RISE:GlenBar[] = [
	['G', 'b4:1 d5:1 g5:2'],
	['D', 'f#5:1 e5:1 d5:2'],
	['Em', 'e5:1 g5:1 b5:1.5 a5:.5'],
	['A', 'a5:3 r:1'],
	['G', 'b5:1 a5:1 g5:2'],
	['D', 'a5:1 f#5:1 d5:2'],
	['Em', 'e5:1.5 f#5:.5 g5:1 b5:1'],
	['A', 'a5:2 b5:1 c#6:1'],
];

/** The summit: long high tones over rushing koto, released by a sweep down every string. */
const GLEN_SUMMIT:GlenBar[] = [
	['D', 'd6:3 a5:1'],
	['G', 'b5:2 g5:2'],
	['Bm', 'f#5:2 b5:2'],
	['A', 'a5:3 r:1'],
	['D', 'd6:2 a5:1 f#5:1'],
	['G', 'b5:2 d6:2'],
	['A', 'e5:1 a5:1 c#6:2'],
	['D', 'd6:4', 'f#5>d3'],
];

const GLEN_HOME:GlenBar[] = [['G'], ['D']];

/**
 * The glen: koto fused with country folk and an open-world adventure theme. The koto keeps its
 * sweeps, rocking figures and rushing climax, but plays the bright ryo pentatonic over country
 * chords; a wooden flute sings a leaping theme; a guitar joins with a boom-chick. Busy parts
 * play softer (`hush`). One koto sweep,
 * the theme, the theme again with guitar, a climbing bridge, the summit, then the theme softly
 * and home.
 */
function glenTheme():Score {
	const strings = track(koto, { gain: 0.8 });
	const whistle = track(flute, { gain: 0.8, dynamic: mf });
	const strum = track(guitar, { gain: 0.55, dynamic: mp });

	const strain = (rows:GlenBar[], pass:GlenPass) => rows.map(([name, tune, span]) => {
		const plucks = span ? sweep(span, 4) : spread(FIGURES[pass.koto](KOTO_CHORDS[name]!), 4);
		const chick = pass.guitar ? boomChick(GUITAR_CHORDS[name]!) : [];
		const touch = hush(pass.touch, plucks, 4);
		return bar(
			4,
			...plucks.map((line) => strings(line, touch)),
			...chick.map((line) => strum(line, hush(mf, chick, 4))),
			...(pass.flute && tune ? [whistle(tune, hush(mf, [tune], 4))] : []),
		);
	});

	return piece({ bpm: 96, gain: 0.9, id: 'glen', filters: [reverb({ mix: 0.4, decay: 0.3, size: 0.8 })] }, [
		...strain(GLEN_INTRO, { koto: 'pluck', touch: f }),
		...strain(GLEN_THEME, { koto: 'rock', touch: mf, flute: true }),
		...strain(GLEN_THEME, { koto: 'rock', touch: mf, flute: true, guitar: true }),
		...strain(GLEN_RISE, { koto: 'rock', touch: mf, flute: true, guitar: true }),
		...strain(GLEN_SUMMIT, { koto: 'rush', touch: f, flute: true, guitar: true }),
		...strain(GLEN_THEME, { koto: 'pluck', touch: mp, flute: true }),
		...strain(GLEN_HOME, { koto: 'pluck', touch: p }),
	]);
}

const LOUDNESS:Dyn[] = [pp, p, mp, mf, f];

/**
 * `base`, one step softer for each doubling of the lines' notes per beat past one, so a busy
 * part sits under a slow one instead of drowning it.
 */
function hush(base:Dyn, lines:string[], beats:number):Dyn {
	const notes = lines.join(' ').split(/\s+/).filter((token) => token && !token.startsWith('r:')).length;
	const softer = Math.max(0, Math.round(Math.log2(notes / beats)));
	return LOUDNESS[Math.max(0, LOUDNESS.indexOf(base) - softer)] ?? pp;
}

export const SONGS:Record<string, Score> = {
	dungeon_vault: dungeonTheme(),
	glen: glenTheme(),
};

/** 5v5 Combat plays the Hero's Might recording. Other scenes play a score. */
export function startSceneMusic(audio:Audio, sceneID:string):void {
	if (sceneID === 'ruins') {
		void audio.playRecording(MIGHT_TRACK, 1, 'heros_might', { start: 7.35, end: 115.8 });
		return;
	}
	if (sceneID === 'marketplace') {
		void audio.playRecording(TALE_TRACK, 1, 'heros_tale', { start: 24.6, end: 168 });
		return;
	}
	void audio.playMusic(SONGS[sceneID] ?? SONGS.dungeon_vault);
}
