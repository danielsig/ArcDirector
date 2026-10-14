import type { PathGraph, PathStep, Vec } from './types.js';
import { distance } from './vec.js';

/** Points to pass through after the start, and the total cost. */
export type Route = { points:Vec[]; cost:number };

/** No open way. Each blocked step that leads there, with the cost of the cheapest route through it, cheapest first. */
export type Blocked = { blockers:{ reason:string; cost:number }[] };

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

/** Key of the goal's own point, which need not be a point of the graph. */
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

function stepCost(from:Vec, step:PathStep):number {
	return Math.max(step.cost ?? 0, distance(from, step.point));
}

/** Where a search ends. */
export type RouteGoal = {
	/** True once `point` counts as arrived. */
	reached(point:Vec):boolean;
	/** Never more than the cost left from `point`, or the route found may not be the cheapest. */
	estimate(point:Vec):number;
	/** Extra cost, at least 0, of a step of cost `length` onto `point`. */
	toll?(point:Vec, length:number):number;
	/** A point off the graph the route may end on, arriving through the steps into it. */
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
 * Cheapest open route from `from` to `goal`. Neither end has to be a point of the graph: the route leaves through
 * the steps out of `from` and, for a goal with its own point, ends on it only through a step into it, so a
 * sparse waypoint network works as well as a grid, and a goal inside a wall is no place to walk to.
 *
 * One search: open ways settle first, so an open route comes back exactly as if blocked steps did not exist.
 * Without one, the search goes on through blocked steps, once per first blocker, and lists every blocker
 * that leads there. A blocked way that rejoins an open one is dropped: the blocker after it is the one to name.
 */
export function findRoute(graph:PathGraph, from:Vec, goal:RouteGoal, cap = SEARCH_CAP):Route | Blocked | undefined {
	const entries = new Map(goal.at ? graph(goal.at, true).map((step) => [keyOf(step.point), step]) : []);
	// An open step either way: a goal no one stands on (a tree, a stall) is still reached from beside it.
	const beside = new Set(goal.at ? [...graph(goal.at), ...entries.values()].filter((step) => !step.blocked).map((step) => keyOf(step.point)) : []);
	const stateOf = (key:string, via?:string):string => (via === undefined ? key : `${key}|${via}`);
	const best = new Map<string, number>([[keyOf(from), 0]]);
	const openlyReached = new Set<string>();
	const blockers = new Map<string, number>();
	const open = new Frontier();
	const relax = (node:Node, point:Vec, step:PathStep, key:string, end?:boolean):void => {
		const via = node.via ?? step.blocked;
		const length = stepCost(end ? goal.at! : node.point, step);
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
			relax(node, goal.at!, entry, END, true);
		}
		for (const step of graph(node.point)) {
			relax(node, step.point, step, keyOf(step.point));
		}
	}
	return blockers.size > 0 ? { blockers: [...blockers].map(([reason, cost]) => ({ reason, cost })) } : undefined;
}

/**
 * In reach, and actually next to the goal on the graph. Euclidean range through a wall is not a stop:
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

/** Points reachable from `from` without a blocked step, cheapest first, up to `cap` of them. */
export function reachablePoints(graph:PathGraph, from:Vec, cap:number):{ point:Vec; cost:number }[] {
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
		for (const step of graph(node.point)) {
			if (step.blocked) {
				continue;
			}
			const cost = node.cost + stepCost(node.point, step);
			const key = keyOf(step.point);
			if (cost < (best.get(key) ?? Infinity)) {
				best.set(key, cost);
				open.push({ point: step.point, cost, rank: cost });
			}
		}
	}
	return out;
}
