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
	local:GainNode | null;
	origin:number;
	clockDirty:boolean;
	scheduled:Set<string>;
	firedCues:Set<string>;
	pruneCycle:number;
};

/**
 * Procedural mixer. No samples. Headless (no AudioContext) is a silent no-op.
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
	private musicDry:GainNode | null = null;
	private musicWetIn:AudioNode | null = null;
	private noise:AudioBuffer | null = null;
	private score:Score | null = null;
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

	get musicPaused():boolean {
		return this.pausedMusic;
	}

	/** Beats from loop start, in `[0, loop)`. */
	musicBeat():number {
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
		if (!this.score || this.pausedMusic) {
			return;
		}
		this.musicHold = this.elapsedSec();
		this.pausedMusic = true;
		this.cutMusicVoices();
	}

	unpauseMusic():void {
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

	playMusic(score:Score):void {
		const bad = scoreProblems(score);
		if (bad.length) {
			throw new Error(`${score.id ?? 'score'}: ${bad.join(', ')}`);
		}
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
		if (!ctx || !this.musicDry || !this.musicWetIn) {
			this.musicBus = null;
			return;
		}
		const bus = ctx.createGain();
		bus.gain.value = 1;
		bus.connect(this.musicDry);
		bus.connect(this.musicWetIn);
		this.musicBus = bus;
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

	stopMusic():void {
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
		const dest = this.spatialize(ctx, bus, opts, when);
		if (!dest) {
			return;
		}
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
		this.pruneCycle = this.pumpScoreNotes(score, this.origin, this.scheduled, this.pruneCycle, bus, 'late music note');
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
						dest,
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
		const input = ctx.createGain();
		const out = ctx.createGain();
		out.gain.value = 0.28;
		const times = [0.029, 0.043, 0.071, 0.103];
		for (const d of times) {
			const delay = ctx.createDelay(0.2);
			delay.delayTime.value = d;
			const lp = ctx.createBiquadFilter();
			lp.type = 'lowpass';
			lp.frequency.value = 2400;
			const fb = ctx.createGain();
			fb.gain.value = 0.38;
			input.connect(delay);
			delay.connect(lp);
			lp.connect(fb);
			fb.connect(delay);
			lp.connect(out);
		}
		return { in: input, out };
	}

	private applyMix(force:boolean):void {
		const key = `${this.muted ? 1 : 0}:${this.musicVolume}:${this.sfxVolume}:${this.duck}:${this.score ? 1 : 0}`;
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
		const music = this.score ? this.musicVolume * this.duck * (this.score.gain ?? 1) : 0.0001;
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
			const busy = !!this.score || this.loops.size > 0 || this.pendingLoops.size > 0;
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
		let local:GainNode | null = null;
		if (isScore(spec.src)) {
			local = ctx.createGain();
			local.gain.value = 1;
			local.connect(panner);
		}
		else {
			const noise = this.loopNoise ?? this.noise;
			if (!noise) {
				return;
			}
			voice = startLoopLayers(ctx, panner, noise, spec.src.layers, spec.src.gain ?? 1);
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
