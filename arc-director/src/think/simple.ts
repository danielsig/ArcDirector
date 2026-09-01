import type { ActionPlan } from '../action/types.js';
import { actionThinkScore, planActionScore } from './score.js';
import { MindScheduler, type MindQueueOpts, type ThinkRow } from './scheduler.js';

export type SimpleQueueOpts = MindQueueOpts;

/** First come, first served. Watches still wake; they do not jump the line. */
export class SimpleQueue extends MindScheduler {
	override rankScore(npcID:string, _raw:number):number {
		return -(this.minds.get(npcID)?.seq ?? 0);
	}

	protected override insert(row:ThinkRow):void {
		if (this.rows.some((r) => r.npcID === row.npcID)) {
			return;
		}
		const mind = this.ensure(row.npcID);
		mind.seq = this.nextSeq;
		this.nextSeq += 1;
		this.rows.push(row);
	}

	protected override prune():void {
		const first = new Map<string, ThinkRow>();
		for (const row of this.rows) {
			if (!first.has(row.npcID)) {
				first.set(row.npcID, row);
			}
		}
		this.rows = [...first.values()];
	}

	protected override order():void {
		this.rows.sort((a, b) => {
			const sa = this.minds.get(a.npcID)?.seq ?? 0;
			const sb = this.minds.get(b.npcID)?.seq ?? 0;
			return sa - sb;
		});
	}

	protected override actionScore(verb:string, ok:boolean):number {
		return actionThinkScore(verb, ok);
	}

	protected override planScore(plan:ActionPlan, ok:boolean):number {
		return planActionScore(plan, ok);
	}
}
