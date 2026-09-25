import {
	Agent,
	ArcDirector,
	CrowdConductor,
	TalkNet,
	STOCK_VERBS,
	isCrowdConductor,
	isFormationVerb,
	roleMentionTitles,
	type ArcResult,
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
import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';
import type { HudAiLogEntry, HudChatLine } from '../ui/hudModel';
import { prefs, preferredChatModel, setPrefs } from '../prefs';
import { publishAiLog, resetAiLogSink, pushLog, logLook } from './aiLogSink';
import { rewriteRetiredFeeNames } from '../engine/gameSave';
import { talkFace, canHearClearly } from './talkAttend';
import { YOU_SYMBOL } from './mapMarks';
import { snapshotMap } from './mapView';
import { WORLD_ENCYCLOPEDIAS } from './encyclopedias';
import type { HostCtx, SceneHooks } from './types';
import { bodyName, findBody, isLiving } from './names';
import { kernelsOf, scanWorld, type PosedFact } from './kernels';
import { hostCanSee, lookWorld, inventoryOf, followedCarry } from './perception';
import { executeStep } from './verbs';
import { restoreCompanionHold } from './companion';
import { runFormation } from './formations';
import { fightExprTags, resolveFightName } from './fight';
import {
	inTalkRange,
	talkOthers,
	talkNames,
	onSpoke,
	hearIfClose,
} from './playerTalk';

export type { HostCtx, SceneHooks };

const ARC_RETRY_CAP = 3;
const STALL_VERBS = new Set(['wait', 'wander', 'say', 'set_status']);

export class GameHost {
	readonly world:World;
	readonly talk:TalkNet;
	ambient:string;
	bargainDone = false;
	readonly scene:string;
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
			scene?:string;
		} = {},
	) {
		this.world = world;
		this.chat = chat;
		this.log = log;
		this.scene = opts.scene ?? '';
		this.ambient = opts.ambient ?? 'A damp stone hall of the abbey.';
		this.storedAgents = JSON.parse(rewriteRetiredFeeNames(JSON.stringify(opts.agents ?? {}))) as Record<string, AgentJSON>;
		this.bargainDone = opts.bargainDone ?? false;
		this.talk = new TalkNet({
			inRange: (speakerID, listenerID) => this.inCrowdRange(speakerID, listenerID),
			others: (speakerID) => this.talkOthersOf(speakerID),
			canSee: (a, b) => this.crowdCanSee(a, b),
			clearHear: (a, b) => this.crowdClearHear(a, b),
			names: (id) => talkNames(this, id),
			face: (who, toward) => talkFace(world, who, toward),
		}, (utterance) => onSpoke(this, utterance), { approach: false });
		this.log.length = 0;
		resetAiLogSink();
	}

	configure(director:ArcDirector<HostCtx>):ArcDirector<HostCtx> {
		const addAgent = director.addAgent.bind(director);
		director.addAgent = (spec) => addAgent({
			...spec,
			skipHeartbeat: spec.skipHeartbeat ?? true,
		});
		return director
			.withPriorityQueue({
				maxParallel: prefs().maxParallel,
				batchThinks: prefs().batchThinks,
				batchWait: 5,
				heartbeatStart: 2,
				heartbeatMin: 2,
				mayThink: (ctx) => {
					const mind = this.arc?.agent(ctx.npcID);
					if (isCrowdConductor(mind)) {
						return mind.crowd.list().some((unit) => isLiving(findBody(this.world, unit.id)));
					}
					const go = this.world.findByID(ctx.npcID) ?? findBody(this.world, ctx.npcID);
					if (!isLiving(go)) {
						return false;
					}
					if (ctx.reason === 'heartbeat') {
						const npc = go?.getComponent(NPCInput);
						return !!(npc?.busy() || ctx.arc);
					}
					return true;
				},
			})
			.withLMStudioInference({
				baseURL: '/inference/v1',
				model: preferredChatModel(),
				enableThinking: prefs().thinkingBudget,
			})
			.withArcText(prefs().arcText)
			.addStockVerbs()
			.addStockCrowdVerbs()
			.onVerb(this.do)
			.withSight({ look: (ctx) => lookWorld(ctx.actor, this.ambient, this), unitName: 'm' })
			.withInventory((ctx) => inventoryOf(ctx.actor))
			.withLineOfSight((a, b) => hostCanSee(this.world, a, resolveFightName(this, a, b)))
			.addSense('followed', {
				description: 'What the person you follow is carrying.',
				gather: followedCarry,
			})
			.withContext(this.context)
			.withKernels(this.kernels)
			.withTalk(this.talk)
			.withMap(this.mapSense)
			.withEncyclopedia((ctx) => WORLD_ENCYCLOPEDIAS[ctx.scene] ?? [])
			.onAbortArc(this.abortArc)
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

	do = (call:VerbCall<HostCtx>):Promise<ArcResult> | ArcResult => {
		if (isFormationVerb(call.verb)) {
			return runFormation(this, call);
		}
		return executeStep(this, { verb: call.verb, args: call.args as Step['args'] }, call.ctx);
	};

	context = (id:string):HostCtx | undefined => {
		const body = this.world.findByID(id) ?? findBody(this.world, id);
		if (!isLiving(body)) {
			return undefined;
		}
		return { world: this.world, actor: body, scene: this.scene };
	};

	abortArc = (id:string):void => {
		if (this.bargainDone) {
			return;
		}
		const body = this.world.findByID(id) ?? findBody(this.world, id);
		const npc = body?.getComponent(NPCInput);
		npc?.interrupt('urgent');
		body?.getComponent(Celebrating)?.stop();
	};

	private readonly mapSense:MapSense = {
		you: YOU_SYMBOL,
		snapshot: (npcID, zoom, prev) => {
			const origin = this.lookOrigin(npcID);
			const snap = snapshotMap(this.world, npcID, zoom, prev, origin);
			if (snap && 'marks' in snap) {
				void logLook(this, npcID, zoom, snap);
			}
			return snap;
		},
	};

	kernels:KernelSource<HostCtx> = (ctx) => kernelsOf(
		this.world,
		ctx.actor,
		this.posedEvents,
		undefined,
		(go) => fightExprTags(this, ctx.actor, go),
	);

	async start():Promise<void> {
		if (this.disposed || !this.arc || this.starting || this.arc.ready || !this.world.arcDirectorOn) {
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
		setPrefs({ model: this.arc.model });
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
			if (isCrowdConductor(agent) && agent.crowd.size > 0) {
				this.attachMind(agent.id, agent);
				return;
			}
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
		if (actor.getComponent(Companion)) {
			agent.strategicInterval = 0;
		}
		this.attachMind(agent.id, agent);
	}

	private attachMind(id:string, agent:Agent<HostCtx>):void {
		agent.toolRoundCap = 0;
		agent.arcRetryCap = ARC_RETRY_CAP;
		agent.stalled = (result) => !result.ok || !!result.interrupted || STALL_VERBS.has(result.verb ?? '');
		this.talk.attach({
			id,
			pushEvent: (event) => {
				const stamped = { ...event, at: event.at ?? this.world.time };
				agent.pushEvent(stamped);
				if (stamped.major) {
					this.wakeMind(agent.id);
					this.arc?.mindQueue()?.enqueueMajor(agent.id, true);
				}
			},
		});
		this.arc?.mindQueue()?.ensure(id);
		this.arc?.mindQueue()?.setAiOn(id, true);
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
		this.hooks.tickMarketNPC?.(this);
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
		if (go) {
			const named = this.arc?.agent(go.id) ?? this.arc?.agent(bodyName(go));
			if (named) {
				return named;
			}
		}
		for (const agent of this.arc?.agents() ?? []) {
			if (isCrowdConductor(agent) && agent.crowd.has(id)) {
				return agent;
			}
		}
		return undefined;
	}

	private conductorOf(id:string):CrowdConductor<HostCtx> | undefined {
		const agent = this.arc?.agent(id);
		if (isCrowdConductor(agent)) {
			return agent;
		}
		for (const row of this.arc?.agents() ?? []) {
			if (isCrowdConductor(row) && (row.crowd.has(id) || row.id === id)) {
				return row;
			}
		}
		return undefined;
	}

	private crowdBodies(conductor:CrowdConductor<HostCtx>):GameObject[] {
		const out:GameObject[] = [];
		for (const unit of conductor.crowd.list()) {
			const go = findBody(this.world, unit.id);
			if (isLiving(go)) {
				out.push(go);
			}
		}
		return out;
	}

	private lookOrigin(id:string):{ x:number; z:number } | undefined {
		if (isLiving(this.world.findByID(id) ?? findBody(this.world, id))) {
			return undefined;
		}
		const hive = this.conductorOf(id);
		if (!hive) {
			return undefined;
		}
		const bodies = this.crowdBodies(hive);
		if (bodies.length === 0) {
			return undefined;
		}
		let x = 0;
		let z = 0;
		for (const go of bodies) {
			x += go.transform.position.x;
			z += go.transform.position.z;
		}
		return { x: x / bodies.length, z: z / bodies.length };
	}

	private inCrowdRange(speakerID:string, listenerID:string):boolean {
		if (inTalkRange(this.world, speakerID, listenerID)) {
			return true;
		}
		const listen = this.conductorOf(listenerID);
		if (listen) {
			for (const unit of listen.crowd.list()) {
				if (inTalkRange(this.world, speakerID, unit.id)) {
					return true;
				}
			}
		}
		const speak = this.conductorOf(speakerID);
		if (speak && !findBody(this.world, speakerID)) {
			for (const unit of speak.crowd.list()) {
				if (inTalkRange(this.world, unit.id, listenerID)) {
					return true;
				}
			}
		}
		return false;
	}

	private talkOthersOf(speakerID:string):string[] {
		const speak = this.conductorOf(speakerID);
		if (speak && !findBody(this.world, speakerID)) {
			const names = new Set<string>();
			for (const unit of speak.crowd.list()) {
				for (const name of talkOthers(this.world, unit.id)) {
					names.add(name);
				}
			}
			return [...names];
		}
		return talkOthers(this.world, speakerID);
	}

	private crowdCanSee(a:string, b:string):boolean {
		if (hostCanSee(this.world, a, b)) {
			return true;
		}
		const listen = this.conductorOf(b);
		if (listen) {
			for (const unit of listen.crowd.list()) {
				if (hostCanSee(this.world, a, unit.id)) {
					return true;
				}
			}
		}
		const speak = this.conductorOf(a);
		if (speak) {
			for (const unit of speak.crowd.list()) {
				if (hostCanSee(this.world, unit.id, b)) {
					return true;
				}
			}
			if (listen) {
				for (const su of speak.crowd.list()) {
					for (const lu of listen.crowd.list()) {
						if (hostCanSee(this.world, su.id, lu.id)) {
							return true;
						}
					}
				}
			}
		}
		return false;
	}

	private crowdClearHear(a:string, b:string):boolean {
		if (canHearClearly(this.world, a, b)) {
			return true;
		}
		const listen = this.conductorOf(b);
		if (listen) {
			for (const unit of listen.crowd.list()) {
				if (canHearClearly(this.world, a, unit.id)) {
					return true;
				}
			}
		}
		const speak = this.conductorOf(a);
		if (speak) {
			for (const unit of speak.crowd.list()) {
				if (canHearClearly(this.world, unit.id, b)) {
					return true;
				}
			}
			if (listen) {
				for (const su of speak.crowd.list()) {
					for (const lu of listen.crowd.list()) {
						if (canHearClearly(this.world, su.id, lu.id)) {
							return true;
						}
					}
				}
			}
		}
		return false;
	}

	dispose():void {
		this.disposed = true;
		for (const agent of this.arc?.agents() ?? []) {
			this.talk.detach(agent.id);
		}
		this.arc?.dispose();
	}
}
