import { formatArc, parseArc } from '../arc/parse.js';
import { exprArgs } from '../arc/validate.js';
import { arcSchema } from '../arc/schema.js';
import { FOCUS_EDIT_VERBS, WATCH_EDIT_VERBS, type VerbRegistry } from '../arc/stock-verbs.js';
import type { Arc, ArcResult, Step } from '../arc/types.js';
import { ArcError } from '../arc/types.js';
import { evaluate, unboundCalls } from '../expr/eval.js';
import { observeExpr } from '../expr/stringify.js';
import { bagOf, cloneEntity } from '../expr/prev.js';
import { isVisionModel } from '../inference/models.js';
import type { ChatMessage, InferenceProvider, JsonSchemaResponseFormat, ToolDef } from '../inference/provider.js';
import { extractJson, isRecord } from '../json.js';
import { mergeTags, nameTags, type MemoryRecord } from '../memory/store.js';
import type { ConversationTurn, MindEvent, Sense, ToolSpec } from './types.js';
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
import { toolFirstArgs, writtenToolCalls } from './toolText.js';
import { arcRepairHint, writtenToolsHint, blockedAgainHint, repeatOutputHint, sayRangeHint, shouldEmitArcText, stablePrefix, volatileBlock, type ThinkInstructions } from './prompt.js';
import type { TalkNet } from './talk.js';
import type { SightClause } from '../perception/types.js';
import { idsOf, mapArc, mapExpr, mapLawName, namesOf } from './ids.js';
import type { NameTarget } from '../character/names.js';
import type { Persona } from '../character/persona.js';
import type { Watches } from '../character/types.js';
import { sayToOf, type ArcRunner } from '../character/arc-runner.js';
import type { Law } from '../arc/laws.js';
import { arcSteps, deferThinks, THINK_ABOUT_CAP } from '../arc/run.js';
import { firstStep } from '../arc/types.js';
import { noWayTo } from '../world/route.js';
import { waitUntilOf, type MindQueue } from '../think/queue.js';
import { hasWatch, watchCount } from '../character/watch.js';
import { asFocusList } from '../character/focus.js';

/** How often a mind thinks and where it stands in the think queue. A host may set these per mind. */
export type MindSettings = {
	/** No think on the queue's heartbeat; only watches, events and arc ends wake it. */
	skipHeartbeat?:boolean;
	/** Major events do not wake it. */
	skipMajor?:boolean;
	/** No think when it joins: it waits for something to happen. Default: it thinks once to start. */
	skipStart?:boolean;
	/** Tie-break after watch `rankScore`. Higher goes first. Default 0. */
	rank?:number;
	/** Fewest game seconds between tactical thinks. Default 0 under a director, whose queue paces thinks. */
	heartbeat?:number;
	/** Game seconds between goal revisions; 0 never revises. Default 180. */
	strategicInterval?:number;
	/** The model it thinks with, by its name on the director (`addModel`). Omit for the director's default. */
	model?:string;
	/**
	 * Clear lines kept in Current Conversation, oldest first.
	 * Omit to use {@link conversationCapFor} on the model's context window. 0 shows none.
	 */
	conversationCap?:number;
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
	readonly persona:Persona;
	/** The owner's own block of the prompt, in place of the laws. A collective lists its roster here. */
	promptSection?(mind:Mind<TCtx>):string;
};

/** What the director gives a mind when it is attached. */
export type MindDeps<TCtx = unknown> = {
	provider:InferenceProvider;
	senses?:Record<string, Sense<TCtx>>;
	tools?:Record<string, ToolSpec<TCtx>>;
	talk?:TalkNet;
	/** When the voice has an executor, `tick` runs the arc unless this is false. */
	autoEnact?:boolean;
	/** Each arc the moment a think chooses it, before it runs. */
	onChoose?:(arc:Arc)=>void;
	queue?:MindQueue;
	/** Heartbeat stretch after an arc. Default: failed or interrupted. */
	stalled?:(result:ArcResult)=>boolean;
	/** The model id its requests name on the server. */
	modelID?:string;
	/** Vectors for memories and recall queries. Omit to recall by text alone. */
	embed?:(texts:string[])=>Promise<number[][]>;
	/** Tool rounds before the Arc must be emitted. Default {@link DEFAULT_TOOL_ROUNDS}; 0 offers no tools. */
	toolRoundCap?:number;
	/** Why there is no way for this character to `id` (`Bridge is raised`, or `''` unnamed), or undefined when there is. Marks unreachable names in earshot. */
	wayBlocked?:(id:string)=>string | undefined;
	/** Extra chat turns after a bad arc or a tool call with tools closed. Host sets this; 0 means fail on the first bad reply. */
	arcRetryCap?:number;
	/** Ask for `go_to() && wait()` text instead of Arc JSON. Testing toggle. Skips the JSON goals pass. */
	arcText?:boolean;
	/** Arc JSON turns send the arc schema for the server to enforce, and offer no tools. Ignored with `arcText`. */
	forceSchema?:boolean;
	/** Sampling temperature from the second repair turn on, so a model stuck on one bad reply moves. Default 0.4. */
	repairTemperature?:number;
	thinkInstructions?:ThinkInstructions;
	/** Whether the model reasons before it answers. Picks the think line and asks the server for it. Default: it does. */
	thinking?:()=>boolean;
	/** Standing verb-chain line. Omit for {@link DEFAULT_VERB_INSTRUCTIONS}. */
	verbInstructions?:string;
	/** Arc that replaces the closing Example in the prompt. */
	arcExample?:string;
	/** Host naming policy seen from this mind: the base name for a character. Omit to use ids. */
	seenAs?:(target:NameTarget)=>string;
	intrusionThreshold?:number;
	intrusionCooldown?:number;
	recallK?:number;
	hideObserve?:boolean;
	/** The context its tools and articles look from. Default: its voice's. */
	worldContext?:()=>TCtx | undefined;
	/** Host top-down snapshots. `see_map` is omitted unless this and vision are both set. */
	map?:MapSense;
	/** What it knows about the world: host articles `recall` searches beside memory. */
	knowledge?:KnowledgeSource<TCtx>;
	/** Most articles shown per think for names said or heard. Default {@link DEFAULT_MENTION_CAP}; 0 shows none. */
	mentionCap?:number;
	/**
	 * Whether the current model accepts image parts.
	 * `false` never offers `see_map`. `true` offers it when `map` is set.
	 * Omit to fall back to `isVisionModel(model)`.
	 */
	vision?:boolean;
};

function asStringArray(v:unknown):string[] {
	if (!Array.isArray(v)) {
		return [];
	}
	return v.filter((x):x is string => typeof x === 'string');
}

/** Tool calls a think may make before it must emit the Arc. Small models need several lookups in a row. */
export const DEFAULT_TOOL_ROUNDS = 6;
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
/** Most lines the computed conversation default will keep. */
export const MAX_CONVERSATION_CAP = 64;
/** Tokens of context per pair of conversation lines. */
const CONVERSATION_TOKENS = 1024;
const RECENT_SUMMARY_MAX = 600;
const RECENT_SEPARATOR = '; ';
const BARE_RESULT = new Set(['ok', 'failed', 'interrupted']);

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

/** 2 lines per 1K tokens of context, at most {@link MAX_CONVERSATION_CAP}. An unknown context gets the most. */
export function conversationCapFor(contextTokens:number | undefined):number {
	if (contextTokens === undefined || !Number.isFinite(contextTokens)) {
		return MAX_CONVERSATION_CAP;
	}
	if (contextTokens <= 0) {
		return 0;
	}
	return Math.min(MAX_CONVERSATION_CAP, Math.floor(contextTokens / CONVERSATION_TOKENS) * 2);
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
	/** What its sight showed this think, each clause with the names of what it saw: its sightings to remember. */
	sighted(clauses:readonly SightClause[]):void;
};

/** Every mind's fields. `index.ts` does not export `mindFields`, so only the library reaches them. */
const allFields = new WeakMap<object, unknown>();

/** The fields `mind`'s constructor handed over. */
export function mindFields<TCtx>(mind:Mind<TCtx>):MindFields<TCtx> {
	return allFields.get(mind) as MindFields<TCtx>;
}

/**
 * Writes arcs: it thinks with the model about its owner's persona and what the owner's voice senses, and hands
 * each arc to that voice. It holds no story of its own, only its settings and thinking state, so it can be
 * swapped or dropped without losing who its owner is. A character owns at most one mind; a collective always
 * has one, shared by its characters.
 *
 * It thinks with one of its director's configured models (`addModel`), by the name in its settings' `model`, or
 * with the default model when it names none or that one is removed. It never changes a model's settings; the
 * director keeps its `modelID` and provider current. Each model caps its own parallel thinks, and every
 * memory is embedded with the director's one embedding model, so a Persona's memories stay comparable whatever
 * mind it moves to.
 */
export class Mind<TCtx = unknown> {
	public skipHeartbeat:boolean;
	public skipMajor:boolean;
	public skipStart:boolean;
	public rank:number;
	public heartbeat:number;
	public strategicInterval:number;
	private _owner:MindOwner<TCtx> | undefined;
	/** The owner's id, kept after a detach so a think still finishing can clean up after itself. */
	private _id = '';
	public senses:Record<string, Sense<TCtx>> = {};
	public tools:Record<string, ToolSpec<TCtx>> = {};
	public talk:TalkNet | undefined;
	public provider!:InferenceProvider;
	public autoEnact = true;
	public onChoose:((arc:Arc)=>void) | undefined;
	public queue:MindQueue | undefined;
	public stalled?:(result:ArcResult)=>boolean;
	/** The model it is assigned, by its name on the director; `undefined` thinks with the default. */
	public model:string | undefined;
	/** The model id its requests name on the server, kept current by the director. */
	public modelID = '';
	public embed:((texts:string[])=>Promise<number[][]>) | undefined;
	public toolRoundCap = DEFAULT_TOOL_ROUNDS;
	public wayBlocked:((id:string)=>string | undefined) | undefined;
	public arcRetryCap = 0;
	/** Mutable so the Testing toggle can flip live minds. */
	public arcText = false;
	public forceSchema = false;
	public repairTemperature = 0.4;
	public thinkInstructions:ThinkInstructions | undefined;
	public thinking:()=>boolean = () => true;
	public verbInstructions:string | undefined;
	public arcExample:string | undefined;
	public seenAs:((target:NameTarget)=>string) | undefined;
	public worldContext:()=>TCtx | undefined = () => undefined;
	public intrusionThreshold = 0.55;
	public intrusionCooldown = 45;
	public recallK = 5;
	public hideObserve = false;
	public map:MapSense | undefined;
	public knowledge:KnowledgeSource<TCtx> | undefined;
	public vision:boolean | undefined;
	/** The context window of the model it thinks with, kept current by the director; `undefined` when unknown. */
	public contextTokens:number | undefined;
	/** Lines shown in Current Conversation; `undefined` follows {@link conversationCapFor} on `contextTokens`. */
	public conversationCap:number | undefined;
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

	constructor(settings:MindSettings = {}) {
		this.skipHeartbeat = settings.skipHeartbeat ?? false;
		this.skipMajor = settings.skipMajor ?? false;
		this.skipStart = settings.skipStart ?? false;
		this.rank = settings.rank ?? 0;
		this.heartbeat = settings.heartbeat ?? 0;
		this.strategicInterval = settings.strategicInterval ?? 180;
		this.conversationCap = settings.conversationCap;
		this.model = settings.model;
		const fields:MindFields<TCtx> = {
			attach: (owner, deps) => this.attach(owner, deps),
			detach: () => {
				this._owner = undefined;
			},
			sighted: (clauses) => {
				this._sighted = clauses;
			},
		};
		allFields.set(this, fields);
	}

	private attach(owner:MindOwner<TCtx>, deps:MindDeps<TCtx>):void {
		this._owner = owner;
		this._id = owner.id;
		this.provider = deps.provider;
		this.senses = deps.senses ?? {};
		this.tools = deps.tools ?? {};
		this.talk = deps.talk;
		this.autoEnact = deps.autoEnact ?? true;
		this.onChoose = deps.onChoose;
		this.queue = deps.queue;
		this.stalled = deps.stalled;
		this.modelID = deps.modelID ?? '';
		this.embed = deps.embed;
		this.toolRoundCap = deps.toolRoundCap ?? DEFAULT_TOOL_ROUNDS;
		this.wayBlocked = deps.wayBlocked;
		this.arcRetryCap = deps.arcRetryCap ?? 0;
		this.arcText = deps.arcText === true;
		this.forceSchema = deps.forceSchema === true;
		this.repairTemperature = deps.repairTemperature ?? 0.4;
		this.thinkInstructions = deps.thinkInstructions;
		this.thinking = deps.thinking ?? (() => true);
		this.verbInstructions = deps.verbInstructions;
		this.arcExample = deps.arcExample;
		this.seenAs = deps.seenAs;
		this.worldContext = deps.worldContext ?? (() => this.voice.context());
		this.intrusionThreshold = deps.intrusionThreshold ?? 0.55;
		this.intrusionCooldown = deps.intrusionCooldown ?? 45;
		this.recallK = deps.recallK ?? 5;
		this.hideObserve = deps.hideObserve ?? false;
		this.map = deps.map;
		this.knowledge = deps.knowledge;
		this._mentionCap = deps.mentionCap ?? DEFAULT_MENTION_CAP;
		this.vision = deps.vision;
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

	/** These settings, to give a character a fresh mind like this one later. */
	public settings():MindSettings {
		return {
			skipHeartbeat: this.skipHeartbeat,
			skipMajor: this.skipMajor,
			skipStart: this.skipStart,
			rank: this.rank,
			heartbeat: this.heartbeat,
			strategicInterval: this.strategicInterval,
			model: this.modelID,
			conversationCap: this.conversationCap,
		};
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

	/** Queue an event for the next think. It is kept in ids and read in this mind's names when that think starts. */
	public pushEvent(event:MindEvent):void {
		this._pendingEvents.push({ ...event, timestamp: event.timestamp ?? this._now });
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

	/** The result of the arc this mind gave its voice, or of a failed think. The next prompt shows it. */
	public ingestResult(result:ArcResult):void {
		this.lastResult = result;
		if (result.unreachable && result.verb) {
			this._noWay.add(`${result.verb} ${result.unreachable}`);
		}
		if (result.interrupted) {
			this.pushEvent({
				kind: 'Interrupted',
				text: result.reason ?? 'interrupted',
				tags: ['interrupted'],
			});
		}
		else {
			// What happened in the world is worth keeping; how its own think went (a bad reply) is not.
			this.pushEvent({
				kind: 'arc_result',
				text: result.reason ?? (result.ok ? 'ok' : 'failed'),
				tags: [result.ok ? 'ok' : 'fail'],
				remember: result.verb !== 'think',
			});
		}
		this.syncQueue(result);
	}

	/** The voice began an arc. */
	public arcStarted(arc:Arc):void {
		this.queue?.beginArc(this.id, arc);
	}

	/** The voice's arc stopped or parked. */
	public arcEnded():void {
		this.queue?.endArc(this.id);
	}

	/**
	 * An arc that ends on a say someone could answer gives the answer time to come before the next think.
	 * A say mid-arc does not wait: the rest of the arc (`say(...) && use(...)`) is what was decided.
	 */
	public async afterArc(result:ArcResult, voice:ArcRunner<TCtx>):Promise<void> {
		const due = result.ok && result.verb === 'say' && 'answerable' in result && result.answerable === true;
		if (due && voice.execute) {
			await voice.execute({ verb: 'wait', args: { seconds: 20 } }, voice.context());
		}
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
			throw err;
		}
		finally {
			this.queue?.endThink(this.id, signal);
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
			settings: this.settings(),
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
		mind.lastArc = json.lastArc;
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
		if (this.lastResult?.interrupted) {
			return true;
		}
		if (this._pendingEvents.some((e) => e.major)) {
			return true;
		}
		if (this.heartbeat <= 0) {
			return true;
		}
		return gameTime - this.lastTacticalTimestamp >= this.heartbeat;
	}

	private strategicDue(gameTime:number):boolean {
		if (this._pendingEvents.some((e) => e.major)) {
			return true;
		}
		if (this.strategicInterval <= 0) {
			return false;
		}
		if (!Number.isFinite(this.lastStrategicTimestamp)) {
			return false;
		}
		return gameTime - this.lastStrategicTimestamp >= this.strategicInterval;
	}

	private async reviseGoals():Promise<void> {
		if (this.arcText) {
			return;
		}
		const system = stablePrefix(this.id, this.persona.identity, this.owner.activeVerbs(), {
			includeWatches: true,
			omitArc: true,
		});
		const user = `${volatileBlock({
			goals: this.persona.goals,
			pinned: this.persona.memory.pinned(),
			recalled: this.recallForPrompt(),
			recent: this._recent,
			recentSummary: this._recentSummary,
			conversation: this.conversationLines(),
		})}\n\n`
			+ 'Revise goals if what you just learned changes what you must do. '
			+ 'Harm, theft, and threats outrank standing work — put that first in goals. '
			+ 'Do not change identity unless who you are has actually changed for good. '
			+ 'Omit identity otherwise. Do not rewrite the role to summarize this moment. '
			+ 'Emit JSON {"goals":[{"text":"...","priority":0}]} and only if needed "identity":{"role":"...","traits":["..."]}. '
			+ `Keep at most ${this.persona.maxGoals} goals. Do not emit movement.`;
		const res = await this.provider.chat({
			model: this.modelID,
			thread: this.id,
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: user },
			],
			temperature: 0,
		});
		if (!res.content) {
			return;
		}
		try {
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
	 * not copy them back as its reply.
	 */
	public lawsSection():string {
		const laws = this.owner.laws;
		if (laws.length === 0) {
			return '';
		}
		const line = (law:Law):string => {
			const who = this.owner.lawsTakeWho() && law.who !== 'me' ? ` (for ${this.named(law.who)})` : '';
			return `- ${mapLawName(law.name, namesOf(this.persona.names))}${who}: when ${this.named(law.watch)}, run ${this.namedArc(law.arc)}`;
		};
		const intro = 'Laws (emergencies that already run on their own, first listed first; do not repeat them in your reply; unlaw(name) drops one):';
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
		const reason = this.lastResult && !this.lastResult.ok ? this.lastResult.reason : undefined;
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
			pinned: this.persona.memory.pinned(),
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
			thinkAbout: this._pendingAbout,
		}), this.extraVolatile()].filter(Boolean).join('\n\n');
	}

	private namedWatches(watches:Watches):Watches {
		return Object.fromEntries(Object.entries(watches).map(([name, expr]) => [name, this.named(expr)]));
	}

	/** The model's reply as an arc in ids. */
	/** The reply as an arc in ids. Throws on a watch that calls a function the watch language does not have: it could never hold. */
	private readArc(raw:unknown, verbs:VerbRegistry):Arc {
		const arc = mapArc(deferThinks(parseArc(raw, verbs)), verbs, idsOf(this.persona.names));
		const catalog = this.voice.catalog?.();
		const unbound = catalog ? exprArgs(arc, verbs).flatMap((expr) => unboundCalls(expr, catalog)) : [];
		if (unbound.length > 0) {
			throw new ArcError(`${unbound.map((name) => `${name}()`).join(', ')} is not a watch function`);
		}
		return arc;
	}

	private parseArcContent(content:string, verbs:VerbRegistry):{ arc:Arc; raw:unknown } | null {
		try {
			const trimmed = content.trim();
			if (!trimmed) {
				return null;
			}
			const raw = (trimmed.startsWith('{') || trimmed.startsWith('```'))
				? extractJson(trimmed)
				: trimmed;
			const arc = this.readArc(raw, verbs);
			if (!firstStep(arc)?.verb) {
				return null;
			}
			return { arc, raw };
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
		this.absorbPending();
		const sensed = this.gatherSensed();
		const emitText = this.emitText(verbs);
		const form = emitText ? 'Arc text' : 'Arc JSON';
		const hint = `While you thought, the live verb changed from ${liveVerbAtThink} to ${this._lastVerb}. `
			+ `Do not think again. Emit a new ${form} if that changes your choices, or confirm the arc you already wrote.`;
		messages.push({ role: 'assistant', content: firstContent });
		messages.push({ role: 'user', content: this.volatileUser(sensed, hint) });
		const res = await this.provider.chat({
			model: this.modelID,
			thread: this.id,
			messages,
			tools: sendTools ? tools : undefined,
			toolChoice: sendTools ? 'none' : undefined,
			responseFormat: this.arcFormat(verbs, emitText),
			temperature: 0,
			fakeThought: true,
		});
		if (res.toolCalls.length > 0 || !res.content) {
			return arc;
		}
		const parsed = this.parseArcContent(res.content, verbs);
		if (!parsed) {
			return arc;
		}
		if (typeof parsed.raw !== 'string') {
			this.applyMind(parsed.raw);
		}
		return parsed.arc;
	}

	private async tactical():Promise<Arc> {
		this._thinks += 1;
		const ctx = this.worldContext();
		this.owner.refreshKit();
		const liveVerbAtThink = this.voice.liveArc ? this._lastVerb : undefined;
		// A repeat after new input (speech, an interruption, a nudge) can be right; without any, the model is stuck.
		const freshInput = this.hasFreshInput();
		const sensed = this.gatherSensed();
		const verbs = this.owner.activeVerbs();
		const emitText = this.emitText(verbs);
		const tools = this.toolRoundCap > 0 && !this.arcFormat(verbs, emitText) ? this.toolDefs() : [];
		const sendTools = tools.length > 0;
		const toolNames = tools.map((t) => t.name);
		const system = stablePrefix(this.id, this.persona.identity, verbs, {
			includeWatches: this.persona.watchesWritable || watchCount(this.persona.watchList()) > 0,
			watchesWritable: verbs.has('watch'),
			canObserve: toolNames.includes('observe'),
			canSeeMap: toolNames.includes('see_map'),
			canRecallKnowledge: toolNames.includes('recall') && this.knowledge !== undefined,
			youSymbol: this.youSymbol(),
			arcText: emitText,
			thinkInstructions: this.thinkInstructions,
			thinking: this.thinking(),
			verbInstructions: this.verbInstructions,
			arcExample: this.arcExample,
			tools: toolNames,
		});
		// Talking in circles: characters who hear each other keep answering, so a streak of talk ends in a deed.
		const user = this.volatileUser(sensed, this._talkStreak >= TALK_STREAK
			? `You have only talked or waited for ${this._talkStreak} thinks. Stop talking: take the next step toward your goal with a verb that does something. Look up what you lack with a tool instead of asking again.`
			: undefined);
		const messages:ChatMessage[] = [
			{ role: 'system', content: system },
			{ role: 'user', content: user },
		];
		let toolsLeft = sendTools ? this.toolRoundCap : 0;
		let repairsLeft = this.arcRetryCap;
		let warnedRepeat = freshInput;
		let checksLeft = Math.max(1, this.arcRetryCap);
		let lastErr:Error | null = null;
		const repeatTurn = 1;
		const budget = toolsLeft + this.arcRetryCap + 1 + (this.talk ? 1 : 0) + repeatTurn;
		for (let turn = 0; turn < budget; turn++) {
			const allowTools = toolsLeft > 0 && tools.length > 0;
			const res = await this.provider.chat({
				model: this.modelID,
				thread: this.id,
				messages,
				tools: sendTools ? tools : undefined,
				toolChoice: sendTools ? (allowTools ? 'auto' : 'none') : undefined,
				responseFormat: this.arcFormat(verbs, emitText),
				temperature: this.arcRetryCap - repairsLeft > 1 || this._emitStreak >= 2
					? this.repairTemperature
					: 0,
				// A repair keeps the whole conversation, so reasoning on top of it runs out of tokens again.
				enableThinking: repairsLeft < this.arcRetryCap ? false : this.thinking(),
			});
			if (res.truncated) {
				lastErr = new ArcError('reply was cut off at the token limit; answer shorter');
				if (!this.pushRepair(messages, { content: null, toolCalls: [] }, lastErr, repairsLeft, toolNames, emitText)) {
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
			// A tool written where the Arc goes is the call the model meant: run it, or drop it from an Arc beside it.
			const written = emitText && res.content ? writtenToolCalls(res.content, toolFirstArgs(tools)) : undefined;
			if (written && written.calls.length > 0 && !written.rest && allowTools) {
				messages.push({ role: 'assistant', content: res.content });
				const results:string[] = [];
				for (const call of written.calls) {
					results.push(`${call.name}: ${await this.lookUp(call.name, JSON.stringify(call.args), ctx)}`);
				}
				this.pushMapImage(messages);
				messages.push({ role: 'user', content: writtenToolsHint(results, emitText) });
				toolsLeft -= 1;
				continue;
			}
			const content = written?.rest || res.content;
			if (res.toolCalls.length > 0) {
				lastErr = new ArcError('model called a tool when it must emit an Arc');
				if (!this.pushRepair(messages, res, lastErr, repairsLeft, toolNames, emitText)) {
					throw lastErr;
				}
				repairsLeft -= 1;
				continue;
			}
			if (content) {
				let arc:Arc;
				let raw:unknown;
				try {
					const trimmed = content.trim();
					raw = (trimmed.startsWith('{') || trimmed.startsWith('```'))
						? extractJson(trimmed)
						: trimmed;
					arc = this.readArc(raw, verbs);
				}
				catch (err) {
					lastErr = err instanceof Error ? err : new ArcError(String(err));
					if (!this.pushRepair(messages, res, lastErr, repairsLeft, toolNames, emitText)) {
						throw lastErr;
					}
					repairsLeft -= 1;
					continue;
				}
				if (!warnedRepeat && this.isRepeat(content)) {
					warnedRepeat = true;
					this._emitStreak += 1;
					messages.push({ role: 'assistant', content });
					messages.push({ role: 'user', content: repeatOutputHint(this._emitStreak, emitText) });
					continue;
				}
				const blocked = this.unreachableSay(arc);
				const again = blocked ? undefined : this.blockedAgain(arc);
				if (blocked || again) {
					lastErr = new ArcError(blocked?.reason ?? again!);
					if (checksLeft <= 0) {
						throw lastErr;
					}
					checksLeft -= 1;
					messages.push({ role: 'assistant', content });
					messages.push({ role: 'user', content: blocked ? sayRangeHint(blocked.reason, blocked.nearby, emitText) : blockedAgainHint(again!, emitText) });
					continue;
				}
				if (typeof raw !== 'string') {
					this.applyMind(raw);
				}
				this.acceptEmit(content);
				this._talkStreak = arcSteps(arc).every((step) => TALK_VERBS.has(step.verb)) ? this._talkStreak + 1 : 0;
				return this.settleLiveArc(
					arc,
					content,
					messages,
					verbs,
					liveVerbAtThink,
					sendTools,
					tools,
				);
			}
			lastErr = new ArcError('model returned no arc');
			if (!this.pushRepair(messages, res, lastErr, repairsLeft, toolNames, emitText)) {
				throw lastErr;
			}
			repairsLeft -= 1;
		}
		throw lastErr ?? new ArcError('failed to obtain Arc');
	}

	/** The arc schema the server must follow under {@link forceSchema}; otherwise none, and the reply is parsed as written. */
	private arcFormat(verbs:VerbRegistry, emitText:boolean):JsonSchemaResponseFormat | undefined {
		return this.forceSchema && !emitText ? { name: 'arc', schema: arcSchema(verbs), strict: true } : undefined;
	}

	private emitText(verbs:VerbRegistry):boolean {
		return shouldEmitArcText(verbs, this.arcText);
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
		emitText:boolean,
	):boolean {
		if (repairsLeft <= 0) {
			return false;
		}
		const called = res.toolCalls.map((c) => c.name);
		const shown = res.content
			?? (called.length > 0 ? `(tool call: ${called.join(', ')})` : '');
		const dropProse = !/^\s*[{`]/.test(shown) && !shown.includes('(');
		messages.push({ role: 'assistant', content: dropProse ? null : (shown || null) });
		messages.push({ role: 'user', content: arcRepairHint(err.message, emitText, toolNames) });
		return true;
	}







	private absorbPending():void {
		for (let i = this._recentAbsorbed; i < this._pendingEvents.length; i++) {
			const e = this.render(this._pendingEvents[i]);
			const text = e.text.trim();
			if (!text) {
				continue;
			}
			if (e.kind === 'arc_result') {
				if (isBareResult(text)) {
					continue;
				}
				this.noteRecent(text);
				if (e.remember) {
					this.keepFact(text, mergeTags(['result'], e.tags, nameTags(text)));
				}
				continue;
			}
			if (e.turn) {
				this.noteConversation(e.turn);
			}
			else {
				this.noteRecent(text);
			}
			if (e.remember) {
				const rows = this.persona.memory.all();
				const last = rows[rows.length - 1];
				if (last?.text !== text) {
					this.persona.memory.add({
						category: 'episodic',
						text,
						tags: mergeTags(e.tags, nameTags(text)),
						timestamp: e.timestamp ?? this._now,
					}, e.timestamp ?? this._now);
				}
			}
		}
		this._recentAbsorbed = this._pendingEvents.length;
	}

	/** Keeps at least {@link MAX_CONVERSATION_CAP} lines, so a larger context later shows more. */
	private noteConversation(turn:ConversationTurn):void {
		const text = turn.text.trim().replace(/\s+/g, ' ');
		const last = this._conversation[this._conversation.length - 1];
		if (!text || (last?.speakerID === turn.speakerID && last.text === text)) {
			return;
		}
		this._conversation.push({ ...turn, text });
		const kept = Math.max(MAX_CONVERSATION_CAP, this.conversationCap ?? 0);
		this._conversation.splice(0, Math.max(0, this._conversation.length - kept));
	}

	/** The turns Current Conversation shows, oldest first. */
	private shownTurns():ConversationTurn[] {
		const cap = this.conversationCap ?? conversationCapFor(this.contextTokens);
		return cap > 0 ? this._conversation.slice(-cap) : [];
	}

	/** `Me (to Forager): …`, `Forager (to you): …`, `Guard: …` to everyone. Each id is named as this mind knows it now. */
	private conversationLines():string[] {
		return this.shownTurns().map((turn) => {
			const speaker = this.isSelf(turn.speakerID) ? 'Me' : this.nameOf(turn.speakerID);
			const to = (turn.to ?? []).map((id) => this.isSelf(id) ? 'you' : this.nameOf(id));
			return `${speaker}${to.length > 0 ? ` (to ${to.join(', ')})` : ''}: ${turn.text}`;
		});
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
		// Speech still in Current Conversation is already on screen.
		const quoting = this.shownTurns().map((turn) => `"${turn.text}"`);
		return this.persona.memory.recall({
			query,
			k: this.recallK,
			now: this._now,
			skip: (r) => {
				const onScreen = r.tags.includes('speech') && quoting.some((quote) => r.text.endsWith(quote));
				if (r.pinned || pinnedIds.has(r.id) || recentSet.has(r.text) || onScreen) {
					return true;
				}
				const seen = r.tags.find((t) => t.startsWith('seen:') && t.length > 5);
				return !!seen && scene.includes(seen.slice('seen:'.length));
			},
		});
	}


	private applyMind(raw:unknown):void {
		if (!isRecord(raw)) {
			return;
		}
		if (raw.identity !== undefined) {
			this.persona.applyIdentityPatch(raw.identity, this.id, this._now);
		}
		if (raw.goals !== undefined) {
			this.persona.applyGoalList(raw.goals);
		}
	}




	private maybeIntrude(perceptionText:string):string | undefined {
		if (this._now - this.lastIntrusionTimestamp < this.intrusionCooldown) {
			return undefined;
		}
		const tags = this._pendingEvents.flatMap((e) => this.render(e).tags ?? []);
		const hit = this.persona.memory.intrusion({
			query: perceptionText,
			now: this._now,
			tags,
			threshold: this.intrusionThreshold,
		});
		if (!hit || hit.tags.includes('seen')) {
			return undefined;
		}
		this.lastIntrusionTimestamp = this._now;
		return hit.text;
	}

	private toolDefs():ToolDef[] {
		const out:ToolDef[] = [];
		for (const [name, spec] of Object.entries(this.mergedTools())) {
			out.push({
				name,
				description: spec.description,
				parameters: spec.parameters,
			});
		}
		return out;
	}

	private mergedTools():Record<string, ToolSpec<TCtx>> {
		const tools:{ [k:string]:ToolSpec<TCtx> } = { ...this.tools };
		if (!tools.recall) {
			tools.recall = {
				description: this.knowledge
					? 'Search what you remember (what you were told, saw, or did) and what you know of the world (places, items, people, who sells or makes what, how things work). Query a name or keyword your goal needs (Bread, Gate), or a plain word (trees, house) to learn its Capitalized name. Empty query lists the topics you know.'
					: 'Search your own memory: what you know, were told, saw, or did. Query the names or keywords your goal needs (Bread, Gate).',
				parameters: {
					type: 'object',
					additionalProperties: false,
					required: ['query'],
					properties: {
						query: { type: 'string' },
						k: { type: 'number' },
					},
				},
				handler: (ctx, args) => this.handleRecall(ctx, args),
			};
		}
		if (!this.hideObserve && !tools.observe) {
			tools.observe = {
				description: 'Evaluate a watch expression against the current world. Standing conditions belong in watches; one-shot questions this think use observe. Names only, no coordinates.',
				parameters: {
					type: 'object',
					additionalProperties: false,
					required: ['expr'],
					properties: {
						expr: { type: 'string' },
					},
				},
				handler: (ctx, args) => this.handleObserve(args),
			};
		}
		if (this.talk && this.voice.embodied && !tools.earshot) {
			tools.earshot = {
				description: 'Who you can say(to) right now. Pass to to check one name before you arc a say. Out of range: error, no speech; get closer first. Omit to to list everyone in range.',
				parameters: {
					type: 'object',
					additionalProperties: false,
					properties: {
						to: { type: 'string' },
					},
				},
				handler: (ctx, args) => this.handleEarshot(args),
			};
		}
		if (this.seeMapOn() && !tools.see_map) {
			tools.see_map = {
				description: 'Map of the land: every named person, place, and thing on it, and where. Look here before you wander or ask where something is. zoom 1 is close around you, 0 the whole land. A second look soon, without moving, is the same legend and no new picture.',
				parameters: {
					type: 'object',
					additionalProperties: false,
					properties: {
						zoom: { type: 'number', minimum: 0, maximum: 1 },
					},
				},
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
		if (this.vision === false) {
			return false;
		}
		if (this.vision === true) {
			return true;
		}
		return isVisionModel(this.modelID);
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
		const names = (this.talk?.nearby(voiceID) ?? []).map((id) => {
			const blocked = this.wayBlocked?.(id);
			const marks = [
				!this.talk!.clear(voiceID, id) && 'too far to make out your words',
				blocked !== undefined && (blocked ? `unreachable, blocked on the way: ${blocked}` : 'unreachable'),
			].filter(Boolean);
			return marks.length > 0 ? `${this.nameOf(id)} (${marks.join('; ')})` : this.nameOf(id);
		});
		if (names.length === 0) {
			return 'No one in talking range. say(to) will fail until you are closer.';
		}
		return `In talking range: ${names.join(', ')}. say(to) only those names; get closer to anyone else first. Far-off speech is muffled.`;
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
			const why = this.wayBlocked?.(id);
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
		const check = this.talk.canSay(this.thinkThread(), sayToOf(head.args));
		if (check.ok) {
			return undefined;
		}
		return { reason: check.reason ?? 'not in earshot', nearby: check.nearby.map((id) => this.nameOf(id)) };
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
		const k = typeof row.k === 'number' ? row.k : this.recallK;
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
		const result = this._thinks - (this._calledOn.get(key) ?? -Infinity) <= window
			? { error: 'Duplicate call. You made it this think or lately. Change the query, call another tool, or emit the arc.' }
			: await this.runTool(name, rawArgs, ctx);
		this._calledOn.set(key, this._thinks);
		return typeof result === 'string' ? result : JSON.stringify(result);
	}

	/** The picture a `see_map` call just painted, if any, as the next message. */
	private pushMapImage(messages:ChatMessage[]):void {
		if (!this._pendingSeeMapImage) {
			return;
		}
		messages.push({
			role: 'user',
			content: [
				{ type: 'text', text: 'The map. Legend is in the tool result; names only, no coordinates.' },
				{ type: 'image_url', image_url: { url: this._pendingSeeMapImage } },
			],
		});
		this._pendingSeeMapImage = undefined;
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
				ok: false,
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
		return { ok: true, verb: 'think' };
	}

	/** watch(name, expr) adds or replaces an extra watch; unwatch(name) drops one. Pins fail closed. */
	private runWatch(step:Step):ArcResult {
		const name = String(step.args.name ?? '');
		if (hasWatch(this.persona.pinnedWatches, name)) {
			return { ok: false, verb: step.verb, reason: `${name} is a required watch` };
		}
		const expr = String(step.args.expr ?? '');
		const ok = step.verb === 'unwatch'
			? this.persona.removeWatch(name)
			: this.persona.editWatch(name, expr) || this.persona.addWatch(name, expr);
		if (ok) {
			this.queue?.setWatches(this.id, this.persona.effectiveWatches());
		}
		return { ok, verb: step.verb, reason: ok ? undefined : `no watch ${name}` };
	}

	/** focus(expr) puts an extra sightFocus first; unfocus(expr) drops one. Pins fail closed. */
	private runFocus(step:Step):ArcResult {
		const expr = String(step.args.expr ?? '').trim();
		if (this.persona.pinnedSightFocus.includes(expr)) {
			return { ok: false, verb: step.verb, reason: 'that sightFocus is required' };
		}
		const rest = this.persona.sightFocus.filter((e) => e !== expr);
		const ok = step.verb === 'focus' ? expr.length > 0 : rest.length < this.persona.sightFocus.length;
		this.persona.sightFocus = step.verb === 'focus' ? asFocusList([expr, ...rest], this.persona.maxSightFocus) : rest;
		return { ok, verb: step.verb, reason: ok ? undefined : 'no such sightFocus' };
	}

	private syncQueue(result:ArcResult):void {
		if (!this.queue) {
			return;
		}
		const stalled = this.stalled
			? this.stalled(result)
			: !result.ok || !!result.interrupted;
		this.queue.noteResult(this.id, stalled);
		if (!result.interrupted && this.lastArc) {
			this.queue.enqueueArc(this.id, this.lastArc, result.ok);
		}
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
			return { ok: true, verb: 'remember' };
		}
		if (step.verb === 'set_goal') {
			const goal = String(step.args.goal ?? '');
			const priority = typeof step.args.priority === 'number' ? step.args.priority : 0;
			this.persona.goals.push({ text: voice ? goal : `[${by.id}] ${goal}`, priority });
			this.persona.trimGoals();
			return { ok: true, verb: 'set_goal' };
		}
		if (step.verb === 'drop_goal') {
			const goal = typeof step.args.goal === 'string' ? step.args.goal : undefined;
			if (!goal) {
				this.persona.goals.pop();
			}
			else {
				this.persona.goals = this.persona.goals.filter((g) => g.text !== goal);
			}
			return { ok: true, verb: 'drop_goal' };
		}
		if (step.verb === 'set_identity') {
			const changed = this.persona.applyIdentityPatch(step.args, this.id, this._now);
			return { ok: changed, verb: 'set_identity', reason: changed ? undefined : 'nothing to change' };
		}
		if (!voice) {
			return undefined;
		}
		if (step.verb === 'say' && this.talk) {
			const text = String(step.args.text ?? '').trim();
			const echo = this.alreadySaid(text, step.args);
			if (echo) {
				return { ok: false, verb: 'say', reason: `they already heard you say that ("${echo}"). Saying it again changes nothing: act on it, or say something new` };
			}
			const result = by.speak(step);
			if (result.ok && text) {
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
