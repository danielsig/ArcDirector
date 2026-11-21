import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hashEmbed } from '../inference/fake.js';
import { MemoryPool, MemoryStore } from './store.js';
import { internalsOf } from '../internals.js';

describe('MemoryPool', () => {
	/** Bob and Ann on their own, and hive Street that thinks for both. */
	function street() {
		const pool = new MemoryPool();
		return { pool, bob: pool.view('Bob'), ann: pool.view('Ann'), hive: pool.view('Street', () => ['Street', 'Bob', 'Ann']) };
	}

	it('keeps an event once, known by each who took it in; each view reads what its holders know', () => {
		const { bob, ann, hive } = street();
		// Taken in as events are: the same text at the same time is one record.
		internalsOf(bob).perceive({ text: ['Joe says: the key is under the stone'], timestamp: 3 });
		internalsOf(ann).perceive({ text: ['Joe says: the key is under the stone'], timestamp: 3 });
		internalsOf(ann).perceive({ text: ['The bell rang'], timestamp: 4 });
		ann.add({ text: 'The bell rang', timestamp: 4 });
		assert.deepEqual(hive.all().map((r) => [r.text, r.knownBy]), [['Joe says: the key is under the stone', ['Bob', 'Ann']], ['The bell rang', ['Ann']], ['The bell rang', ['Ann']]], 'a note added is its own record');
		assert.deepEqual(bob.all().map((r) => r.text), ['Joe says: the key is under the stone']);
		assert.deepEqual(hive.recall({ query: 'bell rang' }).map((r) => r.text), ['The bell rang', 'The bell rang'], 'a collective recalls what its characters know');
	});

	it('pins only its owner\'s own, forgets for its holders alone, and copies what others know before a rewrite', () => {
		const { bob, ann, hive } = street();
		bob.add({ text: 'You are a cobbler', pinned: true });
		hive.add({ text: 'We hold Mill Street', pinned: true });
		assert.deepEqual(hive.pinned().map((r) => r.text), ['We hold Mill Street']);
		assert.deepEqual(bob.pinned().map((r) => r.text), ['You are a cobbler']);
		const seen = bob.add({ text: 'Last saw Joe by the well', knownBy: ['Bob', 'Ann'] });
		const moved = bob.rewrite(seen.id, 'Last saw Joe by the mill')!;
		assert.notEqual(moved.id, seen.id, 'Ann still knows the old one');
		assert.deepEqual(ann.all().filter((r) => r.text.startsWith('Last saw')).map((r) => r.text), ['Last saw Joe by the well']);
		assert.deepEqual(bob.all().filter((r) => r.text.startsWith('Last saw')).map((r) => r.text), ['Last saw Joe by the mill']);
		assert.equal(ann.remove(seen.id), true);
		assert.equal(hive.all().some((r) => r.id === seen.id), false, 'gone with its last holder');
	});

	it('caps each holder\'s plain episodic memories on its own', () => {
		const { pool, bob, ann } = street();
		bob.maxEpisodic = 2;
		for (let t = 0; t < 3; t++) {
			bob.add({ text: `Bob and Ann saw cart ${t}`, knownBy: ['Bob', 'Ann'], timestamp: t });
		}
		assert.deepEqual(bob.all().map((r) => r.text), ['Bob and Ann saw cart 1', 'Bob and Ann saw cart 2']);
		assert.equal(ann.all().length, 3, 'Ann keeps her own, under the pool\'s cap');
		assert.equal(pool.maxEpisodic, 256);
	});
});

describe('MemoryStore', () => {
	it('recalls the newer of memories as relevant, newest first', () => {
		const store = new MemoryStore('Me');
		for (let round = 1; round <= 8; round++) {
			store.add({ text: `Round ${round} at the Mill.`, tags: ['Mill'], timestamp: round });
		}
		assert.deepEqual(store.recall({ query: 'Mill', k: 3 }).map((r) => r.text), ['Round 8 at the Mill.', 'Round 7 at the Mill.', 'Round 6 at the Mill.']);
	});

	it('brings to mind memories of what is before you, most of what stands closest', () => {
		const store = new MemoryStore('Me');
		store.add({ text: 'Hilde asked me for 2 Wool and 1 Thatch.', tags: ['Hilde', 'Wool'] });
		store.add({ text: 'I gave Hilde the 2 Wool. She still needs the Thatch.', tags: ['Hilde'] });
		store.add({ text: 'Mattis owes me a favor.', tags: ['Mattis'] });
		store.add({ text: 'Godric said the roads are muddy.', tags: ['Godric'] });
		const query = 'Finish the jobs people asked of you';
		assert.deepEqual(store.recall({ query, k: 2 }).map((r) => r.text), ['Hilde asked me for 2 Wool and 1 Thatch.'], 'the goal alone finds only the request');
		const before = store.recall({ query, k: 2, salience: new Map([['Hilde', 0.8], ['Mattis', 0.1]]) }).map((r) => r.text);
		assert.deepEqual(before, ['Hilde asked me for 2 Wool and 1 Thatch.', 'I gave Hilde the 2 Wool. She still needs the Thatch.']);
	});

	it('recalls by tag overlap without embeddings', () => {
		const store = new MemoryStore('Me');
		store.add({ text: 'a merchant in a red sash', tags: ['sash', 'red'], timestamp: 1 });
		store.add({ text: 'damp stone', tags: ['hall'], timestamp: 2 });
		const hit = store.recall({ query: 'the red sash', tags: ['sash'], k: 1 });
		assert.equal(hit.length, 1);
		assert.equal(hit[0].text, 'a merchant in a red sash');
	});

	it('skips records the caller already shows before taking the top k', () => {
		const store = new MemoryStore('Me');
		store.add({ text: 'Keeper says: the bridge costs 10 gold', tags: ['bridge'], timestamp: 2 });
		store.add({ text: 'Angler is across the bridge', tags: ['bridge'], timestamp: 1 });
		const hit = store.recall({ query: 'Keeper says: the bridge costs 10 gold', k: 1, skip: (r) => r.text.startsWith('Keeper') });
		assert.deepEqual(hit.map((r) => r.text), ['Angler is across the bridge']);
	});

	it('never brings a pinned memory to mind unbidden: it is in every prompt already', () => {
		const store = new MemoryStore('Me');
		store.add({ text: 'I am the canal-marketplace hive', tags: ['marketplace'], pinned: true, timestamp: 1 });
		assert.equal(store.intrusion({ query: 'the canal marketplace hive', tags: ['marketplace'], threshold: 0 }), null);
		store.add({ text: 'A thief ran through the canal marketplace', tags: ['marketplace'], timestamp: 1 });
		assert.equal(store.intrusion({ query: 'the canal marketplace hive', tags: ['marketplace'], threshold: 0 })?.text, 'A thief ran through the canal marketplace');
	});

	it('recalls by cosine when embeddings exist', () => {
		const store = new MemoryStore('Me');
		store.add({
			text: 'EastGate is the door in the east wall',
			tags: ['gate'],
			timestamp: 1,
			embedding: hashEmbed('EastGate is the door in the east wall'),
		});
		store.add({
			text: 'I like soup',
			tags: ['food'],
			timestamp: 1,
			embedding: hashEmbed('I like soup'),
		});
		const hit = store.recall({
			query: 'where is the gate',
			k: 1,
			embedding: hashEmbed('EastGate is the door in the east wall'),
			baseline: 0,
		});
		assert.equal(hit[0].text.includes('EastGate'), true);
	});

	it('brings a heavy memory to mind more readily, and unbidden on meaning alone', () => {
		const store = new MemoryStore('Me');
		const flames = [1, 0, 0];
		store.add({ text: 'The fire took my brother.', timestamp: 1, embedding: [0.9, 0.1, 0], weight: 3 });
		store.add({ text: 'My cousin stole the cart.', timestamp: 2, embedding: [0.9, 0.1, 0] });
		const unbidden = (embedding?:number[]):string | undefined => store.intrusion(embedding ? { query: 'Flames rise from the barn', embedding, baseline: 0 } : { query: 'Flames rise from the barn' })?.text;
		assert.equal(unbidden(flames), 'The fire took my brother.', 'shares no word with what is seen: only the heavy one comes');
		assert.equal(unbidden(), undefined, 'without meaning, nothing to go on');
		store.add({ text: 'The barn smells of hay.', timestamp: 3 });
		store.add({ text: 'The barn burned down once.', timestamp: 4, weight: 2 });
		assert.deepEqual(store.recall({ query: 'barn', k: 1 }).map((r) => r.text), ['The barn burned down once.'], 'the heavier of two that match alike');
	});

	it('evicts oldest unpinned episodic over cap', () => {
		const store = new MemoryStore('Me');
		store.maxEpisodic = 2;
		store.add({ text: 'old', timestamp: 1 });
		store.add({ text: 'keep me', timestamp: 2, pinned: true });
		store.add({ text: 'mid', timestamp: 3 });
		store.add({ text: 'new', timestamp: 4 });
		const texts = store.all().map((r) => r.text).sort();
		assert.deepEqual(texts, ['keep me', 'mid', 'new']);
	});

	it('recalls by lexical overlap without embeddings or matching tags', () => {
		const store = new MemoryStore('Me');
		store.add({
			text: 'BridgeKeeper says the bridge fee is FireMushroom.',
			tags: ['speech'],
			timestamp: 1,
		});
		store.add({ text: 'I like soup', tags: ['food'], timestamp: 2 });
		const hit = store.recall({ query: 'Trade FireMushroom for SilverTrout', k: 1 });
		assert.equal(hit.length, 1);
		assert.equal(hit[0].text.includes('FireMushroom'), true);
	});

	it('removes and rewrites a record by id', () => {
		const store = new MemoryStore('Me');
		const kept = store.add({ text: 'Dawn leads us', embedding: [1, 0] });
		const gone = store.add({ text: 'Dusk is the enemy' });
		assert.equal(store.remove(gone.id), true);
		assert.equal(store.remove(gone.id), false);
		assert.deepEqual(store.rewrite(kept.id, 'Dawn led us')?.text, 'Dawn led us');
		assert.equal(kept.embedding, undefined);
		assert.equal(store.rewrite('mem_99', 'x'), undefined);
		assert.deepEqual(store.all().map((r) => r.text), ['Dawn led us']);
	});

	it('keeps a memory pinned for as many thinks as it was told, and after that recall still finds it', () => {
		const store = new MemoryStore('Me');
		store.add({ text: 'I live in Hut.', tags: ['Hut'], pinned: true });
		store.add({ text: 'Goal reached: bought Bread.', tags: ['goal', 'Bread'], pinned: true, pinnedThinks: 2 });
		store.agePins();
		assert.equal(store.pinned().length, 2);
		store.agePins();
		assert.deepEqual(store.pinned().map((r) => r.text), ['I live in Hut.'], 'the one for good stays');
		assert.deepEqual(store.recall({ query: 'Bread', k: 1 }).map((r) => r.text), ['Goal reached: bought Bread.']);
	});
});
