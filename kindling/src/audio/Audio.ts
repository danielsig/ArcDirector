import { createFilterChain, createReverbSend, filterProblems, openScoreFilters } from './filters.js';
import { scoreProblems } from './midi.js';
import { distanceGain, forceStereo, makePanner, placePanner, poseListener } from './spatial.js';
import { makeNoise, playLayer, playVoiceNote, startLoopLayers, type LoopNodes } from './synth.js';
import type { ListenerPose, Score, SfxOpts, SfxPatch } from './types.js';

function audioCtor():(new (opts?:AudioContextOptions)=>AudioContext) | undefined {
	const g = globalThis as typeof globalThis & {
		webkitAudioContext?:new (opts?:AudioContextOptions)=>AudioContext;
	};
	return g.AudioContext ?? g.webkitAudioContext;
}

const LOOKAHEAD = 0.32;
const HEAR = 22;
/** Notes must start this far in the future. Past-time ramps scream. */
const AHEAD = 0.008;
/** First beat after play/resume. Lets the context wake so beat 0 is not skipped. */
const START_LEAD = 0.18;

function wrap(value:number, span:number):number {
	if (!(span > 0)) {
		return 0;
	}
	const w = value % span;
	return w < 0 ? w + span : w;
}

/**
 * Where a recording playhead sits. `position` is the unwrapped start plus
 * elapsed seconds. Playback runs up to `loopEnd`, then jumps to `loopStart`.
 */
export function placeRecording(position:number, loopStart:number, loopEnd:number):number {
	if (!(loopEnd > 0)) {
		return 0;
	}
	if (position < loopEnd) {
		return position < 0 ? 0 : position;
	}
	const span = loopEnd - loopStart;
	if (!(span > 0)) {
		return loopStart;
	}
	let into = (position - loopEnd) % span;
	if (into < 0) {
		into += span;
	}
	if (into > span - 1e-4) {
		into = 0;
	}
	return loopStart + into;
}

/** True when a note should be sent to Web Audio this frame. */
export function noteIsDue(t:number, now:number, lookahead = LOOKAHEAD):boolean {
	return t >= now + AHEAD && t <= now + lookahead;
}

export type LoopSrc = SfxPatch | Score;

function isScore(src:LoopSrc):src is Score {
	return 'voices' in src;
}

type LoopVoice = {
	x:number;
	y:number;
	z:number;
	hear:number;
	falloff:number;
	userGain:number;
	src:LoopSrc;
	panner:PannerNode;
	dist:GainNode;
	voice:LoopNodes | null;
	local:AudioNode | null;
	/** Per-voice insert, when that voice lists filters. Otherwise notes use `local`. */
	voiceDest:AudioNode[] | null;
	release:()=>void;
	origin:number;
	clockDirty:boolean;
	scheduled:Set<string>;
	firedCues:Set<string>;
	pruneCycle:number;
};

/**
 * Mixer. Scores are procedural. `playRecording` plays a finished file on the
 * music output, dry, so a mastered track is not sent through the synth room.
 * Headless (no AudioContext) is a silent no-op.
 *
 * ```ts
 * world.audio.connectUnlock(canvas);
 * await world.audio.resume(); // after a click
 * world.audio.playMusic(score);
 * world.audio.playLoop('radio', score, { x, z, hear: 12 });
 * world.audio.playSfx(patch, { x, z });
 * ```
 *
 * While a score or loop is live, `update` runs on its own animation frame.
 * Hosts may still call `update()`; it is safe extra times.
 */
export class Audio {
	musicVolume = 0.52;
	sfxVolume = 0.78;
	muted = false;
	/** 0–1 extra music attenuator (pause menu). */
	duck = 1;
	/** `console.warn` once per drop reason (`sfx before resume`, `late music note`). */
	warnDropped = true;
	private ctx:AudioContext | null = null;
	private master:GainNode | null = null;
	private musicGain:GainNode | null = null;
	private sfxGain:GainNode | null = null;
	private musicBus:GainNode | null = null;
	/** Where score notes connect. Filter input when the score lists filters, else the bus. */
	private noteDest:AudioNode | null = null;
	private voiceDest:AudioNode[] | null = null;
	private filterNodes:AudioNode[] = [];
	private musicDry:GainNode | null = null;
	private musicWetIn:AudioNode | null = null;
	private noise:AudioBuffer | null = null;
	private score:Score | null = null;
	/** Finished file on the music output. Loops. Not sent through the synth room. */
	private recording:AudioBufferSourceNode | null = null;
	private recordingBuffer:AudioBuffer | null = null;
	private recordingGain = 1;
	private recordingToken = 0;
	private recordingOffset = 0;
	private recordingOrigin = 0;
	private recordingID:string | null = null;
	/** Seconds. 0 means the start of the file. */
	private recordingLoopStart = 0;
	/** Seconds. 0 means the end of the file. */
	private recordingLoopEnd = 0;
	private pendingRecording:{ bytes:ArrayBuffer; gain:number } | null = null;
	private origin = 0;
	private musicHold = 0;
	private pausedMusic = false;
	private listener:ListenerPose = { x: 0, y: 0, z: 0, yaw: 0 };
	private unlocks:Array<()=>void> = [];
	private lastMix = '';
	private scheduled = new Set<string>();
	private firedCues = new Set<string>();
	private pruneCycle = -1;
	/** True until the score has an origin on a running context. */
	private clockDirty = true;
	private loopNoise:AudioBuffer | null = null;
	private readonly loops = new Map<string, LoopVoice>();
	private readonly pendingLoops = new Map<string, { src:LoopSrc; opts:SfxOpts }>();
	private pendingSfx:{ patch:SfxPatch; opts:SfxOpts } | null = null;
	private readonly dropped = new Set<string>();
	private pump = 0;

	get ready():boolean {
		return !!this.ctx;
	}

	/** Active looping ids (`playLoop`). */
	loopIDs():string[] {
		return [...new Set([...this.loops.keys(), ...this.pendingLoops.keys()])];
	}

	get playing():Score | null {
		return this.score;
	}

	/**
	 * What the transport is driving. A recording uses 60 BPM so one beat is one
	 * second and `loop` is where playback jumps back (`end`, or the file length).
	 */
	get music():{ id:string; bpm:number; loop:number } | null {
		if (this.score) {
			return {
				id: this.score.id ?? '',
				bpm: this.score.bpm,
				loop: this.score.loop,
			};
		}
		if (!this.recordingID) {
			return null;
		}
		return {
			id: this.recordingID,
			bpm: 60,
			loop: this.recordingBounds().end,
		};
	}

	get musicPaused():boolean {
		return this.pausedMusic;
	}

	/** Beats from loop start, in `[0, loop)`. */
	musicBeat():number {
		if (this.recordingID) {
			return this.recordingSec();
		}
		const score = this.score;
		if (!score) {
			return 0;
		}
		const loop = score.loop;
		const beat = this.elapsedSec() / (60 / score.bpm);
		const wrapped = beat % loop;
		return wrapped < 0 ? wrapped + loop : wrapped;
	}

	pauseMusic():void {
		if (this.recordingID) {
			if (this.pausedMusic) {
				return;
			}
			this.recordingOffset = this.recordingSec();
			this.pausedMusic = true;
			this.releaseRecordingNode();
			this.applyMix(true);
			return;
		}
		if (!this.score || this.pausedMusic) {
			return;
		}
		this.musicHold = this.elapsedSec();
		this.pausedMusic = true;
		this.cutMusicVoices();
	}

	unpauseMusic():void {
		if (this.recordingID) {
			if (!this.pausedMusic) {
				return;
			}
			this.pausedMusic = false;
			this.startRecordingNode();
			this.applyMix(true);
			this.armPump();
			return;
		}
		if (!this.score || !this.pausedMusic) {
			return;
		}
		this.pausedMusic = false;
		this.clockDirty = true;
		if (this.ctx?.state === 'running') {
			this.armClock();
		}
		this.armPump();
	}

	seekMusic(beat:number):void {
		if (this.recordingID) {
			const { end } = this.recordingBounds();
			this.recordingOffset = end > 0 ? wrap(beat, end) : 0;
			if (!this.pausedMusic) {
				this.releaseRecordingNode();
				this.startRecordingNode();
			}
			return;
		}
		const score = this.score;
		if (!score) {
			return;
		}
		const loop = score.loop;
		const times = score.loops ?? -1;
		const span = times < 0 ? loop : times * loop;
		const b = times < 0
			? ((beat % loop) + loop) % loop
			: Math.max(0, Math.min(beat, span));
		this.musicHold = b * (60 / score.bpm);
		this.cutMusicVoices();
		this.scheduled.clear();
		this.firedCues.clear();
		this.pruneCycle = -1;
		const ctx = this.ctx;
		if (!this.pausedMusic && ctx && ctx.state === 'running') {
			this.origin = ctx.currentTime - this.musicHold;
			this.clockDirty = false;
			this.update();
			return;
		}
		this.clockDirty = true;
	}

	/** Create / resume the context. Call from a click or key. */
	async resume():Promise<void> {
		const ctx = this.ensure();
		if (!ctx) {
			return;
		}
		if (ctx.state === 'suspended') {
			try {
				await ctx.resume();
			}
			catch {
				return;
			}
		}
		this.applyMix(true);
		this.armPendingLoops();
		this.flushPendingSfx();
		this.flushPendingRecording();
		if (this.score && this.clockDirty) {
			this.armClock();
		}
		this.armPump();
		this.update();
	}

	/** One-shot click/keydown/touch listeners that call `resume`. */
	connectUnlock(target:EventTarget):()=>void {
		const go = ():void => {
			void this.resume();
		};
		const opts = { passive: true } as const;
		target.addEventListener('pointerdown', go, opts);
		target.addEventListener('keydown', go, opts);
		target.addEventListener('touchstart', go, opts);
		const off = ():void => {
			target.removeEventListener('pointerdown', go);
			target.removeEventListener('keydown', go);
			target.removeEventListener('touchstart', go);
		};
		this.unlocks.push(off);
		return off;
	}

	/**
	 * Loop a finished recording on the music output (volume, mute, duck).
	 * Dry: it does not pass through the synth room. A string is fetched;
	 * an `ArrayBuffer` is decoded. Headless queues nothing audible.
	 *
	 * Playback starts at 0. It runs until `loop.end` (default: the end of the
	 * file), then jumps to `loop.start` (default: 0) and repeats that span.
	 */
	async playRecording(
		src:string | ArrayBuffer,
		gain = 1,
		id = 'recording',
		loop?:{ start?:number; end?:number },
	):Promise<void> {
		const token = ++this.recordingToken;
		this.pendingRecording = null;
		this.releaseRecordingNode();
		this.recordingBuffer = null;
		this.recordingOffset = 0;
		this.recordingLoopStart = loop?.start ?? 0;
		this.recordingLoopEnd = loop?.end ?? 0;
		this.recordingID = id;
		this.score = null;
		this.pausedMusic = false;
		this.musicHold = 0;
		this.clockDirty = true;
		this.firedCues.clear();
		this.cutMusicVoices();
		const ctx = this.ensure();
		let bytes:ArrayBuffer;
		if (typeof src === 'string') {
			const res = await fetch(src);
			if (!res.ok) {
				throw new Error(`recording: HTTP ${res.status}`);
			}
			bytes = await res.arrayBuffer();
		}
		else {
			bytes = src.slice(0);
		}
		if (token !== this.recordingToken) {
			return;
		}
		if (!ctx) {
			this.pendingRecording = { bytes, gain };
			return;
		}
		await this.attachRecording(ctx, bytes, gain, token);
	}

	playMusic(score:Score):void {
		const bad = scoreProblems(score);
		if (bad.length) {
			throw new Error(`${score.id ?? 'score'}: ${bad.join(', ')}`);
		}
		this.stopRecording();
		const ctx = this.ensure();
		this.score = score;
		this.pausedMusic = false;
		this.musicHold = 0;
		this.scheduled.clear();
		this.firedCues.clear();
		this.pruneCycle = -1;
		this.clockDirty = true;
		this.cutMusicVoices();
		this.armPump();
		if (!ctx) {
			return;
		}
		this.applyMix(true);
		this.update();
	}

	private elapsedSec():number {
		if (this.pausedMusic || this.clockDirty) {
			return this.musicHold;
		}
		const ctx = this.ctx;
		if (!ctx) {
			return this.musicHold;
		}
		return Math.max(0, ctx.currentTime - this.origin);
	}

	private cutMusicVoices():void {
		const ctx = this.ctx;
		const old = this.musicBus;
		if (ctx && old) {
			old.gain.cancelScheduledValues(ctx.currentTime);
			old.gain.setValueAtTime(0, ctx.currentTime);
			try {
				old.disconnect();
			}
			catch {
				// already gone
			}
		}
		this.scheduled.clear();
		this.pruneCycle = -1;
		this.releaseMusicFilters();
		if (!ctx || !this.musicDry || !this.musicWetIn) {
			this.musicBus = null;
			return;
		}
		const bus = ctx.createGain();
		bus.gain.value = 1;
		bus.connect(this.musicDry);
		bus.connect(this.musicWetIn);
		this.musicBus = bus;
		this.noteDest = bus;
		const score = this.score;
		if (score) {
			const opened = openScoreFilters(ctx, score, bus);
			if (opened) {
				this.noteDest = opened.input;
				this.voiceDest = opened.voiceDest;
				this.filterNodes = opened.nodes;
			}
		}
	}

	private releaseMusicFilters():void {
		for (const node of this.filterNodes) {
			try {
				node.disconnect();
			}
			catch {
				// already gone
			}
		}
		this.filterNodes = [];
		this.noteDest = null;
		this.voiceDest = null;
	}

	private insertPatchFilters(ctx:AudioContext, dest:AudioNode, patch:SfxPatch, when:number):AudioNode {
		if (!patch.filters || patch.filters.length === 0) {
			return dest;
		}
		const chain = createFilterChain(ctx, patch.filters);
		chain.output.connect(dest);
		let hold = 0.2;
		for (const layer of patch.layers) {
			hold = Math.max(hold, (layer.when ?? 0) + layer.dur);
		}
		const due = when + hold + 1.6;
		const fire = ():void => {
			if (ctx.state === 'closed') {
				return;
			}
			const wait = due - ctx.currentTime;
			if (wait > 0.05) {
				setTimeout(fire, wait * 1000);
				return;
			}
			chain.disconnect();
		};
		setTimeout(fire, Math.max(0, due - ctx.currentTime) * 1000);
		return chain.input;
	}

	private armClock():void {
		const ctx = this.ctx;
		if (!ctx || ctx.state !== 'running' || !this.score || this.pausedMusic) {
			return;
		}
		this.origin = ctx.currentTime + START_LEAD - this.musicHold;
		this.scheduled.clear();
		this.pruneCycle = -1;
		this.clockDirty = false;
	}

	private stopRecording():void {
		this.recordingToken += 1;
		this.pendingRecording = null;
		this.recordingBuffer = null;
		this.recordingOffset = 0;
		this.recordingLoopStart = 0;
		this.recordingLoopEnd = 0;
		this.recordingID = null;
		this.releaseRecordingNode();
	}

	/** Playable span. `end` is 0 until a buffer is decoded. */
	private recordingBounds():{ start:number; end:number } {
		const dur = this.recordingBuffer?.duration ?? 0;
		if (!(dur > 0)) {
			return { start: 0, end: 0 };
		}
		let end = this.recordingLoopEnd > 0 ? Math.min(this.recordingLoopEnd, dur) : dur;
		let start = this.recordingLoopStart;
		if (!(start >= 0) || !(end > start)) {
			start = 0;
			end = dur;
		}
		return { start, end };
	}

	/** Seconds into the file. One beat on the transport. */
	private recordingSec():number {
		const { start, end } = this.recordingBounds();
		let sec = this.recordingOffset;
		if (!this.pausedMusic && this.recording && this.ctx) {
			sec += this.ctx.currentTime - this.recordingOrigin;
		}
		return placeRecording(sec, start, end);
	}

	private startRecordingNode():void {
		const ctx = this.ctx;
		const buffer = this.recordingBuffer;
		const dest = this.musicGain;
		if (!ctx || !buffer || !dest || this.pausedMusic) {
			return;
		}
		const { start, end } = this.recordingBounds();
		let offset = end > 0 ? wrap(this.recordingOffset, end) : 0;
		if (offset >= end - 0.001) {
			offset = start;
		}
		const node = ctx.createBufferSource();
		node.buffer = buffer;
		node.loop = true;
		if (start > 0 || end < buffer.duration - 0.0005) {
			node.loopStart = start;
			node.loopEnd = end;
		}
		node.connect(dest);
		const when = ctx.currentTime;
		node.start(when, offset);
		this.recording = node;
		this.recordingOrigin = when;
		this.recordingOffset = offset;
	}

	private releaseRecordingNode():void {
		const node = this.recording;
		this.recording = null;
		if (!node) {
			return;
		}
		try {
			node.stop();
			node.disconnect();
		}
		catch {
			// already stopped
		}
	}

	private async attachRecording(
		ctx:AudioContext,
		bytes:ArrayBuffer,
		gain:number,
		token:number,
	):Promise<void> {
		const buffer = await ctx.decodeAudioData(bytes.slice(0));
		if (token !== this.recordingToken || this.ctx !== ctx || !this.musicGain) {
			return;
		}
		this.releaseRecordingNode();
		this.recordingBuffer = buffer;
		this.recordingGain = gain;
		this.recordingOffset = 0;
		if (!this.pausedMusic) {
			this.startRecordingNode();
		}
		this.applyMix(true);
		this.armPump();
	}

	private flushPendingRecording():void {
		const pending = this.pendingRecording;
		const ctx = this.ctx;
		if (!pending || !ctx) {
			return;
		}
		this.pendingRecording = null;
		void this.attachRecording(ctx, pending.bytes, pending.gain, this.recordingToken);
	}

	stopMusic():void {
		this.stopRecording();
		this.score = null;
		this.pausedMusic = false;
		this.musicHold = 0;
		this.clockDirty = true;
		this.firedCues.clear();
		this.cutMusicVoices();
		const ctx = this.ctx;
		const g = this.musicGain;
		if (ctx && g) {
			g.gain.cancelScheduledValues(ctx.currentTime);
			g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.12);
		}
	}

	playSfx(patch:SfxPatch, opts:SfxOpts = {}):void {
		const bad = filterProblems(patch.filters, 'sfx filter');
		if (bad.length) {
			throw new Error(`sfx: ${bad.join(', ')}`);
		}
		const ctx = this.ensure();
		const bus = this.sfxGain;
		const noise = this.noise;
		if (!ctx || !bus || !noise || ctx.state !== 'running') {
			if (!this.pendingSfx) {
				this.pendingSfx = { patch, opts: { ...opts } };
				return;
			}
			this.drop('sfx before resume');
			return;
		}
		this.emitSfx(ctx, bus, noise, patch, opts);
	}

	private flushPendingSfx():void {
		const pending = this.pendingSfx;
		if (!pending) {
			return;
		}
		this.pendingSfx = null;
		this.playSfx(pending.patch, pending.opts);
	}

	private emitSfx(
		ctx:AudioContext,
		bus:GainNode,
		noise:AudioBuffer,
		patch:SfxPatch,
		opts:SfxOpts,
	):void {
		const when = ctx.currentTime + 0.01;
		const placed = this.spatialize(ctx, bus, opts, when);
		if (!placed) {
			return;
		}
		const dest = this.insertPatchFilters(ctx, placed, patch, when);
		const g = (patch.gain ?? 1) * (opts.gain ?? 1);
		for (const layer of patch.layers) {
			playLayer(ctx, dest, noise, layer, when, { ...opts, gain: g });
		}
	}

	/**
	 * Start or move a posed loop. Patch (river) or Score (radio). Safe every frame with a new pose.
	 * Same object keeps the graph / clock; a different object restarts.
	 */
	playLoop(id:string, src:LoopSrc, opts:SfxOpts = {}):void {
		if (isScore(src)) {
			const bad = scoreProblems(src);
			if (bad.length) {
				throw new Error(`${id}: ${bad.join(', ')}`);
			}
		}
		else {
			const bad = filterProblems(src.filters, 'sfx filter');
			if (bad.length) {
				throw new Error(`${id}: ${bad.join(', ')}`);
			}
		}
		this.pendingLoops.set(id, { src, opts: { ...opts } });
		this.armLoop(id);
		this.armPump();
	}

	stopLoop(id:string):void {
		this.pendingLoops.delete(id);
		const loop = this.loops.get(id);
		if (!loop) {
			return;
		}
		this.loops.delete(id);
		loop.release();
		const ctx = this.ctx;
		const when = ctx ? ctx.currentTime + 0.04 : 0;
		if (ctx) {
			loop.dist.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.05);
		}
		loop.voice?.stop(when);
		if (!loop.voice) {
			try {
				loop.local?.disconnect();
				loop.panner.disconnect();
				loop.dist.disconnect();
			}
			catch {
				// already gone
			}
		}
	}

	setListener(x:number, y:number, z:number, yaw = 0):void {
		this.listener = { x, y, z, yaw };
	}

	/** Schedule upcoming notes and spatialize loops. The mixer calls this itself in the browser; call it from tests / headless. */
	update():void {
		this.applyMix(false);
		this.syncLoops();
		this.fireCues();
		this.fireLoopCues();
		this.scheduleMusic();
		this.scheduleLoopScores();
	}

	private scheduleMusic():void {
		const ctx = this.ctx;
		const bus = this.musicBus;
		const score = this.score;
		if (!ctx || !bus || !this.noise || !score || ctx.state !== 'running' || this.pausedMusic) {
			return;
		}
		if (this.clockDirty) {
			this.armClock();
		}
		if (this.clockDirty || this.pausedMusic) {
			return;
		}
		const dest = this.noteDest ?? bus;
		this.pruneCycle = this.pumpScoreNotes(
			score,
			this.origin,
			this.scheduled,
			this.pruneCycle,
			dest,
			'late music note',
			this.voiceDest,
		);
	}

	private scheduleLoopScores():void {
		const ctx = this.ctx;
		if (!ctx || !this.noise || ctx.state !== 'running') {
			return;
		}
		const l = this.listener;
		for (const loop of this.loops.values()) {
			if (!isScore(loop.src) || !loop.local) {
				continue;
			}
			if (loop.clockDirty) {
				loop.origin = ctx.currentTime + START_LEAD;
				loop.scheduled.clear();
				loop.pruneCycle = -1;
				loop.clockDirty = false;
			}
			const dist = Math.hypot(loop.x - l.x, loop.y - l.y, loop.z - l.z);
			const dest = dist > loop.hear ? null : loop.local;
			loop.pruneCycle = this.pumpScoreNotes(
				loop.src,
				loop.origin,
				loop.scheduled,
				loop.pruneCycle,
				dest,
				'late posed note',
				loop.voiceDest,
			);
		}
	}

	private pumpScoreNotes(
		score:Score,
		origin:number,
		scheduled:Set<string>,
		pruneCycle:number,
		dest:AudioNode | null,
		lateReason:string,
		voiceDest:AudioNode[] | null = null,
	):number {
		const ctx = this.ctx;
		const noise = this.noise;
		if (!ctx || !noise) {
			return pruneCycle;
		}
		const spb = 60 / score.bpm;
		const now = ctx.currentTime;
		const from = Math.max(0, now - origin);
		const until = from + LOOKAHEAD;
		const startBeat = from / spb;
		const endBeat = until / spb;
		const times = score.loops ?? -1;
		const first = Math.max(0, Math.floor(startBeat / score.loop) - 1);
		const last = Math.floor(endBeat / score.loop) + 1;
		if (first !== pruneCycle) {
			pruneCycle = first;
			for (const key of scheduled) {
				const cycle = Number(key.split(':')[0]);
				if (cycle < first) {
					scheduled.delete(key);
				}
			}
		}
		if (!dest) {
			return pruneCycle;
		}
		for (let cycle = first; cycle <= last; cycle++) {
			if (times >= 0 && cycle >= times) {
				continue;
			}
			for (let vi = 0; vi < score.voices.length; vi++) {
				const voice = score.voices[vi];
				if (!voice) {
					continue;
				}
				for (let ni = 0; ni < voice.notes.length; ni++) {
					const note = voice.notes[ni];
					if (!note) {
						continue;
					}
					const id = `${cycle}:${vi}:${ni}`;
					if (scheduled.has(id)) {
						continue;
					}
					const beat = cycle * score.loop + note.beat;
					const t = origin + beat * spb;
					if (t > now + LOOKAHEAD || t < origin - 0.001) {
						continue;
					}
					if (!noteIsDue(t, now)) {
						if (t < now) {
							scheduled.add(id);
							this.drop(lateReason);
						}
						continue;
					}
					scheduled.add(id);
					playVoiceNote(
						ctx,
						voiceDest?.[vi] ?? dest,
						noise,
						voice,
						t,
						note.pitch,
						note.dur * spb,
						note.vel ?? 0.7,
						note.velTo,
						note.velRampAt !== undefined ? note.velRampAt * spb : undefined,
					);
				}
			}
		}
		return pruneCycle;
	}

	private fireCues():void {
		const score = this.score;
		if (!score || this.pausedMusic) {
			return;
		}
		const cues = score.cues;
		const times = score.loops ?? -1;
		const spb = 60 / score.bpm;
		const elapsedBeats = this.elapsedSec() / spb;
		const toCycle = Math.floor(elapsedBeats / score.loop + 1e-9);
		if (cues?.length) {
			for (let cycle = 0; cycle <= toCycle; cycle++) {
				if (times >= 0 && cycle >= times) {
					break;
				}
				for (let i = 0; i < cues.length; i++) {
					const c = cues[i];
					if (!c) {
						continue;
					}
					const abs = cycle * score.loop + c.beat;
					if (abs > elapsedBeats + 1e-9) {
						continue;
					}
					const id = `${cycle}:${i}`;
					if (this.firedCues.has(id)) {
						continue;
					}
					this.firedCues.add(id);
					const still = this.score;
					c.fn();
					if (this.score !== still) {
						return;
					}
				}
			}
		}
		if (times >= 0 && elapsedBeats + 1e-9 >= times * score.loop && this.score === score) {
			this.stopMusic();
		}
	}

	private fireLoopCues():void {
		for (const [id, loop] of [...this.loops]) {
			if (!isScore(loop.src)) {
				continue;
			}
			const score = loop.src;
			const cues = score.cues;
			const times = score.loops ?? -1;
			const spb = 60 / score.bpm;
			const elapsed = loop.clockDirty || !this.ctx
				? 0
				: Math.max(0, this.ctx.currentTime - loop.origin);
			const elapsedBeats = elapsed / spb;
			const toCycle = Math.floor(elapsedBeats / score.loop + 1e-9);
			let alive = true;
			if (cues?.length) {
				for (let cycle = 0; cycle <= toCycle && alive; cycle++) {
					if (times >= 0 && cycle >= times) {
						break;
					}
					for (let i = 0; i < cues.length; i++) {
						const c = cues[i];
						if (!c) {
							continue;
						}
						const abs = cycle * score.loop + c.beat;
						if (abs > elapsedBeats + 1e-9) {
							continue;
						}
						const cueID = `${cycle}:${i}`;
						if (loop.firedCues.has(cueID)) {
							continue;
						}
						loop.firedCues.add(cueID);
						c.fn();
						if (this.loops.get(id) !== loop || loop.src !== score) {
							alive = false;
							break;
						}
					}
				}
			}
			if (
				alive
				&& times >= 0
				&& elapsedBeats + 1e-9 >= times * score.loop
				&& loop.src === score
				&& this.loops.get(id) === loop
			) {
				this.stopLoop(id);
			}
		}
	}

	dispose():void {
		this.stopRecording();
		this.releaseMusicFilters();
		this.score = null;
		if (this.pump) {
			cancelAnimationFrame(this.pump);
			this.pump = 0;
		}
		for (const id of [...this.loopIDs()]) {
			this.stopLoop(id);
		}
		this.pendingLoops.clear();
		this.pendingSfx = null;
		this.loops.clear();
		for (const off of this.unlocks) {
			off();
		}
		this.unlocks = [];
		const ctx = this.ctx;
		this.ctx = null;
		this.master = null;
		this.musicGain = null;
		this.sfxGain = null;
		this.musicBus = null;
		this.musicDry = null;
		this.musicWetIn = null;
		this.noise = null;
		this.loopNoise = null;
		if (ctx && ctx.state !== 'closed') {
			void ctx.close();
		}
	}

	private ensure():AudioContext | null {
		if (this.ctx) {
			return this.ctx;
		}
		const Ctor = audioCtor();
		if (!Ctor) {
			return null;
		}
		let ctx:AudioContext;
		try {
			ctx = new Ctor({ latencyHint: 'interactive' });
		}
		catch {
			ctx = new Ctor();
		}
		this.ctx = ctx;
		forceStereo(ctx);
		this.noise = makeNoise(ctx);
		this.loopNoise = makeNoise(ctx, 4.2);
		const master = ctx.createGain();
		const musicGain = ctx.createGain();
		const sfxGain = ctx.createGain();
		const musicBus = ctx.createGain();
		musicBus.gain.value = 1;
		const dry = ctx.createGain();
		dry.gain.value = 0.78;
		const wet = this.reverb(ctx);
		musicBus.connect(dry);
		musicBus.connect(wet.in);
		dry.connect(musicGain);
		wet.out.connect(musicGain);
		this.musicDry = dry;
		this.musicWetIn = wet.in;
		musicGain.connect(master);
		sfxGain.connect(master);
		master.connect(ctx.destination);
		this.master = master;
		this.musicGain = musicGain;
		this.sfxGain = sfxGain;
		this.musicBus = musicBus;
		this.applyMix(true);
		this.armPendingLoops();
		return ctx;
	}

	private reverb(ctx:AudioContext):{ in:AudioNode; out:AudioNode } {
		const send = createReverbSend(ctx);
		return { in: send.in, out: send.out };
	}

	private applyMix(force:boolean):void {
		const key = `${this.muted ? 1 : 0}:${this.musicVolume}:${this.sfxVolume}:${this.duck}:${this.score ? 1 : 0}:${this.recording ? 1 : 0}:${this.recordingGain}`;
		if (!force && key === this.lastMix) {
			return;
		}
		this.lastMix = key;
		const ctx = this.ctx;
		if (!ctx || !this.master || !this.musicGain || !this.sfxGain) {
			return;
		}
		const now = ctx.currentTime;
		this.master.gain.setTargetAtTime(this.muted ? 0.0001 : 1, now, 0.04);
		const musicOn = !!this.score || !!this.recording;
		const gain = this.score?.gain ?? (this.recording ? this.recordingGain : 1);
		const music = musicOn ? this.musicVolume * this.duck * gain : 0.0001;
		this.musicGain.gain.setTargetAtTime(Math.max(0.0001, music), now, 0.08);
		this.sfxGain.gain.setTargetAtTime(Math.max(0.0001, this.sfxVolume), now, 0.04);
	}

	private drop(reason:string):void {
		if (!this.warnDropped || this.dropped.has(reason)) {
			return;
		}
		this.dropped.add(reason);
		console.warn(`[kindling audio] dropped: ${reason}`);
	}

	private armPump():void {
		if (this.pump || typeof requestAnimationFrame !== 'function') {
			return;
		}
		const tick = ():void => {
			this.pump = 0;
			if (!this.ctx) {
				return;
			}
			const busy = !!this.score || !!this.recordingID || this.loops.size > 0 || this.pendingLoops.size > 0;
			if (!busy) {
				return;
			}
			this.update();
			this.pump = requestAnimationFrame(tick);
		};
		this.pump = requestAnimationFrame(tick);
	}

	private armPendingLoops():void {
		for (const id of this.pendingLoops.keys()) {
			this.armLoop(id);
		}
	}

	private armLoop(id:string):void {
		const spec = this.pendingLoops.get(id);
		if (!spec) {
			return;
		}
		const live = this.loops.get(id);
		if (live && live.src === spec.src) {
			this.poseLoop(live, spec.opts);
			return;
		}
		if (live) {
			live.release();
			const now = this.ctx?.currentTime ?? 0;
			live.voice?.stop(now);
			try {
				live.local?.disconnect();
				live.panner.disconnect();
				live.dist.disconnect();
			}
			catch {
				// gone
			}
			this.loops.delete(id);
		}
		const ctx = this.ctx;
		const bus = this.sfxGain;
		if (!ctx || !bus) {
			return;
		}
		if (!isScore(spec.src) && !(this.loopNoise ?? this.noise)) {
			return;
		}
		const panner = makePanner(ctx, spec.opts.hear ?? HEAR);
		const dist = ctx.createGain();
		dist.gain.value = 0.0001;
		panner.connect(dist);
		dist.connect(bus);
		let voice:LoopNodes | null = null;
		let local:AudioNode | null = null;
		let voiceDest:AudioNode[] | null = null;
		let release = ():void => {};
		if (isScore(spec.src)) {
			const gain = ctx.createGain();
			gain.gain.value = 1;
			local = gain;
			const opened = openScoreFilters(ctx, spec.src, panner);
			if (opened) {
				local = opened.input;
				voiceDest = opened.voiceDest;
				const nodes = opened.nodes;
				release = ():void => {
					for (const node of nodes) {
						try {
							node.disconnect();
						}
						catch {
							// already gone
						}
					}
				};
			}
			else {
				local.connect(panner);
			}
		}
		else {
			const noise = this.loopNoise ?? this.noise;
			if (!noise) {
				return;
			}
			let layerDest:AudioNode = panner;
			if (spec.src.filters && spec.src.filters.length > 0) {
				const chain = createFilterChain(ctx, spec.src.filters);
				chain.output.connect(panner);
				layerDest = chain.input;
				release = chain.disconnect;
			}
			voice = startLoopLayers(ctx, layerDest, noise, spec.src.layers, spec.src.gain ?? 1);
		}
		const loop:LoopVoice = {
			x: spec.opts.x ?? 0,
			y: spec.opts.y ?? 0,
			z: spec.opts.z ?? 0,
			hear: spec.opts.hear ?? HEAR,
			falloff: spec.opts.falloff ?? 0.16,
			userGain: spec.opts.gain ?? 1,
			src: spec.src,
			panner,
			dist,
			voice,
			local,
			voiceDest,
			release,
			origin: 0,
			clockDirty: true,
			scheduled: new Set(),
			firedCues: new Set(),
			pruneCycle: -1,
		};
		this.loops.set(id, loop);
		this.poseLoop(loop, spec.opts);
	}

	private poseLoop(
		loop:{ x:number; y:number; z:number; hear:number; falloff:number; userGain:number },
		opts:SfxOpts,
	):void {
		if (opts.x !== undefined) {
			loop.x = opts.x;
		}
		if (opts.y !== undefined) {
			loop.y = opts.y;
		}
		if (opts.z !== undefined) {
			loop.z = opts.z;
		}
		if (opts.hear !== undefined) {
			loop.hear = opts.hear;
		}
		if (opts.falloff !== undefined) {
			loop.falloff = opts.falloff;
		}
		if (opts.gain !== undefined) {
			loop.userGain = opts.gain;
		}
	}

	private syncLoops():void {
		const ctx = this.ctx;
		if (!ctx || ctx.state !== 'running') {
			return;
		}
		this.armPendingLoops();
		const now = ctx.currentTime;
		poseListener(ctx, this.listener, now);
		for (const loop of this.loops.values()) {
			const dx = loop.x - this.listener.x;
			const dy = loop.y - this.listener.y;
			const dz = loop.z - this.listener.z;
			const dist = Math.hypot(dx, dy, dz);
			const extra = isScore(loop.src) ? (loop.src.gain ?? 1) : 1;
			const gain = dist > loop.hear ? 0.0001 : loop.userGain * extra * distanceGain(dist, loop.falloff);
			placePanner(loop.panner, loop.x, loop.y, loop.z, now, true);
			loop.panner.maxDistance = Math.max(2, loop.hear);
			loop.dist.gain.setTargetAtTime(Math.max(0.0001, gain), now, 0.08);
		}
	}

	private spatialize(
		ctx:AudioContext,
		bus:AudioNode,
		opts:SfxOpts,
		when:number,
	):AudioNode | null {
		if (opts.x === undefined || opts.z === undefined) {
			return bus;
		}
		const l = this.listener;
		const hear = opts.hear ?? HEAR;
		const dx = opts.x - l.x;
		const dy = (opts.y ?? 0) - l.y;
		const dz = opts.z - l.z;
		const dist = Math.hypot(dx, dy, dz);
		if (dist > hear) {
			return null;
		}
		poseListener(ctx, this.listener, when);
		const panner = makePanner(ctx, hear);
		placePanner(panner, opts.x, opts.y ?? 0, opts.z, when, false);
		const g = ctx.createGain();
		g.gain.value = distanceGain(dist, opts.falloff ?? 0.16);
		panner.connect(g);
		g.connect(bus);
		const hold = 2.8;
		setTimeout(() => {
			try {
				panner.disconnect();
				g.disconnect();
			}
			catch {
				// gone
			}
		}, hold * 1000);
		return panner;
	}
}
