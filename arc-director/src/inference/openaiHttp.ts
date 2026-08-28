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
} from './provider.js';

export const REASONING_EFFORTS = ['low', 'medium', 'xhigh'] as const;
export type ReasoningEffort = typeof REASONING_EFFORTS[number];

export type OpenAICompatConfig = {
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
	for (let i = out.length - 1; i >= 0; i--) {
		const m = out[i];
		if (m.role !== 'user' || m.content === null) {
			continue;
		}
		out[i] = { ...m, content: appendNoThink(m.content) };
		break;
	}
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

function toOpenAIMessages(messages:ChatMessage[]):unknown[] {
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
		const id = typeof item.id === 'string' ? item.id : `call_${out.length}`;
		const name = typeof fn.name === 'string' ? fn.name : '';
		const args = typeof fn.arguments === 'string'
			? fn.arguments
			: JSON.stringify(fn.arguments ?? {});
		if (name) {
			out.push({ id, name, arguments: args });
		}
	}
	return out;
}

export class OpenAICompatProvider implements InferenceProvider {
	readonly baseURL:string;
	private readonly apiKey:string | undefined;
	private readonly fetchImpl:typeof fetch;
	private readonly timeoutMs:number;
	private readonly maxTokens:number | undefined;
	private readonly enableThinking:boolean;
	private readonly reasoningEffort:ReasoningEffort | undefined;
	private readonly thinkingBudget:number | undefined;

	constructor(config:OpenAICompatConfig = {}) {
		this.baseURL = (config.baseURL ?? defaultBaseURL()).replace(/\/+$/, '');
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
	}

	async chat(req:ChatRequest):Promise<ChatResponse> {
		const thinkingModel = isThinkingModel(req.model);
		const think = this.enableThinking && thinkingModel;
		const off = thinkOffMode(req.model);
		const messages = !think && off === 'no_think'
			? withNoThink(req.messages)
			: req.messages;
		const body:Record<string, unknown> = {
			model: req.model,
			messages: toOpenAIMessages(messages),
			temperature: req.temperature ?? 0,
		};
		if (think) {
			if (this.thinkingBudget !== undefined) {
				body['thinking_budget'] = this.thinkingBudget;
			}
			else if (this.reasoningEffort !== undefined) {
				body['reasoning_effort'] = this.reasoningEffort;
			}
		}
		else if (off === 'effort_low') {
			body['reasoning_effort'] = 'low';
		}
		else if (off === 'no_think') {
			body['enable_thinking'] = false;
			body['reasoning_effort'] = 'none';
			body['chat_template_kwargs'] = { enable_thinking: false };
		}
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
		}
		const json = await this.post('chat/completions', body);
		const choices = Array.isArray(json.choices) ? json.choices : [];
		const first = isRecord(choices[0]) ? choices[0] : {};
		const message = isRecord(first.message) ? first.message : {};
		const content = messageText(message);
		return {
			content,
			toolCalls: parseToolCalls(message['tool_calls']),
		};
	}

	async embed(texts:string[], model?:string):Promise<number[][]> {
		const name = model ?? envGet('ARC_DIRECTOR_EMBED_MODEL');
		if (!name) {
			throw new Error('embed: no model id (refusing to load a second embedding model)');
		}
		const json = await this.post('embeddings', {
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

	private async post(path:string, body:Record<string, unknown>):Promise<Record<string, unknown>> {
		const headers:Record<string, string> = {
			'content-type': 'application/json',
		};
		if (this.apiKey) {
			headers.authorization = `Bearer ${this.apiKey}`;
		}
		let lastErr:Error | null = null;
		for (let attempt = 0; attempt < 4; attempt++) {
			if (attempt > 0) {
				await sleep(350 * attempt);
			}
			const res = await this.fetchImpl(joinURL(this.baseURL, path), {
				method: 'POST',
				headers,
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(this.timeoutMs),
			});
			const text = await res.text();
			let parsed:unknown;
			try {
				parsed = text ? JSON.parse(text) : {};
			}
			catch {
				throw new Error(`inference ${path} returned non-JSON (${res.status}): ${text.slice(0, 240)}`);
			}
			if (!res.ok) {
				const err = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : parsed;
				const msg = isRecord(err) && typeof err.message === 'string'
					? err.message
					: text.slice(0, 240);
				lastErr = new Error(`inference ${path} ${res.status}: ${msg}`);
				if (shouldRetry(res.status, text) && attempt < 3) {
					continue;
				}
				throw lastErr;
			}
			if (!isRecord(parsed)) {
				throw new Error(`inference ${path} returned a non-object`);
			}
			return parsed;
		}
		throw lastErr ?? new Error(`inference ${path} failed`);
	}
}
