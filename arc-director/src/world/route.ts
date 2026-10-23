import type { HostWorld, PathStep, Vec } from './types.js';
import { distance } from './vec.js';

/** The parts of a world a route search walks on. */
export type RouteWorld<TEntity> = Required<Pick<HostWorld<TEntity>, 'getNeighbors' | 'canPass'>>;

/** Whether `world` has what a route search walks on. */
export function hasRoutes<TEntity>(world:HostWorld<TEntity> | undefined):world is HostWorld<TEntity> & RouteWorld<TEntity> {
	return !!world?.getNeighbors && !!world.canPass;
}

/** Points to pass through after the start, and the total cost. */
export type Route = { points:Vec[]; cost:number };

/** No open way. Each blocked step that leads there, with the cost of the cheapest route through it, cheapest first. */
export type Blocked = { blockers:{ reason:string; cost:number; by?:string }[] };

/** Blocked ways named when there is no open way, cheapest first. */
export const BLOCKERS_TOLD = 3;

/** What a failed move says: `no way to Well`, plus what blocks the way when something does. */
export function noWayTo(target:string, why:string):string {
	return why ? `no way to ${target}, blocked on the way: ${why}` : `no way to ${target}`;
}

/** What stands in the way, as the agent is told: the cheapest few blockers. */
export function blockedReason(blocked:Blocked):string {
	return blocked.blockers.slice(0, BLOCKERS_TOLD).map((b) => b.reason).join('; ');
}

/** Points a search may settle along open ways, and again along blocked ones, before it gives up. */
export const SEARCH_CAP = 4096;

/** Key of the goal's own point, which need not be a neighbor the world names. */
const END = 'end';

/** `via` is the first blocked step on the way here; open ways have none and always come first. */
type Node = { point:Vec; cost:number; rank:number; prev?:Node; via?:string; end?:boolean };

function keyOf(point:Vec):string {
	return point.map((v) => Math.round(v * 1000)).join(',');
}

function before(a:Node, b:Node):boolean {
	const blockedA = a.via !== undefined;
	return blockedA === (b.via !== undefined) ? a.rank < b.rank : !blockedA;
}

/** Min-heap: open before blocked, then on `rank`. */
class Frontier {
	private readonly _size:Node[] = [];

	public get size():number {
		return this._size.length;
	}

	public push(node:Node):void {
		const h = this._size;
		h.push(node);
		let i = h.length - 1;
		while (i > 0) {
			const up = (i - 1) >> 1;
			if (!before(h[i], h[up])) {
				break;
			}
			[h[up], h[i]] = [h[i], h[up]];
			i = up;
		}
	}

	public pop():Node {
		const h = this._size;
		const top = h[0];
		const last = h.pop()!;
		if (h.length > 0) {
			h[0] = last;
			let i = 0;
			for (;;) {
				const l = i * 2 + 1;
				const r = l + 1;
				let min = i;
				if (l < h.length && before(h[l], h[min])) {
					min = l;
				}
				if (r < h.length && before(h[r], h[min])) {
					min = r;
				}
				if (min === i) {
					break;
				}
				[h[min], h[i]] = [h[i], h[min]];
				i = min;
			}
		}
		return top;
	}
}

function isOpen(step:PathStep | undefined):boolean {
	return !!step && !step.blocked;
}

function stepCost(from:Vec, to:Vec, step:PathStep):number {
	return Math.max(step.cost ?? 0, distance(from, to));
}

/** Each neighbor of `point` `what` can step to, and what that step is. */
function stepsFrom<TEntity>(world:RouteWorld<TEntity>, what:'light' | 'sound' | TEntity, point:Vec):[Vec, PathStep][] {
	return world.getNeighbors(point).flatMap((next):[Vec, PathStep][] => {
		const step = world.canPass(what, point, next);
		return step ? [[next, step]] : [];
	});
}

/**
 * `world` asking each of its parts once per question: for several searches over a world that cannot change between
 * them, such as one think's, which then share what the world said.
 */
export function memoWorld<TEntity>(world:RouteWorld<TEntity>):RouteWorld<TEntity> {
	const neighbors = new Map<string, Vec[]>();
	const passed = new Map<unknown, Map<string, PathStep | undefined>>();
	return {
		getNeighbors: (point) => {
			const key = keyOf(point);
			if (!neighbors.has(key)) {
				neighbors.set(key, world.getNeighbors(point));
			}
			return neighbors.get(key)!;
		},
		canPass: (what, a, b) => {
			const known = passed.get(what) ?? new Map<string, PathStep | undefined>();
			passed.set(what, known);
			const key = `${keyOf(a)}>${keyOf(b)}`;
			if (!known.has(key)) {
				known.set(key, world.canPass(what, a, b));
			}
			return known.get(key);
		},
	};
}

/** Where a search ends. */
export type RouteGoal = {
	/** True once `point` counts as arrived. */
	reached(point:Vec):boolean;
	/** Never more than the cost left from `point`, or the route found may not be the cheapest. */
	estimate(point:Vec):number;
	/** Extra cost, at least 0, of a step of cost `length` onto `point`. */
	toll?(point:Vec, length:number):number;
	/** A point the route may end on, though no neighbor names it, arriving through the steps into it. */
	at?:Vec;
};

/** Within `near` of `to`. */
export function pointGoal(to:Vec, near = 0):RouteGoal {
	return {
		at: to,
		reached: (point) => distance(point, to) <= near,
		// Never more than the cost left while step costs are at least their length.
		estimate: (point) => Math.max(0, distance(point, to) - near),
	};
}

/** A step's toll never passes this many times its length, however close to the threat it lands. */
const AWAY_TOLL_CAP = 10;

/**
 * At least `keep` from `threat`. A step costs `keep` over its distance from `threat` times its length on top, so
 * the cheapest way out keeps wide of them instead of running past. The estimate is how far is left to go, which a
 * step can close by no more than its length.
 */
export function awayGoal(threat:Vec, keep:number):RouteGoal {
	return {
		reached: (point) => distance(point, threat) >= keep,
		estimate: (point) => Math.max(0, keep - distance(point, threat)),
		toll: (point, length) => (length * keep) / Math.max(distance(point, threat), keep / AWAY_TOLL_CAP),
	};
}

/**
 * Cheapest open route for `what` from `from` to `goal`, over `world`'s neighbors and what `canPass` says of each step.
 * Neither end has to be a neighbor the world names: the route leaves through the steps out of `from` and, for a goal
 * with its own point, ends on it only through a step into it, so a sparse waypoint network works as well as a grid,
 * and a goal inside a wall is no place to walk to.
 *
 * One search: open ways settle first, so an open route comes back exactly as if blocked steps did not exist.
 * Without one, the search goes on through blocked steps, once per first blocker, and lists every blocker
 * that leads there. A blocked way that rejoins an open one is dropped: the blocker after it is the one to name.
 */
export function findRoute<TEntity>(
	world:RouteWorld<TEntity>,
	what:'light' | 'sound' | TEntity,
	from:Vec,
	goal:RouteGoal,
	cap = SEARCH_CAP,
):Route | Blocked | undefined {
	const at = goal.at;
	// The steps into the goal's own point, by where each leaves from: the only ways a route ends on it.
	const entries = new Map<string, PathStep>();
	// An open step either way: a goal no one stands on (a tree, a stall) is still reached from beside it.
	const beside = new Set<string>();
	for (const point of at ? world.getNeighbors(at) : []) {
		const into = world.canPass(what, point, at!);
		if (into) {
			entries.set(keyOf(point), into);
		}
		if (isOpen(into) || isOpen(world.canPass(what, at!, point))) {
			beside.add(keyOf(point));
		}
	}
	const stateOf = (key:string, via?:string):string => (via === undefined ? key : `${key}|${via}`);
	const best = new Map<string, number>([[keyOf(from), 0]]);
	const openlyReached = new Set<string>();
	const blockers = new Map<string, number>();
	/** What blocks, by its reason, where `canPass` said. */
	const blockedBy = new Map<string, string>();
	const open = new Frontier();
	const relax = (node:Node, point:Vec, step:PathStep, key:string, end?:boolean):void => {
		const via = node.via ?? step.blocked;
		if (step.blocked && step.by) {
			blockedBy.set(step.blocked, step.by);
		}
		const length = stepCost(node.point, point, step);
		const cost = node.cost + length + (goal.toll?.(point, length) ?? 0);
		const state = stateOf(key, via);
		if (cost < (best.get(state) ?? Infinity)) {
			best.set(state, cost);
			open.push({ point, cost, rank: cost + goal.estimate(point), prev: node, via, end });
		}
	};
	// Open and blocked ways each get `cap` points, so a wide open area cannot use up the search for a way in.
	let openLeft = cap;
	let blockedLeft = cap;
	open.push({ point: from, cost: 0, rank: goal.estimate(from) });
	while (open.size > 0 && blockedLeft > 0) {
		const node = open.pop();
		const key = node.end ? END : keyOf(node.point);
		if (node.cost > (best.get(stateOf(key, node.via)) ?? Infinity)) {
			continue;
		}
		if (node.via !== undefined && (blockers.has(node.via) || openlyReached.has(key))) {
			continue;
		}
		if ((node.via === undefined ? openLeft-- : blockedLeft--) <= 0) {
			continue;
		}
		if (arrived(node, key, goal, beside)) {
			if (node.via === undefined) {
				return routeTo(node);
			}
			blockers.set(node.via, node.cost);
			continue;
		}
		if (node.via === undefined) {
			openlyReached.add(key);
		}
		const entry = entries.get(key);
		if (entry) {
			relax(node, at!, entry, END, true);
		}
		for (const [point, step] of stepsFrom(world, what, node.point)) {
			relax(node, point, step, keyOf(point));
		}
	}
	return blockers.size > 0 ? { blockers: [...blockers].map(([reason, cost]) => ({ reason, cost, ...blockedBy.has(reason) ? { by: blockedBy.get(reason) } : {} })) } : undefined;
}

/**
 * In reach, and actually a step from the goal. Euclidean range through a wall is not a stop:
 * no open step joins here and `at`, so the search keeps going around.
 */
function arrived(node:Node, key:string, goal:RouteGoal, beside:Set<string>):boolean {
	if (node.end) {
		return true;
	}
	if (!goal.reached(node.point)) {
		return false;
	}
	if (!goal.at) {
		return true;
	}
	if (keyOf(goal.at) === key) {
		return true;
	}
	return beside.has(key);
}

function routeTo(end:Node):Route {
	const points:Vec[] = [];
	for (let node:Node | undefined = end; node?.prev; node = node.prev) {
		points.push(node.point);
	}
	points.reverse();
	return { points, cost: end.cost };
}

/** Points `what` reaches from `from` without a blocked step, cheapest first, up to `cap` of them. */
export function reachablePoints<TEntity>(world:RouteWorld<TEntity>, what:'light' | 'sound' | TEntity, from:Vec, cap:number):{ point:Vec; cost:number }[] {
	const best = new Map<string, number>([[keyOf(from), 0]]);
	const open = new Frontier();
	const out:{ point:Vec; cost:number }[] = [];
	open.push({ point: from, cost: 0, rank: 0 });
	while (open.size > 0 && out.length < cap) {
		const node = open.pop();
		if (node.cost > (best.get(keyOf(node.point)) ?? Infinity)) {
			continue;
		}
		out.push({ point: node.point, cost: node.cost });
		for (const [point, step] of stepsFrom(world, what, node.point)) {
			if (step.blocked) {
				continue;
			}
			const cost = node.cost + stepCost(node.point, point, step);
			const key = keyOf(point);
			if (cost < (best.get(key) ?? Infinity)) {
				best.set(key, cost);
				open.push({ point, cost, rank: cost });
			}
		}
	}
	return out;
}
