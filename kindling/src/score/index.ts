import { instrumentOf, type InstrumentEnvelope } from '../audio/instruments.js';
import { scoreProblems } from '../audio/midi.js';
import type { Note, Score, SoundFilter, Voice } from '../audio/types.js';

export {
	registerInstrument,
	pad, pluck, lead, bass, bell, drum, air, piano,
	violin, cello, brass, flute, guitar, twelveString, koto, choir,
	type InstrumentEnvelope,
	type InstrumentPlay,
} from '../audio/instruments.js';
export { overdrive, reverb } from '../audio/filters.js';
export type { OverdriveFilter, ReverbFilter, SoundFilter } from '../audio/types.js';

const STEP:Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

const SUFFIX:Record<string, number[]> = {
	'': [0, 4, 7],
	m: [0, 3, 7],
	'-': [0, 3, 7],
	min: [0, 3, 7],
	dim: [0, 3, 6],
	aug: [0, 4, 8],
	'+': [0, 4, 8],
	sus2: [0, 2, 7],
	sus4: [0, 5, 7],
	'7': [0, 4, 7, 10],
	maj7: [0, 4, 7, 11],
	m7: [0, 3, 7, 10],
	'-7': [0, 3, 7, 10],
	m7b5: [0, 3, 6, 10],
};

const VEL:Record<string, number> = { pp: 0.22, p: 0.38, mp: 0.52, mf: 0.68, f: 0.84, ff: 0.96 };
const NAMES = ['pp', 'p', 'mp', 'mf', 'f', 'ff'] as const;
type DynName = (typeof NAMES)[number];

export type Dyn = { readonly d:1; name:DynName };
type Hair = { readonly h:1; dir:'up' | 'down'; to?:Dyn };
type Block = { readonly b:1; pitches:number[]; beats?:number };
type Tone = number | string;
export type ChordBlock = Block & {
	/** Every chord tone from `from` through `to`. Number is an index; string is a note. */
	range(from:Tone, to:Tone):ChordBlock;
	/** Keep those tones. Number is an index; string is a note. */
	include(...tones:Tone[]):Block;
	/** Drop those tones from the current span. Number is an index; string is a note. */
	exclude(...tones:Tone[]):Block;
};
export type Arpeggio = { readonly a:1; pitches:number[]; beats?:number; step:number };
type Mark = Dyn | Hair;
type Matter = string | Block | Arpeggio;
type Chunk = { matters:Matter[]; mark?:Mark };
export type Part = { readonly p:1; track:Track; chunks:Chunk[] };
export type Bar = { readonly bar:1; beats:number; parts:Part[] };
type Start = { readonly s:1 };
type End = { readonly e:1 };
type Call = { readonly cb:1; fn:()=>void };
export type Track = ((...args:CallArg[])=>Part) & {
	instrument:string;
	gain?:number;
	cutoff?:number;
	transpose?:number;
	dynamic?:Dyn;
	envelope?:InstrumentEnvelope;
	filters?:SoundFilter[];
};
type CallArg = Matter | Mark | Matter[];
type Playback = {
	readonly play:1;
	bars:Bar[];
	with:(...parts:Part[])=>Playback;
	without:(...tracks:Track[])=>Playback;
};
type Phrase = ((...bars:Bar[])=>Playback) & {
	with:(...parts:Part[])=>Playback;
	without:(...tracks:Track[])=>Playback;
};
type Event = Bar | Playback | Start | End | Call;

export function pitch(tok:string):number {
	if (/[!>]/.test(tok)) {
		throw new Error(`no accent suffix in ${tok}`);
	}
	const m = /^([a-g])([#b]?)(-?\d+)$/i.exec(tok.trim());
	if (!m?.[1] || m[3] === undefined) {
		throw new Error(`bad pitch ${tok}`);
	}
	const step = STEP[m[1].toLowerCase()];
	if (step === undefined) {
		throw new Error(`bad pitch ${tok}`);
	}
	return (Number(m[3]) + 1) * 12 + step + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

function tokens(src:string):string[] {
	return src.split(/\s+/).filter(Boolean);
}

function atom(raw:string, dur:number):{ pitch:number | null; dur:number } {
	if (raw === 'r' || raw === '.') {
		return { pitch: null, dur };
	}
	return { pitch: pitch(raw), dur };
}

function timed(raw:string):{ pitch:number | null; dur:number } {
	const split = raw.split(':');
	const dur = Number(split[1]);
	if (!Number.isFinite(dur) || dur <= 0) {
		throw new Error(`bad duration in ${raw}`);
	}
	return atom(split[0] ?? '', dur);
}

function parseCell(toks:string[]):{ pitch:number | null; dur:number }[] {
	const colon = toks.some((t) => t.includes(':'));
	const bare = toks.some((t) => !t.includes(':'));
	if (colon && bare) {
		throw new Error(`mix :n and durationless in ${toks.join(' ')}`);
	}
	if (!colon) {
		const d = 1 / toks.length;
		return toks.map((t) => atom(t, d));
	}
	return toks.map(timed);
}

/** `d4:2 e4:1 r:1 | f4:4` — `|` visual when timed. Durationless cells split one beat. `r` / `.` is a rest (`r:4` = four beats of silence). */
export function line(src:string, start = 0, vel?:number):Note[] {
	const cells = src.includes('|') ? src.split('|') : [src];
	const ev:{ pitch:number | null; dur:number }[] = [];
	for (const cell of cells) {
		const toks = tokens(cell);
		if (toks.length) {
			ev.push(...parseCell(toks));
		}
	}
	const notes:Note[] = [];
	let beat = start;
	for (const e of ev) {
		if (e.pitch !== null) {
			notes.push({ pitch: e.pitch, beat, dur: e.dur, vel });
		}
		beat += e.dur;
	}
	return notes;
}

function lineSpan(src:string):number {
	return line(src).reduce((end, n) => Math.max(end, n.beat + n.dur), 0);
}

function parseChord(symbol:string):number[] {
	const m = /^([A-G])([#b]?)(.*)$/.exec(symbol.trim());
	if (!m?.[1]) {
		throw new Error(`bad chord ${symbol}`);
	}
	let rest = m[3] ?? '';
	let oct = 3;
	const octHit = rest.match(/^(.*)(\d)$/);
	if (SUFFIX[rest] === undefined && octHit && SUFFIX[octHit[1]] !== undefined) {
		rest = octHit[1] ?? '';
		oct = Number(octHit[2]);
	}
	const iv = SUFFIX[rest];
	if (!iv) {
		throw new Error(`bad chord suffix ${symbol}`);
	}
	const root = pitch(`${m[1].toLowerCase()}${m[2] ?? ''}${oct}`);
	return iv.map((s) => root + s);
}

function pcOf(n:number):number {
	return ((n % 12) + 12) % 12;
}

function blockOf(pitches:number[], beats?:number):Block {
	return { b: 1, pitches, beats };
}

/** Chord tone `i` steps from `row[0]`. `row` is one MIDI per pitch class, lowest first. */
function nth(row:number[], i:number):number {
	const k = row.length;
	const wrap = Math.floor(i / k);
	return row[i - wrap * k]! + wrap * 12;
}

function tones(row:number[], lo:number, hi:number):number[] {
	const pcs = row.map(pcOf);
	const a = Math.min(lo, hi);
	const b = Math.max(lo, hi);
	const out:number[] = [];
	for (let n = a; n <= b; n++) {
		if (pcs.includes(pcOf(n))) {
			out.push(n);
		}
	}
	return out;
}

function midiOf(row:number[], x:Tone):number {
	return typeof x === 'number' ? nth(row, x) : pitch(x);
}

function chordBlock(pitches:number[], beats:number | undefined):ChordBlock {
	const row = pitches.filter((n) => n < pitches[0]! + 12);
	const self:ChordBlock = {
		b: 1,
		pitches,
		beats,
		range(from:Tone, to:Tone):ChordBlock {
			return chordBlock(tones(row, midiOf(row, from), midiOf(row, to)), beats);
		},
		include(...kept:Tone[]):Block {
			return blockOf(kept.map((x) => midiOf(row, x)), beats);
		},
		exclude(...dropped:Tone[]):Block {
			const drop = new Set(dropped.map((x) => midiOf(row, x)));
			return blockOf(pitches.filter((n) => !drop.has(n)), beats);
		},
	};
	return self;
}

type Change = string | readonly [string, number];
type ChangeCell = { symbol:string; beats?:number };

/** Named chords in order. One name fills the bar; several need beats: `['D-', 4]`. */
export type Changes = {
	readonly ch:1;
	/** Run each chord through `chord` / `arpeggio` / `root` / any `(symbol, beats?) => …`. */
	as<T>(fn:(symbol:string, beats?:number)=>T):T[];
};

function changeOf(c:Change):ChangeCell {
	return typeof c === 'string' ? { symbol: c } : { symbol: c[0], beats: c[1] };
}

function isChanges(x:unknown):x is Changes {
	return !!x && typeof x === 'object' && (x as Changes).ch === 1;
}

/** Chord list. Realize with `chord(ch)`, `arpeggio(ch)`, `root(ch)`, or `ch.as(fn)`. */
export function changes(head:Change, ...rest:Change[]):Changes {
	const cells = [head, ...rest].map(changeOf);
	if (cells.length > 1 && cells.some((c) => c.beats === undefined)) {
		throw new Error('changes: beats on every chord');
	}
	return {
		ch: 1,
		as(fn) {
			return cells.map((c) => fn(c.symbol, c.beats));
		},
	};
}

/**
 * Named chord, all tones at once (not an arpeggio). `beats` is how long they last; omit and they fill the bar.
 * Root letter, optional `#`/`b`, suffix, optional octave digit (default 3): `C`, `D-`, `Bb2`, `C#7`.
 * Suffixes: major (none); `m`/`-`/`min`; `dim`; `aug`/`+`; `sus2`/`sus4`; `7`; `maj7`; `m7`/`-7`; `m7b5`.
 * `.range('a2', 'a5')` or `.range(0, 3)` keeps every chord tone in that span. `.include(0, 3)` or `.include('c3', 'c4')` keeps those tones. `.exclude(1, 2)` drops them from the span.
 * Pass `changes(...)` for several chords in order.
 */
export function chord(src:Changes):ChordBlock[];
export function chord(symbol:string, beats?:number):ChordBlock;
export function chord(src:string | Changes, beats?:number):ChordBlock | ChordBlock[] {
	if (isChanges(src)) {
		return src.as((s, n) => chordBlock(parseChord(s), n));
	}
	return chordBlock(parseChord(src), beats);
}

/** Simultaneous named pitches. */
export function stack(notes:string[], beats?:number):Block {
	return { b: 1, pitches: notes.map(pitch), beats };
}

function oneArpeggio(src:string | Block, beats?:number, step = 0.5):Arpeggio {
	const raw = typeof src === 'string' ? parseChord(src) : src.pitches;
	const pitches = raw.length === 3 ? [...raw, raw[0]! + 12] : raw;
	const n = beats ?? (typeof src === 'string' ? undefined : src.beats);
	return { a: 1, pitches, beats: n, step };
}

/** Broken chord: tones in order, one every `step` (default half a beat). Omit `beats` and it fills the bar (or the block’s length). A triad also gets its high octave. Playback goes up, then back down the inner tones. Pass `changes(...)` for several chords in order. */
export function arpeggio(src:Changes):Arpeggio[];
export function arpeggio(src:string | Block, beats?:number, step?:number):Arpeggio;
export function arpeggio(src:string | Block | Changes, beats?:number, step = 0.5):Arpeggio | Arpeggio[] {
	if (isChanges(src)) {
		return src.as((s, n) => oneArpeggio(s, n, step));
	}
	return oneArpeggio(src, beats, step);
}

/** Lowest chord tone, held. Same beats rule as `chord`. Pass `changes(...)` for several chords in order. */
export function root(src:Changes):Block[];
export function root(symbol:string, beats?:number):Block;
export function root(src:string | Changes, beats?:number):Block | Block[] {
	if (isChanges(src)) {
		return src.as((s, n) => chordBlock(parseChord(s), n).include(0));
	}
	return chord(src, beats).include(0);
}

/** MIDI block. Prefer `chord('C-')`. */
export function voicing(midi:number[], beat:number, dur:number, vel?:number):Note[] {
	return midi.map((p) => ({ pitch: p, beat, dur, vel }));
}

function dyn(name:DynName):Dyn {
	return { d: 1, name };
}

export const pp:Dyn = dyn('pp');
export const p:Dyn = dyn('p');
export const mp:Dyn = dyn('mp');
export const mf:Dyn = dyn('mf');
export const f:Dyn = dyn('f');
export const ff:Dyn = dyn('ff');

function hair(dir:'up' | 'down'):Hair & ((to?:Dyn)=>Hair) {
	const fn = ((to?:Dyn) => ({ h: 1 as const, dir, to })) as Hair & ((to?:Dyn)=>Hair);
	return Object.assign(fn, { h: 1 as const, dir });
}

/** Open a crescendo. Pass a target (`crescendo(f)`) or look ahead to the next absolute dynamic. */
export const crescendo = hair('up');
/** Open a diminuendo. Pass a target (`diminuendo(p)`) or look ahead to the next absolute dynamic. */
export const diminuendo = hair('down');

function isDyn(x:unknown):x is Dyn {
	return !!x && typeof x === 'object' && (x as Dyn).d === 1;
}

function isHair(x:unknown):x is Hair {
	return !!x && typeof x !== 'string' && (x as Hair).h === 1;
}

function isBlock(x:unknown):x is Block {
	return !!x && typeof x === 'object' && (x as Block).b === 1;
}

function isArpeggio(x:unknown):x is Arpeggio {
	return !!x && typeof x === 'object' && (x as Arpeggio).a === 1;
}

function isPart(x:unknown):x is Part {
	return !!x && typeof x === 'object' && (x as Part).p === 1;
}

function isBar(x:unknown):x is Bar {
	return !!x && typeof x === 'object' && (x as Bar).bar === 1;
}

function isPlay(x:unknown):x is Playback {
	return !!x && typeof x === 'object' && (x as Playback).play === 1;
}

function isCall(x:unknown):x is Call {
	return !!x && typeof x === 'object' && (x as Call).cb === 1;
}

function vOf(d:Dyn | undefined):number {
	return VEL[d?.name ?? 'mf'] ?? VEL.mf!;
}

function matterDur(m:Matter, barBeats:number):number {
	if (typeof m === 'string') {
		return lineSpan(m);
	}
	return m.beats ?? barBeats;
}

function emitMatter(m:Matter, barBeats:number, at:number, vel:number | undefined):Note[] {
	if (typeof m === 'string') {
		return line(m, at, vel);
	}
	if (isArpeggio(m)) {
		const cycle = m.pitches.length > 2
			? [...m.pitches, ...m.pitches.slice(1, -1).reverse()]
			: m.pitches;
		const notes:Note[] = [];
		const dur = m.beats ?? barBeats;
		let i = 0;
		for (let b = at; b < at + dur - 1e-9; b += m.step) {
			const pitchN = cycle[i % cycle.length];
			if (pitchN !== undefined) {
				notes.push({ pitch: pitchN, beat: b, dur: m.step * 1.35, vel });
			}
			i += 1;
		}
		return notes;
	}
	const dur = m.beats ?? barBeats;
	return m.pitches.map((pitchN) => ({ pitch: pitchN, beat: at, dur, vel }));
}

function parseArgs(track:Track, args:CallArg[]):Part {
	const chunks:Chunk[] = [];
	let pending:Matter[] = [];
	const flush = (mark?:Mark):void => {
		if (!pending.length) {
			if (mark) {
				throw new Error('mark with no notes');
			}
			return;
		}
		chunks.push({ matters: pending, mark });
		pending = [];
	};
	for (const arg of args) {
		if (isDyn(arg) || isHair(arg)) {
			flush(arg);
			continue;
		}
		if (Array.isArray(arg)) {
			pending.push(...arg);
			continue;
		}
		pending.push(arg);
	}
	flush();
	return { p: 1, track, chunks };
}

export type TrackOpts = {
	gain?:number;
	cutoff?:number;
	transpose?:number;
	dynamic?:Dyn;
	/** Override the instrument: `sustaining` rides dim/cres on a held note. */
	envelope?:InstrumentEnvelope;
	/** Insert on this track (`overdrive()`, `reverb()`). Series, first to last. */
	filters?:SoundFilter[];
};

/** A track is one lane of an instrument (gain, cutoff, transpose, dynamic, envelope). Two `track()` calls are two tracks even if the instrument matches. Same track twice in one bar overlays (both start at the bar’s downbeat). Sequential notes live in one call, or offset with `r:`. */
export function track(src:{ instrument:string }, opts:TrackOpts = {}):Track {
	const out = ((...args:CallArg[]) => parseArgs(out, args)) as Track;
	out.instrument = src.instrument;
	out.gain = opts.gain;
	out.cutoff = opts.cutoff;
	out.transpose = opts.transpose;
	out.dynamic = opts.dynamic;
	out.envelope = opts.envelope;
	out.filters = opts.filters;
	return out;
}

/** Measure. Each part starts at the bar’s downbeat (overlay). Sequential notes are one track call, or `r:` silence then the next idea. */
export function bar(beats:number, ...parts:Part[]):Bar {
	if (!(beats > 0)) {
		throw new Error('bar beats');
	}
	return { bar: 1, beats, parts };
}

export function start():Start {
	return { s: 1 };
}

export function end():End {
	return { e: 1 };
}

/** Run `fn` when playback reaches this point (between bars, or after the last). */
export function callback(fn:()=>void):Call {
	if (typeof fn !== 'function') {
		throw new Error('callback');
	}
	return { cb: 1, fn };
}

function overlay(bars:Bar[], extra:Part[], mute:Track[]):Bar[] {
	const muted = new Set(mute);
	if (mute.length) {
		const used = new Set<Track>();
		for (const b of bars) {
			for (const p of b.parts) {
				used.add(p.track);
			}
		}
		for (const c of mute) {
			if (!used.has(c)) {
				throw new Error('without: track was not in the phrase');
			}
		}
	}
	return bars.map((b) => {
		const parts = [...b.parts.filter((p) => !muted.has(p.track)), ...extra];
		if (!parts.length) {
			throw new Error('without: bar would be empty');
		}
		return { bar: 1, beats: b.beats, parts };
	});
}

function playback(bars:Bar[]):Playback {
	const self:Playback = {
		play: 1,
		bars,
		with: (...parts:Part[]) => playback(overlay(bars, parts, [])),
		without: (...tracks:Track[]) => playback(overlay(bars, [], tracks)),
	};
	return self;
}

export function slot():Phrase {
	let stored:Bar[] | undefined;
	const phrase = ((...bars:Bar[]) => {
		if (!bars.length) {
			if (!stored) {
				throw new Error('replay before define');
			}
			return playback(stored);
		}
		for (const b of bars) {
			if (!isBar(b)) {
				throw new Error('phrase define takes bars');
			}
		}
		if (stored) {
			throw new Error('phrase already defined');
		}
		stored = bars;
		return playback(bars);
	}) as Phrase;
	phrase.with = (...parts:Part[]) => {
		if (!stored) {
			throw new Error('replay before define');
		}
		return playback(overlay(stored, parts, []));
	};
	phrase.without = (...tracks:Track[]) => {
		if (!stored) {
			throw new Error('replay before define');
		}
		return playback(overlay(stored, [], tracks));
	};
	return phrase;
}

type Seg = { start:number; dur:number; mark?:Mark; notes:Note[] };

function segsFor(barList:Bar[], track:Track):Seg[] {
	const segs:Seg[] = [];
	let origin = 0;
	for (const b of barList) {
		for (const part of b.parts) {
			if (part.track !== track) {
				continue;
			}
			let local = 0;
			for (const ch of part.chunks) {
				let dur = 0;
				const notes:Note[] = [];
				const start = origin + local;
				for (const matter of ch.matters) {
					notes.push(...emitMatter(matter, b.beats, start + dur, undefined));
					dur += matterDur(matter, b.beats);
				}
				segs.push({ start, dur, mark: ch.mark, notes });
				local += dur;
			}
			if (local > b.beats + 1e-6) {
				throw new Error(`part longer than bar (${local} > ${b.beats})`);
			}
		}
		origin += b.beats;
	}
	return segs;
}

type Win = { a:number; b:number; v0:number; v1:number };

function windows(segs:Seg[], running:Dyn):{ wins:Win[]; abs:{ beat:number; vel:number }[] } {
	let cur = running;
	const wins:Win[] = [];
	const pending:{ a:number; v0:number }[] = [];
	const abs:{ beat:number; vel:number }[] = [{ beat: -1, vel: vOf(cur) }];
	for (const s of segs) {
		const m = s.mark;
		if (isHair(m)) {
			if (m.to) {
				wins.push({ a: s.start, b: s.start + s.dur, v0: vOf(cur), v1: vOf(m.to) });
				cur = m.to;
				abs.push({ beat: s.start + s.dur, vel: vOf(cur) });
			}
			else {
				pending.push({ a: s.start, v0: vOf(cur) });
			}
		}
		else if (isDyn(m)) {
			for (const p of pending) {
				wins.push({ a: p.a, b: s.start, v0: p.v0, v1: vOf(m) });
			}
			pending.length = 0;
			cur = m;
			abs.push({ beat: s.start, vel: vOf(cur) });
		}
	}
	if (pending.length) {
		throw new Error('crescendo/diminuendo has no end mark');
	}
	return { wins, abs };
}

function velAt(beat:number, wins:Win[], abs:{ beat:number; vel:number }[]):number {
	for (const w of wins) {
		if (beat >= w.a - 1e-9 && beat < w.b - 1e-9) {
			const t = (beat - w.a) / Math.max(1e-6, w.b - w.a);
			return w.v0 + (w.v1 - w.v0) * t;
		}
	}
	let v = abs[0]?.vel ?? vOf(mf);
	for (const a of abs) {
		if (a.beat <= beat + 1e-9) {
			v = a.vel;
		}
	}
	return v;
}

function swellNote(n:Note, wins:Win[], abs:{ beat:number; vel:number }[]):Note {
	const vel = velAt(n.beat, wins, abs);
	const velTo = velAt(n.beat + n.dur - 1e-6, wins, abs);
	const win = wins.find((w) => n.beat < w.b - 1e-9 && n.beat + n.dur > w.a + 1e-9);
	if (!win || Math.abs(vel - velTo) < 1e-6) {
		return { ...n, vel };
	}
	return { ...n, vel, velTo, velRampAt: Math.max(0, win.a - n.beat) };
}

function tieSustain(notes:Note[]):Note[] {
	const out:Note[] = [];
	for (const n of notes) {
		let hit = -1;
		for (let i = out.length - 1; i >= 0; i--) {
			const prev = out[i];
			if (prev && prev.pitch === n.pitch && Math.abs(prev.beat + prev.dur - n.beat) < 1e-6) {
				hit = i;
				break;
			}
		}
		if (hit < 0) {
			out.push({ ...n });
			continue;
		}
		const prev = out[hit]!;
		const held = prev.velTo === undefined || Math.abs((prev.velTo) - (prev.vel ?? 0)) < 1e-6;
		const rampAt = held ? prev.dur + (n.velRampAt ?? 0) : (prev.velRampAt ?? 0);
		prev.dur += n.dur;
		prev.velTo = n.velTo ?? n.vel;
		prev.velRampAt = rampAt;
	}
	return out;
}

function flatten(events:Event[]):{ bars:Bar[]; cues:{ beat:number; fn:()=>void }[] } {
	let starts = 0;
	let ends = 0;
	const rows:{ kind:'bar' | 'start' | 'end' | 'cue'; bar?:Bar; fn?:()=>void }[] = [];
	for (const e of events) {
		if (e && typeof e === 'object' && (e as Start).s === 1) {
			starts += 1;
			rows.push({ kind: 'start' });
			continue;
		}
		if (e && typeof e === 'object' && (e as End).e === 1) {
			ends += 1;
			rows.push({ kind: 'end' });
			continue;
		}
		if (isCall(e)) {
			rows.push({ kind: 'cue', fn: e.fn });
			continue;
		}
		if (isBar(e)) {
			rows.push({ kind: 'bar', bar: e });
			continue;
		}
		if (isPlay(e)) {
			for (const b of e.bars) {
				rows.push({ kind: 'bar', bar: b });
			}
			continue;
		}
		throw new Error('piece: expected bar, phrase, start, end, or callback');
	}
	if (starts > 1 || ends > 1) {
		throw new Error('at most one start() and one end()');
	}
	let live = starts === 0;
	const bars:Bar[] = [];
	const cues:{ beat:number; fn:()=>void }[] = [];
	let beat = 0;
	for (const r of rows) {
		if (r.kind === 'start') {
			live = true;
			continue;
		}
		if (r.kind === 'end') {
			live = false;
			continue;
		}
		if (!live) {
			continue;
		}
		if (r.kind === 'cue' && r.fn) {
			cues.push({ beat, fn: r.fn });
			continue;
		}
		if (r.bar) {
			bars.push(r.bar);
			beat += r.bar.beats;
		}
	}
	if (!bars.length) {
		throw new Error('piece has no bars');
	}
	return { bars, cues };
}

/** Compile bars into a looping `Score`. `loops` is `-1` (forever, default) or a count. `callback(fn)` in the event list runs at that beat. Throws if an instrument is unknown or a part overruns its bar. */
export function piece(
	opts:{ bpm:number; gain?:number; id?:string; loops?:number; filters?:SoundFilter[] },
	events:Event[],
):Score {
	const loops = opts.loops ?? -1;
	if (loops !== -1 && !(Number.isInteger(loops) && loops > 0)) {
		throw new Error('loops');
	}
	const { bars, cues } = flatten(events);
	const loop = bars.reduce((s, b) => s + b.beats, 0);
	const tracks:Track[] = [];
	for (const b of bars) {
		for (const p of b.parts) {
			if (!tracks.includes(p.track)) {
				tracks.push(p.track);
			}
		}
	}
	const voices:Voice[] = [];
	for (const track of tracks) {
		const def = instrumentOf(track.instrument);
		if (!def) {
			throw new Error(`${opts.id ?? 'piece'} unknown instrument ${track.instrument}`);
		}
		const segs = segsFor(bars, track);
		const { wins, abs } = windows(segs, track.dynamic ?? mf);
		const notes:Note[] = [];
		const tr = track.transpose ?? 0;
		const ride = (track.envelope ?? def.envelope) === 'sustaining';
		for (const s of segs) {
			for (const n of s.notes) {
				const shaped = ride
					? [swellNote(n, wins, abs)]
					: [{ ...n, vel: velAt(n.beat, wins, abs) }];
				for (const sliced of shaped) {
					notes.push({
						pitch: sliced.pitch + tr,
						beat: sliced.beat,
						dur: sliced.dur,
						vel: sliced.vel,
						...(sliced.velTo !== undefined ? { velTo: sliced.velTo, velRampAt: sliced.velRampAt } : {}),
					});
				}
			}
		}
		voices.push({
			instrument: track.instrument,
			notes: ride ? tieSustain(notes) : notes,
			gain: track.gain,
			cutoff: track.cutoff,
			...(track.filters?.length ? { filters: track.filters } : {}),
		});
	}
	const score:Score = {
		bpm: opts.bpm,
		loop,
		gain: opts.gain,
		voices,
		id: opts.id,
		...(loops !== -1 ? { loops } : {}),
		...(cues.length ? { cues } : {}),
		...(opts.filters?.length ? { filters: opts.filters } : {}),
	};
	const bad = scoreProblems(score);
	if (bad.length) {
		throw new Error(`${opts.id ?? 'piece'} score: ${bad.join(', ')}`);
	}
	return score;
}
