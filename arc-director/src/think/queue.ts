import { evaluate } from '../expr/eval.js';
import { clampTrueScore, watchScore } from '../expr/score.js';
import {
	DEFAULT_EPSILON,
	DEFAULT_TRUE_SCORE,
	type Catalog,
	type ScoldReason,
} from '../expr/types.js';

export type ThinkReason = 'watch' | 'major' | 'heartbeat';

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
};

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

	setAiOn(npcID:string, on:boolean):void {
		this.ensure(npcID).aiOn = on;
		if (!on) {
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
		for (const expr of mind.watches) {
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
