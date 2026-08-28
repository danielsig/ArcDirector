import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeScene } from './describe.js';
import { groundAndFigure } from './ground.js';
import { builtinLodLayers } from './lod.js';
import { builtinStringifiers, basicPluralize } from './stringifiers.js';
import type { PerceptionObject, PerceptionInput, RelationshipStringifier } from './types.js';

type Posed = PerceptionObject & { x:number; z:number };

function xz(a:PerceptionObject, b:PerceptionObject):number {
	const pa = a as Partial<Posed>;
	const pb = b as Partial<Posed>;
	return Math.hypot((pa.x ?? 0) - (pb.x ?? 0), (pa.z ?? 0) - (pb.z ?? 0));
}

function obj(partial:Omit<Posed, 'describe'> & { label?:string }):Posed {
	const { label, ...rest } = partial;
	return {
		...rest,
		describe: () => label ?? partial.id,
	};
}

function base(over:Partial<PerceptionInput> & Pick<PerceptionInput, 'objects'>):PerceptionInput {
	return {
		self: { id: 'Watcher' },
		radius: 50,
		unitName: 'm',
		ambient: 'green grass as far as the eye can see',
		closeness: 2,
		farDistance: 3,
		clusterFactor: 2,
		lodLayers: builtinLodLayers(),
		relationships: builtinStringifiers(),
		distance: xz,
		...over,
	};
}

describe('basicPluralize', () => {
	it('applies a few suffix rules, otherwise appends s', () => {
		assert.equal(basicPluralize('city'), 'cities');
		assert.equal(basicPluralize('key'), 'keys');
		assert.equal(basicPluralize('cactus'), 'cacti');
		assert.equal(basicPluralize('bus'), 'buses');
		assert.equal(basicPluralize('box'), 'boxes');
		assert.equal(basicPluralize('tree'), 'trees');
		assert.equal(basicPluralize("city's"), "cities'");
		assert.equal(basicPluralize("cactus's"), "cacti's");
		assert.equal(basicPluralize("bus's"), "buses'");
		assert.equal(basicPluralize("tree's"), "trees'");
		assert.equal(basicPluralize("cities'"), "cities'");
		assert.equal(basicPluralize('city’s'), 'cities’');
	});
});

describe('describeScene', () => {
	it('groups a merchant against OldOak without coordinates', () => {
		const paragraph = describeScene(base({
			objects: [
				obj({
					id: 'OldOak',
					tags: ['landmark', 'tree'],
					x: 0,
					z: -5,
					movable: false,
					landmarkTier: 80,
					label: 'OldOak',
				}),
				obj({
					id: 'Merchant',
					tags: ['agent'],
					x: 0,
					z: -4,
					movable: true,
					landmarkTier: 10,
					interesting: true,
					label: 'Stressed Merchant',
				}),
			],
		}));
		assert.equal(
			paragraph,
			'green grass as far as the eye can see. what seems to be a Stressed Merchant next to the *OldOak*.',
		);
		assert.equal(/\(\s*-?\d/.test(paragraph), false);
		assert.equal(/\bx\s*=/.test(paragraph), false);
	});

	it('lists leftovers when proximityPair is disabled', () => {
		const paragraph = describeScene(base({
			clusterFactor: 0,
			objects: [
				obj({
					id: 'OldOak',
					tags: ['landmark', 'tree'],
					x: 0,
					z: -5,
					movable: false,
					landmarkTier: 80,
					label: 'Large old OldOak',
				}),
				obj({
					id: 'Merchant',
					tags: ['agent'],
					x: 0,
					z: -4,
					movable: true,
					landmarkTier: 10,
					interesting: true,
					label: 'Stressed Merchant',
				}),
			],
		}));
		assert.equal(paragraph.includes('next to'), false);
		assert.equal(paragraph.includes('*OldOak*'), true);
		assert.equal(paragraph.includes('Stressed Merchant'), true);
		assert.equal(paragraph.includes('5m away'), true);
		assert.equal(paragraph.includes('4m away'), true);
	});

	it('PascalCases an interactable leftover', () => {
		const paragraph = describeScene(base({
			ambient: 'damp stone hall',
			clusterFactor: 0,
			objects: [
				obj({
					id: 'EastGate',
					tags: ['door', 'landmark'],
					x: 8,
					z: 0,
					movable: false,
					interactable: true,
					landmarkTier: 80,
					label: 'east gate',
				}),
			],
		}));
		assert.equal(paragraph.includes('EastGate'), true);
		assert.equal(paragraph.includes('east gate'), false);
	});

	it('nests worn boots under a cat on a table', () => {
		const onTable:RelationshipStringifier = {
			id: 'OnTable',
			tier: 100,
			stringify(objects, ctx) {
				const table = objects.find((o) => o.tags.includes('table'));
				if (!table) {
					return null;
				}
				const onIt = objects.filter((o) => o.attachedTo === table.id);
				if (onIt.length === 0) {
					return null;
				}
				const unused = objects.filter((o) => o !== table && !onIt.includes(o));
				const names = onIt.map((o) => ctx.noun(o)).join(', ');
				return {
					text: `*${table.id}* with ${names} on it`,
					unused,
					mode: 'utter',
				};
			},
		};
		const paragraph = describeScene(base({
			ambient: 'a dusty room',
			clusterFactor: 0,
			relationships: [...builtinStringifiers(), onTable],
			objects: [
				obj({
					id: 'WoodenTable',
					tags: ['table', 'furniture'],
					x: 2,
					z: 0,
					movable: false,
					landmarkTier: 80,
				}),
				obj({
					id: 'Cat',
					tags: ['agent'],
					x: 2,
					z: 0.1,
					movable: true,
					landmarkTier: 10,
					attachedTo: 'WoodenTable',
					attachMode: 'on',
				}),
				obj({
					id: 'Boots',
					tags: ['item'],
					x: 2,
					z: 0.1,
					movable: true,
					landmarkTier: 20,
					attachedTo: 'Cat',
					attachMode: 'worn',
				}),
				obj({
					id: 'Carpet',
					tags: ['item'],
					x: 4,
					z: 2,
					movable: true,
					landmarkTier: 20,
				}),
			],
		}));
		assert.equal(paragraph.includes('wearing'), true);
		assert.equal(paragraph.includes('*WoodenTable*'), true);
		assert.equal(paragraph.includes('Carpet'), true);
		assert.equal(paragraph.includes('Boots 1m away'), false);
	});

	it('picks the unmovable as ground', () => {
		const oak = obj({
			id: 'OldOak',
			tags: ['landmark'],
			x: 0,
			z: -5,
			movable: false,
			landmarkTier: 80,
		});
		const merchant = obj({
			id: 'Merchant',
			tags: ['agent'],
			x: 0,
			z: -4,
			movable: true,
			landmarkTier: 10,
		});
		const { ground, figure } = groundAndFigure(oak, merchant, (o) => {
			const p = o as Partial<Posed>;
			return Math.hypot(p.x ?? 0, p.z ?? 0);
		});
		assert.equal(ground.id, 'OldOak');
		assert.equal(figure.id, 'Merchant');
	});

	it('crowds a shared tag with basicPluralize', () => {
		const boxes = ['A', 'B', 'C'].map((id, i) => obj({
			id: `Box${id}`,
			tags: ['box'],
			x: i,
			z: 0,
			movable: true,
			landmarkTier: 20,
		}));
		const paragraph = describeScene(base({
			clusterFactor: 0,
			objects: boxes,
		}));
		assert.equal(paragraph.includes('a cluster of boxes'), true);
	});

	it('uses a host pluralize for crowd labels', () => {
		const herd = ['A', 'B', 'C'].map((id, i) => obj({
			id: `Sheep${id}`,
			tags: ['sheep'],
			x: i,
			z: 0,
			movable: true,
			landmarkTier: 20,
		}));
		const paragraph = describeScene(base({
			clusterFactor: 0,
			pluralize: (word) => word === 'sheep' ? 'sheep' : basicPluralize(word),
			objects: herd,
		}));
		assert.equal(paragraph.includes('a cluster of sheep'), true);
		assert.equal(paragraph.includes('sheeps'), false);
	});
});
