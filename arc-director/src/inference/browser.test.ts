import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { afterThought, inThought, modelID, splitThought, textMessages, withoutTokens, type Tensor, type Tokenizer } from './browser.js';
import type { SchemaConstraint } from './grammar.js';

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

describe('browser schema after a thought', () => {
	// Gemma 4's markers as single tokens; `{` (7) is the only token the schema takes first.
	const spelled:Record<number, string> = { 1: '<|channel>', 2: 'thought', 3: '<channel|>', 5: 'Go.', 7: '{' };
	const tokenizer = {
		encode: (text:string) => (text === '<|channel>thought' ? [1, 2] : []),
		decode: (ids:number[]) => ids.map((id) => spelled[id] ?? '').join(''),
	} as unknown as Tokenizer;
	const VOCAB = 8;
	const logits = ():Tensor => ({ type: 'float32', dims: [1, VOCAB], data: new Float32Array(VOCAB), to: () => logits(), tolist: () => [] });
	const allowed = (t:Tensor):number[] => [...(t.data as Float32Array)].flatMap((s, id) => (s === -Infinity ? [] : [id]));
	const PROMPT = 3;
	const ids = (...reply:number[]):bigint[][] => [[9n, 9n, 9n, ...reply.map(BigInt)]];
	const schema = ():{ constraint:SchemaConstraint; fed:number[][] } => {
		const fed:number[][] = [];
		return {
			fed,
			constraint: {
				process: (seen, l) => {
					fed.push(seen[0].map(Number));
					(l.data as Float32Array).fill(-Infinity);
					l.data[7] = 0;
					return l;
				},
				dispose: () => undefined,
			},
		};
	};

	it('lets the first token start the answer or the thought', () => {
		const { constraint, fed } = schema();
		const gate = afterThought(constraint, tokenizer, PROMPT, undefined);
		assert.deepEqual(allowed(gate(ids(), logits())), [1, 7]);
		gate(ids(7), logits());
		assert.deepEqual(fed, [[], [7]]);
	});

	it('forces the rest of the open marker, thinks freely, then holds the answer to the schema', () => {
		const { constraint, fed } = schema();
		const gate = afterThought(constraint, tokenizer, PROMPT, undefined);
		gate(ids(), logits());
		assert.deepEqual(allowed(gate(ids(1), logits())), [2]);
		assert.equal(allowed(gate(ids(1, 2, 5), logits())).length, VOCAB);
		assert.deepEqual(allowed(gate(ids(1, 2, 5, 3), logits())), [7]);
		gate(ids(1, 2, 5, 3, 7), logits());
		assert.deepEqual(fed, [[], [], [7]]);
	});

	it('thinks from the first token when the template opened the thought', () => {
		const { constraint, fed } = schema();
		const gate = afterThought(constraint, tokenizer, PROMPT, '<|channel>thought');
		assert.equal(allowed(gate(ids(), logits())).length, VOCAB);
		assert.deepEqual(allowed(gate(ids(5, 3), logits())), [7]);
		assert.deepEqual(fed, [[]]);
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
