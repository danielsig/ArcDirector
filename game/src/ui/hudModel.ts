import type { SaveSlotInfo } from '../engine/gameSave';
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
	x:number;
	y:number;
	visible:boolean;
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
	at:number;
};

export type HudAiLogEntry = {
	seq:number;
	name:string;
	message:string;
	/** Stamped look map (data URL). Omitted for text-only rows. */
	image?:string;
};

export type HudModelOption = {
	id:string;
	loaded:boolean;
};

export type MenuPage = 'game' | 'display' | 'audio' | 'saves' | 'testing';

export type HudModel = {
	hp:number;
	maxHP:number;
	mana:number;
	maxMana:number;
	keys:number;
	bombs:number;
	gold:number;
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
	/** Last pause-menu page this session. Not persisted. */
	menuPage:MenuPage;
	menuNotice:string;
	saveLabel:string;
	saveSelectedID:string;
	saveSlots:SaveSlotInfo[];
	/** Player hidden from NPC perception (observer). Default on. */
	observer:boolean;
	/** ArcDirector ticks and NPC motors. Default on. */
	arcDirectorOn:boolean;
	/** Chat model id currently in use / selected in the menu. */
	model:string;
	/** ThinkQueue slots (HTTP in flight). Menu + localStorage. */
	maxParallel:number;
	/** Hold new NPC thinks until the model is idle (or batchWait), then start a wave. Menu + localStorage. */
	batchThinks:boolean;
	/** CoT token cap. 0 disables thinking. Menu + localStorage. */
	thinkingBudget:number;
	/** Local server catalog (embeddings omitted). */
	models:HudModelOption[];
	/** Packed kind currently drawn on the player (`player` = witch). */
	playerKind:string;
	/** Packed kinds for the Character dropdown. */
	playerKinds:{ id:string; label:string }[];
	/** Leftover pref; the Testing page always shows stats. */
	devStatsOpen:boolean;
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
		mana: 5,
		maxMana: 5,
		keys: 0,
		bombs: 0,
		gold: 0,
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
		menuPage: 'game',
		menuNotice: '',
		saveLabel: '',
		saveSelectedID: '',
		saveSlots: [],
		observer: p.observer,
		arcDirectorOn: p.ai,
		model: p.model,
		maxParallel: p.maxParallel,
		batchThinks: p.batchThinks,
		thinkingBudget: p.thinkingBudget,
		models: [],
		playerKind: resolvePlayerKind(p.playerKind),
		playerKinds: characterOptions(),
		devStatsOpen: p.devStatsOpen,
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
