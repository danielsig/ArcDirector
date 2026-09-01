import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hashEmbed } from '../inference/fake.js';
import { MemoryStore } from './store.js';

describe('MemoryStore', () => {
	it('recalls by tag overlap without embeddings', () => {
		const store = new MemoryStore();
		store.add({ text: 'a merchant in a red sash', tags: ['sash', 'red'], createdAt: 1 });
		store.add({ text: 'damp stone', tags: ['hall'], createdAt: 2 });
		const hit = store.recall({ query: 'the red sash', tags: ['sash'], now: 10, k: 1 });
		assert.equal(hit.length, 1);
		assert.equal(hit[0].text, 'a merchant in a red sash');
	});

	it('recalls by cosine when embeddings exist', () => {
		const store = new MemoryStore();
		store.add({
			text: 'EastGate is the door in the east wall',
			tags: ['gate'],
			createdAt: 1,
			embedding: hashEmbed('EastGate is the door in the east wall'),
		});
		store.add({
			text: 'I like soup',
			tags: ['food'],
			createdAt: 1,
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
		store.add({ text: 'old', createdAt: 1 });
		store.add({ text: 'keep me', createdAt: 2, pinned: true });
		store.add({ text: 'mid', createdAt: 3 });
		store.add({ text: 'new', createdAt: 4 });
		const texts = store.all().map((r) => r.text).sort();
		assert.deepEqual(texts, ['keep me', 'mid', 'new']);
	});

	it('recalls by lexical overlap without embeddings or matching tags', () => {
		const store = new MemoryStore();
		store.add({
			text: 'Miller says the mill-fee is FireMushroom.',
			tags: ['speech'],
			createdAt: 1,
		});
		store.add({ text: 'I like soup', tags: ['food'], createdAt: 2 });
		const hit = store.recall({ query: 'Trade FireMushroom for SilverTrout', now: 10, k: 1 });
		assert.equal(hit.length, 1);
		assert.equal(hit[0].text.includes('FireMushroom'), true);
	});
});
