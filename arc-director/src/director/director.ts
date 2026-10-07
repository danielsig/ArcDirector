import { argBase, registerStockVerbs, VerbRegistry, type StockVerb, type VerbArgMap } from '../arc/stock-verbs.js';
import { arcArg, formatArc } from '../arc/parse.js';
import type { ArcResult, Step } from '../arc/types.js';
import { ArcError, firstStep } from '../arc/types.js';
import { lawGroup, type Law, type LawSpec } from '../arc/laws.js';
import type { ArcRunner, RunnerOptions } from '../character/arc-runner.js';
import { Character, type CharacterJSON, type Wiring } from '../character/character.js';
import { Persona } from '../character/persona.js';
import type { Kit, KitSource } from '../character/types.js';
import type { NameTarget } from '../character/names.js';
import { Collective, type CollectiveHost, type CollectiveJSON } from '../collective/collective.js';
import { Mind, type MindDeps, type MindSettings } from '../mind/mind.js';
import type { MindEvent, Sense, ToolSpec } from '../mind/types.js';
import type { ThinkInstructions } from '../mind/prompt.js';
import { TalkNet, type SpeechUtterance, type TalkConfig, type TalkSense } from '../mind/talk.js';
import type { MapSense } from '../mind/map.js';
import {
	GREP_WORLD_ENCYCLOPEDIA,
	type EncyclopediaSource,
} from '../mind/encyclopedia.js';
import { buildCatalog, dummyEntity, type HostKernels } from '../expr/natives.js';
import { freezeMe, type MeFreezeHost } from '../expr/prev.js';
import { catalogEntities, evaluate } from '../expr/eval.js';
import { parse } from '../expr/parse.js';
import { watchScore } from '../expr/score.js';
import { SampleCache, leftoverFilterHint, type Catalog, type ExprEntity, type ExprVal } from '../expr/types.js';
import {
	formatSight,
	formatSightClauses,
	joinSightClauses,
	mergeHiveClauses,
	orderSightClauses,
} from '../perception/sight.js';
import { formatInventory } from '../perception/formatInventory.js';
import type { Inventory } from '../perception/inventory.js';
import type { SeenObject, Sight } from '../perception/types.js';
import {
	registerStockCollectiveVerbs,
	STOCK_COLLECTIVE_VERBS,
	isFormationVerb,
	type StockCollectiveVerb,
} from '../collective/verbs.js';
import { buildCollectiveCatalog, evaluateWho, lawMatches, usesCollective } from '../collective/who.js';
import { chatHandover, HANDOVER_THREAD, type Handover, type Journey, type MemoryEdit } from '../collective/handover.js';
import { nameTags, type MemoryRecord } from '../memory/store.js';
import {
	DEFAULT_COOLDOWN,
	createArcSession,
	firstStartable,
	pollArcSession,
	type ArcHandler,
	type ArcSession,
} from '../arc/run.js';
import type { ChatRequest, ChatResponse, InferenceProvider } from '../inference/provider.js';
import type { FakeChatFn } from '../inference/fake.js';
import { isVisionModel, type ModelInfo } from '../inference/models.js';
import { HttpProvider } from '../inference/http.js';
import { formatChatLog } from '../inference/chatLog.js';
import {
	connectHttpInference,
	fakeInference,
	lmStudioConfig,
	ollamaConfig,
	type HttpInferenceOpts,
} from '../inference/presets.js';
import {
	DEFAULT_BATCH_THINKS,
	DEFAULT_BATCH_WAIT,
	SimpleQueue,
	ThinkQueue,
	type MindQueue,
	type SimpleQueueOpts,
	type ThinkQueueOpts,
	type ThinkRow,
} from '../think/queue.js';
import {
	emptyInferClock,
	type CharacterSpec,
	type CollectiveSpec,
	type DirectorLog,
	type InferClock,
	type KernelSource,
	type SeenName,
	type StartOpts,
	type StockVerbArgs,
	type StockVerbName,
	type VerbArgs,
	type VerbCall,
	type VerbGate,
	type VerbHandler,
} from './types.js';
import { geometryKernels, wayBlocked } from '../world/kernels.js';
import { Mover } from '../world/mover.js';
import { poseOf } from '../world/lookup.js';
import type { HostWorld, Pose, Vec } from '../world/types.js';
import { centroid, distance } from '../world/vec.js';
import { missingParts, worldVerbs } from '../world/verbs.js';

const STARTED = 'ArcDirector already started';

/** A wait in progress (stock `wait`, or a handler's `call.wait`), settled by `tick`. */
type Wait = { characterID:string; verb:string; end:number; seconds:number; met?:()=>boolean; done:(result:ArcResult)=>void };

/** Watch value as a 0–1 fit. A non-empty list or an entity counts as true. */
function fit(value:ExprVal):number {
	if (value.kind === 'list') {
		return value.value.length > 0 ? 1 : 0;
	}
	return value.kind === 'entity' ? 1 : watchScore(value).score;
}

/** Why a watch expression can never hold (bad syntax, leftover English), as opposed to false right now. */
function watchProblem(expr:string, catalog:Catalog | undefined):string | undefined {
	try {
		parse(expr);
	}
	catch (err) {
		return `${expr}: ${err instanceof Error ? err.message : String(err)}`;
	}
	return catalog ? leftoverFilterHint(expr, catalogEntities(catalog)) : undefined;
}

/** What an `id` expression picked: an entity, or the first entity of a list. */
function pickedEntity(value:ExprVal):ExprEntity | undefined {
	if (value.kind === 'entity') {
		return value.value;
	}
	return value.kind === 'list' ? value.value.find((v) => v.kind === 'entity')?.value as ExprEntity | undefined : undefined;
}

type InferenceSlot =
	| { kind:'unset' }
	| { kind:'fake'; chat?:FakeChatFn }
	| { kind:'http'; opts:HttpInferenceOpts }
	| { kind:'custom'; provider:InferenceProvider; model?:string; vision?:boolean };

type QueueSlot =
	| { kind:'default' }
	| { kind:'priority'; opts?:ThinkQueueOpts }
	| { kind:'simple'; opts?:SimpleQueueOpts }
	| { kind:'instance'; queue:MindQueue };

/** What ArcDirector keeps per character or collective: the spec it was built from, and its per-tick sample cache. */
type Row<TSpec, TRunner> = {
	spec:TSpec;
	runner:TRunner;
	cache:SampleCache;
};

/** A save of every character and collective: `ArcDirector.exportCast`. */
export type CastJSON = {
	characters:Record<string, CharacterJSON>;
	collectives:Record<string, CollectiveJSON>;
};

function nowMs():number {
	return performance.now();
}

function whoFromMessages(req:ChatRequest):string {
	for (const m of req.messages) {
		if (m.role !== 'system' || typeof m.content !== 'string') {
			continue;
		}
		const hit = /^You are ([^.]+)/.exec(m.content);
		if (hit) {
			return hit[1].trim();
		}
	}
	return req.thread ?? 'ArcDirector';
}

function sightDistanceDescription(unitName?:string):string {
	const dist = !unitName || unitName === 'pace'
		? 'distances in paces'
		: `distances in ${unitName}`;
	return `What you can see. Names only, ${dist}.`;
}

export class ArcDirector<TCtx = unknown> {
	private started = false;
	/** `restoreCast` before `start()`; the cast is built from it when it is wired. */
	private stored:CastJSON | undefined;
	private disposed = false;
	private inference:InferenceSlot = { kind: 'unset' };
	private queueSlot:QueueSlot = { kind: 'default' };
	private queue:MindQueue | undefined;
	private http:HttpProvider | undefined;
	private verbs = new VerbRegistry();
	private readonly handlers = new Map<string, VerbHandler<TCtx>>();
	private catchAll:VerbHandler<TCtx> | undefined;
	private verbGate:VerbGate<TCtx> | undefined;
	private readonly waits = new Set<Wait>();
	private world:HostWorld<unknown> | undefined;
	/** Stock world verbs, bound at `start()` for the parts `withWorld` has. A host handler of the same name wins. */
	private readonly stockHandlers = new Map<string, VerbHandler<TCtx>>();
	private mover = new Mover(undefined, () => this.clock);
	private toolRounds:number | undefined;
	private arcRetries:number | undefined;
	private stalledFn:((result:ArcResult)=>boolean) | undefined;
	private senses:Record<string, Sense<TCtx>> = {};
	private tools:Record<string, ToolSpec<TCtx>> = {};
	private losFn:((aID:string, bID:string)=>boolean) | undefined;
	private sightLook:((ctx:TCtx)=>Sight) | undefined;
	private sightLimitDefault:number | undefined;
	private sightUnitName:string | undefined;
	private contextFn:((id:string)=>TCtx | undefined) | undefined;
	private kernelFn:KernelSource<TCtx> | undefined;
	private defaultKit:KitSource<TCtx> | undefined;
	private cooldownDefault = DEFAULT_COOLDOWN;
	private talkSense:TalkSense | undefined;
	private onSpoke:((utterance:SpeechUtterance)=>void) | undefined;
	private talkConfig:Partial<TalkConfig> | undefined;
	talk:TalkNet | undefined;
	private map:MapSense | undefined;
	private encyclopedia:EncyclopediaSource<TCtx> | undefined;
	private mentionCap:number | undefined;
	private abortArcFn:((id:string)=>void) | undefined;
	private commanderVacantFn:((collective:Collective<TCtx>, character:Character<TCtx>)=>void) | undefined;
	private logFn:((entry:DirectorLog)=>void) | undefined;
	private stepFn:((call:VerbCall<TCtx>, result:ArcResult)=>void) | undefined;
	private ignoreMissing = false;
	private arcText = false;
	private thinkInstructions:ThinkInstructions | undefined;
	private verbInstructions:string | undefined;
	private arcExample:string | undefined;
	private repairTemperature:number | undefined;
	private seenFn:SeenName<TCtx> | undefined;
	private mindDefaults:MindSettings = {};
	/** `undefined` until `start()` picks the default; `false` when the host turned it off. */
	private handover:Handover<TCtx> | false | undefined;
	private handoverTicks = 1;
	/** Moves waiting for the next handover, one per character: its first `from`, its latest `to`. */
	private readonly journeys = new Map<Character<TCtx>, Journey<TCtx>>();
	private journeyTicks = 0;
	/** A handover call holds one think slot until it answers. */
	private handoverBusy = false;
	/** Specs from `addCharacter`, in order: the characters on their own when the cast is built or restored. */
	private readonly soloSpecs:CharacterSpec<TCtx>[] = [];
	private readonly collectiveSpecs:CollectiveSpec<TCtx>[] = [];
	/** Every character spec by id, on its own or in a collective. One id namespace covers characters and collectives. */
	private readonly specs = new Map<string, CharacterSpec<TCtx>>();
	private readonly characterRows = new Map<string, Row<CharacterSpec<TCtx>, Character<TCtx>>>();
	private readonly collectiveRows = new Map<string, Row<CollectiveSpec<TCtx>, Collective<TCtx>>>();
	private readonly readyThink:ThinkRow[] = [];
	private batchHeldTimestamp:number | null = null;
	private clock = 0;
	private loop:ReturnType<typeof setInterval> | undefined;
	private provider:InferenceProvider | undefined;
	model = '';
	vision = false;
	catalog:ModelInfo[] = [];
	infer:InferClock = emptyInferClock();

	get ready():boolean {
		return this.started && !this.disposed;
	}

	private assertBuilder():void {
		if (this.started) {
			throw new Error(STARTED);
		}
	}

	private emitLog(entry:DirectorLog):void {
		this.logFn?.(entry);
	}

	withPriorityQueue(opts?:ThinkQueueOpts):this {
		this.assertBuilder();
		this.queueSlot = { kind: 'priority', opts };
		return this;
	}

	withSimpleQueue(opts?:SimpleQueueOpts):this {
		this.assertBuilder();
		this.queueSlot = { kind: 'simple', opts };
		return this;
	}

	withQueue(queue:MindQueue):this {
		this.assertBuilder();
		this.queueSlot = { kind: 'instance', queue };
		return this;
	}

	withLMStudioInference(opts?:HttpInferenceOpts):this {
		this.assertBuilder();
		this.inference = { kind: 'http', opts: { ...lmStudioConfig(opts ?? {}), model: opts?.model } };
		return this;
	}

	withOllamaInference(opts?:HttpInferenceOpts):this {
		this.assertBuilder();
		this.inference = { kind: 'http', opts: { ...ollamaConfig(opts ?? {}), model: opts?.model } };
		return this;
	}

	withHttpInference(opts:HttpInferenceOpts):this {
		this.assertBuilder();
		this.inference = { kind: 'http', opts };
		return this;
	}

	withFakeInference(chat?:FakeChatFn):this {
		this.assertBuilder();
		this.inference = { kind: 'fake', chat };
		return this;
	}

	withInference(provider:InferenceProvider, opts?:{ model?:string; vision?:boolean }):this {
		this.assertBuilder();
		this.inference = { kind: 'custom', provider, model: opts?.model, vision: opts?.vision };
		return this;
	}

	addSense(name:string, spec:Sense<TCtx>):this {
		this.senses[name] = spec;
		return this;
	}

	addTool(name:string, spec:ToolSpec<TCtx>):this {
		this.tools[name] = spec;
		return this;
	}

	withSight({ look, limit, unitName }:{
		look?:(ctx:TCtx)=>Sight;
		limit?:number;
		unitName?:string;
	}):this {
		this.assertBuilder();
		if (limit !== undefined) {
			this.sightLimitDefault = limit;
		}
		if (unitName !== undefined) {
			this.sightUnitName = unitName;
		}
		if (this.senses.sight) {
			this.senses.sight.description = sightDistanceDescription(this.sightUnitName);
		}
		if (!look) return this;
		this.sightLook = look;
		this.senses.sight = {
			description: sightDistanceDescription(this.sightUnitName),
			gather: (ctx) => {
				const snap = this.filterSight(look(ctx));
				return formatSight(snap, this.sightFormatOpts());
			},
		};
		return this;
	}

	withCooldown(seconds:number):this {
		this.assertBuilder();
		this.cooldownDefault = seconds;
		return this;
	}

	withArcText(on:boolean):this {
		this.assertBuilder();
		this.arcText = on;
		return this;
	}

	/**
	 * Standing think line per reasoning state. The prompt follows the live reasoning switch.
	 * Defaults: `on` `DEFAULT_THINK_INSTRUCTIONS`, `off` nothing.
	 */
	withThinkInstructions(lines:ThinkInstructions):this {
		this.assertBuilder();
		this.thinkInstructions = lines;
		return this;
	}

	/** Standing verb-chain line. Default `DEFAULT_VERB_INSTRUCTIONS`, plus looping programs for a collective; this replaces both. */
	withVerbInstructions(text:string):this {
		this.assertBuilder();
		this.verbInstructions = text;
		return this;
	}

	/** Arc that closes the prompt as its Example, in place of the stock one. Models copy it, so make it valid. */
	withArcExample(arc:string):this {
		this.assertBuilder();
		this.arcExample = arc;
		return this;
	}

	/**
	 * Repair turns after a bad arc. `retries` is how many (default 0: a bad reply fails the think).
	 * `temperature` applies from the second repair on, so a model stuck on one reply moves (default 0.4).
	 */
	withRepair({ retries, temperature }:{ retries?:number; temperature?:number }):this {
		this.assertBuilder();
		this.arcRetries = retries;
		this.repairTemperature = temperature;
		return this;
	}

	/** Tool rounds a think may spend before it must emit the Arc. Default `DEFAULT_TOOL_ROUNDS`; 0 offers no tools. */
	withToolRounds(rounds:number):this {
		this.assertBuilder();
		this.toolRounds = rounds;
		return this;
	}

	/** Whether a finished arc stalled, which stretches the heartbeat. Default: it failed or was interrupted. */
	withStalled(fn:(result:ArcResult)=>boolean):this {
		this.assertBuilder();
		this.stalledFn = fn;
		return this;
	}

	/**
	 * How each mind names other characters. `seen` returns a base name from what the mind holds about
	 * the target; its owner's book keeps that name stable and numbers duplicates (`EnemyWitch2`).
	 * Applied to sight, earshot, heard speech, watch-language entities, and event `who`. Arcs, laws and
	 * watches are kept in ids: each mind turns its model's names into ids as it reads a reply.
	 */
	withNames({ seen }:{ seen:SeenName<TCtx> }):this {
		this.assertBuilder();
		this.seenFn = seen;
		return this;
	}

	/** What the mind of character or collective `observerID` calls a character, for host-built text such as a sight `note`. */
	seen(observerID:string, target:NameTarget):string {
		return (this.character(observerID) ?? this.collective(observerID))?.mind?.seen(target) ?? target.id;
	}

	withInventory(look:(ctx:TCtx)=>Inventory):this {
		this.assertBuilder();
		this.senses.carrying = {
			description: 'What you wear and carry.',
			gather: (ctx) => formatInventory(look(ctx)),
		};
		return this;
	}

	/**
	 * The game's world: where things are, how characters move, and how items, uses, looks, and trades work.
	 * Runs the stock world verbs (`go_to`, `pick_up`, `buy`, …) and the watch geometry. `TEntity` is the
	 * game's own type for things in its world; every part but `find` receives one. See `HostWorld`.
	 */
	withWorld<TEntity>(world:HostWorld<TEntity>):this {
		this.assertBuilder();
		this.world = world;
		return this;
	}

	withLineOfSight(fn:(aID:string, bID:string)=>boolean):this {
		this.assertBuilder();
		this.losFn = fn;
		return this;
	}

	removeSense(...names:string[]):this {
		for (const name of names) {
			delete this.senses[name];
		}
		return this;
	}

	removeTool(...names:string[]):this {
		for (const name of names) {
			delete this.tools[name];
		}
		return this;
	}

	withContext(fn:(id:string)=>TCtx | undefined):this {
		this.assertBuilder();
		this.contextFn = fn;
		return this;
	}

	withKernels(fn:KernelSource<TCtx>):this {
		this.assertBuilder();
		this.kernelFn = fn;
		return this;
	}

	/** Used when a character or collective spec omits `kit`, a collective's characters too. */
	withDefaultKit(kit:KitSource<TCtx>):this {
		this.assertBuilder();
		this.defaultKit = kit;
		return this;
	}

	withTalk(
		senseOrTalk:TalkSense | TalkNet,
		onSpoke?:(utterance:SpeechUtterance)=>void,
		config?:Partial<TalkConfig>,
	):this {
		this.assertBuilder();
		if (senseOrTalk instanceof TalkNet) {
			this.talk = senseOrTalk;
			this.talkSense = undefined;
			this.onSpoke = undefined;
			this.talkConfig = undefined;
			return this;
		}
		this.talkSense = senseOrTalk;
		this.onSpoke = onSpoke;
		this.talkConfig = config;
		return this;
	}

	withMap(sense:MapSense):this {
		this.assertBuilder();
		this.map = sense;
		return this;
	}

	/** `mentions`: most articles shown per think for names said or heard (default `DEFAULT_MENTION_CAP`; 0 shows none). */
	withEncyclopedia(pages:EncyclopediaSource<TCtx>, { mentions }:{ mentions?:number } = {}):this {
		this.assertBuilder();
		this.encyclopedia = pages;
		this.mentionCap = mentions;
		return this;
	}

	withVerbs(registry:VerbRegistry):this {
		this.assertBuilder();
		this.verbs = registry;
		return this;
	}

	/** Schema-only. Omit `verbs` to register the full stock set. Already-registered names are skipped. */
	addStockVerbs(...verbs:StockVerb[]):this {
		registerStockVerbs(this.verbs, ...verbs);
		return this;
	}

	/** Schema-only collective verbs (`issue`, `tag`, formations). `when` / `law` / `unlaw` ride on stock arc verbs. Kit still has to grant them. */
	addStockCollectiveVerbs(...verbs:StockCollectiveVerb[]):this {
		registerStockCollectiveVerbs(this.verbs, ...verbs);
		return this;
	}

	/**
	 * Schema plus optional world function. `help` is the one line shown after the verb in the prompt's
	 * verb list. The handler's `args` are typed from `args`; a stock verb takes only a handler, typed from
	 * its stock args. Same name again binds or replaces the handler.
	 */
	addVerb<TVerb extends StockVerbName>(name:TVerb, verb:{ help?:string; handler:VerbHandler<TCtx, VerbArgs<StockVerbArgs<TVerb>>> }):this;
	addVerb<const TArgMap extends VerbArgMap = Record<never, never>>(name:string, verb?:{ args?:TArgMap; help?:string; handler?:VerbHandler<TCtx, VerbArgs<TArgMap>> }):this;
	addVerb(name:string, { handler, ...def }:{ args?:VerbArgMap; help?:string; handler?:VerbHandler<TCtx, never> } = {}):this {
		if (!this.verbs.has(name)) {
			this.verbs.add(name, def);
		}
		if (handler) {
			// The schema is checked before dispatch, so the args match what this handler was typed with.
			this.handlers.set(name, handler as VerbHandler<TCtx>);
		}
		return this;
	}

	/** Runs before every host verb. Return a result to refuse the step (a downed character, a cutscene); `undefined` lets it run. */
	withVerbGate(fn:VerbGate<TCtx>):this {
		this.verbGate = fn;
		return this;
	}

	/** Drop catalog schemas and their handlers. */
	removeVerbs(...names:string[]):this {
		this.verbs.remove(...names);
		for (const name of names) {
			this.handlers.delete(name);
		}
		return this;
	}

	onVerb(fn:VerbHandler<TCtx>):this {
		this.catchAll = fn;
		return this;
	}

	onAbortArc(fn:(id:string)=>void):this {
		this.abortArcFn = fn;
		return this;
	}

	/** A collective's commander left or died. Name a new one with `collective.commander = …`. */
	onCommanderVacant(fn:(collective:Collective<TCtx>, character:Character<TCtx>)=>void):this {
		this.commanderVacantFn = fn;
		return this;
	}

	onLog(fn:(entry:DirectorLog)=>void):this {
		this.logFn = fn;
		return this;
	}

	/** After a host verb resolves. `say` does not come through here. */
	onStep(fn:(call:VerbCall<TCtx>, result:ArcResult)=>void):this {
		this.stepFn = fn;
		return this;
	}

	/**
	 * After characters change collectives, one model call fixes the memories of everyone involved: what went
	 * stale in a collective left, and what a character or a collective joined should now remember. Moves
	 * within `ticks` director ticks (default 1) share one call. It takes the next free think slot, never
	 * stops a think, and nothing waits for it. On by default; pass your own `handover`, or `false` to turn it off.
	 */
	withMemoryHandover({ ticks = 1, handover }:{ ticks?:number; handover?:Handover<TCtx> | false } = {}):this {
		this.handoverTicks = Math.max(1, ticks);
		this.handover = handover;
		return this;
	}

	/** Settings every new mind starts from. A spec's `mind` settings win over them. */
	withMindDefaults(settings:MindSettings):this {
		this.mindDefaults = { ...settings };
		return this;
	}

	/**
	 * A character on its own: an NPC with `mind` settings, or one the host drives (the Player) without them.
	 * Its id must be new among characters and collectives.
	 */
	addCharacter(spec:CharacterSpec<TCtx>):this {
		this.claimID(spec.id);
		this.soloSpecs.push(spec);
		this.specs.set(spec.id, spec);
		if (this.started) {
			this.reportMissingNames([spec]);
			this.wireCharacter(spec);
		}
		return this;
	}

	/** Characters sharing one mind. Its id and its characters' ids must be new. */
	addCollective(spec:CollectiveSpec<TCtx>):this {
		// Its own list: `removeCharacter` trims it, and the host's spec stays whole for the next director.
		const own = { ...spec, characters: [...(spec.characters ?? [])] };
		this.claimID(own.id);
		for (const character of own.characters) {
			this.claimID(character.id);
			this.specs.set(character.id, character);
		}
		this.collectiveSpecs.push(own);
		if (this.started) {
			this.reportMissingNames([own, ...own.characters.filter((c) => c.kit)]);
			this.wireCollective(own);
		}
		return this;
	}

	/** Remove a character for good, on its own or from its collective. A commander's leaving tells `onCommanderVacant`. */
	removeCharacter(id:string):this {
		this.specs.delete(id);
		remove(this.soloSpecs, id);
		for (const spec of this.collectiveSpecs) {
			remove(spec.characters ?? [], id);
		}
		this.dropCharacter(id);
		return this;
	}

	/** Remove a collective. Its characters stay, each on its own: with a fresh mind if their spec gave one settings. */
	removeCollective(id:string):this {
		const spec = remove(this.collectiveSpecs, id);
		const row = this.collectiveRows.get(id);
		const members = row ? row.runner.characters.map((c) => c.id) : (spec?.characters ?? []).map((c) => c.id);
		for (const member of members) {
			const memberSpec = this.specs.get(member);
			if (memberSpec) {
				this.soloSpecs.push(memberSpec);
			}
		}
		this.dropCollective(id);
		return this;
	}

	/** Cancel an in-flight think by mind id. */
	abortThink(id:string):this {
		this.queue?.abortThink(id);
		return this;
	}

	character(id:string):Character<TCtx> | undefined {
		return this.characterRows.get(id)?.runner;
	}

	/** Every character: on its own or in a collective. */
	characters():Character<TCtx>[] {
		return [...this.characterRows.values()].map((row) => row.runner);
	}

	collective(id:string):Collective<TCtx> | undefined {
		return this.collectiveRows.get(id)?.runner;
	}

	collectives():Collective<TCtx>[] {
		return [...this.collectiveRows.values()].map((row) => row.runner);
	}

	/** Every mind that thinks: characters' own, then collectives'. */
	minds():Mind<TCtx>[] {
		return [
			...this.characters().flatMap((c) => (c.ownMind ? [c.ownMind] : [])),
			...this.collectives().map((c) => c.mind),
		];
	}

	mindQueue():MindQueue | undefined {
		return this.queue;
	}

	setMaxParallel(n:number):void {
		if (!this.queue) {
			if (this.queueSlot.kind === 'priority') {
				this.queueSlot.opts = { ...this.queueSlot.opts, maxParallel: n };
			}
			else if (this.queueSlot.kind === 'simple') {
				this.queueSlot.opts = { ...this.queueSlot.opts, maxParallel: n };
			}
			else if (this.queueSlot.kind === 'default') {
				this.queueSlot = { kind: 'priority', opts: { maxParallel: n } };
			}
			return;
		}
		this.queue.maxParallel = n;
	}

	setBatchThinks(on:boolean):void {
		if (!this.queue) {
			if (this.queueSlot.kind === 'priority') {
				this.queueSlot.opts = { ...this.queueSlot.opts, batchThinks: on };
			}
			else if (this.queueSlot.kind === 'simple') {
				this.queueSlot.opts = { ...this.queueSlot.opts, batchThinks: on };
			}
			else if (this.queueSlot.kind === 'default') {
				this.queueSlot = { kind: 'priority', opts: { batchThinks: on } };
			}
			else {
				this.queueSlot.queue.batchThinks = on;
			}
			if (this.inference.kind === 'http') {
				this.inference.opts.batchThinks = on;
			}
			return;
		}
		this.queue.batchThinks = on;
		if (this.inference.kind === 'http') {
			this.inference.opts.batchThinks = on;
		}
	}

	liveBatchThinks():boolean {
		return this.thinkBatchPolicy().batchThinks;
	}

	setThinking(on:boolean):void {
		this.http?.setThinking(on);
		if (this.inference.kind === 'http') {
			this.inference.opts.enableThinking = on;
		}
	}

	setContextLength(n:number):void {
		const same = this.liveContextLength() === n;
		if (this.inference.kind === 'http') {
			this.inference.opts.load = { ...this.inference.opts.load, contextLength: n };
		}
		this.http?.setContextLength(n);
		const model = this.model;
		if (same || !model || !this.http) {
			return;
		}
		this.emitLog({ name: 'ArcDirector', message: `context ${n}` });
		void this.http.reload(model).catch((err:unknown) => {
			const text = err instanceof Error ? err.message : String(err);
			this.emitLog({ name: 'ArcDirector', message: text, error: true });
		});
	}

	liveContextLength():number | undefined {
		if (this.http) {
			return this.http.liveContextLength();
		}
		if (this.inference.kind === 'http') {
			return this.inference.opts.load?.contextLength;
		}
		return undefined;
	}

	liveThinking():boolean {
		if (this.inference.kind === 'http') {
			return this.inference.opts.enableThinking === true;
		}
		return false;
	}

	setArcText(on:boolean):void {
		this.arcText = on;
		for (const mind of this.minds()) {
			mind.arcText = on;
		}
	}

	liveArcText():boolean {
		return this.arcText;
	}

	liveMaxParallel():number {
		if (this.queue) {
			return this.queue.maxParallel;
		}
		if (this.queueSlot.kind === 'priority') {
			return this.queueSlot.opts?.maxParallel ?? 2;
		}
		if (this.queueSlot.kind === 'simple') {
			return this.queueSlot.opts?.maxParallel ?? 2;
		}
		if (this.queueSlot.kind === 'instance') {
			return this.queueSlot.queue.maxParallel;
		}
		return 2;
	}

	setModel(id:string):void {
		const name = id.trim();
		if (!name || name === this.model) {
			return;
		}
		this.model = name;
		this.syncVision(name);
		this.emitLog({ name: 'ArcDirector', message: `using ${name}${this.vision ? ' (vision)' : ''}` });
		for (const mind of this.minds()) {
			mind.model = name;
			mind.vision = this.vision;
		}
		void this.http?.ensureLoaded(name).catch((err:unknown) => {
			const text = err instanceof Error ? err.message : String(err);
			this.emitLog({ name: 'ArcDirector', message: text, error: true });
		});
	}

	private syncVision(modelID:string):void {
		const row = this.catalog.find((m) => m.id === modelID)
			?? this.catalog.find((m) => m.id.endsWith(modelID) || m.id.includes(modelID));
		this.vision = isVisionModel(row ?? modelID);
		for (const mind of this.minds()) {
			mind.vision = this.vision;
		}
	}

	resetInferStats():void {
		this.infer = emptyInferClock();
	}

	private recordInfer(id:string | undefined, wallMs:number, res:{ promptMs?:number; generateMs?:number }):void {
		const context = res.promptMs;
		const generate = res.generateMs ?? (context !== undefined ? Math.max(0, wallMs - context) : wallMs);
		this.infer.calls += 1;
		this.infer.wallMs += wallMs;
		this.infer.lastWallMs = wallMs;
		if (context !== undefined) {
			this.infer.contextMs += context;
			this.infer.contextKnown += 1;
			this.infer.lastContextMs = context;
		}
		else {
			this.infer.lastContextMs = null;
		}
		this.infer.generateMs += generate;
		this.infer.lastGenerateMs = generate;
		if (id) {
			this.infer.thinkMs[id] = (this.infer.thinkMs[id] ?? 0) + generate;
		}
	}

	private wrapProvider(inner:InferenceProvider):InferenceProvider {
		const embed = inner.embed?.bind(inner);
		return {
			chat: async (req:ChatRequest):Promise<ChatResponse> => {
				const name = whoFromMessages(req);
				const t0 = nowMs();
				const signal = req.thread ? this.queue?.thinkSignal(req.thread) : undefined;
				try {
					if (!this.http) {
						const dump = formatChatLog(req);
						this.emitLog({ name, message: `prompt\n${dump.message}`, image: dump.image });
					}
					const res = await inner.chat(signal ? { ...req, signal } : req);
					const ms = Math.round(nowMs() - t0);
					this.recordInfer(req.thread, ms, res);
					const parts = [`${ms}ms`];
					if (res.promptMs !== undefined) {
						parts.push(`ctx ${Math.round(res.promptMs)}ms`);
					}
					if (res.generateMs !== undefined) {
						parts.push(`gen ${Math.round(res.generateMs)}ms`);
					}
					if (res.cachedTokens) {
						parts.push(`cache ${res.cachedTokens}`);
					}
					if (res.toolCalls.length > 0) {
						parts.push(`tool ${res.toolCalls.map((c) => c.name).join(', ')}`);
					}
					const thought = res.reasoning?.trim() ?? '';
					const body = res.content?.trim() ?? '';
					if (thought && thought !== body && !body.includes(thought)) {
						parts.push(`(thinking)\n${thought}`);
					}
					if (res.content) {
						parts.push(res.content);
					}
					else if (!thought && res.toolCalls.length === 0) {
						parts.push('(empty content)');
					}
					this.emitLog({ name, message: parts.join('\n') });
					return res;
				}
				catch (err:unknown) {
					const ms = Math.round(nowMs() - t0);
					this.recordInfer(req.thread, ms, {});
					const aborted = !!signal?.aborted;
					const text = aborted
						? 'aborted'
						: err instanceof Error ? err.message : String(err);
					this.emitLog({ name, message: `${ms}ms\n${text}`, error: !aborted });
					throw err;
				}
			},
			embed: embed
				? (texts, model) => embed(texts, model)
				: undefined,
		};
	}

	private resolveQueue():MindQueue {
		if (this.queueSlot.kind === 'instance') {
			return this.queueSlot.queue;
		}
		if (this.queueSlot.kind === 'simple') {
			return new SimpleQueue(this.queueSlot.opts);
		}
		const opts = this.queueSlot.kind === 'priority' ? this.queueSlot.opts : undefined;
		return new ThinkQueue(opts);
	}

	private async connectInference():Promise<void> {
		if (this.inference.kind === 'unset') {
			throw new Error('ArcDirector: no inference (withLMStudioInference / withOllamaInference / withFakeInference / withInference)');
		}
		if (this.inference.kind === 'fake') {
			this.http = undefined;
			this.provider = this.wrapProvider(fakeInference(this.inference.chat));
			this.model = 'fake';
			this.vision = false;
			this.catalog = [];
			return;
		}
		if (this.inference.kind === 'custom') {
			this.http = undefined;
			this.provider = this.wrapProvider(this.inference.provider);
			this.model = this.inference.model ?? this.model ?? 'custom';
			this.vision = this.inference.vision ?? isVisionModel(this.model);
			return;
		}
		const opts = this.inference.opts;
		const load = opts.load ? { ...opts.load } : undefined;
		try {
			const connected = await connectHttpInference(
				{
					...opts,
					load,
					onRequest: ({ req, body, path }) => {
						const dump = formatChatLog(body);
						this.emitLog({
							name: whoFromMessages(req),
							message: `prompt ${path}\n${dump.message}`,
							image: dump.image,
						});
					},
				},
				opts.model,
			);
			this.catalog = connected.catalog;
			this.model = connected.model;
			this.vision = connected.vision;
			this.http = connected.provider;
			this.provider = this.wrapProvider(connected.provider);
		}
		catch (err:unknown) {
			const text = err instanceof Error ? err.message : String(err);
			this.emitLog({ name: 'ArcDirector', message: text });
			throw err instanceof Error ? err : new Error(text);
		}
	}

	async start(opts?:StartOpts):Promise<this> {
		if (this.disposed) {
			throw new Error('ArcDirector disposed');
		}
		if (this.started) {
			return this;
		}
		this.ignoreMissing = opts?.ignoreMissing === true;
		this.queue = this.resolveQueue();
		await this.connectInference();
		if (!this.talk && this.talkSense) {
			const sense:TalkSense = this.losFn
				? { ...this.talkSense, canSee: (a, b) => this.losFn!(a, b) }
				: this.talkSense;
			this.talk = new TalkNet(sense, this.onSpoke, this.talkConfig);
		}
		this.emitLog({
			name: 'ArcDirector',
			message: `using ${this.model}${this.vision ? ' (vision)' : ''}`,
		});
		this.mover = new Mover(this.world, () => this.clock);
		this.bindWorldVerbs();
		this.reportMissingNames();
		this.handover ??= chatHandover((req) => this.provider!.chat(req), () => this.model);
		this.wireCast(this.stored);
		this.stored = undefined;
		this.started = true;
		const ids = this.minds().map((mind) => mind.id);
		if (ids.length > 0) {
			this.emitLog({
				name: 'ArcDirector',
				message: `${ids.join(', ')} on ${this.model}${this.vision ? ' (vision)' : ''}`,
			});
		}
		return this;
	}

	private bindWorldVerbs():void {
		if (!this.world) {
			return;
		}
		const handlers = worldVerbs<TCtx>({
			world: this.world,
			mover: this.mover,
			now: () => this.clock,
			seen: (call) => (this.sightLook ? this.filterSight(this.sightLook(call.ctx)).objects.map((o) => o.id) : []),
		});
		for (const [verb, handler] of Object.entries(handlers)) {
			if (missingParts(verb, this.world).length === 0) {
				this.stockHandlers.set(verb, handler as VerbHandler<TCtx>);
			}
		}
	}

	/** `point`: measure as if the character stood there. */
	private kernelsFor(runner:ArcRunner<TCtx>, ctx:TCtx, cache = this.cacheOf(runner), point?:Vec):HostKernels {
		const mind = runner.mind;
		const kernels = this.namedKernels(mind, this.kernelFn!(ctx, point));
		const here = point && this.world && poseOf(this.world, kernels.me.id);
		const geometry = this.world
			? geometryKernels(this.world, kernels.me.id, here ? new Map([[kernels.me.id, { ...here, point }]]) : undefined)
			: {};
		const lastTimestamp = mind?.lastTacticalTimestamp;
		const last = runner.lastResult;
		const ago = lastTimestamp !== undefined && Number.isFinite(lastTimestamp)
			? Math.max(0, this.clock - lastTimestamp)
			: undefined;
		const los = this.losFn;
		return {
			...kernels,
			...geometry,
			cache,
			...(los ? { canSee: (a, b) => los(a.id, b.id) } : {}),
			hasHeard: mind?.hasHeard() ?? false,
			prev: {
				secondsAgo: ago,
				me: this.prevMeOf(runner, kernels),
				verbs: last
					? [{
						secondsAgo: ago ?? 0,
						isOk: last.ok,
						reason: last.reason ?? '',
						verb: last.verb ?? '',
					}]
					: [],
			},
		} as HostKernels;
	}

	/**
	 * Host entities under `mind`'s names for them, so its model's own words still evaluate (`observe`).
	 * A binding keyed by a character's id is bound under its id and under the name.
	 */
	private namedKernels<TKernels extends Pick<HostKernels, 'others' | 'items' | 'bindings'>>(
		mind:Mind<TCtx> | null,
		kernels:TKernels,
	):TKernels {
		if (!mind || !this.seenFn) {
			return kernels;
		}
		const named = (e:ExprEntity):ExprEntity => ({ ...e, name: mind.seen(e) });
		const bindings:Record<string, ExprVal> = {};
		for (const [key, val] of Object.entries(kernels.bindings ?? {})) {
			if (val.kind !== 'entity') {
				bindings[key] = val;
				continue;
			}
			const name = mind.seen(val.value);
			const value:ExprVal = { kind: 'entity', value: { ...val.value, name } };
			bindings[key] = value;
			if (key === val.value.id) {
				bindings[name] = value;
			}
		}
		return { ...kernels, others: kernels.others.map(named), items: kernels.items.map(named), bindings };
	}

	/** Spawn snapshot so the first think can see a change. A saved prev is left alone. */
	private stampPrev(runner:ArcRunner<TCtx>):void {
		if (runner.prevMe || !this.kernelFn || !this.contextFn) {
			return;
		}
		const ctx = this.tryCtx(runner.id);
		if (ctx) {
			try {
				this.kernelsFor(runner, ctx);
			}
			catch {
				return;
			}
		}
	}

	private prevMeOf(runner:ArcRunner<TCtx>, kernels:MeFreezeHost) {
		runner.prevMe ??= freezeMe(kernels);
		return runner.prevMe;
	}

	/** What `mind` needs from this director to think for `owner`, wired when it attaches. */
	private mindDeps(mind:Mind<TCtx>, owner:ArcRunner<TCtx>):MindDeps<TCtx> {
		return {
			provider: this.provider!,
			senses: this.sensesFor(mind, owner),
			tools: this.tools,
			talk: this.talk,
			toolRoundCap: this.toolRounds,
			wayBlocked: (to) => (this.world ? wayBlocked(this.world, mind.thinkThread(), to) : undefined),
			arcRetryCap: this.arcRetries,
			stalled: this.stalledFn,
			autoEnact: true,
			queue: this.queue,
			model: this.model,
			map: this.map,
			encyclopedia: this.encyclopedia,
			mentionCap: this.mentionCap,
			vision: this.vision,
			arcText: this.arcText,
			thinkInstructions: this.thinkInstructions,
			thinking: () => this.liveThinking(),
			verbInstructions: this.verbInstructions,
			arcExample: this.arcExample,
			repairTemperature: this.repairTemperature,
			seenAs: this.seenAs(mind),
		};
	}

	/** The host naming policy as one mind sees it: by its owner's id, from its voice's context. */
	private seenAs(mind:Mind<TCtx>):((target:NameTarget)=>string) | undefined {
		const seen = this.seenFn;
		if (!seen) {
			return undefined;
		}
		return (target) => seen({ id: mind.id, ctx: this.tryCtx(mind.thinkThread()) }, target);
	}

	/** Host look, minus what is out of sight, with everything seen under `mind`'s name for it. */
	private see(mind:Mind<TCtx>, ctx:TCtx):Sight {
		const snap = this.filterSight(this.sightLook!(ctx));
		if (!this.seenFn) {
			return snap;
		}
		return { ...snap, objects: snap.objects.map((o) => ({ ...o, id: mind.seen(o) })) };
	}

	private sensesFor(mind:Mind<TCtx>, owner:ArcRunner<TCtx>):Record<string, Sense<TCtx>> {
		const wrapSight = !!(this.sightLook && this.senses.sight);
		const commanderless = owner instanceof Collective && !!this.contextFn && this.tryCtx(owner.voice.id) === undefined;
		const skipCarrying = !!this.senses.carrying && commanderless;
		if (!wrapSight && !skipCarrying) {
			return this.senses;
		}
		const senses:{ [k:string]:Sense<TCtx> } = { ...this.senses };
		if (wrapSight && this.senses.sight) {
			senses.sight = {
				description: this.senses.sight.description,
				gather: (ctx) => this.gatherSight(mind, ctx),
			};
		}
		if (skipCarrying) {
			delete senses.carrying;
		}
		return senses;
	}

	private filterSight(snap:Sight):Sight {
		const los = this.losFn;
		if (!los) {
			return snap;
		}
		return { ...snap, objects: snap.objects.filter((o) => los(snap.self.id, o.id)) };
	}

	private sightFormatOpts():{ unitName?:string } {
		return this.sightUnitName ? { unitName: this.sightUnitName } : {};
	}

	/** What `mind`'s voice sees; for a collective with no commander, what all its characters see, pooled. */
	private gatherSight(mind:Mind<TCtx>, ctx:TCtx):string {
		if (!this.sightLook) {
			return '';
		}
		const focus = mind.persona.effectiveSightFocus();
		const limit = mind.persona.sightLimit ?? this.sightLimitDefault;
		const scores = new Map<string, number>();
		const owner = mind.owner;
		if (owner instanceof Collective && owner.characters.length > 0 && this.contextFn && !this.tryCtx(mind.thinkThread())) {
			const groups:{ unitID:string; clauses:ReturnType<typeof formatSightClauses> }[] = [];
			for (const character of owner.characters) {
				const memberCtx = this.tryCtx(character.id);
				if (!memberCtx) {
					continue;
				}
				const snap = this.see(mind, memberCtx);
				const clauses = formatSightClauses(snap, {
					...this.sightFormatOpts(),
					fromName: character.id,
					skipAmbient: groups.length > 0,
				});
				groups.push({ unitID: character.id, clauses });
				if (focus.length > 0) {
					this.scoreSightObjects(snap.objects, focus, memberCtx, character, scores);
				}
			}
			const merged = mergeHiveClauses(groups, focus.length > 0 ? scores : undefined);
			return joinSightClauses(orderSightClauses(merged, scores, limit, focus.length > 0));
		}
		const snap = this.see(mind, ctx);
		const clauses = formatSightClauses(snap, this.sightFormatOpts());
		if (focus.length > 0) {
			this.scoreSightObjects(snap.objects, focus, ctx, mind.voice, scores);
		}
		return joinSightClauses(orderSightClauses(clauses, scores, limit, focus.length > 0));
	}

	private scoreSightObjects(
		objects:SeenObject[],
		exprs:string[],
		ctx:TCtx,
		runner:ArcRunner<TCtx>,
		into:Map<string, number>,
	):void {
		if (!this.kernelFn) {
			return;
		}
		const kernels = this.kernelsFor(runner, ctx);
		for (const obj of objects) {
			const it = dummyEntity(runner.mind?.persona.names.resolve(obj.id) ?? obj.id, {
				name: obj.id,
				tags: obj.tags,
				fields: obj.hp !== undefined && obj.maxHP !== undefined
					? {
						hp: { kind: 'number', value: obj.hp },
						maxHP: { kind: 'number', value: obj.maxHP },
					}
					: undefined,
			});
			const cat = buildCatalog({
				...kernels,
				bindings: { ...kernels.bindings, it: { kind: 'entity', value: it } },
			});
			let best = 0;
			for (let i = 0; i < exprs.length; i++) {
				const r = evaluate(exprs[i], cat);
				const s = watchScore(r.error ? { kind: 'absent' } : r.value).score * (0.8 ** i);
				if (s > best) {
					best = s;
				}
			}
			const prev = into.get(obj.id) ?? 0;
			if (best > prev) {
				into.set(obj.id, best);
			}
		}
	}

	/** One host step, acted by `runner` itself. */
	private dispatch(runner:ArcRunner<TCtx>, step:Step, ctx:TCtx | undefined):Promise<ArcResult> | ArcResult {
		const liveCtx = this.tryCtx(runner.id) ?? ctx;
		if (step.verb === 'law' || step.verb === 'unlaw') {
			return this.handleLaw(runner, step);
		}
		if ((STOCK_COLLECTIVE_VERBS as readonly string[]).includes(step.verb)) {
			const collective = collectiveOf(runner);
			return collective
				? this.handleCollectiveVerb(collective, runner, step, liveCtx)
				: { ok: false, verb: step.verb, reason: `${step.verb} needs a collective` };
		}
		const handler = this.handlers.get(step.verb)
			?? this.stockHandlers.get(step.verb)
			?? (step.verb === 'wait' ? this.waitVerb : this.catchAll);
		if (!handler) {
			return { ok: false, verb: step.verb, reason: `unhandled ${step.verb}` };
		}
		if (!(runner instanceof Character)) {
			return { ok: false, verb: step.verb, reason: `you are not a character in this scene; issue ${step.verb} to one of your characters` };
		}
		if (liveCtx === undefined) {
			return { ok: false, verb: step.verb, reason: 'not in this scene' };
		}
		const call = this.verbCall(runner, step, liveCtx);
		if (!('character' in call)) {
			return call;
		}
		const out = this.verbGate?.(call) ?? handler(call);
		const fn = this.stepFn;
		if (!fn) {
			return out;
		}
		return Promise.resolve(out).then((result) => {
			fn(call, result);
			return result;
		});
	}

	/**
	 * The call a handler sees. `id` args are ids already; one written as an expression becomes the character it
	 * picks (`others.filter("enemy").minBy(u => u.hp)`). `watch` args are checked before the host runs.
	 */
	private verbCall(
		character:Character<TCtx>,
		step:Step,
		ctx:TCtx,
		units?:string[],
	):VerbCall<TCtx> | ArcResult {
		const fail = (reason:string):ArcResult => ({ ok: false, verb: step.verb, reason });
		const catalogAt = (point?:Vec):Catalog | undefined => this.exprCatalog(character, ctx, point ? new SampleCache() : this.cacheOf(character), point);
		const kinds = this.verbs.get(step.verb)?.args ?? {};
		const args:Record<string, unknown> = { ...step.args };
		for (const [key, value] of Object.entries(args)) {
			const kind = argBase(kinds[key]);
			if (typeof value !== 'string' || !value.trim()) {
				continue;
			}
			if (kind === 'id') {
				const catalog = /[(.]|=>/.test(value) ? catalogAt() : undefined;
				if (!catalog) {
					continue;
				}
				const r = evaluate(value, catalog);
				const picked = r.error ? undefined : pickedEntity(r.value);
				if (!picked) {
					return fail(r.error ? `${value}: ${r.error.message}` : `${value} picks no one`);
				}
				args[key] = picked.id;
			}
			const broken = kind === 'watch' ? watchProblem(value, catalogAt()) : undefined;
			if (broken) {
				return fail(broken);
			}
		}
		const score = (arg:string, point?:Vec):number => {
			const expr = args[arg];
			const catalog = typeof expr === 'string' && expr.trim() ? catalogAt(point) : undefined;
			const r = catalog ? evaluate(expr as string, catalog) : undefined;
			return r && !r.error ? fit(r.value) : 0;
		};
		return {
			verb: step.verb,
			args,
			character,
			ctx,
			units,
			score,
			holds: (arg, point) => score(arg, point) > 0,
			goTo: (target, within) => this.goTo(character.id, step.verb, { target }, within),
			goToPoint: (point, within) => this.goTo(character.id, step.verb, { point }, within),
			wait: (seconds) => this.waitFor(character.id, seconds, step.verb),
		};
	}

	/** Move `characterID`, or, in a world where characters do not move, succeed only when already in reach. */
	private goTo(characterID:string, verb:string, dest:{ target:string } | { point:Vec }, within?:number):Promise<ArcResult> {
		if (this.mover.canMove) {
			return this.mover.go(characterID, dest, verb, { within });
		}
		const world = this.world;
		const character = world?.find(characterID);
		const target = 'target' in dest ? world?.find(dest.target) : undefined;
		const point = 'target' in dest ? (target === undefined ? undefined : world?.getPose(target)?.point) : dest.point;
		const me = character === undefined ? undefined : world?.getPose(character)?.point;
		const near = within ?? (character !== undefined && target !== undefined ? world?.getReach?.(character, target) : undefined) ?? 1;
		const ok = !me || !point || distance(me, point) <= near;
		return Promise.resolve(ok ? { ok: true, verb } : { ok: false, verb, reason: 'out of reach' });
	}

	private waitFor(characterID:string, seconds:number, verb:string, met?:()=>boolean):Promise<ArcResult> {
		return new Promise((done) => {
			this.waits.add({ characterID, verb, end: this.clock + seconds, seconds, met, done });
		});
	}

	/** The watch-language view `runner` has from `ctx`: its mind's names, and in a collective `units` / `allUnits`. */
	private exprCatalog(runner:ArcRunner<TCtx>, ctx:TCtx, cache:SampleCache, point?:Vec):Catalog | undefined {
		if (!this.kernelFn) {
			return undefined;
		}
		const kernels = this.kernelsFor(runner, ctx, cache, point);
		const collective = collectiveOf(runner);
		return collective ? buildCollectiveCatalog(kernels, collective) : buildCatalog(kernels);
	}

	/** Stock `wait`: game time passes until `seconds`, or until the `until` watch holds. A host `wait` handler replaces it. */
	private readonly waitVerb:VerbHandler<TCtx> = (call) => {
		const until = typeof call.args.until === 'string' && call.args.until.trim() !== '';
		const seconds = typeof call.args.seconds === 'number' ? call.args.seconds : until ? 20 : 1;
		return this.waitFor(call.character.id, seconds, 'wait', until ? () => call.holds('until') : undefined);
	};

	private tickWaits():void {
		for (const wait of this.waits) {
			const met = wait.met?.() ?? false;
			if (met || this.clock >= wait.end) {
				this.waits.delete(wait);
				wait.done({ ok: true, verb: wait.verb, reason: met ? 'until' : `${wait.seconds}s` });
			}
		}
	}

	/** Stop whatever character `id` is doing now: its waits and moves here, the rest through `onAbortArc`. */
	abortArc(id:string):void {
		for (const wait of this.waits) {
			if (wait.characterID === id) {
				this.waits.delete(wait);
				wait.done({ ok: false, interrupted: true, verb: wait.verb });
			}
		}
		this.mover.stop(id);
		this.abortArcFn?.(id);
	}

	private handleCollectiveVerb(
		collective:Collective<TCtx>,
		runner:ArcRunner<TCtx>,
		step:Step,
		ctx:TCtx | undefined,
	):ArcResult | Promise<ArcResult> {
		if (step.verb === 'issue') {
			return this.handleIssue(collective, runner, step, ctx);
		}
		if (step.verb === 'tag' || step.verb === 'untag') {
			const who = typeof step.args.who === 'string' ? step.args.who : '';
			const name = typeof step.args.name === 'string' ? step.args.name : '';
			if (!who || !name) {
				return { ok: false, verb: step.verb, reason: `${step.verb} needs who and name` };
			}
			const cat = this.collectiveCatalog(collective, runner, ctx);
			const characters = cat ? evaluateWho(who, cat, collective) : [];
			if (step.verb === 'tag') {
				collective.tagCharacters(characters, name);
			}
			else {
				collective.untagCharacters(characters, name);
			}
			return { ok: true, verb: step.verb };
		}
		if (isFormationVerb(step.verb)) {
			return { ok: false, verb: step.verb, reason: 'formation must be issue arc head' };
		}
		return { ok: false, verb: step.verb, reason: `unhandled ${step.verb}` };
	}

	/**
	 * `law` / `unlaw` from `runner`. The voice of a collective writes the collective's own laws; anyone else
	 * writes its own, which a character in a collective keeps there (`Tom.flee`).
	 */
	private handleLaw(runner:ArcRunner<TCtx>, step:Step):ArcResult {
		const home = runner.isVoice ? collectiveOf(runner) ?? runner : runner;
		const name = typeof step.args.name === 'string' && step.args.name ? step.args.name : undefined;
		if (step.verb === 'unlaw') {
			if (!name) {
				return { ok: false, verb: 'unlaw', reason: 'unlaw needs name' };
			}
			home.removeLaw(name);
			return { ok: true, verb: 'unlaw' };
		}
		const who = typeof step.args.who === 'string' ? step.args.who : undefined;
		if (who && !home.lawsTakeWho()) {
			const reason = collectiveOf(runner) ? 'your own law reaches only you; it has no who' : 'solo law has no who';
			return { ok: false, verb: 'law', reason };
		}
		const watch = typeof step.args.watch === 'string' ? step.args.watch : '';
		const arc = arcArg(step.args.arc, this.verbs);
		if (!watch || !arc) {
			return { ok: false, verb: 'law', reason: 'law needs watch and arc' };
		}
		if (!home.addLaw({ name, who, watch, arc })) {
			return { ok: false, verb: 'law', reason: `no law${name ? ` ${name}` : ''}: too many laws, or a bad name; unlaw one first` };
		}
		return { ok: true, verb: 'law' };
	}

	private handleIssue(
		collective:Collective<TCtx>,
		issuer:ArcRunner<TCtx>,
		step:Step,
		ctx:TCtx | undefined,
	):ArcResult | Promise<ArcResult> {
		const who = typeof step.args.who === 'string' ? step.args.who.trim() : '';
		const arc = arcArg(step.args.arc, this.verbs);
		if (!who || !arc) {
			return { ok: false, verb: 'issue', reason: 'issue needs who and arc' };
		}
		const cat = this.collectiveCatalog(collective, issuer, ctx);
		const named = cat ? evaluateWho(who, cat, collective) : [];
		const troops = named.filter((c) => c !== collective.commander);
		if (named.length > 0 && troops.length === 0) {
			return { ok: false, verb: 'issue', reason: 'issue never lands on the commander' };
		}
		const head = firstStep(arc);
		if (head && isFormationVerb(head.verb)) {
			const handler = this.handlers.get(head.verb) ?? this.catchAll;
			// A collective with no commander forms up through its first character.
			const by = issuer instanceof Character ? issuer : troops[0];
			const byCtx = by === issuer ? ctx : by && this.tryCtx(by.id);
			const call = handler && by && byCtx !== undefined
				? this.verbCall(by, head, byCtx, troops.map((c) => c.id))
				: undefined;
			if (handler && call && 'character' in call) {
				void handler(call);
			}
			if (arc.then) {
				collective.issue(troops, arc.then.arc);
			}
			return { ok: true, verb: 'issue' };
		}
		collective.issue(troops, arc);
		return { ok: true, verb: 'issue' };
	}

	private tryCtx(id:string):TCtx | undefined {
		if (!this.contextFn) {
			return undefined;
		}
		try {
			return this.contextFn(id);
		}
		catch {
			return undefined;
		}
	}

	/** The view of a collective with no commander: its first living character's kernels, measured from the middle of them all. */
	private dummyHiveKernels(collective:Collective<TCtx>):HostKernels | undefined {
		if (!this.kernelFn) {
			return undefined;
		}
		const members = collective.characters.map((character) => ({ character, ctx: this.tryCtx(character.id) }));
		const first = members.find((m) => m.ctx !== undefined);
		if (!first?.ctx) {
			return undefined;
		}
		const sample = this.kernelsFor(first.character, first.ctx);
		const center = centroid(members.flatMap(({ character }) => {
			const point = this.world && poseOf(this.world, character.id)?.point;
			return point ? [point] : [];
		}));
		const poses = new Map<string, Pose>(center ? [[collective.id, { point: center }]] : []);
		return {
			...sample,
			...(this.world ? geometryKernels(this.world, first.character.id, poses) : {}),
			me: dummyEntity(collective.id, { tags: ['agent'] }),
			inventory: undefined,
		};
	}

	/** `collective`'s view for `who`: from `runner` when a character ran the step, or pooled when the collective did. */
	private collectiveCatalog(
		collective:Collective<TCtx>,
		runner:ArcRunner<TCtx>,
		ctx:TCtx | undefined,
	):Catalog | undefined {
		if (!this.kernelFn) {
			return undefined;
		}
		const kernels = ctx ? this.kernelsFor(runner, ctx) : this.dummyHiveKernels(collective);
		return kernels ? buildCollectiveCatalog(kernels, collective) : undefined;
	}

	/** A spec's kit, else the default one. Something that can run no verb is a mistake, so it throws. */
	private kitFor(spec:{ id:string; kit?:KitSource<TCtx> }):KitSource<TCtx> {
		const kit = spec.kit ?? this.defaultKit;
		if (!kit) {
			throw new Error(`ArcDirector: '${spec.id}' has no kit; give it one, or call withDefaultKit`);
		}
		if (typeof kit !== 'function' && kit.verbs.length === 0) {
			throw new Error(`ArcDirector: '${spec.id}' has a kit with no verbs`);
		}
		return kit;
	}

	private toolKnown(name:string):boolean {
		if (Object.hasOwn(this.tools, name)) {
			return true;
		}
		if (name === 'recall' || name === 'observe') {
			return true;
		}
		if (name === 'earshot' && (this.talk || this.talkSense)) {
			return true;
		}
		if (name === 'see_map' && this.map && this.vision) {
			return true;
		}
		if (name === GREP_WORLD_ENCYCLOPEDIA && this.encyclopedia) {
			return true;
		}
		return false;
	}

	private readKit(
		src:KitSource<TCtx>,
		id:string | undefined,
		where:string,
	):{ kit?:Kit; error?:string } {
		if (typeof src !== 'function') {
			return { kit: src };
		}
		if (!id) {
			return { error: `withContext required to resolve kit (${where})` };
		}
		if (!this.contextFn) {
			return { error: `withContext required to resolve kit (${where})` };
		}
		try {
			const ctx = this.contextFn(id);
			if (ctx === undefined) {
				return { error: `withContext returned undefined (${where})` };
			}
			return { kit: src(ctx) ?? {} };
		}
		catch (err:unknown) {
			const text = err instanceof Error ? err.message : String(err);
			return { error: `could not resolve kit (${where}): ${text}` };
		}
	}

	private scanKit(kit:Kit, where:string, out:string[]):void {
		for (const name of kit.verbs) {
			if (name && !this.verbs.has(name)) {
				out.push(`verb '${name}' is not registered (${where})`);
				continue;
			}
			const missing = this.handlers.has(name) || this.catchAll ? [] : missingParts(name, this.world);
			if (missing.length > 0) {
				out.push(`verb '${name}' needs withWorld ${missing.join(' and ')} (${where})`);
			}
		}
		for (const name of kit.senses ?? []) {
			if (name && !Object.hasOwn(this.senses, name)) {
				out.push(`sense '${name}' is not registered (${where})`);
			}
		}
		for (const name of kit.tools ?? []) {
			if (name && !this.toolKnown(name)) {
				out.push(`tool '${name}' is not registered (${where})`);
			}
		}
	}

	/** Kit names nothing registers: in `specs`, or in the default kit and every spec waiting for `start()`. */
	private missingNames(specs?:{ id:string; kit?:KitSource<TCtx> }[]):string[] {
		const out:string[] = [];
		if (!specs && this.defaultKit && typeof this.defaultKit !== 'function') {
			this.scanKit(this.defaultKit, 'default kit', out);
		}
		const list = specs ?? [
			...this.soloSpecs,
			...this.collectiveSpecs.flatMap((spec) => [spec, ...(spec.characters ?? []).filter((c) => c.kit)]),
		];
		for (const spec of list) {
			const src = spec.kit ?? (typeof this.defaultKit === 'function' || specs ? this.defaultKit : undefined);
			if (!src) {
				continue;
			}
			const where = `${spec.id}`;
			const read = this.readKit(src, spec.id, where);
			if (read.error) {
				out.push(read.error);
			}
			else if (read.kit) {
				this.scanKit(read.kit, where, out);
			}
		}
		return out;
	}

	private reportMissingNames(specs?:{ id:string; kit?:KitSource<TCtx> }[]):void {
		const parts = this.missingNames(specs);
		if (parts.length === 0) {
			return;
		}
		const message = `ArcDirector: ${parts.join('; ')}`;
		if (this.ignoreMissing) {
			this.emitLog({ name: 'ArcDirector', message });
			return;
		}
		throw new Error(message);
	}

	/** Throw when a character or collective already has `id`: they share one namespace. */
	private claimID(id:string):void {
		if (this.specs.has(id) || this.collectiveSpecs.some((spec) => spec.id === id)) {
			throw new Error(`ArcDirector: '${id}' is already a character or a collective`);
		}
	}

	/** A runner's per-tick sample cache. */
	private cacheOf(runner:ArcRunner<TCtx>):SampleCache {
		return (this.characterRows.get(runner.id) ?? this.collectiveRows.get(runner.id))?.cache ?? new SampleCache();
	}

	/** The deps every runner gets: dispatch through this director, its catalog, its kit. `runner` is the one built from them. */
	private runnerDeps(
		spec:{ id:string; laws?:LawSpec[]; maxLaws?:number; cooldown?:number },
		kit:KitSource<TCtx>,
		runner:()=>ArcRunner<TCtx>,
	):RunnerOptions<TCtx> {
		return {
			id: spec.id,
			verbs: this.verbs,
			context: () => this.tryCtx(runner().voice.id),
			execute: async (step, ctx) => this.dispatch(runner(), step, ctx),
			abortArc: (id) => this.abortArc(id),
			cooldown: spec.cooldown ?? this.cooldownDefault,
			talk: this.talk,
			catalog: this.kernelFn ? (ctx) => buildCatalog(this.kernelsFor(runner(), ctx)) : undefined,
			kit,
			laws: spec.laws,
			maxLaws: spec.maxLaws,
		};
	}

	/** Wire a character: alone, or `into` a collective. `json` restores a save. */
	private wireCharacter(spec:CharacterSpec<TCtx>, json?:CharacterJSON, into?:Collective<TCtx>):Character<TCtx> {
		const persona = json ? Persona.fromJSON(json.persona, spec) : new Persona(spec);
		persona.sightLimit ??= this.sightLimitDefault;
		const kit = this.kitFor(spec);
		const character:Character<TCtx> = new Character<TCtx>({
			...this.runnerDeps(spec, kit, () => character),
			persona,
			tags: spec.tags,
			mindSettings: spec.mind,
			wiring: this.wiring,
		});
		this.characterRows.set(spec.id, { spec, runner: character, cache: new SampleCache() });
		if (json) {
			character.load(json);
			for (const law of spec.laws ?? []) {
				character.addLaw(law, law.pinned);
			}
		}
		if (into) {
			into.members.push(character);
			character.memberOf = into;
			moveLawsInto(character, into);
		}
		else if (json?.mind || spec.mind) {
			this.attachMind(character, json?.mind ? Mind.fromJSON(json.mind) : new Mind({ ...this.mindDefaults, ...spec.mind }));
		}
		this.syncListener(character);
		this.stampPrev(character);
		return character;
	}

	/** Wire a collective, its characters, and its mind. `cast` restores a save. */
	private wireCollective(spec:CollectiveSpec<TCtx>, cast?:CastJSON):Collective<TCtx> {
		const json = cast?.collectives[spec.id];
		const persona = json ? Persona.fromJSON(json.persona, spec) : new Persona(spec);
		persona.sightLimit ??= this.sightLimitDefault;
		const mind = json ? Mind.fromJSON<TCtx>(json.mind) : new Mind<TCtx>({ ...this.mindDefaults, ...spec.mind });
		const collective:Collective<TCtx> = new Collective<TCtx>({
			...this.runnerDeps(spec, this.kitFor(spec), () => collective),
			defaultLawWho: 'units',
			persona,
			mind,
			host: this.collectiveHost,
			onCommanderVacant: (character) => this.commanderVacantFn?.(collective, character),
		});
		this.collectiveRows.set(spec.id, { spec, runner: collective, cache: new SampleCache() });
		const ids = json ? json.characters : (spec.characters ?? []).map((c) => c.id);
		for (const id of ids) {
			this.wireCharacter(this.specs.get(id) ?? { id }, cast?.characters[id], collective);
		}
		if (json) {
			collective.load(json);
			for (const law of spec.laws ?? []) {
				collective.addLaw(law, law.pinned);
			}
		}
		const commander = json ? json.commander : spec.commander;
		if (commander) {
			const chief = collective.character(commander);
			if (!chief) {
				throw new Error(`ArcDirector: no '${commander}' in '${spec.id}' to command it`);
			}
			collective.commander = chief;
		}
		this.attachMind(collective, mind);
		this.listen(collective);
		this.stampPrev(collective);
		return collective;
	}

	/** How a collective adds and removes its characters through this director. */
	private readonly collectiveHost:CollectiveHost<TCtx> = {
		addCharacter: (spec, into) => {
			this.claimID(spec.id);
			this.specs.set(spec.id, spec);
			this.reportMissingNames(spec.kit ? [spec] : []);
			return this.wireCharacter(spec, undefined, into);
		},
		removeCharacter: (id) => {
			this.removeCharacter(id);
		},
	};

	/** How `character.mind = …` and `character.collective = …` reach this director. */
	private readonly wiring:Wiring<TCtx> = {
		setMind: (character, mind) => this.setMind(character, mind),
		setCollective: (character, collective) => this.moveCharacter(character, collective),
	};

	/** `character.mind = mind`: its own mind from now on, out of any collective, or the host's hands for `null`. */
	private setMind(character:Character<TCtx>, mind:Mind<TCtx> | null):void {
		if (mind === character.mind) {
			return;
		}
		const shared = mind && this.collectives().find((c) => c.mind === mind);
		if (shared) {
			this.moveCharacter(character, shared);
			return;
		}
		if (mind?.attached && mind.owner !== character) {
			throw new Error(`ArcDirector: that mind thinks for '${mind.id}', not '${character.id}'`);
		}
		const from = character.memberOf;
		const { dropped } = from ? this.leave(character, from) : { dropped: [] };
		this.dropOwnMind(character);
		character.mindSettings = mind?.settings();
		if (mind) {
			this.attachMind(character, mind);
		}
		this.syncListener(character);
		if (from) {
			this.tellMoved(character, from, null, dropped);
			this.noteJourney(character, from, null);
		}
	}

	/** `character.collective = to`: straight from any collective to `to`, or out to its own mind (or the host's hands). */
	private moveCharacter(character:Character<TCtx>, to:Collective<TCtx> | null):void {
		const from = character.memberOf;
		if (from === to) {
			return;
		}
		if (to && this.collectiveRows.get(to.id)?.runner !== to) {
			throw new Error(`ArcDirector: '${to.id}' is not a collective here`);
		}
		const { kept, dropped } = from ? this.leave(character, from, to) : { kept: [], dropped: [] };
		if (to) {
			this.join(character, to, kept);
		}
		else if (character.mindSettings) {
			this.attachMind(character, new Mind({ ...this.mindDefaults, ...character.mindSettings }));
		}
		this.syncListener(character);
		this.tellMoved(character, from, to, dropped);
		this.noteJourney(character, from, to);
	}

	/** Queue a move for the next memory handover. A character moving again keeps its first `from`. */
	private noteJourney(character:Character<TCtx>, from:Collective<TCtx> | null, to:Collective<TCtx> | null):void {
		if (this.handover === false) {
			return;
		}
		const was = this.journeys.get(character);
		this.journeys.set(character, { character, from: was ? was.from : from, to });
	}

	/**
	 * The memory handover for the moves so far, once their window has passed: it takes the next free think slot,
	 * ahead of thinks still waiting, so memories are fixed before the minds involved think again if it can be.
	 */
	private tickHandover():void {
		if (this.journeys.size === 0) {
			return;
		}
		this.journeyTicks += 1;
		const queue = this.queue;
		const full = !!queue && queue.inFlight >= queue.maxParallel;
		if (this.journeyTicks < this.handoverTicks || this.handoverBusy || full || !this.handover) {
			return;
		}
		const journeys = [...this.journeys.values()].filter((j) => j.from !== j.to && hasIdentity(j.character));
		this.journeys.clear();
		this.journeyTicks = 0;
		if (journeys.length === 0) {
			return;
		}
		this.handoverBusy = true;
		void this.handover(journeys)
			.then((edits) => this.applyMemoryEdits(edits))
			.catch((err:unknown) => {
				const text = err instanceof Error ? err.message : String(err);
				this.emitLog({ name: HANDOVER_THREAD, message: `failed: ${text}`, error: true });
			})
			.finally(() => {
				this.handoverBusy = false;
			});
	}

	/** Apply a handover's edits. Pinned memories and unknown ids are left alone; embeddings follow later. */
	private applyMemoryEdits(edits:MemoryEdit[]):void {
		for (const edit of edits) {
			const memory = (this.character(edit.id) ?? this.collective(edit.id))?.persona.memory;
			if (!memory) {
				continue;
			}
			const editable = (id:string):boolean => memory.all().some((m) => m.id === id && !m.pinned);
			for (const id of edit.remove ?? []) {
				if (editable(id)) {
					memory.remove(id);
				}
			}
			for (const { id, text } of edit.rewrite ?? []) {
				if (editable(id) && text.trim()) {
					this.embedLater(memory.rewrite(id, text.trim())!);
				}
			}
			for (const text of edit.add ?? []) {
				const line = text.trim();
				if (line) {
					this.embedLater(memory.add({ category: 'semantic', text: line, tags: nameTags(line), timestamp: this.clock }, this.clock));
				}
			}
		}
	}

	/** Embed a memory written outside a think, without waiting for it. */
	private embedLater(record:MemoryRecord):void {
		void this.provider?.embed?.([record.text])
			.then(([vec]) => {
				record.embedding = vec;
			})
			.catch(() => undefined);
	}

	/**
	 * Take `character` out of `from`: the commander post if it held it, `from`'s own tags on it, and its own laws
	 * there. Moving on to `to`, those laws are `kept` as they are. Leaving for good, they lose their `Tom.`
	 * prefix and come home, but laws that only work in a collective (`units`, `allUnits`) are `dropped`.
	 */
	private leave(
		character:Character<TCtx>,
		from:Collective<TCtx>,
		to:Collective<TCtx> | null = null,
	):{ kept:Law[]; dropped:Law[] } {
		from.members = from.members.filter((c) => c !== character);
		character.memberOf = null;
		character.tags = character.tags.filter((t) => !from.ownsTag(t));
		const own = from.laws.filter((law) => lawGroup(law.name) === character.id);
		from.laws = from.laws.filter((law) => !own.includes(law));
		from.vacate(character);
		if (to) {
			return { kept: own, dropped: [] };
		}
		const dropped = own.filter((law) => usesCollective(law, this.verbs));
		for (const law of own.filter((l) => !dropped.includes(l))) {
			law.name = law.name.slice(character.id.length + 1);
			character.keepLaw(law);
		}
		return { kept: [], dropped };
	}

	/** Put `character` in `to`: its own mind goes (its settings are kept), and its laws move in as its own there. */
	private join(character:Character<TCtx>, to:Collective<TCtx>, carried:Law[]):void {
		if (character.ownMind) {
			character.mindSettings = character.ownMind.settings();
		}
		this.dropOwnMind(character);
		to.members.push(character);
		character.memberOf = to;
		moveLawsInto(character, to);
		for (const law of carried) {
			to.keepLaw(law);
		}
	}

	/** Tell each mind involved what changed: a collective who left or joined it, and a character what it left. */
	private tellMoved(
		character:Character<TCtx>,
		from:Collective<TCtx> | null,
		to:Collective<TCtx> | null,
		dropped:Law[],
	):void {
		const tell = (mind:Mind<TCtx>, event:MindEvent):void => {
			mind.pushEvent(event);
			this.queue?.enqueueMajor(mind.id, true);
		};
		if (from) {
			// The name it went by there: once gone, the policy may call it something else (an enemy, say).
			const name = from.mind.nameOf(character.id);
			tell(from.mind, { kind: 'Left', text: `${name} left`, tags: [name], major: true });
		}
		if (to) {
			tell(to.mind, { kind: 'Joined', text: '{0} joined', who: [character.id], major: true });
		}
		const own = character.ownMind;
		if (!from || !own) {
			return;
		}
		const doing = character.arc ? ` You are still doing what {0} gave you: ${own.namedArc(character.arc)}.` : '';
		const gone = dropped.length > 0
			? ` Your laws that only work in a group are gone: ${dropped.map((law) => law.name.slice(character.id.length + 1)).join(', ')}.`
			: '';
		tell(own, { kind: 'Left', text: `You left {0}.${doing}${gone}`, who: [from.id], major: true });
	}

	/** Drop a character's own mind, if it has one: its think stops, and it leaves the queue. */
	private dropOwnMind(character:Character<TCtx>):void {
		if (character.ownMind) {
			this.detachMind(character.ownMind);
			character.ownMind = null;
		}
	}

	/** Let `mind` think for `owner`: wire it, and give it a place in the think queue. */
	private attachMind(owner:Character<TCtx> | Collective<TCtx>, mind:Mind<TCtx>):void {
		if (owner instanceof Character) {
			owner.ownMind = mind;
		}
		mind.attach(owner, this.mindDeps(mind, owner));
		mind.stamp(this.clock);
		this.queue?.ensure(mind.id, { skipHeartbeat: mind.skipHeartbeat, skipMajor: mind.skipMajor });
		this.queue?.setWatches(mind.id, mind.persona.effectiveWatches());
		this.queue?.setAiOn(mind.id, true);
	}

	/** Stop `mind` thinking: its think in flight, and its place in the queue. It thinks for no one after. */
	private detachMind(mind:Mind<TCtx>):void {
		mind.abortThink();
		this.queue?.setAiOn(mind.id, false);
		this.queue?.drop(mind.id);
		let i = this.readyThink.length;
		while (i--) {
			if (this.readyThink[i].mindID === mind.id) {
				this.readyThink.splice(i, 1);
			}
		}
		mind.detach();
	}

	/** Speech `runner` hears reaches its mind when it is that mind's voice. */
	private listen(runner:ArcRunner<TCtx>):void {
		this.talk?.attach({
			id: runner.id,
			nameOf: (id) => runner.mind?.nameOf(id) ?? id,
			pushEvent: (event) => {
				const mind = runner.isVoice ? runner.mind : null;
				if (!mind) {
					return;
				}
				mind.pushEvent(event);
				if (event.major) {
					this.queue?.enqueueMajor(mind.id, true);
				}
			},
		});
	}

	/** A character listens to talk while a mind thinks for it. */
	private syncListener(character:Character<TCtx>):void {
		if (character.mind) {
			this.listen(character);
		}
		else {
			this.talk?.detach(character.id);
		}
	}

	/** Take a character off the director: its arc, moves, talk, its own mind, and its place in a collective. */
	private dropCharacter(id:string):void {
		const row = this.characterRows.get(id);
		if (!row) {
			return;
		}
		const character = row.runner;
		this.characterRows.delete(id);
		character.replaceProgram();
		this.mover.stop(id);
		this.talk?.detach(id);
		this.dropOwnMind(character);
		if (character.memberOf) {
			this.leave(character, character.memberOf);
		}
	}

	/** Take a collective off the director. Its characters stay, each on its own: a fresh mind if it had settings for one. */
	private dropCollective(id:string):void {
		const row = this.collectiveRows.get(id);
		if (!row) {
			return;
		}
		const collective = row.runner;
		for (const character of [...collective.members]) {
			this.moveCharacter(character, null);
		}
		this.collectiveRows.delete(id);
		collective.replaceProgram();
		this.talk?.detach(id);
		this.detachMind(collective.mind);
	}

	/** Every character and collective, as a save. Restore it with `restoreCast`. */
	exportCast():CastJSON {
		const characters:Record<string, CharacterJSON> = {};
		for (const row of this.characterRows.values()) {
			characters[row.runner.id] = row.runner.toJSON();
		}
		const collectives:Record<string, CollectiveJSON> = {};
		for (const row of this.collectiveRows.values()) {
			collectives[row.runner.id] = row.runner.toJSON();
		}
		return { characters, collectives };
	}

	/**
	 * Rebuild the cast from `exportCast`, under the specs added here. Before `start()` it is kept, and `start()`
	 * builds from it. A collective's characters come from the save, so ones that joined or died stay that way.
	 */
	restoreCast(cast:CastJSON):void {
		if (!this.started) {
			this.stored = cast;
			return;
		}
		this.clearCast();
		this.wireCast(cast);
	}

	/** Drop every character and collective quietly: no events, no new commanders, no fresh minds. */
	private clearCast():void {
		for (const { runner } of this.characterRows.values()) {
			runner.replaceProgram();
			this.mover.stop(runner.id);
			this.talk?.detach(runner.id);
			this.dropOwnMind(runner);
			runner.memberOf = null;
		}
		for (const { runner } of this.collectiveRows.values()) {
			runner.replaceProgram();
			this.talk?.detach(runner.id);
			this.detachMind(runner.mind);
			runner.members = [];
		}
		this.characterRows.clear();
		this.collectiveRows.clear();
		this.journeys.clear();
	}

	/**
	 * Build every character and collective from the specs added here, or from `cast` under them: then the save
	 * says who belongs to which collective, and who is on their own.
	 */
	private wireCast(cast?:CastJSON):void {
		const members = new Set(Object.values(cast?.collectives ?? {}).flatMap((c) => c.characters));
		const solo = new Set(this.soloSpecs.map((spec) => spec.id));
		for (const id of Object.keys(cast?.characters ?? {})) {
			if (!members.has(id) && !solo.has(id) && this.specs.has(id)) {
				solo.add(id);
			}
		}
		for (const id of solo) {
			if (!members.has(id)) {
				this.wireCharacter(this.specs.get(id)!, cast?.characters[id]);
			}
		}
		for (const spec of this.collectiveSpecs) {
			this.wireCollective(spec, cast);
		}
	}

	/** Tell every mind once. */
	pushEvent(event:MindEvent):void {
		for (const mind of this.minds()) {
			mind.pushEvent(event);
			if (event.major) {
				this.queue?.enqueueMajor(mind.id, true);
			}
		}
	}

	tick(dt:number, now:number):void {
		if (!this.started || this.disposed || !this.queue) {
			return;
		}
		this.clock = now;
		const rows = [...this.characterRows.values(), ...this.collectiveRows.values()];
		for (const row of rows) {
			row.runner.stamp(now);
			row.runner.refreshKit();
		}
		const minds = this.minds();
		const catalogs = new Map<string, Catalog | Catalog[]>();
		for (const mind of minds) {
			mind.stamp(now);
			if (!this.kernelFn || !this.contextFn) {
				continue;
			}
			try {
				catalogs.set(mind.id, this.catalogsFor(mind));
			}
			catch {
				continue;
			}
		}
		const cap = this.queue.maxParallel;
		this.queue.maxParallel = Math.max(cap, minds.length);
		const ready = this.queue.tick(dt, catalogs);
		this.queue.maxParallel = cap;
		this.readyThink.push(...ready);
		this.tickWaits();
		this.mover.tick();
		this.talk?.tick(now);
		for (const row of rows) {
			row.cache.commit();
		}
		for (const row of this.characterRows.values()) {
			if (!row.runner.memberOf) {
				this.tickLaws(row.runner);
			}
		}
		for (const row of this.collectiveRows.values()) {
			this.tickCollectiveLaws(row.runner);
		}
		this.tickHandover();
		this.drain(now);
	}

	/** What `mind`'s watches score against: its voice's view, or one view per character of a collective. */
	private catalogsFor(mind:Mind<TCtx>):Catalog | Catalog[] {
		const owner = mind.owner;
		const voiceCtx = this.tryCtx(mind.thinkThread());
		const kernels = voiceCtx
			? this.kernelsFor(mind.voice, voiceCtx)
			: (owner instanceof Collective ? this.dummyHiveKernels(owner) : undefined);
		if (!kernels) {
			throw new Error('no ctx');
		}
		const thinker = buildCatalog(kernels);
		if (!(owner instanceof Collective)) {
			return thinker;
		}
		const views:Catalog[] = [];
		for (const character of owner.characters) {
			const ctx = this.tryCtx(character.id);
			if (ctx) {
				views.push(buildCollectiveCatalog(this.kernelsFor(character, ctx), owner));
			}
		}
		return views.length > 0 ? views : thinker;
	}

	/** Laws and the live arc session of a character on its own. */
	private tickLaws(character:Character<TCtx>):void {
		if (character.laws.length === 0 && !character.arcSession) {
			return;
		}
		let catalog = character.arcSession?.catalog;
		if (!catalog && this.kernelFn && this.contextFn) {
			catalog = () => {
				const ctx = this.tryCtx(character.id);
				return ctx ? buildCatalog(this.kernelsFor(character, ctx)) : undefined;
			};
		}
		this.pollRunner(character, () => character.lawHandlers(), catalog);
	}

	/** A collective's laws on each of its characters, their sessions, and its own session while it has no commander. */
	private tickCollectiveLaws(collective:Collective<TCtx>):void {
		const voice = collective.voice;
		const voiceCtx = this.tryCtx(voice.id);
		const whoKernels = !this.kernelFn
			? undefined
			: voiceCtx ? this.kernelsFor(voice, voiceCtx) : this.dummyHiveKernels(collective);
		if (!whoKernels) {
			return;
		}
		const whoCat = buildCollectiveCatalog(whoKernels, collective);
		for (const character of collective.characters) {
			const ctx = this.tryCtx(character.id);
			if (!ctx) {
				if (character !== collective.commander && character.busy) {
					character.replaceProgram();
				}
				continue;
			}
			const extras = ():ArcHandler[] => collective.lawHandlersFor(character, (law) => lawMatches(law, character, whoCat, collective));
			const catalog = ():Catalog => buildCollectiveCatalog(this.kernelsFor(character, this.tryCtx(character.id) ?? ctx), collective);
			this.pollRunner(character, extras, catalog);
		}
		if (voice === collective) {
			this.pollRunner(collective, () => [], () => whoCat);
		}
	}

	/** A think is in flight or already queued, so a law must not walk the character out from under it. */
	private thinkWaiting(mindID:string):boolean {
		return !!this.queue?.isThinking(mindID)
			|| !!this.queue?.hasPending(mindID)
			|| this.readyThink.some((row) => row.mindID === mindID);
	}

	/** Poll `runner`'s live session, or start the first law that holds. A voice waits for its mind's think. */
	private pollRunner(
		runner:ArcRunner<TCtx>,
		extras:()=>ArcHandler[],
		catalog:ArcSession['catalog'],
	):void {
		const session = runner.arcSession;
		if (session) {
			if (catalog) {
				session.catalog = catalog;
			}
			session.now = () => this.clock;
			session.extraHandlers = extras;
			session.abortHost = () => this.abortArc(runner.id);
			pollArcSession(session);
			return;
		}
		const probe = createArcSession({
			catalog,
			now: () => this.clock,
			extraHandlers: extras,
		});
		const first = firstStartable(probe);
		const mind = runner.isVoice ? runner.mind : null;
		if (first && !(mind && this.thinkWaiting(mind.id))) {
			runner.beginLaw(first, {
				catalog,
				now: () => this.clock,
				abortHost: () => this.abortArc(runner.id),
				extraHandlers: extras,
			});
		}
	}

	/** The mind the queue knows as `id`: a character's own, or a collective's. */
	private mindByID(id:string):Mind<TCtx> | undefined {
		return this.characterRows.get(id)?.runner.ownMind ?? this.collectiveRows.get(id)?.runner.mind ?? undefined;
	}

	private drain(now:number):void {
		const queue = this.queue;
		if (!queue) {
			return;
		}
		this.readyThink.sort((a, b) => {
			const score = queue.rankScore(b.mindID, b.score) - queue.rankScore(a.mindID, a.score);
			if (score !== 0) {
				return score;
			}
			return (this.mindByID(b.mindID)?.rank ?? 0) - (this.mindByID(a.mindID)?.rank ?? 0);
		});
		const slots = this.thinkSlots(queue, now);
		if (slots <= 0) {
			return;
		}
		const held:ThinkRow[] = [];
		let left = slots;
		for (const row of this.readyThink) {
			const mind = this.mindByID(row.mindID);
			if (!mind || queue.isThinking(row.mindID) || left <= 0) {
				if (mind) {
					held.push(row);
				}
				continue;
			}
			if (!queue.allowThink(row)) {
				held.push(row);
				continue;
			}
			queue.drop(row.mindID);
			this.fireThink(mind, now);
			left -= 1;
		}
		this.readyThink.length = 0;
		this.readyThink.push(...held);
		if (queue.inFlight > 0 && this.readyThink.length > 0 && this.batchHeldTimestamp === null) {
			this.batchHeldTimestamp = now;
		}
	}

	private thinkSlots(queue:MindQueue, now:number):number {
		const inFlight = queue.inFlight;
		if (inFlight === 0) {
			this.batchHeldTimestamp = null;
		}
		const open = queue.maxParallel - inFlight - (this.handoverBusy ? 1 : 0);
		if (open <= 0) {
			return 0;
		}
		const { batchThinks, batchWait } = this.thinkBatchPolicy();
		if (!batchThinks || inFlight === 0) {
			return open;
		}
		const waiting = this.readyThink.some((row) => !!this.mindByID(row.mindID) && !queue.isThinking(row.mindID));
		if (!waiting) {
			return 0;
		}
		if (!Number.isFinite(batchWait) || batchWait <= 0) {
			return 0;
		}
		if (this.batchHeldTimestamp === null) {
			this.batchHeldTimestamp = now;
		}
		if (now - this.batchHeldTimestamp < batchWait) {
			return 0;
		}
		this.batchHeldTimestamp = now;
		return open;
	}

	private thinkBatchPolicy():{ batchThinks:boolean; batchWait:number } {
		const http = this.inference.kind === 'http' ? this.inference.opts : undefined;
		return {
			batchThinks: this.queue?.batchThinks ?? http?.batchThinks ?? DEFAULT_BATCH_THINKS,
			batchWait: this.queue?.batchWait ?? http?.batchWait ?? DEFAULT_BATCH_WAIT,
		};
	}

	private fireThink(mind:Mind<TCtx>, now:number):void {
		void mind.tick(now)
			.then((arc) => {
				if (!mind.attached) {
					return;
				}
				this.queue?.setWatches(mind.id, mind.persona.effectiveWatches());
				if (!arc) {
					this.queue?.noteResult(mind.id, true);
					return;
				}
				this.emitLog({ name: mind.thinkThread(), message: formatArc(arc, this.verbs) });
			})
			.catch((err:unknown) => {
				if (!mind.attached) {
					return;
				}
				const text = err instanceof Error ? err.message : String(err);
				this.emitLog({ name: mind.thinkThread(), message: `stalled: ${text}` });
				this.queue?.noteResult(mind.id, true);
				// An invalid reply ends no arc, so nothing would wake this mind: think again once, told why.
				// Aborts and inference errors are not the mind's doing.
				if (err instanceof ArcError) {
					const again = mind.lastResult?.verb !== 'think' || mind.lastResult.ok;
					mind.ingestResult({ ok: false, verb: 'think', reason: `your reply was not a valid Arc: ${text}` });
					if (again) {
						this.queue?.enqueueVerb(mind.id, 'think', false);
					}
				}
			});
	}

	/** Wall-clock loop for laws. Games must not use this — they already have a frame tick. */
	runLoop(hz:number):()=>void {
		if (!this.started) {
			throw new Error('ArcDirector: start() before runLoop');
		}
		this.stopLoop();
		const dt = 1 / Math.max(1, hz);
		let now = 0;
		this.loop = setInterval(() => {
			now += dt;
			this.tick(dt, now);
		}, Math.max(1, Math.round(1000 / hz)));
		return () => this.stopLoop();
	}

	private stopLoop():void {
		if (this.loop !== undefined) {
			clearInterval(this.loop);
			this.loop = undefined;
		}
	}

	dispose():void {
		this.stopLoop();
		this.disposed = true;
		this.clearCast();
		this.started = false;
	}
}

/** Whether a character has an identity worth a memory handover: a role or traits. */
function hasIdentity<TCtx>(character:Character<TCtx>):boolean {
	const { role, traits } = character.persona.identity;
	return !!role || (traits?.length ?? 0) > 0;
}

/** Remove the spec with `id` from `specs`, and return it. */
function remove<TSpec extends { id:string }>(specs:TSpec[], id:string):TSpec | undefined {
	const i = specs.findIndex((spec) => spec.id === id);
	return i < 0 ? undefined : specs.splice(i, 1)[0];
}

/**
 * A character's laws, moved onto `collective` as its own: `flee` becomes `Tom.flee`, reaching only Tom. Each law
 * object moves itself, so an arc it started still counts as its own.
 */
function moveLawsInto<TCtx>(character:Character<TCtx>, collective:Collective<TCtx>):void {
	for (const law of character.laws) {
		law.name = `${character.id}.${law.name}`;
		law.who = 'me';
		collective.keepLaw(law);
	}
	character.laws = [];
}

/** The collective `runner` acts in: itself, or the one its character belongs to. */
function collectiveOf<TCtx>(runner:ArcRunner<TCtx>):Collective<TCtx> | null {
	return runner instanceof Collective ? runner : runner instanceof Character ? runner.collective : null;
}
