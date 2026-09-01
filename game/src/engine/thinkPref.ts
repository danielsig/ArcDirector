/** How many NPC thoughts may run HTTP at once. Used on the next pulse. */
const THINKERS_KEY = 'arc-director.thinkers.v1';
const BATCH_KEY = 'arc-director.batchThinks.v1';
const BUDGET_KEY = 'arc-director.thinkingBudget.v1';

export const MIN_PARALLEL_THINKERS = 1;
export const MAX_PARALLEL_THINKERS = 10;
export const DEFAULT_PARALLEL_THINKERS = 2;

export const DEFAULT_BATCH_THINKS = true;

export const MIN_THINKING_BUDGET = 0;
export const MAX_THINKING_BUDGET = 2048;
export const DEFAULT_THINKING_BUDGET = 160;

export function clampParallelThinkers(n:number):number {
	if (!Number.isFinite(n)) {
		return DEFAULT_PARALLEL_THINKERS;
	}
	return Math.min(MAX_PARALLEL_THINKERS, Math.max(MIN_PARALLEL_THINKERS, Math.round(n)));
}

export function loadThinkPref():number {
	try {
		const raw = localStorage.getItem(THINKERS_KEY);
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
		localStorage.setItem(THINKERS_KEY, String(clampParallelThinkers(n)));
	}
	catch {
		// quota / private mode
	}
}

export function loadBatchThinkPref():boolean {
	try {
		const raw = localStorage.getItem(BATCH_KEY);
		if (raw === null) {
			return DEFAULT_BATCH_THINKS;
		}
		return raw !== '0' && raw !== 'false';
	}
	catch {
		return DEFAULT_BATCH_THINKS;
	}
}

export function saveBatchThinkPref(on:boolean):void {
	try {
		localStorage.setItem(BATCH_KEY, on ? '1' : '0');
	}
	catch {
		// quota / private mode
	}
}

export function clampThinkingBudget(n:number):number {
	if (!Number.isFinite(n)) {
		return DEFAULT_THINKING_BUDGET;
	}
	return Math.min(MAX_THINKING_BUDGET, Math.max(MIN_THINKING_BUDGET, Math.round(n)));
}

export function loadThinkingBudgetPref():number {
	try {
		const raw = localStorage.getItem(BUDGET_KEY);
		if (raw === null || raw === '') {
			return DEFAULT_THINKING_BUDGET;
		}
		return clampThinkingBudget(Number(raw));
	}
	catch {
		return DEFAULT_THINKING_BUDGET;
	}
}

export function saveThinkingBudgetPref(n:number):void {
	try {
		localStorage.setItem(BUDGET_KEY, String(clampThinkingBudget(n)));
	}
	catch {
		// quota / private mode
	}
}
