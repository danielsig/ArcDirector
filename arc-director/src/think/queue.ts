import type { Arc } from '../arc/types.js';
import { VERB_THINK_SCORES, verbThinkScore, arcScore, thinkRecencyScale } from './score.js';
import { SimpleQueue, type SimpleQueueOpts } from './simple.js';
import { MindScheduler, type MindQueueOpts, type ThinkRow, type WithMindQueue } from './scheduler.js';

export type ThinkQueueOpts = MindQueueOpts & {
	/** Override or add verb → score for `enqueueVerb`. 0 suppresses a default. */
	verbScores?:Record<string, number>;
};

/** Highest watch / arc score first, then recency. */
export class ThinkQueue extends MindScheduler {
	readonly verbScores:Record<string, number>;

	constructor(opts:ThinkQueueOpts = {}) {
		super(opts);
		this.verbScores = { ...VERB_THINK_SCORES, ...opts.verbScores };
	}

	override rankScore(mindID:string, raw:number):number {
		return raw * this.recencyScale(mindID);
	}

	recencyScale(mindID:string):number {
		const mind = this.minds.get(mindID);
		if (!mind?.thoughtOnce) {
			return 1;
		}
		return thinkRecencyScale(mind.sinceThought, this.heartbeatStart, this.trueScore);
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

	protected override verbScore(verb:string, ok:boolean):number {
		return verbThinkScore(verb, ok, this.verbScores);
	}

	protected override arcScore(arc:Arc, ok:boolean):number {
		return arcScore(arc, ok, this.verbScores);
	}
}

export function withPriorityQueue(opts?:ThinkQueueOpts):WithMindQueue {
	return { queue: new ThinkQueue(opts), heartbeat: 0 };
}

export function withSimpleQueue(opts?:SimpleQueueOpts):WithMindQueue {
	return { queue: new SimpleQueue(opts), heartbeat: 0 };
}

/** @deprecated Use `withPriorityQueue`. */
export const withThinkQueue = withPriorityQueue;

export type WithThinkQueue = WithMindQueue;

export {
	VERB_THINK_SCORES,
	THINK_ABOUT_SCORE,
	THINK_BARE_SCORE,
	verbThinkScore,
	arcScore,
	thinkRecencyScale,
	waitUntilOf,
} from './score.js';
export {
	DEFAULT_BATCH_THINKS,
	DEFAULT_BATCH_WAIT,
	type HeartbeatAdjust,
	type MayThink,
	type MindQueue,
	type MindQueueOpts,
	type ThinkBatchOpts,
	type ThinkReason,
	type ThinkRow,
	type WithMindQueue,
} from './scheduler.js';
export { SimpleQueue, type SimpleQueueOpts } from './simple.js';
