import { benchSystemOne, HttpProvider, JevSystemOne, ModelSystemOne, type BenchScore, type SystemOne } from 'arc-director';
import type { HudModelOption } from '../ui/hudModel';

/** TypeSafe's Jev, benched beside the server's models. */
export const JEV_CANDIDATE = 'Jev (TypeSafe)';

/** One candidate's bench, filled in as its picks land. */
export type BenchRow = {
	id:string;
	/** Its turn came: it loads (the untimed warm-up pick) until `total` is set. */
	started:boolean;
	done:number;
	total:number;
	score?:BenchScore;
};

const SERVER = '/inference/v1';
const server = new HttpProvider({ baseURL: SERVER });

/** `id` as a System One: Jev, a decision model through the server's endpoint, or a chat model scored. */
function systemOneFor(id:string, models:HudModelOption[]):SystemOne {
	if (id === JEV_CANDIDATE) {
		return new JevSystemOne();
	}
	const decision = models.find((m) => m.id === id)?.decision === true;
	return new ModelSystemOne(() => ({ provider: server, id, systemOneURL: decision ? `${SERVER}/systemone` : undefined }));
}

/** Benches each of `ids` in turn into `rows`, one row each. Decision making only: no arcs are asked for. */
export async function benchDecisions(ids:string[], models:HudModelOption[], rows:BenchRow[]):Promise<void> {
	rows.splice(0, rows.length, ...ids.map((id) => ({ id, started: false, done: 0, total: 0 })));
	for (const row of rows) {
		row.started = true;
		row.score = await benchSystemOne(systemOneFor(row.id, models), undefined, (done, total) => {
			row.done = done;
			row.total = total;
		});
	}
}
