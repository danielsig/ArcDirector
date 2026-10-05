import type { HostWorld } from '../world/types.js';

/** Test fixture: every `withWorld` part on an open grid, so stock kits start. Every id is an entity, standing at the origin. */
export const OPEN_WORLD:HostWorld<string> = {
	find: (id) => id,
	getPose: () => ({ point: [0, 0], facing: [0, 1], right: [1, 0] }),
	getPathGraph: () => (point) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => ({ point: [point[0] + dx, point[1] + dz] })),
	steerToward: () => false,
	moveItem: () => ({ ok: true }),
	useItem: () => ({ ok: true }),
	getDescription: (actor, target) => target,
	trade: () => ({ ok: true }),
};
