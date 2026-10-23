import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractJson, readID } from './json.js';

describe('extractJson', () => {
	it('parses a complete object', () => {
		assert.deepEqual(extractJson('{"steps":[{"verb":"wait"}]}'), {
			steps: [{ verb: 'wait' }],
		});
	});

	it('closes truncated Arc braces', () => {
		const raw = '{"steps":[{"verb":"go_to","target":"Lantern"},{"verb":"pick_up","item":"Lantern"},{"verb":"go_to","target":"BridgeKeeper"},{"verb":"give","item":"Lantern","to":"BridgeKeeper"},{"verb":"wait","seconds":1';
		const got = extractJson(raw) as { steps:{ verb:string }[] };
		assert.deepEqual(got.steps.map((step) => step.verb), ['go_to', 'pick_up', 'go_to', 'give', 'wait']);
	});

	it('takes the first complete object when extra braces follow', () => {
		assert.deepEqual(extractJson('{"a":1}}'), { a: 1 });
	});

	it('reads a list of steps, and closes one the model cut off', () => {
		assert.deepEqual(extractJson('[{"verb":"wait"},{"verb":"say","text":"ok"}]'), [{ verb: 'wait' }, { verb: 'say', text: 'ok' }]);
		assert.deepEqual(extractJson('[{"verb":"wait"},{"verb":"say","text":"o'), [{ verb: 'wait' }, { verb: 'say', text: 'o' }]);
	});

	it('closes an expression the model closed late, after the brackets that end it', () => {
		// The late quote swallows `}]},` and the stray closers at the end make it parse, nested one step too deep.
		const raw = '{"steps":[{"verb":"issue","arc":[{"verb":"block","target":"near(me).minBy(u => u.hp)}],"},{"verb":"say","text":"Go (now)!"}]}]}';
		assert.deepEqual(extractJson(raw), {
			steps: [{ verb: 'issue', arc: [{ verb: 'block', target: 'near(me).minBy(u => u.hp)' }] }, { verb: 'say', text: 'Go (now)!' }],
		});
	});

	it('leaves strings that only hold brackets as prose alone', () => {
		assert.deepEqual(extractJson('{"text":"There are {X} (or more) {Y}"}'), { text: 'There are {X} (or more) {Y}' });
	});
});

describe('readID', () => {
	it('prefers id and falls back to ID', () => {
		assert.equal(readID({ id: 'a' }), 'a');
		assert.equal(readID(JSON.parse('{"ID":"b"}')), 'b');
		assert.equal(readID(JSON.parse('{"id":"a","ID":"b"}')), 'a');
		assert.equal(readID({}), undefined);
	});
});
