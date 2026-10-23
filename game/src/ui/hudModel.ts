import { prefs, type ArcFormatPref, type PlayerMode, type ShadowQuality, type SystemOneKind } from '../prefs';
import { characterOptions, resolvePlayerKind } from '../render/characterModels';
import type { RenderStats } from '@arc-director/kindling';
import { readURLStats } from '../engine/urlView';
import type { BenchKind, BenchRow } from '../director/bench';
import type { SayCatalog } from './sayCommands';

export type MinimapCell = {
	def:string;
	blocked:boolean;
	height:number;
};

export type HudItem = {
	name:string;
	count:number;
	selected:boolean;
};

export type HudSpeech = {
	id:string;
	/** Shown over the health bar, as a nameplate. */
	name:string;
	text:string;
	status:string;
	/** The mind is thinking: dots over the head instead of a status line. */
	thinking:boolean;
	hp:number;
	maxHP:number;
	/** Coins carried, shown over the head as a gold dot and number. 0 shows none. */
	gold:number;
	/** One {@link CARRY_ICONS} def id per unit carried, shown over the head as tiny icons. */
	items:string[];
	x:number;
	y:number;
	visible:boolean;
	/** World time the line was shown. 0 when this row has no bubble text. */
	timestamp:number;
};

/** Item defs drawn as tiny icons over the heads of whoever carries them (`SceneDef.carried`). */
export const CARRY_ICONS = ['fire_mushroom', 'moon_mushroom', 'silver_trout'] as const;

export type HudPickup = {
	name:string;
	x:number;
	y:number;
	visible:boolean;
};

export type HudChatLine = {
	speaker:string;
	text:string;
	to?:string;
	timestamp:number;
	/** A verb between bodies, not a spoken line. */
	act?:boolean;
};

export type HudAiLogEntry = {
	seq:number;
	name:string;
	message:string;
	/** Stamped look map (data URL). Omitted for text-only rows. */
	image?:string;
	/** Inference or model-load failure. Raises the error toast. */
	error?:boolean;
};

export type HudModelOption = {
	id:string;
	loaded:boolean;
	/** A decision model: a System One only, never a chat model. */
	decision:boolean;
	/** How many linked devices list it. LM Studio names none, and routes a request to one of them itself. */
	devices:number;
};

/** Bytes as KB or MB; `—` for none. */
export function fmtMem(bytes:number):string {
	if (!Number.isFinite(bytes) || bytes <= 0) {
		return '—';
	}
	if (bytes < 1024 * 1024) {
		return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	}
	const mb = bytes / (1024 * 1024);
	return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

/** `id`, then what sets it apart: on several devices, a decision model, or loaded. */
export function modelLabel(m:HudModelOption):string {
	const devices = m.devices > 1 ? ` · ${m.devices} devices` : '';
	return `${m.id}${devices}${m.decision ? ' · decision' : m.loaded ? ' · loaded' : ''}`;
}

export type HudHeartrate = {
	id:string;
	/** Queue pulse seconds. `null` when this mind skips heartbeat. */
	pulse:number | null;
	/** Seconds since last tactical think. `null` if never. */
	ago:number | null;
	thinking:boolean;
	/** Total generate time, milliseconds. */
	thinkMs:number;
};

export type HudGoal = {
	name:string;
	/** 0 to 1; reached at 1. Shown on the line leading into its orb. */
	progress:number;
};

export type GoalColor = 'gold' | 'blue' | 'red';

/** One side's goals, in the order reached, and the colour its orbs glow. Two sides of a track differ in colour. */
export type HudGoalSide = {
	color:GoalColor;
	goals:HudGoal[];
};

/**
 * Goal orbs on one line at the top of the screen, each reached in order. `left` fills from the left end inward, `right`
 * from the right end inward (a race between two sides); a one-way track leaves `right` empty.
 */
export type HudGoals = {
	left:HudGoalSide;
	right:HudGoalSide;
};

export function noGoals():HudGoals {
	return { left: { color: 'gold', goals: [] }, right: { color: 'gold', goals: [] } };
}

/** The card beside a character the player points at or stands close to (`SceneDef.inspect`). */
export type HudInspect = {
	id:string;
	name:string;
	role:string;
	traits:string[];
	/** Their most pressing goal. */
	goal:string;
	gold:number;
	items:{ name:string; count:number }[];
	/** Screen point beside the character, px: the card's left edge, or its right edge on the `left` side. */
	x:number;
	y:number;
	/** Which side of the character the card stands: away from the middle of the screen, so it stays on screen. */
	side:'left' | 'right';
};

export type MenuPage = 'game' | 'display' | 'audio' | 'testing';

export type HudModel = {
	hp:number;
	maxHP:number;
	gold:number;
	/** Shown when any purse or coin exists in the scene, not only on the player. */
	showGold:boolean;
	/** Empty on both sides hides the track. */
	goals:HudGoals;
	inspect:HudInspect | null;
	message:string;
	cursorName:string;
	pickupHint:HudPickup;
	hotbar:HudItem[];
	heldLeft:string;
	heldRight:string;
	back:string;
	speech:HudSpeech[];
	chatOpen:boolean;
	chat:HudChatLine[];
	aiLogOpen:boolean;
	aiLog:HudAiLogEntry[];
	sayOpen:boolean;
	sayTo:string;
	sayPeers:string[];
	sayItems:string[];
	/** What each person offers the player, by lowercase name. */
	sayOffers:SayCatalog['offers'];
	menuOpen:boolean;
	/** Scene brief. First visit opens it; later visits only the (?) button. */
	briefOpen:boolean;
	/** Keybindings help. */
	keysOpen:boolean;
	/** Last pause-menu page this session. Not persisted. */
	menuPage:MenuPage;
	menuNotice:string;
	/** When this scene was last saved (ISO). Empty when there is no save. */
	savedUTC:string;
	/** Where the next Game starts: the autosaved pose, this scene's save (load), or the scene's spawn (restart). */
	bootFrom:'pose' | 'save' | 'spawn';
	/** Bump to boot a new Game (load, restart). */
	boots:number;
	/** Who the player is: participant, observer (unnoticed by NPCs) or camera (no body). Default observer. */
	player:PlayerMode;
	/** ArcDirector ticks and NPC motors. Default on. */
	arcDirectorOn:boolean;
	/** Chat model id currently in use / selected in the menu. */
	model:string;
	/** ThinkQueue slots (HTTP in flight). Menu + localStorage. */
	maxParallel:number;
	/** LM Studio `context_length` when loading the chat model. Menu + localStorage. */
	contextLength:number;
	/** This page stopped writing prefs to storage (MCP `set_pref` with `persist: false`). Cleared by a reload. */
	prefsDetached:boolean;
	/** Hold new NPC thinks until the model is idle (or batchWait), then start a wave. Menu + localStorage. */
	batchThinks:boolean;
	/** CoT on. Menu + localStorage. */
	thinkingBudget:number;
	/** Sampling temperature, 0 to 2. Menu + localStorage. */
	temperature:number;
	/** How NPCs write an Arc: text, JSON, or JSON the server must follow. Menu + localStorage. Testing. */
	arcFormat:ArcFormatPref;
	/** The System One behind `choose`. Menu + localStorage. */
	systemOne:SystemOneKind;
	/** The local System One's model; empty is the main model. Menu + localStorage. */
	decisionModel:string;
	/** The bench whose window is open over the menu, or null. */
	bench:BenchKind | null;
	/** Candidates ticked, per bench. */
	benchPick:Record<BenchKind, string[]>;
	/** Each bench's last run, one row per candidate. */
	benchRows:Record<BenchKind, BenchRow[]>;
	/** A bench is running; one at a time, as they share the server. */
	benchRunning:boolean;
	/** Local server catalog (embeddings omitted). */
	models:HudModelOption[];
	/** Packed kind currently drawn on the player (`player` = witch). */
	playerKind:string;
	/** Packed kinds for the Character dropdown. */
	playerKinds:{ id:string; label:string }[];
	/** Testing-only overlay (`stats=1`). */
	statsOverlay:boolean;
	/** Updated only while the overlay or the Testing page shows it (reading it walks the scene). */
	renderStats:RenderStats;
	detailMaps:boolean;
	shadows:ShadowQuality;
	fpsCounter:boolean;
	/** Frames per second over the last second. Updated only while {@link fpsCounter} is on. */
	fps:number;
	/** The model NPCs think with, as the director resolved it; empty until it has. */
	activeModel:string;
	inferCalls:number;
	inferContextMs:number;
	inferGenerateMs:number;
	inferWallMs:number;
	inferContextKnown:number;
	inferLastContextMs:number | null;
	inferLastGenerateMs:number | null;
	inferLastWallMs:number | null;
	heartrates:HudHeartrate[];
	musicVolume:number;
	sfxVolume:number;
	voices:boolean;
	audioMuted:boolean;
	/** Music off; its volume is kept. */
	musicMuted:boolean;
	minimap:{
		originX:number;
		originZ:number;
		width:number;
		height:number;
		/** Bumps only when the tile grid is rebuilt — not every frame. */
		tileRev:number;
		cells:MinimapCell[];
		playerX:number;
		playerZ:number;
		playerYaw:number;
		/** Centered player, scrolling map. False = current-chunk map, moving arrow. */
		follow:boolean;
	};
};

export function emptyHud():HudModel {
	const p = prefs();
	return {
		hp: 5,
		maxHP: 5,
		gold: 0,
		showGold: false,
		goals: noGoals(),
		inspect: null,
		message: '',
		cursorName: '',
		pickupHint: {
			name: '',
			x: 0,
			y: 0,
			visible: false,
		},
		hotbar: [],
		heldLeft: '',
		heldRight: '',
		back: '',
		speech: [],
		chatOpen: false,
		chat: [],
		aiLogOpen: false,
		aiLog: [],
		sayOpen: false,
		sayTo: '',
		sayPeers: [],
		sayItems: [],
		sayOffers: {},
		menuOpen: false,
		briefOpen: false,
		keysOpen: false,
		menuPage: 'testing',
		menuNotice: '',
		savedUTC: '',
		bootFrom: 'pose',
		boots: 0,
		player: p.player,
		arcDirectorOn: p.ai,
		model: p.model,
		maxParallel: p.maxParallel,
		contextLength: p.contextLength,
		prefsDetached: false,
		batchThinks: p.batchThinks,
		thinkingBudget: p.thinkingBudget,
		temperature: p.temperature,
		arcFormat: p.arcFormat,
		systemOne: p.systemOne,
		decisionModel: p.decisionModel,
		bench: null,
		benchPick: { decision: [], arc: [] },
		benchRows: { decision: [], arc: [] },
		benchRunning: false,
		models: [],
		playerKind: resolvePlayerKind(p.playerKind),
		playerKinds: characterOptions(),
		statsOverlay: readURLStats(),
		renderStats: { calls: 0, triangles: 0, geometries: 0, textures: 0, framebufferMemory: 0, sceneMemory: 0, frameMS: 0, frameMSNow: 0 },
		detailMaps: p.detailMaps,
		shadows: p.shadows,
		fpsCounter: p.fpsCounter,
		fps: 0,
		activeModel: '',
		inferCalls: 0,
		inferContextMs: 0,
		inferGenerateMs: 0,
		inferWallMs: 0,
		inferContextKnown: 0,
		inferLastContextMs: null,
		inferLastGenerateMs: null,
		inferLastWallMs: null,
		heartrates: [],
		musicVolume: p.music,
		sfxVolume: p.sfx,
		voices: p.voices,
		audioMuted: p.muted,
		musicMuted: p.musicMuted,
		minimap: {
			originX: 0,
			originZ: 0,
			width: 16,
			height: 16,
			tileRev: 0,
			cells: [],
			playerX: 0,
			playerZ: 0,
			playerYaw: 0,
			follow: true,
		},
	};
}
