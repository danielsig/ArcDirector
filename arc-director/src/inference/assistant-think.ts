import { FAMILY_TAGS, thinkTags, type ThoughtTags } from './models.js';
import type { ChatMessage } from './provider.js';

/**
 * Prefills for the model's reasoning channel.
 * Lifted from the LM Studio imageVision plugin: close an empty thought in the tags the model's prompt template writes,
 * or use the Harmony `to=user` assistant header from the template.
 */
/** `<think>`'s kin some templates write instead. */
const THINK_KIN_RE = /<(redacted_thinking|thinking)>/i;
export const PREFILL_MARKER = '§PREFILL§';
const TURN_OPEN_TOKENS = ['<|start|>', '<|im_start|>', '<|start_header_id|>', '<start_of_turn>', '<|turn>', '<｜Assistant｜>'];

/** Each model's skip prefill, by modelKey. */
const prefillByModelKey = new Map<string, string | null>();

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

/** The tags `text` (a template's) writes a thought in: a family's, or `<think>`'s kin; undefined for none. */
function tagsIn(text:string):ThoughtTags | undefined {
	const kin = THINK_KIN_RE.exec(text)?.[1];
	return FAMILY_TAGS.find((tags) => text.includes(tags.open)) ?? (kin ? thinkTags(kin) : undefined);
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
	const tags = tagsIn(genTail);
	if (tags) {
		return tags.thought('');
	}
	if (asstHeader && asstHeader !== genTail) {
		return asstHeader;
	}
	return null;
}

export function clearAssistantThinkCache():void {
	prefillByModelKey.clear();
}

/** The skip prefill ({@link prefillFromTemplates}) from `modelKey`'s prompt template, cached by `modelKey`; null when the template cannot be read. */
export async function resolveAssistantPrefill(
	applyPromptTemplate:ApplyPromptTemplate,
	modelKey?:string,
):Promise<string | null> {
	if (modelKey !== undefined && prefillByModelKey.has(modelKey)) {
		return prefillByModelKey.get(modelKey)!;
	}
	try {
		const prefix:PromptTemplateMessage[] = [
			{ role: 'system', content: 'x' },
			{ role: 'user', content: 'y' },
		];
		const [generation, withAssistant] = await Promise.all([
			applyPromptTemplate(prefix),
			applyPromptTemplate([...prefix, { role: 'assistant', content: PREFILL_MARKER }]),
		]);
		const skip = prefillFromTemplates(generation, withAssistant);
		if (modelKey !== undefined) {
			prefillByModelKey.set(modelKey, skip);
		}
		return skip;
	}
	catch {
		return null;
	}
}

/** Trailing assistant message is the generation prefill (OpenAI / LM Studio). */
export function withAssistantPrefill(messages:ChatMessage[], prefill:string):ChatMessage[] {
	const last = messages.at(-1);
	if (last?.role === 'assistant' && last.content === prefill) {
		return messages;
	}
	return [...messages, { role: 'assistant', content: prefill }];
}
