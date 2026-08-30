import { envGet } from '../env.js';
import { extractJson, isRecord } from '../json.js';
import { isThinkingModel, thinkOffMode } from './models.js';
import type {
	ChatContent,
	ChatContentPart,
	ChatMessage,
	ChatRequest,
	ChatResponse,
	InferenceProvider,
	ToolCall,
	ToolDef,
} from './provider.js';
import {
	pickBestThread,
	rememberThread,
	type ThreadSnapshot,
} from './threadCache.js';

export const REASONING_EFFORTS = ['low', 'medium', 'xhigh'] as const;
export type ReasoningEffort = typeof REASONING_EFFORTS[number];

export type HttpLoadConfig = {
	flashAttention?:boolean;
	offloadKvCacheToGpu?:boolean;
	evalBatchSize?:number;
	parallel?:number;
};

export type HttpProviderConfig = {
	baseURL?:string;
	apiKey?:string;
	fetch?:typeof fetch;
	timeoutMs?:number;
	/** Default `max_tokens` when a chat request does not set its own. */
	maxTokens?:number;
	/**
	 * When false (default), disable chain-of-thought on thinking models.
	 * A thinking budget without this flag enables thinking on every NPC tick.
	 */
	enableThinking?:boolean;
	/**
	 * Thinking intensity (`low` / `medium` / `xhigh`).
	 * Ignored unless `enableThinking` is true. Do not set together with `thinkingBudget`.
	 */
	reasoningEffort?:ReasoningEffort;
	/** Cap thinking tokens. Only sent when `enableThinking` is true. */
	thinkingBudget?:number;
	/** Used when POST /api/v1/models/load exists. */
	load?:HttpLoadConfig;
};

function parseEffort(raw:string | undefined):ReasoningEffort | undefined {
	if (raw === 'low' || raw === 'medium' || raw === 'xhigh') {
		return raw;
	}
	return undefined;
}

function parseBudget(raw:string | undefined):number | undefined {
	if (raw === undefined) {
		return undefined;
	}
	const n = Number(raw);
	if (!Number.isFinite(n) || n < 1) {
		return undefined;
	}
	return Math.floor(n);
}

function parseEnableThinking(raw:string | undefined):boolean | undefined {
	if (raw === undefined) {
		return undefined;
	}
	if (raw === '0' || raw === 'false' || raw === 'off') {
		return false;
	}
	if (raw === '1' || raw === 'true' || raw === 'on') {
		return true;
	}
	return undefined;
}

function withNoThink(messages:ChatMessage[]):ChatMessage[] {
	const out = messages.map((m) => ({ ...m }));
	for (let i = 0; i < out.length; i++) {
		const m = out[i];
		if (m.role !== 'system' || m.content === null) {
			continue;
		}
		out[i] = { ...m, content: appendNoThink(m.content) };
		return out;
	}
	out.unshift({ role: 'system', content: '/no_think' });
	return out;
}

function appendNoThink(content:Exclude<ChatContent, null>):Exclude<ChatContent, null> {
	if (typeof content === 'string') {
		return content.includes('/no_think') ? content : `${content}\n/no_think`;
	}
	const parts:ChatContentPart[] = content.map((p) => (
		p.type === 'text' ? { ...p } : { type: 'image_url', image_url: { ...p.image_url } }
	));
	for (let i = parts.length - 1; i >= 0; i--) {
		const part = parts[i];
		if (part.type !== 'text') {
			continue;
		}
		if (!part.text.includes('/no_think')) {
			parts[i] = { type: 'text', text: `${part.text}\n/no_think` };
		}
		return parts;
	}
	parts.push({ type: 'text', text: '/no_think' });
	return parts;
}

function defaultBaseURL():string {
	return envGet('ARC_DIRECTOR_BASE_URL')
		?? envGet('OLLAMA_HOST')
		?? 'http://127.0.0.1:1234/v1';
}

function joinURL(base:string, path:string):string {
	return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** Native `fetch` throws if invoked as a method (`this.fetchImpl()`). */
function asFetch(impl:typeof fetch):typeof fetch {
	return (input, init) => impl(input, init);
}

function sleep(ms:number):Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function shouldRetry(status:number, body:string):boolean {
	if (status >= 500) {
		return true;
	}
	if (status !== 400) {
		return false;
	}
	return /speculative|server_error|sub-batch|try again/i.test(body);
}

export function serverRoot(baseURL:string):string {
	return baseURL.replace(/\/+$/, '').replace(/\/v1$/i, '');
}

function toChatMessages(messages:ChatMessage[]):unknown[] {
	return messages.map((m) => {
		const row:Record<string, unknown> = { role: m.role };
		if (m.content !== null) {
			row.content = m.content;
		}
		if (m.name) {
			row.name = m.name;
		}
		if (m.toolCallID) {
			row['tool_call_id'] = m.toolCallID;
		}
		if (m.toolCalls && m.toolCalls.length > 0) {
			row['tool_calls'] = m.toolCalls.map((c) => ({
				id: c.id,
				type: 'function',
				function: { name: c.name, arguments: c.arguments },
			}));
		}
		return row;
	});
}

function textFrom(value:unknown):string | null {
	if (typeof value === 'string' && value.trim().length > 0) {
		return value;
	}
	if (!Array.isArray(value)) {
		return null;
	}
	const parts:string[] = [];
	for (const item of value) {
		if (typeof item === 'string') {
			parts.push(item);
		}
		else if (isRecord(item) && typeof item.text === 'string') {
			parts.push(item.text);
		}
	}
	const joined = parts.join('').trim();
	return joined.length > 0 ? joined : null;
}

function messageText(message:Record<string, unknown>):string | null {
	const content = textFrom(message.content);
	if (content) {
		return content;
	}
	const reasoning = textFrom(message['reasoning_content']);
	if (!reasoning) {
		return null;
	}
	try {
		extractJson(reasoning);
		return reasoning;
	}
	catch {
		return null;
	}
}

function parseToolCalls(raw:unknown):ToolCall[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const out:ToolCall[] = [];
	for (const item of raw) {
		if (!isRecord(item)) {
			continue;
		}
		const fn = isRecord(item.function) ? item.function : {};
		const id = typeof item.id === 'string'
			? item.id
			: typeof item['call_id'] === 'string' ? item['call_id'] : `call_${out.length}`;
		const name = typeof fn.name === 'string'
			? fn.name
			: typeof item.name === 'string' ? item.name : '';
		const args = typeof fn.arguments === 'string'
			? fn.arguments
			: typeof item.arguments === 'string'
				? item.arguments
				: JSON.stringify(fn.arguments ?? item.arguments ?? {});
		if (name) {
			out.push({ id, name, arguments: args });
		}
	}
	return out;
}

function responseTools(tools:ToolDef[] | undefined):unknown[] | undefined {
	if (!tools || tools.length === 0) {
		return undefined;
	}
	return tools.map((t) => ({
		type: 'function',
		name: t.name,
		description: t.description,
		parameters: t.parameters,
	}));
}

function contentToInput(content:Exclude<ChatContent, null>):unknown {
	if (typeof content === 'string') {
		return content;
	}
	return content.map((p) => {
		if (p.type === 'text') {
			return { type: 'input_text', text: p.text };
		}
		return { type: 'input_image', image_url: p.image_url.url };
	});
}

function messagesToInput(messages:ChatMessage[]):unknown[] {
	const out:unknown[] = [];
	for (const m of messages) {
		if (m.role === 'tool') {
			out.push({
				type: 'function_call_output',
				call_id: m.toolCallID ?? '',
				output: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''),
			});
			continue;
		}
		if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
			for (const call of m.toolCalls) {
				out.push({
					type: 'function_call',
					call_id: call.id,
					name: call.name,
					arguments: call.arguments,
				});
			}
			continue;
		}
		if (m.content === null) {
			continue;
		}
		out.push({
			type: 'message',
			role: m.role,
			content: contentToInput(m.content),
		});
	}
	return out;
}

function asMs(value:unknown, unit:'ms' | 's' | 'ns'):number | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		return undefined;
	}
	if (unit === 's') {
		return value * 1000;
	}
	if (unit === 'ns') {
		return value / 1e6;
	}
	return value;
}

function cachedFromUsage(usage:Record<string, unknown>):number | undefined {
	const details = isRecord(usage['input_tokens_details'])
		? usage['input_tokens_details']
		: isRecord(usage['prompt_tokens_details']) ? usage['prompt_tokens_details'] : {};
	return typeof details['cached_tokens'] === 'number' && Number.isFinite(details['cached_tokens'])
		? details['cached_tokens']
		: undefined;
}

/** Prompt-eval vs generate timings from local servers (LM Studio, llama.cpp, Ollama). */
export function parseChatTimings(json:Record<string, unknown>):{
	cachedTokens:number | undefined;
	promptMs:number | undefined;
	generateMs:number | undefined;
} {
	const usage = isRecord(json.usage) ? json.usage : {};
	const stats = isRecord(json.stats) ? json.stats : {};
	const timings = isRecord(json.timings) ? json.timings : {};
	const promptMs = asMs(timings.prompt_ms, 'ms')
		?? asMs(stats.time_to_first_token_seconds, 's')
		?? asMs(stats.time_to_first_token, 's')
		?? asMs(stats.time_to_first_token_ms, 'ms')
		?? asMs(json.prompt_eval_duration, 'ns');
	let generateMs = asMs(timings.predicted_ms, 'ms')
		?? asMs(stats.generation_time, 's')
		?? asMs(stats.generation_time_ms, 'ms')
		?? asMs(json.eval_duration, 'ns');
	const totalMs = asMs(stats.total_time_ms, 'ms')
		?? asMs(stats.total_time, 's');
	if (generateMs === undefined && promptMs !== undefined && totalMs !== undefined) {
		generateMs = Math.max(0, totalMs - promptMs);
	}
	return {
		cachedTokens: cachedFromUsage(usage),
		promptMs,
		generateMs,
	};
}

function nowMs():number {
	return performance.now();
}

export function mergeClientTimings(
	server:{ promptMs?:number; generateMs?:number },
	firstMs:number | undefined,
	wallMs:number,
):{ promptMs?:number; generateMs?:number } {
	let promptMs = server.promptMs;
	let generateMs = server.generateMs;
	if (promptMs === undefined && firstMs !== undefined) {
		const leftover = wallMs - firstMs;
		const buffered = leftover < 8 && wallMs > 200 && firstMs > 20;
		if (!buffered) {
			promptMs = firstMs;
			if (generateMs === undefined) {
				generateMs = Math.max(0, leftover);
			}
		}
	}
	else if (generateMs === undefined && promptMs !== undefined) {
		generateMs = Math.max(0, wallMs - promptMs);
	}
	return { promptMs, generateMs };
}

function isFirstTokenEvent(ev:Record<string, unknown>):boolean {
	const type = typeof ev.type === 'string' ? ev.type : '';
	if (type.endsWith('.delta') && !type.includes('logprob')) {
		if (typeof ev.delta === 'string') {
			return ev.delta.length > 0;
		}
		return true;
	}
	const choices = Array.isArray(ev.choices) ? ev.choices : [];
	const first = isRecord(choices[0]) ? choices[0] : {};
	const delta = isRecord(first.delta) ? first.delta : {};
	if (typeof delta.content === 'string' && delta.content.length > 0) {
		return true;
	}
	if (Array.isArray(delta['tool_calls']) && delta['tool_calls'].length > 0) {
		return true;
	}
	if (typeof delta['reasoning_content'] === 'string' && delta['reasoning_content'].length > 0) {
		return true;
	}
	return false;
}

function parseSseData(block:string):Record<string, unknown> | 'done' | undefined {
	let eventName = '';
	const lines:string[] = [];
	for (const line of block.split(/\r?\n/)) {
		if (line.startsWith('event:')) {
			eventName = line.slice(6).trim();
		}
		else if (line.startsWith('data:')) {
			lines.push(line.slice(5).trimStart());
		}
	}
	const data = lines.join('\n').trim();
	if (!data || data === '[DONE]') {
		return data === '[DONE]' || eventName === 'done' ? 'done' : undefined;
	}
	try {
		const json:unknown = JSON.parse(data);
		if (!isRecord(json)) {
			return undefined;
		}
		if (typeof json.type !== 'string' && eventName) {
			json.type = eventName;
		}
		return json;
	}
	catch {
		return undefined;
	}
}

function takeSseBlocks(buf:string):{ events:Array<Record<string, unknown> | 'done'>; rest:string } {
	const parts = buf.split(/\r?\n\r?\n/);
	const rest = parts.pop() ?? '';
	const events:Array<Record<string, unknown> | 'done'> = [];
	for (const block of parts) {
		if (!block.trim()) {
			continue;
		}
		const ev = parseSseData(block);
		if (ev) {
			events.push(ev);
		}
	}
	return { events, rest };
}

function flushSse(buf:string):Array<Record<string, unknown> | 'done'> {
	if (!buf.trim()) {
		return [];
	}
	return takeSseBlocks(`${buf.replace(/\s+$/, '')}\n\n`).events;
}

function streamErrorMessage(ev:Record<string, unknown>):string | undefined {
	const type = typeof ev.type === 'string' ? ev.type : '';
	if (type !== 'error' && type !== 'response.failed') {
		return undefined;
	}
	const err = isRecord(ev.error)
		? ev.error
		: isRecord(ev.response) && isRecord(ev.response.error)
			? ev.response.error
			: undefined;
	if (err && typeof err.message === 'string' && err.message.trim()) {
		return err.message;
	}
	if (typeof ev.message === 'string' && ev.message.trim()) {
		return ev.message;
	}
	return type;
}

function sidecarOnto(target:Record<string, unknown>, ev:Record<string, unknown>):void {
	for (const key of ['usage', 'timings', 'stats'] as const) {
		if (target[key] === undefined && ev[key] !== undefined) {
			target[key] = ev[key];
		}
	}
}

function terminalResponse(ev:Record<string, unknown>):Record<string, unknown> | undefined {
	const type = typeof ev.type === 'string' ? ev.type : '';
	if (type !== 'response.completed' && type !== 'response.incomplete') {
		return undefined;
	}
	const base = isRecord(ev.response)
		? { ...ev.response }
		: Array.isArray(ev.output) ? { ...ev } : undefined;
	if (!base) {
		return undefined;
	}
	sidecarOnto(base, ev);
	return base;
}

function noteFunctionItem(
	item:Record<string, unknown>,
	funcs:Map<string, { id:string; name:string; arguments:string }>,
):void {
	const type = typeof item.type === 'string' ? item.type : '';
	if (type !== 'function_call' && type !== 'tool_call') {
		return;
	}
	const callID = typeof item['call_id'] === 'string'
		? item['call_id']
		: typeof item.id === 'string' ? item.id : `call_${funcs.size}`;
	const key = typeof item.id === 'string' ? item.id : callID;
	const prev = funcs.get(key);
	funcs.set(key, {
		id: callID,
		name: typeof item.name === 'string' && item.name ? item.name : (prev?.name ?? ''),
		arguments: typeof item.arguments === 'string' ? item.arguments : (prev?.arguments ?? ''),
	});
}

function responsesFromStream(args:{
	id:string | undefined;
	usage:Record<string, unknown> | undefined;
	timings:Record<string, unknown> | undefined;
	stats:Record<string, unknown> | undefined;
	doneItems:Record<string, unknown>[];
	text:string;
	reasoning:string;
	funcs:Map<string, { id:string; name:string; arguments:string }>;
}):Record<string, unknown> | undefined {
	const output:Record<string, unknown>[] = args.doneItems.length > 0 ? [...args.doneItems] : [];
	if (output.length === 0) {
		if (args.reasoning) {
			output.push({
				type: 'reasoning',
				content: [{ type: 'reasoning_text', text: args.reasoning }],
			});
		}
		if (args.text) {
			output.push({
				type: 'message',
				content: [{ type: 'output_text', text: args.text }],
			});
		}
		for (const fc of args.funcs.values()) {
			if (!fc.name) {
				continue;
			}
			output.push({
				type: 'function_call',
				call_id: fc.id,
				name: fc.name,
				arguments: fc.arguments,
			});
		}
	}
	if (output.length === 0) {
		return undefined;
	}
	const json:Record<string, unknown> = { output };
	if (args.id) {
		json.id = args.id;
	}
	if (args.usage) {
		json.usage = args.usage;
	}
	if (args.timings) {
		json.timings = args.timings;
	}
	if (args.stats) {
		json.stats = args.stats;
	}
	return json;
}

function parseJsonRecord(text:string, url:string, status:number):Record<string, unknown> {
	let parsed:unknown;
	try {
		parsed = text ? JSON.parse(text) : {};
	}
	catch {
		throw new Error(`inference ${url} returned non-JSON (${status}): ${text.slice(0, 240)}`);
	}
	if (!isRecord(parsed)) {
		throw new Error(`inference ${url} returned a non-object`);
	}
	return parsed;
}

async function readInferenceResponse(
	res:Response,
	url:string,
	t0:number,
):Promise<{ json:Record<string, unknown>; firstMs?:number; wallMs:number }> {
	const reader = res.body?.getReader();
	if (!reader) {
		const text = await res.text();
		return { json: parseJsonRecord(text, url, res.status), wallMs: nowMs() - t0 };
	}
	const decoder = new TextDecoder();
	let buf = '';
	let mode:'unknown' | 'json' | 'sse' = 'unknown';
	let firstMs:number | undefined;
	let completed:Record<string, unknown> | undefined;
	let lastChunk:Record<string, unknown> | undefined;
	let lastType = '';
	let responseId:string | undefined;
	let usage:Record<string, unknown> | undefined;
	let timings:Record<string, unknown> | undefined;
	let stats:Record<string, unknown> | undefined;
	let streamErr:string | undefined;
	let assembledContent = '';
	let assembledReasoning = '';
	let assembledTools:unknown = undefined;
	let assembledText = '';
	let responsesReasoning = '';
	const doneItems:Record<string, unknown>[] = [];
	const funcs = new Map<string, { id:string; name:string; arguments:string }>();
	const ingest = (raw:Record<string, unknown> | 'done'):void => {
		if (raw === 'done') {
			return;
		}
		const ev = raw;
		lastChunk = ev;
		const type = typeof ev.type === 'string' ? ev.type : '';
		if (type) {
			lastType = type;
		}
		if (isFirstTokenEvent(ev) && firstMs === undefined) {
			firstMs = nowMs() - t0;
		}
		const err = streamErrorMessage(ev);
		if (err) {
			streamErr = err;
		}
		const term = terminalResponse(ev);
		if (term) {
			completed = term;
			if (typeof term.id === 'string') {
				responseId = term.id;
			}
		}
		if (isRecord(ev.response) && typeof ev.response.id === 'string') {
			responseId = responseId ?? ev.response.id;
		}
		if (isRecord(ev.usage)) {
			usage = ev.usage;
		}
		if (isRecord(ev.timings)) {
			timings = ev.timings;
		}
		if (isRecord(ev.stats)) {
			stats = ev.stats;
		}
		if (type === 'response.output_item.done' && isRecord(ev.item)) {
			doneItems.push(ev.item);
			noteFunctionItem(ev.item, funcs);
		}
		else if (type === 'response.output_item.added' && isRecord(ev.item)) {
			noteFunctionItem(ev.item, funcs);
		}
		else if (type === 'response.function_call_arguments.delta' && typeof ev.delta === 'string') {
			const key = typeof ev.item_id === 'string' ? ev.item_id : '_';
			const prev = funcs.get(key) ?? {
				id: typeof ev['call_id'] === 'string' ? ev['call_id'] : key,
				name: '',
				arguments: '',
			};
			prev.arguments += ev.delta;
			funcs.set(key, prev);
		}
		else if (type === 'response.output_text.delta' && typeof ev.delta === 'string') {
			assembledText += ev.delta;
		}
		else if (type === 'response.output_text.done' && typeof ev.text === 'string') {
			assembledText = ev.text;
		}
		else if (
			(type === 'response.reasoning_text.delta' || type === 'response.reasoning.delta')
			&& typeof ev.delta === 'string'
		) {
			responsesReasoning += ev.delta;
		}
		const choices = Array.isArray(ev.choices) ? ev.choices : [];
		const choice = isRecord(choices[0]) ? choices[0] : {};
		if (isRecord(choice.message)) {
			const msg = choice.message;
			if (typeof msg.content === 'string') {
				assembledContent = msg.content;
			}
			if (typeof msg['reasoning_content'] === 'string') {
				assembledReasoning = msg['reasoning_content'];
			}
			if (msg['tool_calls'] !== undefined) {
				assembledTools = msg['tool_calls'];
			}
		}
		const delta = isRecord(choice.delta) ? choice.delta : {};
		if (typeof delta.content === 'string') {
			assembledContent += delta.content;
		}
		if (typeof delta['reasoning_content'] === 'string') {
			assembledReasoning += delta['reasoning_content'];
		}
		if (delta['tool_calls'] !== undefined) {
			assembledTools = delta['tool_calls'];
		}
	};
	for (;;) {
		const { done, value } = await reader.read();
		if (value) {
			buf += decoder.decode(value, { stream: !done });
		}
		else if (done) {
			buf += decoder.decode();
		}
		if (mode === 'unknown') {
			const start = buf.trimStart();
			if (start.startsWith('data:') || start.startsWith('event:')) {
				mode = 'sse';
			}
			else if (start.startsWith('{') || start.startsWith('[')) {
				mode = 'json';
			}
		}
		if (mode === 'sse') {
			const split = takeSseBlocks(buf);
			buf = split.rest;
			for (const ev of split.events) {
				ingest(ev);
			}
		}
		if (done) {
			break;
		}
	}
	const wallMs = nowMs() - t0;
	if (mode === 'sse') {
		for (const ev of flushSse(buf)) {
			ingest(ev);
		}
		if (streamErr) {
			throw new Error(`inference ${url} ${streamErr}`);
		}
		if (completed) {
			sidecarOnto(completed, { usage, timings, stats });
			return { json: completed, firstMs, wallMs };
		}
		const fromResponses = responsesFromStream({
			id: responseId,
			usage,
			timings,
			stats,
			doneItems,
			text: assembledText,
			reasoning: responsesReasoning,
			funcs,
		});
		if (fromResponses) {
			return { json: fromResponses, firstMs, wallMs };
		}
		if (assembledContent || assembledReasoning || assembledTools !== undefined) {
			const message:Record<string, unknown> = { role: 'assistant', content: assembledContent };
			if (assembledReasoning) {
				message['reasoning_content'] = assembledReasoning;
			}
			if (assembledTools !== undefined) {
				message['tool_calls'] = assembledTools;
			}
			return {
				json: {
					choices: [{ message }],
					usage: usage ?? lastChunk?.usage,
				},
				firstMs,
				wallMs,
			};
		}
		if (lastChunk && (Array.isArray(lastChunk.choices) || Array.isArray(lastChunk.output))) {
			return { json: lastChunk, firstMs, wallMs };
		}
		if (
			isRecord(lastChunk?.response)
			&& Array.isArray(lastChunk.response.output)
			&& lastChunk.response.output.length > 0
		) {
			return { json: lastChunk.response, firstMs, wallMs };
		}
		const hint = lastType ? ` (last event: ${lastType})` : '';
		throw new Error(`inference ${url} stream ended without a response${hint}`);
	}
	return { json: parseJsonRecord(buf, url, res.status), firstMs, wallMs };
}

function parseResponsesOutput(json:Record<string, unknown>):{
	content:string | null;
	toolCalls:ToolCall[];
	id:string | undefined;
	cachedTokens:number | undefined;
	promptMs:number | undefined;
	generateMs:number | undefined;
} {
	const id = typeof json.id === 'string'
		? json.id
		: typeof json['response_id'] === 'string' ? json['response_id'] : undefined;
	const stats = parseChatTimings(json);
	const cached = stats.cachedTokens;
	const output = Array.isArray(json.output) ? json.output : [];
	const toolCalls:ToolCall[] = [];
	const texts:string[] = [];
	for (const item of output) {
		if (!isRecord(item)) {
			continue;
		}
		const type = typeof item.type === 'string' ? item.type : '';
		if (type === 'function_call' || type === 'tool_call') {
			const name = typeof item.name === 'string'
				? item.name
				: typeof item.tool === 'string' ? item.tool : '';
			const callID = typeof item['call_id'] === 'string'
				? item['call_id']
				: typeof item.id === 'string' ? item.id : `call_${toolCalls.length}`;
			const args = typeof item.arguments === 'string'
				? item.arguments
				: JSON.stringify(item.arguments ?? {});
			if (name) {
				toolCalls.push({ id: callID, name, arguments: args });
			}
			continue;
		}
		if (type === 'message' || type === 'reasoning') {
			const text = textFrom(item.content) ?? (typeof item.content === 'string' ? item.content : null);
			if (text && type !== 'reasoning') {
				texts.push(text);
			}
			else if (text && type === 'reasoning') {
				try {
					extractJson(text);
					texts.push(text);
				}
				catch {
					// skip chain-of-thought
				}
			}
		}
	}
	return {
		content: texts.length > 0 ? texts.join('\n') : null,
		toolCalls,
		id,
		cachedTokens: cached,
		promptMs: stats.promptMs,
		generateMs: stats.generateMs,
	};
}

function assistantFromResponse(res:ChatResponse):ChatMessage {
	return {
		role: 'assistant',
		content: res.content,
		toolCalls: res.toolCalls.length > 0 ? res.toolCalls : undefined,
	};
}

export class HttpProvider implements InferenceProvider {
	readonly baseURL:string;
	readonly rootURL:string;
	private readonly apiKey:string | undefined;
	private readonly fetchImpl:typeof fetch;
	private readonly timeoutMs:number;
	private readonly maxTokens:number | undefined;
	private readonly enableThinking:boolean;
	private readonly reasoningEffort:ReasoningEffort | undefined;
	private readonly thinkingBudget:number | undefined;
	private readonly loadOpts:HttpLoadConfig;
	private responses:boolean | undefined;
	private loadEndpoint = false;
	private probed = false;
	private readonly loaded = new Set<string>();
	private readonly threads = new Map<string, ThreadSnapshot[]>();
	private loading:Promise<void> | null = null;

	constructor(config:HttpProviderConfig = {}) {
		this.baseURL = (config.baseURL ?? defaultBaseURL()).replace(/\/+$/, '');
		this.rootURL = serverRoot(this.baseURL);
		this.apiKey = config.apiKey ?? envGet('ARC_DIRECTOR_API_KEY') ?? envGet('OPENAI_API_KEY');
		this.fetchImpl = asFetch(config.fetch ?? fetch);
		this.timeoutMs = config.timeoutMs ?? 180_000;
		this.maxTokens = config.maxTokens ?? 4096;
		this.enableThinking = config.enableThinking
			?? parseEnableThinking(envGet('ARC_DIRECTOR_ENABLE_THINKING'))
			?? false;
		this.thinkingBudget = config.thinkingBudget ?? parseBudget(envGet('ARC_DIRECTOR_THINKING_BUDGET'));
		this.reasoningEffort = this.thinkingBudget !== undefined
			? undefined
			: (config.reasoningEffort ?? parseEffort(envGet('ARC_DIRECTOR_REASONING_EFFORT')));
		this.loadOpts = {
			flashAttention: config.load?.flashAttention ?? true,
			offloadKvCacheToGpu: config.load?.offloadKvCacheToGpu ?? true,
			evalBatchSize: config.load?.evalBatchSize ?? 512,
			parallel: config.load?.parallel,
		};
	}

	async chat(req:ChatRequest):Promise<ChatResponse> {
		await this.ensureReady(req.model);
		const messages = this.prepareMessages(req);
		if (this.responses === true || (this.responses !== false && this.loadEndpoint)) {
			try {
				return await this.chatResponses(req, messages);
			}
			catch (err) {
				if (this.responses === true) {
					const msg = err instanceof Error ? err.message : String(err);
					if (/stream ended without a response/.test(msg)) {
						return this.chatCompletions(req, messages);
					}
					throw err;
				}
				this.responses = false;
			}
		}
		return this.chatCompletions(req, messages);
	}

	async embed(texts:string[], model?:string):Promise<number[][]> {
		const name = model ?? envGet('ARC_DIRECTOR_EMBED_MODEL');
		if (!name) {
			throw new Error('embed: no model id (refusing to load a second embedding model)');
		}
		await this.ensureReady(name);
		const json = await this.post(joinURL(this.baseURL, 'embeddings'), {
			model: name,
			input: texts,
		});
		const data = Array.isArray(json.data) ? json.data : [];
		const rows:Array<{ index:number; vec:number[] }> = [];
		for (const item of data) {
			if (!isRecord(item) || !Array.isArray(item.embedding)) {
				continue;
			}
			const vec = item.embedding.map((n) => Number(n));
			const index = typeof item.index === 'number' ? item.index : rows.length;
			rows.push({ index, vec });
		}
		rows.sort((a, b) => a.index - b.index);
		if (rows.length !== texts.length) {
			throw new Error(`embed expected ${texts.length} vectors, got ${rows.length}`);
		}
		return rows.map((r) => r.vec);
	}

	private prepareMessages(req:ChatRequest):ChatMessage[] {
		const thinkingModel = isThinkingModel(req.model);
		const think = this.enableThinking && thinkingModel;
		const off = thinkOffMode(req.model);
		return !think && off === 'no_think' ? withNoThink(req.messages) : req.messages;
	}

	private async chatCompletions(req:ChatRequest, messages:ChatMessage[]):Promise<ChatResponse> {
		const body = this.completionBody(req, messages);
		const got = await this.postChat(joinURL(this.baseURL, 'chat/completions'), body, true);
		const json = got.json;
		const choices = Array.isArray(json.choices) ? json.choices : [];
		const first = isRecord(choices[0]) ? choices[0] : {};
		const message = isRecord(first.message) ? first.message : isRecord(first.delta) ? first.delta : {};
		const timings = parseChatTimings(json);
		const split = mergeClientTimings(timings, got.firstMs, got.wallMs);
		return {
			content: messageText(message),
			toolCalls: parseToolCalls(message['tool_calls'] ?? message['toolCalls']),
			cachedTokens: timings.cachedTokens,
			promptMs: split.promptMs,
			generateMs: split.generateMs,
		};
	}

	private async chatResponses(req:ChatRequest, messages:ChatMessage[]):Promise<ChatResponse> {
		const key = req.thread?.trim() || '';
		const stored = key ? (this.threads.get(key) ?? []) : [];
		const hit = key ? pickBestThread(stored, messages) : undefined;
		const suffix = hit ? messages.slice(hit.prefixLen) : messages;
		const body:Record<string, unknown> = {
			model: req.model,
			input: messagesToInput(suffix),
			store: true,
			temperature: req.temperature ?? 0,
		};
		if (hit) {
			body['previous_response_id'] = hit.id;
		}
		this.applyThinkFields(req, body, true);
		const cap = req.maxTokens ?? this.maxTokens;
		if (cap !== undefined) {
			body['max_output_tokens'] = cap;
		}
		const tools = responseTools(req.tools);
		if (tools) {
			body.tools = tools;
			if (req.toolChoice) {
				body['tool_choice'] = req.toolChoice;
			}
		}
		let got:{ json:Record<string, unknown>; firstMs?:number; wallMs:number };
		try {
			got = await this.postChat(joinURL(this.baseURL, 'responses'), body, false);
		}
		catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (/ 404:| 405:/.test(msg)) {
				this.responses = false;
				throw err;
			}
			throw err;
		}
		this.responses = true;
		const parsed = parseResponsesOutput(got.json);
		const split = mergeClientTimings(
			{ promptMs: parsed.promptMs, generateMs: parsed.generateMs },
			got.firstMs,
			got.wallMs,
		);
		const res:ChatResponse = {
			content: parsed.content,
			toolCalls: parsed.toolCalls,
			cachedTokens: parsed.cachedTokens,
			promptMs: split.promptMs,
			generateMs: split.generateMs,
		};
		if (key && parsed.id) {
			this.threads.set(key, rememberThread(stored, {
				id: parsed.id,
				messages: [...messages, assistantFromResponse(res)],
			}));
		}
		return res;
	}

	private completionBody(req:ChatRequest, messages:ChatMessage[]):Record<string, unknown> {
		const body:Record<string, unknown> = {
			model: req.model,
			messages: toChatMessages(messages),
			temperature: req.temperature ?? 0,
		};
		this.applyThinkFields(req, body, false);
		const cap = req.maxTokens ?? this.maxTokens;
		if (cap !== undefined) {
			body['max_tokens'] = cap;
		}
		if (req.tools && req.tools.length > 0) {
			body.tools = req.tools.map((t) => ({
				type: 'function',
				function: {
					name: t.name,
					description: t.description,
					parameters: t.parameters,
				},
			}));
			if (req.toolChoice) {
				body['tool_choice'] = req.toolChoice;
			}
		}
		return body;
	}

	private applyThinkFields(req:ChatRequest, body:Record<string, unknown>, responses:boolean):void {
		const thinkingModel = isThinkingModel(req.model);
		const think = this.enableThinking && thinkingModel;
		const off = thinkOffMode(req.model);
		if (think) {
			if (this.thinkingBudget !== undefined) {
				body['thinking_budget'] = this.thinkingBudget;
			}
			else if (this.reasoningEffort !== undefined) {
				body[responses ? 'reasoning' : 'reasoning_effort'] = responses
					? { effort: this.reasoningEffort }
					: this.reasoningEffort;
			}
			return;
		}
		if (off === 'effort_low') {
			if (responses) {
				body.reasoning = { effort: 'low' };
			}
			else {
				body['reasoning_effort'] = 'low';
			}
			return;
		}
		if (off === 'no_think') {
			if (responses) {
				body.reasoning = { effort: 'none' };
			}
			else {
				body['enable_thinking'] = false;
				body['reasoning_effort'] = 'none';
				body['chat_template_kwargs'] = { enable_thinking: false };
			}
		}
	}

	private async ensureReady(model:string):Promise<void> {
		if (!this.probed) {
			await this.probe();
		}
		while (this.loadEndpoint && !this.loaded.has(model)) {
			if (!this.loading) {
				this.loading = this.loadModel(model).finally(() => {
					this.loading = null;
				});
			}
			await this.loading;
		}
	}

	private async probe():Promise<void> {
		this.probed = true;
		try {
			const res = await this.fetchImpl(joinURL(this.rootURL, 'api/v1/models'), {
				method: 'GET',
				headers: this.headers(),
				signal: AbortSignal.timeout(Math.min(4000, this.timeoutMs)),
			});
			if (res.ok) {
				const json:unknown = await res.json();
				if (isRecord(json) && Array.isArray(json.models)) {
					this.loadEndpoint = true;
					for (const row of json.models) {
						if (!isRecord(row)) {
							continue;
						}
						const instances = Array.isArray(row.loaded_instances) ? row.loaded_instances : [];
						if (instances.length === 0) {
							continue;
						}
						if (typeof row.key === 'string') {
							this.loaded.add(row.key);
						}
						for (const inst of instances) {
							if (isRecord(inst) && typeof inst.id === 'string') {
								this.loaded.add(inst.id);
							}
						}
					}
				}
			}
		}
		catch {
			this.loadEndpoint = false;
		}
	}

	private async loadModel(model:string):Promise<void> {
		if (this.loaded.has(model)) {
			return;
		}
		const body:Record<string, unknown> = {
			model,
			flash_attention: this.loadOpts.flashAttention !== false,
			offload_kv_cache_to_gpu: this.loadOpts.offloadKvCacheToGpu !== false,
			eval_batch_size: this.loadOpts.evalBatchSize ?? 512,
			echo_load_config: true,
		};
		if (this.loadOpts.parallel !== undefined) {
			body.parallel = this.loadOpts.parallel;
		}
		try {
			await this.post(joinURL(this.rootURL, 'api/v1/models/load'), body);
			this.loaded.add(model);
		}
		catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (this.loadOpts.parallel !== undefined && / 400:/.test(msg)) {
				delete body.parallel;
				try {
					await this.post(joinURL(this.rootURL, 'api/v1/models/load'), body);
					this.loaded.add(model);
					return;
				}
				catch {
					this.loaded.add(model);
					return;
				}
			}
			if (/ 404:| 405:/.test(msg)) {
				this.loadEndpoint = false;
			}
			this.loaded.add(model);
		}
	}

	private headers():Record<string, string> {
		const headers:Record<string, string> = {
			'content-type': 'application/json',
		};
		if (this.apiKey) {
			headers.authorization = `Bearer ${this.apiKey}`;
		}
		return headers;
	}

	private async postChat(
		url:string,
		body:Record<string, unknown>,
		completions:boolean,
	):Promise<{ json:Record<string, unknown>; firstMs?:number; wallMs:number }> {
		let lastErr:Error | null = null;
		let stream = true;
		for (let attempt = 0; attempt < 4; attempt++) {
			if (attempt > 0) {
				await sleep(350 * attempt);
			}
			const payload:Record<string, unknown> = { ...body, stream };
			if (stream && completions) {
				payload['stream_options'] = { include_usage: true };
			}
			const t0 = nowMs();
			const res = await this.fetchImpl(url, {
				method: 'POST',
				headers: this.headers(),
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(this.timeoutMs),
			});
			if (!res.ok) {
				const text = await res.text();
				let parsed:unknown;
				try {
					parsed = text ? JSON.parse(text) : {};
				}
				catch {
					parsed = {};
				}
				const err = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : parsed;
				const msg = isRecord(err) && typeof err.message === 'string'
					? err.message
					: text.slice(0, 240);
				lastErr = new Error(`inference ${url} ${res.status}: ${msg}`);
				if (stream && (res.status === 400 || res.status === 415) && /stream/i.test(`${msg} ${text}`)) {
					stream = false;
					continue;
				}
				if (shouldRetry(res.status, text) && attempt < 3) {
					continue;
				}
				throw lastErr;
			}
			try {
				return await readInferenceResponse(res, url, t0);
			}
			catch (err) {
				lastErr = err instanceof Error ? err : new Error(String(err));
				if (stream && /stream ended without a response/.test(lastErr.message) && attempt < 3) {
					stream = false;
					continue;
				}
				throw lastErr;
			}
		}
		throw lastErr ?? new Error(`inference ${url} failed`);
	}

	private async post(url:string, body:Record<string, unknown>):Promise<Record<string, unknown>> {
		let lastErr:Error | null = null;
		for (let attempt = 0; attempt < 4; attempt++) {
			if (attempt > 0) {
				await sleep(350 * attempt);
			}
			const res = await this.fetchImpl(url, {
				method: 'POST',
				headers: this.headers(),
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(this.timeoutMs),
			});
			const text = await res.text();
			let parsed:unknown;
			try {
				parsed = text ? JSON.parse(text) : {};
			}
			catch {
				throw new Error(`inference ${url} returned non-JSON (${res.status}): ${text.slice(0, 240)}`);
			}
			if (!res.ok) {
				const err = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : parsed;
				const msg = isRecord(err) && typeof err.message === 'string'
					? err.message
					: text.slice(0, 240);
				lastErr = new Error(`inference ${url} ${res.status}: ${msg}`);
				if (shouldRetry(res.status, text) && attempt < 3) {
					continue;
				}
				throw lastErr;
			}
			if (!isRecord(parsed)) {
				throw new Error(`inference ${url} returned a non-object`);
			}
			return parsed;
		}
		throw lastErr ?? new Error(`inference ${url} failed`);
	}
}
