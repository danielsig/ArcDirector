import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ArcDirector } from '../director/ArcDirector.js';
import '../director/shortcuts.js';
import { OffersFeature } from './OffersFeature.js';
import type { HostWorld, Vec } from './world-types.js';
import { Axes } from './axes.js';

describe('OffersFeature', () => {
	it('takes a standing offer in whole lots, and a directed one only whole', () => {
		const book = new OffersFeature();
		book.post({ from: 'Baker', give: { Loaf: 1 }, get: { gold: 5 } });
		assert.deepEqual(book.match('Ann', 'Baker', { gold: 15 }, { loaf: 3 }), {
			offer: book.all[0],
			pay: { gold: 15 },
			receive: { Loaf: 3 },
		});
		assert.equal(book.match('Ann', 'Baker', { gold: 14 }, { Loaf: 3 }), undefined, 'short of three lots');
		assert.equal(book.match('Ann', 'Baker', { gold: 5 }, { Scarf: 1 }), undefined, 'not on offer');
		book.post({ from: 'Baker', to: 'Ann', give: { Loaf: 1 }, get: { gold: 3 } });
		assert.deepEqual(book.match('Ann', 'Baker', { gold: 3 }, { Loaf: 1 })?.pay, { gold: 3 }, 'her own price first');
		assert.deepEqual(book.match('Ann', 'Baker', { gold: 10 }, { Loaf: 2 })?.pay, { gold: 10 }, 'two loaves come from the standing offer');
	});

	it('loads only well-formed offers from a save, and none from anything else', () => {
		const book = new OffersFeature();
		book.load([
			{ from: 'Baker', give: { Loaf: 1 }, get: { gold: 5 } },
			{ from: 'Ann', to: 'Baker', give: { gold: 4 }, get: { Loaf: 1 } },
			{ from: 'Baker', give: { Loaf: 'one' }, get: { gold: 5 } },
			{ from: 7, give: {}, get: {} },
			{ from: 'Ann', to: 3, give: { gold: 1 }, get: { Loaf: 1 } },
			'Baker',
			null,
		]);
		assert.deepEqual(book.toJSON(), [
			{ from: 'Baker', give: { Loaf: 1 }, get: { gold: 5 } },
			{ from: 'Ann', to: 'Baker', give: { gold: 4 }, get: { Loaf: 1 } },
		]);
		for (const bad of [{ from: 'Baker' }, 'offers', 3, null, undefined]) {
			book.load(bad);
			assert.deepEqual(book.all, []);
		}
	});

	it('settles better terms at the maker\'s price', () => {
		const book = new OffersFeature();
		book.post({ from: 'Baker', give: { Loaf: 1 }, get: { gold: 5 } });
		assert.deepEqual(book.match('Ann', 'Baker', { gold: 9 }, { Loaf: 1 })?.pay, { gold: 5 });
	});

	it('replaces, withdraws, and uses up', () => {
		const book = new OffersFeature();
		book.post({ from: 'Baker', give: { Loaf: 1 }, get: { gold: 5 } });
		book.post({ from: 'Baker', give: { Loaf: 1 }, get: { Egg: 2 } });
		book.post({ from: 'Baker', give: { Loaf: 1 }, get: { gold: 6 } });
		assert.deepEqual(book.all.map((offer) => offer.get), [{ Egg: 2 }, { gold: 6 }], 'repriced, barter kept');
		book.post({ from: 'Ann', to: 'Baker', give: { gold: 4 }, get: { Loaf: 1 } });
		book.post({ from: 'Baker', to: 'Ann', give: { Loaf: 1 }, get: { gold: 5 } });
		const match = book.match('Ann', 'Baker', { gold: 5 }, { Loaf: 1 })!;
		assert.equal(match.offer.to, 'Ann');
		book.settle('Ann', match);
		assert.equal(book.all.filter((offer) => offer.to !== undefined).length, 0, 'both directed offers are used up');
		book.post({ from: 'Baker', give: {}, get: {} });
		assert.equal(book.all.length, 0, 'nothing for nothing withdraws every standing offer');
	});

	it('lets an offer be made where the other makes out its words, with talk or hearing on; else where light passes', () => {
		const points:Record<string, Vec> = { Ann: [0, 0], Baker: [5, 0], Far: [30, 0] };
		const world:HostWorld<string> = { find: (id) => (points[id] ? id : undefined), geometry: { axes: Axes.Plane, getPose: (id) => ({ point: points[id] }) } };
		const plain = new ArcDirector().withWorld(world);
		assert.equal(plain.offers.canOffer('Ann', 'Far'), true, 'nothing stops light');
		const heard = new ArcDirector().withWorld(world).withHearing({});
		assert.equal(heard.offers.canOffer('Ann', 'Baker'), true, 'words carry 8 paces');
		assert.equal(heard.offers.canOffer('Ann', 'Far'), false, 'too far to make out the words');
		const talk = new ArcDirector().withWorld(world).withHearing({}).withTalk({ inRange: (speaker, listener) => listener !== 'Baker', others: () => [] });
		assert.equal(talk.offers.canOffer('Ann', 'Baker'), false, 'out of talk\'s range');
		assert.equal(talk.offers.canOffer('Ann', 'Far'), false, 'in range, too far to make out the words');
		assert.deepEqual([plain, heard, talk].map((d) => d.offers.outOfRange('Far')), ['Far is out of sight', 'Far is out of earshot', 'Far is out of earshot']);
	});
});
