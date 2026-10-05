import type { PathStep, Vec } from './types.js';
import { distance } from './vec.js';

/** Points to pass through after the start, and the total cost. */
export type Route = { points:Vec[]; cost:number };

/** No open way. Each blocked step that leads there, with the cost of the cheapest route through it, cheapest first. */
export type Blocked = { blockers:{ reason:string; cost:number }[] };

/** Points a search may settle along open ways, and again along blocked ones, before it gives up. */
export const SEARCH_CAP = 4096;

/** Key of the destination itself, which need not be a point of the graph. */
const GOAL = 'goal';

/** `via` is the first blocked step on the way here; open ways have none and always come first. */
type Node = { point:Vec; cost:number; rank:number; prev?:Node; via?:string; goal?:boolean };

function keyOf(point:Vec):string {
	return point.map((v) => Math.round(v * 1000)).join(',');
}

function before(a:Node, b:Node):boolean {
	const blockedA = a.via !== undefined;
	return blockedA === (b.via !== undefined) ? a.rank < b.rank : !blockedA;
}

/** Min-heap: open before blocked, then on `rank`. */
class Frontier {
	private readonly heap:Node[] = [];

	get size():number {
		return this.heap.length;
	}

	push(node:Node):void {
		const h = this.heap;
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

	pop():Node {
		const h = this.heap;
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

/**
 * Cheapest open route from `from` to within `near` of `to`. Neither end has to be a point of the graph: the
 * route leaves through the steps out of `from` and arrives through the steps out of `to`, taken backwards,
 * so a sparse waypoint network works as well as a grid.
 *
 * One search: open ways settle first, so an open route comes back exactly as if blocked steps did not exist.
 * Without one, the search goes on through blocked steps, once per first blocker, and lists every blocker
 * that leads there. A blocked way that rejoins an open one is dropped: the blocker after it is the one to name.
 */
export function findRoute(graph:(point:Vec)=>PathStep[], from:Vec, to:Vec, near = 0, cap = SEARCH_CAP):Route | Blocked | undefined {
	const exits = new Map(graph(to).map((step) => [keyOf(step.point), step]));
	// Never more than the cost left while step costs are at least their length.
	const estimate = (point:Vec):number => Math.max(0, distance(point, to) - near);
	const stateOf = (key:string, via?:string):string => (via === undefined ? key : `${key}|${via}`);
	const best = new Map<string, number>([[keyOf(from), 0]]);
	const openlyReached = new Set<string>();
	const blockers = new Map<string, number>();
	const open = new Frontier();
	const relax = (node:Node, point:Vec, step:PathStep, key:string, goal?:boolean):void => {
		const via = node.via ?? step.blocked;
		const cost = node.cost + stepCost(goal ? to : node.point, step);
		const state = stateOf(key, via);
		if (cost < (best.get(state) ?? Infinity)) {
			best.set(state, cost);
			open.push({ point, cost, rank: cost + estimate(point), prev: node, via, goal });
		}
	};
	// Open and blocked ways each get `cap` points, so a wide open area cannot use up the search for a way in.
	let openLeft = cap;
	let blockedLeft = cap;
	open.push({ point: from, cost: 0, rank: estimate(from) });
	while (open.size > 0 && blockedLeft > 0) {
		const node = open.pop();
		const key = node.goal ? GOAL : keyOf(node.point);
		if (node.cost > (best.get(stateOf(key, node.via)) ?? Infinity)) {
			continue;
		}
		if (node.via !== undefined && (blockers.has(node.via) || openlyReached.has(key))) {
			continue;
		}
		if ((node.via === undefined ? openLeft-- : blockedLeft--) <= 0) {
			continue;
		}
		if (node.goal || distance(node.point, to) <= near) {
			if (node.via === undefined) {
				return routeTo(node);
			}
			blockers.set(node.via, node.cost);
			continue;
		}
		if (node.via === undefined) {
			openlyReached.add(key);
		}
		const exit = exits.get(key);
		if (exit) {
			relax(node, to, exit, GOAL, true);
		}
		for (const step of graph(node.point)) {
			relax(node, step.point, step, keyOf(step.point));
		}
	}
	return blockers.size > 0 ? { blockers: [...blockers].map(([reason, cost]) => ({ reason, cost })) } : undefined;
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
export function reachablePoints(graph:(point:Vec)=>PathStep[], from:Vec, cap:number):{ point:Vec; cost:number }[] {
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
