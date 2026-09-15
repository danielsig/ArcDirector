import { registerStockVerbs, VerbRegistry, type StockVerb, type VerbArgMap } from '../action/registry.js';
import { formatPlan } from '../action/parse.js';
import type { ActionResult, Step } from '../action/types.js';
import { firstStep } from '../action/types.js';
import { Agent, type AgentDeps, type AgentJSON } from '../agent/agent.js';
import type { Kit, KitSource, Sense, ToolSpec } from '../agent/types.js';
import { TalkNet, type SpeechUtterance, type TalkConfig, type TalkSense } from '../agent/talk.js';
import type { MapSense } from '../agent/map.js';
import { buildCatalog, dummyEntity, type HostKernels } from '../expr/natives.js';
import { evaluate } from '../expr/eval.js';
import { watchScore } from '../expr/score.js';
import { SampleCache } from '../expr/types.js';
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
	CrowdConductor,
	isCrowdConductor,
	registerStockCrowdVerbs,
	STOCK_CROWD_VERBS,
	FORMATION_VERBS,
	evaluateWho,
	buildCrowdCatalog,
	planArg,
	lawMatches,
	type CrowdLawSpec,
	type CrowdUnitSpec,
	type StockCrowdVerb,
} from '../conductor/index.js';
import {
	DEFAULT_COOLDOWN,
	createPlanSession,
	firstStartable,
	pollPlanSession,
	type PlanHandler,
} from '../agent/run.js';
import type { ChatRequest, ChatResponse, InferenceProvider } from '../inference/provider.js';
import type { FakeChatFn } from '../inference/fake.js';
import { isVisionModel, type ModelInfo } from '../inference/models.js';
import { HttpProvider } from '../inference/http.js';
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
	type AgentSpec,
	type DirectorLog,
	type InferClock,
	type KernelSource,
	type StartOpts,
	type VerbHandler,
} from './types.js';

const STARTED = 'ArcDirector already started';

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

type AgentRow<HostCtx> = {
	spec:AgentSpec<HostCtx>;
	agent:Agent<HostCtx> | null;
	cache:SampleCache;
	rank:number;
};

function nowMs():number {
	return performance.now();
}

function whoFromMessages(req:ChatRequest):string {
	if (req.thread) {
		return req.thread;
	}
	for (const m of req.messages) {
		if (m.role !== 'system' || typeof m.content !== 'string') {
			continue;
		}
		const hit = /^You are ([^.]+)/.exec(m.content);
		if (hit) {
			return hit[1].trim();
		}
	}
	return 'ArcDirector';
}

function clipThought(text:string, max = 600):string {
	const t = text.replace(/\s+/g, ' ').trim();
	if (t.length <= max) {
		return t;
	}
	return `${t.slice(0, max)}…`;
}

export class ArcDirector<HostCtx = unknown> {
	private started = false;
	private disposed = false;
	private inference:InferenceSlot = { kind: 'unset' };
	private queueSlot:QueueSlot = { kind: 'default' };
	private queue:MindQueue | undefined;
	private http:HttpProvider | undefined;
	private verbs = new VerbRegistry();
	private readonly handlers = new Map<string, VerbHandler<HostCtx>>();
	private catchAll:VerbHandler<HostCtx> | undefined;
	private senses:Record<string, Sense<HostCtx>> = {};
	private tools:Record<string, ToolSpec<HostCtx>> = {};
	private losFn:((aID:string, bID:string)=>boolean) | undefined;
	private sightLook:((ctx:HostCtx)=>Sight) | undefined;
	private sightLimitDefault:number | undefined;
	private contextFn:((id:string)=>HostCtx | undefined) | undefined;
	private kernelFn:KernelSource<HostCtx> | undefined;
	private defaultKit:KitSource<HostCtx> | undefined;
	private cooldownDefault = DEFAULT_COOLDOWN;
	private talkSense:TalkSense | undefined;
	private onSpoke:((utterance:SpeechUtterance)=>void) | undefined;
	private talkConfig:Partial<TalkConfig> | undefined;
	talk:TalkNet | undefined;
	private map:MapSense | undefined;
	private abortPlanFn:((id:string)=>void) | undefined;
	private logFn:((entry:DirectorLog)=>void) | undefined;
	private ignoreMissing = false;
	private readonly pending:AgentSpec<HostCtx>[] = [];
	private readonly rows = new Map<string, AgentRow<HostCtx>>();
	private readonly readyThink:ThinkRow[] = [];
	private batchHeldAt:number | null = null;
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

	addSense(name:string, spec:Sense<HostCtx>):this {
		this.senses[name] = spec;
		return this;
	}

	addTool(name:string, spec:ToolSpec<HostCtx>):this {
		this.tools[name] = spec;
		return this;
	}

	withSight({ look, limit }:{ look?:(ctx:HostCtx)=>Sight, limit?:number }):this {
		this.assertBuilder();
		if (limit !== undefined) {
			this.sightLimitDefault = limit;
		}
		if (!look) return this;
		this.sightLook = look;
		this.senses.sight = {
			description: 'What you can see. Names only, distances in paces.',
			gather: (ctx) => {
				const snap = this.filterSight(look(ctx));
				return formatSight(snap);
			},
		};
		return this;
	}

	withCooldown(seconds:number):this {
		this.assertBuilder();
		this.cooldownDefault = seconds;
		return this;
	}

	withInventory(look:(ctx:HostCtx)=>Inventory):this {
		this.assertBuilder();
		this.senses.carrying = {
			description: 'What you wear and carry.',
			gather: (ctx) => formatInventory(look(ctx)),
		};
		return this;
	}

	withLineOfSight(fn:(aID:string, bID:string)=>boolean):this {
		this.assertBuilder();
		this.losFn = fn;
		return this;
	}

	/** Missing names are skipped. Empty rest is a no-op. */
	removeSense(...names:string[]):this {
		for (const name of names) {
			delete this.senses[name];
		}
		return this;
	}

	/** Missing names are skipped. Empty rest is a no-op. */
	removeTool(...names:string[]):this {
		for (const name of names) {
			delete this.tools[name];
		}
		return this;
	}

	withContext(fn:(id:string)=>HostCtx | undefined):this {
		this.assertBuilder();
		this.contextFn = fn;
		return this;
	}

	withKernels(fn:KernelSource<HostCtx>):this {
		this.assertBuilder();
		this.kernelFn = fn;
		return this;
	}

	/** Used when `addAgent` omits `kit`. Same object/callback as per-agent kit; fetched every tick. */
	withDefaultKit(kit:KitSource<HostCtx>):this {
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

	/** Schema-only crowd verbs (`when`, `law`, formations). Kit still has to grant them. */
	addStockCrowdVerbs(...verbs:StockCrowdVerb[]):this {
		registerStockCrowdVerbs(this.verbs, ...verbs);
		return this;
	}

	addVerb(name:string, args:VerbArgMap = {}, handler?:VerbHandler<HostCtx>):this {
		if (!this.verbs.has(name)) {
			this.verbs.add(name, args);
		}
		if (handler) {
			this.handlers.set(name, handler);
		}
		return this;
	}

	/** Drop catalog schemas and named handlers. Missing names are skipped. Empty rest is a no-op. */
	removeVerbs(...names:string[]):this {
		this.verbs.remove(...names);
		for (const name of names) {
			this.handlers.delete(name);
		}
		return this;
	}

	onVerb(fn:VerbHandler<HostCtx>):this {
		this.catchAll = fn;
		return this;
	}

	onAbortPlan(fn:(id:string)=>void):this {
		this.abortPlanFn = fn;
		return this;
	}

	onLog(fn:(entry:DirectorLog)=>void):this {
		this.logFn = fn;
		return this;
	}

	addAgent(spec:AgentSpec<HostCtx>):this {
		const next:AgentSpec<HostCtx> = {
			...spec,
			goals: spec.goals ? spec.goals.map((g) => ({ ...g })) : undefined,
			memories: spec.memories ? spec.memories.map((m) => ({ ...m, tags: m.tags ? [...m.tags] : undefined })) : undefined,
			kit: spec.kit,
		};
		if (!this.started) {
			const i = this.pending.findIndex((s) => s.id === spec.id);
			if (i >= 0) {
				this.pending[i] = next;
			}
			else {
				this.pending.push(next);
			}
			return this;
		}
		this.reportMissingNames(next);
		this.wireAgent(next);
		return this;
	}

	addCrowdConductor(spec:AgentSpec<HostCtx>):this {
		return this.addAgent({ ...spec, units: spec.units ?? [] });
	}

	addCrowdUnit(conductorID:string, spec:CrowdUnitSpec):this {
		const add = ():void => {
			const agent = this.rows.get(conductorID)?.agent;
			if (!isCrowdConductor(agent)) {
				throw new Error(`ArcDirector: '${conductorID}' is not a CrowdConductor`);
			}
			agent.addUnit(spec);
		};
		if (!this.started) {
			const pending = this.pending.find((s) => s.id === conductorID);
			if (pending) {
				pending.units = [...(pending.units ?? []), spec];
				return this;
			}
			throw new Error(`ArcDirector: no conductor '${conductorID}'`);
		}
		add();
		return this;
	}

	removeCrowdUnit(conductorID:string, unitID:string):this {
		if (!this.started) {
			const pending = this.pending.find((s) => s.id === conductorID);
			if (pending?.units) {
				pending.units = pending.units.filter((u) => u.id !== unitID);
			}
			return this;
		}
		const agent = this.rows.get(conductorID)?.agent;
		if (isCrowdConductor(agent)) {
			agent.removeUnit(unitID);
		}
		return this;
	}

	addCrowdLaw(conductorID:string, spec:CrowdLawSpec):this {
		if (!this.started) {
			const pending = this.pending.find((s) => s.id === conductorID);
			if (pending) {
				pending.laws = [...(pending.laws ?? []), spec];
				return this;
			}
			throw new Error(`ArcDirector: no conductor '${conductorID}'`);
		}
		const agent = this.rows.get(conductorID)?.agent;
		if (!isCrowdConductor(agent)) {
			throw new Error(`ArcDirector: '${conductorID}' is not a CrowdConductor`);
		}
		agent.addCrowdLaw(spec, spec.pinned);
		return this;
	}

	removeAgent(id:string):this {
		if (!this.started) {
			const i = this.pending.findIndex((s) => s.id === id);
			if (i >= 0) {
				this.pending.splice(i, 1);
			}
			return this;
		}
		this.dropRow(id);
		return this;
	}

	agent(id:string):Agent<HostCtx> | undefined {
		return this.rows.get(id)?.agent ?? undefined;
	}

	agents():Agent<HostCtx>[] {
		const out:Agent<HostCtx>[] = [];
		for (const row of this.rows.values()) {
			if (row.agent) {
				out.push(row.agent);
			}
		}
		return out;
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

	setThinkingBudget(n:number):void {
		const enable = Number.isFinite(n) && n > 0;
		const budget = enable ? Math.round(n) : undefined;
		this.http?.setThinking(enable, budget);
		if (this.inference.kind === 'http') {
			this.inference.opts.enableThinking = enable;
			this.inference.opts.thinkingBudget = budget;
		}
	}

	liveThinkingBudget():number {
		if (this.inference.kind === 'http') {
			if (this.inference.opts.enableThinking === false) {
				return 0;
			}
			const n = this.inference.opts.thinkingBudget;
			return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
		}
		return 0;
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
		for (const agent of this.agents()) {
			agent.model = name;
			agent.vision = this.vision;
		}
		void this.http?.ensureLoaded(name).catch((err:unknown) => {
			const text = err instanceof Error ? err.message : String(err);
			this.emitLog({ name: 'ArcDirector', message: text });
		});
	}

	private syncVision(modelID:string):void {
		const row = this.catalog.find((m) => m.id === modelID)
			?? this.catalog.find((m) => m.id.endsWith(modelID) || m.id.includes(modelID));
		this.vision = isVisionModel(row ?? modelID);
		for (const agent of this.agents()) {
			agent.vision = this.vision;
		}
	}

	resetInferStats():void {
		this.infer = emptyInferClock();
	}

	private recordInfer(wallMs:number, res:{ promptMs?:number; generateMs?:number }):void {
		const context = res.promptMs;
		let generate = res.generateMs;
		if (generate === undefined && context !== undefined) {
			generate = Math.max(0, wallMs - context);
		}
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
		if (generate !== undefined) {
			this.infer.generateMs += generate;
			this.infer.lastGenerateMs = generate;
		}
		else {
			this.infer.generateMs += wallMs;
			this.infer.lastGenerateMs = wallMs;
		}
	}

	private wrapProvider(inner:InferenceProvider):InferenceProvider {
		const embed = inner.embed?.bind(inner);
		return {
			chat: async (req:ChatRequest):Promise<ChatResponse> => {
				const name = whoFromMessages(req);
				const t0 = nowMs();
				try {
					const res = await inner.chat(req);
					const ms = Math.round(nowMs() - t0);
					this.recordInfer(ms, res);
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
					if (res.content) {
						parts.push(res.content);
					}
					else if (res.reasoning) {
						parts.push(`(thinking)\n${clipThought(res.reasoning)}`);
					}
					else if (res.toolCalls.length === 0) {
						parts.push('(empty content)');
					}
					this.emitLog({ name, message: parts.join('\n') });
					return res;
				}
				catch (err:unknown) {
					const ms = Math.round(nowMs() - t0);
					this.recordInfer(ms, {});
					const text = err instanceof Error ? err.message : String(err);
					this.emitLog({ name, message: `${ms}ms\n${text}` });
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
				{ ...opts, load },
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
		this.reportMissingNames();
		const specs = this.pending.splice(0, this.pending.length);
		for (const spec of specs) {
			this.wireAgent(spec);
		}
		this.started = true;
		const ids = [...this.rows.keys()];
		if (ids.length > 0) {
			this.emitLog({
				name: 'ArcDirector',
				message: `${ids.join(', ')} on ${this.model}${this.vision ? ' (vision)' : ''}`,
			});
		}
		return this;
	}

	private kernelsFor(row:AgentRow<HostCtx>, ctx:HostCtx):HostKernels {
		const kernels = this.kernelFn!(ctx);
		const agent = row.agent;
		const lastAt = agent?.lastTacticalAt;
		const last = agent?.lastResult;
		const ago = lastAt !== undefined && Number.isFinite(lastAt)
			? Math.max(0, this.clock - lastAt)
			: undefined;
		const los = this.losFn;
		return {
			...kernels,
			cache: row.cache,
			...(los ? { canSee: (a, b) => los(a.id, b.id) } : {}),
			hasHeard: agent ? agent.hasHeard() : false,
			prevThought: ago !== undefined ? { secondsAgo: ago } : undefined,
			prevActions: last
				? [{
					secondsAgo: ago ?? 0,
					isOk: last.ok,
					reason: last.reason ?? '',
					verb: last.verb ?? '',
				}]
				: [],
		} as HostKernels;
	}

	private deps(id:string, row:AgentRow<HostCtx>):AgentDeps<HostCtx> {
		return {
			provider: this.provider!,
			verbs: this.verbs,
			senses: this.sensesFor(row),
			tools: this.tools,
			context: () => {
				if (!this.contextFn) {
					throw new Error(`ArcDirector: withContext required (agent ${id})`);
				}
				return this.contextFn(id);
			},
			execute: async (step, ctx, actorID) => this.dispatch(row, step, ctx, actorID),
			abortPlan: (unitID) => this.abortPlanFn?.(unitID),
			cooldown: this.cooldownDefault,
			autoEnact: true,
			queue: this.queue,
			model: this.model,
			talk: this.talk,
			kit: this.kitFor(row.spec),
			catalog: this.kernelFn
				? (ctx) => buildCatalog(this.kernelsFor(row, ctx))
				: undefined,
			map: this.map,
			vision: this.vision,
			watches: row.spec.watches,
			pinnedWatches: row.spec.pinnedWatches,
			watchesWritable: row.spec.watchesWritable,
			pinnedSightFocus: row.spec.pinnedSightFocus,
			sightFocus: row.spec.sightFocus,
			sightFocusWritable: row.spec.sightFocusWritable,
			maxSightFocus: row.spec.maxSightFocus,
			sightLimit: row.spec.sightLimit ?? this.sightLimitDefault,
		};
	}

	private sensesFor(row:AgentRow<HostCtx>):Record<string, Sense<HostCtx>> {
		const wrapSight = !!(this.sightLook && this.senses.sight);
		let skipCarrying = false;
		if (this.senses.carrying && isCrowdConductor(row.agent) && this.contextFn) {
			if (this.tryCtx(row.spec.id) === undefined) {
				skipCarrying = true;
			}
		}
		if (!wrapSight && !skipCarrying) {
			return this.senses;
		}
		const senses:{ [k:string]:Sense<HostCtx> } = { ...this.senses };
		if (wrapSight && this.senses.sight) {
			senses.sight = {
				description: this.senses.sight.description,
				gather: (ctx) => this.gatherSight(row, ctx),
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

	private gatherSight(row:AgentRow<HostCtx>, ctx:HostCtx):string {
		const look = this.sightLook;
		if (!look) {
			return '';
		}
		const agent = row.agent;
		const focus = agent?.effectiveSightFocus() ?? [];
		const limit = agent?.sightLimit ?? this.sightLimitDefault;
		const scores = new Map<string, number>();
		if (isCrowdConductor(agent) && agent.crowd.size > 0 && this.contextFn) {
			const groups:{ unitID:string; clauses:ReturnType<typeof formatSightClauses> }[] = [];
			for (const unit of agent.crowd.list()) {
				const unitCtx = this.tryCtx(unit.id);
				if (!unitCtx) {
					continue;
				}
				const snap = this.filterSight(look(unitCtx));
				const clauses = formatSightClauses(snap, {
					fromName: unit.id,
					skipAmbient: groups.length > 0,
				});
				groups.push({ unitID: unit.id, clauses });
				if (focus.length > 0) {
					this.scoreSightObjects(snap.objects, focus, unitCtx, row, scores);
				}
			}
			const merged = mergeHiveClauses(groups, focus.length > 0 ? scores : undefined);
			return joinSightClauses(orderSightClauses(merged, scores, limit, focus.length > 0));
		}
		const snap = this.filterSight(look(ctx));
		const clauses = formatSightClauses(snap);
		if (focus.length > 0) {
			this.scoreSightObjects(snap.objects, focus, ctx, row, scores);
		}
		return joinSightClauses(orderSightClauses(clauses, scores, limit, focus.length > 0));
	}

	private scoreSightObjects(
		objects:SeenObject[],
		exprs:string[],
		ctx:HostCtx,
		row:AgentRow<HostCtx>,
		into:Map<string, number>,
	):void {
		if (!this.kernelFn) {
			return;
		}
		const kernels = this.kernelsFor(row, ctx);
		for (const obj of objects) {
			const it = dummyEntity(obj.id, { name: obj.id, tags: obj.tags });
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

	private dispatch(
		row:AgentRow<HostCtx>,
		step:Step,
		ctx:HostCtx | undefined,
		actorID?:string,
	):Promise<ActionResult> | ActionResult {
		const agent = row.agent;
		if (!agent) {
			return { ok: false, verb: step.verb, reason: 'no agent' };
		}
		const liveID = actorID ?? agent.id;
		let liveCtx = ctx;
		const next = this.tryCtx(liveID);
		if (next !== undefined) {
			liveCtx = next;
		}
		if (STOCK_CROWD_VERBS.includes(step.verb as typeof STOCK_CROWD_VERBS[number])) {
			return this.handleCrowdVerb(row, step, liveCtx, liveID);
		}
		const call = {
			verb: step.verb,
			args: step.args as Record<string, unknown>,
			agent,
			ctx: liveCtx as HostCtx,
			actorID: liveID,
		};
		const handler = this.handlers.get(step.verb) ?? this.catchAll;
		if (!handler) {
			return { ok: false, verb: step.verb, reason: `unhandled ${step.verb}` };
		}
		return handler(call);
	}

	private handleCrowdVerb(
		row:AgentRow<HostCtx>,
		step:Step,
		ctx:HostCtx | undefined,
		actorID:string,
	):ActionResult | Promise<ActionResult> {
		const agent = row.agent;
		if (!isCrowdConductor(agent)) {
			return { ok: false, verb: step.verb, reason: 'not a CrowdConductor' };
		}
		if (step.verb === 'when') {
			return this.handleWhen(row, agent, step, ctx, actorID);
		}
		if (step.verb === 'law') {
			const who = typeof step.args.who === 'string' ? step.args.who : undefined;
			const watch = typeof step.args.watch === 'string' ? step.args.watch : '';
			const name = typeof step.args.name === 'string' ? step.args.name : undefined;
			const plan = planArg(step.args.plan, this.verbs);
			if (!watch || !plan) {
				return { ok: false, verb: 'law', reason: 'law needs watch and plan' };
			}
			agent.addCrowdLaw({ name, who, watch, plan });
			return { ok: true, verb: 'law' };
		}
		if (step.verb === 'unlaw') {
			const name = typeof step.args.name === 'string' ? step.args.name : '';
			if (!name) {
				return { ok: false, verb: 'unlaw', reason: 'unlaw needs name' };
			}
			agent.removeCrowdLaw(name);
			return { ok: true, verb: 'unlaw' };
		}
		if (step.verb === 'tag' || step.verb === 'untag') {
			const who = typeof step.args.who === 'string' ? step.args.who : '';
			const name = typeof step.args.name === 'string' ? step.args.name : '';
			if (!who || !name) {
				return { ok: false, verb: step.verb, reason: `${step.verb} needs who and name` };
			}
			const cat = this.crowdCatalog(row, agent, ctx);
			const units = cat ? evaluateWho(who, cat, agent.crowd) : [];
			if (step.verb === 'tag') {
				agent.tagUnits(units, name);
			}
			else {
				agent.untagUnits(units, name);
			}
			return { ok: true, verb: step.verb };
		}
		if (FORMATION_VERBS.has(step.verb)) {
			return { ok: false, verb: step.verb, reason: 'formation must be when plan head' };
		}
		return { ok: false, verb: step.verb, reason: `unhandled ${step.verb}` };
	}

	private handleWhen(
		row:AgentRow<HostCtx>,
		agent:CrowdConductor<HostCtx>,
		step:Step,
		ctx:HostCtx | undefined,
		actorID:string,
	):ActionResult | Promise<ActionResult> {
		const who = typeof step.args.who === 'string' ? step.args.who.trim() : '';
		const watch = typeof step.args.watch === 'string' ? step.args.watch.trim() : '';
		const plan = planArg(step.args.plan, this.verbs);
		if (who && watch) {
			return { ok: false, verb: 'when', reason: 'who+watch is law, not when' };
		}
		if (watch && plan && !who) {
			return { ok: false, verb: 'when', reason: 'when(watch) belongs in a plan body' };
		}
		if (!who || !plan) {
			return { ok: false, verb: 'when', reason: 'when needs who and plan' };
		}
		const cat = this.crowdCatalog(row, agent, ctx);
		const units = cat ? evaluateWho(who, cat, agent.crowd) : [];
		const head = firstStep(plan);
		if (head && FORMATION_VERBS.has(head.verb)) {
			const handler = this.handlers.get(head.verb) ?? this.catchAll;
			if (handler && ctx !== undefined) {
				const result = handler({
					verb: head.verb,
					args: head.args as Record<string, unknown>,
					agent,
					ctx,
					actorID,
					units: units.map((u) => u.id),
				});
				if (result && typeof result === 'object' && 'then' in result) {
					void (result as Promise<ActionResult>);
				}
			}
			if (plan.then) {
				agent.assignPlan(units, plan.then.plan);
			}
			return { ok: true, verb: 'when' };
		}
		agent.assignPlan(units, plan);
		return { ok: true, verb: 'when' };
	}

	private tryCtx(id:string):HostCtx | undefined {
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

	private dummyHiveKernels(row:AgentRow<HostCtx>, agent:CrowdConductor<HostCtx>):HostKernels | undefined {
		if (!this.kernelFn) {
			return undefined;
		}
		const poses:{ x:number; z:number }[] = [];
		let sample:HostKernels | undefined;
		for (const unit of agent.crowd.list()) {
			const ctx = this.tryCtx(unit.id);
			if (!ctx) {
				continue;
			}
			const kernels = this.kernelsFor(row, ctx);
			sample = kernels;
			const at = kernels.at?.(kernels.me);
			if (at) {
				poses.push(at);
			}
		}
		if (!sample) {
			return undefined;
		}
		const cx = poses.length > 0 ? poses.reduce((s, p) => s + p.x, 0) / poses.length : 0;
		const cz = poses.length > 0 ? poses.reduce((s, p) => s + p.z, 0) / poses.length : 0;
		const me = dummyEntity(agent.id, { name: agent.id, tags: ['agent'] });
		return {
			...sample,
			me,
			inventory: undefined,
			at: (who) => {
				if (who.id === agent.id) {
					return { x: cx, z: cz };
				}
				return sample.at?.(who);
			},
		};
	}

	private crowdCatalog(
		row:AgentRow<HostCtx>,
		agent:CrowdConductor<HostCtx>,
		ctx:HostCtx | undefined,
	):ReturnType<typeof buildCrowdCatalog> | undefined {
		if (!this.kernelFn) {
			return undefined;
		}
		const kernels = ctx
			? this.kernelsFor(row, ctx)
			: this.dummyHiveKernels(row, agent);
		if (!kernels) {
			return undefined;
		}
		return buildCrowdCatalog(kernels, agent.crowd, agent.id);
	}

	private applySpec(agent:Agent<HostCtx>, spec:AgentSpec<HostCtx>, fresh:boolean):void {
		if (fresh) {
			agent.identity = {
				...spec.identity,
				traits: spec.identity.traits ? [...spec.identity.traits] : undefined,
			};
		}
		for (const mem of spec.memories ?? []) {
			if (!mem.pinned) {
				if (fresh) {
					agent.memory.add({
						category: mem.category ?? 'episodic',
						text: mem.text,
						tags: mem.tags ?? [],
						pinned: false,
					}, mem.createdAt ?? 0);
				}
				continue;
			}
			const tags = mem.tags ?? [];
			const keyTags = tags.slice(0, 2);
			const existing = agent.memory.pinned().find((row) => (
				keyTags.length > 0 && keyTags.every((tag) => row.tags.includes(tag))
			));
			if (existing) {
				existing.text = mem.text;
				existing.tags = [...tags];
				continue;
			}
			agent.memory.add({
				category: mem.category ?? 'episodic',
				text: mem.text,
				tags,
				pinned: true,
			}, mem.createdAt ?? 0);
		}
		if (spec.watchesWritable !== undefined) {
			agent.watchesWritable = spec.watchesWritable;
		}
		if (spec.sightFocusWritable !== undefined) {
			agent.sightFocusWritable = spec.sightFocusWritable;
		}
		if (spec.sightLimit !== undefined) {
			agent.sightLimit = spec.sightLimit;
		}
		else if (this.sightLimitDefault !== undefined && agent.sightLimit === undefined) {
			agent.sightLimit = this.sightLimitDefault;
		}
		if (isCrowdConductor(agent)) {
			for (const unit of spec.units ?? []) {
				agent.addUnit(unit);
			}
			for (const law of spec.laws ?? []) {
				agent.addCrowdLaw(law, law.pinned);
			}
			if (spec.maxLaws !== undefined) {
				agent.maxLaws = spec.maxLaws;
			}
			if (spec.cooldown !== undefined) {
				agent.cooldown = spec.cooldown;
			}
		}
		agent.kit = this.kitFor(spec);
	}

	private kitFor(spec:AgentSpec<HostCtx>):KitSource<HostCtx> {
		return spec.kit ?? this.defaultKit ?? { verbs: [] };
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
		return false;
	}

	private readKit(
		src:KitSource<HostCtx>,
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
		for (const name of kit.verbs ?? []) {
			if (name && !this.verbs.has(name)) {
				out.push(`verb '${name}' is not registered (${where})`);
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

	private missingNames(spec?:AgentSpec<HostCtx>):string[] {
		const out:string[] = [];
		if (spec) {
			const where = `agent ${spec.id}`;
			const read = this.readKit(this.kitFor(spec), spec.id, where);
			if (read.error) {
				out.push(read.error);
			}
			else if (read.kit) {
				this.scanKit(read.kit, where, out);
			}
			return out;
		}
		if (this.defaultKit && typeof this.defaultKit !== 'function') {
			this.scanKit(this.defaultKit, 'default kit', out);
		}
		for (const row of this.pending) {
			if (row.kit) {
				const where = `agent ${row.id}`;
				const read = this.readKit(row.kit, row.id, where);
				if (read.error) {
					out.push(read.error);
				}
				else if (read.kit) {
					this.scanKit(read.kit, where, out);
				}
			}
			else if (typeof this.defaultKit === 'function') {
				const where = `agent ${row.id}`;
				const read = this.readKit(this.defaultKit, row.id, where);
				if (read.error) {
					out.push(read.error);
				}
				else if (read.kit) {
					this.scanKit(read.kit, where, out);
				}
			}
		}
		return out;
	}

	private reportMissingNames(spec?:AgentSpec<HostCtx>):void {
		const parts = this.missingNames(spec);
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

	private attachTalk(agent:Agent<HostCtx>):void {
		if (!this.talk) {
			return;
		}
		this.talk.attach({
			id: agent.id,
			pushEvent: (event) => {
				agent.pushEvent(event);
				if (event.major) {
					this.queue?.enqueueMajor(agent.id, true);
				}
			},
		});
	}

	private wireAgent(spec:AgentSpec<HostCtx>, stored?:AgentJSON):Agent<HostCtx> {
		this.dropRow(spec.id);
		const row:AgentRow<HostCtx> = {
			spec,
			agent: null,
			cache: new SampleCache(),
			rank: spec.rank ?? 0,
		};
		this.rows.set(spec.id, row);
		const deps = this.deps(spec.id, row);
		const isCrowd = spec.units !== undefined || spec.laws !== undefined;
		const agent = stored
			? isCrowd
				? CrowdConductor.fromJSON(stored, deps)
				: Agent.fromJSON(stored, deps)
			: isCrowd
				? new CrowdConductor<HostCtx>({
					...deps,
					id: spec.id,
					identity: spec.identity,
					goals: spec.goals ? spec.goals.map((g) => ({ ...g })) : [],
					units: spec.units,
					laws: spec.laws,
					maxLaws: spec.maxLaws,
					cooldown: spec.cooldown ?? this.cooldownDefault,
				})
				: new Agent<HostCtx>({
					id: spec.id,
					identity: spec.identity,
					goals: spec.goals ? spec.goals.map((g) => ({ ...g })) : [],
					...deps,
				});
		row.agent = agent;
		this.applySpec(agent, spec, !stored);
		this.attachTalk(agent);
		this.queue?.ensure(spec.id, {
			skipHeartbeat: spec.skipHeartbeat ?? false,
			skipMajor: spec.skipMajor ?? false,
		});
		this.queue?.setWatches(spec.id, agent.effectiveWatches());
		this.queue?.setAiOn(spec.id, true);
		return agent;
	}

	private dropRow(id:string):void {
		const row = this.rows.get(id);
		if (!row) {
			return;
		}
		this.talk?.detach(id);
		this.queue?.setAiOn(id, false);
		this.queue?.drop(id);
		this.rows.delete(id);
		let i = this.readyThink.length;
		while (i--) {
			if (this.readyThink[i].npcID === id) {
				this.readyThink.splice(i, 1);
			}
		}
	}

	exportAgents():Record<string, AgentJSON> {
		const out:Record<string, AgentJSON> = {};
		for (const row of this.rows.values()) {
			if (row.agent) {
				out[row.agent.id] = row.agent.toJSON();
			}
		}
		return out;
	}

	restoreAgents(agents:Record<string, AgentJSON>):void {
		if (!this.started || !this.provider) {
			return;
		}
		for (const row of this.rows.values()) {
			const json = agents[row.spec.id];
			if (!json || !row.agent) {
				continue;
			}
			this.talk?.detach(row.spec.id);
			const deps = this.deps(row.spec.id, row);
			row.agent = (row.spec.units !== undefined || row.spec.laws !== undefined)
				? CrowdConductor.fromJSON(json, deps)
				: Agent.fromJSON(json, deps);
			this.applySpec(row.agent, row.spec, false);
			this.attachTalk(row.agent);
			this.queue?.setWatches(row.spec.id, row.agent.effectiveWatches());
		}
	}

	pushEvent(event:{ kind:string; text:string; tags?:string[]; major?:boolean; at?:number }):void {
		for (const row of this.rows.values()) {
			row.agent?.pushEvent(event);
			if (event.major) {
				this.queue?.enqueueMajor(row.spec.id, true);
			}
		}
	}

	tick(dt:number, now:number):void {
		if (!this.started || this.disposed || !this.queue) {
			return;
		}
		this.clock = now;
		const catalogs = new Map<string, ReturnType<typeof buildCatalog> | ReturnType<typeof buildCatalog>[]>();
		for (const row of this.rows.values()) {
			if (!row.agent) {
				continue;
			}
			row.agent.stamp(now);
			row.agent.refreshKit();
			if (!this.kernelFn || !this.contextFn) {
				continue;
			}
			try {
				catalogs.set(row.spec.id, this.catalogsFor(row));
			}
			catch {
				continue;
			}
		}
		const cap = this.queue.maxParallel;
		this.queue.maxParallel = Math.max(cap, this.rows.size);
		const rows = this.queue.tick(dt, catalogs);
		this.queue.maxParallel = cap;
		this.readyThink.push(...rows);
		for (const row of this.rows.values()) {
			row.cache.commit();
			this.tickLaws(row);
			if (row.agent?.planSession) {
				pollPlanSession(row.agent.planSession);
			}
		}
		this.drain(now);
	}

	private catalogsFor(row:AgentRow<HostCtx>):ReturnType<typeof buildCatalog> | ReturnType<typeof buildCatalog>[] {
		const agent = row.agent;
		const thinkerCtx = this.tryCtx(row.spec.id);
		const thinkerKernels = thinkerCtx
			? this.kernelsFor(row, thinkerCtx)
			: (isCrowdConductor(agent) ? this.dummyHiveKernels(row, agent) : undefined);
		if (!thinkerKernels) {
			throw new Error('no ctx');
		}
		const thinker = buildCatalog(thinkerKernels);
		if (!isCrowdConductor(agent) || agent.crowd.size === 0) {
			return thinker;
		}
		const unitCats:ReturnType<typeof buildCatalog>[] = [];
		for (const unit of agent.crowd.list()) {
			const unitCtx = this.tryCtx(unit.id);
			if (!unitCtx) {
				continue;
			}
			unitCats.push(buildCrowdCatalog(this.kernelsFor(row, unitCtx), agent.crowd, agent.id));
		}
		return unitCats.length > 0 ? unitCats : thinker;
	}

	private unitCatalog(
		row:AgentRow<HostCtx>,
		agent:CrowdConductor<HostCtx>,
		unitID:string,
		whoCat:ReturnType<typeof buildCrowdCatalog>,
	):ReturnType<typeof buildCrowdCatalog> {
		const unitCtx = this.tryCtx(unitID);
		if (!unitCtx) {
			return whoCat;
		}
		return buildCrowdCatalog(this.kernelsFor(row, unitCtx), agent.crowd, agent.id);
	}

	private tickLaws(row:AgentRow<HostCtx>):void {
		const agent = row.agent;
		if (!isCrowdConductor(agent) || !this.kernelFn) {
			return;
		}
		const thinkerCtx = this.tryCtx(agent.id);
		const whoKernels = thinkerCtx
			? this.kernelsFor(row, thinkerCtx)
			: this.dummyHiveKernels(row, agent);
		if (!whoKernels) {
			return;
		}
		const whoCat = buildCrowdCatalog(whoKernels, agent.crowd, agent.id);
		for (const unit of agent.crowd.list()) {
			const extras = ():PlanHandler[] => agent.lawHandlers(unit, (law) => lawMatches(law, unit, whoCat, agent.crowd));
			const catalog = ():ReturnType<typeof buildCrowdCatalog> => this.unitCatalog(row, agent, unit.id, whoCat);
			if (unit.session) {
				unit.session.catalog = catalog;
				unit.session.now = () => this.clock;
				unit.session.extraHandlers = extras;
				unit.session.abortHost = () => this.abortPlanFn?.(unit.id);
				unit.session.cooldown = agent.cooldown;
				pollPlanSession(unit.session);
				continue;
			}
			const probe = createPlanSession({
				cooldown: agent.cooldown,
				coolUntil: unit.coolUntil,
				catalog,
				now: () => this.clock,
				extraHandlers: extras,
			});
			const first = firstStartable(probe);
			if (first) {
				agent.beginHandler(unit, first, {
					cooldown: agent.cooldown,
					catalog,
					now: () => this.clock,
					abortHost: () => this.abortPlanFn?.(unit.id),
					extraHandlers: extras,
				});
			}
		}
	}

	private drain(now:number):void {
		const queue = this.queue;
		if (!queue) {
			return;
		}
		this.readyThink.sort((a, b) => {
			const score = queue.rankScore(b.npcID, b.score) - queue.rankScore(a.npcID, a.score);
			if (score !== 0) {
				return score;
			}
			const rankA = this.rows.get(a.npcID)?.rank ?? 0;
			const rankB = this.rows.get(b.npcID)?.rank ?? 0;
			return rankB - rankA;
		});
		const slots = this.thinkSlots(queue, now);
		if (slots <= 0) {
			return;
		}
		const held:ThinkRow[] = [];
		let left = slots;
		for (const row of this.readyThink) {
			const mind = this.rows.get(row.npcID);
			if (!mind?.agent || queue.isThinking(row.npcID) || left <= 0) {
				if (mind?.agent) {
					held.push(row);
				}
				continue;
			}
			if (!queue.allowThink(row)) {
				held.push(row);
				continue;
			}
			if (queue.planOf(row.npcID)) {
				this.abortPlanFn?.(row.npcID);
				held.push(row);
				continue;
			}
			queue.drop(row.npcID);
			this.fireThink(mind, now);
			left -= 1;
		}
		this.readyThink.length = 0;
		this.readyThink.push(...held);
		if (queue.inFlight > 0 && this.readyThink.length > 0 && this.batchHeldAt === null) {
			this.batchHeldAt = now;
		}
	}

	private thinkSlots(queue:MindQueue, now:number):number {
		const inFlight = queue.inFlight;
		if (inFlight === 0) {
			this.batchHeldAt = null;
		}
		const open = queue.maxParallel - inFlight;
		if (open <= 0) {
			return 0;
		}
		const { batchThinks, batchWait } = this.thinkBatchPolicy();
		if (!batchThinks || inFlight === 0) {
			return open;
		}
		const waiting = this.readyThink.some((row) => {
			const mind = this.rows.get(row.npcID);
			return !!mind?.agent && !queue.isThinking(row.npcID);
		});
		if (!waiting) {
			return 0;
		}
		if (!Number.isFinite(batchWait) || batchWait <= 0) {
			return 0;
		}
		if (this.batchHeldAt === null) {
			this.batchHeldAt = now;
		}
		if (now - this.batchHeldAt < batchWait) {
			return 0;
		}
		this.batchHeldAt = now;
		return open;
	}

	private thinkBatchPolicy():{ batchThinks:boolean; batchWait:number } {
		const http = this.inference.kind === 'http' ? this.inference.opts : undefined;
		return {
			batchThinks: this.queue?.batchThinks ?? http?.batchThinks ?? DEFAULT_BATCH_THINKS,
			batchWait: this.queue?.batchWait ?? http?.batchWait ?? DEFAULT_BATCH_WAIT,
		};
	}

	private fireThink(row:AgentRow<HostCtx>, now:number):void {
		const agent = row.agent;
		if (!agent) {
			return;
		}
		void agent.tick(now)
			.then((plan) => {
				this.queue?.setWatches(agent.id, agent.effectiveWatches());
				if (!plan) {
					this.queue?.noteResult(agent.id, true);
					return;
				}
				this.emitLog({ name: agent.id, message: formatPlan(plan) });
			})
			.catch((err:unknown) => {
				const text = err instanceof Error ? err.message : String(err);
				this.emitLog({ name: agent.id, message: `stalled: ${text}` });
				this.queue?.noteResult(agent.id, true);
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
		for (const id of [...this.rows.keys()]) {
			this.dropRow(id);
		}
		this.started = false;
	}
}
