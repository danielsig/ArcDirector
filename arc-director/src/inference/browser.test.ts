import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inThought, modelID, splitThought, textMessages, withoutTokens } from './browser.js';

describe('browser', () => {
	it('sends text only, one system message first, and no tool turns', () => {
		assert.deepEqual(textMessages([
			{ role: 'system', content: 'Be brief.' },
			{ role: 'user', content: [{ type: 'text', text: 'Look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' } }] },
			{ role: 'assistant', content: null, toolCalls: [{ id: 'a', name: 'map', arguments: '{}' }] },
			{ role: 'tool', content: 'A hall.', toolCallID: 'a' },
			{ role: 'system', content: 'Reply as JSON.' },
		]), [
			{ role: 'system', content: 'Be brief.' },
			{ role: 'user', content: 'Look' },
			{ role: 'assistant', content: '' },
			{ role: 'user', content: 'A hall.' },
			{ role: 'user', content: 'Reply as JSON.' },
		]);
	});

	it("splits off Gemma 4's thought channel and drops its template tokens", () => {
		assert.deepEqual(
			splitThought('<|channel>thought\nSeven has no divisors.\n<channel|>Yes.<turn|>'),
			{ content: 'Yes.', reasoning: 'Seven has no divisors.' },
		);
	});

	it('splits a thought the model opened itself, or the template did', () => {
		assert.deepEqual(splitThought('<think>\nSeven has no divisors.\n</think>\n\nYes.'), { content: 'Yes.', reasoning: 'Seven has no divisors.' });
		assert.deepEqual(splitThought('Seven has no divisors.</think>Yes.'), { content: 'Yes.', reasoning: 'Seven has no divisors.' });
	});

	it('keeps a thought cut off before its end as thought', () => {
		assert.deepEqual(splitThought('<|channel>thought\nSeven has'), { content: null, reasoning: 'Seven has' });
	});

	it('leaves an answer without a thought alone, but for its template tokens', () => {
		assert.deepEqual(splitThought('Yes.<turn|>'), { content: 'Yes.' });
	});

	it('reads a Hugging Face repo, pinned or not, from a name or its page', () => {
		const repo = 'onnx-community/gemma-4-E4B-it-ONNX';
		assert.deepEqual(modelID(repo), { repo, revision: 'main' });
		assert.deepEqual(modelID(`${repo}@3f2a9c1`), { repo, revision: '3f2a9c1' });
		assert.deepEqual(modelID(`hf://${repo}`), { repo, revision: 'main' });
		assert.deepEqual(modelID(`https://huggingface.co/${repo}/tree/3f2a9c1`), { repo, revision: '3f2a9c1' });
		assert.deepEqual(modelID(`https://huggingface.co/${repo}/`), { repo, revision: 'main' });
		assert.throws(() => modelID('Gemma 4'), /not a Hugging Face repo/);
	});
});

describe('browser tokens', () => {
	it("drops a model's special tokens from its answer", () => {
		assert.equal(withoutTokens('Halt, traveler.<end_of_turn>', ['<eos>', '<end_of_turn>']), 'Halt, traveler.');
	});
});

describe('browser thought budget', () => {
	it('knows a reply is still thinking, whoever opened the thought', () => {
		assert.equal(inThought('<|channel>thought\nThe guard should', undefined), true);
		assert.equal(inThought('<|channel>thought\nGo.<channel|>{"steps"', undefined), false);
		assert.equal(inThought('The guard should', '<think>'), true);
		assert.equal(inThought('Go.</think>{"steps"', '<think>'), false);
		assert.equal(inThought('{"steps": []}', undefined), false);
	});
});
