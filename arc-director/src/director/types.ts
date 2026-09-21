import type { ActionResult } from '../action/types.js';
import type { Agent } from '../agent/agent.js';
import type { AgentIdentity, Goal, KitSource, WatchInput } from '../agent/types.js';
import type { MemoryDraft } from '../memory/store.js';
import type { HostKernels } from '../expr/natives.js';
import type { SampleCache } from '../expr/types.js';

/** Argument to `ArcDirector.addAgent`. Scene files keep literals; they do not redeclare this. */
export type AgentSpec<HostCtx = unknown> = {
	id:string;
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
	/**
	 * Object or `(ctx) => kit`, fetched every tick. Same object reference is kept so the host can mutate it.
	 * Omit = director `withDefaultKit`, or no verbs if that was omitted too.
	 * `senses` / `tools` omitted on the kit = all registered senses / tools.
	 */
	kit?:KitSource<HostCtx>;
	/** Bulk spawn for `addCrowdConductor`. */
	units?:{ id:string; tags?:string[] }[];
	laws?:{
		name?:string;
		who?:string;
		watch:string;
		plan:import('../action/types.js').ActionPlan | string;
		pinned?:boolean;
	}[];
	maxLaws?:number;
	/** Override director handler cooldown (game seconds). */
	cooldown?:number;
	/** Host-set commander body. Must be a unit on this crowd. */
	commander?:string;
};

export type VerbCall<HostCtx = unknown> = {
	verb:string;
	args:Record<string, unknown>;
	agent:Agent<HostCtx>;
	ctx:HostCtx;
	actorID:string;
	units?:string[];
};

export type VerbHandler<HostCtx = unknown> = (
	call:VerbCall<HostCtx>,
)=>ActionResult | Promise<ActionResult>;

export type DirectorLog = {
	name:string;
	message:string;
	image?:string;
};

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
	};
}

/** Host measurements for watches. Director injects `cache`, `hasHeard`, and `prev`; do not commit `cache`. */
export type KernelSource<HostCtx> = (
	ctx:HostCtx,
)=>Omit<HostKernels, 'cache'> & { cache?:SampleCache };
