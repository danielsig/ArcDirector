import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePlan, parsePlanText, formatPlan } from './parse.js';
import { VerbRegistry, registerStockVerbs, STOCK_MOVE_VERBS, STOCK_VERBS } from './registry.js';
import { ActionError } from './types.js';
import { asPlan } from './validate.js';

function verbs():VerbRegistry {
	return registerStockVerbs(new VerbRegistry());
}

describe('ActionPlan parse', () => {
	it('parses sequenced text form', () => {
		const plan = parsePlanText(
			'go_to(EastGate) && use(item=BrassKey, target=EastGate) ; say("After you.")',
			verbs(),
		);
		assert.equal(plan.head.verb, 'go_to');
		assert.equal(plan.head.args.name, 'EastGate');
		assert.equal(plan.then?.join, 'then_if_ok');
		assert.equal(plan.then?.plan.head.verb, 'use');
		assert.equal(plan.then?.plan.head.args.item, 'BrassKey');
		assert.equal(plan.then?.plan.then?.join, 'then');
		assert.equal(plan.then?.plan.then?.plan.head.args.text, 'After you.');
		assert.equal(
			formatPlan(plan),
			'go_to(EastGate) && use(item=BrassKey, target=EastGate) ; say("After you.")',
		);
	});

	it('parses truncated nested JSON by closing braces', () => {
		const registry = verbs();
		const raw = '{"head":{"verb":"go_to","args":{"name":"Lantern"}},"then":{"join":"then_if_ok","plan":{"head":{"verb":"wait","args":{"seconds":1}}}}';
		const plan = parsePlan(raw, registry);
		assert.equal(plan.head.verb, 'go_to');
		assert.equal(plan.then?.plan.head.verb, 'wait');
	});

	it('parses JSON and rejects coordinates', () => {
		const registry = verbs();
		const plan = parsePlan({
			head: { verb: 'go_to', args: { name: 'EastGate' } },
		}, registry);
		assert.equal(plan.head.args.name, 'EastGate');
		assert.throws(
			() => asPlan({
				head: { verb: 'go_to', args: { name: 'EastGate', x: 3, z: 4 } },
			}, registry),
			ActionError,
		);
		assert.throws(
			() => asPlan({
				head: { verb: 'go_to', args: { name: '3, 4' } },
			}, registry),
			ActionError,
		);
		assert.throws(
			() => parsePlanText('fly(EastGate)', registry),
			ActionError,
		);
		assert.equal(parsePlanText('think("how to open EastGate")', registry).head.args.about, 'how to open EastGate');
		assert.deepEqual(parsePlanText('think()', registry).head.args, {});
		assert.equal(parsePlanText('wait(for=hasHeard)', registry).head.args.for, 'hasHeard');
		assert.equal(parsePlanText('wander(for=hasHeard)', registry).head.args.for, 'hasHeard');
		assert.equal(
			parsePlan(
				'{"head":{"verb":"wander","args":{"for":"some(landmarks.filter(\\"tree\\").nearby(16))"}}}',
				registry,
			).head.args.for,
			'some(landmarks.filter("tree").nearby(16))',
		);
		assert.equal(
			parsePlan(
				'{"head":{"verb":"wander","args":{"until":"isNear(me, Cottage)"}}}',
				registry,
			).head.args.until,
			'isNear(me, Cottage)',
		);
	});

	it('takes the last {"head" out of a CoT essay', () => {
		const registry = verbs();
		const plan = parsePlan(
			'The user wants me to act.\n'
			+ 'Example: {"head":{"verb":"go_to","args":{"name":"EastGate"}}}\n'
			+ 'Final: {"head":{"verb":"follow","args":{"name":"Player"}}}',
			registry,
		);
		assert.equal(plan.head.verb, 'follow');
		assert.equal(plan.head.args.name, 'Player');
	});
});

describe('registerStockVerbs', () => {
	it('registers a subset when stock verb names are passed', () => {
		const verbs = registerStockVerbs(new VerbRegistry(), 'go_to', 'follow');
		assert.ok(verbs.has('go_to'));
		assert.ok(verbs.has('follow'));
		assert.equal(verbs.has('wander'), false);
		assert.equal(verbs.has('pick_up'), false);
		assert.equal(verbs.has('think'), false);
	});

	it('spreads a group and skips names already registered', () => {
		const verbs = registerStockVerbs(new VerbRegistry(), ...STOCK_MOVE_VERBS);
		registerStockVerbs(verbs, 'go_to', 'say');
		assert.deepEqual(
			verbs.list().map((v) => v.name),
			['go_to', 'follow', 'wander', 'say'],
		);
	});

	it('registers the full stock set when called with no verbs', () => {
		const verbs = registerStockVerbs(new VerbRegistry());
		assert.equal(verbs.list().length, STOCK_VERBS.length);
		assert.ok(verbs.has('go_to'));
		assert.ok(verbs.has('set_identity'));
	});
});

describe('VerbRegistry view and remove', () => {
	it('views a subset and remove drops names', () => {
		const verbs = registerStockVerbs(new VerbRegistry(), ...STOCK_MOVE_VERBS);
		assert.deepEqual(verbs.view(['go_to', 'missing']).list().map((v) => v.name), ['go_to']);
		assert.equal(verbs.view(null), verbs);
		verbs.remove('follow', 'wander');
		assert.deepEqual(verbs.list().map((v) => v.name), ['go_to']);
		verbs.remove();
		assert.ok(verbs.has('go_to'));
	});
});
