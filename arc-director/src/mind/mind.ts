import { parseArcText } from '../arc/arc-parse.js';
import { formatArc, formatArcBlocks } from '../arc/arc-format.js';
import { arcJSONBlocks, arcSoFar, finishedSteps, replyBreakdown } from '../arc/wire.js';
import { docsFor, replySchema } from '../arc/schema.js';
import { FOCUS_EDIT_VERBS, INSTEAD_VERB, isFree, PASS_VERB, VerbRegistry, WATCH_EDIT_VERBS, STOCK_VERB_DEFS } from '../arc/stock-verbs.js';
import type { Arc, ArcResult, ArcResultJSON, Step } from '../arc/arc-types.js';
import { ArcError, BlockedArcError, resultFromJSON, resultToJSON } from '../arc/arc-types.js';
import { evaluate } from '../expr/eval.js';
import { observeExpr } from '../expr/stringify.js';
import { cloneEntity } from '../expr/prev.js';
import type { ChatContentPart, ChatDelta, ChatMessage, ChatResponse, JsonSchemaResponseFormat, ToolDef } from '../inference/provider.js';
import { extractJson, isRecord, type JsonSchema } from '../json.js';
import { mergeTags, restsOnFact, type RestsOn } from '../memory/store.js';
import type { ArcFormat, ConversationTurn, HeldEvent, HeldEventJSON, MindEvent, Saved, Sense, ThinkEvent, ToolSpec } from './mind-types.js';
import { DEFAULT_YOU_SYMBOL } from './map.js';
import type { Feature, PromptPart } from '../director/Feature.js';
import { jsonToolCall, toolFirstArgs, writtenToolCalls } from './tool-text.js';
import { arcRepairHint, BESIDE_VERBS, failedPart, faultLine, heardMidThinkHint, NO_LOOKUPS_LEFT, nothingFoundThen, partRepairHint, programFiles, refusedCall, thinkOnHint, thoughtCutHint, writtenToolsHint, toolAnswer, toolResultHint, listAnswer, repeatOutputHint, reviseGoalsAsk, stablePrefix, thinkLine, volatileBlock, type PromptStyle, type ThinkInstructions } from './prompt.js';
import type { SightClause } from '../perception/perception-types.js';
import { idsOf, mapArc, mapExpr, mapLawName, namesOf } from './ids.js';
import type { NameTarget } from '../character/NameBook.js';
import type { FeelingLevels, Mood } from '../character/feeling.js';
import { idsIn, joinTextWithIDs, namedText, namingText, personOf, readTextWithIDs, showNamingText, showTextWithIDs, type TextWithIDs } from '../character/text-with-ids.js';
import { RESERVED_TAGS } from '../world/world-types.js';
import type { Persona } from '../character/Persona.js';
import type { Goal, Watches } from '../character/character-types.js';
import type { ArcRunner, Holder } from '../character/arc-runner.js';
import type { Character } from '../character/Character.js';
import { lawGroup, type Law } from '../arc/laws.js';
import { arcSteps, insteadOf, isArc, sameProgram } from '../arc/arc-types.js';
import { DEFAULT_MIN_CHOICES } from '../arc/choose.js';
import { DEFAULT_EXPLICIT_THINK_ALLOWED_INSIDE } from '../arc/validate.js';
import type { ArgPath } from '../arc/constraints.js';
import type { MindQueue } from '../think/queue.js';
import { FAILED_ARC_SCORE } from '../think/scheduler.js';
import { hasWatch, watchCount } from '../character/watch.js';
import { asFocusList } from '../character/focus.js';
import { hand, internalsOf } from '../internals.js';
import { partLabel, partsText, RejectedParts, ReplyReader, restOfReply, type Rejected } from '../arc/compile.js';
import { MindMemory, takeOut, type KeptLineJSON, type Sighted } from './MindMemory.js';
import { showInPerson } from '../character/person.js';
import { URGENT, type ModelChat, type ModelRun } from '../director/ModelSlots.js';

/**
 * How a mind thinks, and what its prompt tells it. One layer of them: a mind reads each setting from its own (its
 * spec's `mind`, saved with it), else its director's (`withMind`), else the library's ({@link MIND_DEFAULTS}).
 */
export type MindSettings = {
	/**
	 * How readily it rethinks what it is doing, 0–1: higher, more often. The queue's rethink timer wakes it only while the
	 * impact of what remains of its voice's program (`ArcRunner.impact`) is below this, least impact first. Default 0.25:
	 * idle, following, wandering or waiting, not walking somewhere or using things. 0: never on the timer; only
	 * watches, events and Arc ends wake it.
	 */
	rethinkingThreshold?:number;
	/**
	 * How readily it looks back at once when its Arc ends well, 0–1: higher, more often. It thinks at once only when the
	 * impact of the steps that ran (`ArcRunner.ranImpact`) is above 1 − this; else it idles until its next rethink. Default
	 * 0.75: after a walk, a line or a trade, not after a wait. A failed Arc always brings a think.
	 */
	retrospectThreshold?:number;
	/** Rethinks even on a prompt that has not changed since its last think (elapsed times aside). Default: skipped. */
	thinkUnchanged?:boolean;
	/** Major events do not wake it. */
	skipMajor?:boolean;
	/** No think when it joins: it waits for something to happen. Default: it thinks once to start. */
	skipStart?:boolean;
	/** No goal or identity revision, on the timer or after a major event. */
	skipStrategic?:boolean;
	/** Tie-break after watch `rankScore`. Higher goes first. Default 0. */
	rank?:number;
	/** Fewest game seconds between tactical thinks. Default 0 under a director, whose queue paces thinks. */
	minThinkInterval?:number;
	/** Game seconds between goal revisions; 0 never revises. Default 180. */
	strategicInterval?:number;
	/** The model it thinks with, by its role on the director (`addLMStudio({ models })`, …). Omit for the director's default. */
	model?:string;
	/**
	 * How much of Current Conversation to show, in letters, whole messages only, newest kept.
	 * Omit for one quarter of its slot's share of the model's context window ({@link conversationCapFor} in `MindMemory.ts`). 0 shows none.
	 */
	conversationCap?:number;
	/**
	 * How many of its own laws' results since its last think its next prompt pins, newest kept. Every result is also
	 * kept in long-term memory, where `recall` finds it; the pins drop once a think has read them. Default 5.
	 */
	lawResults?:number;
	/** How the model writes an Arc: `text` (`go_to() && wait()`), `json`, or `schema` (JSON the server must follow). Default `schema`. */
	arcFormat?:ArcFormat;
	/** The standing think line per reasoning state. The prompt follows the model's reasoning switch. Defaults: `on` {@link DEFAULT_THINK_INSTRUCTIONS}, `off` nothing. */
	thinkInstructions?:ThinkInstructions;
	/** The standing verb-chain line. Default {@link DEFAULT_VERB_INSTRUCTIONS}, plus looping programs for a collective; this replaces both. */
	verbInstructions?:string;
	/** The Arc that closes the prompt as its Example, in place of the stock one. Models copy it, so make it valid. */
	arcExample?:string;
	/** One sentence in the system prefix, after who it is. */
	systemNote?:string;
	/**
	 * The item id the world pays with (`gold`). The prompt tells how `give` and `offer` move it, the purse is counted in
	 * it, and handing it over is remembered as paying. Without one, nothing is said about money.
	 */
	currency?:string;
	/** Tool rounds a think may spend before it must write the Arc. Default {@link DEFAULT_TOOL_ROUNDS}; 0 offers no tools. */
	toolRounds?:number;
	/**
	 * Heard lines (and offers) a think takes in as it goes: a line that would wake the mind while it looks something up, or
	 * while its reply has not begun the Arc yet (the reply stops for it), joins its next turn, and the think goes on. Past
	 * these, or once the reply under way has begun the Arc, a line waits for the next think. Default 1; 0 takes none.
	 */
	maxInterruptionsPerThink?:number;
	/**
	 * Repair turns after a bad Arc. Default 0: a bad reply fails the think. Each retry samples as the model does, so a
	 * model that wrote one bad reply does not write it again word for word.
	 */
	repairRetries?:number;
	/**
	 * The fewest choices a `choose` in a reply may have; one with fewer goes back for repair, and the prompt asks for this
	 * many to two more. Default {@link DEFAULT_MIN_CHOICES}: models left alone write one or two. Needs repair turns.
	 */
	minChoices?:number;
	/**
	 * The arc args an explicit `think()` may be written directly in: a reply with one anywhere else is turned down, and the
	 * prompt and reply schema say so. Default {@link DEFAULT_EXPLICIT_THINK_ALLOWED_INSIDE}: `if.arc`, `if.else` and a
	 * `choose` choice (`choose.arc`), so a think follows from how something went. Add a conditional verb of the game's own:
	 * `[...DEFAULT_EXPLICIT_THINK_ALLOWED_INSIDE, 'maybe.arc']`.
	 */
	explicitThinkAllowedInside?:readonly ArgPath[];
	/**
	 * The steps of a reply that need no body (`command`, `law`, `when`, `say`, ...) are judged each on its own: the good ones
	 * stand, the model's turn shows only those, and it is told in words what became of the rest, to replace just them. A
	 * reply that does not read at all still goes back whole.
	 */
	repairPerStep?:boolean;
	/**
	 * A watch that reads a field no one in sight has (`u.foo`) goes back for repair too: it would only ever be false. Leave
	 * it off if your entities gain fields later. Read from the director's layer.
	 */
	repairUnknownFields?:boolean;
	/** How close a memory must come to what is before it to come to mind unasked (0–1). Default 0.55. */
	intrusionThreshold?:number;
	/** Game seconds between two memories that come to mind unasked. Default 45. */
	intrusionCooldown?:number;
	/**
	 * With an embedding model, the most memories one think embeds that have no meaning yet (`MemoryRecord.embedding`); the
	 * rest wait for the next. Higher catches up faster after a load or a burst of events, at a bigger request. Default 64.
	 */
	embedBatch?:number;
	/**
	 * The most plain episodic memories its owner keeps: past it the weakest go, the oldest of as weak first. A character of
	 * a collective with no mind of its own reads its spec's `mind`, then the director's. Default 256.
	 */
	maxEpisodic?:number;
	/**
	 * How fast its owner forgets: how many times as fast time passes for its memories as for `director.time`, so a day of
	 * memory is 24 hours of `director.time` over it. Default 60 (`FORGETFULNESS`): a day of memory per 24 minutes, as in
	 * games with days and nights; an episode never used again is still 90% likely after 24 minutes and forgotten after about
	 * a day of play. Set it to how many of the world's days pass per real day (72 for 20-minute days); twice it for an old
	 * man who forgets; 0 forgets nothing but what `maxEpisodic` pushes out.
	 */
	forgetfulness?:number;
	/** Thinks between two {@link Mind.forgetFaded} of its own; 0 never (sleep or the host does it). Default 50. */
	forgetEvery?:number;
	/** Memories brought into each prompt, and the most `recall` returns. Default 5. */
	recallK?:number;
	/** No `observe` tool. */
	hideObserve?:boolean;
	/**
	 * Offer and teach `command(who, append=true)`, which queues orders after what units do now. Default off: models
	 * smaller than about 12B rarely use it and sometimes put it on urgent orders, which then wait.
	 */
	offerAppendedCommands?:boolean;
};

/** A result's reason named by its verb, so it reads on its own as a memory: `wander: saw Lantern`. None without a reason. */
function resultLine(result:ArcResult):TextWithIDs | undefined {
	return result.reason ? joinTextWithIDs(result.verb ? `${result.verb}: ` : '', namedText(result.reason)) : undefined;
}

/** One of its laws' results, and how many times in a row it came out so. */
type LawLine = { text:TextWithIDs; times:number };

/** `line` as its mind reads it: `Law guard failed: …`, `×3` after it when it came out so three times. */
function lawText({ text, times }:LawLine):TextWithIDs {
	return times > 1 ? joinTextWithIDs(text, ` ×${times}`) : text;
}

/** Tool calls a think may make before it must emit the Arc. Small models need several lookups in a row. */
export const DEFAULT_TOOL_ROUNDS = 6;

/** The library's layer of every mind's settings: each one neither the mind nor its director sets. */
const MIND_DEFAULTS = {
	rethinkingThreshold: 0.25,
	retrospectThreshold: 0.75,
	skipMajor: false,
	skipStart: false,
	skipStrategic: false,
	rank: 0,
	minThinkInterval: 0,
	strategicInterval: 180,
	lawResults: 5,
	arcFormat: 'schema',
	toolRounds: DEFAULT_TOOL_ROUNDS,
	maxInterruptionsPerThink: 1,
	repairRetries: 0,
	minChoices: DEFAULT_MIN_CHOICES,
	explicitThinkAllowedInside: DEFAULT_EXPLICIT_THINK_ALLOWED_INSIDE,
	repairPerStep: false,
	repairUnknownFields: false,
	intrusionThreshold: 0.55,
	intrusionCooldown: 45,
	embedBatch: 64,
	forgetEvery: 50,
	recallK: 5,
	hideObserve: false,
	offerAppendedCommands: false,
} as const satisfies MindSettings;

/** Setting `K` as a mind reads it: never unset where the library has a default. */
export type Setting<K extends keyof MindSettings> = K extends keyof typeof MIND_DEFAULTS ? NonNullable<MindSettings[K]> : MindSettings[K];

/** The model a mind thinks with, as its director has it now. */
export type MindModel = {
	/** A lease on one of its slots for a whole think: every request of it goes through the lease's chat. */
	run:ModelRun;
	/** Whether it takes image parts: `see_map` is offered only to a mind whose model does. */
	vision:boolean;
	/** Tokens one request may fill, when known: its slot's share of the model's context window. */
	contextTokens?:number;
	/** Whether it reasons before it answers. Picks the think line and asks the server for it. */
	thinking:boolean;
	/** How much of the standing rules it is told: see {@link PromptStyle}. */
	promptStyle:PromptStyle;
	/** Whether it writes only JSON Arcs, as one trained on them does: `text` is then asked as `schema`. */
	jsonOnly:boolean;
};

/** A mind's thinking state. Its owner's persona is saved with the owner. */
export type MindJSON = {
	settings:MindSettings;
	events?:HeldEventJSON[];
	lastArc?:Arc;
	lastResult?:ArcResultJSON;
	lastTacticalTimestamp?:number;
	lastStrategicTimestamp?:number;
	lastIntrusionTimestamp?:number;
	recent?:KeptLineJSON[];
	recentSummary?:KeptLineJSON[];
	/** Last clear lines, oldest first. */
	conversation?:(Saved<ConversationTurn> & { at:number; knownBy:string[] })[];
	thinkAbout?:string;
};

/** What a mind thinks for: a character, or a collective. Its `voice` enacts the arcs the mind writes. */
export type MindOwner<TCtx = unknown> = ArcRunner<TCtx> & {
	/** The owner's own block of the prompt, in place of the laws. A collective lists its roster here. */
	promptSection?(mind:Mind<TCtx>):string;
	/** The verbs its prompt lists, when fewer than it may parse: a collective's nested ones its characters can run. */
	promptVerbs?():VerbRegistry;
	/** Whether others it leads are at work (a collective's units running programs), so a think may only wait. */
	working?():boolean;
	/** A collective's characters. */
	readonly characters?:readonly Character<TCtx>[];
};

/** A {@link ThinkEvent} before it is told whose think it is. */
type ThinkEventFor = ThinkEvent extends infer E ? E extends ThinkEvent ? Omit<E, 'who'> : never : never;

/** What the director gives a mind when it is attached: services, read live. Its settings are a layer of their own. */
export type MindDeps<TCtx = unknown> = {
	/** The model it thinks with now: asked on every think, so a model added, removed or reassigned is seen at once. */
	thinksWith:()=>MindModel;
	/** The director's layer of its settings (`withMind`), read live: a later change reaches it on its next think. */
	defaults?:MindSettings;
	senses?:Record<string, Sense<TCtx>>;
	tools?:Record<string, ToolSpec<TCtx>>;
	/** When the voice has an executor, `tick` runs the arc unless this is false. */
	autoEnact?:boolean;
	/** Each arc the moment a think chooses it, before it runs. */
	onChoose?:(arc:Arc)=>void;
	/** Whoever watches this mind think, if anyone does by now. */
	thinkWatch?:()=>((event:ThinkEvent)=>void) | undefined;
	/** Why an Arc just read could never work as written, for the model to write it again before it runs. */
	arcProblem?:(arc:Arc)=>ArcError | undefined;
	queue?:MindQueue;
	/** Vectors for memories and recall queries. Omit to recall by text alone. */
	embed?:(texts:string[])=>Promise<number[][]>;
	/**
	 * Character `id`'s mood, as recall reads it (`FeelingFeature.moodOf`): its voice's, or one of its collective's
	 * characters'. Memories steeped in it come unbidden more readily.
	 */
	moodOf?:(id:string)=>Mood | undefined;
	/** Character `id` feels each of `levels` that much more (`FeelingFeature.stir`): what a memory that comes back stirs. */
	stir?:(id:string, levels:FeelingLevels)=>void;
	/** Host naming policy seen from this mind: the base name for a character. Omit to use ids. */
	seenAs?:(target:NameTarget)=>string;
	/** The context its tools and articles look from. Default: its voice's. */
	worldContext?:()=>TCtx | undefined;
	/** Whether the character `id` has fallen (`HostWorld.hasFallen`). Omit when none ever does. */
	hasFallen?:(id:string)=>boolean;
	/** Its director's features, read live: what each puts in its prompt, and the tools each gives it. */
	features?:readonly Feature<TCtx>[];
};

function asStringArray(v:unknown):string[] {
	if (!Array.isArray(v)) {
		return [];
	}
	return v.filter((x):x is string => typeof x === 'string');
}

/**
 * The tools every mind has, unless its kit leaves them out or it cannot use one (`offered`): its memory (`recall`) and the
 * watch language (`observe`). A director registers them first in `director.tools`.
 */
export function mindTools<TCtx>():Record<string, ToolSpec<TCtx>> {
	return {
		recall: {
			description: (mind) => `Search your own memory: what you know, were told, saw, or did. Query the names or keywords your goal needs (Bread, Gate). If it finds nothing, ${nothingFoundThen(mind.owner.activeVerbs())}.`,
			parameters: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string' }, k: { type: 'number' } } },
			handler: async (ctx, args, mind) => {
				const found = await mind.memory.recall(args);
				return found.length > 0 ? listAnswer(found) : mind.memory.nothingMore(args);
			},
		},
		observe: {
			description: 'Evaluate a watch expression against the current world. Standing conditions belong in watches; a one-off question about now uses observe. Names only, no coordinates.',
			parameters: { type: 'object', additionalProperties: false, required: ['expr'], properties: { expr: { type: 'string' } } },
			offered: (mind) => !mind.setting('hideObserve'),
			handler: (ctx, args, mind) => mind.observe(args),
		},
	};
}

/** What a goal pass may write in `text`: only the verbs that edit goals and identity. */
const GOAL_VERBS = new VerbRegistry().addAll(STOCK_VERB_DEFS, 'set_goal', 'drop_goal', 'finish_goal', 'set_identity');

/** What a goal pass replies under `schema`: the whole goal list (empty to keep it), and an identity patch if one is due. */
const GOALS_SCHEMA:JsonSchema = {
	type: 'object',
	additionalProperties: false,
	required: ['goals'],
	properties: {
		goals: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['text'],
				properties: {
					text: { type: 'string' },
					priority: { type: 'number' },
				},
			},
		},
		identity: {
			type: 'object',
			additionalProperties: false,
			properties: {
				role: { type: 'string' },
				traits: { type: 'array', items: { type: 'string' } },
			},
		},
	},
};

/** Thinks in a row that only talk or wait before the next one is told to stop talking and act. */
const TALK_STREAK = 3;
/** Verbs that change nothing in the world. An arc of only these is talk. */
const TALK_VERBS = new Set(['say', 'wait', 'think', 'examine', 'remember']);
/** What a mind hears said to it, which a think under way may take in (`maxInterruptionsPerThink`): lines, and offers. */
const HEARD_KINDS = ['HeardSpeech', 'Offer'];
/** Thinks before the same tool call may be made again. */
const LOOKUP_REPEAT = 5;
/** The most characters of a `think`'s `about` the next think is told. */
const THINK_ABOUT_CAP = 200;
/** A prompt's hash with its elapsed times (`3s`, `running 12s`) left out: they tick on with nothing else changed. */
function promptHash(prompt:string):number {
	let hash = 0x811c9dc5;
	for (const char of prompt.replace(/\d+(\.\d+)?s\b/g, '#s')) {
		hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193);
	}
	return hash >>> 0;
}

/** What a mind's constructor hands the director that attaches it: the director's only way into its private fields. */
export type MindFields<TCtx> = {
	/** Wire it to the owner it thinks for. */
	attach(owner:MindOwner<TCtx>, deps:MindDeps<TCtx>):void;
	/** Let go of it: it thinks for no one, and may think for someone else later. */
	detach():void;
	/** Queue an event the library already keeps by id (a line talk delivers), as {@link Mind.pushEvent} queues a host's. */
	hold(event:HeldEvent):void;
	/** The context its tools and articles look from: `MindDeps.worldContext`, else its voice's. */
	worldContext():TCtx | undefined;
	/** Game time, for the events and memories it stamps. The director stamps every tick. */
	stamp(now:number):void;
	/** Its voice began an arc. */
	arcStarted(arc:Arc):void;
	/** Its voice's arc stopped or parked. */
	arcEnded():void;
	/** How one of its own laws went, for its next prompt to pin. */
	ingestLawResult(law:string, result:ArcResult):void;
	/**
	 * What its sight showed this think, each clause with the names of what it saw: its sightings to remember; and by id,
	 * what else the look found (`seen`): what should bring memories to mind, each thing's state and point, what is gone.
	 */
	sighted(clauses:readonly SightClause[], seen?:Sighted):void;
	/**
	 * Takes from `from` what character `id` knows of what that mind holds for the moment: its waiting events, recent
	 * lines and conversation. `from` keeps what others of its still know.
	 */
	adopt(from:Mind<TCtx>, id:string):void;
};

/**
 * Writes arcs: it thinks with the model about its owner's persona and what the owner's voice senses, and hands
 * each arc to that voice. It holds no story of its own, only its settings and thinking state, so it can be
 * swapped or dropped without losing who its owner is. A character owns at most one mind; a collective always
 * has one, shared by its characters.
 *
 * It thinks with one of its director's models (`getModel`), by the role in its settings' `model`, or
 * with the default model when it names none or that one is removed. It never changes a model's settings, and asks
 * its director on every think for the model as it is then (`MindDeps.thinksWith`). Each model caps its own parallel
 * thinks, and every memory is embedded with the director's one embedding model, so a Persona's memories stay comparable whatever
 * mind it moves to.
 */
export class Mind<TCtx = unknown> {
	/**
	 * Its own settings: its spec's `mind`, and whatever is set on it since; saved with it. What it leaves unset comes from
	 * its director's (`withMind`), else the library's. Read one with {@link setting}.
	 */
	public readonly settings:MindSettings;
	/** What its director gave it when it attached: its model, settings layer, senses, tools, queue and the rest. */
	private _deps:MindDeps<TCtx> = {
		thinksWith: () => {
			throw new Error('ArcDirector: this mind thinks for no one yet');
		},
	};
	private _owner:MindOwner<TCtx> | undefined;
	/** The owner's id, kept after a detach so a think still finishing can clean up after itself. */
	private _id = '';
	/** Who the think under way began for. */
	private _thinkingAs = '';
	/** Its laws' results since the last think, oldest first. */
	private _lawResults:LawLine[] = [];
	/** The last arc or think's result, as the next prompt shows it. */
	public lastResult:ArcResult | undefined;
	public lastArc:Arc | undefined;
	public lastTacticalTimestamp = Number.NEGATIVE_INFINITY;
	public lastStrategicTimestamp = 0;
	private _now = 0;
	private readonly _pendingEvents:HeldEvent[] = [];
	/** What it remembers and what was said: recent lines, the conversation, and its persona's long-term memory. */
	public readonly memory:MindMemory<TCtx>;
	/** What a tool asked to show with its answer (a picture of the map), for the next message. */
	private _shownNext:ChatContentPart[] | undefined;
	private _pendingAbout:string | undefined;
	/** Last accepted model reply, trimmed. A repeat of this is warned, not enacted. */
	private _lastEmit = '';
	private _emitStreak = 0;
	/** Accepted arcs in a row that only talked or waited. */
	private _talkStreak = 0;
	private _thinks = 0;
	/** Whom it named since its last think began, and in the think before: what its last prompt showed. */
	private _named = new Set<string>();
	private _lastNamed = new Set<string>();
	/** Its last asked prompt's hash, elapsed times left out, and whether the think under way was skipped for it. */
	private _lastPrompt:number | undefined;
	private _skipped = false;
	/** Where the think under way hands its reply's steps as they are written, while its voice enacts what it writes. */
	private _stream:ReturnType<ArcRunner['stream']> | undefined;
	/** Tool call (name and args) → the think it was last made on. */
	private readonly _calledOn = new Map<string, number>();
	/** Tools refused for a repeated call this think: offered no more until the next. */
	private readonly _refused = new Set<string>();
	/** Tool calls run, not refused as repeats: whether a round of lookups learned anything new. */
	private _toolRuns = 0;
	/** Set while it writes an Arc: takes a heard line that wakes it into the think under way, if it still may. */
	private _hearMidThink:((event:HeldEvent)=>boolean) | undefined;
	/** The lines the think under way took in so: each joins its next turn, and one it did not read for good wakes the next think. */
	private _heard:HeldEvent[] = [];

	constructor(settings:MindSettings = {}) {
		this.settings = { ...settings };
		this.memory = new MindMemory(this, { events: () => this._pendingEvents, isSelf: (id) => this.isSelf(id), ownKnowers: () => this.ownKnowers(), group: () => this.group(), controls: (id) => this.controls(id), embed: () => this._deps.embed, moodOf: (id) => this._deps.moodOf?.(id), stir: (id, levels) => this._deps.stir?.(id, levels),
			hasFallen: (id) => this._deps.hasFallen?.(id) ?? false,
			manner: (turn) => (this._deps.features ?? []).map((feature) => feature.manner(turn)).filter(Boolean).join(' ') });
		hand(this, {
			attach: (owner, deps) => {
				this._owner = owner;
				this._id = owner.id;
				this._deps = deps;
			},
			detach: () => {
				this._owner = undefined;
			},
			hold: (event) => this.hold(event),
			worldContext: () => this.worldContext(),
			stamp: (now) => {
				this._now = now;
			},
			arcStarted: (arc) => this._deps.queue?.beginArc(this.id, arc),
			arcEnded: () => this._deps.queue?.endArc(this.id),
			ingestLawResult: (law, result) => this.ingestLawResult(law, result),
			sighted: (clauses, seen) => this.memory.sighted(clauses, seen),
			adopt: (from, id) => this.adopt(from, id),
		} satisfies MindFields<TCtx>);
	}

	private worldContext():TCtx | undefined {
		return this._deps.worldContext ? this._deps.worldContext() : this.voice.context();
	}

	/** The model it thinks with now, as its director has it: the one its `model` setting names, else the default. */
	public get thinksWith():MindModel {
		return this._deps.thinksWith();
	}

	/** Setting `key` as this mind thinks with it: its own, else its director's, else the library's. */
	public setting<K extends keyof MindSettings>(key:K):Setting<K> {
		return (this.settings[key] ?? this._deps.defaults?.[key] ?? (MIND_DEFAULTS as MindSettings)[key]) as Setting<K>;
	}

	/** How this mind writes an Arc: its `arcFormat`, but never `text` for a model that writes only JSON ({@link MindModel.jsonOnly}). */
	public get arcFormat():ArcFormat {
		const format = this.setting('arcFormat');
		return format === 'text' && this.thinksWith.jsonOnly ? 'schema' : format;
	}

	/** The character or collective this mind thinks for. */
	public get owner():MindOwner<TCtx> {
		if (!this._owner) {
			throw new Error('ArcDirector: this mind thinks for no one yet');
		}
		return this._owner;
	}

	/** Whether this mind is attached to an owner. */
	public get attached():boolean {
		return this._owner !== undefined;
	}

	/** The owner's id. The think queue, chat thread and logs know a mind by it. */
	public get id():string {
		return this._id;
	}

	public get persona():Persona {
		return this.owner.persona;
	}

	/** The runner that enacts this mind's arcs: the character itself, or a collective's commander. */
	public get voice():ArcRunner<TCtx> {
		return this.owner.voice;
	}

	/** The game time it was last stamped with. */
	public get now():number {
		return this._now;
	}

	private senseAllowed(name:string):boolean {
		if (this.owner.kit === undefined) {
			return true;
		}
		const list = this.owner.currentKit.senses;
		if (list === undefined) {
			return true;
		}
		return list.includes(name);
	}

	private toolsAllowed():readonly string[] | undefined {
		if (this.owner.kit === undefined) {
			return undefined;
		}
		return this.owner.currentKit.tools;
	}

	private filterTools(tools:Record<string, ToolSpec<TCtx>>):Record<string, ToolSpec<TCtx>> {
		const list = this.toolsAllowed();
		if (list === undefined) {
			return tools;
		}
		const next:Record<string, ToolSpec<TCtx>> = {};
		for (const name of list) {
			if (tools[name]) {
				next[name] = tools[name];
			}
		}
		return next;
	}

	/**
	 * This mind's name for a character it is sampling now. Assigns one on first sight, and keeps whom it has seen; seen
	 * `faced`, from in front, it learns their look ({@link NameBook.name}).
	 */
	public seen(target:NameTarget, faced = true):string {
		this._named.add(target.id);
		return this.persona.names.name(target.id, this._deps.seenAs?.(target) ?? target.id, { seen: target.sighting !== undefined, faced, character: target.tags?.includes(RESERVED_TAGS.character) });
	}

	/**
	 * This mind's name for `id`: its vague label while it has one (not with `vague` off, as for what it remembers), else
	 * the name it gave. A character it never sampled gets the policy's answer for a bare id, unrecorded. A voice it reads
	 * before it heard it (a line its collective kept) gets a label of its own, never its person's name.
	 */
	public nameOf(id:string, vague = true):string {
		this._named.add(id);
		const person = personOf(id);
		if (person !== id && this.persona.names.peek(id) === undefined) {
			this.persona.names.labelVoice(person);
		}
		const base = this._deps.seenAs?.({ id: person }) ?? person;
		// Who knows whom is the game's (`withAcquaintance`): one it cannot tell goes by a stranger's label, never their name.
		return this.persona.names.peek(id, vague) ?? (this.persona.names.knowsByRule ? this.persona.names.name(person, base) : base);
	}

	/**
	 * Queue an event for the next think. It is kept in ids and read in this mind's names when that think starts. A major
	 * one wakes this mind, while it thinks for someone.
	 */
	public pushEvent(event:MindEvent):void {
		const text = namedText(event.text);
		const turn = event.turn && { ...event.turn, text: namedText(event.turn.text) };
		this.hold({ ...event, text, turn, who: event.who ?? [...new Set(idsIn(text))], knownBy: Array.isArray(event.knownBy) ? event.knownBy : this.thinksFor() });
	}

	/** Queues `event`, held by id, as {@link pushEvent} does. */
	private hold(event:HeldEvent):void {
		const pending = this._pendingEvents;
		const same = event.key === undefined ? -1 : pending.findIndex((e) => e.key === event.key);
		if (same >= 0) {
			pending.splice(same, 1);
		}
		const held = { ...event, timestamp: event.timestamp ?? this._now };
		pending.push(held);
		const kin = event.cap === undefined ? [] : pending.filter((e) => e.kind === event.kind);
		if (kin.length > event.cap!) {
			const least = kin.reduce((a, b) => ((b.weight ?? 0) < (a.weight ?? 0) ? b : a));
			pending.splice(pending.indexOf(least), 1);
		}
		if (event.major && this.attached && !(HEARD_KINDS.includes(event.kind) && this._hearMidThink?.(held))) {
			this._deps.queue?.enqueueMajor(this.id, false, event.kind);
		}
	}

	/** See {@link MindFields.adopt}. A waiting event it takes wakes it as it would have woken `from`. */
	private adopt(from:Mind<TCtx>, id:string):void {
		const { taken, left } = takeOut(from._pendingEvents, id);
		from._pendingEvents.splice(0, Infinity, ...left);
		taken.forEach((event) => this.hold(event));
		internalsOf(this.memory).adopt(from.memory, id);
	}

	/** The events waiting for the next think, as this mind reads them now. */
	public events():(MindEvent & { text:string })[] {
		return this._pendingEvents.map((e) => this.render(e));
	}

	/** `event` as this mind reads it now: its text and its `who` tags in its names. */
	private render(event:HeldEvent):MindEvent & { text:string } {
		const { who, turn, ...rest } = event;
		const text = showInPerson(event.text, (id) => this.isSelf(id), (id) => this.nameOf(id));
		return { ...rest, ...turn ? { turn: { ...turn, text: namingText(turn.text) } } : {}, text, tags: who.length ? mergeTags(event.tags, who.map((id) => this.nameOf(id))) : event.tags };
	}

	/** Who knows what only this mind did or decided: its voice, which writes its notes, then its owner (one id for a character's own mind). */
	private ownKnowers():string[] {
		return [...new Set([this.thinkThread(), this.id])];
	}

	/** The collective it thinks for, whose words for itself (`we`, `our`) its notes keep as its id. */
	private group():string | undefined {
		return this._owner?.characters ? this.id : undefined;
	}

	/** Every character it thinks for now: a collective's characters but those thinking for themselves, else its owner. */
	public thinksFor():string[] {
		const ids = (this._owner?.characters ?? []).filter((c) => !c.thinksForItself).map((c) => c.id);
		return ids.length > 0 ? ids : [this.id];
	}

	/** Whether `id` is this mind's own: its owner, or the character that speaks for it. */
	private isSelf(id:string):boolean {
		const person = personOf(id);
		return person === this.id || person === this.thinkThread();
	}

	/** Whether this mind acts for `id`: itself, its voice, or one of a collective's characters. */
	private controls(id:string):boolean {
		if (this.isSelf(id)) {
			return true;
		}
		return this._owner?.characters?.some((c) => c.id === id) ?? false;
	}

	/** Unabsorbed speech meant for this mind: to it, naming it, or to everyone. Overheard talk does not count. */
	public hasHeard():boolean {
		return this._pendingEvents.some((e) => e.kind === 'HeardSpeech' && e.major);
	}

	private capturePrevMe():void {
		const me = this.voice.catalog?.()?.me;
		if (me) {
			this.voice.prevMe = cloneEntity(me);
		}
	}

	/** The result of the arc this mind gave its voice, or of a failed think. The next prompt shows it. */
	public ingestResult(result:ArcResult, wake = true):void {
		this.lastResult = result;
		const walk = result.verb === 'go_to' ? ['go_to'] : [];
		if (result.status === 'stopped') {
			this.hold({
				kind: 'Stopped',
				text: resultLine(result) ?? ['stopped'],
				tags: ['stopped', ...walk],
				who: [],
				knownBy: this.ownKnowers(),
			});
		}
		else {
			// What happened in the world is worth keeping; how its own think went (a bad reply) is not, nor a way
			// found blocked: that holds only until the way opens, and talk asks the live world for it. Nor who
			// heard a line: the line is in the conversation already.
			// A walk or a line stays off the recent lines: the next prompt still has this result once, as Last verb result.
			const said = result.verb === 'say' ? ['said'] : [];
			this.hold({
				kind: 'arc_result',
				text: resultLine(result) ?? [result.status === 'ok' ? 'ok' : 'failed'],
				tags: [result.status === 'ok' ? 'ok' : 'fail', ...walk, ...said],
				remember: result.verb !== 'think' && result.verb !== 'say' && !result.unreachable,
				who: [],
				knownBy: this.ownKnowers(),
				...result.restsOn ? { restsOn: result.restsOn } : {},
			});
		}
		if (wake) {
			this.syncQueue(result);
		}
	}

	/**
	 * How one of its own laws went: a line its next think reads among its pinned memories, newest kept up to
	 * `lawResults`, the same line again counted (`×3`). A line goes to long-term memory, where `recall` finds it, once
	 * a think has read it or a newer one pushed it out. Not its own arc's result: that line and short-term memory are
	 * for what it chose.
	 */
	private ingestLawResult(law:string, result:ArcResult):void {
		const outcome = result.status === 'ok' ? 'ran' : result.status;
		const text = joinTextWithIDs(`Law ${law} ${outcome}`, result.reason ? joinTextWithIDs(': ', resultLine(result)!) : '');
		const i = this._lawResults.findIndex((line) => showTextWithIDs(line.text) === showTextWithIDs(text));
		const lines = [...this._lawResults.filter((line, j) => j !== i), { text, times: i < 0 ? 1 : this._lawResults[i].times + 1 }];
		const keep = Math.max(0, this.setting('lawResults'));
		this.rememberLaws(lines.slice(0, Math.max(0, lines.length - keep)));
		this._lawResults = lines.slice(lines.length - keep);
	}

	/** Law results no prompt pins any more, as long-term memories. */
	private rememberLaws(lines:readonly LawLine[]):void {
		for (const line of lines) {
			internalsOf(this.persona.memory).add({ category: 'episodic', text: lawText(line), knownBy: this.ownKnowers(), tags: ['law'], timestamp: this._now }, this._now);
		}
	}

	/**
	 * Drops the names its book holds for anyone nothing it still uses names: its memories, conversation, what it heard,
	 * goals, watches, laws, sight focus, the program it runs, and its last prompt (sight, earshot, roster). Every
	 * `forgetEvery` thinks ({@link forgetFaded}), and before its persona is saved. See {@link NameBook.prune} for what stays anyway.
	 */
	public pruneNames():void {
		const used = new Set([...this.memory.ids(), ...this._named, ...this._lastNamed]);
		const note = (word:string):string => {
			used.add(word);
			return word;
		};
		for (const event of this._pendingEvents) {
			idsIn(event.text).forEach(note);
		}
		const persona = this.persona;
		// Goals are in its words: whom they name by a name it gave.
		for (const goal of persona.goals) {
			goal.text.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (word) => note(persona.names.idOf(word) ?? word));
		}
		for (const expr of [...Object.values(persona.watches), ...Object.values(persona.pinnedWatches), ...persona.sightFocus, ...persona.pinnedSightFocus]) {
			mapExpr(expr, note);
		}
		const verbs = this.voice.verbs;
		for (const law of this._owner?.laws ?? []) {
			[law.who, law.watch, law.until ?? ''].forEach((expr) => mapExpr(expr, note));
			mapArc(law.arc, verbs, note);
		}
		for (const arc of [this.voice.programState()?.arc, this.lastArc]) {
			if (arc) {
				mapArc(arc, verbs, note);
			}
		}
		// A voice it knows reads as its person: that name is in use too.
		[...used].forEach((id) => used.add(personOf(id)));
		persona.names.prune(used);
	}

	/**
	 * What sleep does: its persona forgets what has faded and folds memories told the same way into one
	 * (`MemoryStore.forgetFaded`), then its name book drops whom nothing names any more ({@link pruneNames}). Call it as its
	 * character falls asleep, or `director.forgetFaded()` for everyone; every mind does it every `forgetEvery` thinks too.
	 */
	public forgetFaded():void {
		this.persona.memory.forgetFaded(this._now);
		this.pruneNames();
	}

	/**
	 * It forgets what rests on `fact` (`RestsOn`), now that it is so no more: the events it has yet to think over, its last
	 * result, its recent lines and its memories (`you do not know which one is Bram yet`, once it can tell Bram).
	 */
	public forgetRestingOn(fact:RestsOn):void {
		this._pendingEvents.splice(0, Infinity, ...this._pendingEvents.filter((event) => !restsOnFact(event, fact)));
		if (this.lastResult && restsOnFact(this.lastResult, fact)) {
			this.lastResult = undefined;
		}
		internalsOf(this.memory).forgetRestingOn(fact);
	}

	/** The voice's id: the character that acts and speaks for this mind, or the collective's own id while it has no commander. */
	public thinkThread():string {
		return this._owner?.voice.id ?? this._id;
	}

	/** Cancel this mind's in-flight think. */
	public abortThink():void {
		this._deps.queue?.abortThink(this.id);
	}

	/**
	 * One tactical think, ignoring `minThinkInterval`, ahead of every think waiting for its model. Occupies the think slot so a
	 * queued tick cannot start another. `enact` defaults to `autoEnact`. `now` is game time.
	 */
	public async thinkNow(opts:{ now?:number; about?:string; enact?:boolean } = {}):Promise<Arc | null> {
		if (opts.now !== undefined) {
			this._now = opts.now;
		}
		this.catchUp();
		if (opts.about !== undefined) {
			const about = opts.about.replace(/\s+/g, ' ').trim();
			this._pendingAbout = about.length > 0 ? about : undefined;
		}
		this.abortThink();
		return this.withThinkSlot(opts.enact ?? (this._deps.autoEnact ?? true), URGENT, 'forced', (chat) => this.tactical(chat));
	}

	/** Before a think: its kit as it is now, what features tell it first (what it hears), and what it was told since. */
	private catchUp():void {
		this.owner.refreshKit();
		this._deps.features?.forEach((feature) => feature.thinkStarts(this));
		internalsOf(this.memory).absorb();
	}

	/**
	 * A think if one is due, once its model has a slot for it, `priority` (0–1) ranking it among those waiting. `why`, what
	 * called for it, goes to its watcher with the think's start.
	 */
	public async tick(gameTime:number, priority = 0, why?:string):Promise<Arc | null> {
		this._now = gameTime;
		this.catchUp();
		const strategic = this.strategicDue(gameTime);
		const tactical = this.tacticalDue(gameTime);
		if (!strategic && !tactical) {
			return null;
		}
		return this.withThinkSlot((this._deps.autoEnact ?? true), priority, why, async (chat, signal) => {
			if (strategic) {
				await this.reviseGoals(chat);
				this.lastStrategicTimestamp = gameTime;
			}
			if (!tactical || signal?.aborted) {
				return null;
			}
			return this.tactical(chat, true);
		});
	}

	private async withThinkSlot(enact:boolean, priority:number, why:string | undefined, body:(chat:ModelChat, signal:AbortSignal | undefined)=>Promise<Arc | null>):Promise<Arc | null> {
		const signal = this._deps.queue?.beginThink(this.id);
		let arc:Arc | null = null;
		let error:string | undefined;
		let started = false;
		this._thinkingAs = this.thinkThread();
		this._stream = enact && this.voice.execute ? this.voice.stream() : undefined;
		const heard:HeldEvent[] = [];
		this._heard = heard;
		// What the stream has not run is enacted once the reply is whole; a think that fails keeps what it began.
		const ended = (whole:Arc):Arc | Promise<ArcResult> => {
			const stream = this._stream;
			this._stream = undefined;
			return stream ? stream.finish(whole) : whole;
		};
		try {
			// One lease for the whole think: its reply, tool rounds, repairs and checks.
			arc = await this.thinksWith.run(priority, (chat) => {
				started = true;
				this.showThink({ kind: 'start', ...why ? { why } : {} });
				return body(chat, signal);
			}, signal);
			if (signal?.aborted || !arc) {
				ended([]);
				return null;
			}
			this._pendingAbout = undefined;
			this.lastArc = arc;
			this._deps.onChoose?.(arc);
			this.lastTacticalTimestamp = this._now;
			this.capturePrevMe();
			// Only what this think read. Events that came in while the model answered (a gift, a reply) wait for the next one.
			const unread = this._pendingEvents.filter((event) => !internalsOf(this.memory).absorbed(event));
			this._pendingEvents.splice(0, Infinity, ...unread);
			internalsOf(this.memory).commitSeen();
		}
		catch (err) {
			ended([]);
			if (signal?.aborted) {
				return null;
			}
			this.lastTacticalTimestamp = this._now;
			this.capturePrevMe();
			error = err instanceof Error ? err.message : String(err);
			throw err;
		}
		finally {
			this._deps.queue?.endThink(this.id, signal);
			if (this._heard === heard) {
				this._hearMidThink = undefined;
			}
			// A line it took in that it did not read for good (it failed, or ended before the line joined it) wakes the next think.
			const unread = heard.find((event) => this._pendingEvents.includes(event));
			if (unread && !signal?.aborted) {
				this._deps.queue?.enqueueMajor(this.id, false, unread.kind);
			}
			if (started) {
				this.showThink({ kind: 'end', arc: signal?.aborted ? undefined : arc ?? undefined, error, ...this._skipped ? { skipped: true } : {} });
				this._skipped = false;
				this.memory.thought();
			}
		}
		if (signal?.aborted) {
			return null;
		}
		const rest = ended(arc);
		if (!Array.isArray(rest)) {
			await rest;
		}
		else if (rest.length > 0 && enact && this.voice.execute) {
			const instead = insteadOf(rest);
			await this.voice.enact(instead ?? rest, undefined, undefined, instead ? 'replace' : 'append');
		}
		return arc;
	}

	/**
	 * Hands each finished root step of a reply to the think's stream as it is written (short of one that never ends,
	 * `ReplyReader.soFar`), those its checks pass; one that
	 * fails is turned down where it stands (the slate's red shake), and the steps before it run on. Only the first turn
	 * that writes steps feeds it: a repair's reply is merged at the end, as any reply is. A reply a feature would send
	 * back (`replyCheck`: a way still blocked) stops feeding it, and its end decides, as without a stream. `fed` holds
	 * the steps handed over: they run on whatever comes of the rest.
	 */
	private feeder(reader:ReplyReader, format:ArcFormat, fed:Arc):(turn:number, text:string)=>void {
		let owner:number | undefined;
		const verdicts:boolean[] = [];
		return (turn, text) => {
			const stream = this._stream;
			if (!stream || (owner !== undefined && owner !== turn)) {
				return;
			}
			const sendsBack = (arc:Arc):boolean => (this._deps.features ?? []).some((feature) => feature.replyCheck(this, arc, format));
			const steps = reader.soFar(text, format);
			if (steps.length === 0) {
				return;
			}
			owner = turn;
			const good:Arc = [];
			steps.forEach((step, j) => {
				if (verdicts[j] === undefined) {
					const problem = reader.problem([...good, step]);
					verdicts[j] = !problem;
					if (problem) {
						this.showThink({ kind: 'retry', reason: problem.message });
					}
				}
				if (verdicts[j]) {
					good.push(step);
				}
			});
			if (sendsBack(good)) {
				owner = -1;
				return;
			}
			stream.update(good);
			fed.splice(0, fed.length, ...good);
		};
	}

	public toJSON():MindJSON {
		return {
			settings: { ...this.settings },
			events: this._pendingEvents.map((e) => ({ ...e, tags: e.tags ? [...e.tags] : undefined })),
			lastArc: this.lastArc,
			lastResult: this.lastResult && resultToJSON(this.lastResult),
			lastTacticalTimestamp: Number.isFinite(this.lastTacticalTimestamp) ? this.lastTacticalTimestamp : undefined,
			lastStrategicTimestamp: Number.isFinite(this.lastStrategicTimestamp) ? this.lastStrategicTimestamp : undefined,
			...this.memory.toJSON(),
			thinkAbout: this._pendingAbout,
		};
	}

	/** A saved mind, not yet attached to anyone. */
	public static fromJSON<TCtx>(json:MindJSON):Mind<TCtx> {
		const mind = new Mind<TCtx>(json.settings);
		mind.lastArc = isArc(json.lastArc) ? json.lastArc : undefined;
		mind.lastResult = json.lastResult && resultFromJSON(json.lastResult);
		mind.lastTacticalTimestamp = json.lastTacticalTimestamp ?? Number.NEGATIVE_INFINITY;
		mind.lastStrategicTimestamp = json.lastStrategicTimestamp ?? 0;
		mind._pendingEvents.push(...(json.events ?? []).map(({ text, turn, ...e }) => ({ ...e, text: readTextWithIDs(text), ...turn ? { turn: { ...turn, text: readTextWithIDs(turn.text) } } : {} })));
		mind.memory.load(json);
		mind._pendingAbout = json.thinkAbout;
		return mind;
	}

	private tacticalDue(gameTime:number):boolean {
		if (!Number.isFinite(this.lastTacticalTimestamp)) {
			return true;
		}
		if (this.lastResult?.status === 'stopped') {
			return true;
		}
		if (this._pendingEvents.some((e) => e.major)) {
			return true;
		}
		if (this.setting('minThinkInterval') <= 0) {
			return true;
		}
		return gameTime - this.lastTacticalTimestamp >= this.setting('minThinkInterval');
	}

	private strategicDue(gameTime:number):boolean {
		if (this.setting('skipStrategic')) {
			return false;
		}
		if (this._pendingEvents.some((e) => e.major)) {
			return true;
		}
		if (this.setting('strategicInterval') <= 0) {
			return false;
		}
		if (!Number.isFinite(this.lastStrategicTimestamp)) {
			return false;
		}
		return gameTime - this.lastStrategicTimestamp >= this.setting('strategicInterval');
	}

	/** One strategic pass: the model revises goals and identity, in the form this mind writes (`arcFormat`). A reply that does not read changes nothing. */
	private async reviseGoals(chat:ModelChat):Promise<void> {
		const format = this.arcFormat;
		const system = stablePrefix(this.id, this.persona.identity, this.owner.activeVerbs(), {
			includeWatches: true,
			omitArc: true,
			systemNote: this.setting('systemNote'),
			style: this.thinksWith.promptStyle,
		});
		const user = `${volatileBlock({
			goals: this.persona.goals,
			pinned: this.memory.pinned(),
			...this.memory.lines('', this._pendingAbout),
			compact: this.compact,
		})}\n\n${reviseGoalsAsk(format, this.persona.maxGoals)}`;
		const ask = (messages:ChatMessage[], thinking?:boolean):Promise<ChatResponse> => chat({
			thread: this.id,
			messages,
			responseFormat: format === 'schema' ? { name: 'goals', schema: GOALS_SCHEMA, strict: true } : undefined,
			enableThinking: thinking,
		});
		const asked:ChatMessage[] = [
			{ role: 'system', content: system },
			{ role: 'user', content: user },
		];
		let res = await ask(asked);
		// The thinking budget cut the thought short: answer from it, without thinking again.
		if (res.truncated && !res.content && res.reasoning) {
			res = await ask([...asked, { role: 'assistant', content: res.reasoning }, { role: 'user', content: thoughtCutHint(format, 'goals') }], false);
		}
		if (!res.content) {
			return;
		}
		try {
			if (format === 'text') {
				for (const step of arcSteps(parseArcText(res.content, GOAL_VERBS))) {
					this.editPersona(step, this.voice);
				}
				return;
			}
			const raw = extractJson(res.content);
			if (!isRecord(raw) || (!Array.isArray(raw.goals) && raw.identity === undefined)) {
				return;
			}
			if (raw.identity !== undefined) {
				this.persona.applyIdentityPatch(raw.identity, this._now);
			}
			if (Array.isArray(raw.goals)) {
				this.persona.applyGoalList(raw.goals);
			}
		}
		catch {
			return;
		}
	}

	/** The owner's own block, or the laws and what features add after them. */
	private extraVolatile(parts:PromptPart):string {
		const section = this.owner.promptSection?.(this);
		if (section !== undefined) {
			return section;
		}
		return [this.lawsSection(), parts.section].filter(Boolean).join('\n\n');
	}

	/** What every feature puts in this think's prompt, each part joined across them. */
	private promptParts():PromptPart {
		const parts:PromptPart = {};
		const join = (a:string | undefined, b:string | undefined, by:string):string | undefined => [a, b].filter(Boolean).join(by) || a || b;
		for (const part of (this._deps.features ?? []).map((feature) => feature.promptPart(this))) {
			parts.feeling = join(parts.feeling, part?.feeling, '\n');
			parts.mentioned = join(parts.mentioned, part?.mentioned, '\n');
			parts.lastResultArticles = join(parts.lastResultArticles, part?.lastResultArticles, '\n');
			parts.offers = join(parts.offers, part?.offers, '\n');
			parts.section = join(parts.section, part?.section, '\n\n');
			parts.youSymbol = part?.youSymbol ?? parts.youSymbol;
			parts.recallKnows ||= part?.recallKnows;
		}
		return parts;
	}

	/** Content a tool shows with its answer, a picture above all: the next message carries it. */
	public showNext(content:ChatContentPart[]):void {
		this._shownNext = [...this._shownNext ?? [], ...content];
	}

	/**
	 * The program its own body runs now, for a mind that is no commander (a commander's roster shows its units'), and the
	 * reply that keeps it: `pass()` is free, so it runs beside the program instead of replacing it. So does a reply of only
	 * a line, shown as `say`: a mind that sees its program written out otherwise copies it back and never talks. `beside`:
	 * the other free verbs the block names, those of {@link BESIDE_VERBS} its kit has, so it names none the mind lacks.
	 */
	private ownProgram():{ steps:string; keep:string; say?:string; beside:readonly string[]; instead?:string } | undefined {
		const voice = this.voice;
		const state = voice.programState();
		if (this.owner.promptSection || !state?.running || !voice.activeVerbs().has(PASS_VERB)) {
			return undefined;
		}
		// A marker on each step it is on (each with its channel, of `A while B`), or a `when`'s over the program's it holds.
		const moving = state.marks.filter((mark) => !mark.heldBy);
		const marks = new Map<number, string>();
		for (const mark of moving.length > 0 ? moving : state.marks) {
			const { at } = this.programLines(state.arc, mark.step, voice.verbs);
			const note = mark.heldBy ? `⏸ while ${this.holderText(mark.heldBy)} runs` : `← now, ${mark.seconds}s${mark.channel ? `, ${mark.channel}` : ''}`;
			if (at >= 0) {
				marks.set(at, marks.has(at) ? `${marks.get(at)}; ${note}` : note);
			}
		}
		const { lines } = this.programLines(state.arc, undefined, voice.verbs);
		const file = { path: 'program.arc', who: '', lines, marks, running: true, seconds: state.seconds, endings: [] };
		const active = voice.activeVerbs();
		const instead = active.has(INSTEAD_VERB) && active.has('go_to') ? this.shownSteps([{ verb: INSTEAD_VERB, args: { arc: [{ verb: 'go_to', args: { target: 'Gate' } }] } }], voice.verbs, this.arcFormat) : undefined;
		// Arc text would write the `…` bare, as a name.
		const say = !isFree(active, 'say') ? undefined : this.arcFormat === 'text' ? 'say("…")' : this.shownSteps([{ verb: 'say', args: { text: '…' } }], voice.verbs, this.arcFormat);
		const beside = BESIDE_VERBS.filter((verb) => isFree(active, verb));
		return { steps: programFiles([file]), keep: this.shownSteps([{ verb: PASS_VERB, args: {} }], voice.verbs, this.arcFormat), ...say ? { say } : {}, beside, ...instead ? { instead } : {} };
	}

	/** What holds a program's step, in this mind's names: `law flee`, `when isHurt(me)`. */
	public holderText(holder:Holder):string {
		return 'law' in holder ? `law ${mapLawName(holder.law, namesOf(this.persona.names))}` : `when ${this.named(holder.when)}`;
	}

	/**
	 * `arc` as this mind writes it, a line a step, and the line `step` is on (-1: none). The step is found by where it
	 * sits in `arc`'s tree (the very object, at any depth: a loop's body, a branch, a choice), not by its text, so a
	 * step written twice marks the one running.
	 */
	public programLines(arc:Arc, step:Step | undefined, verbs:VerbRegistry):{ lines:string[]; at:number } {
		const format = this.arcFormat;
		const lines = this.shownSteps(arc, verbs, format).split('\n');
		const marked = step && markStep(arc, step);
		return { lines, at: marked ? this.shownSteps(marked, verbs, format).split('\n').findIndex((line) => line.includes(STEP_MARK)) : -1 };
	}

	/** A stored expression in this mind's names. */
	public named(expr:string):string {
		return mapExpr(expr, namesOf(this.persona.names));
	}

	/** A stored arc in this mind's names, as text. */
	public namedArc(arc:Arc):string {
		const verbs = this.owner.verbs.nested();
		return formatArc(mapArc(arc, verbs, namesOf(this.persona.names)), verbs);
	}

	/** Whether this mind's model is told only what its game makes its own: see {@link PromptStyle}. */
	public get compact():boolean {
		return this.thinksWith.promptStyle === 'compact';
	}

	/**
	 * The owner's laws in list order, as this mind's model reads them: sentences, not arcs, so a small model does
	 * not copy them back as its reply. `running`: by law name, who runs it now and at what step (`for Tom: flee(Wolf)`).
	 */
	public lawsSection(running:ReadonlyMap<string, string> = new Map()):string {
		const laws = this.owner.laws;
		if (laws.length === 0) {
			return '';
		}
		const line = (law:Law):string => {
			const who = this.owner.lawsTakeWho() && law.who !== 'me' ? ` (for ${this.named(law.who)})` : '';
			const times = law.times === undefined ? '' : `, times=${law.times}`;
			const until = law.until ? `, until ${this.named(law.until)}` : '';
			const name = mapLawName(law.name, namesOf(this.persona.names));
			const group = lawGroup(name);
			const label = group ? `${name.slice(group.length + 1)}, ${group}'s own` : name;
			const now = running.has(law.name) ? `; running ${running.get(law.name)}` : '';
			// A sentence, never `name: arc`: a model copies what reads as Arc text back into its reply, `Tom.` included.
			return `- ${label}${who}: when ${this.named(law.watch)}, it runs ${this.namedArc(law.arc)}${times}${until}${now}`;
		};
		// One of a character's own goes by its whole name: say so, with a real one, only where there is one.
		const owned = laws.map((law) => mapLawName(law.name, namesOf(this.persona.names))).find((name) => lawGroup(name));
		const unlaw = owned ? `unlaw(name) drops one, unlaw(${owned}) ${lawGroup(owned)}'s own` : 'unlaw(name) drops one';
		const intro = this.compact ? 'Laws:' : `Laws (emergencies that already run on their own, first listed first; do not repeat them in your reply; ${unlaw}):`;
		return `${intro}\n${laws.map(line).join('\n')}`;
	}

	private gatherSensed():Record<string, unknown> {
		const ctx = this.voice.context();
		const sensed:Record<string, unknown> = {};
		for (const [name, sense] of Object.entries(this._deps.senses ?? {})) {
			if (!this.senseAllowed(name)) {
				continue;
			}
			try {
				const value = sense(ctx as TCtx, this);
				if (value !== undefined) {
					sensed[name] = value;
				}
			}
			catch {
				continue;
			}
		}
		return sensed;
	}

	/** Its prompt's changing part, and what every feature puts in this think's prompt, asked once what came back stirred it. */
	private async volatileUser(sensed:Record<string, unknown>, extra?:string):Promise<{ user:string; parts:PromptPart }> {
		const perceptionText = Object.values(sensed)
			.map((v) => typeof v === 'string' ? v : JSON.stringify(v))
			.join('\n');
		const meaning = await this.memory.meanings(perceptionText, this._pendingAbout);
		const intrusions = this.memory.intrude(perceptionText, this._pendingEvents.flatMap((e) => mergeTags(e.tags, e.who)), meaning.seen, meaning.lens);
		const parts = this.promptParts();
		const changes = this.memory.noteSeen();
		const { recalled, ...lines } = this.memory.lines(perceptionText, this._pendingAbout, meaning.recalled, meaning.lens);
		// Its last result is said once, as Last verb result, not again among the recent lines.
		const last = this.lastResult && resultLine(this.lastResult);
		const lastLine = last && showTextWithIDs(last, (id) => this.nameOf(id)).trim();
		lines.recent = lines.recent.filter((line) => line.trim() !== lastLine);
		const user = [extra, volatileBlock({
			feeling: parts.feeling,
			senses: sensed,
			intrusions,
			changes,
			lastResult: this.lastResult && { ...this.lastResult, reason: this.lastResult.reason && showNamingText(this.lastResult.reason, (id) => this.nameOf(id)) },
			lastResultArticles: parts.lastResultArticles,
			goals: this.persona.goals,
			pinned: [...this.memory.pinned(), ...this._lawResults.map((line) => ({ text: showTextWithIDs(lawText(line), (id) => this.nameOf(id)) }))],
			recalled,
			watches: this.namedWatches(this.persona.watches),
			pinnedWatches: this.namedWatches(this.persona.pinnedWatches),
			watchesWritable: this.owner.activeVerbs().has('watch'),
			pinnedSightFocus: this.persona.pinnedSightFocus.map((e) => this.named(e)),
			sightFocus: this.persona.sightFocus.map((e) => this.named(e)),
			sightFocusWritable: this.owner.activeVerbs().has('focus'),
			...lines,
			mentioned: parts.mentioned,
			offers: parts.offers,
			thinkAbout: this._pendingAbout,
			program: this.ownProgram(),
			compact: this.compact,
		}), this.extraVolatile(parts), thinkLine(this.thinksWith.thinking, this.setting('thinkInstructions'), this.compact)].filter(Boolean).join('\n\n');
		return { user, parts };
	}

	private namedWatches(watches:Watches):Watches {
		return Object.fromEntries(Object.entries(watches).map(([name, expr]) => [name, this.named(expr)]));
	}

	/** How its replies are read with `verbs`: against its voice's world, in its names, checked as its settings say. */
	private reader(verbs:VerbRegistry):ReplyReader {
		return new ReplyReader({
			verbs,
			catalog: () => this.voice.catalog?.(),
			ids: idsOf(this.persona.names),
			minChoices: this.setting('minChoices'),
			explicitThinkAllowedInside: this.setting('explicitThinkAllowedInside'),
			repairs: this.setting('repairRetries') > 0,
			problem: this._deps.arcProblem,
		});
	}

	/** Steps as the model writes them, in its names. */
	public shownSteps(arc:Arc, verbs:VerbRegistry, format:ArcFormat):string {
		const named = mapArc(arc, verbs, namesOf(this.persona.names));
		return format === 'text' ? formatArcBlocks(named, verbs) : arcJSONBlocks(named, verbs);
	}

	private async tactical(chat:ModelChat, rethink = false):Promise<Arc | null> {
		const kept:Arc = [];
		try {
			return await this.writeArc(kept, chat, rethink);
		}
		catch (err) {
			// Out of tries with some of it good: what is good runs, and the next think is told what did not.
			if (kept.length === 0 || !(err instanceof ArcError)) {
				throw err;
			}
			// What did not run, never what was written there: any other refusal is the rest of the reply.
			const parts = err instanceof RejectedParts ? err : new RejectedParts([restOfReply(err)]);
			this.pushEvent({ kind: 'dropped', text: `Part of your last reply did not run: ${parts.note}.`, knownBy: this.ownKnowers(), tags: ['fail'] });
			return kept;
		}
	}

	/** Asks the model until it has an Arc. `kept` collects the steps of a reply that stand while others go back. */
	private async writeArc(kept:Arc, chat:ModelChat, rethink = false):Promise<Arc | null> {
		this._thinks += 1;
		const every = this.setting('forgetEvery');
		if (every > 0 && this._thinks % every === 0) {
			this.forgetFaded();
		}
		this._lastNamed = this._named;
		this._named = new Set();
		this._refused.clear();
		const ctx = this.worldContext();
		this.owner.refreshKit();
		// A repeat after new input (speech, an interruption, a nudge) can be right; without any, the model is stuck.
		const freshInput = this.hasFreshInput();
		const sensed = this.gatherSensed();
		// Talking in circles: characters who hear each other keep answering, so a streak of talk ends in a deed.
		const { user, parts } = await this.volatileUser(sensed, this._talkStreak >= TALK_STREAK
			? `You have only talked or waited for ${this._talkStreak} thinks. Stop talking: take the next step toward your goal with a verb that does something. Look up what you lack with a tool instead of asking again.`
			: undefined);
		const verbs = this.owner.activeVerbs();
		const format = this.arcFormat;
		let reply = this.replyFormat(verbs, format);
		// What a think may look up; under a schema the model calls it in its reply, so none are sent as native tools.
		const offered = this.setting('toolRounds') > 0 ? this.toolDefs() : [];
		const tools = reply ? [] : offered;
		const toolNames = offered.map((t) => t.name);
		const reader = this.reader(verbs);
		// What the stream began runs on whatever comes of the rest: it stays in the Arc, and only the rest is judged and goes back.
		const fed:Arc = [];
		const feed = this.feeder(reader, format, fed);
		const system = stablePrefix(this.id, this.persona.identity, this.owner.promptVerbs?.() ?? verbs, {
			includeWatches: this.persona.watchesWritable || watchCount(this.persona.watchList()) > 0,
			watchesWritable: verbs.has('watch'),
			canObserve: toolNames.includes('observe'),
			canSeeMap: toolNames.includes('see_map'),
			canRecallKnowledge: toolNames.includes('recall') && !!parts.recallKnows,
			youSymbol: parts.youSymbol ?? DEFAULT_YOU_SYMBOL,
			arcFormat: this.arcFormat,
			verbInstructions: this.setting('verbInstructions'),
			arcExample: this.setting('arcExample'),
			systemNote: this.setting('systemNote'),
			currency: this.setting('currency'),
			minChoices: this.setting('minChoices'),
			explicitThinkAllowedInside: this.setting('explicitThinkAllowedInside'),
			tools: toolNames,
			toolArgs: toolFirstArgs(offered),
			style: this.thinksWith.promptStyle,
		});
		// This think has read its laws' results: from now on they are only remembered.
		this.rememberLaws(this._lawResults);
		this._lawResults = [];
		this.persona.memory.agePins();
		const messages:ChatMessage[] = [
			{ role: 'system', content: system },
			{ role: 'user', content: user },
		];
		// Nothing new since its last think: on a rethink, the same prompt (elapsed times aside) is not asked again.
		const asked = promptHash(`${system}\n${user}`);
		if (rethink && asked === this._lastPrompt && !this.setting('thinkUnchanged')) {
			this._skipped = true;
			this.lastTacticalTimestamp = this._now;
			return null;
		}
		this._lastPrompt = asked;
		let toolsLeft = offered.length > 0 ? this.setting('toolRounds') : 0;
		let repairsLeft = this.setting('repairRetries');
		// What it was told stands needs no second go.
		const keep = (steps:Arc):void => {
			kept.push(...steps.filter((step) => !kept.some((had) => sameProgram([had], [step]))));
		};
		/**
		 * Runs `calls` in turn and spends their round: a whole one, or half for one of only lookups this think already made,
		 * told so, which a small model may make again and again. Their answers, and whether that round was the last.
		 */
		const lookUpAll = async (calls:readonly { name:string; args:string }[]):Promise<{ answers:string[]; last:boolean }> => {
			keep(fed);
			const ran = this._toolRuns;
			const answers:string[] = [];
			for (const call of calls) {
				answers.push(await this.lookUp(call.name, call.args, ctx, chat));
			}
			toolsLeft -= this._toolRuns > ran ? 1 : 0.5;
			return { answers, last: toolsLeft <= 0 };
		};
		let sentBack = false;
		/** Shows the model only what stands, and says in words what became of the rest. Throws when it has no tries left. */
		const sendBack = (failed:Rejected[], reply:string):void => {
			if (repairsLeft <= 0) {
				throw new RejectedParts(failed);
			}
			repairsLeft -= 1;
			sentBack = true;
			const lines = failed.map((part) => ({ label: partLabel(part), reason: part.reason, line: format === 'text' ? failedPart(reply, part.at) : '' }));
			retry(partsText(failed), this.shownSteps(kept, verbs, format), partRepairHint(lines, verbs, format, fed.length > 0));
		};
		let warnedRepeat = freshInput;
		let checksLeft = Math.max(1, this.setting('repairRetries'));
		let lastErr:Error | null = null;
		/** Sends `err` back to be written again; throws it when no repairs are left. */
		const repair = (err:Error, res:Pick<ChatResponse, 'content' | 'toolCalls'> = { content: null, toolCalls: [] }):void => {
			lastErr = err;
			if (repairsLeft <= 0) {
				throw err;
			}
			repairsLeft -= 1;
			// The bad reply itself is left out: a small model shown its own broken reply writes it again, word for word.
			const called = res.toolCalls.map((call) => call.name);
			const line = format === 'text' ? faultLine(res.content, err instanceof ArcError ? err.at : undefined) : '';
			const hint = arcRepairHint(err.message, format, toolsLeft > 0 ? toolNames.filter((name) => !this._refused.has(name)) : [], this.owner.activeVerbs(), line, this.owner.voice.embodied);
			retry(err.message, called.length > 0 ? `(tool call: ${called.join(', ')})` : null, hint);
		};
		const heard = this._heard;
		/**
		 * One more turn: its own turn so far (`said`, any tool answers after it), then one message with `hint`, the lines it
		 * heard since its last turn, `then`, and the maps its tools painted.
		 */
		const goOn = (said:ChatMessage[], hint:string, then = ''):void => {
			const memory = internalsOf(this.memory);
			const lines = heard.filter((event) => !memory.absorbed(event));
			memory.absorb(lines);
			// A repeat after what it heard can be right.
			warnedRepeat ||= lines.length > 0;
			const text = [hint, lines.length > 0 && heardMidThinkHint(lines.map((event) => this.render(event).text)), then].filter(Boolean).join('\n');
			const maps = this._shownNext ?? [];
			this._shownNext = undefined;
			const content = maps.length > 0 ? [...text ? [{ type: 'text' as const, text }] : [], ...maps] : text;
			messages.push(...said, ...content ? [{ role: 'user' as const, content }] : []);
		};
		/** One more turn on `content`, the reply as written: `hint` says what to do with it. */
		const retry = (reason:string | undefined, content:string | null, hint:string, then?:string):void => {
			if (reason) {
				this.showThink({ kind: 'retry', reason });
			}
			goOn([{ role: 'assistant', content }], hint, then);
		};
		// A thought that never got to its Arc is asked for it once, whatever repairs are left; one cut short, in the turn
		// right after it.
		let askedForArc = false;
		let cutShort = false;
		let heardLeft = this.setting('maxInterruptionsPerThink');
		/** The request under way: the reply it has written so far, and what stops it. */
		let asking:{ stop:AbortController; streamed:{ text:string; thought:string } } | undefined;
		// A line it hears while no reply has begun the Arc joins its next turn; a reply under way stops for it.
		this._hearMidThink = (event) => {
			if (heardLeft <= 0 || asking?.streamed.text.trim()) {
				return false;
			}
			heardLeft -= 1;
			heard.push(event);
			asking?.stop.abort();
			return true;
		};
		// Rounds of repeats cost half, so as many again; then the repeat warning, those asks, and the checks of what a reply
		// would do (`replyCheck`).
		const budget = 2 * toolsLeft + this.setting('repairRetries') + 1 + 3 + checksLeft + heardLeft;
		// How many tools were refused when the reply schema was last made.
		let refused = 0;
		for (let turn = 0; turn < budget; turn++) {
			// A tool refused for a repeat is offered no more this think: neither sent nor in the reply schema.
			const live = tools.filter((tool) => !this._refused.has(tool.name));
			if (reply && this._refused.size > refused) {
				refused = this._refused.size;
				reply = this.replyFormat(verbs, format);
			}
			// Spent, they are not offered at all: a model offered tools it may not call writes its calls as text.
			const allowTools = toolsLeft > 0 && live.length > 0;
			const stop = new AbortController();
			const streamed = { text: '', thought: '' };
			asking = { stop, streamed };
			// This turn answers from a thought cut short; a later one, after a tool's answer, thinks again.
			const answersCut = cutShort;
			cutShort = false;
			let res:ChatResponse;
			try {
				res = await chat({
					thread: this.id,
					messages,
					tools: allowTools ? live : undefined,
					toolChoice: allowTools ? 'auto' : undefined,
					responseFormat: reply,
					// A repair keeps the whole conversation, so reasoning on top of it runs out of tokens again.
					enableThinking: repairsLeft < this.setting('repairRetries') || askedForArc || answersCut ? false : this.thinksWith.thinking,
					signal: stop.signal,
					onDelta: this.replyWatch(verbs, stop, streamed, (text) => feed(turn, text)),
				});
			}
			catch (err) {
				const reason:unknown = stop.signal.reason;
				if (!(reason instanceof ArcError)) {
					if (!stop.signal.aborted) {
						throw err;
					}
					// Stopped for a line it heard: what it thought so far is its turn, and it thinks on with the line.
					retry(undefined, streamed.thought || null, '', thinkOnHint(format));
					continue;
				}
				// Cut off for going wrong: it is told why, like any other bad reply.
				// The root steps it had finished before it broke down are as good as any others. A chain may have gone on into
				// what broke, so it is written again.
				const finished = this.setting('repairPerStep') ? finishedSteps(streamed.text) : undefined;
				keep(fed);
				const judged = finished ? reader.judge(finished, kept) : { good: [], bad: [] };
				const stands = judged.good.filter((step) => isFree(verbs, step.verb));
				if (stands.length + kept.length > 0) {
					lastErr = reason;
					keep(stands);
					sendBack([...judged.bad, restOfReply(reason)], streamed.text);
				}
				else {
					repair(reason);
				}
				continue;
			}
			finally {
				asking = undefined;
			}
			// Whole, for a server that does not stream: one hand-off, then the end.
			if (res.content) {
				feed(turn, res.content);
			}
			if (this._deps.thinkWatch?.()) {
				this.showThink({ kind: 'reply', thought: res.reasoning ?? '', arc: arcSoFar(res.content ?? '', verbs) ?? '' });
			}
			// The thinking budget cut the thought short: answer from it, without thinking again.
			// Free: the thought was not wrong, only long, so it costs no repair. An answer cut short itself is a repair.
			if (res.truncated && !res.content && res.reasoning && !answersCut) {
				retry(undefined, res.reasoning, thoughtCutHint(format));
				cutShort = true;
				continue;
			}
			if (res.truncated) {
				repair(new ArcError('reply was cut off at the token limit; answer shorter'));
				continue;
			}
			if (res.toolCalls.length > 0 && allowTools) {
				const { answers, last } = await lookUpAll(res.toolCalls.map((call) => ({ name: call.name, args: call.arguments })));
				const told = answers.map((content, i) => ({ role: 'tool' as const, content, toolCallID: res.toolCalls[i].id }));
				goOn([{ role: 'assistant', content: res.content, toolCalls: res.toolCalls }, ...told], last ? NO_LOOKUPS_LEFT : '');
				continue;
			}
			// A tool written where the Arc goes, or in a thought that never got to the Arc, is the call the model meant: run
			// it, or drop it from an Arc beside it.
			const thought = !res.content && res.reasoning ? writtenToolCalls(res.reasoning, toolFirstArgs(tools)) : undefined;
			const written = format === 'text' && res.content ? writtenToolCalls(res.content, toolFirstArgs(tools)) : thought;
			if (written && written.calls.length > 0 && (!written.rest || thought)) {
				if (!allowTools) {
					repair(new ArcError(`no lookups left: write the Arc without ${[...new Set(written.calls.map((call) => call.name))].join(', ')}`), res);
					continue;
				}
				const { answers, last } = await lookUpAll(written.calls.map((call) => ({ name: call.name, args: JSON.stringify(call.args) })));
				retry(undefined, res.content, writtenToolsHint(answers.map((answer, i) => toolAnswer(written.calls[i].name, answer)), format, last));
				continue;
			}
			// A tool called in the reply's own JSON: look it up and answer with what it says. A tool this mind lacks, or one past the cap, is a repair.
			const called = format === 'text' || !res.content ? undefined : jsonToolCall(res.content);
			if (called) {
				if (!toolNames.includes(called.name) || toolsLeft <= 0) {
					repair(new ArcError(toolNames.includes(called.name) ? `no lookups left: ${called.name} was your last` : `${called.name} is not a tool you have`), res);
					continue;
				}
				const { answers, last } = await lookUpAll([{ name: called.name, args: JSON.stringify(called.args) }]);
				retry(undefined, res.content, toolResultHint(called.name, answers[0], last, this.compact));
				continue;
			}
			const content = (res.content && written?.rest) || res.content;
			if (res.toolCalls.length > 0) {
				repair(new ArcError('model called a tool when it must emit an Arc'), res);
				continue;
			}
			if (content) {
				let arc:Arc;
				keep(fed);
				// What stood before this reply: a reply sent back whole (a repeat, a way blocked) is written again in full, so
				// none of its steps stand, or the next reply's would be joined after them (after a `follow` that never ends).
				const stood = kept.length;
				try {
					if (this.setting('repairPerStep') || kept.length > 0) {
						const { good, bad } = reader.judge(content, kept);
						if (bad.length > 0 && good.length + kept.length === 0) {
							throw new ArcError(bad[0].reason);
						}
						if (bad.length > 0) {
							keep(good);
							sendBack(bad, content);
							continue;
						}
						// "Leave them out" adds nothing.
						keep(good.filter((step) => !sentBack || step.verb !== 'wait' || Object.keys(step.args).length > 0));
						arc = [...kept];
					}
					else {
						arc = reader.read(content);
					}
				}
				catch (err) {
					// The world moved under the reply: a repair turn would show the model the old world again. Or out of repairs.
					if (err instanceof BlockedArcError || err instanceof RejectedParts) {
						throw err;
					}
					const why = err instanceof Error ? err : new ArcError(String(err));
					if (kept.length > 0) {
						lastErr = why;
						sendBack([restOfReply(why)], content);
					}
					else {
						repair(why, res);
					}
					continue;
				}
				// What remains of the program under way (a commander's: of its units'), restated, changes nothing, as its prompt promises: no repeat.
				if (!warnedRepeat && this.isRepeat(content) && !this.supervising(arc) && !this.owner.runs(arc)) {
					warnedRepeat = true;
					this._emitStreak += 1;
					kept.splice(stood);
					retry('the same Arc as last time', content, repeatOutputHint(this._emitStreak, format));
					continue;
				}
				const check = (this._deps.features ?? []).map((feature) => feature.replyCheck(this, arc, format)).find(Boolean);
				if (check) {
					kept.splice(stood);
					lastErr = new BlockedArcError(check.reason);
					if (checksLeft <= 0) {
						throw lastErr;
					}
					checksLeft -= 1;
					retry(check.reason, content, check.hint);
					continue;
				}
				this.acceptEmit(content);
				this._talkStreak = !this.supervising(arc) && arcSteps(arc).every((step) => TALK_VERBS.has(step.verb)) ? this._talkStreak + 1 : 0;
				return arc;
			}
			const none = new ArcError('model returned no arc');
			if (askedForArc) {
				repair(none, res);
				continue;
			}
			askedForArc = true;
			lastErr = none;
			retry(none.message, null, 'Emit the Arc now.');
		}
		throw lastErr ?? new ArcError('failed to obtain Arc');
	}

	/**
	 * Tells this mind's watcher, if any, how its think goes, in the name of whoever it began for: a commander may die mid-
	 * think, and every event of one think must reach the one watching it, its end above all.
	 */
	private showThink(event:ThinkEventFor):void {
		this._deps.thinkWatch?.()?.({ ...event, who: this._thinkingAs } as ThinkEvent);
	}

	/**
	 * Follows the reply to one request as its pieces come in: tells this mind's watcher, if any, how it is going, and
	 * ends the request through `stop` the moment the reply can no longer become an Arc. `written` gathers its thought and its text.
	 */
	private replyWatch(verbs:VerbRegistry, stop:AbortController, written:{ text:string; thought:string }, feed:(text:string)=>void):(delta:ChatDelta)=>void {
		const breakdown = replyBreakdown(verbs);
		let arc = '';
		return ({ content, reasoning }) => {
			written.text += content ?? '';
			written.thought += reasoning ?? '';
			const why = content ? breakdown(content) : undefined;
			if (why) {
				stop.abort(new ArcError(why));
				return;
			}
			if (content) {
				feed(written.text);
			}
			if (this._deps.thinkWatch?.()) {
				arc = (content ? arcSoFar(written.text, verbs) : undefined) ?? arc;
				this.showThink({ kind: 'reply', thought: written.thought, arc });
			}
		};
	}

	/** The schema the server must follow under `schema`; otherwise none, and the reply is parsed as written. */
	private replyFormat(verbs:VerbRegistry, format:ArcFormat):JsonSchemaResponseFormat | undefined {
		const catalog = this.setting('offerAppendedCommands') ? verbs.nested() : verbs.nested().withoutArg('command', 'append');
		return format === 'schema' ? { name: 'reply', schema: replySchema(catalog, this.replyTools(), this.setting('explicitThinkAllowedInside')), strict: true } : undefined;
	}

	/** Waiting while the units it leads work: supervising, neither talking in circles nor stuck. */
	private supervising(arc:Arc):boolean {
		return arcSteps(arc).every((step) => step.verb === 'wait') && (this.owner.working?.() ?? false);
	}

	private isRepeat(text:string):boolean {
		const t = text.trim();
		return t !== '' && t === this._lastEmit;
	}

	private acceptEmit(text:string):void {
		if (this.isRepeat(text)) {
			return;
		}
		this._lastEmit = text.trim();
		this._emitStreak = this._lastEmit ? 1 : 0;
	}

	/** Anything since the last accepted think besides this mind's own arc result. */
	private hasFreshInput():boolean {
		return this._pendingAbout !== undefined || this._pendingEvents.some((e) => e.kind !== 'arc_result');
	}

	private toolDefs():ToolDef[] {
		const tools = this.mergedTools();
		const verbs = this.owner.activeVerbs();
		const catalog = [...verbs.nested().list().map((spec) => spec.name), ...Object.keys(tools)];
		const allowed = new Set([...verbs.list().map((spec) => spec.name), ...Object.keys(tools)]);
		const out:ToolDef[] = [];
		for (const [name, spec] of Object.entries(tools)) {
			out.push({
				name,
				description: docsFor(typeof spec.description === 'string' ? spec.description : spec.description(this), name, allowed, catalog),
				parameters: spec.parameters,
			});
		}
		return out;
	}

	/**
	 * The parameters of each tool this mind is offered now, none without tool rounds and none refused this think: what
	 * `replySchema` lets a reply call.
	 */
	private replyTools():Record<string, JsonSchema> {
		const tools = this.setting('toolRounds') > 0 ? this.mergedTools() : {};
		return Object.fromEntries(Object.entries(tools).filter(([name]) => !this._refused.has(name)).map(([name, spec]) => [name, spec.parameters]));
	}

	/** Every tool this mind may call now: its director's (`withTools`) it can use (`offered`), less what its kit leaves out. */
	private mergedTools():Record<string, ToolSpec<TCtx>> {
		return this.filterTools(Object.fromEntries(Object.entries(this._deps.tools ?? {}).filter(([, spec]) => spec.offered?.(this) ?? true)));
	}

	/** What `observe` with `args` (`expr`) answers: the watch expression's value in `catalog`, by default the world as its voice sees it now. */
	public observe(args:unknown, catalog = this.voice.catalog?.()):string | { error:string } {
		const row = isRecord(args) ? args : {};
		const expr = typeof row.expr === 'string' ? row.expr : '';
		if (!expr) {
			return { error: 'observe needs expr' };
		}
		if (!catalog) {
			return { error: 'no catalog' };
		}
		return observeExpr(expr, catalog, evaluate);
	}

	/**
	 * A tool's answer as text. A repeat did not help, so it is refused: any call within this think, which also disables
	 * its tool for the rest of the think (`_refused`), and a lookup within the last few. Other tools (see_map, observe)
	 * may answer differently once the character has moved.
	 */
	private async lookUp(name:string, rawArgs:string, ctx:TCtx | undefined, chat:ModelChat):Promise<string> {
		const key = `${name} ${rawArgs.replace(/\s+/g, '')}`;
		const window = name === 'recall' ? LOOKUP_REPEAT : 0;
		const last = this._calledOn.get(key) ?? -Infinity;
		if (last === this._thinks || this._refused.has(name)) {
			this._refused.add(name);
			return refusedCall(name, rawArgs, last === this._thinks, this.owner.activeVerbs().has('say'));
		}
		this._calledOn.set(key, this._thinks);
		if (this._thinks - last <= window) {
			return JSON.stringify({ error: 'Duplicate call. You made it lately. Change the query, call another tool, or emit the arc.' });
		}
		this.showThink({ kind: 'tool', tool: name, args: rawArgs });
		this._toolRuns += 1;
		const result = await this.runTool(name, rawArgs, ctx, chat);
		return typeof result === 'string' ? result : JSON.stringify(result);
	}

	private async runTool(name:string, rawArgs:string, ctx:TCtx | undefined, chat:ModelChat):Promise<unknown> {
		if (ctx === undefined) {
			return { error: 'nothing of yours is in this scene to look from' };
		}
		const spec = this.mergedTools()[name];
		if (!spec) {
			return { error: `unknown tool '${name}'` };
		}
		let args:unknown = {};
		if (rawArgs.trim()) {
			try {
				args = JSON.parse(rawArgs);
			}
			catch {
				return { error: `tool '${name}' arguments were not valid JSON` };
			}
		}
		try {
			return await spec.handler(ctx, args, this, chat);
		}
		catch (err) {
			return { error: err instanceof Error ? err.message : String(err) };
		}
	}

	/** What the next think is about, its first {@link THINK_ABOUT_CAP} characters. */
	private runThink(step:Step):ArcResult {
		const about = String(step.args.about ?? '').replace(/\s+/g, ' ').trim().slice(0, THINK_ABOUT_CAP).trim();
		this._pendingAbout = about.length > 0 ? about : undefined;
		return { status: 'ok', verb: 'think' };
	}

	/** watch(name, expr) adds or replaces an extra watch; unwatch(name) drops one. Pins fail closed. */
	private runWatch(step:Step):ArcResult {
		const name = String(step.args.name ?? '');
		if (hasWatch(this.persona.pinnedWatches, name)) {
			return { status: 'failed', verb: step.verb, reason: `${name} is a required watch` };
		}
		const expr = String(step.args.expr ?? '');
		const ok = step.verb === 'unwatch'
			? this.persona.removeWatch(name)
			: this.persona.editWatch(name, expr) || this.persona.addWatch(name, expr);
		if (ok) {
			this._deps.queue?.setWatches(this.id, this.persona.watchList());
		}
		return { status: ok ? 'ok' : 'failed', verb: step.verb, reason: ok ? undefined : `no watch ${name}` };
	}

	/** focus(expr) puts an extra sightFocus first; unfocus(expr) drops one. Pins fail closed. */
	private runFocus(step:Step):ArcResult {
		const expr = String(step.args.expr ?? '').trim();
		if (this.persona.pinnedSightFocus.includes(expr)) {
			return { status: 'failed', verb: step.verb, reason: 'that sightFocus is required' };
		}
		const rest = this.persona.sightFocus.filter((e) => e !== expr);
		const ok = step.verb === 'focus' ? expr.length > 0 : rest.length < this.persona.sightFocus.length;
		this.persona.sightFocus = step.verb === 'focus' ? asFocusList([expr, ...rest], this.persona.maxSightFocus) : rest;
		return { status: ok ? 'ok' : 'failed', verb: step.verb, reason: ok ? undefined : 'no such sightFocus' };
	}

	private syncQueue(result:ArcResult):void {
		if (!this._deps.queue) {
			return;
		}
		this._deps.queue.noteResult(this.id);
		// Orders given are work under way: its watches say when that needs another think.
		const ordered = result.status === 'ok' && this.lastArc && arcSteps(this.lastArc).some((step) => step.verb === 'command');
		if (result.status === 'stopped' || !this.lastArc || ordered) {
			return;
		}
		// What ran says how much there is to look back on: little, and it idles until its next rethink.
		const ran = this.voice.ranImpact();
		if (result.status === 'failed' || ran > 1 - this.setting('retrospectThreshold')) {
			this._deps.queue.enqueueArcEnd(this.id, `arc ${result.status}${result.verb ? ` at ${result.verb}` : ''}`, result.status === 'failed' ? Math.max(FAILED_ARC_SCORE, ran) : ran);
		}
	}

	/** `goal` is reached: it stops being a goal, and whoever listens hears. */
	public finishGoal(goal:Goal<never>):void {
		this.persona.finishGoal(goal, this._now, this.ownKnowers(), this.thinkThread());
		(this._deps.features ?? []).forEach((feature) => feature.goalReached(this, goal));
	}

	/**
	 * This mind's own word that a goal is done: `text`, or with none its first. One with an `until` ends by that alone, so
	 * a model cannot talk itself past what its game asks.
	 */
	private finishByWord(text:string | undefined, mark:string):ArcResult {
		const goal = this.goalsMarked(mark, text).find((g) => text || !g.until);
		if (!goal) {
			return { status: 'failed', verb: 'finish_goal', reason: text ? `no goal reads "${text}"` : 'no goal to finish' };
		}
		if (goal.until) {
			return { status: 'failed', verb: 'finish_goal', reason: 'not yet: that goal ends by itself once it is done' };
		}
		this.finishGoal(goal);
		return { status: 'ok', verb: 'finish_goal' };
	}

	/** The goals that carry `mark`, or only the one reading `text` when it is named. */
	private goalsMarked(mark:string, text:string | undefined):Goal<never>[] {
		return this.persona.goals.filter((g) => (text ? g.text === mark + text : g.text.startsWith(mark)));
	}

	/** `set_goal`, `drop_goal`, `finish_goal` or `set_identity` as `by` runs it, which is how the model edits who this mind is. Undefined for any other step. */
	private editPersona(step:Step, by:ArcRunner<TCtx>):ArcResult | undefined {
		// A goal another of its characters sets is marked as theirs, and only they finish or drop it by name.
		const mark = by === this.voice ? '' : `[${by.id}] `;
		if (step.verb === 'set_goal') {
			const goal = String(step.args.goal ?? '');
			const priority = typeof step.args.priority === 'number' ? step.args.priority : 0;
			const text = mark + goal;
			// The same goal again only changes its priority.
			const same = this.persona.goals.find((g) => g.text === text);
			this.persona.goals = this.persona.goals.filter((g) => g !== same);
			this.persona.goals.push({ ...same, text, priority });
			this.persona.trimGoals();
			return { status: 'ok', verb: 'set_goal' };
		}
		if (step.verb === 'finish_goal') {
			return this.finishByWord(typeof step.args.goal === 'string' ? step.args.goal : undefined, mark);
		}
		if (step.verb === 'drop_goal') {
			const goal = typeof step.args.goal === 'string' ? step.args.goal : undefined;
			const dropped = this.goalsMarked(mark, goal).slice(goal ? 0 : -1);
			this.persona.goals = this.persona.goals.filter((g) => !dropped.includes(g));
			return { status: 'ok', verb: 'drop_goal' };
		}
		if (step.verb === 'set_identity') {
			const changed = this.persona.applyIdentityPatch(step.args, this._now);
			return { status: changed ? 'ok' : 'failed', verb: 'set_identity', reason: changed ? undefined : 'nothing to change' };
		}
		return undefined;
	}

	/**
	 * A mind verb that `by` runs: its voice, or another of a collective's characters, whose memories and goals
	 * are marked as theirs. Undefined for a step the character runs itself.
	 */
	public async perform(step:Step, by:ArcRunner<TCtx>):Promise<ArcResult | undefined> {
		const voice = by === this.voice;
		if (step.verb === 'think') {
			return this.runThink(step);
		}
		if (WATCH_EDIT_VERBS.includes(step.verb)) {
			return this.runWatch(step);
		}
		if (FOCUS_EDIT_VERBS.includes(step.verb)) {
			return this.runFocus(step);
		}
		if (step.verb === 'remember') {
			const content = String(step.args.content ?? '');
			const tags = asStringArray(step.args.tags);
			await this.memory.remember(content, tags, this._now, voice ? undefined : by.id);
			return { status: 'ok', verb: 'remember' };
		}
		const edited = this.editPersona(step, by);
		if (edited) {
			return edited;
		}
		if (voice && step.verb === 'wait' && typeof step.args.until === 'string') {
			this._deps.queue?.armOnce(this.id, step.args.until);
		}
		return undefined;
	}

}

/** Written into the one step {@link markStep} marks, so its line can be found once the arc is laid out. */
const STEP_MARK = '§step§';

/** `arc` with `step`, the very object at any depth, carrying {@link STEP_MARK}; undefined when `step` is not in it. */
function markStep(arc:Arc, step:Step):Arc | undefined {
	let found = false;
	const walk = (steps:Arc):Arc => steps.map((s) => {
		if (s === step) {
			found = true;
			return { ...s, args: { ...s.args, [STEP_MARK]: STEP_MARK } };
		}
		return { ...s, args: Object.fromEntries(Object.entries(s.args).map(([key, value]) => [key, isArc(value) ? walk(value) : value])) };
	});
	const marked = walk(arc);
	return found ? marked : undefined;
}
