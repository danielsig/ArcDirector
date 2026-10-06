import { formatArc, parseArc } from '../arc/parse.js';
import { arcSchema } from '../arc/schema.js';
import { FOCUS_EDIT_VERBS, WATCH_EDIT_VERBS, type VerbRegistry } from '../arc/stock-verbs.js';
import { Actor, type ActorDeps, type ActorJSON, type ActorOptions } from './actor.js';
import type { Arc, ArcResult, Step } from '../arc/types.js';
import { ArcError } from '../arc/types.js';
import { evaluate } from '../expr/eval.js';
import { observeExpr } from '../expr/stringify.js';
import type { Catalog, ExprEntity } from '../expr/types.js';
import { bagOf, cloneEntity, prevMeFromJSON } from '../expr/prev.js';
import { isVisionModel } from '../inference/models.js';
import type { ChatMessage, InferenceProvider, ToolDef } from '../inference/provider.js';
import { extractJson, isRecord, readID } from '../json.js';
import { MemoryStore, mergeTags, nameTags, type MemoryRecord } from '../memory/store.js';
import type { Sense, ToolSpec, Kit, KitSource } from './types.js';
import { parseMapZoom, stampMap, isMapSnapshot, DEFAULT_YOU_SYMBOL, type MapPrev, type MapSense } from './map.js';
import {
	articlesNamedIn,
	encyclopediaPages,
	mentionedArticles,
	grepEncyclopedia,
	isAboutItem,
	receivedArticles,
	GREP_WORLD_ENCYCLOPEDIA,
	type EncyclopediaSource,
} from './encyclopedia.js';
import { LOOKUP_TOOLS, arcRepairHint, blockedAgainHint, repeatOutputHint, sayRangeHint, shouldEmitArcText, stablePrefix, volatileBlock, type ThinkInstructions } from './prompt.js';
import { NameBook, type NameBookJSON, type NameTarget } from './names.js';
import {
	runArc,
	arcSteps,
	deferThinks,
	createArcSession,
	DEFAULT_COOLDOWN,
	THINK_ABOUT_CAP,
	type ArcHandler,
	type ArcSession,
	type ArcSessionOpts,
} from './run.js';
import { firstStep } from '../arc/types.js';
import type { SayTo, TalkNet } from './talk.js';
import { noWayTo } from '../world/route.js';
import type { AgentEvent, AgentIdentity, Goal, WatchInput, Watches } from './types.js';
import { waitUntilOf, type MindQueue } from '../think/queue.js';
import {
	applyWatchOps,
	asWatches,
	copyWatches,
	extrasWithoutPins,
	findWatchName,
	hasWatch,
	mergePinnedWatches,
	watchCount,
	watchExprs,
} from './watch.js';
import {
	asFocusList,
	DEFAULT_MAX_SIGHT_FOCUS,
	effectiveSightFocus,
	extrasWithoutPinnedFocus,
	mergePinnedFocus,
} from './focus.js';
import {
	DEFAULT_MAX_LAWS,
	dropLaw,
	lawFromSpec,
	upsertLaw,
	type CrowdLaw,
	type CrowdLawSpec,
} from '../conductor/laws.js';

/** A save: the body's part plus the mind. */
export type AgentJSON = ActorJSON & {
	identity:AgentIdentity;
	goals:Goal[];
	memories:MemoryRecord[];
	events?:AgentEvent[];
	watches?:WatchInput;
	pinnedWatches?:WatchInput;
	watchesWritable?:boolean;
	pinnedSightFocus?:string[];
	sightFocus?:string[];
	sightFocusWritable?:boolean;
	maxSightFocus?:number;
	sightLimit?:number;
	lastArc?:Arc;
	lastTacticalTimestamp?:number;
	lastStrategicTimestamp?:number;
	lastIntrusionTimestamp?:number;
	maxGoals:number;
	maxEpisodic:number;
	recent?:string[];
	recentSummary?:string;
	thinkAbout?:string;
	lastVerb?:string;
	names?:NameBookJSON;
};

/** What a mind needs on top of its body's `ActorDeps`. */
export type AgentDeps<TAgentCtx = unknown> = ActorDeps<TAgentCtx> & {
	provider:InferenceProvider;
	senses?:Record<string, Sense<TAgentCtx>>;
	tools?:Record<string, ToolSpec<TAgentCtx>>;
	/** When `execute` is set, `tick` runs the arc unless this is false. */
	autoEnact?:boolean;
	queue?:MindQueue;
	/** Heartbeat stretch after an arc. Default: failed or interrupted. */
	stalled?:(result:ArcResult)=>boolean;
	model?:string;
	embedModel?:string;
	heartbeat?:number;
	/** Tool rounds before the Arc must be emitted. Default {@link DEFAULT_TOOL_ROUNDS}; 0 offers no tools. */
	toolRoundCap?:number;
	/** Why there is no way for this body to `id` (`Bridge is raised`, or `''` unnamed), or undefined when there is. Marks unreachable names in earshot. */
	wayBlocked?:(id:string)=>string | undefined;
	/** Extra chat turns after a bad arc or a tool call with tools closed. Host sets this; 0 means fail on the first bad reply. */
	arcRetryCap?:number;
	/** Ask for `go_to() && wait()` text instead of Arc JSON. Testing toggle. Skips the JSON goals pass. */
	arcText?:boolean;
	/** Sampling temperature from the second repair turn on, so a model stuck on one bad reply moves. Default 0.4. */
	repairTemperature?:number;
	thinkInstructions?:ThinkInstructions;
	/** Whether the model reasons before it answers. Picks the think line. Default: it does. */
	thinking?:()=>boolean;
	/** Standing verb-chain line. Omit for {@link DEFAULT_VERB_INSTRUCTIONS}. */
	verbInstructions?:string;
	/** Arc that replaces the closing Example in the prompt. */
	arcExample?:string;
	/** Host naming policy seen from this agent: the base name for a body. Omit to use ids. */
	seenAs?:(target:NameTarget)=>string;
	maxGoals?:number;
	intrusionThreshold?:number;
	intrusionCooldown?:number;
	recallK?:number;
	strategicInterval?:number;
	hideObserve?:boolean;
	/** Host top-down snapshots. `see_map` is omitted unless this and vision are both set. */
	map?:MapSense;
	/** Host world-type articles. `grep_world_encyclopedia` is omitted unless this is set. */
	encyclopedia?:EncyclopediaSource<TAgentCtx>;
	/** Most articles shown per think for names said or heard. Default {@link DEFAULT_MENTION_CAP}; 0 shows none. */
	mentionCap?:number;
	/**
	 * Whether the current model accepts image parts.
	 * `false` never offers `see_map`. `true` offers it when `map` is set.
	 * Omit to fall back to `isVisionModel(model)`.
	 */
	vision?:boolean;
	watches?:WatchInput;
	pinnedWatches?:WatchInput;
	watchesWritable?:boolean;
	pinnedSightFocus?:string[];
	sightFocus?:string[];
	sightFocusWritable?:boolean;
	maxSightFocus?:number;
	sightLimit?:number;
};

export type AgentOptions<TAgentCtx = unknown> = AgentDeps<TAgentCtx> & ActorOptions<TAgentCtx> & {
	identity:AgentIdentity;
	goals?:Goal[];
	memory?:MemoryStore;
};

function asStringArray(v:unknown):string[] {
	if (!Array.isArray(v)) {
		return [];
	}
	return v.filter((x):x is string => typeof x === 'string');
}

/** Tool calls a think may make before it must emit the Arc. Small models need several lookups in a row. */
export const DEFAULT_TOOL_ROUNDS = 6;
/** Thinks in a row that only talk or wait before the next one must look something up first. */
const TALK_STREAK_LOOKUP = 3;
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
const BARE_RESULT = new Set(['ok', 'failed', 'interrupted']);

function foldRecent(prev:string, overflow:string[]):string {
	const next = [prev, ...overflow].filter((s) => s.trim().length > 0).join(' ').replace(/\s+/g, ' ').trim();
	if (next.length <= RECENT_SUMMARY_MAX) {
		return next;
	}
	return next.slice(next.length - RECENT_SUMMARY_MAX).trim();
}

function isBareResult(text:string):boolean {
	const t = text.trim().toLowerCase();
	return !t || BARE_RESULT.has(t) || /^\d+s$/.test(t);
}

function clauseAbout(scene:string, name:string):string {
	const parts = scene.split(/(?<=[.!?])\s+/);
	const hit = parts.find((p) => p.includes(name));
	return (hit ?? scene).replace(/\s+/g, ' ').trim().slice(0, 220);
}

/** An `Actor` with a mind: it thinks with the model, remembers, and picks its own arcs. */
export class Agent<TAgentCtx = unknown> extends Actor<TAgentCtx> {
	identity:AgentIdentity;
	goals:Goal[];
	readonly memory:MemoryStore;
	readonly senses:Record<string, Sense<TAgentCtx>>;
	readonly tools:Record<string, ToolSpec<TAgentCtx>>;
	readonly provider:InferenceProvider;
	readonly autoEnact:boolean;
	readonly queue:MindQueue | undefined;
	stalled?:(result:ArcResult)=>boolean;
	model:string;
	embedModel:string | undefined;
	heartbeat:number;
	toolRoundCap:number;
	readonly wayBlocked:((id:string)=>string | undefined) | undefined;
	arcRetryCap:number;
	/** Mutable so the Testing toggle can flip live agents. */
	arcText:boolean;
	repairTemperature:number;
	thinkInstructions:ThinkInstructions | undefined;
	thinking:()=>boolean;
	verbInstructions:string | undefined;
	arcExample:string | undefined;
	readonly seenAs:((target:NameTarget)=>string) | undefined;
	/** This agent's names for other bodies. Saved, because memories quote them. */
	readonly names = new NameBook();
	maxGoals:number;
	intrusionThreshold:number;
	intrusionCooldown:number;
	recallK:number;
	strategicInterval:number;
	hideObserve:boolean;
	map:MapSense | undefined;
	encyclopedia:EncyclopediaSource<TAgentCtx> | undefined;
	vision:boolean | undefined;
	watches:Watches;
	pinnedWatches:Watches;
	watchesWritable:boolean;
	pinnedSightFocus:string[];
	sightFocus:string[];
	sightFocusWritable:boolean;
	maxSightFocus:number;
	sightLimit:number | undefined;
	lastArc:Arc | undefined;
	lastTacticalTimestamp = Number.NEGATIVE_INFINITY;
	lastStrategicTimestamp = 0;
	lastIntrusionTimestamp = Number.NEGATIVE_INFINITY;
	private readonly pendingEvents:AgentEvent[] = [];
	private recent:string[] = [];
	private recentSummary = '';
	private recentAbsorbed = 0;
	private pendingSeeMapImage:string | undefined;
	private lastMap:MapPrev & { legend:string } | undefined;
	private pendingAbout:string | undefined;
	private lastVerb:string | undefined;
	/** Last accepted model reply, trimmed. A repeat of this is warned, not enacted. */
	private lastEmit = '';
	private emitStreak = 0;
	/** Accepted arcs in a row that only talked or waited. */
	private talkStreak = 0;
	/** Recent lines this agent said, with who heard each clearly. */
	private said:{ gist:Set<string>; text:string; heard:Set<string> }[] = [];
	private readonly mentionCap:number;
	private thinks = 0;
	/** Article name → the think it was last shown on for being mentioned. */
	private readonly mentionedOn = new Map<string, number>();
	/** Tool call (name and args) → the think it was last made on. */
	private readonly calledOn = new Map<string, number>();
	/** `verb id` pairs whose move found no way; `blockedAgain` refuses them until the way opens. */
	private readonly noWay = new Set<string>();

	constructor(opts:AgentOptions<TAgentCtx>) {
		super(opts);
		this.identity = opts.identity;
		this.goals = opts.goals ? [...opts.goals] : [];
		this.memory = opts.memory ?? new MemoryStore();
		this.senses = opts.senses ?? {};
		this.tools = opts.tools ?? {};
		this.provider = opts.provider;
		this.autoEnact = opts.autoEnact ?? true;
		this.queue = opts.queue;
		this.stalled = opts.stalled;
		this.model = opts.model ?? '';
		this.embedModel = opts.embedModel;
		this.heartbeat = opts.heartbeat ?? 30;
		this.toolRoundCap = opts.toolRoundCap ?? DEFAULT_TOOL_ROUNDS;
		this.wayBlocked = opts.wayBlocked;
		this.arcRetryCap = opts.arcRetryCap ?? 0;
		this.arcText = opts.arcText === true;
		this.repairTemperature = opts.repairTemperature ?? 0.4;
		this.thinkInstructions = opts.thinkInstructions;
		this.thinking = opts.thinking ?? (() => true);
		this.verbInstructions = opts.verbInstructions;
		this.arcExample = opts.arcExample;
		this.seenAs = opts.seenAs;
		this.maxGoals = opts.maxGoals ?? 5;
		this.intrusionThreshold = opts.intrusionThreshold ?? 0.55;
		this.intrusionCooldown = opts.intrusionCooldown ?? 45;
		this.recallK = opts.recallK ?? 5;
		this.strategicInterval = opts.strategicInterval ?? 180;
		this.hideObserve = opts.hideObserve ?? false;
		this.map = opts.map;
		this.encyclopedia = opts.encyclopedia;
		this.mentionCap = opts.mentionCap ?? DEFAULT_MENTION_CAP;
		this.vision = opts.vision;
		this.pinnedWatches = asWatches(opts.pinnedWatches);
		this.watches = extrasWithoutPins(asWatches(opts.watches), this.pinnedWatches);
		this.watchesWritable = opts.watchesWritable ?? true;
		this.pinnedSightFocus = asFocusList(opts.pinnedSightFocus, Number.POSITIVE_INFINITY);
		this.maxSightFocus = opts.maxSightFocus ?? DEFAULT_MAX_SIGHT_FOCUS;
		this.sightFocus = extrasWithoutPinnedFocus(
			asFocusList(opts.sightFocus, this.maxSightFocus),
			this.pinnedSightFocus,
		);
		this.sightFocusWritable = opts.sightFocusWritable ?? true;
		this.sightLimit = opts.sightLimit;
		if (this.talk) {
			this.talk.attach(this);
		}
		if (opts.maxGoals !== undefined) {
			this.trimGoals();
		}
	}

	/** A mind keeps the mind-only verbs, but not the watch / focus edits its host made read-only. */
	protected override withheldVerbs():readonly string[] {
		return [
			...(this.watchesWritable ? [] : WATCH_EDIT_VERBS),
			...(this.sightFocusWritable ? [] : FOCUS_EDIT_VERBS),
		];
	}

	private senseAllowed(name:string):boolean {
		if (this.kit === undefined) {
			return true;
		}
		const list = this.currentKit.senses;
		if (list === undefined) {
			return true;
		}
		return list.includes(name);
	}

	private toolsAllowed():readonly string[] | undefined {
		if (this.kit === undefined) {
			return undefined;
		}
		return this.currentKit.tools;
	}

	private filterTools(tools:Record<string, ToolSpec<TAgentCtx>>):Record<string, ToolSpec<TAgentCtx>> {
		const list = this.toolsAllowed();
		if (list === undefined) {
			return tools;
		}
		const next:Record<string, ToolSpec<TAgentCtx>> = {};
		for (const name of list) {
			if (tools[name]) {
				next[name] = tools[name];
			}
		}
		return next;
	}

	/** This agent's name for a body it is sampling now. Assigns one on first sight. */
	override seen(target:NameTarget):string {
		return this.seenAs ? this.names.name(target.id, this.seenAs(target)) : target.id;
	}

	/** This agent's name for `id`. A body it never sampled gets the policy's answer for a bare id, unrecorded. */
	override nameOf(id:string):string {
		return this.names.peek(id) ?? this.seenAs?.({ id }) ?? id;
	}

	/** The id behind a name this agent gave (or an id, unchanged). */
	override resolveName(name:string):string {
		return this.names.resolve(name);
	}

	/**
	 * `{0}`, `{1}`, … in the text become this agent's names for `who`, and this agent itself becomes "you":
	 * a small model reads "Forager gave FireMushroom to BridgeKeeper" about someone else, even as BridgeKeeper.
	 */
	pushEvent({ who, ...event }:AgentEvent):void {
		const names = (who ?? []).map((id) => this.nameOf(id));
		this.pendingEvents.push({
			...event,
			text: event.text.replace(/\{(\d+)\}/g, (hit, n, at:number) => {
				const id = who?.[Number(n)];
				if (id === undefined) {
					return hit;
				}
				return id === this.id ? (at === 0 ? 'You' : 'you') : names[Number(n)];
			}),
			tags: names.length > 0 ? mergeTags(event.tags, names) : event.tags,
			timestamp: event.timestamp ?? this.now,
		});
	}

	/** Unabsorbed speech meant for this agent: to it, naming it, or to everyone. Overheard talk does not count. */
	hasHeard():boolean {
		return this.pendingEvents.some((e) => e.kind === 'HeardSpeech' && e.major);
	}

	private capturePrevMe():void {
		const ctx = this.context();
		if (!ctx || !this.catalog) {
			return;
		}
		this.prevMe = cloneEntity(this.catalog(ctx).me);
	}

	/** Hosts that run world verbs themselves should call this so think() cooldown sees them. */
	noteVerb(verb:string):void {
		if (verb) {
			this.lastVerb = verb;
		}
	}

	/** Hosts that run the arc themselves still need this for remember / think / set_goal / set_identity. */
	async perform(step:Step, ctx:TAgentCtx | undefined = this.context()):Promise<ArcResult> {
		return this.runStep(step, ctx);
	}

	ingestResult(result:ArcResult):void {
		this.lastResult = result;
		if (result.unreachable && result.verb) {
			this.noWay.add(`${result.verb} ${result.unreachable}`);
		}
		this.liveArc = false;
		if (result.interrupted) {
			this.pushEvent({
				kind: 'Interrupted',
				text: result.reason ?? 'interrupted',
				tags: ['interrupted'],
			});
		}
		else {
			this.pushEvent({
				kind: 'arc_result',
				text: result.reason ?? (result.ok ? 'ok' : 'failed'),
				tags: [result.ok ? 'ok' : 'fail'],
			});
		}
		this.syncQueue(result);
	}

	protected override onArcStart(arc:Arc):void {
		this.queue?.beginArc(this.id, arc);
	}

	protected override onArcEnd():void {
		this.queue?.endArc(this.id);
	}

	/**
	 * An arc that ends on a say someone could answer gives the answer time to come before the next think.
	 * A say mid-arc does not wait: the rest of the arc (`say(...) && use(...)`) is what was decided.
	 */
	protected override async afterArc(result:ArcResult):Promise<void> {
		const due = result.ok && result.verb === 'say' && 'answerable' in result && result.answerable === true;
		if (due && this.execute) {
			await this.execute({ verb: 'wait', args: { seconds: 20 } }, this.context());
		}
	}

	protected override onArcResult(result:ArcResult):void {
		this.ingestResult(result);
	}

	async remember(text:string, tags:string[] = [], timestamp = this.now):Promise<MemoryRecord> {
		let embedding:number[] | undefined;
		if (this.provider.embed) {
			try {
				const [vec] = await this.provider.embed([text], this.embedModel);
				embedding = vec;
			}
			catch {
				embedding = undefined;
			}
		}
		return this.memory.add({
			category: 'semantic',
			text,
			tags: mergeTags(tags, nameTags(text)),
			timestamp,
			embedding,
		}, timestamp);
	}

	/** Living commander (crowd) or this mind. Chat thread, logs, and world face. */
	thinkThread():string {
		return this.id;
	}

	/** Cancel this mind's in-flight think. */
	abortThink():void {
		this.queue?.abortThink(this.id);
	}

	/**
	 * One tactical think, ignoring heartbeat. Occupies the think slot so a
	 * queued tick cannot start another. `enact` defaults to `autoEnact`. `now` is game time.
	 */
	async thinkNow(opts:{ now?:number; about?:string; enact?:boolean } = {}):Promise<Arc | null> {
		if (opts.now !== undefined) {
			this.now = opts.now;
		}
		this.refreshKit();
		this.absorbPending();
		if (opts.about !== undefined) {
			const about = opts.about.replace(/\s+/g, ' ').trim();
			this.pendingAbout = about.length > 0 ? about : undefined;
		}
		this.abortThink();
		return this.withThinkSlot(opts.enact ?? this.autoEnact, () => this.tactical());
	}

	async tick(gameTime:number):Promise<Arc | null> {
		this.now = gameTime;
		this.refreshKit();
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
			this.pendingAbout = undefined;
			this.lastArc = arc;
			this.lastTacticalTimestamp = this.now;
			this.capturePrevMe();
			// Only what this think read. Events that came in while the model answered (a gift, a reply) wait for the next one.
			this.pendingEvents.splice(0, this.recentAbsorbed);
			this.recentAbsorbed = 0;
		}
		catch (err) {
			if (signal?.aborted) {
				return null;
			}
			this.lastTacticalTimestamp = this.now;
			this.capturePrevMe();
			throw err;
		}
		finally {
			this.queue?.endThink(this.id, signal);
		}
		if (signal?.aborted) {
			return null;
		}
		if (arc && this.execute && enact) {
			await this.enact(arc);
		}
		return arc;
	}

	override toJSON():AgentJSON {
		return {
			...super.toJSON(),
			identity: { ...this.identity, traits: this.identity.traits ? [...this.identity.traits] : undefined },
			goals: this.goals.map((g) => ({ ...g })),
			memories: this.memory.toJSON(),
			events: this.pendingEvents.map((e) => ({ ...e, tags: e.tags ? [...e.tags] : undefined })),
			watches: copyWatches(this.watches),
			pinnedWatches: copyWatches(this.pinnedWatches),
			watchesWritable: this.watchesWritable,
			pinnedSightFocus: [...this.pinnedSightFocus],
			sightFocus: [...this.sightFocus],
			sightFocusWritable: this.sightFocusWritable,
			maxSightFocus: this.maxSightFocus,
			sightLimit: this.sightLimit,
			lastArc: this.lastArc,
			lastTacticalTimestamp: Number.isFinite(this.lastTacticalTimestamp) ? this.lastTacticalTimestamp : undefined,
			lastStrategicTimestamp: Number.isFinite(this.lastStrategicTimestamp) ? this.lastStrategicTimestamp : undefined,
			lastIntrusionTimestamp: Number.isFinite(this.lastIntrusionTimestamp) ? this.lastIntrusionTimestamp : undefined,
			maxGoals: this.maxGoals,
			maxEpisodic: this.memory.maxEpisodic,
			recent: [...this.recent],
			recentSummary: this.recentSummary || undefined,
			thinkAbout: this.pendingAbout,
			lastVerb: this.lastVerb,
			names: this.names.toJSON(),
		};
	}

	static fromJSON<TAgentCtx>(json:AgentJSON, deps:AgentDeps<TAgentCtx>):Agent<TAgentCtx> {
		const id = readID(json);
		if (!id) {
			throw new Error('agent json missing id');
		}
		const agent = new Agent({
			...deps,
			id,
			identity: json.identity,
			goals: json.goals,
			memory: MemoryStore.fromJSON(json.memories),
		});
		agent.loadJSON(json, deps);
		return agent;
	}

	protected override loadJSON(json:AgentJSON, deps?:AgentDeps<TAgentCtx>):void {
		super.loadJSON(json);
		this.memory.maxEpisodic = json.maxEpisodic;
		this.maxGoals = json.maxGoals;
		this.lastArc = json.lastArc;
		this.lastTacticalTimestamp = json.lastTacticalTimestamp ?? Number.NEGATIVE_INFINITY;
		this.lastStrategicTimestamp = json.lastStrategicTimestamp ?? 0;
		this.lastIntrusionTimestamp = json.lastIntrusionTimestamp ?? Number.NEGATIVE_INFINITY;
		const hostPins = asWatches(deps?.pinnedWatches);
		const jsonPins = asWatches(json.pinnedWatches);
		this.pinnedWatches = mergePinnedWatches(hostPins, jsonPins);
		this.watches = extrasWithoutPins(asWatches(json.watches), this.pinnedWatches);
		this.watchesWritable = json.watchesWritable ?? true;
		const hostFocus = asFocusList(deps?.pinnedSightFocus, Number.POSITIVE_INFINITY);
		const jsonFocus = asFocusList(json.pinnedSightFocus, Number.POSITIVE_INFINITY);
		this.pinnedSightFocus = mergePinnedFocus(hostFocus, jsonFocus);
		this.maxSightFocus = json.maxSightFocus ?? deps?.maxSightFocus ?? DEFAULT_MAX_SIGHT_FOCUS;
		this.sightFocus = extrasWithoutPinnedFocus(
			asFocusList(json.sightFocus, this.maxSightFocus),
			this.pinnedSightFocus,
		);
		this.sightFocusWritable = json.sightFocusWritable ?? true;
		this.sightLimit = json.sightLimit ?? deps?.sightLimit;
		for (const e of json.events ?? []) {
			this.pendingEvents.push(e);
		}
		this.recent = json.recent ? [...json.recent] : [];
		this.recentSummary = json.recentSummary ?? '';
		this.recentAbsorbed = this.pendingEvents.length;
		this.pendingAbout = json.thinkAbout;
		this.lastVerb = json.lastVerb;
		this.names.load(json.names);
		if (json.maxGoals !== undefined) {
			this.trimGoals();
		}
	}

	private tacticalDue(gameTime:number):boolean {
		if (!Number.isFinite(this.lastTacticalTimestamp)) {
			return true;
		}
		if (this.lastResult?.interrupted) {
			return true;
		}
		if (this.pendingEvents.some((e) => e.major)) {
			return true;
		}
		if (this.heartbeat <= 0) {
			return true;
		}
		return gameTime - this.lastTacticalTimestamp >= this.heartbeat;
	}

	private strategicDue(gameTime:number):boolean {
		if (this.pendingEvents.some((e) => e.major)) {
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
		const system = stablePrefix(this.id, this.identity, this.activeVerbs(), {
			includeWatches: true,
			omitArc: true,
		});
		const user = `${volatileBlock({
			goals: this.goals,
			pinned: this.memory.pinned(),
			recalled: this.recallForPrompt(),
			recent: this.recent,
			recentSummary: this.recentSummary,
		})}\n\n`
			+ 'Revise goals if what you just learned changes what you must do. '
			+ 'Harm, theft, and threats outrank standing work — put that first in goals. '
			+ 'Do not change identity unless who you are has actually changed for good. '
			+ 'Omit identity otherwise. Do not rewrite the role to summarize this moment. '
			+ 'Emit JSON {"goals":[{"text":"...","priority":0}]} and only if needed "identity":{"role":"...","traits":["..."]}. '
			+ `Keep at most ${this.maxGoals} goals. Do not emit movement.`;
		const res = await this.provider.chat({
			model: this.model,
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
				this.applyIdentityPatch(raw.identity);
			}
			if (Array.isArray(raw.goals)) {
				this.applyGoalList(raw.goals);
			}
		}
		catch {
			return;
		}
	}

	protected extraVolatile():string {
		const parts:string[] = [];
		if (this.laws.length > 0) {
			const lines = this.laws.map((law) => (
				this.crowdLawWho()
					? `- ${law.name}: who=${law.who} watch=${law.watch} → ${formatArc(law.arc, this.verbs.nested())}`
					: `- ${law.name}: watch=${law.watch} → ${formatArc(law.arc, this.verbs.nested())}`
			));
			parts.push(`Laws (emergencies, list order; unlaw to drop):\n${lines.join('\n')}`);
		}
		const read = this.receivedSinceThink();
		if (read) {
			parts.push(read);
		}
		return parts.join('\n\n');
	}

	private receivedSinceThink():string {
		const ctx = this.context();
		if (!this.encyclopedia || !this.catalog || !this.prevMe || ctx === undefined) {
			return '';
		}
		const pages = encyclopediaPages(this.encyclopedia, ctx);
		if (pages.length === 0) {
			return '';
		}
		const prev = new Set(bagOf(this.prevMe).map((item) => item.id));
		const gained = bagOf(this.catalog(ctx).me).filter((item) => !prev.has(item.id));
		return receivedArticles(pages, gained);
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
		const meantFor = [this.sayToOf(args) ?? this.talk.nearby(this.id)].flat();
		return this.said.find((line) => {
			const shared = [...gist].filter((w) => line.gist.has(w)).length;
			return shared / gist.size >= REPEAT_OVERLAP
				&& meantFor.length > 0 && meantFor.every((id) => line.heard.has(id));
		})?.text;
	}

	/**
	 * Articles for names said or heard lately: talk carries the outside facts an agent lacks, while its own
	 * reasoning would only feed its fixation. Item articles always say whether this mind carries one.
	 * The article text itself is not repeated within a few thinks.
	 */
	private mentionedText():string {
		const ctx = this.encyclopedia && this.mentionCap > 0 && this.recent.length > 0 ? this.context() : undefined;
		if (!this.encyclopedia || ctx === undefined) {
			return '';
		}
		const bag = this.catalog ? bagOf(this.catalog(ctx).me) : undefined;
		const lines:string[] = [];
		for (const entry of mentionedArticles(encyclopediaPages(this.encyclopedia, ctx), this.recent.join('\n'), Infinity)) {
			if (lines.length >= this.mentionCap) {
				break;
			}
			const name = entry.name.trim();
			const carried = entry.item && bag ? ` (${isAboutItem(entry, bag) ? 'you carry one' : 'you carry none'})` : '';
			if (this.thinks - (this.mentionedOn.get(name) ?? -Infinity) > MENTION_REPEAT) {
				this.mentionedOn.set(name, this.thinks);
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
		const ctx = reason ? this.context() : undefined;
		if (!reason || !this.encyclopedia || ctx === undefined) {
			return '';
		}
		return articlesNamedIn(encyclopediaPages(this.encyclopedia, ctx), reason);
	}

	protected trimGoals():void {
		if (this.goals.length <= this.maxGoals) {
			return;
		}
		this.goals = [...this.goals]
			.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
			.slice(0, this.maxGoals);
	}

	private gatherSensed():Record<string, unknown> {
		const ctx = this.context();
		const sensed:Record<string, unknown> = {};
		for (const [name, sense] of Object.entries(this.senses)) {
			if (!this.senseAllowed(name)) {
				continue;
			}
			try {
				sensed[name] = sense.gather(ctx as TAgentCtx);
			}
			catch {
				continue;
			}
		}
		if (this.talk) {
			sensed.earshot = this.earshotText();
		}
		return sensed;
	}

	private volatileUser(sensed:Record<string, unknown>, extra?:string):string {
		const perceptionText = Object.values(sensed)
			.map((v) => typeof v === 'string' ? v : JSON.stringify(v))
			.join('\n');
		const intrusion = this.maybeIntrude(perceptionText);
		this.noteSeen(perceptionText);
		const recalled = this.recallForPrompt(perceptionText);
		return [extra, volatileBlock({
			senses: sensed,
			intrusion,
			lastResult: this.lastResult,
			lastResultArticles: this.failureArticles(),
			goals: this.goals,
			pinned: this.memory.pinned(),
			recalled,
			watches: this.watches,
			pinnedWatches: this.pinnedWatches,
			watchesWritable: this.activeVerbs().has('watch'),
			pinnedSightFocus: this.pinnedSightFocus,
			sightFocus: this.sightFocus,
			sightFocusWritable: this.activeVerbs().has('focus'),
			recent: this.recent,
			recentSummary: this.recentSummary,
			mentioned: this.mentionedText(),
			thinkAbout: this.pendingAbout,
		}), this.extraVolatile()].filter(Boolean).join('\n\n');
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
			const arc = deferThinks(parseArc(raw, verbs));
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
		if (!liveVerbAtThink || !this.liveArc || this.lastVerb === liveVerbAtThink) {
			return arc;
		}
		this.absorbPending();
		const sensed = this.gatherSensed();
		const emitText = this.emitText(verbs);
		const form = emitText ? 'Arc text' : 'Arc JSON';
		const hint = `While you thought, the live verb changed from ${liveVerbAtThink} to ${this.lastVerb}. `
			+ `Do not think again. Emit a new ${form} if that changes your choices, or confirm the arc you already wrote.`;
		messages.push({ role: 'assistant', content: firstContent });
		messages.push({ role: 'user', content: this.volatileUser(sensed, hint) });
		const res = await this.provider.chat({
			model: this.model,
			thread: this.id,
			messages,
			tools: sendTools ? tools : undefined,
			toolChoice: sendTools ? 'none' : undefined,
			responseFormat: emitText
				? undefined
				: { name: 'arc', schema: arcSchema(verbs), strict: false },
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
		this.thinks += 1;
		const ctx = this.context();
		this.refreshKit();
		const liveVerbAtThink = this.liveArc ? this.lastVerb : undefined;
		// A repeat after new input (speech, an interruption, a nudge) can be right; without any, the model is stuck.
		const freshInput = this.hasFreshInput();
		const sensed = this.gatherSensed();
		const verbs = this.activeVerbs();
		const tools = this.toolRoundCap > 0 ? this.toolDefs() : [];
		const sendTools = tools.length > 0;
		const toolNames = tools.map((t) => t.name);
		const emitText = this.emitText(verbs);
		const system = stablePrefix(this.id, this.identity, verbs, {
			includeWatches: this.watchesWritable || watchCount(this.watchList()) > 0,
			watchesWritable: verbs.has('watch'),
			canObserve: toolNames.includes('observe'),
			canSeeMap: toolNames.includes('see_map'),
			canGrepEncyclopedia: toolNames.includes(GREP_WORLD_ENCYCLOPEDIA),
			youSymbol: this.youSymbol(),
			arcText: emitText,
			thinkInstructions: this.thinkInstructions,
			thinking: this.thinking(),
			verbInstructions: this.verbInstructions,
			arcExample: this.arcExample,
			tools: toolNames,
		});
		// Talking in circles: the first turn must call a lookup, so the missing fact gets looked up instead of asked for again.
		// Only lookups are offered, or the model answers with a check (earshot) that leads back to talk.
		const lookups = tools.filter((t) => LOOKUP_TOOLS.includes(t.name));
		const lookupFirst = lookups.length > 0 && this.talkStreak >= TALK_STREAK_LOOKUP;
		const user = this.volatileUser(sensed, lookupFirst
			? `You have only talked or waited for ${this.talkStreak} thinks. Look up what you lack before you act.`
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
				model: this.model,
				thread: this.id,
				messages,
				tools: !sendTools ? undefined : lookupFirst && turn === 0 ? lookups : tools,
				toolChoice: sendTools ? (lookupFirst && turn === 0 ? 'required' : allowTools ? 'auto' : 'none') : undefined,
				responseFormat: allowTools || emitText
					? undefined
					: { name: 'arc', schema: arcSchema(verbs), strict: false },
				temperature: this.arcRetryCap - repairsLeft > 1 || this.emitStreak >= 2
					? this.repairTemperature
					: 0,
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
					const key = `${call.name} ${call.arguments.replace(/\s+/g, '')}`;
					// A repeat did not help, so it is refused: any call within this think, a lookup within the last few.
					// Other tools (see_map, observe) may answer differently once the body has moved.
					const window = LOOKUP_TOOLS.includes(call.name) ? LOOKUP_REPEAT : 0;
					const result = this.thinks - (this.calledOn.get(key) ?? -Infinity) <= window
						? { error: 'Duplicate call. You made it this think or lately. Change the query, call another tool, or emit the arc.' }
						: await this.runTool(call.name, call.arguments, ctx);
					this.calledOn.set(key, this.thinks);
					messages.push({
						role: 'tool',
						content: typeof result === 'string' ? result : JSON.stringify(result),
						toolCallID: call.id,
					});
					if (this.pendingSeeMapImage) {
						messages.push({
							role: 'user',
							content: [
								{ type: 'text', text: 'The map. Legend is in the tool result; names only, no coordinates.' },
								{ type: 'image_url', image_url: { url: this.pendingSeeMapImage } },
							],
						});
						this.pendingSeeMapImage = undefined;
					}
				}
				toolsLeft -= 1;
				continue;
			}
			if (res.toolCalls.length > 0) {
				lastErr = new ArcError('model called a tool when it must emit an Arc');
				if (!this.pushRepair(messages, res, lastErr, repairsLeft, toolNames, emitText)) {
					throw lastErr;
				}
				repairsLeft -= 1;
				continue;
			}
			if (res.content) {
				let arc:Arc;
				let raw:unknown;
				try {
					const trimmed = res.content.trim();
					raw = (trimmed.startsWith('{') || trimmed.startsWith('```'))
						? extractJson(trimmed)
						: trimmed;
					arc = deferThinks(parseArc(raw, verbs));
				}
				catch (err) {
					lastErr = err instanceof Error ? err : new ArcError(String(err));
					if (!this.pushRepair(messages, res, lastErr, repairsLeft, toolNames, emitText)) {
						throw lastErr;
					}
					repairsLeft -= 1;
					continue;
				}
				if (!warnedRepeat && this.isRepeat(res.content)) {
					warnedRepeat = true;
					this.emitStreak += 1;
					messages.push({ role: 'assistant', content: res.content });
					messages.push({ role: 'user', content: repeatOutputHint(this.emitStreak, emitText) });
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
					messages.push({ role: 'assistant', content: res.content });
					messages.push({ role: 'user', content: blocked ? sayRangeHint(blocked.reason, blocked.nearby, emitText) : blockedAgainHint(again!, emitText) });
					continue;
				}
				if (typeof raw !== 'string') {
					this.applyMind(raw);
				}
				this.acceptEmit(res.content);
				this.talkStreak = arcSteps(arc).every((step) => TALK_VERBS.has(step.verb)) ? this.talkStreak + 1 : 0;
				return this.settleLiveArc(
					arc,
					res.content,
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

	private emitText(verbs:VerbRegistry):boolean {
		return shouldEmitArcText(verbs, this.arcText);
	}

	private isRepeat(text:string):boolean {
		const t = text.trim();
		return t !== '' && t === this.lastEmit;
	}

	private acceptEmit(text:string):void {
		if (this.isRepeat(text)) {
			return;
		}
		this.lastEmit = text.trim();
		this.emitStreak = this.lastEmit ? 1 : 0;
	}

	/** Anything since the last accepted think besides this agent's own arc result. */
	private hasFreshInput():boolean {
		return this.pendingAbout !== undefined || this.pendingEvents.some((e) => e.kind !== 'arc_result');
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

	effectiveWatches():string[] {
		return watchExprs(this.watchList());
	}

	/** Pins first, then extra, de-duplicated by name. */
	watchList():Watches {
		return { ...this.pinnedWatches, ...extrasWithoutPins(this.watches, this.pinnedWatches) };
	}

	/** Host or tests. Fails if the name is taken (pinned or extra) or empty. */
	addWatch(name:string, expr:string):boolean {
		const next = applyWatchOps(this.watches, this.pinnedWatches, {
			add: asWatches({ [name]: expr }),
			edit: {},
			remove: [],
		});
		if (watchCount(next) === watchCount(this.watches)) {
			return false;
		}
		this.watches = next;
		return true;
	}

	/** Host or tests. Fails if missing or pinned. */
	editWatch(name:string, expr:string):boolean {
		if (!hasWatch(this.watches, name) || hasWatch(this.pinnedWatches, name)) {
			return false;
		}
		const patched = asWatches({ [name]: expr });
		if (watchCount(patched) === 0) {
			return false;
		}
		this.watches = applyWatchOps(this.watches, this.pinnedWatches, {
			add: {},
			edit: patched,
			remove: [],
		});
		return true;
	}

	/** Host or tests. Fails if missing or pinned. */
	removeWatch(name:string):boolean {
		const next = applyWatchOps(this.watches, this.pinnedWatches, {
			add: {},
			edit: {},
			remove: [name],
		});
		if (watchCount(next) === watchCount(this.watches)) {
			return false;
		}
		this.watches = next;
		return true;
	}

	/** Dev-authored pin. Overwrites a pin of the same name; drops a colliding extra. */
	addPinnedWatch(name:string, expr:string):boolean {
		const row = asWatches({ [name]: expr });
		const n = Object.keys(row)[0];
		if (!n) {
			return false;
		}
		const extra = findWatchName(this.watches, n);
		if (extra) {
			const next = { ...this.watches };
			delete next[extra];
			this.watches = next;
		}
		const pin = findWatchName(this.pinnedWatches, n);
		if (pin) {
			this.pinnedWatches = { ...this.pinnedWatches, [pin]: row[n] };
			return true;
		}
		this.pinnedWatches = { ...this.pinnedWatches, [n]: row[n] };
		return true;
	}

	private absorbPending():void {
		for (let i = this.recentAbsorbed; i < this.pendingEvents.length; i++) {
			const e = this.pendingEvents[i];
			if (!e) {
				continue;
			}
			const text = e.text.trim();
			if (!text) {
				continue;
			}
			if (e.kind === 'arc_result') {
				if (isBareResult(text)) {
					continue;
				}
				this.noteRecent(text);
				this.keepFact(text, mergeTags(['result'], e.tags, nameTags(text)));
				continue;
			}
			this.noteRecent(text);
			if (e.remember) {
				const rows = this.memory.all();
				const last = rows[rows.length - 1];
				if (last?.text !== text) {
					this.memory.add({
						category: 'episodic',
						text,
						tags: mergeTags(e.tags, nameTags(text)),
						timestamp: e.timestamp ?? this.now,
					}, e.timestamp ?? this.now);
				}
			}
		}
		this.recentAbsorbed = this.pendingEvents.length;
	}

	private noteRecent(line:string):void {
		const text = line.trim();
		if (!text || this.recent[this.recent.length - 1] === text) {
			return;
		}
		this.recent.push(text);
		if (this.recent.length <= RECENT_CAP) {
			return;
		}
		const overflow = this.recent.splice(0, this.recent.length - RECENT_CAP);
		this.recentSummary = foldRecent(this.recentSummary, overflow);
	}

	private keepFact(text:string, tags:string[]):void {
		const line = text.trim();
		if (!line) {
			return;
		}
		const rows = this.memory.all();
		if (rows[rows.length - 1]?.text === line) {
			return;
		}
		this.memory.add({
			category: 'semantic',
			text: line,
			tags,
			timestamp: this.now,
		}, this.now);
	}

	private noteSeen(scene:string):void {
		const text = scene.trim();
		if (!text) {
			return;
		}
		for (const name of nameTags(text)) {
			if (name === this.id) {
				continue;
			}
			const snippet = clauseAbout(text, name);
			if (!snippet) {
				continue;
			}
			const line = `Last I saw ${name}: ${snippet}`;
			const tag = `seen:${name}`;
			const existing = this.memory.all().find((r) => r.category === 'semantic' && r.tags.includes(tag));
			if (existing) {
				if (existing.text !== line) {
					existing.text = line;
					existing.lastAccessed = this.now;
				}
				continue;
			}
			this.memory.add({
				category: 'semantic',
				text: line,
				tags: mergeTags([tag, name, 'seen'], nameTags(snippet)),
				timestamp: this.now,
			}, this.now);
		}
	}

	private recallForPrompt(scene = ''):MemoryRecord[] {
		const query = [
			...this.goals.map((g) => g.text),
			this.pendingAbout ?? '',
			...this.recent,
			this.recentSummary,
		].filter((s) => s.trim().length > 0).join(' ');
		if (!query.trim()) {
			return [];
		}
		const pinnedIds = new Set(this.memory.pinned().map((r) => r.id));
		const recentSet = new Set(this.recent);
		return this.memory.recall({
			query,
			k: this.recallK,
			now: this.now,
			skip: (r) => {
				if (r.pinned || pinnedIds.has(r.id) || recentSet.has(r.text)) {
					return true;
				}
				const seen = r.tags.find((t) => t.startsWith('seen:') && t.length > 5);
				return !!seen && scene.includes(seen.slice('seen:'.length));
			},
		});
	}

	effectiveSightFocus():string[] {
		return effectiveSightFocus(this.pinnedSightFocus, this.sightFocus);
	}

	private applyMind(raw:unknown):void {
		if (!isRecord(raw)) {
			return;
		}
		if (raw.identity !== undefined) {
			this.applyIdentityPatch(raw.identity);
		}
		if (raw.goals !== undefined) {
			this.applyGoalList(raw.goals);
		}
	}

	private applyIdentityPatch(raw:unknown):boolean {
		if (!isRecord(raw)) {
			return false;
		}
		const nextRole = typeof raw.role === 'string' ? raw.role.trim() : '';
		let changed = false;
		if (nextRole.length > 0 && nextRole !== this.identity.role) {
			this.identity.role = nextRole;
			changed = true;
		}
		if (Array.isArray(raw.traits)) {
			this.identity.traits = raw.traits.filter((x):x is string => (
				typeof x === 'string' && x.trim().length > 0
			));
			changed = true;
		}
		if (changed) {
			this.stampIdentity();
		}
		return changed;
	}

	private applyGoalList(raw:unknown):void {
		if (!Array.isArray(raw)) {
			return;
		}
		const goals:Goal[] = [];
		for (const g of raw) {
			if (isRecord(g) && typeof g.text === 'string' && g.text.trim()) {
				goals.push({
					text: g.text.trim(),
					priority: typeof g.priority === 'number' ? g.priority : undefined,
				});
			}
		}
		if (goals.length > 0) {
			this.goals = goals;
			this.trimGoals();
		}
	}

	private stampIdentity():void {
		const text = this.identity.role ? `I am ${this.id}. Role: ${this.identity.role}.` : `I am ${this.id}.`;
		const existing = this.memory.pinned().find((row) => (
			row.category === 'identity' || row.tags.includes('identity')
		));
		if (existing) {
			existing.text = text;
			existing.category = 'identity';
			if (!existing.tags.includes('identity')) {
				existing.tags = [...existing.tags, 'identity'];
			}
			return;
		}
		this.memory.add({
			category: 'identity',
			text,
			tags: ['identity'],
			pinned: true,
		}, this.now);
	}

	private maybeIntrude(perceptionText:string):string | undefined {
		if (this.now - this.lastIntrusionTimestamp < this.intrusionCooldown) {
			return undefined;
		}
		const tags = this.pendingEvents.flatMap((e) => e.tags ?? []);
		const hit = this.memory.intrusion({
			query: perceptionText,
			now: this.now,
			tags,
			threshold: this.intrusionThreshold,
		});
		if (!hit || hit.tags.includes('seen')) {
			return undefined;
		}
		this.lastIntrusionTimestamp = this.now;
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

	private mergedTools():Record<string, ToolSpec<TAgentCtx>> {
		const tools:{ [k:string]:ToolSpec<TAgentCtx> } = { ...this.tools };
		if (!tools.recall) {
			tools.recall = {
				description: 'Search your own memory: what you know, were told, saw, or did. Query the names or keywords your goal needs (Bread, Gate).',
				parameters: {
					type: 'object',
					additionalProperties: false,
					required: ['query'],
					properties: {
						query: { type: 'string' },
						k: { type: 'number' },
					},
				},
				handler: (ctx, args) => this.handleRecall(args),
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
				handler: (ctx, args) => this.handleObserve(ctx, args),
			};
		}
		if (this.talk && !tools.earshot) {
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
		if (this.encyclopediaOn() && !tools[GREP_WORLD_ENCYCLOPEDIA]) {
			tools[GREP_WORLD_ENCYCLOPEDIA] = {
				description: 'Look up world facts: places, items, people, who sells or makes what, how things work. Query a name or a plain word (trees, house) to learn its Capitalized name. Empty query lists every article.',
				parameters: {
					type: 'object',
					additionalProperties: false,
					properties: {
						query: { type: 'string' },
					},
				},
				handler: (ctx, args) => this.handleGrepEncyclopedia(ctx, args),
			};
		}
		return this.filterTools(tools);
	}

	private seeMapOn():boolean {
		return !!this.map && this.visionCapable();
	}

	private encyclopediaOn():boolean {
		return this.encyclopedia !== undefined;
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
		return isVisionModel(this.model);
	}

	private async handleSeeMap(args:unknown):Promise<unknown> {
		const zoom = parseMapZoom(args);
		if (!this.map) {
			return { ok: false, zoom, reason: 'no map' };
		}
		const prev = this.lastMap;
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
			this.pendingSeeMapImage = undefined;
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
		this.pendingSeeMapImage = stamped.image;
		this.lastMap = {
			timestamp: this.now,
			zoom,
			legend: stamped.legend,
			image: stamped.image,
			x: snap.x,
			y: snap.y,
		};
		return { ok: true, zoom, legend: stamped.legend };
	}

	private earshotText():string {
		// In earshot is not in reach (across a river) or clear (a mumble); unmarked, the agent walks into the river or talks to no avail.
		const names = (this.talk?.nearby(this.id) ?? []).map((id) => {
			const blocked = this.wayBlocked?.(id);
			const marks = [
				!this.talk!.clear(this.id, id) && 'too far to make out your words',
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
			const id = typeof arg === 'string' ? this.names.resolve(arg) : '';
			const key = `${head?.verb} ${id}`;
			if (!this.noWay.has(key)) {
				continue;
			}
			const why = this.wayBlocked?.(id);
			if (why === undefined) {
				this.noWay.delete(key);
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
		const check = this.talk.canSay(this.id, this.sayToOf(head.args));
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
		const nearby = this.talk.nearby(this.id).map((id) => this.nameOf(id));
		if (!to) {
			return nearby.length > 0 ? nearby : 'No one in talking range.';
		}
		const check = this.talk.canSay(this.id, this.names.resolve(to));
		if (!check.ok) {
			return { error: check.reason, inRange: false, nearby };
		}
		return { ok: true, inRange: true, nearby };
	}

	private handleObserve(ctx:TAgentCtx, args:unknown):unknown {
		const row = isRecord(args) ? args : {};
		const expr = typeof row.expr === 'string' ? row.expr : '';
		if (!expr) {
			return { error: 'observe needs expr' };
		}
		if (!this.catalog) {
			return { error: 'no catalog' };
		}
		return observeExpr(expr, this.catalog(ctx), evaluate);
	}

	private handleGrepEncyclopedia(ctx:TAgentCtx | undefined, args:unknown):unknown {
		const row = isRecord(args) ? args : {};
		const query = typeof row.query === 'string' ? row.query : '';
		const pages = encyclopediaPages(this.encyclopedia, ctx);
		return grepEncyclopedia(pages, query);
	}

	private async handleRecall(args:unknown):Promise<unknown> {
		const row = isRecord(args) ? args : {};
		const query = typeof row.query === 'string' ? row.query : '';
		const k = typeof row.k === 'number' ? row.k : this.recallK;
		let embedding:number[] | undefined;
		if (this.provider.embed && query) {
			try {
				const [vec] = await this.provider.embed([query], this.embedModel);
				embedding = vec;
			}
			catch {
				embedding = undefined;
			}
		}
		return [
			...this.recent.slice(-k).map((text) => ({
				id: 'recent',
				text,
				tags: ['recent'],
				category: 'episodic' as const,
			})),
			...this.memory.recall({
				query,
				k,
				now: this.now,
				embedding,
			}).map((m) => ({
				id: m.id,
				text: m.text,
				tags: m.tags,
				category: m.category,
			})),
		].slice(0, k);
	}

	private async runTool(name:string, rawArgs:string, ctx:TAgentCtx | undefined):Promise<unknown> {
		if (ctx === undefined) {
			return { error: 'no ctx' };
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

	private runThink(step:Step):ArcResult {
		if (this.lastVerb === 'think') {
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
		this.pendingAbout = about.length > 0 ? about : undefined;
		this.lastVerb = 'think';
		return { ok: true, verb: 'think' };
	}

	/** watch(name, expr) adds or replaces an extra watch; unwatch(name) drops one. Pins fail closed. */
	private runWatch(step:Step):ArcResult {
		const name = String(step.args.name ?? '');
		if (hasWatch(this.pinnedWatches, name)) {
			return { ok: false, verb: step.verb, reason: `${name} is a required watch` };
		}
		const expr = String(step.args.expr ?? '');
		const ok = step.verb === 'unwatch'
			? this.removeWatch(name)
			: this.editWatch(name, expr) || this.addWatch(name, expr);
		if (ok) {
			this.queue?.setWatches(this.id, this.effectiveWatches());
		}
		return { ok, verb: step.verb, reason: ok ? undefined : `no watch ${name}` };
	}

	/** focus(expr) puts an extra sightFocus first; unfocus(expr) drops one. Pins fail closed. */
	private runFocus(step:Step):ArcResult {
		const expr = String(step.args.expr ?? '').trim();
		if (this.pinnedSightFocus.includes(expr)) {
			return { ok: false, verb: step.verb, reason: 'that sightFocus is required' };
		}
		const rest = this.sightFocus.filter((e) => e !== expr);
		const ok = step.verb === 'focus' ? expr.length > 0 : rest.length < this.sightFocus.length;
		this.sightFocus = step.verb === 'focus' ? asFocusList([expr, ...rest], this.maxSightFocus) : rest;
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

	/** Mind verbs run here; `say` and world verbs run through the body. */
	protected override async runStep(step:Step, ctx:TAgentCtx | undefined):Promise<ArcResult> {
		if (!this.activeVerbs().has(step.verb)) {
			return super.runStep(step, ctx);
		}
		if (step.verb === 'think') {
			return this.runThink(step);
		}
		this.noteVerb(step.verb);
		if (WATCH_EDIT_VERBS.includes(step.verb)) {
			return this.runWatch(step);
		}
		if (FOCUS_EDIT_VERBS.includes(step.verb)) {
			return this.runFocus(step);
		}
		if (step.verb === 'remember') {
			const content = String(step.args.content ?? '');
			const tags = asStringArray(step.args.tags);
			await this.remember(content, tags, this.now);
			return { ok: true, verb: 'remember' };
		}
		if (step.verb === 'set_goal') {
			const goal = String(step.args.goal ?? '');
			const priority = typeof step.args.priority === 'number' ? step.args.priority : 0;
			this.goals.push({ text: goal, priority });
			this.trimGoals();
			return { ok: true, verb: 'set_goal' };
		}
		if (step.verb === 'drop_goal') {
			const goal = typeof step.args.goal === 'string' ? step.args.goal : undefined;
			if (!goal) {
				this.goals.pop();
			}
			else {
				this.goals = this.goals.filter((g) => g.text !== goal);
			}
			return { ok: true, verb: 'drop_goal' };
		}
		if (step.verb === 'set_identity') {
			const changed = this.applyIdentityPatch(step.args);
			return { ok: changed, verb: 'set_identity', reason: changed ? undefined : 'nothing to change' };
		}
		if (step.verb === 'say' && this.talk) {
			const text = String(step.args.text ?? '').trim();
			const echo = this.alreadySaid(text, step.args);
			if (echo) {
				return { ok: false, verb: 'say', reason: `they already heard you say that ("${echo}"). Saying it again changes nothing: act on it, or say something new` };
			}
			const result = this.speak(step);
			if (result.ok && text) {
				this.said = [...this.said, { gist: gistOf(text), text, heard: new Set(result.heard ?? []) }].slice(-SAID_CAP);
				const who = [this.sayToOf(step.args) ?? []].flat().map((id) => this.nameOf(id)).join(', ');
				this.noteRecent(who ? `You said to ${who}: "${text}"` : `You said: "${text}"`);
			}
			return result;
		}
		const once = waitUntilOf(step);
		if (once) {
			this.queue?.armOnce(this.id, once);
		}
		return super.runStep(step, ctx);
	}
}
