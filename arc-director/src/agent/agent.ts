import { formatArc, parseArc } from '../arc/parse.js';
import { arcSchema } from '../arc/schema.js';
import { FOCUS_EDIT_VERBS, WATCH_EDIT_VERBS, type VerbRegistry } from '../arc/stock-verbs.js';
import type { Arc, ArcResult, Step } from '../arc/types.js';
import { ArcError } from '../arc/types.js';
import { evaluate } from '../expr/eval.js';
import { observeExpr } from '../expr/stringify.js';
import type { Catalog, ExprEntity } from '../expr/types.js';
import { cloneEntity, prevMeFromJSON } from '../expr/prev.js';
import { isVisionModel } from '../inference/models.js';
import type { ChatMessage, InferenceProvider, ToolDef } from '../inference/provider.js';
import { extractJson, isRecord, readID } from '../json.js';
import { MemoryStore, mergeTags, nameTags, type MemoryRecord } from '../memory/store.js';
import type { Sense, ToolSpec, Kit, KitSource } from './types.js';
import { parseMapZoom, stampMap, isMapSnapshot, DEFAULT_YOU_SYMBOL, type MapPrev, type MapSense } from './map.js';
import {
	encyclopediaPages,
	grepEncyclopedia,
	GREP_WORLD_ENCYCLOPEDIA,
	type EncyclopediaSource,
} from './encyclopedia.js';
import { arcRepairHint, sayRangeHint, shouldEmitArcText, stablePrefix, volatileBlock, type ThinkInstructions } from './prompt.js';
import { NameBook, type NameBookJSON, type NameTarget } from './names.js';
import {
	runArc,
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

export type AgentJSON = {
	id:string;
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
	lastResult?:ArcResult;
	lastArc?:Arc;
	lastTacticalTimestamp?:number;
	lastStrategicTimestamp?:number;
	lastIntrusionTimestamp?:number;
	liveArc:boolean;
	maxGoals:number;
	maxEpisodic:number;
	recent?:string[];
	recentSummary?:string;
	thinkAbout?:string;
	lastVerb?:string;
	laws?:CrowdLaw[];
	maxLaws?:number;
	cooldown?:number;
	prevMe?:ExprEntity;
	names?:NameBookJSON;
};

export type AgentDeps<TAgentCtx = unknown> = {
	provider:InferenceProvider;
	verbs:VerbRegistry;
	senses?:Record<string, Sense<TAgentCtx>>;
	tools?:Record<string, ToolSpec<TAgentCtx>>;
	context:()=>TAgentCtx | undefined;
	execute?:(step:Step, ctx:TAgentCtx | undefined, actorID?:string)=>Promise<ArcResult>;
	abortArc?:(id:string)=>void;
	/** Host cooldown in game seconds after a handler pops or aborts. Default 8. */
	cooldown?:number;
	/** When `execute` is set, `tick` runs the arc unless this is false. */
	autoEnact?:boolean;
	queue?:MindQueue;
	/** Heartbeat stretch after an arc. Default: failed or interrupted. */
	stalled?:(result:ArcResult)=>boolean;
	model?:string;
	embedModel?:string;
	heartbeat?:number;
	toolRoundCap?:number;
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
	talk?:TalkNet;
	catalog?:(ctx:TAgentCtx)=>Catalog;
	hideObserve?:boolean;
	/** Host top-down snapshots. `see_map` is omitted unless this and vision are both set. */
	map?:MapSense;
	/** Host world-type articles. `grep_world_encyclopedia` is omitted unless this is set. */
	encyclopedia?:EncyclopediaSource<TAgentCtx>;
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
	/**
	 * Object or `(ctx) => kit`. Omit = all catalog verbs and all registered senses / tools (Agent tests).
	 * Director always passes a kit (`{}` if the spec omitted it).
	 */
	kit?:KitSource<TAgentCtx>;
};

export type AgentOptions<TAgentCtx = unknown> = AgentDeps<TAgentCtx> & {
	id:string;
	identity:AgentIdentity;
	goals?:Goal[];
	memory?:MemoryStore;
	laws?:CrowdLawSpec[];
	maxLaws?:number;
	defaultLawWho?:string;
};

function asStringArray(v:unknown):string[] {
	if (!Array.isArray(v)) {
		return [];
	}
	return v.filter((x):x is string => typeof x === 'string');
}

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

export class Agent<TAgentCtx = unknown> {
	readonly id:string;
	identity:AgentIdentity;
	goals:Goal[];
	readonly memory:MemoryStore;
	readonly verbs:VerbRegistry;
	readonly senses:Record<string, Sense<TAgentCtx>>;
	readonly tools:Record<string, ToolSpec<TAgentCtx>>;
	readonly provider:InferenceProvider;
	readonly context:()=>TAgentCtx | undefined;
	readonly execute?:(step:Step, ctx:TAgentCtx | undefined, actorID?:string)=>Promise<ArcResult>;
	readonly abortArc?:(id:string)=>void;
	cooldown:number;
	laws:CrowdLaw[] = [];
	maxLaws:number;
	protected defaultLawWho:string;
	readonly autoEnact:boolean;
	arcSession:ArcSession | null = null;
	readonly queue:MindQueue | undefined;
	stalled?:(result:ArcResult)=>boolean;
	model:string;
	embedModel:string | undefined;
	heartbeat:number;
	toolRoundCap:number;
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
	talk:TalkNet | undefined;
	catalog?:(ctx:TAgentCtx)=>Catalog;
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
	/** Object or callback. Assign a new one any time. Fetched every tick. */
	kit:KitSource<TAgentCtx> | undefined;
	private currentKit:Kit = {};

	lastResult:ArcResult | undefined;
	lastArc:Arc | undefined;
	/** Index of the step currently running inside `enact` (0-based). */
	verbIndex = 0;
	lastTacticalTimestamp = Number.NEGATIVE_INFINITY;
	/** Self at last tactical think; spawn freeze until then. */
	prevMe:ExprEntity | undefined;
	lastStrategicTimestamp = 0;
	lastIntrusionTimestamp = Number.NEGATIVE_INFINITY;
	liveArc = false;
	protected now = 0;
	private readonly pendingEvents:AgentEvent[] = [];
	private recent:string[] = [];
	private recentSummary = '';
	private recentAbsorbed = 0;
	private pendingSeeMapImage:string | undefined;
	private lastMap:MapPrev & { legend:string } | undefined;
	private pendingAbout:string | undefined;
	private lastVerb:string | undefined;

	constructor(opts:AgentOptions<TAgentCtx>) {
		this.id = opts.id;
		this.identity = opts.identity;
		this.goals = opts.goals ? [...opts.goals] : [];
		this.memory = opts.memory ?? new MemoryStore();
		this.verbs = opts.verbs;
		this.senses = opts.senses ?? {};
		this.tools = opts.tools ?? {};
		this.provider = opts.provider;
		this.context = opts.context;
		this.execute = opts.execute;
		this.abortArc = opts.abortArc;
		this.cooldown = opts.cooldown ?? DEFAULT_COOLDOWN;
		this.maxLaws = opts.maxLaws ?? DEFAULT_MAX_LAWS;
		this.defaultLawWho = opts.defaultLawWho ?? 'me';
		this.autoEnact = opts.autoEnact ?? true;
		this.queue = opts.queue;
		this.stalled = opts.stalled;
		this.model = opts.model ?? '';
		this.embedModel = opts.embedModel;
		this.heartbeat = opts.heartbeat ?? 30;
		this.toolRoundCap = opts.toolRoundCap ?? 2;
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
		this.talk = opts.talk;
		this.catalog = opts.catalog;
		this.hideObserve = opts.hideObserve ?? false;
		this.map = opts.map;
		this.encyclopedia = opts.encyclopedia;
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
		this.kit = opts.kit;
		if (this.talk) {
			this.talk.attach(this);
		}
		if (opts.maxGoals !== undefined) {
			this.trimGoals();
		}
		for (const spec of opts.laws ?? []) {
			this.addLaw(spec, spec.pinned);
		}
	}

	/** Resolve `kit` (object, getters, or callback). Director calls this each tick. */
	refreshKit():Kit {
		const src = this.kit;
		if (src === undefined) {
			this.currentKit = {};
			return this.currentKit;
		}
		if (typeof src === 'function') {
			try {
				const ctx = this.context();
				this.currentKit = ctx !== undefined ? (src(ctx) ?? {}) : {};
			}
			catch {
				this.currentKit = {};
			}
			return this.currentKit;
		}
		this.currentKit = src;
		return this.currentKit;
	}

	/**
	 * Catalog filtered by the current kit. Unset `kit` (standalone Agent) = whole catalog.
	 * The watch and focus verbs also need `watchesWritable` / `sightFocusWritable`.
	 */
	activeVerbs():VerbRegistry {
		this.refreshKit();
		const off = [
			...(this.watchesWritable ? [] : WATCH_EDIT_VERBS),
			...(this.sightFocusWritable ? [] : FOCUS_EDIT_VERBS),
		];
		const granted = this.kit === undefined
			? this.verbs.list().map((spec) => spec.name)
			: this.currentKit.verbs ?? [];
		const view = this.kit === undefined && off.length === 0
			? this.verbs
			: this.verbs.view(granted.filter((name) => !off.includes(name)));
		if (this.crowdLawWho() || !view.has('law')) {
			return view;
		}
		return view.withoutArg('law', 'who');
	}

	protected crowdLawWho():boolean {
		return false;
	}

	addLaw(spec:CrowdLawSpec, pinned = false):CrowdLaw | undefined {
		const law = lawFromSpec(
			{ ...spec, pinned: pinned || spec.pinned },
			this.verbs,
			spec.name ?? `law_${this.laws.length + 1}`,
			this.defaultLawWho,
		);
		if (!law) {
			return undefined;
		}
		this.laws = upsertLaw(this.laws, law, this.maxLaws);
		return this.laws.find((s) => s.name === law.name);
	}

	removeLaw(name:string):void {
		this.laws = dropLaw(this.laws, name);
	}

	lawHandlers(matches?:(law:CrowdLaw)=>boolean):ArcHandler[] {
		const out:ArcHandler[] = [];
		this.laws.forEach((law, i) => {
			if (matches && !matches(law)) {
				return;
			}
			out.push({
				key: `law:${law.name}`,
				watch: law.watch,
				arc: law.arc,
				rank: i,
			});
		});
		return out;
	}

	beginLaw(handler:ArcHandler, sessionOpts?:ArcSessionOpts):void {
		if (this.arcSession && (this.liveArc || this.arcSession.parked)) {
			this.arcSession.pending = { kind: 'preempt', handler };
			this.arcSession.token += 1;
			this.abortArc?.(this.id);
			return;
		}
		void this.enact(handler.arc, handler, sessionOpts);
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
	seen(target:NameTarget):string {
		return this.seenAs ? this.names.name(target.id, this.seenAs(target)) : target.id;
	}

	/** This agent's name for `id`. A body it never sampled gets the policy's answer for a bare id, unrecorded. */
	nameOf(id:string):string {
		return this.names.peek(id) ?? this.seenAs?.({ id }) ?? id;
	}

	pushEvent({ who, ...event }:AgentEvent):void {
		const names = (who ?? []).map((id) => this.nameOf(id));
		this.pendingEvents.push({
			...event,
			text: event.text.replace(/\{(\d+)\}/g, (hit, n) => names[Number(n)] ?? hit),
			tags: names.length > 0 ? mergeTags(event.tags, names) : event.tags,
			timestamp: event.timestamp ?? this.now,
		});
	}

	stamp(now:number):void {
		this.now = now;
	}

	/** Unabsorbed `HeardSpeech`. Cleared after a tactical think. */
	hasHeard():boolean {
		return this.pendingEvents.some((e) => e.kind === 'HeardSpeech');
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

	/** Run an arc (world verbs via `execute`). Arms wait(until), then notes the queue. */
	async enact(
		arc:Arc,
		handler?:ArcHandler,
		sessionOpts?:ArcSessionOpts,
	):Promise<ArcResult> {
		this.replaceProgram();
		this.liveArc = true;
		this.verbIndex = 0;
		this.queue?.beginArc(this.id, arc);
		const session = createArcSession({
			now: () => this.now,
			catalog: () => {
				const ctx = this.context();
				return ctx && this.catalog ? this.catalog(ctx) : undefined;
			},
			abortHost: () => this.abortArc?.(this.id),
			...sessionOpts,
		});
		this.arcSession = session;
		try {
			let i = 0;
			const result = await runArc(arc, async (step) => {
				this.verbIndex = i;
				i += 1;
				const out = await this.runStep(step, this.context());
				this.lastResult = out;
				return out;
			}, { session, asHandler: handler });
			if (this.arcSession !== session) {
				return result;
			}
			if (session.parked) {
				this.liveArc = false;
				this.queue?.endArc(this.id);
				return result;
			}
			this.ingestResult(result);
			return result;
		}
		finally {
			if (this.arcSession === session && !session.parked) {
				this.liveArc = false;
				this.arcSession = null;
				this.queue?.endArc(this.id);
			}
		}
	}

	replaceProgram():void {
		if (this.arcSession) {
			this.arcSession.token += 1;
			this.arcSession.pending = { kind: 'abort' };
			this.arcSession.abortHost?.();
		}
		this.abortArc?.(this.id);
		this.arcSession = null;
		this.liveArc = false;
		this.queue?.endArc(this.id);
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

	/** Cancel this mind's in-flight think. Same as `queue.abortThink(id)`. */
	abortThink():void {
		this.queue?.abortThink(this.id);
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
		const signal = this.queue?.beginThink(this.id);
		let arc:Arc | null = null;
		try {
			if (strategic) {
				await this.reviseGoals();
				this.lastStrategicTimestamp = gameTime;
			}
			if (!tactical || signal?.aborted) {
				return null;
			}
			arc = await this.tactical();
			if (signal?.aborted) {
				return null;
			}
			this.pendingAbout = undefined;
			this.lastArc = arc;
			this.lastTacticalTimestamp = gameTime;
			this.capturePrevMe();
			this.pendingEvents.length = 0;
			this.recentAbsorbed = 0;
		}
		catch (err) {
			if (signal?.aborted) {
				return null;
			}
			this.lastTacticalTimestamp = gameTime;
			this.capturePrevMe();
			throw err;
		}
		finally {
			this.queue?.endThink(this.id);
		}
		if (signal?.aborted) {
			return null;
		}
		if (arc && this.execute && this.autoEnact) {
			await this.enact(arc);
		}
		return arc;
	}

	toJSON():AgentJSON {
		return {
			id: this.id,
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
			lastResult: this.lastResult ? { ...this.lastResult } : undefined,
			lastArc: this.lastArc,
			lastTacticalTimestamp: Number.isFinite(this.lastTacticalTimestamp) ? this.lastTacticalTimestamp : undefined,
			lastStrategicTimestamp: Number.isFinite(this.lastStrategicTimestamp) ? this.lastStrategicTimestamp : undefined,
			lastIntrusionTimestamp: Number.isFinite(this.lastIntrusionTimestamp) ? this.lastIntrusionTimestamp : undefined,
			liveArc: this.liveArc,
			maxGoals: this.maxGoals,
			maxEpisodic: this.memory.maxEpisodic,
			recent: [...this.recent],
			recentSummary: this.recentSummary || undefined,
			thinkAbout: this.pendingAbout,
			lastVerb: this.lastVerb,
			laws: this.laws.map((s) => ({ ...s, arc: s.arc })),
			maxLaws: this.maxLaws,
			cooldown: this.cooldown,
			prevMe: this.prevMe ? cloneEntity(this.prevMe) : undefined,
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

	protected loadJSON(json:AgentJSON, deps?:AgentDeps<TAgentCtx>):void {
		this.memory.maxEpisodic = json.maxEpisodic;
		this.maxGoals = json.maxGoals;
		this.lastResult = json.lastResult;
		this.lastArc = json.lastArc;
		this.lastTacticalTimestamp = json.lastTacticalTimestamp ?? Number.NEGATIVE_INFINITY;
		this.lastStrategicTimestamp = json.lastStrategicTimestamp ?? 0;
		this.lastIntrusionTimestamp = json.lastIntrusionTimestamp ?? Number.NEGATIVE_INFINITY;
		this.liveArc = json.liveArc;
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
		if (json.maxLaws !== undefined) {
			this.maxLaws = json.maxLaws;
		}
		if (json.cooldown !== undefined) {
			this.cooldown = json.cooldown;
		}
		this.prevMe = prevMeFromJSON(json.prevMe);
		this.names.load(json.names);
		if (json.laws) {
			this.laws = json.laws.map((s) => ({ ...s }));
		}
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
		if (this.laws.length === 0) {
			return '';
		}
		const lines = this.laws.map((law) => (
			this.crowdLawWho()
				? `- ${law.name}: who=${law.who} watch=${law.watch} → ${formatArc(law.arc, this.verbs.nested())}`
				: `- ${law.name}: watch=${law.watch} → ${formatArc(law.arc, this.verbs.nested())}`
		));
		return `Laws (emergencies, list order; unlaw to drop):\n${lines.join('\n')}`;
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
		const ctx = this.context();
		this.refreshKit();
		const liveVerbAtThink = this.liveArc ? this.lastVerb : undefined;
		const sensed = this.gatherSensed();
		const verbs = this.activeVerbs();
		const tools = this.toolDefs();
		const seeMapBoost = this.seeMapOn() && this.toolRoundCap <= 0 ? 1 : 0;
		const sendTools = tools.length > 0 && (this.toolRoundCap > 0 || seeMapBoost > 0);
		const toolNames = sendTools ? tools.map((t) => t.name) : [];
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
		const user = this.volatileUser(sensed);
		const messages:ChatMessage[] = [
			{ role: 'system', content: system },
			{ role: 'user', content: user },
		];
		let toolsLeft = tools.length === 0 ? 0 : this.toolRoundCap + seeMapBoost;
		let repairsLeft = this.arcRetryCap;
		let rangeLeft = this.talk ? Math.max(1, this.arcRetryCap) : 0;
		let lastErr:Error | null = null;
		const budget = this.toolRoundCap + seeMapBoost + this.arcRetryCap + 1 + (this.talk ? 1 : 0);
		for (let turn = 0; turn < budget; turn++) {
			const allowTools = toolsLeft > 0 && tools.length > 0;
			const res = await this.provider.chat({
				model: this.model,
				thread: this.id,
				messages,
				tools: sendTools ? tools : undefined,
				toolChoice: sendTools ? (allowTools ? 'auto' : 'none') : undefined,
				responseFormat: allowTools || emitText
					? undefined
					: { name: 'arc', schema: arcSchema(verbs), strict: false },
				temperature: this.arcRetryCap - repairsLeft > 1 ? this.repairTemperature : 0,
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
					const result = await this.runTool(call.name, call.arguments, ctx);
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
				const blocked = this.unreachableSay(arc);
				if (blocked) {
					lastErr = new ArcError(blocked.reason);
					if (rangeLeft <= 0) {
						throw lastErr;
					}
					rangeLeft -= 1;
					messages.push({ role: 'assistant', content: res.content });
					messages.push({ role: 'user', content: sayRangeHint(blocked.reason, blocked.nearby, emitText) });
					continue;
				}
				if (typeof raw !== 'string') {
					this.applyMind(raw);
				}
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
		}).filter((r) => {
			if (r.pinned || pinnedIds.has(r.id) || recentSet.has(r.text)) {
				return false;
			}
			const seen = r.tags.find((t) => t.startsWith('seen:') && t.length > 5);
			if (seen && scene.includes(seen.slice('seen:'.length))) {
				return false;
			}
			return true;
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
				description: 'Search this agent\'s episodic and semantic memory. Prefer names, not coordinates.',
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
				description: 'Pictogram of the land. Prefer the English scene. Unnamed place: wander(until) or ask. A second look soon, without moving, is the same legend and no new picture.',
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
				description: 'Grep world-type docs. Query leftover English (trees, house) for the Capitalized name. Empty query lists names.',
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
		if (this.seeMapOn() && this.toolRoundCap <= 0 && tools.see_map) {
			return this.filterTools({ see_map: tools.see_map });
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
		const names = (this.talk?.nearby(this.id) ?? []).map((id) => this.nameOf(id));
		if (names.length === 0) {
			return 'No one in talking range. say(to) will fail until you are closer.';
		}
		return `In talking range: ${names.join(', ')}. say(to) only those names; get closer to anyone else first. Far-off speech is muffled.`;
	}

	/** Addressee ids. The model writes its own names for them. */
	protected sayToOf(args:Step['args']):SayTo | undefined {
		const to = args.to;
		if (Array.isArray(to)) {
			const ids = to
				.filter((x):x is string => typeof x === 'string' && x.trim().length > 0)
				.map((name) => this.names.resolve(name));
			return ids.length > 0 ? ids : undefined;
		}
		if (typeof to === 'string' && to.trim()) {
			return this.names.resolve(to);
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

	private async runStep(step:Step, ctx:TAgentCtx | undefined):Promise<ArcResult> {
		this.refreshKit();
		if (!this.activeVerbs().has(step.verb)) {
			return { ok: false, verb: step.verb, reason: `verb '${step.verb}' is not available` };
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
			const text = String(step.args.text ?? '');
			const to = this.sayToOf(step.args);
			const result = this.talk.say(this.id, text, to, this.now);
			if (result.ok && text.trim()) {
				const who = [to ?? []].flat().map((id) => this.nameOf(id)).join(', ');
				this.noteRecent(who ? `You said to ${who}: "${text.trim()}"` : `You said: "${text.trim()}"`);
			}
			return result;
		}
		if (!this.execute) {
			return { ok: false, verb: step.verb, reason: `host has no executor for ${step.verb}` };
		}
		const once = waitUntilOf(step);
		if (once) {
			this.queue?.armOnce(this.id, once);
		}
		return this.execute(step, ctx);
	}
}
