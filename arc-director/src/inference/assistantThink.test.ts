import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	DONE_THOUGHT,
	EMPTY_THINK_PREFILL,
	PREFILL_MARKER,
	clearAssistantThinkCache,
	fallbackThoughtPrefill,
	prefillFromTemplates,
	resolveAssistantPrefill,
	resolveThoughtPrefill,
	thoughtPrefillFromTemplates,
	withAssistantPrefill,
} from './assistantThink.js';

describe('assistantThink', () => {
	it('prefers Harmony to=user over think tags', () => {
		const header = '<|start|>assistant to=user<|channel|>final<|message|>';
		const generation = '<|start|>user<|message|>y<|end|><|start|>assistant<|channel|>analysis<|message|><think>';
		const withAssistant = `<|start|>user<|message|>y<|end|>${header}${PREFILL_MARKER}`;
		assert.equal(prefillFromTemplates(generation, withAssistant), header);
	});

	it('closes an empty think block using the template think tags', () => {
		const generation = '<|im_start|>user\ny<|im_end|>\n<|im_start|>assistant\n<think>';
		const withAssistant = `<|im_start|>user\ny<|im_end|>\n<|im_start|>assistant\n${PREFILL_MARKER}`;
		assert.equal(prefillFromTemplates(generation, withAssistant), '<think></think>');
	});

	it('uses the assistant header when it differs from the generation tail', () => {
		const header = '<|start|>assistant<|channel|>final<|message|>';
		const generation = '<|start|>user<|message|>y<|end|><|start|>assistant<|channel|>analysis<|message|>';
		const withAssistant = `<|start|>user<|message|>y<|end|>${header}${PREFILL_MARKER}`;
		assert.equal(prefillFromTemplates(generation, withAssistant), header);
	});

	it('returns null when the marked assistant turn matches generation', () => {
		const tail = '<|start|>assistant<|message|>';
		const generation = `<|start|>user<|message|>y<|end|>${tail}`;
		const withAssistant = `<|start|>user<|message|>y<|end|>${tail}${PREFILL_MARKER}`;
		assert.equal(prefillFromTemplates(generation, withAssistant), null);
	});

	it('wraps a canned thought in the template think tags', () => {
		const generation = '<|im_start|>user\ny<|im_end|>\n<|im_start|>assistant\n<think>';
		const withAssistant = `<|im_start|>user\ny<|im_end|>\n<|im_start|>assistant\n${PREFILL_MARKER}`;
		assert.equal(
			thoughtPrefillFromTemplates(generation, withAssistant),
			`<think>\n${DONE_THOUGHT}\n</think>`,
		);
	});

	it('appends Harmony to=user after a canned thought', () => {
		const header = '<|start|>assistant to=user<|channel|>final<|message|>';
		const generation = '<|start|>user<|message|>y<|end|><|start|>assistant<|channel|>analysis<|message|><think>';
		const withAssistant = `<|start|>user<|message|>y<|end|>${header}${PREFILL_MARKER}`;
		assert.equal(
			thoughtPrefillFromTemplates(generation, withAssistant),
			`<think>\n${DONE_THOUGHT}\n</think>${header}`,
		);
	});

	it('falls back to redacted_thinking when the template has no think tags', () => {
		assert.equal(fallbackThoughtPrefill(), `<redacted_thinking>\n${DONE_THOUGHT}\n</redacted_thinking>`);
		assert.equal(EMPTY_THINK_PREFILL, '<redacted_thinking></redacted_thinking>');
	});

	it('caches resolveAssistantPrefill by modelKey', async () => {
		clearAssistantThinkCache();
		let n = 0;
		const apply = async (messages:{ role:string }[]) => {
			n += 1;
			const marked = messages.at(-1)?.role === 'assistant' ? PREFILL_MARKER : '';
			return `<|im_start|>assistant\n<think>${marked}`;
		};
		const first = await resolveAssistantPrefill(apply, 'muse');
		const second = await resolveAssistantPrefill(apply, 'muse');
		const done = await resolveThoughtPrefill(apply, 'muse');
		assert.equal(first, '<think></think>');
		assert.equal(second, '<think></think>');
		assert.equal(done, `<think>\n${DONE_THOUGHT}\n</think>`);
		assert.equal(n, 2);
		clearAssistantThinkCache();
	});

	it('appends a trailing assistant prefill', () => {
		const messages = withAssistantPrefill(
			[{ role: 'user', content: 'pong' }],
			EMPTY_THINK_PREFILL,
		);
		assert.equal(messages.at(-1)?.role, 'assistant');
		assert.equal(messages.at(-1)?.content, EMPTY_THINK_PREFILL);
	});
});
