import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractJson, readID } from './json.js';

describe('extractJson', () => {
	it('parses a complete object', () => {
		assert.deepEqual(extractJson('{"head":{"verb":"wait"}}'), {
			head: { verb: 'wait' },
		});
	});

	it('closes truncated ActionPlan braces', () => {
		const raw = '{"head":{"verb":"go_to","args":{"name":"Lantern"}},"then":{"join":"then_if_ok","plan":{"head":{"verb":"pick_up","args":{"name":"Lantern"}},"then":{"join":"then_if_ok","plan":{"head":{"verb":"go_to","args":{"name":"Miller"}},"then":{"join":"then_if_ok","plan":{"head":{"verb":"give","args":{"item":"Lantern","to":"Miller"}},"then":{"join":"then_if_ok","plan":{"head":{"verb":"wait","args":{"seconds":1}}}}}}}}';
		const got = extractJson(raw) as {
			head:{ verb:string };
			then:{ plan:{ then:{ plan:{ then:{ plan:{ then:{ plan:{ head:{ verb:string } } } } } } } } };
		};
		assert.equal(got.head.verb, 'go_to');
		assert.equal(got.then.plan.then.plan.then.plan.then.plan.head.verb, 'wait');
	});

	it('takes the first complete object when extra braces follow', () => {
		assert.deepEqual(extractJson('{"a":1}}'), { a: 1 });
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
