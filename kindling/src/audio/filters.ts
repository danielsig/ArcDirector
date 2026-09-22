import type { OverdriveFilter, ReverbFilter, Score, SoundFilter } from './types.js';

function clamp(n:number, lo:number, hi:number):number {
	return Math.max(lo, Math.min(hi, n));
}

function unit(n:number):boolean {
	return Number.isFinite(n) && n >= 0 && n <= 1;
}

/** Waveshaper sample in [-1, 1]. Drive 0 is a straight line. */
export function overdriveSample(x:number, drive:number):number {
	const d = clamp(drive, 0, 1);
	if (d <= 0) {
		return clamp(x, -1, 1);
	}
	const k = 1 + d * 36;
	const y = Math.tanh(k * x) / Math.tanh(k);
	return clamp(y, -1, 1);
}

export function overdriveCurve(drive:number, length = 2048):Float32Array {
	const curve = new Float32Array(length);
	const d = clamp(drive, 0, 1);
	for (let i = 0; i < length; i++) {
		const x = (i / (length - 1)) * 2 - 1;
		curve[i] = overdriveSample(x, d);
	}
	return curve;
}

/** Short room. `mix` is wet level added to a full dry signal. */
export function reverb(opts:Omit<ReverbFilter, 'kind'> = {}):ReverbFilter {
	return { kind: 'reverb', ...opts };
}

/** Soft clip plus a tone lowpass. `drive` is 0–1. */
export function overdrive(opts:Omit<OverdriveFilter, 'kind'> = {}):OverdriveFilter {
	return { kind: 'overdrive', ...opts };
}

/** Empty when the list is usable. */
export function filterProblems(filters:readonly SoundFilter[] | undefined, label = 'filter'):string[] {
	if (!filters) {
		return [];
	}
	if (!Array.isArray(filters)) {
		return [label];
	}
	const out:string[] = [];
	for (let i = 0; i < filters.length; i++) {
		const f = filters[i];
		const tag = `${label} ${i}`;
		if (!f || (f.kind !== 'reverb' && f.kind !== 'overdrive')) {
			out.push(tag);
			continue;
		}
		if (f.kind === 'reverb') {
			if (f.mix !== undefined && !unit(f.mix)) {
				out.push(`${tag} mix`);
			}
			if (f.decay !== undefined && !unit(f.decay)) {
				out.push(`${tag} decay`);
			}
			if (f.tone !== undefined && !(f.tone > 0 && Number.isFinite(f.tone))) {
				out.push(`${tag} tone`);
			}
		}
		else {
			if (f.drive !== undefined && !unit(f.drive)) {
				out.push(`${tag} drive`);
			}
			if (f.tone !== undefined && !(f.tone > 0 && Number.isFinite(f.tone))) {
				out.push(`${tag} tone`);
			}
		}
	}
	return out;
}

export type FilterChain = {
	input:GainNode;
	output:GainNode;
	nodes:AudioNode[];
	disconnect:()=>void;
};

/**
 * Parallel short delays. `wet` is the send gain (the music bus uses 0.28).
 * Dry is the caller's job.
 */
export function createReverbSend(
	ctx:AudioContext,
	opts?:{ decay?:number; tone?:number; wet?:number },
):{ in:GainNode; out:GainNode; nodes:AudioNode[] } {
	const input = ctx.createGain();
	const out = ctx.createGain();
	out.gain.value = clamp(opts?.wet ?? 0.28, 0, 1);
	const decay = clamp(opts?.decay ?? 0.38, 0, 0.85);
	const tone = clamp(opts?.tone ?? 2400, 200, 12000);
	const nodes:AudioNode[] = [input, out];
	for (const delayTime of [0.029, 0.043, 0.071, 0.103]) {
		const delay = ctx.createDelay(0.2);
		delay.delayTime.value = delayTime;
		const lp = ctx.createBiquadFilter();
		lp.type = 'lowpass';
		lp.frequency.value = tone;
		const fb = ctx.createGain();
		fb.gain.value = decay;
		input.connect(delay);
		delay.connect(lp);
		lp.connect(fb);
		fb.connect(delay);
		lp.connect(out);
		nodes.push(delay, lp, fb);
	}
	return { in: input, out, nodes };
}

function disconnectNodes(nodes:readonly AudioNode[]):void {
	for (const node of nodes) {
		try {
			node.disconnect();
		}
		catch {
			// already gone
		}
	}
}

function stage(ctx:AudioContext, filter:SoundFilter):{ input:AudioNode; output:AudioNode; nodes:AudioNode[] } {
	if (filter.kind === 'reverb') {
		const input = ctx.createGain();
		const output = ctx.createGain();
		const dry = ctx.createGain();
		dry.gain.value = 1;
		const send = createReverbSend(ctx, {
			decay: filter.decay,
			tone: filter.tone,
			wet: filter.mix ?? 0.28,
		});
		input.connect(dry);
		dry.connect(output);
		input.connect(send.in);
		send.out.connect(output);
		return { input, output, nodes: [input, output, dry, ...send.nodes] };
	}
	const drive = clamp(filter.drive ?? 0.45, 0, 1);
	const input = ctx.createGain();
	input.gain.value = 1 + drive * 7;
	const shaper = ctx.createWaveShaper();
	shaper.curve = overdriveCurve(drive) as Float32Array<ArrayBuffer>;
	shaper.oversample = '2x';
	const tone = ctx.createBiquadFilter();
	tone.type = 'lowpass';
	tone.frequency.value = clamp(filter.tone ?? 2800, 200, 12000);
	tone.Q.value = 0.7;
	const output = ctx.createGain();
	output.gain.value = 1 / (1 + drive * 2.4);
	input.connect(shaper);
	shaper.connect(tone);
	tone.connect(output);
	return { input, output, nodes: [input, shaper, tone, output] };
}

/** Series insert. Sources connect to `input`; `output` goes to the bus. */
export function createFilterChain(ctx:AudioContext, filters:readonly SoundFilter[]):FilterChain {
	const input = ctx.createGain();
	const output = ctx.createGain();
	const nodes:AudioNode[] = [input, output];
	let head:AudioNode = input;
	for (const filter of filters) {
		const next = stage(ctx, filter);
		head.connect(next.input);
		nodes.push(...next.nodes);
		head = next.output;
	}
	head.connect(output);
	return {
		input,
		output,
		nodes,
		disconnect: ():void => {
			disconnectNodes(nodes);
		},
	};
}

export function scoreHasFilters(score:Score):boolean {
	if (score.filters && score.filters.length > 0) {
		return true;
	}
	return score.voices.some((voice) => !!voice.filters && voice.filters.length > 0);
}

/**
 * Notes connect to `input` (or `voiceDest[i]` when that voice has its own chain).
 * `tail` is the bus those chains feed.
 */
export function openScoreFilters(
	ctx:AudioContext,
	score:Score,
	tail:AudioNode,
):{ input:AudioNode; voiceDest:AudioNode[] | null; nodes:AudioNode[] } | null {
	if (!scoreHasFilters(score)) {
		return null;
	}
	const nodes:AudioNode[] = [];
	let input:AudioNode = tail;
	if (score.filters && score.filters.length > 0) {
		const chain = createFilterChain(ctx, score.filters);
		chain.output.connect(tail);
		nodes.push(...chain.nodes);
		input = chain.input;
	}
	const anyVoice = score.voices.some((voice) => !!voice.filters && voice.filters.length > 0);
	if (!anyVoice) {
		return { input, voiceDest: null, nodes };
	}
	const voiceDest = score.voices.map((voice) => {
		if (!voice.filters || voice.filters.length === 0) {
			return input;
		}
		const chain = createFilterChain(ctx, voice.filters);
		chain.output.connect(input);
		nodes.push(...chain.nodes);
		return chain.input;
	});
	return { input, voiceDest, nodes };
}
