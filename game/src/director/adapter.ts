import { Time, type GameObject } from '@arc-director/kindling';
import { SpeechQueue } from './speechQueue';
import {
	ArcDirector,
	BrowserProvider,
	HttpProvider,
	TalkNet,
	parseArc,
	LM_STUDIO_LOAD,
	type ArcResult,
	type Character,
	type Collective,
	type KernelSource,
	type MapSense,
	type Mind,
	type ModelSpec,
} from 'arc-director';
import { NPCInput } from '../characters/NPCInput';
import { PlayerPilot } from '../characters/PlayerPilot';
import {
	Celebrating,
	Named,
	Companion,
	HearOnly,
} from '../engine/components';
import type { World } from '../engine/World';
import type { HudAiLogEntry, HudChatLine } from '../ui/hudModel';
import { prefs, setPrefs, type Prefs } from '../prefs';
import { publishAiLog, resetAiLogSink, pushLog, logLook } from './aiLogSink';
import { talkFace, canHearClearly, SPEECH_LIFE } from './talkAttend';
import { YOU_SYMBOL } from './mapMarks';
import { snapshotMap } from './mapView';
import { WORLD_KNOWLEDGE } from './knowledge';
import type { CharacterCtx, SceneHooks } from './types';
import { idOf, findObject, isLiving } from './names';
import { kernelsOf, scanWorld } from './kernels';
import { lookWorld, inventoryOf, followedCarry } from './perception';
import { roomBounds, type RoomDef } from '../world/spawn';
import { verbGate } from './verbs';
import { gameWorld } from './world';
import { LM_STUDIO_ROOT, SKALDIC_LAYA, decisionModelOf, menuModel, showDownload, type SamplingSource } from './inference';
import { HOSTED, defaultSystemOne } from './hosted';
import { fightExprTags } from './fight';
import {
	inTalkRange,
	talkOthers,
	talkNames,
	onSpoke,
	noteAct,
} from './playerTalk';

export type { CharacterCtx, SceneHooks };

const ARC_RETRY_CAP = 1;
const STALL_VERBS = new Set(['wait', 'wander', 'say', 'set_status']);

/**
 * The menu's chat model three ways, one loaded model under them all: `main`, which every mind thinks with unless a
 * scene assigns another; `quick`, without reasoning, for minds that must answer mid-fight; and `local`, the System
 * One that scores `choose` picks with it, or with the menu's decision model. In the browser, the one model on the
 * GPU answers as many thinks at once as parallel thinkers allows, and adding it starts its download.
 */
export function addModels<TCtx>(director:ArcDirector<TCtx>, p:Prefs = prefs(), sampling:SamplingSource = 'menu'):ArcDirector<TCtx> {
	if (p.inference === 'browser' && p.browserModel) {
		// One download for all three; the picker shows it.
		const main = { model: p.browserModel, ...menuModel(p, sampling) };
		// A loading bar over the game while it downloads (with Cancel), as well as the picker's.
		director.addBrowserModel('main', main);
		showDownload(p.browserModel, BrowserProvider.shared.download(p.browserModel));
		director.addBrowserModel('quick', { ...main, thinking: false });
		const decider = decisionModelOf(p);
		// Skaldic Laya is a System One on its own engine (the library sees to it); without it the chat model scores.
		director.addBrowserModel('local', decider || { ...main, thinking: false, decision: true });
		return director;
	}
	const main:ModelSpec = { inference: 'lmstudio', id: p.model || undefined, ...menuModel(p, sampling) };
	const decider = decisionModelOf(p);
	director.addModel('main', main).addModel('quick', { ...main, thinking: false });
	// Skaldic Laya in the browser beside LM Studio's chat model; else an LM Studio model scores, or the chat model.
	return decider === SKALDIC_LAYA.model
		? director.addBrowserModel('local', decider)
		: director.addModel('local', { ...main, id: decider || main.id, thinking: false, decision: true });
}

/**
 * How the game's minds think, whatever world they are in: the menu's models (LM Studio's or the browser's), its arc
 * format, and repairs. Play and the arc bench share it; a bench samples as each model's makers say.
 */
export function addThinking<TCtx>(director:ArcDirector<TCtx>, p:Prefs = prefs(), sampling:SamplingSource = 'menu'):ArcDirector<TCtx> {
	return addModels(director.addLMStudioInference({ baseURL: `${LM_STUDIO_ROOT}/v1`, load: LM_STUDIO_LOAD }), p, sampling)
		.withArcFormat(p.arcFormat)
		.withRepair({ retries: ARC_RETRY_CAP });
}

/**
 * xAI's models, through the dev server's `/xai` proxy, which adds the key (`HOSTED.xai`). They reason before every
 * answer, at length, so they get room for it.
 */
export const XAI = new HttpProvider({ baseURL: '/xai', timeoutMs: 600_000, maxTokens: 16384, enableThinking: true });

/** As {@link addThinking}, with xAI's `id` as every model, as the benches set it beside the local ones. */
export function addXAIThinking<TCtx>(director:ArcDirector<TCtx>, id:string, p:Prefs = prefs()):ArcDirector<TCtx> {
	const main:ModelSpec = { inference: 'xai', id, thinking: true, maxParallel: p.maxParallel };
	return director
		.addInference('xai', XAI)
		.addModel('main', main)
		.addModel('quick', { ...main, thinking: false })
		.addModel('local', { ...main, thinking: false, decision: true })
		.withArcFormat(p.arcFormat)
		.withRepair({ retries: ARC_RETRY_CAP });
}

export class GameHost {
	public readonly world:World;
	public readonly talk:TalkNet;
	/** Bubbles and voices, one speaker at a time. */
	public readonly speech:SpeechQueue;
	public ambient:string;
	public bargainDone = false;
	public readonly scene:string;
	public hooks:SceneHooks<GameHost> = {};
	public arc:ArcDirector<CharacterCtx> | null = null;
	public readonly doorOpen = new Map<string, boolean>();
	public readonly chestOpen = new Map<string, boolean>();
	public readonly labels = new Map<string, { text:string; until:number }>();
	public logSeq = 0;
	public readonly chat:HudChatLine[];
	public readonly log:HudAiLogEntry[];
	/** The scene's rooms: each with a `memory` puts it on the mind of whoever stands in it. */
	public readonly rooms:RoomDef[];
	/** Tags of the player's character, from the scene (a fight role). */
	private readonly _playerTags:string[];
	private _disposed = false;
	private _starting = false;
	/** Its director's start has resolved: its servers and models answered. Laws and moves run from before then. */
	private _started = false;
	private _nextTryTimestamp = 0;

	constructor(
		world:World,
		chat:HudChatLine[],
		log:HudAiLogEntry[],
		opts:{
			ambient?:string;
			scene?:string;
			playerTags?:string[];
			rooms?:RoomDef[];
		} = {},
	) {
		this.world = world;
		this.chat = chat;
		this.speech = new SpeechQueue(world);
		this.log = log;
		this.scene = opts.scene ?? '';
		this._playerTags = opts.playerTags ?? [];
		this.rooms = opts.rooms ?? [];
		this.ambient = opts.ambient ?? 'A damp stone hall of the dungeon.';
		this.talk = new TalkNet({
			inRange: (speakerID, listenerID) => inTalkRange(world, speakerID, listenerID),
			others: (speakerID) => talkOthers(world, speakerID),
			clearHear: (a, b) => canHearClearly(world, a, b),
			hears: (speakerID, listenerID) => this.mayHear(speakerID, listenerID),
			names: (id) => talkNames(this, id),
			face: (who, toward) => talkFace(world, who, toward),
		}, (utterance) => onSpoke(this, utterance), { approach: false, rehear: SPEECH_LIFE });
		this.log.length = 0;
		resetAiLogSink();
	}

	public configure(director:ArcDirector<CharacterCtx>):ArcDirector<CharacterCtx> {
		// Both System Ones, named as the menu names them; the menu picks the default, a scene may assign either. Jev
		// only with its key on the dev server (`HOSTED`).
		addThinking(director);
		if (HOSTED.jev) {
			director.addJevInference({ name: 'jev' });
		}
		director.setDefaultSystemOne(defaultSystemOne(prefs().systemOne));
		for (const room of this.rooms) {
			const { minX, maxX, minZ, maxZ } = roomBounds(room);
			const box = { from: [minX, minZ], to: [maxX, maxZ] };
			if (room.memory) {
				director.addRegion(room.name, { ...box, memory: room.memory });
			}
			for (const [id, memory] of Object.entries(room.memories ?? {})) {
				director.addRegion(`${room.name}:${id}`, { ...box, who: ({ character }) => idOf(character) === id, memory });
			}
		}
		return director
			.withCurrency('gold')
			.withMindDefaults({ skipHeartbeat: true })
			.withPriorityQueue({
				batchThinks: prefs().batchThinks,
				batchWait: 5,
				verbScores: { steal: 0.95, equip: 0.5, unequip: 0.5 },
				heartbeatStart: 2,
				heartbeatMin: 2,
				mayThink: (ctx) => {
					if (this.hooks.mayThink?.(this, ctx.mindID) === false) {
						return false;
					}
					const collective = this.arc?.collective(ctx.mindID);
					if (collective) {
						return collective.characters.some((c) => isLiving(findObject(this.world, c.id)));
					}
					const go = this.world.findByID(ctx.mindID) ?? findObject(this.world, ctx.mindID);
					if (!isLiving(go)) {
						return false;
					}
					// An idle mind waits for its watches to wake it; one with none has only its heartbeat.
					if (ctx.reason === 'heartbeat') {
						const persona = this.arc?.character(ctx.mindID)?.persona;
						return !!ctx.arc || (!!persona && Object.keys({ ...persona.watches, ...persona.pinnedWatches }).length === 0);
					}
					return true;
				},
			})
			.addStockVerbs()
			.addStockCollectiveVerbs()
			.withWorld(gameWorld(this))
			.withVerbGate(verbGate(this))
			.withStalled((result) => !result.ok || !!result.interrupted || STALL_VERBS.has(result.verb ?? ''))
			.withSight({ look: (ctx) => lookWorld(ctx.character, this.ambient, this), unitName: 'm' })
			.withInventory((ctx) => inventoryOf(ctx.character))
			.addSense('followed', {
				description: 'What the person you follow is carrying.',
				gather: followedCarry,
			})
			.withContext(this.context)
			.withKernels(this.kernels)
			.withTalk(this.talk)
			.withMap(this._mapSense)
			.withKnowledge((ctx) => WORLD_KNOWLEDGE[ctx.scene] ?? [])
			.onAbortArc(this.abortArc)
			.onLog((entry) => pushLog(this, entry.name, entry.message, entry))
			.onStep((call, result) => noteAct(this, call, result))
			// The player's character, for `enactPlayer`. No mind: it never calls the model.
			.addCharacter({ id: 'Player', tags: this._playerTags });
	}

	public bind(director:ArcDirector<CharacterCtx>):void {
		this.arc = director;
	}

	public context = (id:string):CharacterCtx | undefined => {
		const character = this.world.findByID(id) ?? findObject(this.world, id);
		const npc = character?.getComponent(NPCInput);
		if (!isLiving(character) || !npc) {
			return undefined;
		}
		return { world: this.world, character: character, npc, scene: this.scene };
	};

	public abortArc = (id:string):void => {
		if (this.bargainDone) {
			return;
		}
		(this.world.findByID(id) ?? findObject(this.world, id))?.getComponent(Celebrating)?.stop();
	};

	private readonly _mapSense:MapSense = {
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

	public kernels:KernelSource<CharacterCtx> = (ctx, point) => kernelsOf(
		this.world,
		ctx.character,
		point && { x: point[0], z: point[1] },
		(go) => fightExprTags(this, ctx.character, go),
	);

	public async start():Promise<void> {
		if (this._disposed || !this.arc || this._starting || this._started || !this.world.arcDirectorOn) {
			return;
		}
		this._starting = true;
		try {
			await this.arc.start();
		}
		catch {
			this._nextTryTimestamp = Time.time + 3;
			this.world.setMessage('NPCs idle — start LM Studio on port 1234');
			return;
		}
		finally {
			this._starting = false;
		}
		this._started = true;
		setPrefs({ model: this.arc.modelID() });
		for (const mind of this.arc.minds()) {
			this.wireVoice(mind);
		}
	}

	/** Give the character that speaks for `mind` its role as an alias, and its AI. A mind with no character left is removed. */
	public wireVoice(mind:Mind<CharacterCtx>):void {
		const id = mind.thinkThread();
		const character = this.world.findByID(id) ?? findObject(this.world, id);
		if (!character) {
			const collective = this.arc?.collective(mind.id);
			if (collective && collective.characters.length > 0) {
				return;
			}
			console.warn(`GameHost: no ${id}`);
			pushLog(this, 'GameHost', `no ${id} in the world`);
			if (collective) {
				this.arc?.removeCollective(mind.id);
			}
			else {
				this.arc?.removeCharacter(mind.id);
			}
			return;
		}
		const named = character.getComponent(Named);
		const role = mind.persona.identity.role;
		if (named && role) {
			named.aliases = [...new Set([...(named.aliases ?? []), role])];
		}
		const npc = character.getComponent(NPCInput);
		if (npc) {
			npc.aiOn = true;
		}
		if (character.getComponent(Companion)) {
			mind.strategicInterval = 0;
		}
	}

	public observe(dt = 0):void {
		this.speech.update();
		scanWorld(this);
		this.hooks.checkBargain?.(this);
		this.hooks.tickMarketNPC?.(this);
		publishAiLog(this.log);
		if (!this._started && Time.time >= this._nextTryTimestamp) {
			void this.start();
		}
	}

	public pulse(dt = 0):void {
		if (this._disposed) {
			return;
		}
		if (!this.arc?.ready) {
			return;
		}
		this.arc.tick(dt, Time.time);
	}

	/** Run one arc on the player character. Mind verbs are rejected; a canvas click aborts it. */
	public async enactPlayer(text:string):Promise<ArcResult> {
		const player = this.arc?.ready ? this.arc.character('Player') : undefined;
		const pilot = this.world.findByID('Player')?.getComponent(PlayerPilot);
		if (!player || !pilot) {
			throw new Error('ArcDirector is not running');
		}
		const arc = parseArc(text, player.activeVerbs());
		const release = pilot.claim(() => player.replaceProgram());
		try {
			return await player.enact(arc);
		}
		finally {
			release();
		}
	}

	/** The character with id `id`, or one that answers to that name. */
	public characterOf(id:string):Character<CharacterCtx> | undefined {
		const go = findObject(this.world, id);
		return this.arc?.character(id) ?? (go ? this.arc?.character(go.id) ?? this.arc?.character(idOf(go)) : undefined);
	}

	/** The collective `id` names, or the one its character belongs to. */
	private collectiveOf(id:string):Collective<CharacterCtx> | undefined {
		return this.arc?.collective(id) ?? this.arc?.character(id)?.collective ?? undefined;
	}

	private livingMembers(collective:Collective<CharacterCtx>):GameObject[] {
		const out:GameObject[] = [];
		for (const character of collective.characters) {
			const go = findObject(this.world, character.id);
			if (isLiving(go)) {
				out.push(go);
			}
		}
		return out;
	}

	private lookOrigin(id:string):{ x:number; z:number } | undefined {
		if (isLiving(this.world.findByID(id) ?? findObject(this.world, id))) {
			return undefined;
		}
		const hive = this.collectiveOf(id);
		if (!hive) {
			return undefined;
		}
		const characters = this.livingMembers(hive);
		if (characters.length === 0) {
			return undefined;
		}
		let x = 0;
		let z = 0;
		for (const go of characters) {
			x += go.transform.position.x;
			z += go.transform.position.z;
		}
		return { x: x / characters.length, z: z / characters.length };
	}

	private mayHear(speakerID:string, listenerID:string):boolean {
		const character = this.world.findByID(listenerID) ?? findObject(this.world, listenerID);
		const only = character?.getComponent(HearOnly);
		if (!only) {
			return true;
		}
		return only.from.includes(speakerID);
	}

	public dispose():void {
		this._disposed = true;
		this.arc?.dispose();
	}
}
