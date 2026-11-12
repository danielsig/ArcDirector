import type { HostWorld, PathStep, Vec } from './world-types.js';
import { distance } from './vec.js';

/** The parts of a world a route search walks on. */
export type RouteWorld<TEntity, TPoint extends Vec = Vec> = Required<Pick<HostWorld<TEntity, TPoint>, 'getNeighbors'>>
	& Pick<HostWorld<TEntity, TPoint>, 'getNearby' | 'canTraverse'>;

/** Whether `world` has what a route search walks on. */
export function hasRoutes<TEntity, TPoint extends Vec>(world:HostWorld<TEntity, TPoint> | undefined):world is HostWorld<TEntity, TPoint> & RouteWorld<TEntity, TPoint> {
	return !!world?.getNeighbors;
}

/** The step `who` takes from `a` to `b`: its `canTraverse`, else open. */
function traverse<TEntity, TPoint extends Vec>(world:RouteWorld<TEntity, TPoint>, who:TEntity, a:TPoint, b:TPoint):PathStep | undefined {
	return world.canTraverse ? world.canTraverse(who, a, b) : {};
}

/** `point` as a node of `world` and the nodes it links to: its `getNearby`, else `point` itself, a plain `Vec` node. */
function nearby<TEntity, TPoint extends Vec>(world:RouteWorld<TEntity, TPoint>, point:Vec):{ at:TPoint; nearby:TPoint[] } {
	return world.getNearby ? world.getNearby(point) : { at: point as TPoint, nearby: world.getNeighbors(point as TPoint) };
}

/** Points to pass through after the start, and the total cost. */
export type Route<TPoint extends Vec = Vec> = { points:TPoint[]; cost:number };

/** No open way. Each blocked step that leads there, with the cost of the cheapest route through it, cheapest first. */
export type Blocked = { blockers:{ reason:string; cost:number; by?:string }[] };

/** Blocked ways named when there is no open way, cheapest first. */
const BLOCKERS_TOLD = 3;

/** What a failed move says: `no way to Well`, plus what blocks the way when something does. */
export function noWayTo(target:string, why:string):string {
	return why ? `no way to ${target}, blocked on the way: ${why}` : `no way to ${target}`;
}

/** What stands in the way, as the agent is told: the cheapest few blockers. */
export function blockedReason(blocked:Blocked):string {
	return blocked.blockers.slice(0, BLOCKERS_TOLD).map((b) => b.reason).join('; ');
}

/** Points a search may settle along open ways, and again along blocked ones, before it gives up. */
const SEARCH_CAP = 4096;

/** Key of the goal's own point, which need not be a neighbor the world names. */
const END = 'end';

/**
 * `key` says where it is (`END` on the goal's own point); `via` is the first blocked step on the way here, which open
 * ways lack and always come first; `nearby`, on the start only, is what it links to.
 */
type Node<TPoint> = { point:TPoint; key:string; cost:number; rank:number; prev?:Node<TPoint>; via?:string; nearby?:TPoint[] };

function keyOf(point:Vec):string {
	return point.map((v) => Math.round(v * 1000)).join(',');
}

function before<TPoint>(a:Node<TPoint>, b:Node<TPoint>):boolean {
	const blockedA = a.via !== undefined;
	return blockedA === (b.via !== undefined) ? a.rank < b.rank : !blockedA;
}

/** Min-heap: open before blocked, then on `rank`. */
class Frontier<TPoint> {
	private readonly _size:Node<TPoint>[] = [];

	public get size():number {
		return this._size.length;
	}

	public push(node:Node<TPoint>):void {
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

	public pop():Node<TPoint> {
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

/** Whether `canTraverse` let a step through: there is one, and nothing stops it for now. */
export function isOpen(step:PathStep | undefined):boolean {
	return !!step && !step.blocked;
}

/** Its length times its weight, never less than its length, so the search stays exact. */
function stepCost(from:Vec, to:Vec, step:PathStep):number {
	return distance(from, to) * Math.max(1, step.weight ?? 1);
}

/** Each node `who` can step to from `node`, and what that step is. */
function stepsFrom<TEntity, TPoint extends Vec>(world:RouteWorld<TEntity, TPoint>, who:TEntity, node:Node<TPoint>):[TPoint, PathStep][] {
	return (node.nearby ?? world.getNeighbors(node.point)).flatMap((next):[TPoint, PathStep][] => {
		const step = traverse(world, who, node.point, next);
		return step ? [[next, step]] : [];
	});
}

/** What `map` holds at `key`, made first when it holds nothing there. */
function remember<K, V>(map:Map<K, V>, key:K, make:()=>V):V {
	if (!map.has(key)) {
		map.set(key, make());
	}
	return map.get(key)!;
}

/**
 * `world` asking each of its parts once per question: for several searches over a world that cannot change between
 * them, such as one think's, which then share what the world said. It knows points by their coordinates: two points
 * at the same coordinates get the same answers.
 */
export function memoWorld<TEntity, TPoint extends Vec = Vec>(world:RouteWorld<TEntity, TPoint>):RouteWorld<TEntity, TPoint> {
	const near = new Map<string, { at:TPoint; nearby:TPoint[] }>();
	const neighbors = new Map<string, TPoint[]>();
	const steps = new Map<TEntity, Map<string, PathStep | undefined>>();
	return {
		getNearby: (point) => remember(near, keyOf(point), () => nearby(world, point)),
		getNeighbors: (node) => remember(neighbors, keyOf(node), () => world.getNeighbors(node)),
		canTraverse: (who, a, b) => remember(remember(steps, who, () => new Map()), `${keyOf(a)}>${keyOf(b)}`, () => traverse(world, who, a, b)),
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

/**
 * Near a group standing at `points` (at least one): within its spread of its median center, or `floor` for a tight group.
 * The spread is the root mean square of each one's distance from that center, one standard deviation of where they stand.
 */
export function groupGoal(points:readonly Vec[], floor:number):RouteGoal {
	const center = points[0].map((element, axis) => {
		const sorted = points.map((point) => point[axis]).sort((a, b) => a - b);
		const mid = sorted.length >> 1;
		return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
	});
	const spread = Math.sqrt(points.reduce((sum, point) => sum + distance(point, center) ** 2, 0) / points.length);
	return pointGoal(center, Math.max(spread, floor));
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
 * Cheapest open route for `who` from `from` to `goal`, over `world`'s neighbors and what `canTraverse` says of each step.
 * Neither end has to be a node the world names: the route starts on `from` as `getNearby` gives it and leaves through
 * what it links to, and, for a goal with its own point, ends on it only through a step into it from what that links
 * to, so a sparse waypoint network works as well as a grid, and a goal inside a wall is no place to walk to.
 *
 * One search: open ways settle first, so an open route comes back exactly as if blocked steps did not exist.
 * Without one, the search goes on through blocked steps, once per first blocker, and lists every blocker
 * that leads there. A blocked way that rejoins an open one is dropped: the blocker after it is the one to name.
 */
export function findRoute<TEntity, TPoint extends Vec = Vec>(
	world:RouteWorld<TEntity, TPoint>,
	who:TEntity,
	from:Vec,
	goal:RouteGoal,
	cap = SEARCH_CAP,
):Route<TPoint> | Blocked | undefined {
	const end = goal.at && nearby(world, goal.at);
	// The steps into the goal's own point, by where each leaves from: the only ways a route ends on it.
	const entries = new Map<string, PathStep>();
	// An open step either way: a goal no one stands on (a tree, a stall) is still reached from beside it.
	const beside = new Set<string>();
	for (const point of end?.nearby ?? []) {
		const into = traverse(world, who, point, end!.at);
		if (into) {
			entries.set(keyOf(point), into);
		}
		if (isOpen(into) || isOpen(traverse(world, who, end!.at, point))) {
			beside.add(keyOf(point));
		}
	}
	const stateOf = (key:string, via?:string):string => (via === undefined ? key : `${key}|${via}`);
	const start = startOf(world, from, goal.estimate(from));
	const best = new Map<string, number>([[start.key, 0]]);
	const openlyReached = new Set<string>();
	const blockers = new Map<string, number>();
	/** What blocks, by its reason, where `canTraverse` said. */
	const blockedBy = new Map<string, string>();
	const open = new Frontier<TPoint>();
	const relax = (node:Node<TPoint>, point:TPoint, step:PathStep, key:string):void => {
		const via = node.via ?? step.blocked;
		if (step.blocked && step.by) {
			blockedBy.set(step.blocked, step.by);
		}
		const length = stepCost(node.point, point, step);
		const cost = node.cost + length + (goal.toll?.(point, length) ?? 0);
		const state = stateOf(key, via);
		if (cost < (best.get(state) ?? Infinity)) {
			best.set(state, cost);
			open.push({ point, key, cost, rank: cost + goal.estimate(point), prev: node, via });
		}
	};
	// Open and blocked ways each get `cap` points, so a wide open area cannot use up the search for a way in.
	let openLeft = cap;
	let blockedLeft = cap;
	open.push(start);
	while (open.size > 0 && blockedLeft > 0) {
		const node = open.pop();
		const { key } = node;
		if (node.cost > (best.get(stateOf(key, node.via)) ?? Infinity)) {
			continue;
		}
		if (node.via !== undefined && (blockers.has(node.via) || openlyReached.has(key))) {
			continue;
		}
		if ((node.via === undefined ? openLeft-- : blockedLeft--) <= 0) {
			continue;
		}
		if (arrived(node, goal, beside)) {
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
			relax(node, end!.at, entry, END);
		}
		for (const [point, step] of stepsFrom(world, who, node)) {
			relax(node, point, step, keyOf(point));
		}
	}
	return blockers.size > 0 ? { blockers: [...blockers].map(([reason, cost]) => ({ reason, cost, ...blockedBy.has(reason) ? { by: blockedBy.get(reason) } : {} })) } : undefined;
}

/**
 * In reach, and actually a step from the goal. Euclidean range through a wall is not a stop:
 * no open step joins here and `at`, so the search keeps going around.
 */
function arrived(node:Node<Vec>, goal:RouteGoal, beside:Set<string>):boolean {
	if (node.key === END) {
		return true;
	}
	if (!goal.reached(node.point)) {
		return false;
	}
	if (!goal.at) {
		return true;
	}
	return keyOf(goal.at) === node.key || beside.has(node.key);
}

function routeTo<TPoint extends Vec>(end:Node<TPoint>):Route<TPoint> {
	const points:TPoint[] = [];
	for (let node:Node<TPoint> | undefined = end; node?.prev; node = node.prev) {
		points.push(node.point);
	}
	points.reverse();
	return { points, cost: end.cost };
}

/** Where a search starts: `from` as a node of `world`, leaving through what it links to. */
function startOf<TEntity, TPoint extends Vec>(world:RouteWorld<TEntity, TPoint>, from:Vec, rank:number):Node<TPoint> {
	const { at, nearby: links } = nearby(world, from);
	return { point: at, key: keyOf(at), cost: 0, rank, nearby: links };
}

/** Points `who` reaches from `from` without a blocked step, cheapest first, up to `cap` of them. */
export function reachablePoints<TEntity, TPoint extends Vec = Vec>(world:RouteWorld<TEntity, TPoint>, who:TEntity, from:Vec, cap:number):{ point:TPoint; cost:number }[] {
	const start = startOf(world, from, 0);
	const best = new Map<string, number>([[start.key, 0]]);
	const open = new Frontier<TPoint>();
	const out:{ point:TPoint; cost:number }[] = [];
	open.push(start);
	while (open.size > 0 && out.length < cap) {
		const node = open.pop();
		if (node.cost > (best.get(node.key) ?? Infinity)) {
			continue;
		}
		out.push({ point: node.point, cost: node.cost });
		for (const [point, step] of stepsFrom(world, who, node)) {
			if (step.blocked) {
				continue;
			}
			const cost = node.cost + stepCost(node.point, point, step);
			const key = keyOf(point);
			if (cost < (best.get(key) ?? Infinity)) {
				best.set(key, cost);
				open.push({ point, key, cost, rank: cost });
			}
		}
	}
	return out;
}
