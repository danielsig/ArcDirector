import type { NamingText } from '../character/text-with-ids.js';
import type { CatalogInputs } from '../expr/natives.js';
import type { ExprEntity } from '../expr/expr-types.js';
import { blockedReason, findRoute, memoWorld, pointGoal } from './route.js';
import { rightOf } from './axes.js';
import { axesOf, edgeDistance, poseOf, reachTo } from './lookup.js';
import type { HostWorld, Pose, Vec } from './world-types.js';
import { cosToward, distance } from './vec.js';

type GeometryKernels = Pick<CatalogInputs, 'point' | 'distance' | 'facing' | 'side' | 'pathDistance'>;

/**
 * Watch geometry from the host's poses. `poses` overrides where some ids are (`me` standing somewhere
 * else to ask what if, a hive at its units' center). Path distances use `characterID`'s own way of moving.
 */
export function geometryKernels(
	world:HostWorld<unknown>,
	characterID:string | undefined,
	poses:ReadonlyMap<string, Pose> = new Map(),
):GeometryKernels {
	const whereIs = (who:ExprEntity):Pose | undefined => poses.get(who.id) ?? poseOf(world, who.id);
	const pair = (a:ExprEntity, b:ExprEntity):[Pose, Pose] | undefined => {
		const pa = whereIs(a);
		const pb = whereIs(b);
		return pa && pb ? [pa, pb] : undefined;
	};
	const character = characterID === undefined ? undefined : world.find(characterID);
	const routes = character !== undefined ? world.routes : undefined;
	const axes = axesOf(world);
	return {
		point: (who) => whereIs(who)?.point,
		distance: (a, b) => {
			const p = pair(a, b);
			return p && edgeDistance(p[0], p[1]);
		},
		facing: (a, b) => {
			const p = pair(a, b);
			return p?.[0].facing ? cosToward(p[0].facing, p[0].point, p[1].point) : 0;
		},
		side: (a, b) => {
			const p = pair(a, b);
			const right = p?.[0].facing && axes && rightOf(p[0].facing, axes, p[0].up);
			return right ? cosToward(right, p[0].point, p[1].point) : 0;
		},
		pathDistance: routes
			? (a, b) => {
				const p = pair(a, b);
				if (!p) {
					return undefined;
				}
				const target = world.find(b.id);
				const near = target === undefined ? 1 : reachTo(world, character, target);
				const route = findRoute(routes, character, p[0].point, pointGoal(p[1].point, near));
				return route && 'points' in route ? routeLength(p[0].point, route.points) : undefined;
			}
			: undefined,
	};
}

/**
 * Why there is no way for `characterID` into reach of each of `targetIDs`: the blockers on the way, or `''` when
 * nothing names one. Undefined where there is a way, or when the world has no routes to ask. One look at the world:
 * its searches share what it said.
 */
export function wayBlocked(world:HostWorld<unknown>, characterID:string, targetIDs:readonly string[]):(NamingText | undefined)[] {
	const character = world.find(characterID);
	const from = poseOf(world, characterID)?.point;
	const routes = world.routes && memoWorld(world.routes);
	return targetIDs.map((targetID) => {
		const target = world.find(targetID);
		const to = poseOf(world, targetID)?.point;
		if (!routes || character === undefined || target === undefined || !from || !to) {
			return undefined;
		}
		const route = findRoute(routes, character, from, pointGoal(to, reachTo(world, character, target)));
		if (!route) {
			return '';
		}
		return 'blockers' in route ? blockedReason(route) : undefined;
	});
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
