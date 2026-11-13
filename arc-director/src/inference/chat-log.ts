import type { DirectorLog, InferClock } from '../director/director-types.js';
import type { ChatRequest, ChatResponse, InferenceProvider } from './provider.js';
import { isRecord } from '../json.js';

function contentText(content:unknown):string {
	if (typeof content === 'string') {
		return content;
	}
	if (!Array.isArray(content)) {
		return '';
	}
	const parts:string[] = [];
	for (const part of content) {
		if (typeof part === 'string') {
			parts.push(part);
		}
		else if (isRecord(part) && typeof part.text === 'string') {
			parts.push(part.text);
		}
	}
	return parts.join('');
}

function findImage(payload:unknown):string | undefined {
	if (!isRecord(payload)) {
		return undefined;
	}
	return lastDataURL(payload.messages);
}

function lastDataURL(value:unknown):string | undefined {
	if (typeof value === 'string') {
		return value.startsWith('data:') ? value : undefined;
	}
	if (Array.isArray(value)) {
		let hit:string | undefined;
		for (const item of value) {
			hit = lastDataURL(item) ?? hit;
		}
		return hit;
	}
	if (isRecord(value)) {
		let hit:string | undefined;
		for (const item of Object.values(value)) {
			hit = lastDataURL(item) ?? hit;
		}
		return hit;
	}
	return undefined;
}

function stripContents(value:unknown, blocks:string[]):unknown {
	if (Array.isArray(value)) {
		return value.map((item) => {
			if (isRecord(item) && 'content' in item) {
				const text = contentText(item.content);
				if (text) {
					blocks.push(text);
				}
				const rest:Record<string, unknown> = { ...item };
				delete rest.content;
				return rest;
			}
			return stripContents(item, blocks);
		});
	}
	if (isRecord(value)) {
		const out:Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			out[key] = stripContents(item, blocks);
		}
		return out;
	}
	if (typeof value === 'string' && value.startsWith('data:')) {
		return '[image]';
	}
	return value;
}

function fence(text:string):string {
	let n = 3;
	const tick = '`';
	while (text.includes(tick.repeat(n))) {
		n += 1;
	}
	const marks = tick.repeat(n);
	return `${marks}\n${text}\n${marks}`;
}

/** A response-format schema is kilobytes of grammar, so the log shows its name: wire `response_format` or raw `responseFormat`. */
function schemaNamed(payload:unknown):unknown {
	if (!isRecord(payload)) {
		return payload;
	}
	const out:Record<string, unknown> = { ...payload };
	const wire = out['response_format'];
	if (isRecord(wire) && isRecord(wire['json_schema']) && typeof wire['json_schema'].name === 'string') {
		out['response_format'] = wire['json_schema'].name;
	}
	const raw = out['responseFormat'];
	if (isRecord(raw) && typeof raw.name === 'string') {
		out['responseFormat'] = raw.name;
	}
	return out;
}

/** Wire/request dump: JSON minus message bodies, bodies in fences, schemas by name, last data-URL as `image`. */
export function formatChatLog(payload:unknown):{ message:string; image?:string } {
	const blocks:string[] = [];
	const image = findImage(payload);
	const json = JSON.stringify(stripContents(schemaNamed(payload), blocks));
	const message = blocks.length > 0 ? `${json}\n${blocks.map(fence).join('\n')}` : json;
	return image ? { message, image } : { message };
}

/** A System One's pick: only a pick asks for the answer token's log probabilities. It is logged once, whole, by the pick. */
function isPick(req:ChatRequest):boolean {
	return req.topLogprobs !== undefined;
}

/** Who a request thinks for: the `You are …` of its system prompt, else its thread. */
function whoFromMessages(req:ChatRequest):string {
	for (const m of req.messages) {
		if (m.role !== 'system' || typeof m.content !== 'string') {
			continue;
		}
		const hit = /^You are ([^.]+)/.exec(m.content);
		if (hit) {
			return hit[1].trim();
		}
	}
	return req.thread ?? 'ArcDirector';
}

/**
 * `inner` timed into `clock` and logged: the prompt (the body as sent, when the server sends one), then the reply with
 * its timings, or why it failed. A stopped think ends its request.
 */
export function loggedProvider(inner:InferenceProvider, clock:InferClock, log:(entry:DirectorLog)=>void):InferenceProvider {
	const embed = inner.embed?.bind(inner);
	return {
		chat: async (req:ChatRequest):Promise<ChatResponse> => {
			if (isPick(req)) {
				return inner.chat(req);
			}
			const name = whoFromMessages(req);
			const t0 = performance.now();
			let sent = false;
			const prompt = (payload:unknown, path?:string):void => {
				sent = true;
				const dump = formatChatLog(payload);
				log({ name, message: `prompt${path ? ` ${path}` : ''}\n${dump.message}`, image: dump.image });
			};
			try {
				const res = await inner.chat({ ...req, onRequest: ({ body, path }) => prompt(body, path) });
				if (!sent) {
					prompt(req);
				}
				const ms = Math.round(performance.now() - t0);
				recordInfer(clock, req.thread, ms, res);
				const parts = [`${ms}ms`];
				if (res.promptMs !== undefined) {
					parts.push(`ctx ${Math.round(res.promptMs)}ms`);
				}
				if (res.generateMs !== undefined) {
					parts.push(`gen ${Math.round(res.generateMs)}ms`);
					if (res.outputTokens && res.generateMs > 0) {
						parts.push(`${res.outputTokens} tok ${(res.outputTokens / (res.generateMs / 1000)).toFixed(1)}/s`);
					}
				}
				if (res.cachedTokens) {
					parts.push(`cache ${res.cachedTokens}`);
				}
				if (res.toolCalls.length > 0) {
					parts.push(`tool ${res.toolCalls.map((c) => c.name).join(', ')}`);
				}
				const thought = res.reasoning?.trim() ?? '';
				const body = res.content?.trim() ?? '';
				if (thought && thought !== body && !body.includes(thought)) {
					parts.push(`(thinking)\n${thought}`);
				}
				if (res.content) {
					parts.push(res.content);
				}
				else if (!thought && res.toolCalls.length === 0) {
					parts.push('(empty content)');
				}
				log({ name, message: parts.join('\n') });
				return res;
			}
			catch (err:unknown) {
				if (!sent) {
					prompt(req);
				}
				const ms = Math.round(performance.now() - t0);
				recordInfer(clock, req.thread, ms, {});
				const aborted = !!req.signal?.aborted;
				const text = aborted ? 'aborted' : err instanceof Error ? err.message : String(err);
				log({ name, message: `${ms}ms\n${text}`, error: !aborted });
				throw err;
			}
		},
		embed: embed ? (texts, model) => embed(texts, model) : undefined,
		systemOneEndpoint: inner.systemOneEndpoint?.bind(inner),
	};
}

/** One request's time into `clock`: wall time, and the context and generation time where the server says. */
function recordInfer(clock:InferClock, id:string | undefined, wallMs:number, res:{ promptMs?:number; generateMs?:number }):void {
	const context = res.promptMs;
	const generate = res.generateMs ?? (context !== undefined ? Math.max(0, wallMs - context) : wallMs);
	clock.calls += 1;
	clock.wallMs += wallMs;
	clock.lastWallMs = wallMs;
	if (context !== undefined) {
		clock.contextMs += context;
		clock.contextKnown += 1;
		clock.lastContextMs = context;
	}
	else {
		clock.lastContextMs = null;
	}
	clock.generateMs += generate;
	clock.lastGenerateMs = generate;
	if (id) {
		clock.thinkMs[id] = (clock.thinkMs[id] ?? 0) + generate;
	}
}
