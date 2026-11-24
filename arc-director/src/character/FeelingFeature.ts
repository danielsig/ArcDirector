import { Channel } from '../arc/Channel.js';
import type { Step } from '../arc/arc-types.js';
import type { ArcRunner } from './arc-runner.js';
import type { Character } from './Character.js';
import type { ArcDirector } from '../director/ArcDirector.js';
import { callEach } from '../director/director-types.js';
import { Feature, type FeatureTick, type PromptPart, type WatchKernels } from '../director/Feature.js';
import type { Mind } from '../mind/mind.js';
import { isRecord, type JsonValue } from '../json.js';
import type { SeenObject } from '../perception/perception-types.js';
import type { Manner } from '../mind/mind-types.js';
import { FEELINGS, feelingsIn, type Feeling, type FeelingDef, type FeelingLevels, type FeelingMap, type Mood } from './feeling.js';

/** Game seconds a feeling shows before it fades, by default. */
const FEELING_SECONDS = 120;
/** A feeling shows on a character while it is at least this strong, and stronger than its standing level. */
const SHOWN = 0.25;

/** How strongly a character was stirred to a feeling, when, and the game seconds a full one takes to stop showing. */
interface Felt {
	level:number;
	at:number;
	seconds:number;
}

/** What `withFeelings`' `when` is asked, as `character` starts `verb`, one of its `on`. */
export interface FeelingCase<TCtx = unknown> {
	character:Character<TCtx>;
	verb:string;
	step:Step;
}

/** What `withFeelings` takes. */
export interface FeelingsOptions<TCtx = unknown> {
	/** Every feeling there is, by name. Replaces the stock ones ({@link FEELINGS}), so a game names only those it can show. */
	feelings?:FeelingMap<FeelingDef>;
	/** Game seconds a feeling shows before it fades. Default 120. */
	seconds?:number;
	/** Each feeling a character starts to show, for its face, body and sound, and `undefined` once it fades. Adds a listener. */
	onFeeling?:(id:string, feeling:Feeling | undefined)=>void;
	/** The feeling a character is stirred to, fully, times its temperament, as it starts each verb, any verb, stock or the host's: `{ read: Feeling.Happy }`. */
	on?:Readonly<Record<string, Feeling>>;
	/**
	 * The feeling it shows as it starts a verb of `on`: `feeling` (`on`'s), another, or `undefined` for none. Per-character
	 * tastes go here: `(c, feeling) => (c.character.id === 'BridgeKeeper' ? feeling : undefined)`. With none, `on`'s.
	 */
	when?:(started:FeelingCase<TCtx>, feeling:Feeling)=>Feeling | undefined;
	/**
	 * What a mind reads first of all while its character shows `feeling`: by default {@link feelLine}, or `undefined` for
	 * nothing, so a game can word it or spare a mind it.
	 */
	feel?:(id:string, feeling:Feeling)=>string | undefined;
	/**
	 * Whether character `id` has feelings at all: one that has none (a golem, a crowd extra) shows none, not even by
	 * `express`, nothing stirs it, and it keeps none with its memories. Default: every character. How strongly each one is
	 * stirred is its `PersonaSpec.temperament`.
	 */
	hasFeelings?:(id:string)=>boolean;
}

/**
 * What a mind reads of the feeling its character shows, by default: the feeling colors what it would say, not what it
 * does. Trialed on a 12B model. `let it show in your words and voice` colored as many lines, but trades and deeds dropped
 * for an extra line. `say any line in that mood` cost answers: asked a question, stressed or sad, a mind answered from
 * what it knew 11 times in 40, against 21 with this line and 20 in 20 with no feeling; the other answers were vague words
 * of the mood. Sad, with either line a mind asked a toll 10 in 10, chased a thief 10 in 10 and made a trade right 5 in
 * 10, every line sad. `You feel sad.` alone colored 1 line in 48.
 */
export function feelLine(id:string, feeling:Feeling):string {
	return `You feel ${feeling}: say what you would say in that mood, and do as you would anyway.`;
}

/**
 * What characters feel, each its own, in a collective too (`withFeelings({ onFeeling })`): the `express(feeling)` verb, a
 * verb that stirs one (`on`), what it sees and what comes back to it (`looked`, its memories' `felt`), or the host's
 * own word (`getFeelings()?.express(id, Feeling.Afraid)` on a hit), each as its temperament lets it.
 * Onlookers see it (`Angler (looking angry)`), its lines carry it (`Ann says angrily to you`), watches read it
 * (`feeling(u) == "angry"`), and memories steeped in it come to mind more readily (`moodOf`). A save keeps each one shown
 * with the time it has left.
 */
export class FeelingFeature<TCtx = unknown> extends Feature<TCtx> {
	private readonly _options:FeelingsOptions<TCtx> = {};
	private _feelings = new Map<Feeling, FeelingDef>(feelingsIn(FEELINGS));
	private readonly _onFeeling:((id:string, feeling:Feeling | undefined)=>void)[] = [];
	/** What each character was stirred to, by feeling, in the order stirred, each fading as it is read. */
	private readonly _felt = new Map<string, Map<Feeling, Felt>>();
	/** The feeling each character was last told to show (`onFeeling`). */
	private readonly _told = new Map<string, Feeling>();
	/** Whom each character's last look showed, and when it last saw each one, by id ({@link looked}). */
	private readonly _sights = new Map<string, { last:ReadonlySet<string>; at:Map<string, number> }>();

	public override readonly order = 45;
	public override readonly saveKey = 'feelings';

	public configure({ feelings, onFeeling, ...options }:FeelingsOptions<TCtx>):this {
		Object.assign(this._options, options);
		if (onFeeling && !this._onFeeling.includes(onFeeling)) {
			this._onFeeling.push(onFeeling);
		}
		if (feelings) {
			this._feelings = new Map(feelingsIn(feelings));
			if (this.attached) {
				this.verbsChanged();
			}
		}
		return this;
	}

	/** Onlookers see the feeling each character shows (`Angler (looking angry)`), where the host's own `looks` says nothing. */
	public override seen(ctx:TCtx, selfID:string, objects:SeenObject[]):SeenObject[] {
		return objects.map((o) => {
			const looks = o.looks === undefined ? this.looks(o.id) : undefined;
			return looks ? { ...o, looks } : o;
		});
	}

	public override install():void {
		this.director.withVerbs((v) => v.add('express', {
			args: { feeling: 'string' },
			help: 'shows on your face and body until it fades',
			channel: Channel.None,
			handler: ({ character, args }) => (this.express(character.id, args.feeling)
				? { status: 'ok', verb: 'express' }
				: { status: 'failed', verb: 'express', reason: this._feelings.has(args.feeling) ? 'you show no feelings' : `no feeling called ${args.feeling}` }),
		}));
	}

	/** `express`'s `feeling` is one of the feelings there are, in its help and its reply schema alike. */
	public override verbsChanged():void {
		this.director.verbs.argNames('express', 'feeling', [...this._feelings.keys()]);
	}

	/**
	 * Character `id` feels `feeling` fully, and shows it for `seconds` (default `withFeelings`' `seconds`) unless another
	 * grows stronger, whatever its temperament; false for a feeling there is not, or one with no feelings (`hasFeelings`).
	 */
	public express(id:string, feeling:Feeling, seconds = this.seconds):boolean {
		if (!this._feelings.has(feeling) || !this.hasFeelings(id)) {
			return false;
		}
		this.set(id, feeling, 1, seconds);
		this.refresh(id);
		return true;
	}

	/**
	 * Character `id` feels each of `levels` that much more, times its temperament, up to 1, fading as an expressed one does
	 * over `seconds`: what a memory that comes back stirs, or the host's nudge (`stir(id, { sad: 0.3 })`). A feeling there
	 * is not is skipped, and one that feels nothing feels none.
	 */
	public stir(id:string, levels:FeelingLevels, seconds = this.seconds):void {
		if (!this.hasFeelings(id)) {
			return;
		}
		for (const [feeling, amount] of feelingsIn(levels)) {
			if (this._feelings.has(feeling) && amount > 0) {
				this.set(id, feeling, Math.min(1, this.levelOf(id, feeling) + amount * this.temper(id, feeling)), seconds);
			}
		}
		this.refresh(id);
	}

	/**
	 * Whom character `id` sees come into view stirs what it feels toward them (`MemoryStore.feelingsToward`): each feeling
	 * up to as strongly as it feels it toward them, times how much they stand before it, its temperament, and the square
	 * of how long they were out of its sight, fully after a feeling's `seconds`; never down. A companion in every look
	 * stirs nothing, so its feeling fades; one back after a moment, next to nothing; after half a feeling's `seconds`, a
	 * quarter.
	 */
	public override looked(id:string, salience:ReadonlyMap<string, number>):void {
		const character = this.director.character(id);
		if (!character || !this.hasFeelings(id)) {
			return;
		}
		const now = this.director.time;
		const sight = this._sights.get(id) ?? { last: new Set<string>(), at: new Map<string, number>() };
		// One in its last look too stood before it all along, however long ago that look was. Out of sight a moment (behind
		// it as it leads), next to nothing: by the square of how long.
		const arrived = [...salience].filter(([other]) => !sight.last.has(other))
			.map(([other, weight]) => [other, weight * Math.min(1, (now - (sight.at.get(other) ?? -Infinity)) / this.seconds) ** 2] as const)
			.filter(([, weight]) => weight > 0);
		for (const other of salience.keys()) {
			sight.at.set(other, now);
		}
		this._sights.set(id, { last: new Set(salience.keys()), at: sight.at });
		if (arrived.length === 0) {
			return;
		}
		const toward = character.persona.memory.feelingsToward(now, id);
		const targets:Record<string, number> = {};
		for (const [other, weight] of arrived) {
			for (const [feeling, level] of feelingsIn(toward.get(other))) {
				targets[feeling] = Math.max(targets[feeling] ?? 0, Math.min(1, level * weight * this.temper(id, feeling)));
			}
		}
		const raised = Object.entries(targets).filter(([feeling, target]) => this._feelings.has(feeling) && target > this.levelOf(id, feeling));
		raised.forEach(([feeling, target]) => this.set(id, feeling, target, this.seconds));
		if (raised.length > 0) {
			this.refresh(id);
		}
	}

	/** Whether `id` has feelings (`withFeelings({ hasFeelings })`): never a collective's own id. */
	private hasFeelings(id:string):boolean {
		return !this.director.collective(id) && (this._options.hasFeelings?.(id) ?? true);
	}

	/** How strongly character `id` is stirred to `feeling` (`PersonaSpec.temperament`). */
	private temper(id:string, feeling:Feeling):number {
		const temperament = this.director.character(id)?.persona.temperament;
		return typeof temperament === 'number' ? temperament : temperament?.[feeling] ?? 1;
	}

	/**
	 * How strongly character `id` feels `feeling` now, 0 to 1: what it was stirred to, fading toward its standing level
	 * (`PersonaSpec.disposition`), so that a full one stops showing in its `seconds`.
	 */
	public levelOf(id:string, feeling:Feeling):number {
		const felt = this._felt.get(id)?.get(feeling);
		const standing = this.standing(id)[feeling] ?? 0;
		return felt ? Math.max(standing, this.faded(felt)) : standing;
	}

	/** How strongly character `id` feels each feeling it feels at all now, its standing ones too. */
	public levelsOf(id:string):FeelingLevels {
		const feelings = new Set([...this._felt.get(id)?.keys() ?? [], ...Object.keys(this.standing(id))]);
		return Object.fromEntries([...feelings].map((feeling) => [feeling, this.levelOf(id, feeling)] as const).filter(([, level]) => level > 0));
	}

	/**
	 * How far character `id` is stirred above its standing level now, by feeling: what a memory it keeps now is kept with
	 * (`MemoryRecord.felt`), so its standing feelings tint no memory.
	 */
	public stirredOf(id:string):FeelingLevels {
		const standing = this.standing(id);
		return Object.fromEntries([...this._felt.get(id) ?? []].map(([feeling, felt]) => [feeling, this.faded(felt) - (standing[feeling] ?? 0)] as const).filter(([, level]) => level > 0));
	}

	/** What `felt` has faded to at `now`. */
	private faded({ level, at, seconds }:Felt, now = this.director.time):number {
		return level - Math.max(0, now - at) * (1 - SHOWN) / seconds;
	}

	/** What character `id` feels whatever happens (`PersonaSpec.disposition`). */
	private standing(id:string):FeelingLevels {
		return this.director.character(id)?.persona.disposition ?? {};
	}

	private set(id:string, feeling:Feeling, level:number, seconds:number):void {
		const felt = this._felt.get(id) ?? new Map<Feeling, Felt>();
		// Set again last, so the map keeps the order they were stirred in.
		felt.delete(feeling);
		felt.set(feeling, { level, at: this.director.time, seconds });
		this._felt.set(id, felt);
	}

	/** Game seconds a feeling shows before it fades (`withFeelings({ seconds })`). */
	private get seconds():number {
		return this._options.seconds ?? FEELING_SECONDS;
	}

	/** `onFeeling` hears what character `id` shows now, if it changed since it last heard. */
	private refresh(id:string):void {
		const shown = this.of(id);
		if (shown !== this._told.get(id)) {
			if (shown === undefined) {
				this._told.delete(id);
			}
			else {
				this._told.set(id, shown);
			}
			this.tell(id, shown);
		}
	}

	/** The feeling its voice shows, first in a mind's prompt, as `feel` words it. */
	public override promptPart(mind:Mind<TCtx>):PromptPart | undefined {
		const id = mind.thinkThread();
		const feeling = this.of(id);
		const line = feeling === undefined ? undefined : (this._options.feel ?? feelLine)(id, feeling);
		return line ? { feeling: line } : undefined;
	}

	/** A character starting a verb of `on` is stirred to its feeling, or the one `when` picks. */
	public override stepStarts(runner:ArcRunner<TCtx>, step:Step):void {
		const stirred = this._options.on?.[step.verb];
		const character = this.director.character(runner.id);
		if (stirred === undefined || !character) {
			return;
		}
		const feeling = this._options.when ? this._options.when({ character, verb: step.verb, step }, stirred) : stirred;
		if (feeling !== undefined) {
			this.stir(character.id, { [feeling]: 1 });
		}
	}

	/**
	 * The feeling character `id` shows now: of those it was stirred to above its standing level, the strongest, at least
	 * {@link SHOWN}; the one stirred last of two as strong.
	 */
	public of(id:string):Feeling | undefined {
		const standing = this.standing(id);
		const shown = [...this._felt.get(id) ?? []]
			.map(([feeling, felt], order) => ({ feeling, level: this.faded(felt), order }))
			.filter(({ feeling, level }) => level >= SHOWN && level > (standing[feeling] ?? 0))
			.sort((a, b) => b.level - a.level || b.order - a.order);
		return shown[0]?.feeling;
	}

	/**
	 * `id`'s mood, as recall reads it: how strongly it feels each feeling now, with every feeling's `memories`
	 * (`FeelingDef.memories`) to tell that one's by. None while fewer than two feelings have memories.
	 */
	public moodOf(id:string):Mood | undefined {
		const memories = Object.fromEntries([...this._feelings].filter(([, def]) => (def.memories?.length ?? 0) > 0).map(([name, def]) => [name, def.memories!]));
		return Object.keys(memories).length > 1 ? { levels: this.levelsOf(id), memories } : undefined;
	}

	/** What `feeling` is in words, if there is such a feeling. */
	public def(feeling:Feeling | undefined):FeelingDef | undefined {
		return feeling === undefined ? undefined : this._feelings.get(feeling);
	}

	/** How character `id` looks to onlookers: `looking angry`, or nothing while it shows no feeling. */
	public looks(id:string):string | undefined {
		const def = this.def(this.of(id));
		return def && `looking ${def.looking}`;
	}

	/** Each feeling faded back to its standing level is let go, and `onFeeling` hears what each character shows now. */
	public override beforeWatches({ now }:FeatureTick):void {
		for (const [id, felt] of this._felt) {
			const standing = this.standing(id);
			for (const [feeling, one] of felt) {
				if (this.faded(one, now) <= (standing[feeling] ?? 0)) {
					felt.delete(feeling);
				}
			}
			if (felt.size === 0) {
				this._felt.delete(id);
			}
		}
		for (const id of new Set([...this._felt.keys(), ...this._told.keys()])) {
			this.refresh(id);
		}
	}

	/** What each character was stirred to, by feeling: how strongly now, and the seconds a full one shows. */
	public override toJSON():JsonValue {
		const saved:Record<string, JsonValue> = {};
		for (const [id, felt] of this._felt) {
			const levels = Object.fromEntries([...felt].map(([feeling, one]) => [feeling, { level: Math.round(this.faded(one) * 1000) / 1000, seconds: one.seconds }] as const).filter(([, { level }]) => level > 0));
			if (Object.keys(levels).length > 0) {
				saved[id] = levels;
			}
		}
		return saved;
	}

	/** Each saved feeling is felt again as strongly as it was, and `onFeeling` hears what shows; one the save lacks is gone. */
	public override load(json:JsonValue | undefined):void {
		this._felt.clear();
		for (const [id, levels] of Object.entries(isRecord(json) ? json : {})) {
			for (const [feeling, one] of Object.entries(isRecord(levels) ? levels : {})) {
				if (isRecord(one) && typeof one.level === 'number' && typeof one.seconds === 'number') {
					this.set(id, feeling, one.level, one.seconds);
				}
			}
		}
		for (const id of new Set([...this._felt.keys(), ...this._told.keys()])) {
			this.refresh(id);
		}
	}

	public override runnerRemoved(runner:ArcRunner<TCtx>):void {
		this._felt.delete(runner.id);
		this._told.delete(runner.id);
		this._sights.delete(runner.id);
	}

	/** `feeling(u)`: the feeling `u` shows, `""` for none. */
	public override watchKernels():WatchKernels {
		return { functions: { feeling: ([who]) => {
			const one = who?.kind === 'list' ? who.value[0] : who;
			return { kind: 'string', value: (one?.kind === 'entity' && this.of(one.value.id)) || '' };
		} } };
	}

	/** A line said with a feeling, said so: `Ann says angrily to you`, `Ann (says angrily, to you): …`; in a tone, after the tone's word (`growls angrily`). */
	public override manner(turn:Manner):string | undefined {
		const adverb = this.def(turn.feeling)?.adverb;
		return adverb && (turn.as ? adverb : `says ${adverb}`);
	}

	private tell(id:string, feeling:Feeling | undefined):void {
		callEach('onFeeling', this._onFeeling, [id, feeling], (entry) => this.director.log(entry));
	}
}

declare module '../director/ArcDirector.js' {
	interface ArcDirector<TCtx, TEntity> {
		/**
		 * {@link FeelingFeature}: `withFeelings({ seconds: 60, onFeeling: (id, feeling) => face(id, feeling), on: { read:
		 * Feeling.Happy } })`.
		 */
		withFeelings(options?:FeelingsOptions<TCtx>):this;
		getFeelings():FeelingFeature<TCtx> | undefined;
	}
}
export function withFeelings<TCtx>(this:ArcDirector<TCtx>, options:FeelingsOptions<TCtx> = {}):ArcDirector<TCtx> {
	return this.configureFeature(FeelingFeature<TCtx>, () => new FeelingFeature<TCtx>(), (feelings) => feelings.configure(options));
}
