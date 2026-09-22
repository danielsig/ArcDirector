import type { ChatMessage } from './provider.js';

/**
 * Prefills for the model's reasoning channel.
 * Lifted from the LM Studio imageVision plugin: close an empty think block, or
 * use the Harmony `to=user` assistant header from the model's prompt template.
 * The same tokens wrap a canned finished thought so a follow-up turn does not
 * generate new CoT.
 */
const thinkingTag = 'redacted_thinking';
export const EMPTY_THINK_PREFILL = `<${thinkingTag}></${thinkingTag}>`;
export const DONE_THOUGHT = 'I have to respond either with "ok" or a new Arc adapted to the circumstances but only if I must.\n\nI\'m ready to respond.';
const THINK_TAG_RE = /<\/?(?:redacted_)?think(?:ing)?>/i;
const THINK_OPEN_RE = /<(redacted_thinking|think(?:ing)?)>/i;
export const PREFILL_MARKER = '§PREFILL§';
const TURN_OPEN_TOKENS = ['<|start|>', '<|im_start|>', '<|start_header_id|>', '<start_of_turn>'];

type ThinkTags = { open:string; close:string };

export type AssistantThink = {
	/** Skip CoT (empty think or Harmony `to=user`). */
	skip:string | null;
	/** Finished thought so generation starts at the answer. */
	done:string;
};

const assistantThinkByModelKey = new Map<string, AssistantThink>();

export type PromptTemplateMessage = {
	role:'system' | 'user' | 'assistant';
	content:string;
};

export type ApplyPromptTemplate = (messages:PromptTemplateMessage[])=>Promise<string>;

function lastTurnOpen(s:string):number {
	let last = -1;
	for (const token of TURN_OPEN_TOKENS) {
		const at = s.lastIndexOf(token);
		if (at > last) {
			last = at;
		}
	}
	return last;
}

function turnSuffix(s:string):string {
	const at = lastTurnOpen(s);
	return at >= 0 ? s.slice(at) : '';
}

function thinkTagsFrom(s:string):ThinkTags {
	const m = s.match(THINK_OPEN_RE);
	const name = m?.[1] ?? thinkingTag;
	return { open: `<${name}>`, close: `</${name}>` };
}

function wrapThought(tags:ThinkTags, body:string):string {
	return `${tags.open}\n${body}\n${tags.close}`;
}

function templateParts(generation:string, withAssistant:string):{ asstHeader:string; genTail:string } {
	const markerAt = withAssistant.indexOf(PREFILL_MARKER);
	const asstHeader = markerAt >= 0 ? turnSuffix(withAssistant.slice(0, markerAt)) : '';
	return { asstHeader, genTail: turnSuffix(generation) };
}

/**
 * Prefill that skips the model's reasoning channel, derived from its prompt template.
 * Take the last turn-open token before a marked assistant message — not a common-prefix
 * split, which slices through a shared `<|start|>assistant` and drops `to=user`.
 * Harmony `to=user` wins over think-tag detection (LM Studio may inject those when
 * reasoning is on).
 */
export function prefillFromTemplates(generation:string, withAssistant:string):string | null {
	const { asstHeader, genTail } = templateParts(generation, withAssistant);
	if (/to=user/i.test(asstHeader)) {
		return asstHeader;
	}
	if (THINK_TAG_RE.test(genTail)) {
		const { open, close } = thinkTagsFrom(genTail);
		return `${open}${close}`;
	}
	if (asstHeader && asstHeader !== genTail) {
		return asstHeader;
	}
	return null;
}

/** Canned finished thought in the template's think tokens, then the answer channel if Harmony. */
export function thoughtPrefillFromTemplates(
	generation:string,
	withAssistant:string,
	body = DONE_THOUGHT,
):string {
	const { genTail } = templateParts(generation, withAssistant);
	const thought = wrapThought(thinkTagsFrom(genTail), body);
	const skip = prefillFromTemplates(generation, withAssistant);
	if (skip && !THINK_TAG_RE.test(skip)) {
		return `${thought}${skip}`;
	}
	return thought;
}

export function fallbackThoughtPrefill(body = DONE_THOUGHT):string {
	return wrapThought(thinkTagsFrom(''), body);
}

export function clearAssistantThinkCache():void {
	assistantThinkByModelKey.clear();
}

function fromTemplates(generation:string, withAssistant:string):AssistantThink {
	return {
		skip: prefillFromTemplates(generation, withAssistant),
		done: thoughtPrefillFromTemplates(generation, withAssistant),
	};
}

/** Cached in-memory by modelKey. */
export async function resolveAssistantThink(
	applyPromptTemplate:ApplyPromptTemplate,
	modelKey?:string,
):Promise<AssistantThink> {
	if (modelKey !== undefined && assistantThinkByModelKey.has(modelKey)) {
		return assistantThinkByModelKey.get(modelKey)!;
	}
	const fallback:AssistantThink = { skip: null, done: fallbackThoughtPrefill() };
	try {
		const prefix:PromptTemplateMessage[] = [
			{ role: 'system', content: 'x' },
			{ role: 'user', content: 'y' },
		];
		const [generation, withAssistant] = await Promise.all([
			applyPromptTemplate(prefix),
			applyPromptTemplate([...prefix, { role: 'assistant', content: PREFILL_MARKER }]),
		]);
		const think = fromTemplates(generation, withAssistant);
		if (modelKey !== undefined) {
			assistantThinkByModelKey.set(modelKey, think);
		}
		return think;
	}
	catch {
		return fallback;
	}
}

/** Cached skip prefill. */
export async function resolveAssistantPrefill(
	applyPromptTemplate:ApplyPromptTemplate,
	modelKey?:string,
):Promise<string | null> {
	return (await resolveAssistantThink(applyPromptTemplate, modelKey)).skip;
}

/** Cached finished-thought prefill. */
export async function resolveThoughtPrefill(
	applyPromptTemplate:ApplyPromptTemplate,
	modelKey?:string,
):Promise<string> {
	return (await resolveAssistantThink(applyPromptTemplate, modelKey)).done;
}

/** Trailing assistant message is the generation prefill (OpenAI / LM Studio). */
export function withAssistantPrefill(messages:ChatMessage[], prefill:string):ChatMessage[] {
	const last = messages.at(-1);
	if (last?.role === 'assistant' && last.content === prefill) {
		return messages;
	}
	return [...messages, { role: 'assistant', content: prefill }];
}
