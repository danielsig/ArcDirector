import {
	Agent,
	ArcDirector,
	CrowdConductor,
	TalkNet,
	isCrowdConductor,
	type Kit,
	type KernelSource,
	type MapSense,
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
import { talkFace, canHearClearly, SPEECH_LIFE } from './talkAttend';
import { YOU_SYMBOL } from './mapMarks';
import { snapshotMap } from './mapView';
import { WORLD_ENCYCLOPEDIAS } from './encyclopedias';
import type { AgentCtx, SceneHooks } from './types';
import { bodyName, findBody, isLiving } from './names';
import { kernelsOf, scanWorld } from './kernels';
import { hostCanSee, lookWorld, inventoryOf, followedCarry } from './perception';
import { addBodyVerbs, GAME_VERBS, verbGate } from './verbs';
import { gameWorld } from './world';
import { fightExprTags } from './fight';
import {
	inTalkRange,
	talkOthers,
	talkNames,
	onSpoke,
} from './playerTalk';

export type { AgentCtx, SceneHooks };

const ARC_RETRY_CAP = 3;
const STALL_VERBS = new Set(['wait', 'wander', 'say', 'set_status']);

export class GameHost {
	readonly world:World;
	readonly talk:TalkNet;
	ambient:string;
	bargainDone = false;
	readonly scene:string;
	hooks:SceneHooks<GameHost> = {};
	arc:ArcDirector<AgentCtx> | null = null;
	/** Shared kit for this scene. Mutate `verbs` / `tools`; fetched every tick. */
	kit:Kit = { verbs: [...GAME_VERBS] };
	readonly doorOpen = new Map<string, boolean>();
	readonly chestOpen = new Map<string, boolean>();
	readonly labels = new Map<string, { text:string; until:number }>();
	logSeq = 0;
	readonly chat:HudChatLine[];
	readonly log:HudAiLogEntry[];
	private disposed = false;
	private starting = false;
	private nextTryTimestamp = 0;

	constructor(
		world:World,
		chat:HudChatLine[],
		log:HudAiLogEntry[],
		opts:{
			ambient?:string;
			scene?:string;
		} = {},
	) {
		this.world = world;
		this.chat = chat;
		this.log = log;
		this.scene = opts.scene ?? '';
		this.ambient = opts.ambient ?? 'A damp stone hall of the dungeon.';
		this.talk = new TalkNet({
			inRange: (speakerID, listenerID) => this.inCrowdRange(speakerID, listenerID),
			others: (speakerID) => this.talkOthersOf(speakerID),
			canSee: (a, b) => this.crowdCanSee(a, b),
			clearHear: (a, b) => this.crowdClearHear(a, b),
			names: (id) => talkNames(this, id),
			face: (who, toward) => talkFace(world, who, toward),
		}, (utterance) => onSpoke(this, utterance), { approach: false, rehear: SPEECH_LIFE });
		this.log.length = 0;
		resetAiLogSink();
	}

	configure(director:ArcDirector<AgentCtx>):ArcDirector<AgentCtx> {
		const addAgent = director.addAgent.bind(director);
		director.addAgent = (spec) => addAgent({
			...spec,
			skipHeartbeat: spec.skipHeartbeat ?? true,
		});
		return addBodyVerbs(director)
			.withPriorityQueue({
				maxParallel: prefs().maxParallel,
				batchThinks: prefs().batchThinks,
				batchWait: 5,
				verbScores: { steal: 0.95, equip: 0.5, unequip: 0.5 },
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
						return !!ctx.arc;
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
			.withWorld(gameWorld(this))
			.withVerbGate(verbGate(this))
			.withToolRounds(0)
			.withRepair({ retries: ARC_RETRY_CAP })
			.withStalled((result) => !result.ok || !!result.interrupted || STALL_VERBS.has(result.verb ?? ''))
			.withSight({ look: (ctx) => lookWorld(ctx.actor, this.ambient, this), unitName: 'm' })
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
			.withEncyclopedia((ctx) => WORLD_ENCYCLOPEDIAS[ctx.scene] ?? [])
			.onAbortArc(this.abortArc)
			.onLog((entry) => pushLog(this, entry.name, entry.message, entry.image));
	}

	bind(director:ArcDirector<AgentCtx>):void {
		this.arc = director;
	}

	context = (id:string):AgentCtx | undefined => {
		const body = this.world.findByID(id) ?? findBody(this.world, id);
		const npc = body?.getComponent(NPCInput);
		if (!isLiving(body) || !npc) {
			return undefined;
		}
		return { world: this.world, actor: body, npc, scene: this.scene };
	};

	abortArc = (id:string):void => {
		if (this.bargainDone) {
			return;
		}
		(this.world.findByID(id) ?? findBody(this.world, id))?.getComponent(Celebrating)?.stop();
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

	kernels:KernelSource<AgentCtx> = (ctx, point) => kernelsOf(
		this.world,
		ctx.actor,
		point && { x: point[0], z: point[1] },
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
			this.nextTryTimestamp = this.world.time + 3;
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
		for (const agent of this.arc.agents()) {
			this.wireBody(agent.id);
		}
	}

	wireBody(id:string):void {
		const actor = this.world.findByID(id) ?? findBody(this.world, id);
		const agent = this.agentByID(id);
		if (!actor) {
			if (isCrowdConductor(agent) && agent.crowd.size > 0) {
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
		if (named && agent.identity.role) {
			named.aliases = [...new Set([...(named.aliases ?? []), agent.identity.role])];
		}
		const npc = actor.getComponent(NPCInput);
		if (npc) {
			npc.aiOn = true;
		}
		if (actor.getComponent(Companion)) {
			agent.strategicInterval = 0;
		}
	}

	observe(dt = 0):void {
		scanWorld(this);
		this.hooks.checkBargain?.(this);
		this.hooks.tickMarketNPC?.(this);
		publishAiLog(this.log);
		if (!this.arc?.ready && this.world.time >= this.nextTryTimestamp) {
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

	agentByID(id:string):Agent<AgentCtx> | undefined {
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

	private conductorOf(id:string):CrowdConductor<AgentCtx> | undefined {
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

	private crowdBodies(conductor:CrowdConductor<AgentCtx>):GameObject[] {
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
