import type { HostKernels } from '../expr/natives.js';
import type { ExprEntity } from '../expr/types.js';
import { findRoute } from './route.js';
import { poseOf } from './lookup.js';
import type { HostWorld, Pose, Vec } from './types.js';
import { cosToward, distance } from './vec.js';

export type GeometryKernels = Pick<HostKernels, 'point' | 'distance' | 'facing' | 'side' | 'pathDistance'>;

/**
 * Watch geometry from the host's poses. `poses` overrides where some ids are (`me` standing somewhere
 * else to ask what if, a hive at its units' center). Path distances use `actorID`'s own way of moving.
 */
export function geometryKernels(
	world:HostWorld<unknown>,
	actorID:string | undefined,
	poses:ReadonlyMap<string, Pose> = new Map(),
):GeometryKernels {
	const whereIs = (who:ExprEntity):Pose | undefined => poses.get(who.id) ?? poseOf(world, who.id);
	const pair = (a:ExprEntity, b:ExprEntity):[Pose, Pose] | undefined => {
		const pa = whereIs(a);
		const pb = whereIs(b);
		return pa && pb ? [pa, pb] : undefined;
	};
	const actor = actorID === undefined ? undefined : world.find(actorID);
	const graph = world.getPathGraph && actor !== undefined ? world.getPathGraph.bind(world, actor) : undefined;
	return {
		point: (who) => whereIs(who)?.point,
		distance: (a, b) => {
			const p = pair(a, b);
			return p ? distance(p[0].point, p[1].point) : undefined;
		},
		facing: (a, b) => {
			const p = pair(a, b);
			return p?.[0].facing ? cosToward(p[0].facing, p[0].point, p[1].point) : 0;
		},
		side: (a, b) => {
			const p = pair(a, b);
			return p?.[0].right ? cosToward(p[0].right, p[0].point, p[1].point) : 0;
		},
		pathDistance: graph
			? (a, b) => {
				const p = pair(a, b);
				if (!p) {
					return undefined;
				}
				const target = world.find(b.id);
				const near = target === undefined ? 1 : world.getReach?.(actor, target) ?? 1;
				const route = findRoute(graph(), p[0].point, p[1].point, near);
				return route && 'points' in route ? routeLength(p[0].point, route.points) : undefined;
			}
			: undefined,
	};
}

function routeLength(from:Vec, points:Vec[]):number {
	let sum = 0;
	let prev = from;
	for (const p of points) {
		sum += distance(prev, p);
		prev = p;
	}
	return sum;
}
