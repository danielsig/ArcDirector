import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inPageFetch, type Wllama } from './browser.js';
import { HttpProvider } from './http.js';

/** A wllama that answers every chat with `chunks`, as one reply or streamed, and records what it was asked. */
function fakeWllama(chunks:{ reasoning_content?:string; content?:string }[]):{ wllama:Wllama; asked:Record<string, unknown>[]; stopped:()=>boolean } {
	const asked:Record<string, unknown>[] = [];
	let signal:AbortSignal | undefined;
	const wllama:Wllama = {
		modelManager: { getModels: async () => [] },
		// eslint-disable-next-line no-restricted-syntax -- wllama's own name
		loadModelFromUrl: async () => undefined,
		exit: async () => undefined,
		createChatCompletion: async (params) => {
			asked.push(params);
			signal = params['abortSignal'] as AbortSignal;
			if (!params['stream']) {
				return {
					choices: [{
						message: { content: chunks.map((c) => c.content ?? '').join('') },
						logprobs: { content: [{ token: 'A', logprob: -0.1, top_logprobs: [{ token: 'A', logprob: -0.1 }, { token: 'B', logprob: -2.5 }] }] },
						finish_reason: 'stop',
					}],
				};
			}
			return (async function* () {
				for (const delta of chunks) {
					if (signal?.aborted) {
						return;
					}
					yield { choices: [{ index: 0, delta, finish_reason: null }] };
				}
				yield { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
			})();
		},
	};
	return { wllama, asked, stopped: () => !!signal?.aborted };
}

function providerOn(wllama:Wllama):HttpProvider {
	return new HttpProvider({ baseURL: 'http://browser.invalid/v1', fetch: inPageFetch(() => Promise.resolve(wllama)) });
}

describe('browser', () => {
	it('answers a streamed chat from the model in the page, its thought apart', async () => {
		const { wllama, asked } = fakeWllama([{ reasoning_content: 'The gate is shut.' }, { content: '{"steps":' }, { content: '[]}' }]);
		const res = await providerOn(wllama).chat({ model: 'gemma', messages: [{ role: 'user', content: 'hi' }], enableThinking: true });
		assert.equal(res.content, '{"steps":[]}');
		assert.equal(res.reasoning, 'The gate is shut.');
		assert.equal(asked[0]?.['stream'], true);
	});

	it('answers in one piece when the caller wants scores, as System One does', async () => {
		const { wllama } = fakeWllama([{ content: 'A' }]);
		const res = await providerOn(wllama).chat({ model: 'gemma', messages: [{ role: 'user', content: 'pick' }], maxTokens: 1, topLogprobs: 2, sampling: { temperature: 0 } });
		assert.equal(res.content, 'A');
		assert.ok((res.logprobs?.['A'] ?? -Infinity) > (res.logprobs?.['B'] ?? -Infinity));
	});

	it('stops the model once the thinking budget runs out', async () => {
		const thought = Array.from({ length: 40 }, () => ({ reasoning_content: 'I need to lower the Bridge. ' }));
		const { wllama, stopped } = fakeWllama([...thought, { content: '{}' }]);
		const provider = providerOn(wllama);
		provider.configureModel('gemma', { thinkingBudget: 16 });
		const res = await provider.chat({ model: 'gemma', messages: [{ role: 'user', content: 'hi' }], enableThinking: true });
		assert.equal(res.truncated, true);
		assert.equal(res.content, null);
		assert.ok(stopped(), 'the model stops thinking too, not only the reader');
	});

	it('is not found at any other path, as on a server without it', async () => {
		const res = await inPageFetch(() => Promise.resolve(fakeWllama([]).wllama))('http://browser.invalid/api/v1/models', { method: 'GET' });
		assert.equal(res.status, 404);
	});
});
