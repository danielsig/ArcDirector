import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePlan, parsePlanText, formatPlan } from './parse.js';
import { VerbRegistry, registerStockVerbs, STOCK_MOVE_VERBS, STOCK_VERBS } from './registry.js';
import { registerStockCrowdVerbs } from '../conductor/verbs.js';
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

	it('formats wander until as a named expr, not a JSON string', () => {
		const plan = parsePlanText(
			'wander(until=some(landmarks.filter("waterfall").nearby()))',
			verbs(),
		);
		assert.equal(plan.head.args.until, 'some(landmarks.filter("waterfall").nearby())');
		assert.equal(
			formatPlan(plan),
			'wander(until=some(landmarks.filter("waterfall").nearby()))',
		);
	});

	it('parses issue who= expr and nested plan=', () => {
		const registry = registerStockCrowdVerbs(registerStockVerbs(new VerbRegistry()));
		const plan = parsePlanText(
			'issue(who=units.filter("Guard"), plan=go_to(Keep) && wait(seconds=1))',
			registry,
		);
		assert.equal(plan.head?.verb, 'issue');
		assert.equal(plan.head?.args.who, 'units.filter("Guard")');
		const inner = plan.head.args.plan as { head:{ verb:string; args:Record<string, unknown> }; then?:{ plan:{ head:{ verb:string } } } };
		assert.equal(inner.head.verb, 'go_to');
		assert.equal(inner.head.args.name, 'Keep');
		assert.equal(inner.then?.plan.head.verb, 'wait');
		assert.equal(
			formatPlan(plan),
			'issue(who=units.filter("Guard"), plan=go_to(Keep) && wait(1))',
		);
	});

	it('rejects when(who) and issue(watch) with migration errors', () => {
		const registry = registerStockCrowdVerbs(registerStockVerbs(new VerbRegistry()));
		assert.throws(
			() => parsePlanText('when(who=units.filter("Guard"), plan=go_to(Keep))', registry),
			/when\(who\) is issue/,
		);
		assert.throws(
			() => parsePlanText('issue(watch=isHurt(me), plan=go_to(Keep))', registry),
			/issue\(watch\) is when/,
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
		assert.equal(parsePlanText('wait(until=hasHeard)', registry).head.args.until, 'hasHeard');
		assert.equal(parsePlanText('wait(until=isNear(me, Cottage))', registry).head.args.until, 'isNear(me, Cottage)');
		assert.equal(parsePlanText('wander(until=hasHeard)', registry).head.args.until, 'hasHeard');
		assert.equal(
			parsePlanText('wander(until=\'some(items.filter("FireMushroom").nearby())\')', registry).head.args.until,
			'some(items.filter("FireMushroom").nearby())',
		);
		assert.equal(
			parsePlan(
				'{"head":{"verb":"wander","args":{"until":"some(landmarks.filter(\\"tree\\").nearby(16))"}}}',
				registry,
			).head.args.until,
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

	it('parses grouped (A && B) || C', () => {
		const plan = parsePlanText(
			'(go_to(Keep) && wait(seconds=1)) || say(fail.reason)',
			verbs(),
		);
		assert.ok(plan.group);
		assert.equal(plan.group?.head?.verb, 'go_to');
		assert.equal(plan.then?.join, 'then_if_err');
		assert.equal(plan.then?.plan.head?.verb, 'say');
		assert.equal(formatPlan(plan), '(go_to(Keep) && wait(1)) || say(fail.reason)');
	});

	it('registers the full stock set when called with no verbs', () => {
		const verbs = registerStockVerbs(new VerbRegistry());
		assert.equal(verbs.list().length, STOCK_VERBS.length);
		assert.ok(verbs.has('go_to'));
		assert.ok(verbs.has('set_identity'));
		assert.ok(verbs.has('law'));
		assert.ok(verbs.has('unlaw'));
		assert.ok(verbs.has('when'));
		assert.ok(verbs.has('loop'));
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

describe('kit views and issue(who)', () => {
	function fightKit():VerbRegistry {
		const catalog = registerStockCrowdVerbs(registerStockVerbs(new VerbRegistry()));
		catalog.add('hex', { name: 'id' });
		catalog.add('smite', { name: 'id' });
		return catalog.view(['issue', 'go_to', 'smite']);
	}

	it('parses unit verbs inside issue(who) that the kit does not grant the thinker', () => {
		const kit = fightKit();
		const plan = parsePlanText(
			'issue(who=units.filter("Witch"), plan=hex("Healer")) ; smite("Healer")',
			kit,
		);
		assert.equal(plan.head.verb, 'issue');
		const inner = plan.head.args.plan as { head:{ verb:string; args:{ name:string } } };
		assert.equal(inner.head.verb, 'hex');
		assert.equal(inner.head.args.name, 'Healer');
		assert.equal(plan.then?.join, 'then');
		assert.equal(plan.then?.plan.head.verb, 'smite');
		assert.throws(() => parsePlanText('hex("Healer")', kit), /unknown verb 'hex'/);
	});

	it('hoists then off issue args when the model nests the join there', () => {
		const kit = fightKit();
		const plan = parsePlan({
			head: {
				verb: 'issue',
				args: {
					who: 'Brune',
					plan: { head: { verb: 'hex', args: { name: 'Healer' } } },
					then: {
						join: 'then',
						plan: {
							head: {
								verb: 'issue',
								args: {
									who: 'Cade',
									plan: { head: { verb: 'hex', args: { name: 'Witch' } } },
								},
							},
						},
					},
				},
			},
		}, kit);
		assert.equal(plan.head.args.who, 'Brune');
		assert.equal(plan.then?.join, 'then');
		assert.equal(plan.then?.plan.head.verb, 'issue');
		assert.equal(plan.then?.plan.head.args.who, 'Cade');
		assert.equal(
			formatPlan(plan),
			'issue(who=Brune, plan=hex(Healer)) ; issue(who=Cade, plan=hex(Witch))',
		);
	});

	it('parses a truncated issue chain from CoT JSON', () => {
		const catalog = registerStockCrowdVerbs(registerStockVerbs(new VerbRegistry()));
		catalog.add('slash', { name: 'id' });
		catalog.add('cleave', { name: 'id' });
		const kit = catalog.view(['issue', 'loop', 'slash', 'cleave']);
		const raw = '{"head":{"verb":"issue","args":{"who":"allUnits","plan":{"head":{"verb":"loop","args":{"plan":{"head":{"verb":"slash","args":{"name":"Blade"}}}}}}},"then":{"join":"then_if_ok","plan":{"head":{"verb":"issue","args":{"who":"allUnits","plan":{"head":{"verb":"loop","args":{"plan":{"head":{"verb":"cleave","args":{"name":"Knight"}}}}}}}}}}';
		const plan = parsePlan(raw, kit);
		assert.equal(plan.head.args.who, 'allUnits');
		assert.equal(plan.then?.plan.head.args.who, 'allUnits');
		assert.equal(
			formatPlan(plan),
			'issue(who=allUnits, plan=loop(slash(Blade))) && issue(who=allUnits, plan=loop(cleave(Knight)))',
		);
	});

	it('parses long chains; nested plan= is a separate tree', () => {
		const kit = fightKit();
		const plan = parsePlanText(
			'issue(who=units.filter("Witch"), plan=hex("Healer")) '
			+ '; issue(who=units.filter("Archer"), plan=hex("Witch")) '
			+ '; issue(who=units.filter("Knight"), plan=hex("Archer")) '
			+ '; issue(who=units.filter("Blade"), plan=hex("Blade")) '
			+ '; smite("Healer")',
			kit,
		);
		assert.equal(plan.head.verb, 'issue');
		assert.equal(plan.then?.plan.then?.plan.then?.plan.then?.plan.head.verb, 'smite');
		const long = parsePlanText(
			'go_to(A) && go_to(B) && go_to(C) && go_to(D) && go_to(E)',
			kit,
		);
		assert.equal(long.head.verb, 'go_to');
		assert.equal(long.then?.plan.then?.plan.then?.plan.then?.plan.head.args.name, 'E');
	});
});
