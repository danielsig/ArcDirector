import type { ActionPlan } from '../action/types.js';
import { ACTION_THINK_SCORES, actionThinkScore, planActionScore, thinkRecencyScale } from './score.js';
import { SimpleQueue, type SimpleQueueOpts } from './simple.js';
import { MindScheduler, type MindQueueOpts, type ThinkRow, type WithMindQueue } from './scheduler.js';

export type ThinkQueueOpts = MindQueueOpts & {
	/** Override or add verb → score for `enqueueAction`. 0 suppresses a default. */
	actionScores?:Record<string, number>;
};

/** Highest watch / plan score first, then recency. */
export class ThinkQueue extends MindScheduler {
	readonly actionScores:Record<string, number>;

	constructor(opts:ThinkQueueOpts = {}) {
		super(opts);
		this.actionScores = { ...ACTION_THINK_SCORES, ...opts.actionScores };
	}

	override rankScore(npcID:string, raw:number):number {
		return raw * this.recencyScale(npcID);
	}

	recencyScale(npcID:string):number {
		const mind = this.minds.get(npcID);
		if (!mind?.thoughtOnce) {
			return 1;
		}
		return thinkRecencyScale(mind.sinceThought, this.heartbeatStart, this.trueScore);
	}

	protected override prune():void {
		const best = new Map<string, ThinkRow>();
		for (const row of this.rows) {
			const prev = best.get(row.npcID);
			if (!prev || row.score > prev.score) {
				best.set(row.npcID, row);
			}
		}
		this.rows = [...best.values()];
	}

	protected override order():void {
		this.rows.sort((a, b) => this.rankScore(b.npcID, b.score) - this.rankScore(a.npcID, a.score));
	}

	protected override actionScore(verb:string, ok:boolean):number {
		return actionThinkScore(verb, ok, this.actionScores);
	}

	protected override planScore(plan:ActionPlan, ok:boolean):number {
		return planActionScore(plan, ok, this.actionScores);
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
	ACTION_THINK_SCORES,
	THINK_ABOUT_SCORE,
	THINK_BARE_SCORE,
	actionThinkScore,
	planActionScore,
	thinkRecencyScale,
	waitForOf,
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
