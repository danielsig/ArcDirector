import type { HudAiLogEntry } from '../ui/hudModel';

type Host = {
	__aiLog:HudAiLogEntry[];
};

function host():Host {
	return window as unknown as Host;
}

export function publishAiLog(entries:HudAiLogEntry[]):void {
	host().__aiLog = entries;
}

export function resetAiLogSink():void {
	publishAiLog([]);
	void fetch('/__ai-log', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ reset: true }),
	}).catch(() => undefined);
}

function withoutImage(entry:HudAiLogEntry):{ seq:number; name:string; message:string } {
	return { seq: entry.seq, name: entry.name, message: entry.message };
}

export function sinkAiLog(entries:HudAiLogEntry[], added:HudAiLogEntry, trimmed:boolean):void {
	publishAiLog(entries);
	const body = trimmed
		? { replace: entries.map(withoutImage) }
		: withoutImage(added);
	void fetch('/__ai-log', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	}).catch(() => undefined);
}
