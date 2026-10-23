import type { ArcResult } from '../arc/types.js';
import { blockedReason, findRoute, hasRoutes, noWayTo, pointGoal, type Route, type RouteGoal, type RouteWorld } from './route.js';
import type { HostWorld, Vec } from './types.js';
import { add, distance, groundAxes, sub, unit } from './vec.js';

/**
 * How characters bound for the same target share it. `line`: the first goes in, the rest queue one behind another
 * out along the way the target faces, each moving up as the one ahead is done; for one served at a time (a vendor).
 * `ring`: each takes its own place round the target in reach, and any past a full ring wait in the next one out;
 * for many at once (a foe, a speaker). `none`: each goes straight in.
 */
export type Crowd = 'line' | 'ring' | 'none';

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
	/** How it shares its target with others bound there. Default: the target character's, else the director's for this verb. */
	crowd?:Crowd;
};

/** The crowd a move to `target` takes when its options name none. */
export type CrowdOf = (verb:string, target:string)=>Crowd;

/** A game's crowds, for `withCrowd`: how characters bound for the same character share it. */
export type CrowdSettings = {
	/** For a verb `verbs` does not name. Default `none`. */
	crowd?:Crowd;
	/** By the verb that moves them: `{ offer: 'line' }`. */
	verbs?:Record<string, Crowd>;
	/** Room between two in a line or a ring, in the world's units. Default 1. */
	spacing?:number;
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
	/** How it shares its target. `none` once its crowd place turned out to be out of the way. */
	crowd:Crowd;
	/** Its place round the target in a `ring`: which ring out, and which place in it. */
	slot?:{ ring:number; index:number };
	/** The last plan headed for its crowd place, not the target. */
	toPlace:boolean;
	done:(result:ArcResult)=>void;
};

/** Where a crowd puts one of its own: the point to head for, and whether to wait there (not its turn) or go on in. */
type Place = { point:Vec; waiting:boolean };

const CHECK_EVERY = 0.25;
const REPLAN_EVERY = 2;
const STUCK_AFTER = 1.5;
const STUCK_TRIES = 3;
/** Closing 2% of the gap to the waypoint counts as progress. */
const PROGRESS = 0.98;
/** The innermost ring of a `ring` crowd, as a share of reach: in reach with room to spare. */
const RING_IN = 0.8;
/** Rings out from the target before the rest go straight in. */
const RINGS = 4;

/**
 * The last of `points` from `i` on in a straight line with the step into `i`: steering there passes the same
 * points, so a host that moves in steps longer than one is not held to one point a step.
 */
function straightEnd(points:readonly Vec[], i:number):number {
	if (i === 0) {
		return i;
	}
	const step = sub(points[i], points[i - 1]);
	let end = i;
	while (end + 1 < points.length && distance(sub(points[end + 1], points[end]), step) < 1e-6) {
		end += 1;
	}
	return end;
}

/** Drives characters along routes over the host's `getNeighbors` and `canPass`, one move per character; a new move replaces the old. */
export class Mover {
	private readonly _errands = new Map<string, Errand>();
	/** Ring places whose takers got there, by target then taker: taken while the taker still stands in it. */
	private readonly _settled = new Map<string, Map<string, { ring:number; index:number }>>();
	/** The way each line runs, by target: set when it forms, so it does not swing as the target turns. */
	private readonly _lineWays = new Map<string, Vec>();

	constructor(
		private readonly _world:HostWorld<unknown> | undefined,
		private readonly _now:()=>number,
		private readonly _crowdOf:CrowdOf = () => 'none',
		/** Room between two in a line or a ring, in the world's units. */
		private readonly _spacing = 1,
	) {}

	public get canMove():boolean {
		return hasRoutes(this._world) && !!this._world.steerToward;
	}

	public moving(characterID:string):boolean {
		return this._errands.has(characterID);
	}

	public go(characterID:string, dest:MoveDest, verb:string, opts:MoveOpts = {}):Promise<ArcResult> {
		if (!this.canMove) {
			return Promise.resolve({ ok: false, verb, reason: 'cannot move' });
		}
		this.stop(characterID, { ok: false, interrupted: true, verb, reason: 'replaced' });
		for (const settled of this._settled.values()) {
			settled.delete(characterID);
		}
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
				crowd: opts.crowd ?? ('target' in dest ? this._crowdOf(verb, dest.target) : 'none'),
				toPlace: false,
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
		const lined = new Set([...this._errands.values()].flatMap((e) => (e.crowd === 'line' && 'target' in e.dest ? [e.dest.target] : [])));
		for (const target of this._lineWays.keys()) {
			if (!lined.has(target)) {
				this._lineWays.delete(target);
			}
		}
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
		const aim = this.aim(e, character);
		if ('ok' in aim) {
			return aim;
		}
		const { goal, dest, within } = aim;
		const place = dest && this.place(id, e, me, dest, aim.facing, within);
		// In reach counts only in its turn, and with a place of its own, once there: else it stops wherever reach begins,
		// on top of the last to get there. In reach before its first step, it stays put.
		const settled = !place || e.plannedAt === -Infinity || distance(me, place.point) <= this._spacing / 2;
		if (!place?.waiting && settled) {
			if (e.opts.check && now - e.checkedAt >= CHECK_EVERY) {
				e.checkedAt = now;
				const met = e.opts.check();
				if (met !== undefined) {
					return { ok: true, verb: e.verb, reason: met };
				}
			}
			if (goal.reached(me)) {
				return this.arrive(id, e, character, now);
			}
		}
		const toward = place?.point ?? dest;
		const target = 'target' in e.dest ? e.dest.target : undefined;
		const moved = target !== undefined && e.plannedTo && toward && distance(toward, e.plannedTo) > (place ? this._spacing / 2 : within);
		const stale = !('point' in e.dest) && now - e.plannedAt >= REPLAN_EVERY;
		if (!e.route && now < e.retryAt) {
			return undefined;
		}
		if (!e.route || moved || stale || !!place !== e.toPlace || this.isStuck(e, now)) {
			const failed = this.plan(e, character, me, place ? pointGoal(place.point) : goal, toward, !!place);
			// No way to its crowd place: from now on it goes straight in.
			if (failed && place) {
				e.crowd = 'none';
				e.slot = undefined;
				e.stuck = 0;
				return undefined;
			}
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
				return place ? this.stand(e, character, place.point, now) : this.arrive(id, e, character, now);
			}
			const end = straightEnd(route.points, e.next);
			const waypoint = route.points[end];
			if (!world.steerToward!(character, waypoint)) {
				const gap = distance(me, waypoint);
				if (gap < e.bestGap * PROGRESS) {
					e.bestGap = gap;
					e.bestAt = now;
				}
				return undefined;
			}
			e.next = end + 1;
			e.bestGap = Infinity;
			e.stuck = 0;
		}
	}

	/** What this move aims at now: its goal, the point it heads for past the route when it has one, and which way that faces. */
	private aim(e:Errand, character:unknown):{ goal:RouteGoal; dest?:Vec; facing?:Vec; within:number } | ArcResult {
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
		// Its part nearest the one going there, for a thing spread over many cells.
		const pose = found === undefined ? undefined : world.getPose(found, character);
		if (!pose) {
			return { ok: false, verb: e.verb, reason: `${e.dest.target} is ${world.isDown?.(e.dest.target) ? 'down' : 'gone'}` };
		}
		const within = e.opts.within ?? world.getReach?.(character, found) ?? 1;
		return { goal: pointGoal(pose.point, within), dest: pose.point, facing: pose.facing, within };
	}

	/** Where its crowd puts `id` on the way to `dest`; none to go straight in. */
	private place(id:string, e:Errand, me:Vec, dest:Vec, facing:Vec | undefined, within:number):Place | undefined {
		if (e.crowd === 'none' || !('target' in e.dest)) {
			return undefined;
		}
		const target = e.dest.target;
		const crowd = [...this._errands].filter(([, other]) => other.crowd === e.crowd && 'target' in other.dest && other.dest.target === target);
		return e.crowd === 'line' ? this.linePlace(id, target, crowd, dest, facing, within) : this.ringPlace(id, e, target, crowd, me, dest, within);
	}

	/** Its place in line, first come first: none for the first, who goes in; the rest one behind another the way the target faces. */
	private linePlace(id:string, target:string, crowd:[string, Errand][], dest:Vec, facing:Vec | undefined, within:number):Place | undefined {
		const rank = crowd.findIndex(([other]) => other === id);
		if (rank <= 0) {
			return undefined;
		}
		const first = crowd[0][1].character;
		const firstAt = first === undefined ? undefined : this._world!.getPose(first)?.point;
		const way = this._lineWays.get(target) ?? (facing && unit(facing)) ?? (firstAt && unit(sub(firstAt, dest))) ?? groundAxes(dest.length, this._world!.up)[0];
		this._lineWays.set(target, way);
		return { point: add(dest, way, within + rank * this._spacing), waiting: true };
	}

	/**
	 * Its place round the target: the nearest free one in the innermost ring with room, kept until a ring further
	 * in has room. Only the innermost ring is in reach; the rest wait.
	 */
	private ringPlace(id:string, e:Errand, target:string, crowd:[string, Errand][], me:Vec, dest:Vec, within:number):Place | undefined {
		const world = this._world!;
		const key = (ring:number, index:number):string => `${ring}:${index}`;
		const taken = new Set(crowd.flatMap(([other, o]) => (other !== id && o.slot ? [key(o.slot.ring, o.slot.index)] : [])));
		const [e1, e2] = groundAxes(dest.length, world.up);
		const ringOf = (ring:number):{ radius:number; count:number } => {
			const radius = within * RING_IN + ring * this._spacing;
			return { radius, count: Math.max(1, Math.floor((Math.PI * 2 * radius) / this._spacing)) };
		};
		const pointOf = (ring:number, index:number):Vec => {
			const { radius, count } = ringOf(ring);
			const a = (index / count) * Math.PI * 2;
			return add(add(dest, e1, Math.cos(a) * radius), e2, Math.sin(a) * radius);
		};
		const settled = this._settled.get(target);
		for (const [other, slot] of settled ?? []) {
			const found = world.find(other);
			const at = found === undefined ? undefined : world.getPose(found)?.point;
			if (at && distance(at, pointOf(slot.ring, slot.index)) <= this._spacing / 2) {
				taken.add(key(slot.ring, slot.index));
			}
			else {
				settled!.delete(other);
			}
		}
		for (let ring = 0; ring < Math.min(e.slot?.ring ?? RINGS, RINGS); ring++) {
			let best:{ index:number; gap:number } | undefined;
			for (let index = 0; index < ringOf(ring).count; index++) {
				const gap = taken.has(key(ring, index)) ? Infinity : distance(pointOf(ring, index), me);
				if (gap < (best?.gap ?? Infinity)) {
					best = { index, gap };
				}
			}
			if (best) {
				e.slot = { ring, index: best.index };
				break;
			}
		}
		return e.slot && { point: pointOf(e.slot.ring, e.slot.index), waiting: e.slot.ring > 0 };
	}

	/** At its crowd place: it stands there until the crowd moves it on. */
	private stand(e:Errand, character:unknown, place:Vec, now:number):undefined {
		e.bestAt = now;
		e.stuck = 0;
		this._world!.steerToward!(character, place);
		return undefined;
	}

	/** In reach: done, or for a sticky move, stand by until the target moves off. Its ring place stays its own while it stands there. */
	private arrive(id:string, e:Errand, character:unknown, now:number):ArcResult | undefined {
		if (!e.opts.sticky) {
			if (e.slot && 'target' in e.dest) {
				const settled = this._settled.get(e.dest.target) ?? new Map<string, { ring:number; index:number }>();
				this._settled.set(e.dest.target, settled.set(id, e.slot));
			}
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
	private plan(e:Errand, character:unknown, me:Vec, goal:RouteGoal, dest:Vec | undefined, toPlace:boolean):ArcResult | undefined {
		if (e.stuck >= STUCK_TRIES) {
			return { ok: false, verb: e.verb, reason: 'stuck' };
		}
		const route = findRoute(this._world as RouteWorld<unknown>, character, me, goal);
		e.plannedAt = this._now();
		e.plannedTo = dest;
		e.toPlace = toPlace;
		e.next = 0;
		e.route = undefined;
		if (!route || 'blockers' in route) {
			const why = route ? blockedReason(route) : '';
			const target = 'target' in e.dest ? e.dest.target : undefined;
			const reason = 'goal' in e.dest ? e.dest.noWay(why) : target !== undefined ? noWayTo(target, why) : why || 'no way there';
			const by = route ? route.blockers.flatMap((b) => (b.by ? [b.by] : [])) : [];
			return { ok: false, verb: e.verb, reason, unreachable: target, ...by.length > 0 ? { blockedBy: by } : {} };
		}
		e.route = route;
		return undefined;
	}
}
