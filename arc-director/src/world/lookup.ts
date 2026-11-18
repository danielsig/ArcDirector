import { checkAxes, type Axes } from './axes.js';
import { distance } from './vec.js';
import { Medium, type HostWorld, type Pose, type Vec } from './world-types.js';

/** Where the thing `id` names is now, if the world has it and its geometry. */
export function poseOf(world:HostWorld<unknown>, id:string):Pose | undefined {
	const entity = world.geometry && world.find(id);
	return entity === undefined ? undefined : world.geometry!.getPose(entity);
}

/** The world's axes, checked ({@link checkAxes}); none without geometry. */
export function axesOf(world:HostWorld<unknown> | undefined):Axes | undefined {
	return world?.geometry && checkAxes(world.geometry.axes);
}

/** How far apart `a` and `b` are edge to edge: between their middles, less both sizes, never below 0. */
export function edgeDistance(a:Pose, b:Pose):number {
	return Math.max(0, distance(a.point, b.point) - (a.size ?? 0) - (b.size ?? 0));
}

/** How far `character` reaches using `using` (an item or a verb; nothing named, bare-handed): the world's `getReach`, default 1. */
export function reachOf(world:HostWorld<unknown> | undefined, character:unknown, using?:string):number {
	return world?.geometry?.getReach?.(character, using) ?? 1;
}

/**
 * How near `character`'s middle must come to `target`'s to have it in reach using `using`: its reach
 * ({@link reachOf}) past both edges (their `Pose.size`).
 */
export function reachTo(world:HostWorld<unknown>, character:unknown, target:unknown, using?:string):number {
	const geometry = world.geometry;
	return reachOf(world, character, using) + (geometry?.getPose(target, character)?.size ?? 0) + (geometry?.getPose(character)?.size ?? 0);
}

/** Whether the thing `targetID` names is in reach of character `characterID` using `using`; undefined where either has no place. */
export function inReach(world:HostWorld<unknown>, characterID:string, targetID:string, using?:string):boolean | undefined {
	const character = world.geometry && world.find(characterID);
	const target = character === undefined ? undefined : world.find(targetID);
	const from = character === undefined ? undefined : world.geometry!.getPose(character);
	const to = target === undefined ? undefined : world.geometry!.getPose(target, character);
	return from && to ? edgeDistance(from, to) <= reachOf(world, character, using) : undefined;
}

/**
 * How clearly `what` goes straight from `a` to `b`, 0 to 1: one `castRay`, then `getClarity` only on a hit; without
 * `castRay`, `getClarity`. 1 when the world says neither, 0 for a hit with no `getClarity` to ask.
 */
export function clarityOf(world:HostWorld<unknown>, what:Medium, a:Vec, b:Vec):number {
	return castOf(world, what, a, b).clarity;
}

/** {@link clarityOf}, and how far along the line `castRay` hit something, when it did. */
export function castOf(world:HostWorld<unknown>, what:Medium, a:Vec, b:Vec):{ clarity:number; hit?:number } {
	const geometry = world.geometry;
	if (!geometry?.castRay) {
		return { clarity: geometry?.getClarity?.(what, a, b) ?? 1 };
	}
	const hit = geometry.castRay(what, a, b);
	return hit ? { clarity: geometry.getClarity?.(what, a, b, hit) ?? 0, hit: hit.distance } : { clarity: 1 };
}

/** Whether the world says what stands in the way of sight or sound: `castRay` or `getClarity`. */
export function blocksLines(world:HostWorld<unknown> | undefined):world is HostWorld<unknown> {
	return !!(world?.geometry?.getClarity || world?.geometry?.castRay);
}

/** Whether `what` (light by default) passes from where `fromID` is to where `toID` is. No world, or one that says nothing, means yes; one with no place means no. */
export function inLineOfSight(world:HostWorld<unknown> | undefined, fromID:string, toID:string, what:Medium = Medium.Light):boolean {
	if (!blocksLines(world)) {
		return true;
	}
	const from = poseOf(world, fromID)?.point;
	const to = poseOf(world, toID)?.point;
	return !!from && !!to && clarityOf(world, what, from, to) > 0;
}
