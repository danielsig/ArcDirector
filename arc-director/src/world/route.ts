import { showNamingText, type NamingText } from '../character/text-with-ids.js';
import type { Passage, Vec, WorldRoutes } from './world-types.js';
import { Heap } from './Heap.js';
import { distance, dot, sub, unit } from './vec.js';

/** The half of a world's routes a route search walks on. */
export type RouteWorld<TEntity, TPoint extends Vec = Vec> = Pick<WorldRoutes<TEntity, TPoint>, 'createAt' | 'getNeighbors' | 'getPassage'>;

/** The passage `who` has from `a` to `b`: its `getPassage`, else open. */
function passage<TEntity, TPoint extends Vec>(world:RouteWorld<TEntity, TPoint>, who:TEntity, a:TPoint, b:TPoint):Passage | undefined {
	return world.getPassage ? world.getPassage(who, a, b) : {};
}

/** A new point of `world` at `pos`: its `createAt`, else `pos` itself, a plain `Vec` point. */
export function createAt<TEntity, TPoint extends Vec>(world:RouteWorld<TEntity, TPoint>, pos:Vec):TPoint {
	return world.createAt ? world.createAt(pos) : pos as TPoint;
}

/** Points to pass through after the start, and the total cost. */
export interface Route<TPoint extends Vec = Vec> {
	points:TPoint[];
	cost:number;
}

/**
 * No open way. Each blocked step that leads there, with the cost of the cheapest route through it, cheapest first
 * (none when nothing that can be cleared stands in the way), and the open route to where the goal is nearest.
 */
export interface Blocked {
	blockers:{ reason:NamingText; cost:number; by?:string }[];
	nearest:Route;
}

/** Blocked ways named when there is no open way, cheapest first. */
const BLOCKERS_TOLD = 3;

/** What a failed move says: `no way to Well`, plus what blocks the way when something does. */
export function noWayTo(target:NamingText, why:NamingText):NamingText {
	return (name) => {
		const [to, blocked] = [showNamingText(target, name), showNamingText(why, name)];
		return blocked ? `no way to ${to}, blocked on the way: ${blocked}` : `no way to ${to}`;
	};
}

/** What stands in the way, as the agent is told: the cheapest few blockers, each read only when it is shown. */
export function blockedReason(blocked:Blocked):NamingText {
	return (name) => blocked.blockers.slice(0, BLOCKERS_TOLD).map((b) => showNamingText(b.reason, name)).join('; ');
}

/** Points a search may settle along open ways, and again along blocked ones, before it gives up. */
const SEARCH_CAP = 4096;

/** Key of the goal's own point, which need not be a neighbor the world names. */
const END = 'end';

/**
 * `key` says where it is (`END` on the goal's own point); `via` is the first blocked step on the way here, by the
 * number of its blocker, which open ways lack and always come first.
 */
type Node<TPoint> = { point:TPoint; key:string; cost:number; rank:number; prev?:Node<TPoint>; via?:number };

function keyOf(point:Vec):string {
	return point.map((v) => Math.round(v * 1000)).join(',');
}

/** Open before blocked, then on `rank`: the order a route search settles its points in. */
function before<TPoint>(a:Node<TPoint>, b:Node<TPoint>):boolean {
	const blockedA = a.via !== undefined;
	return blockedA === (b.via !== undefined) ? a.rank < b.rank : !blockedA;
}

/** Whether `getPassage` let a step through: there is one, and nothing stops it for now. */
export function isOpen(passage:Passage | undefined):boolean {
	return !!passage && !passage.blocked;
}

/** Its length times its weight, never less than its length, so the search stays exact. */
function passageCost(from:Vec, to:Vec, passage:Passage):number {
	return distance(from, to) * Math.max(1, passage.weight ?? 1);
}

/** Each node `who` can step to from `node`, and its passage there. */
function passagesFrom<TEntity, TPoint extends Vec>(world:RouteWorld<TEntity, TPoint>, who:TEntity, node:Node<TPoint>):[TPoint, Passage][] {
	return world.getNeighbors(node.point).flatMap((next):[TPoint, Passage][] => {
		const there = passage(world, who, node.point, next);
		return there ? [[next, there]] : [];
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
	const points = new Map<string, TPoint>();
	const neighbors = new Map<string, TPoint[]>();
	const passages = new Map<TEntity, Map<string, Passage | undefined>>();
	return {
		createAt: (pos) => remember(points, keyOf(pos), () => createAt(world, pos)),
		getNeighbors: (node) => remember(neighbors, keyOf(node), () => world.getNeighbors(node)),
		getPassage: (who, a, b) => remember(remember(passages, who, () => new Map()), `${keyOf(a)}>${keyOf(b)}`, () => passage(world, who, a, b)),
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
 * Cheapest open route for `who` from `from` to `goal`, over `world`'s neighbors and what `getPassage` says of each step.
 * Neither end has to be a point the world names: the route starts on the point `createAt` makes at `from` and leaves
 * through its `getNeighbors`, and, for a goal with its own point, ends on the one `createAt` makes there only through a
 * step into it from its `getNeighbors`, so a sparse waypoint network works as well as a grid, and a goal inside a wall
 * is no place to walk to.
 *
 * One search: open ways settle first, so an open route comes back exactly as if blocked steps did not exist.
 * Without one, the search goes on through blocked steps, once per first blocker, and lists every blocker
 * that leads there. A blocked way that rejoins an open one is dropped: the blocker after it is the one to name.
 * It then also gives the open route to where the goal is nearest (`goal.estimate`).
 */
export function findRoute<TEntity, TPoint extends Vec = Vec>(
	world:RouteWorld<TEntity, TPoint>,
	who:TEntity,
	from:Vec,
	goal:RouteGoal,
	cap = SEARCH_CAP,
):Route<TPoint> | Blocked {
	const end = goal.at && createAt(world, goal.at);
	// The steps into the goal's own point, by where each leaves from: the only ways a route ends on it.
	const entries = new Map<string, Passage>();
	// An open step either way: a goal no one stands on (a tree, a stall) is still reached from beside it.
	const beside = new Set<string>();
	for (const point of end ? world.getNeighbors(end) : []) {
		const into = passage(world, who, point, end!);
		if (into) {
			entries.set(keyOf(point), into);
		}
		if (isOpen(into) || isOpen(passage(world, who, end!, point))) {
			beside.add(keyOf(point));
		}
	}
	const stateOf = (key:string, via?:number):string => (via === undefined ? key : `${key}|${via}`);
	const here = createAt(world, from);
	const start:Node<TPoint> = { point: here, key: keyOf(here), cost: 0, rank: goal.estimate(from) };
	const best = new Map<string, number>([[start.key, 0]]);
	const openlyReached = new Set<string>();
	let nearest = start;
	let nearestLeft = goal.estimate(here);
	/** The cheapest cost to the goal through each blocker that leads there, by its number. */
	const blockers = new Map<number, number>();
	/** Each blocker met, numbered by its `blocked` (a function by identity), with what blocks where `getPassage` said. */
	const numbers = new Map<NamingText, number>();
	const met:{ reason:NamingText; by?:string }[] = [];
	const open = new Heap<Node<TPoint>>(before);
	const relax = (node:Node<TPoint>, point:TPoint, passage:Passage, key:string):void => {
		const blocker = passage.blocked ? remember(numbers, passage.blocked, () => met.push({ reason: passage.blocked! }) - 1) : undefined;
		const via = node.via ?? blocker;
		if (blocker !== undefined && passage.by) {
			met[blocker].by = passage.by;
		}
		const length = passageCost(node.point, point, passage);
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
			const left = goal.estimate(node.point);
			if (left < nearestLeft) {
				[nearest, nearestLeft] = [node, left];
			}
		}
		const entry = entries.get(key);
		if (entry) {
			relax(node, end!, entry, END);
		}
		for (const [point, passage] of passagesFrom(world, who, node)) {
			relax(node, point, passage, keyOf(point));
		}
	}
	return { blockers: [...blockers].map(([blocker, cost]) => ({ ...met[blocker], cost })), nearest: routeTo(nearest) };
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

/** A node a scout passed: how far it had gone there, and the share of its steps out that are open (1: no wall at hand). */
export type Scouted<TPoint extends Vec = Vec> = { point:TPoint; gone:number; openness:number };

/**
 * A scout for `who` from `from`, sent out on as many headings as asked: the nodes it passes heading `way` (a unit
 * vector) over open steps, for up to `length`. Each step gains ground along `way`, onto the open neighbor that keeps
 * closest to the line out; it ends where that strays more than 45° off it, so a wall across the way ends it.
 */
export function scout<TEntity, TPoint extends Vec>(world:RouteWorld<TEntity, TPoint>, who:TEntity, from:Vec):(way:Vec, length:number)=>Scouted<TPoint>[] {
	const start = createAt(world, from);
	const openFrom = (here:TPoint, points:TPoint[]):TPoint[] => points.filter((point) => isOpen(passage(world, who, here, point)));
	const first = openFrom(start, world.getNeighbors(start));
	return (way, length) => {
		const out = (point:Vec):number => dot(unit(sub(point, start)) ?? way, way);
		const passed:Scouted<TPoint>[] = [];
		let [here, ways] = [start, first];
		// Every step gains ground along `way`, so it never comes back to a node.
		for (let gone = 0; gone < length;) {
			// No farther than 45° off the line out (a cosine of 0.7).
			let [next, along] = [undefined as TPoint | undefined, 0.7];
			for (const point of ways) {
				const line = dot(sub(point, here), way) > 0 ? out(point) : -1;
				[next, along] = line > along ? [point, line] : [next, along];
			}
			if (!next) {
				break;
			}
			const neighbors = world.getNeighbors(next);
			ways = openFrom(next, neighbors);
			gone += distance(here, next);
			here = next;
			passed.push({ point: next, gone, openness: ways.length / Math.max(1, neighbors.length) });
		}
		return passed;
	};
}
