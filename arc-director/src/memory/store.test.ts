import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hashEmbed } from '../inference/fake.js';
import { MemoryStore } from './store.js';

describe('MemoryStore', () => {
	it('brings to mind memories of what is before you, most of what stands closest', () => {
		const store = new MemoryStore();
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
		const store = new MemoryStore();
		store.add({ text: 'a merchant in a red sash', tags: ['sash', 'red'], timestamp: 1 });
		store.add({ text: 'damp stone', tags: ['hall'], timestamp: 2 });
		const hit = store.recall({ query: 'the red sash', tags: ['sash'], now: 10, k: 1 });
		assert.equal(hit.length, 1);
		assert.equal(hit[0].text, 'a merchant in a red sash');
	});

	it('skips records the caller already shows before taking the top k', () => {
		const store = new MemoryStore();
		store.add({ text: 'Keeper says: the bridge costs 10 gold', tags: ['bridge'], timestamp: 2 });
		store.add({ text: 'Angler is across the bridge', tags: ['bridge'], timestamp: 1 });
		const hit = store.recall({ query: 'Keeper says: the bridge costs 10 gold', now: 4, k: 1, skip: (r) => r.text.startsWith('Keeper') });
		assert.deepEqual(hit.map((r) => r.text), ['Angler is across the bridge']);
	});

	it('never brings a pinned memory to mind unbidden: it is in every prompt already', () => {
		const store = new MemoryStore();
		store.add({ text: 'I am the canal-market hive', tags: ['market'], pinned: true, timestamp: 1 });
		assert.equal(store.intrusion({ query: 'the canal market hive', now: 2, tags: ['market'], threshold: 0 }), null);
		store.add({ text: 'A thief ran through the canal market', tags: ['market'], timestamp: 1 });
		assert.equal(store.intrusion({ query: 'the canal market hive', now: 2, tags: ['market'], threshold: 0 })?.text, 'A thief ran through the canal market');
	});

	it('recalls by cosine when embeddings exist', () => {
		const store = new MemoryStore();
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
			now: 4,
			k: 1,
			embedding: hashEmbed('EastGate is the door in the east wall'),
		});
		assert.equal(hit[0].text.includes('EastGate'), true);
	});

	it('evicts oldest unpinned episodic over cap', () => {
		const store = new MemoryStore();
		store.maxEpisodic = 2;
		store.add({ text: 'old', timestamp: 1 });
		store.add({ text: 'keep me', timestamp: 2, pinned: true });
		store.add({ text: 'mid', timestamp: 3 });
		store.add({ text: 'new', timestamp: 4 });
		const texts = store.all().map((r) => r.text).sort();
		assert.deepEqual(texts, ['keep me', 'mid', 'new']);
	});

	it('recalls by lexical overlap without embeddings or matching tags', () => {
		const store = new MemoryStore();
		store.add({
			text: 'BridgeKeeper says the bridge fee is FireMushroom.',
			tags: ['speech'],
			timestamp: 1,
		});
		store.add({ text: 'I like soup', tags: ['food'], timestamp: 2 });
		const hit = store.recall({ query: 'Trade FireMushroom for SilverTrout', now: 10, k: 1 });
		assert.equal(hit.length, 1);
		assert.equal(hit[0].text.includes('FireMushroom'), true);
	});

	it('removes and rewrites a record by id', () => {
		const store = new MemoryStore();
		const kept = store.add({ text: 'Dawn leads us', embedding: [1, 0] });
		const gone = store.add({ text: 'Dusk is the enemy' });
		assert.equal(store.remove(gone.id), true);
		assert.equal(store.remove(gone.id), false);
		assert.equal(store.rewrite(kept.id, 'Dawn led us')?.text, 'Dawn led us');
		assert.equal(kept.embedding, undefined);
		assert.equal(store.rewrite('mem_99', 'x'), undefined);
		assert.deepEqual(store.all().map((r) => r.text), ['Dawn led us']);
	});
});
