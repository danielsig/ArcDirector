import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseArcText } from './arc-parse.js';
import { formatArc, formatArcBlocks } from './arc-format.js';
import { arcToJSON, parseArc } from './wire.js';
import { parse } from '../expr/expr-parse.js';
import { VerbRegistry, STOCK_VERB_DEFS, STOCK_MOVE_VERBS, STOCK_TRADE_VERBS, STOCK_VERBS } from './stock-verbs.js';
import { STOCK_COLLECTIVE_VERB_DEFS } from '../collective/collective-verbs.js';
import { ArcError, isArc, type Arc } from './arc-types.js';

function verbs():VerbRegistry {
	return new VerbRegistry().addAll(STOCK_VERB_DEFS);
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

	it('parses command who= expr and nested arc=', () => {
		const registry = new VerbRegistry().addAll(STOCK_VERB_DEFS).addAll(STOCK_COLLECTIVE_VERB_DEFS);
		const arc = parseArcText(
			'command(who=units.filter("Guard"), arc=go_to(Keep) && wait(seconds=1))',
			registry,
		);
		assert.equal(arc[0].verb, 'command');
		assert.equal(arc[0].args.who, 'units.filter("Guard")');
		assert.deepEqual(inner(arc).map((step) => step.verb), ['go_to', 'wait']);
		assert.equal(inner(arc)[0].args.target, 'Keep');
		assert.equal(formatArc(arc, registry), 'command(units.filter("Guard")) { go_to(Keep) && wait(1) }');
	});

	it('rejects when(who) and command(watch) with migration errors', () => {
		const registry = new VerbRegistry().addAll(STOCK_VERB_DEFS).addAll(STOCK_COLLECTIVE_VERB_DEFS);
		assert.throws(
			() => parseArcText('when(who=units.filter("Guard"), arc=go_to(Keep))', registry),
			/when\(who\) is command/,
		);
		assert.throws(
			() => parseArcText('command(watch=isHurt(me), arc=go_to(Keep))', registry),
			/command\(watch\) is when/,
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

describe('Arc args written as numbers', () => {
	it('keeps a number written for a text arg as its text, in Arc text and in JSON', () => {
		const registry = verbs().add('dial', { args: { code: 'string' } });
		assert.deepEqual(parseArcText('dial(code=007) ; say(text=42)', registry).map((step) => step.args), [{ code: '007' }, { text: '42' }]);
		assert.deepEqual(parseArc('{"steps":[{"verb":"dial","code":417},{"verb":"wait","seconds":2}]}', registry).map((step) => step.args), [{ code: '417' }, { seconds: 2 }]);
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

describe('VerbRegistry.addAll', () => {
	it('registers a subset when stock verb names are passed', () => {
		const verbs = new VerbRegistry().addAll(STOCK_VERB_DEFS, 'go_to', 'follow');
		assert.ok(verbs.has('go_to'));
		assert.ok(verbs.has('follow'));
		assert.equal(verbs.has('wander'), false);
		assert.equal(verbs.has('pick_up'), false);
		assert.equal(verbs.has('think'), false);
	});

	it('spreads a group and skips names already registered', () => {
		const verbs = new VerbRegistry().addAll(STOCK_VERB_DEFS, ...STOCK_MOVE_VERBS);
		verbs.addAll(STOCK_VERB_DEFS, 'go_to', 'say');
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
		const verbs = new VerbRegistry().addAll(STOCK_VERB_DEFS);
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
		const verbs = new VerbRegistry().addAll(STOCK_VERB_DEFS, ...STOCK_MOVE_VERBS);
		assert.deepEqual(verbs.view(['go_to', 'missing']).list().map((v) => v.name), ['go_to']);
		assert.equal(verbs.view(null), verbs);
		verbs.remove('follow', 'flee', 'wander');
		assert.deepEqual(verbs.list().map((v) => v.name), ['go_to']);
		verbs.remove();
		assert.ok(verbs.has('go_to'));
	});
});

describe('kit views and command(who)', () => {
	function fightKit():VerbRegistry {
		const catalog = new VerbRegistry().addAll(STOCK_VERB_DEFS).addAll(STOCK_COLLECTIVE_VERB_DEFS);
		catalog.add('hex', { args: { target: 'id' } });
		catalog.add('smite', { args: { target: 'id' } });
		return catalog.view(['command', 'go_to', 'smite']);
	}

	it('parses unit verbs inside command(who) that the kit does not grant the thinker', () => {
		const kit = fightKit();
		const arc = parseArcText(
			'command(who=units.filter("Witch"), arc=hex("Healer")) ; smite("Healer")',
			kit,
		);
		assert.equal(arc[0].verb, 'command');
		assert.equal(inner(arc)[0].verb, 'hex');
		assert.equal(inner(arc)[0].args.target, 'Healer');
		assert.equal(arc[0].then, 'always');
		assert.equal(arc[1].verb, 'smite');
		assert.throws(() => parseArcText('hex("Healer")', kit), /unknown verb 'hex'/);
	});

	it('reads an arc in brackets inside command(who) with the catalog, not the kit, as the arc itself', () => {
		const kit = fightKit();
		const arc = parseArcText('command(who=units, arc=(hex(Healer) ; go_to(Keep)))', kit);
		assert.deepEqual(inner(arc).map((step) => step.verb), ['hex', 'go_to']);
	});

	it('names an argument written after the closing parenthesis', () => {
		const verbs = new VerbRegistry().addAll(STOCK_VERB_DEFS);
		assert.throws(() => parseArcText('say(text="Hi") to=BridgeKeeper', verbs), /to is outside the parentheses/);
		assert.throws(() => parseArcText('say("Hi") to BridgeKeeper', verbs), /to is outside the parentheses/);
	});

	it('reads a verb and one bare name with no parentheses as its first arg', () => {
		const verbs = new VerbRegistry().addAll(STOCK_VERB_DEFS);
		assert.deepEqual(parseArcText('go_to BridgeKeeper', verbs), [{ verb: 'go_to', args: { target: 'BridgeKeeper' } }]);
		const chain = parseArcText('go_to BridgeKeeper && say(Hi, to=BridgeKeeper)', verbs);
		assert.equal(chain[1].verb, 'say');
		assert.deepEqual(parseArcText('wander', verbs), [{ verb: 'wander', args: {} }]);
	});

	it('reads a verb and one string with no parentheses as its first arg', () => {
		const verbs = new VerbRegistry().addAll(STOCK_VERB_DEFS);
		assert.deepEqual(parseArcText('say "Hold the line"', verbs), [{ verb: 'say', args: { text: 'Hold the line' } }]);
		const chain = parseArcText('say "Hold, the line!" && go_to(BridgeKeeper)\nsay \'On me\'', verbs);
		assert.deepEqual(chain.map((step) => step.args.text ?? step.args.target), ['Hold, the line!', 'BridgeKeeper', 'On me']);
		assert.throws(() => parseArcText('"Hold the line"', verbs), /alone is not a step/);
		assert.throws(() => parseArcText('Guard "Hold the line"', verbs), ArcError);
	});

	it('drops a stuttered key= the model repeated inside its own value', () => {
		const verbs = new VerbRegistry().addAll(STOCK_VERB_DEFS);
		const arc = parseArcText('say(text=text="How much?", to=BridgeKeeper)', verbs);
		assert.deepEqual(arc[0].args, { text: 'How much?', to: 'BridgeKeeper' });
	});

	it('parses long chains; nested arc= is a separate list', () => {
		const kit = fightKit();
		const arc = parseArcText(
			'command(who=units.filter("Witch"), arc=hex("Healer")) '
			+ '; command(who=units.filter("Archer"), arc=hex("Witch")) '
			+ '; command(who=units.filter("Knight"), arc=hex("Archer")) '
			+ '; command(who=units.filter("Blade"), arc=hex("Blade")) '
			+ '; smite("Healer")',
			kit,
		);
		assert.deepEqual(arc.map((step) => step.verb), ['command', 'command', 'command', 'command', 'smite']);
		const long = parseArcText(
			'go_to(A) && go_to(B) && go_to(C) && go_to(D) && go_to(E)',
			kit,
		);
		assert.equal(long.length, 5);
		assert.equal(long[4].args.target, 'E');
	});

	it('skips extra closing parens between joined command() steps', () => {
		const kit = fightKit();
		const arc = parseArcText(
			'command(who=units.filter("Knight"), arc=loop(hex(Healer)))))) ; command(who=units.filter("Blade"), arc=loop(hex(Witch)))',
			kit,
		);
		assert.equal(arc[0].verb, 'command');
		assert.equal(arc[0].args.who, 'units.filter("Knight")');
		assert.equal(arc[0].then, 'always');
		assert.equal(arc[1].args.who, 'units.filter("Blade")');
	});

	it('skips a trailing period after copied Example text', () => {
		const kit = fightKit();
		const arc = parseArcText(
			'command(who=units.filter("Knight"), arc=loop(hex(Healer))) ; command(who=units.filter("Blade"), arc=loop(hex(Witch))).',
			kit,
		);
		assert.equal(arc.length, 2);
		assert.equal(arc[1].args.who, 'units.filter("Blade")');
		assert.equal(arc[1].then, undefined);
	});

	it('binds a leftover positional to the next unset law arg', () => {
		const registry = new VerbRegistry().addAll(STOCK_VERB_DEFS).addAll(STOCK_COLLECTIVE_VERB_DEFS);
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
	it('refuses steps after a verb that never ends, and says how to turn the chain around', () => {
		const commander = new VerbRegistry().addAll(STOCK_VERB_DEFS).addAll(STOCK_COLLECTIVE_VERB_DEFS);
		assert.throws(() => parseArcText('follow(Valerius, distance=3) && say("These torches")', verbs()), {
			message: 'follow never ends, so say(…) after it never runs. Write go_to(Valerius) && say(…) && follow(target=Valerius, distance=3, until=…) — follow last, with an until= or within= to end it.',
		});
		assert.throws(() => parseArcText('follow(Bo) || say("a") ; wait()', verbs()), /so say\(…\) && wait\(…\) after it/);
		assert.throws(() => parseArcText('command(who=units) { follow(Bo) ; say("a") }', commander), /follow never ends/, 'what its units run');
		for (const fine of ['follow(Bo, until=done) && say("a")', 'follow(Bo, within=5s) ; say("a")', 'say("a") && follow(Bo)', 'when(danger) { follow(Bo) ; say("lost him") }']) {
			assert.doesNotThrow(() => parseArcText(fine, verbs()), fine);
		}
		assert.doesNotThrow(() => parseArcText('follow(Bo) ; say("a")', commander), 'a commander\'s own steps are orders');
	});

	it('takes braces as a named arc arg, as it takes a body', () => {
		const registry = new VerbRegistry().addAll(STOCK_VERB_DEFS).addAll(STOCK_COLLECTIVE_VERB_DEFS);
		const command = parseArcText('command(who=units, arc={\n\tloop(until=done) {\n\t\twait()\n\t}\n})', registry);
		assert.deepEqual(command, parseArcText('command(who=units) {\n\tloop(until=done) {\n\t\twait()\n\t}\n}', registry));
		const branch = parseArcText('if(cond=done, arc={ wait() }, else={ say("not yet") })', registry);
		assert.deepEqual(branch, parseArcText('if (done) { wait() } else { say("not yet") }', registry));
		assert.deepEqual(parseArcText('offer(to=Bo, give={"Egg": 2})', registry)[0].args.give, { Egg: 2 }, 'braces with key: value stay an object');
	});

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

	it('still rejects a command cut off before its arc, and a command swallowed by the one before it', () => {
		const crowd = verbs().addAll(STOCK_COLLECTIVE_VERB_DEFS);
		crowd.add('slash', { args: { target: 'id' } });
		assert.throws(
			() => parseArcText('command(who=units.filter("Witch"), arc=loop(slash(Foe))) ; command(who', crowd),
			/missing required arg 'arc'/,
		);
		assert.throws(
			() => parseArcText('command(who=units.filter("Blade"), arc=loop(slash(Foe)) ; command(who=units.filter("Witch"), arc=loop(slash(Foe)))', crowd),
			/command goes at the root/,
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
		const crowd = verbs().addAll(STOCK_COLLECTIVE_VERB_DEFS);
		crowd.add('slash', { args: { target: 'id' } });
		const arc = parseArcText(
			'command(who=units.filter("Blade"), arc=loop(slash(Foe)))), ; command(who=units.filter("Witch"), arc=loop(slash(Foe)))',
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
		const text = 'choose("hold the gate") { hold: go_to(EastGate) && wait() ; follow(Raider) ; wait_2: wait() }';
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

describe('one grammar: watches', () => {
	it('parses literals, arrays, infix is, ternary, ??', () => {
		assert.ok(parse('1 + 2'));
		assert.ok(parse('["key", "door"]'));
		assert.ok(parse('i is "door"'));
		assert.ok(parse('a ? b : c'));
		assert.ok(parse('x ?? y'));
		assert.ok(parse('p => p is "key"'));
		assert.ok(parse('matches(first(prev.verbs).reason, "locked|blocked")'));
	});

	it('reads method syntax as call syntax', () => {
		assert.deepEqual(parse('Player.isNear(me)').ast, parse('isNear(Player, me)').ast);
	});

	it('rejects this and self', () => {
		assert.throws(() => parse('this.hp'));
		assert.throws(() => parse('self'));
	});

	it('treats ?. as .', () => {
		assert.deepEqual(parse('me?.inventory').ast, parse('me.inventory').ast);
	});

	it('maps and/or/equals/===/in', () => {
		assert.deepEqual(parse('a and b').ast, parse('a && b').ast);
		assert.deepEqual(parse('a or b').ast, parse('a || b').ast);
		assert.deepEqual(parse('a equals b').ast, parse('a == b').ast);
		assert.deepEqual(parse('a === b').ast, parse('a == b').ast);
		assert.deepEqual(parse('x in y').ast, parse('y.includes(x)').ast);
	});

	it('does not treat is "key" or "door" as any-of', () => {
		const ast = parse('i is "key" or "door"');
		assert.equal(ast.ast.type, 'binary');
		if (ast.ast.type === 'binary') {
			assert.equal(ast.ast.op, '||');
		}
	});

	it('reads durations as game seconds', () => {
		assert.deepEqual(parse('prev.secondsAgo > 1.5min').ast, parse('prev.secondsAgo > 90').ast);
		assert.deepEqual(parse('2h').ast, parse('7200').ast);
		assert.throws(() => parse('isNear(me, Keep, 5m)'), /5m: distances are plain numbers; minutes are min/, 'm is meters in sight, never minutes');
	});

	it('is one expression that only asks: no steps, no named args, no bodies', () => {
		for (const text of ['go_to(A) ; wait()', 'say(text="Hi")', 'loop { wait() }', 'hasLoaf &&', 'let x = isHurt(me)']) {
			assert.throws(() => parse(text), text);
		}
	});

	it('reads comments as space', () => {
		assert.deepEqual(parse('isHurt(me) // hurt').ast, parse('isHurt(me)').ast);
		assert.deepEqual(parse('isHurt(me) /* hurt */ && some(others)').ast, parse('isHurt(me) && some(others)').ast);
	});
});

describe('one grammar: arcs', () => {
	const crowd = ():VerbRegistry => verbs().addAll(STOCK_COLLECTIVE_VERB_DEFS).add('attack', { args: { target: 'id' } });

	it('takes a verb\'s arc as a body after its call, braces on its line or the next', () => {
		const knr = parseArcText('command(units.filter("Archers")) {\n\tgo_to(Wall)\n\tattack(Wolf)\n}', crowd());
		const allman = parseArcText('command(units.filter("Archers"))\n{\n\tgo_to(Wall); attack(Wolf)\n}', crowd());
		assert.deepEqual(knr, allman);
		assert.equal(knr[0].args.who, 'units.filter("Archers")');
		assert.deepEqual(inner(knr).map((step) => [step.verb, step.then]), [['go_to', 'always'], ['attack', undefined]]);
		assert.deepEqual(parseArcText('loop { wander() }', verbs()), [{ verb: 'loop', args: { arc: [{ verb: 'wander', args: {} }] } }]);
	});

	it('reads if, else and else if, with blocks or one statement each', () => {
		const registry = crowd().add('heal', { args: { target: 'id' } }).add('revive', { args: { target: 'id' } });
		const blocks = parseArcText([
			'if (isHurt(Mira))',
			'{',
			'    heal(Mira)',
			'}',
			'else if (isDead(Mira))',
			'{',
			'    revive(Mira)',
			'    say("Get back up and fight!")',
			'}',
			'else {',
			'    say("You are not dead yet Mira, go get them!")',
			'}',
		].join('\n'), registry);
		assert.equal(blocks.length, 1);
		assert.deepEqual(blocks[0].args.cond, [{ verb: 'test', args: { watch: 'isHurt(Mira)' } }]);
		const otherwise = blocks[0].args.else as Arc;
		assert.equal(otherwise[0].verb, 'if');
		assert.deepEqual((otherwise[0].args.arc as Arc).map((step) => step.verb), ['revive', 'say']);
		assert.equal((otherwise[0].args.else as Arc)[0].args.text, 'You are not dead yet Mira, go get them!');
		const lines = parseArcText('if (isHurt(Mira))\n    heal(Mira)\nelse if (isDead(Mira))\n    revive(Mira)', registry);
		assert.equal(lines.length, 1);
		assert.equal(((lines[0].args.else as Arc)[0].args.arc as Arc)[0].verb, 'revive');
		assert.deepEqual(parseArcText('if isHurt(Mira) { heal(Mira) }', registry), parseArcText('if (isHurt(Mira)) { heal(Mira) }', registry), 'a condition without its brackets is read too');
	});

	it('drops comments outside strings, as small models write them', () => {
		const plain = parseArcText('if (pick_up(Bucket)) {\n\tgo_to(Well)\n} else {\n\tsay("No bucket.")\n}', verbs());
		const commented = parseArcText([
			'// try the bucket first',
			'if (pick_up(Bucket)) { /* got it */',
			'\tgo_to(Well) // then fill it',
			'} else {',
			'\t/* none here',
			'\t   so say so */',
			'\tsay("No bucket.")',
			'}',
		].join('\n'), verbs());
		assert.deepEqual(commented, plain);
		assert.equal(parseArcText('say("a // b /* c */")', verbs())[0].args.text, 'a // b /* c */', 'inside a string it stays');
		assert.deepEqual(parseArcText('go_to(Well) /* never closed', verbs()), parseArcText('go_to(Well)', verbs()));
	});

	it('takes a verb as a condition, and a query as a step', () => {
		const arc = parseArcText('if (pick_up(Bucket)) { go_to(Well) } else { say("No bucket.") }', verbs());
		assert.deepEqual(arc[0].args.cond, [{ verb: 'pick_up', args: { item: 'Bucket' } }]);
		const chain = parseArcText('isHurt(me) && say("Ouch") ; !some(others) || wait()', verbs());
		assert.deepEqual(chain.map((step) => step.verb), ['test', 'say', 'test', 'wait']);
		assert.equal(chain[2].args.watch, '!some(others)');
		assert.throws(() => parseArcText('fly(EastGate)', verbs()), /unknown verb 'fly'/, 'an unknown verb is still no query');
		assert.throws(() => parseArcText('isHurt(me) ? go_to(Keep) : wait()', verbs()), /a verb inside an expression/);
	});

	it('reads when with its watch bare, and choose with labeled choices', () => {
		const when = parseArcText('when !isHurt(Mira) { say("Better.") }', verbs());
		assert.equal(when[0].args.watch, '!isHurt(Mira)');
		const choose = parseArcText('choose("stay alive") {\n\tfight: go_to(Wolf)\n\tflee: {\n\t\tflee(Wolf)\n\t\tsay("Run!", to=Mira)\n\t}\n}', verbs());
		assert.deepEqual(Object.keys(choose[0].args), ['goal', 'fight', 'flee']);
		assert.deepEqual((choose[0].args.flee as Arc).map((step) => step.verb), ['flee', 'say']);
		assert.throws(() => parseArcText('fight: go_to(Wolf)', verbs()), /inside choose/);
	});

	it('takes named args with = or :, durations, and method syntax for verbs', () => {
		assert.deepEqual(parseArcText('say("Hi", to: Mira)', verbs()), parseArcText('say("Hi", to=Mira)', verbs()));
		assert.equal(parseArcText('wait(1.5min)', verbs())[0].args.seconds, 90);
		assert.equal(parseArcText('wander(seconds=20s)', verbs())[0].args.seconds, 20);
		assert.deepEqual(parseArcText('Keep.go_to()', verbs()), parseArcText('go_to(Keep)', verbs()));
	});

	it('names a step\'s result with let, once in its arc', () => {
		const arc = parseArcText('let picked = pick_up(Key)\nif (picked) { go_to(Door) }', verbs());
		assert.equal(arc[0].let, 'picked');
		assert.deepEqual(arc[1].args.cond, [{ verb: 'test', args: { watch: 'picked' } }]);
		assert.equal(parseArcText('let both = pick_up(Key) && go_to(Door)', verbs())[0].verb, 'group', 'a chain is one step');
		assert.throws(() => parseArcText('let x = pick_up(Key) ; let x = go_to(Door)', verbs()), /let x twice/);
		assert.throws(() => parseArcText('let x = pick_up(Key) ; loop { let x = wait() }', verbs()), /let x twice/, 'an inner arc sees the outer name');
		assert.doesNotThrow(() => parseArcText('loop { let x = wait() } ; let x = go_to(Door)', verbs()), 'a name ends with its arc');
		assert.throws(() => parseArcText('let me = wait()', verbs()), /let me/);
	});

	it('writes bodies, if, let and choices back as it reads them, indented in block layout', () => {
		const registry = crowd();
		const text = 'let ok = pick_up(Key) ; if (ok) { go_to(Door) } else { say("It is locked.") } ; command(units) { loop { attack(Wolf) } }';
		const arc = parseArcText(text, registry);
		assert.equal(formatArc(arc, registry), text);
		assert.deepEqual(parseArcText(formatArcBlocks(arc, registry), registry), arc);
		assert.equal(formatArcBlocks(arc, registry), [
			'let ok = pick_up(Key)',
			'if (ok) {',
			'\tgo_to(Door)',
			'} else {',
			'\tsay("It is locked.")',
			'}',
			'command(units) {',
			'\tloop {',
			'\t\tattack(Wolf)',
			'\t}',
			'}',
		].join('\n'));
		assert.deepEqual(parseArc(JSON.stringify(arcToJSON(arc)), registry), arc, 'the same tree in Arc JSON');
	});

	it('sends back prose, and a quoted line with no verb, instead of running nothing', () => {
		assert.throws(() => parseArcText('I see four foes. say("Charge!")', verbs()), /expected verb/);
		assert.throws(() => parseArcText('"Charge, my friends!"\ngo_to(Keep)', verbs()), /alone is not a step: say/);
		assert.equal(parseArcText('if (true) { wait() }', verbs())[0].verb, 'if', 'a literal is a condition still');
	});
});
