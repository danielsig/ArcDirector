import type { ChatContent, ChatMessage, ToolCall } from './provider.js';

export type ThreadSnapshot = {
	id:string;
	messages:ChatMessage[];
};

const THREAD_CAP = 32;

export function messageEqual(a:ChatMessage, b:ChatMessage):boolean {
	if (a.role !== b.role || a.name !== b.name || a.toolCallID !== b.toolCallID) {
		return false;
	}
	if (!contentEqual(a.content, b.content)) {
		return false;
	}
	return toolCallsEqual(a.toolCalls, b.toolCalls);
}

function contentEqual(a:ChatContent | undefined, b:ChatContent | undefined):boolean {
	if (a === b) {
		return true;
	}
	if (a === null || b === null || a === undefined || b === undefined) {
		return a === b;
	}
	if (typeof a === 'string' || typeof b === 'string') {
		return a === b;
	}
	if (a.length !== b.length) {
		return false;
	}
	for (let i = 0; i < a.length; i++) {
		const pa = a[i];
		const pb = b[i];
		if (pa.type !== pb.type) {
			return false;
		}
		if (pa.type === 'text' && pb.type === 'text' && pa.text !== pb.text) {
			return false;
		}
		if (pa.type === 'image_url' && pb.type === 'image_url' && pa.image_url.url !== pb.image_url.url) {
			return false;
		}
	}
	return true;
}

function toolCallsEqual(a:ToolCall[] | undefined, b:ToolCall[] | undefined):boolean {
	if (!a && !b) {
		return true;
	}
	if (!a || !b || a.length !== b.length) {
		return false;
	}
	for (let i = 0; i < a.length; i++) {
		if (a[i].id !== b[i].id || a[i].name !== b[i].name || a[i].arguments !== b[i].arguments) {
			return false;
		}
	}
	return true;
}

export function commonPrefixLength(a:ChatMessage[], b:ChatMessage[]):number {
	const n = Math.min(a.length, b.length);
	let i = 0;
	for (; i < n; i++) {
		if (!messageEqual(a[i], b[i])) {
			break;
		}
	}
	return i;
}

/**
 * Longest stored thread that is an exact prefix of `current`.
 * The next request can continue that `id` and send only the suffix.
 */
export function pickBestThread(
	stored:ThreadSnapshot[],
	current:ChatMessage[],
):{ id:string; prefixLen:number } | undefined {
	let best:{ id:string; prefixLen:number } | undefined;
	for (const row of stored) {
		const n = commonPrefixLength(row.messages, current);
		if (n === 0 || n >= current.length || row.messages.length !== n) {
			continue;
		}
		if (!best || n > best.prefixLen) {
			best = { id: row.id, prefixLen: n };
		}
	}
	return best;
}

export function rememberThread(
	stored:ThreadSnapshot[],
	row:ThreadSnapshot,
):ThreadSnapshot[] {
	const next = stored.filter((s) => s.id !== row.id);
	next.push(row);
	if (next.length > THREAD_CAP) {
		return next.slice(next.length - THREAD_CAP);
	}
	return next;
}
