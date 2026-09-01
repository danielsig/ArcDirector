import {
	Agent,
	ArcDirector,
	TalkNet,
	STOCK_VERBS,
	roleMentionTitles,
	type ActionResult,
	type AgentEvent,
	type AgentJSON,
	type Kit,
	type KernelSource,
	type MapSense,
	type Step,
	type VerbCall,
} from 'arc-director';
import { NPCInput } from '../actors/NPCInput';
import {
	Celebrating,
	Named,
	Companion,
} from '../engine/components';
import type { World } from '../engine/World';
import type { HudAiLogEntry, HudChatLine } from '../ui/hudModel';
import { preferredChatModel, saveModelPref } from '../engine/modelPref';
import {
	loadBatchThinkPref,
	loadThinkPref,
	loadThinkingBudgetPref,
} from '../engine/thinkPref';
import { publishAiLog, resetAiLogSink, pushLog, logLook } from './aiLogSink';
import { rewriteRetiredFeeNames } from '../engine/gameSave';
import { talkFace, canHearClearly } from './talkAttend';
import { YOU_SYMBOL } from './mapMarks';
import { snapshotMap } from './mapView';
import type { HostCtx, SceneHooks } from './types';
import { bodyName, findBody } from './names';
import { kernelsOf, scanWorld, type PosedFact } from './kernels';
import { hostCanSee, lookWorld, inventoryOf, followedCarry } from './perception';
import { executeStep } from './verbs';
import { restoreCompanionHold } from './companion';
import {
	inTalkRange,
	talkOthers,
	talkNames,
	onSpoke,
	hearIfClose,
} from './playerTalk';

export type { HostCtx, SceneHooks };

const PLAN_RETRY_CAP = 3;
const STALL_VERBS = new Set(['wait', 'wander', 'say', 'set_status']);

export class GameHost {
	readonly world:World;
	readonly talk:TalkNet;
	ambient:string;
	bargainDone = false;
	hooks:SceneHooks<GameHost> = {};
	arc:ArcDirector<HostCtx> | null = null;
	/** Shared kit for this scene. Mutate `verbs` / `tools`; fetched every tick. */
	kit:Kit = { verbs: [...STOCK_VERBS] };
	posedEvents:PosedFact[] = [];
	readonly doorOpen = new Map<string, boolean>();
	readonly chestOpen = new Map<string, boolean>();
	readonly pendingHear = new Map<string, {
		speakerID:string;
		spoken:string;
		addressed:boolean;
		until:number;
	}[]>();
	readonly labels = new Map<string, { text:string; until:number }>();
	logSeq = 0;
	readonly chat:HudChatLine[];
	readonly log:HudAiLogEntry[];
	private storedAgents:Record<string, AgentJSON>;
	private disposed = false;
	private starting = false;
	private nextTryAt = 0;

	constructor(
		world:World,
		chat:HudChatLine[],
		log:HudAiLogEntry[],
		opts:{
			ambient?:string;
			agents?:Record<string, AgentJSON>;
			bargainDone?:boolean;
		} = {},
	) {
		this.world = world;
		this.chat = chat;
		this.log = log;
		this.ambient = opts.ambient ?? 'A damp stone hall of the abbey.';
		this.storedAgents = JSON.parse(rewriteRetiredFeeNames(JSON.stringify(opts.agents ?? {}))) as Record<string, AgentJSON>;
		this.bargainDone = opts.bargainDone ?? false;
		this.talk = new TalkNet({
			inRange: (speakerID, listenerID) => inTalkRange(world, speakerID, listenerID),
			others: (speakerID) => talkOthers(world, speakerID),
			canSee: (a, b) => hostCanSee(world, a, b),
			clearHear: (a, b) => canHearClearly(world, a, b),
			names: (id) => talkNames(this, id),
			face: (who, toward) => talkFace(world, who, toward),
		}, (utterance) => onSpoke(this, utterance), { approach: false });
		this.log.length = 0;
		resetAiLogSink();
	}

	configure(director:ArcDirector<HostCtx>):ArcDirector<HostCtx> {
		return director
			.withPriorityQueue({
				maxParallel: loadThinkPref(),
				batchThinks: loadBatchThinkPref(),
				batchWait: 5,
				mayThink: (ctx) => {
					const go = this.world.findByID(ctx.npcID);
					const npc = go?.getComponent(NPCInput);
					if (ctx.plan) {
						return ctx.reason === 'major' || (ctx.reason === 'watch' && ctx.rankedScore >= 0.5);
					}
					if ((ctx.reason === 'heartbeat' || ctx.reason === 'action') && npc?.busy()) {
						return false;
					}
					return true;
				},
			})
			.withLMStudioInference({
				baseURL: '/inference/v1',
				model: preferredChatModel(),
				enableThinking: loadThinkingBudgetPref() > 0,
				thinkingBudget: loadThinkingBudgetPref() || undefined,
				maxTokens: 10_000,
			})
			.addStockVerbs()
			.onVerb(this.do)
			.withSight((ctx) => lookWorld(ctx.actor, this.ambient))
			.withInventory((ctx) => inventoryOf(ctx.actor))
			.withLineOfSight((a, b) => hostCanSee(this.world, a, b))
			.addSense('followed', {
				description: 'What the person you follow is carrying.',
				gather: followedCarry,
			})
			.withContext(this.context)
			.withKernels(this.kernels)
			.withTalk(this.talk)
			.withMap(this.mapSense)
			.onAbortPlan(this.abortPlan)
			.onLog((entry) => pushLog(this, entry.name, entry.message, entry.image));
	}

	bind(director:ArcDirector<HostCtx>):void {
		this.arc = director;
		if (this.arc.ready && Object.keys(this.storedAgents).length > 0) {
			this.arc.restoreAgents(this.storedAgents);
			for (const agent of this.arc.agents()) {
				this.wireBody(agent.id);
			}
		}
	}

	do = (call:VerbCall<HostCtx>):Promise<ActionResult> | ActionResult => {
		return executeStep(this, { verb: call.verb, args: call.args as Step['args'] }, call.ctx);
	};

	context = (id:string):HostCtx => {
		const body = this.world.findByID(id);
		if (!body) {
			throw new Error(`missing body ${id}`);
		}
		return { world: this.world, actor: body };
	};

	abortPlan = (id:string):void => {
		this.world.findByID(id)?.getComponent(NPCInput)?.interrupt('urgent');
		this.world.findByID(id)?.getComponent(Celebrating)?.stop();
	};

	private readonly mapSense:MapSense = {
		you: YOU_SYMBOL,
		snapshot: (npcID, zoom, prev) => {
			const snap = snapshotMap(this.world, npcID, zoom, prev);
			if (snap && 'marks' in snap) {
				void logLook(this, npcID, zoom, snap);
			}
			return snap;
		},
	};

	kernels:KernelSource<HostCtx> = (ctx) => kernelsOf(this.world, ctx.actor, this.posedEvents);

	async start():Promise<void> {
		if (this.disposed || !this.arc || this.starting || this.arc.ready) {
			return;
		}
		this.starting = true;
		try {
			await this.arc.start();
		}
		catch {
			this.nextTryAt = this.world.time + 3;
			this.world.setMessage('NPCs idle — start LM Studio on port 1234');
			return;
		}
		finally {
			this.starting = false;
		}
		const pref = preferredChatModel();
		if (pref !== this.arc.model) {
			this.arc.setModel(pref);
		}
		saveModelPref(this.arc.model);
		if (Object.keys(this.storedAgents).length > 0) {
			this.arc.restoreAgents(this.storedAgents);
		}
		for (const agent of this.arc.agents()) {
			this.wireBody(agent.id);
		}
	}

	wireBody(id:string):void {
		const actor = this.world.findByID(id) ?? findBody(this.world, id);
		const agent = this.agentByID(id);
		if (!actor) {
			console.warn(`GameHost: no ${id}`);
			pushLog(this, 'GameHost', `no ${id} in the world`);
			this.arc?.removeAgent(id);
			return;
		}
		if (!agent) {
			return;
		}
		const named = actor.getComponent(Named);
		if (named) {
			const given = roleMentionTitles(agent.identity.role).filter((t) => /^[A-Z][A-Za-z0-9]*$/.test(t));
			named.aliases = [...new Set([...(named.aliases ?? []), agent.identity.name, ...given])];
		}
		restoreCompanionHold(this, actor, agent);
		const npc = actor.getComponent(NPCInput);
		if (npc) {
			npc.aiOn = true;
		}
		agent.toolRoundCap = 0;
		agent.planRetryCap = PLAN_RETRY_CAP;
		agent.stalled = (result) => !result.ok || !!result.interrupted || STALL_VERBS.has(result.verb ?? '');
		if (actor.getComponent(Companion)) {
			agent.strategicInterval = 0;
		}
		this.talk.attach({
			id: agent.id,
			pushEvent: (event) => {
				const stamped = { ...event, at: event.at ?? this.world.time };
				agent.pushEvent(stamped);
				if (stamped.major) {
					this.wakeMind(agent.id);
					this.arc?.mindQueue()?.enqueueMajor(agent.id, true);
				}
			},
		});
		this.arc?.mindQueue()?.setAiOn(agent.id, true);
	}

	exportAgents():Record<string, AgentJSON> {
		return this.arc?.exportAgents() ?? {};
	}

	restoreAgents(agents:Record<string, AgentJSON>):void {
		this.storedAgents = JSON.parse(rewriteRetiredFeeNames(JSON.stringify(agents))) as Record<string, AgentJSON>;
		this.doorOpen.clear();
		this.chestOpen.clear();
		if (!this.arc?.ready) {
			return;
		}
		this.arc.restoreAgents(this.storedAgents);
		for (const agent of this.arc.agents()) {
			this.wireBody(agent.id);
		}
	}

	observe(_dt = 0):void {
		scanWorld(this);
		this.hooks.checkBargain?.(this);
		this.hooks.tickCrowd?.(this);
		hearIfClose(this);
		publishAiLog(this.log);
		if (!this.arc?.ready && this.world.time >= this.nextTryAt) {
			void this.start();
		}
	}

	pulse(dt = 0):void {
		if (this.disposed) {
			return;
		}
		if (!this.arc?.ready) {
			return;
		}
		this.arc.tick(dt, this.world.time);
	}

	wakeMind(id:string):void {
		const go = this.world.findByID(id) ?? findBody(this.world, id);
		go?.getComponent(Celebrating)?.stop();
		this.arc?.mindQueue()?.setAiOn(id, true);
		const npc = go?.getComponent(NPCInput);
		if (npc) {
			npc.aiOn = true;
		}
	}

	pushEvent(event:AgentEvent):void {
		const stamped = { ...event, at: event.at ?? this.world.time };
		this.arc?.pushEvent(stamped);
		const urgent = /^(Theft|HeardSpeech|Hurt)$/i.test(stamped.kind)
			|| (stamped.tags ?? []).some((t) => /^(steal|theft|hurt|speech|threat)$/i.test(t));
		if (!stamped.major || !urgent) {
			return;
		}
		for (const agent of this.arc?.agents() ?? []) {
			this.wakeMind(agent.id);
		}
	}

	agentByID(id:string):Agent<HostCtx> | undefined {
		const a = this.arc?.agent(id);
		if (a) {
			return a;
		}
		const go = findBody(this.world, id);
		if (!go) {
			return;
		}
		return this.arc?.agent(go.id) ?? this.arc?.agent(bodyName(go));
	}

	dispose():void {
		this.disposed = true;
		for (const agent of this.arc?.agents() ?? []) {
			this.talk.detach(agent.id);
		}
		this.arc?.dispose();
	}
}
