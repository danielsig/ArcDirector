import type { ArcResult } from '../arc/types.js';
import { blockedReason, findRoute, noWayTo, pointGoal, type Route, type RouteGoal } from './route.js';
import type { HostWorld, Vec } from './types.js';
import { distance } from './vec.js';

/**
 * Where a move heads: a character or thing (followed as it moves), a fixed point, or any goal a route search can
 * aim at (`awayGoal`), asked again on each replan so it follows what it is about. `noWay` words a failed search.
 */
export type MoveDest = { target:string } | { point:Vec } | { goal:()=>RouteGoal | undefined; noWay:(why:string)=>string };

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
	/** Where the target stood at the last plan. */
	plannedTo?:Vec;
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
	private readonly _errands = new Map<string, Errand>();

	constructor(
		private readonly _world:HostWorld<unknown> | undefined,
		private readonly _now:()=>number,
	) {}

	public get canMove():boolean {
		return !!(this._world?.getPathGraph && this._world.steerToward);
	}

	public moving(characterID:string):boolean {
		return this._errands.has(characterID);
	}

	public go(characterID:string, dest:MoveDest, verb:string, opts:MoveOpts = {}):Promise<ArcResult> {
		if (!this.canMove) {
			return Promise.resolve({ ok: false, verb, reason: 'cannot move' });
		}
		this.stop(characterID, { ok: false, interrupted: true, verb, reason: 'replaced' });
		return new Promise((done) => {
			const now = this._now();
			this._errands.set(characterID, {
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
	public stop(characterID:string, result?:ArcResult):void {
		const errand = this._errands.get(characterID);
		if (!errand) {
			return;
		}
		this._errands.delete(characterID);
		if (errand.character !== undefined) {
			this._world?.steerToward?.(errand.character, null);
		}
		errand.done(result ?? { ok: false, interrupted: true, verb: errand.verb });
	}

	public tick():void {
		for (const [id, errand] of [...this._errands]) {
			const reason = this.step(id, errand);
			if (reason !== undefined) {
				this.stop(id, reason);
			}
		}
	}

	/** One tick of one move. A result ends it. */
	private step(id:string, e:Errand):ArcResult | undefined {
		const world = this._world!;
		const character = world.find(id);
		const me = character === undefined ? undefined : world.getPose(character)?.point;
		if (character === undefined || !me) {
			return { ok: false, verb: e.verb, reason: 'not in this scene' };
		}
		e.character = character;
		const now = this._now();
		if (e.opts.check && now - e.checkedAt >= CHECK_EVERY) {
			e.checkedAt = now;
			const met = e.opts.check();
			if (met !== undefined) {
				return { ok: true, verb: e.verb, reason: met };
			}
		}
		const aim = this.aim(e, character);
		if ('ok' in aim) {
			return aim;
		}
		const { goal, dest, within } = aim;
		if (goal.reached(me)) {
			return this.arrive(e, character, now);
		}
		const target = 'target' in e.dest ? e.dest.target : undefined;
		const moved = target !== undefined && e.plannedTo && dest && distance(dest, e.plannedTo) > within;
		const stale = !('point' in e.dest) && now - e.plannedAt >= REPLAN_EVERY;
		if (!e.route && now < e.retryAt) {
			return undefined;
		}
		if (!e.route || moved || stale || this.isStuck(e, now)) {
			const failed = this.plan(e, character, me, goal, dest);
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
		// Follow the route only. A Euclidean "close enough" on the far side of a wall is not a step.
		const route = e.route!;
		for (;;) {
			if (e.next >= route.points.length) {
				return this.arrive(e, character, now);
			}
			const waypoint = route.points[e.next];
			if (!world.steerToward!(character, waypoint)) {
				const gap = distance(me, waypoint);
				if (gap < e.bestGap * PROGRESS) {
					e.bestGap = gap;
					e.bestAt = now;
				}
				return undefined;
			}
			e.next += 1;
			e.bestGap = Infinity;
			e.stuck = 0;
		}
	}

	/** What this move aims at now: its goal, and the point it heads for past the route when it has one. */
	private aim(e:Errand, character:unknown):{ goal:RouteGoal; dest?:Vec; within:number } | ArcResult {
		const world = this._world!;
		if ('goal' in e.dest) {
			const goal = e.dest.goal();
			return goal ? { goal, within: 0 } : { ok: false, verb: e.verb, reason: 'gone' };
		}
		if ('point' in e.dest) {
			const within = e.opts.within ?? 0;
			return { goal: pointGoal(e.dest.point, within), dest: e.dest.point, within };
		}
		const found = world.find(e.dest.target);
		const dest = found === undefined ? undefined : world.getPose(found)?.point;
		if (!dest) {
			return { ok: false, verb: e.verb, reason: `${e.dest.target} is gone` };
		}
		const within = e.opts.within ?? world.getReach?.(character, found) ?? 1;
		return { goal: pointGoal(dest, within), dest, within };
	}

	/** In reach: done, or for a sticky move, stand by until the target moves off. */
	private arrive(e:Errand, character:unknown, now:number):ArcResult | undefined {
		if (!e.opts.sticky) {
			return { ok: true, verb: e.verb };
		}
		e.route = undefined;
		e.bestAt = now;
		e.stuck = 0;
		this._world!.steerToward!(character, null);
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

	/** New route to `goal`. A result means there is none. */
	private plan(e:Errand, character:unknown, me:Vec, goal:RouteGoal, dest:Vec | undefined):ArcResult | undefined {
		if (e.stuck >= STUCK_TRIES) {
			return { ok: false, verb: e.verb, reason: 'stuck' };
		}
		const route = findRoute(this._world!.getPathGraph!(character), me, goal);
		e.plannedAt = this._now();
		e.plannedTo = dest;
		e.next = 0;
		e.route = undefined;
		if (!route || 'blockers' in route) {
			const why = route ? blockedReason(route) : '';
			const target = 'target' in e.dest ? e.dest.target : undefined;
			const reason = 'goal' in e.dest ? e.dest.noWay(why) : target !== undefined ? noWayTo(target, why) : why || 'no way there';
			return { ok: false, verb: e.verb, reason, unreachable: target };
		}
		e.route = route;
		return undefined;
	}
}
