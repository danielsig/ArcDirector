import { envGet } from '../env.js';
import { extractJson, isRecord } from '../json.js';
import {
	asModelList,
	isThinkingModel,
	modelIDsMatch,
	pickReasoningOption,
	thinkOffMode,
	type ReasoningOption,
} from './models.js';
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
	EMPTY_THINK_PREFILL,
	fallbackThoughtPrefill,
	resolveAssistantPrefill,
	resolveThoughtPrefill,
	withAssistantPrefill,
	type ApplyPromptTemplate,
} from './assistantThink.js';
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
	/** LM Studio `context_length` (`n_ctx`). Reload the instance when this changes. */
	contextLength?:number;
};

type LoadedInstance = {
	id:string;
	key:string;
	type:string;
	config:Record<string, unknown>;
};

export function loadConfigFits(got:Record<string, unknown>, want:HttpLoadConfig):boolean {
	if (want.flashAttention !== false && got['flash_attention'] === false) {
		return false;
	}
	if (want.offloadKvCacheToGpu !== false && got['offload_kv_cache_to_gpu'] === false) {
		return false;
	}
	const batch = want.evalBatchSize ?? 512;
	if (typeof got['eval_batch_size'] === 'number' && got['eval_batch_size'] < batch) {
		return false;
	}
	if (want.parallel !== undefined && typeof got['parallel'] === 'number' && got['parallel'] < want.parallel) {
		return false;
	}
	if (want.contextLength !== undefined) {
		const gotCtx = instanceContextLength(got);
		if (gotCtx !== undefined && gotCtx !== want.contextLength) {
			return false;
		}
	}
	return true;
}

function isVramError(msg:string):boolean {
	return /vram|out of memory|\boom\b|not enough memory|failed to allocate|cuda.*alloc|insufficient.*(memory|vram)|ggml.*alloc|metal.*oom|no extra buffer/i.test(msg);
}

function readLoadedInstances(models:unknown[]):LoadedInstance[] {
	const out:LoadedInstance[] = [];
	for (const row of models) {
		if (!isRecord(row)) {
			continue;
		}
		const key = typeof row.key === 'string' ? row.key
			: typeof row.id === 'string' ? row.id : '';
		const type = typeof row.type === 'string' ? row.type : 'llm';
		const instances = Array.isArray(row.loaded_instances) ? row.loaded_instances : [];
		for (const inst of instances) {
			if (!isRecord(inst) || typeof inst.id !== 'string' || !inst.id) {
				continue;
			}
			out.push({
				id: inst.id,
				key: key || inst.id,
				type,
				config: isRecord(inst.config) ? inst.config : {},
			});
		}
	}
	return out;
}



/** What one model on a server runs with. Unset fields fall back to the provider's own config. */
export type ModelSettings = {
	contextLength?:number;
	enableThinking?:boolean;
	reasoningEffort?:ReasoningEffort;
};

export type RequestInfo = {
	req:ChatRequest;
	body:Record<string, unknown>;
	path:string;
};

export type HttpProviderConfig = {
	baseURL?:string;
	apiKey?:string;
	fetch?:typeof fetch;
	timeoutMs?:number;
	/** Sent as `max_tokens` only if set. When omitted, thinking still gets a 512-token cap so CoT cannot fill the window. */
	maxTokens?:number;
	/**
	 * When false (default), disable chain-of-thought on thinking models.
	 */
	enableThinking?:boolean;
	/**
	 * Thinking intensity (`low` / `medium` / `xhigh`).
	 * Ignored unless `enableThinking` is true, and only sent when the listed
	 * model allows that option (`low` if omitted and allowed).
	 */
	reasoningEffort?:ReasoningEffort;
	/** Used when POST /api/v1/models/load exists. */
	load?:HttpLoadConfig;
	/**
	 * Apply the model's prompt template (LM Studio SDK `applyPromptTemplate`).
	 * When thinking is off, used to derive the Harmony `to=user` / empty-think prefill.
	 * When a turn asks for a canned thought, used to wrap it in the model's think tokens.
	 */
	applyPromptTemplate?:ApplyPromptTemplate;
	/** Fired with the exact JSON body after prepare, immediately before the HTTP send. */
	onRequest?:(info:RequestInfo)=>void;
};

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

function messageReasoning(message:Record<string, unknown>):string | undefined {
	const text = textFrom(message['reasoning_content']);
	return text ?? undefined;
}

function setTemplateKwargs(body:Record<string, unknown>, patch:Record<string, unknown>):void {
	const prev = isRecord(body['chat_template_kwargs']) ? body['chat_template_kwargs'] : {};
	body['chat_template_kwargs'] = { ...prev, ...patch };
}

function preferReasoning(effort:ReasoningEffort | undefined):ReasoningOption {
	if (effort === 'xhigh') {
		return 'high';
	}
	return effort ?? 'low';
}

/** The responses API takes `reasoning: { effort }` in OpenAI's words and rejects a bare option with a 400. */
const RESPONSES_EFFORT:Record<ReasoningOption, string> = { off: 'none', on: 'medium', low: 'low', medium: 'medium', high: 'high' };

function setReasoningOption(body:Record<string, unknown>, option:ReasoningOption, responses:boolean):void {
	if (responses) {
		body.reasoning = { effort: RESPONSES_EFFORT[option] };
		return;
	}
	body.reasoning = option;
	if (!responses && (option === 'low' || option === 'medium' || option === 'high')) {
		body['reasoning_effort'] = option;
	}
	if (!responses && option === 'low') {
		setTemplateKwargs(body, { reasoning_strength: 'low' });
	}
}

function defaultBaseURL():string {
	return 'http://127.0.0.1:1234/v1';
}

function joinURL(base:string, path:string):string {
	return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** `req.responseFormat` as a JSON schema the server must follow. Chat completions only: see `dispatchChat`. */
function applyResponseFormat(req:ChatRequest, body:Record<string, unknown>):void {
	const format = req.responseFormat;
	if (format) {
		body['response_format'] = { type: 'json_schema', json_schema: { name: format.name, schema: format.schema, strict: format.strict ?? false } };
	}
}

/** `req.topLogprobs` in the shape each endpoint asks for it. */
function applyLogprobs(req:ChatRequest, body:Record<string, unknown>, responses:boolean):void {
	if (!req.topLogprobs) {
		return;
	}
	body['top_logprobs'] = req.topLogprobs;
	if (responses) {
		body['include'] = ['message.output_text.logprobs'];
	}
	else {
		body['logprobs'] = true;
	}
}

/** The first answer token's top candidates from a responses or chat completions reply, or undefined without them. */
function firstLogprobs(json:Record<string, unknown>):Record<string, number> | undefined {
	const choice = Array.isArray(json.choices) && isRecord(json.choices[0]) ? json.choices[0] : undefined;
	const tokens = choice
		? (isRecord(choice.logprobs) ? choice.logprobs.content : undefined)
		: (Array.isArray(json.output) ? json.output : [])
			.flatMap((item) => (isRecord(item) && item.type === 'message' && Array.isArray(item.content) ? item.content : []))
			.flatMap((part) => (isRecord(part) && Array.isArray(part.logprobs) ? part.logprobs : []));
	const first = Array.isArray(tokens) && isRecord(tokens[0]) ? tokens[0] : undefined;
	if (!first || !Array.isArray(first['top_logprobs'])) {
		return undefined;
	}
	const out:Record<string, number> = {};
	for (const top of first['top_logprobs']) {
		if (isRecord(top) && typeof top.token === 'string' && typeof top.logprob === 'number') {
			const token = top.token.trim();
			out[token] = Math.max(out[token] ?? -Infinity, top.logprob);
		}
	}
	return out;
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

function isContextOverflow(msg:string):boolean {
	return /context size has been exceeded|exceeds the (available )?context/i.test(msg);
}

const THINK_OUT = 4096;
const OVERFLOW_OUT = 256;

function estimateTokens(value:unknown):number {
	return Math.max(1, Math.ceil(JSON.stringify(value).length / 4));
}

function configNumber(config:Record<string, unknown>, ...keys:string[]):number | undefined {
	for (const key of keys) {
		const n = config[key];
		if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
			return n;
		}
	}
	return undefined;
}

function instanceContextLength(config:Record<string, unknown>):number | undefined {
	return configNumber(config, 'context_length', 'contextLength', 'n_ctx', 'max_context_length');
}

function shrinkForOverflow(body:Record<string, unknown>):boolean {
	let changed = false;
	// The responses API takes `{ effort }` and rejects a bare option with a 400.
	if (isRecord(body.reasoning) && body.reasoning.effort !== RESPONSES_EFFORT.off) {
		body.reasoning = { effort: RESPONSES_EFFORT.off };
		changed = true;
	}
	else if (body.reasoning !== undefined && !isRecord(body.reasoning) && body.reasoning !== 'off') {
		body.reasoning = 'off';
		delete body['reasoning_effort'];
		changed = true;
	}
	if (body['enable_thinking'] === true) {
		body['enable_thinking'] = false;
		changed = true;
	}
	const kwargs = isRecord(body['chat_template_kwargs']) ? body['chat_template_kwargs'] : undefined;
	if (kwargs && (kwargs.enable_thinking === true || kwargs.reasoning_strength !== undefined)) {
		body['chat_template_kwargs'] = { ...kwargs, enable_thinking: false };
		delete (body['chat_template_kwargs'] as Record<string, unknown>).reasoning_strength;
		changed = true;
	}
	if (body['max_tokens'] !== OVERFLOW_OUT) {
		body['max_tokens'] = OVERFLOW_OUT;
		changed = true;
	}
	if ('max_output_tokens' in body && body['max_output_tokens'] !== OVERFLOW_OUT) {
		body['max_output_tokens'] = OVERFLOW_OUT;
		changed = true;
	}
	return changed;
}

function shouldRetry(status:number, body:string):boolean {
	if (isVramError(body) || isContextOverflow(body)) {
		return false;
	}
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

/** Chat-template tokens a model leaks into content: `<|x|>`, `<|x>`, `<x|>`, or a dangling `<|x` at the end. */
export function stripTemplateTokens(text:string | null):string | null {
	return text?.replace(/<\|[\w-]+\|?>|<[\w-]+\|>|<\|[\w-]*$/g, '').trim() || null;
}

function messageText(message:Record<string, unknown>):string | null {
	const content = stripTemplateTokens(textFrom(message.content));
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

function mergeArgFragments(prev:string, next:string):string {
	if (!next) {
		return prev;
	}
	if (!prev) {
		return next;
	}
	if (next.startsWith(prev) || prev.startsWith(next)) {
		return next.length >= prev.length ? next : prev;
	}
	return prev + next;
}

/** OpenAI streams `tool_calls` as per-index fragments. Replacing the array drops the name. */
function mergeToolCallDeltas(acc:unknown, delta:unknown):unknown[] {
	const out:unknown[] = Array.isArray(acc)
		? acc.map((row) => {
			if (!isRecord(row)) {
				return row;
			}
			const fn = isRecord(row.function) ? row.function : undefined;
			return fn ? { ...row, function: { ...fn } } : { ...row };
		})
		: [];
	if (!Array.isArray(delta)) {
		return out;
	}
	for (const item of delta) {
		if (!isRecord(item)) {
			continue;
		}
		const index = typeof item.index === 'number' ? item.index : out.length;
		while (out.length <= index) {
			out.push({});
		}
		const prev = isRecord(out[index]) ? out[index] : {};
		const prevFn = isRecord(prev.function) ? prev.function : {};
		const nextFn = isRecord(item.function) ? item.function : {};
		const prevArgs = typeof prevFn.arguments === 'string' ? prevFn.arguments : '';
		const nextArgs = typeof nextFn.arguments === 'string' ? nextFn.arguments : '';
		const name = typeof nextFn.name === 'string' && nextFn.name
			? nextFn.name
			: typeof prevFn.name === 'string' ? prevFn.name : '';
		const id = typeof item.id === 'string' && item.id
			? item.id
			: typeof prev.id === 'string' ? prev.id : undefined;
		out[index] = {
			...prev,
			...item,
			index,
			...(id ? { id } : {}),
			type: typeof item.type === 'string' ? item.type : (typeof prev.type === 'string' ? prev.type : 'function'),
			function: {
				...prevFn,
				...nextFn,
				name,
				arguments: mergeArgFragments(prevArgs, nextArgs),
			},
		};
	}
	return out;
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
	let responseID:string | undefined;
	let usage:Record<string, unknown> | undefined;
	let timings:Record<string, unknown> | undefined;
	let stats:Record<string, unknown> | undefined;
	let streamErr:string | undefined;
	let assembledContent = '';
	let assembledReasoning = '';
	let assembledTools:unknown = undefined;
	let finishReason:unknown = undefined;
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
				responseID = term.id;
			}
		}
		if (isRecord(ev.response) && typeof ev.response.id === 'string') {
			responseID = responseID ?? ev.response.id;
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
		finishReason = choice['finish_reason'] ?? finishReason;
		const delta = isRecord(choice.delta) ? choice.delta : {};
		if (typeof delta.content === 'string') {
			assembledContent += delta.content;
		}
		if (typeof delta['reasoning_content'] === 'string') {
			assembledReasoning += delta['reasoning_content'];
		}
		if (delta['tool_calls'] !== undefined) {
			assembledTools = mergeToolCallDeltas(assembledTools, delta['tool_calls']);
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
			id: responseID,
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
					choices: [{ message, finish_reason: finishReason }],
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
	reasoning:string | undefined;
	toolCalls:ToolCall[];
	id:string | undefined;
	truncated:boolean;
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
	const thoughts:string[] = [];
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
				thoughts.push(text);
				try {
					extractJson(text);
					texts.push(text);
				}
				catch {
					// chain-of-thought, not an arc
				}
			}
		}
	}
	return {
		content: stripTemplateTokens(texts.length > 0 ? texts.join('\n') : null),
		reasoning: thoughts.length > 0 ? thoughts.join('\n') : undefined,
		toolCalls,
		id,
		truncated: json.status === 'incomplete',
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
	public readonly baseURL:string;
	public readonly rootURL:string;
	private readonly _apiKey:string | undefined;
	private readonly _fetchImpl:typeof fetch;
	private readonly _timeoutMs:number;
	private readonly _maxTokens:number | undefined;
	private readonly _loadOpts:HttpLoadConfig;
	private readonly _applyPromptTemplateFn:ApplyPromptTemplate | undefined;
	private readonly _onRequest?:(info:RequestInfo)=>void;
	private readonly _reasoningByModel = new Map<string, ReasoningOption[]>();
	/** Each catalog model's most context. A load asking for more gets less, and must still count as fitting. */
	private readonly _maxContextByModel = new Map<string, number>();
	/** Models the host configured on this server: each loads with its own settings, and none unloads another. */
	private readonly _models = new Map<string, ModelSettings>();
	private readonly _threads = new Map<string, ThreadSnapshot[]>();
	private _enableThinking:boolean;
	private _reasoningEffort:ReasoningEffort | undefined;
	private _responses:boolean | undefined;
	private _loadEndpoint = false;
	private _probed = false;
	private _instances:LoadedInstance[] = [];
	private _readyChain:Promise<void> = Promise.resolve();
	private _jitFirst:Promise<ChatResponse> | null = null;
	private _jitModel = '';

	constructor(config:HttpProviderConfig = {}) {
		this.baseURL = (config.baseURL ?? defaultBaseURL()).replace(/\/+$/, '');
		this.rootURL = serverRoot(this.baseURL);
		this._apiKey = config.apiKey ?? envGet('ARC_DIRECTOR_API_KEY') ?? envGet('OPENAI_API_KEY');
		this._fetchImpl = asFetch(config.fetch ?? fetch);
		this._timeoutMs = config.timeoutMs ?? 180_000;
		this._maxTokens = config.maxTokens;
		this._enableThinking = config.enableThinking ?? false;
		this._reasoningEffort = config.reasoningEffort;
		this._loadOpts = {
			flashAttention: config.load?.flashAttention ?? true,
			offloadKvCacheToGpu: config.load?.offloadKvCacheToGpu ?? true,
			evalBatchSize: config.load?.evalBatchSize ?? 512,
			parallel: config.load?.parallel,
			contextLength: config.load?.contextLength,
		};
		this._applyPromptTemplateFn = config.applyPromptTemplate;
		this._onRequest = config.onRequest;
	}

	/**
	 * Run `model` with `settings` from now on, and keep it loaded beside the other configured models. The next
	 * `ensureLoaded` reloads it if a loaded copy no longer fits.
	 */
	public configureModel(model:string, settings:ModelSettings):void {
		this._models.set(model, { ...settings });
	}

	/** `model` is no longer configured: it runs with the provider's config, and loading another may unload it. */
	public forgetModel(model:string):void {
		this._models.delete(model);
	}

	/** Load one copy of `model` that fits its settings (and eject extras). */
	public async ensureLoaded(model:string):Promise<void> {
		if (this._jitModel !== model) {
			this._jitFirst = null;
			this._jitModel = model;
		}
		await this.ensureReady(model);
	}

	public async chat(req:ChatRequest):Promise<ChatResponse> {
		await this.ensureReady(req.model);
		if (!this._loadEndpoint) {
			return this.chatJit(req);
		}
		return this.dispatchChat(req);
	}

	public async embed(texts:string[], model?:string):Promise<number[][]> {
		const name = model;
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

	private settingsOf(model:string):ModelSettings {
		for (const [id, settings] of this._models) {
			if (modelIDsMatch(id, model)) {
				return settings;
			}
		}
		return {};
	}

	/**
	 * The load config for `model`: the provider's, with that model's context length, capped at the most it takes.
	 * Uncapped, a 4k model never fits a 16k ask, so every request would unload and reload it.
	 */
	private loadOf(model:string):HttpLoadConfig {
		const want = this.settingsOf(model).contextLength ?? this._loadOpts.contextLength;
		const max = [...this._maxContextByModel].find(([id]) => modelIDsMatch(id, model))?.[1];
		return { ...this._loadOpts, contextLength: want !== undefined && max !== undefined ? Math.min(want, max) : want };
	}

	private thinkingOn(req:ChatRequest):boolean {
		return req.enableThinking ?? this.settingsOf(req.model).enableThinking ?? this._enableThinking;
	}

	private async thinkOffPrefill(model:string, thinkingOn:boolean):Promise<string | null> {
		if (thinkingOn) {
			return null;
		}
		if (!isThinkingModel(model) && !thinkOffMode(model)) {
			return null;
		}
		if (this._applyPromptTemplateFn) {
			const derived = await resolveAssistantPrefill(this._applyPromptTemplateFn, model);
			if (derived) {
				return derived;
			}
		}
		return EMPTY_THINK_PREFILL;
	}

	private async thoughtDonePrefill(model:string):Promise<string> {
		if (this._applyPromptTemplateFn) {
			return resolveThoughtPrefill(this._applyPromptTemplateFn, model);
		}
		return fallbackThoughtPrefill();
	}

	private async prepareMessages(req:ChatRequest):Promise<ChatMessage[]> {
		const thinkingOn = this.thinkingOn(req);
		const thinkingModel = isThinkingModel(req.model);
		let messages = req.messages;
		if (req.fakeThought && thinkingOn && (thinkingModel || thinkOffMode(req.model))) {
			return withAssistantPrefill(messages, await this.thoughtDonePrefill(req.model));
		}
		if (thinkingOn && thinkingModel) {
			return messages;
		}
		const off = thinkOffMode(req.model);
		if (off === 'no_think') {
			messages = withNoThink(messages);
		}
		const prefill = await this.thinkOffPrefill(req.model, thinkingOn);
		if (prefill) {
			messages = withAssistantPrefill(messages, prefill);
		}
		return messages;
	}

	private emitRequest(req:ChatRequest, body:Record<string, unknown>, path:string):void {
		this._onRequest?.({ req, body, path });
	}

	private async chatCompletions(req:ChatRequest, messages:ChatMessage[]):Promise<ChatResponse> {
		const body = this.completionBody(req, messages);
		const got = await this.postChat(joinURL(this.baseURL, 'chat/completions'), body, true, req);
		const json = got.json;
		const choices = Array.isArray(json.choices) ? json.choices : [];
		const first = isRecord(choices[0]) ? choices[0] : {};
		const message = isRecord(first.message) ? first.message : isRecord(first.delta) ? first.delta : {};
		const timings = parseChatTimings(json);
		const split = mergeClientTimings(timings, got.firstMs, got.wallMs);
		return {
			content: messageText(message),
			reasoning: messageReasoning(message),
			toolCalls: parseToolCalls(message['tool_calls'] ?? message['toolCalls']),
			truncated: first['finish_reason'] === 'length',
			cachedTokens: timings.cachedTokens,
			promptMs: split.promptMs,
			generateMs: split.generateMs,
			logprobs: firstLogprobs(json),
		};
	}

	private async chatResponses(req:ChatRequest, messages:ChatMessage[]):Promise<ChatResponse> {
		const key = req.thread?.trim() || '';
		const stored = key ? (this._threads.get(key) ?? []) : [];
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
		const tools = responseTools(req.tools);
		if (tools) {
			body.tools = tools;
			if (req.toolChoice) {
				body['tool_choice'] = req.toolChoice;
			}
		}
		this.applyOutputCap(req, body, true);
		applyLogprobs(req, body, true);
		let got:{ json:Record<string, unknown>; firstMs?:number; wallMs:number };
		try {
			got = await this.postChat(joinURL(this.baseURL, 'responses'), body, false, req);
		}
		catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (/ 404:| 405:/.test(msg)) {
				this._responses = false;
				throw err;
			}
			throw err;
		}
		this._responses = true;
		const parsed = parseResponsesOutput(got.json);
		const split = mergeClientTimings(
			{ promptMs: parsed.promptMs, generateMs: parsed.generateMs },
			got.firstMs,
			got.wallMs,
		);
		const res:ChatResponse = {
			content: parsed.content,
			reasoning: parsed.reasoning,
			toolCalls: parsed.toolCalls,
			truncated: parsed.truncated,
			cachedTokens: parsed.cachedTokens,
			promptMs: split.promptMs,
			generateMs: split.generateMs,
			logprobs: firstLogprobs(got.json),
		};
		if (key && parsed.id) {
			this._threads.set(key, rememberThread(stored, {
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
		applyResponseFormat(req, body);
		applyLogprobs(req, body, false);
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
		this.applyOutputCap(req, body, false);
		return body;
	}

	private applyThinkFields(req:ChatRequest, body:Record<string, unknown>, responses:boolean):void {
		const thinkingOn = this.thinkingOn(req);
		const thinkingModel = isThinkingModel(req.model);
		const off = thinkOffMode(req.model);
		const option = pickReasoningOption(
			this.allowedReasoning(req.model),
			thinkingOn,
			thinkingOn ? preferReasoning(this.settingsOf(req.model).reasoningEffort ?? this._reasoningEffort) : undefined,
		);
		if (option) {
			setReasoningOption(body, option, responses);
		}
		if (thinkingOn) {
			if (thinkingModel && off === 'no_think' && !responses) {
				body['enable_thinking'] = true;
				setTemplateKwargs(body, { enable_thinking: true });
			}
			return;
		}
		if (off === 'no_think' && !responses) {
			body['enable_thinking'] = false;
			body['chat_template_kwargs'] = { enable_thinking: false };
		}
	}

	private slotContext(model:string):number | undefined {
		const inst = this._instances.find((row) => this.instanceMatches(row, model));
		return inst ? instanceContextLength(inst.config) : undefined;
	}

	private applyOutputCap(req:ChatRequest, body:Record<string, unknown>, responses:boolean):void {
		const thinkingOn = this.thinkingOn(req);
		const want = req.maxTokens ?? this._maxTokens ?? (thinkingOn ? THINK_OUT : undefined);
		const slot = this.slotContext(req.model);
		if (want === undefined && slot === undefined) {
			return;
		}
		const prompt = estimateTokens(body);
		let cap = want ?? THINK_OUT;
		if (slot !== undefined) {
			cap = Math.min(cap, Math.max(1, slot - prompt - 32));
		}
		if (responses) {
			body['max_output_tokens'] = cap;
		}
		else {
			body['max_tokens'] = cap;
		}
	}

	private allowedReasoning(model:string):ReasoningOption[] | undefined {
		for (const [id, allowed] of this._reasoningByModel) {
			if (modelIDsMatch(id, model)) {
				return allowed;
			}
		}
		return undefined;
	}

	private rememberReasoning(models:unknown[]):void {
		this._reasoningByModel.clear();
		this._maxContextByModel.clear();
		for (const row of asModelList({ models })) {
			if (row.reasoning && row.reasoning.allowed.length > 0) {
				this._reasoningByModel.set(row.id, row.reasoning.allowed);
			}
			if (row.maxContextLength !== undefined) {
				this._maxContextByModel.set(row.id, row.maxContextLength);
			}
		}
	}

	private async dispatchChat(req:ChatRequest):Promise<ChatResponse> {
		const messages = await this.prepareMessages(req);
		// LM Studio's responses API ignores `text.format`, so a schema the answer must follow goes to chat completions.
		if (!req.responseFormat && (this._responses === true || (this._responses !== false && this._loadEndpoint))) {
			try {
				return await this.chatResponses(req, messages);
			}
			catch (err) {
				if (this._responses === true) {
					const msg = err instanceof Error ? err.message : String(err);
					if (/stream ended without a response/.test(msg)) {
						return this.chatCompletions(req, messages);
					}
					throw err;
				}
				this._responses = false;
			}
		}
		return this.chatCompletions(req, messages);
	}

	/**
	 * LM Studio JIT-loads one instance per in-flight request when nothing is in VRAM.
	 * Hold the second wave until the first completion has started an instance.
	 */
	private async chatJit(req:ChatRequest):Promise<ChatResponse> {
		if (this._jitModel !== req.model) {
			this._jitFirst = null;
			this._jitModel = req.model;
		}
		if (this.hasReusable(req.model)) {
			return this.dispatchChat(req);
		}
		if (!this._jitFirst) {
			this._jitFirst = this.dispatchChat(req).then((res) => {
				if (!this._instances.some((inst) => this.instanceMatches(inst, req.model))) {
					this._instances.push({
						id: req.model,
						key: req.model,
						type: 'llm',
						config: {},
					});
				}
				return res;
			}, (err:unknown) => {
				this._jitFirst = null;
				throw err;
			});
			return this._jitFirst;
		}
		await this._jitFirst;
		return this.dispatchChat(req);
	}

	private async ensureReady(model:string):Promise<void> {
		const run = this._readyChain.then(() => this.ensureReadyLocked(model));
		this._readyChain = run.then(() => undefined, () => undefined);
		await run;
	}

	private async ensureReadyLocked(model:string):Promise<void> {
		if (!this._probed) {
			await this.probe();
		}
		if (!this._loadEndpoint) {
			return;
		}
		if (this.hasReusable(model)) {
			await this.keepOneInstance(model);
			return;
		}
		await this.loadModel(model);
	}

	private hasReusable(model:string):boolean {
		return this._instances.some((inst) => this.instanceMatches(inst, model) && loadConfigFits(inst.config, this.loadOf(model)));
	}

	private instanceMatches(inst:LoadedInstance, model:string):boolean {
		return modelIDsMatch(inst.id, model) || modelIDsMatch(inst.key, model);
	}

	private async probe():Promise<void> {
		this._probed = true;
		try {
			await this.refreshInstances();
			this._loadEndpoint = true;
		}
		catch {
			this._loadEndpoint = false;
		}
	}

	private async refreshInstances():Promise<void> {
		const res = await this._fetchImpl(joinURL(this.rootURL, 'api/v1/models'), {
			method: 'GET',
			headers: this.headers(),
			signal: AbortSignal.timeout(Math.min(4000, this._timeoutMs)),
		});
		if (!res.ok) {
			throw new Error(`inference models ${res.status}`);
		}
		const json:unknown = await res.json();
		if (!isRecord(json) || !Array.isArray(json.models)) {
			throw new Error('inference models: no catalog');
		}
		this._instances = readLoadedInstances(json.models);
		this.rememberReasoning(json.models);
	}

	private async loadModel(model:string):Promise<void> {
		try {
			await this.refreshInstances();
		}
		catch {
			// keep whatever probe already saw
		}
		if (this.hasReusable(model)) {
			await this.keepOneInstance(model);
			return;
		}
		const stale = this._instances.filter((inst) => this.instanceMatches(inst, model) && !loadConfigFits(inst.config, this.loadOf(model)));
		for (const inst of stale) {
			await this.unloadInstance(inst.id);
		}
		await this.freeVram(model);
		const body = this.loadBody(model);
		let lastErr:unknown;
		for (let round = 0; round < 4; round++) {
			try {
				await this.postLoad(model, body);
				await this.keepOneInstance(model);
				return;
			}
			catch (err) {
				lastErr = err;
				const msg = err instanceof Error ? err.message : String(err);
				if (round === 0 && this._loadOpts.parallel !== undefined && / 400:/.test(msg)) {
					delete body.parallel;
					continue;
				}
				if (/ 404:| 405:/.test(msg)) {
					this._loadEndpoint = false;
					return;
				}
				try {
					await this.refreshInstances();
				}
				catch {
					// still use the in-memory list
				}
				if (await this.freeVram(model)) {
					continue;
				}
				throw err;
			}
		}
		throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
	}

	private loadBody(model:string):Record<string, unknown> {
		const body:Record<string, unknown> = {
			model,
			flash_attention: this._loadOpts.flashAttention !== false,
			offload_kv_cache_to_gpu: this._loadOpts.offloadKvCacheToGpu !== false,
			eval_batch_size: this._loadOpts.evalBatchSize ?? 512,
			echo_load_config: true,
		};
		if (this._loadOpts.parallel !== undefined) {
			body.parallel = this._loadOpts.parallel;
		}
		const contextLength = this.loadOf(model).contextLength;
		if (contextLength !== undefined) {
			body.context_length = contextLength;
		}
		return body;
	}

	private async postLoad(model:string, body:Record<string, unknown>):Promise<void> {
		const json = await this.post(joinURL(this.rootURL, 'api/v1/models/load'), body);
		const id = typeof json['instance_id'] === 'string' ? json['instance_id'] : model;
		const config = isRecord(json['load_config']) ? json['load_config'] : {};
		this.forgetInstance(id);
		this._instances.push({
			id,
			key: model,
			type: typeof json.type === 'string' ? json.type : 'llm',
			config,
		});
	}

	/** Unload what is in the way of `keep`: anything loaded that is neither it nor another configured model. */
	private async freeVram(keep:string):Promise<boolean> {
		const configured = [...this._models.keys()];
		const victims = this._instances.filter((inst) => !this.instanceMatches(inst, keep)
			&& !configured.some((model) => this.instanceMatches(inst, model)));
		if (victims.length === 0) {
			return false;
		}
		for (const inst of victims) {
			await this.unloadInstance(inst.id);
		}
		return true;
	}

	private async keepOneInstance(model:string):Promise<void> {
		const remembered = this._instances.filter((inst) => this.instanceMatches(inst, model));
		try {
			await this.refreshInstances();
		}
		catch {
			// keep remembered
		}
		const seen = new Set(this._instances.map((inst) => inst.id));
		for (const inst of remembered) {
			if (!seen.has(inst.id)) {
				this._instances.push(inst);
				seen.add(inst.id);
			}
		}
		const same = this._instances.filter((inst) => this.instanceMatches(inst, model));
		const keep = same.find((inst) => loadConfigFits(inst.config, this.loadOf(model))) ?? same[0];
		if (!keep) {
			return;
		}
		for (const extra of same) {
			if (extra.id !== keep.id) {
				await this.unloadInstance(extra.id);
			}
		}
	}

	private async unloadInstance(instanceID:string):Promise<void> {
		try {
			await this.post(joinURL(this.rootURL, 'api/v1/models/unload'), { instance_id: instanceID });
		}
		catch {
			// already gone
		}
		this.forgetInstance(instanceID);
	}

	private forgetInstance(instanceID:string):void {
		this._instances = this._instances.filter((inst) => inst.id !== instanceID);
	}

	private headers():Record<string, string> {
		const headers:Record<string, string> = {
			'content-type': 'application/json',
		};
		if (this._apiKey) {
			headers.authorization = `Bearer ${this._apiKey}`;
		}
		return headers;
	}

	private async postChat(
		url:string,
		body:Record<string, unknown>,
		completions:boolean,
		req:ChatRequest,
	):Promise<{ json:Record<string, unknown>; firstMs?:number; wallMs:number }> {
		let lastErr:Error | null = null;
		// Streamed logprobs come in pieces; a scored answer is one token anyway.
		let stream = !req.topLogprobs;
		for (let attempt = 0; attempt < 4; attempt++) {
			if (req.signal?.aborted) {
				throw req.signal.reason instanceof Error ? req.signal.reason : new Error('aborted');
			}
			if (attempt > 0) {
				await sleep(350 * attempt);
			}
			const payload:Record<string, unknown> = { ...body, stream };
			if (stream && completions) {
				payload['stream_options'] = { include_usage: true };
			}
			this.emitRequest(req, payload, url);
			const t0 = nowMs();
			const res = await this._fetchImpl(url, {
				method: 'POST',
				headers: this.headers(),
				body: JSON.stringify(payload),
				signal: req.signal ?? AbortSignal.timeout(this._timeoutMs),
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
				if (isContextOverflow(`${msg} ${text}`) && shrinkForOverflow(body) && attempt < 3) {
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
				if (req.signal?.aborted) {
					throw lastErr;
				}
				if (isContextOverflow(lastErr.message) && shrinkForOverflow(body) && attempt < 3) {
					continue;
				}
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
			const res = await this._fetchImpl(url, {
				method: 'POST',
				headers: this.headers(),
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(this._timeoutMs),
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
				if (!url.includes('/models/load') && shouldRetry(res.status, text) && attempt < 3) {
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
