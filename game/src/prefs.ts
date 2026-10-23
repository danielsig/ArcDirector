/**
 * Menu / testing settings. One JSON blob. World saves and per-scene pose stay elsewhere.
 *
 * Do not import from other files. This module is pulled in widely and must stay
 * dependency-free so it cannot form import cycles.
 */

export const MIN_PARALLEL_THINKERS = 1;
/** Most thinks at once each runs: LM Studio's Max Concurrent Predictions, and llama.cpp's `LLAMA_MAX_SEQ` in the browser. */
export const MAX_PARALLEL_THINKERS:Record<InferenceKind, number> = { lmstudio: 1023, browser: 256 };

export const CONTEXT_LENGTHS = [2048, 4096, 8192, 16384, 32768, 65536, 131072] as const;
export const MIN_CONTEXT_LENGTH = CONTEXT_LENGTHS[0];
export const MAX_CONTEXT_LENGTH = CONTEXT_LENGTHS[CONTEXT_LENGTHS.length - 1];

/** How many tokens NPCs may think before they answer: not at all, up to a budget, or as long as they like (-1). */
export const THINKING_BUDGETS = [0, 256, 512, 1024, 2048, -1] as const;

/** Who the player is: a character NPCs notice, one they never notice, or only a camera (no body to see or bump into). */
export const PLAYER_MODES = ['participant', 'observer', 'camera'] as const;
export type PlayerMode = (typeof PLAYER_MODES)[number];

/** Where NPC minds think: LM Studio (on this machine or another), or a model WebLLM runs in the page. */
export const INFERENCE_KINDS = ['lmstudio', 'browser'] as const;
export type InferenceKind = (typeof INFERENCE_KINDS)[number];

/** The System One behind `choose`: none, TypeSafe's Jev, or the local chat model scoring the choices. */
export const SYSTEM_ONE_KINDS = ['off', 'jev', 'local'] as const;
export type SystemOneKind = (typeof SYSTEM_ONE_KINDS)[number];

/**
 * Shadows: picked for this machine's speed (never Off), none, still-scene maps with soft capsule shadows standing in
 * for characters, or realtime at 256 or 512 per side.
 */
export const SHADOW_QUALITIES = ['auto', 'off', 'simple', 'low', 'high'] as const;
export type ShadowQuality = (typeof SHADOW_QUALITIES)[number];
/** A quality the renderer runs: anything but `auto`. */
export type ShadowTier = Exclude<ShadowQuality, 'auto'>;

/** How NPC minds write an Arc (the library's `ArcFormat`): Arc text, Arc JSON, or JSON the server must follow. */
export const ARC_FORMATS = ['text', 'json', 'schema'] as const;
export type ArcFormatPref = (typeof ARC_FORMATS)[number];

/** The director's default System One for a menu choice: its name there, or none. */
export function systemOneName(kind:SystemOneKind):string | null {
	return kind === 'off' ? null : kind;
}

/** Music turned on at zero volume comes back at this; also where it starts. */
const MUSIC_ON_VOLUME = 0.5;

const DEFAULT = {
	player: 'observer' as PlayerMode,
	ai: true,
	detailMaps: true,
	shadows: 'auto' as ShadowQuality,
	/** Frames per second in the top-right corner. */
	fpsCounter: false,
	music: MUSIC_ON_VOLUME,
	sfx: 0.78,
	/** Characters babble when they speak. */
	voices: true,
	muted: false,
	/** Music off in the scene picker and in scenes alike; its volume is kept. */
	musicMuted: false,
	musicPlayerOpen: false,
	inference: 'lmstudio' as InferenceKind,
	/** LM Studio's model id. Empty: the server's pick. */
	model: '',
	/** The WebLLM model id when `inference` is `browser`. */
	browserModel: '',
	playerKind: '',
	maxParallel: 4,
	contextLength: 16384,
	batchThinks: true,
	thinkingBudget: 512 as number,
	/** How freely NPCs pick each word: 0 always the likeliest, 2 wild. */
	temperature: 1 as number,
	arcFormat: 'schema' as ArcFormatPref,
	systemOne: 'local' as SystemOneKind,
	/** The local System One's model id: a chat model scored, or a decision model. Empty: the main model. */
	decisionModel: '',
	aiLogSource: '',
};

export type Prefs = typeof DEFAULT;

type PrefsWatch = (next:Prefs, prev:Prefs)=>void;

/** How each field is read from untrusted input. `fallback` is the value kept when `v` is unusable. */
const FIELDS:{ [K in keyof Prefs]:(v:unknown, fallback:Prefs[K])=>Prefs[K] } = {
	player: (v, fallback) => PLAYER_MODES.find((mode) => mode === v) ?? fallback,
	ai: bool,
	detailMaps: bool,
	shadows: (v, fallback) => SHADOW_QUALITIES.find((q) => q === v) ?? fallback,
	fpsCounter: bool,
	music: clamp01,
	sfx: clamp01,
	voices: bool,
	muted: bool,
	musicMuted: bool,
	musicPlayerOpen: bool,
	inference: (v, fallback) => INFERENCE_KINDS.find((kind) => kind === v) ?? fallback,
	model: str,
	// A GGUF's URL; anything else is a model the game no longer runs.
	browserModel: (v, fallback) => (typeof v === 'string' && /\.gguf$/.test(v) ? v : fallback),
	playerKind: str,
	maxParallel: (v, fallback) => clampInt(v, MIN_PARALLEL_THINKERS, Math.max(...Object.values(MAX_PARALLEL_THINKERS)), fallback),
	contextLength: (v, fallback) => (Number.isFinite(Number(v)) ? clampContextLength(v) : fallback),
	batchThinks: bool,
	thinkingBudget: (v, fallback) => THINKING_BUDGETS.find((budget) => budget === v) ?? fallback,
	temperature: (v, fallback) => (Number.isFinite(Number(v)) ? Math.min(2, Math.max(0, Math.round(Number(v) * 20) / 20)) : fallback),
	arcFormat: (v, fallback) => ARC_FORMATS.find((format) => format === v) ?? fallback,
	systemOne: (v, fallback) => SYSTEM_ONE_KINDS.find((kind) => kind === v) ?? fallback,
	decisionModel: str,
	aiLogSource: str,
};

let live:Prefs | null = null;
/** This page no longer writes prefs to storage, so test pages can differ. Cleared by a reload. */
let detached = false;
const watches = new Set<PrefsWatch>();

/** Known keys of `raw`, each sanitized. An unusable value keeps `base`'s. Unknown keys are dropped. */
export function coercePrefsPatch(raw:unknown, base:Prefs = prefs()):Partial<Prefs> {
	const out:Record<string, unknown> = {};
	if (typeof raw !== 'object' || raw === null) {
		return out;
	}
	for (const [key, value] of Object.entries(raw)) {
		if (key in FIELDS) {
			out[key] = coerceField(key as keyof Prefs, value, base);
		}
	}
	return out as Partial<Prefs>;
}

function coerceField<K extends keyof Prefs>(key:K, value:unknown, base:Prefs):Prefs[K] {
	return FIELDS[key](value, base[key]);
}

function loadStored():Prefs {
	const raw = lsGet(KEY);
	if (!raw) {
		return { ...DEFAULT };
	}
	try {
		const stored = { ...DEFAULT, ...coercePrefsPatch(JSON.parse(raw), DEFAULT) };
		// Music on at zero volume is a state older saves left behind: it showed music on and played nothing.
		return stored.music === 0 && !stored.musicMuted ? { ...stored, music: MUSIC_ON_VOLUME } : stored;
	}
	catch {
		return { ...DEFAULT };
	}
}

export function prefs():Prefs {
	if (!live) {
		live = loadStored();
	}
	return { ...live };
}

export function prefsDetached():boolean {
	return detached;
}

/** Drop the in-memory copy and the detached mode, as a page reload would. */
export function reloadPrefs():void {
	live = null;
	detached = false;
}

export function watchPrefs(fn:PrefsWatch):()=>void {
	watches.add(fn);
	return () => {
		watches.delete(fn);
	};
}

/** `persist: false` detaches this page: from then on no pref change here reaches storage. */
export function setPrefs(patch:Partial<Prefs>, persist = true):Prefs {
	const prev = prefs();
	if (!persist) {
		detached = true;
	}
	const next = { ...prev, ...coercePrefsPatch(patch, prev) };
	live = next;
	if (!detached) {
		lsSet(KEY, JSON.stringify(next));
	}
	for (const fn of watches) {
		fn({ ...next }, prev);
	}
	return { ...next };
}

/** URL query wins when present; otherwise the stored player mode (default observer) and ai (default on). */
export function flagsFromURL(url:{ player?:PlayerMode; ai?:boolean }):Pick<Prefs, 'player' | 'ai'> {
	const p = prefs();
	return {
		player: url.player ?? p.player,
		ai: url.ai ?? p.ai,
	};
}

/**
 * Music at zero volume is music off. Turning it up turns it on; turning it to zero turns it off and keeps `restore`
 * (the volume before the slider went down) for turning it back on.
 */
export function setMusicVolume(music:number, restore:number):Prefs {
	return setPrefs(music > 0 ? { music, musicMuted: false } : { music: restore, musicMuted: true });
}

/** Music on or off, with `patch`. Turned on at zero volume, it comes back at half. */
export function setMusicMuted(musicMuted:boolean, patch:Partial<Prefs> = {}):Prefs {
	const silent = !musicMuted && prefs().music === 0;
	return setPrefs({ ...patch, musicMuted, ...(silent ? { music: MUSIC_ON_VOLUME } : {}) });
}

export function contextLabel(n:number):string {
	return `${Math.round(n / 1024)}k`;
}

export function lsGet(key:string):string | null {
	try {
		return localStorage.getItem(key);
	}
	catch {
		return null;
	}
}

export function lsSet(key:string, value:string):boolean {
	try {
		localStorage.setItem(key, value);
		return true;
	}
	catch {
		return false;
	}
}

export function lsDel(key:string):void {
	try {
		localStorage.removeItem(key);
	}
	catch {
		// private mode
	}
}

export function clampParallelThinkers(n:unknown):number {
	return FIELDS.maxParallel(n, DEFAULT.maxParallel);
}

export function clampContextLength(n:unknown):number {
	const v = typeof n === 'number' ? n : Number(n);
	if (!Number.isFinite(v)) {
		return DEFAULT.contextLength;
	}
	let best:number = CONTEXT_LENGTHS[0];
	let dist = Math.abs(v - best);
	for (const step of CONTEXT_LENGTHS) {
		const d = Math.abs(v - step);
		if (d < dist) {
			best = step;
			dist = d;
		}
	}
	return best;
}

export function thinkingLabel(budget:number):string {
	return budget === 0 ? 'Off' : budget < 0 ? 'No limit' : budget >= 1024 ? `${budget / 1024}k` : String(budget);
}

/** The thinking budget `delta` steps along from `current`: Off, then longer, then no limit. */
export function nudgeThinkingBudget(current:number, delta:number):number {
	const i = Math.max(0, THINKING_BUDGETS.findIndex((budget) => budget === current));
	return THINKING_BUDGETS[Math.max(0, Math.min(THINKING_BUDGETS.length - 1, i + delta))];
}

export function nudgeContextLength(current:number, delta:number):number {
	const now = clampContextLength(current);
	const i = CONTEXT_LENGTHS.indexOf(now as typeof CONTEXT_LENGTHS[number]);
	const next = CONTEXT_LENGTHS[Math.max(0, Math.min(CONTEXT_LENGTHS.length - 1, i + delta))];
	return next ?? now;
}

const KEY = 'arc-director.prefs.v1';

function clampInt(n:unknown, min:number, max:number, fallback:number):number {
	const v = typeof n === 'number' ? n : Number(n);
	if (!Number.isFinite(v)) {
		return fallback;
	}
	return Math.min(max, Math.max(min, Math.round(v)));
}

function clamp01(n:unknown, fallback:number):number {
	const v = typeof n === 'number' ? n : Number(n);
	if (!Number.isFinite(v)) {
		return fallback;
	}
	return Math.max(0, Math.min(1, v));
}

function bool(v:unknown, fallback:boolean):boolean {
	return typeof v === 'boolean' ? v : fallback;
}

function str(v:unknown, fallback:string):string {
	return typeof v === 'string' ? v.trim() : fallback;
}
