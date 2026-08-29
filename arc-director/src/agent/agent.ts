import { parsePlan } from '../action/parse.js';
import { actionPlanSchema } from '../action/schema.js';
import type { VerbRegistry } from '../action/registry.js';
import type { ActionPlan, ActionResult, Step } from '../action/types.js';
import { ActionError } from '../action/types.js';
import { envGet } from '../env.js';
import { evaluate } from '../expr/eval.js';
import { observeExpr } from '../expr/stringify.js';
import type { Catalog } from '../expr/types.js';
import { isVisionModel, PREFERRED_MODELS } from '../inference/models.js';
import type { ChatMessage, InferenceProvider, ToolDef } from '../inference/provider.js';
import { extractJson, isRecord, readID } from '../json.js';
import { MemoryStore, type MemoryRecord } from '../memory/store.js';
import type { PerceptionRecipe, ToolSpec } from './types.js';
import { parseMapZoom, stampMap, isMapSnapshot, DEFAULT_YOU_SYMBOL, type MapPrev, type MapSense } from './map.js';
import { planRepairHint, sayRangeHint, shortTermBlock, stablePrefix, volatileBlock } from './prompt.js';
import { runPlan } from './run.js';
import type { SayTo, TalkNet } from './talk.js';
import type { AgentEvent, AgentIdentity, Goal } from './types.js';

export type AgentJSON = {
	id:string;
	identity:AgentIdentity;
	goals:Goal[];
	memories:MemoryRecord[];
	events?:AgentEvent[];
	watches?:string[];
	pinnedWatches?:string[];
	watchesWritable?:boolean;
	lastResult?:ActionResult;
	lastPlan?:ActionPlan;
	lastTacticalAt?:number;
	lastStrategicAt?:number;
	lastIntrusionAt?:number;
	livePlan:boolean;
	maxGoals:number;
	maxEpisodic:number;
	recent?:string[];
	recentSummary?:string;
};

export type AgentDeps<HostCtx = unknown> = {
	provider:InferenceProvider;
	verbs:VerbRegistry;
	recipe:PerceptionRecipe<HostCtx>;
	context:()=>HostCtx;
	execute?:(step:Step, ctx:HostCtx)=>Promise<ActionResult>;
	model?:string;
	embedModel?:string;
	heartbeat?:number;
	toolRoundCap?:number;
	/** Extra chat turns after a bad plan or a tool call with tools closed. Host sets this; 0 means fail on the first bad reply. */
	planRetryCap?:number;
	maxGoals?:number;
	intrusionThreshold?:number;
	intrusionCooldown?:number;
	recallK?:number;
	strategicInterval?:number;
	talk?:TalkNet;
	catalog?:(ctx:HostCtx)=>Catalog;
	hideObserve?:boolean;
	/** Host top-down snapshots. `see_map` is omitted unless this and vision are both set. */
	map?:MapSense;
	/**
	 * Whether the current model accepts image parts.
	 * `false` never offers `see_map`. `true` offers it when `map` is set.
	 * Omit to fall back to `isVisionModel(model)`.
	 */
	vision?:boolean;
	watches?:string[];
	pinnedWatches?:string[];
	watchesWritable?:boolean;
};

export type AgentOptions<HostCtx = unknown> = AgentDeps<HostCtx> & {
	id:string;
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

const RECENT_CAP = 8;
const RECENT_SUMMARY_MAX = 600;
const SKIP_RECENT = new Set(['action_result']);

function foldRecent(prev:string, overflow:string[]):string {
	const next = [prev, ...overflow].filter((s) => s.trim().length > 0).join(' ').replace(/\s+/g, ' ').trim();
	if (next.length <= RECENT_SUMMARY_MAX) {
		return next;
	}
	return next.slice(next.length - RECENT_SUMMARY_MAX).trim();
}

export class Agent<HostCtx = unknown> {
	readonly id:string;
	identity:AgentIdentity;
	goals:Goal[];
	readonly memory:MemoryStore;
	readonly verbs:VerbRegistry;
	readonly recipe:PerceptionRecipe<HostCtx>;
	readonly provider:InferenceProvider;
	readonly context:()=>HostCtx;
	readonly execute?:(step:Step, ctx:HostCtx)=>Promise<ActionResult>;
	model:string;
	embedModel:string | undefined;
	heartbeat:number;
	toolRoundCap:number;
	planRetryCap:number;
	maxGoals:number;
	intrusionThreshold:number;
	intrusionCooldown:number;
	recallK:number;
	strategicInterval:number;
	talk:TalkNet | undefined;
	catalog?:(ctx:HostCtx)=>Catalog;
	hideObserve:boolean;
	map:MapSense | undefined;
	vision:boolean | undefined;
	watches:string[];
	pinnedWatches:string[];
	watchesWritable:boolean;

	lastResult:ActionResult | undefined;
	lastPlan:ActionPlan | undefined;
	lastTacticalAt = Number.NEGATIVE_INFINITY;
	lastStrategicAt = 0;
	lastIntrusionAt = Number.NEGATIVE_INFINITY;
	livePlan = false;
	private now = 0;
	private readonly pendingEvents:AgentEvent[] = [];
	private recent:string[] = [];
	private recentSummary = '';
	private recentAbsorbed = 0;
	private pendingSeeMapImage:string | undefined;
	private lastMap:MapPrev & { legend:string } | undefined;

	constructor(opts:AgentOptions<HostCtx>) {
		this.id = opts.id;
		this.identity = opts.identity;
		this.goals = opts.goals ? [...opts.goals] : [];
		this.memory = opts.memory ?? new MemoryStore();
		this.verbs = opts.verbs;
		this.recipe = opts.recipe;
		this.provider = opts.provider;
		this.context = opts.context;
		this.execute = opts.execute;
		this.model = opts.model ?? envGet('ARC_DIRECTOR_MODEL') ?? PREFERRED_MODELS[0];
		this.embedModel = opts.embedModel ?? envGet('ARC_DIRECTOR_EMBED_MODEL');
		this.heartbeat = opts.heartbeat ?? 30;
		this.toolRoundCap = opts.toolRoundCap ?? 2;
		this.planRetryCap = opts.planRetryCap ?? 0;
		this.maxGoals = opts.maxGoals ?? 5;
		this.intrusionThreshold = opts.intrusionThreshold ?? 0.55;
		this.intrusionCooldown = opts.intrusionCooldown ?? 45;
		this.recallK = opts.recallK ?? 5;
		this.strategicInterval = opts.strategicInterval ?? 180;
		this.talk = opts.talk;
		this.catalog = opts.catalog;
		this.hideObserve = opts.hideObserve ?? false;
		this.map = opts.map;
		this.vision = opts.vision;
		this.pinnedWatches = opts.pinnedWatches ? [...opts.pinnedWatches] : [];
		this.watches = (opts.watches ? [...opts.watches] : []).filter((w) => !this.pinnedWatches.includes(w));
		this.watchesWritable = opts.watchesWritable ?? true;
		if (this.talk) {
			this.talk.attach(this);
		}
		if (opts.maxGoals !== undefined) {
			this.trimGoals();
		}
	}

	pushEvent(event:AgentEvent):void {
		this.pendingEvents.push({ ...event, at: event.at ?? this.now });
	}

	/** Hosts that run the plan themselves still need this for remember / set_goal / set_identity. */
	async perform(step:Step, ctx:HostCtx = this.context()):Promise<ActionResult> {
		return this.runStep(step, ctx);
	}

	ingestResult(result:ActionResult):void {
		this.lastResult = result;
		this.livePlan = false;
		if (result.interrupted) {
			this.pushEvent({
				kind: 'Interrupted',
				text: result.reason ?? 'interrupted',
				tags: ['interrupted'],
			});
		}
		else {
			this.pushEvent({
				kind: 'action_result',
				text: result.reason ?? (result.ok ? 'ok' : 'failed'),
				tags: [result.ok ? 'ok' : 'fail'],
			});
		}
	}

	async remember(text:string, tags:string[] = [], at = this.now):Promise<MemoryRecord> {
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
			category: 'episodic',
			text,
			tags,
			createdAt: at,
			embedding,
		}, at);
	}

	async tick(gameTime:number):Promise<ActionPlan | null> {
		this.now = gameTime;
		this.absorbPending();
		if (this.strategicDue(gameTime)) {
			await this.reviseGoals();
			this.lastStrategicAt = gameTime;
		}
		if (!this.tacticalDue(gameTime)) {
			return null;
		}
		try {
			const plan = await this.tactical();
			this.lastPlan = plan;
			this.lastTacticalAt = gameTime;
			this.pendingEvents.length = 0;
			this.recentAbsorbed = 0;
			if (this.execute) {
				this.livePlan = true;
				const ctx = this.context();
				const result = await runPlan(plan, (step) => this.runStep(step, ctx));
				this.ingestResult(result);
			}
			else {
				this.livePlan = false;
			}
			return plan;
		}
		catch (err) {
			this.lastTacticalAt = gameTime;
			this.livePlan = false;
			throw err;
		}
	}

	toJSON():AgentJSON {
		return {
			id: this.id,
			identity: { ...this.identity, traits: this.identity.traits ? [...this.identity.traits] : undefined },
			goals: this.goals.map((g) => ({ ...g })),
			memories: this.memory.toJSON(),
			events: this.pendingEvents.map((e) => ({ ...e, tags: e.tags ? [...e.tags] : undefined })),
			watches: [...this.watches],
			pinnedWatches: [...this.pinnedWatches],
			watchesWritable: this.watchesWritable,
			lastResult: this.lastResult ? { ...this.lastResult } : undefined,
			lastPlan: this.lastPlan,
			lastTacticalAt: Number.isFinite(this.lastTacticalAt) ? this.lastTacticalAt : undefined,
			lastStrategicAt: Number.isFinite(this.lastStrategicAt) ? this.lastStrategicAt : undefined,
			lastIntrusionAt: Number.isFinite(this.lastIntrusionAt) ? this.lastIntrusionAt : undefined,
			livePlan: this.livePlan,
			maxGoals: this.maxGoals,
			maxEpisodic: this.memory.maxEpisodic,
			recent: [...this.recent],
			recentSummary: this.recentSummary || undefined,
		};
	}

	static fromJSON<HostCtx>(json:AgentJSON, deps:AgentDeps<HostCtx>):Agent<HostCtx> {
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
		agent.memory.maxEpisodic = json.maxEpisodic;
		agent.maxGoals = json.maxGoals;
		agent.lastResult = json.lastResult;
		agent.lastPlan = json.lastPlan;
		agent.lastTacticalAt = json.lastTacticalAt ?? Number.NEGATIVE_INFINITY;
		agent.lastStrategicAt = json.lastStrategicAt ?? 0;
		agent.lastIntrusionAt = json.lastIntrusionAt ?? Number.NEGATIVE_INFINITY;
		agent.livePlan = json.livePlan;
		const hostPins = deps.pinnedWatches ? [...deps.pinnedWatches] : [];
		const jsonPins = json.pinnedWatches ?? [];
		const pinSeen = new Set<string>();
		agent.pinnedWatches = [...hostPins, ...jsonPins].filter((w) => {
			if (pinSeen.has(w)) {
				return false;
			}
			pinSeen.add(w);
			return true;
		});
		agent.watches = (json.watches ? [...json.watches] : []).filter((w) => !agent.pinnedWatches.includes(w));
		agent.watchesWritable = json.watchesWritable ?? true;
		for (const e of json.events ?? []) {
			agent.pendingEvents.push(e);
		}
		agent.recent = json.recent ? [...json.recent] : [];
		agent.recentSummary = json.recentSummary ?? '';
		agent.recentAbsorbed = agent.pendingEvents.length;
		return agent;
	}

	private tacticalDue(gameTime:number):boolean {
		if (!Number.isFinite(this.lastTacticalAt)) {
			return true;
		}
		if (this.lastResult?.interrupted) {
			return true;
		}
		if (this.pendingEvents.some((e) => e.major)) {
			return true;
		}
		if (this.heartbeat <= 0) {
			return !this.livePlan;
		}
		return gameTime - this.lastTacticalAt >= this.heartbeat;
	}

	private strategicDue(gameTime:number):boolean {
		if (this.pendingEvents.some((e) => e.major)) {
			return true;
		}
		if (this.strategicInterval <= 0) {
			return false;
		}
		if (!Number.isFinite(this.lastStrategicAt)) {
			return false;
		}
		return gameTime - this.lastStrategicAt >= this.strategicInterval;
	}

	private async reviseGoals():Promise<void> {
		const system = stablePrefix(this.identity, this.verbs, {
			includeWatches: true,
			canSeeMap: this.seeMapOn(),
			youSymbol: this.youSymbol(),
		});
		const stm = this.shortTermText();
		const user = (stm ? `${stm}\n\n` : '')
			+ (this.goals.length > 0
				? `Goals (highest first):\n${[...this.goals].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)).map((g) => `- ${g.text}`).join('\n')}\n\n`
				: '')
			+ 'Revise goals if what you just learned changes what you must do. '
			+ 'Harm, theft, and threats outrank standing work — put that first in goals. '
			+ 'Do not change identity unless who you are has actually changed for good. '
			+ 'Omit identity otherwise. Do not rename or rewrite the role to summarize this moment. '
			+ 'Emit JSON {"goals":[{"text":"...","priority":0}]} and only if needed "identity":{"name":"...","role":"...","traits":["..."]}. '
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

	private trimGoals():void {
		if (this.goals.length <= this.maxGoals) {
			return;
		}
		this.goals = [...this.goals]
			.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
			.slice(0, this.maxGoals);
	}

	private async tactical():Promise<ActionPlan> {
		const ctx = this.context();
		const pushed:Record<string, unknown> = {};
		for (const [name, pusher] of Object.entries(this.recipe.push)) {
			pushed[name] = pusher.gather(ctx);
		}
		if (this.talk) {
			pushed.earshot = this.earshotPush();
		}
		const perceptionText = Object.values(pushed)
			.map((v) => typeof v === 'string' ? v : JSON.stringify(v))
			.join('\n');
		const intrusion = this.maybeIntrude(perceptionText);
		const system = stablePrefix(this.identity, this.verbs, {
			includeWatches: true,
			canSeeMap: this.seeMapOn(),
			youSymbol: this.youSymbol(),
		});
		const user = volatileBlock({
			pushed,
			intrusion,
			lastResult: this.lastResult,
			goals: this.goals,
			pinned: this.memory.pinned(),
			watches: this.effectiveWatches(),
			pinnedWatches: this.pinnedWatches,
			watchesWritable: this.watchesWritable,
			recent: this.recent,
			recentSummary: this.recentSummary,
		});
		const messages:ChatMessage[] = [
			{ role: 'system', content: system },
			{ role: 'user', content: user },
		];
		const tools = this.toolDefs();
		const seeMapBoost = this.seeMapOn() && this.toolRoundCap <= 0 ? 1 : 0;
		let toolsLeft = tools.length === 0 ? 0 : this.toolRoundCap + seeMapBoost;
		const sendTools = tools.length > 0 && (this.toolRoundCap > 0 || seeMapBoost > 0);
		let repairsLeft = this.planRetryCap;
		let rangeLeft = this.talk ? Math.max(1, this.planRetryCap) : 0;
		let lastErr:Error | null = null;
		const budget = this.toolRoundCap + seeMapBoost + this.planRetryCap + 1 + (this.talk ? 1 : 0);
		for (let turn = 0; turn < budget; turn++) {
			const allowTools = toolsLeft > 0 && tools.length > 0;
			const res = await this.provider.chat({
				model: this.model,
				thread: this.id,
				messages,
				tools: sendTools ? tools : undefined,
				toolChoice: sendTools ? (allowTools ? 'auto' : 'none') : undefined,
				responseFormat: allowTools
					? undefined
					: { name: 'action_plan', schema: actionPlanSchema(this.verbs), strict: false },
				temperature: 0,
			});
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
				lastErr = new ActionError('model called a tool when it must emit an ActionPlan');
				if (!this.pushRepair(messages, res, lastErr, repairsLeft)) {
					throw lastErr;
				}
				repairsLeft -= 1;
				continue;
			}
			if (res.content) {
				let plan:ActionPlan;
				let raw:unknown;
				try {
					const trimmed = res.content.trim();
					raw = (trimmed.startsWith('{') || trimmed.startsWith('```'))
						? extractJson(trimmed)
						: trimmed;
					plan = parsePlan(raw, this.verbs);
				}
				catch (err) {
					lastErr = err instanceof Error ? err : new ActionError(String(err));
					if (!this.pushRepair(messages, res, lastErr, repairsLeft)) {
						throw lastErr;
					}
					repairsLeft -= 1;
					continue;
				}
				const blocked = this.unreachableSay(plan);
				if (blocked) {
					lastErr = new ActionError(blocked.reason);
					if (rangeLeft <= 0) {
						throw lastErr;
					}
					rangeLeft -= 1;
					messages.push({ role: 'assistant', content: res.content });
					messages.push({ role: 'user', content: sayRangeHint(blocked.reason, blocked.nearby) });
					continue;
				}
				if (typeof raw !== 'string') {
					this.applyMind(raw);
				}
				return plan;
			}
			lastErr = new ActionError('model returned no plan');
			if (!this.pushRepair(messages, res, lastErr, repairsLeft)) {
				throw lastErr;
			}
			repairsLeft -= 1;
		}
		throw lastErr ?? new ActionError('failed to obtain ActionPlan');
	}

	private pushRepair(
		messages:ChatMessage[],
		res:{ content:string | null; toolCalls:{ name:string }[] },
		err:Error,
		repairsLeft:number,
	):boolean {
		if (repairsLeft <= 0) {
			return false;
		}
		const called = res.toolCalls.map((c) => c.name);
		const shown = res.content
			?? (called.length > 0 ? `(tool call: ${called.join(', ')})` : '');
		messages.push({ role: 'assistant', content: shown || null });
		messages.push({ role: 'user', content: planRepairHint(err.message) });
		return true;
	}

	effectiveWatches():string[] {
		const seen = new Set(this.pinnedWatches);
		const extra = this.watches.filter((w) => {
			if (seen.has(w)) {
				return false;
			}
			seen.add(w);
			return true;
		});
		return [...this.pinnedWatches, ...extra];
	}

	private absorbPending():void {
		for (let i = this.recentAbsorbed; i < this.pendingEvents.length; i++) {
			const e = this.pendingEvents[i];
			if (!e || SKIP_RECENT.has(e.kind)) {
				continue;
			}
			const text = e.text.trim();
			if (!text) {
				continue;
			}
			this.noteRecent(text);
			if (e.kind === 'HeardSpeech') {
				const rows = this.memory.all();
				const last = rows[rows.length - 1];
				if (last?.text !== text) {
					this.memory.add({
						category: 'episodic',
						text,
						tags: e.tags ? [...e.tags] : ['speech'],
						createdAt: e.at ?? this.now,
					}, e.at ?? this.now);
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

	private shortTermText():string {
		return shortTermBlock(this.recentSummary, this.recent);
	}

	private applyWatches(raw:unknown):void {
		if (!this.watchesWritable || !isRecord(raw) || !Array.isArray(raw.watches)) {
			return;
		}
		this.watches = raw.watches.filter((x):x is string => (
			typeof x === 'string' && !this.pinnedWatches.includes(x)
		));
	}

	private applyMind(raw:unknown):void {
		this.applyWatches(raw);
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
		const nextName = typeof raw.name === 'string' ? raw.name.trim() : '';
		const nextRole = typeof raw.role === 'string' ? raw.role.trim() : '';
		const rename = nextName.length > 0 && nextName !== this.identity.name;
		const reroled = nextRole.length > 0 && nextRole !== this.identity.role;
		let changed = false;
		if (reroled) {
			this.identity.role = nextRole;
			changed = true;
		}
		if (rename && reroled) {
			this.identity.name = nextName;
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
		const text = `I am ${this.identity.name}. ${this.identity.role}`;
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
		if (this.now - this.lastIntrusionAt < this.intrusionCooldown) {
			return undefined;
		}
		const tags = this.pendingEvents.flatMap((e) => e.tags ?? []);
		const hit = this.memory.intrusion({
			query: perceptionText,
			now: this.now,
			tags,
			threshold: this.intrusionThreshold,
		});
		if (!hit) {
			return undefined;
		}
		this.lastIntrusionAt = this.now;
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

	private mergedTools():Record<string, ToolSpec<HostCtx>> {
		const tools:{ [k:string]:ToolSpec<HostCtx> } = { ...this.recipe.tools };
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
				handler: (_ctx, args) => this.handleRecall(args),
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
				description: 'Who you can say(to) right now. Pass to to check one name before you plan a say. Out of range: error, no speech; go_to them first. Omit to to list everyone in range.',
				parameters: {
					type: 'object',
					additionalProperties: false,
					properties: {
						to: { type: 'string' },
					},
				},
				handler: (_ctx, args) => this.handleEarshot(args),
			};
		}
		if (this.seeMapOn() && !tools.see_map) {
			tools.see_map = {
				description: 'Pictogram of the land. Prefer the English scene; only call this if you cannot pick a go_to from names you already have. A second look soon after, without moving, returns the same legend and no new picture.',
				parameters: {
					type: 'object',
					additionalProperties: false,
					properties: {
						zoom: { type: 'number', minimum: 0, maximum: 1 },
					},
				},
				handler: (_ctx, args) => this.handleSeeMap(args),
			};
		}
		if (this.seeMapOn() && this.toolRoundCap <= 0 && tools.see_map) {
			return { see_map: tools.see_map };
		}
		return tools;
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
			snap = await this.map.snapshot(this.id, zoom, prev);
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
		const stamped = await stampMap(snap);
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

	private earshotPush():string {
		const names = this.talk?.nearby(this.id) ?? [];
		if (names.length === 0) {
			return 'No one in talking range. say(to) will fail until you go_to them.';
		}
		return `In talking range: ${names.join(', ')}. say(to) only those names; go_to anyone else first. Far-off speech is muffled.`;
	}

	private sayToOf(args:Record<string, string | number | boolean | string[]>):SayTo | undefined {
		const to = args.to;
		if (Array.isArray(to)) {
			const names = to.filter((x):x is string => typeof x === 'string' && x.trim().length > 0);
			return names.length > 0 ? names : undefined;
		}
		if (typeof to === 'string' && to.trim()) {
			return to;
		}
		return undefined;
	}

	private unreachableSay(plan:ActionPlan):{ reason:string; nearby:string[] } | undefined {
		if (!this.talk || plan.head.verb !== 'say') {
			return undefined;
		}
		const check = this.talk.canSay(this.id, this.sayToOf(plan.head.args));
		if (check.ok) {
			return undefined;
		}
		return { reason: check.reason ?? 'not in earshot', nearby: check.nearby };
	}

	private handleEarshot(args:unknown):unknown {
		if (!this.talk) {
			return { error: 'no talk' };
		}
		const row = isRecord(args) ? args : {};
		const to = typeof row.to === 'string' ? row.to.trim() : '';
		if (!to) {
			const names = this.talk.nearby(this.id);
			return names.length > 0 ? names : 'No one in talking range.';
		}
		const check = this.talk.canSay(this.id, to);
		if (!check.ok) {
			return {
				error: check.reason,
				inRange: false,
				nearby: check.nearby,
			};
		}
		return { ok: true, inRange: true, nearby: check.nearby };
	}

	private handleObserve(ctx:HostCtx, args:unknown):unknown {
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

	private async runTool(name:string, rawArgs:string, ctx:HostCtx):Promise<unknown> {
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

	private async runStep(step:Step, ctx:HostCtx):Promise<ActionResult> {
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
			const nextName = typeof step.args.name === 'string' ? step.args.name.trim() : '';
			const nextRole = typeof step.args.role === 'string' ? step.args.role.trim() : '';
			const rename = nextName.length > 0 && nextName !== this.identity.name;
			const reroled = nextRole.length > 0 && nextRole !== this.identity.role;
			const changed = this.applyIdentityPatch({
				name: step.args.name,
				role: step.args.role,
				traits: step.args.traits,
			});
			if (rename && !reroled && !changed) {
				return {
					ok: false,
					verb: 'set_identity',
					reason: 'name only changes with a new role',
				};
			}
			return { ok: changed, verb: 'set_identity', reason: changed ? undefined : 'nothing to change' };
		}
		if (step.verb === 'say' && this.talk) {
			const text = String(step.args.text ?? '');
			const to = this.sayToOf(step.args);
			const result = this.talk.say(this.id, text, to, this.now);
			if (result.ok && text.trim()) {
				const who = Array.isArray(to) ? to.join(', ') : to;
				this.noteRecent(who ? `You said to ${who}: "${text.trim()}"` : `You said: "${text.trim()}"`);
			}
			return result;
		}
		if (!this.execute) {
			return { ok: false, verb: step.verb, reason: `host has no executor for ${step.verb}` };
		}
		return this.execute(step, ctx);
	}
}
