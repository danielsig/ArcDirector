/**
 * Menu / testing settings. One JSON blob. World saves and per-scene pose stay elsewhere.
 *
 * Do not import from other files. This module is pulled in widely and must stay
 * dependency-free so it cannot form import cycles.
 */

export const MIN_PARALLEL_THINKERS = 1;
export const MAX_PARALLEL_THINKERS = 10;

export const CONTEXT_LENGTHS = [2048, 4096, 8192, 16384, 32768, 65536, 131072] as const;
export const MIN_CONTEXT_LENGTH = CONTEXT_LENGTHS[0];
export const MAX_CONTEXT_LENGTH = CONTEXT_LENGTHS[CONTEXT_LENGTHS.length - 1];

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
	contextLength: 8192,
	batchThinks: true,
	thinkingBudget: true,
	arcText: false,
	aiLogSource: '',
};

export type Prefs = typeof DEFAULT;

type PrefsWatch = (next:Prefs, prev:Prefs)=>void;

/** How each field is read from untrusted input. `fallback` is the value kept when `v` is unusable. */
const FIELDS:{ [K in keyof Prefs]:(v:unknown, fallback:Prefs[K])=>Prefs[K] } = {
	observer: bool,
	ai: bool,
	detailMaps: bool,
	shadows: bool,
	music: clamp01,
	sfx: clamp01,
	muted: bool,
	menuMusicMuted: bool,
	musicPlayerOpen: bool,
	model: str,
	playerKind: str,
	maxParallel: (v, fallback) => clampInt(v, MIN_PARALLEL_THINKERS, MAX_PARALLEL_THINKERS, fallback),
	contextLength: (v, fallback) => (Number.isFinite(Number(v)) ? clampContextLength(v) : fallback),
	batchThinks: bool,
	thinkingBudget: bool,
	arcText: bool,
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
		return { ...DEFAULT, ...coercePrefsPatch(JSON.parse(raw), DEFAULT) };
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

/** Turning music up also unmutes the scene-picker music. */
export function setMusicVolume(music:number):Prefs {
	return setPrefs(music > 0 ? { music, menuMusicMuted: false } : { music });
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
