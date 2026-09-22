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

export type ThinkReason = 'watch' | 'major' | 'verb' | 'heartbeat';

export type ThinkRow = {
	npcID:string;
	score:number;
	reason:ThinkReason;
};

/** Keep a fixed interval (`false`, default), or stretch/shrink (`'auto'`), or return seconds. */
export type HeartbeatAdjust = false | 'auto' | ((npcID:string, stalled:boolean)=>number);

/** Asked before a think starts while an arc may still be running. */
export type MayThink = {
	npcID:string;
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
	 * Buffer starts until the model is idle (or `batchWait`), then launch up to `maxParallel`.
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
	maxParallel?:number;
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

/** Interchangeable scheduler. Spread `withPriorityQueue` / `withSimpleQueue` into each `Agent`. */
export type MindQueue = {
	maxParallel:number;
	batchThinks:boolean | undefined;
	batchWait:number | undefined;
	mayThink:((ctx:MayThink)=>boolean) | undefined;
	readonly inFlight:number;
	isThinking(npcID:string):boolean;
	arcOf(npcID:string):Arc | null;
	beginThink(npcID:string):void;
	endThink(npcID:string):void;
	beginArc(npcID:string, arc:Arc):void;
	endArc(npcID:string):void;
	allowThink(row:ThinkRow):boolean;
	ensure(npcID:string, opts?:{ skipHeartbeat?:boolean; skipMajor?:boolean }):void;
	setWatches(npcID:string, watches:string[]):void;
	armOnce(npcID:string, expr:string):void;
	clearOnce(npcID:string):void;
	setAiOn(npcID:string, on:boolean):void;
	lastMax(npcID:string):number;
	scold(npcID:string):ScoldReason | undefined;
	rankScore(npcID:string, raw:number):number;
	heartbeatSeconds(npcID:string):number | null;
	scoreWatches(npcID:string, catalog:Catalog | readonly Catalog[]):number;
	enqueueMajor(npcID:string, force?:boolean):void;
	enqueueVerb(npcID:string, verb:string, ok?:boolean):void;
	enqueueArc(npcID:string, arc:Arc, ok?:boolean):void;
	noteResult(npcID:string, stalled:boolean):void;
	tick(dt:number, catalogs:Map<string, Catalog | readonly Catalog[]>):ThinkRow[];
	drop(npcID:string):void;
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

export abstract class MindScheduler implements MindQueue {
	readonly trueScore:number;
	readonly epsilon:number;
	readonly watchInterval:number;
	readonly processInterval:number;
	maxParallel:number;
	batchThinks:boolean | undefined;
	batchWait:number | undefined;
	readonly heartbeatStart:number;
	readonly heartbeatMin:number;
	readonly heartbeatMax:number;
	readonly heartbeatAdjust:HeartbeatAdjust;
	mayThink:((ctx:MayThink)=>boolean) | undefined;
	protected watchClock = 0;
	protected processClock = 0;
	protected rows:ThinkRow[] = [];
	protected readonly minds = new Map<string, MindState>();
	protected readonly thinking = new Set<string>();
	protected readonly executing = new Map<string, Arc>();
	protected nextSeq = 1;

	constructor(opts:MindQueueOpts = {}) {
		this.trueScore = clampTrueScore(opts.trueScore ?? DEFAULT_TRUE_SCORE);
		this.epsilon = opts.epsilon ?? DEFAULT_EPSILON;
		this.watchInterval = opts.watchInterval ?? 0.25;
		this.processInterval = opts.processInterval ?? 1;
		this.maxParallel = opts.maxParallel ?? 2;
		this.batchThinks = opts.batchThinks;
		this.batchWait = opts.batchWait;
		this.heartbeatStart = opts.heartbeatStart ?? 3;
		this.heartbeatMin = opts.heartbeatMin ?? 3;
		this.heartbeatMax = opts.heartbeatMax ?? 300;
		this.heartbeatAdjust = opts.heartbeatAdjust ?? false;
		this.mayThink = opts.mayThink;
	}

	get inFlight():number {
		return this.thinking.size;
	}

	isThinking(npcID:string):boolean {
		return this.thinking.has(npcID);
	}

	arcOf(npcID:string):Arc | null {
		return this.executing.get(npcID) ?? null;
	}

	beginThink(npcID:string):void {
		this.ensure(npcID);
		this.clearOnce(npcID);
		this.drop(npcID);
		this.thinking.add(npcID);
	}

	endThink(npcID:string):void {
		this.thinking.delete(npcID);
	}

	beginArc(npcID:string, arc:Arc):void {
		this.ensure(npcID);
		this.executing.set(npcID, arc);
	}

	endArc(npcID:string):void {
		this.executing.delete(npcID);
	}

	allowThink(row:ThinkRow):boolean {
		const arc = this.arcOf(row.npcID);
		const ctx:MayThink = {
			npcID: row.npcID,
			reason: row.reason,
			score: row.score,
			rankedScore: this.rankScore(row.npcID, row.score),
			arc,
			verbs: arc ? arcVerbs(arc) : [],
		};
		if (this.mayThink) {
			return this.mayThink(ctx);
		}
		return true;
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
				seq: 0,
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

	armOnce(npcID:string, expr:string):void {
		const text = expr.replace(/\s+/g, ' ').trim();
		if (!text) {
			return;
		}
		this.ensure(npcID).once = text;
	}

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

	abstract rankScore(npcID:string, raw:number):number;

	heartbeatSeconds(npcID:string):number | null {
		const mind = this.minds.get(npcID);
		if (mind?.skipHeartbeat) {
			return null;
		}
		return mind?.heartbeat ?? this.heartbeatStart;
	}

	scoreWatches(npcID:string, catalog:Catalog | readonly Catalog[]):number {
		const mind = this.ensure(npcID);
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

	sampleWatches(npcID:string, catalog:Catalog | readonly Catalog[]):void {
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

	enqueueVerb(npcID:string, verb:string, ok = true):void {
		this.enqueueScore(npcID, this.verbScore(verb, ok));
	}

	enqueueArc(npcID:string, arc:Arc, ok = true):void {
		this.enqueueScore(npcID, this.arcScore(arc, ok));
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

	tick(dt:number, catalogs:Map<string, Catalog | readonly Catalog[]>):ThinkRow[] {
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
		const slots = Math.max(0, this.maxParallel - this.thinking.size);
		if (slots === 0) {
			return [];
		}
		this.prune();
		this.order();
		const picked:ThinkRow[] = [];
		const leftover:ThinkRow[] = [];
		for (const row of this.rows) {
			if (picked.length >= slots || this.thinking.has(row.npcID) || !this.allowThink(row)) {
				leftover.push(row);
				continue;
			}
			picked.push(row);
		}
		this.rows = leftover;
		return picked;
	}

	drop(npcID:string):void {
		this.rows = this.rows.filter((r) => r.npcID !== npcID);
	}

	protected abstract prune():void;
	protected abstract order():void;
	protected abstract verbScore(verb:string, ok:boolean):number;
	protected abstract arcScore(arc:Arc, ok:boolean):number;

	protected enqueueScore(npcID:string, score:number):void {
		const mind = this.ensure(npcID);
		if (!mind.aiOn) {
			return;
		}
		if (score <= this.epsilon) {
			return;
		}
		this.insert({ npcID, score, reason: 'verb' });
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
