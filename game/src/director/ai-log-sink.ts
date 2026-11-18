import { stampMap, type MapSnapshot } from 'arc-director';
import type { AiLogPost, AiLogRow, AiLogRun } from '@arc-director/control';
import { HumanBody } from '../engine/components';
import { readURLSession } from '../engine/url-view';
import type { HudAiLogEntry } from '../ui/hud-model';
import { snapshotMap } from './map-view';
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

/** The last post to the dev server, so rows land in order. */
let posting = Promise.resolve();

/** A new run of the AI log, starting now: the dev server stores each run's rows in a file of its own (`vite-ai-log.ts`). */
export function aiLogRun(scene:string):AiLogRun {
	return { session: readURLSession(), scene, started: new Date().toISOString() };
}

/** A row as the control hub and the stored log give it: the map image as a flag. */
export function aiLogRow(entry:HudAiLogEntry):AiLogRow {
	const row:AiLogRow = { seq: entry.seq, name: entry.name, message: entry.message };
	if (entry.image) row.image = true;
	if (entry.error) row.error = true;
	return row;
}

function store(post:AiLogPost):void {
	const body = JSON.stringify(post);
	posting = posting.then(() => fetch('/__ai-log', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body,
	})).then(() => undefined, () => undefined);
}

export function pushLog(
	host:GameHost,
	name:string,
	message:string,
	extra:{ image?:string; error?:boolean; schema?:Record<string, unknown> } = {},
):void {
	if (message.startsWith('choose')) {
		return; // comment out for `choose` verb logs
	}
	host.logSeq += 1;
	const entry:HudAiLogEntry = { seq: host.logSeq, name, message };
	if (extra.image) entry.image = extra.image;
	if (extra.error) entry.error = true;
	host.log.push(entry);
	if (host.log.length > AI_LOG_CAP) {
		host.log.splice(0, host.log.length - AI_LOG_CAP);
	}
	publishAiLog(host.log);
	store({ run: host.logRun, row: aiLogRow(entry), schema: extra.schema });
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
