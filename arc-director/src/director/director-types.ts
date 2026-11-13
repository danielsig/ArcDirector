import type { ArcResult } from '../arc/arc-types.js';
import type { STOCK_VERB_DEFS, VerbArgMap } from '../arc/stock-verbs.js';
import type { Arc, StepArg } from '../arc/arc-types.js';
import type { STOCK_COLLECTIVE_VERB_DEFS } from '../collective/collective-verbs.js';
import type { Character } from '../character/Character.js';
import type { NameTarget } from '../character/NameBook.js';
import type { PersonaSpec } from '../character/Persona.js';
import type { Goal, KitSource } from '../character/character-types.js';
import type { LawSpec } from '../arc/laws.js';
import type { MindSettings } from '../mind/mind.js';
import type { HostKernels } from '../expr/natives.js';
import type { SampleCache } from '../expr/expr-types.js';
import type { Crowd, MoveOpts } from '../world/mover.js';
import type { Offer } from '../world/offers.js';
import type { Vec } from '../world/world-types.js';

/** What both a character and a collective spec hold: an id, a kit, laws, and the persona fields. */
type RunnerSpec<TCtx> = Omit<PersonaSpec, 'goals'> & {
	id:string;
	goals?:Goal<TCtx>[];
	/**
	 * Fetched every tick, so the host can mutate it in place. Omit = director `withDefaultKit`; with neither,
	 * the cast cannot be wired. `senses` / `tools` omitted on the kit = all registered ones.
	 */
	kit?:KitSource<TCtx>;
	laws?:LawSpec[];
	maxLaws?:number;
	/** Game seconds its standing `choose` rests after a failed pick; overrides `withCooldown`. */
	cooldown?:number;
	/**
	 * The System One it picks `choose` with, by its model role on the director (`addJev`, any role); `null` for none.
	 * Omit for the director's default. A collective's also picks for every character in it. Its kit must still
	 * grant `choose`.
	 */
	systemOne?:string | null;
};

/** Argument to `ArcDirector.addCharacter` and `Collective.addCharacter`. */
export type CharacterSpec<TCtx = unknown> = RunnerSpec<TCtx> & {
	/** Plain tags. A collective's `tag` adds its own, prefixed, on top. */
	tags?:string[];
	/**
	 * Give it a mind of its own, with these settings (`{}` for the defaults). Omit for a character the host
	 * drives. In a collective it thinks with the collective's mind, and gets its own when it leaves.
	 */
	mind?:MindSettings;
	/**
	 * Act without a mind: a System One model keeps picking one of these arcs by name for `goal`. Every key but
	 * `goal` and `until` names a choice; its value is that choice's arc text. `until` is a watch that ends the
	 * picking while it holds. Runs whenever the character is idle and the director has a System One; in a
	 * collective, that is whenever its commander has issued it nothing.
	 */
	choose?:StandingChoice;
	/** Standing offers it makes from the start, to anyone: `{ give: { Loaf: 1 }, get: { gold: 5 } }`. A save keeps its own. */
	offers?:Pick<Offer, 'give' | 'get'>[];
	/** How others coming to it share it, whatever the director's `withWorldVerbs` `crowd` says for their verb: `line` for a vendor. A move's own `crowd` still wins. */
	crowd?:Crowd;
};

/** A character spec's `choose`: `{ goal, until?, hold: 'go_to(EastGate) && wait()', … }`. */
export type StandingChoice = {
	goal:string;
	until?:string;
	[choice:string]:string | undefined;
};

/** Argument to `ArcDirector.addCollective`: characters sharing one mind. */
export type CollectiveSpec<TCtx = unknown> = RunnerSpec<TCtx> & {
	/** Settings for its mind. A collective always has one. */
	mind?:MindSettings;
	/** Its characters. Each runs steps with its own kit, or the director's default. */
	characters?:CharacterSpec<TCtx>[];
	/** The character the mind acts through. Omit for a collective without one, like a market hive. */
	commander?:string;
	/** Most units one `command` may address at once. Unset to allow command to address all units. */
	maxUnitsPerCommand?:number;
};

type ArgValue<TArg> = ArgKindValue<TArg extends { kind:infer TKind } ? TKind : TArg>;

type ArgKindValue<TKind> = TKind extends `number${'' | '?'}` ? number
	: TKind extends `count${'' | '?'}` ? number | true
		: TKind extends `bundle${'' | '?'}` ? Record<string, number>
			: TKind extends `string[]${'' | '?'}` ? string[]
				: TKind extends `arc${'' | '?'}` ? Arc
					: string;

/** Whether an arg as declared, a kind or an `ArgSpec`, may be left out. */
type Optional<TArg> = (TArg extends { kind:infer TKind } ? TKind : TArg) extends `${string}?` ? true : false;

/** The `args` a handler receives for an arg map: `{ item: 'id', offer: 'number?' }` is `{ item: string; offer?: number }`. */
export type VerbArgs<TArgMap> = {
	[K in keyof TArgMap as Optional<TArgMap[K]> extends true ? never : K]:ArgValue<TArgMap[K]>;
} & {
	[K in keyof TArgMap as Optional<TArgMap[K]> extends true ? K : never]?:ArgValue<TArgMap[K]>;
};

type StockDefs = typeof STOCK_VERB_DEFS & typeof STOCK_COLLECTIVE_VERB_DEFS;

/** Stock and stock collective verbs, whose args the library already declares. */
export type StockVerbName = keyof StockDefs;

/** Arg map of a stock verb. */
export type StockVerbArgs<TVerb extends StockVerbName> = StockDefs[TVerb] extends { args:infer TArgMap extends VerbArgMap } ? TArgMap : Record<never, never>;

export type VerbCall<TCtx = unknown, TArgs = Record<string, unknown>> = {
	verb:string;
	/** Checked against the verb's arg map before the handler runs. */
	args:TArgs;
	/** The character running the step. */
	character:Character<TCtx>;
	ctx:TCtx;
	/**
	 * Aborts when the step's `until` holds (reason `'until'`) or its `within` runs out (`'within'`). Its moves and waits
	 * end then on their own; a verb that can still say how it went returns that (`wander`: what it saw).
	 */
	signal:AbortSignal;
	/** How well a `watch` arg fits right now, 0–1, or as if this character stood at `point`. Missing arg: 0. */
	score(arg:keyof TArgs & string, point?:Vec):number;
	/** `score(arg, point) > 0`. */
	holds(arg:keyof TArgs & string, point?:Vec):boolean;
	/**
	 * Move this character until in reach of `target` (`within`, default `withWorld` `getReach`), following it as it
	 * moves, or sooner once `check` gives a reason. Fails only when there is no way there.
	 */
	goTo(target:string, opts?:MoveOpts):Promise<ArcResult>;
	/** Move this character to a point. */
	goToPoint(point:Vec, opts?:MoveOpts):Promise<ArcResult>;
	/** Let game time pass. Ends early, stopped, when the step is aborted. */
	wait(seconds:number):Promise<ArcResult>;
};

/** An alias verb's arc, watch or who: a template with `{arg}` holes, or made from its args. */
export type AliasPart = string | ((args:Readonly<Record<string, StepArg>>)=>string);

/**
 * A verb that is a named arc (`keep_distance(keep=3)` runs `flee(…)`). As a law's whole arc it brings its own `watch`,
 * `who` and `rearm` when the law gives none.
 */
export type VerbAlias = { arc:AliasPart; watch?:AliasPart; who?:AliasPart; rearm?:number };

export type VerbHandler<TCtx = unknown, TArgs = Record<string, unknown>> = (
	call:VerbCall<TCtx, TArgs>,
)=>ArcResult | Promise<ArcResult>;

/** Runs before every host verb. A result refuses the step; `undefined` lets it run. */
export type VerbGate<TCtx = unknown> = (call:VerbCall<TCtx>)=>ArcResult | undefined;

export type DirectorLog = {
	name:string;
	message:string;
	image?:string;
	/** A failure the host should surface (inference threw, model failed to load). Not an abort. */
	error?:boolean;
};

/**
 * Calls each of `listeners` (what an `on*` added) with `args`. One that throws goes to `log` as `name`'s, and the rest
 * are still called: a bug in how a host shows something must not end what told it.
 */
export function callEach<A extends unknown[]>(name:string, listeners:readonly ((...args:A)=>void)[], args:A, log?:(entry:DirectorLog)=>void):void {
	for (const listener of listeners) {
		try {
			listener(...args);
		}
		catch (err) {
			log?.({ name: 'ArcDirector', message: `${name}: ${err instanceof Error ? err.message : String(err)}`, error: true });
		}
	}
}

/** What a naming policy knows about the mind doing the naming: its owner's id, and its voice's context (none for a collective with no commander). */
export type NameObserver<TCtx = unknown> = { readonly id:string; readonly ctx:TCtx | undefined };

/** Base name `observer` gives `target`. Return `target.id` to name it as itself. */
export type SeenName<TCtx = unknown> = (observer:NameObserver<TCtx>, target:NameTarget)=>string;

export type InferClock = {
	calls:number;
	contextMs:number;
	generateMs:number;
	wallMs:number;
	contextKnown:number;
	lastContextMs:number | null;
	lastGenerateMs:number | null;
	lastWallMs:number | null;
	/** Generate milliseconds keyed by mind id. */
	thinkMs:Record<string, number>;
};

export function emptyInferClock():InferClock {
	return {
		calls: 0,
		contextMs: 0,
		generateMs: 0,
		wallMs: 0,
		contextKnown: 0,
		lastContextMs: null,
		lastGenerateMs: null,
		lastWallMs: null,
		thinkMs: {},
	};
}

/** Measurements the director derives from `withWorld` poses and routes; a kernel source does not give them. */
type WorldMeasures = 'point' | 'distance' | 'pathDistance' | 'facing' | 'side' | 'isFacing';

/**
 * Host measurements for watches. `point` is set when a verb asks what if the character stood there: answer as if it
 * did. Director injects `cache`, `hasHeard`, `prev`, and the geometry from `withWorld`; do not commit `cache`.
 */
export type KernelSource<TCtx> = (
	ctx:TCtx,
	point?:Vec,
)=>Omit<HostKernels, 'cache' | WorldMeasures> & { cache?:SampleCache };
