import { instrumentOf, registerInstrument } from './instruments.js';
import { midiHz } from './midi.js';
import type { SfxLayer, SfxOpts, Voice } from './types.js';

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

function tAt(ctx:BaseAudioContext, t:number):number {
	return Math.max(t, ctx.currentTime + 0.003);
}

function env(
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

function disconnectSoon(nodes:AudioNode[], when:number, ctx:AudioContext, hold:number):void {
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

function bellHz(
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

function pluckHz(
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

function noiseBurst(
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
		case 'creak': {
			const src = ctx.createBufferSource();
			src.buffer = noise;
			src.loop = true;
			const filter = ctx.createBiquadFilter();
			filter.type = 'bandpass';
			filter.Q.value = layer.q ?? 6;
			filter.frequency.setValueAtTime(freq, t);
			filter.frequency.exponentialRampToValueAtTime(Math.max(80, layer.freqTo ?? freq * 0.45), t + dur);
			const out = ctx.createGain();
			env(out, t, dur, gain, 0.04, 0.12);
			src.connect(filter);
			filter.connect(out);
			out.connect(dest);
			src.start(t);
			src.stop(t + dur + 0.05);
			disconnectSoon([src, filter, out], t, ctx, dur + 0.15);
			return;
		}
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
		case 'murmur': {
			murmur(ctx, dest, t, freq, dur, gain, opts.freqTo ?? layer.freqTo);
			return;
		}
		default:
			noiseBurst(
				ctx,
				dest,
				noise,
				t,
				dur,
				gain,
				layer.cutoff ?? freq,
				layer.freqTo ? 'bandpass' : 'lowpass',
				layer.q ?? 1,
			);
	}
}

function murmur(ctx:AudioContext, dest:AudioNode, when:number, freq:number, dur:number, gain:number, freqTo?:number):void {
	const osc = ctx.createOscillator();
	osc.type = 'sawtooth';
	const t0 = tAt(ctx, when);
	osc.frequency.setValueAtTime(freq, t0);
	if (freqTo && freqTo > freq) {
		const rise = Math.min(0.28, Math.max(0.12, dur * 0.22));
		const tRise = Math.max(t0 + 0.05, t0 + dur - rise);
		osc.frequency.setValueAtTime(freq, tRise);
		osc.frequency.exponentialRampToValueAtTime(Math.max(freq + 1, freqTo), t0 + dur);
	}
	const lfo = ctx.createOscillator();
	lfo.frequency.value = 4.4 + (freq % 3);
	const lfoGain = ctx.createGain();
	lfoGain.gain.value = freq * 0.04;
	lfo.connect(lfoGain);
	lfoGain.connect(osc.frequency);
	const mix = ctx.createGain();
	mix.gain.value = 1;
	const out = ctx.createGain();
	env(out, t0, dur, gain * 0.18, 0.04, 0.16);
	const trem = ctx.createOscillator();
	trem.frequency.value = 7.5;
	const tremG = ctx.createGain();
	tremG.gain.value = gain * 0.05;
	trem.connect(tremG);
	tremG.connect(out.gain);
	for (const f of [freq * 3.2, 1100, 2400]) {
		const bp = ctx.createBiquadFilter();
		bp.type = 'bandpass';
		bp.frequency.value = f;
		bp.Q.value = 4.5;
		osc.connect(bp);
		bp.connect(mix);
		disconnectSoon([bp], t0, ctx, dur + 0.2);
	}
	mix.connect(out);
	out.connect(dest);
	osc.start(t0);
	lfo.start(t0);
	trem.start(t0);
	osc.stop(t0 + dur + 0.05);
	lfo.stop(t0 + dur + 0.05);
	trem.stop(t0 + dur + 0.05);
	disconnectSoon([osc, lfo, lfoGain, mix, out, trem, tremG], t0, ctx, dur + 0.2);
}

export type LoopNodes = {
	stop:(when:number)=>void;
};

/** Looping filtered-noise bed. Two detuned copies hide the buffer seam. */
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
		const type:BiquadFilterType = layer.filter ?? 'lowpass';
		const mix = ctx.createGain();
		mix.gain.value = gain * (layer.gain ?? 1);
		mix.connect(dest);
		nodes.push(mix);
		for (const rate of [0.89, 1.12]) {
			const src = ctx.createBufferSource();
			src.buffer = noise;
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

export const pad = registerInstrument('pad', 'sustaining', playPad);
export const bass = registerInstrument('bass', 'sustaining', playBass);
export const lead = registerInstrument('lead', 'sustaining', playLead);
export const pluck = registerInstrument('pluck', 'percussive', playPluck);
export const drum = registerInstrument('drum', 'percussive', playDrum);
export const bell = registerInstrument('bell', 'percussive', playBell);
export const air = registerInstrument('air', 'sustaining', playAir);
export const piano = registerInstrument('piano', 'percussive', playPiano);

