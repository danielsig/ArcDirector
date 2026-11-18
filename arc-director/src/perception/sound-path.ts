import { Heap } from '../world/Heap.js';
import type { Axes } from '../world/axes.js';
import { axesOf, castOf } from '../world/lookup.js';
import { createAt } from '../world/route.js';
import { add, cross, distance, dot, perpendiculars, sub, unit } from '../world/vec.js';
import type { HostWorld, Medium, Vec } from '../world/world-types.js';
import { AUDIBLE } from './hearing.js';

/** How sound finds its way round things: `withHearing`'s numbers for it. */
export type SoundWays = {
	/** Most bends on the way: 0 the straight line only, 1 one corner or bounce, 2 one more. Default 2. */
	reflections:number;
	/** What a bounce off a surface leaves of a sound turning right back; a smaller turn loses less. Default 0.5. */
	reflection:number;
	/** What bending round an edge (a corner, a wall's top, a crest) leaves of it turning right back. Default 0.2. */
	diffraction:number;
	/**
	 * Rays cast from the source, up to 45° either side of the way to the listener, to seed the search where the
	 * world's nodes do not reach (`castRay` only): how many, and in 3D over a `cone` or across the ground `plane`
	 * (default {@link raySpread}).
	 */
	rays:{ count:number; spread?:'cone' | 'plane' };
};

export const DEFAULT_SOUND_WAYS:Readonly<SoundWays> = { reflections: 2, reflection: 0.5, diffraction: 0.2, rays: { count: 8 } };

/** How `rays` spread in a world with `axes`: as they say, else across the `plane` where the axes have no up (2D), else over a `cone`. */
export function raySpread(rays:SoundWays['rays'], axes:Axes | undefined):'cone' | 'plane' {
	return rays.spread ?? (axes?.up ? 'cone' : 'plane');
}

/** The clearest way a sound reaches a listener: how loud there, how much of it came through things, how far it went, and the last bend it came round. */
export type SoundPath = { level:number; through:number; length:number; from?:Vec };

/** Nodes a search may expand, at most, before it gives up. */
const SEARCH_CAP = 4096;
/** How far short of what a ray hits its seed lies. */
const SHORT = 0.05;

type Bend = 'reflection' | 'diffraction';
/** Where the path last bent (or the source), reached straight from the bend before it. */
type Anchor = { point:Vec; cost:number; from?:Anchor; kind?:Bend; factor:number; through:number; bends:number };
type NodeEntry<TPoint> = { point:Vec; node:TPoint; anchor:Anchor; parent?:NodeEntry<TPoint>; priority:number; key:string };
type Entry<TPoint> = NodeEntry<TPoint> | { ray:Vec; priority:number };

/** What a bend leaves: 1 going straight on, `falloff` turning right back. */
function bendFactor(from:Vec, at:Vec, to:Vec, falloff:number):number {
	const turn = (1 - dot(unit(sub(at, from)) ?? [], unit(sub(to, at)) ?? [])) / 2;
	return 1 + (falloff - 1) * turn;
}

/** The fan's directions from `axis`, nearest it first, each with its angle off it. */
function fan(axis:Vec, spread:number, count:number, shape:'cone' | 'plane', up:Vec | undefined):{ dir:Vec; angle:number }[] {
	if (axis.length < 2 || spread <= 0 || count < 1) {
		return [];
	}
	const ahead = (angle:number):Vec => axis.map((a) => a * Math.cos(angle));
	if (axis.length === 3 && shape === 'cone') {
		// A golden spiral over the cap, nearer the axis first.
		const [u, v] = perpendiculars(axis);
		return Array.from({ length: count }, (element, i) => {
			const angle = spread * Math.sqrt((i + 0.5) / count);
			const turn = i * Math.PI * (3 - Math.sqrt(5));
			return { dir: add(add(ahead(angle), u, Math.sin(angle) * Math.cos(turn)), v, Math.sin(angle) * Math.sin(turn)), angle };
		});
	}
	const side = axis.length === 2 ? [-axis[1], axis[0]] : (up && unit(cross(axis, up))) ?? perpendiculars(axis)[0];
	return Array.from({ length: count }, (element, i) => (count === 1 ? 0 : -spread + (2 * spread * i) / (count - 1)))
		.sort((a, b) => Math.abs(a) - Math.abs(b))
		.map((angle) => ({ dir: add(ahead(angle), side, Math.sin(angle)), angle: Math.abs(angle) }));
}

/**
 * The clearest way `world` carries a sound from `source` to `listener` by `what`, heard at `levelAt(length)` before
 * walls and bends: the straight line dimmed by what it passes through, or a way round things, bent at most
 * `reflections` times, found by one `A*` that ranks by clarity, seeded by the source's nearby nodes and, with
 * `castRay`, a fan of rays. Every check is one raycast. Nothing when no way reaches `floor` ({@link AUDIBLE}; a wake
 * check asks for loud, and searches far less).
 */
export function soundPath<TPoint extends Vec>(
	world:HostWorld<unknown, TPoint>,
	what:Medium,
	source:Vec,
	listener:Vec,
	levelAt:(length:number)=>number,
	ways:SoundWays = DEFAULT_SOUND_WAYS,
	floor = AUDIBLE,
):SoundPath | undefined {
	const cast = (a:Vec, b:Vec):{ clarity:number; hit?:number } => castOf(world, what, a, b);
	const straight = distance(source, listener);
	// A sound under the floor at the straight distance is under it every way: no raycast.
	if (levelAt(straight) < floor) {
		return undefined;
	}
	const direct = cast(source, listener);
	let best:SoundPath | undefined = levelAt(straight) * direct.clarity >= floor
		? { level: levelAt(straight) * direct.clarity, through: direct.clarity, length: straight }
		: undefined;
	// Nothing beats a clear straight line.
	if (direct.clarity >= 1 || ways.reflections < 1) {
		return best;
	}
	const routes = world.routes;
	const around = (point:Vec):TPoint[] => (routes ? routes.getNeighbors(createAt(routes, point)) : []);
	const softest = Math.max(ways.reflection, ways.diffraction);
	/** What turning at `a` toward `next` leaves. */
	const close = (a:Anchor, next:Vec):number => (a.kind && a.from ? bendFactor(a.from.point, a.point, next, ways[a.kind]) : 1);
	/** The least a path on from `at`, coming from `from`, loses turning toward the listener over `bends` bends. */
	const turnLeft = (from:Vec, at:Vec, bends:number):number => {
		const angle = Math.acos(Math.max(-1, Math.min(1, dot(unit(sub(at, from)) ?? [], unit(sub(listener, at)) ?? []))));
		return angle < 1e-6 ? 1 : bends <= 0 ? 0 : (1 - (1 - softest) * (1 - Math.cos(angle / bends)) / 2) ** bends;
	};
	/** The most a path through `point`, straight from `anchor`, could still be heard at: exact, as factors to come are at most 1. */
	const bound = (point:Vec, anchor:Anchor):number => levelAt(anchor.cost + distance(anchor.point, point) + distance(point, listener))
		* anchor.factor * close(anchor, point) * turnLeft(anchor.point, point, ways.reflections - anchor.bends);
	const heard = (level:number, through:number, length:number, from:Vec):void => {
		if (level >= floor && level > (best?.level ?? 0)) {
			best = { level, through, length, from };
		}
	};
	const queue = new Heap<Entry<TPoint>>((a, b) => a.priority > b.priority);
	/** The best bound each node was expanded at, by node and bends: closed only on expansion, so a hopeful entry through a wall hides no true way round. */
	const closed = new Map<string, number>();
	const push = (node:TPoint, anchor:Anchor, parent?:NodeEntry<TPoint>):void => {
		const key = `${node.join(',')}/${anchor.bends}`;
		const priority = bound(node, anchor);
		if (priority > (closed.get(key) ?? 0)) {
			queue.push({ point: node, node, anchor, parent, priority, key });
		}
	};
	const start:Anchor = { point: source, cost: 0, factor: 1, through: 1, bends: 0 };
	/** A bend at `seed`, reached straight from the source: heard from there, and searched on from its nearby nodes. */
	const seedAt = (seed:Vec, kind:Bend):void => {
		const anchor:Anchor = { point: seed, cost: distance(source, seed), from: start, kind, factor: 1, through: 1, bends: 1 };
		const exit = cast(seed, listener);
		const length = anchor.cost + distance(seed, listener);
		heard(levelAt(length) * exit.clarity * bendFactor(source, seed, listener, ways[kind]), exit.clarity, length, seed);
		around(seed).forEach((node) => push(node, anchor));
	};
	// Rays need what a cast hits, and reach only as wide as an audible way through their nearest point to the listener.
	if (world.geometry?.castRay) {
		const axes = axesOf(world);
		let spread = Math.PI / 4;
		while (spread > 0 && levelAt(straight * (Math.cos(spread) + Math.sin(spread))) < floor) {
			spread -= Math.PI / 90;
		}
		for (const { dir, angle } of fan(unit(sub(listener, source))!, spread, ways.rays.count, raySpread(ways.rays, axes), axes?.up)) {
			queue.push({ ray: dir, priority: levelAt(straight * (Math.cos(angle) + Math.sin(angle))) * (angle > 0 ? (1 + softest) / 2 : 1) });
		}
	}
	around(source).forEach((node) => push(node, start));
	for (let expanded = 0; queue.size > 0 && expanded < SEARCH_CAP;) {
		const entry = queue.pop();
		if (entry.priority <= (best?.level ?? 0) || entry.priority < floor) {
			break;
		}
		if ('ray' in entry) {
			const end = add(source, entry.ray, straight);
			const { hit } = cast(source, end);
			seedAt(hit === undefined ? add(source, entry.ray, dot(sub(listener, source), entry.ray)) : add(source, entry.ray, Math.max(0, hit - SHORT)), hit === undefined ? 'diffraction' : 'reflection');
			continue;
		}
		if (entry.priority <= (closed.get(entry.key) ?? 0)) {
			continue;
		}
		expanded++;
		let anchor = entry.anchor;
		// Straight from the last bend; else bent at the step before, which needs a bend to spare and a way through.
		if (cast(anchor.point, entry.point).clarity < 1) {
			const parent = entry.parent;
			const step = parent && anchor.bends < ways.reflections ? cast(parent.point, entry.point) : { clarity: 0 };
			if (!parent || step.clarity <= 0) {
				continue;
			}
			const before = parent.anchor;
			anchor = {
				point: parent.point,
				cost: before.cost + distance(before.point, parent.point),
				from: before,
				kind: 'diffraction',
				factor: before.factor * close(before, parent.point) * step.clarity,
				through: before.through * step.clarity,
				bends: before.bends + 1,
			};
		}
		closed.set(entry.key, Math.max(closed.get(entry.key) ?? 0, anchor === entry.anchor ? entry.priority : bound(entry.point, anchor)));
		const exit = anchor.bends < ways.reflections ? cast(entry.point, listener) : { clarity: 0 };
		if (exit.clarity > 0) {
			const length = anchor.cost + distance(anchor.point, entry.point) + distance(entry.point, listener);
			const level = levelAt(length) * anchor.factor * close(anchor, entry.point) * exit.clarity * bendFactor(anchor.point, entry.point, listener, ways.diffraction);
			heard(level, anchor.through * exit.clarity, length, entry.point);
			// A clear way out that is the best so far ends it.
			if (exit.clarity >= 1 && best?.level === level) {
				break;
			}
		}
		const here:NodeEntry<TPoint> = { ...entry, anchor };
		routes?.getNeighbors(entry.node).forEach((node) => push(node, anchor, here));
	}
	return best;
}
