import { bellHz, disconnectSoon, env, midiHz, noiseBurst, pluckHz, tAt } from './synth.js';
import type { Voice } from './types.js';

// Instruments: the registry scores play from, and the built-in ones. Each turns a note into Web
// Audio nodes from the building blocks in `synth.ts`.

export type InstrumentEnvelope = 'percussive' | 'sustaining';

export type InstrumentPlay = (
	ctx:AudioContext,
	dest:AudioNode,
	noise:AudioBuffer,
	when:number,
	midi:number,
	durSec:number,
	gain:number,
	voice:Voice,
)=>void;

type Registered = {
	envelope:InstrumentEnvelope;
	play:InstrumentPlay;
};

const registry = new Map<string, Registered>();

/**
 * Register (or replace) an instrument. Returns `{ instrument }` for `track()`.
 * `percussive` locks loudness at attack. `sustaining` lets a dim/cres turn the
 * volume on a note that is already playing.
 */
export function registerInstrument<K extends string>(
	name:K,
	envelope:InstrumentEnvelope,
	play:InstrumentPlay,
):{ instrument:K } {
	if (!name.trim()) {
		throw new Error('registerInstrument: empty name');
	}
	if (envelope !== 'percussive' && envelope !== 'sustaining') {
		throw new Error(`registerInstrument: ${name} envelope`);
	}
	registry.set(name, { envelope, play });
	return { instrument: name };
}

export function instrumentOf(name:string):Registered | undefined {
	return registry.get(name);
}

export function playVoiceNote(
	ctx:AudioContext,
	dest:AudioNode,
	noise:AudioBuffer,
	voice:Voice,
	when:number,
	midi:number,
	durSec:number,
	vel:number,
	velTo?:number,
	rampAtSec?:number,
):void {
	if (when < ctx.currentTime + 0.002) {
		return;
	}
	const dyn = ctx.createGain();
	dyn.connect(dest);
	const t0 = tAt(ctx, when);
	const v0 = Math.max(0.0001, vel);
	dyn.gain.setValueAtTime(v0, t0);
	if (velTo !== undefined && Math.abs(velTo - vel) > 1e-4) {
		const tRamp = t0 + Math.max(0, rampAtSec ?? 0);
		const tEnd = t0 + Math.max(0.03, durSec - 0.08);
		dyn.gain.setValueAtTime(v0, tRamp);
		dyn.gain.linearRampToValueAtTime(Math.max(0.0001, velTo), Math.max(tRamp + 0.02, tEnd));
	}
	disconnectSoon([dyn], when, ctx, durSec + 0.25);
	const play = instrumentOf(voice.instrument)?.play;
	if (!play) {
		return;
	}
	play(ctx, dyn, noise, when, midi, durSec, voice.gain ?? 1, voice);
}

function playPad(
	ctx:AudioContext,
	dest:AudioNode,
	noise:AudioBuffer,
	when:number,
	midi:number,
	dur:number,
	gain:number,
	voice:Voice,
):void {
	const freq = midiHz(midi);
	const cutoff = voice.cutoff ?? 780;
	const filter = ctx.createBiquadFilter();
	filter.type = 'lowpass';
	filter.frequency.setValueAtTime(cutoff * 0.72, when);
	filter.frequency.linearRampToValueAtTime(cutoff, when + Math.min(1.2, dur * 0.5));
	filter.Q.value = 0.7;
	const out = ctx.createGain();
	env(out, when, dur, gain * 0.22, 0.42, 1.15);
	filter.connect(out);
	out.connect(dest);
	const nodes:AudioNode[] = [filter, out];
	for (const [type, detune, g] of [['sawtooth', -9, 0.7], ['sawtooth', 8, 0.7], ['triangle', 0, 0.45]] as const) {
		const osc = ctx.createOscillator();
		osc.type = type;
		osc.frequency.value = freq;
		osc.detune.value = detune;
		const mix = ctx.createGain();
		mix.gain.value = g;
		osc.connect(mix);
		mix.connect(filter);
		osc.start(when);
		osc.stop(when + dur + 0.05);
		nodes.push(osc, mix);
	}
	disconnectSoon(nodes, when, ctx, dur + 0.2);
}

function playBass(
	ctx:AudioContext,
	dest:AudioNode,
	noise:AudioBuffer,
	when:number,
	midi:number,
	dur:number,
	gain:number,
	voice:Voice,
):void {
	const freq = midiHz(midi);
	const cutoff = voice.cutoff ?? 260;
	const osc = ctx.createOscillator();
	osc.type = 'triangle';
	osc.frequency.value = freq;
	const filter = ctx.createBiquadFilter();
	filter.type = 'lowpass';
	filter.frequency.value = cutoff;
	const out = ctx.createGain();
	env(out, when, dur, gain * 0.4, 0.03, 0.18);
	osc.connect(filter);
	filter.connect(out);
	out.connect(dest);
	osc.start(when);
	osc.stop(when + dur + 0.05);
	disconnectSoon([osc, filter, out], when, ctx, dur + 0.15);
}

function playLead(
	ctx:AudioContext,
	dest:AudioNode,
	noise:AudioBuffer,
	when:number,
	midi:number,
	dur:number,
	gain:number,
):void {
	const freq = midiHz(midi);
	const osc = ctx.createOscillator();
	osc.type = 'triangle';
	osc.frequency.value = freq;
	const lfo = ctx.createOscillator();
	lfo.frequency.value = 5.1;
	const lfoGain = ctx.createGain();
	lfoGain.gain.value = freq * 0.012;
	lfo.connect(lfoGain);
	lfoGain.connect(osc.frequency);
	const out = ctx.createGain();
	env(out, when, dur, gain * 0.28, 0.03, 0.12);
	osc.connect(out);
	out.connect(dest);
	osc.start(when);
	lfo.start(when);
	osc.stop(when + dur + 0.05);
	lfo.stop(when + dur + 0.05);
	disconnectSoon([osc, lfo, lfoGain, out], when, ctx, dur + 0.15);
}

function playPiano(
	ctx:AudioContext,
	dest:AudioNode,
	noise:AudioBuffer,
	when:number,
	midi:number,
	dur:number,
	gain:number,
):void {
	const freq = midiHz(midi);
	const t0 = tAt(ctx, when);
	const ring = Math.min(4.8, dur * 0.9 + 0.2 + 200 / Math.max(55, freq));
	const filter = ctx.createBiquadFilter();
	filter.type = 'lowpass';
	const bright = Math.min(7200, freq * 16);
	filter.frequency.setValueAtTime(bright, t0);
	filter.frequency.exponentialRampToValueAtTime(Math.max(420, freq * 5.5), t0 + Math.min(1.6, ring * 0.55));
	filter.Q.value = 0.45;
	const out = ctx.createGain();
	const peak = Math.max(0.0002, gain * 0.5);
	out.gain.setValueAtTime(0.0001, t0);
	out.gain.exponentialRampToValueAtTime(peak, t0 + 0.005);
	out.gain.exponentialRampToValueAtTime(peak * 0.38, t0 + Math.min(0.16, ring * 0.1));
	out.gain.exponentialRampToValueAtTime(0.0001, t0 + ring);
	filter.connect(out);
	out.connect(dest);
	const nodes:AudioNode[] = [filter, out];
	const stretch = 0.00014;
	const partials:[number, number][] = [
		[1, 1],
		[2, 0.46],
		[3, 0.24],
		[4.02, 0.13],
		[5, 0.08],
		[6.04, 0.045],
		[7, 0.028],
	];
	for (const [n, amp] of partials) {
		const hz = freq * n * Math.sqrt(1 + stretch * n * n);
		if (hz > 12500) {
			continue;
		}
		const osc = ctx.createOscillator();
		osc.type = 'sine';
		osc.frequency.value = hz;
		const mix = ctx.createGain();
		mix.gain.value = amp;
		osc.connect(mix);
		mix.connect(filter);
		osc.start(t0);
		osc.stop(t0 + ring + 0.04);
		nodes.push(osc, mix);
	}
	noiseBurst(ctx, dest, noise, t0, 0.014, gain * 0.16, Math.min(5200, freq * 9), 'highpass', 0.7);
	disconnectSoon(nodes, t0, ctx, ring + 0.2);
}

function playBell(
	ctx:AudioContext,
	dest:AudioNode,
	noise:AudioBuffer,
	when:number,
	midi:number,
	dur:number,
	gain:number,
):void {
	bellHz(ctx, dest, when, midiHz(midi), dur, gain);
}

function playPluck(
	ctx:AudioContext,
	dest:AudioNode,
	noise:AudioBuffer,
	when:number,
	midi:number,
	dur:number,
	gain:number,
):void {
	pluckHz(ctx, dest, noise, when, midiHz(midi), dur, gain);
}

function playDrum(
	ctx:AudioContext,
	dest:AudioNode,
	noise:AudioBuffer,
	when:number,
	midi:number,
	dur:number,
	gain:number,
):void {
	const kind = midi < 40 ? 'dum' : midi < 45 ? 'tek' : 'tap';
	if (kind === 'dum') {
		const t0 = tAt(ctx, when);
		const osc = ctx.createOscillator();
		osc.type = 'sine';
		const deep = Math.max(0, 36 - midi);
		const ring = Math.max(0.32 + deep * 0.03, dur);
		const drop = Math.min(0.16 + deep * 0.012, ring * 0.45);
		osc.frequency.setValueAtTime(Math.max(48, 86 - deep * 3.4), t0);
		osc.frequency.exponentialRampToValueAtTime(Math.max(22, 42 - deep * 1.7), t0 + drop);
		const og = ctx.createGain();
		og.gain.setValueAtTime(gain * (0.7 + deep * 0.03), t0);
		og.gain.exponentialRampToValueAtTime(0.0001, t0 + ring);
		osc.connect(og);
		og.connect(dest);
		osc.start(t0);
		osc.stop(t0 + ring + 0.02);
		noiseBurst(ctx, dest, noise, t0, 0.1, gain * 0.38, Math.max(140, 280 - deep * 12), 'lowpass', 0.6);
		disconnectSoon([osc, og], t0, ctx, ring + 0.08);
		return;
	}
	const cutoff = kind === 'tek' ? 2200 : 1400;
	noiseBurst(ctx, dest, noise, when, Math.min(dur, 0.07), gain * 0.45, cutoff, 'bandpass', 1.4);
}

function playAir(
	ctx:AudioContext,
	dest:AudioNode,
	noise:AudioBuffer,
	when:number,
	midi:number,
	dur:number,
	gain:number,
	voice:Voice,
):void {
	const cutoff = voice.cutoff ?? midiHz(midi);
	const src = ctx.createBufferSource();
	src.buffer = noise;
	src.loop = true;
	const filter = ctx.createBiquadFilter();
	filter.type = 'bandpass';
	filter.frequency.value = cutoff;
	filter.Q.value = 0.8;
	const out = ctx.createGain();
	env(out, when, dur, gain * 0.12, 0.8, 1.2);
	src.connect(filter);
	filter.connect(out);
	out.connect(dest);
	src.start(when);
	src.stop(when + dur + 0.05);
	disconnectSoon([src, filter, out], when, ctx, dur + 0.2);
}

function playViolin(
	ctx:AudioContext,
	dest:AudioNode,
	noise:AudioBuffer,
	when:number,
	midi:number,
	dur:number,
	gain:number,
):void {
	const freq = midiHz(midi);
	const filter = ctx.createBiquadFilter();
	filter.type = 'lowpass';
	filter.frequency.value = Math.min(2800, freq * 5.8);
	filter.Q.value = 0.7;
	const out = ctx.createGain();
	env(out, when, dur, gain * 0.26, 0.12, 0.22);
	filter.connect(out);
	out.connect(dest);
	const lfo = ctx.createOscillator();
	lfo.frequency.value = 5.1;
	const lfoGain = ctx.createGain();
	lfoGain.gain.value = 5;
	lfo.connect(lfoGain);
	const nodes:AudioNode[] = [filter, out, lfo, lfoGain];
	for (const [type, detune, g] of [
		['sawtooth', 0, 0.82],
		['triangle', 0, 0.38],
		['sawtooth', 4, 0.18],
	] as const) {
		const osc = ctx.createOscillator();
		osc.type = type;
		osc.frequency.value = freq;
		osc.detune.value = detune;
		lfoGain.connect(osc.detune);
		const mixG = ctx.createGain();
		mixG.gain.value = g;
		osc.connect(mixG);
		mixG.connect(filter);
		osc.start(when);
		osc.stop(when + dur + 0.05);
		nodes.push(osc, mixG);
	}
	lfo.start(when);
	lfo.stop(when + dur + 0.05);
	disconnectSoon(nodes, when, ctx, dur + 0.2);
}

function playBrass(
	ctx:AudioContext,
	dest:AudioNode,
	noise:AudioBuffer,
	when:number,
	midi:number,
	dur:number,
	gain:number,
):void {
	const freq = midiHz(midi);
	const filter = ctx.createBiquadFilter();
	filter.type = 'lowpass';
	filter.frequency.value = Math.min(2400, freq * 5.2);
	filter.Q.value = 0.55;
	const out = ctx.createGain();
	env(out, when, dur, gain * 0.36, 0.08, 0.22);
	filter.connect(out);
	out.connect(dest);
	const nodes:AudioNode[] = [filter, out];
	for (const [type, detune, g] of [
		['sawtooth', -4, 0.7],
		['sawtooth', 3, 0.7],
		['sawtooth', 0, 0.5],
		['triangle', 0, 0.32],
	] as const) {
		const osc = ctx.createOscillator();
		osc.type = type;
		osc.frequency.value = freq;
		osc.detune.value = detune;
		const mixG = ctx.createGain();
		mixG.gain.value = g;
		osc.connect(mixG);
		mixG.connect(filter);
		osc.start(when);
		osc.stop(when + dur + 0.05);
		nodes.push(osc, mixG);
	}
	disconnectSoon(nodes, when, ctx, dur + 0.18);
}

/** How a blown pipe speaks. */
type Pipe = {
	/** Harmonic number and level of each sine; the first is the fundamental. */
	partials:readonly (readonly [harmonic:number, level:number])[];
	/** Breath noise level, and its band's Q (lower is airier). */
	breath:number;
	breathQ:number;
	/** Noise kick on the attack, like the tongue on a flute. */
	chiff:number;
	/** Rate (Hz), pitch depth (cents), breath depth, and how long after the attack it blooms (s). */
	vibrato:readonly [rate:number, cents:number, breath:number, delay:number];
};

/**
 * A blown pipe: sines at the partials, looping breath noise, a chiff on the attack, and a
 * vibrato that blooms once the note settles. The vibrato moves pitch and breath together, the
 * way a player's diaphragm does.
 */
function blown(pipe:Pipe):InstrumentPlay {
	return (ctx, dest, noise, when, midi, dur, gain) => {
		const freq = midiHz(midi);
		const out = ctx.createGain();
		env(out, when, dur, gain * 0.15, 0.05, 0.14);
		const breathPulse = ctx.createGain();
		breathPulse.connect(out);
		out.connect(dest);
		const nodes:AudioNode[] = [out, breathPulse];
		const detunes:AudioParam[] = [];
		for (const [harmonic, level] of pipe.partials) {
			const osc = ctx.createOscillator();
			osc.type = 'sine';
			osc.frequency.value = freq * harmonic;
			const g = ctx.createGain();
			g.gain.value = level;
			osc.connect(g);
			g.connect(breathPulse);
			osc.start(when);
			osc.stop(when + dur + 0.05);
			nodes.push(osc, g);
			detunes.push(osc.detune);
		}
		const [rate, cents, breathDepth, delay] = pipe.vibrato;
		nodes.push(...vibrato(ctx, when, dur, rate, delay, [...detunes.map((d) => [d, cents] as const), [breathPulse.gain, breathDepth]]));
		const breath = ctx.createBufferSource();
		breath.buffer = noise;
		breath.loop = true;
		const bFilt = ctx.createBiquadFilter();
		bFilt.type = 'bandpass';
		bFilt.frequency.value = freq * 2.4;
		bFilt.Q.value = pipe.breathQ;
		const bGain = ctx.createGain();
		bGain.gain.value = gain * pipe.breath;
		breath.connect(bFilt);
		bFilt.connect(bGain);
		bGain.connect(out);
		breath.start(when);
		breath.stop(when + dur + 0.05);
		nodes.push(breath, bFilt, bGain);
		nodes.push(...noiseHit(ctx, dest, noise, when, 0.05, gain * pipe.chiff, 'bandpass', Math.min(6000, freq * 3), 1.2));
		disconnectSoon(nodes, when, ctx, dur + 0.15);
	};
}

/** Wooden flute or low whistle: nearly pure, a soft second harmonic, a quick even vibrato. */
const FLUTE:Pipe = {
	partials: [[1, 1], [2, 0.14], [3, 0.05]],
	breath: 0.04,
	breathQ: 1.1,
	chiff: 0.07,
	vibrato: [5.2, 11, 0.12, 0.25],
};

/**
 * Wobble that fades in after `delay`, like a player settling into the note. One LFO drives
 * every target at its own depth (cents for a detune).
 */
function vibrato(
	ctx:AudioContext,
	when:number,
	dur:number,
	rate:number,
	delay:number,
	targets:readonly (readonly [AudioParam, number])[],
):AudioNode[] {
	const lfo = ctx.createOscillator();
	lfo.frequency.value = rate;
	const t0 = tAt(ctx, when);
	const nodes:AudioNode[] = [lfo];
	for (const [param, depth] of targets) {
		const g = ctx.createGain();
		g.gain.setValueAtTime(0, t0);
		g.gain.setValueAtTime(0, t0 + delay);
		g.gain.linearRampToValueAtTime(depth, t0 + delay + 0.5);
		lfo.connect(g);
		g.connect(param);
		nodes.push(g);
	}
	lfo.start(when);
	lfo.stop(when + dur + 0.1);
	return nodes;
}

/** Filtered noise hit that decays over `dur`. */
function noiseHit(
	ctx:AudioContext,
	dest:AudioNode,
	noise:AudioBuffer,
	when:number,
	dur:number,
	gain:number,
	type:BiquadFilterType,
	freq:number,
	q:number,
):AudioNode[] {
	const src = ctx.createBufferSource();
	src.buffer = noise;
	const filter = ctx.createBiquadFilter();
	filter.type = type;
	filter.frequency.value = freq;
	filter.Q.value = q;
	const out = ctx.createGain();
	const t0 = tAt(ctx, when);
	out.gain.setValueAtTime(Math.max(0.0002, gain), t0);
	out.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.01, dur));
	src.connect(filter);
	filter.connect(out);
	out.connect(dest);
	src.start(t0);
	src.stop(t0 + dur + 0.02);
	return [src, filter, out];
}

const STRING_SECONDS = 3.2;
const strings = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

/** Strings that sound together for one note: semitones above it, level, lag in seconds, detune ratio. */
type Course = readonly [semitones:number, level:number, lag:number, detune:number];

/** One biquad of an instrument body, in series with the rest. */
type BodyFilter = readonly [BiquadFilterType, hz:number, q:number, db:number];

/** How a plucked instrument speaks. */
type Plucked = {
	courses:(midi:number)=>readonly Course[];
	/** Where the string is plucked, as a fraction of its length. Nearer the end is brighter and thinner. */
	pluckAt:number;
	/** How sharp the pluck is, 0–1: a fingertip pad near 0.45, a pick or nail higher. */
	edge:number;
	body:readonly BodyFilter[];
	/** The string starts this fraction sharp and settles within ~50 ms: a taut string's twang. */
	twang?:number;
};

/**
 * Karplus–Strong string, rendered once per pitch and pluck. The pluck is not a noise burst: it
 * is the string's velocity when released from a bend at `pluckAt`, rounded off by `edge`, with a
 * little grit. Harmonics with a node at the pluck drop out, which is most of what separates a
 * guitar from a harpsichord. Low strings ring longer.
 */
function stringBuffer(ctx:BaseAudioContext, midi:number, pluckAt:number, edge:number):AudioBuffer {
	let byKey = strings.get(ctx);
	if (!byKey) {
		byKey = new Map();
		strings.set(ctx, byKey);
	}
	const key = `${midi}:${pluckAt}:${edge}`;
	const hit = byKey.get(key);
	if (hit) {
		return hit;
	}
	const sr = ctx.sampleRate;
	const freq = midiHz(midi);
	const period = Math.max(2, Math.round(sr / freq - 0.5));
	const len = Math.floor(sr * STRING_SECONDS);
	const buf = ctx.createBuffer(1, len, sr);
	const y = buf.getChannelData(0);
	const apex = Math.max(1, Math.round(period * pluckAt));
	const back = -apex / Math.max(1, period - apex);
	let soft = 0;
	let mean = 0;
	for (let i = 0; i < period; i++) {
		soft += edge * ((i < apex ? 1 : back) + 0.2 * (Math.random() * 2 - 1) - soft);
		y[i] = soft;
		mean += soft / period;
	}
	for (let i = 0; i < period; i++) {
		y[i] = (y[i] ?? 0) - mean;
	}
	const t60 = Math.max(1.1, 4.2 - freq / 260);
	const loss = Math.pow(0.001, 1 / (t60 * freq));
	for (let i = period; i < len; i++) {
		y[i] = loss * 0.5 * ((y[i - period] ?? 0) + (y[i - period - 1] ?? 0));
	}
	let peak = 0;
	for (let i = 0; i < len; i++) {
		peak = Math.max(peak, Math.abs(y[i] ?? 0));
	}
	const fade = Math.floor(sr * 0.05);
	for (let i = 0; i < len; i++) {
		const tail = Math.min(1, (len - i) / fade);
		y[i] = ((y[i] ?? 0) / (peak || 1)) * tail;
	}
	byKey.set(key, buf);
	return buf;
}

/**
 * A plucked instrument: each note plucks its courses through the body. A note rings for its
 * whole length, so write fingerpicking as overlapping lines where each string holds until it
 * is plucked again.
 */
function strung(plucked:Plucked):InstrumentPlay {
	const { courses, pluckAt, edge, twang = 0 } = plucked;
	return (ctx, dest, noise, when, midi, dur, gain) => {
		const t0 = tAt(ctx, when);
		const body = plucked.body.map(([type, hz, q, db]) => {
			const f = ctx.createBiquadFilter();
			f.type = type;
			f.frequency.value = hz;
			f.Q.value = q;
			f.gain.value = db;
			return f;
		});
		body.forEach((f, i) => f.connect(body[i + 1] ?? dest));
		const nodes:AudioNode[] = [...body];
		const ring = Math.min(STRING_SECONDS - 0.05, dur + 0.3);
		for (const [semitones, level, lag, detune] of courses(midi)) {
			const pitch = midi + semitones;
			const freq = midiHz(pitch);
			const period = Math.max(2, Math.round(ctx.sampleRate / freq - 0.5));
			const src = ctx.createBufferSource();
			src.buffer = stringBuffer(ctx, pitch, pluckAt, edge);
			const rate = ((freq * (period + 0.5)) / ctx.sampleRate) * detune;
			const start = t0 + lag;
			src.playbackRate.setValueAtTime(rate * (1 + twang), start);
			src.playbackRate.setTargetAtTime(rate, start, 0.03);
			const g = ctx.createGain();
			g.gain.setValueAtTime(gain * 0.34 * level, start);
			g.gain.setTargetAtTime(0.0001, start + Math.max(0.05, dur), 0.08);
			src.connect(g);
			g.connect(body[0]!);
			src.start(start);
			src.stop(start + ring);
			nodes.push(src, g);
		}
		disconnectSoon(nodes, t0, ctx, ring + 0.1);
	};
}

const ONE_STRING:readonly Course[] = [[0, 1, 0, 1]];

/** Low courses pair with an octave string, high courses with a detuned unison, struck a hair apart. */
function twelveCourses(midi:number):readonly Course[] {
	return midi < 55
		? [[0, 1, 0, 1], [12, 0.5, 0.012, 1]]
		: [[0, 1, 0, 1], [0, 0.7, 0.009, 1.0021]];
}

/** Steel-string flat-top, fingerpicked over the soundhole: air cavity boom, top plate, soft treble. */
const GUITAR:Plucked = {
	courses: () => ONE_STRING,
	pluckAt: 0.18,
	edge: 0.45,
	body: [
		['peaking', 100, 2, 6],
		['peaking', 220, 1.4, 4],
		['lowpass', 5200, 0.7, 0],
	],
};

/** Thirteen-string koto, plucked near the bridge with ivory picks: woody, nasal, bright, and a little twang. */
const KOTO:Plucked = {
	courses: () => ONE_STRING,
	pluckAt: 0.07,
	edge: 0.8,
	body: [
		['peaking', 180, 1.2, 3],
		['peaking', 1400, 1.5, 3],
		['peaking', 3200, 1.2, 4],
		['lowpass', 8000, 0.7, 0],
	],
	twang: 0.004,
};

type Formant = [hz:number, level:number];
const OO:Formant[] = [[320, 1], [800, 0.4], [2300, 0.08]];
const AH:Formant[] = [[720, 1], [1150, 0.55], [2650, 0.16]];

/** Wordless choir: a small ensemble of detuned voices through vowel formants that open from "oo" to "ah". */
function playChoir(
	ctx:AudioContext,
	dest:AudioNode,
	noise:AudioBuffer,
	when:number,
	midi:number,
	dur:number,
	gain:number,
):void {
	const freq = midiHz(midi);
	const t0 = tAt(ctx, when);
	const open = t0 + Math.max(0.4, dur * 0.6);
	const src = ctx.createGain();
	const out = ctx.createGain();
	env(out, when, dur, gain * 0.9, Math.min(0.55, dur * 0.35), Math.min(1, dur * 0.4));
	out.connect(dest);
	const nodes:AudioNode[] = [src, out];
	for (const [cents, rate] of [[-7, 4.8], [0, 5.3], [8, 5.0]] as const) {
		const osc = ctx.createOscillator();
		osc.type = 'sawtooth';
		osc.frequency.value = freq;
		osc.detune.value = cents;
		const g = ctx.createGain();
		g.gain.value = 0.34;
		osc.connect(g);
		g.connect(src);
		osc.start(when);
		osc.stop(when + dur + 0.1);
		nodes.push(osc, g, ...vibrato(ctx, when, dur, rate, 0.35, [[osc.detune, 16]]));
	}
	for (let i = 0; i < OO.length; i++) {
		const [fromHz, fromLevel] = OO[i]!;
		const [toHz, toLevel] = AH[i]!;
		const bp = ctx.createBiquadFilter();
		bp.type = 'bandpass';
		bp.Q.value = 5;
		bp.frequency.setValueAtTime(Math.max(fromHz, freq), t0);
		bp.frequency.linearRampToValueAtTime(Math.max(toHz, freq), open);
		const g = ctx.createGain();
		g.gain.setValueAtTime(fromLevel * 2.4, t0);
		g.gain.linearRampToValueAtTime(toLevel * 2.4, open);
		src.connect(bp);
		bp.connect(g);
		g.connect(out);
		nodes.push(bp, g);
	}
	nodes.push(...noiseHit(ctx, out, noise, when, dur, gain * 0.05, 'highpass', 2400, 0.5));
	disconnectSoon(nodes, when, ctx, dur + 0.3);
}

/**
 * Bowed cello: bow scrape on the attack, a body resonance, a brightening bow stroke and a late
 * vibrato. Short notes come out as hard spiccato chugs, long ones as a singing line.
 */
function playCello(
	ctx:AudioContext,
	dest:AudioNode,
	noise:AudioBuffer,
	when:number,
	midi:number,
	dur:number,
	gain:number,
):void {
	const freq = midiHz(midi);
	const t0 = tAt(ctx, when);
	const bow = ctx.createBiquadFilter();
	bow.type = 'lowpass';
	bow.Q.value = 1.2;
	bow.frequency.setValueAtTime(Math.min(3600, freq * 2.5), t0);
	bow.frequency.linearRampToValueAtTime(Math.min(3600, freq * 6), t0 + Math.min(0.6, dur * 0.5));
	const body = ctx.createBiquadFilter();
	body.type = 'peaking';
	body.frequency.value = 290;
	body.Q.value = 1.4;
	body.gain.value = 5;
	const out = ctx.createGain();
	const attack = Math.max(0.012, Math.min(0.18, dur * 0.2));
	env(out, when, dur, gain * 0.32, attack, Math.min(0.28, dur * 0.3));
	bow.connect(body);
	body.connect(out);
	out.connect(dest);
	const nodes:AudioNode[] = [bow, body, out];
	const detunes:AudioParam[] = [];
	for (const cents of [-3, 4]) {
		const osc = ctx.createOscillator();
		osc.type = 'sawtooth';
		osc.frequency.value = freq;
		osc.detune.value = cents;
		osc.connect(bow);
		osc.start(when);
		osc.stop(when + dur + 0.05);
		nodes.push(osc);
		detunes.push(osc.detune);
	}
	nodes.push(...vibrato(ctx, when, dur, 5.3, 0.3, detunes.map((d) => [d, 14] as const)));
	nodes.push(...noiseHit(ctx, out, noise, when, 0.07, gain * 0.5, 'bandpass', Math.min(4000, freq * 4), 2));
	nodes.push(...noiseHit(ctx, out, noise, when, dur, gain * 0.05, 'bandpass', Math.min(4000, freq * 3), 3));
	disconnectSoon(nodes, when, ctx, dur + 0.2);
}

export const pad = registerInstrument('pad', 'sustaining', playPad);
export const bass = registerInstrument('bass', 'sustaining', playBass);
export const lead = registerInstrument('lead', 'sustaining', playLead);
export const pluck = registerInstrument('pluck', 'percussive', playPluck);
export const drum = registerInstrument('drum', 'percussive', playDrum);
export const bell = registerInstrument('bell', 'percussive', playBell);
export const air = registerInstrument('air', 'sustaining', playAir);
export const piano = registerInstrument('piano', 'percussive', playPiano);
export const violin = registerInstrument('violin', 'sustaining', playViolin);
export const brass = registerInstrument('brass', 'sustaining', playBrass);
export const flute = registerInstrument('flute', 'sustaining', blown(FLUTE));
export const guitar = registerInstrument('guitar', 'percussive', strung(GUITAR));
export const twelveString = registerInstrument('twelveString', 'percussive', strung({ ...GUITAR, courses: twelveCourses }));
export const koto = registerInstrument('koto', 'percussive', strung(KOTO));
export const choir = registerInstrument('choir', 'sustaining', playChoir);
export const cello = registerInstrument('cello', 'sustaining', playCello);
