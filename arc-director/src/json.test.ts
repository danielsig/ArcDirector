import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractJson, readID } from './json.js';

describe('extractJson', () => {
	it('parses a complete object', () => {
		assert.deepEqual(extractJson('{"head":{"verb":"wait"}}'), {
			head: { verb: 'wait' },
		});
	});

	it('closes truncated Arc braces', () => {
		const raw = '{"head":{"verb":"go_to","args":{"target":"Lantern"}},"then":{"join":"then_if_ok","arc":{"head":{"verb":"pick_up","args":{"item":"Lantern"}},"then":{"join":"then_if_ok","arc":{"head":{"verb":"go_to","args":{"target":"BridgeKeeper"}},"then":{"join":"then_if_ok","arc":{"head":{"verb":"give","args":{"item":"Lantern","to":"BridgeKeeper"}},"then":{"join":"then_if_ok","arc":{"head":{"verb":"wait","args":{"seconds":1}}}}}}}}';
		const got = extractJson(raw) as {
			head:{ verb:string };
			then:{ arc:{ then:{ arc:{ then:{ arc:{ then:{ arc:{ head:{ verb:string } } } } } } } } };
		};
		assert.equal(got.head.verb, 'go_to');
		assert.equal(got.then.arc.then.arc.then.arc.then.arc.head.verb, 'wait');
	});

	it('takes the first complete object when extra braces follow', () => {
		assert.deepEqual(extractJson('{"a":1}}'), { a: 1 });
	});

	it('keeps a trailing then after an early-closed head', () => {
		const raw = '{"head":{"verb":"wait","args":{"seconds":1}}},"then":{"join":"then","arc":{"head":{"verb":"say","args":{"text":"ok"}}}}}';
		const got = extractJson(raw) as {
			head:{ verb:string };
			then:{ join:string; arc:{ head:{ verb:string } } };
		};
		assert.equal(got.head.verb, 'wait');
		assert.equal(got.then.join, 'then');
		assert.equal(got.then.arc.head.verb, 'say');
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
