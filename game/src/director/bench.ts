import { BrowserProvider, HttpProvider, JevSystemOne, ModelSystemOne, type SystemOne } from 'arc-director';
import { ARC_BENCH, benchArcs, benchSystemOne, DECISION_BENCH, type BenchScore } from 'arc-director/bench';
import type { HudModelOption } from '../ui/hudModel';
import { prefs, type Prefs } from '../prefs';
import { addThinking, addXAIThinking, XAI } from './adapter';
import { HOSTED } from './hosted';
import { BROWSER_MODELS, SKALDIC_LAYA } from './inference';

/** What a bench asks: System One picks for `choose`, or a mind's arcs and lookups. */
export type BenchKind = 'decision' | 'arc';

/** TypeSafe's Jev, benched beside the server's models. */
export const JEV_CANDIDATE = 'Jev (TypeSafe)';

/** An xAI model as a bench candidate: `xai:grok-4.6`, so it is never taken for a local one. */
export const XAI_CANDIDATE = 'xai:';

/** xAI's model under candidate `id`, or undefined for any other candidate. */
function xaiModel(id:string):string | undefined {
	return id.startsWith(XAI_CANDIDATE) ? id.slice(XAI_CANDIDATE.length) : undefined;
}

/** xAI's chat models, as bench candidates; none without its key. Image and video models are left out. */
export async function xaiCandidates():Promise<{ id:string; label:string }[]> {
	if (!HOSTED.xai) {
		return [];
	}
	const res = await fetch('/xai/models').catch(() => undefined);
	const ids = res?.ok ? ((await res.json()) as { data?:{ id:string }[] }).data?.map((m) => m.id) ?? [] : [];
	return ids
		.filter((id) => /^grok/i.test(id) && !/imagine|multi-agent/i.test(id))
		.map((id) => ({ id: `${XAI_CANDIDATE}${id}`, label: `${id} · xAI` }));
}

/**
 * How a bench runs: a quick check (per skill, its medium case, then its easy or hard one by how that went; not the
 * bench's score), and times each case runs.
 */
export type BenchRun = { quick?:boolean; repeats?:number };

/** One candidate's bench, filled in as its trials land. */
export type BenchRow = {
	id:string;
	/** Its turn came: it loads (the untimed warm-up) until `total` is set. */
	started:boolean;
	done:number;
	total:number;
	/** A quick check, not the bench's score. */
	quick:boolean;
	score?:BenchScore;
};

const SERVER = '/inference/v1';
const server = new HttpProvider({ baseURL: SERVER });

/** Whether `id` is one of the game's browser models, which run in the page rather than on LM Studio. */
function inBrowser(id:string):boolean {
	return BROWSER_MODELS.some((m) => m.model === id);
}

/** The menu's settings with `id` as the model NPCs think with, in the browser or on LM Studio. */
function prefsFor(id:string):Prefs {
	return inBrowser(id) ? { ...prefs(), inference: 'browser', browserModel: id } : { ...prefs(), inference: 'lmstudio', model: id };
}

/** `id` as a System One: Jev, a decision model through the server's endpoint, or a chat model scored, on the server or in the page. */
function systemOneFor(id:string, models:HudModelOption[]):SystemOne {
	if (id === JEV_CANDIDATE) {
		return new JevSystemOne();
	}
	const xai = xaiModel(id);
	if (xai) {
		return new ModelSystemOne(() => ({ provider: XAI, id: xai }));
	}
	if (id === SKALDIC_LAYA.model) {
		// On its own engine in the page, as the game runs it: it answers through its System One endpoint.
		return new ModelSystemOne(() => ({ provider: BrowserProvider.decisions, id }));
	}
	if (inBrowser(id)) {
		return new ModelSystemOne(() => ({ provider: BrowserProvider.shared, id }));
	}
	const decision = models.find((m) => m.id === id)?.decision === true;
	return new ModelSystemOne(() => ({ provider: server, id, systemOneURL: decision ? `${SERVER}/systemone` : undefined }));
}

/** Benches each of `ids` in turn into `rows`, one row each. */
async function benchEach(
	ids:string[],
	rows:BenchRow[],
	quick:boolean,
	bench:(id:string, onTrial:(done:number, total:number)=>void)=>Promise<BenchScore>,
):Promise<void> {
	rows.splice(0, rows.length, ...ids.map((id) => ({ id, started: false, done: 0, total: 0, quick })));
	for (const row of rows) {
		row.started = true;
		row.score = await bench(row.id, (done, total) => {
			row.done = done;
			row.total = total;
		});
	}
}

/** Decision making only: no arcs are asked for. */
export function benchDecisions(ids:string[], models:HudModelOption[], rows:BenchRow[], { quick = false, repeats }:BenchRun = {}):Promise<void> {
	return benchEach(ids, rows, quick, (id, onTrial) => benchSystemOne(systemOneFor(id, models), DECISION_BENCH, { onTrial, repeats, quick }));
}

/**
 * Arcs and lookups, each model thinking as it would in play, on LM Studio or in the browser: the menu's arc format,
 * reasoning, context and repairs, and as many cases at once as it thinks at once. Every model samples as its makers
 * say, not at the menu's temperature, so their scores compare.
 */
export function benchArcWriting(ids:string[], rows:BenchRow[], { quick = false, repeats }:BenchRun = {}):Promise<void> {
	return benchEach(ids, rows, quick, (id, onTrial) => {
		const xai = xaiModel(id);
		return benchArcs((director) => (xai ? addXAIThinking(director, xai) : addThinking(director, prefsFor(id), 'makers')), ARC_BENCH, { onTrial, repeats, quick });
	});
}
