import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseArcText, formatArc, formatArcBlocks } from './arc-parse.js';
import { arcFromJSON, arcJSONBlocks, arcJSONText, arcSoFar, finishedSteps, arcToJSON, parseArc, replyBreakdown } from './wire.js';
import { replySchema } from './schema.js';
import { VerbRegistry, STOCK_VERB_DEFS } from './stock-verbs.js';
import { STOCK_COLLECTIVE_VERB_DEFS } from '../collective/collective-verbs.js';
import { ArcError, sameProgram, type Arc } from './arc-types.js';

function verbs():VerbRegistry {
	return new VerbRegistry().addAll(STOCK_VERB_DEFS);
}

function crowd():VerbRegistry {
	const catalog = verbs().addAll(STOCK_COLLECTIVE_VERB_DEFS);
	catalog.add('hex', { args: { target: 'id' } });
	catalog.add('slash', { args: { target: 'id' } });
	catalog.add('cleave', { args: { target: 'id' } });
	return catalog;
}

describe('replyBreakdown', () => {
	const verbs = new VerbRegistry().addAll(STOCK_VERB_DEFS);
	const first = (...pieces:string[]):string | undefined => {
		const watch = replyBreakdown(verbs);
		for (const piece of pieces) {
			const why = watch(piece);
			if (why) {
				return why;
			}
		}
		return undefined;
	};

	it('catches a quote never closed, whatever pieces it comes in', () => {
		const junk = '{"steps":[{"verb":"block","target":"others.filter(u => u.hp).minBy(u => u.hp)}]}}]}]}]}```out of reach';
		assert.match(first(junk) ?? '', /"target" never closed its quote/);
		assert.match(first(...junk.split('')) ?? '', /"target" never closed its quote/);
	});

	it('catches a value that runs on, or closes what it never opened', () => {
		assert.match(first(`{"steps":[{"verb":"go_to","target":"${'a'.repeat(301)}`) ?? '', /ran on/);
		assert.match(first(`{"steps":[{"verb":"say","text":"${'a'.repeat(801)}`) ?? '', /ran on/);
		assert.match(first('{"steps":[{"verb":"go_to","target":"others.minBy(u => u.hp))') ?? '', /never opened/);
	});

	it('lets real replies through: brackets in speech, a trade, the Arc\'s own closers, a fence, text', () => {
		const real = [
			'{"steps":[{"verb":"say","text":"Ha :) (he said) \\"no\\" ok","to":"Ann"}]}',
			'{"steps":[{"verb":"offer","to":"Ann","give":{"gold":5},"get":{"Egg":1}}]}',
			'{"steps":[{"verb":"issue","who":"units.filter(u => isHurt(u))","arc":[{"verb":"loop","arc":[{"verb":"choose","goal":"Hit: the weak (or not)","choices":{"a":[{"verb":"wait"}]}}]}]}]}',
			'```json\n{"steps":[{"verb":"wait"}]}\n```',
			'go_to(Keep) && say(text="It is (very) far: }]}")',
			'I should think about this (at length).\n\n{"steps":[{"verb":"wait"}]}',
		];
		for (const reply of real) {
			assert.equal(first(reply), undefined, reply);
			assert.equal(first(...reply.split('')), undefined, reply);
		}
	});
});

describe('finishedSteps', () => {
	it('finds the root steps written to their end, whatever is in their strings', () => {
		const one = '{"verb":"say","text":"a } \\" ] {"}';
		const two = '{"verb":"loop","arc":[{"verb":"wait"}]}';
		assert.equal(finishedSteps(`{"steps":[\n\t${one},\n\t${two},\n\t{"verb":"law","watch":"some(x)}]}}]}`), `{"steps":[${one},${two}]}`);
		assert.equal(finishedSteps(`{"steps":[${one}]}`), `{"steps":[${one}]}`);
		assert.equal(finishedSteps('{"steps":[{"verb":"law","watch":"x'), undefined);
		assert.equal(finishedSteps('go_to(Keep)'), undefined);
	});
});

describe('arcJSONBlocks', () => {
	it('lays Arc JSON out by its nesting, and it reads back the same', () => {
		const all = new VerbRegistry().addAll(STOCK_VERB_DEFS);
		const arc = parseArcText('loop(arc=choose("why", wander=wander(), wait=wait()), until=!some(others)) ; say("Done")', all);
		const text = arcJSONBlocks(arc, all);
		assert.equal(text, [
			'{"steps":[',
			'\t{"verb":"loop","arc":[',
			'\t\t{"verb":"choose","goal":"why","choices":{',
			'\t\t\t"wander":[{"verb":"wander"}],',
			'\t\t\t"wait":[{"verb":"wait"}]',
			'\t\t}}',
			'\t],"until":"!some(others)","then":"always"},',
			'\t{"verb":"say","text":"Done"}',
			']}',
		].join('\n'));
		assert.equal(sameProgram(parseArc(text, all), arc), true);
		assert.equal(arcJSONBlocks(parseArcText('wait()', all), all), '{"steps":[{"verb":"wait"}]}', 'nothing to nest stays on its line');
	});
});

describe('arcSoFar', () => {
	it('reads Arc JSON cut anywhere without throwing, and grows as it comes', () => {
		const kit = crowd().view(['issue', 'loop', 'slash', 'cleave']);
		const whole = '{"steps":[{"verb":"issue","who":"units.filter(\\"Blade\\")","arc":[{"verb":"loop","arc":[{"verb":"slash","target":"Knight"}]}]},{"verb":"issue","who":"allUnits","arc":[{"verb":"loop","arc":[{"verb":"cleave","target":"Knight"}]}]}]}';
		const seen = new Set<string>();
		for (let cut = 1; cut <= whole.length; cut += 1) {
			const text = arcSoFar(whole.slice(0, cut), kit);
			if (text !== undefined) {
				seen.add(text);
			}
		}
		assert.equal(arcSoFar(whole, kit), formatArcBlocks(parseArc(whole, kit), kit));
		assert.ok(seen.size > 3, `read only ${[...seen].join(' | ')}`);
	});

	it('leaves Arc text as written', () => {
		assert.equal(arcSoFar('go_to(Lever) && us', verbs()), 'go_to(Lever) && us');
	});

	it('reads nothing into a reply that calls a tool', () => {
		assert.equal(arcSoFar('{"tool":"recall","query":"Keep"}', verbs()), undefined);
	});
});

describe('Arc JSON', () => {
	it('writes a step flat: verb first, args beside it, then last', () => {
		const arc = parseArcText('go_to(Lever) || use(item=Lever) ; say("It\'s stuck.", to=Forager)', verbs());
		assert.equal(
			JSON.stringify(arcToJSON(arc)),
			'{"steps":[{"verb":"go_to","target":"Lever","then":"if_failed"},{"verb":"use","item":"Lever","then":"always"},{"verb":"say","text":"It\'s stuck.","to":"Forager"}]}',
		);
	});

	it('round-trips groups, choices, nested arcs and every join', () => {
		const registry = crowd();
		for (const text of [
			'go_to(A) && wait(seconds=2) ; say(Hi) || go_to(B)',
			'(go_to(Keep) && wait(seconds=1)) || say(fail.reason)',
			'loop(choose("hold the gate", hold=go_to(EastGate) && wait(), chase=follow(Raider)), until=isHurt(me))',
			'issue(who=units.filter("Witch"), arc=hex(Healer) ; (slash(Foe) || wait())) ; issue(who=units, arc=loop(cleave(Knight)))',
			'when(watch=isHurt(me), arc=go_to(Keep)) ; wander()',
		]) {
			const arc = parseArcText(text, registry);
			assert.deepEqual(arcFromJSON(arcToJSON(arc), registry), arc, text);
			assert.deepEqual(parseArc(JSON.stringify(arcToJSON(arc)), registry), arc, text);
		}
	});

	it('writes a group as a step and a choice as named steps', () => {
		const registry = verbs();
		const group = arcToJSON(parseArcText('(go_to(A) ; wait()) && say(Hi)', registry));
		assert.deepEqual(group, { steps: [
			{ verb: 'group', arc: [{ verb: 'go_to', target: 'A', then: 'always' }, { verb: 'wait' }] },
			{ verb: 'say', text: 'Hi' },
		] });
		const choose = arcToJSON(parseArcText('choose("hold", stand=wait(), chase=follow(Raider))', registry));
		assert.deepEqual(choose, { steps: [{ verb: 'choose', goal: 'hold', choices: { stand: [{ verb: 'wait' }], chase: [{ verb: 'follow', target: 'Raider' }] } }] });
	});

	it('reads {steps}, a bare list of steps, one step, and Arc text where an arc goes', () => {
		const registry = verbs();
		const one:Arc = [{ verb: 'go_to', args: { target: 'EastGate' } }];
		assert.deepEqual(parseArc('{"steps":[{"verb":"go_to","target":"EastGate"}]}', registry), one);
		assert.deepEqual(parseArc('[{"verb":"go_to","target":"EastGate"}]', registry), one);
		assert.deepEqual(parseArc('{"verb":"go_to","target":"EastGate"}', registry), one);
		assert.deepEqual(parseArc({ steps: [{ verb: 'go_to', target: 'EastGate' }] }, registry), one);
		assert.deepEqual(parseArc('```json\n{"steps":[{"verb":"go_to","target":"EastGate"}]}\n```', registry), one);
		const loop = parseArc('{"steps":[{"verb":"loop","arc":"go_to(Keep) && wait()"}]}', registry);
		assert.deepEqual((loop[0].args.arc as Arc).map((step) => step.verb), ['go_to', 'wait']);
	});

	it('skips an empty {} a model left between two steps', () => {
		const arc = parseArc('{"steps":[{"verb":"wait"},{  },{"verb":"say","text":"Hi"}]}', verbs());
		assert.deepEqual(arc.map((step) => step.verb), ['wait', 'say']);
		assert.throws(() => parseArc('{"steps":[{}]}', verbs()), /the arc is empty/);
	});

	it('takes if_ok, always and if_failed as then, or && ; ||, and drops what is the default', () => {
		const registry = verbs();
		const arc = parseArc('{"steps":[{"verb":"go_to","target":"A","then":"&&"},{"verb":"wait","then":";"},{"verb":"say","text":"Hi","then":"||"},{"verb":"go_to","target":"B","then":"if_ok"},{"verb":"wait","then":"always"}]}', registry);
		assert.deepEqual(arc.map((step) => step.then), [undefined, 'always', 'if_failed', undefined, undefined]);
		assert.throws(() => parseArc('{"steps":[{"verb":"wait","then":"later"},{"verb":"wait"}]}', registry), /unknown join 'later'/);
	});

	it('parses truncated JSON by closing braces', () => {
		const arc = parseArc('{"steps":[{"verb":"go_to","target":"Lantern"},{"verb":"wait","seconds":1', verbs());
		assert.deepEqual(arc.map((step) => step.verb), ['go_to', 'wait']);
		assert.equal(arc[1].args.seconds, 1);
	});

	it('parses a truncated issue chain from CoT JSON', () => {
		const kit = crowd().view(['issue', 'loop', 'slash', 'cleave']);
		const raw = '{"steps":[{"verb":"issue","who":"allUnits","arc":[{"verb":"loop","arc":[{"verb":"slash","target":"Blade"}]}]},{"verb":"issue","who":"allUnits","arc":[{"verb":"loop","arc":[{"verb":"cleave","target":"Knight"';
		const arc = parseArc(raw, kit);
		assert.equal(arc[0].args.who, 'allUnits');
		assert.equal(arc[1].args.who, 'allUnits');
		assert.equal(
			formatArc(arc, kit),
			'issue(who=allUnits, arc=loop(slash(Blade))) && issue(who=allUnits, arc=loop(cleave(Knight)))',
		);
	});

	it('rejects coordinates and unknown verbs and args', () => {
		const registry = verbs();
		assert.throws(() => parseArc({ steps: [{ verb: 'go_to', target: 'EastGate', x: 3, z: 4 }] }, registry), ArcError);
		assert.throws(() => parseArc({ steps: [{ verb: 'go_to', target: '3, 4' }] }, registry), ArcError);
		assert.throws(() => parseArc({ steps: [{ verb: 'fly', target: 'EastGate' }] }, registry), /unknown verb 'fly'/);
		assert.throws(() => parseArc({ steps: [{ verb: 'go_to', place: 'EastGate' }] }, registry), /has no arg 'place'/);
		assert.throws(() => parseArc({ steps: [{ verb: 'go_to' }] }, registry), /missing required arg 'target'/);
		assert.throws(() => parseArc({ steps: [] }, registry), ArcError);
		assert.throws(() => parseArc({ head: { verb: 'go_to', args: { target: 'EastGate' } } }, registry), ArcError);
		assert.throws(() => parseArc('{"steps":[{"verb":"wait","hold":{"verb":"wait"}}]}', registry), ArcError);
	});

	it('keeps expression strings as they were written', () => {
		const registry = verbs();
		assert.equal(
			parseArc('{"steps":[{"verb":"wander","until":"some(landmarks.filter(\\"tree\\").nearby(16))"}]}', registry)[0].args.until,
			'some(landmarks.filter("tree").nearby(16))',
		);
		assert.equal(parseArc('{"steps":[{"verb":"wander","until":"isNear(me, Cottage)"}]}', registry)[0].args.until, 'isNear(me, Cottage)');
	});

	it('takes the last {"steps" out of a CoT essay', () => {
		const arc = parseArc(
			'The user wants me to act.\n'
			+ 'Example: {"steps":[{"verb":"go_to","target":"EastGate"}]}\n'
			+ 'Final: {"steps":[{"verb":"follow","target":"Player"}]}',
			verbs(),
		);
		assert.equal(arc[0].verb, 'follow');
		assert.equal(arc[0].args.target, 'Player');
	});

	it('reads the choose and group JSON forms, and refuses what they do not take', () => {
		const registry = verbs();
		const arc = parseArc({ steps: [{ verb: 'choose', goal: 'hold', choices: { stand: [{ verb: 'wait' }] } }] }, registry);
		assert.equal((arc[0].args.stand as Arc)[0].verb, 'wait');
		const group = parseArc({ steps: [{ verb: 'group', arc: [{ verb: 'wait' }], then: 'always' }, { verb: 'wait' }] }, registry);
		assert.equal(group[0].verb, 'group');
		assert.equal(group[0].then, 'always');
		assert.throws(() => parseArc({ steps: [{ verb: 'choose', goal: 'hold', stand: [{ verb: 'wait' }] }] }, registry), /takes goal and choices, not 'stand'/);
		assert.throws(() => parseArc({ steps: [{ verb: 'group', steps: [{ verb: 'wait' }] }] }, registry), /takes arc, not 'steps'/);
		assert.throws(() => parseArc({ steps: [{ verb: 'choose', goal: 'hold' }] }, registry), /needs choices/);
	});

	it('shows an example in one line with expression strings in single quotes, prose untouched', () => {
		const registry = verbs();
		const arc = parseArcText('wander(until=some(items.filter("Lantern").nearby())) ; say("A \\"fine\\" day")', registry);
		const text = arcJSONText(arc, registry);
		assert.equal(text.includes('\n'), false);
		assert.ok(text.includes('"until":"some(items.filter(\'Lantern\').nearby())"'), text);
		const back = parseArc(text, registry);
		assert.equal(back[0].args.until, "some(items.filter('Lantern').nearby())");
		assert.equal(back[1].args.text, 'A "fine" day');
		assert.deepEqual(back.map((step) => step.verb), ['wander', 'say']);
	});
});

describe('exits on law and when', () => {
	it('reads times and until from Arc text and Arc JSON alike', () => {
		const text = 'law(watch=count(others.filter(\'enemy\')) == 0, arc=say(We won, friends), name=victory_speech, times=1) ; when(watch=isHurt(me), arc=wait(), until=isNear(me, Keep), times=2)';
		const arc = parseArcText(text, verbs());
		assert.equal(arc[0].args.times, 1);
		assert.equal(arc[0].args.name, 'victory_speech');
		assert.equal(arc[1].args.times, 2);
		assert.equal(arc[1].args.until, 'isNear(me, Keep)');
		assert.deepEqual(arcFromJSON(JSON.parse(JSON.stringify(arcToJSON(arc))), verbs()), arc);
		assert.deepEqual(parseArcText(formatArc(arc), verbs()), arc);
	});

	it('turns down a times that is no number, as loop does', () => {
		for (const verb of ['law', 'when']) {
			assert.throws(() => parseArcText(`${verb}(watch=isHurt(me), arc=wait(), times=often)`, verbs()), /'times' must be a number/);
		}
	});
});

describe('replySchema', () => {
	function schemaOf(registry:VerbRegistry):{ $defs:{ step:{ anyOf:{ properties:{ verb:{ const:string } } }[] } } } {
		return replySchema(registry) as never;
	}

	it('has one branch per verb of the catalog, plus the group, whatever kit asks', () => {
		const catalog = crowd();
		const kit = catalog.view(['issue', 'wait']);
		const names = (registry:VerbRegistry):string[] => schemaOf(registry.nested()).$defs.step.anyOf.map((branch) => branch.properties.verb.const);
		assert.deepEqual(names(kit), [...catalog.list().map((spec) => spec.name).filter((name) => name !== 'issue'), 'group']);
		assert.equal(JSON.stringify(replySchema(kit.nested())), JSON.stringify(replySchema(catalog)));
	});

	it('takes times and until on law and when, as on loop', () => {
		const branches = schemaOf(verbs()).$defs.step.anyOf;
		for (const verb of ['law', 'when', 'loop']) {
			const { properties } = branches.find((branch) => branch.properties.verb.const === verb)! as unknown as { properties:Record<string, unknown> };
			assert.ok(properties.times && properties.until, verb);
		}
	});

	it('takes issue at the root of a reply only, so no nested arc can hold one', () => {
		const schema = replySchema(crowd()) as unknown as { properties:{ steps:{ items:{ anyOf:{ properties?:{ verb:{ const:string }; arc:unknown } }[] } } } };
		const root = schema.properties.steps.items.anyOf;
		assert.equal(root[0].properties?.verb.const, 'issue');
		assert.deepEqual(root[0].properties?.arc, { $ref: '#/$defs/arc' });
		assert.deepEqual(root[1], { $ref: '#/$defs/step' });
	});

	it('calls two arcs the same program whatever their goal and choices are called, and only then', () => {
		const kit = crowd();
		const arc = (text:string) => parseArcText(text, kit);
		const program = arc('loop(choose("Crush him!", kill=cleave(Knight), guard=slash(Foe)))');
		assert.ok(sameProgram(program, arc('loop(choose("Silence that tin can.", defend=slash(Foe), attack=cleave(Knight)))')));
		assert.ok(!sameProgram(program, arc('loop(choose("Crush him!", kill=cleave(Blade), guard=slash(Foe)))')));
		assert.ok(!sameProgram(arc('say("Hold!")'), arc('say("Run!")')), 'what a say says is what it does');
	});

	it('refuses issue anywhere but the root of an Arc', () => {
		const kit = crowd();
		for (const text of ['loop(issue(who=units, arc=wait()))', 'law(watch=1 > 0, arc=issue(who=units, arc=wait()))', 'when(watch=1 > 0, arc=issue(who=units, arc=wait()))', 'issue(who=units, arc=issue(who=units, arc=wait()))']) {
			assert.throws(() => parseArcText(text, kit), /issue goes at the root/, text);
		}
		assert.doesNotThrow(() => parseArcText('issue(who=units, arc=loop(wait())) ; issue(who=allUnits, arc=wait())', kit));
	});

	it('has one branch per tool before the steps, the built-ins first, and no more for a mind that lacks one', () => {
		const tools = {
			recall: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, k: { type: 'number' } } },
			observe: { type: 'object', required: ['expr'], properties: { expr: { type: 'string' } } },
			sell_tip: { type: 'object', properties: { to: { type: 'string' } } },
		};
		const schema = replySchema(verbs(), tools) as unknown as { anyOf:{ required:string[]; additionalProperties:boolean; properties:Record<string, unknown> }[]; required?:string[] };
		assert.equal(schema.required, undefined, 'with tools the reply is one of several shapes');
		assert.deepEqual(schema.anyOf.map((branch) => Object.keys(branch.properties)[0]), ['tool', 'tool', 'tool', 'steps']);
		assert.deepEqual(schema.anyOf.map((branch) => (branch.properties.tool as { const:string } | undefined)?.const), ['recall', 'observe', 'sell_tip', undefined]);
		assert.deepEqual(schema.anyOf[0].required, ['tool', 'query']);
		assert.deepEqual(Object.keys(schema.anyOf[0].properties), ['tool', 'query', 'k']);
		assert.deepEqual(schema.anyOf[2].required, ['tool']);
		assert.equal(schema.anyOf[0].additionalProperties, false);
		assert.ok(JSON.stringify(schema).length < 20_000);
	});

	it('refuses a tool with a parameter called tool', () => {
		assert.throws(() => replySchema(verbs(), { odd: { type: 'object', properties: { tool: { type: 'string' } } } }), /parameter called 'tool'/);
	});

	it('is the same bytes while nothing changes, and different once a verb or a tool is added', () => {
		const tools = { recall: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } } };
		const catalog = crowd();
		const before = JSON.stringify(replySchema(catalog, tools));
		assert.equal(JSON.stringify(replySchema(catalog, tools)), before);
		catalog.add('shout', { args: { text: 'text' } });
		const withVerb = JSON.stringify(replySchema(catalog, tools));
		assert.notEqual(withVerb, before);
		assert.match(withVerb, /"const":"shout"/);
		const withTool = JSON.stringify(replySchema(catalog, { ...tools, peek: { type: 'object', properties: {} } }));
		assert.notEqual(withTool, withVerb);
		assert.match(withTool, /"const":"peek"/);
	});

	it('writes group and choose as steps of their own, with the nested arc by reference', () => {
		const schema = replySchema(verbs()) as unknown as { $defs:{ step:{ anyOf:{ required:string[]; properties:Record<string, { $ref?:string; additionalProperties?:unknown; const?:string }> }[] } } };
		const group = schema.$defs.step.anyOf.at(-1);
		assert.deepEqual(group?.required, ['verb', 'arc']);
		assert.equal(group?.properties.verb.const, 'group');
		assert.equal(group?.properties.arc.$ref, '#/$defs/arc');
		const choose = schema.$defs.step.anyOf.find((branch) => branch.properties.verb.const === 'choose');
		assert.deepEqual(choose?.required, ['verb', 'goal', 'choices']);
		assert.deepEqual(choose?.properties.choices.additionalProperties, { $ref: '#/$defs/arc' });
	});

	it('names each verb, its args in order and then last, and recurses through $defs', () => {
		const schema = replySchema(verbs()) as unknown as {
			required:string[];
			properties:{ steps:{ $ref:string } };
			$defs:{ arc:{ minItems:number }; step:{ anyOf:{ required:string[]; properties:Record<string, unknown> }[] } };
		};
		assert.deepEqual(schema.required, ['steps']);
		assert.equal(schema.properties.steps.$ref, '#/$defs/arc');
		assert.equal(schema.$defs.arc.minItems, 1);
		const use = schema.$defs.step.anyOf.find((branch) => (branch.properties.verb as { const:string }).const === 'use');
		assert.deepEqual(Object.keys(use?.properties ?? {}), ['verb', 'item', 'target', 'then']);
		assert.deepEqual(use?.required, ['verb', 'item']);
		const loop = schema.$defs.step.anyOf.find((branch) => (branch.properties.verb as { const:string }).const === 'loop');
		assert.deepEqual((loop?.properties.arc as { $ref:string }).$ref, '#/$defs/arc');
		assert.ok(JSON.stringify(schema).length < 20_000);
	});
});
