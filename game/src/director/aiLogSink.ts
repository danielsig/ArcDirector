import { stampMap, type MapSnapshot } from 'arc-director';
import { HumanBody } from '../engine/components';
import type { HudAiLogEntry } from '../ui/hudModel';
import { snapshotMap } from './mapView';
import { isLiving } from './names';
import type { GameHost } from './adapter';

const AI_LOG_CAP = 250;

type Host = {
	aiLog:HudAiLogEntry[];
};

function host():Host {
	return window as unknown as Host;
}

export function publishAiLog(entries:HudAiLogEntry[]):void {
	host().aiLog = entries;
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

export function pushLog(
	host:GameHost,
	name:string,
	message:string,
	extra:{ image?:string; error?:boolean } = {},
):void {
	if (message.startsWith('choose')) {
		return; // comment out for `choose` verb logs
	}
	host.logSeq += 1;
	const entry:HudAiLogEntry = { seq: host.logSeq, name, message };
	if (extra.image) entry.image = extra.image;
	if (extra.error) entry.error = true;
	host.log.push(entry);
	let trimmed = false;
	if (host.log.length > AI_LOG_CAP) {
		host.log.splice(0, host.log.length - AI_LOG_CAP);
		trimmed = true;
	}
	sinkAiLog(host.log, entry, trimmed);
}

export async function logLook(host:GameHost, id:string, zoom:number, snap:MapSnapshot):Promise<void> {
	const stamped = await stampMap(snap);
	const legend = stamped.legend || '(no marks)';
	const z = zoom === 0 || zoom === 1 ? String(zoom) : String(Math.round(zoom * 100) / 100);
	pushLog(host, id, `see_map({zoom:${z}})\n${legend}`, { image: stamped.image });
}

export async function dumpLookMaps(host:GameHost):Promise<number> {
	const ids:string[] = [];
	host.world.forEachComponent(HumanBody, (body, go) => {
		if (go.id === 'Player' || !isLiving(go)) {
			return;
		}
		ids.push(go.id);
	});
	let n = 0;
	for (const npcID of ids) {
		for (const zoom of [1, 0]) {
			const snap = snapshotMap(host.world, npcID, zoom);
			if (!snap || !('marks' in snap)) {
				continue;
			}
			await logLook(host, npcID, zoom, snap);
			n += 1;
		}
	}
	return n;
}
