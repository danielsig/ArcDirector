/**
 * Menu / testing settings. One JSON blob. World saves and per-scene pose stay elsewhere.
 *
 * Do not import from other files. This module is pulled in widely and must stay
 * dependency-free so it cannot form import cycles.
 */

export const MIN_PARALLEL_THINKERS = 1;
export const MAX_PARALLEL_THINKERS = 10;

const DEFAULT = {
	observer: true,
	ai: true,
	detailMaps: true,
	shadows: true,
	music: 0,
	sfx: 0.78,
	muted: false,
	menuMusicMuted: false,
	musicPlayerOpen: false,
	model: '',
	playerKind: '',
	maxParallel: 2,
	batchThinks: true,
	thinkingBudget: true,
	arcText: false,
	aiLogSource: '',
};

export type Prefs = typeof DEFAULT;

function coerce(raw:Partial<Prefs>):Prefs {
	return {
		...DEFAULT,
		observer: bool(raw.observer, DEFAULT.observer),
		ai: bool(raw.ai, DEFAULT.ai),
		detailMaps: bool(raw.detailMaps, DEFAULT.detailMaps),
		shadows: bool(raw.shadows, DEFAULT.shadows),
		music: clamp01(raw.music, DEFAULT.music),
		sfx: clamp01(raw.sfx, DEFAULT.sfx),
		muted: bool(raw.muted, DEFAULT.muted),
		menuMusicMuted: bool(raw.menuMusicMuted, DEFAULT.menuMusicMuted),
		musicPlayerOpen: bool(raw.musicPlayerOpen, DEFAULT.musicPlayerOpen),
		model: typeof raw.model === 'string' ? raw.model.trim() : DEFAULT.model,
		playerKind: typeof raw.playerKind === 'string' ? raw.playerKind.trim() : DEFAULT.playerKind,
		maxParallel: clampParallelThinkers(raw.maxParallel as number),
		batchThinks: bool(raw.batchThinks, DEFAULT.batchThinks),
		thinkingBudget: bool(
			typeof raw.thinkingBudget === 'number' ? raw.thinkingBudget > 0 : raw.thinkingBudget,
			DEFAULT.thinkingBudget,
		),
		arcText: bool(raw.arcText, DEFAULT.arcText),
		aiLogSource: typeof raw.aiLogSource === 'string' ? raw.aiLogSource.trim() : DEFAULT.aiLogSource,
	};
}

export function prefs():Prefs {
	const raw = lsGet(KEY);
	if (!raw) {
		return { ...DEFAULT };
	}
	try {
		return coerce(JSON.parse(raw) as Partial<Prefs>);
	}
	catch {
		return { ...DEFAULT };
	}
}

export function setPrefs(patch:Partial<Prefs>):Prefs {
	const next = coerce({ ...prefs(), ...patch });
	lsSet(KEY, JSON.stringify(next));
	return next;
}

/** URL query wins when present; otherwise stored observer/ai (both default on). */
export function flagsFromURL(url:{ observer?:boolean; ai?:boolean }):Pick<Prefs, 'observer' | 'ai'> {
	const p = prefs();
	return {
		observer: url.observer ?? p.observer,
		ai: url.ai ?? p.ai,
	};
}

export function setMenuMusicMuted(muted:boolean):Prefs {
	return setPrefs({
		menuMusicMuted: muted,
		music: muted ? 0 : prefs().music,
	});
}

export function preferredChatModel():string {
	const stored = prefs().model;
	if (!stored || stored === 'meta/muse-glimmer' || stored === 'muse-glimmer') {
		return '';
	}
	return stored;
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

export function clampParallelThinkers(n:number):number {
	return clampInt(n, MIN_PARALLEL_THINKERS, MAX_PARALLEL_THINKERS, DEFAULT.maxParallel);
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
