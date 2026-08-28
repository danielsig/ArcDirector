/** How many NPC thoughts may run HTTP at once. Used on the next pulse. */
const KEY = 'arc-director.thinkers.v1';

export const MIN_PARALLEL_THINKERS = 1;
export const MAX_PARALLEL_THINKERS = 10;
export const DEFAULT_PARALLEL_THINKERS = 2;

export function clampParallelThinkers(n:number):number {
	if (!Number.isFinite(n)) {
		return DEFAULT_PARALLEL_THINKERS;
	}
	return Math.min(MAX_PARALLEL_THINKERS, Math.max(MIN_PARALLEL_THINKERS, Math.round(n)));
}

export function loadThinkPref():number {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) {
			return DEFAULT_PARALLEL_THINKERS;
		}
		return clampParallelThinkers(Number(raw));
	}
	catch {
		return DEFAULT_PARALLEL_THINKERS;
	}
}

export function saveThinkPref(n:number):void {
	try {
		localStorage.setItem(KEY, String(clampParallelThinkers(n)));
	}
	catch {
		// quota / private mode
	}
}
