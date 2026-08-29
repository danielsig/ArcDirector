import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickBestThread, rememberThread, type ThreadSnapshot } from './threadCache.js';
import type { ChatMessage } from './provider.js';

const sys:ChatMessage = { role: 'system', content: 'You are Guard.' };
const userA:ChatMessage = { role: 'user', content: 'look' };
const userB:ChatMessage = { role: 'user', content: 'wait' };
const asst:ChatMessage = {
	role: 'assistant',
	content: null,
	toolCalls: [{ id: 'c1', name: 'see_map', arguments: '{}' }],
};
const tool:ChatMessage = { role: 'tool', content: '{"ok":true}', toolCallID: 'c1' };

describe('thread cache', () => {
	it('picks the longest stored prefix', () => {
		const stored:ThreadSnapshot[] = [
			{ id: 'resp_short', messages: [sys] },
			{ id: 'resp_mid', messages: [sys, userA, asst] },
		];
		const hit = pickBestThread(stored, [sys, userA, asst, tool]);
		assert.equal(hit?.id, 'resp_mid');
		assert.equal(hit?.prefixLen, 3);
	});

	it('ignores a thread that is not an exact prefix', () => {
		const stored:ThreadSnapshot[] = [
			{ id: 'resp_a', messages: [sys, userA, asst] },
		];
		assert.equal(pickBestThread(stored, [sys, userB]), undefined);
	});

	it('keeps a shorter branch when a longer snapshot has diverged', () => {
		const later:ChatMessage = { role: 'assistant', content: '{"head":{"verb":"wait"}}' };
		const stored:ThreadSnapshot[] = [
			{ id: 'resp_tool', messages: [sys, userA, asst] },
			{ id: 'resp_plan', messages: [sys, userA, asst, tool, later] },
		];
		const other:ChatMessage = { role: 'tool', content: '{"elsewhere":true}', toolCallID: 'c1' };
		const hit = pickBestThread(stored, [sys, userA, asst, other]);
		assert.equal(hit?.id, 'resp_tool');
		assert.equal(hit?.prefixLen, 3);
	});

	it('does not reuse a snapshot that is the whole current request', () => {
		const stored:ThreadSnapshot[] = [
			{ id: 'resp_same', messages: [sys, userA] },
		];
		assert.equal(pickBestThread(stored, [sys, userA]), undefined);
	});

	it('caps remembered threads', () => {
		let stored:ThreadSnapshot[] = [];
		for (let i = 0; i < 40; i++) {
			stored = rememberThread(stored, {
				id: `resp_${i}`,
				messages: [sys, { role: 'user', content: `u${i}` }],
			});
		}
		assert.equal(stored.length, 32);
		assert.equal(stored[0].id, 'resp_8');
	});
});
