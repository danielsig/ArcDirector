import { emptyInferClock, type InferClock } from 'arc-director';
import { prefs } from '../prefs';
import { characterOptions, resolvePlayerKind } from '../render/character-models';
import type { RenderStats } from '@arc-director/kindling';
import type { PerfStats } from '../engine/PerfHistory';
import { readURLStats } from '../engine/url-view';
import type { BenchKind, BenchRow } from '../director/bench';
import type { SayCatalog } from './say-commands';
import { CHUNK_SIZE } from '../world/constants';

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
	/** The tool the mind just called: its icon over the head, in place of the dots. Empty for none. */
	tool:string;
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

/** Item defs drawn as tiny icons over the heads of whoever carries them (`Scene.carried`). */
export const CARRY_ICONS = ['fire_mushroom', 'moon_mushroom', 'silver_trout', 'brass_key', 'iron_key'] as const;

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
	/** An encoder (BERT and kin): it scores choices, but cannot write. */
	encoder?:boolean;
	/** Billions of parameters, and of those that run per token (fewer in a mixture of experts); unknown for a model never listed. */
	params?:{ total:number; active:number };
	/** Gigabytes it takes up loaded: its file, as LM Studio lists it. */
	gb?:number;
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

export type HudMindStats = {
	id:string;
	/** Seconds between its rethinks; `null` when it never rethinks on the timer. */
	rethink:number | null;
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

/** One side's goals, in the order reached, and the color its orbs glow. Two sides of a track differ in color. */
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

/** The card beside a character the player points at or stands close to (`Scene.inspect`). */
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

/** How a think on a slate stands: being written, chosen, ended by an error, or cut short by a newer think. */
export type SlateState = 'writing' | 'done' | 'failed' | 'dropped';

/** A mind's think, as it stands: on a slate, and in the AI log. */
export type HudThink = {
	seq:number;
	id:string;
	name:string;
	color:GoalColor;
	/** What started the think (`rethink`, `heard speech`), or `''`. */
	why:string;
	/** The model's reasoning so far. */
	thought:string;
	/** What it has written of its Arc, as Arc text. */
	arc:string;
	state:SlateState;
	/** Why the model's last reply would not do, or what ended the think; `''` once it writes on. */
	error:string;
	/** A reply was just turned down, or the think just failed: it shakes, in red. */
	wrong:boolean;
	/** How long the think has run, or ran. */
	ms:number;
};

/** A slate by the head of a mind thinking, writing out its Arc as the model does. */
export type HudSlate = HudThink & {
	/** Where its bottom left corner wants to be on screen, px (it grows upward); `HudSlates` keeps it clear of other things. */
	x:number;
	y:number;
	visible:boolean;
	/** About to go. */
	leaving:boolean;
};

/** How wide a slate is, px, and the tallest it gets. */
export const SLATE_WIDTH = 330;
export const SLATE_HEIGHT = 190;

/** The minimap's side in pixels: one chunk at 7 px a tile. The key hints stack above it. */
export const MINIMAP_SIZE = CHUNK_SIZE * 7;

export type MenuPage = 'game' | 'display' | 'audio' | 'testing';

/** What the game shows: written by the `Hud` component each frame (the chat and the AI log by the director). Vue only reads it. */
export type HudFrame = {
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
	/** No mouse or trackpad is attached: the touch controls show. */
	touch:boolean;
	/** The mouse is captured (pointer lock): the Esc hint shows. */
	pointerLocked:boolean;
	hotbar:HudItem[];
	heldLeft:string;
	heldRight:string;
	back:string;
	speech:HudSpeech[];
	chat:HudChatLine[];
	aiLog:HudAiLogEntry[];
	/** The latest thinks, oldest first; kept up only while the AI log is open. */
	thinks:HudThink[];
	/** Updated only while the overlay or the Testing page shows it (reading it walks the scene). */
	renderStats:RenderStats & PerfStats;
	/** Frames per second over the last second. Updated only while the FPS counter pref is on. */
	fps:number;
	/** Minds at work, each on its slate. */
	slates:HudSlate[];
	/** The model NPCs think with, as the director resolved it; empty until it has. */
	activeModel:string;
	/** The model's clocks. Updated only while the menu's Arc Director page shows them. */
	infer:InferClock;
	mindStats:HudMindStats[];
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
	};
};

/** The HUD's own state: owned by Vue, read and set by `Session`, read by the frame. */
export type HudUI = {
	chatOpen:boolean;
	aiLogOpen:boolean;
	sayOpen:boolean;
	sayPeers:string[];
	sayItems:string[];
	/** What each person offers the player, by lowercase name. */
	sayOffers:SayCatalog['offers'];
	menuOpen:boolean;
	/** The scene's brief and the keys. A scene's first visit opens it; later visits only its button. */
	guideOpen:boolean;
	/** Last pause-menu page this session. Not persisted. */
	menuPage:MenuPage;
	menuNotice:string;
	/** When this scene was last saved (ISO). Empty when there is no save. */
	savedUTC:string;
	/** Where the next Game starts: the autosaved pose, this scene's save (load), or the scene's spawn (restart). */
	bootFrom:'pose' | 'save' | 'spawn';
	/** Bump to boot a new Game (load, restart). */
	boots:number;
	/** The bench whose window is open over the menu, or null. */
	bench:BenchKind | null;
	/** Candidates ticked, per bench. */
	benchPick:Record<BenchKind, string[]>;
	/** Each bench's last run, one row per candidate. */
	benchRows:Record<BenchKind, BenchRow[]>;
	/** A bench is running; one at a time, as they share the server. */
	benchRunning:boolean;
	/** Packed kind currently drawn on the player (`player` = witch). */
	playerKind:string;
	/** Packed kinds for the Character dropdown. */
	playerKinds:{ id:string; label:string }[];
	/** Testing-only overlay (`stats=1`). */
	statsOverlay:boolean;
	/** Centered player, scrolling minimap. False = current-chunk map, moving arrow. */
	minimapFollow:boolean;
};

/** The HUD's one reactive object, both halves. */
export type HudModel = HudFrame & HudUI;

/** The HUD as the frame sees it: its own half to write, the UI's to read. */
export type HudView = HudFrame & Readonly<HudUI>;

export function emptyHud():HudModel {
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
		touch: false,
		pointerLocked: false,
		hotbar: [],
		heldLeft: '',
		heldRight: '',
		back: '',
		speech: [],
		chat: [],
		aiLog: [],
		thinks: [],
		renderStats: { calls: 0, triangles: 0, geometries: 0, textures: 0, framebufferMemory: 0, sceneMemory: 0, frameMS: 0, frameMSNow: 0, fps: [], phaseMS: { director: 0, simulate: 0, render: 0 }, heapMB: undefined },
		fps: 0,
		slates: [],
		activeModel: '',
		infer: emptyInferClock(),
		mindStats: [],
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
		},
		chatOpen: false,
		aiLogOpen: false,
		sayOpen: false,
		sayPeers: [],
		sayItems: [],
		sayOffers: {},
		menuOpen: false,
		guideOpen: false,
		menuPage: 'testing',
		menuNotice: '',
		savedUTC: '',
		bootFrom: 'pose',
		boots: 0,
		bench: null,
		benchPick: { decision: [], arc: [] },
		benchRows: { decision: [], arc: [] },
		benchRunning: false,
		playerKind: resolvePlayerKind(prefs().playerKind),
		playerKinds: characterOptions(),
		statsOverlay: readURLStats(),
		minimapFollow: true,
	};
}
