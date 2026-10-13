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
	/** Camera follows whom `focus` (watch syntax, as the player sees them) picks; `''` stops. `zoom` is the distance in meters. */
	| { op:'setCamera'; focus?:string; zoom?:number };

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
