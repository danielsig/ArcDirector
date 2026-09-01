import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { VerbRegistry, registerStockVerbs } from '../action/registry.js';
import { stablePrefix, volatileBlock, seeMapHint } from './prompt.js';

describe('prompt split', () => {
	const verbs = registerStockVerbs(new VerbRegistry());
	const identity = { name: 'Guard', role: 'Pays attention.', traits: ['alert'] };

	it('puts standing instructions in the system prefix, not goals', () => {
		const system = stablePrefix(identity, verbs, { includeWatches: true, canSeeMap: true });
		assert.match(system, /You are Guard/);
		assert.match(system, /Traits: alert/);
		assert.match(system, /Available verbs/);
		assert.match(system, /remember\(content/);
		assert.match(system, /think\(about\?\)/);
		assert.match(system, /wait\(for\)/);
		assert.match(system, /wander\(for\)/);
		assert.match(system, /Looking for a thing or place/);
		assert.match(system, /Do not call see_map/);
		assert.match(system, /❌ = you/);
		assert.equal(system.includes('Goals (highest first)'), false);
		assert.equal(system.includes('Pinned memories'), false);
	});

	it('puts goals and pinned memory in the user block', () => {
		const user = volatileBlock({
			senses: { environment: 'a damp hall' },
			goals: [{ text: 'Go to EastGate', priority: 1 }],
			pinned: [{
				id: 'mem_1',
				category: 'episodic',
				text: 'the key is hidden',
				tags: [],
				createdAt: 0,
				lastAccessed: 0,
				pinned: true,
			}],
		});
		assert.match(user, /Goals \(highest first\)/);
		assert.match(user, /Go to EastGate/);
		assert.match(user, /Pinned memories/);
		assert.match(user, /the key is hidden/);
		assert.match(user, /a damp hall/);
		assert.equal(user.includes('Available verbs'), false);
		assert.equal(user.includes('see_map'), false);
	});

	it('lists recalled unpinned facts', () => {
		const user = volatileBlock({
			senses: { environment: 'a hall' },
			recalled: [{
				id: 'mem_2',
				category: 'episodic',
				text: 'Miller wants FireMushroom for the mill-fee',
				tags: ['Miller'],
				createdAt: 0,
				lastAccessed: 0,
			}],
		});
		assert.match(user, /You remember:/);
		assert.match(user, /Miller wants FireMushroom/);
	});

	it('lists a one-shot think-about note', () => {
		const user = volatileBlock({
			senses: { environment: 'a hall' },
			thinkAbout: 'how to open EastGate',
		});
		assert.match(user, /You asked to think about: how to open EastGate/);
	});

	it('lists named watches and tells the model to add, edit, or remove', () => {
		const user = volatileBlock({
			senses: { environment: 'a glen' },
			pinnedWatches: { hurt: 'isHurt(me)' },
			watches: { theft: 'some(events.filter("theft").nearby(16))' },
			watchesWritable: true,
		});
		assert.match(user, /Required watches/);
		assert.match(user, /hurt: isHurt\(me\)/);
		assert.match(user, /theft: some/);
		assert.match(user, /addWatches/);
		assert.match(user, /editWatches/);
		assert.match(user, /removeWatches/);
		assert.match(user, /"watches"/);
	});

	it('uses the configured you pictogram in the see_map hint', () => {
		const system = stablePrefix(identity, verbs, { canSeeMap: true, youSymbol: '🎯' });
		assert.match(system, /🎯 = you/);
		assert.equal(system.includes('❌ = you'), false);
		assert.match(seeMapHint('🎯'), /🎯 = you/);
	});
});
