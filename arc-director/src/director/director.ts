import { argBase, CHOOSE_VERB, registerStockVerbs, VerbRegistry, type StockVerb, type VerbArgMap } from '../arc/stock-verbs.js';
import { formatArc, parseArcText } from '../arc/parse.js';
import { arcArg } from '../arc/wire.js';
import type { Arc, ArcResult, Step, StepArg } from '../arc/types.js';
import { validateArc } from '../arc/validate.js';
import { choicePrompt } from '../character/choice.js';
import { JevSystemOne, ModelSystemOne, type JevOpts, type SystemOne } from '../inference/systemone.js';
import { ArcError } from '../arc/types.js';
import { lawGroup, type Law, type LawSpec } from '../arc/laws.js';
import { bodiless, type ArcRunner, type RunnerOptions } from '../character/arc-runner.js';
import { Character, type CharacterFields, type CharacterJSON, type Wiring } from '../character/character.js';
import { Persona } from '../character/persona.js';
import type { Kit, KitSource } from '../character/types.js';
import type { NameTarget } from '../character/names.js';
import { Collective, type CollectiveFields, type CollectiveHost, type CollectiveJSON } from '../collective/collective.js';
import { Mind, mindFields, type MindDeps, type MindSettings } from '../mind/mind.js';
import type { ArcFormat, MindEvent, Sense, ToolSpec } from '../mind/types.js';
import type { ThinkInstructions } from '../mind/prompt.js';
import { TalkNet, type SpeechUtterance, type TalkConfig, type TalkMind, type TalkSense } from '../mind/talk.js';
import type { MapSense } from '../mind/map.js';
import type { KnowledgeSource } from '../mind/knowledge.js';
import { buildCatalog, dummyEntity, type HostKernels } from '../expr/natives.js';
import { freezeMe, type MeFreezeHost } from '../expr/prev.js';
import { catalogEntities, evaluate, unboundCalls, type EvalResult } from '../expr/eval.js';
import { parse } from '../expr/parse.js';
import { watchScore } from '../expr/score.js';
import { ABSENT, ExprError, SampleCache, leftoverFilterHint, type Catalog, type ExprEntity, type ExprVal } from '../expr/types.js';
import {
	formatSight,
	formatSightClauses,
	joinSightClauses,
	mergeHiveClauses,
	orderSightClauses,
} from '../perception/sight.js';
import { formatInventory } from '../perception/formatInventory.js';
import type { Inventory } from '../perception/inventory.js';
import type { SeenObject, Sight, SightClause } from '../perception/types.js';
import {
	registerStockCollectiveVerbs,
	STOCK_COLLECTIVE_VERBS,
	isFormationVerb,
	type StockCollectiveVerb,
} from '../collective/verbs.js';
import { buildCollectiveCatalog, evaluateWho, lawMatches, memberEntity, usesCollective } from '../collective/who.js';
import { chatHandover, HANDOVER_THREAD, type Handover, type Journey, type MemoryEdit } from '../collective/handover.js';
import { nameTags, type MemoryRecord } from '../memory/store.js';
import {
	DEFAULT_COOLDOWN,
	createArcSession,
	firstStartable,
	pollArcSession,
	watchIsTrue,
	type ArcHandler,
	type ArcPick,
	type ArcSession,
	type LastChoice,
} from '../arc/run.js';
import type { ChatRequest, ChatResponse, InferenceProvider } from '../inference/provider.js';
import type { FakeChatFn } from '../inference/fake.js';
import { formatChatLog } from '../inference/chatLog.js';
import { lmStudioConfig, ollamaConfig, type HttpInferenceOpts } from '../inference/presets.js';
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
import { ModelRegistry, type EmbeddingSpec, type InferenceSource, type LiveModel, type ModelSpec } from './models.js';
import { geometryKernels, wayBlocked } from '../world/kernels.js';
import { Mover } from '../world/mover.js';
import { OfferBook, offerText, type Offer } from '../world/offers.js';
import { poseOf } from '../world/lookup.js';
import type { HostWorld, Pose, Vec } from '../world/types.js';
import { centroid, distance } from '../world/vec.js';
import { missingParts, worldVerbs } from '../world/verbs.js';

const STARTED = 'ArcDirector already started';

/** A wait in progress (stock `wait`, or a handler's `call.wait`), settled by `tick`. */
type Wait = { runnerID:string; verb:string; end:number; seconds:number; met?:()=>boolean; done:(result:ArcResult)=>void };

/** Character ids a reply wait is watching. One id, or several. */
function replyTargets(raw:unknown):string[] {
	if (typeof raw === 'string' && raw.trim()) {
		return [raw];
	}
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw.filter((id):id is string => typeof id === 'string' && id.trim() !== '');
}

/** Watch value as a 0–1 fit. A non-empty list or an entity counts as true. */
function fit(value:ExprVal):number {
	if (value.kind === 'list') {
		return value.value.length > 0 ? 1 : 0;
	}
	return value.kind === 'entity' ? 1 : watchScore(value).score;
}

/** How well watch `expr` fits in `catalog`, 0–1. No catalog, or an expression that does not evaluate: 0. */
function watchFit(expr:string, catalog:Catalog | undefined):number {
	const r = catalog ? evaluate(expr, catalog) : undefined;
	return r && !r.error ? fit(r.value) : 0;
}

/** Why a watch expression can never hold (bad syntax, leftover English, a function there is none of), as opposed to false right now. */
function watchProblem(expr:string, catalog:Catalog | undefined):string | undefined {
	try {
		parse(expr);
	}
	catch (err) {
		return `${expr}: ${err instanceof Error ? err.message : String(err)}`;
	}
	const unbound = catalog ? unboundCalls(expr, catalog) : [];
	if (unbound.length > 0) {
		return `${expr}: ${unbound.map((name) => `${name}()`).join(', ')} is not a function`;
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

/** A mind's provider while its model has not resolved: every call says so. */
const NO_MODEL:InferenceProvider = {
	chat: async () => {
		throw new Error('ArcDirector: no chat model (addModel)');
	},
};

/** How long a System One that failed is skipped, so each pick does not wait on it again. */
const SYSTEM_ONE_REST_MS = 30_000;

/** A character's standing `choose`: its loop, its `until`, and the game time a failed loop rests until. */
type Standing = { arc:Arc; until?:string; restUntil:number };

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
	/** Every open offer; none when no one offers anything. */
	offers?:Offer[];
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
	private _ready = false;
	/** `restoreCast` before `start()`; the cast is built from it when it is wired. */
	private _stored:CastJSON | undefined;
	private _disposed = false;
	private _queueSlot:QueueSlot = { kind: 'default' };
	private _queue:MindQueue | undefined;
	private _verbs = new VerbRegistry();
	private readonly _handlers = new Map<string, VerbHandler<TCtx>>();
	private _catchAll:VerbHandler<TCtx> | undefined;
	private _verbGate:VerbGate<TCtx> | undefined;
	private readonly _waits = new Set<Wait>();
	private _world:HostWorld<unknown> | undefined;
	/** Every open offer, standing ones and ones to someone. Saved with the cast. */
	public readonly offers = new OfferBook();
	/** Stock world verbs, bound at `start()` for the parts `withWorld` has. A host handler of the same name wins. */
	private readonly _stockHandlers = new Map<string, VerbHandler<TCtx>>();
	private _mover = new Mover(undefined, () => this._clock);
	private _toolRounds:number | undefined;
	private _arcRetries:number | undefined;
	private _stalledFn:((result:ArcResult)=>boolean) | undefined;
	private _senses:Record<string, Sense<TCtx>> = {};
	private _tools:Record<string, ToolSpec<TCtx>> = {};
	private _sightLook:((ctx:TCtx)=>Sight) | undefined;
	private _sightLimitDefault:number | undefined;
	private _sightUnitName:string | undefined;
	private _contextFn:((id:string)=>TCtx | undefined) | undefined;
	private _kernelFn:KernelSource<TCtx> | undefined;
	private _defaultKit:KitSource<TCtx> | undefined;
	private _cooldownDefault = DEFAULT_COOLDOWN;
	private _talkSense:TalkSense | undefined;
	private _onSpoke:((utterance:SpeechUtterance)=>void) | undefined;
	private _talkConfig:Partial<TalkConfig> | undefined;
	public talk:TalkNet | undefined;
	private _map:MapSense | undefined;
	private _knowledge:KnowledgeSource<TCtx> | undefined;
	private _mentionCap:number | undefined;
	private _abortArcFn:((id:string)=>void) | undefined;
	private _commanderVacantFn:((collective:Collective<TCtx>, character:Character<TCtx>)=>void) | undefined;
	private _logFn:((entry:DirectorLog)=>void) | undefined;
	private _stepFn:((call:VerbCall<TCtx>, result:ArcResult)=>void) | undefined;
	private _ignoreMissing = false;
	private _arcFormat:ArcFormat = 'json';
	/** System One models by name. A runner is assigned one; one without an assignment uses the default. */
	private readonly _systemOnes = new Map<string, SystemOne>();
	/** When each System One that failed may be asked again (`performance.now()`). */
	private readonly _systemOneRest = new Map<string, number>();
	private _defaultSystemOne:string | null = null;
	/** One pick closure per character, so `withheldVerbs` asking for it every refresh stays cheap. */
	private readonly _picks = new WeakMap<ArcRunner<TCtx>, ArcPick>();
	private readonly _standing = new WeakMap<Character<TCtx>, Standing>();
	private _thinkInstructions:ThinkInstructions | undefined;
	private _verbInstructions:string | undefined;
	private _arcExample:string | undefined;
	private _systemNote:string | undefined;
	private _repairTemperature:number | undefined;
	private _seenFn:SeenName<TCtx> | undefined;
	private _mindDefaults:MindSettings = {};
	/** `undefined` until `start()` picks the default; `false` when the host turned it off. */
	private _handover:Handover<TCtx> | false | undefined;
	private _handoverTicks = 1;
	/** Moves waiting for the next handover, one per character: its first `from`, its latest `to`. */
	private readonly _journeys = new Map<Character<TCtx>, Journey<TCtx>>();
	private _journeyTicks = 0;
	/** A handover call holds one think slot until it answers. */
	private _handoverBusy = false;
	/** Specs from `addCharacter`, in order: the characters on their own when the cast is built or restored. */
	private readonly _soloSpecs:CharacterSpec<TCtx>[] = [];
	private readonly _collectiveSpecs:CollectiveSpec<TCtx>[] = [];
	/** Every character spec by id, on its own or in a collective. One id namespace covers characters and collectives. */
	private readonly _specs = new Map<string, CharacterSpec<TCtx>>();
	private readonly _characterRows = new Map<string, Row<CharacterSpec<TCtx>, Character<TCtx>>>();
	private readonly _collectiveRows = new Map<string, Row<CollectiveSpec<TCtx>, Collective<TCtx>>>();
	/** What each character's and collective's constructor handed this director, kept past their rows. */
	private readonly _characterFields = new WeakMap<Character<TCtx>, CharacterFields<TCtx>>();
	private readonly _collectiveFields = new WeakMap<Collective<TCtx>, CollectiveFields<TCtx>>();
	/** Each mind owner's talk listener, shared by every character it hears through. */
	private readonly _talkMinds = new WeakMap<ArcRunner<TCtx>, TalkMind>();
	private readonly _readyThink:ThinkRow[] = [];
	/** Per model: when its waiting thinks started waiting for it to go idle. */
	private readonly _batchHeld = new Map<string, number>();
	private _clock = 0;
	private _loop:ReturnType<typeof setInterval> | undefined;
	/** Chat servers and the models configured on them, by name. */
	private readonly _models = new ModelRegistry({
		wrap: (provider, http) => this.wrapProvider(provider, http),
		onRequest: ({ req, body, path }) => {
			// A System One's pick is logged once, whole, by `pick`.
			if (isPick(req)) {
				return;
			}
			const dump = formatChatLog(body);
			this.emitLog({ name: whoFromMessages(req), message: `prompt ${path}
${dump.message}`, image: dump.image });
		},
		changed: () => this.syncModels(),
		log: (message, error) => this.emitLog({ name: 'ArcDirector', message, error }),
	});
	public infer:InferClock = emptyInferClock();

	public get ready():boolean {
		return this._ready && !this._disposed;
	}

	private assertBuilder():void {
		if (this._ready) {
			throw new Error(STARTED);
		}
	}

	private emitLog(entry:DirectorLog):void {
		this._logFn?.(entry);
	}

	public withPriorityQueue(opts?:ThinkQueueOpts):this {
		this.assertBuilder();
		this._queueSlot = { kind: 'priority', opts };
		return this;
	}

	public withSimpleQueue(opts?:SimpleQueueOpts):this {
		this.assertBuilder();
		this._queueSlot = { kind: 'simple', opts };
		return this;
	}

	public withQueue(queue:MindQueue):this {
		this.assertBuilder();
		this._queueSlot = { kind: 'instance', queue };
		return this;
	}

	/** LM Studio as chat server `name` (default `lmstudio`), before or after `start()`. Default URL `http://127.0.0.1:1234/v1`. */
	public addLMStudioInference({ name = 'lmstudio', ...opts }:HttpInferenceOpts & { name?:string } = {}):this {
		return this.addInference(name, { kind: 'http', opts: lmStudioConfig(opts) });
	}

	/** Ollama as chat server `name` (default `ollama`). Default URL `http://127.0.0.1:11434/v1`. */
	public addOllamaInference({ name = 'ollama', ...opts }:HttpInferenceOpts & { name?:string } = {}):this {
		return this.addInference(name, { kind: 'http', opts: ollamaConfig(opts) });
	}

	/** Any OpenAI-compatible server, as chat server `name` (default `http`). */
	public addHttpInference({ name = 'http', ...opts }:HttpInferenceOpts & { name?:string }):this {
		return this.addInference(name, { kind: 'http', opts });
	}

	/** Canned replies for tests, as chat server `name` (default `fake`); its model id is `fake`. */
	public addFakeInference(chat?:FakeChatFn, { name = 'fake' }:{ name?:string } = {}):this {
		return this.addInference(name, { kind: 'fake', chat });
	}

	/**
	 * A server under `name`, before or after `start()`; the same name again replaces it. A chat server is your own
	 * `InferenceProvider` or a source. A System One (anything with `pick`) answers `choose`: a spec's `systemOne`
	 * assigns one by name, a runner without one uses {@link setDefaultSystemOne}'s, and when a runner's own fails or
	 * names no choice, the others are asked in the order added, then the runner's chat model.
	 */
	public addInference(name:string, source:InferenceProvider | InferenceSource | SystemOne, { vision }:{ vision?:boolean } = {}):this {
		if ('pick' in source) {
			this._systemOnes.set(name, source);
		}
		else {
			this._models.addInference(name, 'kind' in source ? source : { kind: 'custom', provider: source, vision });
		}
		return this;
	}

	/**
	 * Drops server `name`, whichever `add*Inference` added it, and every model on it. Runners assigned a System One
	 * that went have none until it is added again; the default too.
	 */
	public removeInference(name:string):void {
		this._models.removeInference(name);
		for (const [other, systemOne] of this._systemOnes) {
			if (systemOne instanceof ModelSystemOne ? !this._models.has(other) : other === name) {
				this._systemOnes.delete(other);
			}
		}
	}

	/**
	 * A chat model under `name`, before or after `start()`; the same name again replaces it. A mind thinks with the
	 * one its settings' `model` names, else the default: the first added, unless `setDefaultModel` says otherwise.
	 * With none added, `start()` adds the first server's own pick, named after that server. A `decision` model is
	 * also System One `name`: it answers `choose` with one choice's name, never thinks aloud unless `thinking` says
	 * so, and is never the minds' default.
	 */
	public addModel(name:string, spec:ModelSpec = {}):this {
		this._models.addModel(name, spec);
		if (spec.decision) {
			this._systemOnes.set(name, this.modelSystemOne(name));
		}
		else {
			this.removeModelSystemOne(name);
		}
		return this;
	}

	/** Minds assigned `name` think with the default until it is added again; a decision model's System One goes too. */
	public removeModel(name:string):void {
		this._models.removeModel(name);
		this.removeModelSystemOne(name);
	}

	public setDefaultModel(name:string):void {
		this._models.setDefault(name);
	}

	/** The server's id for model `name`, or the default's; `''` until its server answered. */
	public modelID(name?:string):string {
		return this._models.live(name)?.id ?? '';
	}

	/** The one model every memory is embedded with, so recall compares like with like whatever a mind thinks with. */
	public withEmbeddings(spec:EmbeddingSpec):this {
		this.assertBuilder();
		this._models.setEmbeddings(spec);
		return this;
	}

	/** TypeSafe's Jev, as System One `name` (default `jev`). Default endpoint `/systemone`: a page proxy that adds the key. */
	public addJevInference({ name = 'jev', ...opts }:Partial<JevOpts> & { name?:string } = {}):this {
		return this.addInference(name, new JevSystemOne(opts));
	}

	/**
	 * The System One of every runner without one of its own, any time; `null` for none. Without one, `choose` is
	 * withheld from every kit and standing `choose` characters stay idle.
	 */
	public setDefaultSystemOne(name:string | null):void {
		if (name !== null && !this._systemOnes.has(name)) {
			throw new Error(`ArcDirector: no System One '${name}' (addJevInference / addModel with decision / addInference)`);
		}
		this._defaultSystemOne = name;
	}

	public addSense(name:string, spec:Sense<TCtx>):this {
		this._senses[name] = spec;
		return this;
	}

	public addTool(name:string, spec:ToolSpec<TCtx>):this {
		this._tools[name] = spec;
		return this;
	}

	public withSight({ look, limit, unitName }:{
		look?:(ctx:TCtx)=>Sight;
		limit?:number;
		unitName?:string;
	}):this {
		this.assertBuilder();
		if (limit !== undefined) {
			this._sightLimitDefault = limit;
		}
		if (unitName !== undefined) {
			this._sightUnitName = unitName;
		}
		if (this._senses.sight) {
			this._senses.sight.description = sightDistanceDescription(this._sightUnitName);
		}
		if (!look) return this;
		this._sightLook = look;
		this._senses.sight = {
			description: sightDistanceDescription(this._sightUnitName),
			gather: (ctx) => {
				const snap = this.filterSight(look(ctx));
				return formatSight(snap, this.sightFormatOpts());
			},
		};
		return this;
	}

	public withCooldown(seconds:number):this {
		this.assertBuilder();
		this._cooldownDefault = seconds;
		return this;
	}

	/** How minds write an Arc: `text`, `json` (default), or `schema` (JSON the server must follow). Live: `setArcFormat`. */
	public withArcFormat(format:ArcFormat):this {
		this.assertBuilder();
		this._arcFormat = format;
		return this;
	}

	/**
	 * Standing think line per reasoning state. The prompt follows the live reasoning switch.
	 * Defaults: `on` `DEFAULT_THINK_INSTRUCTIONS`, `off` nothing.
	 */
	public withThinkInstructions(lines:ThinkInstructions):this {
		this.assertBuilder();
		this._thinkInstructions = lines;
		return this;
	}

	/** Standing verb-chain line. Default `DEFAULT_VERB_INSTRUCTIONS`, plus looping programs for a collective; this replaces both. */
	public withVerbInstructions(text:string):this {
		this.assertBuilder();
		this._verbInstructions = text;
		return this;
	}

	/** Arc that closes the prompt as its Example, in place of the stock one. Models copy it, so make it valid. */
	public withArcExample(arc:string):this {
		this.assertBuilder();
		this._arcExample = arc;
		return this;
	}

	/** One sentence in every mind's system prefix, after who it is. */
	public withSystemNote(text:string):this {
		this.assertBuilder();
		this._systemNote = text;
		return this;
	}

	/**
	 * Repair turns after a bad arc. `retries` is how many (default 0: a bad reply fails the think).
	 * `temperature` applies from the second repair on, so a model stuck on one reply moves (default 0.4).
	 */
	public withRepair({ retries, temperature }:{ retries?:number; temperature?:number }):this {
		this.assertBuilder();
		this._arcRetries = retries;
		this._repairTemperature = temperature;
		return this;
	}

	/** Tool rounds a think may spend before it must emit the Arc. Default `DEFAULT_TOOL_ROUNDS`; 0 offers no tools. */
	public withToolRounds(rounds:number):this {
		this.assertBuilder();
		this._toolRounds = rounds;
		return this;
	}

	/** Whether a finished arc stalled, which stretches the heartbeat. Default: it failed or was interrupted. */
	public withStalled(fn:(result:ArcResult)=>boolean):this {
		this.assertBuilder();
		this._stalledFn = fn;
		return this;
	}

	/**
	 * How each mind names other characters. `seen` returns a base name from what the mind holds about
	 * the target; its owner's book keeps that name stable and numbers duplicates (`EnemyWitch2`).
	 * Applied to sight, earshot, heard speech, watch-language entities, and event `who`. Arcs, laws and
	 * watches are kept in ids: each mind turns its model's names into ids as it reads a reply.
	 */
	public withNames({ seen }:{ seen:SeenName<TCtx> }):this {
		this.assertBuilder();
		this._seenFn = seen;
		return this;
	}

	/** What the mind of character or collective `observerID` calls a character, for host-built text such as a sight `note`. */
	public seen(observerID:string, target:NameTarget):string {
		return (this.character(observerID) ?? this.collective(observerID))?.mind?.seen(target) ?? target.id;
	}

	/**
	 * `expr` (watch syntax) as character `id` sees the world now, for host tools such as a camera that follows
	 * `others.filter(u => doing(u, "cleave"))`. Every character in `others` carries its `busy` and `verb`.
	 */
	public evaluate(id:string, expr:string):EvalResult {
		const runner = this.character(id);
		const ctx = runner?.context();
		if (!runner || ctx === undefined || !this._kernelFn) {
			return { value: ABSENT, error: new ExprError(`${id} has no view of the world`) };
		}
		const kernels = this.kernelsFor(runner, ctx);
		const others = kernels.others.map((e) => {
			const other = this.character(e.id);
			return other ? { ...e, fields: { ...e.fields, ...memberEntity(other, '').fields } } : e;
		});
		return evaluate(expr, buildCatalog({ ...kernels, others }));
	}

	public withInventory(look:(ctx:TCtx)=>Inventory):this {
		this.assertBuilder();
		this._senses.carrying = {
			description: 'What you wear and carry.',
			gather: (ctx) => formatInventory(look(ctx)),
		};
		return this;
	}

	/**
	 * The game's world: where things are, how characters move, and how items, uses, looks, and trades work.
	 * Runs the stock world verbs (`go_to`, `pick_up`, `offer`, …) and the watch geometry. `TEntity` is the
	 * game's own type for things in its world; every part but `find` receives one. See `HostWorld`.
	 */
	public withWorld<TEntity>(world:HostWorld<TEntity>):this {
		this.assertBuilder();
		this._world = world;
		return this;
	}

	public removeSense(...names:string[]):this {
		for (const name of names) {
			delete this._senses[name];
		}
		return this;
	}

	public removeTool(...names:string[]):this {
		for (const name of names) {
			delete this._tools[name];
		}
		return this;
	}

	public withContext(fn:(id:string)=>TCtx | undefined):this {
		this.assertBuilder();
		this._contextFn = fn;
		return this;
	}

	public withKernels(fn:KernelSource<TCtx>):this {
		this.assertBuilder();
		this._kernelFn = fn;
		return this;
	}

	/** Used when a character or collective spec omits `kit`, a collective's characters too. */
	public withDefaultKit(kit:KitSource<TCtx>):this {
		this.assertBuilder();
		this._defaultKit = kit;
		return this;
	}

	public withTalk(
		senseOrTalk:TalkSense | TalkNet,
		onSpoke?:(utterance:SpeechUtterance)=>void,
		config?:Partial<TalkConfig>,
	):this {
		this.assertBuilder();
		if (senseOrTalk instanceof TalkNet) {
			this.talk = senseOrTalk;
			this._talkSense = undefined;
			this._onSpoke = undefined;
			this._talkConfig = undefined;
			return this;
		}
		this._talkSense = senseOrTalk;
		this._onSpoke = onSpoke;
		this._talkConfig = config;
		return this;
	}

	public withMap(sense:MapSense):this {
		this.assertBuilder();
		this._map = sense;
		return this;
	}

	/**
	 * What minds know of the world: articles `recall` searches beside memory, and brings up unasked when a name is said
	 * or heard. `mentions`: most articles shown per think that way (default `DEFAULT_MENTION_CAP`; 0 shows none).
	 */
	public withKnowledge(pages:KnowledgeSource<TCtx>, { mentions }:{ mentions?:number } = {}):this {
		this.assertBuilder();
		this._knowledge = pages;
		this._mentionCap = mentions;
		return this;
	}

	public withVerbs(registry:VerbRegistry):this {
		this.assertBuilder();
		this._verbs = registry;
		return this;
	}

	/** Schema-only. Omit `verbs` to register the full stock set. Already-registered names are skipped. */
	public addStockVerbs(...verbs:StockVerb[]):this {
		registerStockVerbs(this._verbs, ...verbs);
		return this;
	}

	/** Schema-only collective verbs (`issue`, `tag`, formations). `when` / `law` / `unlaw` ride on stock arc verbs. Kit still has to grant them. */
	public addStockCollectiveVerbs(...verbs:StockCollectiveVerb[]):this {
		registerStockCollectiveVerbs(this._verbs, ...verbs);
		return this;
	}

	/**
	 * Schema plus optional world function. `help` is the one line shown after the verb in the prompt's
	 * verb list. The handler's `args` are typed from `args`; a stock verb takes only a handler, typed from
	 * its stock args. Same name again binds or replaces the handler.
	 */
	public addVerb<TVerb extends StockVerbName>(name:TVerb, verb:{ help?:string; reply?:boolean; handler:VerbHandler<TCtx, VerbArgs<StockVerbArgs<TVerb>>> }):this;
	public addVerb<const TArgMap extends VerbArgMap = Record<never, never>>(name:string, verb?:{ args?:TArgMap; help?:string; reply?:boolean; handler?:VerbHandler<TCtx, VerbArgs<TArgMap>> }):this;
	public addVerb(name:string, { handler, ...def }:{ args?:VerbArgMap; help?:string; reply?:boolean; handler?:VerbHandler<TCtx, never> } = {}):this {
		if (!this._verbs.has(name)) {
			this._verbs.add(name, def);
		}
		if (handler) {
			// The schema is checked before dispatch, so the args match what this handler was typed with.
			this._handlers.set(name, handler as VerbHandler<TCtx>);
		}
		return this;
	}

	/** Runs before every host verb. Return a result to refuse the step (a downed character, a cutscene); `undefined` lets it run. */
	public withVerbGate(fn:VerbGate<TCtx>):this {
		this._verbGate = fn;
		return this;
	}

	/** Drop catalog schemas and their handlers. */
	public removeVerbs(...names:string[]):this {
		this._verbs.remove(...names);
		for (const name of names) {
			this._handlers.delete(name);
		}
		return this;
	}

	public onVerb(fn:VerbHandler<TCtx>):this {
		this._catchAll = fn;
		return this;
	}

	public onAbortArc(fn:(id:string)=>void):this {
		this._abortArcFn = fn;
		return this;
	}

	/** A collective's commander left or died. Name a new one with `collective.commander = …`. */
	public onCommanderVacant(fn:(collective:Collective<TCtx>, character:Character<TCtx>)=>void):this {
		this._commanderVacantFn = fn;
		return this;
	}

	public onLog(fn:(entry:DirectorLog)=>void):this {
		this._logFn = fn;
		return this;
	}

	/** After a host verb resolves. `say` does not come through here. */
	public onStep(fn:(call:VerbCall<TCtx>, result:ArcResult)=>void):this {
		this._stepFn = fn;
		return this;
	}

	/**
	 * After characters change collectives, one model call fixes the memories of everyone involved: what went
	 * stale in a collective left, and what a character or a collective joined should now remember. Moves
	 * within `ticks` director ticks (default 1) share one call. It takes the next free think slot, never
	 * stops a think, and nothing waits for it. On by default; pass your own `handover`, or `false` to turn it off.
	 */
	public withMemoryHandover({ ticks = 1, handover }:{ ticks?:number; handover?:Handover<TCtx> | false } = {}):this {
		this._handoverTicks = Math.max(1, ticks);
		this._handover = handover;
		return this;
	}

	/** Settings every new mind starts from. A spec's `mind` settings win over them. */
	public withMindDefaults(settings:MindSettings):this {
		this._mindDefaults = { ...settings };
		return this;
	}

	/**
	 * A character on its own: an NPC with `mind` settings, or one the host drives (the Player) without them.
	 * Its id must be new among characters and collectives.
	 */
	public addCharacter(spec:CharacterSpec<TCtx>):this {
		this.claimID(spec.id);
		this._soloSpecs.push(spec);
		this._specs.set(spec.id, spec);
		if (this._ready) {
			this.reportMissingNames([spec]);
			this.wireCharacter(spec);
		}
		return this;
	}

	/** Characters sharing one mind. Its id and its characters' ids must be new. */
	public addCollective(spec:CollectiveSpec<TCtx>):this {
		// Its own list: `removeCharacter` trims it, and the host's spec stays whole for the next director.
		const own = { ...spec, characters: [...(spec.characters ?? [])] };
		this.claimID(own.id);
		for (const character of own.characters) {
			this.claimID(character.id);
			this._specs.set(character.id, character);
		}
		this._collectiveSpecs.push(own);
		if (this._ready) {
			this.reportMissingNames([own, ...own.characters.filter((c) => c.kit)]);
			this.wireCollective(own);
		}
		return this;
	}

	/** Remove a character for good, on its own or from its collective. A commander's leaving tells `onCommanderVacant`. */
	public removeCharacter(id:string):this {
		this._specs.delete(id);
		remove(this._soloSpecs, id);
		for (const spec of this._collectiveSpecs) {
			remove(spec.characters ?? [], id);
		}
		this.dropCharacter(id);
		return this;
	}

	/** Remove a collective. Its characters stay, each on its own: with a fresh mind if their spec gave one settings. */
	public removeCollective(id:string):this {
		const spec = remove(this._collectiveSpecs, id);
		const row = this._collectiveRows.get(id);
		const members = row ? row.runner.characters.map((c) => c.id) : (spec?.characters ?? []).map((c) => c.id);
		for (const member of members) {
			const memberSpec = this._specs.get(member);
			if (memberSpec) {
				this._soloSpecs.push(memberSpec);
			}
		}
		this.dropCollective(id);
		return this;
	}

	/** Cancel an in-flight think by mind id. */
	public abortThink(id:string):this {
		this._queue?.abortThink(id);
		return this;
	}

	public character(id:string):Character<TCtx> | undefined {
		return this._characterRows.get(id)?.runner;
	}

	/** Every character: on its own or in a collective. */
	public characters():Character<TCtx>[] {
		return [...this._characterRows.values()].map((row) => row.runner);
	}

	public collective(id:string):Collective<TCtx> | undefined {
		return this._collectiveRows.get(id)?.runner;
	}

	public collectives():Collective<TCtx>[] {
		return [...this._collectiveRows.values()].map((row) => row.runner);
	}

	/** Every mind that thinks: characters' own, then collectives'. */
	public minds():Mind<TCtx>[] {
		return [
			...this.characters().flatMap((c) => ownMindOf(c) ?? []),
			...this.collectives().map((c) => c.mind),
		];
	}

	public mindQueue():MindQueue | undefined {
		return this._queue;
	}

	public setBatchThinks(on:boolean):void {
		if (this._queue) {
			this._queue.batchThinks = on;
		}
		else if (this._queueSlot.kind === 'instance') {
			this._queueSlot.queue.batchThinks = on;
		}
		else if (this._queueSlot.kind === 'simple') {
			this._queueSlot.opts = { ...this._queueSlot.opts, batchThinks: on };
		}
		else {
			this._queueSlot = { kind: 'priority', opts: { ...(this._queueSlot.kind === 'priority' ? this._queueSlot.opts : {}), batchThinks: on } };
		}
	}

	public liveBatchThinks():boolean {
		return this.thinkBatchPolicy().batchThinks;
	}

	public setArcFormat(format:ArcFormat):void {
		this._arcFormat = format;
		for (const mind of this.minds()) {
			mind.arcFormat = format;
		}
	}

	public get arcFormat():ArcFormat {
		return this._arcFormat;
	}

	/** Minds re-read their model: assigned, added again, removed, or a new default. */
	private syncModels():void {
		for (const mind of this.minds()) {
			this.syncModel(mind);
		}
	}

	private syncModel(mind:Mind<TCtx>):void {
		const live = this._models.live(mind.model);
		mind.provider = live?.provider ?? NO_MODEL;
		mind.modelID = live?.id ?? '';
		mind.vision = live?.vision;
		mind.contextTokens = live?.contextLength;
	}

	public resetInferStats():void {
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

	/** Timing and the AI log around a server. An HTTP one logs its own request bodies. */
	private wrapProvider(inner:InferenceProvider, http:boolean):InferenceProvider {
		const embed = inner.embed?.bind(inner);
		return {
			chat: async (req:ChatRequest):Promise<ChatResponse> => {
				// A System One's pick is logged once, whole, by `pick`, and is not a think.
				if (isPick(req)) {
					return inner.chat(req);
				}
				const name = whoFromMessages(req);
				const t0 = nowMs();
				const signal = req.thread ? this._queue?.thinkSignal(req.thread) : undefined;
				try {
					if (!http) {
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
		if (this._queueSlot.kind === 'instance') {
			return this._queueSlot.queue;
		}
		if (this._queueSlot.kind === 'simple') {
			return new SimpleQueue(this._queueSlot.opts);
		}
		const opts = this._queueSlot.kind === 'priority' ? this._queueSlot.opts : undefined;
		return new ThinkQueue(opts);
	}

	/** A chat model, unless every character acts by a standing `choose` on a System One that needs no chat. */
	private needsChat():boolean {
		return this._systemOnes.size === 0
			|| this._collectiveSpecs.length > 0
			|| this._soloSpecs.some((spec) => spec.mind)
			|| Object.values(this._stored?.characters ?? {}).some((json) => json.mind);
	}

	/** Chat model `name`, or the default, as its server answered it. Throws while there is none. */
	private chatModel(name?:string):LiveModel {
		const model = this._models.live(name);
		if (!model) {
			throw new Error(`ArcDirector: no chat model '${name ?? 'default'}' (addModel)`);
		}
		return model;
	}

	/** Chat model `name` (or the default) as a System One that names one choice. */
	private modelSystemOne(name?:string):ModelSystemOne {
		return new ModelSystemOne(() => this.chatModel(name));
	}

	/** Drops System One `name` when a decision model backed it, so it never falls back to the default chat model. */
	private removeModelSystemOne(name:string):void {
		if (this._systemOnes.get(name) instanceof ModelSystemOne) {
			this._systemOnes.delete(name);
		}
	}

	private async connectInference():Promise<void> {
		if (!this._models.hasServers) {
			if (!this.needsChat()) {
				return;
			}
			throw new Error('ArcDirector: no inference (addLMStudioInference / addOllamaInference / addFakeInference / addInference)');
		}
		try {
			await this._models.start();
		}
		catch (err:unknown) {
			const text = err instanceof Error ? err.message : String(err);
			this.emitLog({ name: 'ArcDirector', message: text });
			throw err instanceof Error ? err : new Error(text);
		}
	}

	public async start(opts?:StartOpts):Promise<this> {
		if (this._disposed) {
			throw new Error('ArcDirector disposed');
		}
		if (this._ready) {
			return this;
		}
		this._ignoreMissing = opts?.ignoreMissing === true;
		this._queue = this.resolveQueue();
		await this.connectInference();
		if (!this.talk && this._talkSense) {
			const sense:TalkSense = this._world?.hasLineOfSight
				? { ...this._talkSense, canSee: (a, b) => this.inLineOfSight(a, b) }
				: this._talkSense;
			this.talk = new TalkNet(sense, this._onSpoke, this._talkConfig);
		}
		this._mover = new Mover(this._world, () => this._clock);
		this.bindWorldVerbs();
		this.reportMissingNames();
		this._handover ??= chatHandover((req) => this.chatModel().provider.chat(req), () => this.chatModel().id);
		this.wireCast(this._stored);
		this._stored = undefined;
		this._ready = true;
		return this;
	}

	private bindWorldVerbs():void {
		if (!this._world) {
			return;
		}
		const handlers = worldVerbs<TCtx>({
			world: this._world,
			mover: this._mover,
			now: () => this._clock,
			seen: (call) => (this._sightLook ? this.filterSight(this._sightLook(call.ctx)).objects.map((o) => o.id) : []),
			nearRadius: (call) => (this._kernelFn ? this.kernelsFor(call.character, call.ctx).nearRadius : undefined),
			offers: () => this.liveOffers(),
			canOffer: (fromID, toID) => this.canOffer(fromID, toID),
			tell: (id, event) => {
				const character = this.character(id);
				const owner = character?.collective ?? (character?.mind ? character : null);
				if (owner) {
					this.talkMindOf(owner).pushEvent(event);
				}
			},
		});
		for (const [verb, handler] of Object.entries(handlers)) {
			if (missingParts(verb, this._world).length === 0) {
				this._stockHandlers.set(verb, handler as VerbHandler<TCtx>);
			}
		}
	}

	/** Whether character `fromID` may make an offer to `toID`: the host's `canOffer`, else in its sight, else in its line of sight, else yes. */
	private canOffer(fromID:string, toID:string):boolean {
		const world = this._world;
		if (world?.canOffer) {
			const from = world.find(fromID);
			const to = world.find(toID);
			return from !== undefined && to !== undefined && world.canOffer(from, to);
		}
		const ctx = this._sightLook ? this.tryCtx(fromID) : undefined;
		if (ctx !== undefined) {
			return this.filterSight(this._sightLook!(ctx)).objects.some((o) => o.id === toID);
		}
		return this.inLineOfSight(fromID, toID);
	}

	/** Whether `fromID` can see `toID`. No `hasLineOfSight` means yes. A missing entity means no. */
	private inLineOfSight(fromID:string, toID:string):boolean {
		const world = this._world;
		if (!world?.hasLineOfSight) {
			return true;
		}
		const from = world.find(fromID);
		const to = world.find(toID);
		return from !== undefined && to !== undefined && world.hasLineOfSight(from, to);
	}

	/** The offer book, without offers to someone their maker may no longer make. */
	private liveOffers():OfferBook {
		this.offers.prune((offer) => offer.to === undefined || this.canOffer(offer.from, offer.to));
		return this.offers;
	}

	/** Every standing offer, and each offer by or to a character `mind` thinks for: only for a mind whose kit trades. */
	private offersSeenBy(mind:Mind<TCtx>):string {
		const owner = mind.owner;
		if (!owner.activeVerbs().has('offer')) {
			return '';
		}
		const mine = new Set(owner instanceof Collective ? owner.characters.map((c) => c.id) : [owner.id]);
		const voice = mind.voice.id;
		const name = (id:string):string => (id === voice ? 'you' : mind.nameOf(id));
		return this.liveOffers().all
			.filter((offer) => offer.to === undefined || mine.has(offer.from) || mine.has(offer.to))
			.map((offer) => {
				const who = offer.from === voice ? 'You offer' : `${name(offer.from)} offers`;
				return offer.to === undefined
					? `- ${who} ${offerText(offer)} to anyone`
					: `- ${who} ${name(offer.to)} ${offerText(offer)}`;
			})
			.join('\n');
	}

	/** `point`: measure as if the character stood there. */
	private kernelsFor(runner:ArcRunner<TCtx>, ctx:TCtx, cache = this.cacheOf(runner), point?:Vec):HostKernels {
		const mind = runner.mind;
		const kernels = this.namedKernels(mind, this._kernelFn!(ctx, point));
		const here = point && this._world && poseOf(this._world, kernels.me.id);
		const geometry = this._world
			? geometryKernels(this._world, kernels.me.id, here ? new Map([[kernels.me.id, { ...here, point }]]) : undefined)
			: {};
		const lastTimestamp = mind?.lastTacticalTimestamp;
		const last = runner.lastResult;
		const ago = lastTimestamp !== undefined && Number.isFinite(lastTimestamp)
			? Math.max(0, this._clock - lastTimestamp)
			: undefined;
		return {
			...kernels,
			...geometry,
			cache,
			...(this._world?.hasLineOfSight ? { canSee: (a, b) => this.inLineOfSight(a.id, b.id) } : {}),
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
		if (!mind || !this._seenFn) {
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
		if (runner.prevMe || !this._kernelFn || !this._contextFn) {
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
			provider: this._models.live(mind.model)?.provider ?? NO_MODEL,
			senses: this.sensesFor(mind, owner),
			tools: this._tools,
			talk: this.talk,
			toolRoundCap: this._toolRounds,
			wayBlocked: (to) => (this._world ? wayBlocked(this._world, mind.thinkThread(), to) : undefined),
			arcRetryCap: this._arcRetries,
			stalled: this._stalledFn,
			autoEnact: true,
			onChoose: (arc) => this.emitLog({ name: mind.thinkThread(), message: formatArc(arc, this._verbs) }),
			queue: this._queue,
			modelID: this._models.live(mind.model)?.id ?? '',
			embed: this._models.embedder(),
			map: this._map,
			knowledge: this._knowledge,
			mentionCap: this._mentionCap,
			offers: () => this.offersSeenBy(mind),
			vision: this._models.live(mind.model)?.vision,
			arcFormat: this._arcFormat,
			thinkInstructions: this._thinkInstructions,
			thinking: () => this._models.live(mind.model)?.thinking ?? false,
			verbInstructions: this._verbInstructions,
			arcExample: this._arcExample,
			systemNote: this._systemNote,
			repairTemperature: this._repairTemperature,
			seenAs: this.seenAs(mind),
			worldContext: () => this.tryCtx(owner.voice.id) ?? (owner instanceof Collective ? this.present(owner)?.ctx : undefined),
		};
	}

	/** The host naming policy as one mind sees it: by its owner's id, from its voice's context. */
	private seenAs(mind:Mind<TCtx>):((target:NameTarget)=>string) | undefined {
		const seen = this._seenFn;
		if (!seen) {
			return undefined;
		}
		return (target) => seen({ id: mind.id, ctx: this.tryCtx(mind.thinkThread()) }, target);
	}

	/** Host look, minus what is out of sight, with everything seen under `mind`'s name for it. */
	private see(mind:Mind<TCtx>, ctx:TCtx):Sight {
		const snap = this.filterSight(this._sightLook!(ctx));
		if (!this._seenFn) {
			return snap;
		}
		return { ...snap, objects: snap.objects.map((o) => ({ ...o, id: mind.seen(o) })) };
	}

	private sensesFor(mind:Mind<TCtx>, owner:ArcRunner<TCtx>):Record<string, Sense<TCtx>> {
		const wrapSight = !!(this._sightLook && this._senses.sight);
		const commanderless = owner instanceof Collective && !!this._contextFn && this.tryCtx(owner.voice.id) === undefined;
		const skipCarrying = !!this._senses.carrying && commanderless;
		if (!wrapSight && !skipCarrying) {
			return this._senses;
		}
		const senses:{ [k:string]:Sense<TCtx> } = { ...this._senses };
		if (wrapSight && this._senses.sight) {
			senses.sight = {
				description: this._senses.sight.description,
				gather: (ctx) => this.gatherSight(mind, ctx),
			};
		}
		if (skipCarrying) {
			delete senses.carrying;
		}
		return senses;
	}

	private filterSight(snap:Sight):Sight {
		if (!this._world?.hasLineOfSight) {
			return snap;
		}
		return { ...snap, objects: snap.objects.filter((o) => this.inLineOfSight(snap.self.id, o.id)) };
	}

	private sightFormatOpts():{ unitName?:string } {
		return this._sightUnitName ? { unitName: this._sightUnitName } : {};
	}

	/** What `mind`'s voice sees; for a collective with no commander, what all its characters see, pooled. */
	private gatherSight(mind:Mind<TCtx>, ctx:TCtx):string {
		if (!this._sightLook) {
			return '';
		}
		const focus = mind.persona.effectiveSightFocus();
		const limit = mind.persona.sightLimit ?? this._sightLimitDefault;
		const scores = new Map<string, number>();
		const owner = mind.owner;
		if (owner instanceof Collective && owner.characters.length > 0 && this._contextFn && !this.tryCtx(mind.thinkThread())) {
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
			return this.shown(mind, orderSightClauses(merged, scores, limit, focus.length > 0));
		}
		const snap = this.see(mind, ctx);
		const clauses = formatSightClauses(snap, this.sightFormatOpts());
		if (focus.length > 0) {
			this.scoreSightObjects(snap.objects, focus, ctx, mind.voice, scores);
		}
		return this.shown(mind, orderSightClauses(clauses, scores, limit, focus.length > 0));
	}

	/** The sight text `mind` is shown; it remembers each name in it as last seen there. */
	private shown(mind:Mind<TCtx>, clauses:SightClause[]):string {
		mindFields(mind).sighted(clauses);
		return joinSightClauses(clauses);
	}

	private scoreSightObjects(
		objects:SeenObject[],
		exprs:string[],
		ctx:TCtx,
		runner:ArcRunner<TCtx>,
		into:Map<string, number>,
	):void {
		if (!this._kernelFn) {
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
		if ((STOCK_COLLECTIVE_VERBS as readonly string[]).includes(step.verb) && !isFormationVerb(step.verb)) {
			const collective = collectiveOf(runner);
			return collective
				? this.handleCollectiveVerb(collective, runner, step, liveCtx)
				: { ok: false, verb: step.verb, reason: `${step.verb} needs a collective` };
		}
		if (!(runner instanceof Character)) {
			// No body to hand a host: only the director's own clock runs for it.
			return step.verb === 'wait'
				? this.stockWait(runner.id, step.args, () => watchFit(String(step.args.until), runner.catalog?.()) > 0)
				: bodiless(step.verb);
		}
		const handler = this._handlers.get(step.verb)
			?? this._stockHandlers.get(step.verb)
			?? (step.verb === 'wait' ? this._waitVerb : this._catchAll);
		if (!handler) {
			return { ok: false, verb: step.verb, reason: `unhandled ${step.verb}` };
		}
		if (liveCtx === undefined) {
			return { ok: false, verb: step.verb, reason: 'not in this scene' };
		}
		const call = this.verbCall(runner, step, liveCtx);
		if (!('character' in call)) {
			return call;
		}
		const out = this._verbGate?.(call) ?? handler(call);
		const fn = this._stepFn;
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
	):VerbCall<TCtx> | ArcResult {
		const fail = (reason:string):ArcResult => ({ ok: false, verb: step.verb, reason });
		const catalogAt = (point?:Vec):Catalog | undefined => this.exprCatalog(character, ctx, point ? new SampleCache() : this.cacheOf(character), point);
		const kinds = this._verbs.get(step.verb)?.args ?? {};
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
			return typeof expr === 'string' && expr.trim() ? watchFit(expr, catalogAt(point)) : 0;
		};
		return {
			verb: step.verb,
			args,
			character,
			ctx,
			score,
			holds: (arg, point) => score(arg, point) > 0,
			goTo: (target, within) => this.goTo(character.id, step.verb, { target }, within),
			goToPoint: (point, within) => this.goTo(character.id, step.verb, { point }, within),
			wait: (seconds) => this.waitFor(character.id, seconds, step.verb),
		};
	}

	/** Move `characterID`, or, in a world where characters do not move, succeed only when already in reach. */
	private goTo(characterID:string, verb:string, dest:{ target:string } | { point:Vec }, within?:number):Promise<ArcResult> {
		if (this._mover.canMove) {
			return this._mover.go(characterID, dest, verb, { within });
		}
		const world = this._world;
		const character = world?.find(characterID);
		const target = 'target' in dest ? world?.find(dest.target) : undefined;
		const point = 'target' in dest ? (target === undefined ? undefined : world?.getPose(target)?.point) : dest.point;
		const me = character === undefined ? undefined : world?.getPose(character)?.point;
		const near = within ?? (character !== undefined && target !== undefined ? world?.getReach?.(character, target) : undefined) ?? 1;
		const ok = !me || !point || distance(me, point) <= near;
		return Promise.resolve(ok ? { ok: true, verb } : { ok: false, verb, reason: 'out of reach' });
	}

	private waitFor(runnerID:string, seconds:number, verb:string, met?:()=>boolean):Promise<ArcResult> {
		return new Promise((done) => {
			this._waits.add({ runnerID, verb, end: this._clock + seconds, seconds, met, done });
		});
	}

	/** The watch-language view `runner` has from `ctx`: its mind's names, and in a collective `units` / `allUnits`. */
	private exprCatalog(runner:ArcRunner<TCtx>, ctx:TCtx, cache:SampleCache, point?:Vec):Catalog | undefined {
		if (!this._kernelFn) {
			return undefined;
		}
		const kernels = this.kernelsFor(runner, ctx, cache, point);
		const collective = collectiveOf(runner);
		return collective ? buildCollectiveCatalog(kernels, collective) : buildCatalog(kernels);
	}

	/** Stock `wait` for a character. A host `wait` handler replaces it. */
	private readonly _waitVerb:VerbHandler<TCtx> = (call) => this.stockWait(call.character.id, call.args, () => call.holds('until'));

	/**
	 * Game time passes for runner `id` until `seconds`, until `until` holds, or until someone named by `reply`
	 * finishes a non-movement verb. `reply` is how a mind waits out an answer; it is not a model arg.
	 */
	private stockWait(id:string, args:Record<string, unknown>, until:()=>boolean):Promise<ArcResult> {
		const watching = typeof args.until === 'string' && args.until.trim() !== '';
		const replyTo = replyTargets(args.reply);
		const seen = new Map(replyTo.map((who) => [who, this.character(who)?.replies ?? 0]));
		const seconds = typeof args.seconds === 'number' ? args.seconds : watching || replyTo.length > 0 ? 20 : 1;
		const met = ():boolean => (watching && until()) || replyTo.some((who) => (this.character(who)?.replies ?? 0) !== seen.get(who));
		return this.waitFor(id, seconds, 'wait', watching || replyTo.length > 0 ? met : undefined);
	}

	private tickWaits():void {
		for (const wait of this._waits) {
			const met = wait.met?.() ?? false;
			if (met || this._clock >= wait.end) {
				this._waits.delete(wait);
				wait.done({ ok: true, verb: wait.verb, reason: met ? 'until' : `${wait.seconds}s` });
			}
		}
	}

	/** Stop whatever character `id` is doing now: its waits and moves here, the rest through `onAbortArc`. */
	public abortArc(id:string):void {
		for (const wait of this._waits) {
			if (wait.runnerID === id) {
				this._waits.delete(wait);
				wait.done({ ok: false, interrupted: true, verb: wait.verb });
			}
		}
		this._mover.stop(id);
		this._abortArcFn?.(id);
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
		const arc = arcArg(step.args.arc, this._verbs);
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
		const arc = arcArg(step.args.arc, this._verbs);
		if (!who || !arc) {
			return { ok: false, verb: 'issue', reason: 'issue needs who and arc' };
		}
		const cat = this.collectiveCatalog(collective, issuer, ctx);
		const named = cat ? evaluateWho(who, cat, collective) : [];
		const troops = named.filter((c) => c !== collective.commander);
		if (named.length > 0 && troops.length === 0) {
			return { ok: false, verb: 'issue', reason: 'issue never lands on the commander' };
		}
		collective.issue(troops, arc);
		return { ok: true, verb: 'issue' };
	}

	private tryCtx(id:string):TCtx | undefined {
		if (!this._contextFn) {
			return undefined;
		}
		try {
			return this._contextFn(id);
		}
		catch {
			return undefined;
		}
	}

	/** `collective`'s first character in this scene, with its context: where a collective with no commander looks from. */
	private present(collective:Collective<TCtx>):{ character:Character<TCtx>; ctx:TCtx } | undefined {
		for (const character of collective.characters) {
			const ctx = this.tryCtx(character.id);
			if (ctx !== undefined) {
				return { character, ctx };
			}
		}
		return undefined;
	}

	/** The view of a collective with no commander: its first living character's kernels, measured from the middle of them all. */
	private dummyHiveKernels(collective:Collective<TCtx>):HostKernels | undefined {
		const first = this._kernelFn ? this.present(collective) : undefined;
		if (!first) {
			return undefined;
		}
		const sample = this.kernelsFor(first.character, first.ctx);
		const center = centroid(collective.characters.flatMap((character) => {
			const point = this._world && poseOf(this._world, character.id)?.point;
			return point ? [point] : [];
		}));
		const poses = new Map<string, Pose>(center ? [[collective.id, { point: center }]] : []);
		return {
			...sample,
			...(this._world ? geometryKernels(this._world, first.character.id, poses) : {}),
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
		if (!this._kernelFn) {
			return undefined;
		}
		const kernels = ctx ? this.kernelsFor(runner, ctx) : this.dummyHiveKernels(collective);
		return kernels ? buildCollectiveCatalog(kernels, collective) : undefined;
	}

	/** `runner`'s view now: from its voice, or, for a collective with no commander, pooled from its characters. */
	private runnerCatalog(runner:ArcRunner<TCtx>):Catalog | undefined {
		const ctx = runner.context();
		if (ctx !== undefined) {
			return buildCatalog(this.kernelsFor(runner, ctx));
		}
		return runner instanceof Collective ? this.collectiveCatalog(runner, runner, undefined) : undefined;
	}

	/** A spec's kit, else the default one. Something that can run no verb is a mistake, so it throws. */
	private kitFor(spec:{ id:string; kit?:KitSource<TCtx> }):KitSource<TCtx> {
		const kit = spec.kit ?? this._defaultKit;
		if (!kit) {
			throw new Error(`ArcDirector: '${spec.id}' has no kit; give it one, or call withDefaultKit`);
		}
		if (typeof kit !== 'function' && kit.verbs.length === 0) {
			throw new Error(`ArcDirector: '${spec.id}' has a kit with no verbs`);
		}
		return kit;
	}

	private toolKnown(name:string):boolean {
		if (Object.hasOwn(this._tools, name)) {
			return true;
		}
		if (name === 'recall' || name === 'observe') {
			return true;
		}
		if (name === 'earshot' && (this.talk || this._talkSense)) {
			return true;
		}
		if (name === 'see_map' && this._map && this._models.all().some((model) => model.vision)) {
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
		if (!this._contextFn) {
			return { error: `withContext required to resolve kit (${where})` };
		}
		try {
			const ctx = this._contextFn(id);
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
			if (name && !this._verbs.has(name)) {
				out.push(`verb '${name}' is not registered (${where})`);
				continue;
			}
			const missing = this._handlers.has(name) || this._catchAll ? [] : missingParts(name, this._world);
			if (missing.length > 0) {
				out.push(`verb '${name}' needs withWorld ${missing.join(' and ')} (${where})`);
			}
		}
		for (const name of kit.senses ?? []) {
			if (name && !Object.hasOwn(this._senses, name)) {
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
		if (!specs && this._defaultKit && typeof this._defaultKit !== 'function') {
			this.scanKit(this._defaultKit, 'default kit', out);
		}
		const list = specs ?? [
			...this._soloSpecs,
			...this._collectiveSpecs.flatMap((spec) => [spec, ...(spec.characters ?? []).filter((c) => c.kit)]),
		];
		for (const spec of list) {
			const src = spec.kit ?? (typeof this._defaultKit === 'function' || specs ? this._defaultKit : undefined);
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
		if (this._ignoreMissing) {
			this.emitLog({ name: 'ArcDirector', message });
			return;
		}
		throw new Error(message);
	}

	/** Throw when a character or collective already has `id`: they share one namespace. */
	private claimID(id:string):void {
		if (this._specs.has(id) || this._collectiveSpecs.some((spec) => spec.id === id)) {
			throw new Error(`ArcDirector: '${id}' is already a character or a collective`);
		}
	}

	/** A runner's per-tick sample cache. */
	private cacheOf(runner:ArcRunner<TCtx>):SampleCache {
		return (this._characterRows.get(runner.id) ?? this._collectiveRows.get(runner.id))?.cache ?? new SampleCache();
	}

	/** The deps every runner gets: dispatch through this director, its catalog, its kit. `runner` is the one built from them. */
	private runnerDeps(
		spec:{ id:string; laws?:LawSpec[]; maxLaws?:number; cooldown?:number },
		kit:KitSource<TCtx>,
		runner:()=>ArcRunner<TCtx>,
	):RunnerOptions<TCtx> {
		return {
			id: spec.id,
			verbs: this._verbs,
			context: () => this.tryCtx(runner().voice.id),
			execute: async (step, ctx) => this.dispatch(runner(), step, ctx),
			abortArc: (id) => this.abortArc(id),
			cooldown: spec.cooldown ?? this._cooldownDefault,
			talk: this.talk,
			catalog: this._kernelFn ? () => this.runnerCatalog(runner()) : undefined,
			kit,
			laws: spec.laws,
			maxLaws: spec.maxLaws,
		};
	}

	/** Wire a character: alone, or `into` a collective. `json` restores a save. */
	private wireCharacter(spec:CharacterSpec<TCtx>, json?:CharacterJSON, into?:Collective<TCtx>):Character<TCtx> {
		this.checkNames(spec);
		const standing = this.standingChoice(spec);
		const persona = json ? Persona.fromJSON(json.persona, spec) : new Persona(spec);
		persona.sightLimit ??= this._sightLimitDefault;
		const kit = this.kitFor(spec);
		const wiring:Wiring<TCtx> = {
			setMind: (target, mind) => this.setMind(target, mind),
			setCollective: (target, collective) => this.moveCharacter(target, collective),
		};
		const character:Character<TCtx> = new Character<TCtx>({
			...this.runnerDeps(spec, kit, () => character),
			pick: () => this.pickFor(character),
			persona,
			tags: spec.tags,
			mindSettings: spec.mind,
			wiring,
		});
		const fields = filled(wiring.fields);
		this._characterFields.set(character, fields);
		if (standing) {
			this._standing.set(character, standing);
		}
		this._characterRows.set(spec.id, { spec, runner: character, cache: new SampleCache() });
		if (!json) {
			for (const offer of spec.offers ?? []) {
				this.offers.post({ ...offer, from: spec.id });
			}
		}
		if (json) {
			fields.load(json);
			for (const law of spec.laws ?? []) {
				character.addLaw(law, law.pinned);
			}
		}
		if (into) {
			this.fields(into).setCharacters([...into.characters, character]);
			fields.setCollective(into);
			moveLawsInto(character, this.fields(into));
		}
		else if (json?.mind || spec.mind) {
			this.attachMind(character, json?.mind ? Mind.fromJSON(json.mind) : new Mind({ ...this._mindDefaults, ...spec.mind }));
		}
		this.syncListener(character);
		this.stampPrev(character);
		return character;
	}

	/** Wire a collective, its characters, and its mind. `cast` restores a save. */
	private wireCollective(spec:CollectiveSpec<TCtx>, cast?:CastJSON):Collective<TCtx> {
		this.checkNames(spec);
		const json = cast?.collectives[spec.id];
		const persona = json ? Persona.fromJSON(json.persona, spec) : new Persona(spec);
		persona.sightLimit ??= this._sightLimitDefault;
		const mind = json ? Mind.fromJSON<TCtx>(json.mind) : new Mind<TCtx>({ ...this._mindDefaults, ...spec.mind });
		const host:CollectiveHost<TCtx> = {
			addCharacter: (character, into) => {
				this.claimID(character.id);
				this._specs.set(character.id, character);
				this.reportMissingNames(character.kit ? [character] : []);
				return this.wireCharacter(character, undefined, into);
			},
			removeCharacter: (id) => {
				this.removeCharacter(id);
			},
		};
		const collective:Collective<TCtx> = new Collective<TCtx>({
			...this.runnerDeps(spec, this.kitFor(spec), () => collective),
			pick: () => this.pickFor(collective),
			defaultLawWho: 'units',
			persona,
			mind,
			host,
			onCommanderVacant: (character) => this._commanderVacantFn?.(collective, character),
		});
		this._collectiveFields.set(collective, filled(host.fields));
		this._collectiveRows.set(spec.id, { spec, runner: collective, cache: new SampleCache() });
		const ids = json ? json.characters : (spec.characters ?? []).map((c) => c.id);
		for (const id of ids) {
			this.wireCharacter(this._specs.get(id) ?? { id }, cast?.characters[id], collective);
		}
		if (json) {
			this.fields(collective).load(json);
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

	/** What `runner`'s constructor handed this director: its only way into the runner's private fields. */
	private fields(runner:Character<TCtx>):CharacterFields<TCtx>;
	private fields(runner:Collective<TCtx>):CollectiveFields<TCtx>;
	private fields(runner:Character<TCtx> | Collective<TCtx>):CharacterFields<TCtx> | CollectiveFields<TCtx> {
		const fields = runner instanceof Character ? this._characterFields.get(runner) : this._collectiveFields.get(runner);
		return filled(fields);
	}

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
		const from = character.collective;
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
		const from = character.collective;
		if (from === to) {
			return;
		}
		if (to && this._collectiveRows.get(to.id)?.runner !== to) {
			throw new Error(`ArcDirector: '${to.id}' is not a collective here`);
		}
		const { kept, dropped } = from ? this.leave(character, from, to) : { kept: [], dropped: [] };
		if (to) {
			this.join(character, to, kept);
		}
		else if (character.mindSettings) {
			this.attachMind(character, new Mind({ ...this._mindDefaults, ...character.mindSettings }));
		}
		this.syncListener(character);
		this.tellMoved(character, from, to, dropped);
		this.noteJourney(character, from, to);
	}

	/** Queue a move for the next memory handover. A character moving again keeps its first `from`. */
	private noteJourney(character:Character<TCtx>, from:Collective<TCtx> | null, to:Collective<TCtx> | null):void {
		if (this._handover === false) {
			return;
		}
		const was = this._journeys.get(character);
		this._journeys.set(character, { character, from: was ? was.from : from, to });
	}

	/**
	 * The memory handover for the moves so far, once their window has passed: it takes the next free think slot,
	 * ahead of thinks still waiting, so memories are fixed before the minds involved think again if it can be.
	 */
	private tickHandover():void {
		if (this._journeys.size === 0) {
			return;
		}
		this._journeyTicks += 1;
		const queue = this._queue;
		const model = this._models.live();
		const full = !!queue && !!model && this.thinkingOn(model.name) >= model.maxParallel;
		if (this._journeyTicks < this._handoverTicks || this._handoverBusy || full || !this._handover) {
			return;
		}
		const journeys = [...this._journeys.values()].filter((j) => j.from !== j.to && hasIdentity(j.character));
		this._journeys.clear();
		this._journeyTicks = 0;
		if (journeys.length === 0) {
			return;
		}
		this._handoverBusy = true;
		void this._handover(journeys)
			.then((edits) => this.applyMemoryEdits(edits))
			.catch((err:unknown) => {
				const text = err instanceof Error ? err.message : String(err);
				this.emitLog({ name: HANDOVER_THREAD, message: `failed: ${text}`, error: true });
			})
			.finally(() => {
				this._handoverBusy = false;
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
					this.embedLater(memory.add({ category: 'semantic', text: line, tags: nameTags(line), timestamp: this._clock }, this._clock));
				}
			}
		}
	}

	/** Embed a memory written outside a think, without waiting for it. */
	private embedLater(record:MemoryRecord):void {
		void this._models.embedder()?.([record.text])
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
		this.fields(from).setCharacters(from.characters.filter((c) => c !== character));
		this.fields(character).setCollective(null);
		character.tags = character.tags.filter((t) => !from.ownsTag(t));
		const own = from.laws.filter((law) => lawGroup(law.name) === character.id);
		from.laws = from.laws.filter((law) => !own.includes(law));
		this.fields(from).vacate(character);
		if (to) {
			return { kept: own, dropped: [] };
		}
		const dropped = own.filter((law) => usesCollective(law, this._verbs));
		for (const law of own.filter((l) => !dropped.includes(l))) {
			law.name = law.name.slice(character.id.length + 1);
			this.fields(character).keepLaw(law);
		}
		return { kept: [], dropped };
	}

	/** Put `character` in `to`: its own mind goes (its settings are kept), and its laws move in as its own there. */
	private join(character:Character<TCtx>, to:Collective<TCtx>, carried:Law[]):void {
		const own = ownMindOf(character);
		if (own) {
			character.mindSettings = own.settings();
		}
		this.dropOwnMind(character);
		this.fields(to).setCharacters([...to.characters, character]);
		this.fields(character).setCollective(to);
		moveLawsInto(character, this.fields(to));
		for (const law of carried) {
			this.fields(to).keepLaw(law);
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
			this._queue?.enqueueMajor(mind.id, true);
		};
		if (from) {
			// The name it went by there: once gone, the policy may call it something else (an enemy, say).
			const name = from.mind.nameOf(character.id);
			tell(from.mind, { kind: 'Left', text: `${name} left`, tags: [name], major: true });
		}
		if (to) {
			tell(to.mind, { kind: 'Joined', text: '{0} joined', who: [character.id], major: true });
		}
		const own = ownMindOf(character);
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
		const own = ownMindOf(character);
		if (own) {
			this.detachMind(own);
			this.fields(character).setMind(null);
		}
	}

	/** Let `mind` think for `owner`: wire it, and give it a place in the think queue. */
	private attachMind(owner:Character<TCtx> | Collective<TCtx>, mind:Mind<TCtx>):void {
		if (owner instanceof Character) {
			this.fields(owner).setMind(mind);
		}
		mindFields(mind).attach(owner, this.mindDeps(mind, owner));
		mind.stamp(this._clock);
		this._queue?.ensure(mind.id, { skipHeartbeat: mind.skipHeartbeat, skipMajor: mind.skipMajor, skipStart: mind.skipStart });
		this._queue?.setWatches(mind.id, mind.persona.effectiveWatches());
		this._queue?.setAiOn(mind.id, true);
	}

	/** Stop `mind` thinking: its think in flight, and its place in the queue. It thinks for no one after. */
	private detachMind(mind:Mind<TCtx>):void {
		mind.abortThink();
		this._queue?.setAiOn(mind.id, false);
		this._queue?.drop(mind.id);
		let i = this._readyThink.length;
		while (i--) {
			if (this._readyThink[i].mindID === mind.id) {
				this._readyThink.splice(i, 1);
			}
		}
		mindFields(mind).detach();
	}

	/** The listener for `owner`'s mind: one per character with a mind of its own, and one per collective. */
	private talkMindOf(owner:Character<TCtx> | Collective<TCtx>):TalkMind {
		let listener = this._talkMinds.get(owner);
		if (!listener) {
			listener = {
				id: owner.id,
				nameOf: (id) => owner.mind?.nameOf(id) ?? id,
				voice: () => owner.voice.id,
				pushEvent: (event) => {
					const mind = owner.mind;
					if (!mind) {
						return;
					}
					mind.pushEvent(event);
					if (event.major) {
						this._queue?.enqueueMajor(mind.id, true);
					}
				},
			};
			this._talkMinds.set(owner, listener);
		}
		return listener;
	}

	/** Speech said to a collective by name reaches its mind; what its characters hear does too (`syncListener`). */
	private listen(collective:Collective<TCtx>):void {
		this.talk?.attach(this.talkMindOf(collective));
	}

	/** A character hears for the mind that thinks for it: its own, or its collective's. The host's hears nothing. */
	private syncListener(character:Character<TCtx>):void {
		const owner = character.collective ?? (character.mind ? character : null);
		if (owner) {
			this.talk?.attach(this.talkMindOf(owner), character.id);
		}
		else {
			this.talk?.detach(character.id);
		}
	}

	/** Take a character off the director: its arc, moves, talk, its own mind, and its place in a collective. */
	private dropCharacter(id:string):void {
		const row = this._characterRows.get(id);
		if (!row) {
			return;
		}
		const character = row.runner;
		this._characterRows.delete(id);
		character.replaceProgram();
		this._mover.stop(id);
		this.talk?.detach(id);
		this.offers.drop(id);
		this.dropOwnMind(character);
		if (character.collective) {
			this.leave(character, character.collective);
		}
	}

	/** Take a collective off the director. Its characters stay, each on its own: a fresh mind if it had settings for one. */
	private dropCollective(id:string):void {
		const row = this._collectiveRows.get(id);
		if (!row) {
			return;
		}
		const collective = row.runner;
		for (const character of [...collective.characters]) {
			this.moveCharacter(character, null);
		}
		this._collectiveRows.delete(id);
		collective.replaceProgram();
		this.talk?.detach(id);
		this.detachMind(collective.mind);
	}

	/** Every character and collective, as a save. Restore it with `restoreCast`. */
	public exportCast():CastJSON {
		const characters:Record<string, CharacterJSON> = {};
		for (const row of this._characterRows.values()) {
			characters[row.runner.id] = row.runner.toJSON();
		}
		const collectives:Record<string, CollectiveJSON> = {};
		for (const row of this._collectiveRows.values()) {
			collectives[row.runner.id] = row.runner.toJSON();
		}
		return { characters, collectives, offers: this.offers.toJSON() };
	}

	/**
	 * Rebuild the cast from `exportCast`, under the specs added here. Before `start()` it is kept, and `start()`
	 * builds from it. A collective's characters come from the save, so ones that joined or died stay that way.
	 */
	public restoreCast(cast:CastJSON):void {
		if (!this._ready) {
			this._stored = cast;
			return;
		}
		this.clearCast();
		this.wireCast(cast);
	}

	/** Drop every character and collective quietly: no events, no new commanders, no fresh minds. */
	private clearCast():void {
		for (const { runner } of this._characterRows.values()) {
			runner.replaceProgram();
			this._mover.stop(runner.id);
			this.talk?.detach(runner.id);
			this.dropOwnMind(runner);
			this.fields(runner).setCollective(null);
		}
		for (const { runner } of this._collectiveRows.values()) {
			runner.replaceProgram();
			this.talk?.detach(runner.id);
			this.detachMind(runner.mind);
			this.fields(runner).setCharacters([]);
		}
		this._characterRows.clear();
		this._collectiveRows.clear();
		this._journeys.clear();
		this.offers.clear();
	}

	/**
	 * Build every character and collective from the specs added here, or from `cast` under them: then the save
	 * says who belongs to which collective, and who is on their own.
	 */
	private wireCast(cast?:CastJSON):void {
		if (cast) {
			this.offers.load(cast.offers ?? []);
		}
		const members = new Set(Object.values(cast?.collectives ?? {}).flatMap((c) => c.characters));
		const solo = new Set(this._soloSpecs.map((spec) => spec.id));
		for (const id of Object.keys(cast?.characters ?? {})) {
			if (!members.has(id) && !solo.has(id) && this._specs.has(id)) {
				solo.add(id);
			}
		}
		for (const id of solo) {
			if (!members.has(id)) {
				this.wireCharacter(this._specs.get(id)!, cast?.characters[id]);
			}
		}
		for (const spec of this._collectiveSpecs) {
			this.wireCollective(spec, cast);
		}
	}

	/** Tell every mind once. */
	public pushEvent(event:MindEvent):void {
		for (const mind of this.minds()) {
			mind.pushEvent(event);
			if (event.major) {
				this._queue?.enqueueMajor(mind.id, true);
			}
		}
	}

	public tick(dt:number, now:number):void {
		if (!this._ready || this._disposed || !this._queue) {
			return;
		}
		this._clock = now;
		const rows = [...this._characterRows.values(), ...this._collectiveRows.values()];
		for (const row of rows) {
			row.runner.stamp(now);
			row.runner.refreshKit();
		}
		const minds = this.minds();
		// A host may reassign `mind.model` any time.
		for (const mind of minds) {
			this.syncModel(mind);
		}
		const catalogs = new Map<string, Catalog | Catalog[]>();
		for (const mind of minds) {
			mind.stamp(now);
			if (!this._kernelFn || !this._contextFn) {
				continue;
			}
			try {
				catalogs.set(mind.id, this.catalogsFor(mind));
			}
			catch {
				continue;
			}
		}
		const ready = this._queue.tick(dt, catalogs);
		this._readyThink.push(...ready);
		this.tickWaits();
		this._mover.tick();
		this.talk?.tick(now);
		for (const row of rows) {
			row.cache.commit();
		}
		for (const row of this._characterRows.values()) {
			if (!row.runner.collective) {
				this.tickLaws(row.runner);
			}
			this.tickStanding(row.runner);
		}
		for (const row of this._collectiveRows.values()) {
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

	/**
	 * `spec.choose` as `loop(choose(goal, …choices), until)`, checked now so a typo throws at `start()`, not
	 * mid-game. Its choices may use any registered verb.
	 */
	private standingChoice(spec:CharacterSpec<TCtx>):Standing | undefined {
		if (!spec.choose) {
			return undefined;
		}
		if (spec.mind) {
			throw new Error(`ArcDirector: '${spec.id}' has both choose and mind; give it one`);
		}
		const { goal, until, ...choices } = spec.choose;
		try {
			const args:Record<string, StepArg> = { goal };
			for (const [name, text] of Object.entries(choices)) {
				if (text !== undefined) {
					args[name] = parseArcText(text, this._verbs);
				}
			}
			const arc:Arc = [{ verb: 'loop', args: { arc: [{ verb: CHOOSE_VERB, args }], ...(until ? { until } : {}) } }];
			validateArc(arc, this._verbs);
			if (until) {
				parse(until);
			}
			return { arc, until, restUntil: 0 };
		}
		catch (err) {
			throw new Error(`ArcDirector: '${spec.id}' choose: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	/** Start a character's standing `choose` while it is idle, System One is on, and its `until` does not hold. */
	private tickStanding(character:Character<TCtx>):void {
		const standing = this._standing.get(character);
		if (!standing || character.arcSession || this._clock < standing.restUntil || !this.pickFor(character)) {
			return;
		}
		const catalog = standing.until ? character.catalog?.() : undefined;
		if (standing.until && catalog && watchIsTrue(standing.until, catalog)) {
			return;
		}
		void character.enact(standing.arc).then((result) => {
			// A dead endpoint or a bad pick rests like a handler would, instead of asking again every tick.
			if (!result.ok && !result.preempted) {
				standing.restUntil = this._clock + character.cooldown;
			}
		}, (err:unknown) => {
			standing.restUntil = this._clock + character.cooldown;
			this.emitLog({ name: character.id, message: `choose: ${err instanceof Error ? err.message : String(err)}`, error: true });
		});
	}

	/**
	 * The name of a runner's System One: the one its spec names, else its collective's, else the default. A spec's
	 * `null` means none there, whatever the default is.
	 */
	private systemOneOf(runner:ArcRunner<TCtx>):string | null {
		const specs = [
			(this._characterRows.get(runner.id) ?? this._collectiveRows.get(runner.id))?.spec,
			runner instanceof Character && runner.collective ? this._collectiveRows.get(runner.collective.id)?.spec : undefined,
		];
		const assigned = specs.find((spec) => spec?.systemOne !== undefined)?.systemOne;
		const name = assigned === undefined ? this._defaultSystemOne : assigned;
		return name && this._systemOnes.has(name) ? name : null;
	}

	/** A spec naming a System One or a chat model this director lacks is a typo; caught when it is wired. */
	private checkNames(spec:{ id:string; systemOne?:string | null; mind?:MindSettings }):void {
		if (spec.systemOne && !this._systemOnes.has(spec.systemOne)) {
			throw new Error(`ArcDirector: '${spec.id}' names System One '${spec.systemOne}', which was never added`);
		}
		if (spec.mind?.model !== undefined && !this._models.has(spec.mind.model)) {
			throw new Error(`ArcDirector: '${spec.id}' names model '${spec.mind.model}', which was never added`);
		}
	}

	/** This runner's pick while it has a System One. */
	private pickFor(runner:ArcRunner<TCtx>):ArcPick | undefined {
		if (!this.systemOneOf(runner)) {
			return undefined;
		}
		let pick = this._picks.get(runner);
		if (!pick) {
			pick = (goal, choices, last) => this.pick(runner, goal, choices, last);
			this._picks.set(runner, pick);
		}
		return pick;
	}

	/**
	 * Ask which of `choices` serves `goal` now, worded by {@link choicePrompt}. A lone choice left is taken unasked;
	 * with none left the pick fails unasked. The runner's own System One answers first; when it fails or names no
	 * choice, every other System One in turn, then the runner's chat model. One that failed rests a while. Every pick
	 * is logged with who answered.
	 */
	private async pick(runner:ArcRunner<TCtx>, goal:string, choices:Record<string, Arc>, last:LastChoice | undefined):Promise<string> {
		const own = this.systemOneOf(runner);
		if (!own) {
			throw new Error('System One is off');
		}
		const prompt = choicePrompt({ id: runner.id, verb: runner.verb, last, catalog: runner.catalog?.(), choices, verbs: this._verbs });
		if (!prompt) {
			throw new Error('no choice can run now');
		}
		const { state, criteria } = prompt;
		const shown = Object.keys(criteria);
		const now = nowMs();
		if (shown.length === 1) {
			this.logPick(runner, goal, `${shown[0]}, the only one that can run`, now, [], state, criteria);
			runner.record.picked(shown[0]);
			return shown[0];
		}
		const asked = [own, ...[...this._systemOnes.keys()].filter((name) => name !== own && (this._systemOneRest.get(name) ?? 0) <= now)]
			.map((name):[string, SystemOne] => [name, this._systemOnes.get(name)!]);
		const chat = this._models.live(runner.mind?.model);
		if (chat) {
			asked.push([chat.name, this.modelSystemOne(chat.name)]);
		}
		const misses:string[] = [];
		for (const [by, systemOne] of asked) {
			try {
				const name = await systemOne.pick(state, goal, criteria);
				if (Object.hasOwn(criteria, name)) {
					this.logPick(runner, goal, `${name} by ${by}`, now, misses, state, criteria);
					runner.record.picked(name);
					return name;
				}
				misses.push(`${by} named '${name}'`);
			}
			catch (err) {
				misses.push(`${by}: ${err instanceof Error ? err.message : String(err)}`);
				if (this._systemOnes.has(by)) {
					this._systemOneRest.set(by, nowMs() + SYSTEM_ONE_REST_MS);
				}
			}
		}
		this.logPick(runner, goal, 'nothing', now, misses, state, criteria);
		throw new Error(misses.join('; ') || 'no System One answered');
	}

	private logPick(runner:ArcRunner<TCtx>, goal:string, answer:string, started:number, misses:string[], state:string, criteria:Record<string, string>):void {
		const lines = Object.entries(criteria).map(([key, arc]) => `  ${key}: ${arc}`).join('\n');
		this.emitLog({
			name: runner.id,
			message: `choose ${JSON.stringify(goal)} → ${answer} in ${Math.round(nowMs() - started)}ms`
				+ `${misses.length > 0 ? ` (${misses.join('; ')})` : ''}\n${state}\n${lines}`,
			error: answer === 'nothing',
		});
	}

	/** Laws and the live arc session of a character on its own. */
	private tickLaws(character:Character<TCtx>):void {
		if (character.laws.length === 0 && !character.arcSession) {
			return;
		}
		let catalog = character.arcSession?.catalog;
		if (!catalog && this._kernelFn && this._contextFn) {
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
		const whoKernels = !this._kernelFn
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

	/**
	 * A think is in flight or already queued, so a law must not walk the character out from under it. Not before
	 * the mind's first think ends: laws act from the start, not after the opening think.
	 */
	private thinkWaiting(mindID:string):boolean {
		if (!this._queue?.hasThought(mindID)) {
			return false;
		}
		return this._queue.isThinking(mindID)
			|| this._queue.hasPending(mindID)
			|| this._readyThink.some((row) => row.mindID === mindID);
	}

	/**
	 * Poll `runner`'s live session, or start the first law that holds. A voice waits for its mind's think, except a
	 * party's commander: that think is mostly orders for others, and its own laws (heal, keep back) cannot wait.
	 */
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
			session.now = () => this._clock;
			session.extraHandlers = extras;
			session.abortHost = () => this.abortArc(runner.id);
			pollArcSession(session);
			return;
		}
		const probe = createArcSession({
			catalog,
			now: () => this._clock,
			extraHandlers: extras,
		});
		const first = firstStartable(probe);
		const commander = runner instanceof Character && !!runner.collective;
		const mind = runner.isVoice && !commander ? runner.mind : null;
		if (first && !(mind && this.thinkWaiting(mind.id))) {
			runner.beginLaw(first, {
				catalog,
				now: () => this._clock,
				abortHost: () => this.abortArc(runner.id),
				extraHandlers: extras,
			});
		}
	}

	/** The mind the queue knows as `id`: a character's own, or a collective's. */
	private mindByID(id:string):Mind<TCtx> | undefined {
		return ownMindOf(this._characterRows.get(id)?.runner) ?? this._collectiveRows.get(id)?.runner.mind ?? undefined;
	}

	/** The model a mind thinks with: its own, or the default. `''` before any resolved. */
	private modelOf(mind:Mind<TCtx>):string {
		return this._models.live(mind.model)?.name ?? '';
	}

	/** Thinks running on `model` now, the memory handover counting against the default. */
	private thinkingOn(model:string):number {
		const queue = this._queue;
		const thinks = queue ? this.minds().filter((mind) => queue.isThinking(mind.id) && this.modelOf(mind) === model).length : 0;
		return thinks + (this._handoverBusy && model === this._models.live()?.name ? 1 : 0);
	}

	/** Start ready thinks, best first, as far as each one's model has free slots. */
	private drain(now:number):void {
		const queue = this._queue;
		if (!queue) {
			return;
		}
		this._readyThink.sort((a, b) => {
			const score = queue.rankScore(b.mindID, b.score) - queue.rankScore(a.mindID, a.score);
			if (score !== 0) {
				return score;
			}
			return (this.mindByID(b.mindID)?.rank ?? 0) - (this.mindByID(a.mindID)?.rank ?? 0);
		});
		const open = new Map<string, number>();
		const held:ThinkRow[] = [];
		for (const row of this._readyThink) {
			const mind = this.mindByID(row.mindID);
			if (!mind) {
				continue;
			}
			const model = this.modelOf(mind);
			const slots = open.get(model) ?? this.thinkSlots(model, now);
			if (slots <= 0 || queue.isThinking(row.mindID) || !queue.allowThink(row)) {
				open.set(model, slots);
				held.push(row);
				continue;
			}
			queue.drop(row.mindID);
			this.fireThink(mind, now);
			open.set(model, slots - 1);
		}
		this._readyThink.length = 0;
		this._readyThink.push(...held);
		for (const row of held) {
			const mind = this.mindByID(row.mindID);
			const model = mind ? this.modelOf(mind) : '';
			if (mind && this.thinkingOn(model) > 0 && !this._batchHeld.has(model)) {
				this._batchHeld.set(model, now);
			}
		}
	}

	/**
	 * Free think slots on `model`. With `batchThinks`, new thinks wait while it is generating (a new prompt's
	 * prefill stalls every slot already decoding), up to `batchWait`, then start as one wave.
	 */
	private thinkSlots(model:string, now:number):number {
		const queue = this._queue;
		const live = this._models.live(model);
		if (!queue || !live) {
			return 0;
		}
		const thinking = this.thinkingOn(model);
		if (thinking === 0) {
			this._batchHeld.delete(model);
		}
		const open = live.maxParallel - thinking;
		if (open <= 0) {
			return 0;
		}
		const { batchThinks, batchWait } = this.thinkBatchPolicy();
		if (!batchThinks || thinking === 0) {
			return open;
		}
		if (!Number.isFinite(batchWait) || batchWait <= 0) {
			return 0;
		}
		const since = this._batchHeld.get(model) ?? now;
		this._batchHeld.set(model, since);
		if (now - since < batchWait) {
			return 0;
		}
		this._batchHeld.set(model, now);
		return open;
	}

	private thinkBatchPolicy():{ batchThinks:boolean; batchWait:number } {
		return {
			batchThinks: this._queue?.batchThinks ?? DEFAULT_BATCH_THINKS,
			batchWait: this._queue?.batchWait ?? DEFAULT_BATCH_WAIT,
		};
	}

	private fireThink(mind:Mind<TCtx>, now:number):void {
		void mind.tick(now)
			.then((arc) => {
				if (!mind.attached) {
					return;
				}
				this._queue?.setWatches(mind.id, mind.persona.effectiveWatches());
				if (!arc) {
					this._queue?.noteResult(mind.id, true);
				}
			})
			.catch((err:unknown) => {
				if (!mind.attached) {
					return;
				}
				const text = err instanceof Error ? err.message : String(err);
				this.emitLog({ name: mind.thinkThread(), message: `stalled: ${text}` });
				this._queue?.noteResult(mind.id, true);
				// An invalid reply ends no arc, so nothing would wake this mind: think again once, told why.
				// Aborts and inference errors are not the mind's doing.
				if (err instanceof ArcError) {
					const again = mind.lastResult?.verb !== 'think' || mind.lastResult.ok;
					mind.ingestResult({ ok: false, verb: 'think', reason: `your reply was not a valid Arc: ${text}` });
					if (again) {
						this._queue?.enqueueVerb(mind.id, 'think', false);
					}
				}
			});
	}

	/** Wall-clock loop for laws. Games must not use this — they already have a frame tick. */
	public runLoop(hz:number):()=>void {
		if (!this._ready) {
			throw new Error('ArcDirector: start() before runLoop');
		}
		this.stopLoop();
		const dt = 1 / Math.max(1, hz);
		let now = 0;
		this._loop = setInterval(() => {
			now += dt;
			this.tick(dt, now);
		}, Math.max(1, Math.round(1000 / hz)));
		return () => this.stopLoop();
	}

	private stopLoop():void {
		if (this._loop !== undefined) {
			clearInterval(this._loop);
			this._loop = undefined;
		}
	}

	public dispose():void {
		this.stopLoop();
		this._disposed = true;
		this.clearCast();
		this._ready = false;
	}
}

/** Whether a character has an identity worth a memory handover: a role or traits. */
function hasIdentity<TCtx>(character:Character<TCtx>):boolean {
	const { role, traits } = character.persona.identity;
	return !!role || (traits?.length ?? 0) > 0;
}

/** Remove the spec with `id` from `specs`, and return it. */
/** A System One's pick: only a pick asks for the answer token's log probabilities. */
function isPick(req:ChatRequest):boolean {
	return req.topLogprobs !== undefined;
}

function remove<TSpec extends { id:string }>(specs:TSpec[], id:string):TSpec | undefined {
	const i = specs.findIndex((spec) => spec.id === id);
	return i < 0 ? undefined : specs.splice(i, 1)[0];
}

/**
 * A character's laws, moved onto `collective` as its own: `flee` becomes `Tom.flee`, reaching only Tom. Each law
 * object moves itself, so an arc it started still counts as its own.
 */
function moveLawsInto<TCtx>(character:Character<TCtx>, collective:CollectiveFields<TCtx>):void {
	for (const law of character.laws) {
		law.name = `${character.id}.${law.name}`;
		law.who = 'me';
		collective.keepLaw(law);
	}
	character.laws = [];
}

/** A character's own mind: none while it is in a collective, whose mind it thinks with. */
function ownMindOf<TCtx>(character:Character<TCtx> | undefined):Mind<TCtx> | null {
	return character && !character.collective ? character.mind : null;
}

/** What a constructor filled in for this director. */
function filled<T>(fields:T | undefined):T {
	if (!fields) {
		throw new Error('ArcDirector: not wired to this director');
	}
	return fields;
}

/** The collective `runner` acts in: itself, or the one its character belongs to. */
function collectiveOf<TCtx>(runner:ArcRunner<TCtx>):Collective<TCtx> | null {
	return runner instanceof Collective ? runner : runner instanceof Character ? runner.collective : null;
}
