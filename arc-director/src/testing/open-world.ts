import type { HostWorld } from '../world/world-types.js';
import { Axes } from '../world/axes.js';

/** Test axes: 2D, +Y ahead and +X right, as on a page of graph paper. */
export const PAGE_AXES:Axes = { forward: [0, 1], right: [1, 0] };

/** Test fixture: every `withWorld` part on an open grid, so stock kits start. Every id is an entity, standing at the origin. */
export const OPEN_WORLD:HostWorld<string> = {
	find: (id) => id,
	getDescription: (character, target) => target,
	useItem: () => ({ ok: true }),
	geometry: { axes: Axes.Plane, getPose: () => ({ point: [0, 0], facing: [0, 1] }) },
	routes: {
		getNeighbors: (point) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => [point[0] + dx, point[1] + dz]),
		steerToward: () => false,
	},
	transfers: { transfer: () => () => undefined },
};
