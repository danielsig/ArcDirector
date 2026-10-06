import { prefs } from '../prefs';
import { characterOptions, resolvePlayerKind } from '../render/artCache';

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
	text:string;
	status:string;
	hp:number;
	maxHP:number;
	x:number;
	y:number;
	visible:boolean;
	/** World time the line was shown. 0 when this row has no bubble text. */
	timestamp:number;
};

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
};

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

export type MenuPage = 'game' | 'display' | 'audio' | 'save' | 'testing';

export type HudModel = {
	hp:number;
	maxHP:number;
	gold:number;
	/** Shown when any purse or coin exists in the scene, not only on the player. */
	showGold:boolean;
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
	sayGoods:{ item:string; from:string }[];
	menuOpen:boolean;
	/** Scene brief. First visit opens it; later visits only the (?) button. */
	briefOpen:boolean;
	/** Last pause-menu page this session. Not persisted. */
	menuPage:MenuPage;
	menuNotice:string;
	/** When this scene was last saved (ISO). Empty when there is no save. */
	savedUTC:string;
	/** The next Game loads this scene's save. */
	loading:boolean;
	/** Bump to boot a new Game (load). */
	boots:number;
	/** Player hidden from NPC perception (observer). Default on. */
	observer:boolean;
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
	thinkingBudget:boolean;
	/** Ask for Arc text instead of JSON. Menu + localStorage. Testing. */
	arcText:boolean;
	/** Local server catalog (embeddings omitted). */
	models:HudModelOption[];
	/** Packed kind currently drawn on the player (`player` = witch). */
	playerKind:string;
	/** Packed kinds for the Character dropdown. */
	playerKinds:{ id:string; label:string }[];
	graphicsMemory:number;
	detailMaps:boolean;
	shadows:boolean;
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
	audioMuted:boolean;
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
		sayGoods: [],
		menuOpen: false,
		briefOpen: false,
		menuPage: 'testing',
		menuNotice: '',
		savedUTC: '',
		loading: false,
		boots: 0,
		observer: p.observer,
		arcDirectorOn: p.ai,
		model: p.model,
		maxParallel: p.maxParallel,
		contextLength: p.contextLength,
		prefsDetached: false,
		batchThinks: p.batchThinks,
		thinkingBudget: p.thinkingBudget,
		arcText: p.arcText,
		models: [],
		playerKind: resolvePlayerKind(p.playerKind),
		playerKinds: characterOptions(),
		graphicsMemory: 0,
		detailMaps: p.detailMaps,
		shadows: p.shadows,
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
		audioMuted: p.muted,
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
