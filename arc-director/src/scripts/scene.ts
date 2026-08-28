import {
	builtinLodLayers,
	builtinStringifiers,
	describeScene,
	type PerceptionInput,
	type PerceptionObject,
} from '../index.js';

type Posed = PerceptionObject & { x:number; z:number };

function xz(a:PerceptionObject, b:PerceptionObject):number {
	const pa = a as Partial<Posed>;
	const pb = b as Partial<Posed>;
	return Math.hypot((pa.x ?? 0) - (pb.x ?? 0), (pa.z ?? 0) - (pb.z ?? 0));
}

function named(
	id:string,
	extra:Partial<Posed> & { label?:string },
):Posed {
	const label = extra.label ?? extra.describe?.({ npcID: 'Guard', distance: 0, bearing: 'away' }) ?? id;
	return {
		id,
		tags: extra.tags ?? [],
		landmarkTier: extra.landmarkTier ?? 40,
		x: extra.x ?? 0,
		z: extra.z ?? 0,
		movable: extra.movable,
		interesting: extra.interesting,
		interactable: extra.interactable,
		count: extra.count,
		attachedTo: extra.attachedTo,
		attachMode: extra.attachMode,
		describe: extra.describe ?? (() => label),
	};
}

export function fixturePerception():PerceptionInput {
	return {
		self: { id: 'Guard' },
		radius: 20,
		unitName: 'm',
		ambient: 'damp stone hall',
		objects: [
			named('EastGate', {
				tags: ['door', 'landmark'],
				movable: false,
				interactable: true,
				landmarkTier: 80,
				x: 8,
				z: 0,
				label: 'east gate',
			}),
			named('OakA', { tags: ['tree'], landmarkTier: 40, x: -1, z: -6 }),
			named('OakB', { tags: ['tree'], landmarkTier: 40, x: 0, z: -6 }),
			named('OakC', { tags: ['tree'], landmarkTier: 40, x: 1, z: -6 }),
			named('OakD', { tags: ['tree'], landmarkTier: 40, x: 0.3, z: -5.4 }),
		],
		closeness: 2,
		farDistance: 12,
		clusterFactor: 1.2,
		lodLayers: builtinLodLayers(),
		relationships: builtinStringifiers(),
		distance: xz,
	};
}

export function fixtureParagraph():string {
	return describeScene(fixturePerception());
}

export type FixtureCtx = {
	paragraph:string;
};
