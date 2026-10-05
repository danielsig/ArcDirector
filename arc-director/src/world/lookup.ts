import type { HostWorld, Pose } from './types.js';

/** Where the thing `id` names is now, if the world has it. */
export function poseOf(world:HostWorld<unknown>, id:string):Pose | undefined {
	const entity = world.find(id);
	return entity === undefined ? undefined : world.getPose(entity);
}
