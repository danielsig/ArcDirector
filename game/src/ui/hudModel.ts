import type { SaveSlotInfo } from '../engine/gameSave';
import { DEFAULT_PARALLEL_THINKERS } from '../engine/thinkPref';

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
	/** Local server catalog (embeddings omitted). */
	models:HudModelOption[];
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

export function emptyHud():HudModel {
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
		menuNotice: '',
		saveLabel: '',
		saveSelectedID: '',
		saveSlots: [],
		observer: true,
		arcDirectorOn: true,
		model: '',
		maxParallel: DEFAULT_PARALLEL_THINKERS,
		models: [],
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
	};
}
