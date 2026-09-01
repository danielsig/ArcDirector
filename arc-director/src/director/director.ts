import { registerStockVerbs, VerbRegistry, type StockVerb, type VerbArgMap } from '../action/registry.js';
import { formatPlan } from '../action/parse.js';
import type { ActionResult, Step } from '../action/types.js';
import { Agent, type AgentDeps, type AgentJSON } from '../agent/agent.js';
import type { Kit, KitSource, Sense, ToolSpec } from '../agent/types.js';
import { TalkNet, type SpeechUtterance, type TalkConfig, type TalkSense } from '../agent/talk.js';
import type { MapSense } from '../agent/map.js';
import { buildCatalog, type HostKernels } from '../expr/natives.js';
import { SampleCache } from '../expr/types.js';
import { formatSight } from '../perception/sight.js';
import { formatInventory } from '../perception/formatInventory.js';
import type { Inventory } from '../perception/inventory.js';
import type { Sight } from '../perception/types.js';
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
	private contextFn:((id:string)=>HostCtx) | undefined;
	private kernelFn:KernelSource<HostCtx> | undefined;
	private defaultKit:KitSource<HostCtx> | undefined;
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

	withSight(look:(ctx:HostCtx)=>Sight):this {
		this.assertBuilder();
		this.senses.sight = {
			description: 'What you can see. Names only, distances in paces.',
			gather: (ctx) => {
				const snap = look(ctx);
				const los = this.losFn;
				const objects = los
					? snap.objects.filter((o) => los(snap.self.id, o.id))
					: snap.objects;
				return formatSight({ ...snap, objects });
			},
		};
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

	withContext(fn:(id:string)=>HostCtx):this {
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
			senses: this.senses,
			tools: this.tools,
			context: () => {
				if (!this.contextFn) {
					throw new Error(`ArcDirector: withContext required (agent ${id})`);
				}
				return this.contextFn(id);
			},
			execute: async (step, ctx) => this.dispatch(row, step, ctx),
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
		};
	}

	private dispatch(
		row:AgentRow<HostCtx>,
		step:Step,
		ctx:HostCtx,
	):Promise<ActionResult> | ActionResult {
		const agent = row.agent;
		if (!agent) {
			return { ok: false, verb: step.verb, reason: 'no agent' };
		}
		const call = { verb: step.verb, args: step.args as Record<string, unknown>, agent, ctx };
		const handler = this.handlers.get(step.verb) ?? this.catchAll;
		if (!handler) {
			return { ok: false, verb: step.verb, reason: `unhandled ${step.verb}` };
		}
		return handler(call);
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
			return { kit: src(this.contextFn(id)) ?? {} };
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
		const agent = stored
			? Agent.fromJSON(stored, deps)
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
			row.agent = Agent.fromJSON(json, this.deps(row.spec.id, row));
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
		const catalogs = new Map<string, ReturnType<typeof buildCatalog>>();
		for (const row of this.rows.values()) {
			if (!row.agent) {
				continue;
			}
			row.agent.refreshKit();
			if (!this.kernelFn || !this.contextFn) {
				continue;
			}
			try {
				const ctx = this.contextFn(row.spec.id);
				catalogs.set(row.spec.id, buildCatalog(this.kernelsFor(row, ctx)));
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
		}
		this.drain(now);
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

	/** Wall-clock loop for scripts. Games must not use this — they already have a frame tick. */
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
