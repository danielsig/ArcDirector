import type { SayToneDef } from '../mind/talk.js';
import type { ArcRunner } from '../character/arc-runner.js';
import type { ArcDirector } from '../director/ArcDirector.js';
import { Feature, type FeatureTick } from '../director/Feature.js';
import type { Mind } from '../mind/mind.js';
import { callEach, type VerbCall } from '../director/director-types.js';
import { axesOf, clarityOf, poseOf } from '../world/lookup.js';
import { add, distance, dot, sub } from '../world/vec.js';
import { Medium, type Vec } from '../world/world-types.js';
import { AUDIBLE, clarityAt, DEFAULT_HEARING, heardText, LOUD, loudnessAfter, loudnessStep, noiseHelp, SPEAKING, WORDS, type HearingRange, type Sound, type SoundListener, type SoundSource } from './hearing.js';
import { SightFeature } from './SightFeature.js';
import { DEFAULT_SOUND_WAYS, soundPath, type SoundWays } from './sound-path.js';

/**
 * A sound going on: where, when it was made, how loud each mind was last told it was, and where its maker and each
 * character stood at the last poll. A line being said only drowns others (`masks`): talk tells it.
 */
type Made<TCtx> = { from:string | Vec; sound:Sound; at:number; told:Map<ArcRunner<TCtx>, number>; polled?:Map<string, Vec>; masks?:true };

/** How it is heard at one listener, and the way it came. */
type Heard = { level:number; source:SoundSource; muffled:boolean; via?:Vec; length?:number };

/** Seconds between the checks of whether a sound going on now wakes someone it did not. */
const POLL_SECONDS = 1;
/** The source's own place in a sound's `polled`. */
const SOURCE = '';
/** Words a second a line is said at: how long it drowns others. */
const WORDS_PER_SECOND = 2.5;

/** What `withHearing` takes. */
export type HearingOptions<TCtx = unknown> = {
	/** The sound each verb makes while it runs (`go_to: { name: 'footsteps', loudness: 0.4 }`), or with `seconds`, for that long. */
	noise?:Record<string, Sound>;
	/** Most sounds a mind is told a think, the loudest kept. Default 5. */
	limit?:number;
	/** How far sound carries: the default curve's numbers, or the game's own `(listenerID, source) => 0–1`. */
	range?:Partial<typeof DEFAULT_HEARING> | ((listenerID:string, source:SoundSource)=>number);
	/**
	 * Hears every sound too, as it is made and again each second while it goes on, for whatever has no mind: a game's
	 * simple bots turning toward a noise. Adds a listener.
	 */
	onSound?:SoundListener;
	/** What a character hears by, from its context: `sound` (default), or a medium the game added (a ghost that hears through walls). */
	medium?:(ctx:TCtx)=>Medium;
	/**
	 * Loud sounds drown quieter ones: a sound under `masking` times the noise at a listener (every other sound there,
	 * summed after walls) is not heard, and told once it is, if it still goes on. Default 0.25 (about 12 dB); 0 turns it off.
	 */
	masking?:number;
	/** Speech's words are made out from `intelligible` times the noise (and {@link WORDS} in silence); under it, muffled. Default 1. */
	intelligible?:number;
} & Partial<Omit<SoundWays, 'rays'>> & { rays?:Partial<SoundWays['rays']> };

/**
 * NPCs hear sounds as they hear speech (`withHearing({ noise: { go_to: { name: 'footsteps', loudness: 0.4 } } })`):
 * a verb's noise while it runs, its help saying how far it carries, and any sound the host makes with {@link emit}. How
 * loud each is heard, and how minds are told: the README's Talk and map. Needs `withWorld`.
 */
export class HearingFeature<TCtx = unknown> extends Feature<TCtx> {
	private readonly _noise = new Map<string, Sound>();
	private _limit = 5;
	private _range:HearingRange = DEFAULT_HEARING;
	private readonly _onSound:SoundListener[] = [];
	private _medium:((ctx:TCtx)=>Medium) | undefined;
	private _ways:SoundWays = DEFAULT_SOUND_WAYS;
	/** The sounds going on, by name and where. */
	private readonly _sounds = new Map<string, Made<TCtx>>();
	/** What ends each verb's own sound once the verb ends. */
	private readonly _hushes = new WeakMap<VerbCall<TCtx>, ()=>void>();
	/** Each noisy verb's help as it was registered, before this added how far its sound carries. */
	private readonly _baseHelp = new Map<string, string | undefined>();
	private _polledAt = -Infinity;
	private _masking = 0.25;
	private _intelligible = 1;

	public override readonly order = 30;

	/** Each verb's `noise` joins those set before. */
	public configure({ noise, limit, range, onSound, medium, masking, intelligible, rays, ...ways }:HearingOptions<TCtx>):this {
		this._medium = medium ?? this._medium;
		this._masking = masking ?? this._masking;
		this._intelligible = intelligible ?? this._intelligible;
		this._ways = { ...this._ways, ...ways, rays: { ...this._ways.rays, ...rays } };
		Object.entries(noise ?? {}).forEach(([verb, sound]) => this._noise.set(verb, sound));
		this._limit = limit ?? this._limit;
		this._range = typeof range === 'function' ? range : range ? { ...DEFAULT_HEARING, ...range } : this._range;
		if (onSound) {
			this._onSound.push(onSound);
		}
		return this.changed();
	}

	/**
	 * `sound` made at `from`, a character or thing the world places or a point: every mind in earshot is told it, and one
	 * heard {@link LOUD} or louder thinks. The same sound again there replaces it. Returns what ends it early.
	 */
	public emit(from:string | Vec, sound:Sound):()=>void {
		return this.make(from, sound);
	}

	/**
	 * How character `listenerID` hears a line `speakerID` says now, in a `tone` or plainly: its `words`, `muffled`
	 * (too far, too quiet against the noise, or through something), or nothing when it is drowned or out of earshot.
	 */
	public speech(speakerID:string, listenerID:string, tone?:SayToneDef):'words' | 'muffled' | undefined {
		const line:Made<TCtx> = { from: speakerID, sound: { name: 'speech', loudness: tone?.words ?? SPEAKING }, at: this.director.time, told: new Map() };
		const heard = this.heardBy(listenerID, line);
		const noise = heard && this.noiseAt(listenerID, `speech@${speakerID}`);
		if (!heard || noise === undefined || heard.level < this._masking * noise) {
			return undefined;
		}
		return !heard.muffled && heard.level >= Math.max(WORDS, this._intelligible * noise) ? 'words' : 'muffled';
	}

	/** `speakerID` says `text`, in a `tone` or plainly: it drowns quieter sounds while it is said, and the tone's own sound is heard. */
	public spoke(speakerID:string, text:string, tone?:SayToneDef):void {
		const seconds = Math.max(1, text.split(/\s+/).length / WORDS_PER_SECOND);
		this.make(speakerID, { name: 'speech', loudness: tone?.words ?? SPEAKING, seconds }, true);
		if (tone?.sound) {
			this.emit(speakerID, tone.sound);
		}
	}

	/** A sound made, heard by every mind in earshot unless it only `masks`; returns what ends it early. */
	private make(from:string | Vec, sound:Sound, masks?:true):()=>void {
		const key = `${sound.name}@${typeof from === 'string' ? from : from.map(Math.round).join(',')}`;
		const made:Made<TCtx> = { from, sound, at: this.director.time, told: this._sounds.get(key)?.told ?? new Map(), ...masks ? { masks } : {} };
		this._sounds.set(key, made);
		if (!masks) {
			this.hear(key, made);
		}
		const end = ():void => {
			if (this._sounds.get(key) === made) {
				this._sounds.delete(key);
			}
		};
		if (!((sound.seconds ?? 0) > 0)) {
			end();
		}
		return end;
	}

	/** Each noisy verb's help says what it is heard as, and how far it carries. */
	public override verbsChanged():void {
		const verbs = this.director.verbs;
		const unitName = this.director.getFeature(SightFeature)?.unitName;
		for (const verb of new Set([...this._baseHelp.keys(), ...this._noise.keys()])) {
			const spec = verbs.get(verb);
			const sound = this._noise.get(verb);
			const base = this._baseHelp.has(verb) ? this._baseHelp.get(verb) : spec?.help;
			if (spec) {
				verbs.redefine(verb, { ...spec, help: sound ? [base, noiseHelp(sound, this._range, unitName)].filter(Boolean).join('; ') : base });
			}
			if (spec && sound) {
				this._baseHelp.set(verb, base);
			}
			else {
				this._baseHelp.delete(verb);
			}
		}
	}

	/** A verb's sound goes on while it runs, unless it says how long it lasts itself. */
	public override stepStarted(call:VerbCall<TCtx>):void {
		const noise = this._noise.get(call.verb);
		if (!noise) {
			return;
		}
		const hush = this.emit(call.character.id, noise.seconds === undefined ? { ...noise, seconds: Infinity } : noise);
		if (noise.seconds === undefined) {
			this._hushes.set(call, hush);
		}
	}

	public override stepEnded(call:VerbCall<TCtx>):void {
		this._hushes.get(call)?.();
	}

	/**
	 * Each second, the sounds going on that ran their time end, and the rest wake whoever they are loud for now: a cart
	 * coming closer, a listener walking past a bell, a door opened on the music. Each pair is heard at its closest
	 * since the last poll, both moving straight, so a cart that passed in between still wakes. The rest of what a mind
	 * hears it is told as it starts thinking ({@link thinkStarts}).
	 */
	public override afterMoves({ now }:FeatureTick):void {
		if (now - this._polledAt < POLL_SECONDS) {
			return;
		}
		this._polledAt = now;
		for (const [key, made] of this._sounds) {
			if (now - made.at >= (made.sound.seconds ?? 0)) {
				this._sounds.delete(key);
				continue;
			}
			if (made.masks) {
				continue;
			}
			const was = made.polled ?? new Map<string, Vec>();
			const polled = new Map<string, Vec>();
			made.polled = polled;
			this.hear(key, made, { loud: true, at: (id) => {
				const source = this.pointOf(made.from);
				const here = this.pointOf(id);
				if (!source || !here) {
					return undefined;
				}
				polled.set(SOURCE, source).set(id, here);
				return closest(was.get(SOURCE) ?? source, source, was.get(id) ?? here, here);
			} });
		}
	}

	/** What `mind` hears now of every sound going on, told before its think: what is new to it, or a step louder. */
	public override thinkStarts(mind:Mind<TCtx>):void {
		for (const [key, made] of this._sounds) {
			if (!made.masks) {
				this.hear(key, made, { owner: mind.owner });
			}
		}
	}

	/**
	 * The noise at character `listenerID`: every sound going on but `except`, summed as heard straight there (walls
	 * dim it; no way round is searched, a party being mostly in the open). Undefined when it has no place.
	 */
	private noiseAt(listenerID:string, except:string):number | undefined {
		const world = this.director.world;
		const here = this.pointOf(listenerID);
		if (!world || !here) {
			return undefined;
		}
		let noise = 0;
		for (const [key, { from, sound, at }] of this._sounds) {
			const point = this.pointOf(from);
			if (key === except || !point || from === listenerID || this._masking <= 0) {
				continue;
			}
			const loudness = loudnessAfter(sound, this.director.time - at);
			const level = typeof this._range === 'function'
				? loudness * this._range(listenerID, typeof from === 'string' ? { id: from, point } : { point })
				: loudness * clarityAt(distance(point, here), this._range) * clarityOf(world, Medium.Sound, point, here);
			noise += Math.min(1, level);
		}
		return noise;
	}

	/** Its help lines say it again, once it is added. */
	private changed():this {
		if (this.attached) {
			this.verbsChanged();
		}
		return this;
	}

	/** Where the character or thing `from` names is now, or the point it is. */
	private pointOf(from:string | Vec):Vec | undefined {
		const world = this.director.world;
		return typeof from === 'string' ? world && poseOf(world, from)?.point : from;
	}

	/**
	 * How loud a sound going on is at character `listenerID` (at `points`, its source's and listener's, else where they
	 * are now), from where, and the way it came; nothing under `floor`.
	 */
	private heardBy(listenerID:string, { from, sound, at }:Made<TCtx>, floor = AUDIBLE, points?:{ point:Vec; here:Vec }):Heard | undefined {
		const world = this.director.world;
		const range = this._range;
		const point = points?.point ?? this.pointOf(from);
		const here = points?.here ?? this.pointOf(listenerID);
		if (!world || !point || !here || from === listenerID) {
			return undefined;
		}
		const source:SoundSource = typeof from === 'string' ? { id: from, point } : { point };
		const loudness = loudnessAfter(sound, this.director.time - at);
		if (typeof range === 'function') {
			const level = Math.min(1, loudness * range(listenerID, source));
			return level >= floor ? { level, source, muffled: false } : undefined;
		}
		const ctx = this._medium && this.director.contextOf(listenerID);
		const path = soundPath(world, ctx === undefined ? Medium.Sound : this._medium!(ctx), point, here, (length) => Math.min(1, loudness * clarityAt(length, range)), this._ways, floor);
		return path && { level: path.level, source, muffled: path.through < 1, ...path.from ? { via: path.from, length: path.length } : {} };
	}

	/**
	 * Tell the minds that hear the sound `key` of it, where it is new to them or a step louder than they were told: only
	 * `owner`'s, only where it is `loud`, each character heard `at` the points given. Bots hear it unless one mind asks.
	 */
	private hear(key:string, made:Made<TCtx>, only:{ owner?:ArcRunner<TCtx>; loud?:boolean; at?:(id:string)=>{ point:Vec; here:Vec } | undefined } = {}):void {
		const world = this.director.world;
		if (!world) {
			return;
		}
		if (!only.owner) {
			callEach('onSound', this._onSound, [made.from, made.sound, (listenerID) => this.heardBy(listenerID, made)?.level ?? 0], (entry) => this.director.log(entry));
		}
		const maker = typeof made.from === 'string' ? this.director.character(made.from) : undefined;
		const sight = this.director.getFeature(SightFeature);
		// Each mind hears it through whichever of its characters hears it loudest.
		const loudest = new Map<ArcRunner<TCtx>, Heard & { id:string }>();
		for (const character of this.director.characters()) {
			const owner = character.owner;
			const listens = owner && owner !== maker?.owner && (!only.owner || owner === only.owner);
			const heard = listens ? this.heardBy(character.id, made, only.loud ? LOUD : AUDIBLE, only.at?.(character.id)) : undefined;
			// Drowned by the rest: neither told nor marked told, so it is told once the noise drops, if it still goes on.
			const drowned = heard && heard.level < this._masking * (this.noiseAt(character.id, key) ?? 0);
			if (owner && heard && !drowned && heard.level > (loudest.get(owner)?.level ?? 0)) {
				loudest.set(owner, { id: character.id, ...heard });
			}
		}
		for (const [owner, { id, level, source, muffled, via, length }] of loudest) {
			const step = loudnessStep(level);
			// Told already, and no louder; or there in plain sight, which says it already.
			if (step <= (made.told.get(owner) ?? -1) || (source.id !== undefined && sight?.sees(id, source.id))) {
				continue;
			}
			made.told.set(owner, step);
			const pose = poseOf(world, id)!;
			const text = heardText(made.sound, level, pose.point, source.point, { facing: pose.facing, axes: axesOf(world), up: pose.up, bearing: sight?.bearing, muffled, unitName: sight?.unitName, via, length });
			owner.tell({ kind: 'sound', text, tags: ['sound'], timestamp: this.director.time, key, cap: this._limit, weight: level, ...level >= LOUD ? { major: true } : {} });
		}
	}
}

/** Where a source moving straight from `s0` to `s1` and a listener from `l0` to `l1`, over the same time, come closest. */
function closest(s0:Vec, s1:Vec, l0:Vec, l1:Vec):{ point:Vec; here:Vec } {
	const gap = sub(s0, l0);
	const drift = sub(sub(s1, s0), sub(l1, l0));
	const speed = dot(drift, drift);
	const t = speed > 1e-12 ? Math.max(0, Math.min(1, -dot(gap, drift) / speed)) : 1;
	return { point: add(s0, sub(s1, s0), t), here: add(l0, sub(l1, l0), t) };
}

declare module '../director/ArcDirector.js' {
	interface ArcDirector<TCtx, TEntity> {
		/** {@link HearingFeature}: `withHearing({ noise: { go_to: { name: 'footsteps', loudness: 0.4 } } })`. */
		withHearing(options:HearingOptions<TCtx>):this;
		getHearing():HearingFeature<TCtx> | undefined;
	}
}
export function withHearing<TCtx>(this:ArcDirector<TCtx>, options:HearingOptions<TCtx>):ArcDirector<TCtx> {
	return this.configureFeature(HearingFeature<TCtx>, () => new HearingFeature<TCtx>(), (hearing) => hearing.configure(options));
}
