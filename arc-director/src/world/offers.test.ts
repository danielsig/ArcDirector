import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OfferBook } from './offers.js';

describe('OfferBook', () => {
	it('takes a standing offer in whole lots, and a directed one only whole', () => {
		const book = new OfferBook();
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

	it('settles better terms at the maker\'s price', () => {
		const book = new OfferBook();
		book.post({ from: 'Baker', give: { Loaf: 1 }, get: { gold: 5 } });
		assert.deepEqual(book.match('Ann', 'Baker', { gold: 9 }, { Loaf: 1 })?.pay, { gold: 5 });
	});

	it('replaces, withdraws, and uses up', () => {
		const book = new OfferBook();
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
});
