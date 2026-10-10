import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseArcText, formatArc } from './parse.js';
import { VerbRegistry, registerStockVerbs, STOCK_MOVE_VERBS, STOCK_TRADE_VERBS, STOCK_VERBS } from './stock-verbs.js';
import { registerStockCollectiveVerbs } from '../collective/verbs.js';
import { ArcError, isArc, type Arc } from './types.js';

function verbs():VerbRegistry {
	return registerStockVerbs(new VerbRegistry());
}

function inner(arc:Arc, at = 0):Arc {
	return arc[at].args.arc as Arc;
}

describe('Arc parse', () => {
	it('parses sequenced text form', () => {
		const arc = parseArcText(
			'go_to(EastGate) && use(item=BrassKey, target=EastGate) ; say("After you.")',
			verbs(),
		);
		assert.equal(arc[0].verb, 'go_to');
		assert.equal(arc[0].args.target, 'EastGate');
		assert.equal(arc[0].then, undefined, '&& is the default join and is not written down');
		assert.equal(arc[1].verb, 'use');
		assert.equal(arc[1].args.item, 'BrassKey');
		assert.equal(arc[1].then, 'always');
		assert.equal(arc[2].args.text, 'After you.');
		assert.equal(arc[2].then, undefined);
		assert.equal(
			formatArc(arc, verbs()),
			'go_to(EastGate) && use(item=BrassKey, target=EastGate) ; say("After you.")',
		);
	});

	it('maps && ; || and a new line to if_ok, always, if_failed and always', () => {
		const arc = parseArcText('go_to(A) && wait() ; say(Hi) || go_to(B)\nwait()', verbs());
		assert.deepEqual(arc.map((step) => step.then), [undefined, 'always', 'if_failed', 'always', undefined]);
	});

	it('formats wander until as a named expr, not a JSON string', () => {
		const arc = parseArcText(
			'wander(until=some(landmarks.filter("waterfall").nearby()))',
			verbs(),
		);
		assert.equal(arc[0].args.until, 'some(landmarks.filter("waterfall").nearby())');
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
		assert.equal(arc[0].verb, 'issue');
		assert.equal(arc[0].args.who, 'units.filter("Guard")');
		assert.deepEqual(inner(arc).map((step) => step.verb), ['go_to', 'wait']);
		assert.equal(inner(arc)[0].args.target, 'Keep');
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

	it('rejects unknown verbs and reads think, wait and wander args', () => {
		const registry = verbs();
		assert.throws(
			() => parseArcText('fly(EastGate)', registry),
			ArcError,
		);
		assert.equal(parseArcText('think("how to open EastGate")', registry)[0].args.about, 'how to open EastGate');
		assert.deepEqual(parseArcText('think()', registry)[0].args, {});
		assert.equal(parseArcText('wait(until=hasHeard)', registry)[0].args.until, 'hasHeard');
		assert.equal(parseArcText('wait(until=isNear(me, Cottage))', registry)[0].args.until, 'isNear(me, Cottage)');
		assert.equal(parseArcText('wander(until=hasHeard)', registry)[0].args.until, 'hasHeard');
		assert.equal(
			parseArcText('wander(until=\'some(items.filter("FireMushroom").nearby())\')', registry)[0].args.until,
			'some(items.filter("FireMushroom").nearby())',
		);
	});
});

describe('isArc', () => {
	it('is a non-empty list of { verb, args } steps', () => {
		assert.equal(isArc([{ verb: 'wait', args: {} }]), true);
		assert.equal(isArc([{ verb: 'group', args: { arc: [{ verb: 'wait', args: {} }] } }, { verb: 'wait', args: {}, then: 'always' }]), true);
		for (const not of [[], ['Able', 'Baker'], [{ verb: 'wait' }], [{ args: {} }], { verb: 'wait', args: {} }, 'wait()', null, undefined, 3]) {
			assert.equal(isArc(not), false, JSON.stringify(not));
		}
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

	it('parses grouped (A && B) || C, and the group uses the same kit', () => {
		const arc = parseArcText(
			'(go_to(Keep) && wait(seconds=1)) || say(fail.reason)',
			verbs(),
		);
		assert.equal(arc[0].verb, 'group');
		assert.deepEqual(inner(arc).map((step) => step.verb), ['go_to', 'wait']);
		assert.equal(arc[0].then, 'if_failed');
		assert.equal(arc[1].verb, 'say');
		assert.equal(formatArc(arc, verbs()), '(go_to(Keep) && wait(1)) || say(fail.reason)');
		assert.throws(() => parseArcText('(go_to(Keep) && hex(Healer))', verbs()), /unknown verb 'hex'/);
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

	it('keeps the group verb and the step keys verb and then out of verbs', () => {
		assert.throws(() => new VerbRegistry().add('group'), /not a verb/);
		assert.throws(() => new VerbRegistry().add('rest', { args: { verb: 'string' } }), /reserved/);
		assert.throws(() => new VerbRegistry().add('rest', { args: { then: 'string' } }), /reserved/);
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
		assert.equal(arc[0].verb, 'issue');
		assert.equal(inner(arc)[0].verb, 'hex');
		assert.equal(inner(arc)[0].args.target, 'Healer');
		assert.equal(arc[0].then, 'always');
		assert.equal(arc[1].verb, 'smite');
		assert.throws(() => parseArcText('hex("Healer")', kit), /unknown verb 'hex'/);
	});

	it('reads a group inside issue(who) with the catalog, not the kit', () => {
		const kit = fightKit();
		const arc = parseArcText('issue(who=units, arc=(hex(Healer) ; go_to(Keep)))', kit);
		assert.deepEqual(inner(inner(arc)).map((step) => step.verb), ['hex', 'go_to']);
	});

	it('names an argument written after the closing parenthesis', () => {
		const verbs = registerStockVerbs(new VerbRegistry());
		assert.throws(() => parseArcText('say(text="Hi") to=BridgeKeeper', verbs), /to is outside the parentheses/);
		assert.throws(() => parseArcText('say("Hi") to BridgeKeeper', verbs), /to is outside the parentheses/);
	});

	it('reads a verb and one bare name with no parentheses as its first arg', () => {
		const verbs = registerStockVerbs(new VerbRegistry());
		assert.deepEqual(parseArcText('go_to BridgeKeeper', verbs), [{ verb: 'go_to', args: { target: 'BridgeKeeper' } }]);
		const chain = parseArcText('go_to BridgeKeeper && say(Hi, to=BridgeKeeper)', verbs);
		assert.equal(chain[1].verb, 'say');
		assert.deepEqual(parseArcText('wander', verbs), [{ verb: 'wander', args: {} }]);
	});

	it('drops a stuttered key= the model repeated inside its own value', () => {
		const verbs = registerStockVerbs(new VerbRegistry());
		const arc = parseArcText('say(text=text="How much?", to=BridgeKeeper)', verbs);
		assert.deepEqual(arc[0].args, { text: 'How much?', to: 'BridgeKeeper' });
	});

	it('parses long chains; nested arc= is a separate list', () => {
		const kit = fightKit();
		const arc = parseArcText(
			'issue(who=units.filter("Witch"), arc=hex("Healer")) '
			+ '; issue(who=units.filter("Archer"), arc=hex("Witch")) '
			+ '; issue(who=units.filter("Knight"), arc=hex("Archer")) '
			+ '; issue(who=units.filter("Blade"), arc=hex("Blade")) '
			+ '; smite("Healer")',
			kit,
		);
		assert.deepEqual(arc.map((step) => step.verb), ['issue', 'issue', 'issue', 'issue', 'smite']);
		const long = parseArcText(
			'go_to(A) && go_to(B) && go_to(C) && go_to(D) && go_to(E)',
			kit,
		);
		assert.equal(long.length, 5);
		assert.equal(long[4].args.target, 'E');
	});

	it('skips extra closing parens between joined issue() steps', () => {
		const kit = fightKit();
		const arc = parseArcText(
			'issue(who=units.filter("Knight"), arc=loop(hex(Healer)))))) ; issue(who=units.filter("Blade"), arc=loop(hex(Witch)))',
			kit,
		);
		assert.equal(arc[0].verb, 'issue');
		assert.equal(arc[0].args.who, 'units.filter("Knight")');
		assert.equal(arc[0].then, 'always');
		assert.equal(arc[1].args.who, 'units.filter("Blade")');
	});

	it('skips a trailing period after copied Example text', () => {
		const kit = fightKit();
		const arc = parseArcText(
			'issue(who=units.filter("Knight"), arc=loop(hex(Healer))) ; issue(who=units.filter("Blade"), arc=loop(hex(Witch))).',
			kit,
		);
		assert.equal(arc.length, 2);
		assert.equal(arc[1].args.who, 'units.filter("Blade")');
		assert.equal(arc[1].then, undefined);
	});

	it('binds a leftover positional to the next unset law arg', () => {
		const registry = registerStockCollectiveVerbs(registerStockVerbs(new VerbRegistry()));
		const arc = parseArcText(
			'law(who=units, watch=isHurt(me), go_to(Keep), name=lastStand)',
			registry,
		);
		assert.equal(arc[0].verb, 'law');
		assert.equal(arc[0].args.who, 'units');
		assert.equal(arc[0].args.watch, 'isHurt(me)');
		assert.equal(arc[0].args.name, 'lastStand');
		assert.equal(inner(arc)[0].verb, 'go_to');
		assert.equal(inner(arc)[0].args.target, 'Keep');
	});
});

describe('small-model slips from the AI logs', () => {
	it('reads block layout: args one per line, each ending in a comma, and ) alone', () => {
		const arc = parseArcText('loop(\n\tchoose(\n\t\t"Hold the gate",\n\t\tgo_to(Keep),\n\t\tgate=go_to(EastGate),\n\t),\n)\nwander(\n\tuntil=done,\n)', verbs());
		assert.equal(arc[0].verb, 'loop');
		assert.equal(inner(arc).length, 1);
		assert.equal(arc[0].then, 'always', 'a new line joins like ;');
		assert.equal(arc[1].args.until, 'done');
	});

	it('reads a C-style ; between args as a comma, and refuses an arg given twice', () => {
		const arc = parseArcText('wander(\n\tuntil=done;\n\tseconds=5;\n)', verbs());
		assert.equal(arc[0].args.until, 'done');
		assert.equal(arc[0].args.seconds, 5);
		assert.throws(() => parseArcText('wander(until=done; until=ready)', verbs()), /got until= twice/);
	});

	it('reads prose with commas and apostrophes as one text arg', () => {
		const arc = parseArcText(
			"think(I have the FireMushroom from the Forager. According to my rules, I must use BridgeKeeper's crank.)use(item=BridgeCrank, target=BridgeLever)",
			verbs(),
		);
		assert.equal(arc[0].verb, 'think');
		assert.equal(arc[0].args.about, "I have the FireMushroom from the Forager. According to my rules, I must use BridgeKeeper's crank.");
		assert.equal(arc[0].then, 'always');
		assert.equal(arc[1].args.target, 'BridgeLever');
	});

	it('ends raw text at the next named arg of the verb', () => {
		const raw = parseArcText('say(Hello there, friend, to=Player) ; go_to(BridgeKeeper)', verbs());
		assert.equal(raw[0].args.text, 'Hello there, friend');
		assert.equal(raw[0].args.to, 'Player');
		assert.equal(raw[1].verb, 'go_to');
		const named = parseArcText("think(about=Check BridgeKeeper's stall (the big one)) ; go_to(BridgeKeeper)", verbs());
		assert.equal(named[0].args.about, "Check BridgeKeeper's stall (the big one)");
		assert.equal(named[1].verb, 'go_to');
		const quoted = parseArcText('say("Wait :) here", to=Player)', verbs());
		assert.equal(quoted[0].args.text, 'Wait :) here');
		assert.equal(quoted[0].args.to, 'Player');
		assert.equal(parseArcText("say('I don't know')", verbs())[0].args.text, "I don't know");
		assert.equal(parseArcText('say(Hello, Player)', verbs())[0].args.text, 'Hello, Player');
	});

	it('closes what the model left open at the end', () => {
		const arc = parseArcText('go_to(BridgeKeeper) && give(item=FireMushroom, to=BridgeKeeper', verbs());
		assert.equal(arc[1].args.to, 'BridgeKeeper');
		assert.equal(parseArcText('say("Good day', verbs())[0].args.text, 'Good day');
		assert.equal(inner(parseArcText('(go_to(BridgeKeeper) && wait(seconds=2)', verbs()))[1].verb, 'wait');
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
		assert.equal(arc.length, 2);
		assert.equal(arc[1].then, undefined);
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
		assert.equal(arc[1].args.who, 'units.filter("Witch")');
	});
});

describe('choose', () => {
	it('reads named choices, each an arc, in order', () => {
		const arc = parseArcText(
			'choose(goal="hold the gate", hold=go_to(EastGate) && wait(), chase=follow(Raider), stand=wait())',
			verbs(),
		);
		const args = arc[0].args;
		assert.equal(arc[0].verb, 'choose');
		assert.equal(args.goal, 'hold the gate');
		assert.deepEqual(Object.keys(args), ['goal', 'hold', 'chase', 'stand']);
		const hold = args.hold as Arc;
		assert.deepEqual(hold.map((step) => step.verb), ['go_to', 'wait']);
		assert.equal(hold[0].then, undefined);
	});

	it('names a bare choice after its verb and first id, numbering repeats', () => {
		const arc = parseArcText('choose("hold", go_to(EastGate), wait(), wait())', verbs());
		assert.equal(arc[0].args.goal, 'hold');
		assert.deepEqual(Object.keys(arc[0].args), ['goal', 'go_to_EastGate', 'wait', 'wait_2']);
	});

	it('keeps ; inside one choice as always', () => {
		const arc = parseArcText('choose(goal=greet them, hi=wait() ; say("hi"), no=wait())', verbs());
		assert.equal(arc[0].args.goal, 'greet them');
		assert.equal((arc[0].args.hi as Arc)[0].then, 'always');
		assert.deepEqual(Object.keys(arc[0].args), ['goal', 'hi', 'no']);
	});

	it('round-trips through formatArc', () => {
		const text = 'choose("hold the gate", hold=go_to(EastGate) && wait(), follow(Raider), wait_2=wait())';
		const arc = parseArcText(text, verbs());
		assert.equal(formatArc(arc, verbs()), text);
		assert.deepEqual(parseArcText(formatArc(arc, verbs()), verbs()), arc);
	});

	it('nests in loop with until', () => {
		const arc = parseArcText('loop(choose("hold", a=wait(), b=go_to(EastGate)), until=isHurt(me))', verbs());
		assert.equal(arc[0].verb, 'loop');
		assert.equal(inner(arc)[0].verb, 'choose');
		assert.equal(arc[0].args.until, 'isHurt(me)');
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
	});
});
