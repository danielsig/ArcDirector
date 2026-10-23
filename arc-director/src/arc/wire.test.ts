import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseArcText, formatArc } from './parse.js';
import { arcFromJSON, arcJSONText, arcToJSON, parseArc } from './wire.js';
import { replySchema } from './schema.js';
import { VerbRegistry, registerStockVerbs } from './stock-verbs.js';
import { registerStockCollectiveVerbs } from '../collective/verbs.js';
import { ArcError, type Arc } from './types.js';

function verbs():VerbRegistry {
	return registerStockVerbs(new VerbRegistry());
}

function crowd():VerbRegistry {
	const catalog = registerStockCollectiveVerbs(verbs());
	catalog.add('hex', { args: { target: 'id' } });
	catalog.add('slash', { args: { target: 'id' } });
	catalog.add('cleave', { args: { target: 'id' } });
	return catalog;
}

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
		assert.throws(() => parseArc('{"steps":[{}]}', verbs()), /non-empty list of steps/);
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

describe('replySchema', () => {
	function schemaOf(registry:VerbRegistry):{ $defs:{ step:{ anyOf:{ properties:{ verb:{ const:string } } }[] } } } {
		return replySchema(registry) as never;
	}

	it('has one branch per verb of the catalog, plus the group, whatever kit asks', () => {
		const catalog = crowd();
		const kit = catalog.view(['issue', 'wait']);
		const names = (registry:VerbRegistry):string[] => schemaOf(registry.nested()).$defs.step.anyOf.map((branch) => branch.properties.verb.const);
		assert.deepEqual(names(kit), [...catalog.list().map((spec) => spec.name), 'group']);
		assert.equal(JSON.stringify(replySchema(kit.nested())), JSON.stringify(replySchema(catalog)));
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
