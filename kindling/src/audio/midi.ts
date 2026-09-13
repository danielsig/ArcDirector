import { instrumentOf } from './instruments.js';

export function midiHz(midi:number):number {
	return 440 * 2 ** ((midi - 69) / 12);
}

export function clamp(n:number, lo:number, hi:number):number {
	return Math.max(lo, Math.min(hi, n));
}

/** Empty list means the score is playable. */
export function scoreProblems(score:ScoreLike):string[] {
	const out:string[] = [];
	if (!(score.bpm > 0) || !Number.isFinite(score.bpm)) {
		out.push('bpm');
	}
	if (!(score.loop > 0) || !Number.isFinite(score.loop)) {
		out.push('loop');
	}
	const loops = score.loops ?? -1;
	if (loops !== -1 && !(Number.isInteger(loops) && loops > 0)) {
		out.push('loops');
	}
	if (score.cues) {
		for (let i = 0; i < score.cues.length; i++) {
			const c = score.cues[i];
			if (!c || typeof c.fn !== 'function' || !Number.isFinite(c.beat) || c.beat < 0 || c.beat > score.loop) {
				out.push(`cue ${i}`);
			}
		}
	}
	for (let v = 0; v < score.voices.length; v++) {
		const voice = score.voices[v];
		if (!voice) {
			out.push(`voice ${v}`);
			continue;
		}
		if (!voice.instrument || !instrumentOf(voice.instrument)) {
			out.push(`voice ${v} instrument`);
		}
		for (let i = 0; i < voice.notes.length; i++) {
			const n = voice.notes[i];
			if (!n || !Number.isFinite(n.pitch) || !Number.isFinite(n.beat) || !(n.dur > 0)) {
				out.push(`voice ${v} note ${i}`);
				continue;
			}
			if (n.beat < 0 || n.beat >= score.loop) {
				out.push(`voice ${v} note ${i} beat`);
			}
		}
	}
	return out;
}

type ScoreLike = {
	bpm:number;
	loop:number;
	loops?:number;
	cues?:{ beat:number; fn:()=>void }[];
	voices:{ instrument?:string; notes:{ pitch:number; beat:number; dur:number }[] }[];
};
