import type { ArcResult } from '../arc/types.js';
import type { STOCK_VERB_DEFS, VerbArgMap } from '../arc/stock-verbs.js';
import type { Arc } from '../arc/types.js';
import type { STOCK_CROWD_VERB_DEFS } from '../conductor/conductor-verbs.js';
import type { Actor } from '../agent/actor.js';
import type { NameTarget } from '../agent/names.js';
import type { AgentIdentity, Goal, KitSource, WatchInput } from '../agent/types.js';
import type { MemoryDraft } from '../memory/store.js';
import type { HostKernels } from '../expr/natives.js';
import type { SampleCache } from '../expr/types.js';
import type { Vec } from '../world/types.js';

/** Argument to `ArcDirector.addActor`: a body the host drives with arcs. It never calls the model. */
export type ActorSpec<TAgentCtx = unknown> = {
	id:string;
	/**
	 * Fetched every tick, so the host can mutate it in place. Omit = director `withDefaultKit`, else no verbs.
	 * `senses` / `tools` omitted on the kit = all registered ones.
	 */
	kit?:KitSource<TAgentCtx>;
	laws?:{
		name?:string;
		who?:string;
		watch:string;
		arc:import('../arc/types.js').Arc | string;
		pinned?:boolean;
	}[];
	maxLaws?:number;
	/** Override director handler cooldown (game seconds). */
	cooldown?:number;
};

/** Argument to `ArcDirector.addAgent`: a body with a mind. */
export type AgentSpec<TAgentCtx = unknown> = ActorSpec<TAgentCtx> & {
	identity:AgentIdentity;
	goals?:Goal[];
	memories?:MemoryDraft[];
	watches?:WatchInput;
	pinnedWatches?:WatchInput;
	watchesWritable?:boolean;
	pinnedSightFocus?:string[];
	sightFocus?:string[];
	sightFocusWritable?:boolean;
	maxSightFocus?:number;
	sightLimit?:number;
	skipHeartbeat?:boolean;
	skipMajor?:boolean;
	/** Tie-break after watch `rankScore`. Higher goes first. Default 0. */
	rank?:number;
	/** Bulk spawn for `addCrowdConductor`. */
	units?:{ id:string; tags?:string[] }[];
	/** Host-set commander body. Must be a unit on this crowd. */
	commander?:string;
};

type ArgValue<TKind> = TKind extends `number${'' | '?'}` ? number
	: TKind extends `string[]${'' | '?'}` ? string[]
		: TKind extends `arc${'' | '?'}` ? Arc
			: string;

/** The `args` a handler receives for an arg map: `{ item: 'id', offer: 'number?' }` is `{ item: string; offer?: number }`. */
export type VerbArgs<TArgMap> = {
	[K in keyof TArgMap as TArgMap[K] extends `${string}?` ? never : K]:ArgValue<TArgMap[K]>;
} & {
	[K in keyof TArgMap as TArgMap[K] extends `${string}?` ? K : never]?:ArgValue<TArgMap[K]>;
};

type StockDefs = typeof STOCK_VERB_DEFS & typeof STOCK_CROWD_VERB_DEFS;

/** Stock and stock crowd verbs, whose args the library already declares. */
export type StockVerbName = keyof StockDefs;

/** Arg map of a stock verb. */
export type StockVerbArgs<TVerb extends StockVerbName> = StockDefs[TVerb] extends { args:infer TArgMap extends VerbArgMap } ? TArgMap : Record<never, never>;

export type VerbCall<TAgentCtx = unknown, TArgs = Record<string, unknown>> = {
	verb:string;
	/** Checked against the verb's arg map before the handler runs. */
	args:TArgs;
	/** Who runs the arc: an `Agent`, or a host-driven `Actor`. Its names are the ones in `args`. */
	actor:Actor<TAgentCtx>;
	ctx:TAgentCtx;
	actorID:string;
	units?:string[];
	/** How well a `watch` arg fits right now, 0–1, or as if this body stood at `point`. Missing arg: 0. */
	score(arg:keyof TArgs & string, point?:Vec):number;
	/** `score(arg, point) > 0`. */
	holds(arg:keyof TArgs & string, point?:Vec):boolean;
	/** Move this body until in reach of `target` (`within`, default `withWorld` `getReach`), following it as it moves. */
	goTo(target:string, within?:number):Promise<ArcResult>;
	/** Move this body to a point. */
	goToPoint(point:Vec, within?:number):Promise<ArcResult>;
	/** Let game time pass. Ends early, interrupted, when the step is aborted. */
	wait(seconds:number):Promise<ArcResult>;
};

export type VerbHandler<TAgentCtx = unknown, TArgs = Record<string, unknown>> = (
	call:VerbCall<TAgentCtx, TArgs>,
)=>ArcResult | Promise<ArcResult>;

/** Runs before every host verb. A result refuses the step; `undefined` lets it run. */
export type VerbGate<TAgentCtx = unknown> = (call:VerbCall<TAgentCtx>)=>ArcResult | undefined;

export type DirectorLog = {
	name:string;
	message:string;
	image?:string;
	/** A failure the host should surface (inference threw, model failed to load). Not an abort. */
	error?:boolean;
};

/** What a naming policy knows about the agent doing the naming. `ctx` is undefined for a bodiless hive. */
export type NameObserver<TAgentCtx = unknown> = { id:string; ctx:TAgentCtx | undefined };

/** Base name `observer` gives `target`. Return `target.id` to name it as itself. */
export type SeenName<TAgentCtx = unknown> = (observer:NameObserver<TAgentCtx>, target:NameTarget)=>string;

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
	/** Generate milliseconds keyed by agent id. */
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
 * Host measurements for watches. `point` is set when a verb asks what if the body stood there: answer as if it
 * did. Director injects `cache`, `hasHeard`, `prev`, and the geometry from `withWorld`; do not commit `cache`.
 */
export type KernelSource<TAgentCtx> = (
	ctx:TAgentCtx,
	point?:Vec,
)=>Omit<HostKernels, 'cache' | WorldMeasures> & { cache?:SampleCache };
