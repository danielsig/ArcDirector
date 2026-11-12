import { argKind, CHOOSE_VERB, fillHoles, stepDoing, STOCK_TRADE_VERBS, STOCK_VERB_DEFS, STOCK_VERBS, type StockVerb, type VerbArgKind, type VerbArgMap, VerbRegistry } from '../arc/stock-verbs.js';
import { parseArcText } from '../arc/arc-parse.js';
import { formatArc } from '../arc/arc-format.js';
import { withLoneWait } from '../arc/choose.js';
import { arcArg } from '../arc/wire.js';
import { arcSteps, eachStep, firstStep, isCountMap, sameProgram, type Arc, type ArcResult, type Step, type StepArg } from '../arc/arc-types.js';
import { validateArc } from '../arc/validate.js';
import { choicePrompt, type ChoicePrompt } from '../character/choice.js';
import { JevSystemOne, ModelSystemOne, type JevOpts, type SystemOne } from '../inference/system-one.js';
import { ArcError, BlockedArcError } from '../arc/arc-types.js';
import { lawGroup, type Law, type LawSpec } from '../arc/laws.js';
import { bodiless, type ArcRunner, type RunnerOptions } from '../character/arc-runner.js';
import { Character, type CharacterJSON, type Wiring } from '../character/Character.js';
import { Persona } from '../character/Persona.js';
import type { Goal, Kit, KitSource } from '../character/character-types.js';
import type { NameTarget } from '../character/NameBook.js';
import { Collective, type CollectiveFields, type CollectiveHost, type CollectiveJSON } from '../collective/Collective.js';
import { internalsOf } from '../internals.js';
import { Mind, type MindDeps, type MindModel, type MindSettings } from '../mind/mind.js';
import { MindDefaults } from '../mind/MindDefaults.js';
import type { ArcFormat, MindEvent, Replacing, Sense, ThinkEvent, ToolSpec } from '../mind/mind-types.js';
import type { ThinkInstructions } from '../mind/prompt.js';
import { TalkNet, type SpeechUtterance, type TalkConfig, type TalkSense } from '../mind/talk.js';
import type { MapSense } from '../mind/map.js';
import type { KnowledgeSource } from '../mind/knowledge.js';
import { buildCatalog, dummyEntity, type HostKernels } from '../expr/natives.js';
import { freezeMe, type MeFreezeHost } from '../expr/prev.js';
import { catalogEntities, evaluate, unboundCalls, type EvalResult } from '../expr/eval.js';
import { lambdaParams, lex } from '../expr/lex.js';
import { parse } from '../expr/expr-parse.js';
import { watchScore } from '../expr/watch-score.js';
import { ABSENT, ExprError, SampleCache, leftoverFilterHint, type Catalog, type ExprEntity, type ExprVal } from '../expr/expr-types.js';
import {
	DEFAULT_SIGHT,
	formatMeasure,
	formatSight,
	formatSightClauses,
	joinSightClauses,
	mergeHiveClauses,
	orderSightClauses,
	quantizeDistance,
} from '../perception/sight.js';
import { formatInventory } from '../perception/format-inventory.js';
import type { Inventory } from '../perception/format-inventory.js';
import { AUDIBLE, clarityAt, DEFAULT_HEARING, heardText, LOUD, loudnessAfter, loudnessStep, noiseHelp, type HearingRange, type Sound, type SoundListener, type SoundSource } from '../perception/hearing.js';
import { bareName } from '../perception/lod.js';
import type { SeenObject, Sight, SightClause } from '../perception/perception-types.js';
import {
	STOCK_COLLECTIVE_VERB_DEFS,
	STOCK_COLLECTIVE_VERBS,
	isFormationVerb,
	type StockCollectiveVerb,
} from '../collective/collective-verbs.js';
import { buildCollectiveCatalog, doingFields, evaluateWho, idsInVal, lawMatches, memberEntity, noUnitReason, usesCollective } from '../collective/who.js';
import { chatHandover, HANDOVER_THREAD, type Handover, type Journey, type MemoryEdit } from '../collective/handover.js';
import { nameTags, type MemoryRecord } from '../memory/store.js';
import {
	DEFAULT_COOLDOWN,
	createArcSession,
	firstStartable,
	pollArcSession,
	reactionOf,
	DEFAULT_REARM,
	runArc,
	watchIsTrue,
	type ArcHandler,
	type ArcPick,
	type ArcSession,
	type LastChoice,
} from '../arc/run.js';
import type { ChatRequest, ChatResponse, InferenceProvider, Sampling } from '../inference/provider.js';
import type { FakeChatFn } from '../inference/fake.js';
import { formatChatLog } from '../inference/chat-log.js';
import { lmStudioConfig, ollamaConfig, type HttpInferenceOpts } from '../inference/presets.js';
import { recommendedSampling, trainedOnArcDirector } from '../inference/models.js';
import {
	DEFAULT_BATCH_THINKS,
	DEFAULT_BATCH_WAIT,
	ThinkQueue,
	type MindQueue,
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
	type StockVerbArgs,
	type StockVerbName,
	type VerbArgs,
	type VerbCall,
	type VerbGate,
	type VerbHandler,
	type AliasPart,
	type VerbAlias,
} from './director-types.js';
import { ModelRegistry, type BrowserModelSpec, type EmbeddingSpec, type InferenceSource, type LiveModel, type ModelSpec } from './model-registry.js';
import { BROWSER_DECISION_MODELS, browserModelURL, BrowserProvider, DEFAULT_BROWSER_MODEL } from '../inference/browser.js';
import type { DownloadObserver, ModelDownload } from '../inference/download.js';
import { showLoadingBar, type LoadingBarOptions } from '../inference/loading-bar.js';
import { geometryKernels, wayBlocked } from '../world/geometry-kernels.js';
import { Mover, type Crowd, type CrowdSettings, type MoveOpts } from '../world/mover.js';
import { groupGoal, noWayTo, type RouteGoal } from '../world/route.js';
import { mapExpr, namesOf } from '../mind/ids.js';
import { searchTool, type SearchSpec } from '../search/search.js';
import { RTS } from '../rts/rts.js';
import type { RTSHost } from '../rts/rts-types.js';
import { STOCK_RTS_VERB_DEFS } from '../rts/rts-verbs.js';
import { genreVerbs, STOCK_MOBA_VERB_DEFS, STOCK_RPG_VERB_DEFS, type GenreVerbEntry, type MOBAHost, type RPGHost } from '../genre/genre-verbs.js';
import { OfferBook, offerText, type Offer } from '../world/offers.js';
import { passes, poseOf } from '../world/lookup.js';
import { RESERVED_TAGS, type HostWorld, type Pose, type Vec } from '../world/world-types.js';
import { centroid, distance } from '../world/vec.js';
import { Regions, type RegionSpec } from './regions.js';
import { CARRIED_SALIENCE, sightSalience } from '../perception/salience.js';
import { missingParts, worldVerbs } from '../world/world-verbs.js';

/** What every entity can be asked, whatever fields it carries. */
const ALWAYS_FIELDS = new Set(['id', 'name', 'tags', 'hp', 'maxHP']);

/** What reads like a name in a watch and is not one. */
const WATCH_WORDS = new Set(['me', 'it']);

/** A wait in progress (stock `wait`, or a handler's `call.wait`), settled by `tick`. */
/** A wait under way. `unmet` is why it fails when its time runs out before `met`; without it, running out is how it ends. */
type Wait = { runnerID:string; verb:string; end:number; seconds:number; met?:()=>boolean; unmet?:string; done:(result:ArcResult)=>void };

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
/** Game seconds between the tries `tick` makes to connect while the servers do not answer. */
const RETRY_SECONDS = 3;
/** What a step no race stops is handed: it never aborts. */
const NEVER = new AbortController().signal;

/** An RPG's crowds: round whoever they come to, in line to trade or hand over. */
const RPG_CROWD:CrowdSettings = { crowd: 'ring', verbs: { offer: 'line', give: 'line' } };

/** A character's standing `choose`: its loop, its `until`, and the game time a failed loop rests until. */
type Standing = { arc:Arc; until?:string; restUntil:number };

/** What ArcDirector keeps per character or collective: the spec it was built from, and its per-tick sample cache. */
type Row<TCtx> =
	| { spec:CharacterSpec<TCtx>; runner:Character<TCtx>; cache:SampleCache }
	| { spec:CollectiveSpec<TCtx>; runner:Collective<TCtx>; cache:SampleCache };

/** A save of every character and collective: `ArcDirector.exportCast`. */
export type CastJSON = {
	characters:Record<string, CharacterJSON>;
	collectives:Record<string, CollectiveJSON>;
	/** Every open offer; none when no one offers anything. */
	offers?:Offer[];
	/** The director's `time`, which every time in the cast is on. */
	time?:number;
};

function nowMs():number {
	return performance.now();
}

/** Whether an interval of `every` seconds that last fired at `last` is due at `now` (game time adds up in floating point). */
function due(last:number | undefined, every:number, now:number):boolean {
	return last === undefined || now - last >= every - 1e-6;
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
	// ---- Lifecycle ----

	/** The cast is built from the specs (`wire`). Every builder works before and after. */
	private _wired = false;
	private _connected = false;
	/** A `connect` under way: one at a time. */
	private _connecting:Promise<void> | undefined;
	/** The game time `tick` next tries to connect at, while not connected. */
	private _retryAt = 0;
	private _disposed = false;
	private _logFn:((entry:DirectorLog)=>void) | undefined;
	private _time = 0;

	/** Its servers and models answered: thinks run. Until then laws, programs and moves still run on every tick. */
	public get connected():boolean {
		return this._connected && !this._disposed;
	}

	/**
	 * Wires the cast if it is not yet, then connects every server and model, and resolves once they answer (loaded and
	 * warm). Rejects with the first assembly or connection error, which `onLog` hears too; called again, it tries again.
	 * Optional: `tick` does the same on its own, every 3 game seconds until they answer.
	 */
	public async connect():Promise<this> {
		if (this._disposed) {
			throw new Error('ArcDirector disposed');
		}
		try {
			this.wire();
			if (!this._connected) {
				this._connecting ??= this.connectInference().finally(() => {
					this._connecting = undefined;
				});
				await this._connecting;
			}
		}
		catch (err:unknown) {
			const text = err instanceof Error ? err.message : String(err);
			this.emitLog({ name: 'ArcDirector', message: text });
			throw err instanceof Error ? err : new Error(text);
		}
		return this;
	}

	/**
	 * Build the cast from the specs, once: the first `tick`, and every accessor that hands out cast objects, call it.
	 * Throws, building nothing, when a kit names what nothing registers or a spec does not hold together.
	 */
	private wire():void {
		if (this._wired || this._disposed) {
			return;
		}
		// Set first: a host's context or kernels asked while wiring may ask for the cast again.
		this._wired = true;
		try {
			this.syncVerbSchemas();
			this.reportMissingNames();
			this.wireCast(this._stored);
			this._stored = undefined;
		}
		catch (err) {
			this.clearCast();
			this._wired = false;
			throw err;
		}
	}

	/**
	 * A setting the cast copied when it was wired changed: every runner takes its verbs, cooldown, kit, catalog and
	 * talk again, and every mind its deps. A running arc goes on; its next step sees the new kit, a think under way
	 * the new deps on its next think. Nothing to do before wiring.
	 */
	private rewire():void {
		if (!this._wired) {
			return;
		}
		this.syncVerbSchemas();
		for (const { spec, runner } of this._rows.values()) {
			const deps = this.runnerDeps(spec, this.kitFor(spec), () => runner);
			runner.verbs = deps.verbs;
			runner.cooldown = deps.cooldown ?? DEFAULT_COOLDOWN;
			runner.kit = deps.kit;
			runner.catalog = deps.catalog;
			runner.talk = deps.talk;
			const mind = runner instanceof Collective ? runner.mind : ownMindOf(runner);
			if (mind) {
				internalsOf(mind).attach(runner, this.mindDeps(mind, runner));
			}
			if (runner instanceof Character) {
				this.syncListener(runner);
			}
			else {
				this.listen(runner);
			}
		}
	}

	private emitLog(entry:DirectorLog):void {
		this._logFn?.(entry);
	}

	public onLog(fn:(entry:DirectorLog)=>void):this {
		this._logFn = fn;
		return this;
	}

	/** Game seconds its ticks have added up to: the clock its deadlines, rearms and memories go by. A save keeps it. */
	public get time():number {
		return this._time;
	}

	/**
	 * `dt` game seconds pass: laws, programs, moves, sounds and talk run, and ready minds think once connected. Until
	 * then it connects on its own (wiring the cast first) every 3 game seconds; what goes wrong goes to `onLog`, and
	 * nothing runs while the cast cannot be wired. A `dt` of 0 or less (a paused game) does nothing.
	 */
	public tick(dt:number):void {
		if (this._disposed || !(dt > 0)) {
			return;
		}
		this._time += dt;
		const now = this._time;
		if (!this._connected && !this._connecting && now >= this._retryAt) {
			this._retryAt = now + RETRY_SECONDS;
			void this.connect().catch(() => undefined);
		}
		if (!this._wired) {
			return;
		}
		const watch = due(this._watchedAt, this._intervals.watch, now);
		const think = due(this._thoughtAt ??= now, this._intervals.think, now);
		if (watch) {
			this._watchedAt = now;
		}
		if (think) {
			this._thoughtAt = now;
		}
		// Characters before collectives: steps waiting for the clock wake in that order.
		const rows = [...this._rows.values()].sort((a, b) => Number(a.runner instanceof Collective) - Number(b.runner instanceof Collective));
		for (const row of rows) {
			row.runner.stamp(now, this._watchedAt);
			row.runner.refreshKit();
		}
		const minds = this.minds();
		for (const mind of minds) {
			mind.stamp(now);
		}
		const world = this._world;
		if (world) {
			this._regions.tick(this.characters(), (id) => poseOf(world, id)?.point, dt, now);
		}
		// Built only for the minds whose watches are asked this tick: a view per character is not cheap.
		const catalogs = {
			get: (id:string):Catalog | Catalog[] | undefined => {
				const mind = this._kernelFn && this._contextFn ? this.mindByID(id) : undefined;
				try {
					return mind && this.catalogsFor(mind);
				}
				catch {
					return undefined;
				}
			},
		};
		const ready = this._queue.tick(dt, think ? catalogs : undefined);
		this._readyThink.push(...ready);
		this.tickWaits();
		this._rts?.tick(dt);
		this._mover.tick();
		this.tickSounds();
		this.talk?.tick(now);
		for (const row of rows) {
			row.cache.commit();
		}
		if (watch) {
			this.tickAllLaws();
		}
		this.tickHandover();
		if (think) {
			this.tickGoals(minds);
		}
		this.drain(now);
	}

	/** Every runner's laws and standing `choose`, and each collective's laws. */
	private tickAllLaws():void {
		for (const { runner } of this._rows.values()) {
			if (!(runner instanceof Character)) {
				continue;
			}
			if (!runner.collective) {
				this.tickLaws(runner);
			}
			this.tickStanding(runner);
		}
		for (const { runner } of this._rows.values()) {
			if (!(runner instanceof Collective)) {
				continue;
			}
			// Whatever brought it down, a mind does not go on thinking through it.
			const commander = runner.commander;
			if (commander && this._world?.isDown?.(commander.id)) {
				internalsOf(runner).vacate(commander);
			}
			this.tickCollectiveLaws(runner);
		}
	}

	public dispose():void {
		this._disposed = true;
		this.clearCast();
	}

	// ---- Inference ----

	/** Shows a loading bar for each browser model it downloads (`withLoadingBar`). */
	private _loadingBar:LoadingBarOptions | undefined;
	/** System One models by name. A runner is assigned one; one without an assignment uses the default. */
	private readonly _systemOnes = new Map<string, SystemOne>();
	/** When each System One that failed may be asked again (`performance.now()`). */
	private readonly _systemOneRest = new Map<string, number>();
	private _defaultSystemOne:string | null = null;
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
		log: (message, error) => this.emitLog({ name: 'ArcDirector', message, error }),
	});
	public infer:InferClock = emptyInferClock();

	/** LM Studio as chat server `name` (default `lmstudio`), any time. Default URL `http://127.0.0.1:1234/v1`. */
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
	 * A server under `name`, any time; the same name again replaces it. A chat server is your own
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
	 * A chat model under `name`, any time; the same name again replaces it. A mind thinks with the
	 * one its settings' `model` names, else the default: the first added, unless `setDefaultModel` says otherwise.
	 * With none added, connecting adds the first server's own pick, named after that server. A `decision` model is
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

	/**
	 * Model `name`, run in the page on the GPU through wllama (`@wllama/wllama`, llama.cpp in WebAssembly), any
	 * time; the same name again replaces it. `model` is one of ArcDirector's own (`Skaldic.Gemma4E4B`,
	 * `Skaldic.Laya`), a GGUF's URL ({@link BrowserModelSpec.model}), or
	 * the whole spec; without one, Skaldic Gemma 4 E4B ({@link DEFAULT_BROWSER_MODEL}). A decision model the library
	 * knows (Skaldic Laya) is a System One on its own engine ({@link BrowserProvider.decisions}), server
	 * `browser-decisions`, unless the spec says otherwise. It starts downloading now unless the
	 * browser has it, then loads; `observer` follows it, and {@link withLoadingBar} shows it. Models named alike share
	 * one download, which `BrowserProvider.shared.download(model)` also returns.
	 */
	public addBrowserModel(name:string, model:string | BrowserModelSpec = {}, observer?:DownloadObserver):this {
		const given = typeof model === 'string' ? { model } : model;
		const asked = { ...given, model: browserModelURL(given.model ?? DEFAULT_BROWSER_MODEL) };
		const decides = BROWSER_DECISION_MODELS.includes(asked.model);
		const { model: ref = DEFAULT_BROWSER_MODEL, provider = decides ? BrowserProvider.decisions : BrowserProvider.shared, inference = decides ? 'browser-decisions' : 'browser', ...spec } = decides ? { decision: true, thinking: false, ...asked } : asked;
		if (this._models.providerOf(inference) !== provider) {
			this.addInference(inference, provider);
		}
		// The registry configures it too once it resolves, but the download loads it now.
		provider.configureModel(ref, { contextLength: spec.contextLength, enableThinking: spec.thinking, thinkingBudget: spec.thinkingBudget, sampling: { ...recommendedSampling(ref, spec.thinking), ...spec.sampling }, maxParallel: spec.maxParallel });
		this.addModel(name, { ...spec, inference, id: ref });
		const download = provider.download(ref);
		if (observer) {
			download.subscribe(observer);
		}
		if (this._loadingBar) {
			showLoadingBar(download, ref, this._loadingBar);
		}
		return this;
	}

	/**
	 * A plain loading bar in the page for each browser model this director downloads ({@link addBrowserModel}): its
	 * name, a `<progress>`, and what it is doing. Gone once the model is loaded; a failure stays, with the reason. In a
	 * small panel in the page's bottom-left corner, or in `parent`. For a bar of your own, follow the download with
	 * `addBrowserModel`'s `observer` instead.
	 */
	public withLoadingBar(opts:LoadingBarOptions = {}):this {
		this._loadingBar = opts;
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

	/** Thinks model `name`, or the default, runs at once (its `maxParallel`); 0 until its server answered. */
	public modelParallel(name?:string):number {
		return this._models.live(name)?.maxParallel ?? 0;
	}

	/** How model `name`, or the default, picks its tokens, every setting filled in; `undefined` until its server answered. */
	public modelSampling(name?:string):Sampling | undefined {
		const sampling = this._models.live(name)?.sampling;
		return sampling && { ...sampling };
	}

	/**
	 * Load model `name`, or the default, now: one request a token long, so the first think is not the one that waits
	 * for it, as before a bench times thinks. Rejects when the model cannot answer.
	 */
	public async warmUp(name?:string):Promise<void> {
		const { provider, id } = this.chatModel(name);
		await provider.chat({ model: id, messages: [{ role: 'user', content: 'Reply with OK.' }], maxTokens: 1, enableThinking: false });
	}

	/**
	 * Think on `from`'s chat servers and models in place of this director's own, over the same
	 * connections and as `from` resolved them, so connecting looks nothing up again. For many short-lived directors on
	 * one setup, such as a bench's cases. Their requests are logged by `from`.
	 */
	public shareInference(from:ArcDirector<TCtx>):this {
		this._models.adopt(from._models);
		return this;
	}

	/** The one model every memory is embedded with, so recall compares like with like whatever a mind thinks with. */
	public withEmbeddings(spec:EmbeddingSpec):this {
		this._models.setEmbeddings(spec);
		this.rewire();
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
				const signal = req.thread ? this._queue.thinkSignal(req.thread) : undefined;
				try {
					if (!http) {
						const dump = formatChatLog(req);
						this.emitLog({ name, message: `prompt\n${dump.message}`, image: dump.image });
					}
					// A think stopped, and a request its own mind ended, both end it.
					const res = await inner.chat(signal ? { ...req, signal: req.signal ? AbortSignal.any([req.signal, signal]) : signal } : req);
					const ms = Math.round(nowMs() - t0);
					this.recordInfer(req.thread, ms, res);
					const parts = [`${ms}ms`];
					if (res.promptMs !== undefined) {
						parts.push(`ctx ${Math.round(res.promptMs)}ms`);
					}
					if (res.generateMs !== undefined) {
						parts.push(`gen ${Math.round(res.generateMs)}ms`);
						if (res.outputTokens && res.generateMs > 0) {
							parts.push(`${res.outputTokens} tok ${(res.outputTokens / (res.generateMs / 1000)).toFixed(1)}/s`);
						}
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
			systemOneEndpoint: inner.systemOneEndpoint?.bind(inner),
		};
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
				this._connected = true;
				return;
			}
			throw new Error('ArcDirector: no inference (addLMStudioInference / addOllamaInference / addFakeInference / addInference)');
		}
		await this._models.start();
		this._connected = true;
	}

	/** A spec naming a System One or a chat model this director lacks is a typo; caught when it is wired. */
	private checkNames(spec:{ id:string; systemOne?:string | null; mind?:MindSettings; goals?:Goal<TCtx>[] }):void {
		if (spec.systemOne && !this._systemOnes.has(spec.systemOne)) {
			throw new Error(`ArcDirector: '${spec.id}' names System One '${spec.systemOne}', which was never added`);
		}
		if (spec.mind?.model !== undefined && !this._models.has(spec.mind.model)) {
			throw new Error(`ArcDirector: '${spec.id}' names model '${spec.mind.model}', which was never added`);
		}
		// A typo in a goal's watch would leave it open for good: it throws now, as a law's does, not silently in play.
		for (const { until } of spec.goals ?? []) {
			if (typeof until === 'string') {
				parse(until);
			}
		}
	}

	// ---- Choice (System One picking) ----

	/** One pick closure per character, so `withheldVerbs` asking for it every refresh stays cheap. */
	private readonly _picks = new WeakMap<ArcRunner<TCtx>, ArcPick>();
	private readonly _standing = new WeakMap<Character<TCtx>, Standing>();

	/**
	 * What `id`'s System One would be asked now to pick among `choices` (arcs, or arc text), worded as `choose` words
	 * it ({@link choicePrompt}): its state lines and each choice that can run, with whom it is about. `doing` and `last`
	 * stand in for the verb it runs and its last choice. Undefined when no choice can run now. For previews and
	 * training data.
	 */
	public choiceQuestion(id:string, choices:Record<string, Arc | string>, { doing, last }:{ doing?:string; last?:LastChoice } = {}):ChoicePrompt | undefined {
		const runner = this.character(id) ?? this.collective(id);
		if (!runner) {
			throw new Error(`no character or collective ${id}`);
		}
		const arcs = Object.fromEntries(Object.entries(choices).map(([name, arc]) => [name, typeof arc === 'string' ? parseArcText(arc, this._verbs) : arc]));
		return this.choiceQuestionOf(runner, arcs, doing ?? runner.verb, last);
	}

	private choiceQuestionOf(runner:ArcRunner<TCtx>, choices:Record<string, Arc>, verb:string, last:LastChoice | undefined):ChoicePrompt | undefined {
		return choicePrompt({ id: runner.id, verb, last, catalog: runner.catalog?.(), choices: withLoneWait(choices), verbs: this._verbs });
	}

	/**
	 * `spec.choose` as `loop(choose(goal, …choices), until)`, checked as the cast is wired so a typo throws then, not
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
		if (!standing || character.arcSession || this._time < standing.restUntil || !this.pickFor(character)) {
			return;
		}
		const catalog = standing.until ? character.catalog?.() : undefined;
		if (standing.until && catalog && watchIsTrue(standing.until, catalog)) {
			return;
		}
		void character.enact(standing.arc).then((result) => {
			// A dead endpoint or a bad pick rests like a handler would, instead of asking again every tick.
			if (result.status === 'failed') {
				standing.restUntil = this._time + character.cooldown;
			}
		}, (err:unknown) => {
			standing.restUntil = this._time + character.cooldown;
			this.emitLog({ name: character.id, message: `choose: ${err instanceof Error ? err.message : String(err)}`, error: true });
		});
	}

	/**
	 * The name of a runner's System One: the one its spec names, else its collective's, else the default. A spec's
	 * `null` means none there, whatever the default is.
	 */
	private systemOneOf(runner:ArcRunner<TCtx>):string | null {
		const specs = [
			this._rows.get(runner.id)?.spec,
			runner instanceof Character && runner.collective ? this._rows.get(runner.collective.id)?.spec : undefined,
		];
		const assigned = specs.find((spec) => spec?.systemOne !== undefined)?.systemOne;
		const name = assigned === undefined ? this._defaultSystemOne : assigned;
		return name && this._systemOnes.has(name) ? name : null;
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
	 * choice, every other System One in turn, then the runner's chat model. One that failed rests a while.
	 */
	private async pick(runner:ArcRunner<TCtx>, goal:string, choices:Record<string, Arc>, last:LastChoice | undefined):Promise<string> {
		const own = this.systemOneOf(runner);
		if (!own) {
			throw new Error('System One is off');
		}
		const prompt = this.choiceQuestionOf(runner, choices, runner.verb, last);
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
		const chat = this._models.live(runner.mind?.setting('model'));
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

	// ---- Verbs and dispatch ----

	private _verbs = new VerbRegistry();
	private readonly _handlers = new Map<string, VerbHandler<TCtx>>();
	private _catchAll:VerbHandler<TCtx> | undefined;
	private _verbGate:VerbGate<TCtx> | undefined;
	private readonly _waits = new Set<Wait>();
	/**
	 * How often each runner was stopped (`abortArc`). A verb still running for it gives way at its next wait or walk,
	 * though the stop came between two of them, while none was there to cut short.
	 */
	private readonly _stops = new Map<string, number>();
	private _world:HostWorld<unknown> | undefined;
	/** Every open offer, standing ones and ones to someone. Saved with the cast. */
	public readonly offers = new OfferBook();
	/** Stock world verbs for the parts `withWorld` has, and the RTS verbs once `withRTS` is set. A host handler of the same name wins. */
	private readonly _stockHandlers = new Map<string, VerbHandler<TCtx>>();
	private _mover = new Mover(undefined, () => this._time);
	private readonly _aliases = new Map<string, VerbAlias>();
	/** Each noisy verb's help as it was registered, before {@link syncVerbSchemas} added how far its sound carries. */
	private readonly _baseHelp = new Map<string, string | undefined>();
	private _crowd:CrowdSettings | undefined;
	private _groupWalk:((character:Character<TCtx>, verb:string, targets:readonly string[])=>boolean) | undefined;
	private _abortArcFn:((id:string)=>void) | undefined;
	private _stepFn:((call:VerbCall<TCtx>, result:ArcResult)=>void) | undefined;

	/**
	 * How characters bound for the same character share it: a `line` to be served one at a time, a `ring` round it,
	 * or `none`, each going straight in. `withRPG` gives `ring`, with `line` for `offer` and `give`; without it,
	 * `none`. A character spec's `crowd` wins over this, and a move's own `crowd` over both.
	 */
	public withCrowd(crowd:CrowdSettings):this {
		this._crowd = crowd;
		return this;
	}

	/**
	 * Whether `character` walks near a group before `verb` acts on it (`VerbDef.group`), given the ids of `targets`. Default:
	 * it walks. If not, it acts from where it stands, and `say` reaches whoever of them is in earshot. Asked on the fly, and
	 * more than once a step, so a program knows whether a line would take its body: keep it cheap and free of side effects.
	 */
	public withGroupWalk(fn:(character:Character<TCtx>, verb:string, targets:readonly string[])=>boolean):this {
		this._groupWalk = fn;
		return this;
	}

	/** The crowd a move by `verb` to `target` takes when it names none: none to a thing, else the target's, else the game's. */
	private crowdOf(verb:string, target:string):Crowd {
		if (!this.character(target)) {
			return 'none';
		}
		return this._specs.get(target)?.crowd ?? this._crowd?.verbs?.[verb] ?? this._crowd?.crowd ?? 'none';
	}

	/**
	 * `step` with its group arg read as `runner` sees it (`VerbDef.group`). A name stays, for what names do. An expression
	 * that picks a list becomes its ids, without `runner` or anyone down or gone; one that picks one becomes that id.
	 * The result is why it picks no one, when it does not.
	 */
	private aimGroup(runner:ArcRunner<TCtx>, step:Step):Step | ArcResult {
		const key = this._verbs.get(step.verb)?.group;
		const value = key ? step.args[key] : undefined;
		const word = typeof value === 'string' ? value.trim() : '';
		if (!key || (!word && !Array.isArray(value)) || this.character(word) || this._world?.find(word) !== undefined) {
			return step;
		}
		const names = runner.mind?.persona.names;
		const shown = names ? mapExpr(word, namesOf(names)) : word;
		const fail = (reason:string):ArcResult => ({ status: 'failed', verb: step.verb, reason });
		let picked = value as string[];
		if (word) {
			const ctx = runner.context();
			const catalog = ctx === undefined ? undefined : this.exprCatalog(runner, ctx, this.cacheOf(runner));
			// A bare word the catalog does not bind is a name no one has, and fails as one.
			if (!/[(.]|=>/.test(word) && !catalog?.names.has(word)) {
				return step;
			}
			if (!catalog) {
				return fail(`${shown} picks no one: nothing to pick from`);
			}
			const r = evaluate(word, catalog);
			if (r.error) {
				return fail(`cannot read ${shown} as a group: ${r.error.message}`);
			}
			picked = idsInVal(r.value);
			if (r.value.kind !== 'list') {
				return picked[0] ? { ...step, args: { ...step.args, [key]: picked[0] } } : fail(`${shown} picks no one`);
			}
		}
		const ids = this.standing(picked).filter((id) => id !== runner.id);
		return ids.length > 0 ? { ...step, args: { ...step.args, [key]: ids } } : fail(`no one left in ${shown || 'the group'}`);
	}

	/** Those of `ids` still in the world and on their feet, where there is a world to ask. */
	private standing(ids:readonly string[]):string[] {
		const world = this._world;
		return ids.filter((id) => !world || (poseOf(world, id) && !world.isDown?.(id)));
	}

	/**
	 * The walk that takes `runner` near the group `ids`, following it as it moves, ready to run. None when it is near
	 * already, when it has no body or the world has no routes, or when the host says not to (`withGroupWalk`).
	 */
	private walkToGroup(runner:ArcRunner<TCtx>, verb:string, ids:readonly string[], opts?:MoveOpts):(()=>Promise<ArcResult>) | undefined {
		const world = this._world;
		const me = world && poseOf(world, runner.id)?.point;
		if (!world || !me || !(runner instanceof Character) || !this._mover.canMove) {
			return undefined;
		}
		const goal = ():RouteGoal | undefined => {
			const left = this.standing(ids);
			return left.length > 0
				? groupGoal(left.map((id) => poseOf(world, id)!.point), world.getReach?.(world.find(runner.id), world.find(left[0])) ?? 1)
				: undefined;
		};
		if (goal()?.reached(me) !== false || this._groupWalk?.(runner, verb, ids) === false) {
			return undefined;
		}
		return async () => {
			const out = await this._mover.go(runner.id, { goal, noWay: (why) => noWayTo('them', why) }, verb, opts);
			return out.reason === 'gone' ? { ...out, reason: 'no one left in the group' } : out;
		};
	}

	/**
	 * The game's world: where things are, how characters move, and how items, uses, looks, and trades work.
	 * Runs the stock world verbs (`go_to`, `pick_up`, `offer`, …) and the watch geometry. `TEntity` is the
	 * game's own type for things in its world; every part but `find` receives one. See `HostWorld`.
	 */
	public withWorld<TEntity>(world:HostWorld<TEntity>):this {
		this._world = world;
		// Moves under way were through the world before.
		for (const { runner } of this._rows.values()) {
			this._mover.stop(runner.id);
		}
		this._mover = new Mover(world, () => this._time, (verb, target) => this.crowdOf(verb, target), () => this._crowd?.spacing ?? 1);
		this.bindWorldVerbs();
		return this;
	}

	public withVerbs(registry:VerbRegistry):this {
		this._verbs = registry;
		this._baseHelp.clear();
		this.rewire();
		return this;
	}

	/** Schema-only. Omit `verbs` to register the full stock set. Already-registered names are skipped. */
	public addStockVerbs(...verbs:StockVerb[]):this {
		this._verbs.addAll(STOCK_VERB_DEFS, ...verbs);
		this.syncVerbSchemas();
		return this;
	}

	/** Schema-only collective verbs (`command`, `tag`, formations). `when` / `law` / `unlaw` ride on stock arc verbs. Kit still has to grant them. */
	public addStockCollectiveVerbs(...verbs:StockCollectiveVerb[]):this {
		this._verbs.addAll(STOCK_COLLECTIVE_VERB_DEFS, ...verbs);
		this.syncVerbSchemas();
		return this;
	}

	/**
	 * What the registry says that other settings decide, kept in step with them; run again whenever one changes. A law
	 * whose whole arc is an alias with a watch may leave its own out. A verb that makes a sound says so, and how far it
	 * carries (`withHearing`, in sight's unit).
	 */
	private syncVerbSchemas():void {
		if ([...this._aliases.values()].some((alias) => alias.watch !== undefined) && this._verbs.get('law')?.args.watch?.kind === 'watch') {
			this._verbs.redefine('law', { ...STOCK_VERB_DEFS.law, args: { ...STOCK_VERB_DEFS.law.args, watch: 'watch?' } });
		}
		const noise = this._hearing?.noise ?? new Map<string, Sound>();
		for (const verb of new Set([...this._baseHelp.keys(), ...noise.keys()])) {
			const spec = this._verbs.get(verb);
			const sound = noise.get(verb);
			const base = this._baseHelp.has(verb) ? this._baseHelp.get(verb) : spec?.help;
			if (spec) {
				this._verbs.redefine(verb, { ...spec, help: sound ? [base, noiseHelp(sound, this._hearing!.range, this._sightUnitName)].filter(Boolean).join('; ') : base });
			}
			if (spec && sound) {
				this._baseHelp.set(verb, base);
			}
			else {
				this._baseHelp.delete(verb);
			}
		}
	}

	/**
	 * Schema plus optional world function. `help` is the one line shown after the verb in the prompt's
	 * verb list. The handler's `args` are typed from `args`; a stock verb takes only a handler, typed from
	 * its stock args. Same name again binds or replaces the handler.
	 */
	public addVerb<TVerb extends StockVerbName>(name:TVerb, verb:{ help?:string; reply?:boolean; seen?:string; handler:VerbHandler<TCtx, VerbArgs<StockVerbArgs<TVerb>>> }):this;
	public addVerb<const TArgMap extends VerbArgMap = Record<never, never>>(name:string, verb?:{ args?:TArgMap; help?:string; reply?:boolean; seen?:string; group?:string; endless?:boolean; handler?:VerbHandler<TCtx, VerbArgs<TArgMap>> }):this;
	/**
	 * An alias: a verb that runs `arc`, its `{arg}` holes filled from its args (or `arc` made from them). Usable
	 * wherever a verb is. As a law's whole arc it brings `watch`, `who` and `rearm` when the law gives none:
	 * `law(name=archers, arc=keep_distance(keep=4), who=units.filter("Archer"))`.
	 */
	public addVerb(name:string, verb:{ args?:VerbArgMap; help?:string; seen?:string } & VerbAlias):this;
	public addVerb(name:string, { handler, arc, watch, who, rearm, ...def }:{ args?:VerbArgMap; help?:string; reply?:boolean; seen?:string; group?:string; endless?:boolean; handler?:VerbHandler<TCtx, never> } & Partial<VerbAlias> = {}):this {
		if (!this._verbs.has(name)) {
			this._verbs.add(name, def);
		}
		else if (def.seen) {
			// A stock verb bound to the game's handler may still say how others see it.
			this._verbs.redefine(name, { ...this._verbs.get(name)!, seen: def.seen });
		}
		if (arc !== undefined) {
			this._aliases.set(name, { arc, watch, who, rearm });
		}
		if (handler) {
			// The schema is checked before dispatch, so the args match what this handler was typed with.
			this._handlers.set(name, handler as VerbHandler<TCtx>);
		}
		this.syncVerbSchemas();
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
		this.syncVerbSchemas();
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

	/** After a host verb resolves. `say` does not come through here. */
	public onStep(fn:(call:VerbCall<TCtx>, result:ArcResult)=>void):this {
		this._stepFn = fn;
		return this;
	}

	/** The stock world verbs `world` has the parts for. A host handler of the same name wins. */
	private bindWorldVerbs():void {
		const world = this._world!;
		const handlers = worldVerbs<TCtx>({
			world,
			mover: this._mover,
			now: () => this._time,
			seen: (call) => (this._sightLook ? this.filterSight(this._sightLook(call.ctx)).objects : []),
			nearRadius: (call) => (this._kernelFn ? this.kernelsFor(call.character, call.ctx).nearRadius : undefined),
			offers: () => this.liveOffers(),
			isCharacter: (id) => this.character(id) !== undefined,
			canOffer: (fromID, toID) => this.canOffer(fromID, toID),
			canPickUp: (call, item, fromID) => this.canPickUp(call, item, fromID),
			tell: (id, event) => this.character(id)?.tell(event),
			tellAll: (event) => this.pushEvent(event),
			currency: () => this._mindDefaults.settings.currency,
		});
		for (const [verb, handler] of Object.entries(handlers)) {
			if (missingParts(verb, world).length === 0) {
				this._stockHandlers.set(verb, handler as VerbHandler<TCtx>);
			}
			else {
				this._stockHandlers.delete(verb);
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
		return this.sees(fromID, toID) ?? this.inLineOfSight(fromID, toID);
	}

	/**
	 * Whether the acting character may pick up `item` from `fromID` (the item where it lies, or what holds it): the host's
	 * `canPickUp` where it rules, else it sees `item` there, else `fromID` is in its line of sight, else yes.
	 */
	private canPickUp(call:VerbCall<TCtx>, item:string, fromID:string):boolean {
		const world = this._world;
		if (world?.canPickUp) {
			const character = world.find(call.character.id);
			const from = world.find(fromID);
			if (character === undefined || from === undefined) {
				return false;
			}
			const verdict = world.canPickUp(character, item, from);
			if (verdict !== undefined) {
				return verdict;
			}
		}
		if (this._sightLook) {
			return this.filterSight(this._sightLook(call.ctx)).objects
				.some((o) => o.id === item && (o.attachMode === 'in' ? o.attachedTo === fromID : fromID === item));
		}
		return this.inLineOfSight(call.character.id, fromID);
	}

	/** The offer book, without offers to someone their maker may no longer make. */
	private liveOffers():OfferBook {
		this.offers.prune((offer) => offer.to === undefined || this.canOffer(offer.from, offer.to));
		return this.offers;
	}

	/**
	 * One host step, acted by `runner` itself. When `signal` aborts (its `until` held, its `within` ran out, a reaction
	 * took over, a new program came), what the host does for `runner` stops, as `abortArc` stops it.
	 */
	private async dispatch(runner:ArcRunner<TCtx>, step:Step, ctx:TCtx | undefined, signal = NEVER):Promise<ArcResult> {
		// Stopped before the host began it.
		if (signal.aborted) {
			return { status: 'stopped', verb: step.verb };
		}
		const stop = ():void => this.abortArc(runner.id);
		signal.addEventListener('abort', stop, { once: true });
		try {
			return await this.dispatchStep(runner, step, ctx, signal);
		}
		finally {
			signal.removeEventListener('abort', stop);
		}
	}

	private dispatchStep(runner:ArcRunner<TCtx>, step:Step, ctx:TCtx | undefined, signal:AbortSignal):Promise<ArcResult> | ArcResult {
		const liveCtx = this.tryCtx(runner.id) ?? ctx;
		if (step.verb === 'law' || step.verb === 'unlaw') {
			return this.handleLaw(runner, step);
		}
		if (this._aliases.has(step.verb)) {
			return this.runAlias(runner, step);
		}
		if ((STOCK_COLLECTIVE_VERBS as readonly string[]).includes(step.verb) && !isFormationVerb(step.verb)) {
			const collective = collectiveOf(runner);
			return collective
				? this.handleCollectiveVerb(collective, runner, step, liveCtx)
				: { status: 'failed', verb: step.verb, reason: `${step.verb} needs a collective` };
		}
		if (!(runner instanceof Character)) {
			// No body to hand a host: only the director's own clock runs for it.
			return step.verb === 'wait' ? this.stockWait(runner.id, step.args) : bodiless(step.verb);
		}
		const handler = this._handlers.get(step.verb)
			?? this._stockHandlers.get(step.verb)
			?? (step.verb === 'wait' ? this._waitVerb : this._catchAll);
		if (!handler) {
			return { status: 'failed', verb: step.verb, reason: `unhandled ${step.verb}` };
		}
		if (liveCtx === undefined) {
			return { status: 'failed', verb: step.verb, reason: 'not in this scene' };
		}
		const call = this.verbCall(runner, step, liveCtx, signal);
		if (!('character' in call)) {
			return call;
		}
		const gated = this._verbGate?.(call);
		const noise = gated ? undefined : this._hearing?.noise.get(step.verb);
		// A verb's sound goes on while it runs, unless it says how long it lasts itself.
		const hush = noise && this.emitSound(runner.id, noise.seconds === undefined ? { ...noise, seconds: Infinity } : noise);
		const out = gated ?? handler(call);
		if (hush && noise.seconds === undefined) {
			void Promise.resolve(out).then(hush, hush);
		}
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
		signal:AbortSignal,
	):VerbCall<TCtx> | ArcResult {
		const fail = (reason:string):ArcResult => ({ status: 'failed', verb: step.verb, reason });
		const catalogAt = (point?:Vec):Catalog | undefined => this.exprCatalog(character, ctx, point ? new SampleCache() : this.cacheOf(character), point);
		const spec = this._verbs.get(step.verb);
		const args:Record<string, unknown> = { ...step.args };
		for (const [key, value] of Object.entries(args)) {
			const kind = argKind(spec, key);
			if (typeof value !== 'string' || !value.trim()) {
				continue;
			}
			if (kind === 'id') {
				// The model may echo the name as sight wrote it: `go_to(what seems to be a Lantern)`.
				args[key] = bareName(value);
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
		const stops = this._stops.get(character.id) ?? 0;
		const stopped = ():ArcResult | undefined => ((this._stops.get(character.id) ?? 0) === stops && !signal.aborted ? undefined : { status: 'stopped', verb: step.verb });
		return {
			verb: step.verb,
			args,
			character,
			ctx,
			signal,
			score,
			holds: (arg, point) => score(arg, point) > 0,
			goTo: async (target, opts) => stopped() ?? this.goTo(character.id, step.verb, { target }, opts),
			goToPoint: async (point, opts) => stopped() ?? this.goTo(character.id, step.verb, { point }, opts),
			wait: async (seconds) => stopped() ?? this.waitFor(character.id, seconds, step.verb),
		};
	}

	/**
	 * Move `characterID`, or, in a world where characters do not move, succeed only when already in reach. Already
	 * close enough by `opts.check`, it does not take a step.
	 */
	private goTo(characterID:string, verb:string, dest:{ target:string } | { point:Vec }, opts:MoveOpts = {}):Promise<ArcResult> {
		const met = opts.check?.();
		if (met !== undefined) {
			return Promise.resolve({ status: 'ok', verb, reason: met });
		}
		if (this._mover.canMove) {
			return this._mover.go(characterID, dest, verb, opts);
		}
		const { within } = opts;
		const world = this._world;
		const character = world?.find(characterID);
		const target = 'target' in dest ? world?.find(dest.target) : undefined;
		const point = 'target' in dest ? (target === undefined ? undefined : world?.getPose(target)?.point) : dest.point;
		const me = character === undefined ? undefined : world?.getPose(character)?.point;
		const near = within ?? (character !== undefined && target !== undefined ? world?.getReach?.(character, target) : undefined) ?? 1;
		const ok = !me || !point || distance(me, point) <= near;
		return Promise.resolve(ok ? { status: 'ok', verb } : { status: 'failed', verb, reason: 'out of reach' });
	}

	private waitFor(runnerID:string, seconds:number, verb:string, met?:()=>boolean, unmet?:string):Promise<ArcResult> {
		return new Promise((done) => {
			this._waits.add({ runnerID, verb, end: this._time + seconds, seconds, met, unmet, done });
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
	private readonly _waitVerb:VerbHandler<TCtx> = (call) => this.stockWait(call.character.id, call.args);

	/**
	 * Game time passes for runner `id` for `seconds`, or until someone named by `reply` finishes a non-movement verb.
	 * `reply` is how a mind waits out an answer; it is not a model arg. A wait for its `until` (which the runtime
	 * watches, and which ends it) that runs out of time first fails, so the steps after it never run as if it had come
	 * true. With a `within`, that is all the time it has.
	 */
	private stockWait(id:string, args:Record<string, unknown>):Promise<ArcResult> {
		const watching = typeof args.until === 'string' && args.until.trim() !== '';
		const replyTo = replyTargets(args.reply);
		const seen = new Map(replyTo.map((who) => [who, this.character(who)?.replies ?? 0]));
		const seconds = typeof args.seconds === 'number' ? args.seconds
			: typeof args.within === 'number' ? Infinity
				: watching || replyTo.length > 0 ? 20 : 1;
		const met = ():boolean => replyTo.some((who) => (this.character(who)?.replies ?? 0) !== seen.get(who));
		const unmet = watching && replyTo.length === 0 ? `until not met after ${seconds}s` : undefined;
		return this.waitFor(id, seconds, 'wait', replyTo.length > 0 ? met : undefined, unmet);
	}

	private tickWaits():void {
		for (const wait of this._waits) {
			const met = wait.met?.() ?? false;
			if (met || this._time >= wait.end) {
				this._waits.delete(wait);
				wait.done(!met && wait.unmet
					? { status: 'failed', verb: wait.verb, reason: wait.unmet }
					: { status: 'ok', verb: wait.verb, reason: met ? 'until' : `${wait.seconds}s` });
			}
		}
	}

	/** Stop whatever character `id` is doing now: its waits and moves here, the rest through `onAbortArc`. */
	public abortArc(id:string):void {
		this._stops.set(id, (this._stops.get(id) ?? 0) + 1);
		for (const wait of this._waits) {
			if (wait.runnerID === id) {
				this._waits.delete(wait);
				wait.done({ status: 'stopped', verb: wait.verb });
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
		if (step.verb === 'command') {
			return this.handleIssue(collective, runner, step, ctx);
		}
		if (step.verb === 'tag' || step.verb === 'untag') {
			const who = typeof step.args.who === 'string' ? step.args.who : '';
			const name = typeof step.args.name === 'string' ? step.args.name : '';
			if (!who || !name) {
				return { status: 'failed', verb: step.verb, reason: `${step.verb} needs who and name` };
			}
			const cat = this.collectiveCatalog(collective, runner, ctx);
			const characters = cat ? evaluateWho(who, cat, collective) : [];
			if (step.verb === 'tag') {
				collective.tagCharacters(characters, name);
			}
			else {
				collective.untagCharacters(characters, name);
			}
			return { status: 'ok', verb: step.verb };
		}
		return { status: 'failed', verb: step.verb, reason: `unhandled ${step.verb}` };
	}

	/** `step`'s alias `part` with its `{arg}` holes filled; `undefined` when `step` is no alias or its alias has none. */
	private aliasPart(step:Step, part:'arc' | 'watch' | 'who'):string | undefined {
		const src:AliasPart | undefined = this._aliases.get(step.verb)?.[part];
		if (src === undefined) {
			return undefined;
		}
		return typeof src === 'function' ? src(step.args) : fillHoles(src, step.args);
	}

	/** An alias step: its arc, filled from its args, run in its place by the same runner. */
	private async runAlias(runner:ArcRunner<TCtx>, step:Step):Promise<ArcResult> {
		const text = this.aliasPart(step, 'arc') ?? '';
		const hole = /\{([A-Za-z_]\w*)\}/.exec(text)?.[1];
		if (hole) {
			return { status: 'failed', verb: step.verb, reason: `${step.verb} needs ${hole}` };
		}
		let arc:Arc;
		try {
			arc = parseArcText(text, this._verbs);
		}
		catch (err) {
			return { status: 'failed', verb: step.verb, reason: err instanceof Error ? err.message : String(err) };
		}
		// Run inside a reaction, its arc follows that reaction's trigger as the reaction's own steps do.
		const session = createArcSession({ verbs: this._verbs, catalog: () => runner.catalog?.(), now: () => this._time, watchedAt: () => this._watchedAt, nextTime: () => runner.nextTime(), reaction: runner.arcSession?.running.at(-1) });
		// Granting the alias grants what it runs: a game may offer `advance` and never `attack_move`.
		const result = await runArc(arc, (inner, signal) => runner.perform(inner, runner.context(), true, signal), { session });
		return { ...result, verb: step.verb };
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
				return { status: 'failed', verb: 'unlaw', reason: 'unlaw needs name' };
			}
			home.removeLaw(name);
			return { status: 'ok', verb: 'unlaw' };
		}
		const who = typeof step.args.who === 'string' ? step.args.who : undefined;
		if (who && !home.lawsTakeWho()) {
			const reason = collectiveOf(runner) ? 'your own law reaches only you; it has no who' : 'solo law has no who';
			return { status: 'failed', verb: 'law', reason };
		}
		const arc = arcArg(step.args.arc, this._verbs);
		// A law whose whole arc is one alias takes the alias's watch, who, rearm and name when it gives none.
		const alias = arc?.length === 1 ? this.aliasPart(arc[0], 'watch') : undefined;
		const watch = typeof step.args.watch === 'string' && step.args.watch ? step.args.watch : alias ?? '';
		if (!watch || !arc) {
			return { status: 'failed', verb: 'law', reason: 'law needs watch and arc' };
		}
		const aliasWho = arc.length === 1 && home.lawsTakeWho() ? this.aliasPart(arc[0], 'who') : undefined;
		const aliasName = arc.length === 1 && this._aliases.has(arc[0].verb) ? arc[0].verb : undefined;
		const aliasRearm = aliasName ? this._aliases.get(aliasName)!.rearm : undefined;
		// All units shouting one line is never what is meant: it is the commander's own.
		const speaks = home.lawsTakeWho() && home.voice !== home && arcSteps(arc).every((part) => part.verb === 'say');
		if (!home.addLaw({ rearm: aliasRearm, ...reactionOf(step.args), name: name ?? aliasName, who: who ?? aliasWho ?? (speaks ? 'me' : undefined), watch, arc })) {
			return { status: 'failed', verb: 'law', reason: `no law${name ? ` ${name}` : ''}: too many laws, or a bad name; unlaw one first` };
		}
		return { status: 'ok', verb: 'law' };
	}

	/** Handles the `command` verb produced by {@link Collective}s. */
	private handleIssue(
		collective:Collective<TCtx>,
		issuer:ArcRunner<TCtx>,
		step:Step,
		ctx:TCtx | undefined,
	):ArcResult | Promise<ArcResult> {
		// Validation keeps command at an Arc's root; an alias or a host's law can still bring one to a unit, which takes orders.
		if (issuer !== collective.voice) {
			return { status: 'failed', verb: 'command', reason: 'only your commander issues orders' };
		}
		const who = typeof step.args.who === 'string' ? step.args.who.trim() : '';
		const arc = arcArg(step.args.arc, this._verbs);
		if (!who || !arc) {
			return { status: 'failed', verb: 'command', reason: 'command needs who and arc' };
		}
		const cat = this.collectiveCatalog(collective, issuer, ctx);
		const named = cat ? evaluateWho(who, cat, collective) : [];
		const troops = named.filter((c) => c !== collective.commander);
		if (troops.length === 0) {
			return { status: 'failed', verb: 'command', reason: named.length > 0 ? 'command never lands on the commander' : noUnitReason(who, cat) };
		}
		// Those its think chose to leave at what they are doing.
		const kept = Array.isArray(step.args.keep) ? step.args.keep as string[] : [];
		const appended = Array.isArray(step.args.append) ? step.args.append as string[] : [];
		if (troops.every((c) => kept.includes(c.id))) {
			return { status: 'ok', verb: 'command' };
		}
		const maxUnits = collective.maxUnitsPerCommand;
		if (maxUnits !== undefined && troops.length > maxUnits) {
			return { status: 'failed', verb: 'command', reason: `that is ${troops.length} units; a command names ${maxUnits === 1 ? 'one' : `at most ${maxUnits}`}` };
		}
		const group = typeof step.args.group === 'string' ? step.args.group : undefined;
		const taking = troops.filter((c) => !kept.includes(c.id) && !c.runs(arc));
		const name = collective.command(troops.filter((c) => !kept.includes(c.id)), arc, group, appended);
		if (taking.length > 0) {
			this._thinkFn?.({ kind: 'command', who: issuer.voice.id, to: taking.map((c) => c.id), arc, text: formatArc(arc, this._verbs) });
		}
		// A group ordered without its name gets one, and is told it.
		return name && !group?.trim() ? { status: 'ok', verb: 'command', reason: `no group= given: called them ${name}` } : { status: 'ok', verb: 'command' };
	}

	// ---- Arc checks ----

	private _repairUnknownFields = false;
	private _thinkFn:((event:ThinkEvent)=>void) | undefined;
	private _replaceCheck = false;

	/**
	 * Before an Arc cuts short work not finished (a program with its steps still to do, or that has not gone once round
	 * its loop), ask the model, in a short follow-up to that same think, what to do with each, told where it has got to:
	 * replace it, append the new work to it, or keep it and drop the new work. Off by default.
	 */
	public withReplaceCheck(on = true):this {
		this._replaceCheck = on;
		return this;
	}

	/**
	 * Why the Arc `owner`'s mind just wrote could never work as written. Only what no change in the world would mend: what
	 * is merely not so right now (nobody near, too far, no gold yet) is for the verb to say as it runs. A
	 * {@link BlockedArcError} when the world changed under the reply instead (a thing it saw went while it thought): no
	 * repair turn mends that, since the prompt still shows the old world, so the mind thinks again from a fresh one.
	 */
	private arcProblem(owner:ArcRunner<TCtx>, arc:Arc):ArcError | undefined {
		const voice = owner.voice;
		const ctx = this.tryCtx(voice.id);
		// Its own cache: a look at a reply must not use up the change `hasRisen` is waiting to see.
		const catalog = ctx === undefined ? undefined : this.exprCatalog(voice, ctx, new SampleCache());
		const bound = new Set(['fail']);
		let gone:string | undefined;
		eachStep(arc, this._verbs, (step) => {
			const named = typeof step.args.through === 'string' ? /^\s*(\w+)\s+in\b/.exec(step.args.through)?.[1] : undefined;
			if (named) {
				bound.add(named);
			}
		});
		const known = (name:string):boolean => bound.has(name) || name === this._mindDefaults.settings.currency || !!catalog?.names.has(name)
			|| !!this.character(name) || !!this.collective(name) || !this._world || !!this._rts || this._world.find(name) !== undefined || !!this._world.isItem?.(name);
		let problem:string | undefined;
		eachStep(arc, this._verbs, (step, verbs) => {
			const spec = verbs.get(step.verb);
			for (const [key, value] of Object.entries(step.args)) {
				const kind = argKind(spec, key);
				if (typeof value === 'string' && (kind === 'watch' || kind === 'expr' || (kind === 'id' && /[(.]|=>/.test(value)))) {
					problem ??= this.exprProblem(value, catalog, known);
				}
				// Only the step that runs next, of a stock verb: something can come to be by a later one, and a host's own verb may
				// aim at what only it knows.
				else if (kind === 'id' && typeof value === 'string' && step === firstStep(arc) && this._stockHandlers.has(step.verb) && !known(bareName(value))) {
					gone ??= problem === undefined ? this.goneSince(voice, bareName(value)) : undefined;
					problem ??= gone ?? `there is no ${bareName(value)}`;
				}
				else if (kind === 'bundle' && isCountMap(value)) {
					const notItem = this._world?.isItem && Object.keys(value).find((name) => name !== this._mindDefaults.settings.currency && !this._world!.isItem!(name));
					problem ??= notItem ? `'${notItem}' is not an item: the terms of a trade are {"ItemName":count}` : undefined;
				}
			}
		});
		const reason = problem ?? this.lawProblem(owner, arc) ?? this.commandProblem(owner, arc);
		return reason === undefined ? undefined : reason === gone ? new BlockedArcError(reason) : new ArcError(reason);
	}

	/**
	 * Why an arc may not aim at `id`, which nothing in the world answers to, when the mind has seen it: it was there when it
	 * looked and went while it thought (burned, picked up). Undefined for a name it never saw.
	 */
	private goneSince(voice:ArcRunner<TCtx>, id:string):string | undefined {
		const name = voice.mind?.nameOf(id) ?? id;
		return voice.persona.memory.all().some((row) => row.tags.includes(`seen:${name}`)) ? `${name} is gone since you looked` : undefined;
	}

	/** Why `expr` can never work: it does not read, misuses the language, or names what is not in this world. */
	private exprProblem(expr:string, catalog:Catalog | undefined, known:(name:string)=>boolean):string | undefined {
		const broken = watchProblem(expr, catalog);
		if (broken || !catalog) {
			return broken;
		}
		const { error } = evaluate(expr, catalog);
		if (error?.reason === 'fieldCall' || error?.reason === 'misuse') {
			return `${expr}: ${error.message}`;
		}
		const toks = lex(expr);
		const params = lambdaParams(toks);
		if (this._mindDefaults.settings.repairUnknownFields) {
			const plain = expr.replace(/"[^"]*"|'[^']*'/g, ' ');
			const entities = [catalog.me, ...catalogEntities(catalog)];
			const read = [...params].flatMap((param) => [...plain.matchAll(new RegExp(`\\b${param}\\.(\\w+)\\b(?!\\s*\\()`, 'g'))].map((m) => m[1]));
			const unread = read.find((field) => !ALWAYS_FIELDS.has(field) && !entities.some((entity) => entity.fields?.[field] !== undefined));
			if (unread) {
				return `${expr}: no one has a field '${unread}'. What something is, its tag: u is "Witch"`;
			}
		}
		const words = toks
			.filter((tok, n) => tok.kind === 'ident' && !['dot', 'qdot'].includes(toks[n - 1]?.kind) && toks[n + 1]?.kind !== 'lp' && !params.has(tok.raw) && !WATCH_WORDS.has(tok.raw))
			.map((tok) => tok.raw);
		const unknown = words.find((word) => !known(word) && evaluate(word, catalog).value.kind === 'absent');
		return unknown ? `${expr}: there is no ${unknown}` : undefined;
	}

	/** A law past the cap, or one it has already under another name. */
	private lawProblem(owner:ArcRunner<TCtx>, arc:Arc):string | undefined {
		const own = owner.laws.filter((law) => lawGroup(law.name) === '');
		let count = own.length;
		for (const step of arcSteps(arc)) {
			const name = typeof step.args.name === 'string' ? step.args.name : undefined;
			if (step.verb === 'unlaw') {
				count -= own.some((law) => law.name === name) ? 1 : 0;
			}
			if (step.verb !== 'law') {
				continue;
			}
			const body = arcArg(step.args.arc, this._verbs);
			const twin = owner.laws.find((law) => law.name !== name && law.watch === String(step.args.watch ?? '').trim()
				&& (step.args.who ?? law.who) === law.who && !!body && sameProgram(law.arc, body));
			if (twin) {
				return `that is your law ${twin.name} already`;
			}
			count += own.some((law) => law.name === name) ? 0 : 1;
			if (count > owner.maxLaws) {
				return `you have ${own.length} laws, the most you can (${own.map((law) => law.name).join(', ')}): unlaw one first`;
			}
		}
		return undefined;
	}

	/** An order that reaches no one right now, whom it asks for being a matter of who stands. Its own earlier groups count. */
	private commandProblem(owner:ArcRunner<TCtx>, arc:Arc):string | undefined {
		const collective = collectiveOf(owner);
		const voice = owner.voice;
		const catalog = collective && this.collectiveCatalog(collective, voice, this.tryCtx(voice.id));
		if (!collective || !catalog) {
			return undefined;
		}
		const groups:string[] = [];
		for (const step of arc) {
			if (step.verb !== 'command' || typeof step.args.who !== 'string') {
				continue;
			}
			const who = step.args.who;
			const named = evaluateWho(who, catalog, collective);
			if (named.length === 0 && !groups.some((group) => who.includes(group))) {
				return noUnitReason(who, catalog);
			}
			if (named.length > 0 && named.every((character) => character === collective.commander)) {
				return 'command never lands on the commander';
			}
			if (typeof step.args.group === 'string') {
				groups.push(step.args.group);
			}
		}
		return undefined;
	}

	/** The unfinished work `arc` would cut short: each unit an `command` of it reaches, and the voice, unless it takes no body. */
	private replacedBy(owner:ArcRunner<TCtx>, arc:Arc):Replacing[] {
		if (!this._replaceCheck) {
			return [];
		}
		const out:Replacing[] = [];
		const note = (runner:ArcRunner<TCtx>, next:Arc):void => {
			const now = runner.runs(next) ? undefined : runner.unfinished();
			if (now) {
				out.push({ id: runner.id, now, next: formatArc(next, this._verbs), looping: runner.inLoop() });
			}
		};
		const collective = collectiveOf(owner);
		const voice = owner.voice;
		for (const step of arc) {
			const orders = step.verb === 'command' ? arcArg(step.args.arc, this._verbs) : undefined;
			const catalog = orders && collective ? this.collectiveCatalog(collective, voice, this.tryCtx(voice.id)) : undefined;
			const named = catalog && typeof step.args.who === 'string' ? evaluateWho(step.args.who, catalog, collective!) : [];
			named.filter((character) => character !== collective?.commander).forEach((character) => note(character, orders!));
		}
		if (!voice.takesNoBody(arc)) {
			note(voice, arc);
		}
		return out;
	}

	/** What each mind is doing as it thinks, down to its reply as it is written, and the orders it gives: for a host to show. */
	public onThink(fn:(event:ThinkEvent)=>void):this {
		// It runs in the middle of reading a reply: a bug in how a host shows a think must not end the think.
		this._thinkFn = (event) => {
			try {
				fn(event);
			}
			catch (err) {
				this.emitLog({ name: 'ArcDirector', message: `onThink: ${err instanceof Error ? err.message : String(err)}`, error: true });
			}
		};
		return this;
	}

	// ---- Genre presets ----

	private _rts:RTS<TCtx> | undefined;

	/**
	 * An RTS: its kinds as data and a few primitives, each acting once (`RTSHost`). Registers the stock RTS verbs and
	 * runs them all: who does the work, routes, queues, supply, target picking, failure reasons. A unit or building
	 * whose tags name a kind gets that kind's verbs as its kit; a side's commander reads its stock, supply, queues
	 * and grouped units in its prompt. Movement needs `withWorld`.
	 */
	public withRTS(host:RTSHost):this {
		this._verbs.addAll(STOCK_RTS_VERB_DEFS);
		const rts = new RTS<TCtx>({
			host,
			world: () => this._world,
			character: (id) => this.character(id),
			collective: (id) => this.collective(id),
			pick: (call, expr) => this.pickIDs(call, expr),
			seen: (call) => (this._sightLook ? this.filterSight(this._sightLook(call.ctx)).objects.map((o) => o.id) : []),
			tell: (id, text) => this._rows.get(id)?.runner.tell({ kind: 'rts', text, major: true }),
			has: (verb) => this._verbs.has(verb),
		});
		this._rts = rts;
		for (const [verb, handler] of Object.entries(rts.handlers())) {
			this._stockHandlers.set(verb, handler);
		}
		for (const [name, alias] of Object.entries({ ...rts.aliases(), ...rts.renamed() })) {
			this.addVerb(name, alias);
		}
		this.rewire();
		return this;
	}

	/**
	 * An RPG to start from: `equip`, `unequip`, `steal`, `attack`, `block`, `heal` and `protect`, each registered with
	 * its args and help once the game gives its handler (`RPGHost`), and the game's own attacks and spells as
	 * `abilities`. Registers the stock verbs too; without `withDefaultKit`, characters get them, `offer` and these.
	 */
	public withRPG(host:RPGHost<TCtx>):this {
		this._crowd ??= RPG_CROWD;
		return this.withGenre(genreVerbs(STOCK_RPG_VERB_DEFS, host), STOCK_TRADE_VERBS);
	}

	/** A MOBA to start from: as `withRPG`, with its heroes' `attack`, `block`, `heal`, `protect` and `abilities`, and no `offer`. */
	public withMOBA(host:MOBAHost<TCtx>):this {
		return this.withGenre(genreVerbs(STOCK_MOBA_VERB_DEFS, host));
	}

	/** Register a genre's verbs and the stock ones; with `more`, they are the default kit unless `withDefaultKit` says otherwise. */
	private withGenre(verbs:readonly GenreVerbEntry<TCtx>[], more:readonly string[] = []):this {
		this._verbs.addAll(STOCK_VERB_DEFS);
		for (const { name, def, handler } of verbs) {
			if (!this._verbs.has(name)) {
				this._verbs.add(name, def);
			}
			this._handlers.set(name, handler);
		}
		this._defaultKit ??= { verbs: [...STOCK_VERBS, ...more, ...verbs.map((verb) => verb.name)] };
		this.rewire();
		return this;
	}

	/** The ids `expr` picks, as `call`'s character sees: its collective's `units` too. */
	private pickIDs(call:VerbCall<TCtx>, expr:string):string[] | { error:string } {
		const catalog = this.exprCatalog(call.character, call.ctx, new SampleCache());
		if (!catalog) {
			return { error: 'nothing to pick from' };
		}
		const r = evaluate(expr, catalog);
		if (r.error) {
			return { error: r.error.message };
		}
		return idsInVal(r.value);
	}

	// ---- Perception (sight, hearing, kernels, catalogs) ----

	private _senses:Record<string, Sense<TCtx>> = {};
	private _sightLook:((ctx:TCtx)=>Sight) | undefined;
	private _inventoryLook:((ctx:TCtx)=>Inventory) | undefined;
	private _sightLimitDefault:number | undefined;
	private _sightUnitName:string | undefined;
	private _contextFn:((id:string)=>TCtx | undefined) | undefined;
	private _kernelFn:KernelSource<TCtx> | undefined;
	private _seenFn:SeenName<TCtx> | undefined;
	/** The sound each verb makes, and what muffles a sound for a listener, once {@link withHearing} is set. */
	private _hearing:{ noise:ReadonlyMap<string, Sound>; limit:number; range:HearingRange; onSound?:SoundListener } | undefined;
	/** The sounds going on, by name and where: when each was made, and how loud each mind was last told it was. */
	private readonly _sounds = new Map<string, { from:string | Vec; sound:Sound; at:number; told:Map<ArcRunner<TCtx>, number> }>();

	public addSense(name:string, spec:Sense<TCtx>):this {
		this._senses[name] = spec;
		this.rewire();
		return this;
	}

	public withSight({ look, limit, unitName }:{
		look?:(ctx:TCtx)=>Sight;
		limit?:number;
		unitName?:string;
	}):this {
		if (limit !== undefined) {
			this._sightLimitDefault = limit;
		}
		if (unitName !== undefined) {
			this._sightUnitName = unitName;
		}
		if (look) {
			this._sightLook = look;
			this._senses.sight = {
				description: sightDistanceDescription(this._sightUnitName),
				gather: (ctx) => {
					const snap = this.filterSight(look(ctx));
					return formatSight(snap, this.sightFormatOpts());
				},
			};
		}
		else if (this._senses.sight) {
			this._senses.sight.description = sightDistanceDescription(this._sightUnitName);
		}
		this.rewire();
		return this;
	}

	/**
	 * How each mind names other characters. `seen` returns a base name from what the mind holds about
	 * the target; its owner's book keeps that name stable and numbers duplicates (`EnemyWitch2`).
	 * Applied to sight, earshot, heard speech, watch-language entities, and event `who`. Arcs, laws and
	 * watches are kept in ids: each mind turns its model's names into ids as it reads a reply.
	 */
	public withNames({ seen }:{ seen:SeenName<TCtx> }):this {
		this._seenFn = seen;
		this.rewire();
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
		this._inventoryLook = look;
		this._senses.carrying = {
			description: 'What you wear and carry.',
			gather: (ctx) => formatInventory(look(ctx), this._mindDefaults.settings.currency),
		};
		this.rewire();
		return this;
	}

	public removeSense(...names:string[]):this {
		for (const name of names) {
			delete this._senses[name];
		}
		this.rewire();
		return this;
	}

	public withContext(fn:(id:string)=>TCtx | undefined):this {
		this._contextFn = fn;
		return this;
	}

	public withKernels(fn:KernelSource<TCtx>):this {
		this._kernelFn = fn;
		this.rewire();
		return this;
	}

	/**
	 * NPCs hear sounds as they hear speech. A sound is as loud as its `loudness` (0–1) times how clearly `range` carries
	 * it to a listener: by default an inverse-square drop out to `max`, halved where sound does not pass straight
	 * between them (`canPass`, heard `muffled`),
	 * or the game's own `(listenerID, source) => 0–1`. Heard from {@link AUDIBLE} up. `noise` is the sound each verb
	 * makes while it runs (`go_to: { name: 'footsteps', loudness: 0.4 }`): its help says how far that carries, so a mind
	 * knows which of its own deeds can be heard, and from where. Any other sound the host makes with {@link emitSound}.
	 * A mind is told at most `limit` sounds a think, the loudest; none it sees the source of. `onSound` hears every
	 * sound too, as it is made and again each tick while it goes on, for whatever has no mind: a game's simple bots
	 * turning toward a noise. Needs `withWorld`.
	 */
	public withHearing({ noise = {}, limit = 5, range, onSound }:{
		noise?:Record<string, Sound>;
		limit?:number;
		range?:Partial<typeof DEFAULT_HEARING> | ((listenerID:string, source:SoundSource)=>number);
		onSound?:SoundListener;
	} = {}):this {
		this._hearing = { noise: new Map(Object.entries(noise)), limit, range: typeof range === 'function' ? range : { ...DEFAULT_HEARING, ...range }, onSound };
		this.syncVerbSchemas();
		return this;
	}

	/**
	 * `sound` made at `from`: a character or thing the world places (it moves with it), or a point. Every mind in earshot
	 * is told it, from whichever of its characters hears it loudest, as an event it reads in its next think (`You hear
	 * footsteps LOUDLY 1 pace behind you!`); one heard {@link LOUD} or louder makes it think. A sound that goes on
	 * (`seconds`) is told again only once it is heard a step louder (`!`, then `LOUDLY`). The same sound made again at
	 * the same place or by the same thing replaces it, so a game keeps a sound going by making it again. Its maker's own
	 * mind does not hear it. Returns what ends it early.
	 */
	public emitSound(from:string | Vec, sound:Sound):()=>void {
		if (!this._hearing) {
			return () => undefined;
		}
		const key = `${sound.name}@${typeof from === 'string' ? from : from.map(Math.round).join(',')}`;
		const made = { from, sound, at: this._time, told: this._sounds.get(key)?.told ?? new Map<ArcRunner<TCtx>, number>() };
		this._sounds.set(key, made);
		this.hear(key);
		const end = ():void => {
			if (this._sounds.get(key) === made) {
				this._sounds.delete(key);
			}
		};
		if (!((sound.seconds ?? 0) > 0)) {
			end();
		}
		return end;
	}

	/** How loud a sound going on is at character `listenerID` now, and from where; nothing when it is not heard. */
	private heardBy(listenerID:string, { from, sound, at }:{ from:string | Vec; sound:Sound; at:number }):{ level:number; source:SoundSource; muffled:boolean } | undefined {
		const world = this._world;
		const range = this._hearing?.range;
		if (!world) {
			return undefined;
		}
		const point = typeof from === 'string' ? poseOf(world, from)?.point : from;
		const here = poseOf(world, listenerID)?.point;
		if (!range || !point || !here || from === listenerID) {
			return undefined;
		}
		const source:SoundSource = typeof from === 'string' ? { id: from, point } : { point };
		const muffled = typeof range !== 'function' && !passes(world, 'sound', point, here);
		const clarity = typeof range === 'function' ? range(listenerID, source) : clarityAt(distance(here, point), range) * (muffled ? range.occluded : 1);
		const level = Math.min(1, loudnessAfter(sound, this._time - at) * clarity);
		return level >= AUDIBLE ? { level, source, muffled } : undefined;
	}

	/** Tell every mind that hears the sound `key` of it, where it is new to them or a step louder than they were told. */
	private hear(key:string):void {
		const made = this._sounds.get(key);
		const world = this._world;
		if (!made || !world || !this._hearing) {
			return;
		}
		this._hearing.onSound?.(made.from, made.sound, (listenerID) => this.heardBy(listenerID, made)?.level ?? 0);
		const maker = typeof made.from === 'string' ? this.character(made.from) : undefined;
		// Each mind hears it through whichever of its characters hears it loudest.
		const loudest = new Map<ArcRunner<TCtx>, { id:string; level:number; source:SoundSource; muffled:boolean }>();
		for (const character of this.characters()) {
			const owner = character.owner;
			const heard = owner && owner !== maker?.owner ? this.heardBy(character.id, made) : undefined;
			if (owner && heard && heard.level > (loudest.get(owner)?.level ?? 0)) {
				loudest.set(owner, { id: character.id, ...heard });
			}
		}
		for (const [owner, { id, level, source, muffled }] of loudest) {
			const step = loudnessStep(level);
			// Told already, and no louder; or there in plain sight, which says it already.
			if (step <= (made.told.get(owner) ?? -1) || (source.id !== undefined && this.sees(id, source.id))) {
				continue;
			}
			made.told.set(owner, step);
			const pose = poseOf(world, id)!;
			const text = heardText(made.sound, level, pose.point, source.point, { facing: pose.facing, up: world.up, muffled, unitName: this._sightUnitName });
			owner.tell({ kind: 'sound', text, tags: ['sound'], timestamp: this._time, key, cap: this._hearing.limit, weight: level, ...level >= LOUD ? { major: true } : {} });
		}
	}

	/** The sounds going on, heard again as their makers and listeners move; those that ran their time end. */
	private tickSounds():void {
		for (const [key, { sound, at }] of this._sounds) {
			if (this._time - at >= (sound.seconds ?? 0)) {
				this._sounds.delete(key);
			}
			else {
				this.hear(key);
			}
		}
	}

	/**
	 * Who outside `collective` its character `id` sees, nearest first, as `mind` says them: `EnemyKnight 8m (in reach)`.
	 * Characters only, as far as sight reaches; whether in reach where the host's sight says.
	 */
	private othersSeenBy(id:string, collective:Collective<TCtx>, mind:Mind<TCtx>):{ name:string; away:number; text:string }[] {
		const ctx = this._sightLook ? this.tryCtx(id) : undefined;
		if (ctx === undefined) {
			return [];
		}
		const snap = this.filterSight(this._sightLook!(ctx));
		const members = new Set(collective.characters.map((c) => c.id));
		return snap.objects
			.filter((o) => !members.has(o.id) && (o.tags.includes(RESERVED_TAGS.character) || this.character(o.id) !== undefined))
			.map((o) => ({ o, away: distance(o.point, snap.self.point) }))
			.filter(({ o, away }) => o.always || away <= DEFAULT_SIGHT.radius)
			.sort((a, b) => a.away - b.away)
			.map(({ o, away }) => ({ name: o.id, away, text: `${mind.nameOf(o.id) || o.id}${o.hp !== undefined && o.maxHP !== undefined ? ` ${o.hp}/${o.maxHP} hp` : ''} ${formatMeasure(quantizeDistance(away, DEFAULT_SIGHT.closeness), this._sightUnitName ?? DEFAULT_SIGHT.unitName)}${o.inReach === undefined ? '' : o.inReach ? ' (in reach)' : ' (out of reach)'}` }));
	}

	/** Character `id`'s health by the host's `hp` kernel; nothing without one. */
	private healthOf(id:string):{ hp:number; maxHP:number } | undefined {
		const ctx = this._kernelFn ? this.tryCtx(id) : undefined;
		if (ctx === undefined) {
			return undefined;
		}
		const kernels = this._kernelFn!(ctx);
		return kernels.hp?.(kernels.me);
	}

	/** Whether character `fromID` sees `toID` now, by `withSight`, as far as sight reaches; `undefined` when there is no sight to ask. */
	private sees(fromID:string, toID:string):boolean | undefined {
		const ctx = this._sightLook ? this.tryCtx(fromID) : undefined;
		if (ctx === undefined) {
			return undefined;
		}
		const snap = this.filterSight(this._sightLook!(ctx));
		return snap.objects.some((o) => o.id === toID && (o.always || distance(o.point, snap.self.point) <= DEFAULT_SIGHT.radius));
	}

	/** Whether light passes from where `fromID` is to where `toID` is (`canPass`). No `canPass` means yes. One with no place means no. */
	private inLineOfSight(fromID:string, toID:string):boolean {
		const world = this._world;
		if (!world?.canPass) {
			return true;
		}
		const from = poseOf(world, fromID)?.point;
		const to = poseOf(world, toID)?.point;
		return !!from && !!to && passes(world, 'light', from, to);
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
			? Math.max(0, this._time - lastTimestamp)
			: undefined;
		const side = !this._rts ? undefined : runner instanceof Collective ? runner.id : (runner as Character<TCtx>).collective?.id ?? runner.id;
		// What happened since its mind last thought, as `events`: `events.filter("sound")`. A unit reads its collective's.
		const listener = mind ?? (runner instanceof Character ? runner.collective?.mind : undefined);
		const events:ExprVal = { kind: 'list', value: (listener?.events() ?? []).map((e, i):ExprVal => ({
			kind: 'entity',
			value: dummyEntity(`event${i + 1}`, { tags: [e.kind, ...e.tags ?? []], fields: { secondsAgo: { kind: 'number', value: Math.max(0, this._time - (e.timestamp ?? this._time)) } } }),
		})) };
		return {
			...kernels,
			...geometry,
			// Each character among them with what it is at, so `doing(u, "go_to")` and `isBusy(u)` read it.
			others: kernels.others.map((e) => {
				const character = this.character(e.id);
				return character ? { ...e, fields: { ...e.fields, ...doingFields(character) } } : e;
			}),
			// Who sees whom, where the host's kernels say; else where light passes.
			canSee: kernels.canSee ?? (this._world?.canPass ? (a, b) => this.inLineOfSight(a.id, b.id) : undefined),
			bindings: { events, ...kernels.bindings, ...side ? this._rts!.bindings(side) : {} },
			// Its watches by name, so `wait(until=fallen || idle)` reads them.
			watches: listener?.persona.watchList(),
			cache,
			hasHeard: mind?.hasHeard() ?? false,
			prev: {
				secondsAgo: ago,
				me: this.prevMeOf(runner, kernels),
				verbs: last
					? [{
						secondsAgo: ago ?? 0,
						isOk: last.status === 'ok',
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
	private namedKernels<TKernels extends Pick<HostKernels, 'others' | 'items' | 'bindings' | 'lookup'>>(
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
		const lookup = kernels.lookup && this.namedLookup(mind, kernels.lookup);
		return { ...kernels, others: kernels.others.map(named), items: kernels.items.map(named), bindings, ...lookup ? { lookup } : {} };
	}

	/**
	 * The host's `lookup` in `mind`'s names, as `namedKernels` names a binding: an entity under the name the mind gives it,
	 * and also found by that name.
	 */
	private namedLookup(mind:Mind<TCtx>, lookup:(name:string)=>ExprVal | undefined):(name:string)=>ExprVal | undefined {
		const named = (val:ExprVal | undefined):ExprVal | undefined => (val?.kind === 'entity' ? { kind: 'entity', value: { ...val.value, name: mind.seen(val.value) } } : val);
		return (name) => {
			const found = lookup(name);
			if (found) {
				return named(found);
			}
			const id = mind.persona.names.resolve(name);
			const known = id === name ? undefined : named(lookup(id));
			return known?.kind === 'entity' && known.value.id === id && known.value.name === name ? known : undefined;
		};
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

	/** The host naming policy as one mind sees it: by its owner's id, from its voice's context. */
	private seenAs(mind:Mind<TCtx>):((target:NameTarget)=>string) | undefined {
		const seen = this._seenFn;
		if (!seen) {
			return undefined;
		}
		// Its context only when the policy reads it: a kernel set names every entity in it, many times a frame.
		const tryCtx = ():TCtx | undefined => this.tryCtx(mind.thinkThread());
		return (target) => seen({ id: mind.id, get ctx() {
			return tryCtx();
		} }, target);
	}

	/** Host look, minus what is out of sight, with everything seen under `mind`'s name for it. */
	private see(mind:Mind<TCtx>, ctx:TCtx):Sight {
		const snap = this.filterSight(this._sightLook!(ctx));
		return {
			...snap,
			objects: snap.objects.map((o) => {
				const doing = o.doing ?? this.seenDoing(o.id, mind);
				return { ...o, ...this._seenFn ? { id: mind.seen(o) } : {}, ...doing ? { doing } : {} };
			}),
		};
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

	/** `snap` without what light does not reach from where it is seen (`canPass`), but what everyone sees (`always`). */
	private filterSight(snap:Sight):Sight {
		const world = this._world;
		if (!world?.canPass) {
			return snap;
		}
		return { ...snap, objects: snap.objects.filter((o) => o.always || passes(world, 'light', snap.self.point, o.point)) };
	}

	/** What character `id` is seen doing, in its verb's own words and `mind`'s names: `going to Cottage`. Nothing while idle or waiting. */
	private seenDoing(id:string, mind:Mind<TCtx>):string | undefined {
		const character = this.character(id);
		const step = character?.verb && character.verb !== 'wait' ? character.lastStep : undefined;
		return step && stepDoing(step, this._verbs, (name) => mind.nameOf(name) || name);
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
		const salience = new Map<string, number>();
		const owner = mind.owner;
		if (owner instanceof Collective && owner.characters.length > 0 && this._contextFn && !this.tryCtx(mind.thinkThread())) {
			const groups:{ unitID:string; clauses:ReturnType<typeof formatSightClauses> }[] = [];
			for (const character of owner.characters) {
				const memberCtx = this.tryCtx(character.id);
				if (!memberCtx) {
					continue;
				}
				const snap = this.see(mind, memberCtx);
				sightSalience(snap, salience);
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
			return this.shown(mind, orderSightClauses(merged, scores, limit, focus.length > 0), salience);
		}
		const snap = this.see(mind, ctx);
		sightSalience(snap, salience);
		const bag = this._inventoryLook?.(ctx);
		for (const item of [...bag?.pockets ?? [], ...bag?.pack?.items ?? [], ...Object.values(bag?.worn ?? {})]) {
			salience.set(item, CARRIED_SALIENCE);
		}
		const clauses = formatSightClauses(snap, this.sightFormatOpts());
		if (focus.length > 0) {
			this.scoreSightObjects(snap.objects, focus, ctx, mind.voice, scores);
		}
		return this.shown(mind, orderSightClauses(clauses, scores, limit, focus.length > 0), salience);
	}

	/** The sight text `mind` is shown; it remembers each name in it as last seen there, and recalls by what is salient. */
	private shown(mind:Mind<TCtx>, clauses:SightClause[], salience:ReadonlyMap<string, number>):string {
		internalsOf(mind).sighted(clauses, salience);
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
			me: dummyEntity(collective.id, { tags: [RESERVED_TAGS.character] }),
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
			// A character in a collective reads its roster (`units`) too, as its laws do.
			const collective = runner instanceof Character ? runner.collective : undefined;
			const kernels = this.kernelsFor(runner, ctx);
			return collective ? buildCollectiveCatalog(kernels, collective) : buildCatalog(kernels);
		}
		return runner instanceof Collective ? this.collectiveCatalog(runner, runner, undefined) : undefined;
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
				views.push(buildCollectiveCatalog(this.kernelsFor(character, ctx), owner, owner.commander ?? undefined));
			}
		}
		return views.length > 0 ? views : thinker;
	}

	// ---- Mind configuration ----

	private readonly _mindDefaults = new MindDefaults();
	private _tools:Record<string, ToolSpec<TCtx>> = {};
	public talk:TalkNet | undefined;
	private _map:MapSense | undefined;
	private _knowledge:KnowledgeSource<TCtx> | undefined;
	private _mentionCap:number | undefined;

	/**
	 * The director's layer of every mind's settings: `withMind((m) => m.withCurrency('gold').withSkipHeartbeat())`. A
	 * mind reads each setting from its own (its spec's `mind`), else this layer, else the library's; a change here
	 * reaches every mind on its next think. The director reads its `currency` and `repairUnknownFields` from here too.
	 */
	public withMind(configure:(mind:MindDefaults)=>void):this {
		configure(this._mindDefaults);
		// The queue keeps its own copy of what wakes a mind.
		for (const mind of this.castMinds()) {
			this.enqueue(mind);
		}
		return this;
	}

	/**
	 * ### Add an LLM tool that minds can call.
	 * - `description` is the tool's description.
	 * - `parameters` is the tool's arguments' JSON schema.
	 * - `handler` is the function that will be called when the tool is called. Returns a promise or a value.
	 * Requires `withKernels` to look up entities by ID and `getPose` to get their position.
	 * Adding a tool of the same name as an existing one replaces it.
	 */
	public addTool(name:string, spec:ToolSpec<TCtx>):this {
		this._tools[name] = spec;
		return this;
	}

	/**
	 * A tool `name` that looks ahead in a game for the mind that calls it: the best moves from where it stands, each
	 * with its chance to win and the line expected after it. Add one per game (`chess_move`, `plan_build`); a kit's
	 * `tools` grants it like any tool.
	 */
	public addSearch<TState>(name:string, spec:SearchSpec<TCtx, TState>):this {
		return this.addTool(name, searchTool(spec));
	}

	public removeTool(...names:string[]):this {
		for (const name of names) {
			delete this._tools[name];
		}
		return this;
	}

	public withTalk(
		senseOrTalk:TalkSense | TalkNet,
		onSpoke?:(utterance:SpeechUtterance)=>void,
		config?:Partial<TalkConfig<TCtx>>,
	):this {
		if (senseOrTalk instanceof TalkNet) {
			this.talk = senseOrTalk;
		}
		else {
			const { repeats, ...rest } = config ?? {};
			// A repeats function is asked with the speaker's context; one with none to give is refused.
			const byID = typeof repeats === 'function'
				? (id:string, text:string):boolean | string => {
					const ctx = this.tryCtx(id);
					return ctx !== undefined && repeats(ctx, text);
				}
				: repeats;
			this.talk = new TalkNet(senseOrTalk, onSpoke, { ...rest, ...byID === undefined ? {} : { repeats: byID } });
		}
		this.rewire();
		return this;
	}

	public withMap(sense:MapSense):this {
		this._map = sense;
		this.rewire();
		return this;
	}

	/**
	 * What minds know of the world: articles `recall` searches beside memory, and brings up unasked when a name is said
	 * or heard. `mentions`: most articles shown per think that way (default `DEFAULT_MENTION_CAP`; 0 shows none).
	 */
	public withKnowledge(pages:KnowledgeSource<TCtx>, { mentions }:{ mentions?:number } = {}):this {
		this._knowledge = pages;
		this._mentionCap = mentions;
		this.rewire();
		return this;
	}

	/**
	 * Every standing offer, and each offer by or to a character `mind` thinks for. A collective with no body of its
	 * own does not have `offer` (its units do), and it still has to see the prices to send them.
	 */
	private offersSeenBy(mind:Mind<TCtx>):string {
		const owner = mind.owner;
		const traders = owner instanceof Collective ? [owner, ...owner.characters] : [owner];
		if (!traders.some((runner) => runner.activeVerbs().has('offer'))) {
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

	/** What `mind` needs from this director to think for `owner`, wired when it attaches. */
	private mindDeps(mind:Mind<TCtx>, owner:ArcRunner<TCtx>):MindDeps<TCtx> {
		return {
			thinksWith: () => this.modelFor(mind),
			defaults: this._mindDefaults.settings,
			senses: this.sensesFor(mind, owner),
			tools: this._tools,
			talk: this.talk,
			wayBlocked: (to) => (this._world ? wayBlocked(this._world, mind.thinkThread(), to) : to.map(() => undefined)),
			autoEnact: true,
			onChoose: (arc) => this.emitLog({ name: mind.thinkThread(), message: formatArc(arc, this._verbs) }),
			onGoalReached: (goal) => this._goalReachedFn?.(mind.id, goal),
			thinkWatch: () => this._thinkFn,
			replacing: (arc) => this.replacedBy(owner, arc),
			arcProblem: (arc) => this.arcProblem(owner, arc),
			queue: this._queue,
			embed: this._models.embedder(),
			map: this._map,
			knowledge: this._knowledge,
			mentionCap: this._mentionCap,
			offers: () => this.offersSeenBy(mind),
			seenAs: this.seenAs(mind),
			worldContext: () => this.tryCtx(owner.voice.id) ?? (owner instanceof Collective ? this.present(owner)?.ctx : undefined),
		};
	}

	/** The model `mind` thinks with now: the one its settings name, else the default; none until its server answered. */
	private modelFor(mind:Mind<TCtx>):MindModel {
		const live = this._models.live(mind.setting('model'));
		return {
			provider: live?.provider ?? NO_MODEL,
			id: live?.id ?? '',
			vision: live?.vision,
			contextTokens: live?.contextLength,
			thinking: live?.thinking ?? false,
			promptStyle: live?.prompt ?? 'full',
			jsonOnly: trainedOnArcDirector(live?.id ?? ''),
		};
	}

	private toolKnown(name:string):boolean {
		if (Object.hasOwn(this._tools, name)) {
			return true;
		}
		if (name === 'recall' || name === 'observe') {
			return true;
		}
		if (name === 'earshot' && this.talk) {
			return true;
		}
		if (name === 'see_map' && this._map && this._models.all().some((model) => model.vision)) {
			return true;
		}
		return false;
	}

	// ---- Cast (specs, rows, wiring, membership, handover, save) ----

	/** `restoreCast` before the cast is wired: it is built from it then. */
	private _stored:CastJSON | undefined;
	private _defaultKit:KitSource<TCtx> | undefined;
	private _cooldownDefault = DEFAULT_COOLDOWN;
	private _commanderVacantFn:((collective:Collective<TCtx>, character:Character<TCtx>)=>void) | undefined;
	/** `undefined` until the first handover picks the default; `false` when the host turned it off. */
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
	/** Every character and collective by id, in the order they were wired. */
	private readonly _rows = new Map<string, Row<TCtx>>();

	/** Game seconds a standing `choose` rests after a failed pick, for every runner without its own. Default 8. */
	public withCooldown(seconds:number):this {
		this._cooldownDefault = seconds;
		this.rewire();
		return this;
	}

	/** Used when a character or collective spec omits `kit`, a collective's characters too. */
	public withDefaultKit(kit:KitSource<TCtx>):this {
		this._defaultKit = kit;
		this.rewire();
		return this;
	}

	/** A collective's commander left or died. Name a new one with `collective.commander = …`. */
	public onCommanderVacant(fn:(collective:Collective<TCtx>, character:Character<TCtx>)=>void):this {
		this._commanderVacantFn = fn;
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

	/**
	 * A character on its own: an NPC with `mind` settings, or one the host drives (the Player) without them.
	 * Its id must be new among characters and collectives.
	 */
	public addCharacter(spec:CharacterSpec<TCtx>):this {
		this.claimID(spec.id);
		this._soloSpecs.push(spec);
		this._specs.set(spec.id, spec);
		if (this._wired) {
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
		if (this._wired) {
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
		const runner = this._rows.get(id)?.runner;
		const members = (runner instanceof Collective ? runner.characters : spec?.characters ?? []).map((c) => c.id);
		for (const member of members) {
			const memberSpec = this._specs.get(member);
			if (memberSpec) {
				this._soloSpecs.push(memberSpec);
			}
		}
		this.dropCollective(id);
		return this;
	}

	/** Character `id`, on its own or in a collective. Like every accessor of the cast, it wires the cast first. */
	public character(id:string):Character<TCtx> | undefined {
		this.wire();
		const runner = this._rows.get(id)?.runner;
		return runner instanceof Character ? runner : undefined;
	}

	/** Every character: on its own or in a collective. */
	public characters():Character<TCtx>[] {
		this.wire();
		return [...this._rows.values()].flatMap(({ runner }) => (runner instanceof Character ? [runner] : []));
	}

	public collective(id:string):Collective<TCtx> | undefined {
		this.wire();
		const runner = this._rows.get(id)?.runner;
		return runner instanceof Collective ? runner : undefined;
	}

	public collectives():Collective<TCtx>[] {
		this.wire();
		return [...this._rows.values()].flatMap(({ runner }) => (runner instanceof Collective ? [runner] : []));
	}

	/** Every mind that thinks: characters' own, then collectives'. */
	public minds():Mind<TCtx>[] {
		this.wire();
		return this.castMinds();
	}

	/** The minds of the cast wired so far, as {@link minds} lists them, without wiring it: for builders. */
	private castMinds():Mind<TCtx>[] {
		const runners = [...this._rows.values()].map((row) => row.runner);
		return [
			...runners.flatMap((runner) => (runner instanceof Character ? ownMindOf(runner) ?? [] : [])),
			...runners.flatMap((runner) => (runner instanceof Collective ? [runner.mind] : [])),
		];
	}

	/** A spec's kit, else the default one. Something that can run no verb is a mistake, so it throws. */
	private kitFor(spec:{ id:string; kit?:KitSource<TCtx>; tags?:readonly string[] }):KitSource<TCtx> {
		const kind = this._rts && spec.tags?.find((tag) => this._rts!.spec(tag));
		const kit = spec.kit ?? (kind ? this._rts!.kitOf(kind) : undefined) ?? this._defaultKit;
		if (!kit) {
			throw new Error(`ArcDirector: '${spec.id}' has no kit; give it one, or call withDefaultKit`);
		}
		if (typeof kit !== 'function' && kit.verbs.length === 0) {
			throw new Error(`ArcDirector: '${spec.id}' has a kit with no verbs`);
		}
		return kit;
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

	/** Kit names nothing registers: in `specs`, or in the default kit and every spec waiting to be wired. */
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
		if (parts.length > 0) {
			throw new Error(`ArcDirector: ${parts.join('; ')}`);
		}
	}

	/** Throw when a character or collective already has `id`: they share one namespace. */
	private claimID(id:string):void {
		if (this._specs.has(id) || this._collectiveSpecs.some((spec) => spec.id === id)) {
			throw new Error(`ArcDirector: '${id}' is already a character or a collective`);
		}
	}

	/** A runner's per-tick sample cache. */
	private cacheOf(runner:ArcRunner<TCtx>):SampleCache {
		return this._rows.get(runner.id)?.cache ?? new SampleCache();
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
			execute: async (step, ctx, signal) => this.dispatch(runner(), step, ctx, signal),
			abortArc: (id) => this.abortArc(id),
			cooldown: spec.cooldown ?? this._cooldownDefault,
			talk: this.talk,
			goTo: (target, opts) => this.goTo(runner().id, 'go_to', { target }, opts),
			aimGroup: (step) => this.aimGroup(runner(), step),
			walkToGroup: (verb, ids, opts) => this.walkToGroup(runner(), verb, ids, opts),
			catalog: this._kernelFn ? () => this.runnerCatalog(runner()) : undefined,
			kit,
			laws: spec.laws,
			maxLaws: spec.maxLaws,
		};
	}

	/** Wire a character: alone, or `into` a collective. `json` restores a save. */
	private wireCharacter(given:CharacterSpec<TCtx>, json?:CharacterJSON, into?:Collective<TCtx>):Character<TCtx> {
		// In an RTS a unit tagged with its kind gets that kind's tags too (`Worker`, `Fighter`), as one it trains does.
		const kind = this._rts && given.tags?.find((tag) => this._rts!.spec(tag));
		const spec = kind ? { ...given, tags: [...new Set([...given.tags ?? [], ...this._rts!.tagsOf(kind)])] } : given;
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
		const fields = internalsOf(character);
		if (standing) {
			this._standing.set(character, standing);
		}
		this._rows.set(spec.id, { spec, runner: character, cache: new SampleCache() });
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
			internalsOf(into).setCharacters([...into.characters, character]);
			fields.setCollective(into);
			moveLawsInto(character, internalsOf(into));
		}
		else if (json?.mind || spec.mind) {
			this.attachMind(character, json?.mind ? Mind.fromJSON(json.mind) : new Mind(spec.mind));
		}
		this.syncListener(character);
		this.stampPrev(character);
		return character;
	}

	/** Wire a collective, its characters, and its mind. `cast` restores from a save. */
	private wireCollective(spec:CollectiveSpec<TCtx>, cast?:CastJSON):Collective<TCtx> {
		this.checkNames(spec);
		const json = cast?.collectives[spec.id];
		const persona = json ? Persona.fromJSON(json.persona, spec) : new Persona(spec);
		persona.sightLimit ??= this._sightLimitDefault;
		const mind = json ? Mind.fromJSON<TCtx>(json.mind) : new Mind<TCtx>(spec.mind);
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
			isDown: (id) => this._world?.isDown?.(id) ?? false,
			othersSeenBy: (id, seer) => this.othersSeenBy(id, collective, seer),
			healthOf: (id) => this.healthOf(id),
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
		if (this._rts) {
			const rts = this._rts;
			collective.status = () => rts.status(collective.id);
		}
		collective.maxUnitsPerCommand = spec.maxUnitsPerCommand;
		this._rows.set(spec.id, { spec, runner: collective, cache: new SampleCache() });
		const ids = json ? json.characters : (spec.characters ?? []).map((c) => c.id);
		const chiefID = json ? json.commander : spec.commander;
		for (const id of ids) {
			const own = this._specs.get(id) ?? { id };
			// The commander runs its mind's orders, so without a kit of its own it has its collective's.
			this.wireCharacter(id === chiefID && !own.kit && spec.kit ? { ...own, kit: spec.kit } : own, cast?.characters[id], collective);
		}
		if (json) {
			internalsOf(collective).load(json);
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
		character.mindSettings = mind ? { ...mind.settings } : undefined;
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
		if (to && this._rows.get(to.id)?.runner !== to) {
			throw new Error(`ArcDirector: '${to.id}' is not a collective here`);
		}
		const { kept, dropped } = from ? this.leave(character, from, to) : { kept: [], dropped: [] };
		if (to) {
			this.join(character, to, kept);
		}
		else if (character.mindSettings) {
			this.attachMind(character, new Mind(character.mindSettings));
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
		this._handover ??= chatHandover((req) => this.chatModel().provider.chat(req), () => this.chatModel().id);
		this._journeyTicks += 1;
		const model = this._models.live();
		const full = !!model && this.thinkingOn(model.name) >= model.maxParallel;
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
					this.embedLater(memory.add({ category: 'semantic', text: line, tags: nameTags(line), timestamp: this._time }, this._time));
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
		internalsOf(from).setCharacters(from.characters.filter((c) => c !== character));
		internalsOf(character).setCollective(null);
		character.tags = character.tags.filter((t) => !from.ownsTag(t));
		const own = from.laws.filter((law) => lawGroup(law.name) === character.id);
		from.laws = from.laws.filter((law) => !own.includes(law));
		internalsOf(from).vacate(character);
		if (to) {
			return { kept: own, dropped: [] };
		}
		const dropped = own.filter((law) => usesCollective(law, this._verbs));
		for (const law of own.filter((l) => !dropped.includes(l))) {
			law.name = law.name.slice(character.id.length + 1);
			internalsOf(character).keepLaw(law);
		}
		return { kept: [], dropped };
	}

	/** Put `character` in `to`: its own mind goes (its settings are kept), and its laws move in as its own there. */
	private join(character:Character<TCtx>, to:Collective<TCtx>, carried:Law[]):void {
		const own = ownMindOf(character);
		if (own) {
			character.mindSettings = { ...own.settings };
		}
		this.dropOwnMind(character);
		internalsOf(to).setCharacters([...to.characters, character]);
		internalsOf(character).setCollective(to);
		moveLawsInto(character, internalsOf(to));
		for (const law of carried) {
			internalsOf(to).keepLaw(law);
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
			// A major event wakes a mind; this one wakes even a mind that skips them.
			this._queue.enqueueMajor(mind.id, true);
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
			internalsOf(character).setMind(null);
		}
	}

	/** Let `mind` think for `owner`: wire it, and give it a place in the think queue. */
	private attachMind(owner:Character<TCtx> | Collective<TCtx>, mind:Mind<TCtx>):void {
		if (owner instanceof Character) {
			internalsOf(owner).setMind(mind);
		}
		internalsOf(mind).attach(owner, this.mindDeps(mind, owner));
		mind.stamp(this._time);
		this.enqueue(mind);
		this._queue.setAiOn(mind.id, true);
	}

	/** Give `mind` its place in the think queue, with its watches. */
	private enqueue(mind:Mind<TCtx>):void {
		this._queue.ensure(mind.id, { skipHeartbeat: mind.setting('skipHeartbeat'), skipMajor: mind.setting('skipMajor'), skipStart: mind.setting('skipStart') });
		this._queue.setWatches(mind.id, mind.persona.effectiveWatches());
	}

	/** Stop `mind` thinking: its think in flight, and its place in the queue. It thinks for no one after. */
	private detachMind(mind:Mind<TCtx>):void {
		mind.abortThink();
		this._queue.setAiOn(mind.id, false);
		this._queue.drop(mind.id);
		let i = this._readyThink.length;
		while (i--) {
			if (this._readyThink[i].mindID === mind.id) {
				this._readyThink.splice(i, 1);
			}
		}
		internalsOf(mind).detach();
	}

	/** Speech said to a collective by name reaches its mind; what its characters hear does too (`syncListener`). */
	private listen(collective:Collective<TCtx>):void {
		this.talk?.attach(collective);
	}

	/** A character hears for the mind that thinks for it: its own, or its collective's. The host's hears nothing. */
	private syncListener(character:Character<TCtx>):void {
		const owner = character.owner;
		if (owner) {
			this.talk?.attach(owner, character.id);
		}
		else {
			this.talk?.detach(character.id);
		}
	}

	/** Take a character off the director: its arc, moves, talk, its own mind, and its place in a collective. */
	private dropCharacter(id:string):void {
		const character = this._rows.get(id)?.runner;
		if (!(character instanceof Character)) {
			return;
		}
		this._rows.delete(id);
		this.unwire(character);
		this.offers.drop(id);
		if (character.collective) {
			this.leave(character, character.collective);
		}
	}

	/** Take a collective off the director. Its characters stay, each on its own: a fresh mind if it had settings for one. */
	private dropCollective(id:string):void {
		const collective = this._rows.get(id)?.runner;
		if (!(collective instanceof Collective)) {
			return;
		}
		for (const character of [...collective.characters]) {
			this.moveCharacter(character, null);
		}
		this._rows.delete(id);
		this.unwire(collective);
	}

	/** Take `runner` off the director: its arc, its moves, what it hears, its own mind. Membership is the caller's. */
	private unwire(runner:Character<TCtx> | Collective<TCtx>):void {
		runner.replaceProgram();
		this._mover.stop(runner.id);
		this.talk?.detach(runner.id);
		if (runner instanceof Character) {
			this.dropOwnMind(runner);
		}
		else {
			this.detachMind(runner.mind);
		}
	}

	/** Every character and collective, as a save. Restore it with `restoreCast`. */
	public exportCast():CastJSON {
		const characters:Record<string, CharacterJSON> = {};
		for (const character of this.characters()) {
			characters[character.id] = character.toJSON();
		}
		const collectives:Record<string, CollectiveJSON> = {};
		for (const collective of this.collectives()) {
			collectives[collective.id] = collective.toJSON();
		}
		return { characters, collectives, offers: this.offers.toJSON(), time: this._time };
	}

	/**
	 * Rebuild the cast from `exportCast`, under the specs added here. Before the cast is wired it is kept, and the cast
	 * is built from it then. A collective's characters come from the save, so ones that joined or died stay that way.
	 */
	public restoreCast(cast:CastJSON):void {
		this._time = cast.time ?? this._time;
		if (!this._wired) {
			this._stored = cast;
			return;
		}
		this.clearCast();
		this.wireCast(cast);
	}

	/** Drop every character and collective quietly: no events, no new commanders, no fresh minds. */
	private clearCast():void {
		for (const character of this.characters()) {
			this.unwire(character);
			internalsOf(character).setCollective(null);
		}
		for (const collective of this.collectives()) {
			this.unwire(collective);
			internalsOf(collective).setCharacters([]);
		}
		this._rows.clear();
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
		}
	}

	// ---- Regions ----

	private readonly _regions = new Regions<TCtx>((id, watch) => {
		const r = this.evaluate(id, watch);
		return !r.error && fit(r.value) > 0;
	});

	/**
	 * ### Add a region to inject memories or run callbacks when characters touch it.

	 * Defined as either a box between two corners (`from`, `to`) or a ball (`center`, `radius`), in world coordinates (`Vec`s).
	 * - `who` (requires `withKernels`) filters what characters the region applies to.
	 * Either a predicate given the character's context, or a watch string from the character's perspective.
	 * - `memory` gets injected into the mind of characters inside the region and forgotten when they leave.
	 * - `onEnter`, `onStay` and `onExit` run for each character inside the region.
	 * - `until` removes the region once it returns true.
	 * - `center` can be either world coordinates or an entity's ID and the region follows it.
	 * Requires `withWorld` with `find` to look up entities by ID and `getPose` to get their position.
	 * - Adding a region of the same name as an existing one replaces it.
	 *
	 * ### Notes
	 * Regions are often the simplest way to give a mind what it needs, just when it needs it.
	 * The problem with goals and pinned memories is that they stay in the mind forever.
	 * A region's memory reaches the right characters at the right time and goes away when it becomes irrelevant.
	 * A room's atmosphere, the dread at a monster's lair, a character's presence and aura, an item's instruction manual,
	 * one character's own take on a place, a pep talk that triggers at the beginning of a journey.
	 * All of these keep the prompt short for better performance and the minds focused on what's relevant.
	 *
	 * ### Performance
	 * Cheap to have many of. With many regions and characters the check switches to sweep and prune, so it grows as
	 * `n log n` rather than `n²`.
	 */
	public addRegion(name:string, spec:RegionSpec<TCtx>):this {
		this.removeRegion(name);
		this._regions.add(name, spec);
		return this;
	}

	/** Remove regions defined by {@link addRegion}.
	 * On removal, everyone `who` counted as inside the region
	 * has their injected memories removed and `onExit` gets called.
	 * Regions not found by name are ignored.
	 */
	public removeRegion(...names:string[]):this {
		for (const name of names) {
			this._regions.remove(name, this._time);
		}
		return this;
	}

	// ---- Goals ----

	private _goalReachedFn:((id:string, goal:Goal<never>)=>void) | undefined;
	/** Each goal as it is reached, with the id of the mind whose goal it was: a cheer, a line on the screen. */
	public onGoalReached(fn:(id:string, goal:Goal<TCtx>)=>void):this {
		this._goalReachedFn = fn as (id:string, goal:Goal<never>)=>void;
		return this;
	}

	/** Every goal whose `until` holds is reached. As often as watches are sampled: a view per character is not cheap. */
	private tickGoals(minds:readonly Mind<TCtx>[]):void {
		for (const mind of minds) {
			for (const goal of mind.persona.goals.filter((g) => g.until && this.goalMet(mind.thinkThread(), g.until as NonNullable<Goal<TCtx>['until']>))) {
				mind.finishGoal(goal);
			}
		}
	}

	/** Whether `until` holds for character `id`, as it sees the world. One without a context yet is not asked. */
	private goalMet(id:string, until:NonNullable<Goal<TCtx>['until']>):boolean {
		if (typeof until === 'string') {
			const r = this.evaluate(id, until);
			return !r.error && fit(r.value) > 0;
		}
		const ctx = this.tryCtx(id);
		return ctx !== undefined && until(ctx);
	}

	// ---- Thinking (queue, drain, laws tick) ----

	private _queue:MindQueue = new ThinkQueue();
	private _rearm = DEFAULT_REARM;
	private _intervals = { watch: 0.05, think: 0.25 };
	/** Game time the `watch` interval and the `think` interval last fired at. */
	private _watchedAt:number | undefined;
	private _thoughtAt:number | undefined;
	/** Minds whose think in flight came of their heartbeat alone: their laws need not wait for it. */
	private readonly _beatThinks = new Set<string>();
	private readonly _readyThink:ThinkRow[] = [];
	/** Per model: when its waiting thinks started waiting for it to go idle. */
	private readonly _batchHeld = new Map<string, number>();

	/** The default queue, highest score first, with `opts`. */
	public withPriorityQueue(opts?:ThinkQueueOpts):this {
		return this.withQueue(new ThinkQueue(opts));
	}

	/** Your own queue, or `new SimpleQueue(opts)` (first in, first out). Every mind moves to it, and starts there as a new mind does. */
	public withQueue(queue:MindQueue):this {
		this._queue = queue;
		for (const mind of this.castMinds()) {
			this.enqueue(mind);
		}
		this.rewire();
		return this;
	}

	/**
	 * Game seconds a `when`'s or a law's watch must have been false before it may start again, unless it sets its own
	 * `rearm`. A reaction that started runs to its end whatever its watch does; this keeps one whose watch flickers (a foe
	 * at just the distance it watches for) from starting over and over. Default 1.
	 */
	public withRearm(seconds:number):this {
		this._rearm = Math.max(0, seconds);
		return this;
	}

	/**
	 * Game seconds between asks of the watches; each ask builds the world as each character sees it, which a frame cannot
	 * afford many times over. Every `watch` (default 0.05) every law, every parked `when` and every step's `until` is
	 * asked, so a reaction starts within one interval of its watch turning true; every `think` (default 0.25) the minds'
	 * own watches are sampled for the think queue, and goals' `until`s asked. Each fires once it is due and never catches
	 * up: `watch` fires on the first tick, `think` an interval after it. `0` asks every tick. A `within` is no watch: it ends
	 * on time.
	 */
	public withIntervals(intervals:{ watch?:number; think?:number }):this {
		this._intervals = { ...this._intervals, ...intervals };
		return this;
	}

	/** Cancel an in-flight think by mind id. */
	public abortThink(id:string):this {
		this._queue.abortThink(id);
		return this;
	}

	public mindQueue():MindQueue {
		return this._queue;
	}

	public setBatchThinks(on:boolean):void {
		this._queue.batchThinks = on;
	}

	public liveBatchThinks():boolean {
		return this.thinkBatchPolicy().batchThinks;
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
		character.dropFinishedLaws(() => [character.id]);
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
		collective.dropFinishedLaws((law) => (lawGroup(law.name) === '' ? evaluateWho(law.who, whoCat, collective).map((c) => c.id) : [lawGroup(law.name)]));
	}

	/**
	 * A think something called for is in flight or already queued, so a law must not walk the character out from under
	 * it. Not a heartbeat's: a mind that thinks on a beat always has one coming, and its laws would never act. Not
	 * before the mind's first think ends either: laws act from the start, not after the opening think.
	 */
	private thinkWaiting(mindID:string):boolean {
		if (!this._queue.hasThought(mindID)) {
			return false;
		}
		return (this._queue.isThinking(mindID) && !this._beatThinks.has(mindID))
			|| this._queue.hasPending(mindID, 'heartbeat')
			|| this._readyThink.some((row) => row.mindID === mindID && row.reason !== 'heartbeat');
	}

	/**
	 * Poll `runner`'s live session, or start the first law that holds. A voice waits for its mind's think, except a
	 * party's commander: that think is mostly orders for others, and its own laws (heal, keep back) cannot wait.
	 */
	private pollRunner(
		runner:ArcRunner<TCtx>,
		lawHandlers:()=>ArcHandler[],
		catalog:ArcSession['catalog'],
	):void {
		const extras = lawHandlers;
		const session = runner.arcSession;
		if (session) {
			if (catalog) {
				session.catalog = catalog;
			}
			session.now = () => this._time;
			session.rearm = this._rearm;
			session.extraHandlers = extras;
			session.abortHost = () => this.abortArc(runner.id);
			pollArcSession(session);
			return;
		}
		const probe = createArcSession({
			catalog,
			now: () => this._time,
			rearm: this._rearm,
			extraHandlers: extras,
		});
		const first = firstStartable(probe);
		const commander = runner instanceof Character && !!runner.collective;
		const mind = runner.isVoice && !commander ? runner.mind : null;
		if (first && !(mind && this.thinkWaiting(mind.id))) {
			runner.beginLaw(first, {
				catalog,
				now: () => this._time,
				rearm: this._rearm,
				abortHost: () => this.abortArc(runner.id),
				extraHandlers: extras,
			});
		}
	}

	/** The mind the queue knows as `id`: a character's own, or a collective's. */
	private mindByID(id:string):Mind<TCtx> | undefined {
		return ownMindOf(this.character(id)) ?? this.collective(id)?.mind;
	}

	/** The model a mind thinks with: its own, or the default. `''` before any resolved. */
	private modelOf(mind:Mind<TCtx>):string {
		return this._models.live(mind.setting('model'))?.name ?? '';
	}

	/** Thinks running on `model` now, the memory handover counting against the default. */
	private thinkingOn(model:string):number {
		const thinks = this.minds().filter((mind) => this._queue.isThinking(mind.id) && this.modelOf(mind) === model).length;
		return thinks + (this._handoverBusy && model === this._models.live()?.name ? 1 : 0);
	}

	/** Start ready thinks, best first, as far as each one's model has free slots. */
	private drain(now:number):void {
		const queue = this._queue;
		if (!this._connected) {
			return;
		}
		this._readyThink.sort((a, b) => {
			const score = queue.rankScore(b.mindID, b.score) - queue.rankScore(a.mindID, a.score);
			if (score !== 0) {
				return score;
			}
			return (this.mindByID(b.mindID)?.setting('rank') ?? 0) - (this.mindByID(a.mindID)?.setting('rank') ?? 0);
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
			if (row.reason === 'heartbeat') {
				this._beatThinks.add(row.mindID);
			}
			else {
				this._beatThinks.delete(row.mindID);
			}
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
		const live = this._models.live(model);
		if (!live) {
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
			batchThinks: this._queue.batchThinks ?? DEFAULT_BATCH_THINKS,
			batchWait: this._queue.batchWait ?? DEFAULT_BATCH_WAIT,
		};
	}

	private fireThink(mind:Mind<TCtx>, now:number):void {
		void mind.tick(now)
			.then((arc) => {
				if (!mind.attached) {
					return;
				}
				this._queue.setWatches(mind.id, mind.persona.effectiveWatches());
				if (!arc) {
					this._queue.noteResult(mind.id, true);
				}
			})
			.catch((err:unknown) => {
				if (!mind.attached) {
					return;
				}
				const text = err instanceof Error ? err.message : String(err);
				this.emitLog({ name: mind.thinkThread(), message: `stalled: ${text}` });
				this._queue.noteResult(mind.id, true);
				// An invalid reply ends no arc, so nothing would wake this mind: think again once, told why.
				// Aborts and inference errors are not the mind's doing.
				if (err instanceof ArcError) {
					const again = mind.lastResult?.verb !== 'think' || mind.lastResult.status === 'ok';
					const why = err instanceof BlockedArcError ? 'your plan cannot run' : 'your reply was not a valid Arc';
					mind.ingestResult({ status: 'failed', verb: 'think', reason: `${why}: ${text}` });
					if (again) {
						this._queue.enqueueVerb(mind.id, 'think', false);
					}
				}
			});
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

/** The collective `runner` acts in: itself, or the one its character belongs to. */
function collectiveOf<TCtx>(runner:ArcRunner<TCtx>):Collective<TCtx> | null {
	return runner instanceof Collective ? runner : runner instanceof Character ? runner.collective : null;
}
