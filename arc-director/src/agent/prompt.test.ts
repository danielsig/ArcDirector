import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePlan } from '../action/parse.js';
import { VerbRegistry, registerStockVerbs } from '../action/registry.js';
import { registerStockCrowdVerbs } from '../conductor/verbs.js';
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
		assert.match(system, /wait\(until\)/);
		assert.match(system, /wander\(until\)/);
		assert.match(system, /args\.until/);
		assert.match(system, /"verb":"wander"/);
		assert.match(system, /Looking for a thing or place/);
		assert.match(system, /isReachable\(me, Cottage\)/);
		assert.match(system, /wrap list watches in some/);
		assert.match(system, /Answer immediately with only the ActionPlan JSON/);
		assert.match(system, /No preamble, no scratchpad, no prose before or after it/);
		assert.match(system, /Do not think\(\) twice in a row/);
		assert.match(system, /Do not call see_map/);
		assert.match(system, /If the last wander already met args\.until/);
		assert.match(system, /units \(this Crowd roster/);
		assert.match(system, /manhattan\(me, Player\)/);
		assert.equal(system.includes('wander(for) with a watch expr'), false);
		assert.equal(system.includes('Then emit one ActionPlan as JSON'), false);
		assert.match(system, /❌ = you/);
		assert.equal(system.includes('Goals (highest first)'), false);
		assert.equal(system.includes('Pinned memories'), false);
		const wanderJson = system.match(/\{"head":\{"verb":"wander","args":\{"until":"(?:\\.|[^"\\])*"\}\}\}/);
		assert.ok(wanderJson);
		assert.equal(parsePlan(wanderJson[0], verbs).head.verb, 'wander');
		assert.equal(
			parsePlan(wanderJson[0], verbs).head.args.until,
			'some(items.filter("FireMushroom").nearby())',
		);
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

	it('when(who) and law rules appear when the kit has crowd verbs', () => {
		const verbs = registerStockCrowdVerbs(registerStockVerbs(new VerbRegistry()));
		const system = stablePrefix(identity, verbs);
		assert.match(system, /when\(who, plan\) replaces that unit's plan stack/);
		assert.match(system, /law\(who, watch, plan, name\?\) is a standing emergency/);
		assert.match(system, /when\(watch, plan\) is critical on this job/);
	});

	it('lists required and extra sightFocus in the user block', () => {
		const user = volatileBlock({
			senses: { environment: 'a square' },
			pinnedSightFocus: ['isHurt(it)'],
			sightFocus: ['isNear(it, Player)'],
			sightFocusWritable: true,
		});
		assert.match(user, /Required sightFocus/);
		assert.match(user, /isHurt\(it\)/);
		assert.match(user, /Current sightFocus/);
		assert.match(user, /isNear\(it, Player\)/);
		assert.match(user, /"sightFocus"/);
	});
});
