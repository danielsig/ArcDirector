import { patchSeconds } from './synth.js';
import type { SfxLayer, SfxPatch } from './types.js';

/** How a character sounds when it talks. Every field is optional; see `DEFAULT_VOICE`. */
export type SpeechVoice = {
	/** Speaking pitch in Hz: about 170–240 for a cute low voice, 300–420 for a mouse-like high one. Default 220. */
	pitch?:number;
	/** Syllables per second. */
	rate?:number;
	/** How far the pitch moves: 0 is a monotone, 1 ordinary speech, 2 sing-song. */
	range?:number;
};

const DEFAULT_VOICE:Required<SpeechVoice> = { pitch: 220, rate: 5.5, range: 1 };

/** Major pentatonic, in semitones above the voice's pitch: every syllable lands on one of these, so a line is a little tune. */
const PENTATONIC = [0, 2, 4, 7, 9, 12];

/**
 * The vowel sounds `respell` writes, one letter each, as a regex class: lowercase for the short
 * vowels (cat, bed, sit, hot, cup), `ə` for a slurred "uh", and capitals for the rest: A say,
 * E see, I my, O go, U too, W how, Y boy, H car, Q saw, R her.
 */
const VOWEL = '[aeiouəAEIOUWYHQR]';
/** The rounded and slurred vowels, spoken as "boo" (beau-ti-ful is boo-bee-boo); every other one is a "bee". */
const ROUNDED = /[ouəOUWYQR]/;
/** The two sounds every vowel becomes, `bee` and `boo`. `step` is semitones off the sentence's pitch. */
const VOWELS = {
	ee: { kind: 'bee', step: 2 },
	oo: { kind: 'boo', step: -2 },
} as const;
/** How far each syllable's pitch glides toward the next one's, so it rises or falls with the words. */
const GLIDE = 0.8;
/** Each word's own lilt: up to this share up or down through its syllables, the same every time it is said. */
const LILT = 0.12;
/** Any consonant letter, as a regex class. */
const CONSONANT = '[b-df-hj-np-tv-z]';
/** A respelled syllable: its consonants, then one vowel sound. */
const SYLLABLE = new RegExp(`[^${VOWEL.slice(1, -1)}]*${VOWEL}`, 'g');

/** One find-and-replace step of a spelling rule. In `find`, `C` stands for any consonant and `V` for any vowel sound. */
function rule(find:string, sound:string):readonly [RegExp, string] {
	return [new RegExp(find.replace(/C/g, CONSONANT).replace(/V/g, VOWEL), 'g'), sound];
}

/**
 * Ten rules that read most English aloud, each a few find-and-replace steps run in order by
 * `respell`. Rules write sounds as `VOWEL` letters and only ever match lowercase, so a sound
 * once found stays found. A vowel letter no rule touches is short (cat, bed, sit, hot, cup).
 * Rule 10 is `IRREGULAR`.
 */
const RULES = [
	// 1. Consonants: a doubled letter is one sound (happy); ck is k, ph f, wh w, qu kw; c and g soften before e (city, nice, page).
	rule('(C)\\1', '$1'), rule('ck', 'k'), rule('ph', 'f'), rule('wh', 'w'), rule('qu', 'kw'), rule('c(?=[eiy])', 's'), rule('g(?=es?$)', 'j'),
	// 2. Silent letters: knee, gnome, write, lamb; gh is silent, or lengthens the vowel before it (night, eight, caught, thought).
	rule('^[kg]n', 'n'), rule('^wr', 'r'), rule('mb$', 'm'), rule('eigh', 'A'), rule('igh', 'I'), rule('[ao]ugh(?=t)', 'Q'), rule('gh', ''),
	// 3. Weak syllables slur to "uh": nation, nature, gorgeous, delicious, famous, careful, animal, table, moment, silence,
	// an "er" between vowels after the first syllable (interesting, different, every), and a leading a before one consonant (about, away).
	rule('[st]ion', 'shən'), rule('ture', 'chər'), rule('g[ei]ous$', 'jəs'), rule('(?:[cs]i|[ct]e|ti|xi)ous$', 'shəs'), rule('ous$', 'əs'),
	rule('ful$', 'fəl'), rule('(?<=V.*)al$', 'əl'), rule('(?<=V.*C)er(?=[aiouyə]|e(?!$))', 'ər'), rule('(?<=V.*)en(?=t$|se$)', 'ən'),
	rule('(C)le(?=[sd]?$)', '$1əl'), rule('^a(?=C[aeiou])', 'ə'),
	// 4. Vowel teams, two letters for one sound: see, sea, rain, day, boat, moon, coin, boy, cause, saw, new, blue, pie, field, key, out, down, cow, snow.
	rule('eau', 'U'), rule('e[ea]', 'E'), rule('a[iy]', 'A'), rule('oa', 'O'), rule('oo', 'U'), rule('o[iy]', 'Y'), rule('a[uw]', 'Q'), rule('ew|ue', 'U'),
	rule('ie$', 'I'), rule('ie', 'E'), rule('ey$', 'E'), rule('ou', 'W'), rule('ow(?=[nl]|er)', 'W'), rule('^(C?)ow$', '$1W'), rule('ow', 'O'),
	// 5. Open syllables: a short word ending on its only vowel says that vowel's name (go, he, she, hi).
	rule('^(C*)o$', '$1O'), rule('^(C*)e$', '$1E'), rule('^(C*)i$', '$1I'),
	// 6. Silent e: a vowel, one consonant and a final e: the vowel says its name (sale, here, mere, severe, mine, home, cute, makes, named).
	rule('a(?=Ce[sd]?$)', 'A'), rule('e(?=Ce[sd]?$)', 'E'), rule('i(?=Ce[sd]?$)', 'I'), rule('o(?=Ce[sd]?$)', 'O'), rule('u(?=Ce[sd]?$)', 'U'),
	// 7. Silent endings: a final e after a consonant (sale, leave, house), -es but after a hiss (makes, not races), and -ed but after t or d (played, not wanted).
	rule('(?<=V.*C)e$', ''), rule('(?<=V.*C)(?<![sxzj]|[cs]h)es$', 's'), rule('(?<=V.*)(?<![td])ed$', 'd'),
	// 8. R and L color the vowel before them: car, for, her, bird, turn, war, word; all, walk, salt.
	rule('(?<=w)ar(?!V|y)', 'Qr'), rule('(?<=w)or(?!V|y)', 'R'), rule('ar(?!V|y)', 'Hr'), rule('or(?!V|y)', 'Qr'), rule('[eiu]r(?!V|y)', 'R'),
	rule('a(?=l(C|$))', 'Q'),
	// 9. Y is a vowel at a word's end (my, fly; happy, very) or between consonants (gym), and a consonant elsewhere (yes, beyond).
	rule('^(C+)y$', '$1I'), rule('y$', 'E'), rule('(?<=C)y(?=C)', 'i'),
];

/** 10. Common words the rules read wrong, already respelled. */
const IRREGULAR:Record<string, string> = {
	have: 'hav', give: 'giv', live: 'liv', love: 'luv', above: 'əbuv', come: 'kum', some: 'sum', done: 'dun', none: 'nun',
	one: 'wun', once: 'wuns', gone: 'gon', were: 'wR', there: 'ther', where: 'wer', are: 'Hr', you: 'yU', your: 'yQr',
	four: 'fQr', through: 'thrU', though: 'thO', enough: 'ənuf', young: 'yung', what: 'wut', was: 'wuz', of: 'uv',
	said: 'sed', says: 'sez', does: 'duz', do: 'dU', to: 'tU', two: 'tU', who: 'hU', they: 'thA', know: 'nO', been: 'bin',
	could: 'kud', would: 'wud', should: 'shud', friend: 'frend', people: 'pEpəl', many: 'menE', any: 'enE', move: 'mUv',
	great: 'grAt', head: 'hed', ready: 'redE', other: 'uthR', mother: 'muthR', dont: 'dOnt', wont: 'wOnt', eye: 'I',
};

/** `word` as one letter per sound: lowercase consonants and the vowel sounds of `VOWEL`. */
export function respell(word:string):string {
	return IRREGULAR[word] ?? RULES.reduce((w, [find, sound]) => w.replace(find, sound), word);
}

const COMMA_GAP = 0.1;
const SENTENCE_GAP = 0.2;
/** A `bee` or `boo` fills this share of its syllable's time; the rest is the tiny break between them. */
const SOUNDING = 0.6;
/** Syllables sound this many times above the speaking pitch: a small creature's register. */
const REGISTER = 2;
/** Loudness of a stressed syllable. */
const LOUD = 0.12;

/** Little words English speakers rush: short, unstressed. */
const FUNCTION_WORDS = new Set([
	'a', 'an', 'the', 'to', 'of', 'and', 'or', 'but', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'as', 'than',
	'is', 'am', 'are', 'was', 'were', 'be', 'it', 'its', 'i', 'you', 'he', 'she', 'we', 'they', 'me', 'him', 'her',
	'us', 'them', 'my', 'your', 'his', 'our', 'their', 'that', 'this', 'if', 'so', 'do', 'not', 'can', 'will', 'just',
]);
/** Function words whose vowel slurs to a neutral "uh". */
const SLURRED = new Set(['a', 'an', 'the', 'to', 'of', 'and', 'or', 'but', 'for', 'from', 'as', 'than']);
/** A vowel lasts longer before a voiced consonant (bad, seen) than before a voiceless one (bat, seat). */
const VOICED_NEXT = /[bdgvzmnlrwj]/;
const VOICELESS_NEXT = /[ptkfscxh]/;

type End = '.' | '!' | '?';
/**
 * `sound` is a `VOWEL` letter, and `word` the word it is in. `length` scales the syllable's
 * time: rushed function words, long vowels, stress, and the consonant that follows. `gap` is
 * silence after it: none inside a sentence, some at a comma or full stop.
 */
type Syllable = { sound:string; word:string; stressed:boolean; length:number; gap:number; end?:End };

/**
 * A spoken line as a babble patch for `Audio.playSfx`, the way Animal Crossing talks: one
 * short syllable an octave up (`REGISTER`) per syllable of the text, a `boo` for a rounded
 * vowel as `respell` reads it and a `bee` for any other (`VOWELS`).
 * Pitch drifts down through each sentence and lifts on stressed syllables, every syllable landing
 * on the pentatonic scale. Each syllable glides toward the next (`GLIDE`), with its word's own
 * lilt (`LILT`), so it rises or falls with the words; the last one rises at a question and
 * falls hard at an exclamation.
 * Every syllable is spoken at the voice's own rate, or, given `seconds`,
 * sped up or slowed down to last exactly that long (to match a speech bubble). A line always
 * sounds the same.
 */
export function speech(text:string, voice:SpeechVoice = {}, seconds?:number):SfxPatch {
	const v = { ...DEFAULT_VOICE, ...voice };
	const swing = (ratio:number):number => 1 + v.range * (ratio - 1);
	const semis = (n:number):number => swing(Math.pow(2, n / 12));
	const layers:SfxLayer[] = [];
	let at = 0;
	for (const sentence of sentences(parse(text))) {
		const end = sentence[sentence.length - 1]!.end ?? '.';
		const vowels = sentence.map((s) => (ROUNDED.test(s.sound) ? VOWELS.oo : VOWELS.ee));
		const pitches = sentence.map((s, k) => {
			const progress = sentence.length > 1 ? k / (sentence.length - 1) : 1;
			const lift = swing(s.stressed ? 1.06 : 1) * swing(end === '!' ? 1.1 : 1) * swing(wobble(`${k}${s.sound}`, 0.06));
			return REGISTER * tune(v.pitch * swing(1.08 - 0.2 * progress) * lift * semis(vowels[k]!.step), v.pitch);
		});
		sentence.forEach((s, k) => {
			const freq = pitches[k]!;
			const next = pitches[k + 1];
			// The last syllable of a sentence carries its intonation; the rest lean toward what comes next.
			const bend = next === undefined
				? swing(end === '?' ? 1.25 : end === '!' ? 0.85 : 0.9)
				: Math.pow(next / freq, GLIDE) * swing(wobble(s.word, LILT));
			const slot = slotOf(s, v.rate);
			const gain = LOUD * (s.stressed ? 1 : 0.8) * (end === '!' ? 1.2 : 1);
			layers.push({ kind: vowels[k]!.kind, when: at, dur: slot * SOUNDING, freq, freqTo: freq * bend, gain });
			at += slot + s.gap;
		});
	}
	const line = { gain: 0.85, layers };
	return seconds ? stretch(line, seconds / patchSeconds(line)) : line;
}

/** The same patch played `by` times as long: every start and length scaled. */
function stretch(patch:SfxPatch, by:number):SfxPatch {
	return {
		...patch,
		layers: patch.layers.map((layer) => ({ ...layer, when: (layer.when ?? 0) * by, dur: layer.dur * by })),
	};
}

/**
 * A stable, varied voice for `seed` (a character's id, say): its own pitch within `pitch` Hz,
 * pace and lilt. Pass a lower range for a man's voice (about 170–240) or a high, mouse-like
 * one for a woman's (about 300–420).
 */
export function voiceFor(seed:string, pitch:readonly [low:number, high:number] = [160, 300]):Required<SpeechVoice> {
	const roll = (trait:string):number => (hash(`${seed}/${trait}`) % 1000) / 999;
	return {
		pitch: pitch[0] + (pitch[1] - pitch[0]) * roll('pitch'),
		rate: 4.8 + 1.6 * roll('rate'),
		range: 0.75 + 0.6 * roll('range'),
	};
}

/** `hz` moved onto the nearest pentatonic note on `root`. */
function tune(hz:number, root:number):number {
	const semis = 12 * Math.log2(hz / root);
	const octave = Math.floor(semis / 12) * 12;
	const note = octave + PENTATONIC.reduce((best, n) => (Math.abs(octave + n - semis) < Math.abs(octave + best - semis) ? n : best));
	return root * Math.pow(2, note / 12);
}

function parse(text:string):Syllable[] {
	const out:Syllable[] = [];
	for (const token of text.toLowerCase().match(/[a-z']+|\d+|[.!?]+|[,;:—–]/g) ?? []) {
		const prev = out[out.length - 1];
		if (/^[.!?]/.test(token)) {
			if (prev) {
				prev.end = token.includes('?') ? '?' : token.includes('!') ? '!' : '.';
				prev.gap = SENTENCE_GAP;
			}
			continue;
		}
		if (/^[,;:—–]/.test(token)) {
			if (prev) {
				prev.gap = Math.max(prev.gap, COMMA_GAP);
			}
			continue;
		}
		const word = respell(token.replace(/'/g, ''));
		const parts = word.match(SYLLABLE) ?? [`${word}ə`];
		const rushed = FUNCTION_WORDS.has(token);
		let end = 0;
		parts.forEach((part, i) => {
			const sound = SLURRED.has(token) ? 'ə' : part.slice(-1);
			const last = i === parts.length - 1;
			const stressed = i === 0 && !rushed && token.length > 2;
			end += part.length;
			const next = word.charAt(end);
			const long = sound !== sound.toLowerCase();
			const follow = VOICED_NEXT.test(next) ? 1.2 : VOICELESS_NEXT.test(next) ? 0.85 : last ? 1.25 : 1;
			out.push({
				sound,
				word: token,
				stressed,
				length: rushed ? 0.55 : (stressed ? 1.25 : 1) * (long ? 1.6 : 1) * follow,
				gap: 0,
			});
		});
	}
	const last = out[out.length - 1];
	if (last && !last.end) {
		last.end = '.';
		last.gap = SENTENCE_GAP;
	}
	return out;
}

/** Seconds a syllable takes before its gap: its `length`, stretched before a pause. */
function slotOf(s:Syllable, rate:number):number {
	return s.length * (s.gap ? 1.35 : 1) / rate;
}

/** Split after every syllable that ends a sentence. */
function sentences(syllables:Syllable[]):Syllable[][] {
	const out:Syllable[][] = [[]];
	for (const s of syllables) {
		out[out.length - 1]!.push(s);
		if (s.end) {
			out.push([]);
		}
	}
	return out.filter((group) => group.length > 0);
}

/** A steady factor within ±`amount` of 1, picked by `seed`. */
function wobble(seed:string, amount:number):number {
	return 1 + amount * ((hash(seed) % 201) / 100 - 1);
}

/** FNV-1a. */
function hash(seed:string):number {
	let h = 2166136261;
	for (let i = 0; i < seed.length; i++) {
		h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
	}
	return h >>> 0;
}
