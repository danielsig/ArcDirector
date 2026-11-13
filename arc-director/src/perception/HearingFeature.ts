import type { ArcResult } from '../arc/arc-types.js';
import type { ArcRunner } from '../character/arc-runner.js';
import type { ArcDirector } from '../director/ArcDirector.js';
import { Feature, type FeatureTick } from '../director/Feature.js';
import { callEach, type VerbCall } from '../director/director-types.js';
import { poseOf } from '../world/lookup.js';
import { distance } from '../world/vec.js';
import type { Vec } from '../world/world-types.js';
import { AUDIBLE, clarityAt, DEFAULT_HEARING, heardText, LOUD, loudnessAfter, loudnessStep, noiseHelp, type HearingRange, type Sound, type SoundListener, type SoundSource } from './hearing.js';
import { SightFeature } from './SightFeature.js';

/** A sound going on: where, when it was made, and how loud each mind was last told it was. */
type Made<TCtx> = { from:string | Vec; sound:Sound; at:number; told:Map<ArcRunner<TCtx>, number> };

/** What `withHearing` takes. */
export type HearingOptions = {
	/** The sound each verb makes while it runs (`go_to: { name: 'footsteps', loudness: 0.4 }`), or with `seconds`, for that long. */
	noise?:Record<string, Sound>;
	/** Most sounds a mind is told a think, the loudest kept. Default 5. */
	limit?:number;
	/** How far sound carries: the default curve's numbers, or the game's own `(listenerID, source) => 0–1`. */
	range?:Partial<typeof DEFAULT_HEARING> | ((listenerID:string, source:SoundSource)=>number);
	/**
	 * Hears every sound too, as it is made and again each tick while it goes on, for whatever has no mind: a game's simple
	 * bots turning toward a noise. Adds a listener.
	 */
	onSound?:SoundListener;
};

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
	/** The sounds going on, by name and where. */
	private readonly _sounds = new Map<string, Made<TCtx>>();
	/** What ends each verb's own sound once the verb ends. */
	private readonly _hushes = new WeakMap<VerbCall<TCtx>, ()=>void>();
	/** Each noisy verb's help as it was registered, before this added how far its sound carries. */
	private readonly _baseHelp = new Map<string, string | undefined>();

	public override readonly order = 30;

	/** Each verb's `noise` joins those set before. */
	public configure({ noise, limit, range, onSound }:HearingOptions):this {
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
		const key = `${sound.name}@${typeof from === 'string' ? from : from.map(Math.round).join(',')}`;
		const made:Made<TCtx> = { from, sound, at: this.director.time, told: this._sounds.get(key)?.told ?? new Map() };
		this._sounds.set(key, made);
		this.hear(key);
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

	public override stepEnded(call:VerbCall<TCtx>, _result:ArcResult):void {
		this._hushes.get(call)?.();
	}

	/** The sounds going on, heard again as their makers and listeners move; those that ran their time end. */
	public override afterMoves({ now }:FeatureTick):void {
		for (const [key, { sound, at }] of this._sounds) {
			if (now - at >= (sound.seconds ?? 0)) {
				this._sounds.delete(key);
			}
			else {
				this.hear(key);
			}
		}
	}

	/** Its help lines say it again, once it is added. */
	private changed():this {
		if (this.attached) {
			this.verbsChanged();
		}
		return this;
	}

	/** How loud a sound going on is at character `listenerID` now, and from where; nothing when it is not heard. */
	private heardBy(listenerID:string, { from, sound, at }:Made<TCtx>):{ level:number; source:SoundSource; muffled:boolean } | undefined {
		const world = this.director.world;
		const range = this._range;
		const point = world && (typeof from === 'string' ? poseOf(world, from)?.point : from);
		const here = world && poseOf(world, listenerID)?.point;
		if (!world || !point || !here || from === listenerID) {
			return undefined;
		}
		const source:SoundSource = typeof from === 'string' ? { id: from, point } : { point };
		const muffled = typeof range !== 'function' && (world.canPass?.('sound', point, here) ?? 1) <= 0;
		const clarity = typeof range === 'function' ? range(listenerID, source) : clarityAt(distance(here, point), range) * (muffled ? range.occluded : 1);
		const level = Math.min(1, loudnessAfter(sound, this.director.time - at) * clarity);
		return level >= AUDIBLE ? { level, source, muffled } : undefined;
	}

	/** Tell every mind that hears the sound `key` of it, where it is new to them or a step louder than they were told. */
	private hear(key:string):void {
		const made = this._sounds.get(key);
		const world = this.director.world;
		if (!made || !world) {
			return;
		}
		callEach('onSound', this._onSound, [made.from, made.sound, (listenerID) => this.heardBy(listenerID, made)?.level ?? 0], (entry) => this.director.log(entry));
		const maker = typeof made.from === 'string' ? this.director.character(made.from) : undefined;
		const sight = this.director.getFeature(SightFeature);
		// Each mind hears it through whichever of its characters hears it loudest.
		const loudest = new Map<ArcRunner<TCtx>, { id:string; level:number; source:SoundSource; muffled:boolean }>();
		for (const character of this.director.characters()) {
			const owner = character.owner;
			const heard = owner && owner !== maker?.owner ? this.heardBy(character.id, made) : undefined;
			if (owner && heard && heard.level > (loudest.get(owner)?.level ?? 0)) {
				loudest.set(owner, { id: character.id, ...heard });
			}
		}
		for (const [owner, { id, level, source, muffled }] of loudest) {
			const step = loudnessStep(level);
			// Told already, and no louder; or there in plain sight, which says it already.
			if (step <= (made.told.get(owner) ?? -1) || (source.id !== undefined && sight?.sees(id, source.id))) {
				continue;
			}
			made.told.set(owner, step);
			const pose = poseOf(world, id)!;
			const text = heardText(made.sound, level, pose.point, source.point, { facing: pose.facing, up: world.up, muffled, unitName: sight?.unitName });
			owner.tell({ kind: 'sound', text, tags: ['sound'], timestamp: this.director.time, key, cap: this._limit, weight: level, ...level >= LOUD ? { major: true } : {} });
		}
	}
}

declare module '../director/ArcDirector.js' {
	interface ArcDirector<TCtx, TEntity> {
		/** {@link HearingFeature}: `withHearing({ noise: { go_to: { name: 'footsteps', loudness: 0.4 } } })`. */
		withHearing(options:HearingOptions):this;
		getHearing():HearingFeature<TCtx> | undefined;
	}
}
export function withHearing<TCtx>(this:ArcDirector<TCtx>, options:HearingOptions):ArcDirector<TCtx> {
	return this.configureFeature(HearingFeature<TCtx>, () => new HearingFeature<TCtx>(), (hearing) => hearing.configure(options));
}
