import { midiHz, registerInstrument } from '@arc-director/kindling';

function tAt(ctx:BaseAudioContext, t:number):number {
	return Math.max(t, ctx.currentTime + 0.003);
}

function env(g:GainNode, when:number, dur:number, peak:number, attack:number, release:number):void {
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

function playViolin(
	ctx:AudioContext,
	dest:AudioNode,
	_noise:AudioBuffer,
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
	_noise:AudioBuffer,
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

function playFlute(
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
	osc.type = 'sine';
	osc.frequency.value = freq;
	const bp = ctx.createBiquadFilter();
	bp.type = 'bandpass';
	bp.frequency.value = freq * 1.5;
	bp.Q.value = 2.2;
	const out = ctx.createGain();
	env(out, when, dur, gain * 0.32, 0.06, 0.14);
	osc.connect(bp);
	bp.connect(out);
	out.connect(dest);
	const breath = ctx.createBufferSource();
	breath.buffer = noise;
	const bFilt = ctx.createBiquadFilter();
	bFilt.type = 'bandpass';
	bFilt.frequency.value = freq * 2.4;
	bFilt.Q.value = 1.1;
	const bGain = ctx.createGain();
	bGain.gain.value = gain * 0.04;
	breath.connect(bFilt);
	bFilt.connect(bGain);
	bGain.connect(out);
	osc.start(when);
	breath.start(when);
	osc.stop(when + dur + 0.05);
	breath.stop(when + dur + 0.05);
	disconnectSoon([osc, bp, out, breath, bFilt, bGain], when, ctx, dur + 0.15);
}

export const violin = registerInstrument('violin', 'sustaining', playViolin);
export const brass = registerInstrument('brass', 'sustaining', playBrass);
export const flute = registerInstrument('flute', 'sustaining', playFlute);
