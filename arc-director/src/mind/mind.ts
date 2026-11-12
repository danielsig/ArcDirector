import { parseArcText } from '../arc/arc-parse.js';
import { formatArc, formatArcBlocks } from '../arc/arc-format.js';
import { arcJSONBlocks, arcSoFar, finishedSteps, parseArc, replyBreakdown } from '../arc/wire.js';
import { exprArgs } from '../arc/validate.js';
import { docsFor, replySchema } from '../arc/schema.js';
import { CHOOSE_VERB, FOCUS_EDIT_VERBS, PASS_VERB, VerbRegistry, WATCH_EDIT_VERBS, argBase, groupTargets, STOCK_VERB_DEFS } from '../arc/stock-verbs.js';
import type { Arc, ArcResult, Step } from '../arc/arc-types.js';
import { ArcError, BlockedArcError } from '../arc/arc-types.js';
import { catalogEntities, evaluate, unboundCalls } from '../expr/eval.js';
import { plainTagTests } from '../expr/tag-tests.js';
import { observeExpr } from '../expr/stringify.js';
import { bagOf, cloneEntity } from '../expr/prev.js';
import { isVisionModel } from '../inference/models.js';
import type { ChatContent, ChatContentPart, ChatDelta, ChatMessage, ChatResponse, InferenceProvider, JsonSchemaResponseFormat, ToolDef } from '../inference/provider.js';
import { extractJson, isRecord, type JsonSchema } from '../json.js';
import { mergeTags, nameTags, type MemoryRecord } from '../memory/store.js';
import type { ArcFormat, ConversationTurn, MindEvent, Replacing, Sense, ThinkEvent, ToolSpec } from './mind-types.js';
import { parseMapZoom, stampMap, isMapSnapshot, DEFAULT_YOU_SYMBOL, type MapPrev, type MapSense } from './map.js';
import {
	articlesNamedIn,
	knowledgeFor,
	knowledgePages,
	mentionedArticles,
	isAboutItem,
	receivedArticles,
	type KnowledgeSource,
} from './knowledge.js';
import { jsonToolCall, toolFirstArgs, writtenToolCalls } from './tool-text.js';
import { arcRepairHint, partRepairHint, programFiles, replaceAsk, thoughtCutHint, writtenToolsHint, toolResultHint, blockedAgainHint, repeatOutputHint, reviseGoalsAsk, sayRangeHint, stablePrefix, volatileBlock, type PromptStyle, type ThinkInstructions } from './prompt.js';
import type { TalkNet } from './talk.js';
import type { SightClause } from '../perception/perception-types.js';
import { idsOf, mapArc, mapExpr, mapLawName, namesOf } from './ids.js';
import type { NameTarget } from '../character/NameBook.js';
import type { Persona } from '../character/Persona.js';
import type { Goal, Watches } from '../character/character-types.js';
import { sayToOf, type ArcRunner, type Holder } from '../character/arc-runner.js';
import { lawGroup, type Law } from '../arc/laws.js';
import { deferThinks, THINK_ABOUT_CAP } from '../arc/run.js';
import { arcSteps, eachStep, firstStep, isArc, mapArgs, sameProgram } from '../arc/arc-types.js';
import { choicesOf, DEFAULT_MIN_CHOICES } from '../arc/choose.js';
import { noWayTo } from '../world/route.js';
import { waitUntilOf, type MindQueue } from '../think/queue.js';
import { hasWatch, watchCount } from '../character/watch.js';
import { asFocusList } from '../character/focus.js';
import { hand } from '../internals.js';

/**
 * How a mind thinks, and what its prompt tells it. One layer of them: a mind reads each setting from its own (its
 * spec's `mind`, saved with it), else its director's (`withMind`), else the library's ({@link MIND_DEFAULTS}).
 */
export type MindSettings = {
	/** No think on the queue's heartbeat; only watches, events and arc ends wake it. */
	skipHeartbeat?:boolean;
	/** Major events do not wake it. */
	skipMajor?:boolean;
	/** No think when it joins: it waits for something to happen. Default: it thinks once to start. */
	skipStart?:boolean;
	/** No goal or identity revision, on the timer or after a major event. */
	skipStrategic?:boolean;
	/** Tie-break after watch `rankScore`. Higher goes first. Default 0. */
	rank?:number;
	/** Fewest game seconds between tactical thinks. Default 0 under a director, whose queue paces thinks. */
	heartbeat?:number;
	/** Game seconds between goal revisions; 0 never revises. Default 180. */
	strategicInterval?:number;
	/** The model it thinks with, by its name on the director (`addModel`). Omit for the director's default. */
	model?:string;
	/**
	 * How much of Current Conversation to show, in letters, whole messages only, newest kept.
	 * Omit for one quarter of the model's context window ({@link conversationCapFor}). 0 shows none.
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
	/** Whether a finished arc stalled, which stretches the heartbeat. Default: it failed or was stopped. */
	stalled?:(result:ArcResult)=>boolean;
	/** How close a memory must come to what is before it to come to mind unasked (0–1). Default 0.55. */
	intrusionThreshold?:number;
	/** Game seconds between two memories that come to mind unasked. Default 45. */
	intrusionCooldown?:number;
	/** Memories brought into each prompt, and the most `recall` returns. Default 5. */
	recallK?:number;
	/** No `observe` tool. */
	hideObserve?:boolean;
};

/** Tool calls a think may make before it must emit the Arc. Small models need several lookups in a row. */
export const DEFAULT_TOOL_ROUNDS = 6;

/** The library's layer of every mind's settings: each one neither the mind nor its director sets. */
const MIND_DEFAULTS = {
	skipHeartbeat: false,
	skipMajor: false,
	skipStart: false,
	skipStrategic: false,
	rank: 0,
	heartbeat: 0,
	strategicInterval: 180,
	lawResults: 5,
	arcFormat: 'schema',
	toolRounds: DEFAULT_TOOL_ROUNDS,
	repairRetries: 0,
	minChoices: DEFAULT_MIN_CHOICES,
	repairPerStep: false,
	repairUnknownFields: false,
	intrusionThreshold: 0.55,
	intrusionCooldown: 45,
	recallK: 5,
	hideObserve: false,
} as const satisfies MindSettings;

/** Setting `K` as a mind reads it: never unset where the library has a default. */
export type Setting<K extends keyof MindSettings> = K extends keyof typeof MIND_DEFAULTS ? NonNullable<MindSettings[K]> : MindSettings[K];

/** The model a mind thinks with, as its director has it now. */
export type MindModel = {
	provider:InferenceProvider;
	/** The id its requests name on the server; `''` until the server answered. */
	id:string;
	/** Whether it takes image parts: `false` never offers `see_map`, `true` offers it with a map. Omit to go by its id ({@link isVisionModel}). */
	vision?:boolean;
	/** Its context window in tokens, when known. */
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
	events?:MindEvent[];
	lastArc?:Arc;
	lastResult?:ArcResult;
	lastTacticalTimestamp?:number;
	lastStrategicTimestamp?:number;
	lastIntrusionTimestamp?:number;
	recent?:string[];
	recentSummary?:string;
	/** Last clear lines, oldest first. */
	conversation?:ConversationTurn[];
	thinkAbout?:string;
	lastVerb?:string;
};

/** What a mind thinks for: a character, or a collective. Its `voice` enacts the arcs the mind writes. */
export type MindOwner<TCtx = unknown> = ArcRunner<TCtx> & {
	/** The owner's own block of the prompt, in place of the laws. A collective lists its roster here. */
	promptSection?(mind:Mind<TCtx>):string;
	/** The verbs its prompt lists, when fewer than it may parse: a collective's nested ones its characters can run. */
	promptVerbs?():VerbRegistry;
	/** Whether others it leads are at work (a collective's units running programs), so a think may only wait. */
	working?():boolean;
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
	talk?:TalkNet;
	/** When the voice has an executor, `tick` runs the arc unless this is false. */
	autoEnact?:boolean;
	/** Each arc the moment a think chooses it, before it runs. */
	onChoose?:(arc:Arc)=>void;
	/** Each goal as it is reached, by its `until` or by this mind's own word. */
	onGoalReached?:(goal:Goal<never>)=>void;
	/** Whoever watches this mind think, if anyone does by now. */
	thinkWatch?:()=>((event:ThinkEvent)=>void) | undefined;
	/** The unfinished work `arc` would cut short, when it is to be asked about before replacing it. */
	replacing?:(arc:Arc)=>Replacing[];
	/** Why an Arc just read could never work as written, for the model to write it again before it runs. */
	arcProblem?:(arc:Arc)=>ArcError | undefined;
	queue?:MindQueue;
	/** Vectors for memories and recall queries. Omit to recall by text alone. */
	embed?:(texts:string[])=>Promise<number[][]>;
	/**
	 * Why there is no way for this character to each of `ids`, in order (`Bridge is raised`, or `''` unnamed), or
	 * undefined where there is: one look at the world for all of them. Marks unreachable names in earshot.
	 */
	wayBlocked?:(ids:readonly string[])=>(string | undefined)[];
	/** Host naming policy seen from this mind: the base name for a character. Omit to use ids. */
	seenAs?:(target:NameTarget)=>string;
	/** The context its tools and articles look from. Default: its voice's. */
	worldContext?:()=>TCtx | undefined;
	/** Host top-down snapshots. `see_map` is omitted unless this and vision are both set. */
	map?:MapSense;
	/** What it knows about the world: host articles `recall` searches beside memory. */
	knowledge?:KnowledgeSource<TCtx>;
	/** Most articles shown per think for names said or heard. Default {@link DEFAULT_MENTION_CAP}; 0 shows none. */
	mentionCap?:number;
	/** The open offers it may take or answer, one per line, shown in every prompt. Omit, or `''`, for none. */
	offers?:()=>string;
};

function asStringArray(v:unknown):string[] {
	if (!Array.isArray(v)) {
		return [];
	}
	return v.filter((x):x is string => typeof x === 'string');
}

/**
 * What each built-in tool takes. Fixed, in this order, so the reply schema built from them (then the host's tools) is
 * the same bytes for every mind, whatever tools it is offered.
 */
const BUILTIN_TOOL_PARAMETERS:Record<string, JsonSchema> = {
	recall: {
		type: 'object',
		additionalProperties: false,
		required: ['query'],
		properties: {
			query: { type: 'string' },
			k: { type: 'number' },
		},
	},
	observe: {
		type: 'object',
		additionalProperties: false,
		required: ['expr'],
		properties: {
			expr: { type: 'string' },
		},
	},
	earshot: {
		type: 'object',
		additionalProperties: false,
		properties: {
			to: { type: 'string' },
		},
	},
	see_map: {
		type: 'object',
		additionalProperties: false,
		properties: {
			zoom: { type: 'number', minimum: 0, maximum: 1 },
		},
	},
};

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
/** Lines kept to tell a repeat from something new. */
const SAID_CAP = 6;
/** Share of a new line's content words an earlier line already had that makes the new line old news. */
const REPEAT_OVERLAP = 0.6;
/** Long words that carry no content of their own. */
const FILLER = new Set(['about', 'again', 'already', 'could', 'excuse', 'hello', 'might', 'perhaps', 'please', 'really', 'should', 'sorry', 'still', 'thank', 'thanks', 'their', 'there', 'these', 'those', 'where', 'which', 'while', 'would']);

/**
 * The content words of a line, to tell a repeat from something new however it is reworded. Each word is cut
 * to its first five letters, a crude stem that makes "lowering" and "lower" the same word.
 */
function gistOf(text:string):Set<string> {
	return new Set(text.toLowerCase().split(/[^a-z0-9]+/)
		.filter((w) => w.length >= 5 && !FILLER.has(w))
		.map((w) => w.slice(0, 5)));
}

/** Articles shown per think for names said or heard. */
export const DEFAULT_MENTION_CAP = 2;
/** Thinks before an article shown for a mention may be shown again. */
const MENTION_REPEAT = 5;
/** Thinks before the same tool call may be made again. */
const LOOKUP_REPEAT = 5;
const RECENT_CAP = 8;
const RECENT_SUMMARY_MAX = 600;
const RECENT_SEPARATOR = '; ';
const BARE_RESULT = new Set(['ok', 'failed', 'stopped']);

/** The folded summary with `overflow` added: lines kept apart, the oldest whole lines dropped past the cap. */
function foldRecent(prev:string, overflow:string[]):string {
	const lines = [prev, ...overflow].map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s.length > 0);
	const next = lines.join(RECENT_SEPARATOR);
	if (next.length <= RECENT_SUMMARY_MAX) {
		return next;
	}
	const tail = next.slice(next.length - RECENT_SUMMARY_MAX);
	const cut = tail.indexOf(RECENT_SEPARATOR);
	return (cut < 0 ? tail : tail.slice(cut + RECENT_SEPARATOR.length)).trim();
}

/**
 * One quarter of the context window, in letters. English runs about 4 letters a token, so this is
 * `contextTokens / 4 * 4`. An unknown window is unlimited. 0 shows none.
 */
function conversationCapFor(contextTokens:number | undefined):number {
	if (contextTokens === undefined || !Number.isFinite(contextTokens)) {
		return Number.POSITIVE_INFINITY;
	}
	if (contextTokens <= 0) {
		return 0;
	}
	return Math.floor(contextTokens / 4 * 4);
}

function isBareResult(text:string):boolean {
	const t = text.trim().toLowerCase();
	return !t || BARE_RESULT.has(t) || /^\d+s$/.test(t);
}

/** What a mind's constructor hands the director that attaches it: the director's only way into its private fields. */
export type MindFields<TCtx> = {
	/** Wire it to the owner it thinks for. */
	attach(owner:MindOwner<TCtx>, deps:MindDeps<TCtx>):void;
	/** Let go of it: it thinks for no one, and may think for someone else later. */
	detach():void;
	/**
	 * What its sight showed this think, each clause with the names of what it saw: its sightings to remember. With
	 * `salience`, how much each name it sees or carries should bring its memories to mind (0–1).
	 */
	sighted(clauses:readonly SightClause[], salience?:ReadonlyMap<string, number>):void;
};

/**
 * Writes arcs: it thinks with the model about its owner's persona and what the owner's voice senses, and hands
 * each arc to that voice. It holds no story of its own, only its settings and thinking state, so it can be
 * swapped or dropped without losing who its owner is. A character owns at most one mind; a collective always
 * has one, shared by its characters.
 *
 * It thinks with one of its director's configured models (`addModel`), by the name in its settings' `model`, or
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
	/** Its director's layer of settings, read live. */
	private _defaults:MindSettings = {};
	/** The model it thinks with now, as its director has it. */
	private _thinksWith!:()=>MindModel;
	private _owner:MindOwner<TCtx> | undefined;
	/** The owner's id, kept after a detach so a think still finishing can clean up after itself. */
	private _id = '';
	public senses:Record<string, Sense<TCtx>> = {};
	public tools:Record<string, ToolSpec<TCtx>> = {};
	public talk:TalkNet | undefined;
	public autoEnact = true;
	public onChoose:((arc:Arc)=>void) | undefined;
	private _onGoalReached:MindDeps['onGoalReached'];
	private _thinkWatch:MindDeps['thinkWatch'];
	private _replacing:MindDeps['replacing'];
	private _arcProblem:MindDeps['arcProblem'];
	/** Who the think under way began for. */
	private _thinkingAs = '';
	public queue:MindQueue | undefined;
	public embed:((texts:string[])=>Promise<number[][]>) | undefined;
	public wayBlocked:((ids:readonly string[])=>(string | undefined)[]) | undefined;
	public seenAs:((target:NameTarget)=>string) | undefined;
	public worldContext:()=>TCtx | undefined = () => undefined;
	public map:MapSense | undefined;
	public knowledge:KnowledgeSource<TCtx> | undefined;
	public offers:(()=>string) | undefined;
	/** Its laws' results since the last think, oldest first. */
	private _lawResults:string[] = [];
	/** The last arc or think's result, as the next prompt shows it. */
	public lastResult:ArcResult | undefined;
	public lastArc:Arc | undefined;
	public lastTacticalTimestamp = Number.NEGATIVE_INFINITY;
	public lastStrategicTimestamp = 0;
	public lastIntrusionTimestamp = Number.NEGATIVE_INFINITY;
	private _now = 0;
	private readonly _pendingEvents:MindEvent[] = [];
	private _recent:string[] = [];
	private _recentSummary = '';
	private _conversation:ConversationTurn[] = [];
	private _recentAbsorbed = 0;
	private _pendingSeeMapImage:string | undefined;
	private _lastMap:MapPrev & { legend:string } | undefined;
	private _pendingAbout:string | undefined;
	private _lastVerb:string | undefined;
	/** Last accepted model reply, trimmed. A repeat of this is warned, not enacted. */
	private _lastEmit = '';
	private _emitStreak = 0;
	/** Accepted arcs in a row that only talked or waited. */
	private _talkStreak = 0;
	/** Characters a `reply` verb in the running arc asked something of. */
	private _replyTo:string[] = [];
	/** Recent lines this mind's voice said, with who heard each clearly. */
	private _said:{ gist:Set<string>; text:string; heard:Set<string> }[] = [];
	private _mentionCap = DEFAULT_MENTION_CAP;
	private _thinks = 0;
	/** Article name → the think it was last shown on for being mentioned. */
	private readonly _mentionedOn = new Map<string, number>();
	/** Tool call (name and args) → the think it was last made on. */
	private readonly _calledOn = new Map<string, number>();
	/** `verb id` pairs whose move found no way; `blockedAgain` refuses them until the way opens. */
	private readonly _noWay = new Set<string>();
	/** What its sight showed since it last noted sightings. */
	private _sighted:readonly SightClause[] = [];
	/** What is before it this think, and how much each should bring its memories to mind. */
	private _salience:ReadonlyMap<string, number> = new Map();

	constructor(settings:MindSettings = {}) {
		this.settings = { ...settings };
		hand(this, {
			attach: (owner, deps) => this.attach(owner, deps),
			detach: () => {
				this._owner = undefined;
			},
			sighted: (clauses, salience) => {
				this._sighted = clauses;
				this._salience = salience ?? new Map();
			},
		} satisfies MindFields<TCtx>);
	}

	private attach(owner:MindOwner<TCtx>, deps:MindDeps<TCtx>):void {
		this._owner = owner;
		this._id = owner.id;
		this._thinksWith = deps.thinksWith;
		this._defaults = deps.defaults ?? {};
		this.senses = deps.senses ?? {};
		this.tools = deps.tools ?? {};
		this.talk = deps.talk;
		this.autoEnact = deps.autoEnact ?? true;
		this.onChoose = deps.onChoose;
		this._onGoalReached = deps.onGoalReached;
		this._thinkWatch = deps.thinkWatch;
		this._replacing = deps.replacing;
		this._arcProblem = deps.arcProblem;
		this.queue = deps.queue;
		this.embed = deps.embed;
		this.wayBlocked = deps.wayBlocked;
		this.seenAs = deps.seenAs;
		this.worldContext = deps.worldContext ?? (() => this.voice.context());
		this.map = deps.map;
		this.knowledge = deps.knowledge;
		this.offers = deps.offers;
		this._mentionCap = deps.mentionCap ?? DEFAULT_MENTION_CAP;
	}

	/** The model it thinks with now, as its director has it: the one its `model` setting names, else the default. */
	public get thinksWith():MindModel {
		return this._thinksWith();
	}

	/** Setting `key` as this mind thinks with it: its own, else its director's, else the library's. */
	public setting<K extends keyof MindSettings>(key:K):Setting<K> {
		return (this.settings[key] ?? this._defaults[key] ?? (MIND_DEFAULTS as MindSettings)[key]) as Setting<K>;
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

	/** Game time, for the events and memories this mind stamps. The director stamps every tick. */
	public stamp(now:number):void {
		this._now = now;
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

	/** This mind's name for a character it is sampling now. Assigns one on first sight. */
	public seen(target:NameTarget):string {
		return this.seenAs ? this.persona.names.name(target.id, this.seenAs(target)) : target.id;
	}

	/** This mind's name for `id`. A character it never sampled gets the policy's answer for a bare id, unrecorded. */
	public nameOf(id:string):string {
		return this.persona.names.peek(id) ?? this.seenAs?.({ id }) ?? id;
	}

	/**
	 * Queue an event for the next think. It is kept in ids and read in this mind's names when that think starts. A major
	 * one wakes this mind, while it thinks for someone.
	 */
	public pushEvent(event:MindEvent):void {
		const pending = this._pendingEvents;
		const same = event.key === undefined ? -1 : pending.findIndex((e) => e.key === event.key);
		if (same >= 0) {
			pending.splice(same, 1);
		}
		pending.push({ ...event, timestamp: event.timestamp ?? this._now });
		const kin = event.cap === undefined ? [] : pending.filter((e) => e.kind === event.kind);
		if (kin.length > event.cap!) {
			const least = kin.reduce((a, b) => ((b.weight ?? 0) < (a.weight ?? 0) ? b : a));
			pending.splice(pending.indexOf(least), 1);
		}
		if (event.major && this.attached) {
			this.queue?.enqueueMajor(this.id);
		}
	}

	/** The events waiting for the next think, as this mind reads them now. */
	public events():MindEvent[] {
		return this._pendingEvents.map((e) => this.render(e));
	}

	/**
	 * `{0}`, `{1}`, … in the text become this mind's names for `who` now, and its owner or voice becomes "you":
	 * a small model reads "Forager gave FireMushroom to BridgeKeeper" about someone else, even as BridgeKeeper.
	 */
	private render({ who, ...event }:MindEvent):MindEvent {
		const names = (who ?? []).map((id) => this.nameOf(id));
		return {
			...event,
			text: event.text.replace(/\{(\d+)\}/g, (hit, n, at:number) => {
				const id = who?.[Number(n)];
				if (id === undefined) {
					return hit;
				}
				return this.isSelf(id) ? (at === 0 ? 'You' : 'you') : names[Number(n)];
			}),
			tags: names.length > 0 ? mergeTags(event.tags, names) : event.tags,
		};
	}

	/** Whether `id` is this mind's own: its owner, or the character that speaks for it. */
	private isSelf(id:string):boolean {
		return id === this.id || id === this.thinkThread();
	}

	/** Whether this mind acts for `id`: itself, its voice, or one of a collective's characters. */
	private controls(id:string):boolean {
		if (this.isSelf(id)) {
			return true;
		}
		const roster = this._owner as { characters?:readonly { id:string }[] } | undefined;
		return roster?.characters?.some((c) => c.id === id) ?? false;
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

	/** Hosts that run world verbs on the voice themselves should call this so think() cooldown sees them. */
	public noteVerb(verb:string):void {
		if (verb) {
			this._lastVerb = verb;
		}
	}

	/** The result of an arc that ran beside the voice's program. The next prompt shows it; only a failure calls for that think now. */
	public ingestBeside(result:ArcResult):void {
		this._replyTo = [];
		this.ingestResult(result, result.status !== 'ok');
	}

	/** The result of the arc this mind gave its voice, or of a failed think. The next prompt shows it. */
	public ingestResult(result:ArcResult, wake = true):void {
		this.lastResult = result;
		if (result.unreachable && result.verb) {
			this._noWay.add(`${result.verb} ${result.unreachable}`);
		}
		const walk = result.verb === 'go_to' ? ['go_to'] : [];
		if (result.status === 'stopped') {
			this.pushEvent({
				kind: 'Stopped',
				text: result.reason ?? 'stopped',
				tags: ['stopped', ...walk],
			});
		}
		else {
			// What happened in the world is worth keeping; how its own think went (a bad reply) is not, nor a way
			// found blocked: that holds only until the way opens, and `_noWay` already asks the live world. Nor who
			// heard a line: the line is in the conversation already.
			// A walk or a line stays off the recent lines: the next prompt still has this result once, as Last verb result.
			const said = result.verb === 'say' ? ['said'] : [];
			this.pushEvent({
				kind: 'arc_result',
				text: result.reason ?? (result.status === 'ok' ? 'ok' : 'failed'),
				tags: [result.status === 'ok' ? 'ok' : 'fail', ...walk, ...said],
				remember: result.verb !== 'think' && result.verb !== 'say' && !result.unreachable,
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
	public ingestLawResult(law:string, result:ArcResult):void {
		const outcome = result.status === 'ok' ? 'ran' : result.status;
		const text = `Law ${law} ${outcome}${result.reason ? `: ${result.reason}` : ''}`;
		const i = this._lawResults.findIndex((line) => line.replace(/ ×\d+$/, '') === text);
		const times = i < 0 ? 1 : Number(/ ×(\d+)$/.exec(this._lawResults[i])?.[1] ?? 1) + 1;
		const lines = [...this._lawResults.filter((_, j) => j !== i), times > 1 ? `${text} ×${times}` : text];
		const keep = Math.max(0, this.setting('lawResults'));
		this.rememberLaws(lines.slice(0, Math.max(0, lines.length - keep)));
		this._lawResults = lines.slice(lines.length - keep);
	}

	/** Law results no prompt pins any more, as long-term memories. */
	private rememberLaws(lines:readonly string[]):void {
		for (const text of lines) {
			this.persona.memory.add({ category: 'episodic', text, tags: ['law'], timestamp: this._now }, this._now);
		}
	}

	/** The voice began an arc. */
	public arcStarted(arc:Arc):void {
		this._replyTo = [];
		this.queue?.beginArc(this.id, arc);
	}

	/** The voice's arc stopped or parked. */
	public arcEnded():void {
		this.queue?.endArc(this.id);
	}

	/**
	 * After the arc, wait for anyone a `reply` step named, when they are still nearby.
	 * The wait is at the end, so `give(...) && say(...)` still runs the say. A step that names no character waits for no one.
	 */
	public async afterArc(result:ArcResult, voice:ArcRunner<TCtx>):Promise<void> {
		const who = result.status === 'stopped' ? [] : this.nearbyReply(voice);
		this._replyTo = [];
		if (who.length > 0 && voice.execute) {
			await voice.execute({ verb: 'wait', args: { seconds: 20, reply: who.length === 1 ? who[0] : who } }, voice.context());
		}
	}

	/** A finished `reply` step. Remember the characters it named; the wait happens when the arc ends. */
	public noteReply(step:Step, result:ArcResult, voice:ArcRunner<TCtx>):void {
		// A line to a group, like one to no one, waits for no answer.
		if (result.status !== 'ok' || !voice.verbs.get(step.verb)?.reply || groupTargets(step, voice.verbs)) {
			return;
		}
		for (const id of idTargets(step, voice)) {
			if (!this._replyTo.includes(id)) {
				this._replyTo.push(id);
			}
		}
	}

	/** Reply targets from this arc who are still close enough to answer. */
	private nearbyReply(voice:ArcRunner<TCtx>):string[] {
		if (this._replyTo.length === 0) {
			return [];
		}
		const near = voice.talk ? new Set(voice.talk.nearby(voice.id)) : otherCharacters(voice);
		return this._replyTo.filter((id) => near.has(id));
	}

	public async remember(text:string, tags:string[] = [], timestamp = this._now):Promise<MemoryRecord> {
		let embedding:number[] | undefined;
		if (this.embed) {
			try {
				const [vec] = await this.embed([text]);
				embedding = vec;
			}
			catch {
				embedding = undefined;
			}
		}
		return this.persona.memory.add({
			category: 'semantic',
			text,
			tags: mergeTags(tags, nameTags(text)),
			timestamp,
			embedding,
		}, timestamp);
	}

	/** The voice's id: the character that acts and speaks for this mind, or the collective's own id while it has no commander. */
	public thinkThread():string {
		return this._owner?.voice.id ?? this._id;
	}

	/** Cancel this mind's in-flight think. */
	public abortThink():void {
		this.queue?.abortThink(this.id);
	}

	/**
	 * One tactical think, ignoring heartbeat. Occupies the think slot so a
	 * queued tick cannot start another. `enact` defaults to `autoEnact`. `now` is game time.
	 */
	public async thinkNow(opts:{ now?:number; about?:string; enact?:boolean } = {}):Promise<Arc | null> {
		if (opts.now !== undefined) {
			this._now = opts.now;
		}
		this.owner.refreshKit();
		this.absorbPending();
		if (opts.about !== undefined) {
			const about = opts.about.replace(/\s+/g, ' ').trim();
			this._pendingAbout = about.length > 0 ? about : undefined;
		}
		this.abortThink();
		return this.withThinkSlot(opts.enact ?? this.autoEnact, () => this.tactical());
	}

	public async tick(gameTime:number):Promise<Arc | null> {
		this._now = gameTime;
		this.owner.refreshKit();
		this.absorbPending();
		const strategic = this.strategicDue(gameTime);
		const tactical = this.tacticalDue(gameTime);
		if (!strategic && !tactical) {
			return null;
		}
		return this.withThinkSlot(this.autoEnact, async (signal) => {
			if (strategic) {
				await this.reviseGoals();
				this.lastStrategicTimestamp = gameTime;
			}
			if (!tactical || signal?.aborted) {
				return null;
			}
			return this.tactical();
		});
	}

	private async withThinkSlot(
		enact:boolean,
		body:(signal:AbortSignal | undefined)=>Promise<Arc | null>,
	):Promise<Arc | null> {
		const signal = this.queue?.beginThink(this.id);
		let arc:Arc | null = null;
		let error:string | undefined;
		this._thinkingAs = this.thinkThread();
		this.showThink({ kind: 'start' });
		try {
			if (signal?.aborted) {
				return null;
			}
			arc = await body(signal);
			if (signal?.aborted || !arc) {
				return null;
			}
			this._pendingAbout = undefined;
			this.lastArc = arc;
			this.onChoose?.(arc);
			this.lastTacticalTimestamp = this._now;
			this.capturePrevMe();
			// Only what this think read. Events that came in while the model answered (a gift, a reply) wait for the next one.
			this._pendingEvents.splice(0, this._recentAbsorbed);
			this._recentAbsorbed = 0;
		}
		catch (err) {
			if (signal?.aborted) {
				return null;
			}
			this.lastTacticalTimestamp = this._now;
			this.capturePrevMe();
			error = err instanceof Error ? err.message : String(err);
			throw err;
		}
		finally {
			this.queue?.endThink(this.id, signal);
			this.showThink({ kind: 'end', arc: signal?.aborted ? undefined : arc ?? undefined, error });
		}
		if (signal?.aborted) {
			return null;
		}
		if (arc && enact && this.voice.execute) {
			await this.voice.enact(arc);
		}
		return arc;
	}

	public toJSON():MindJSON {
		return {
			settings: { ...this.settings },
			events: this._pendingEvents.map((e) => ({ ...e, tags: e.tags ? [...e.tags] : undefined })),
			lastArc: this.lastArc,
			lastResult: this.lastResult ? { ...this.lastResult } : undefined,
			lastTacticalTimestamp: Number.isFinite(this.lastTacticalTimestamp) ? this.lastTacticalTimestamp : undefined,
			lastStrategicTimestamp: Number.isFinite(this.lastStrategicTimestamp) ? this.lastStrategicTimestamp : undefined,
			lastIntrusionTimestamp: Number.isFinite(this.lastIntrusionTimestamp) ? this.lastIntrusionTimestamp : undefined,
			recent: [...this._recent],
			recentSummary: this._recentSummary || undefined,
			conversation: this._conversation.map((turn) => ({ ...turn })),
			thinkAbout: this._pendingAbout,
			lastVerb: this._lastVerb,
		};
	}

	/** A saved mind, not yet attached to anyone. */
	public static fromJSON<TCtx>(json:MindJSON):Mind<TCtx> {
		const mind = new Mind<TCtx>(json.settings);
		mind.lastArc = isArc(json.lastArc) ? json.lastArc : undefined;
		mind.lastResult = json.lastResult;
		mind.lastTacticalTimestamp = json.lastTacticalTimestamp ?? Number.NEGATIVE_INFINITY;
		mind.lastStrategicTimestamp = json.lastStrategicTimestamp ?? 0;
		mind.lastIntrusionTimestamp = json.lastIntrusionTimestamp ?? Number.NEGATIVE_INFINITY;
		mind._pendingEvents.push(...json.events ?? []);
		mind._recent = json.recent ? [...json.recent] : [];
		mind._recentSummary = json.recentSummary ?? '';
		mind._conversation = (json.conversation ?? []).map((turn) => ({ ...turn }));
		mind._recentAbsorbed = mind._pendingEvents.length;
		mind._pendingAbout = json.thinkAbout;
		mind._lastVerb = json.lastVerb;
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
		if (this.setting('heartbeat') <= 0) {
			return true;
		}
		return gameTime - this.lastTacticalTimestamp >= this.setting('heartbeat');
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
	private async reviseGoals():Promise<void> {
		const format = this.arcFormat;
		const system = stablePrefix(this.id, this.persona.identity, this.owner.activeVerbs(), {
			includeWatches: true,
			omitArc: true,
			systemNote: this.setting('systemNote'),
			style: this.thinksWith.promptStyle,
		});
		const user = `${volatileBlock({
			goals: this.persona.goals,
			pinned: this.persona.memory.pinned(),
			recalled: this.recallForPrompt(),
			recent: this._recent,
			recentSummary: this._recentSummary,
			conversation: this.conversationLines(),
			compact: this.compact,
		})}\n\n${reviseGoalsAsk(format, this.persona.maxGoals)}`;
		const ask = (messages:ChatMessage[], thinking?:boolean):Promise<ChatResponse> => this.thinksWith.provider.chat({
			model: this.thinksWith.id,
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
				this.persona.applyIdentityPatch(raw.identity, this.id, this._now);
			}
			if (Array.isArray(raw.goals)) {
				this.persona.applyGoalList(raw.goals);
			}
		}
		catch {
			return;
		}
	}

	/** The owner's own block, or the laws and what just came into the voice's hands. */
	private extraVolatile():string {
		const section = this.owner.promptSection?.(this);
		if (section !== undefined) {
			return section;
		}
		return [this.lawsSection(), this.receivedSinceThink()].filter(Boolean).join('\n\n');
	}

	/**
	 * The program its own body runs now, for a mind that is no commander (a commander's roster shows its units'), and the
	 * reply that keeps it: `pass()` is free, so it runs beside the program instead of replacing it.
	 */
	private ownProgram():{ steps:string; keep:string } | undefined {
		const voice = this.voice;
		const state = voice.programState();
		if (this.owner.promptSection || !state?.running || !voice.activeVerbs().has(PASS_VERB)) {
			return undefined;
		}
		// One marker: the step it is on, a `when`'s over the program's it holds.
		const mark = state.marks.at(-1);
		const { lines, at } = this.programLines(state.arc, mark?.step, voice.verbs);
		const note = mark && (mark.heldBy ? `⏸ while ${this.holderText(mark.heldBy)} runs` : `← now, ${mark.seconds}s`);
		const file = { path: 'program.arc', who: '', lines, marks: new Map(at < 0 || !note ? [] : [[at, note]]), running: true, seconds: state.seconds, endings: [] };
		return { steps: programFiles([file]), keep: this.shownSteps([{ verb: PASS_VERB, args: {} }], voice.verbs, this.arcFormat) };
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

	/**
	 * The owner's laws in list order, as this mind's model reads them: sentences, not arcs, so a small model does
	 * not copy them back as its reply. `running`: by law name, who runs it now and at what step (`for Tom: flee(Wolf)`).
	 */
	/** Whether this mind's model is told only what its game makes its own: see {@link PromptStyle}. */
	public get compact():boolean {
		return this.thinksWith.promptStyle === 'compact';
	}

	public lawsSection(running:ReadonlyMap<string, string> = new Map()):string {
		const laws = this.owner.laws;
		if (laws.length === 0) {
			return '';
		}
		const line = (law:Law):string => {
			const who = this.owner.lawsTakeWho() && law.who !== 'me' ? ` (for ${this.named(law.who)})` : '';
			const times = law.times === undefined ? '' : `, times=${law.times}`;
			const until = law.until ? `, until ${this.named(law.until)}` : '';
			// A sentence, never `name: arc`: a model copies what reads as Arc text back into its reply, `Tom.` included.
			const name = mapLawName(law.name, namesOf(this.persona.names));
			const group = lawGroup(name);
			const label = group ? `${name.slice(group.length + 1)}, ${group}'s own` : name;
			const now = running.has(law.name) ? `; running ${running.get(law.name)}` : '';
			return `- ${label}${who}: when ${this.named(law.watch)}, it runs ${this.namedArc(law.arc)}${times}${until}${now}`;
		};
		// One of a character's own goes by its whole name: say so, with a real one, only where there is one.
		const owned = laws.map((law) => mapLawName(law.name, namesOf(this.persona.names))).find((name) => lawGroup(name));
		const unlaw = owned ? `unlaw(name) drops one, unlaw(${owned}) ${lawGroup(owned)}'s own` : 'unlaw(name) drops one';
		const intro = this.compact ? 'Laws:' : `Laws (emergencies that already run on their own, first listed first; do not repeat them in your reply; ${unlaw}):`;
		return `${intro}\n${laws.map(line).join('\n')}`;
	}

	private receivedSinceThink():string {
		const voice = this.voice;
		const me = this.knowledge && voice.prevMe ? voice.catalog?.()?.me : undefined;
		if (!me || !voice.prevMe) {
			return '';
		}
		const pages = knowledgePages(this.knowledge, this.worldContext());
		if (pages.length === 0) {
			return '';
		}
		const prev = new Set(bagOf(voice.prevMe).map((item) => item.id));
		const gained = bagOf(me).filter((item) => !prev.has(item.id));
		const articles = receivedArticles(pages, gained);
		return articles ? `What you know about what you just received:\n${articles}` : '';
	}

	/**
	 * The earlier line that already said most of `text`, when everyone it is meant for (the addressees, or
	 * everyone in earshot) heard it clearly. Telling someone new, or adding something, is fine.
	 */
	private alreadySaid(text:string, args:Step['args']):string | undefined {
		const gist = gistOf(text);
		if (gist.size < 3 || !this.talk) {
			return undefined;
		}
		const meantFor = [sayToOf(args) ?? this.talk.nearby(this.thinkThread())].flat();
		return this._said.find((line) => {
			const shared = [...gist].filter((w) => line.gist.has(w)).length;
			return shared / gist.size >= REPEAT_OVERLAP
				&& meantFor.length > 0 && meantFor.every((id) => line.heard.has(id));
		})?.text;
	}

	/**
	 * Articles for names said or heard lately: talk carries the outside facts a mind lacks, while its own
	 * reasoning would only feed its fixation. Item articles always say whether this mind carries one.
	 * The article text itself is not repeated within a few thinks.
	 */
	private mentionedText():string {
		const talked = [...this._recent, ...this.conversationLines()].join('\n');
		const ctx = this.knowledge && this._mentionCap > 0 && talked.trim() ? this.worldContext() : undefined;
		if (!this.knowledge || ctx === undefined) {
			return '';
		}
		const me = this.voice.catalog?.()?.me;
		const bag = me ? bagOf(me) : undefined;
		const lines:string[] = [];
		for (const entry of mentionedArticles(knowledgePages(this.knowledge, ctx), talked, Infinity)) {
			if (lines.length >= this._mentionCap) {
				break;
			}
			const name = entry.name.trim();
			const carried = entry.item && bag ? ` (${isAboutItem(entry, bag) ? 'you carry one' : 'you carry none'})` : '';
			if (this._thinks - (this._mentionedOn.get(name) ?? -Infinity) > MENTION_REPEAT) {
				this._mentionedOn.set(name, this._thinks);
				lines.push(`- ${name}${carried}: ${entry.text.trim()}`);
			}
			else if (carried) {
				lines.push(`- ${name}${carried}.`);
			}
		}
		return lines.join('\n');
	}

	/**
	 * Articles for what stopped the last verb. A small model looks up its goal, not its obstacle;
	 * this does the obstacle's lookup for it, when it is stuck on it and only then.
	 */
	private failureArticles():string {
		const reason = this.lastResult && this.lastResult.status !== 'ok' ? this.lastResult.reason : undefined;
		const ctx = reason ? this.worldContext() : undefined;
		if (!reason || !this.knowledge || ctx === undefined) {
			return '';
		}
		return articlesNamedIn(knowledgePages(this.knowledge, ctx), reason);
	}


	private gatherSensed():Record<string, unknown> {
		const ctx = this.voice.context();
		const sensed:Record<string, unknown> = {};
		for (const [name, sense] of Object.entries(this.senses)) {
			if (!this.senseAllowed(name)) {
				continue;
			}
			try {
				sensed[name] = sense.gather(ctx as TCtx);
			}
			catch {
				continue;
			}
		}
		if (this.talk && this.voice.embodied) {
			sensed.earshot = this.earshotText();
		}
		return sensed;
	}

	private volatileUser(sensed:Record<string, unknown>, extra?:string):string {
		const perceptionText = Object.values(sensed)
			.map((v) => typeof v === 'string' ? v : JSON.stringify(v))
			.join('\n');
		const intrusion = this.maybeIntrude(perceptionText);
		this.noteSeen();
		const recalled = this.recallForPrompt(perceptionText);
		return [extra, volatileBlock({
			senses: sensed,
			intrusion,
			lastResult: this.lastResult,
			lastResultArticles: this.failureArticles(),
			goals: this.persona.goals,
			pinned: [...this.persona.memory.pinned(), ...this._lawResults.map((text) => ({ text }))],
			recalled,
			watches: this.namedWatches(this.persona.watches),
			pinnedWatches: this.namedWatches(this.persona.pinnedWatches),
			watchesWritable: this.owner.activeVerbs().has('watch'),
			pinnedSightFocus: this.persona.pinnedSightFocus.map((e) => this.named(e)),
			sightFocus: this.persona.sightFocus.map((e) => this.named(e)),
			sightFocusWritable: this.owner.activeVerbs().has('focus'),
			recent: this._recent,
			recentSummary: this._recentSummary,
			conversation: this.conversationLines(),
			mentioned: this.mentionedText(),
			offers: this.offers?.(),
			thinkAbout: this._pendingAbout,
			program: this.ownProgram(),
			compact: this.compact,
		}), this.extraVolatile()].filter(Boolean).join('\n\n');
	}

	private namedWatches(watches:Watches):Watches {
		return Object.fromEntries(Object.entries(watches).map(([name, expr]) => [name, this.named(expr)]));
	}

	/** The reply as an arc in ids. Throws on a watch that calls a function the watch language does not have: it could never hold. */
	private readArc(content:string, verbs:VerbRegistry):Arc {
		const arc = this.inIDs(parseArc(content, verbs), verbs);
		const problem = this.problemIn(arc, verbs);
		if (problem) {
			throw problem;
		}
		return arc;
	}

	/** An arc as a reply wrote it, as it is kept: in ids, with its tests of what things are in the language's own form. */
	private inIDs(arc:Arc, verbs:VerbRegistry):Arc {
		const catalog = this.voice.catalog?.();
		const hasField = (name:string):boolean => !!catalog && catalogEntities(catalog).some((entity) => entity.fields?.[name] !== undefined);
		const plain = mapArgs(arc, verbs, (text, kind) => (['watch', 'expr', 'id'].includes(kind) ? plainTagTests(text, hasField) : text));
		return mapArc(deferThinks(plain), verbs, idsOf(this.persona.names));
	}

	/** Why `arc`, in ids, could never work as written, if it could not. */
	private problemIn(arc:Arc, verbs:VerbRegistry):ArcError | undefined {
		const catalog = this.voice.catalog?.();
		const unbound = catalog ? exprArgs(arc, verbs).flatMap((expr) => unboundCalls(expr, catalog)) : [];
		if (unbound.length > 0) {
			return new ArcError(`${unbound.map((name) => `${name}()`).join(', ')} is not a watch function`);
		}
		// With no repair turn to send it back on, it runs as written and its verbs say what went wrong.
		if (this.setting('repairRetries') === 0) {
			return undefined;
		}
		return this.fewChoices(arc, verbs) ?? this._arcProblem?.(arc);
	}

	/** Why a `choose` in `arc` has too few choices to be worth asking about, if one has. */
	private fewChoices(arc:Arc, verbs:VerbRegistry):ArcError | undefined {
		const least = this.setting('minChoices');
		let found:number | undefined;
		eachStep(arc, verbs, (step) => {
			const count = Object.keys(choicesOf(step)).length;
			if (step.verb === CHOOSE_VERB && count < least) {
				found ??= count;
			}
		});
		return found === undefined ? undefined : new ArcError(`choose needs at least ${least} choices, one for each way things may go: this one has ${found}`);
	}

	/**
	 * The reply's root steps in ids, each read on its own where the whole does not read; `reason` on those that do not.
	 * Throws when the reply gives no steps to read, as when its JSON is broken.
	 */
	private readRoots(content:string, verbs:VerbRegistry):{ steps:Arc; unread:{ label:string; reason:string }[] } {
		try {
			return { steps: this.inIDs(parseArc(content, verbs), verbs), unread: [] };
		}
		catch (err) {
			let raw:unknown;
			try {
				raw = extractJson(content);
			}
			catch {
				throw err;
			}
			if (!isRecord(raw) || !Array.isArray(raw.steps)) {
				throw err;
			}
			const steps:Arc = [];
			const unread:{ label:string; reason:string }[] = [];
			for (const step of raw.steps) {
				try {
					steps.push(...this.inIDs(parseArc(JSON.stringify({ steps: [step] }), verbs), verbs));
				}
				catch (bad) {
					unread.push({ label: isRecord(step) && typeof step.verb === 'string' ? step.verb : 'a step', reason: bad instanceof Error ? bad.message : String(bad) });
				}
			}
			return { steps, unread };
		}
	}

	/**
	 * What a reply comes to when its steps are judged apart, given those already `kept`. A step that needs no body, and is
	 * not joined to one that does, stands alone: it can fail while others run. The rest are one chain that stands or falls
	 * together.
	 */
	private judgeSteps(content:string, verbs:VerbRegistry, kept:Arc):{ good:Arc; bad:{ label:string; reason:string }[] } {
		const { steps, unread } = this.readRoots(content, verbs);
		const free = (step:Step | undefined):boolean => !!step && (step.verb === 'when' || !!verbs.get(step.verb)?.free);
		const alone = (step:Step, i:number):boolean => free(step)
			&& (i === 0 || free(steps[i - 1]) || steps[i - 1].then === 'always')
			&& (i === steps.length - 1 || free(steps[i + 1]) || step.then === 'always');
		const good:Arc = [];
		const bad = [...unread];
		const chain = steps.filter((step, i) => !alone(step, i));
		const labelOf = (step:Step):string => {
			const name = typeof step.args.name === 'string' ? ` named ${step.args.name}` : typeof step.args.who === 'string' ? ` for ${step.args.who}` : '';
			return `${step.verb}${name}`;
		};
		steps.forEach((step) => {
			if (chain.includes(step)) {
				return;
			}
			const reason = this.problemIn([...kept, ...good, step], verbs)?.message;
			if (reason) {
				bad.push({ label: labelOf(step), reason });
			}
			else {
				good.push(step);
			}
		});
		if (chain.length > 0) {
			const reason = this.problemIn([...kept, ...good, ...chain], verbs)?.message;
			if (reason) {
				bad.push({ label: chain.map(labelOf).join(' then '), reason });
			}
			else {
				good.push(...chain);
			}
		}
		// Judged apart, they still run in the order the reply wrote them: a deferred think stays last.
		return { good: steps.filter((step) => good.includes(step)), bad };
	}

	/** Steps as the model writes them, in its names. */
	public shownSteps(arc:Arc, verbs:VerbRegistry, format:ArcFormat):string {
		const named = mapArc(arc, verbs, namesOf(this.persona.names));
		return format === 'text' ? formatArcBlocks(named, verbs) : arcJSONBlocks(named, verbs);
	}

	/** The reply as an arc, or null when it is empty or does not read. */
	private parseArcContent(content:string, verbs:VerbRegistry):Arc | null {
		try {
			const arc = content.trim() ? this.readArc(content, verbs) : undefined;
			return arc && firstStep(arc)?.verb ? arc : null;
		}
		catch {
			return null;
		}
	}

	private async settleLiveArc(
		arc:Arc,
		firstContent:string | null,
		messages:ChatMessage[],
		verbs:VerbRegistry,
		liveVerbAtThink:string | undefined,
		sendTools:boolean,
		tools:ToolDef[],
	):Promise<Arc> {
		if (!liveVerbAtThink || !this.voice.liveArc || this._lastVerb === liveVerbAtThink) {
			return arc;
		}
		const format = this.arcFormat;
		const schema = format === 'schema';
		const form = format === 'text' ? 'Arc text' : 'Arc JSON';
		const hint = `While you thought, the live verb changed from ${liveVerbAtThink} to ${this._lastVerb}. `
			+ (schema
				? 'Do not think again. Reply with new steps if that changes your choices, or repeat the steps you already wrote to keep them.'
				: `Do not think again. Emit a new ${form} if that changes your choices, or confirm the arc you already wrote.`);
		messages.push({ role: 'assistant', content: firstContent });
		messages.push({ role: 'user', content: hint });
		const res = await this.thinksWith.provider.chat({
			model: this.thinksWith.id,
			thread: this.id,
			messages,
			tools: sendTools ? tools : undefined,
			toolChoice: sendTools ? 'none' : undefined,
			responseFormat: this.replyFormat(verbs, format),
			// "Confirm" cannot be written under a schema, so a reply there asks for the steps again, with no thought to fake.
			...(schema ? { enableThinking: false } : { fakeThought: true }),
		});
		// A tool call here, or no steps, keeps the arc already written.
		if (res.toolCalls.length > 0 || !res.content) {
			return arc;
		}
		return this.parseArcContent(res.content, verbs) ?? arc;
	}

	private async tactical():Promise<Arc> {
		const kept:Arc = [];
		try {
			return await this.writeArc(kept);
		}
		catch (err) {
			// Out of tries with some of it good: what is good runs, and the next think is told what did not.
			if (kept.length === 0 || !(err instanceof ArcError)) {
				throw err;
			}
			this.pushEvent({ kind: 'dropped', text: `Part of your last reply did not run: ${err.message}`, tags: ['fail'] });
			return kept;
		}
	}

	/** Asks the model until it has an Arc. `kept` collects the steps of a reply that stand while others go back. */
	private async writeArc(kept:Arc):Promise<Arc> {
		this._thinks += 1;
		const ctx = this.worldContext();
		this.owner.refreshKit();
		// A collective's arc orders its units: its commander's own next step leaves it no less true, so it is not asked again.
		const liveVerbAtThink = this.voice.liveArc && this.voice === this.owner ? this._lastVerb : undefined;
		// A repeat after new input (speech, an interruption, a nudge) can be right; without any, the model is stuck.
		const freshInput = this.hasFreshInput();
		const sensed = this.gatherSensed();
		const verbs = this.owner.activeVerbs();
		const format = this.arcFormat;
		const reply = this.replyFormat(verbs, format);
		// What a think may look up; under a schema the model calls it in its reply, so none are sent as native tools.
		const offered = this.setting('toolRounds') > 0 ? this.toolDefs() : [];
		const tools = reply ? [] : offered;
		const sendTools = tools.length > 0;
		const toolNames = offered.map((t) => t.name);
		const system = stablePrefix(this.id, this.persona.identity, this.owner.promptVerbs?.() ?? verbs, {
			includeWatches: this.persona.watchesWritable || watchCount(this.persona.watchList()) > 0,
			watchesWritable: verbs.has('watch'),
			canObserve: toolNames.includes('observe'),
			canSeeMap: toolNames.includes('see_map'),
			canRecallKnowledge: toolNames.includes('recall') && this.knowledge !== undefined,
			youSymbol: this.youSymbol(),
			arcFormat: this.arcFormat,
			thinkInstructions: this.setting('thinkInstructions'),
			thinking: this.thinksWith.thinking,
			verbInstructions: this.setting('verbInstructions'),
			arcExample: this.setting('arcExample'),
			systemNote: this.setting('systemNote'),
			currency: this.setting('currency'),
			minChoices: this.setting('minChoices'),
			tools: toolNames,
			style: this.thinksWith.promptStyle,
		});
		// Talking in circles: characters who hear each other keep answering, so a streak of talk ends in a deed.
		const user = this.volatileUser(sensed, this._talkStreak >= TALK_STREAK
			? `You have only talked or waited for ${this._talkStreak} thinks. Stop talking: take the next step toward your goal with a verb that does something. Look up what you lack with a tool instead of asking again.`
			: undefined);
		// This think has read its laws' results: from now on they are only remembered.
		this.rememberLaws(this._lawResults);
		this._lawResults = [];
		this.persona.memory.agePins();
		const messages:ChatMessage[] = [
			{ role: 'system', content: system },
			{ role: 'user', content: user },
		];
		let toolsLeft = offered.length > 0 ? this.setting('toolRounds') : 0;
		let repairsLeft = this.setting('repairRetries');
		// What it was told stands needs no second go.
		const keep = (steps:Arc):void => {
			kept.push(...steps.filter((step) => !kept.some((had) => sameProgram([had], [step]))));
		};
		/** Shows the model only what stands, and says in words what became of the rest. Throws when it has no tries left. */
		const sendBack = (failed:{ label:string; reason:string }[]):void => {
			const reason = failed.map((step) => `${step.label}: ${step.reason}`).join('; ');
			if (repairsLeft <= 0) {
				throw new ArcError(reason);
			}
			repairsLeft -= 1;
			this.showThink({ kind: 'retry', reason });
			messages.push({ role: 'assistant', content: this.shownSteps(kept, verbs, format) });
			messages.push({ role: 'user', content: partRepairHint(failed, verbs, format) });
		};
		let warnedRepeat = freshInput;
		let checksLeft = Math.max(1, this.setting('repairRetries'));
		let lastErr:Error | null = null;
		// A thought that never got to its Arc is asked for it once, whatever repairs are left.
		let askedForArc = false;
		// The repeat warning and that ask.
		const extraTurns = 2;
		const budget = toolsLeft + this.setting('repairRetries') + 1 + (this.talk ? 1 : 0) + extraTurns;
		for (let turn = 0; turn < budget; turn++) {
			const allowTools = toolsLeft > 0 && tools.length > 0;
			const stop = new AbortController();
			const streamed = { text: '' };
			let res:ChatResponse;
			try {
				res = await this.thinksWith.provider.chat({
					model: this.thinksWith.id,
					thread: this.id,
					messages,
					tools: sendTools ? tools : undefined,
					toolChoice: sendTools ? (allowTools ? 'auto' : 'none') : undefined,
					responseFormat: reply,
					// A repair keeps the whole conversation, so reasoning on top of it runs out of tokens again.
					enableThinking: repairsLeft < this.setting('repairRetries') || askedForArc ? false : this.thinksWith.thinking,
					signal: stop.signal,
					onDelta: this.replyWatch(verbs, stop, streamed),
				});
			}
			catch (err) {
				// Cut off for going wrong: it is told why, like any other bad reply.
				const reason:unknown = stop.signal.reason;
				if (!(reason instanceof ArcError)) {
					throw err;
				}
				lastErr = reason;
				// The root steps it had finished before it broke down are as good as any others. A chain may have gone on into
				// what broke, so it is written again.
				const finished = this.setting('repairPerStep') ? finishedSteps(streamed.text) : undefined;
				const judged = finished ? this.judgeSteps(finished, verbs, kept) : { good: [], bad: [] };
				const stands = judged.good.filter((step) => step.verb === 'when' || verbs.get(step.verb)?.free);
				if (stands.length + kept.length > 0) {
					keep(stands);
					sendBack([...judged.bad, { label: 'the rest of your reply', reason: lastErr.message }]);
					continue;
				}
				if (!this.pushRepair(messages, { content: null, toolCalls: [] }, lastErr, repairsLeft, toolNames, format)) {
					throw lastErr;
				}
				repairsLeft -= 1;
				continue;
			}
			// Whole, for a server that does not stream.
			if (this._thinkWatch?.()) {
				this.showThink({ kind: 'reply', thought: res.reasoning ?? '', arc: arcSoFar(res.content ?? '', verbs) ?? '' });
			}
			// The thinking budget cut the thought short: answer from it, without thinking again.
			if (res.truncated && !res.content && res.reasoning && repairsLeft > 0) {
				messages.push({ role: 'assistant', content: res.reasoning });
				messages.push({ role: 'user', content: thoughtCutHint(format) });
				repairsLeft -= 1;
				continue;
			}
			if (res.truncated) {
				lastErr = new ArcError('reply was cut off at the token limit; answer shorter');
				if (!this.pushRepair(messages, { content: null, toolCalls: [] }, lastErr, repairsLeft, toolNames, format)) {
					throw lastErr;
				}
				repairsLeft -= 1;
				continue;
			}
			if (res.toolCalls.length > 0 && allowTools) {
				messages.push({
					role: 'assistant',
					content: res.content,
					toolCalls: res.toolCalls,
				});
				for (const call of res.toolCalls) {
					messages.push({ role: 'tool', content: await this.lookUp(call.name, call.arguments, ctx), toolCallID: call.id });
					this.pushMapImage(messages);
				}
				toolsLeft -= 1;
				continue;
			}
			// A tool written where the Arc goes, or in a thought that never got to the Arc, is the call the model meant: run
			// it, or drop it from an Arc beside it.
			const thought = !res.content && res.reasoning ? writtenToolCalls(res.reasoning, toolFirstArgs(tools)) : undefined;
			const written = format === 'text' && res.content ? writtenToolCalls(res.content, toolFirstArgs(tools)) : thought;
			if (written && written.calls.length > 0 && (!written.rest || thought) && allowTools) {
				messages.push({ role: 'assistant', content: res.content });
				const results:string[] = [];
				for (const call of written.calls) {
					results.push(`${call.name}: ${await this.lookUp(call.name, JSON.stringify(call.args), ctx)}`);
				}
				this.pushMapImage(messages);
				messages.push({ role: 'user', content: writtenToolsHint(results, format) });
				toolsLeft -= 1;
				continue;
			}
			// A tool called in the reply's own JSON: look it up and answer with what it says. A tool this mind lacks, or one past the cap, is a repair.
			const called = format === 'text' || !res.content ? undefined : jsonToolCall(res.content);
			if (called) {
				if (!toolNames.includes(called.name) || toolsLeft <= 0) {
					lastErr = new ArcError(toolNames.includes(called.name) ? `no lookups left: ${called.name} was your last` : `${called.name} is not a tool you have`);
					if (!this.pushRepair(messages, res, lastErr, repairsLeft, toolNames, format)) {
						throw lastErr;
					}
					repairsLeft -= 1;
					continue;
				}
				messages.push({ role: 'assistant', content: res.content });
				const result = await this.lookUp(called.name, JSON.stringify(called.args), ctx);
				toolsLeft -= 1;
				messages.push({ role: 'user', content: this.withMapImage(toolResultHint(called.name, result, toolsLeft <= 0, this.compact)) });
				continue;
			}
			const content = (res.content && written?.rest) || res.content;
			if (res.toolCalls.length > 0) {
				lastErr = new ArcError('model called a tool when it must emit an Arc');
				if (!this.pushRepair(messages, res, lastErr, repairsLeft, toolNames, format)) {
					throw lastErr;
				}
				repairsLeft -= 1;
				continue;
			}
			if (content) {
				let arc:Arc;
				try {
					if (this.setting('repairPerStep')) {
						const { good, bad } = this.judgeSteps(content, verbs, kept);
						if (bad.length > 0 && good.length + kept.length === 0) {
							throw new ArcError(bad[0].reason);
						}
						if (bad.length > 0) {
							keep(good);
							sendBack(bad);
							continue;
						}
						// "Leave them out" adds nothing.
						keep(good.filter((step) => kept.length === 0 || step.verb !== 'wait' || Object.keys(step.args).length > 0));
						arc = [...kept];
					}
					else {
						arc = this.readArc(content, verbs);
					}
				}
				catch (err) {
					lastErr = err instanceof Error ? err : new ArcError(String(err));
					// The world moved under the reply: a repair turn would show the model the old world again.
					if (lastErr instanceof BlockedArcError || !this.pushRepair(messages, res, lastErr, repairsLeft, toolNames, format)) {
						throw lastErr;
					}
					repairsLeft -= 1;
					continue;
				}
				if (!warnedRepeat && this.isRepeat(content) && !this.supervising(arc)) {
					warnedRepeat = true;
					this._emitStreak += 1;
					this.showThink({ kind: 'retry', reason: 'the same Arc as last time' });
					messages.push({ role: 'assistant', content });
					messages.push({ role: 'user', content: repeatOutputHint(this._emitStreak, format) });
					continue;
				}
				const blocked = this.unreachableSay(arc);
				const again = blocked ? undefined : this.blockedAgain(arc);
				if (blocked || again) {
					lastErr = new BlockedArcError(blocked?.reason ?? again!);
					if (checksLeft <= 0) {
						throw lastErr;
					}
					checksLeft -= 1;
					this.showThink({ kind: 'retry', reason: lastErr.message });
					messages.push({ role: 'assistant', content });
					messages.push({ role: 'user', content: blocked ? sayRangeHint(blocked.reason, blocked.nearby, format) : blockedAgainHint(again!, format) });
					continue;
				}
				this.acceptEmit(content);
				this._talkStreak = !this.supervising(arc) && arcSteps(arc).every((step) => TALK_VERBS.has(step.verb)) ? this._talkStreak + 1 : 0;
				const settled = await this.settleLiveArc(
					arc,
					content,
					messages,
					verbs,
					liveVerbAtThink,
					sendTools,
					tools,
				);
				return this.askReplace(settled, content, messages);
			}
			lastErr = new ArcError('model returned no arc');
			if (!askedForArc) {
				askedForArc = true;
				this.showThink({ kind: 'retry', reason: lastErr.message });
				messages.push({ role: 'assistant', content: null });
				messages.push({ role: 'user', content: 'Emit the Arc now.' });
				continue;
			}
			if (!this.pushRepair(messages, res, lastErr, repairsLeft, toolNames, format)) {
				throw lastErr;
			}
			repairsLeft -= 1;
		}
		throw lastErr ?? new ArcError('failed to obtain Arc');
	}

	/**
	 * `arc` as the model still wants it, once asked about any unfinished work it would cut short: a follow-up to the
	 * think just had, so it costs a few tokens on top of what the server has cached. Each name is replaced or kept only
	 * if the reply says exactly that; anything else, a reply that does not read or never comes too, appends: nothing is
	 * lost either way.
	 */
	private async askReplace(arc:Arc, content:string, messages:ChatMessage[]):Promise<Arc> {
		const cut = this._replacing?.(arc) ?? [];
		if (cut.length === 0) {
			return arc;
		}
		const names = new Map(cut.map((line) => [this.nameOf(line.id), line.id]));
		this.showThink({ kind: 'retry', reason: `would cut short ${[...names.keys()].join(', ')}` });
		const json = this.arcFormat === 'schema';
		let said:unknown;
		try {
			const res = await this.thinksWith.provider.chat({
				model: this.thinksWith.id,
				thread: this.id,
				messages: [
					...messages,
					{ role: 'assistant', content },
					{ role: 'user', content: replaceAsk(cut.map((line) => ({ ...line, name: this.nameOf(line.id) })), json) },
				],
				responseFormat: json
					? { name: 'replace', schema: { type: 'object', additionalProperties: false, required: [...names.keys()], properties: Object.fromEntries([...names.keys()].map((name) => [name, { enum: ['replace', 'append', 'keep'] }])) }, strict: true }
					: undefined,
				enableThinking: false,
			});
			said = extractJson(res.content ?? '');
		}
		catch {
			said = undefined;
		}
		const answered = (answer:string):string[] => [...names].filter(([name]) => isRecord(said) && said[name] === answer).map(([, id]) => id);
		const replace = answered('replace');
		const keep = answered('keep');
		return this.settled(arc, keep, [...names.values()].filter((id) => !replace.includes(id) && !keep.includes(id)));
	}

	/**
	 * `arc` with `kept` left at what they are doing and `appended` given it after that: its orders say so, and what would
	 * take its voice's body is dropped, or added to the voice's program (it runs now if that program has just ended).
	 */
	private settled(arc:Arc, kept:readonly string[], appended:readonly string[]):Arc {
		if (kept.length === 0 && appended.length === 0) {
			return arc;
		}
		const voice = this.voice;
		const body = arc.filter((step) => !voice.takesNoBody([step]));
		const aside = kept.includes(voice.id) || (appended.includes(voice.id) && voice.append(body));
		const left = arc
			.filter((step) => !aside || !body.includes(step))
			.map((step) => (step.verb === 'command' ? { ...step, args: { ...step.args, keep: [...kept], append: [...appended] } } : step));
		return left.length > 0 ? left : [{ verb: 'wait', args: {}, granted: true }];
	}

	/**
	 * Tells this mind's watcher, if any, how its think goes, in the name of whoever it began for: a commander may die mid-
	 * think, and every event of one think must reach the one watching it, its end above all.
	 */
	private showThink(event:ThinkEventFor):void {
		this._thinkWatch?.()?.({ ...event, who: this._thinkingAs } as ThinkEvent);
	}

	/**
	 * Follows the reply to one request as its pieces come in: tells this mind's watcher, if any, how it is going, and
	 * ends the request through `stop` the moment the reply can no longer become an Arc.
	 */
	private replyWatch(verbs:VerbRegistry, stop:AbortController, written:{ text:string }):(delta:ChatDelta)=>void {
		const breakdown = replyBreakdown(verbs);
		let thought = '';
		let arc = '';
		return ({ content, reasoning }) => {
			written.text += content ?? '';
			const why = content ? breakdown(content) : undefined;
			if (why) {
				stop.abort(new ArcError(why));
				return;
			}
			if (this._thinkWatch?.()) {
				thought += reasoning ?? '';
				arc = (content ? arcSoFar(written.text, verbs) : undefined) ?? arc;
				this.showThink({ kind: 'reply', thought, arc });
			}
		};
	}

	/** The schema the server must follow under `schema`; otherwise none, and the reply is parsed as written. */
	private replyFormat(verbs:VerbRegistry, format:ArcFormat):JsonSchemaResponseFormat | undefined {
		return format === 'schema' ? { name: 'reply', schema: replySchema(verbs.nested(), this.replyTools()), strict: true } : undefined;
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

	private pushRepair(
		messages:ChatMessage[],
		res:{ content:string | null; toolCalls:{ name:string }[] },
		err:Error,
		repairsLeft:number,
		toolNames:string[],
		format:ArcFormat,
	):boolean {
		if (repairsLeft <= 0) {
			return false;
		}
		this.showThink({ kind: 'retry', reason: err.message });
		// The bad reply itself is left out: a small model shown its own broken reply writes it again, word for word.
		const called = res.toolCalls.map((c) => c.name);
		messages.push({ role: 'assistant', content: called.length > 0 ? `(tool call: ${called.join(', ')})` : null });
		messages.push({ role: 'user', content: arcRepairHint(err.message, format, toolNames, this.owner.activeVerbs()) });
		return true;
	}







	private absorbPending():void {
		for (let i = this._recentAbsorbed; i < this._pendingEvents.length; i++) {
			const e = this.render(this._pendingEvents[i]);
			const text = e.text.trim();
			if (!text) {
				continue;
			}
			// go_to is a walk. It is not a line of chat, and it does not fill short-term or Current Conversation.
			const walk = e.tags?.includes('go_to') === true;
			if (e.kind === 'arc_result') {
				if (isBareResult(text)) {
					continue;
				}
				if (!walk && !e.tags?.includes('said')) {
					this.noteRecent(text);
				}
				if (e.remember) {
					this.keepFact(text, mergeTags(['result'], e.tags, nameTags(text)));
				}
				continue;
			}
			const who = this._pendingEvents[i].who ?? [];
			// A deed between one of its own and another, worth keeping (a gift, a trade), reads as part of the
			// conversation; a passing one (a blow in a fight) is only short-term memory.
			const betweenUs = !e.turn && e.remember === true && who.length >= 2 && who.some((id) => this.controls(id));
			// A walk with no spoken turn is not chat. Speech still is, even beside a walk tag.
			if (!(walk && !e.turn)) {
				if (betweenUs) {
					this.noteConversation({ speakerID: '', text });
				}
				else if (e.turn) {
					this.noteConversation(e.turn);
				}
				else {
					this.noteRecent(text);
				}
			}
			if (e.remember || (betweenUs && !walk)) {
				const tags = betweenUs ? mergeTags(e.tags, ['act'], nameTags(text)) : mergeTags(e.tags, nameTags(text));
				const rows = this.persona.memory.all();
				const last = rows[rows.length - 1];
				if (last?.text !== text) {
					this.persona.memory.add({
						category: 'episodic',
						text,
						tags,
						timestamp: e.timestamp ?? this._now,
					}, e.timestamp ?? this._now);
				}
			}
		}
		this._recentAbsorbed = this._pendingEvents.length;
	}

	/** Drops oldest messages past the letter budget. A cap of 0 still keeps the window's quarter, so raising it shows them. */
	private noteConversation(turn:ConversationTurn):void {
		const text = turn.text.trim().replace(/\s+/g, ' ');
		const last = this._conversation[this._conversation.length - 1];
		if (!text || (last?.speakerID === turn.speakerID && last.text === text)) {
			return;
		}
		this._conversation.push({ ...turn, text });
		const cap = this.setting('conversationCap');
		const budget = cap !== undefined && cap > 0 ? cap : conversationCapFor(this.thinksWith.contextTokens);
		const kept = this.turnsWithin(this._conversation, budget);
		const start = kept.length > 0 ? this._conversation.length - kept.length : this._conversation.length - 1;
		this._conversation.splice(0, Math.max(0, start));
	}

	/** The newest whole messages whose rendered lines fit in `cap` letters. */
	private turnsWithin(turns:readonly ConversationTurn[], cap:number):ConversationTurn[] {
		if (cap <= 0) {
			return [];
		}
		let used = 0;
		let start = turns.length;
		for (let i = turns.length - 1; i >= 0; i--) {
			const n = this.conversationLine(turns[i]).length;
			if (used + n > cap) {
				break;
			}
			used += n;
			start = i;
		}
		return turns.slice(start);
	}

	/** The turns Current Conversation shows, oldest first. */
	private shownTurns():ConversationTurn[] {
		const cap = this.setting('conversationCap') ?? conversationCapFor(this.thinksWith.contextTokens);
		return this.turnsWithin(this._conversation, cap);
	}

	/** `Me (to Forager): …`, `Forager (to you): …`, `Guard: …` to everyone. Each id is named as this mind knows it now. */
	private conversationLine(turn:ConversationTurn):string {
		if (!turn.speakerID) {
			return turn.text;
		}
		const speaker = this.isSelf(turn.speakerID) ? 'Me' : this.nameOf(turn.speakerID);
		const to = (turn.to ?? []).map((id) => this.isSelf(id) ? 'you' : this.nameOf(id));
		return `${speaker}${to.length > 0 ? ` (to ${to.join(', ')})` : ''}: ${turn.text}`;
	}

	private conversationLines():string[] {
		return this.shownTurns().map((turn) => this.conversationLine(turn));
	}

	private noteRecent(line:string):void {
		const text = line.trim();
		if (!text || this._recent[this._recent.length - 1] === text) {
			return;
		}
		this._recent.push(text);
		if (this._recent.length <= RECENT_CAP) {
			return;
		}
		const overflow = this._recent.splice(0, this._recent.length - RECENT_CAP);
		this._recentSummary = foldRecent(this._recentSummary, overflow);
	}

	private keepFact(text:string, tags:string[]):void {
		const line = text.trim();
		if (!line) {
			return;
		}
		const rows = this.persona.memory.all();
		if (rows[rows.length - 1]?.text === line) {
			return;
		}
		this.persona.memory.add({
			category: 'semantic',
			text: line,
			tags,
			timestamp: this._now,
		}, this._now);
	}

	/** One "Last I saw" memory per name its sight showed, kept to the latest clause it was seen in. */
	private noteSeen():void {
		const sightings = this._sighted.flatMap((clause) => clause.claimedIDs.map((name) => ({ name, snippet: clause.text.trim() })));
		this._sighted = [];
		for (const { name, snippet } of sightings) {
			if (this.isSelf(name) || !snippet) {
				continue;
			}
			const line = `Last I saw ${name}: ${snippet}`;
			const tag = `seen:${name}`;
			const existing = this.persona.memory.all().find((r) => r.category === 'semantic' && r.tags.includes(tag));
			if (existing) {
				if (existing.text !== line) {
					existing.text = line;
					existing.lastAccessed = this._now;
				}
				continue;
			}
			this.persona.memory.add({
				category: 'semantic',
				text: line,
				tags: mergeTags([tag, name, 'seen'], nameTags(snippet)),
				timestamp: this._now,
			}, this._now);
		}
	}

	private recallForPrompt(scene = ''):MemoryRecord[] {
		const query = [
			...this.persona.goals.map((g) => g.text),
			this._pendingAbout ?? '',
			...this._recent,
			this._recentSummary,
			...this.conversationLines(),
		].filter((s) => s.trim().length > 0).join(' ');
		if (!query.trim()) {
			return [];
		}
		const pinnedIds = new Set(this.persona.memory.pinned().map((r) => r.id));
		const recentSet = new Set(this._recent);
		// Speech and acts still in Current Conversation are already on screen.
		const shown = this.shownTurns();
		const quoting = shown.map((turn) => `"${turn.text}"`);
		const lines = new Set(shown.map((turn) => this.conversationLine(turn)));
		return this.persona.memory.recall({
			query,
			k: this.setting('recallK'),
			now: this._now,
			salience: this._salience,
			skip: (r) => {
				const onScreen = (r.tags.includes('speech') && quoting.some((quote) => r.text.endsWith(quote)))
					|| (r.tags.includes('act') && lines.has(r.text));
				if (r.pinned || pinnedIds.has(r.id) || recentSet.has(r.text) || onScreen) {
					return true;
				}
				const seen = r.tags.find((t) => t.startsWith('seen:') && t.length > 5);
				return !!seen && scene.includes(seen.slice('seen:'.length));
			},
		});
	}


	private maybeIntrude(perceptionText:string):string | undefined {
		if (this._now - this.lastIntrusionTimestamp < this.setting('intrusionCooldown')) {
			return undefined;
		}
		const tags = this._pendingEvents.flatMap((e) => this.render(e).tags ?? []);
		const hit = this.persona.memory.intrusion({
			query: perceptionText,
			now: this._now,
			tags,
			threshold: this.setting('intrusionThreshold'),
		});
		if (!hit || hit.tags.includes('seen')) {
			return undefined;
		}
		this.lastIntrusionTimestamp = this._now;
		return hit.text;
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
				description: docsFor(spec.description, name, allowed, catalog),
				parameters: spec.parameters,
			});
		}
		return out;
	}

	/** Every tool's parameters, the host's after the built-ins: what `replySchema` lets a reply call, whatever this mind is offered. */
	private replyTools():Record<string, JsonSchema> {
		const tools = { ...BUILTIN_TOOL_PARAMETERS };
		for (const [name, spec] of Object.entries(this.tools)) {
			tools[name] = spec.parameters;
		}
		return tools;
	}

	private mergedTools():Record<string, ToolSpec<TCtx>> {
		const tools:{ [k:string]:ToolSpec<TCtx> } = { ...this.tools };
		if (!tools.recall) {
			tools.recall = {
				description: this.knowledge
					? 'Search what you remember (what you were told, saw, or did) and what you know of the world (places, items, people, who sells or makes what, how things work). Query a name or keyword your goal needs (Bread, Gate), or a plain word (trees, house) to learn its Capitalized name. Empty query lists the topics you know. It answers any question. Never ask anyone until this cannot find it. Then try different words.'
					: 'Search your own memory: what you know, were told, saw, or did. Query the names or keywords your goal needs (Bread, Gate). Never ask anyone until this cannot find it. Then try different words.',
				parameters: BUILTIN_TOOL_PARAMETERS.recall,
				handler: (ctx, args) => this.handleRecall(ctx, args),
			};
		}
		if (!this.setting('hideObserve') && !tools.observe) {
			tools.observe = {
				description: 'Evaluate a watch expression against the current world. Standing conditions belong in watches; one-shot questions this think use observe. Names only, no coordinates.',
				parameters: BUILTIN_TOOL_PARAMETERS.observe,
				handler: (ctx, args) => this.handleObserve(args),
			};
		}
		if (this.talk && this.voice.embodied && !tools.earshot) {
			tools.earshot = {
				description: 'Who is in range right now. Who you can say(to) is this list. Pass to to check one name before you arc a say. Out of range: error, no speech; get closer first. Omit to to list everyone in range.',
				parameters: BUILTIN_TOOL_PARAMETERS.earshot,
				handler: (ctx, args) => this.handleEarshot(args),
			};
		}
		if (this.seeMapOn() && !tools.see_map) {
			tools.see_map = {
				description: 'Map of the land: every named person, place, and thing on it, and where. Look here before you ask where something is. Look here before you wander. Never ask where something is until this cannot find it. zoom 1 is close around you, 0 the whole land. A second look soon, without moving, is the same legend and no new picture.',
				parameters: BUILTIN_TOOL_PARAMETERS.see_map,
				handler: (ctx, args) => this.handleSeeMap(args),
			};
		}
		return this.filterTools(tools);
	}

	private seeMapOn():boolean {
		return !!this.map && this.visionCapable();
	}

	private youSymbol():string {
		const you = this.map?.you?.trim();
		return you || DEFAULT_YOU_SYMBOL;
	}

	private visionCapable():boolean {
		if (this.thinksWith.vision === false) {
			return false;
		}
		if (this.thinksWith.vision === true) {
			return true;
		}
		return isVisionModel(this.thinksWith.id);
	}

	private async handleSeeMap(args:unknown):Promise<unknown> {
		const zoom = parseMapZoom(args);
		if (!this.map) {
			return { ok: false, zoom, reason: 'no map' };
		}
		const prev = this._lastMap;
		let snap;
		try {
			snap = await this.map.snapshot(this.thinkThread(), zoom, prev);
		}
		catch (err) {
			return { ok: false, zoom, reason: err instanceof Error ? err.message : String(err) };
		}
		if (!snap) {
			return { ok: false, zoom, reason: 'no map' };
		}
		if (prev && snap.image === prev.image) {
			this._pendingSeeMapImage = undefined;
			return {
				ok: true,
				zoom,
				legend: prev.legend,
				unchanged: true,
				reason: 'map unchanged since last look',
			};
		}
		if (!isMapSnapshot(snap)) {
			return { ok: false, zoom, reason: 'no map' };
		}
		const stamped = await stampMap(snap, (id) => this.nameOf(id));
		this._pendingSeeMapImage = stamped.image;
		this._lastMap = {
			timestamp: this._now,
			zoom,
			legend: stamped.legend,
			image: stamped.image,
			x: snap.x,
			y: snap.y,
		};
		return { ok: true, zoom, legend: stamped.legend };
	}

	private earshotText():string {
		// In earshot is not in reach (across a river) or clear (a mumble); unmarked, the voice walks into the river or talks to no avail.
		const voiceID = this.thinkThread();
		const nearby = this.talk?.nearby(voiceID) ?? [];
		const ways = this.wayBlocked?.(nearby);
		const names = nearby.map((id, i) => {
			const blocked = ways?.[i];
			const marks = [
				!this.talk!.clear(voiceID, id) && 'too far to make out your words',
				blocked !== undefined && (blocked ? `unreachable, blocked on the way: ${blocked}` : 'unreachable'),
			].filter(Boolean);
			return marks.length > 0 ? `${this.nameOf(id)} (${marks.join('; ')})` : this.nameOf(id);
		});
		// Where the world can tell whether there is a way, say(to) walks up to them first.
		const walks = this.wayBlocked !== undefined;
		if (this.compact) {
			// Only what this host does differently: say(to) cannot walk up to anyone.
			const range = names.length > 0 ? `In talking range: ${names.join(', ')}.` : 'No one in talking range.';
			return walks ? range : `${range} say(to) only those names.`;
		}
		if (names.length === 0) {
			return walks ? 'No one in talking range. say(to) walks up to them first.' : 'No one in talking range. say(to) will fail until you are closer.';
		}
		return walks
			? `In talking range: ${names.join(', ')}. say(to) walks up to them first. Far-off speech is muffled.`
			: `In talking range: ${names.join(', ')}. say(to) only those names; get closer to anyone else first. Far-off speech is muffled.`;
	}

	/**
	 * Why the arc's first step would fail again: the same verb toward someone it already found no way to,
	 * while the way is still blocked. Asked of the live world, so a lowered bridge lets it through.
	 */
	private blockedAgain(arc:Arc):string | undefined {
		const head = firstStep(arc);
		for (const arg of Object.values(head?.args ?? {})) {
			const id = typeof arg === 'string' ? arg : '';
			const key = `${head?.verb} ${id}`;
			if (!this._noWay.has(key)) {
				continue;
			}
			const [why] = this.wayBlocked?.([id]) ?? [];
			if (why === undefined) {
				this._noWay.delete(key);
				continue;
			}
			return noWayTo(this.nameOf(id), why);
		}
		return undefined;
	}

	private unreachableSay(arc:Arc):{ reason:string; nearby:string[] } | undefined {
		const head = firstStep(arc);
		if (!this.talk || head?.verb !== 'say') {
			return undefined;
		}
		const aimed = this.voice.aimGroup(head);
		// A group is not refused here: running, it speaks to whoever of them it can, or says why it cannot.
		if ('status' in aimed || groupTargets(aimed, this.voice.verbs)) {
			return undefined;
		}
		const to = sayToOf(aimed.args);
		const check = this.talk.canSay(this.thinkThread(), to);
		if (check.ok) {
			return undefined;
		}
		const nearby = check.nearby.map((id) => this.nameOf(id));
		// Out of earshot is only a walk away, unless there is no way to them.
		if (to !== undefined && this.wayBlocked && ![to].flat().includes(this.thinkThread())) {
			const ids = [to].flat();
			const ways = this.wayBlocked(ids);
			const i = ways.findIndex((why) => why !== undefined);
			return i < 0 ? undefined : { reason: noWayTo(this.nameOf(ids[i]), ways[i]!), nearby };
		}
		return { reason: check.reason ?? 'not in earshot', nearby };
	}

	private handleEarshot(args:unknown):unknown {
		if (!this.talk) {
			return { error: 'no talk' };
		}
		const row = isRecord(args) ? args : {};
		const to = typeof row.to === 'string' ? row.to.trim() : '';
		const nearby = this.talk.nearby(this.thinkThread()).map((id) => this.nameOf(id));
		if (!to) {
			return nearby.length > 0 ? nearby : 'No one in talking range.';
		}
		const check = this.talk.canSay(this.thinkThread(), this.persona.names.resolve(to));
		if (!check.ok) {
			return { error: check.reason, inRange: false, nearby };
		}
		return { ok: true, inRange: true, nearby };
	}

	private handleObserve(args:unknown):unknown {
		const row = isRecord(args) ? args : {};
		const expr = typeof row.expr === 'string' ? row.expr : '';
		if (!expr) {
			return { error: 'observe needs expr' };
		}
		const catalog = this.voice.catalog?.();
		if (!catalog) {
			return { error: 'no catalog' };
		}
		return observeExpr(expr, catalog, evaluate);
	}

	/** Memories for the query, and with knowledge, `{ remember, know }`: the articles it matches too. */
	private async handleRecall(ctx:TCtx | undefined, args:unknown):Promise<unknown> {
		const row = isRecord(args) ? args : {};
		const query = typeof row.query === 'string' ? row.query : '';
		const k = typeof row.k === 'number' ? row.k : this.setting('recallK');
		let embedding:number[] | undefined;
		if (this.embed && query) {
			try {
				const [vec] = await this.embed([query]);
				embedding = vec;
			}
			catch {
				embedding = undefined;
			}
		}
		const remember = [
			...this._recent.slice(-k).map((text) => ({
				id: 'recent',
				text,
				tags: ['recent'],
				category: 'episodic' as const,
			})),
			...this.persona.memory.recall({
				query,
				k,
				now: this._now,
				embedding,
			}).map((m) => ({
				id: m.id,
				text: m.text,
				tags: m.tags,
				category: m.category,
			})),
		].slice(0, k);
		return this.knowledge ? { remember, know: knowledgeFor(knowledgePages(this.knowledge, ctx), query) } : remember;
	}

	/**
	 * A tool's answer as text. A repeat did not help, so it is refused: any call within this think, a lookup within the
	 * last few. Other tools (see_map, observe) may answer differently once the character has moved.
	 */
	private async lookUp(name:string, rawArgs:string, ctx:TCtx | undefined):Promise<string> {
		const key = `${name} ${rawArgs.replace(/\s+/g, '')}`;
		const window = name === 'recall' ? LOOKUP_REPEAT : 0;
		const repeat = this._thinks - (this._calledOn.get(key) ?? -Infinity) <= window;
		if (!repeat) {
			this.showThink({ kind: 'tool', tool: name, args: rawArgs });
		}
		const result = repeat
			? { error: 'Duplicate call. You made it this think or lately. Change the query, call another tool, or emit the arc.' }
			: await this.runTool(name, rawArgs, ctx);
		this._calledOn.set(key, this._thinks);
		return typeof result === 'string' ? result : JSON.stringify(result);
	}

	/** The picture a `see_map` call just painted, if any, as the next message. */
	private pushMapImage(messages:ChatMessage[]):void {
		const map = this.takeMapImage();
		if (map) {
			messages.push({ role: 'user', content: map });
		}
	}

	/** `text` as a message body, with the picture a `see_map` call just painted beside it. */
	private withMapImage(text:string):ChatContent {
		const map = this.takeMapImage();
		return map ? [{ type: 'text', text }, ...map] : text;
	}

	private takeMapImage():ChatContentPart[] | undefined {
		const url = this._pendingSeeMapImage;
		this._pendingSeeMapImage = undefined;
		return url
			? [
				{ type: 'text', text: 'The map. Legend is in the tool result; names only, no coordinates.' },
				{ type: 'image_url', image_url: { url } },
			]
			: undefined;
	}

	private async runTool(name:string, rawArgs:string, ctx:TCtx | undefined):Promise<unknown> {
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
			return await spec.handler(ctx, args);
		}
		catch (err) {
			return { error: err instanceof Error ? err.message : String(err) };
		}
	}

	private runThink(step:Step, voice:boolean):ArcResult {
		if (voice && this._lastVerb === 'think') {
			return {
				status: 'failed',
				verb: 'think',
				reason: 'act first; think() cannot follow think()',
			};
		}
		let about = String(step.args.about ?? '').replace(/\s+/g, ' ').trim();
		if (about.length > THINK_ABOUT_CAP) {
			about = about.slice(0, THINK_ABOUT_CAP).trim();
		}
		this._pendingAbout = about.length > 0 ? about : undefined;
		if (voice) {
			this._lastVerb = 'think';
		}
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
			this.queue?.setWatches(this.id, this.persona.effectiveWatches());
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
		if (!this.queue) {
			return;
		}
		const stalled = this.setting('stalled')?.(result) ?? result.status !== 'ok';
		this.queue.noteResult(this.id, stalled);
		// Orders given are work under way: its watches say when that needs another think.
		const ordered = result.status === 'ok' && this.lastArc && arcSteps(this.lastArc).some((step) => step.verb === 'command');
		if (result.status !== 'stopped' && this.lastArc && !ordered) {
			this.queue.enqueueArc(this.id, this.lastArc, result.status === 'ok');
		}
	}

	/** `goal` is reached: it stops being a goal, and whoever listens hears. */
	public finishGoal(goal:Goal<never>):void {
		this.persona.finishGoal(goal, this._now);
		this._onGoalReached?.(goal);
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
			const changed = this.persona.applyIdentityPatch(step.args, this.id, this._now);
			return { status: changed ? 'ok' : 'failed', verb: 'set_identity', reason: changed ? undefined : 'nothing to change' };
		}
		return undefined;
	}

	/**
	 * A mind verb that `by` runs: its voice, or another of a collective's characters, whose memories and goals
	 * are marked as theirs. `say` keeps the voice from repeating itself. Undefined for a step the character runs itself.
	 */
	public async perform(step:Step, by:ArcRunner<TCtx>):Promise<ArcResult | undefined> {
		const voice = by === this.voice;
		if (step.verb === 'think') {
			return this.runThink(step, voice);
		}
		if (voice) {
			this.noteVerb(step.verb);
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
			await this.remember(content, voice ? tags : [...tags, `unit:${by.id}`], this._now);
			return { status: 'ok', verb: 'remember' };
		}
		const edited = this.editPersona(step, by);
		if (edited) {
			return edited;
		}
		if (!voice) {
			return undefined;
		}
		if (step.verb === 'say' && this.talk) {
			const text = String(step.args.text ?? '').trim();
			const echo = this.alreadySaid(text, step.args);
			if (echo) {
				return { status: 'failed', verb: 'say', reason: `they already heard you say that ("${echo}"). Saying it again changes nothing: act on it, or say something new` };
			}
			const result = await by.speak(step);
			if (result.status === 'ok' && text) {
				this._said = [...this._said, { gist: gistOf(text), text, heard: new Set(result.heard ?? []) }].slice(-SAID_CAP);
				this.noteConversation({ speakerID: this.thinkThread(), to: [sayToOf(step.args) ?? []].flat(), text });
			}
			return result;
		}
		const once = waitUntilOf(step);
		if (once) {
			this.queue?.armOnce(this.id, once);
		}
		return undefined;
	}

}

/** Other characters named by a `reply` verb's id args. */
function idTargets<TCtx>(step:Step, voice:ArcRunner<TCtx>):string[] {
	const people = otherCharacters(voice);
	const kinds = voice.verbs.get(step.verb)?.args ?? {};
	const ids:string[] = [];
	for (const [key, arg] of Object.entries(kinds)) {
		if (argBase(arg.kind) !== 'id') {
			continue;
		}
		const id = step.args[key];
		if (typeof id === 'string' && id !== voice.id && people.has(id) && !ids.includes(id)) {
			ids.push(id);
		}
	}
	return ids;
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

/** Living characters besides the one acting: the catalog's `others`, and anyone talk can address. */
function otherCharacters<TCtx>(voice:ArcRunner<TCtx>):Set<string> {
	const ids = new Set<string>();
	const listed = voice.catalog?.()?.names.get('others');
	if (listed?.kind === 'list') {
		for (const row of listed.value) {
			if (row.kind === 'entity' && row.value.id !== voice.id) {
				ids.add(row.value.id);
			}
		}
	}
	for (const id of voice.talk?.sense.others(voice.id) ?? []) {
		if (id && id !== voice.id) {
			ids.add(id);
		}
	}
	return ids;
}
