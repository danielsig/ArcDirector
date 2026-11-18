import { extractJson, isRecord } from '../json.js';
import { FAMILY_TAGS, type ReasoningOption } from './models.js';
import type { ChatContent, ChatMessage, ChatRequest, ChatResponse, ToolCall, ToolDef } from './provider.js';

type Json = Record<string, unknown>;

/** What a request runs with, as the provider decided it; each wire writes it in its own fields. */
export type WireAsk = {
	/** The reasoning effort, when the model lists the options it takes. */
	reasoning?:ReasoningOption;
	/** A `/no_think` model's template switch: true to think, false not to, unset for other models. */
	templateThinking?:boolean;
};

/** A streamed reply as it comes in, one event at a time. */
export type WireFold = {
	/** Takes one event, and says whether it held a piece of the answer or of the thought. */
	take(ev:Json):'answer' | 'thought' | undefined;
	/** The thought so far. */
	readonly thought:string;
	/** Some of the answer, text or a tool call, has come. */
	readonly answering:boolean;
	/** What the stream added up to, shaped as the endpoint's whole reply, or undefined when it held none. */
	reply(last:Json | undefined):Json | undefined;
};

/**
 * One of the two OpenAI-style chat endpoints: how a request is written for it, and how its reply reads, streamed or
 * whole. `HttpProvider` picks one per request and keeps what they share: sampling, the output cap, retries, timings.
 */
export type Wire = {
	readonly path:string;
	/** The field the output cap goes in. */
	readonly capField:string;
	/** Fields a streamed request adds. */
	readonly streamFields:Json;
	/** The request's fields this endpoint names its own way: messages, reasoning, schema, logprobs, tools. */
	body(req:ChatRequest, messages:ChatMessage[], ask:WireAsk):Json;
	/** A fold for one streamed reply; `onAnswer` gets each piece of answer text as it comes. */
	fold(onAnswer:(text:string)=>void):WireFold;
	/** A whole reply's answer, without timings: those depend on how it was sent. */
	parse(json:Json):ChatResponse;
};

/**
 * Both endpoints take an effort in OpenAI's words: the responses API as `reasoning: { effort }` (a bare option is a
 * 400), chat completions as `reasoning_effort` (a bare `reasoning` is ignored, so only this turns reasoning off).
 */
export const REASONING_EFFORT:Record<ReasoningOption, string> = { off: 'none', on: 'medium', low: 'low', medium: 'medium', high: 'high' };

/** `chat/completions`: served everywhere, and the one LM Studio holds to a JSON schema. */
export const chatWire:Wire = {
	path: 'chat/completions',
	capField: 'max_tokens',
	streamFields: { stream_options: { include_usage: true } },
	body(req, messages, ask) {
		const body:Json = { messages: toChatMessages(messages) };
		if (ask.reasoning) {
			body['reasoning_effort'] = REASONING_EFFORT[ask.reasoning];
			if (ask.reasoning === 'low') {
				setTemplateKwargs(body, { reasoning_strength: 'low' });
			}
		}
		if (ask.templateThinking !== undefined) {
			body['enable_thinking'] = ask.templateThinking;
			setTemplateKwargs(body, { enable_thinking: ask.templateThinking });
		}
		if (req.responseFormat) {
			const { name, schema, strict } = req.responseFormat;
			body['response_format'] = { type: 'json_schema', json_schema: { name, schema, strict: strict ?? false } };
		}
		if (req.topLogprobs) {
			body.logprobs = true;
			body['top_logprobs'] = req.topLogprobs;
		}
		addTools(body, req, (t) => ({ type: 'function', function: t }));
		return body;
	},
	fold(onAnswer) {
		let content = '';
		let thought = '';
		let tools:unknown;
		let finish:unknown;
		return {
			get thought() {
				return thought;
			},
			get answering() {
				return content !== '' || tools !== undefined;
			},
			take(ev) {
				const choice = Array.isArray(ev.choices) && isRecord(ev.choices[0]) ? ev.choices[0] : {};
				finish = choice['finish_reason'] ?? finish;
				if (isRecord(choice.message)) {
					const msg = choice.message;
					content = typeof msg.content === 'string' ? msg.content : content;
					thought = typeof msg['reasoning_content'] === 'string' ? msg['reasoning_content'] : thought;
					tools = msg['tool_calls'] ?? tools;
				}
				const delta = isRecord(choice.delta) ? choice.delta : {};
				let piece:'answer' | 'thought' | undefined;
				if (Array.isArray(delta['tool_calls']) && delta['tool_calls'].length > 0) {
					tools = mergeToolCallDeltas(tools, delta['tool_calls']);
					piece = 'answer';
				}
				if (typeof delta.content === 'string' && delta.content) {
					content += delta.content;
					onAnswer(delta.content);
					piece = 'answer';
				}
				if (typeof delta['reasoning_content'] === 'string' && delta['reasoning_content']) {
					thought += delta['reasoning_content'];
					piece = 'thought';
				}
				return piece;
			},
			reply(last) {
				if (!content && !thought && tools === undefined) {
					return last && Array.isArray(last.choices) ? last : undefined;
				}
				const message:Json = { role: 'assistant', content };
				if (thought) {
					message['reasoning_content'] = thought;
				}
				if (tools !== undefined) {
					message['tool_calls'] = tools;
				}
				return { choices: [{ message, finish_reason: finish }] };
			},
		};
	},
	parse(json) {
		const first = Array.isArray(json.choices) && isRecord(json.choices[0]) ? json.choices[0] : {};
		const message = isRecord(first.message) ? first.message : isRecord(first.delta) ? first.delta : {};
		return {
			content: stripTemplateTokens(textFrom(message.content)) ?? jsonOrNull(textFrom(message['reasoning_content'])),
			reasoning: cleanThought(textFrom(message['reasoning_content'])),
			toolCalls: parseToolCalls(message['tool_calls'] ?? message['toolCalls']),
			truncated: first['finish_reason'] === 'length',
			logprobs: topLogprobs(isRecord(first.logprobs) ? first.logprobs.content : undefined),
		};
	},
};

/** `responses`: LM Studio continues a stored reply's thread from its id, so a long conversation is not sent again. */
export const responsesWire:Wire = {
	path: 'responses',
	capField: 'max_output_tokens',
	streamFields: {},
	body(req, messages, ask) {
		const body:Json = { input: messagesToInput(messages), store: true };
		if (ask.reasoning) {
			body.reasoning = { effort: REASONING_EFFORT[ask.reasoning] };
		}
		if (req.topLogprobs) {
			body.include = ['message.output_text.logprobs'];
			body['top_logprobs'] = req.topLogprobs;
		}
		addTools(body, req, (t) => ({ type: 'function', ...t }));
		return body;
	},
	fold(onAnswer) {
		let completed:Json | undefined;
		let id:string | undefined;
		let text = '';
		let thought = '';
		const doneItems:Json[] = [];
		const funcs = new Map<string, { id:string; name:string; arguments:string }>();
		return {
			get thought() {
				return thought;
			},
			get answering() {
				return text !== '' || funcs.size > 0;
			},
			take(ev) {
				const type = typeof ev.type === 'string' ? ev.type : '';
				completed = terminalResponse(type, ev) ?? completed;
				if (isRecord(ev.response) && typeof ev.response.id === 'string') {
					id ??= ev.response.id;
				}
				if (isRecord(ev.item) && (type === 'response.output_item.done' || type === 'response.output_item.added')) {
					if (type === 'response.output_item.done') {
						doneItems.push(ev.item);
					}
					noteFunctionItem(ev.item, funcs);
				}
				else if (type === 'response.output_text.done' && typeof ev.text === 'string') {
					text = ev.text;
				}
				if (typeof ev.delta !== 'string' || !ev.delta) {
					return undefined;
				}
				if (type === 'response.function_call_arguments.delta') {
					const key = typeof ev['item_id'] === 'string' ? ev['item_id'] : '_';
					const call = funcs.get(key) ?? { id: typeof ev['call_id'] === 'string' ? ev['call_id'] : key, name: '', arguments: '' };
					call.arguments += ev.delta;
					funcs.set(key, call);
					return 'answer';
				}
				if (type === 'response.output_text.delta') {
					text += ev.delta;
					onAnswer(ev.delta);
					return 'answer';
				}
				if (type === 'response.reasoning_text.delta' || type === 'response.reasoning.delta') {
					thought += ev.delta;
					return 'thought';
				}
				return undefined;
			},
			reply(last) {
				if (completed) {
					return completed;
				}
				const output:Json[] = doneItems.length > 0 ? doneItems : [
					...thought ? [{ type: 'reasoning', content: [{ type: 'reasoning_text', text: thought }] }] : [],
					...text ? [{ type: 'message', content: [{ type: 'output_text', text }] }] : [],
					...[...funcs.values()].filter((fc) => fc.name).map((fc) => ({ type: 'function_call', call_id: fc.id, name: fc.name, arguments: fc.arguments })),
				];
				if (output.length > 0) {
					return id ? { id, output } : { output };
				}
				if (last && Array.isArray(last.output)) {
					return last;
				}
				return isRecord(last?.response) && Array.isArray(last.response.output) && last.response.output.length > 0 ? last.response : undefined;
			},
		};
	},
	parse(json) {
		const output = (Array.isArray(json.output) ? json.output : []).filter(isRecord);
		const texts:string[] = [];
		const thoughts:string[] = [];
		for (const item of output) {
			const text = textFrom(item.content);
			if (text && item.type === 'message') {
				texts.push(text);
			}
			else if (text && item.type === 'reasoning') {
				thoughts.push(text);
				if (jsonOrNull(text)) {
					texts.push(text);
				}
			}
		}
		return {
			content: stripTemplateTokens(texts.join('\n') || null),
			reasoning: cleanThought(thoughts.join('\n')),
			toolCalls: parseToolCalls(output.filter((item) => item.type === 'function_call' || item.type === 'tool_call')),
			truncated: json.status === 'incomplete',
			logprobs: topLogprobs(output
				.flatMap((item) => (item.type === 'message' && Array.isArray(item.content) ? item.content : []))
				.flatMap((part) => (isRecord(part) && Array.isArray(part.logprobs) ? part.logprobs : []))),
		};
	},
};

function setTemplateKwargs(body:Json, patch:Json):void {
	const prev = isRecord(body['chat_template_kwargs']) ? body['chat_template_kwargs'] : {};
	body['chat_template_kwargs'] = { ...prev, ...patch };
}

function addTools(body:Json, req:ChatRequest, shape:(tool:ToolDef)=>unknown):void {
	if (req.tools && req.tools.length > 0) {
		body.tools = req.tools.map(shape);
		if (req.toolChoice) {
			body['tool_choice'] = req.toolChoice;
		}
	}
}

/** `text` when it holds JSON, else null: a model may write its answer into the thought. */
function jsonOrNull(text:string | null):string | null {
	try {
		extractJson(text ?? '');
		return text;
	}
	catch {
		return null;
	}
}

/** The first answer token's top candidates from a reply's token list, or undefined without them. */
function topLogprobs(tokens:unknown):Record<string, number> | undefined {
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

function toChatMessages(messages:ChatMessage[]):unknown[] {
	return messages.map((m) => {
		const row:Json = { role: m.role };
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
const TEMPLATE_TOKENS = /<\|[\w-]+\|?>|<[\w-]+\|>|<\|[\w-]*$/g;

/** `text` without leaked chat-template tokens (see `TEMPLATE_TOKENS`), trimmed; `null` when nothing is left. */
export function stripTemplateTokens(text:string | null):string | null {
	return text?.replace(TEMPLATE_TOKENS, '').trim() || null;
}

/**
 * What a model may leak into its thought: a channel header at its start (Gemma 4's `<|channel>thought`, Harmony's
 * `<|channel|>analysis`), and any family's thought tags (`FAMILY_TAGS`) anywhere in it.
 */
const THOUGHT_MARKS = new RegExp([
	String.raw`^\s*<\|channel\|?>\w*`,
	...FAMILY_TAGS.flatMap((tags) => [tags.open, tags.close]).map((tag) => tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
].join('|'), 'g');

/** A thought without leaked thought tags or template tokens, untrimmed. */
function untagged(thought:string):string {
	return thought.replace(THOUGHT_MARKS, '').replace(TEMPLATE_TOKENS, '');
}

/** A thought as shown: no leaked thought tags or template tokens, trimmed; `undefined` when nothing is left. */
export function cleanThought(text:string | null | undefined):string | undefined {
	return (text && untagged(text).trim()) || undefined;
}

/**
 * Streams a thought clean: given the whole thought so far, emits only its new clean text. A header, tag or token still
 * arriving (`<|chan`, `</thi`, a last `<`) is held back until it is whole and dropped, or turns out to be text.
 */
export function thoughtStream(emit:(text:string)=>void):(soFar:string)=>void {
	let shown = '';
	return (soFar) => {
		const clean = untagged(soFar).trimStart().replace(/<\/?[\w|]*$/, '');
		if (clean.length > shown.length && clean.startsWith(shown)) {
			emit(clean.slice(shown.length));
			shown = clean;
		}
	};
}

/**
 * Whether `text` ends in one unit of 1 to `maxUnit` letters said `times` times back to back, over at least `minSpan`
 * letters: a model stuck in a loop (`thought\n` over and over, `}}}}`, `and and and`). A real list's items differ, so
 * it is left alone. Reads only the tail in place, so it runs on every streamed piece.
 */
export function loops(text:string, times = 8, maxUnit = 40, minSpan = 64):boolean {
	const end = text.length - 1;
	// A unit shorter than this repeats at a multiple of its length that is not.
	for (let unit = Math.ceil(minSpan / times); unit <= maxUnit && unit * times <= end + 1; unit++) {
		let i = unit;
		while (i < unit * times && text.charCodeAt(end - i) === text.charCodeAt(end - i + unit)) {
			i++;
		}
		if (i === unit * times) {
			return true;
		}
	}
	return false;
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

/** Tool calls as either endpoint writes them: `{ id, function: { name, arguments } }`, or flat with a `call_id`. */
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
		const id = typeof item['call_id'] === 'string'
			? item['call_id']
			: typeof item.id === 'string' ? item.id : `call_${out.length}`;
		const name = [fn.name, item.name, item.tool].find((n) => typeof n === 'string') as string | undefined;
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

/** The finished reply a `response.completed` or `response.incomplete` event carries. */
function terminalResponse(type:string, ev:Json):Json | undefined {
	if (type !== 'response.completed' && type !== 'response.incomplete') {
		return undefined;
	}
	return isRecord(ev.response) ? { ...ev.response } : Array.isArray(ev.output) ? { ...ev } : undefined;
}

function noteFunctionItem(item:Json, funcs:Map<string, { id:string; name:string; arguments:string }>):void {
	if (item.type !== 'function_call' && item.type !== 'tool_call') {
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
