import type { ArcDirector } from '../director/ArcDirector.js';
import { thinkRecencyScale } from './think-score.js';
import { SimpleThinkQueue, type SimpleThinkQueueOpts } from './SimpleThinkQueue.js';
import { MindScheduler, type MindQueueOpts, type ThinkRow } from './scheduler.js';

export type PriorityThinkQueueOpts = MindQueueOpts;

/** Highest watch / arc score first, then recency. */
export class PriorityThinkQueue extends MindScheduler {
	public override rankScore(mindID:string, raw:number):number {
		return raw * this.recencyScale(mindID);
	}

	public recencyScale(mindID:string):number {
		const mind = this.minds.get(mindID);
		if (!mind?.thoughtOnce) {
			return 1;
		}
		return thinkRecencyScale(mind.sinceThought, this.rethinkInterval, this.trueScore);
	}

	protected override prune():void {
		const best = new Map<string, ThinkRow>();
		for (const row of this.rows) {
			const prev = best.get(row.mindID);
			if (!prev || row.score > prev.score) {
				best.set(row.mindID, row);
			}
		}
		this.rows = [...best.values()];
	}

	protected override order():void {
		this.rows.sort((a, b) => this.rankScore(b.mindID, b.score) - this.rankScore(a.mindID, a.score));
	}
}

declare module '../director/ArcDirector.js' {
	interface ArcDirector<TCtx, TEntity> {
		/** `withQueue(new PriorityThinkQueue(opts))`, the default. A director has one queue, so another `with*ThinkQueue` replaces it. */
		withPriorityThinkQueue(opts?:PriorityThinkQueueOpts):this;
		/** `withQueue(new SimpleThinkQueue(opts))`: first in, first out. */
		withSimpleThinkQueue(opts?:SimpleThinkQueueOpts):this;
	}
}
export function withPriorityThinkQueue<TCtx>(this:ArcDirector<TCtx>, opts?:PriorityThinkQueueOpts):ArcDirector<TCtx> {
	return this.withQueue(new PriorityThinkQueue(opts));
}
export function withSimpleThinkQueue<TCtx>(this:ArcDirector<TCtx>, opts?:SimpleThinkQueueOpts):ArcDirector<TCtx> {
	return this.withQueue(new SimpleThinkQueue(opts));
}

export { thinkRecencyScale } from './think-score.js';
export {
	type MayThink,
	type MindQueue,
	type MindQueueOpts,
	type ThinkReason,
	type ThinkRow,
} from './scheduler.js';
export { SimpleThinkQueue, type SimpleThinkQueueOpts } from './SimpleThinkQueue.js';
