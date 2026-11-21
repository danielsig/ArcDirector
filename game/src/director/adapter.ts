import type { GameObject, XZ } from '@arc-director/kindling';
import { SpeechQueue } from './SpeechQueue';
import { ThinkShow } from './ThinkShow';
import {
	showNamingText,
	ArcDirector,
	BrowserProvider,
	parseArc,
	LM_STUDIO_LOAD,
	type ArcResult,
	type Character,
	type Collective,
	type KernelSource,
	type MapSense,
	type Mind,
	type ModelSpec,
	type RegionSpec,
} from 'arc-director';
import { NPCInput } from '../characters/NPCInput';
import { PlayerPilot } from '../characters/PlayerPilot';
import { Reading } from '../characters/Reading';
import { Seated } from '../characters/Seated';
import { Belly } from '../engine/Belly';
import {
	Celebrating,
	Named,
	Companion,
	HearOnly,
	idOf,
} from '../engine/components';
import type { DemoWorld } from '../engine/demo-world';
import { mindsOf, type Scene } from '../scenes/scene';
import type { HudAiLogEntry, HudChatLine } from '../ui/hud-model';
import type { AiLogRun } from '@arc-director/control';
import { prefs, setPrefs, type Prefs } from '../prefs';
import { aiLogRun, publishAiLog, pushLog, logLook } from './ai-log-sink';
import { talkFace, SPEECH_LIFE } from './talk-attend';
import { YOU_SYMBOL } from './map-marks';
import { snapshotMap } from './map-view';
import type { CharacterCtx, SceneHooks } from './game-types';
import { findObject, isLiving } from './names';
import { EXPR_STRINGIFIERS, gameFunctions, kernelsOf, scanWorld } from './kernels';
import { lookWorld, inventoryOf, followedCarry } from './perception';
import { roomBounds, type RoomDef } from '../world/spawn';
import { verbGate } from './game-verbs';
import { onStruck } from './fight-verbs';
import { gameWorld } from './game-world';
import { LM_STUDIO_ROOT, SKALDIC_LAYA, decisionModelOf, menuModel, queuesOrders, showDownload, type SamplingSource } from './inference';
import { HOSTED, defaultSystemOne } from './hosted';
import { fightExprTags, isRival } from './fight';
import {
	inTalkRange,
	talkOthers,
	talkNames,
	onSpoke,
	noteAct,
} from './player-talk';

export type { CharacterCtx, SceneHooks };

const ARC_RETRY_CAP = 1;
const HUNGRY = 'hungry';
const FULL = 'full';

/**
 * The menu's chat model three ways, one loaded model under them all: `main`, which every mind thinks with unless a
 * scene assigns another; `quick`, without reasoning, for minds that must answer mid-fight; and `local`, the System
 * One that scores `choose` picks with it, or the menu's decision model. Again on each change, as the menu's roles move
 * between LM Studio and the browser. In the browser, the one model on the GPU answers as many thinks at once as
 * parallel thinkers allows, and adding it starts its download. Minds are offered queued orders when it is big enough.
 */
export function addModels<TCtx>(director:ArcDirector<TCtx>, p:Prefs = prefs(), sampling:SamplingSource = 'menu'):ArcDirector<TCtx> {
	const browser = p.inference === 'browser' && !!p.browserModel;
	const main:ModelSpec = { id: (browser ? p.browserModel : p.model) || undefined, ...menuModel(p, sampling) };
	const decider = decisionModelOf(p);
	// Skaldic Laya runs in the browser beside either, on its own engine; else an LM Studio model scores, or the chat model.
	const laya = decider === SKALDIC_LAYA.model;
	const local = laya ? decider : { ...main, id: decider || main.id, thinking: false };
	const chat = { main, quick: { ...main, thinking: false } };
	return director.if(browser,
		d => {
			// A loading bar over the game while it downloads (with Cancel), as well as the picker's.
			showDownload(p.browserModel, BrowserProvider.shared.download(p.browserModel));
			d.addWllama({ models: { ...chat, local } });
		},
		d => d
			.addLMStudio({ baseURL: `${LM_STUDIO_ROOT}/v1`, load: LM_STUDIO_LOAD, models: laya ? chat : { ...chat, local } })
			.if(laya, (l) => l.addWllama({ models: { local } }))
	).withMind({ offerAppendedCommands: queuesOrders(main.id) });
}

/**
 * How the game's minds think, whatever world they are in: the menu's models (LM Studio's or the browser's), its arc
 * format, and repairs. Play and the arc bench share it; a bench samples as each model's makers say.
 */
export function addThinking<TCtx>(director:ArcDirector<TCtx>, p:Prefs = prefs(), sampling:SamplingSource = 'menu'):ArcDirector<TCtx> {
	return addModels(director, p, sampling)
		.withMind({ arcFormat: p.arcFormat, repairRetries: ARC_RETRY_CAP, repairPerStep: true, repairUnknownFields: true });
}

/**
 * xAI's server for `addHttp`, through the dev server's `/xai` proxy, which adds the key (`HOSTED.xai`). Its models
 * reason before every answer, at length, so they get room for it.
 */
export const XAI = { name: 'xai', baseURL: '/xai', timeoutMs: 600_000, maxTokens: 16384, enableThinking: true };

/** As {@link addThinking}, with xAI's `id` as every model, as the benches set it beside the local ones. */
export function addXAIThinking<TCtx>(director:ArcDirector<TCtx>, id:string, p:Prefs = prefs()):ArcDirector<TCtx> {
	const main:ModelSpec = { id, thinking: true, maxParallel: p.maxParallel, batchWait: p.batchThinks ? 5 : 0 };
	return director
		.addHttp({ ...XAI, models: { main, quick: { ...main, thinking: false }, local: { ...main, thinking: false } } })
		.withMind({ arcFormat: p.arcFormat, repairRetries: ARC_RETRY_CAP, repairPerStep: true, repairUnknownFields: true });
}

/** Each room as regions: its `memory` for everyone in it, and each of its `memories` for that one character. */
function roomRegions(rooms:RoomDef[]):Record<string, RegionSpec<CharacterCtx>> {
	return Object.fromEntries(rooms.flatMap((room):[string, RegionSpec<CharacterCtx>][] => {
		const { minX, maxX, minZ, maxZ } = roomBounds(room);
		const box = { from: [minX, minZ], to: [maxX, maxZ] };
		const theirs = Object.entries(room.memories ?? {}).map(([id, memory]):[string, RegionSpec<CharacterCtx>] => [`${room.name}:${id}`, { ...box, who: ({ character }) => idOf(character) === id, memory }]);
		return room.memory ? [[room.name, { ...box, memory: room.memory }], ...theirs] : theirs;
	}));
}

/** What every scene keeps as it runs, saved with the game: whether it is won. Each scene adds its own fields. */
export type SceneState = { bargainDone:boolean };

export class GameHost {
	public readonly world:DemoWorld;
	/** Bubbles and voices, one speaker at a time. */
	public readonly speech:SpeechQueue;
	public readonly scene:Scene;
	public readonly hooks:SceneHooks<GameHost>;
	public arc:ArcDirector<CharacterCtx, GameObject> | null = null;
	public readonly doorOpen = new Map<string, boolean>();
	public readonly chestOpen = new Map<string, boolean>();
	public readonly labels = new Map<string, { text:string; until:number }>();
	/** What minds do as they think, on show. */
	public readonly thinks:ThinkShow;
	public logSeq = 0;
	public readonly chat:HudChatLine[];
	public readonly log:HudAiLogEntry[];
	/** This game's run of the AI log: a restart or a new scene logs to a new file, and the last stays whole. */
	public readonly logRun:AiLogRun;
	private readonly _sceneState:SceneState = { bargainDone: false };
	private _disposed = false;

	constructor(
		world:DemoWorld,
		chat:HudChatLine[],
		log:HudAiLogEntry[],
		scene:Scene,
	) {
		this.world = world;
		world.struck = (blow) => onStruck(this, blow);
		world.caught = (character, name) => this.caught(character, name);
		world.canSeeInventoryOf = (viewer, holder) => !!this.arc?.getWorldVerbs()?.canSeeInventoryOf(idOf(viewer), idOf(holder));
		world.enact = async (arc) => {
			const result = await this.enactPlayer(arc);
			return { ...result, reason: result.reason && showNamingText(result.reason) };
		};
		this.chat = chat;
		this.speech = new SpeechQueue(world);
		this.thinks = new ThinkShow(world, () => this.hooks.goals?.(this), (id) => this.arc?.collective(id)?.characters);
		this.log = log;
		this.scene = scene;
		this.hooks = scene.hooks ?? {};
		// A new game starts with no chat and no AI log on show.
		this.chat.length = 0;
		this.log.length = 0;
		this.logRun = aiLogRun(scene.id);
	}

	public configure(director:ArcDirector<CharacterCtx, GameObject>):ArcDirector<CharacterCtx, GameObject> {
		// Both System Ones, named as the menu names them; the menu picks the default, a scene may assign either. Jev
		// only with its key on the dev server (`HOSTED`).
		addThinking(director).if(HOSTED.jev, (d) => d.addJev());
		director.models.withDefaultSystemOne(defaultSystemOne(prefs().systemOne));
		director
			.addRegions(roomRegions(this.scene.rooms ?? []))
			.withMind({ currency: 'gold' })
			.withPriorityThinkQueue({
				// Events, watches and an arc's end wake a mind; a rethink only one whose program has little impact (`rethinkingThreshold`: idle, following, waiting).
				rethinkInterval: 30,
				mayThink: (ctx) => {
					if (this.hooks.mayThink?.(this, ctx.mindID, ctx.reason) === false) {
						return false;
					}
					const collective = this.arc?.collective(ctx.mindID);
					if (collective) {
						return collective.characters.some((c) => isLiving(findObject(this.world, c.id)));
					}
					const go = this.world.findByID(ctx.mindID) ?? findObject(this.world, ctx.mindID);
					// Nor does a sleeper think, until it wakes.
					if (!isLiving(go) || go?.getComponent(Seated)?.asleep) {
						return false;
					}
					// With a book open, only a watch or an event calls it away.
					return ctx.reason !== 'rethink' || !go?.getComponent(Reading)?.active;
				},
			})
			.withVerbs((v) => v.addStock().addStockCollective().withGate(verbGate(this)))
			.withRequirements(this.scene.requirements ?? [])
			.withWorld(gameWorld(this))
			.withSight({ look: (ctx) => lookWorld(ctx.character, this.scene.ambient, this), unitName: 'm' })
			.withInventory((ctx) => inventoryOf(ctx.character))
			.withSenses((s) => s.add('followed', followedCarry))
			.withContext(this.context)
			.withKernels(this.kernels)
			.withFunctions(gameFunctions(this))
			.withStringifiers(EXPR_STRINGIFIERS)
			// Hearing measures each line: its words to about 8 m, muffled farther or through a wall, drowned in a din.
			.withHearing({})
			.withTalk({
				inRange: (speakerID, listenerID) => inTalkRange(this.world, speakerID, listenerID),
				others: (speakerID) => talkOthers(this.world, speakerID),
				hears: (speakerID, listenerID) => this.mayHear(speakerID, listenerID),
				addresses: (speakerID, listenerID) => !this.rivals(speakerID, listenerID),
				names: (id) => talkNames(this, id),
				face: (who, toward) => talkFace(this.world, who, toward),
				onSpoke: (utterance) => onSpoke(this, utterance),
				rehear: SPEECH_LIFE,
				// The no-parrot refusal is written for a model, so the player is never shown it: the player may repeat.
				repeats: (speakerID) => speakerID === 'Player',
			})
			.withMap(this._mapSense)
			.withKnowledge({ pages: () => this.scene.knowledge })
			.onAbortArc(this.abortArc)
			.onLog((entry) => pushLog(this, entry.name, entry.message, entry))
			.onStep((call, result) => noteAct(this, call, result))
			.onThink(this.thinks.handle)
			// Why each think started, in the full log too, for whoever reads it over the control hub (`read_ai_log`).
			.onThink((event) => {
				if (event.kind === 'start' && event.why) {
					pushLog(this, event.who, `start · why: ${event.why}`);
				}
			})
			// The player's character, for `enactPlayer`. No mind: it never calls the model.
			.addCharacter({ id: 'Player', tags: this.scene.player?.tags ?? [] });
		// The cast's minds of their own; the scene adds its collectives.
		mindsOf(this.scene.cast).forEach((spec) => director.addCharacter(spec));
		return director;
	}

	public bind(director:ArcDirector<CharacterCtx, GameObject>):void {
		this.arc = director;
	}

	public context = (id:string):CharacterCtx | undefined => {
		const character = this.world.findByID(id) ?? findObject(this.world, id);
		const npc = character?.getComponent(NPCInput);
		if (!isLiving(character) || !npc) {
			return undefined;
		}
		return { world: this.world, character: character, npc };
	};

	/** The scene's state as it runs, `S` the scene's own fields (each optional until set). The save holds it whole. */
	public sceneState<S extends object = object>():SceneState & Partial<S> {
		return this._sceneState as SceneState & Partial<S>;
	}

	public abortArc = (id:string):void => {
		if (this._sceneState.bargainDone) {
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

	/**
	 * Once the scene and any save are in: give each voice its alias, and, while NPCs may think, ask for the model. The
	 * director keeps trying on its own every tick after a failure.
	 */
	public connect():void {
		const arc = this.arc;
		if (!arc) {
			return;
		}
		for (const mind of arc.minds()) {
			this.wireVoice(mind);
		}
		if (prefs().ai) {
			void arc.connect().then(
				() => setPrefs({ model: arc.getModel()?.id ?? '' }),
				() => this.world.setMessage('NPCs idle — start LM Studio on port 1234'),
			);
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
		if (character.getComponent(Companion)) {
			mind.settings.strategicInterval = 0;
		}
	}

	/** `character` landed a fish: everyone hears, and if it is the player, it says so. */
	private caught(character:GameObject, name:string):void {
		this.arc?.pushEvent({ kind: 'Caught', text: (who) => `${who(idOf(character))} caught ${name}`, tags: ['fish', name], major: false });
		if (character.id === 'Player') {
			this.world.setMessage(`caught ${name}`);
		}
	}

	/** `hungry` or `full` among the traits of whoever has a belly, as it says. */
	private syncHunger():void {
		this.world.forEachComponent(Belly, (belly, go) => {
			const identity = this.arc?.character(idOf(go))?.persona.identity;
			const state = belly.hungry ? HUNGRY : FULL;
			if (identity && !identity.traits?.includes(state)) {
				identity.traits = [...(identity.traits ?? []).filter((trait) => trait !== HUNGRY && trait !== FULL), state];
			}
		});
	}

	public observe(dt = 0):void {
		this.speech.update();
		scanWorld(this);
		this.syncHunger();
		this.hooks.tick?.(this);
		publishAiLog(this.log);
	}

	/** `dt` game seconds pass for the director. */
	public pulse(dt:number):void {
		if (!this._disposed) {
			this.arc?.tick(dt);
		}
	}

	/** Run one arc on the player character. Mind verbs are rejected; a canvas click aborts it. */
	public async enactPlayer(text:string):Promise<ArcResult> {
		const player = this.arc?.character('Player');
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

	private lookOrigin(id:string):XZ | undefined {
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

	/** Whether `aID` and `bID` fight on rival sides. */
	private rivals(aID:string, bID:string):boolean {
		const [a, b] = [aID, bID].map((id) => findObject(this.world, id));
		return !!a && !!b && isRival(this, a, b);
	}

	private mayHear(speakerID:string, listenerID:string):boolean {
		const character = this.world.findByID(listenerID) ?? findObject(this.world, listenerID);
		if (character?.getComponent(Seated)?.asleep) {
			return false;
		}
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
