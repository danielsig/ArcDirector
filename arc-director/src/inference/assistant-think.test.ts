import assert from 'node:assert/strict';
import { alwaysThinks } from './models.js';
import { describe, it } from 'node:test';
import {
	PREFILL_MARKER,
	clearAssistantThinkCache,
	prefillFromTemplates,
	resolveAssistantPrefill,
	withAssistantPrefill,
} from './assistant-think.js';
import { cleanThought } from './wire-formats.js';

/**
 * Each family's chat template (on Hugging Face, 2026-11-15) rendered for a system and a user message: with the
 * generation prompt (thinking off where the template asks), and with a marked assistant message after them.
 */
const FAMILIES:{ model:string; generation:string; withAssistant:string; skip:string | null; leaked:string }[] = [
	{
		model: 'google/gemma-4-12b-qat',
		generation: '<|turn>system\nx<turn|>\n<|turn>user\ny<turn|>\n<|turn>model\n<|channel>thought\n<channel|>',
		withAssistant: `<|turn>system\nx<turn|>\n<|turn>user\ny<turn|>\n<|turn>model\n${PREFILL_MARKER}<turn|>\n`,
		skip: '<|channel>thought\n<channel|>',
		leaked: '<|channel>thought\nGo to the Well.<channel|><|channel>thought\n',
	},
	{
		model: 'qwen/qwen3.5-9b',
		generation: '<|im_start|>system\nx<|im_end|>\n<|im_start|>user\ny<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n',
		withAssistant: `<|im_start|>system\nx<|im_end|>\n<|im_start|>user\ny<|im_end|>\n<|im_start|>assistant\n${PREFILL_MARKER}<|im_end|>\n`,
		skip: '<think>\n\n</think>\n\n',
		leaked: '<think>\nGo to the Well.\n</think>',
	},
	{
		model: 'microsoft/phi-4-reasoning-plus',
		generation: '<|im_start|>system<|im_sep|>x<|im_end|><|im_start|>user<|im_sep|>y<|im_end|><|im_start|>assistant<|im_sep|>',
		withAssistant: `<|im_start|>system<|im_sep|>x<|im_end|><|im_start|>user<|im_sep|>y<|im_end|><|im_start|>assistant<|im_sep|>${PREFILL_MARKER}<|im_end|>`,
		skip: null,
		leaked: '<think> Go to the Well. </think>',
	},
	{
		model: 'deepseek/deepseek-r1-0528-qwen3-8b',
		generation: 'x<｜User｜>y<｜Assistant｜>',
		withAssistant: `x<｜User｜>y<｜Assistant｜>${PREFILL_MARKER}<｜end▁of▁sentence｜>`,
		skip: null,
		leaked: '<think>\nGo to the Well.\n</think>',
	},
	{
		model: 'openai/gpt-oss-20b',
		generation: '<|start|>system<|message|>x<|end|><|start|>user<|message|>y<|end|><|start|>assistant',
		withAssistant: `<|start|>system<|message|>x<|end|><|start|>user<|message|>y<|end|><|start|>assistant<|channel|>final<|message|>${PREFILL_MARKER}<|return|>`,
		skip: '<|start|>assistant<|channel|>final<|message|>',
		leaked: '<|channel|>analysis<|message|>Go to the Well.<|end|>',
	},
	{
		model: 'meta/muse-glimmer',
		generation: '<|start|>system<|message|>x<|eot|><|start|>user<|message|>y<|eot|><|start|>assistant',
		withAssistant: `<|start|>system<|message|>x<|eot|><|start|>user<|message|>y<|eot|><|start|>assistant to=user<|message|>${PREFILL_MARKER}<|eot|>`,
		skip: '<|start|>assistant to=user<|message|>',
		leaked: '<|start|>assistant to=self<|message|>Go to the Well.<|eom|>',
	},
];

describe('assistantThink', () => {
	for (const family of FAMILIES) {
		it(`writes ${family.model}'s thoughts in its own tags, and cleans them out of a thought`, () => {
			assert.equal(prefillFromTemplates(family.generation, family.withAssistant), family.skip);
			assert.equal(cleanThought(family.leaked), 'Go to the Well.');
		});
	}

	it('prefers Harmony to=user over think tags', () => {
		const header = '<|start|>assistant to=user<|channel|>final<|message|>';
		const generation = '<|start|>user<|message|>y<|end|><|start|>assistant<|channel|>analysis<|message|><think>';
		const withAssistant = `<|start|>user<|message|>y<|end|>${header}${PREFILL_MARKER}`;
		assert.equal(prefillFromTemplates(generation, withAssistant), header);
	});

	it('returns null when the marked assistant turn matches generation', () => {
		const tail = '<|start|>assistant<|message|>';
		const generation = `<|start|>user<|message|>y<|end|>${tail}`;
		const withAssistant = `<|start|>user<|message|>y<|end|>${tail}${PREFILL_MARKER}`;
		assert.equal(prefillFromTemplates(generation, withAssistant), null);
	});

	it("closes a thought in <think>'s kin when the template writes one", () => {
		const generation = '<|im_start|>user\ny<|im_end|>\n<|im_start|>assistant\n<redacted_thinking>';
		const withAssistant = `<|im_start|>user\ny<|im_end|>\n<|im_start|>assistant\n${PREFILL_MARKER}`;
		assert.equal(prefillFromTemplates(generation, withAssistant), '<redacted_thinking>\n\n</redacted_thinking>\n\n');
	});

	it('caches resolveAssistantPrefill by modelKey', async () => {
		clearAssistantThinkCache();
		let n = 0;
		const apply = async (messages:{ role:string }[]) => {
			n += 1;
			const marked = messages.at(-1)?.role === 'assistant' ? PREFILL_MARKER : '';
			return `<|im_start|>assistant\n<think>${marked}`;
		};
		const first = await resolveAssistantPrefill(apply, 'qwen3');
		const second = await resolveAssistantPrefill(apply, 'qwen3');
		assert.equal(first, '<think>\n\n</think>\n\n');
		assert.equal(second, '<think>\n\n</think>\n\n');
		assert.equal(n, 2);
		clearAssistantThinkCache();
	});

	it('knows the models that always think', () => {
		assert.equal(alwaysThinks('qwen/qwen3-4b-thinking-2507'), true);
		assert.equal(alwaysThinks('qwen3-4b-thinking-arcs'), true);
		assert.equal(alwaysThinks('qwen/qwen3-4b-instruct-2507'), false);
		assert.equal(alwaysThinks('google/gemma-4-e4b'), false);
	});

	it('appends a trailing assistant prefill', () => {
		const messages = withAssistantPrefill([{ role: 'user', content: 'pong' }], '<think>\n\n</think>\n\n');
		assert.equal(messages.at(-1)?.role, 'assistant');
		assert.equal(messages.at(-1)?.content, '<think>\n\n</think>\n\n');
	});
});
