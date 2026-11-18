import { hand } from '../internals.js';
import type { Arc, ArcResult } from '../arc/arc-types.js';
import type { ArcRunner } from '../character/arc-runner.js';
import type { Character } from '../character/Character.js';
import type { Collective } from '../collective/Collective.js';
import type { Mind } from '../mind/mind.js';
import type { ArcFormat, Manner } from '../mind/mind-types.js';
import type { ExprVal, NativeFn } from '../expr/expr-types.js';
import type { Goal, KitSource } from '../character/character-types.js';
import type { JsonValue } from '../json.js';
import type { SeenObject } from '../perception/perception-types.js';
import type { ArcDirector } from './ArcDirector.js';
import type { VerbCall } from './director-types.js';

/** What a feature's constructor hands the director that adds it: the one way to set its director. */
export type FeatureFields<TCtx> = {
	attach(director:ArcDirector<TCtx>):void;
};

/** What a feature adds to the watch language ({@link Feature.watchKernels}): functions of its own, and values under names. */
export type WatchKernels = { functions?:Record<string, NativeFn>; bindings?:Record<string, ExprVal> };

/** One tick as a feature's tick hooks see it: game seconds passed, the game time now, and which intervals fired. */
export type FeatureTick = {
	dt:number;
	now:number;
	/** The `watch` interval fired: laws and parked `when`s are asked this tick (`withIntervals`). */
	watch:boolean;
	/** The `think` interval fired: minds' watches are sampled, and goals asked. */
	think:boolean;
};

/**
 * What a feature puts in a mind's prompt, each in the place the prompt keeps for it (`mind/prompt.ts` lays them out and
 * words their headers, so the prompt reads the same whichever features fill it).
 */
export type PromptPart = {
	/** Lines for what was said and heard lately, under short-term memory. */
	mentioned?:string;
	/** Lines for the names in a failed last result, under it. */
	lastResultArticles?:string;
	/** Open offers, one per line. */
	offers?:string;
	/** A block after the rest, for a mind whose owner has no section of its own (a collective's roster). */
	section?:string;
	/** The mark the map shows the mind at, which the standing rules name. */
	youSymbol?:string;
	/** The standing rules say `recall` searches what the world knows, besides memory. */
	recallKnows?:boolean;
};

/**
 * Something a director can do: hearing, talk, an RTS, a game's own. Added with `addFeature`, or a built-in by its
 * `with*` shortcut (`withMap`). Every hook is empty until a feature overrides it; the director calls each hook on
 * every feature, lowest `order` first, then in the order they were added. Hooks are synchronous, and each touches only
 * its own feature's state. The shape of a Kindling `Component`: `getFeature` is `getComponent`.
 */
export abstract class Feature<TCtx = unknown> {
	private _director:ArcDirector<TCtx> | undefined;

	constructor() {
		hand(this, {
			attach: (director) => {
				if (this._director && this._director !== director) {
					throw new Error('ArcDirector: a feature belongs to one director');
				}
				this._director = director;
			},
		} satisfies FeatureFields<TCtx>);
	}

	/** Where its hooks run among the other features'. The built-ins keep the library's sequence; a game's own come after. */
	public readonly order:number = 100;

	/**
	 * The key a save keeps its state under (`'feelings'`): set, `exportCast` keeps what {@link toJSON} returns and
	 * `restoreCast` hands it to {@link load}. A word of its own, not the class name, which a minifier renames.
	 */
	public readonly saveKey:string | undefined = undefined;

	/** Whether it was added to a director yet. */
	protected get attached():boolean {
		return this._director !== undefined;
	}

	/** The director it was added to. Its hooks run only once it has one. */
	protected get director():ArcDirector<TCtx> {
		if (!this._director) {
			throw new Error('ArcDirector: this feature was never added (addFeature)');
		}
		return this._director;
	}

	/** Once, when added: register verbs, tools and senses through the director's registries. */
	public install():void {}

	/** Its state for a save, under its {@link saveKey}; undefined keeps nothing. */
	public toJSON():JsonValue | undefined {
		return undefined;
	}

	/**
	 * Its state from a save, in place of what it holds: once `restoreCast` cleared the cast, before it is rebuilt.
	 * Undefined when the save holds none for it (it had none, or was not there yet).
	 */
	public load(json:JsonValue | undefined):void {}

	/** The verbs changed (one added, removed, or given a handler): what it says in their help lines is said again. */
	public verbsChanged():void {}

	/** Each tick, before the think queue samples the minds' watches. */
	public beforeWatches(tick:FeatureTick):void {}
	/** Each tick, once waits are settled, before characters move. */
	public beforeMoves(tick:FeatureTick):void {}
	/** Each tick, once characters moved. */
	public afterMoves(tick:FeatureTick):void {}
	/** Each tick, last before ready minds start thinking. */
	public beforeThinks(tick:FeatureTick):void {}

	/** A character or collective joined the cast: wired, or the feature added once it was. */
	public runnerAdded(runner:ArcRunner<TCtx>):void {}
	/** A character or collective left the cast: removed, or the whole cast cleared. */
	public runnerRemoved(runner:ArcRunner<TCtx>):void {}
	/** `character` moved from collective `from` to `to`; `null` is on its own, with its own mind or the host's hands. */
	public characterMoved(character:Character<TCtx>, from:Collective<TCtx> | null, to:Collective<TCtx> | null):void {}

	/** The kind `tags` name, for a character or collective the cast wires: all its tags (`Worker`), and its kit for a spec with none. */
	public kindOf(tags:readonly string[] | undefined):{ tags:string[]; kit:KitSource<TCtx> } | undefined {
		return undefined;
	}

	/** Whether an Arc may aim at `name` though nothing in the world answers to it now (an RTS's sites and kinds). */
	public knows(name:string):boolean {
		return false;
	}

	/** Who of no part of `collective` its character `id` sees, in `mind`'s words (`EnemyKnight 12/28 hp 8m (in reach)`, `(in reach, no clear shot)`, `(out of reach)`): its roster says the nearest. */
	public othersSeenBy(id:string, collective:Collective<TCtx>, mind:Mind<TCtx>):{ name:string; away:number; text:string }[] {
		return [];
	}

	/**
	 * `collective`'s side at a glance for its mind's prompt (an RTS's stock, supply, queues and units grouped by kind),
	 * in place of its roster of every unit by name and their programs.
	 */
	public rosterStatus(collective:Collective<TCtx>):string | undefined {
		return undefined;
	}

	/** What it adds to the watch language for `runner`: bindings (an RTS side's numbers), or kernels of its own. */
	public watchKernels(runner:ArcRunner<TCtx>):WatchKernels | undefined {
		return undefined;
	}

	/** `mind` is about to think: what it should know by then, it is told now (hearing tells it what it hears). */
	public thinkStarts(mind:Mind<TCtx>):void {}
	/** What it adds to `mind`'s prompt this think. Called once a think, so it may count thinks. */
	public promptPart(mind:Mind<TCtx>):PromptPart | undefined {
		return undefined;
	}

	/** What `selfID` sees from `ctx` (`SightFeature.seenBy`), with what it adds: `objects` as they are by default. */
	public seen(ctx:TCtx, selfID:string, objects:SeenObject[]):SeenObject[] {
		return objects;
	}

	/** How `turn` was said, in the word Current Conversation shows it with (`growls`, `angrily`); features' words join in order. */
	public manner(turn:Manner):string | undefined {
		return undefined;
	}

	/** Why `arc`, a reply of `mind`'s that reads, would fail as it starts, and the turn that asks for another (no repair turn). */
	public replyCheck(mind:Mind<TCtx>, arc:Arc, format:ArcFormat):{ reason:string; hint:string } | undefined {
		return undefined;
	}

	/** `mind` reached `goal`, by its `until` or its own word: it is a goal no more. */
	public goalReached(mind:Mind<TCtx>, goal:Goal<never>):void {}

	/** A host verb passed the gate and its handler starts. */
	public stepStarted(call:VerbCall<TCtx>):void {}
	/** A host verb {@link stepStarted} told of ended, how it went; a handler that threw ended `failed`. */
	public stepEnded(call:VerbCall<TCtx>, result:ArcResult):void {}
}

/** Feature `type`'s `get*` shortcut, which its file declares on `ArcDirector` typed with the director's context and `shortcuts.ts` builds. */
export function featureGetter<F>(type:abstract new (...args:never[])=>F):(this:ArcDirector)=>F | undefined {
	return function() {
		return this.getFeature(type);
	};
}
