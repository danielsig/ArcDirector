import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseArc, parseArcText, formatArc } from './parse.js';
import { VerbRegistry, registerStockVerbs, STOCK_MOVE_VERBS, STOCK_TRADE_VERBS, STOCK_VERBS } from './stock-verbs.js';
import { registerStockCollectiveVerbs } from '../collective/verbs.js';
import { ArcError } from './types.js';
import { asArc } from './validate.js';
import { arcSchema } from './schema.js';
import type { Arc } from './types.js';

function verbs():VerbRegistry {
	return registerStockVerbs(new VerbRegistry());
}

describe('Arc parse', () => {
	it('parses sequenced text form', () => {
		const arc = parseArcText(
			'go_to(EastGate) && use(item=BrassKey, target=EastGate) ; say("After you.")',
			verbs(),
		);
		assert.equal(arc.head.verb, 'go_to');
		assert.equal(arc.head.args.target, 'EastGate');
		assert.equal(arc.then?.join, 'then_if_ok');
		assert.equal(arc.then?.arc.head.verb, 'use');
		assert.equal(arc.then?.arc.head.args.item, 'BrassKey');
		assert.equal(arc.then?.arc.then?.join, 'then');
		assert.equal(arc.then?.arc.then?.arc.head.args.text, 'After you.');
		assert.equal(
			formatArc(arc, verbs()),
			'go_to(EastGate) && use(item=BrassKey, target=EastGate) ; say("After you.")',
		);
	});

	it('formats wander until as a named expr, not a JSON string', () => {
		const arc = parseArcText(
			'wander(until=some(landmarks.filter("waterfall").nearby()))',
			verbs(),
		);
		assert.equal(arc.head.args.until, 'some(landmarks.filter("waterfall").nearby())');
		assert.equal(
			formatArc(arc, verbs()),
			'wander(until=some(landmarks.filter("waterfall").nearby()))',
		);
	});

	it('parses issue who= expr and nested arc=', () => {
		const registry = registerStockCollectiveVerbs(registerStockVerbs(new VerbRegistry()));
		const arc = parseArcText(
			'issue(who=units.filter("Guard"), arc=go_to(Keep) && wait(seconds=1))',
			registry,
		);
		assert.equal(arc.head?.verb, 'issue');
		assert.equal(arc.head?.args.who, 'units.filter("Guard")');
		const inner = arc.head.args.arc as { head:{ verb:string; args:Record<string, unknown> }; then?:{ arc:{ head:{ verb:string } } } };
		assert.equal(inner.head.verb, 'go_to');
		assert.equal(inner.head.args.target, 'Keep');
		assert.equal(inner.then?.arc.head.verb, 'wait');
		assert.equal(
			formatArc(arc, verbs()),
			'issue(who=units.filter("Guard"), arc=go_to(Keep) && wait(1))',
		);
	});

	it('rejects when(who) and issue(watch) with migration errors', () => {
		const registry = registerStockCollectiveVerbs(registerStockVerbs(new VerbRegistry()));
		assert.throws(
			() => parseArcText('when(who=units.filter("Guard"), arc=go_to(Keep))', registry),
			/when\(who\) is issue/,
		);
		assert.throws(
			() => parseArcText('issue(watch=isHurt(me), arc=go_to(Keep))', registry),
			/issue\(watch\) is when/,
		);
	});

	it('parses truncated nested JSON by closing braces', () => {
		const registry = verbs();
		const raw = '{"head":{"verb":"go_to","args":{"target":"Lantern"}},"then":{"join":"then_if_ok","arc":{"head":{"verb":"wait","args":{"seconds":1}}}}';
		const arc = parseArc(raw, registry);
		assert.equal(arc.head.verb, 'go_to');
		assert.equal(arc.then?.arc.head.verb, 'wait');
	});

	it('parses JSON and rejects coordinates', () => {
		const registry = verbs();
		const arc = parseArc({
			head: { verb: 'go_to', args: { target: 'EastGate' } },
		}, registry);
		assert.equal(arc.head.args.target, 'EastGate');
		assert.throws(
			() => asArc({
				head: { verb: 'go_to', args: { target: 'EastGate', x: 3, z: 4 } },
			}, registry),
			ArcError,
		);
		assert.throws(
			() => asArc({
				head: { verb: 'go_to', args: { target: '3, 4' } },
			}, registry),
			ArcError,
		);
		assert.throws(
			() => parseArcText('fly(EastGate)', registry),
			ArcError,
		);
		assert.equal(parseArcText('think("how to open EastGate")', registry).head.args.about, 'how to open EastGate');
		assert.deepEqual(parseArcText('think()', registry).head.args, {});
		assert.equal(parseArcText('wait(until=hasHeard)', registry).head.args.until, 'hasHeard');
		assert.equal(parseArcText('wait(until=isNear(me, Cottage))', registry).head.args.until, 'isNear(me, Cottage)');
		assert.equal(parseArcText('wander(until=hasHeard)', registry).head.args.until, 'hasHeard');
		assert.equal(
			parseArcText('wander(until=\'some(items.filter("FireMushroom").nearby())\')', registry).head.args.until,
			'some(items.filter("FireMushroom").nearby())',
		);
		assert.equal(
			parseArc(
				'{"head":{"verb":"wander","args":{"until":"some(landmarks.filter(\\"tree\\").nearby(16))"}}}',
				registry,
			).head.args.until,
			'some(landmarks.filter("tree").nearby(16))',
		);
		assert.equal(
			parseArc(
				'{"head":{"verb":"wander","args":{"until":"isNear(me, Cottage)"}}}',
				registry,
			).head.args.until,
			'isNear(me, Cottage)',
		);
	});

	it('takes the last {"head" out of a CoT essay', () => {
		const registry = verbs();
		const arc = parseArc(
			'The user wants me to act.\n'
			+ 'Example: {"head":{"verb":"go_to","args":{"target":"EastGate"}}}\n'
			+ 'Final: {"head":{"verb":"follow","args":{"target":"Player"}}}',
			registry,
		);
		assert.equal(arc.head.verb, 'follow');
		assert.equal(arc.head.args.target, 'Player');
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
			['go_to', 'follow', 'flee', 'wander', 'say'],
		);
	});

	it('parses grouped (A && B) || C', () => {
		const arc = parseArcText(
			'(go_to(Keep) && wait(seconds=1)) || say(fail.reason)',
			verbs(),
		);
		assert.ok(arc.group);
		assert.equal(arc.group?.head?.verb, 'go_to');
		assert.equal(arc.then?.join, 'then_if_err');
		assert.equal(arc.then?.arc.head?.verb, 'say');
		assert.equal(formatArc(arc, verbs()), '(go_to(Keep) && wait(1)) || say(fail.reason)');
	});

	it('registers the full stock set when called with no verbs', () => {
		const verbs = registerStockVerbs(new VerbRegistry());
		assert.equal(verbs.list().length, STOCK_VERBS.length + STOCK_TRADE_VERBS.length);
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
		verbs.remove('follow', 'flee', 'wander');
		assert.deepEqual(verbs.list().map((v) => v.name), ['go_to']);
		verbs.remove();
		assert.ok(verbs.has('go_to'));
	});
});

describe('kit views and issue(who)', () => {
	function fightKit():VerbRegistry {
		const catalog = registerStockCollectiveVerbs(registerStockVerbs(new VerbRegistry()));
		catalog.add('hex', { args: { target: 'id' } });
		catalog.add('smite', { args: { target: 'id' } });
		return catalog.view(['issue', 'go_to', 'smite']);
	}

	it('parses unit verbs inside issue(who) that the kit does not grant the thinker', () => {
		const kit = fightKit();
		const arc = parseArcText(
			'issue(who=units.filter("Witch"), arc=hex("Healer")) ; smite("Healer")',
			kit,
		);
		assert.equal(arc.head.verb, 'issue');
		const inner = arc.head.args.arc as { head:{ verb:string; args:{ target:string } } };
		assert.equal(inner.head.verb, 'hex');
		assert.equal(inner.head.args.target, 'Healer');
		assert.equal(arc.then?.join, 'then');
		assert.equal(arc.then?.arc.head.verb, 'smite');
		assert.throws(() => parseArcText('hex("Healer")', kit), /unknown verb 'hex'/);
	});

	it('names an argument written after the closing parenthesis', () => {
		const verbs = registerStockVerbs(new VerbRegistry());
		assert.throws(() => parseArcText('say(text="Hi") to=BridgeKeeper', verbs), /to is outside the parentheses/);
		assert.throws(() => parseArcText('say("Hi") to BridgeKeeper', verbs), /to is outside the parentheses/);
	});

	it('reads a verb and one bare name with no parentheses as its first arg', () => {
		const verbs = registerStockVerbs(new VerbRegistry());
		assert.deepEqual(parseArcText('go_to BridgeKeeper', verbs).head, { verb: 'go_to', args: { target: 'BridgeKeeper' } });
		const chain = parseArcText('go_to BridgeKeeper && say(Hi, to=BridgeKeeper)', verbs);
		assert.equal(chain.then?.arc.head.verb, 'say');
		assert.deepEqual(parseArcText('wander', verbs).head, { verb: 'wander', args: {} });
	});

	it('drops a stuttered key= the model repeated inside its own value', () => {
		const verbs = registerStockVerbs(new VerbRegistry());
		const arc = parseArcText('say(text=text="How much?", to=BridgeKeeper)', verbs);
		assert.deepEqual(arc.head.args, { text: 'How much?', to: 'BridgeKeeper' });
	});

	it('hoists then off issue args when the model nests the join there', () => {
		const kit = fightKit();
		const arc = parseArc({
			head: {
				verb: 'issue',
				args: {
					who: 'Brune',
					arc: { head: { verb: 'hex', args: { target: 'Healer' } } },
					then: {
						join: 'then',
						arc: {
							head: {
								verb: 'issue',
								args: {
									who: 'Cade',
									arc: { head: { verb: 'hex', args: { target: 'Witch' } } },
								},
							},
						},
					},
				},
			},
		}, kit);
		assert.equal(arc.head.args.who, 'Brune');
		assert.equal(arc.then?.join, 'then');
		assert.equal(arc.then?.arc.head.verb, 'issue');
		assert.equal(arc.then?.arc.head.args.who, 'Cade');
		assert.equal(
			formatArc(arc, kit),
			'issue(who=Brune, arc=hex(Healer)) ; issue(who=Cade, arc=hex(Witch))',
		);
	});

	it('parses a truncated issue chain from CoT JSON', () => {
		const catalog = registerStockCollectiveVerbs(registerStockVerbs(new VerbRegistry()));
		catalog.add('slash', { args: { target: 'id' } });
		catalog.add('cleave', { args: { target: 'id' } });
		const kit = catalog.view(['issue', 'loop', 'slash', 'cleave']);
		const raw = '{"head":{"verb":"issue","args":{"who":"allUnits","arc":{"head":{"verb":"loop","args":{"arc":{"head":{"verb":"slash","args":{"target":"Blade"}}}}}}},"then":{"join":"then_if_ok","arc":{"head":{"verb":"issue","args":{"who":"allUnits","arc":{"head":{"verb":"loop","args":{"arc":{"head":{"verb":"cleave","args":{"target":"Knight"}}}}}}}}}}';
		const arc = parseArc(raw, kit);
		assert.equal(arc.head.args.who, 'allUnits');
		assert.equal(arc.then?.arc.head.args.who, 'allUnits');
		assert.equal(
			formatArc(arc, kit),
			'issue(who=allUnits, arc=loop(slash(Blade))) && issue(who=allUnits, arc=loop(cleave(Knight)))',
		);
	});

	it('parses a JSON bag of issue() / when() strings', () => {
		const catalog = registerStockCollectiveVerbs(registerStockVerbs(new VerbRegistry()));
		catalog.add('hex', { args: { target: 'id' } });
		const kit = catalog.view(['issue', 'when', 'go_to', 'hex']);
		const arc = parseArc({
			issue: [
				'issue(who=units.filter("Witch"), arc=hex("Healer"))',
				'issue(who=units.filter("Archer"), arc=hex("Witch"))',
			],
			when: 'when(isHurt(me), go_to(Keep))',
		}, kit);
		assert.equal(arc.head.verb, 'issue');
		assert.equal(arc.head.args.who, 'units.filter("Witch")');
		assert.equal(arc.then?.arc.head.verb, 'issue');
		assert.equal(arc.then?.arc.then?.arc.head.verb, 'when');
		assert.equal(
			formatArc(arc, kit),
			'issue(who=units.filter("Witch"), arc=hex(Healer)) ; issue(who=units.filter("Archer"), arc=hex(Witch)) ; when(watch=isHurt(me), arc=go_to(Keep))',
		);
		const wrapped = parseArc(
			'{"issue":"issue(who=units.filter(\\"Witch\\"), arc=hex(Healer))","when":"when(isHurt(me), go_to(Keep))"}',
			kit,
		);
		assert.equal(wrapped.head.verb, 'issue');
		assert.equal(wrapped.then?.arc.head.verb, 'when');
	});

	it('parses long chains; nested arc= is a separate tree', () => {
		const kit = fightKit();
		const arc = parseArcText(
			'issue(who=units.filter("Witch"), arc=hex("Healer")) '
			+ '; issue(who=units.filter("Archer"), arc=hex("Witch")) '
			+ '; issue(who=units.filter("Knight"), arc=hex("Archer")) '
			+ '; issue(who=units.filter("Blade"), arc=hex("Blade")) '
			+ '; smite("Healer")',
			kit,
		);
		assert.equal(arc.head.verb, 'issue');
		assert.equal(arc.then?.arc.then?.arc.then?.arc.then?.arc.head.verb, 'smite');
		const long = parseArcText(
			'go_to(A) && go_to(B) && go_to(C) && go_to(D) && go_to(E)',
			kit,
		);
		assert.equal(long.head.verb, 'go_to');
		assert.equal(long.then?.arc.then?.arc.then?.arc.then?.arc.head.args.target, 'E');
	});

	it('skips extra closing parens between joined issue() steps', () => {
		const kit = fightKit();
		const arc = parseArcText(
			'issue(who=units.filter("Knight"), arc=loop(hex(Healer)))))) ; issue(who=units.filter("Blade"), arc=loop(hex(Witch)))',
			kit,
		);
		assert.equal(arc.head.verb, 'issue');
		assert.equal(arc.head.args.who, 'units.filter("Knight")');
		assert.equal(arc.then?.join, 'then');
		assert.equal(arc.then?.arc.head.args.who, 'units.filter("Blade")');
	});

	it('skips a trailing period after copied Example text', () => {
		const kit = fightKit();
		const arc = parseArcText(
			'issue(who=units.filter("Knight"), arc=loop(hex(Healer))) ; issue(who=units.filter("Blade"), arc=loop(hex(Witch))).',
			kit,
		);
		assert.equal(arc.head.verb, 'issue');
		assert.equal(arc.then?.arc.head.args.who, 'units.filter("Blade")');
		assert.equal(arc.then?.arc.then, undefined);
	});

	it('binds a leftover positional to the next unset law arg', () => {
		const registry = registerStockCollectiveVerbs(registerStockVerbs(new VerbRegistry()));
		const arc = parseArcText(
			'law(who=units, watch=isHurt(me), go_to(Keep), name=lastStand)',
			registry,
		);
		assert.equal(arc.head.verb, 'law');
		assert.equal(arc.head.args.who, 'units');
		assert.equal(arc.head.args.watch, 'isHurt(me)');
		assert.equal(arc.head.args.name, 'lastStand');
		const inner = arc.head.args.arc as { head:{ verb:string; args:{ target:string } } };
		assert.equal(inner.head.verb, 'go_to');
		assert.equal(inner.head.args.target, 'Keep');
	});
});

describe('small-model slips from the AI logs', () => {
	it('reads block layout: args one per line, each ending in a comma, and ) alone', () => {
		const arc = parseArcText('loop(\n\tchoose(\n\t\t"Hold the gate",\n\t\tgo_to(Keep),\n\t\tgate=go_to(EastGate),\n\t),\n)\nwander(\n\tuntil=done,\n)', verbs());
		assert.equal(arc.head.verb, 'loop');
		assert.deepEqual(Object.keys(arc.head.args.arc as object), ['head']);
		assert.equal(arc.then?.join, 'then', 'a new line joins like ;');
		assert.equal(arc.then?.arc.head.args.until, 'done');
	});

	it('reads a C-style ; between args as a comma, and refuses an arg given twice', () => {
		const arc = parseArcText('wander(\n\tuntil=done;\n\tseconds=5;\n)', verbs());
		assert.equal(arc.head.args.until, 'done');
		assert.equal(arc.head.args.seconds, 5);
		assert.throws(() => parseArcText('wander(until=done; until=ready)', verbs()), /got until= twice/);
	});

	it('reads prose with commas and apostrophes as one text arg', () => {
		const arc = parseArcText(
			"think(I have the FireMushroom from the Forager. According to my rules, I must use BridgeKeeper's crank.)use(item=BridgeCrank, target=BridgeLever)",
			verbs(),
		);
		assert.equal(arc.head.verb, 'think');
		assert.equal(arc.head.args.about, "I have the FireMushroom from the Forager. According to my rules, I must use BridgeKeeper's crank.");
		assert.equal(arc.then?.join, 'then');
		assert.equal(arc.then?.arc.head.args.target, 'BridgeLever');
	});

	it('ends raw text at the next named arg of the verb', () => {
		const raw = parseArcText('say(Hello there, friend, to=Player) ; go_to(BridgeKeeper)', verbs());
		assert.equal(raw.head.args.text, 'Hello there, friend');
		assert.equal(raw.head.args.to, 'Player');
		assert.equal(raw.then?.arc.head.verb, 'go_to');
		const named = parseArcText("think(about=Check BridgeKeeper's stall (the big one)) ; go_to(BridgeKeeper)", verbs());
		assert.equal(named.head.args.about, "Check BridgeKeeper's stall (the big one)");
		assert.equal(named.then?.arc.head.verb, 'go_to');
		const quoted = parseArcText('say("Wait :) here", to=Player)', verbs());
		assert.equal(quoted.head.args.text, 'Wait :) here');
		assert.equal(quoted.head.args.to, 'Player');
		assert.equal(parseArcText("say('I don't know')", verbs()).head.args.text, "I don't know");
		assert.equal(parseArcText('say(Hello, Player)', verbs()).head.args.text, 'Hello, Player');
	});

	it('closes what the model left open at the end', () => {
		const arc = parseArcText('go_to(BridgeKeeper) && give(item=FireMushroom, to=BridgeKeeper', verbs());
		assert.equal(arc.then?.arc.head.args.to, 'BridgeKeeper');
		assert.equal(parseArcText('say("Good day', verbs()).head.args.text, 'Good day');
		assert.equal(parseArcText('(go_to(BridgeKeeper) && wait(seconds=2)', verbs()).group?.then?.arc.head.verb, 'wait');
		assert.throws(() => parseArcText('go_to(', verbs()), /missing required arg 'target'/);
	});

	it('still rejects an issue cut off before its arc, and an issue swallowed by the one before it', () => {
		const crowd = registerStockCollectiveVerbs(verbs());
		crowd.add('slash', { args: { target: 'id' } });
		assert.throws(
			() => parseArcText('issue(who=units.filter("Witch"), arc=loop(slash(Foe))) ; issue(who', crowd),
			/missing required arg 'arc'/,
		);
		assert.throws(
			() => parseArcText('issue(who=units.filter("Blade"), arc=loop(slash(Foe)) ; issue(who=units.filter("Witch"), arc=loop(slash(Foe)))', crowd),
			/issue inside an issue arc/,
		);
	});

	it('drops a join with nothing after it, and refuses a half-written expression', () => {
		const arc = parseArcText('go_to(BridgeKeeper) && give(item=FireMushroom, to=BridgeKeeper) ;', verbs());
		assert.equal(arc.then?.arc.then, undefined);
		assert.throws(
			() => parseArcText('wander(until=some(items.filter("FireMushroom"', verbs()),
			/expression cut off/,
		);
	});

	it('prints a lone arg bare only where the parser reads a positional one', () => {
		for (const text of ['wait(until=Player)', 'wait(5)', 'go_to(BridgeKeeper)', 'wander(seconds=5)']) {
			assert.equal(formatArc(parseArcText(text, verbs()), verbs()), text);
		}
		assert.equal(formatArc(parseArcText('go_to(BridgeKeeper)', verbs())), 'go_to(target=BridgeKeeper)');
	});

	it('drops a stray comma after extra closers', () => {
		const crowd = registerStockCollectiveVerbs(verbs());
		crowd.add('slash', { args: { target: 'id' } });
		const arc = parseArcText(
			'issue(who=units.filter("Blade"), arc=loop(slash(Foe)))), ; issue(who=units.filter("Witch"), arc=loop(slash(Foe)))',
			crowd,
		);
		assert.equal(arc.then?.arc.head.args.who, 'units.filter("Witch")');
	});
});

describe('choose', () => {
	it('reads named choices, each an arc, in order', () => {
		const arc = parseArcText(
			'choose(goal="hold the gate", hold=go_to(EastGate) && wait(), chase=follow(Raider), stand=wait())',
			verbs(),
		);
		const args = arc.head.args;
		assert.equal(arc.head.verb, 'choose');
		assert.equal(args.goal, 'hold the gate');
		assert.deepEqual(Object.keys(args), ['goal', 'hold', 'chase', 'stand']);
		const hold = args.hold as Arc;
		assert.equal(hold.head.verb, 'go_to');
		assert.equal(hold.then?.join, 'then_if_ok');
		assert.equal(hold.then?.arc.head.verb, 'wait');
	});

	it('names a bare choice after its verb and first id, numbering repeats', () => {
		const arc = parseArcText('choose("hold", go_to(EastGate), wait(), wait())', verbs());
		assert.equal(arc.head.args.goal, 'hold');
		assert.deepEqual(Object.keys(arc.head.args), ['goal', 'go_to_EastGate', 'wait', 'wait_2']);
	});

	it('keeps ; inside one choice as then', () => {
		const arc = parseArcText('choose(goal=greet them, hi=wait() ; say("hi"), no=wait())', verbs());
		assert.equal(arc.head.args.goal, 'greet them');
		assert.equal((arc.head.args.hi as Arc).then?.join, 'then');
		assert.deepEqual(Object.keys(arc.head.args), ['goal', 'hi', 'no']);
	});

	it('round-trips through formatArc', () => {
		const text = 'choose("hold the gate", hold=go_to(EastGate) && wait(), follow(Raider), wait_2=wait())';
		const arc = parseArcText(text, verbs());
		assert.equal(formatArc(arc, verbs()), text);
		assert.deepEqual(parseArcText(formatArc(arc, verbs()), verbs()), arc);
	});

	it('nests in loop with until', () => {
		const arc = parseArcText('loop(choose("hold", a=wait(), b=go_to(EastGate)), until=isHurt(me))', verbs());
		assert.equal(arc.head.verb, 'loop');
		assert.equal((arc.head.args.arc as Arc).head.verb, 'choose');
		assert.equal(arc.head.args.until, 'isHurt(me)');
	});

	it('reads the JSON form', () => {
		const arc = parseArc({
			head: { verb: 'choose', args: { goal: 'hold', stand: { head: { verb: 'wait', args: {} } } } },
		}, verbs());
		assert.equal((arc.head.args.stand as Arc).head.verb, 'wait');
	});

	it('rejects a choose without goal, without choices, or with a reserved or repeated name', () => {
		assert.throws(() => parseArcText('choose(a=wait())', verbs()), ArcError);
		assert.throws(() => parseArcText('choose("hold")', verbs()), ArcError);
		assert.throws(() => parseArcText('choose("hold", until=wait())', verbs()), ArcError);
		assert.throws(() => parseArcText('choose("hold", a=wait(), a=go_to(EastGate))', verbs()), ArcError);
		assert.throws(() => parseArcText('choose("hold", a=hold the gate)', verbs()), ArcError);
		const many = Array.from({ length: 256 }, (_, n) => `c${n}=wait()`).join(', ');
		assert.throws(() => parseArcText(`choose("hold", ${many})`, verbs()), ArcError);
	});

	it('leaves every other verb closed to unknown keys', () => {
		assert.throws(() => parseArcText('wait(hold=wait())', verbs()), ArcError);
		assert.throws(() => parseArc({ head: { verb: 'wait', args: { hold: { head: { verb: 'wait', args: {} } } } } }, verbs()), ArcError);
	});

	it('lets the JSON schema carry named choices only when choose is registered', () => {
		const args = (registry:VerbRegistry):unknown => {
			const schema = arcSchema(registry) as { $defs:{ step:{ properties:{ args:{ additionalProperties:unknown } } } } };
			return schema.$defs.step.properties.args.additionalProperties;
		};
		assert.equal(args(registerStockVerbs(new VerbRegistry(), 'wait')), false);
		assert.deepEqual(args(verbs()), { $ref: '#/$defs/arc' });
	});

	it('keeps the arc schema small by recursing through $defs', () => {
		assert.ok(JSON.stringify(arcSchema(verbs())).length < 20_000);
		const kit = registerStockCollectiveVerbs(registerStockVerbs(new VerbRegistry())).view(['issue', 'wait']);
		const schema = arcSchema(kit);
		assert.deepEqual(Object.keys(schema.$defs ?? {}), ['arc', 'step', 'nestedArc', 'nestedStep']);
	});
});
