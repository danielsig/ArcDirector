/** Last model the player picked in the menu. Used on the next inference connect. */
const KEY = 'arc-director.model.v1';
const FALLBACK = 'meta/muse-glimmer';

export function loadModelPref():string {
	try {
		const raw = localStorage.getItem(KEY);
		return raw?.trim() ?? '';
	}
	catch {
		return '';
	}
}

export function saveModelPref(id:string):void {
	try {
		const name = id.trim();
		if (!name) {
			localStorage.removeItem(KEY);
			return;
		}
		localStorage.setItem(KEY, name);
	}
	catch {
		// quota / private mode
	}
}

/** Menu pick if set else Glimmer. */
export function preferredChatModel():string {
	return loadModelPref() ?? FALLBACK;
}
