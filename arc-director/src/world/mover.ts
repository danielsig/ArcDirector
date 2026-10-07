import type { ArcResult } from '../arc/types.js';
import { blockedReason, findRoute, noWayTo, type Route } from './route.js';
import type { HostWorld, Vec } from './types.js';
import { distance } from './vec.js';

/** Where a move heads: a character or thing (followed as it moves), or a fixed point. */
export type MoveDest = { target:string } | { point:Vec };

export type MoveOpts = {
	/** Arrive this close. Default: `getReach` for a target; for a point, when `steerToward` says the character is there. */
	within?:number;
	/** Never finish: keep within reach as the target moves, until replaced or stopped. */
	sticky?:boolean;
	/** Asked a few times a second while moving. A reason ends the move there, successfully. */
	check?:()=>string | undefined;
};

type Errand = {
	verb:string;
	dest:MoveDest;
	opts:MoveOpts;
	route?:Route;
	next:number;
	goal?:Vec;
	plannedAt:number;
	/** No search before this: the last one found no way. */
	retryAt:number;
	bestGap:number;
	bestAt:number;
	stuck:number;
	checkedAt:number;
	character?:unknown;
	done:(result:ArcResult)=>void;
};

const CHECK_EVERY = 0.25;
const REPLAN_EVERY = 2;
const STUCK_AFTER = 1.5;
const STUCK_TRIES = 3;
/** Closing 2% of the gap to the waypoint counts as progress. */
const PROGRESS = 0.98;

/** Drives characters along routes through the host's `getPathGraph`, one move per character; a new move replaces the old. */
export class Mover {
	private readonly errands = new Map<string, Errand>();

	constructor(
		private readonly world:HostWorld<unknown> | undefined,
		private readonly now:()=>number,
	) {}

	get canMove():boolean {
		return !!(this.world?.getPathGraph && this.world.steerToward);
	}

	moving(characterID:string):boolean {
		return this.errands.has(characterID);
	}

	go(characterID:string, dest:MoveDest, verb:string, opts:MoveOpts = {}):Promise<ArcResult> {
		if (!this.canMove) {
			return Promise.resolve({ ok: false, verb, reason: 'cannot move' });
		}
		this.stop(characterID, { ok: false, interrupted: true, verb, reason: 'replaced' });
		return new Promise((done) => {
			const now = this.now();
			this.errands.set(characterID, {
				verb,
				dest,
				opts,
				next: 0,
				plannedAt: -Infinity,
				retryAt: -Infinity,
				bestGap: Infinity,
				bestAt: now,
				stuck: 0,
				checkedAt: now,
				done,
			});
		});
	}

	/** End `characterID`'s move, standing still. Default result: interrupted. */
	stop(characterID:string, result?:ArcResult):void {
		const errand = this.errands.get(characterID);
		if (!errand) {
			return;
		}
		this.errands.delete(characterID);
		if (errand.character !== undefined) {
			this.world?.steerToward?.(errand.character, null);
		}
		errand.done(result ?? { ok: false, interrupted: true, verb: errand.verb });
	}

	tick():void {
		for (const [id, errand] of [...this.errands]) {
			const reason = this.step(id, errand);
			if (reason !== undefined) {
				this.stop(id, reason);
			}
		}
	}

	/** One tick of one move. A result ends it. */
	private step(id:string, e:Errand):ArcResult | undefined {
		const world = this.world!;
		const character = world.find(id);
		const me = character === undefined ? undefined : world.getPose(character)?.point;
		if (character === undefined || !me) {
			return { ok: false, verb: e.verb, reason: 'not in this scene' };
		}
		e.character = character;
		const target = 'target' in e.dest ? e.dest.target : undefined;
		const goal = target !== undefined ? world.find(target) : undefined;
		const dest = target !== undefined ? (goal === undefined ? undefined : world.getPose(goal)?.point) : (e.dest as { point:Vec }).point;
		if (!dest) {
			return { ok: false, verb: e.verb, reason: `${target} is gone` };
		}
		const now = this.now();
		if (e.opts.check && now - e.checkedAt >= CHECK_EVERY) {
			e.checkedAt = now;
			const met = e.opts.check();
			if (met !== undefined) {
				return { ok: true, verb: e.verb, reason: met };
			}
		}
		const within = e.opts.within ?? (target !== undefined ? world.getReach?.(character, goal) ?? 1 : 0);
		if (distance(me, dest) <= within) {
			return this.arrive(e, character, now);
		}
		const moved = target !== undefined && e.goal && distance(dest, e.goal) > within;
		const stale = target !== undefined && now - e.plannedAt >= REPLAN_EVERY;
		if (!e.route && now < e.retryAt) {
			return undefined;
		}
		if (!e.route || moved || stale || this.isStuck(e, now)) {
			const failed = this.plan(e, character, me, dest, within, target);
			if (failed) {
				if (!e.opts.sticky) {
					return failed;
				}
				e.retryAt = now + REPLAN_EVERY;
				e.stuck = 0;
				world.steerToward!(character, null);
				return undefined;
			}
		}
		// The game's motor says when the character is at a waypoint. Past the route, head straight for the destination.
		const route = e.route!;
		for (;;) {
			const waypoint = route.points[e.next] ?? dest;
			if (!world.steerToward!(character, waypoint)) {
				const gap = distance(me, waypoint);
				if (gap < e.bestGap * PROGRESS) {
					e.bestGap = gap;
					e.bestAt = now;
				}
				return undefined;
			}
			if (e.next >= route.points.length) {
				return this.arrive(e, character, now);
			}
			e.next += 1;
			e.bestGap = Infinity;
			e.stuck = 0;
		}
	}

	/** In reach: done, or for a sticky move, stand by until the target moves off. */
	private arrive(e:Errand, character:unknown, now:number):ArcResult | undefined {
		if (!e.opts.sticky) {
			return { ok: true, verb: e.verb };
		}
		e.route = undefined;
		e.bestAt = now;
		e.stuck = 0;
		this.world!.steerToward!(character, null);
		return undefined;
	}

	private isStuck(e:Errand, now:number):boolean {
		if (now - e.bestAt < STUCK_AFTER) {
			return false;
		}
		e.stuck += 1;
		e.bestAt = now;
		e.bestGap = Infinity;
		return true;
	}

	/** New route toward `dest`. A result means there is none. */
	private plan(e:Errand, character:unknown, me:Vec, dest:Vec, within:number, target?:string):ArcResult | undefined {
		if (e.stuck >= STUCK_TRIES) {
			return { ok: false, verb: e.verb, reason: 'stuck' };
		}
		const route = findRoute(this.world!.getPathGraph!(character), me, dest, within);
		e.plannedAt = this.now();
		e.goal = dest;
		e.next = 0;
		e.route = undefined;
		if (!route) {
			return { ok: false, verb: e.verb, reason: target !== undefined ? noWayTo(target, '') : 'no way there', unreachable: target };
		}
		if ('blockers' in route) {
			const why = blockedReason(route);
			return { ok: false, verb: e.verb, reason: target !== undefined ? noWayTo(target, why) : why, unreachable: target };
		}
		e.route = route;
		return undefined;
	}
}
