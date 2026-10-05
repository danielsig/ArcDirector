import { lsGet, lsSet } from '../prefs';

/** Scene ids whose brief has already auto-opened. Same helpers as the other UI keys. */
const KEY = 'arc-director.brief.v1';

function read():string[] {
	try {
		const raw = JSON.parse(lsGet(KEY) ?? '[]');
		return Array.isArray(raw) ? raw.filter((id):id is string => typeof id === 'string' && id.length > 0) : [];
	}
	catch {
		return [];
	}
}

export function briefSeen(sceneID:string):boolean {
	return read().includes(sceneID);
}

export function markBriefSeen(sceneID:string):void {
	const ids = read();
	if (ids.includes(sceneID)) {
		return;
	}
	lsSet(KEY, JSON.stringify([...ids, sceneID]));
}
