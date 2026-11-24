import { envGet } from '../env.js';
import { isRecord } from '../json.js';
import {
	alwaysThinks,
	asModelList,
	isThinkingModel,
	modelIDsMatch,
	pickReasoningOption,
	thinkOffMode,
	thoughtTagsOf,
	type ReasoningOption,
} from './models.js';
import {
	samplingOf,
	type ChatContent,
	type ChatContentPart,
	type ChatMessage,
	type ChatRequest,
	type ChatResponse,
	type InferenceProvider,
	type Sampling,
} from './provider.js';
import {
	resolveAssistantPrefill,
	withAssistantPrefill,
	type ApplyPromptTemplate,
} from './assistant-think.js';
import {
	pickBestThread,
	rememberThread,
	type ThreadSnapshot,
} from './thread-cache.js';
import { sleep } from '../turn.js';
import { LMStudioLoader, type HttpLoadConfig } from './LMStudioLoader.js';
import { chatWire, cleanThought, loops, REASONING_EFFORT, responsesWire, thoughtStream, type Wire, type WireAsk } from './wire-formats.js';

export { loadConfigFits, type HttpLoadConfig } from './LMStudioLoader.js';

export const REASONING_EFFORTS = ['low', 'medium', 'xhigh'] as const;
export type ReasoningEffort = typeof REASONING_EFFORTS[number];

function isVramError(msg:string):boolean {
	return /vram|out of memory|\boom\b|not enough memory|failed to allocate|cuda.*alloc|insufficient.*(memory|vram)|ggml.*alloc|metal.*oom|no extra buffer/i.test(msg);
}

/** What one model on a server runs with. Unset fields fall back to the provider's own config. */
export type ModelSettings = {
	contextLength?:number;
	enableThinking?:boolean;
	reasoningEffort?:ReasoningEffort;
	/**
	 * Most tokens a think may think, its requests together (`ChatRequest.thinkingSpent`). The first may think all of it;
	 * after that (after a tool call, say) each is capped at what is left, but the cap drops by at most half each time and
	 * never below `thinkingFloor`. At 256 with the floor at 64: 256, then at least 128, then at least 64.
	 * The reply then comes back `truncated`, with no content and the thought so far as its `reasoning`, for the caller
	 * to answer from, as it does when the server stops it at the reply's cap (its allowance, plus room to answer).
	 * Default: no limit. A turn that does not think is cut the same way past a few tokens.
	 */
	thinkingBudget?:number;
	/**
	 * The lowest the thinking cap may go after a tool call: each later request may think at least this much. Clamped to
	 * `thinkingBudget` (under a budget of 32 the floor is 32). Default 64; 0 lets a think run out of thought.
	 */
	thinkingFloor?:number;
	/** How it picks each token. Default {@link DEFAULT_SAMPLING}. */
	sampling?:Sampling;
	/** Thinks it answers at once. A server that loads models itself runs that many side by side. */
	maxParallel?:number;
};

/** A reply as it came over the wire, or the thought so far when the thinking budget cut it off. */
type Got = { json:Record<string, unknown>; firstMs?:number; wallMs:number; cutThought?:string };

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
	/**
	 * The body field a server that ends a thought at its budget itself takes it in (llama.cpp's `thinking_budget_tokens`):
	 * each request is sent what its think has left, and its stream is not cut.
	 */
	budgetField?:string;
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

function preferReasoning(effort:ReasoningEffort | undefined):ReasoningOption | undefined {
	return effort === 'xhigh' ? 'high' : effort;
}

function defaultBaseURL():string {
	return 'http://127.0.0.1:1234/v1';
}

/** What a server's error body says: its `error.message`, else its first 240 letters. */
function errorText(text:string):string {
	let parsed:unknown;
	try {
		parsed = text ? JSON.parse(text) : {};
	}
	catch {
		parsed = {};
	}
	const err = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : parsed;
	return isRecord(err) && typeof err.message === 'string' ? err.message : text.slice(0, 240);
}

function joinURL(base:string, path:string):string {
	return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** Native `fetch` throws if invoked as a method (`this.fetchImpl()`). */
function asFetch(impl:typeof fetch):typeof fetch {
	return (input, init) => impl(input, init);
}

function isContextOverflow(msg:string):boolean {
	return /context size has been exceeded|exceeds the (available )?context/i.test(msg);
}

const THINK_OUT = 4096;
const OVERFLOW_OUT = 512;
/** Tokens a reply that thinks on a budget may answer in past it: a long Arc runs a few hundred. */
const ANSWER_ROOM = 512;
/** Most tokens a reply asked not to think may think anyway, before it is cut and handed back as a budget cut is. */
const THINK_OFF_BUDGET = 32;
/** `ModelSettings.thinkingFloor`'s default: room for a short thought on what a tool answered. */
const DEFAULT_THINKING_FLOOR = 64;
/** What a reply stuck saying one thing over (`loops`) fails with. One stuck in its thought is asked again without one. */
const LOOPING = / repeats itself in its (thought|answer)/;

/** A request whose prompt leaves its reply too little of its slot's context: it would come back empty, so it is not sent. */
class PromptTooLongError extends Error {}

/** A request body's prompt tokens, roughly. `response_format` is grammar the server compiles, not prompt. */
function promptTokens(body:Record<string, unknown>):number {
	const prompt = { ...body };
	delete prompt['response_format'];
	return Math.max(1, Math.ceil(JSON.stringify(prompt).length / 4));
}

function shrinkForOverflow(body:Record<string, unknown>):boolean {
	let changed = false;
	// The responses API takes `{ effort }` and rejects a bare option with a 400.
	if (isRecord(body.reasoning) && body.reasoning.effort !== REASONING_EFFORT.off) {
		body.reasoning = { effort: REASONING_EFFORT.off };
		changed = true;
	}
	else if (body['reasoning_effort'] !== undefined && body['reasoning_effort'] !== REASONING_EFFORT.off) {
		body['reasoning_effort'] = REASONING_EFFORT.off;
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

/** A reply the thinking budget cut off: no answer yet, only the thought so far. */
function cutThoughtReply(got:Got):ChatResponse {
	return { content: null, reasoning: cleanThought(got.cutThought), toolCalls: [], truncated: true, generateMs: got.wallMs };
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
	outputTokens:number | undefined;
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
	const count = [timings.predicted_n, usage.completion_tokens, usage.output_tokens].find((n) => typeof n === 'number' && n > 0);
	return {
		cachedTokens: cachedFromUsage(usage),
		promptMs,
		generateMs,
		outputTokens: count as number | undefined,
	};
}

function nowMs():number {
	return performance.now();
}

function mergeClientTimings(
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

/** One SSE block's JSON event, typed by its `event:` line when the JSON has no `type`; undefined for `[DONE]` and junk. */
function parseSseData(block:string):Record<string, unknown> | undefined {
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
	try {
		const json:unknown = JSON.parse(lines.join('\n'));
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

/** The whole events in `buf`, and the unfinished rest. */
function takeSseBlocks(buf:string):{ events:Record<string, unknown>[]; rest:string } {
	const parts = buf.split(/\r?\n\r?\n/);
	const rest = parts.pop() ?? '';
	return { events: parts.map(parseSseData).filter((ev) => ev !== undefined), rest };
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

/** Fields a server may send beside the reply, in any event: what it counted and timed. */
const SIDECARS = ['usage', 'timings', 'stats'] as const;

/**
 * Reads a reply whole, or as it streams in: each SSE event goes to `wire`'s fold, which says what it held. Stops a
 * thought past `thinkingBudget` before any answer, and hands the thought back instead. Fails a reply stuck repeating
 * itself, in its thought or its answer.
 */
async function readInferenceResponse(
	res:Response,
	url:string,
	wire:Wire,
	t0:number,
	thinkingBudget?:number,
	onDelta?:ChatRequest['onDelta'],
):Promise<Got> {
	const reader = res.body?.getReader();
	if (!reader) {
		return { json: parseJsonRecord(await res.text(), url, res.status), wallMs: nowMs() - t0 };
	}
	const decoder = new TextDecoder();
	let answer = '';
	/** The thought or the answer ends in one short run said over and over, checked as each piece comes. */
	let looped = false;
	const fold = wire.fold((content) => {
		answer += content;
		looped ||= loops(answer);
		onDelta?.({ content });
	});
	const showThought = thoughtStream((reasoning) => onDelta?.({ reasoning }));
	const sidecars:Record<string, unknown> = {};
	let buf = '';
	let mode:'unknown' | 'json' | 'sse' = 'unknown';
	let firstMs:number | undefined;
	let last:Record<string, unknown> | undefined;
	let streamErr:string | undefined;
	/** Streamed thought pieces so far: a server sends one per token. */
	let thoughtTokens = 0;
	const take = (ev:Record<string, unknown>):void => {
		last = ev;
		streamErr = streamErrorMessage(ev) ?? streamErr;
		for (const key of SIDECARS) {
			sidecars[key] = isRecord(ev[key]) ? ev[key] : sidecars[key];
		}
		const piece = fold.take(ev);
		firstMs ??= piece ? nowMs() - t0 : undefined;
		if (piece === 'thought') {
			thoughtTokens += 1;
			looped ||= loops(fold.thought);
			showThought(fold.thought);
		}
	};
	for (;;) {
		const { done, value } = await reader.read();
		buf += value ? decoder.decode(value, { stream: !done }) : done ? decoder.decode() : '';
		if (mode === 'unknown') {
			const start = buf.trimStart();
			// A server that thinks long may open with comments (`: keepalive`) before its first event (xAI).
			if (start.startsWith('data:') || start.startsWith('event:') || start.startsWith(':')) {
				mode = 'sse';
			}
			else if (start.startsWith('{') || start.startsWith('[')) {
				mode = 'json';
			}
		}
		if (mode === 'sse') {
			const split = takeSseBlocks(done ? `${buf}\n\n` : buf);
			buf = split.rest;
			split.events.forEach(take);
			if (looped) {
				await reader.cancel().catch(() => undefined);
				throw new Error(`inference ${url} repeats itself in its ${fold.answering ? 'answer' : 'thought'}`);
			}
			// Still thinking past the budget: stop generating, and hand back the thought for an answer without one.
			if (thinkingBudget !== undefined && thoughtTokens > thinkingBudget && !fold.answering) {
				await reader.cancel().catch(() => undefined);
				return { json: {}, firstMs, wallMs: nowMs() - t0, cutThought: fold.thought };
			}
		}
		if (done) {
			break;
		}
	}
	const wallMs = nowMs() - t0;
	if (mode !== 'sse') {
		return { json: parseJsonRecord(buf, url, res.status), firstMs, wallMs };
	}
	if (streamErr) {
		throw new Error(`inference ${url} ${streamErr}`);
	}
	const json = fold.reply(last);
	if (!json) {
		const hint = typeof last?.type === 'string' ? ` (last event: ${last.type})` : '';
		throw new Error(`inference ${url} stream ended without a response${hint}`);
	}
	for (const key of SIDECARS) {
		json[key] ??= sidecars[key];
	}
	return { json, firstMs, wallMs };
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
	private readonly _budgetField:string | undefined;
	private readonly _reasoningByModel = new Map<string, ReasoningOption[]>();
	/** Each catalog model's most context. A load asking for more gets less, and must still count as fitting. */
	private readonly _maxContextByModel = new Map<string, number>();
	/** Models the host configured on this server: each loads with its own settings, and none unloads another. */
	private readonly _models = new Map<string, ModelSettings>();
	private readonly _threads = new Map<string, ThreadSnapshot[]>();
	private _enableThinking:boolean;
	private _reasoningEffort:ReasoningEffort | undefined;
	private _responses:boolean | undefined;
	/** LM Studio's own model management, when the server has it. */
	private readonly _loader:LMStudioLoader;
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
		this._budgetField = config.budgetField;
		this._loader = new LMStudioLoader({
			url: (path) => joinURL(this.rootURL, path),
			fetch: this._fetchImpl,
			timeoutMs: this._timeoutMs,
			headers: () => this.headers(),
			post: (url, body) => this.post(url, body),
			loadOf: (model) => this.loadOf(model),
			load: this._loadOpts,
			configured: () => [...this._models.keys()],
			catalog: (models) => this.rememberReasoning(models),
		});
	}

	/**
	 * Run `model` with `settings` from now on, and keep it loaded beside the other configured models. The next
	 * request reloads it if a loaded copy no longer fits.
	 */
	public configureModel(model:string, settings:ModelSettings):void {
		this._models.set(model, { ...settings });
	}

	/** `model` is no longer configured: it runs with the provider's config, and loading another may unload it. */
	public forgetModel(model:string):void {
		this._models.delete(model);
	}

	public async chat(req:ChatRequest):Promise<ChatResponse> {
		await this._loader.ensureReady(req.model);
		this._loader.hold(req.model);
		const send = (ask:ChatRequest):Promise<ChatResponse> => (this._loader.present ? this.dispatchChat(ask) : this.chatJit(ask));
		try {
			return await send(req).catch((err:unknown) => {
				// Stuck repeating its thought, or no room to think: that turn failed, and is asked once more without thinking.
				// One stuck in its answer has already handed the caller that much of it, so it fails.
				const thinkless = err instanceof PromptTooLongError ? this.thinkingOn(req) : err instanceof Error && LOOPING.exec(err.message)?.[1] === 'thought';
				if (!thinkless) {
					throw err;
				}
				return send({ ...req, enableThinking: false });
			});
		}
		finally {
			this._loader.release(req.model);
		}
	}

	public async embed(texts:string[], model?:string):Promise<number[][]> {
		const name = model;
		if (!name) {
			throw new Error('embed: no model id (refusing to load a second embedding model)');
		}
		await this._loader.ensureReady(name);
		this._loader.hold(name);
		try {
			return await this.embedReady(texts, name);
		}
		finally {
			this._loader.release(name);
		}
	}

	private async embedReady(texts:string[], name:string):Promise<number[][]> {
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

	/** The request's sampling as body fields: `top_k` only when set, since not every server takes it. */
	private samplingBody(req:ChatRequest):Record<string, number> {
		const { temperature, topP, topK } = samplingOf(this.settingsOf(req.model).sampling, req.sampling);
		return {
			...temperature === undefined ? {} : { temperature },
			...topP === undefined ? {} : { top_p: topP },
			...topK === undefined ? {} : { top_k: topK },
		};
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
	 * The load config for `model`: the provider's, with that model's context length, capped at the most it takes, and
	 * as many slots as it thinks at once. Uncapped, a 4k model never fits a 16k ask, so every request would unload and
	 * reload it. With fewer slots than its thinks, a copy loaded earlier (by hand, or by another setup) would queue
	 * them, so it is loaded again.
	 */
	private loadOf(model:string):HttpLoadConfig {
		const settings = this.settingsOf(model);
		const want = settings.contextLength ?? this._loadOpts.contextLength;
		const max = [...this._maxContextByModel].find(([id]) => modelIDsMatch(id, model))?.[1];
		const slots = settings.maxParallel ?? this._loadOpts.parallel;
		const maxSlots = this._loader.maxParallel.get(model);
		return {
			...this._loadOpts,
			parallel: slots !== undefined && maxSlots !== undefined ? Math.min(slots, maxSlots) : slots,
			contextLength: want !== undefined && max !== undefined ? Math.min(want, max) : want,
		};
	}

	/** Whether `req` thinks: as asked, else as its model or this provider says, and only while its think allows it some. */
	private thinkingOn(req:ChatRequest):boolean {
		return (req.enableThinking ?? this.settingsOf(req.model).enableThinking ?? this._enableThinking) && this.thinkingAllowance(req) !== 0;
	}

	/**
	 * Most tokens `req` may think on its model's budget (`ModelSettings.thinkingBudget`): what its think has left, or half
	 * what the think's last thinking request was allowed when that is more, and never under the floor; undefined with no
	 * budget.
	 */
	private thinkingAllowance(req:ChatRequest):number | undefined {
		const { thinkingBudget: budget, thinkingFloor: floor = DEFAULT_THINKING_FLOOR } = this.settingsOf(req.model);
		return budget === undefined ? undefined : Math.max(budget - (req.thinkingSpent ?? 0), Math.floor((req.lastThinkingAllowance ?? 0) / 2), Math.min(floor, budget));
	}

	/** Most tokens `req` may think before it is cut: its allowance, or a little when off. */
	private thinkingBudget(req:ChatRequest):number | undefined {
		return !this.thinkingOn(req) ? THINK_OFF_BUDGET : this._budgetField ? undefined : this.thinkingAllowance(req);
	}

	private async thinkOffPrefill(model:string, thinkingOn:boolean):Promise<string | null> {
		if (thinkingOn) {
			return null;
		}
		if (!isThinkingModel(model) && !thinkOffMode(model) && !alwaysThinks(model)) {
			return null;
		}
		if (this._applyPromptTemplateFn) {
			const derived = await resolveAssistantPrefill(this._applyPromptTemplateFn, model);
			if (derived) {
				return derived;
			}
		}
		return thoughtTagsOf(model).thought('');
	}

	private async prepareMessages(req:ChatRequest):Promise<ChatMessage[]> {
		const thinkingOn = this.thinkingOn(req);
		const thinkingModel = isThinkingModel(req.model);
		let messages = req.messages;
		// llama.cpp feeds a trailing assistant message to the JSON-schema grammar.
		// A think-tag or Harmony prefill starts with `<`, which empties that stack.
		const grammar = req.responseFormat !== undefined;
		if (thinkingOn && thinkingModel) {
			return messages;
		}
		const off = thinkOffMode(req.model);
		if (off === 'no_think') {
			messages = withNoThink(messages);
		}
		if (grammar) {
			return messages;
		}
		const prefill = await this.thinkOffPrefill(req.model, thinkingOn);
		if (prefill) {
			messages = withAssistantPrefill(messages, prefill);
		}
		return messages;
	}

	/**
	 * A reply over `wire`, and the whole reply's JSON for its id. `extra` adds fields to the request; `held` is what the
	 * server already holds of the thread, read before `messages` but not sent again.
	 */
	private async chatVia(
		wire:Wire,
		req:ChatRequest,
		messages:ChatMessage[],
		extra:Record<string, unknown> = {},
		held:ChatMessage[] = [],
	):Promise<{ res:ChatResponse; json:Record<string, unknown> }> {
		const body:Record<string, unknown> = { model: req.model, ...wire.body(req, messages, this.wireAsk(req)), ...extra, ...this.samplingBody(req) };
		const allowance = this.thinkingAllowance(req);
		if (this._budgetField && allowance !== undefined) {
			body[this._budgetField] = allowance;
		}
		const cap = this.outputCap(req, promptTokens(body) + (held.length > 0 ? promptTokens({ held }) : 0));
		if (cap !== undefined) {
			body[wire.capField] = cap;
		}
		const got = await this.postChat(wire, body, req);
		const allowed = this.thinkingOn(req) && allowance !== undefined ? { thinkingAllowance: allowance } : {};
		if (got.cutThought !== undefined) {
			return { res: { ...cutThoughtReply(got), ...allowed }, json: got.json };
		}
		const timings = parseChatTimings(got.json);
		return { res: { ...wire.parse(got.json), ...timings, ...mergeClientTimings(timings, got.firstMs, got.wallMs), ...allowed }, json: got.json };
	}

	/** Over the responses API, continuing the request's thread from the stored reply it best extends. */
	private async chatResponses(req:ChatRequest, messages:ChatMessage[]):Promise<ChatResponse> {
		const key = req.thread?.trim() || '';
		const stored = key ? (this._threads.get(key) ?? []) : [];
		const hit = key ? pickBestThread(stored, messages) : undefined;
		const suffix = hit ? messages.slice(hit.prefixLen) : messages;
		const { res, json } = await this.chatVia(responsesWire, req, suffix, hit ? { previous_response_id: hit.id } : {}, messages.slice(0, hit?.prefixLen ?? 0));
		this._responses = true;
		const id = json.id ?? json['response_id'];
		if (key && typeof id === 'string') {
			this._threads.set(key, rememberThread(stored, { id, messages: [...messages, assistantFromResponse(res)] }));
		}
		return res;
	}

	/** What `req` runs with: the reasoning option its model takes, and a `/no_think` model's template switch. */
	private wireAsk(req:ChatRequest):WireAsk {
		const thinkingOn = this.thinkingOn(req);
		const prefer = thinkingOn ? preferReasoning(this.settingsOf(req.model).reasoningEffort ?? this._reasoningEffort) : undefined;
		const noThink = thinkOffMode(req.model) === 'no_think';
		return {
			reasoning: pickReasoningOption(this.allowedReasoning(req.model), thinkingOn, prefer),
			templateThinking: !noThink ? undefined : thinkingOn ? (isThinkingModel(req.model) || undefined) : false,
		};
	}

	/**
	 * The most tokens the reply may run, within what its slot's context leaves; undefined leaves it to the server. A
	 * thought on a budget gets its allowance and room to answer: the stream is cut at the allowance, but the server goes
	 * on generating until it hits this, and a stalled page reads the whole backlog before it can cut. A slot's share is
	 * what it holds with every slot busy; a lone request may fill more of a unified KV cache, so it gets at least its
	 * allowance and room to answer (or the reply's own cap, when smaller), and throws only when the whole context lacks it.
	 */
	private outputCap(req:ChatRequest, prompt:number):number | undefined {
		const thinking = this.thinkingOn(req);
		const allowance = thinking ? this.thinkingAllowance(req) : undefined;
		let want = req.maxTokens ?? this._maxTokens ?? (thinking ? THINK_OUT : undefined);
		if (allowance !== undefined) {
			want = Math.min(want ?? THINK_OUT, allowance + ANSWER_ROOM);
		}
		const context = this._loader.contextOf(req.model);
		if (context === undefined) {
			return want;
		}
		const cap = want ?? THINK_OUT;
		const least = Math.min(cap, (allowance ?? 0) + ANSWER_ROOM);
		if (context.whole - prompt - 32 < least) {
			throw new PromptTooLongError(`prompt too long: ≈${prompt} of the ${context.whole} tokens ${req.model} is loaded with, leaving under ${least} to ${allowance === undefined ? '' : 'think and '}answer in: raise contextLength`);
		}
		return Math.min(cap, Math.max(least, context.slot - prompt - 32));
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
		if (!req.responseFormat && (this._responses === true || (this._responses !== false && this._loader.present))) {
			try {
				return await this.chatResponses(req, messages);
			}
			catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				// A reply stuck repeating itself came from the endpoint, and a prompt too long is too long on either. A server
				// without it is not asked again; one with it falls back for a reply it lost.
				if (LOOPING.test(msg) || err instanceof PromptTooLongError) {
					throw err;
				}
				if (this._responses !== true || / 404:| 405:/.test(msg)) {
					this._responses = false;
				}
				else if (!/stream ended without a response/.test(msg)) {
					throw err;
				}
			}
		}
		return (await this.chatVia(chatWire, req, messages)).res;
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
		if (this._loader.hasReusable(req.model)) {
			return this.dispatchChat(req);
		}
		if (!this._jitFirst) {
			this._jitFirst = this.dispatchChat(req).then((res) => {
				this._loader.loadedByRequest(req.model);
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

	private headers():Record<string, string> {
		const headers:Record<string, string> = {
			'content-type': 'application/json',
		};
		if (this._apiKey) {
			headers.authorization = `Bearer ${this._apiKey}`;
		}
		return headers;
	}

	private async postChat(wire:Wire, body:Record<string, unknown>, req:ChatRequest):Promise<Got> {
		const url = joinURL(this.baseURL, wire.path);
		let lastErr:Error | null = null;
		const thinkingBudget = this.thinkingBudget(req);
		// Streamed logprobs come in pieces; a scored answer is one token anyway.
		let stream = !req.topLogprobs;
		for (let attempt = 0; attempt < 4; attempt++) {
			if (req.signal?.aborted) {
				throw req.signal.reason instanceof Error ? req.signal.reason : new Error('aborted');
			}
			if (attempt > 0) {
				await sleep(350 * attempt);
			}
			const payload:Record<string, unknown> = { ...body, stream, ...stream ? wire.streamFields : {} };
			req.onRequest?.({ body: payload, path: url });
			const t0 = nowMs();
			const res = await this._fetchImpl(url, {
				method: 'POST',
				headers: this.headers(),
				body: JSON.stringify(payload),
				// The caller's cancel and the timeout both end it: a think that never answers would hold its mind forever.
				signal: req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(this._timeoutMs)]) : AbortSignal.timeout(this._timeoutMs),
			});
			if (!res.ok) {
				const text = await res.text();
				const msg = errorText(text);
				lastErr = new Error(`inference ${url} ${res.status}: ${msg}`);
				if (stream && (res.status === 400 || res.status === 415) && /stream/i.test(`${msg} ${text}`)) {
					stream = false;
					continue;
				}
				if (isContextOverflow(`${msg} ${text}`) && shrinkForOverflow(body) && attempt < 3) {
					continue;
				}
				// Every turn names its effort, so a server or model that takes none says so: it is asked again without one.
				if (res.status === 400 && /reasoning/i.test(msg) && ('reasoning' in body || 'reasoning_effort' in body)) {
					delete body.reasoning;
					delete body['reasoning_effort'];
					continue;
				}
				if (shouldRetry(res.status, text) && attempt < 3) {
					continue;
				}
				throw lastErr;
			}
			try {
				return await readInferenceResponse(res, url, wire, t0, thinkingBudget, req.onDelta);
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
			if (!res.ok) {
				lastErr = new Error(`inference ${url} ${res.status}: ${errorText(text)}`);
				if (!url.includes('/models/load') && shouldRetry(res.status, text) && attempt < 3) {
					continue;
				}
				throw lastErr;
			}
			return parseJsonRecord(text, url, res.status);
		}
		throw lastErr ?? new Error(`inference ${url} failed`);
	}
}
