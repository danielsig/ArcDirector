import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { VerbRegistry, registerCoreVerbs } from '../action/registry.js';
import { stablePrefix, volatileBlock, seeMapHint } from './prompt.js';

describe('prompt split', () => {
	const verbs = registerCoreVerbs(new VerbRegistry());
	const identity = { name: 'Guard', role: 'Pays attention.', traits: ['alert'] };

	it('puts standing instructions in the system prefix, not goals', () => {
		const system = stablePrefix(identity, verbs, { includeWatches: true, canSeeMap: true });
		assert.match(system, /You are Guard/);
		assert.match(system, /Traits: alert/);
		assert.match(system, /Available verbs/);
		assert.match(system, /Do not call see_map/);
		assert.match(system, /❌ = you/);
		assert.equal(system.includes('Goals (highest first)'), false);
		assert.equal(system.includes('Pinned memories'), false);
	});

	it('puts goals and pinned memory in the user block', () => {
		const user = volatileBlock({
			pushed: { environment: 'a damp hall' },
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

	it('uses the configured you pictogram in the see_map hint', () => {
		const system = stablePrefix(identity, verbs, { canSeeMap: true, youSymbol: '🎯' });
		assert.match(system, /🎯 = you/);
		assert.equal(system.includes('❌ = you'), false);
		assert.match(seeMapHint('🎯'), /🎯 = you/);
	});
});
