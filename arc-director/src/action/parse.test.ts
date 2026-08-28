import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePlan, parsePlanText, formatPlan } from './parse.js';
import { VerbRegistry, registerCoreVerbs } from './registry.js';
import { ActionError } from './types.js';
import { asPlan } from './validate.js';

function verbs():VerbRegistry {
	return registerCoreVerbs(new VerbRegistry());
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
	});
});
