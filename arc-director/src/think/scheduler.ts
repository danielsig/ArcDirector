import { arcSteps, type Arc } from '../arc/arc-types.js';
import { evaluate } from '../expr/eval.js';
import { clampTrueScore, watchScore } from '../expr/watch-score.js';
import {
	DEFAULT_EPSILON,
	DEFAULT_TRUE_SCORE,
	type Catalog,
	type ScoldReason,
} from '../expr/expr-types.js';
import type { Watches } from '../character/character-types.js';

/** How a mind joins the queue. `rethinks`: on the queue's timer (default). `skipStart` only counts when it is new. */
export type EnsureOpts = { rethinks?:boolean; skipMajor?:boolean; skipStart?:boolean };

/** Each mind's watch views by its id, built only for the minds whose watches are sampled (a `Map` will do). */
export type WatchCatalogs = { get(mindID:string):Catalog | readonly Catalog[] | undefined };

/**
 * Why a mind is queued to think. `start`: once, when it joins, so it acts before anything happens to it. `arc`: its
 * Arc ended. `rethink`: the timer that asks it to rethink what it is doing, which wakes it only while its program has
 * little impact.
 */
export type ThinkReason = 'start' | 'watch' | 'major' | 'arc' | 'rethink';

export type ThinkRow = {
	mindID:string;
	score:number;
	reason:ThinkReason;
	/** What called for it, in a few words for a log (`watch hurt`, `heard speech`, `arc ok at go_to`). */
	why:string;
};

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

export type MindQueueOpts = {
	trueScore?:number;
	epsilon?:number;
	processInterval?:number;
	/** Game seconds between the queue asking a mind to rethink. Default 3. */
	rethinkInterval?:number;
	/**
	 * May this mind start a think? Default: yes when idle, no while an arc is live.
	 * Return true to think (host should abort the arc if it cannot overlap).
	 */
	mayThink?:(ctx:MayThink)=>boolean;
};

/** Interchangeable scheduler: the director keeps one, keyed by mind id. Each model's `maxParallel` caps its thinks. */
export type MindQueue = {
	mayThink:((ctx:MayThink)=>boolean) | undefined;
	readonly inFlight:number;
	isThinking(mindID:string):boolean;
	/** A think queued for `mindID`; with `except`, one for any other reason. */
	hasPending(mindID:string, except?:ThinkReason):boolean;
	/** It finished a think since it joined: its opening one, or any after. */
	hasThought(mindID:string):boolean;
	arcOf(mindID:string):Arc | null;
	beginThink(mindID:string):AbortSignal;
	endThink(mindID:string, signal?:AbortSignal):void;
	abortThink(mindID:string):void;
	beginArc(mindID:string, arc:Arc):void;
	endArc(mindID:string):void;
	allowThink(row:ThinkRow):boolean;
	ensure(mindID:string, opts?:EnsureOpts):void;
	/** A mind's watches, by name: the name is what a think it wakes says woke it. */
	setWatches(mindID:string, watches:Watches):void;
	armOnce(mindID:string, expr:string):void;
	clearOnce(mindID:string):void;
	setAiOn(mindID:string, on:boolean):void;
	lastMax(mindID:string):number;
	scold(mindID:string):ScoldReason | undefined;
	rankScore(mindID:string, raw:number):number;
	rethinkSeconds(mindID:string):number | null;
	scoreWatches(mindID:string, catalog:Catalog | readonly Catalog[]):number;
	/** `event`: the kind of event that wakes it (`HeardSpeech`), read as its why (`heard speech`). */
	enqueueMajor(mindID:string, force?:boolean, event?:string):void;
	/**
	 * Its Arc ended: it thinks again, at `score`, the impact of what ran (a failed one's at least {@link FAILED_ARC_SCORE}).
	 * `why`: what came of it, for a log.
	 */
	enqueueArcEnd(mindID:string, why:string, score:number):void;
	/** A think of it ended: its rethink timer and recency count from now. */
	noteResult(mindID:string):void;
	/** Time passes; with `catalogs`, every mind's watches are sampled too (the director passes them on its `withIntervals` `think`). */
	tick(dt:number, catalogs?:WatchCatalogs):ThinkRow[];
	drop(mindID:string):void;
};

export type MindState = {
	watches:Watches;
	/** It rethinks on the queue's timer. */
	rethinks:boolean;
	skipMajor:boolean;
	sinceRethink:number;
	lastMax:number;
	scold?:ScoldReason;
	thoughtOnce:boolean;
	sinceThought:number;
	aiOn:boolean;
	once?:string;
	/** Why the watch that scored highest at its last sampling would wake it (`watch hurt`, `until hasHeard`). */
	topWatch?:string;
	seq:number;
};

/** A watch with no name, in a few words for a log. */
function shortExpr(expr:string):string {
	return expr.length > 40 ? `${expr.slice(0, 39)}…` : expr;
}

/** Below every other reason; the director scales it by how little impact the mind's program has. */
const RETHINK_SCORE = 0.001;
const MAJOR_SCORE = 1;
/** Below a major event, so a scene's opening thinks queue behind anything that already happened. */
const START_SCORE = 0.5;
/** The least a failed Arc's think scores, however little ran: as a scene's opening think, well above the queue's epsilon. */
export const FAILED_ARC_SCORE = 0.5;

export abstract class MindScheduler implements MindQueue {
	public readonly trueScore:number;
	public readonly epsilon:number;
	public readonly processInterval:number;
	public readonly rethinkInterval:number;
	public mayThink:((ctx:MayThink)=>boolean) | undefined;
	protected processClock = 0;
	protected rows:ThinkRow[] = [];
	protected readonly minds = new Map<string, MindState>();
	protected readonly inflight = new Map<string, AbortController>();
	protected readonly executing = new Map<string, Arc>();
	protected nextSeq = 1;

	constructor(opts:MindQueueOpts = {}) {
		this.trueScore = clampTrueScore(opts.trueScore ?? DEFAULT_TRUE_SCORE);
		this.epsilon = opts.epsilon ?? DEFAULT_EPSILON;
		this.processInterval = opts.processInterval ?? 1;
		this.rethinkInterval = opts.rethinkInterval ?? 3;
		this.mayThink = opts.mayThink;
	}

	public get inFlight():number {
		return this.inflight.size;
	}

	public isThinking(mindID:string):boolean {
		return this.inflight.has(mindID);
	}

	public hasPending(mindID:string, except?:ThinkReason):boolean {
		return this.rows.some((row) => row.mindID === mindID && row.reason !== except);
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
			verbs: arc ? arcSteps(arc).map((step) => step.verb) : [],
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
				watches: {},
				rethinks: opts?.rethinks ?? true,
				skipMajor: opts?.skipMajor ?? false,
				sinceRethink: 0,
				lastMax: 0,
				thoughtOnce: false,
				sinceThought: Number.POSITIVE_INFINITY,
				aiOn: true,
				seq: 0,
			};
			this.minds.set(mindID, m);
			// Rethinking on the timer or not, a new mind thinks once: one that waits for events would otherwise idle until one.
			if (!opts?.skipStart) {
				this.insert({ mindID, score: START_SCORE, reason: 'start', why: 'start' });
			}
		}
		if (opts?.rethinks !== undefined) {
			m.rethinks = opts.rethinks;
		}
		if (opts?.skipMajor !== undefined) {
			m.skipMajor = opts.skipMajor;
		}
		return m;
	}

	public setWatches(mindID:string, watches:Watches):void {
		this.ensure(mindID).watches = { ...watches };
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

	public rethinkSeconds(mindID:string):number | null {
		return this.minds.get(mindID)?.rethinks === false ? null : this.rethinkInterval;
	}

	public scoreWatches(mindID:string, catalog:Catalog | readonly Catalog[]):number {
		const mind = this.ensure(mindID);
		let max = 0;
		let top:string | undefined;
		let scold:ScoldReason | undefined;
		const watches = Object.entries(mind.watches).map(([name, expr]) => ({ expr, why: `watch ${name || shortExpr(expr)}` }));
		// A wait's until wakes it as a watch does; it has no name.
		const exprs = mind.once ? [...watches, { expr: mind.once, why: `until ${shortExpr(mind.once)}` }] : watches;
		const catalogs = Array.isArray(catalog) ? catalog : [catalog];
		for (const cat of catalogs) {
			for (const { expr, why } of exprs) {
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
					top = why;
				}
			}
		}
		mind.lastMax = max;
		mind.topWatch = top;
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
			this.insert({ mindID, score: max, reason: 'watch', why: mind.topWatch ?? 'watch' });
		}
	}

	public enqueueMajor(mindID:string, force = false, event?:string):void {
		const mind = this.ensure(mindID);
		if (!mind.aiOn || (mind.skipMajor && !force)) {
			return;
		}
		const why = event ? event.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase() : 'major event';
		this.insert({ mindID, score: MAJOR_SCORE, reason: 'major', why });
	}

	public enqueueArcEnd(mindID:string, why:string, score:number):void {
		if (this.ensure(mindID).aiOn) {
			this.insert({ mindID, score, reason: 'arc', why });
		}
	}

	public noteResult(mindID:string):void {
		const mind = this.ensure(mindID);
		mind.thoughtOnce = true;
		mind.sinceRethink = 0;
		mind.sinceThought = 0;
	}

	public tick(dt:number, catalogs?:WatchCatalogs):ThinkRow[] {
		if (dt > 0) {
			this.processClock += dt;
			for (const [id, mind] of this.minds) {
				if (!mind.aiOn) {
					continue;
				}
				if (Number.isFinite(mind.sinceThought)) {
					mind.sinceThought += dt;
				}
				if (!mind.rethinks) {
					continue;
				}
				mind.sinceRethink += dt;
				if (mind.sinceRethink >= this.rethinkInterval) {
					this.insert({ mindID: id, score: RETHINK_SCORE, reason: 'rethink', why: 'rethink' });
					mind.sinceRethink = 0;
				}
			}
		}
		if (catalogs) {
			for (const [id, mind] of this.minds) {
				if (!mind.aiOn) {
					continue;
				}
				if (Object.keys(mind.watches).length === 0 && !mind.once) {
					mind.lastMax = 0;
					mind.scold = undefined;
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

	protected insert(row:ThinkRow):void {
		this.rows.push(row);
	}
}
