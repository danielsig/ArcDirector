import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { JsonSchema } from '../json.js';
import { replySchema } from './schema.js';
import { VerbRegistry, STOCK_VERB_DEFS } from './stock-verbs.js';

function verbs():VerbRegistry {
	return new VerbRegistry().addAll(STOCK_VERB_DEFS);
}

/** The branch for `verb` in the step def `def` of `schema`. */
function branch(schema:JsonSchema, def:string, verb:string):JsonSchema {
	return schema.$defs![def].anyOf!.find((step) => step.properties?.verb?.const === verb)!;
}

describe('replySchema constraints', () => {
	it('gives only the stock law arc defs of its own', () => {
		assert.deepEqual(Object.keys(replySchema(verbs()).$defs!), ['arc', 'step', 'arc_in_law', 'step_in_law']);
	});

	it('writes bounds, whole numbers and names on the arg itself', () => {
		const schema = replySchema(verbs().constrain('wait', 'seconds', { min: 1, max: 10, integer: true }).constrain('go_to', 'target', { names: ['Keep', 'Gate'] }));
		assert.deepEqual(branch(schema, 'step', 'wait').properties!.seconds, { type: 'integer', minimum: 1, maximum: 10 });
		assert.deepEqual(branch(schema, 'step', 'go_to').properties!.target, { type: 'string', enum: ['Keep', 'Gate'] });
		assert.deepEqual(Object.keys(schema.$defs!), ['arc', 'step', 'arc_in_law', 'step_in_law']);
	});

	it('gives a narrowed arc defs of its own: its verbs, its most steps, and its args as written there', () => {
		const schema = replySchema(verbs()
			.constrain('law', 'arc', { not: ['say', 'law'], maxSteps: 6 })
			.constrain('wait', 'seconds', { max: 10 }, 'law.arc')
			.constrain('wait', 'seconds', { min: 1 }, 'loop.arc'));
		assert.deepEqual(Object.keys(schema.$defs!), ['arc', 'step', 'arc_in_loop', 'step_in_loop', 'arc_in_law', 'step_in_law']);
		assert.deepEqual(schema.$defs!.arc_in_law, { type: 'array', minItems: 1, maxItems: 6, items: { $ref: '#/$defs/step_in_law' } });
		assert.equal(branch(schema, 'step_in_law', 'say'), undefined);
		assert.equal(branch(schema, 'step_in_law', 'law'), undefined);
		assert.deepEqual(branch(schema, 'step_in_law', 'wait').properties!.seconds, { type: 'number', minimum: 0, maximum: 10 });
		assert.deepEqual(branch(schema, 'step_in_loop', 'wait').properties!.seconds, { type: 'number', minimum: 1 });
		assert.deepEqual(branch(schema, 'step', 'wait').properties!.seconds, { type: 'number', minimum: 0 }, 'not at the root');
		assert.deepEqual(branch(schema, 'step', 'law').properties!.arc, { $ref: '#/$defs/arc_in_law' });
		assert.deepEqual(branch(schema, 'step_in_law', 'loop').properties!.arc, { $ref: '#/$defs/arc_in_loop' });
		assert.deepEqual(branch(schema, 'step_in_law', 'if').properties!.arc, { $ref: '#/$defs/arc_in_law' }, 'an if is where it stands');
		assert.deepEqual(branch(schema, 'step_in_law', 'group').properties!.arc, { $ref: '#/$defs/arc_in_law' }, 'and a group too');
		assert.deepEqual(branch(schema, 'step', 'when').properties!.arc, { $ref: '#/$defs/arc' });
	});

	it('lists only the allowed verbs of an arc, beside a group and a test', () => {
		const schema = replySchema(verbs().constrain('loop', 'arc', { subverbs: ['go_to', 'wait'] }));
		assert.deepEqual(schema.$defs!.step_in_loop.anyOf!.map((step) => step.properties!.verb.const), ['go_to', 'wait', 'group', 'test']);
	});
});
