import type { HostWorld, Pose, Vec } from './types.js';

/** Where the thing `id` names is now, if the world has it. */
export function poseOf(world:HostWorld<unknown>, id:string):Pose | undefined {
	const entity = world.find(id);
	return entity === undefined ? undefined : world.getPose(entity);
}

/** Whether `what` gets straight from `a` to `b` now, by the world's `canPass`: open, not only blocked for now. Without one, anything does. */
export function passes<TEntity>(world:Pick<HostWorld<TEntity>, 'canPass'>, what:'light' | 'sound' | TEntity, a:Vec, b:Vec):boolean {
	const step = world.canPass ? world.canPass(what, a, b) : {};
	return !!step && !step.blocked;
}
