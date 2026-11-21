import type { ArcResult } from '../arc/arc-types.js';
import type { STOCK_VERB_DEFS, VerbArgMap } from '../arc/stock-verbs.js';
import type { Arc, StepArg } from '../arc/arc-types.js';
import type { STOCK_COLLECTIVE_VERB_DEFS } from '../collective/collective-verbs.js';
import type { Character } from '../character/Character.js';
import type { NamingText } from '../character/text-with-ids.js';
import type { NameTarget } from '../character/NameBook.js';
import type { PersonaSpec } from '../character/Persona.js';
import type { Goal, KitSource } from '../character/character-types.js';
import type { LawSpec } from '../arc/laws.js';
import type { MemoryRecord, MemorySharing } from '../memory/store.js';
import type { ExprEntity, ExprVal } from '../expr/expr-types.js';
import type { MindSettings } from '../mind/mind.js';
import type { TalkStyle } from '../mind/talk.js';
import type { Crowd, MoveOpts, ServingSpot } from '../world/mover.js';
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
	 * How it talks unasked, shown with who is in earshot (`withTalk`): `{ instructions: TalkInstructions.Banter, avoid:
	 * ['the crown'] }`. Its instructions replace the director's (`withTalk({ instructions })`); `avoid` adds `Never
	 * mention the crown.` to whichever it talks by.
	 */
	talk?:TalkStyle;
	/**
	 * Act without a mind: a System One model keeps picking one of its `choices` by name for `goal`. `until` is a watch
	 * that ends the picking while it is true. Runs whenever the character is idle and the director has a System One; in a
	 * collective, that is whenever its commander has issued it nothing.
	 */
	choose?:StandingChoice;
	/** Standing offers it makes from the start, to anyone: `{ give: { Loaf: 1 }, get: { gold: 5 } }`. A save keeps its own. */
	offers?:Pick<Offer, 'give' | 'get'>[];
	/** How others coming to it share it, whatever the director's `withWorldVerbs` `crowd` says for their verb: `line` for a vendor. A move's own `crowd` still wins. */
	crowd?:Crowd;
	/** Where the one it serves stands while others line up to it (a `line`), in its own frame. Default just clear of its edge. */
	servingSpot?:ServingSpot;
};

/**
 * What doing `verb` needs of whoever does it: other fields are its args, matched by id or tag; `condition` a watch on
 * `me`, the doer; `reason` what it is told while that fails (else `needs <condition>`), ids in its own names. Gemma 4
 * E4B writes `{ [reason]: { 'use.item': 'Sushi', condition } }` better (72/72 to 58, 2026-11-20): kept for Skaldic Edda.
 */
export type Requirement = { verb:string; condition:string; reason?:NamingText; [arg:string]:NamingText | undefined };

/** A character spec's `choose`: `{ goal, until?, choices: { hold: 'go_to(EastGate) && wait()', … } }`. */
export type StandingChoice = {
	goal:string;
	until?:string;
	/** Each choice's arc text, by its name. */
	choices:Record<string, string>;
};

/** Argument to `ArcDirector.addCollective`: characters sharing one mind. */
export type CollectiveSpec<TCtx = unknown> = RunnerSpec<TCtx> & {
	/** Settings for its mind. A collective always has one. */
	mind?:MindSettings;
	/** Its characters. Each runs steps with its own kit, or the director's default. */
	characters?:CharacterSpec<TCtx>[];
	/** The character the mind acts through. Omit for a collective without one, like a marketplace hive. */
	commander?:string;
	/** Most units one `command` may address at once. Unset to allow command to address all units. */
	maxUnitsPerCommand?:number;
	/** What a character of it reads while it thinks for itself: what it witnessed (the default), or what any of them knows. */
	sharing?:MemorySharing;
	/**
	 * Of what a `Shared` collective knows that `character` did not witness, whether it keeps `record` when it leaves
	 * for good. Asked once a record. Default: it keeps only what it witnessed.
	 */
	leaverKeepsMemory?:(record:MemoryRecord, character:Character<TCtx>)=>boolean;
};

type ArgValue<TArg> = ArgKindValue<TArg extends { kind:infer TKind } ? TKind : TArg>;

type ArgKindValue<TKind> = TKind extends `number${'' | '?'}` ? number
	: TKind extends `bool${'' | '?'}` ? boolean
		: TKind extends `duration${'' | '?'}` ? true | number | string
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

export interface VerbCall<TCtx = unknown, TArgs = Record<string, unknown>> {
	verb:string;
	/** Checked against the verb's arg map before the handler runs. */
	args:TArgs;
	/** The character running the step. */
	character:Character<TCtx>;
	ctx:TCtx;
	/**
	 * Aborts when the step's `until` is met (reason `'until'`) or its `within` runs out (`'within'`). Its moves and waits
	 * end then on their own; a verb that can still say how it went returns that (`wander`: what it saw).
	 */
	signal:AbortSignal;
	/** How well a `watch` arg fits right now, 0–1, or as if this character stood at `point`. Missing arg: 0. */
	score(arg:keyof TArgs & string, point?:Vec):number;
	/** Whether a `watch` arg is met now, or would be were this character at `point`: `score(arg, point) > 0`. */
	isMet(arg:keyof TArgs & string, point?:Vec):boolean;
	/** `score(arg, point)` for a graded `watch` arg (a number here: a `count`, a `distance`); none for a yes/no one. */
	grader(arg:keyof TArgs & string):((point:Vec)=>number) | undefined;
	/**
	 * Move this character until in reach of `target` (`within`, default `withWorld` `getReach` with the step's `with`, else its verb), following it as it
	 * moves, or sooner once `check` gives a reason. Fails only when there is no way there.
	 */
	goTo(target:string, opts?:MoveOpts):Promise<ArcResult>;
	/** Move this character to a point. */
	goToPoint(point:Vec, opts?:MoveOpts):Promise<ArcResult>;
	/** Let game time pass. Ends early, stopped, when the step is aborted. */
	wait(seconds:number):Promise<ArcResult>;
}

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
	/** The response format a prompt asked for, whole (`message` names it only): what a stored log needs to replay the request. */
	schema?:Record<string, unknown>;
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

/**
 * What a character sees of the world in the watch language, from its context: who (`others`) and what (`items`) is
 * there, names a watch may read (`bindings`, `lookup`), and how to read health, packs, doors and cooldowns. `point`
 * is set when a verb asks what if the character stood there: answer as if it did. The director adds the rest:
 * geometry from `withWorld` (`distance`, `canSee`, …), `withFunctions`, `withStringifiers`, and its cache.
 */
export type KernelSource<TCtx> = (
	ctx:TCtx,
	point?:Vec,
)=>{
	me:ExprEntity;
	others:ExprEntity[];
	items:ExprEntity[];
	bindings?:Record<string, ExprVal>;
	/** A name no binding gives, built the first time a watch reads it (the places of a big world); absent, no such name. */
	lookup?:(name:string)=>ExprVal | undefined;
	nearRadius?:number;
	inventory?:(who:ExprEntity)=>ExprEntity[];
	hp?:(who:ExprEntity)=>{ hp:number; maxHP:number } | undefined;
	isOpen?:(who:ExprEntity)=>boolean | undefined;
	/** Whether `who` may `verb` now, its cooldown over; undefined (ready) for a verb with none. */
	isReady?:(who:ExprEntity, verb:string)=>boolean | undefined;
};
