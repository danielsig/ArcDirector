import type { Arc } from '../arc/types.js';
import { evaluate } from '../expr/eval.js';
import { clampTrueScore, watchScore } from '../expr/score.js';
import {
	DEFAULT_EPSILON,
	DEFAULT_TRUE_SCORE,
	type Catalog,
	type ScoldReason,
} from '../expr/types.js';
import { arcVerbs } from './score.js';

/** How a mind joins the queue. `skipStart` only counts when it is new. */
export type EnsureOpts = { skipHeartbeat?:boolean; skipMajor?:boolean; skipStart?:boolean };

/** Why a mind is queued to think. `start`: once, when it joins, so it acts before anything happens to it. */
export type ThinkReason = 'start' | 'watch' | 'major' | 'verb' | 'heartbeat';

export type ThinkRow = {
	mindID:string;
	score:number;
	reason:ThinkReason;
};

/** Keep a fixed interval (`false`, default), or stretch/shrink (`'auto'`), or return seconds. */
export type HeartbeatAdjust = false | 'auto' | ((mindID:string, stalled:boolean)=>number);

/** Asked before a think starts while an arc may still be running. */
export type MayThink = {
	mindID:string;
	reason:ThinkReason;
	score:number;
	rankedScore:number;
	/** Live arc, if this mind is still executing one. */
	arc:Arc | null;
	/** Verbs on that arc, in order. Empty when `arc` is null. */
	verbs:string[];
};

export const DEFAULT_BATCH_THINKS = true;
/** Seconds on the `tick` clock. */
export const DEFAULT_BATCH_WAIT = 20;

/**
 * Hold new thinks while any generation is in flight, then start a wave.
 * A new prompt's prefill stalls decode of every slot already generating.
 */
export type ThinkBatchOpts = {
	/**
	 * Buffer starts until the model is idle (or `batchWait`), then launch up to its `maxParallel`.
	 * `false` fills a free slot as soon as one opens. Default true.
	 */
	batchThinks?:boolean;
	/**
	 * Seconds (`tick`'s `now`) to wait for idle before starting anyway. Default 20.
	 * Non-finite or ≤ 0 waits until idle. Ignored when `batchThinks` is false.
	 */
	batchWait?:number;
};

export type MindQueueOpts = ThinkBatchOpts & {
	trueScore?:number;
	epsilon?:number;
	watchInterval?:number;
	processInterval?:number;
	heartbeatStart?:number;
	heartbeatMin?:number;
	heartbeatMax?:number;
	heartbeatAdjust?:HeartbeatAdjust;
	/**
	 * May this mind start a think? Default: yes when idle, no while an arc is live.
	 * Return true to think (host should abort the arc if it cannot overlap).
	 */
	mayThink?:(ctx:MayThink)=>boolean;
};

/** Interchangeable scheduler: the director keeps one, keyed by mind id. Each model's `maxParallel` caps its thinks. */
export type MindQueue = {
	batchThinks:boolean | undefined;
	batchWait:number | undefined;
	mayThink:((ctx:MayThink)=>boolean) | undefined;
	readonly inFlight:number;
	isThinking(mindID:string):boolean;
	/** A follow-up, watch, or heartbeat is waiting to start. */
	hasPending(mindID:string):boolean;
	/** It finished a think since it joined: its opening one, or any after. */
	hasThought(mindID:string):boolean;
	arcOf(mindID:string):Arc | null;
	beginThink(mindID:string):AbortSignal;
	endThink(mindID:string, signal?:AbortSignal):void;
	abortThink(mindID:string):void;
	thinkSignal(mindID:string):AbortSignal | undefined;
	beginArc(mindID:string, arc:Arc):void;
	endArc(mindID:string):void;
	allowThink(row:ThinkRow):boolean;
	ensure(mindID:string, opts?:EnsureOpts):void;
	setWatches(mindID:string, watches:string[]):void;
	armOnce(mindID:string, expr:string):void;
	clearOnce(mindID:string):void;
	setAiOn(mindID:string, on:boolean):void;
	lastMax(mindID:string):number;
	scold(mindID:string):ScoldReason | undefined;
	rankScore(mindID:string, raw:number):number;
	heartbeatSeconds(mindID:string):number | null;
	scoreWatches(mindID:string, catalog:Catalog | readonly Catalog[]):number;
	enqueueMajor(mindID:string, force?:boolean):void;
	enqueueVerb(mindID:string, verb:string, ok?:boolean):void;
	enqueueArc(mindID:string, arc:Arc, ok?:boolean):void;
	noteResult(mindID:string, stalled:boolean):void;
	tick(dt:number, catalogs:Map<string, Catalog | readonly Catalog[]>):ThinkRow[];
	drop(mindID:string):void;
};

export type WithMindQueue = {
	queue:MindQueue;
	heartbeat:0;
};

export type MindState = {
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
	seq:number;
};

const HEARTBEAT_SCORE = 0.001;
const MAJOR_SCORE = 1;
/** Below a major event, so a scene's opening thinks queue behind anything that already happened. */
const START_SCORE = 0.5;

export abstract class MindScheduler implements MindQueue {
	public readonly trueScore:number;
	public readonly epsilon:number;
	public readonly watchInterval:number;
	public readonly processInterval:number;
	public batchThinks:boolean | undefined;
	public batchWait:number | undefined;
	public readonly heartbeatStart:number;
	public readonly heartbeatMin:number;
	public readonly heartbeatMax:number;
	public readonly heartbeatAdjust:HeartbeatAdjust;
	public mayThink:((ctx:MayThink)=>boolean) | undefined;
	protected watchClock = 0;
	protected processClock = 0;
	protected rows:ThinkRow[] = [];
	protected readonly minds = new Map<string, MindState>();
	protected readonly inflight = new Map<string, AbortController>();
	protected readonly executing = new Map<string, Arc>();
	protected nextSeq = 1;

	constructor(opts:MindQueueOpts = {}) {
		this.trueScore = clampTrueScore(opts.trueScore ?? DEFAULT_TRUE_SCORE);
		this.epsilon = opts.epsilon ?? DEFAULT_EPSILON;
		this.watchInterval = opts.watchInterval ?? 0.25;
		this.processInterval = opts.processInterval ?? 1;
		this.batchThinks = opts.batchThinks;
		this.batchWait = opts.batchWait;
		this.heartbeatStart = opts.heartbeatStart ?? 3;
		this.heartbeatMin = opts.heartbeatMin ?? 3;
		this.heartbeatMax = opts.heartbeatMax ?? 300;
		this.heartbeatAdjust = opts.heartbeatAdjust ?? false;
		this.mayThink = opts.mayThink;
	}

	public get inFlight():number {
		return this.inflight.size;
	}

	public isThinking(mindID:string):boolean {
		return this.inflight.has(mindID);
	}

	public hasPending(mindID:string):boolean {
		return this.rows.some((row) => row.mindID === mindID);
	}

	public hasThought(mindID:string):boolean {
		return this.minds.get(mindID)?.thoughtOnce === true;
	}

	public arcOf(mindID:string):Arc | null {
		return this.executing.get(mindID) ?? null;
	}

	public beginThink(mindID:string):AbortSignal {
		this.ensure(mindID);
		this.clearOnce(mindID);
		this.rows = this.rows.filter((r) => r.mindID !== mindID);
		const ac = new AbortController();
		this.inflight.set(mindID, ac);
		return ac.signal;
	}

	public endThink(mindID:string, signal?:AbortSignal):void {
		const ac = this.inflight.get(mindID);
		if (signal && ac && ac.signal !== signal) {
			return;
		}
		this.inflight.delete(mindID);
	}

	public abortThink(mindID:string):void {
		this.inflight.get(mindID)?.abort();
	}

	public thinkSignal(mindID:string):AbortSignal | undefined {
		return this.inflight.get(mindID)?.signal;
	}

	public beginArc(mindID:string, arc:Arc):void {
		this.ensure(mindID);
		this.executing.set(mindID, arc);
	}

	public endArc(mindID:string):void {
		this.executing.delete(mindID);
	}

	public allowThink(row:ThinkRow):boolean {
		const arc = this.arcOf(row.mindID);
		const ctx:MayThink = {
			mindID: row.mindID,
			reason: row.reason,
			score: row.score,
			rankedScore: this.rankScore(row.mindID, row.score),
			arc,
			verbs: arc ? arcVerbs(arc) : [],
		};
		if (this.mayThink) {
			return this.mayThink(ctx);
		}
		return true;
	}

	public ensure(mindID:string, opts?:EnsureOpts):MindState {
		let m = this.minds.get(mindID);
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
				seq: 0,
			};
			this.minds.set(mindID, m);
			// Heartbeat or not, a new mind thinks once: one that waits for events would otherwise idle until one.
			if (!opts?.skipStart) {
				this.insert({ mindID, score: START_SCORE, reason: 'start' });
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

	public setWatches(mindID:string, watches:string[]):void {
		this.ensure(mindID).watches = [...watches];
	}

	public armOnce(mindID:string, expr:string):void {
		const text = expr.replace(/\s+/g, ' ').trim();
		if (!text) {
			return;
		}
		this.ensure(mindID).once = text;
	}

	public clearOnce(mindID:string):void {
		const mind = this.minds.get(mindID);
		if (mind) {
			mind.once = undefined;
		}
	}

	public setAiOn(mindID:string, on:boolean):void {
		const mind = this.ensure(mindID);
		mind.aiOn = on;
		if (!on) {
			mind.once = undefined;
			this.rows = this.rows.filter((r) => r.mindID !== mindID);
			this.abortThink(mindID);
		}
	}

	public lastMax(mindID:string):number {
		return this.minds.get(mindID)?.lastMax ?? 0;
	}

	public scold(mindID:string):ScoldReason | undefined {
		return this.minds.get(mindID)?.scold;
	}

	public abstract rankScore(mindID:string, raw:number):number;

	public heartbeatSeconds(mindID:string):number | null {
		const mind = this.minds.get(mindID);
		if (mind?.skipHeartbeat) {
			return null;
		}
		return mind?.heartbeat ?? this.heartbeatStart;
	}

	public scoreWatches(mindID:string, catalog:Catalog | readonly Catalog[]):number {
		const mind = this.ensure(mindID);
		let max = 0;
		let scold:ScoldReason | undefined;
		const exprs = mind.once ? [...mind.watches, mind.once] : mind.watches;
		const catalogs = Array.isArray(catalog) ? catalog : [catalog];
		for (const cat of catalogs) {
			for (const expr of exprs) {
				const r = evaluate(expr, cat);
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
		}
		mind.lastMax = max;
		mind.scold = scold;
		return max;
	}

	public sampleWatches(mindID:string, catalog:Catalog | readonly Catalog[]):void {
		const mind = this.ensure(mindID);
		if (!mind.aiOn) {
			return;
		}
		const max = this.scoreWatches(mindID, catalog);
		if (max > this.epsilon) {
			this.insert({ mindID, score: max, reason: 'watch' });
		}
	}

	public enqueueMajor(mindID:string, force = false):void {
		const mind = this.ensure(mindID);
		if (!mind.aiOn || (mind.skipMajor && !force)) {
			return;
		}
		this.insert({ mindID, score: MAJOR_SCORE, reason: 'major' });
	}

	public enqueueVerb(mindID:string, verb:string, ok = true):void {
		this.enqueueScore(mindID, this.verbScore(verb, ok));
	}

	public enqueueArc(mindID:string, arc:Arc, ok = true):void {
		this.enqueueScore(mindID, this.arcScore(arc, ok));
	}

	public noteResult(mindID:string, stalled:boolean):void {
		const mind = this.ensure(mindID);
		mind.thoughtOnce = true;
		mind.sinceBeat = 0;
		mind.sinceThought = 0;
		if (this.heartbeatAdjust === false) {
			return;
		}
		if (typeof this.heartbeatAdjust === 'function') {
			mind.heartbeat = this.clampBeat(this.heartbeatAdjust(mindID, stalled));
			return;
		}
		if (stalled) {
			mind.heartbeat = this.clampBeat(mind.heartbeat * 1.25);
		}
		else {
			mind.heartbeat = this.clampBeat(mind.heartbeat * 0.9);
		}
	}

	public tick(dt:number, catalogs:Map<string, Catalog | readonly Catalog[]>):ThinkRow[] {
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
					this.insert({ mindID: id, score: HEARTBEAT_SCORE, reason: 'heartbeat' });
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
		this.prune();
		this.order();
		const picked:ThinkRow[] = [];
		const leftover:ThinkRow[] = [];
		for (const row of this.rows) {
			if (this.inflight.has(row.mindID) || !this.allowThink(row)) {
				leftover.push(row);
				continue;
			}
			picked.push(row);
		}
		this.rows = leftover;
		return picked;
	}

	public drop(mindID:string):void {
		this.abortThink(mindID);
		this.rows = this.rows.filter((r) => r.mindID !== mindID);
	}

	protected abstract prune():void;
	protected abstract order():void;
	protected abstract verbScore(verb:string, ok:boolean):number;
	protected abstract arcScore(arc:Arc, ok:boolean):number;

	protected enqueueScore(mindID:string, score:number):void {
		const mind = this.ensure(mindID);
		if (!mind.aiOn) {
			return;
		}
		if (score <= this.epsilon) {
			return;
		}
		this.insert({ mindID, score, reason: 'verb' });
	}

	protected insert(row:ThinkRow):void {
		this.rows.push(row);
	}

	protected clampBeat(n:number):number {
		return Math.min(this.heartbeatMax, Math.max(this.heartbeatMin, n));
	}
}

export function withScheduler(queue:MindQueue):WithMindQueue {
	return { queue, heartbeat: 0 };
}
