import type { SfxLayer, SfxOpts, SfxPatch, Vowel } from './types.js';

/** Hz of MIDI note `midi` (69 is A4, 440 Hz). */
export function midiHz(midi:number):number {
	return 440 * 2 ** ((midi - 69) / 12);
}

export function makeNoise(ctx:AudioContext, seconds = 1.5):AudioBuffer {
	const n = Math.max(1, Math.floor(ctx.sampleRate * seconds));
	const buf = ctx.createBuffer(1, n, ctx.sampleRate);
	const data = buf.getChannelData(0);
	let b0 = 0;
	let b1 = 0;
	let b2 = 0;
	for (let i = 0; i < n; i++) {
		const w = Math.random() * 2 - 1;
		b0 = 0.99765 * b0 + w * 0.099046;
		b1 = 0.963 * b1 + w * 0.2965164;
		b2 = 0.57 * b2 + w * 1.052691;
		data[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
	}
	return buf;
}

export function tAt(ctx:BaseAudioContext, t:number):number {
	return Math.max(t, ctx.currentTime + 0.003);
}

export function env(
	g:GainNode,
	when:number,
	dur:number,
	peak:number,
	attack:number,
	release:number,
):void {
	const ctx = g.context;
	const t0 = tAt(ctx, when);
	const a = Math.max(0.004, Math.min(attack, dur * 0.45));
	const peakAt = t0 + a;
	const r = Math.min(release, Math.max(0.04, dur - a));
	const end = Math.max(peakAt + 0.02, t0 + dur);
	const holdAt = Math.max(peakAt, end - r);
	const pk = Math.max(0.0002, peak);
	g.gain.cancelScheduledValues(t0);
	g.gain.setValueAtTime(0.0001, t0);
	g.gain.exponentialRampToValueAtTime(pk, peakAt);
	g.gain.setValueAtTime(Math.max(0.0002, pk * 0.82), holdAt);
	g.gain.exponentialRampToValueAtTime(0.0001, Math.max(holdAt + 0.004, end));
}

function later(ms:number, fn:()=>void):ReturnType<typeof setTimeout> {
	return setTimeout(fn, Math.max(0, ms));
}

export function disconnectSoon(nodes:AudioNode[], when:number, ctx:AudioContext, hold:number):void {
	const due = when + hold;
	const fire = ():void => {
		if (ctx.state === 'closed') {
			return;
		}
		const wait = due - ctx.currentTime;
		if (wait > 0.03) {
			later(wait * 1000, fire);
			return;
		}
		for (const n of nodes) {
			try {
				n.disconnect();
			}
			catch {
				// already gone
			}
		}
	};
	later((due - ctx.currentTime) * 1000, fire);
}

export function bellHz(
	ctx:AudioContext,
	dest:AudioNode,
	when:number,
	freq:number,
	dur:number,
	gain:number,
):void {
	const car = ctx.createOscillator();
	car.type = 'sine';
	car.frequency.value = freq;
	const mod = ctx.createOscillator();
	mod.type = 'sine';
	mod.frequency.value = freq * 2.01;
	const idx = ctx.createGain();
	const t0 = tAt(ctx, when);
	const t1 = Math.max(t0 + 0.02, tAt(ctx, when + dur));
	idx.gain.setValueAtTime(freq * 1.6, t0);
	idx.gain.exponentialRampToValueAtTime(Math.max(0.0001, freq * 0.08), t1);
	mod.connect(idx);
	idx.connect(car.frequency);
	const out = ctx.createGain();
	env(out, when, dur, gain * 0.22, 0.008, dur * 0.85);
	car.connect(out);
	out.connect(dest);
	car.start(when);
	mod.start(when);
	car.stop(when + dur + 0.05);
	mod.stop(when + dur + 0.05);
	disconnectSoon([car, mod, idx, out], when, ctx, dur + 0.15);
}

export function pluckHz(
	ctx:AudioContext,
	dest:AudioNode,
	noise:AudioBuffer,
	when:number,
	freq:number,
	dur:number,
	gain:number,
):void {
	const period = 1 / Math.max(40, freq);
	const delay = ctx.createDelay(1);
	delay.delayTime.value = period;
	const filter = ctx.createBiquadFilter();
	filter.type = 'lowpass';
	filter.frequency.value = Math.min(4200, freq * 7.5);
	filter.Q.value = 0.2;
	const fb = ctx.createGain();
	const t0 = tAt(ctx, when);
	fb.gain.setValueAtTime(0.9, t0);
	fb.gain.setTargetAtTime(0.0001, t0 + Math.max(0.08, dur * 0.7), 0.05);
	delay.connect(filter);
	filter.connect(fb);
	fb.connect(delay);
	const out = ctx.createGain();
	out.gain.setValueAtTime(Math.max(0.0002, gain * 0.55), t0);
	out.gain.exponentialRampToValueAtTime(0.0001, Math.max(t0 + 0.02, tAt(ctx, when + dur)));
	filter.connect(out);
	out.connect(dest);
	const burst = ctx.createBufferSource();
	burst.buffer = noise;
	const bg = ctx.createGain();
	bg.gain.setValueAtTime(gain, t0);
	bg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.018);
	burst.connect(bg);
	bg.connect(delay);
	burst.start(t0);
	burst.stop(t0 + 0.03);
	const tone = ctx.createOscillator();
	tone.type = 'triangle';
	tone.frequency.value = freq;
	const tg = ctx.createGain();
	tg.gain.setValueAtTime(gain * 0.28, t0);
	tg.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.min(dur, 0.45));
	tone.connect(tg);
	tg.connect(out);
	tone.start(t0);
	tone.stop(t0 + dur + 0.05);
	disconnectSoon([delay, filter, fb, out, burst, bg, tone, tg], t0, ctx, dur + 0.2);
}

export function noiseBurst(
	ctx:AudioContext,
	dest:AudioNode,
	noise:AudioBuffer,
	when:number,
	dur:number,
	gain:number,
	cutoff:number,
	type:BiquadFilterType,
	q:number,
):void {
	const src = ctx.createBufferSource();
	src.buffer = noise;
	const filter = ctx.createBiquadFilter();
	filter.type = type;
	filter.frequency.value = cutoff;
	filter.Q.value = q;
	const out = ctx.createGain();
	const t0 = tAt(ctx, when);
	const t1 = Math.max(t0 + 0.008, tAt(ctx, when + dur));
	out.gain.setValueAtTime(Math.max(0.0002, gain), t0);
	out.gain.exponentialRampToValueAtTime(0.0001, t1);
	src.connect(filter);
	filter.connect(out);
	out.connect(dest);
	src.start(t0);
	src.stop(t1 + 0.02);
	disconnectSoon([src, filter, out], t0, ctx, dur + 0.1);
}

const glottalWaves = new WeakMap<BaseAudioContext, PeriodicWave>();

/**
 * One period of a Rosenberg glottal pulse as an oscillator wave: the flow derivative of vocal
 * folds that open slowly and close gently. A throat's buzz, rounder than a sawtooth: the
 * voice of a `boo`. Only the first few harmonics, so it stays soft at a babble's high pitch.
 */
function glottalWave(ctx:BaseAudioContext):PeriodicWave {
	const hit = glottalWaves.get(ctx);
	if (hit) {
		return hit;
	}
	const harmonics = 4;
	const steps = 512;
	const open = 0.2;
	const close = 0.5;
	const flow = (t:number):number => (t < open
		? 0.5 * (1 - Math.cos(Math.PI * t / open))
		: t < open + close ? Math.cos(Math.PI * (t - open) / (2 * close)) : 0);
	const real = new Float32Array(harmonics + 1);
	const imag = new Float32Array(harmonics + 1);
	for (let i = 0; i < steps; i++) {
		const slope = flow((i + 1) / steps) - flow(i / steps);
		for (let k = 1; k <= harmonics; k++) {
			const phase = 2 * Math.PI * k * i / steps;
			real[k] = (real[k] ?? 0) + slope * Math.cos(phase);
			imag[k] = (imag[k] ?? 0) + slope * Math.sin(phase);
		}
	}
	const wave = ctx.createPeriodicWave(real, imag);
	glottalWaves.set(ctx, wave);
	return wave;
}

function filter(ctx:AudioContext, type:BiquadFilterType, hz:number, q:number):BiquadFilterNode {
	const node = ctx.createBiquadFilter();
	node.type = type;
	node.frequency.value = hz;
	node.Q.value = q;
	return node;
}

function level(ctx:AudioContext, gain:number):GainNode {
	const node = ctx.createGain();
	node.gain.value = gain;
	return node;
}

/** An oscillator gliding from `freq` to `freqTo` over `dur`, started and stopped. */
function glide(osc:OscillatorNode, t:number, freq:number, freqTo:number, dur:number):OscillatorNode {
	osc.frequency.setValueAtTime(freq, t);
	osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqTo), t + dur);
	osc.start(t);
	osc.stop(t + dur + 0.05);
	return osc;
}

/** `nodes` wired one after another from `from`; returns the last. */
function chain(from:AudioNode, nodes:AudioNode[]):AudioNode {
	return nodes.reduce<AudioNode>((a, b) => a.connect(b), from);
}

/**
 * The "b" of a `bee` or `boo`: the lips letting go, a click of air 2 ms long, mostly above
 * 8 kHz. Longer and airier would make it a "p".
 */
function lipsClick(ctx:AudioContext, dest:AudioNode, noise:AudioBuffer, t:number, gain:number):void {
	noiseBurst(ctx, dest, noise, t, 0.002, gain, 8000, 'highpass', 0.7);
}

/** Breath: noise with nothing below `hz` (three high-pass filters in a row), running from `t` for `dur`. */
function breath(ctx:AudioContext, noise:AudioBuffer, t:number, dur:number, hz:number):{ out:AudioNode; nodes:AudioNode[] } {
	const src = ctx.createBufferSource();
	src.buffer = noise;
	src.loop = true;
	src.start(t, Math.random() * noise.duration);
	src.stop(t + dur + 0.05);
	const highs = [hz, hz, hz].map((cut) => filter(ctx, 'highpass', cut, 0));
	return { out: chain(src, highs), nodes: [src, ...highs] };
}

/** Seconds a `bee`'s lips stay shut while its voice already hums behind them. */
const BEE_SHUT = 0.01;

/**
 * "Bee", matched band by band to recordings of two voices saying it. Its low energy is one
 * nearly pure tone (the first formant), then almost nothing from 500 Hz to 2.4 kHz, then a
 * bright ring: a second formant at 2.4–2.6 kHz and a fourth around 4.6 kHz, over breath that
 * fills 3 to 16 kHz about as loud as the tone. Its "b": the click of the lips, then 10 ms of
 * the voice humming behind them, quiet and rising (3% to 15%); then they let go, and within
 * 2 ms it is at full strength, the second formant ringing louder than the tone and settling
 * about 10 dB lower over the next 15 ms. It holds, then fades out over its last 40%. The ring
 * is a buzz at the same pitch, so it fuses with the tone.
 */
function bee(ctx:AudioContext, dest:AudioNode, noise:AudioBuffer, t:number, freq:number, freqTo:number, dur:number, gain:number):void {
	const open = t + BEE_SHUT;
	lipsClick(ctx, dest, noise, t, gain);
	const out = ctx.createGain();
	out.gain.setValueAtTime(gain * 0.03, t);
	out.gain.exponentialRampToValueAtTime(gain * 0.15, open);
	out.gain.exponentialRampToValueAtTime(gain, open + 0.002);
	out.gain.setValueAtTime(gain, Math.max(open + 0.002, t + dur * 0.6));
	out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
	out.connect(dest);
	const tone = glide(ctx.createOscillator(), t, freq, freqTo, dur);
	const toneLevel = level(ctx, 0.25);
	tone.connect(toneLevel).connect(out);
	// A trace of the octave, so the tone is a voice and not a whistle.
	const octave = glide(ctx.createOscillator(), t, freq * 2, freqTo * 2, dur);
	const octaveLevel = level(ctx, 0.0125);
	octave.connect(octaveLevel).connect(out);
	const buzz = ctx.createOscillator();
	buzz.type = 'sawtooth';
	glide(buzz, t, freq, freqTo, dur);
	// Three high-pass filters in a row empty the buzz below the ring, leaving the gap under it.
	const highs = [2400, 2400, 2400].map((hz) => filter(ctx, 'highpass', hz, 0));
	const bright = chain(buzz, highs);
	const second = filter(ctx, 'bandpass', 2400, 8);
	second.frequency.setValueAtTime(2400, open);
	second.frequency.exponentialRampToValueAtTime(2600, Math.max(open + 0.01, t + dur * 0.4));
	const secondLevel = ctx.createGain();
	secondLevel.gain.setValueAtTime(2.1, t);
	secondLevel.gain.setValueAtTime(7, open);
	secondLevel.gain.setTargetAtTime(2.1, open + 0.003, 0.01);
	const fourth = filter(ctx, 'bandpass', 4600, 3);
	const fourthLevel = level(ctx, 0.375);
	bright.connect(second).connect(secondLevel).connect(out);
	bright.connect(fourth).connect(fourthLevel).connect(out);
	const air = breath(ctx, noise, t, dur, 3000);
	const airLevel = ctx.createGain();
	airLevel.gain.setValueAtTime(0.4, t);
	airLevel.gain.setValueAtTime(1.3, open);
	air.out.connect(airLevel).connect(out);
	disconnectSoon([tone, toneLevel, octave, octaveLevel, buzz, ...highs, second, secondLevel, fourth, fourthLevel, ...air.nodes, airLevel, out], t, ctx, dur + 0.12);
}

/**
 * "Boo", matched band by band to recordings of two voices saying it: a throat's buzz with only
 * its low harmonics, almost nothing from 1.5 to 4 kHz, and a steady breath above 4.5 kHz. Its
 * "b": the click of the lips, then the breath and a murmur at 2% that swells steadily to full
 * strength a third of the way through, holds to halfway, and fades. As the lips round, the
 * mouth closes from 1.8 kHz to 800 Hz over the first 30 ms. The breath holds steady while the
 * voice swells under it.
 */
function boo(ctx:AudioContext, dest:AudioNode, noise:AudioBuffer, t:number, freq:number, freqTo:number, dur:number, gain:number):void {
	lipsClick(ctx, dest, noise, t, gain * 3);
	const out = ctx.createGain();
	out.gain.setValueAtTime(gain * 0.02, t);
	out.gain.linearRampToValueAtTime(gain, t + dur * 0.35);
	out.gain.setValueAtTime(gain, t + dur * 0.5);
	out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
	out.connect(dest);
	const buzz = ctx.createOscillator();
	buzz.setPeriodicWave(glottalWave(ctx));
	glide(buzz, t, freq, freqTo, dur);
	const mouth = [1800, 1800].map((hz) => {
		const lowpass = filter(ctx, 'lowpass', hz, 0);
		lowpass.frequency.setValueAtTime(hz, t);
		lowpass.frequency.exponentialRampToValueAtTime(800, t + 0.03);
		return lowpass;
	});
	chain(buzz, mouth).connect(out);
	const air = breath(ctx, noise, t, dur, 4500);
	const airLevel = ctx.createGain();
	airLevel.gain.setValueAtTime(gain * 0.25, t);
	airLevel.gain.setValueAtTime(gain * 0.25, t + dur * 0.5);
	airLevel.gain.exponentialRampToValueAtTime(0.0001, t + dur);
	air.out.connect(airLevel).connect(dest);
	disconnectSoon([buzz, ...mouth, out, ...air.nodes, airLevel], t, ctx, dur + 0.12);
}

/** How long a patch sounds: until its last layer ends, every layer lasting `dur` if given. */
const crackles = new WeakMap<BaseAudioContext, Map<number, AudioBuffer>>();

/**
 * Two seconds of random pops, `rate` a second: each a click of noise dying away in 0.5–3 ms, most
 * of them faint and a few loud. Made once per context and rate; a crackle loops it.
 */
function crackleBuffer(ctx:AudioContext, rate:number):AudioBuffer {
	const key = Math.round(rate);
	let byRate = crackles.get(ctx);
	if (!byRate) {
		byRate = new Map();
		crackles.set(ctx, byRate);
	}
	const hit = byRate.get(key);
	if (hit) {
		return hit;
	}
	const seconds = 2;
	const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
	const data = buf.getChannelData(0);
	for (let i = 0; i < key * seconds; i++) {
		const at = Math.floor(Math.random() * data.length);
		const amp = Math.random() ** 2.5;
		const fall = ctx.sampleRate * (0.0005 + Math.random() * 0.0025);
		for (let k = 0; k < fall * 5 && at + k < data.length; k++) {
			data[at + k]! += amp * (Math.random() * 2 - 1) * Math.exp(-k / fall);
		}
	}
	byRate.set(key, buf);
	return buf;
}

/** Sweeps `param` from `from` to `to` Hz over `dur` from `t` (holds `from` when `to` is unset). */
function sweep(param:AudioParam, t:number, from:number, to:number | undefined, dur:number):void {
	param.setValueAtTime(from, t);
	if (to !== undefined) {
		param.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
	}
}

/**
 * A creak's stick-slip, `dur` s long: one click each time the wood catches and slips, `freq` a
 * second at first and `freqTo` by the end, each a little early or late and louder or softer than
 * the last, swelling and fading with the strain.
 */
function slipBuffer(ctx:AudioContext, dur:number, freq:number, freqTo:number):AudioBuffer {
	const rate = ctx.sampleRate;
	const buf = ctx.createBuffer(1, Math.max(1, Math.ceil(rate * dur)), rate);
	const data = buf.getChannelData(0);
	const wobble = Math.random() * Math.PI * 2;
	for (let t = 0; t < dur;) {
		const u = t / dur;
		const strain = Math.sin(Math.PI * Math.min(1, u * 1.15)) * (0.75 + 0.25 * Math.sin(wobble + u * 17));
		const amp = strain * (0.6 + 0.8 * Math.random());
		const at = Math.floor(t * rate);
		for (let k = 0; k < 24 && at + k < data.length; k++) {
			data[at + k]! += amp * (Math.random() * 2 - 1) * Math.exp(-k / 4);
		}
		t += (0.8 + 0.4 * Math.random()) / (freq * (freqTo / freq) ** u);
	}
	return buf;
}

/** Resonances of a creaking piece of wood, over its lowest: ratio, loudness, and how much sharper each rings. */
const WOOD = [[1, 1, 1], [2.3, 0.5, 1.2], [3.9, 0.28, 1.4]] as const;

/**
 * Wood creaking: stick-slip clicks (`freq` to `freqTo` a second; slow is a groan, fast a squeal)
 * ringing the wood's resonances from `body` Hz up, `q` sharp. A big door is a low body, a bow a high one.
 */
function creak(ctx:AudioContext, dest:AudioNode, t:number, freq:number, freqTo:number, dur:number, gain:number, body:number, q:number):void {
	const src = ctx.createBufferSource();
	src.buffer = slipBuffer(ctx, dur, Math.max(1, freq), Math.max(1, freqTo));
	const out = ctx.createGain();
	env(out, t, dur, gain, 0.02, dur * 0.3);
	out.connect(dest);
	const nodes:AudioNode[] = [src, out];
	for (const [ratio, loud, sharp] of WOOD) {
		const band = filter(ctx, 'bandpass', body * ratio, q * sharp);
		// A narrow band passes little of a click: make it up.
		const g = level(ctx, loud * Math.sqrt(q * sharp) * 2);
		src.connect(band);
		band.connect(g).connect(out);
		nodes.push(band, g);
	}
	src.start(t);
	disconnectSoon(nodes, t, ctx, dur + 0.15);
}

/** Formants (Hz) of each vowel, low to high, for a grown voice. */
const VOWELS:Record<Vowel, [number, number, number]> = {
	a: [800, 1150, 2900],
	e: [480, 1720, 2520],
	i: [310, 2200, 2960],
	o: [480, 800, 2830],
	u: [340, 700, 2400],
};

/** Partials of a struck metal bar (ratios over the lowest), how loud each starts, and how long each rings (shares of the layer). */
const METAL = [[1, 1, 1], [2.76, 0.6, 0.7], [5.4, 0.42, 0.5], [8.93, 0.26, 0.35], [13.34, 0.16, 0.25]] as const;

/** A shaped noise layer: swelling in over `attack`, its filter sweeping from `cutoff` to `cutoffTo`. */
function shapedNoise(ctx:AudioContext, dest:AudioNode, buffer:AudioBuffer, layer:SfxLayer, t:number, dur:number, gain:number, cutoff:number, type:BiquadFilterType, q:number):void {
	const src = ctx.createBufferSource();
	src.buffer = buffer;
	src.loop = true;
	const shape = filter(ctx, type, cutoff, q);
	sweep(shape.frequency, t, cutoff, layer.cutoffTo, dur);
	// Without an attack it dies away over most of its length; with one it swells, holds and dies away over the rest.
	const out = ctx.createGain();
	env(out, t, dur, gain, layer.attack ?? 0.004, layer.release ?? dur - (layer.attack ?? dur * 0.4));
	chain(src, [shape, out, dest]);
	src.start(t, Math.random() * Math.max(0, buffer.duration - 0.1));
	src.stop(t + dur + 0.05);
	disconnectSoon([src, shape, out], t, ctx, dur + 0.15);
}

/** A struck bar at `freq`: its partials ringing out over `dur`, with a bright tick of the strike. */
function metal(ctx:AudioContext, dest:AudioNode, noise:AudioBuffer, t:number, freq:number, dur:number, gain:number, cutoff:number):void {
	const nodes:AudioNode[] = [];
	for (const [ratio, loud, ring] of METAL) {
		const osc = ctx.createOscillator();
		osc.frequency.value = freq * ratio * (1 + (Math.random() - 0.5) * 0.01);
		const g = ctx.createGain();
		g.gain.setValueAtTime(gain * loud, t);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur * ring);
		osc.connect(g).connect(dest);
		osc.start(t);
		osc.stop(t + dur * ring + 0.02);
		nodes.push(osc, g);
	}
	noiseBurst(ctx, dest, noise, t, 0.02, gain * 0.7, cutoff, 'highpass', 0.7);
	disconnectSoon(nodes, t, ctx, dur + 0.1);
}

/**
 * A throat's buzz at `freq` gliding to `freqTo`, shaped into `vowel` by three formants, with a
 * breath of air through it; trembling `tremble` times a second (0 holds steady). `tract` scales the
 * formants: below 1 a bigger throat.
 */
function formant(ctx:AudioContext, dest:AudioNode, noise:AudioBuffer, t:number, freq:number, freqTo:number, dur:number, gain:number, vowel:Vowel, attack:number, release:number, tremble:number, tract:number):void {
	const out = ctx.createGain();
	env(out, t, dur, gain, attack, release);
	out.connect(dest);
	const buzz = glide(ctx.createOscillator(), t, freq, freqTo, dur);
	buzz.type = 'sawtooth';
	const air = breath(ctx, noise, t, dur, 900);
	const nodes:AudioNode[] = [out, buzz, ...air.nodes];
	if (tremble > 0) {
		// The pitch wavers about 4%, unevenly: two slow wobbles against each other.
		for (const [rate, depth] of [[tremble, 0.03], [tremble * 1.7, 0.015]] as const) {
			const lfo = ctx.createOscillator();
			lfo.frequency.value = rate * (0.9 + 0.2 * Math.random());
			const swing = level(ctx, Math.max(freq, freqTo) * depth);
			lfo.connect(swing).connect(buzz.frequency);
			lfo.start(t);
			lfo.stop(t + dur + 0.05);
			nodes.push(lfo, swing);
		}
	}
	VOWELS[vowel].forEach((hz, i) => {
		const band = filter(ctx, 'bandpass', hz * tract, 6 + i * 3);
		const g = level(ctx, [1, 0.5, 0.25][i]!);
		buzz.connect(band);
		air.out.connect(band);
		band.connect(g).connect(out);
		nodes.push(band, g);
	});
	disconnectSoon(nodes, t, ctx, dur + 0.15);
}

/** Low noise below `cutoff` (sweeping to `cutoffTo`) rolling `rate` times a second, over a sub tone gliding down from `freq`. */
function rumble(ctx:AudioContext, dest:AudioNode, noise:AudioBuffer, layer:SfxLayer, t:number, freq:number, dur:number, gain:number):void {
	const out = ctx.createGain();
	env(out, t, dur, gain, layer.attack ?? dur * 0.08, layer.release ?? dur * 0.75);
	out.connect(dest);
	const src = ctx.createBufferSource();
	src.buffer = noise;
	src.loop = true;
	const low = filter(ctx, 'lowpass', layer.cutoff ?? 160, 0.9);
	sweep(low.frequency, t, layer.cutoff ?? 160, layer.cutoffTo, dur);
	const roll = level(ctx, 0.6);
	const lfo = ctx.createOscillator();
	lfo.frequency.value = layer.rate ?? 5;
	const depth = level(ctx, 0.4);
	lfo.connect(depth).connect(roll.gain);
	chain(src, [low, roll, out]);
	const sub = glide(ctx.createOscillator(), t, freq, layer.freqTo ?? freq * 0.6, dur);
	const subGain = level(ctx, 0.5);
	sub.connect(subGain).connect(out);
	src.start(t);
	src.stop(t + dur + 0.05);
	lfo.start(t);
	lfo.stop(t + dur + 0.05);
	disconnectSoon([out, src, low, roll, lfo, depth, sub, subGain], t, ctx, dur + 0.15);
}

/** `patch` with every layer's `freq` and `freqTo` times `pitch`, and its `cutoff` and `cutoffTo` times `tract` (a `formant`'s vowel takes `tract` from the play's options). */
export function pitched(patch:SfxPatch, pitch:number, tract = 1):SfxPatch {
	const times = (v:number | undefined, by:number):number | undefined => (v === undefined ? v : v * by);
	return pitch === 1 && tract === 1 ? patch : {
		...patch,
		layers: patch.layers.map((l) => ({ ...l, freq: times(l.freq, pitch), freqTo: times(l.freqTo, pitch), cutoff: times(l.cutoff, tract), cutoffTo: times(l.cutoffTo, tract) })),
	};
}

/** `patch` as one play hears it: its pitch and loudness moved by up to its `vary`. */
export function varied(patch:SfxPatch):SfxPatch {
	const vary = patch.vary ?? 0;
	if (vary <= 0) {
		return patch;
	}
	const pitch = 2 ** ((Math.random() * 2 - 1) * vary * 4 / 12);
	const hz = (v:number | undefined):number | undefined => (v === undefined ? v : v * pitch);
	return {
		...patch,
		gain: (patch.gain ?? 1) * (1 + (Math.random() * 2 - 1) * vary * 0.3),
		layers: patch.layers.map((l) => ({ ...l, freq: hz(l.freq), freqTo: hz(l.freqTo), cutoff: hz(l.cutoff), cutoffTo: hz(l.cutoffTo) })),
	};
}

export function patchSeconds(patch:SfxPatch, dur?:number):number {
	return patch.layers.reduce((end, layer) => Math.max(end, (layer.when ?? 0) + (dur ?? layer.dur)), 0);
}

export function playLayer(
	ctx:AudioContext,
	dest:AudioNode,
	noise:AudioBuffer,
	layer:SfxLayer,
	when:number,
	opts:SfxOpts,
):void {
	const dur = opts.dur ?? layer.dur;
	const freq = opts.freq ?? layer.freq ?? 220;
	const gain = (layer.gain ?? 1) * (opts.gain ?? 1);
	const t = tAt(ctx, when + (layer.when ?? 0));
	switch (layer.kind) {
		case 'pluck':
			pluckHz(ctx, dest, noise, t, freq, dur, gain);
			return;
		case 'fm':
			bellHz(ctx, dest, t, freq, dur, gain);
			return;
		case 'thump': {
			const osc = ctx.createOscillator();
			osc.type = 'sine';
			osc.frequency.setValueAtTime(freq, t);
			osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * 0.45), t + dur);
			const og = ctx.createGain();
			og.gain.setValueAtTime(gain, t);
			og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
			osc.connect(og);
			og.connect(dest);
			osc.start(t);
			osc.stop(t + dur + 0.02);
			noiseBurst(ctx, dest, noise, t, dur * 0.5, gain * 0.4, layer.cutoff ?? 400, 'lowpass', 0.7);
			disconnectSoon([osc, og], t, ctx, dur + 0.1);
			return;
		}
		case 'click': {
			noiseBurst(ctx, dest, noise, t, Math.min(dur, 0.04), gain, layer.cutoff ?? 3500, 'highpass', 0.7);
			const osc = ctx.createOscillator();
			osc.type = 'sine';
			osc.frequency.value = freq;
			const og = ctx.createGain();
			og.gain.setValueAtTime(gain * 0.5, t);
			og.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(dur, 0.05));
			osc.connect(og);
			og.connect(dest);
			osc.start(t);
			osc.stop(t + 0.06);
			disconnectSoon([osc, og], t, ctx, 0.12);
			return;
		}
		case 'creak':
			creak(ctx, dest, t, freq, layer.freqTo ?? freq, dur, gain, layer.cutoff ?? 900, layer.q ?? 6);
			return;
		case 'chirp': {
			const osc = ctx.createOscillator();
			osc.type = 'sine';
			osc.frequency.setValueAtTime(freq, t);
			osc.frequency.exponentialRampToValueAtTime(Math.max(40, layer.freqTo ?? freq * 1.6), t + dur);
			const out = ctx.createGain();
			env(out, t, dur, gain, 0.01, 0.08);
			osc.connect(out);
			out.connect(dest);
			osc.start(t);
			osc.stop(t + dur + 0.05);
			disconnectSoon([osc, out], t, ctx, dur + 0.12);
			return;
		}
		case 'bee':
			bee(ctx, dest, noise, t, freq, layer.freqTo ?? freq, dur, gain);
			return;
		case 'boo':
			boo(ctx, dest, noise, t, freq, layer.freqTo ?? freq, dur, gain);
			return;
		case 'crackle':
			shapedNoise(ctx, dest, crackleBuffer(ctx, layer.rate ?? 40), layer, t, dur, gain, layer.cutoff ?? 2500, layer.filter ?? 'bandpass', layer.q ?? 0.8);
			return;
		case 'metal':
			metal(ctx, dest, noise, t, freq, dur, gain, layer.cutoff ?? 4000);
			return;
		case 'formant':
			formant(ctx, dest, noise, t, freq, layer.freqTo ?? freq, dur, gain, layer.vowel ?? 'a', layer.attack ?? 0.02, layer.release ?? dur * 0.5, layer.rate ?? 0, opts.tract ?? 1);
			return;
		case 'rumble':
			rumble(ctx, dest, noise, layer, t, layer.freq ?? 50, dur, gain);
			return;
		default:
			if (layer.attack !== undefined || layer.cutoffTo !== undefined) {
				shapedNoise(ctx, dest, noise, layer, t, dur, gain, layer.cutoff ?? freq, layer.filter ?? 'lowpass', layer.q ?? 1);
				return;
			}
			noiseBurst(ctx, dest, noise, t, dur, gain, layer.cutoff ?? freq, layer.filter ?? 'lowpass', layer.q ?? 1);
	}
}

export type LoopNodes = {
	stop:(when:number)=>void;
};

/** Looping filtered-noise bed (`crackle` layers loop their pops instead). Two detuned copies hide the buffer seam. */
export function startLoopLayers(
	ctx:AudioContext,
	dest:AudioNode,
	noise:AudioBuffer,
	layers:readonly SfxLayer[],
	gain:number,
):LoopNodes {
	const nodes:AudioNode[] = [];
	const sources:AudioBufferSourceNode[] = [];
	const oscs:OscillatorNode[] = [];
	const now = ctx.currentTime;
	for (const layer of layers) {
		const cutoff = layer.cutoff ?? layer.freq ?? 500;
		const crackle = layer.kind === 'crackle';
		const type:BiquadFilterType = layer.filter ?? (crackle ? 'bandpass' : 'lowpass');
		const mix = ctx.createGain();
		mix.gain.value = gain * (layer.gain ?? 1);
		mix.connect(dest);
		nodes.push(mix);
		for (const rate of [0.89, 1.12]) {
			const src = ctx.createBufferSource();
			src.buffer = crackle ? crackleBuffer(ctx, layer.rate ?? 40) : noise;
			src.loop = true;
			src.playbackRate.value = rate;
			const filter = ctx.createBiquadFilter();
			filter.type = type;
			filter.frequency.value = cutoff;
			filter.Q.value = layer.q ?? 0.7;
			const lfo = ctx.createOscillator();
			lfo.frequency.value = 0.11 + Math.random() * 0.16;
			const lfoG = ctx.createGain();
			lfoG.gain.value = cutoff * 0.16;
			lfo.connect(lfoG);
			lfoG.connect(filter.frequency);
			const g = ctx.createGain();
			g.gain.value = 0.55;
			src.connect(filter);
			filter.connect(g);
			g.connect(mix);
			src.start(now);
			lfo.start(now);
			sources.push(src);
			oscs.push(lfo);
			nodes.push(src, filter, g, lfo, lfoG);
		}
	}
	return {
		stop(when:number):void {
			for (const s of sources) {
				try {
					s.stop(when);
				}
				catch {
					// already stopped
				}
			}
			for (const o of oscs) {
				try {
					o.stop(when);
				}
				catch {
					// already stopped
				}
			}
			later((when - ctx.currentTime + 0.12) * 1000, () => {
				for (const n of nodes) {
					try {
						n.disconnect();
					}
					catch {
						// gone
					}
				}
			});
		},
	};
}
