/** Testing flags: observer (player hidden from NPCs) and ArcDirector on/off. */
export type DevFlags = {
	observer:boolean;
	ai:boolean;
};

export const DEFAULT_DEV_FLAGS:DevFlags = {
	observer: true,
	ai: true,
};

const KEY = 'arc-director.flags.v1';

function asBool(v:unknown):boolean | undefined {
	if (typeof v === 'boolean') {
		return v;
	}
	return undefined;
}

export function packDevFlags(flags:DevFlags):string {
	return JSON.stringify({ observer: flags.observer, ai: flags.ai });
}

export function parseDevFlags(raw:string):DevFlags | null {
	try {
		const data = JSON.parse(raw) as Partial<DevFlags>;
		const observer = asBool(data.observer);
		const ai = asBool(data.ai);
		if (observer === undefined || ai === undefined) {
			return null;
		}
		return { observer, ai };
	}
	catch {
		return null;
	}
}

export function loadDevFlags():DevFlags | null {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) {
			return null;
		}
		return parseDevFlags(raw);
	}
	catch {
		return null;
	}
}

export function saveDevFlags(flags:DevFlags):void {
	try {
		localStorage.setItem(KEY, packDevFlags(flags));
	}
	catch {
		// quota / private mode
	}
}

export function resolveDevFlags(url:Partial<DevFlags>, stored:DevFlags | null):DevFlags {
	const base = stored ?? DEFAULT_DEV_FLAGS;
	return {
		observer: url.observer ?? base.observer,
		ai: url.ai ?? base.ai,
	};
}
