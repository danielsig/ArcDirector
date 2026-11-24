export const HUB_PORT = 3921;
export const HUB_HOST = '127.0.0.1';
export const COMMAND_TIMEOUT_MS = 180_000;
export const LIST_TIMEOUT_MS = 5_000;
/** Delay before an MCP process retries hosting or joining the hub after losing it. */
export const REOPEN_MS = 1_000;

export function hubWSURL(port = HUB_PORT):string {
	return `ws://${HUB_HOST}:${port}`;
}

/** Filters for the AI log. All optional; `pattern` is a JavaScript regular expression on name or message. */
export type AiLogQuery = {
	name?:string;
	after?:number;
	limit?:number;
	pattern?:string;
};

/** The rows `query` keeps, in order. */
export function filterAiLog<T extends AiLogRow>(rows:readonly T[], query:AiLogQuery):T[] {
	const re = query.pattern ? new RegExp(query.pattern) : null;
	const after = query.after ?? -Infinity;
	const kept = rows.filter((row) => row.seq > after
		&& (!query.name || row.name === query.name)
		&& (!re || re.test(row.name) || re.test(row.message)));
	return query.limit !== undefined && query.limit > 0 ? kept.slice(-query.limit) : kept;
}

/** One AI log row, live or stored. `image` stands for the map image the row had; `schema` is the stored id of the response format its prompt asked for. */
export type AiLogRow = {
	seq:number;
	name:string;
	message:string;
	image?:boolean;
	error?:boolean;
	schema?:string;
};

/** A run of the AI log: one per game a page boots (a scene's start, restart or load). */
export type AiLogRun = {
	session:string;
	scene:string;
	/** ISO time the run began. */
	started:string;
};

/** What a page sends to store a row: its run, the row, and the whole response format when the row is a prompt that asked for one. */
export type AiLogPost = {
	run:AiLogRun;
	row:Omit<AiLogRow, 'schema'>;
	schema?:Record<string, unknown>;
};

export type Command =
	| { op:'listCharacters' }
	| { op:'runVerb'; character:string; arc:string }
	| { op:'getPrefs' }
	| { op:'setPref'; patch:Record<string, unknown>; persist?:boolean }
	/** `id` is a character (it thinks with its own mind, or its collective's) or a collective. */
	| { op:'think'; id:string; about?:string; enact?:boolean }
	/** Move `character` into `collective`, or out of any with `null`. */
	| { op:'setCollective'; character:string; collective:string | null }
	| ({ op:'readAiLog' } & AiLogQuery)
	/** The renderer's `RenderStats` and the scene id. */
	| { op:'renderStats' }
	| { op:'saveGame' }
	| { op:'loadGame' }
	/** For testing: `character` falls dead at once, struck down by `by` (default: itself), as any blow that fells. */
	| { op:'kill'; character:string; by?:string }
	/** For testing: put `character`, or any thing by name, at `x`, `z` on the ground. */
	| { op:'teleport'; character:string; x:number; z:number }
	/**
	 * For testing, to inspect animation frames: the game holds still `at` seconds after `character` starts `verb`'s
	 * move (wound up over `windUp` s, default the verb's own, at `target`), or `at` seconds from now with no `verb`.
	 * `at: null` lets the game run again.
	 */
	| { op:'scrub'; character:string; verb?:string; target?:string; windUp?:number; at:number | null }
	/**
	 * Camera follows whom `focus` (watch syntax, as the player sees them) picks; `''` stops. `zoom` is the distance in meters.
	 * `view` puts the player, the camera's rig, at x, y, z facing yaw, as the URL `view` does.
	 */
	| { op:'setCamera'; focus?:string; zoom?:number; view?:{ x:number; y:number; z:number; yaw:number } };

/** Who thinks for a character: its own mind, its collective's, or none when the host drives it (the Player). */
export type CharacterRow = {
	id:string;
	mind:'own' | 'collective' | 'none';
	collective?:string;
	tags?:string[];
	/** The arc it runs now, the step it is on, and how its last step went. */
	arc?:string;
	verb?:string;
	last?:string;
	/** Its ground position, `[x, z]`, rounded. */
	at?:[number, number];
};

/** Characters sharing one mind. Its `commander` acts for it; without one it is bodiless. */
export type CollectiveRow = {
	id:string;
	commander?:string;
	characters:string[];
};

/** What `listCharacters` answers. */
export type CastRows = {
	characters:CharacterRow[];
	collectives:CollectiveRow[];
};

/** A command result that means "this page is about to reload": the hub answers once the page says hello again. */
export type ReconnectResult = {
	reconnect:true;
};

export function isReconnectResult(value:unknown):value is ReconnectResult {
	return isRecord(value) && value.reconnect === true;
}

export type HelloMsg = {
	kind:'hello';
	session:string;
	instance?:string;
};

/** Hub assigned a different session because the requested id was already live. */
export type SessionMsg = {
	kind:'session';
	session:string;
};

export type CallMsg = {
	kind:'call';
	id:string;
	command:Command;
};

export type ResultMsg =
	| { kind:'result'; id:string; ok:true; result:unknown }
	| { kind:'result'; id:string; ok:false; error:string };

export type RpcMsg =
	| { kind:'rpc'; id:string; method:'list' }
	| { kind:'rpc'; id:string; method:'call'; session:string; command:Command };

export type RpcResultMsg =
	| { kind:'rpcResult'; id:string; ok:true; result:unknown }
	| { kind:'rpcResult'; id:string; ok:false; error:string };

export type HubMsg = HelloMsg | SessionMsg | CallMsg | ResultMsg | RpcMsg | RpcResultMsg;

export function isRecord(value:unknown):value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseHubMsg(raw:string):HubMsg | null {
	let value:unknown;
	try {
		value = JSON.parse(raw) as unknown;
	}
	catch {
		return null;
	}
	if (!isRecord(value) || typeof value.kind !== 'string') {
		return null;
	}
	return value as HubMsg;
}

export function errorText(err:unknown):string {
	return err instanceof Error ? err.message : String(err);
}

export function encode(msg:HubMsg):string {
	return JSON.stringify(msg);
}
