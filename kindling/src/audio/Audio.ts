import { createFilterChain, createReverbSend, filterProblems, openScoreFilters } from './filters.js';
import { scoreProblems } from './midi.js';
import { distanceGain, forceStereo, heardAt, makePanner, placePanner, poseListener } from './spatial.js';
import { playVoiceNote } from './instruments.js';
import { disconnectSoon, makeNoise, patchSeconds, pitched, playLayer, startLoopLayers, varied, type LoopNodes } from './synth.js';
import type { ListenerPose, Score, SfxHandle, SfxOpts, SfxPatch } from './types.js';

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
	public musicVolume = 0.52;
	public sfxVolume = 0.78;
	public muted = false;
	/** 0–1 extra music attenuator (pause menu). */
	public duck = 1;
	/** `console.warn` once per drop reason (`sfx before resume`, `late music note`). */
	public warnDropped = true;

	private _ctx:AudioContext | null = null;
	private _master:GainNode | null = null;
	private _musicGain:GainNode | null = null;
	private _sfxGain:GainNode | null = null;
	private _musicBus:GainNode | null = null;
	/** Where score notes connect. Filter input when the score lists filters, else the bus. */
	private _noteDest:AudioNode | null = null;
	private _voiceDest:AudioNode[] | null = null;
	private _filterNodes:AudioNode[] = [];
	private _musicDry:GainNode | null = null;
	private _musicWetIn:AudioNode | null = null;
	private _noise:AudioBuffer | null = null;
	private _playing:Score | null = null;
	/** Finished file on the music output. Loops. Not sent through the synth room. */
	private _recording:AudioBufferSourceNode | null = null;
	private _recordingBuffer:AudioBuffer | null = null;
	private _recordingGain = 1;
	private _recordingToken = 0;
	private _recordingOffset = 0;
	private _recordingOrigin = 0;
	private _recordingID:string | null = null;
	/** Seconds. 0 means the start of the file. */
	private _recordingLoopStart = 0;
	/** Seconds. 0 means the end of the file. */
	private _recordingLoopEnd = 0;
	private _pendingRecording:{ bytes:ArrayBuffer; gain:number } | null = null;
	private _origin = 0;
	private _musicHold = 0;
	private _musicPaused = false;
	private _listener:ListenerPose = { x: 0, y: 0, z: 0, yaw: 0 };
	/** Where distance falloff is measured from; the listener unless `setListener` says otherwise. */
	private _falloffFrom = { x: 0, y: 0, z: 0 };
	private _unlocks:Array<()=>void> = [];
	private _lastMix = '';
	private _scheduled = new Set<string>();
	private _firedCues = new Set<string>();
	private _pruneCycle = -1;
	/** True until the score has an origin on a running context. */
	private _clockDirty = true;
	private _loopNoise:AudioBuffer | null = null;
	private _pendingSfx:{ patch:SfxPatch; opts:SfxOpts } | null = null;
	private _pump = 0;

	private readonly _loops = new Map<string, LoopVoice>();
	private readonly _pendingLoops = new Map<string, { src:LoopSrc; opts:SfxOpts }>();
	private readonly _dropped = new Set<string>();

	public get ready():boolean {
		return !!this._ctx;
	}

	/** Active looping ids (`playLoop`). */
	public loopIDs():string[] {
		return [...new Set([...this._loops.keys(), ...this._pendingLoops.keys()])];
	}

	public get playing():Score | null {
		return this._playing;
	}

	/**
	 * What the transport is driving. A recording uses 60 BPM so one beat is one
	 * second and `loop` is where playback jumps back (`end`, or the file length).
	 */
	public get music():{ id:string; bpm:number; loop:number } | null {
		if (this._playing) {
			return {
				id: this._playing.id ?? '',
				bpm: this._playing.bpm,
				loop: this._playing.loop,
			};
		}
		if (!this._recordingID) {
			return null;
		}
		return {
			id: this._recordingID,
			bpm: 60,
			loop: this.recordingBounds().end,
		};
	}

	public get musicPaused():boolean {
		return this._musicPaused;
	}

	/** Beats from loop start, in `[0, loop)`. */
	public musicBeat():number {
		if (this._recordingID) {
			return this.recordingSec();
		}
		const score = this._playing;
		if (!score) {
			return 0;
		}
		const loop = score.loop;
		const beat = this.elapsedSec() / (60 / score.bpm);
		const wrapped = beat % loop;
		return wrapped < 0 ? wrapped + loop : wrapped;
	}

	public pauseMusic():void {
		if (this._recordingID) {
			if (this._musicPaused) {
				return;
			}
			this._recordingOffset = this.recordingSec();
			this._musicPaused = true;
			this.releaseRecordingNode();
			this.applyMix(true);
			return;
		}
		if (!this._playing || this._musicPaused) {
			return;
		}
		this._musicHold = this.elapsedSec();
		this._musicPaused = true;
		this.cutMusicVoices();
	}

	public unpauseMusic():void {
		if (this._recordingID) {
			if (!this._musicPaused) {
				return;
			}
			this._musicPaused = false;
			this.startRecordingNode();
			this.applyMix(true);
			this.armPump();
			return;
		}
		if (!this._playing || !this._musicPaused) {
			return;
		}
		this._musicPaused = false;
		this._clockDirty = true;
		if (this._ctx?.state === 'running') {
			this.armClock();
		}
		this.armPump();
	}

	public seekMusic(beat:number):void {
		if (this._recordingID) {
			const { end } = this.recordingBounds();
			this._recordingOffset = end > 0 ? wrap(beat, end) : 0;
			if (!this._musicPaused) {
				this.releaseRecordingNode();
				this.startRecordingNode();
			}
			return;
		}
		const score = this._playing;
		if (!score) {
			return;
		}
		const loop = score.loop;
		const times = score.loops ?? -1;
		const span = times < 0 ? loop : times * loop;
		const b = times < 0
			? ((beat % loop) + loop) % loop
			: Math.max(0, Math.min(beat, span));
		this._musicHold = b * (60 / score.bpm);
		this.cutMusicVoices();
		this._scheduled.clear();
		this._firedCues.clear();
		this._pruneCycle = -1;
		const ctx = this._ctx;
		if (!this._musicPaused && ctx && ctx.state === 'running') {
			this._origin = ctx.currentTime - this._musicHold;
			this._clockDirty = false;
			this.update();
			return;
		}
		this._clockDirty = true;
	}

	/** Create / resume the context. Call from a click or key. */
	public async resume():Promise<void> {
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
		if (this._playing && this._clockDirty) {
			this.armClock();
		}
		this.armPump();
		this.update();
	}

	/** One-shot click/keydown/touch listeners that call `resume`. */
	public connectUnlock(target:EventTarget):()=>void {
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
		this._unlocks.push(off);
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
	public async playRecording(
		src:string | ArrayBuffer,
		gain = 1,
		id = 'recording',
		loop?:{ start?:number; end?:number },
	):Promise<void> {
		const token = ++this._recordingToken;
		this._pendingRecording = null;
		this.releaseRecordingNode();
		this._recordingBuffer = null;
		this._recordingOffset = 0;
		this._recordingLoopStart = loop?.start ?? 0;
		this._recordingLoopEnd = loop?.end ?? 0;
		this._recordingID = id;
		this._playing = null;
		this._musicPaused = false;
		this._musicHold = 0;
		this._clockDirty = true;
		this._firedCues.clear();
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
		if (token !== this._recordingToken) {
			return;
		}
		if (!ctx) {
			this._pendingRecording = { bytes, gain };
			return;
		}
		await this.attachRecording(ctx, bytes, gain, token);
	}

	public playMusic(score:Score):void {
		const bad = scoreProblems(score);
		if (bad.length) {
			throw new Error(`${score.id ?? 'score'}: ${bad.join(', ')}`);
		}
		this.stopRecording();
		const ctx = this.ensure();
		this._playing = score;
		this._musicPaused = false;
		this._musicHold = 0;
		this._scheduled.clear();
		this._firedCues.clear();
		this._pruneCycle = -1;
		this._clockDirty = true;
		this.cutMusicVoices();
		this.armPump();
		if (!ctx) {
			return;
		}
		this.applyMix(true);
		this.update();
	}

	private elapsedSec():number {
		if (this._musicPaused || this._clockDirty) {
			return this._musicHold;
		}
		const ctx = this._ctx;
		if (!ctx) {
			return this._musicHold;
		}
		return Math.max(0, ctx.currentTime - this._origin);
	}

	private cutMusicVoices():void {
		const ctx = this._ctx;
		const old = this._musicBus;
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
		this._scheduled.clear();
		this._pruneCycle = -1;
		this.releaseMusicFilters();
		if (!ctx || !this._musicDry || !this._musicWetIn) {
			this._musicBus = null;
			return;
		}
		const bus = ctx.createGain();
		bus.gain.value = 1;
		bus.connect(this._musicDry);
		bus.connect(this._musicWetIn);
		this._musicBus = bus;
		this._noteDest = bus;
		const score = this._playing;
		if (score) {
			const opened = openScoreFilters(ctx, score, bus);
			if (opened) {
				this._noteDest = opened.input;
				this._voiceDest = opened.voiceDest;
				this._filterNodes = opened.nodes;
			}
		}
	}

	private releaseMusicFilters():void {
		for (const node of this._filterNodes) {
			try {
				node.disconnect();
			}
			catch {
				// already gone
			}
		}
		this._filterNodes = [];
		this._noteDest = null;
		this._voiceDest = null;
	}

	private insertPatchFilters(ctx:AudioContext, dest:AudioNode, patch:SfxPatch, when:number, seconds:number):AudioNode {
		if (!patch.filters || patch.filters.length === 0) {
			return dest;
		}
		const chain = createFilterChain(ctx, patch.filters);
		chain.output.connect(dest);
		const due = when + Math.max(0.2, seconds) + 1.6;
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
		const ctx = this._ctx;
		if (!ctx || ctx.state !== 'running' || !this._playing || this._musicPaused) {
			return;
		}
		this._origin = ctx.currentTime + START_LEAD - this._musicHold;
		this._scheduled.clear();
		this._pruneCycle = -1;
		this._clockDirty = false;
	}

	private stopRecording():void {
		this._recordingToken += 1;
		this._pendingRecording = null;
		this._recordingBuffer = null;
		this._recordingOffset = 0;
		this._recordingLoopStart = 0;
		this._recordingLoopEnd = 0;
		this._recordingID = null;
		this.releaseRecordingNode();
	}

	/** Playable span. `end` is 0 until a buffer is decoded. */
	private recordingBounds():{ start:number; end:number } {
		const dur = this._recordingBuffer?.duration ?? 0;
		if (!(dur > 0)) {
			return { start: 0, end: 0 };
		}
		let end = this._recordingLoopEnd > 0 ? Math.min(this._recordingLoopEnd, dur) : dur;
		let start = this._recordingLoopStart;
		if (!(start >= 0) || !(end > start)) {
			start = 0;
			end = dur;
		}
		return { start, end };
	}

	/** Seconds into the file. One beat on the transport. */
	private recordingSec():number {
		const { start, end } = this.recordingBounds();
		let sec = this._recordingOffset;
		if (!this._musicPaused && this._recording && this._ctx) {
			sec += this._ctx.currentTime - this._recordingOrigin;
		}
		return placeRecording(sec, start, end);
	}

	private startRecordingNode():void {
		const ctx = this._ctx;
		const buffer = this._recordingBuffer;
		const dest = this._musicGain;
		if (!ctx || !buffer || !dest || this._musicPaused) {
			return;
		}
		const { start, end } = this.recordingBounds();
		let offset = end > 0 ? wrap(this._recordingOffset, end) : 0;
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
		this._recording = node;
		this._recordingOrigin = when;
		this._recordingOffset = offset;
	}

	private releaseRecordingNode():void {
		const node = this._recording;
		this._recording = null;
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
		if (token !== this._recordingToken || this._ctx !== ctx || !this._musicGain) {
			return;
		}
		this.releaseRecordingNode();
		this._recordingBuffer = buffer;
		this._recordingGain = gain;
		this._recordingOffset = 0;
		if (!this._musicPaused) {
			this.startRecordingNode();
		}
		this.applyMix(true);
		this.armPump();
	}

	private flushPendingRecording():void {
		const pending = this._pendingRecording;
		const ctx = this._ctx;
		if (!pending || !ctx) {
			return;
		}
		this._pendingRecording = null;
		void this.attachRecording(ctx, pending.bytes, pending.gain, this._recordingToken);
	}

	public stopMusic():void {
		this.stopRecording();
		this._playing = null;
		this._musicPaused = false;
		this._musicHold = 0;
		this._clockDirty = true;
		this._firedCues.clear();
		this.cutMusicVoices();
		const ctx = this._ctx;
		const g = this._musicGain;
		if (ctx && g) {
			g.gain.cancelScheduledValues(ctx.currentTime);
			g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.12);
		}
	}

	/** Plays `patch` once; returns a handle to stop it early, or null when it is not playing (out of earshot, or queued before the context runs). */
	public playSfx(patch:SfxPatch, opts:SfxOpts = {}):SfxHandle | null {
		const bad = filterProblems(patch.filters, 'sfx filter');
		if (bad.length) {
			throw new Error(`sfx: ${bad.join(', ')}`);
		}
		const ctx = this.ensure();
		const bus = this._sfxGain;
		const noise = this._noise;
		if (!ctx || !bus || !noise || ctx.state !== 'running') {
			if (!this._pendingSfx) {
				this._pendingSfx = { patch, opts: { ...opts } };
				return null;
			}
			this.drop('sfx before resume');
			return null;
		}
		return this.emitSfx(ctx, bus, noise, patch, opts);
	}

	private flushPendingSfx():void {
		const pending = this._pendingSfx;
		if (!pending) {
			return;
		}
		this._pendingSfx = null;
		this.playSfx(pending.patch, pending.opts);
	}

	private emitSfx(
		ctx:AudioContext,
		bus:GainNode,
		noise:AudioBuffer,
		sound:SfxPatch,
		opts:SfxOpts,
	):SfxHandle | null {
		const patch = pitched(varied(sound), opts.pitch ?? 1, opts.tract ?? 1);
		const when = ctx.currentTime + 0.01;
		const seconds = patchSeconds(patch, opts.dur);
		const placed = this.spatialize(ctx, bus, opts, when, seconds);
		if (!placed) {
			return null;
		}
		// One gain over the whole sound, for stopping it early.
		const fade = ctx.createGain();
		fade.connect(placed);
		disconnectSoon([fade], when, ctx, seconds + 1);
		const dest = this.insertPatchFilters(ctx, fade, patch, when, seconds);
		const g = (patch.gain ?? 1) * (opts.gain ?? 1);
		for (const layer of patch.layers) {
			playLayer(ctx, dest, noise, layer, when, { ...opts, gain: g });
		}
		return { stop: (seconds = 0.1) => fade.gain.setTargetAtTime(0, ctx.currentTime, Math.max(0.005, seconds / 3)) };
	}

	/**
	 * Start or move a posed loop. Patch (river) or Score (radio). Safe every frame with a new pose.
	 * Same object keeps the graph / clock; a different object restarts.
	 */
	public playLoop(id:string, src:LoopSrc, opts:SfxOpts = {}):void {
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
		this._pendingLoops.set(id, { src, opts: { ...opts } });
		this.armLoop(id);
		this.armPump();
	}

	public stopLoop(id:string):void {
		this._pendingLoops.delete(id);
		const loop = this._loops.get(id);
		if (!loop) {
			return;
		}
		this._loops.delete(id);
		loop.release();
		const ctx = this._ctx;
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

	/**
	 * Where sounds are heard from: `x`, `y`, `z` facing `yaw` sets their direction (a camera, say).
	 * Loudness falls off with distance from `falloffFrom` when given (the player the camera
	 * follows), otherwise from the listener itself.
	 */
	public setListener(x:number, y:number, z:number, yaw = 0, falloffFrom?:{ x:number; y:number; z:number }):void {
		this._listener = { x, y, z, yaw };
		this._falloffFrom = falloffFrom ? { x: falloffFrom.x, y: falloffFrom.y, z: falloffFrom.z } : { x, y, z };
	}

	/** Schedule upcoming notes and spatialize loops. The mixer calls this itself in the browser; call it from tests / headless. */
	public update():void {
		this.applyMix(false);
		this.syncLoops();
		this.fireCues();
		this.fireLoopCues();
		this.scheduleMusic();
		this.scheduleLoopScores();
	}

	private scheduleMusic():void {
		const ctx = this._ctx;
		const bus = this._musicBus;
		const score = this._playing;
		if (!ctx || !bus || !this._noise || !score || ctx.state !== 'running' || this._musicPaused) {
			return;
		}
		if (this._clockDirty) {
			this.armClock();
		}
		if (this._clockDirty || this._musicPaused) {
			return;
		}
		const dest = this._noteDest ?? bus;
		this._pruneCycle = this.pumpScoreNotes(
			score,
			this._origin,
			this._scheduled,
			this._pruneCycle,
			dest,
			'late music note',
			this._voiceDest,
		);
	}

	private scheduleLoopScores():void {
		const ctx = this._ctx;
		if (!ctx || !this._noise || ctx.state !== 'running') {
			return;
		}
		const ears = this._falloffFrom;
		for (const loop of this._loops.values()) {
			if (!isScore(loop.src) || !loop.local) {
				continue;
			}
			if (loop.clockDirty) {
				loop.origin = ctx.currentTime + START_LEAD;
				loop.scheduled.clear();
				loop.pruneCycle = -1;
				loop.clockDirty = false;
			}
			const dist = Math.hypot(loop.x - ears.x, loop.y - ears.y, loop.z - ears.z);
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
		const ctx = this._ctx;
		const noise = this._noise;
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
		const score = this._playing;
		if (!score || this._musicPaused) {
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
					if (this._firedCues.has(id)) {
						continue;
					}
					this._firedCues.add(id);
					const still = this._playing;
					c.fn();
					if (this._playing !== still) {
						return;
					}
				}
			}
		}
		if (times >= 0 && elapsedBeats + 1e-9 >= times * score.loop && this._playing === score) {
			this.stopMusic();
		}
	}

	private fireLoopCues():void {
		for (const [id, loop] of [...this._loops]) {
			if (!isScore(loop.src)) {
				continue;
			}
			const score = loop.src;
			const cues = score.cues;
			const times = score.loops ?? -1;
			const spb = 60 / score.bpm;
			const elapsed = loop.clockDirty || !this._ctx
				? 0
				: Math.max(0, this._ctx.currentTime - loop.origin);
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
						if (this._loops.get(id) !== loop || loop.src !== score) {
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
				&& this._loops.get(id) === loop
			) {
				this.stopLoop(id);
			}
		}
	}

	public dispose():void {
		this.stopRecording();
		this.releaseMusicFilters();
		this._playing = null;
		if (this._pump) {
			cancelAnimationFrame(this._pump);
			this._pump = 0;
		}
		for (const id of [...this.loopIDs()]) {
			this.stopLoop(id);
		}
		this._pendingLoops.clear();
		this._pendingSfx = null;
		this._loops.clear();
		for (const off of this._unlocks) {
			off();
		}
		this._unlocks = [];
		const ctx = this._ctx;
		this._ctx = null;
		this._master = null;
		this._musicGain = null;
		this._sfxGain = null;
		this._musicBus = null;
		this._musicDry = null;
		this._musicWetIn = null;
		this._noise = null;
		this._loopNoise = null;
		if (ctx && ctx.state !== 'closed') {
			void ctx.close();
		}
	}

	private ensure():AudioContext | null {
		if (this._ctx) {
			return this._ctx;
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
		this._ctx = ctx;
		forceStereo(ctx);
		this._noise = makeNoise(ctx);
		this._loopNoise = makeNoise(ctx, 4.2);
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
		this._musicDry = dry;
		this._musicWetIn = wet.in;
		musicGain.connect(master);
		sfxGain.connect(master);
		master.connect(ctx.destination);
		this._master = master;
		this._musicGain = musicGain;
		this._sfxGain = sfxGain;
		this._musicBus = musicBus;
		this.applyMix(true);
		this.armPendingLoops();
		return ctx;
	}

	private reverb(ctx:AudioContext):{ in:AudioNode; out:AudioNode } {
		const send = createReverbSend(ctx);
		return { in: send.in, out: send.out };
	}

	private applyMix(force:boolean):void {
		const key = `${this.muted ? 1 : 0}:${this.musicVolume}:${this.sfxVolume}:${this.duck}:${this._playing ? 1 : 0}:${this._recording ? 1 : 0}:${this._recordingGain}`;
		if (!force && key === this._lastMix) {
			return;
		}
		this._lastMix = key;
		const ctx = this._ctx;
		if (!ctx || !this._master || !this._musicGain || !this._sfxGain) {
			return;
		}
		const now = ctx.currentTime;
		this._master.gain.setTargetAtTime(this.muted ? 0.0001 : 1, now, 0.04);
		const musicOn = !!this._playing || !!this._recording;
		const gain = this._playing?.gain ?? (this._recording ? this._recordingGain : 1);
		const music = musicOn ? this.musicVolume * this.duck * gain : 0.0001;
		this._musicGain.gain.setTargetAtTime(Math.max(0.0001, music), now, 0.08);
		this._sfxGain.gain.setTargetAtTime(Math.max(0.0001, this.sfxVolume), now, 0.04);
	}

	private drop(reason:string):void {
		if (!this.warnDropped || this._dropped.has(reason)) {
			return;
		}
		this._dropped.add(reason);
		console.warn(`[kindling audio] dropped: ${reason}`);
	}

	private armPump():void {
		if (this._pump || typeof requestAnimationFrame !== 'function') {
			return;
		}
		const tick = ():void => {
			this._pump = 0;
			if (!this._ctx) {
				return;
			}
			const busy = !!this._playing || !!this._recordingID || this._loops.size > 0 || this._pendingLoops.size > 0;
			if (!busy) {
				return;
			}
			this.update();
			this._pump = requestAnimationFrame(tick);
		};
		this._pump = requestAnimationFrame(tick);
	}

	private armPendingLoops():void {
		for (const id of this._pendingLoops.keys()) {
			this.armLoop(id);
		}
	}

	private armLoop(id:string):void {
		const spec = this._pendingLoops.get(id);
		if (!spec) {
			return;
		}
		const live = this._loops.get(id);
		if (live && live.src === spec.src) {
			this.poseLoop(live, spec.opts);
			return;
		}
		if (live) {
			live.release();
			const now = this._ctx?.currentTime ?? 0;
			live.voice?.stop(now);
			try {
				live.local?.disconnect();
				live.panner.disconnect();
				live.dist.disconnect();
			}
			catch {
				// gone
			}
			this._loops.delete(id);
		}
		const ctx = this._ctx;
		const bus = this._sfxGain;
		if (!ctx || !bus) {
			return;
		}
		if (!isScore(spec.src) && !(this._loopNoise ?? this._noise)) {
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
			const noise = this._loopNoise ?? this._noise;
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
		this._loops.set(id, loop);
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
		const ctx = this._ctx;
		if (!ctx || ctx.state !== 'running') {
			return;
		}
		this.armPendingLoops();
		const now = ctx.currentTime;
		poseListener(ctx, this._listener, now);
		for (const loop of this._loops.values()) {
			const dx = loop.x - this._falloffFrom.x;
			const dy = loop.y - this._falloffFrom.y;
			const dz = loop.z - this._falloffFrom.z;
			const dist = Math.hypot(dx, dy, dz);
			const extra = isScore(loop.src) ? (loop.src.gain ?? 1) : 1;
			const gain = dist > loop.hear ? 0.0001 : loop.userGain * extra * distanceGain(dist, loop.falloff);
			const at = heardAt(this._listener, loop.x, loop.z);
			placePanner(loop.panner, at.x, at.y, at.z, now, true);
			loop.panner.maxDistance = Math.max(2, loop.hear);
			loop.dist.gain.setTargetAtTime(Math.max(0.0001, gain), now, 0.08);
		}
	}

	private spatialize(
		ctx:AudioContext,
		bus:AudioNode,
		opts:SfxOpts,
		when:number,
		seconds:number,
	):AudioNode | null {
		if (opts.x === undefined || opts.z === undefined) {
			return bus;
		}
		const l = this._listener;
		const hear = opts.hear ?? HEAR;
		const ears = this._falloffFrom;
		const dx = opts.x - ears.x;
		const dy = (opts.y ?? 0) - ears.y;
		const dz = opts.z - ears.z;
		const dist = Math.hypot(dx, dy, dz);
		if (dist > hear) {
			return null;
		}
		poseListener(ctx, this._listener, when);
		const panner = makePanner(ctx, hear);
		const at = heardAt(l, opts.x, opts.z);
		placePanner(panner, at.x, at.y, at.z, when, false);
		const g = ctx.createGain();
		g.gain.value = distanceGain(dist, opts.falloff ?? 0.16);
		panner.connect(g);
		g.connect(bus);
		// Held as long as the sound plays (speech runs for seconds), with room for its release.
		const hold = seconds + 1;
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
