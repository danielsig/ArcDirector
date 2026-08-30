import type { ActionPlan, Step } from '../action/types.js';
import { evaluate } from '../expr/eval.js';
import { clampTrueScore, watchScore } from '../expr/score.js';
import {
	DEFAULT_EPSILON,
	DEFAULT_TRUE_SCORE,
	type Catalog,
	type ScoldReason,
} from '../expr/types.js';

export type ThinkReason = 'watch' | 'major' | 'action' | 'heartbeat';

export type ThinkRow = {
	npcID:string;
	score:number;
	reason:ThinkReason;
};

export type HeartbeatAdjust = false | 'auto' | ((npcID:string, stalled:boolean)=>number);

export type ThinkQueueOpts = {
	trueScore?:number;
	epsilon?:number;
	watchInterval?:number;
	processInterval?:number;
	maxParallel?:number;
	heartbeatStart?:number;
	heartbeatMin?:number;
	heartbeatMax?:number;
	heartbeatAdjust?:HeartbeatAdjust;
	/** Override or add verb → score for `enqueueAction`. 0 suppresses a default. */
	actionScores?:Record<string, number>;
};

/**
 * Follow-up think scores after a plan. 0 means do not enqueue on success.
 * Hosts merge extras via `actionScores`.
 */
export const ACTION_THINK_SCORES:Readonly<Record<string, number>> = {
	steal: 0.95,
	use: 0.65,
	give: 0.6,
	buy: 0.6,
	sell: 0.6,
	pick_up: 0.6,
	drop: 0.55,
	equip: 0.5,
	unequip: 0.5,
	go_to: 0.5,
	set_goal: 0.45,
	think: 0.35,
	wander: 0.3,
	say: 0.25,
	drop_goal: 0.2,
	follow: 0,
};

/** Bare think() (no about). Same as ACTION_THINK_SCORES.think. */
export const THINK_BARE_SCORE = ACTION_THINK_SCORES.think;
/** think(about=…) */
export const THINK_ABOUT_SCORE = 0.55;

/** Every failed verb re-thinks at least this high. */
const ACTION_FAIL_SCORE = 0.3;

export function actionThinkScore(
	verb:string,
	ok = true,
	extra?:Record<string, number>,
):number {
	const raw = extra?.[verb] ?? ACTION_THINK_SCORES[verb] ?? 0;
	const base = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
	if (!ok) {
		return Math.min(1, Math.max(base, ACTION_FAIL_SCORE));
	}
	return base;
}

export function waitForOf(step:Step):string {
	if (step.verb !== 'wait') {
		return '';
	}
	return typeof step.args.for === 'string' ? step.args.for.replace(/\s+/g, ' ').trim() : '';
}

function stepWarrant(step:Step, extra?:Record<string, number>):number {
	if (step.verb === 'think') {
		const about = typeof step.args.about === 'string' ? step.args.about.trim() : '';
		return about ? THINK_ABOUT_SCORE : actionThinkScore('think', true, extra);
	}
	return actionThinkScore(step.verb, true, extra);
}

/** Highest score among verbs after the last wait(for). Failures still floor at 0.3. */
export function planActionScore(
	plan:ActionPlan,
	ok = true,
	extra?:Record<string, number>,
):number {
	const steps:Step[] = [];
	let cur:ActionPlan | undefined = plan;
	while (cur) {
		steps.push(cur.head);
		cur = cur.then?.plan;
	}
	let start = 0;
	for (let i = 0; i < steps.length; i++) {
		if (waitForOf(steps[i])) {
			start = i + 1;
		}
	}
	let max = 0;
	for (let i = start; i < steps.length; i++) {
		const s = stepWarrant(steps[i], extra);
		if (s > max) {
			max = s;
		}
	}
	if (!ok) {
		return Math.min(1, Math.max(max, ACTION_FAIL_SCORE));
	}
	return max;
}

type MindState = {
	watches:string[];
	skipHeartbeat:boolean;
	skipMajor:boolean;
	heartbeat:number;
	sinceBeat:number;
	lastMax:number;
	scold?:ScoldReason;
	thoughtOnce:boolean;
	sinceThought:number;
	aiOn:boolean;
	once?:string;
};

const HEARTBEAT_SCORE = 0.001;
const MAJOR_SCORE = 1;

/** Score scale from time since last think. `trueScore` just after a think, 1 after half of `heartbeatStart`. */
export function thinkRecencyScale(
	age:number,
	heartbeatStart:number,
	trueScore = DEFAULT_TRUE_SCORE,
):number {
	if (!Number.isFinite(age) || age < 0) {
		return 1;
	}
	const span = heartbeatStart * 0.5;
	if (!(span > 0) || age >= span) {
		return 1;
	}
	const fresh = clampTrueScore(trueScore);
	const t = age / span;
	return fresh + (1 - fresh) * t;
}

export class ThinkQueue {
	readonly trueScore:number;
	readonly epsilon:number;
	readonly watchInterval:number;
	readonly processInterval:number;
	maxParallel:number;
	readonly heartbeatStart:number;
	readonly heartbeatMin:number;
	readonly heartbeatMax:number;
	readonly heartbeatAdjust:HeartbeatAdjust;
	readonly actionScores:Record<string, number>;
	private watchClock = 0;
	private processClock = 0;
	private rows:ThinkRow[] = [];
	private readonly minds = new Map<string, MindState>();

	constructor(opts:ThinkQueueOpts = {}) {
		this.trueScore = clampTrueScore(opts.trueScore ?? DEFAULT_TRUE_SCORE);
		this.epsilon = opts.epsilon ?? DEFAULT_EPSILON;
		this.watchInterval = opts.watchInterval ?? 0.25;
		this.processInterval = opts.processInterval ?? 1;
		this.maxParallel = opts.maxParallel ?? 2;
		this.heartbeatStart = opts.heartbeatStart ?? 120;
		this.heartbeatMin = opts.heartbeatMin ?? 30;
		this.heartbeatMax = opts.heartbeatMax ?? 300;
		this.heartbeatAdjust = opts.heartbeatAdjust ?? 'auto';
		this.actionScores = { ...ACTION_THINK_SCORES, ...opts.actionScores };
	}

	ensure(npcID:string, opts?:{ skipHeartbeat?:boolean; skipMajor?:boolean }):MindState {
		let m = this.minds.get(npcID);
		if (!m) {
			m = {
				watches: [],
				skipHeartbeat: opts?.skipHeartbeat ?? false,
				skipMajor: opts?.skipMajor ?? false,
				heartbeat: this.heartbeatStart,
				sinceBeat: 0,
				lastMax: 0,
				thoughtOnce: false,
				sinceThought: Number.POSITIVE_INFINITY,
				aiOn: true,
			};
			this.minds.set(npcID, m);
			if (!m.skipHeartbeat) {
				this.insert({ npcID, score: HEARTBEAT_SCORE, reason: 'heartbeat' });
			}
		}
		if (opts?.skipHeartbeat !== undefined) {
			m.skipHeartbeat = opts.skipHeartbeat;
		}
		if (opts?.skipMajor !== undefined) {
			m.skipMajor = opts.skipMajor;
		}
		return m;
	}

	setWatches(npcID:string, watches:string[]):void {
		this.ensure(npcID).watches = [...watches];
	}

	/** One-shot watch from wait(for). Sampled with standing watches; dropped by `clearOnce`. */
	armOnce(npcID:string, expr:string):void {
		const text = expr.replace(/\s+/g, ' ').trim();
		if (!text) {
			return;
		}
		this.ensure(npcID).once = text;
	}

	/** Call when a think starts so wait(for) does not survive that tick. */
	clearOnce(npcID:string):void {
		const mind = this.minds.get(npcID);
		if (mind) {
			mind.once = undefined;
		}
	}

	setAiOn(npcID:string, on:boolean):void {
		const mind = this.ensure(npcID);
		mind.aiOn = on;
		if (!on) {
			mind.once = undefined;
			this.rows = this.rows.filter((r) => r.npcID !== npcID);
		}
	}

	lastMax(npcID:string):number {
		return this.minds.get(npcID)?.lastMax ?? 0;
	}

	scold(npcID:string):ScoldReason | undefined {
		return this.minds.get(npcID)?.scold;
	}

	rankScore(npcID:string, raw:number):number {
		return raw * this.recencyScale(npcID);
	}

	recencyScale(npcID:string):number {
		const mind = this.minds.get(npcID);
		if (!mind?.thoughtOnce) {
			return 1;
		}
		return thinkRecencyScale(mind.sinceThought, this.heartbeatStart, this.trueScore);
	}

	heartbeatSeconds(npcID:string):number {
		return this.minds.get(npcID)?.heartbeat ?? this.heartbeatStart;
	}

	scoreWatches(npcID:string, catalog:Catalog):number {
		const mind = this.ensure(npcID);
		let max = 0;
		let scold:ScoldReason | undefined;
		const exprs = mind.once ? [...mind.watches, mind.once] : mind.watches;
		for (const expr of exprs) {
			const r = evaluate(expr, catalog);
			if (r.error) {
				scold = r.error.reason;
			}
			const s = watchScore(r.error ? { kind: 'absent' } : r.value, this.trueScore);
			if (s.scold) {
				scold = s.scold;
			}
			if (s.score > max) {
				max = s.score;
			}
		}
		mind.lastMax = max;
		mind.scold = scold;
		return max;
	}

	sampleWatches(npcID:string, catalog:Catalog):void {
		const mind = this.ensure(npcID);
		if (!mind.aiOn) {
			return;
		}
		const max = this.scoreWatches(npcID, catalog);
		if (max > this.epsilon) {
			this.insert({ npcID, score: max, reason: 'watch' });
		}
	}

	enqueueMajor(npcID:string, force = false):void {
		const mind = this.ensure(npcID);
		if (!mind.aiOn || (mind.skipMajor && !force)) {
			return;
		}
		this.insert({ npcID, score: MAJOR_SCORE, reason: 'major' });
	}

	/** After a world verb. Score from seriousness; 0 / wait / rest / follow do not enqueue on success. Failures always do (≥ 0.3). */
	enqueueAction(npcID:string, verb:string, ok = true):void {
		this.enqueueScore(npcID, actionThinkScore(verb, ok, this.actionScores));
	}

	/** After a plan. Highest score after the last wait(for). */
	enqueuePlan(npcID:string, plan:ActionPlan, ok = true):void {
		this.enqueueScore(npcID, planActionScore(plan, ok, this.actionScores));
	}

	private enqueueScore(npcID:string, score:number):void {
		const mind = this.ensure(npcID);
		if (!mind.aiOn) {
			return;
		}
		if (score <= this.epsilon) {
			return;
		}
		this.insert({ npcID, score, reason: 'action' });
	}

	noteResult(npcID:string, stalled:boolean):void {
		const mind = this.ensure(npcID);
		mind.thoughtOnce = true;
		mind.sinceBeat = 0;
		mind.sinceThought = 0;
		if (this.heartbeatAdjust === false) {
			return;
		}
		if (typeof this.heartbeatAdjust === 'function') {
			mind.heartbeat = this.clampBeat(this.heartbeatAdjust(npcID, stalled));
			return;
		}
		if (stalled) {
			mind.heartbeat = this.clampBeat(mind.heartbeat * 1.25);
		}
		else {
			mind.heartbeat = this.clampBeat(mind.heartbeat * 0.9);
		}
	}

	tick(dt:number, catalogs:Map<string, Catalog>, inFlight:number):ThinkRow[] {
		if (dt > 0) {
			this.watchClock += dt;
			this.processClock += dt;
			for (const [id, mind] of this.minds) {
				if (!mind.aiOn) {
					continue;
				}
				if (Number.isFinite(mind.sinceThought)) {
					mind.sinceThought += dt;
				}
				if (mind.skipHeartbeat) {
					continue;
				}
				mind.sinceBeat += dt;
				if (mind.sinceBeat >= mind.heartbeat) {
					this.insert({ npcID: id, score: HEARTBEAT_SCORE, reason: 'heartbeat' });
					mind.sinceBeat = 0;
				}
			}
		}
		if (this.watchClock >= this.watchInterval) {
			this.watchClock = 0;
			for (const [id, mind] of this.minds) {
				if (!mind.aiOn) {
					continue;
				}
				const cat = catalogs.get(id);
				if (cat) {
					this.sampleWatches(id, cat);
				}
			}
		}
		if (this.processClock < this.processInterval) {
			return [];
		}
		this.processClock = 0;
		const slots = Math.max(0, this.maxParallel - inFlight);
		if (slots === 0) {
			return [];
		}
		this.prune();
		this.rows.sort((a, b) => this.rankScore(b.npcID, b.score) - this.rankScore(a.npcID, a.score));
		const picked = this.rows.slice(0, slots);
		const taken = new Set(picked.map((r) => r.npcID));
		this.rows = this.rows.filter((r) => !taken.has(r.npcID));
		return picked;
	}

	drop(npcID:string):void {
		this.rows = this.rows.filter((r) => r.npcID !== npcID);
	}

	private clampBeat(n:number):number {
		return Math.min(this.heartbeatMax, Math.max(this.heartbeatMin, n));
	}

	private insert(row:ThinkRow):void {
		this.rows.push(row);
	}

	private prune():void {
		const best = new Map<string, ThinkRow>();
		for (const row of this.rows) {
			const prev = best.get(row.npcID);
			if (!prev || row.score > prev.score) {
				best.set(row.npcID, row);
			}
		}
		this.rows = [...best.values()];
	}
}
