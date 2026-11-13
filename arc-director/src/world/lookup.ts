import type { HostWorld, Pose } from './world-types.js';

/** Where the thing `id` names is now, if the world has it. */
export function poseOf(world:HostWorld<unknown>, id:string):Pose | undefined {
	const entity = world.find(id);
	return entity === undefined ? undefined : world.getPose(entity);
}

/** Whether light passes from where `fromID` is to where `toID` is (`canPass`). No world or no `canPass` means yes; one with no place means no. */
export function inLineOfSight(world:HostWorld<unknown> | undefined, fromID:string, toID:string):boolean {
	if (!world?.canPass) {
		return true;
	}
	const from = poseOf(world, fromID)?.point;
	const to = poseOf(world, toID)?.point;
	return !!from && !!to && world.canPass('light', from, to) > 0;
}
