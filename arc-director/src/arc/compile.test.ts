import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ReplyReader } from './compile.js';
import { parseArcText } from './arc-parse.js';
import { STOCK_VERB_DEFS, VerbRegistry } from './stock-verbs.js';

describe('ReplyReader', () => {
	const verbs = new VerbRegistry().addAll(STOCK_VERB_DEFS);
	const reader = new ReplyReader({ verbs, ids: (word) => word, minChoices: 2, explicitThinkAllowedInside: [], repairs: true });

	it('streams the steps written so far up to one that never ends, which waits for the whole reply', () => {
		assert.deepEqual(reader.soFar('say("a") ; follow(Bo) ; ', 'text').map((step) => step.verb), ['say']);
		assert.deepEqual(reader.soFar('say("a") while follow(Bo) ; ', 'text'), [], 'a while that never ends too');
		assert.deepEqual(reader.soFar('{"steps":[{"verb":"follow","target":"Bo"},', 'json'), []);
		assert.deepEqual(reader.soFar('follow(Bo, until=isNear(me, Bo, 2)) ; ', 'text').map((step) => step.verb), ['follow'], 'one with an end starts at once');
	});

	it('turns down a later turn\'s steps after a kept one that never ends', () => {
		const { good, bad } = reader.judge('say("A")', parseArcText('follow(Bo)', verbs));
		assert.deepEqual(good, []);
		assert.match(bad[0]?.reason ?? '', /follow never ends, so say\(…\) after it never runs/);
	});
});
