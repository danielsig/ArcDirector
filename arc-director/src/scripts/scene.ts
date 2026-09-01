import { formatSight, type Sight, type SeenObject } from '../index.js';

function named(
	id:string,
	extra:Partial<SeenObject> & { x?:number; z?:number },
):SeenObject {
	const { x, z, ...rest } = extra;
	return {
		id,
		at: [x ?? 0, z ?? 0],
		tags: extra.tags ?? [],
		...rest,
	};
}

export function fixtureSight():Sight {
	return {
		self: { id: 'Guard', at: [0, 0] },
		ambient: 'damp stone hall',
		objects: [
			named('EastGate', {
				tags: ['door', 'landmark'],
				movable: false,
				interactable: true,
				x: 8,
				z: 0,
			}),
			named('OakA', { tags: ['tree'], x: -1, z: -6 }),
			named('OakB', { tags: ['tree'], x: 0, z: -6 }),
			named('OakC', { tags: ['tree'], x: 1, z: -6 }),
			named('OakD', { tags: ['tree'], x: 0.3, z: -5.4 }),
		],
	};
}

export function fixtureParagraph():string {
	return formatSight(fixtureSight());
}

export type FixtureCtx = {
	paragraph:string;
};
