import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatSight } from './sight.js';
import { groundAndFigure } from './ground.js';
import { builtinStringifiers, basicPluralize } from './stringifiers.js';
import type { SeenObject, Sight, RelationshipStringifier } from './types.js';
import { formatInventory } from './formatInventory.js';

function seen(
	id:string,
	at:number[],
	extra:Partial<SeenObject> = {},
):SeenObject {
	return {
		id,
		at,
		tags: extra.tags ?? [],
		...extra,
	};
}

function person(id:string, at:number[]):SeenObject {
	return seen(id, at, {
		tags: ['agent', 'person'],
		interactable: true,
		interesting: 1,
		movable: true,
	});
}

function item(id:string, at:number[], extra:Partial<SeenObject> = {}):SeenObject {
	return seen(id, at, {
		tags: ['item'],
		interactable: true,
		movable: true,
		...extra,
	});
}

function door(id:string, at:number[]):SeenObject {
	return seen(id, at, {
		tags: ['door', 'landmark'],
		interactable: true,
		movable: false,
	});
}

const HALL:Sight = {
	self: { id: 'Captain', at: [11.5, 10.5], facing: [0, -1] },
	ambient: 'A damp stone hall of the abbey.',
	objects: [
		person('Alchemist', [11.5, 7.5]),
		person('Herbalist', [8, 10.5]),
		door('EastGate', [18, 10.5]),
		door('WestGate', [2, 10.5]),
		seen('ArmoryChest', [14, 8], { tags: ['chest', 'landmark'], interactable: true, movable: false }),
		item('LeatherGlove', [13.2, 10.5]),
		item('WorkGlove', [9.8, 10.5]),
		item('Bitterroot', [11.5, -5], { interesting: 1 }),
		item('BrassKey', [16, 6]),
		item('TorchA', [6, 8]),
		item('TorchB', [17, 13]),
		item('Lantern', [10, 14]),
		seen('CrateA', [4, 6], { tags: ['box'], movable: true }),
		seen('CrateB', [5, 6], { tags: ['box'], movable: true }),
		seen('CrateC', [4.5, 6.4], { tags: ['box'], movable: true }),
		seen('BrewHearth', [20, 2], { tags: ['landmark'], interactable: true, movable: false }),
		seen('NollCot', [22, 4], { tags: ['cot', 'landmark'], interactable: true, movable: false }),
		seen('LinaCot', [22, 8], { tags: ['cot', 'landmark'], interactable: true, movable: false }),
		item('GoldCoin', [15, 12]),
		item('ChestKey', [12.8, 12]),
		item('Broom', [3, 14]),
		item('Bucket', [7, 13]),
		item('Rag', [19, 7]),
		seen('Pillar', [11.5, 4], { tags: ['landmark'], movable: false }),
	],
};

const HALL_GOLDEN = 'A damp stone hall of the abbey. boxes. Alchemist 3 paces ahead. Herbalist 4 paces left. *ArmoryChest* 4 paces ahead. *BrewHearth* 10 paces ahead. *EastGate* 5 paces right. *LinaCot* 10 paces right. *NollCot* 10 paces right. *Pillar* 5 paces ahead. *WestGate* 10 paces left. Bitterroot 15 paces ahead. BrassKey 5 paces ahead. Broom 10 paces left. Bucket 5 paces left. ChestKey 2 paces behind. GoldCoin 4 paces right. Lantern 4 paces behind. LeatherGlove 2 paces right. Rag 10 paces right. TorchA 5 paces left. TorchB 5 paces right. WorkGlove 2 paces left.';

const GLEN:Sight = {
	self: { id: 'Forager', at: [7, 8], facing: [1, 0] },
	ambient: 'A windy river glen.',
	objects: [
		person('Miller', [16, 9]),
		person('Angler', [16, 18]),
		person('Servant', [13, 11]),
		item('CottageKey', [7.6, 8]),
		item('FireMushroom', [4, 5]),
		item('SilverTrout', [22, 22]),
		seen('Cottage', [6, 12], { tags: ['landmark'], interactable: true, movable: false }),
		door('CottageDoor', [6, 10.5]),
		seen('MillBridge', [12, 14], { tags: ['bridge', 'landmark'], interactable: true, movable: false }),
		seen('MillLever', [14, 10], { tags: ['landmark'], interactable: true, movable: false }),
		seen('Falls', [20, 4], { tags: ['landmark'], movable: false }),
		seen('OakA', [2, 3], { tags: ['tree'], movable: false }),
		seen('OakB', [3, 16], { tags: ['tree'], movable: false }),
		item('ReedA', [11, 16], { tags: ['plant'] }),
		item('ReedB', [12, 17], { tags: ['plant'] }),
		item('Pebble', [8, 6]),
		item('Stick', [9, 10]),
		item('Basket', [5, 9]),
		seen('MillStone', [17, 8], { tags: ['landmark'], movable: false }),
		item('Net', [15, 20]),
		item('Oar', [18, 17]),
	],
};

const STREET:Sight = {
	self: { id: 'Holt', at: [4, 8], facing: [1, 0] },
	ambient: 'A busy street flea market.',
	objects: [
		person('Potter', [16.2, 8]),
		seen('PotterStall', [16.6, 8], { tags: ['landmark'], interactable: true, movable: false }),
		person('Baker', [10, 6]),
		seen('BakerStall', [10.4, 6], { tags: ['landmark'], interactable: true, movable: false }),
		person('Weaver', [10, 10]),
		seen('WeaverStall', [10.4, 10], { tags: ['landmark'], interactable: true, movable: false }),
		person('Cutler', [16, 12]),
		seen('CutlerStall', [16.4, 12], { tags: ['landmark'], interactable: true, movable: false }),
		person('Pike', [4, 10]),
		person('Brant', [20, 6]),
		person('Cass', [20, 10]),
		door('WestGate', [0, 8]),
		door('EastGate', [24, 8]),
		item('Loaf', [10, 5.5]),
		item('Scarf', [10, 10.5]),
		item('Bowl', [18, 4]),
		item('Knife', [16, 12.5]),
		item('Apple', [11, 7]),
		item('Candle', [15, 9]),
		seen('CrateA', [7, 4], { tags: ['box'], movable: true }),
		seen('CrateB', [7.4, 4], { tags: ['box'], movable: true }),
		seen('CrateC', [7.2, 4.3], { tags: ['box'], movable: true }),
		person('VisitorA', [12, 8]),
		person('VisitorB', [14, 14]),
		person('VisitorC', [8, 14]),
	],
};

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

describe('formatSight', () => {
	it('hall: ids, bearings, glove leftovers, far Bitterroot without hedge', () => {
		const paragraph = formatSight(HALL);
		assert.equal(paragraph.includes('what seems to be'), false);
		assert.equal(paragraph.includes('cluster of'), false);
		assert.equal(paragraph, HALL_GOLDEN);
	});

	it('glen: people with bearing, CottageKey 1 pace, no agent crowd', () => {
		const paragraph = formatSight(GLEN);
		assert.equal(paragraph.includes('cluster of'), false);
		assert.equal(/\bagents\b/.test(paragraph), false);
		assert.equal(
			paragraph,
			'A windy river glen. Angler 15 paces right. Miller 10 paces ahead. Servant 5 paces ahead. *Cottage* 5 paces right. *CottageDoor* 3 paces right. *Falls* 15 paces ahead. *MillBridge* 10 paces right. *MillLever* 5 paces ahead. *MillStone* 10 paces ahead. *OakA* 5 paces behind. *OakB* 10 paces right. Basket 2 paces behind. CottageKey 1 pace ahead. FireMushroom 5 paces behind. Net 15 paces right. Oar 15 paces ahead. Pebble 2 paces left. ReedA 10 paces right. ReedB 10 paces right. SilverTrout 20 paces ahead. Stick 3 paces ahead.',
		);
	});

	it('street: Potter next to PotterStall, distinct stalls, no agent crowd', () => {
		const paragraph = formatSight(STREET);
		assert.equal(paragraph.includes('Potter next to *PotterStall*'), true);
		assert.equal(paragraph.includes('cluster of'), false);
		assert.equal(/\bagents\b/.test(paragraph), false);
		assert.equal(
			paragraph,
			'A busy street flea market. boxes. Cutler next to *CutlerStall*. Weaver next to *WeaverStall*. Baker next to *BakerStall*. Potter next to *PotterStall*. Brant 15 paces ahead. Cass 15 paces ahead. Pike 2 paces right. VisitorA 10 paces ahead. VisitorB 10 paces ahead. VisitorC 5 paces right. *EastGate* 20 paces ahead. *WestGate* 4 paces behind. Apple 5 paces ahead. Bowl 15 paces ahead. Candle 10 paces ahead. Knife 15 paces ahead. Loaf 5 paces ahead. Scarf 5 paces ahead.',
		);
	});

	it('PascalCases an interactable leftover', () => {
		const paragraph = formatSight({
			self: { id: 'Watcher', at: [0, 0] },
			ambient: 'damp stone hall',
			objects: [
				seen('EastGate', [8, 0], {
					tags: ['door', 'landmark'],
					movable: false,
					interactable: true,
				}),
			],
		});
		assert.equal(paragraph.includes('EastGate'), true);
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
		const paragraph = formatSight({
			self: { id: 'Watcher', at: [0, 0] },
			ambient: 'a dusty room',
			objects: [
				seen('WoodenTable', [2, 0], {
					tags: ['table', 'furniture'],
					movable: false,
				}),
				seen('Cat', [2, 0.1], {
					tags: ['agent'],
					movable: true,
					attachedTo: 'WoodenTable',
					attachMode: 'on',
				}),
				seen('Boots', [2, 0.1], {
					tags: ['item'],
					movable: true,
					attachedTo: 'Cat',
					attachMode: 'worn',
				}),
				seen('Carpet', [4, 2], {
					tags: ['item'],
					movable: true,
				}),
			],
		}, {
			clusterFactor: 0,
			relationships: [...builtinStringifiers(), onTable],
		});
		assert.equal(paragraph.includes('wearing'), true);
		assert.equal(paragraph.includes('*WoodenTable*'), true);
		assert.equal(paragraph.includes('Carpet'), true);
		assert.equal(paragraph.includes('Boots 1 pace'), false);
	});

	it('picks the unmovable as ground', () => {
		const oak = seen('OldOak', [0, -5], {
			tags: ['landmark'],
			movable: false,
		});
		const merchant = seen('Merchant', [0, -4], {
			tags: ['agent'],
			movable: true,
		});
		const { ground, figure } = groundAndFigure(oak, merchant, (o) => hypot(o.at, [0, 0]));
		assert.equal(ground.id, 'OldOak');
		assert.equal(figure.id, 'Merchant');
	});

	it('crowds a shared tag with basicPluralize', () => {
		const boxes = ['A', 'B', 'C'].map((id, i) => seen(`Box${id}`, [i, 0], {
			tags: ['box'],
			movable: true,
		}));
		const paragraph = formatSight({
			self: { id: 'Watcher', at: [0, 0] },
			ambient: 'green grass as far as the eye can see',
			objects: boxes,
		}, { clusterFactor: 0 });
		assert.equal(paragraph.includes('boxes'), true);
		assert.equal(paragraph.includes('cluster of'), false);
	});

	it('uses a host pluralize for crowd labels', () => {
		const herd = ['A', 'B', 'C'].map((id, i) => seen(`Sheep${id}`, [i, 0], {
			tags: ['sheep'],
			movable: true,
		}));
		const paragraph = formatSight({
			self: { id: 'Watcher', at: [0, 0] },
			ambient: 'green grass as far as the eye can see',
			objects: herd,
		}, {
			clusterFactor: 0,
			pluralize: (word) => word === 'sheep' ? 'sheep' : basicPluralize(word),
		});
		assert.equal(paragraph.includes('sheep'), true);
		assert.equal(paragraph.includes('sheeps'), false);
		assert.equal(paragraph.includes('cluster of'), false);
	});
});

function hypot(a:number[], b:number[]):number {
	const n = Math.min(a.length, b.length);
	let s = 0;
	for (let i = 0; i < n; i++) {
		const d = (a[i] ?? 0) - (b[i] ?? 0);
		s += d * d;
	}
	return Math.sqrt(s);
}

describe('formatInventory', () => {
	it('formats filled slots in insertion order', () => {
		assert.equal(
			formatInventory({
				worn: {
					head: 'Helmet',
					torso: 'Tunic',
					feet: 'Boots',
					back: "Traveler'sPack",
					'hands.left.held': 'Torch',
				},
				purse: 22,
				pockets: ['CottageKey'],
				pack: { name: "Traveler'sPack", items: ['GoldCoin', 'ChestKey'] },
			}),
			[
				'head: Helmet',
				'torso: Tunic',
				'feet: Boots',
				"back: Traveler'sPack",
				'hands.left.held: Torch',
				'Purse: 22 gold',
				'Pockets: CottageKey',
				"Backpack Traveler'sPack: GoldCoin, ChestKey",
			].join('\n'),
		);
	});

	it('empty bag is Nothing worn', () => {
		assert.equal(formatInventory({}), 'Nothing worn.');
	});

	it('keeps counts in the pocket label', () => {
		assert.equal(
			formatInventory({ pockets: ['Knife x2'] }),
			'Pockets: Knife x2',
		);
	});
});
