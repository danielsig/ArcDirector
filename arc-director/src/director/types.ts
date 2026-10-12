import type { ArcResult } from '../arc/types.js';
import type { STOCK_VERB_DEFS, VerbArgMap } from '../arc/stock-verbs.js';
import type { Arc } from '../arc/types.js';
import type { STOCK_COLLECTIVE_VERB_DEFS } from '../collective/verbs.js';
import type { Character } from '../character/character.js';
import type { NameTarget } from '../character/names.js';
import type { PersonaSpec } from '../character/persona.js';
import type { KitSource } from '../character/types.js';
import type { LawSpec } from '../arc/laws.js';
import type { MindSettings } from '../mind/mind.js';
import type { HostKernels } from '../expr/natives.js';
import type { SampleCache } from '../expr/types.js';
import type { Offer } from '../world/offers.js';
import type { Vec } from '../world/types.js';

/** What both a character and a collective spec hold: an id, a kit, laws, and the persona fields. */
type RunnerSpec<TCtx> = PersonaSpec & {
	id:string;
	/**
	 * Fetched every tick, so the host can mutate it in place. Omit = director `withDefaultKit`; with neither,
	 * `start()` throws. `senses` / `tools` omitted on the kit = all registered ones.
	 */
	kit?:KitSource<TCtx>;
	laws?:LawSpec[];
	maxLaws?:number;
	/** Override director handler cooldown (game seconds). */
	cooldown?:number;
	/**
	 * The System One it picks `choose` with, by its name on the director (`addJevInference`, …); `null` for none.
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
};

type ArgValue<TKind> = TKind extends `number${'' | '?'}` ? number
	: TKind extends `bundle${'' | '?'}` ? Record<string, number>
		: TKind extends `string[]${'' | '?'}` ? string[]
			: TKind extends `arc${'' | '?'}` ? Arc
				: string;

/** The `args` a handler receives for an arg map: `{ item: 'id', offer: 'number?' }` is `{ item: string; offer?: number }`. */
export type VerbArgs<TArgMap> = {
	[K in keyof TArgMap as TArgMap[K] extends `${string}?` ? never : K]:ArgValue<TArgMap[K]>;
} & {
	[K in keyof TArgMap as TArgMap[K] extends `${string}?` ? K : never]?:ArgValue<TArgMap[K]>;
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
	/** How well a `watch` arg fits right now, 0–1, or as if this character stood at `point`. Missing arg: 0. */
	score(arg:keyof TArgs & string, point?:Vec):number;
	/** `score(arg, point) > 0`. */
	holds(arg:keyof TArgs & string, point?:Vec):boolean;
	/** Move this character until in reach of `target` (`within`, default `withWorld` `getReach`), following it as it moves. */
	goTo(target:string, within?:number):Promise<ArcResult>;
	/** Move this character to a point. */
	goToPoint(point:Vec, within?:number):Promise<ArcResult>;
	/** Let game time pass. Ends early, interrupted, when the step is aborted. */
	wait(seconds:number):Promise<ArcResult>;
};

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

/** What a naming policy knows about the mind doing the naming: its owner's id, and its voice's context (none for a collective with no commander). */
export type NameObserver<TCtx = unknown> = { id:string; ctx:TCtx | undefined };

/** Base name `observer` gives `target`. Return `target.id` to name it as itself. */
export type SeenName<TCtx = unknown> = (observer:NameObserver<TCtx>, target:NameTarget)=>string;

/** Argument to `ArcDirector.start`. */
export type StartOpts = {
	/** Log unknown kit names via `onLog` instead of throwing. Default false. */
	ignoreMissing?:boolean;
};

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
