import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MODEL_TIERS, type ThinkOff } from './models.js';
import { HttpProvider, loadConfigFits, parseChatTimings, stripTemplateTokens } from './http.js';
import { ChatSystemOne, JevSystemOne, ModelSystemOne } from './systemone.js';
import type { ChatRequest } from './provider.js';
import {
	EMPTY_THINK_PREFILL,
	DONE_THOUGHT,
	PREFILL_MARKER,
	clearAssistantThinkCache,
} from './assistantThink.js';

function idWithThinkOff(mode:ThinkOff):string {
	const row = MODEL_TIERS.find((t) => t.thinking && t.thinkOff === mode);
	if (row) {
		return row.id;
	}
	assert.equal(mode, 'no_think');
	return 'qwen3.8-27b';
}

async function captureBody(
	config:ConstructorParameters<typeof HttpProvider>[0],
	model:string,
	catalog?:{ models:unknown[] },
	extra?:Partial<ChatRequest>,
):Promise<Record<string, unknown>> {
	let body:Record<string, unknown> | undefined;
	const provider = new HttpProvider({
		...config,
		baseURL: 'http://127.0.0.1:9/v1',
		fetch: async (input, init) => {
			const url = String(input);
			if (url.endsWith('/api/v1/models') && init?.method !== 'POST') {
				if (!catalog) {
					return new Response('nope', { status: 404 });
				}
				return new Response(JSON.stringify(catalog), { status: 200 });
			}
			if (url.includes('/responses')) {
				return new Response('nope', { status: 404 });
			}
			body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			return new Response(JSON.stringify({
				choices: [{ message: { content: '{"ok":true}' } }],
			}), { status: 200 });
		},
	});
	await provider.chat({
		model,
		messages: [{ role: 'user', content: 'pong' }],
		...extra,
	});
	assert.ok(body);
	return body;
}

function catalogWithReasoning(id:string, allowed:string[]):{ models:unknown[] } {
	return {
		models: [{
			key: id,
			loaded_instances: [{ id }],
			capabilities: { reasoning: { allowed_options: allowed } },
		}],
	};
}

describe('HttpProvider thinking', () => {
	it('does not send max_tokens unless configured', async () => {
		const body = await captureBody({}, 'other-llm');
		assert.equal('max_tokens' in body, false);
	});

	it('caps thinking output so CoT cannot fill the window', async () => {
		const model = 'other-llm';
		const body = await captureBody(
			{ enableThinking: true },
			model,
			catalogWithReasoning(model, ['off', 'on']),
		);
		assert.equal(body['reasoning_effort'], 'medium');
		assert.equal(body['max_tokens'], 4096);
	});

	it('turns reasoning off and shrinks output when the engine exceeds context', async () => {
		const bodies:Record<string, unknown>[] = [];
		const model = 'other-llm';
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			enableThinking: true,
			fetch: async (input, init) => {
				const url = String(input);
				if (url.endsWith('/api/v1/models') && init?.method !== 'POST') {
					return new Response(JSON.stringify(catalogWithReasoning(model, ['off', 'on'])), { status: 200 });
				}
				if (url.includes('/responses')) {
					return new Response('nope', { status: 404 });
				}
				bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
				if (bodies.length === 1) {
					return new Response(
						'event: error\ndata: {"type":"error","error":{"message":"Engine protocol predict stream returned an error: {\\"code\\":500,\\"message\\":\\"Context size has been exceeded.\\",\\"type\\":\\"server_error\\"}"}}\n\n',
						{ status: 200, headers: { 'content-type': 'text/event-stream' } },
					);
				}
				return new Response(JSON.stringify({
					choices: [{ message: { content: '{"ok":true}' } }],
				}), { status: 200 });
			},
		});
		const res = await provider.chat({
			model,
			messages: [{ role: 'user', content: 'hi' }],
		});
		assert.equal(res.content, '{"ok":true}');
		assert.equal(bodies[0]?.['reasoning_effort'], 'medium');
		assert.equal(bodies[0]?.['max_tokens'], 4096);
		assert.equal(bodies[1]?.['reasoning_effort'], 'none', 'the retry still sends an effort, off, rather than dropping it');
		assert.equal(bodies[1]?.['max_tokens'], 512);
	});

	it('think-off no_think prefixes /no_think and prefills', async () => {
		const model = idWithThinkOff('no_think');
		const body = await captureBody({ maxTokens: 384 }, model);
		assert.equal(body['enable_thinking'], false);
		const messages = body.messages as Array<{ role?:string; content?:string }>;
		const system = messages.find((m) => m.role === 'system');
		assert.match(String(system?.content), /\/no_think/);
		assert.equal(messages.find((m) => m.role === 'user')?.content, 'pong');
		assert.equal(messages.at(-1)?.role, 'assistant');
		assert.equal(messages.at(-1)?.content, EMPTY_THINK_PREFILL);
	});

	it('reports the prepared body before the HTTP send', async () => {
		const order:string[] = [];
		let logged:Record<string, unknown> | undefined;
		const model = idWithThinkOff('strength');
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			onRequest: ({ body, path }) => {
				order.push('request');
				logged = body;
				assert.match(path, /chat\/completions$/);
			},
			fetch: async (input, init) => {
				const url = String(input);
				if (url.includes('/responses') || url.endsWith('/api/v1/models')) {
					return new Response('nope', { status: 404 });
				}
				order.push('fetch');
				assert.ok(logged);
				assert.deepEqual(logged, JSON.parse(String(init?.body)));
				return new Response(JSON.stringify({
					choices: [{ message: { content: '{"ok":true}' } }],
				}), { status: 200 });
			},
		});
		await provider.chat({
			model,
			messages: [{ role: 'user', content: 'pong' }],
		});
		assert.deepEqual(order, ['request', 'fetch']);
		const messages = logged?.messages as Array<{ role?:string; content?:string }>;
		assert.equal(messages.at(-1)?.role, 'assistant');
		assert.equal(messages.at(-1)?.content, EMPTY_THINK_PREFILL);
	});

	it('ignores reasoning_content that is not a JSON arc', async () => {
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async () => new Response(JSON.stringify({
				choices: [{
					message: {
						content: '',
						reasoning_content: 'Need emit JSON {"head": ... but never does',
					},
				}],
			}), { status: 200 }),
		});
		const res = await provider.chat({
			model: idWithThinkOff('no_think'),
			messages: [{ role: 'user', content: 'pong' }],
		});
		assert.equal(res.content, null);
		assert.equal(res.reasoning, 'Need emit JSON {"head": ... but never does');
	});

	it('reads reasoning_content when a JSON arc is only in reasoning_content', async () => {
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async () => new Response(JSON.stringify({
				choices: [{
					message: {
						content: '',
						reasoning_content: '{"head":{"verb":"wait","args":{"seconds":1}}}',
					},
				}],
			}), { status: 200 }),
		});
		const res = await provider.chat({
			model: idWithThinkOff('no_think'),
			messages: [{ role: 'user', content: 'pong' }],
		});
		assert.equal(res.content, '{"head":{"verb":"wait","args":{"seconds":1}}}');
	});

	it('enables thinking on no_think models', async () => {
		const body = await captureBody({
			enableThinking: true,
			maxTokens: 384,
		}, idWithThinkOff('no_think'));
		assert.equal(body['enable_thinking'], true);
		assert.deepEqual(body['chat_template_kwargs'], { enable_thinking: true });
	});

	it('does not send reasoning low unless the catalog allows it', async () => {
		const model = idWithThinkOff('strength');
		const body = await captureBody({
			enableThinking: true,
			maxTokens: 384,
		}, model);
		assert.equal(body['reasoning_effort'], undefined);
	});

	it('sends reasoning low when the listed model allows low', async () => {
		const model = idWithThinkOff('strength');
		const body = await captureBody({
			enableThinking: true,
			maxTokens: 384,
		}, model, catalogWithReasoning(model, ['off', 'on', 'low', 'medium', 'high']));
		assert.equal(body['reasoning_effort'], 'low');
		assert.equal(body.reasoning, undefined, 'chat completions ignores a bare reasoning option');
		assert.equal(body['enable_thinking'], undefined);
		assert.deepEqual(body['chat_template_kwargs'], { reasoning_strength: 'low' });
	});

	it('sends reasoning off when thinking is off and off is allowed', async () => {
		const model = idWithThinkOff('strength');
		const body = await captureBody({
			maxTokens: 384,
		}, model, catalogWithReasoning(model, ['off', 'on', 'low', 'medium', 'high']));
		assert.equal(body['reasoning_effort'], 'none');
		const messages = body.messages as Array<{ role?:string; content?:string }>;
		assert.equal(messages.at(-1)?.role, 'assistant');
		assert.equal(messages.at(-1)?.content, EMPTY_THINK_PREFILL);
	});

	it('does not prefill when thinking is on', async () => {
		const model = idWithThinkOff('strength');
		const body = await captureBody({
			enableThinking: true,
			maxTokens: 384,
		}, model, catalogWithReasoning(model, ['off', 'on', 'low', 'medium', 'high']));
		const messages = body.messages as Array<{ role?:string; content?:string }>;
		assert.equal(messages.at(-1)?.role, 'user');
		assert.equal(messages.at(-1)?.content, 'pong');
	});

	it('prefills a canned thought for one request when thinking stays on', async () => {
		const model = idWithThinkOff('strength');
		const body = await captureBody({
			enableThinking: true,
			maxTokens: 384,
		}, model, catalogWithReasoning(model, ['off', 'on', 'low', 'medium', 'high']), { fakeThought: true });
		assert.equal(body['reasoning_effort'], 'low');
		const messages = body.messages as Array<{ role?:string; content?:string }>;
		assert.equal(messages.at(-1)?.role, 'assistant');
		assert.equal(messages.at(-1)?.content, `<redacted_thinking>\n${DONE_THOUGHT}\n</redacted_thinking>`);
	});

	it('turns thinking off for one request even when the provider has it on', async () => {
		const model = idWithThinkOff('strength');
		const body = await captureBody({
			enableThinking: true,
			maxTokens: 384,
		}, model, catalogWithReasoning(model, ['off', 'on', 'low', 'medium', 'high']), { enableThinking: false });
		assert.equal(body['reasoning_effort'], 'none');
		const messages = body.messages as Array<{ role?:string; content?:string }>;
		assert.equal(messages.at(-1)?.role, 'assistant');
		assert.equal(messages.at(-1)?.content, EMPTY_THINK_PREFILL);
	});

	it('uses the Harmony to=user prefill from applyPromptTemplate', async () => {
		clearAssistantThinkCache();
		const header = '<|start|>assistant to=user<|channel|>final<|message|>';
		const model = idWithThinkOff('strength');
		const body = await captureBody({
			applyPromptTemplate: async (messages) => {
				const marked = messages.at(-1)?.role === 'assistant' ? PREFILL_MARKER : '';
				return `<|start|>user<|message|>y<|end|>${header}${marked}`;
			},
		}, model);
		const messages = body.messages as Array<{ role?:string; content?:string }>;
		assert.equal(messages.at(-1)?.role, 'assistant');
		assert.equal(messages.at(-1)?.content, header);
		clearAssistantThinkCache();
	});

	it('prefills a canned Harmony thought from applyPromptTemplate', async () => {
		clearAssistantThinkCache();
		const header = '<|start|>assistant to=user<|channel|>final<|message|>';
		const model = idWithThinkOff('strength');
		const body = await captureBody({
			enableThinking: true,
			applyPromptTemplate: async (messages) => {
				if (messages.at(-1)?.role === 'assistant') {
					return `<|start|>user<|message|>y<|end|>${header}${PREFILL_MARKER}`;
				}
				return '<|start|>user<|message|>y<|end|><|start|>assistant<|channel|>analysis<|message|><think>';
			},
		}, model, catalogWithReasoning(model, ['off', 'on', 'low', 'medium', 'high']), { fakeThought: true });
		const messages = body.messages as Array<{ role?:string; content?:string }>;
		assert.equal(body['reasoning_effort'], 'low');
		assert.equal(messages.at(-1)?.role, 'assistant');
		assert.equal(messages.at(-1)?.content, `<think>\n${DONE_THOUGHT}\n</think>${header}`);
		clearAssistantThinkCache();
	});

	it('sends reasoning on for on/off models, not low', async () => {
		const model = 'google/gemma-4-26b-a4b';
		const body = await captureBody({
			enableThinking: true,
			maxTokens: 384,
		}, model, catalogWithReasoning(model, ['off', 'on']));
		assert.equal(body['reasoning_effort'], 'medium');
	});

	it('does not send reasoning off when the model only allows on', async () => {
		const model = 'deepseek-r1';
		const body = await captureBody({
			maxTokens: 384,
		}, model, catalogWithReasoning(model, ['on']));
		assert.equal(body['reasoning_effort'], undefined);
	});

	it('sends reasoning low on the responses API as an effort object when the catalog allows it', async () => {
		let body:Record<string, unknown> | undefined;
		const provider = new HttpProvider({
			enableThinking: true,
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async (input, init) => {
				const url = String(input);
				if (url.endsWith('/api/v1/models') && init?.method !== 'POST') {
					return new Response(JSON.stringify({
						models: [{
							key: 'google/gemma-4-26b-a4b-qat',
							loaded_instances: [{ id: 'google/gemma-4-26b-a4b-qat' }],
							capabilities: {
								reasoning: { allowed_options: ['off', 'on', 'low', 'medium', 'high'] },
							},
						}],
					}), { status: 200 });
				}
				if (url.includes('/responses')) {
					body = JSON.parse(String(init?.body)) as Record<string, unknown>;
					return new Response(JSON.stringify({
						id: 'resp_1',
						output: [{
							type: 'message',
							content: [{ type: 'output_text', text: '{"ok":true}' }],
						}],
					}), { status: 200 });
				}
				return new Response('nope', { status: 404 });
			},
		});
		await provider.chat({
			model: 'google/gemma-4-26b-a4b-qat',
			messages: [{ role: 'user', content: 'pong' }],
		});
		assert.ok(body);
		assert.deepEqual(body.reasoning, { effort: 'low' }, 'the responses API wants an effort object; a bare string is a 400');
	});

	it('turns reasoning off as an effort object when a responses request overflows the context', async () => {
		const bodies:Record<string, unknown>[] = [];
		const provider = new HttpProvider({
			enableThinking: true,
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async (input, init) => {
				const url = String(input);
				if (url.endsWith('/api/v1/models') && init?.method !== 'POST') {
					return new Response(JSON.stringify({
						models: [{
							key: 'google/gemma-4-e4b',
							loaded_instances: [{ id: 'google/gemma-4-e4b' }],
							capabilities: { reasoning: { allowed_options: ['off', 'on', 'low', 'medium', 'high'] } },
						}],
					}), { status: 200 });
				}
				if (url.includes('/responses')) {
					bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
					if (bodies.length === 1) {
						return new Response(JSON.stringify({ error: { message: 'The number of tokens to keep exceeds the context' } }), { status: 400 });
					}
					return new Response(JSON.stringify({
						id: 'resp_1',
						output: [{ type: 'message', content: [{ type: 'output_text', text: 'wait()' }] }],
					}), { status: 200 });
				}
				return new Response('nope', { status: 404 });
			},
		});
		const res = await provider.chat({ model: 'google/gemma-4-e4b', messages: [{ role: 'user', content: 'pong' }] });
		assert.equal(res.content, 'wait()');
		assert.equal(bodies.length, 2);
		assert.deepEqual(bodies[1].reasoning, { effort: 'none' }, 'a bare "off" is a 400 on the responses API');
	});

	it('puts /no_think on the system message, not image user parts', async () => {
		let body:Record<string, unknown> | undefined;
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async (input, init) => {
				body = JSON.parse(String(init?.body)) as Record<string, unknown>;
				return new Response(JSON.stringify({
					choices: [{ message: { content: '{"ok":true}' } }],
				}), { status: 200 });
			},
		});
		await provider.chat({
			model: idWithThinkOff('no_think'),
			messages: [{
				role: 'user',
				content: [
					{ type: 'text', text: 'The map.' },
					{ type: 'image_url', image_url: { url: 'data:image/png;base64,xx' } },
				],
			}],
		});
		assert.ok(body);
		const messages = body.messages as Array<{ role?:string; content?:unknown }>;
		const system = messages.find((m) => m.role === 'system');
		assert.match(String(system?.content), /\/no_think/);
		const user = messages.find((m) => m.role === 'user');
		const content = user?.content as Array<{
			type?:string;
			text?:string;
			image_url?:{ url?:string };
		}>;
		assert.ok(Array.isArray(content));
		assert.equal(content[0]?.type, 'text');
		assert.equal(content[0]?.text, 'The map.');
		assert.equal(String(content[0]?.text).includes('/no_think'), false);
		assert.equal(content[1]?.type, 'image_url');
		assert.equal(content[1]?.image_url?.url, 'data:image/png;base64,xx');
		assert.equal(messages.at(-1)?.role, 'assistant');
		assert.equal(messages.at(-1)?.content, EMPTY_THINK_PREFILL);
	});
});

describe('HttpProvider native server', () => {
	it('loads via /api/v1/models/load when the native catalog exists', async () => {
		const urls:string[] = [];
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			load: { parallel: 2, evalBatchSize: 1024 },
			fetch: async (input, init) => {
				const url = String(input);
				urls.push(`${init?.method ?? 'GET'} ${url}`);
				if (url.endsWith('/api/v1/models') && init?.method !== 'POST') {
					return new Response(JSON.stringify({ models: [{ key: 'guard', loaded_instances: [] }] }), { status: 200 });
				}
				if (url.includes('/api/v1/models/load')) {
					const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
					assert.equal(body.flash_attention, true);
					assert.equal(body.offload_kv_cache_to_gpu, true);
					assert.equal(body.eval_batch_size, 1024);
					assert.equal(body.parallel, 2);
					assert.equal('context_length' in body, false);
					return new Response(JSON.stringify({ status: 'loaded', instance_id: 'guard' }), { status: 200 });
				}
				return new Response(JSON.stringify({
					choices: [{ message: { content: '{"ok":true}' } }],
				}), { status: 200 });
			},
		});
		await provider.chat({
			model: 'guard',
			messages: [{ role: 'user', content: 'hi' }],
		});
		assert.ok(urls.some((u) => u.includes('/api/v1/models/load')));
	});

	it('sends context_length on load when configured', async () => {
		let loadBody:Record<string, unknown> | undefined;
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			load: { contextLength: 8192 },
			fetch: async (input, init) => {
				const url = String(input);
				if (url.endsWith('/api/v1/models') && init?.method !== 'POST') {
					return new Response(JSON.stringify({ models: [{ key: 'guard', loaded_instances: [] }] }), { status: 200 });
				}
				if (url.includes('/api/v1/models/load')) {
					loadBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
					return new Response(JSON.stringify({ status: 'loaded', instance_id: 'guard' }), { status: 200 });
				}
				return new Response(JSON.stringify({
					choices: [{ message: { content: '{"ok":true}' } }],
				}), { status: 200 });
			},
		});
		await provider.chat({
			model: 'guard',
			messages: [{ role: 'user', content: 'hi' }],
		});
		assert.equal(loadBody?.context_length, 8192);
	});

	it('reuses a loaded instance when flash-attn, KV, batch, and parallel fit', async () => {
		const urls:string[] = [];
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			load: { parallel: 2, evalBatchSize: 512 },
			fetch: async (input, init) => {
				const url = String(input);
				urls.push(`${init?.method ?? 'GET'} ${url}`);
				if (url.endsWith('/api/v1/models') && init?.method !== 'POST') {
					return new Response(JSON.stringify({
						models: [{
							key: 'other-llm',
							type: 'llm',
							loaded_instances: [{
								id: 'other-llm',
								config: {
									flash_attention: true,
									offload_kv_cache_to_gpu: true,
									eval_batch_size: 512,
									parallel: 4,
								},
							}],
						}],
					}), { status: 200 });
				}
				if (url.includes('/api/v1/models/load') || url.includes('/api/v1/models/unload')) {
					return new Response('should not load', { status: 500 });
				}
				return new Response(JSON.stringify({
					choices: [{ message: { content: '{"ok":true}' } }],
				}), { status: 200 });
			},
		});
		await provider.chat({
			model: 'other-llm',
			messages: [{ role: 'user', content: 'hi' }],
		});
		assert.equal(urls.some((u) => u.includes('/models/load')), false);
		assert.equal(urls.some((u) => u.includes('/models/unload')), false);
	});

	it('unloads a same-id instance whose config is too small, then loads', async () => {
		const urls:string[] = [];
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			load: { parallel: 2, evalBatchSize: 512 },
			fetch: async (input, init) => {
				const url = String(input);
				urls.push(`${init?.method ?? 'GET'} ${url}`);
				if (url.endsWith('/api/v1/models') && init?.method !== 'POST') {
					return new Response(JSON.stringify({
						models: [{
							key: 'other-llm',
							type: 'llm',
							loaded_instances: [{
								id: 'other-llm',
								config: {
									flash_attention: true,
									offload_kv_cache_to_gpu: true,
									eval_batch_size: 512,
									parallel: 1,
								},
							}],
						}],
					}), { status: 200 });
				}
				if (url.includes('/api/v1/models/unload')) {
					const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
					assert.equal(body.instance_id, 'other-llm');
					return new Response(JSON.stringify({ instance_id: body.instance_id }), { status: 200 });
				}
				if (url.includes('/api/v1/models/load')) {
					return new Response(JSON.stringify({
						status: 'loaded',
						instance_id: 'other-llm',
						load_config: {
							flash_attention: true,
							offload_kv_cache_to_gpu: true,
							eval_batch_size: 512,
							parallel: 2,
						},
					}), { status: 200 });
				}
				return new Response(JSON.stringify({
					choices: [{ message: { content: '{"ok":true}' } }],
				}), { status: 200 });
			},
		});
		await provider.chat({
			model: 'other-llm',
			messages: [{ role: 'user', content: 'hi' }],
		});
		assert.ok(urls.some((u) => u.includes('/models/unload')));
		assert.ok(urls.some((u) => u.includes('/models/load')));
	});

	it('ejects other loaded models before loading the preferred one', async () => {
		let loads = 0;
		const urls:string[] = [];
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			load: { parallel: 2 },
			fetch: async (input, init) => {
				const url = String(input);
				urls.push(`${init?.method ?? 'GET'} ${url}`);
				if (url.endsWith('/api/v1/models') && init?.method !== 'POST') {
					return new Response(JSON.stringify({
						models: [{
							key: 'google/gemma-4-26b-a4b-qat',
							type: 'llm',
							loaded_instances: [{
								id: 'google/gemma-4-26b-a4b-qat',
								config: { flash_attention: true, offload_kv_cache_to_gpu: true },
							}],
						}, {
							key: 'other-llm',
							type: 'llm',
							loaded_instances: [],
						}],
					}), { status: 200 });
				}
				if (url.includes('/api/v1/models/unload')) {
					const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
					assert.equal(body.instance_id, 'google/gemma-4-26b-a4b-qat');
					return new Response(JSON.stringify({ instance_id: body.instance_id }), { status: 200 });
				}
				if (url.includes('/api/v1/models/load')) {
					loads += 1;
					return new Response(JSON.stringify({
						status: 'loaded',
						instance_id: 'other-llm',
					}), { status: 200 });
				}
				return new Response(JSON.stringify({
					choices: [{ message: { content: '{"ok":true}' } }],
				}), { status: 200 });
			},
		});
		await provider.chat({
			model: 'other-llm',
			messages: [{ role: 'user', content: 'hi' }],
		});
		assert.equal(loads, 1);
		const unloadAt = urls.findIndex((u) => u.includes('/models/unload'));
		const loadAt = urls.findIndex((u) => u.includes('/models/load'));
		assert.ok(unloadAt >= 0 && loadAt > unloadAt);
	});

	it('ejects other loaded models after any failed preferred load, not only VRAM-worded errors', async () => {
		let loads = 0;
		const urls:string[] = [];
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async (input, init) => {
				const url = String(input);
				urls.push(`${init?.method ?? 'GET'} ${url}`);
				if (url.endsWith('/api/v1/models') && init?.method !== 'POST') {
					return new Response(JSON.stringify({
						models: [{
							key: 'google/gemma-4-26b-a4b-qat',
							type: 'llm',
							loaded_instances: [{ id: 'google/gemma-4-26b-a4b-qat', config: {} }],
						}, {
							key: 'google/gemma-4-31b-qat',
							type: 'llm',
							loaded_instances: [],
						}],
					}), { status: 200 });
				}
				if (url.includes('/api/v1/models/unload')) {
					return new Response(JSON.stringify({
						instance_id: JSON.parse(String(init?.body)).instance_id,
					}), { status: 200 });
				}
				if (url.includes('/api/v1/models/load')) {
					loads += 1;
					if (loads === 1) {
						return new Response(JSON.stringify({
							error: { message: 'failed to load model' },
						}), { status: 400 });
					}
					return new Response(JSON.stringify({
						status: 'loaded',
						instance_id: 'google/gemma-4-31b-qat',
					}), { status: 200 });
				}
				return new Response(JSON.stringify({
					choices: [{ message: { content: '{"ok":true}' } }],
				}), { status: 200 });
			},
		});
		await provider.chat({
			model: 'google/gemma-4-31b-qat',
			messages: [{ role: 'user', content: 'hi' }],
		});
		assert.equal(loads, 2);
		assert.ok(urls.some((u) => u.includes('/models/unload')));
	});

	it('unloads extra copies of the preferred model and keeps one', async () => {
		const unloaded:string[] = [];
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async (input, init) => {
				const url = String(input);
				if (url.endsWith('/api/v1/models') && init?.method !== 'POST') {
					return new Response(JSON.stringify({
						models: [{
							key: 'google/gemma-4-31b-qat',
							type: 'llm',
							loaded_instances: [
								{ id: 'google/gemma-4-31b-qat', config: { flash_attention: true } },
								{ id: 'google/gemma-4-31b-qat-2', config: { flash_attention: true } },
								{ id: 'google/gemma-4-31b-qat-3', config: { flash_attention: true } },
								{ id: 'google/gemma-4-31b-qat-4', config: { flash_attention: true } },
							],
						}],
					}), { status: 200 });
				}
				if (url.includes('/api/v1/models/unload')) {
					unloaded.push(String(JSON.parse(String(init?.body)).instance_id));
					return new Response(JSON.stringify({ instance_id: unloaded.at(-1) }), { status: 200 });
				}
				if (url.includes('/api/v1/models/load')) {
					return new Response('should not load', { status: 500 });
				}
				return new Response(JSON.stringify({
					choices: [{ message: { content: '{"ok":true}' } }],
				}), { status: 200 });
			},
		});
		await provider.chat({
			model: 'google/gemma-4-31b-qat',
			messages: [{ role: 'user', content: 'hi' }],
		});
		assert.equal(unloaded.length, 3);
		assert.equal(unloaded.includes('google/gemma-4-31b-qat'), false);
	});

	it('loads one instance when four chats start together', async () => {
		let loads = 0;
		let loaded = false;
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async (input, init) => {
				const url = String(input);
				if (url.endsWith('/api/v1/models') && init?.method !== 'POST') {
					return new Response(JSON.stringify({
						models: [{
							key: 'google/gemma-4-26b-a4b-qat',
							type: 'llm',
							loaded_instances: loaded
								? [{
									id: 'google/gemma-4-26b-a4b-qat',
									config: {
										flash_attention: true,
										offload_kv_cache_to_gpu: true,
										eval_batch_size: 512,
									},
								}]
								: [],
						}],
					}), { status: 200 });
				}
				if (url.includes('/api/v1/models/load')) {
					loads += 1;
					await new Promise((resolve) => setTimeout(resolve, 40));
					loaded = true;
					return new Response(JSON.stringify({
						status: 'loaded',
						instance_id: 'google/gemma-4-26b-a4b-qat',
						load_config: {
							flash_attention: true,
							offload_kv_cache_to_gpu: true,
							eval_batch_size: 512,
						},
					}), { status: 200 });
				}
				if (url.includes('/models/unload')) {
					return new Response('should not unload', { status: 500 });
				}
				return new Response(JSON.stringify({
					choices: [{ message: { content: '{"ok":true}' } }],
				}), { status: 200 });
			},
		});
		await Promise.all([0, 1, 2, 3].map(() => provider.chat({
			model: 'google/gemma-4-26b-a4b-qat',
			messages: [{ role: 'user', content: 'hi' }],
		})));
		assert.equal(loads, 1);
	});

	it('does not JIT four copies when the load endpoint is missing', async () => {
		let startedWhileCold = 0;
		let cold = true;
		let completions = 0;
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async (input, init) => {
				const url = String(input);
				if (url.endsWith('/api/v1/models') && init?.method !== 'POST') {
					return new Response('no native catalog', { status: 404 });
				}
				if (cold) {
					startedWhileCold += 1;
				}
				await new Promise((resolve) => setTimeout(resolve, 30));
				cold = false;
				completions += 1;
				return new Response(JSON.stringify({
					choices: [{ message: { content: '{"ok":true}' } }],
				}), { status: 200 });
			},
		});
		await Promise.all([0, 1, 2, 3].map(() => provider.chat({
			model: 'google/gemma-4-26b-a4b-qat',
			messages: [{ role: 'user', content: 'hi' }],
		})));
		assert.equal(startedWhileCold, 1);
		assert.equal(completions, 4);
	});

	it('continues the longest cached thread with previous_response_id', async () => {
		let n = 0;
		const bodies:Record<string, unknown>[] = [];
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async (input, init) => {
				const url = String(input);
				if (url.endsWith('/api/v1/models') && init?.method !== 'POST') {
					return new Response(JSON.stringify({
						models: [{ key: 'guard', loaded_instances: [{ id: 'guard' }] }],
					}), { status: 200 });
				}
				if (url.includes('/responses')) {
					n += 1;
					bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
					if (n === 1) {
						return new Response(JSON.stringify({
							id: 'resp_1',
							output: [{
								type: 'function_call',
								call_id: 'c1',
								name: 'see_map',
								arguments: '{}',
							}],
							usage: { input_tokens_details: { cached_tokens: 0 } },
						}), { status: 200 });
					}
					return new Response(JSON.stringify({
						id: 'resp_2',
						output: [{
							type: 'message',
							content: [{ type: 'output_text', text: '{"head":{"verb":"wait"}}' }],
						}],
						usage: { input_tokens_details: { cached_tokens: 40 } },
						stats: { time_to_first_token_seconds: 0.25, generation_time: 0.1 },
					}), { status: 200 });
				}
				return new Response('nope', { status: 404 });
			},
		});
		const sys = { role: 'system' as const, content: 'You are Guard.' };
		const user = { role: 'user' as const, content: 'look' };
		const first = await provider.chat({
			model: 'guard',
			thread: 'Guard',
			messages: [sys, user],
			tools: [{
				name: 'see_map',
				description: 'map',
				parameters: { type: 'object', properties: {} },
			}],
		});
		assert.equal(first.toolCalls[0]?.name, 'see_map');
		assert.equal(bodies[0]?.['previous_response_id'], undefined);
		const second = await provider.chat({
			model: 'guard',
			thread: 'Guard',
			messages: [
				sys,
				user,
				{ role: 'assistant', content: null, toolCalls: first.toolCalls },
				{ role: 'tool', content: '{"ok":true}', toolCallID: first.toolCalls[0]?.id },
			],
			tools: [{
				name: 'see_map',
				description: 'map',
				parameters: { type: 'object', properties: {} },
			}],
			toolChoice: 'none',
		});
		assert.equal(bodies[1]?.['previous_response_id'], 'resp_1');
		const input = bodies[1]?.input as Array<{ type?:string }>;
		assert.equal(input[0]?.type, 'function_call_output');
		assert.equal(second.cachedTokens, 40);
		assert.equal(second.promptMs, 250);
		assert.equal(second.generateMs, 100);
		assert.match(String(second.content), /wait/);
	});

	it('measures context load from the first streamed output token', async () => {
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async (input, init) => {
				const url = String(input);
				if (url.endsWith('/api/v1/models') && init?.method !== 'POST') {
					return new Response(JSON.stringify({
						models: [{ key: 'guard', loaded_instances: [{ id: 'guard' }] }],
					}), { status: 200 });
				}
				if (url.includes('/responses')) {
					const stream = new ReadableStream({
						async start(controller) {
							const enc = new TextEncoder();
							controller.enqueue(enc.encode(
								'event: response.created\ndata: {"type":"response.created"}\n\n',
							));
							await new Promise((resolve) => {
								setTimeout(resolve, 45);
							});
							controller.enqueue(enc.encode(
								'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hi"}\n\n',
							));
							controller.enqueue(enc.encode(
								'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_s","output":[{"type":"message","content":[{"type":"output_text","text":"hi"}]}],"usage":{"input_tokens_details":{"cached_tokens":4}}}}\n\n',
							));
							controller.close();
						},
					});
					return new Response(stream, {
						status: 200,
						headers: { 'content-type': 'text/event-stream' },
					});
				}
				return new Response('nope', { status: 404 });
			},
		});
		const res = await provider.chat({
			model: 'guard',
			thread: 'Guard',
			messages: [{ role: 'user', content: 'hi' }],
		});
		assert.equal(res.content, 'hi');
		assert.equal(res.cachedTokens, 4);
		assert.ok((res.promptMs ?? 0) >= 40, `promptMs ${res.promptMs}`);
		assert.ok((res.generateMs ?? 0) >= 0);
		assert.ok((res.promptMs ?? 0) + (res.generateMs ?? 0) < 5000);
	});

	it('reads a completed Responses event that never got a trailing blank line', async () => {
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async (input, init) => {
				const url = String(input);
				if (url.endsWith('/api/v1/models') && init?.method !== 'POST') {
					return new Response(JSON.stringify({
						models: [{ key: 'guard', loaded_instances: [{ id: 'guard' }] }],
					}), { status: 200 });
				}
				if (url.includes('/responses')) {
					const stream = new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode(
								'event: response.completed\ndata: {"response":{"id":"resp_s","output":[{"type":"message","content":[{"type":"output_text","text":"hi"}]}]}}',
							));
							controller.close();
						},
					});
					return new Response(stream, {
						status: 200,
						headers: { 'content-type': 'text/event-stream' },
					});
				}
				return new Response('nope', { status: 404 });
			},
		});
		const res = await provider.chat({
			model: 'guard',
			messages: [{ role: 'user', content: 'hi' }],
		});
		assert.equal(res.content, 'hi');
	});

	it('treats response.incomplete as a finished payload', async () => {
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async (input, init) => {
				const url = String(input);
				if (url.endsWith('/api/v1/models') && init?.method !== 'POST') {
					return new Response(JSON.stringify({
						models: [{ key: 'guard', loaded_instances: [{ id: 'guard' }] }],
					}), { status: 200 });
				}
				if (url.includes('/responses')) {
					return new Response(
						'event: response.incomplete\ndata: {"type":"response.incomplete","response":{"id":"resp_i","status":"incomplete","output":[{"type":"message","content":[{"type":"output_text","text":"{\\"head\\":{\\"verb\\":\\"wait\\"}}"}]}]}}\n\n',
						{ status: 200, headers: { 'content-type': 'text/event-stream' } },
					);
				}
				return new Response('nope', { status: 404 });
			},
		});
		const res = await provider.chat({
			model: 'guard',
			messages: [{ role: 'user', content: 'hi' }],
		});
		assert.match(String(res.content), /wait/);
	});

	it('assembles Responses output from deltas when completed never arrives', async () => {
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async (input, init) => {
				const url = String(input);
				if (url.endsWith('/api/v1/models') && init?.method !== 'POST') {
					return new Response(JSON.stringify({
						models: [{ key: 'guard', loaded_instances: [{ id: 'guard' }] }],
					}), { status: 200 });
				}
				if (url.includes('/responses')) {
					return new Response(
						'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"{\\"ok\\":true}"}\n\n',
						{ status: 200, headers: { 'content-type': 'text/event-stream' } },
					);
				}
				return new Response('nope', { status: 404 });
			},
		});
		const res = await provider.chat({
			model: 'guard',
			messages: [{ role: 'user', content: 'hi' }],
		});
		assert.equal(res.content, '{"ok":true}');
	});

	it('reads a function call from output_item.done without response.completed', async () => {
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async (input, init) => {
				const url = String(input);
				if (url.endsWith('/api/v1/models') && init?.method !== 'POST') {
					return new Response(JSON.stringify({
						models: [{ key: 'guard', loaded_instances: [{ id: 'guard' }] }],
					}), { status: 200 });
				}
				if (url.includes('/responses')) {
					return new Response(
						'event: response.output_item.done\ndata: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"c1","name":"see_map","arguments":"{}"}}\n\n',
						{ status: 200, headers: { 'content-type': 'text/event-stream' } },
					);
				}
				return new Response('nope', { status: 404 });
			},
		});
		const res = await provider.chat({
			model: 'guard',
			thread: 'Guard',
			messages: [{ role: 'user', content: 'look' }],
			tools: [{
				name: 'see_map',
				description: 'map',
				parameters: { type: 'object', properties: {} },
			}],
		});
		assert.equal(res.toolCalls[0]?.name, 'see_map');
		assert.equal(res.toolCalls[0]?.id, 'c1');
	});

	it('merges streamed completions tool_call fragments', async () => {
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async (input) => {
				const url = String(input);
				if (url.endsWith('/api/v1/models')) {
					return new Response(JSON.stringify({
						models: [{ key: 'guard', loaded_instances: [{ id: 'guard' }] }],
					}), { status: 200 });
				}
				if (url.includes('/responses')) {
					return new Response('nope', { status: 404 });
				}
				const stream = new ReadableStream({
					start(controller) {
						const enc = new TextEncoder();
						controller.enqueue(enc.encode(
							'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"see_map","arguments":""}}]}}]}\n\n',
						));
						controller.enqueue(enc.encode(
							'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"zoom\\":1}"}}]}}]}\n\n',
						));
						controller.enqueue(enc.encode(
							'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
						));
						controller.enqueue(enc.encode('data: [DONE]\n\n'));
						controller.close();
					},
				});
				return new Response(stream, {
					status: 200,
					headers: { 'content-type': 'text/event-stream' },
				});
			},
		});
		const res = await provider.chat({
			model: 'guard',
			messages: [{ role: 'user', content: 'look' }],
			tools: [{
				name: 'see_map',
				description: 'map',
				parameters: { type: 'object', properties: {} },
			}],
		});
		assert.equal(res.toolCalls[0]?.name, 'see_map');
		assert.equal(res.toolCalls[0]?.id, 'call_1');
		assert.equal(res.toolCalls[0]?.arguments, '{"zoom":1}');
	});

	it('retries responses without streaming when the SSE body is empty', async () => {
		let n = 0;
		const bodies:Record<string, unknown>[] = [];
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async (input, init) => {
				const url = String(input);
				if (url.endsWith('/api/v1/models') && init?.method !== 'POST') {
					return new Response(JSON.stringify({
						models: [{ key: 'guard', loaded_instances: [{ id: 'guard' }] }],
					}), { status: 200 });
				}
				if (url.includes('/responses')) {
					n += 1;
					bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
					if (n === 1) {
						return new Response(
							'event: response.created\ndata: {"type":"response.created"}\n\n',
							{ status: 200, headers: { 'content-type': 'text/event-stream' } },
						);
					}
					assert.equal(bodies[1]?.stream, false);
					return new Response(JSON.stringify({
						id: 'resp_2',
						output: [{
							type: 'message',
							content: [{ type: 'output_text', text: 'hi' }],
						}],
					}), { status: 200 });
				}
				return new Response('nope', { status: 404 });
			},
		});
		const res = await provider.chat({
			model: 'guard',
			messages: [{ role: 'user', content: 'hi' }],
		});
		assert.equal(res.content, 'hi');
		assert.equal(n, 2);
	});

	it('surfaces a Responses stream error', async () => {
		let n = 0;
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async (input, init) => {
				const url = String(input);
				if (url.endsWith('/api/v1/models') && init?.method !== 'POST') {
					return new Response(JSON.stringify({
						models: [{ key: 'guard', loaded_instances: [{ id: 'guard' }] }],
					}), { status: 200 });
				}
				if (url.includes('/responses')) {
					n += 1;
					if (n === 1) {
						return new Response(JSON.stringify({
							id: 'resp_1',
							output: [{
								type: 'message',
								content: [{ type: 'output_text', text: 'ok' }],
							}],
						}), { status: 200 });
					}
					return new Response(
						'event: error\ndata: {"type":"error","error":{"message":"image too large"}}\n\n',
						{ status: 200, headers: { 'content-type': 'text/event-stream' } },
					);
				}
				return new Response('nope', { status: 404 });
			},
		});
		await provider.chat({
			model: 'guard',
			messages: [{ role: 'user', content: 'hi' }],
		});
		await assert.rejects(
			() => provider.chat({
				model: 'guard',
				messages: [{ role: 'user', content: 'hi' }],
			}),
			/image too large/,
		);
	});
});

describe('loadConfigFits', () => {
	it('accepts a larger parallel and batch than requested', () => {
		assert.equal(loadConfigFits({
			flash_attention: true,
			offload_kv_cache_to_gpu: true,
			eval_batch_size: 1024,
			parallel: 4,
		}, { parallel: 2, evalBatchSize: 512 }), true);
	});

	it('rejects missing flash attention or too-small parallel', () => {
		assert.equal(loadConfigFits({
			flash_attention: false,
			offload_kv_cache_to_gpu: true,
			parallel: 4,
		}, { parallel: 2 }), false);
		assert.equal(loadConfigFits({
			flash_attention: true,
			offload_kv_cache_to_gpu: true,
			parallel: 1,
		}, { parallel: 2 }), false);
	});

	it('accepts only the configured context length', () => {
		assert.equal(loadConfigFits({
			flash_attention: true,
			offload_kv_cache_to_gpu: true,
			context_length: 4096,
		}, { contextLength: 8192 }), false);
		assert.equal(loadConfigFits({
			flash_attention: true,
			offload_kv_cache_to_gpu: true,
			context_length: 16384,
		}, { contextLength: 8192 }), false);
		assert.equal(loadConfigFits({
			flash_attention: true,
			offload_kv_cache_to_gpu: true,
			context_length: 8192,
		}, { contextLength: 8192 }), true);
		assert.equal(loadConfigFits({
			flash_attention: true,
			offload_kv_cache_to_gpu: true,
		}, { contextLength: 8192 }), true);
	});
});

describe('parseChatTimings', () => {
	it('reads LM Studio chat completions stats in seconds', () => {
		const t = parseChatTimings({
			stats: { time_to_first_token: 1.2, generation_time: 0.4 },
			usage: { prompt_tokens_details: { cached_tokens: 80 } },
		});
		assert.equal(t.promptMs, 1200);
		assert.equal(t.generateMs, 400);
		assert.equal(t.cachedTokens, 80);
	});

	it('reads native responses stats in seconds', () => {
		const t = parseChatTimings({
			stats: { time_to_first_token_seconds: 0.5, tokens_per_second: 30 },
		});
		assert.equal(t.promptMs, 500);
		assert.equal(t.generateMs, undefined);
	});

	it('reads llama.cpp timings in milliseconds', () => {
		const t = parseChatTimings({
			timings: { prompt_ms: 90, predicted_ms: 210 },
		});
		assert.equal(t.promptMs, 90);
		assert.equal(t.generateMs, 210);
	});
});

describe('reply cleanup', () => {
	function providerFor(payload:unknown):HttpProvider {
		return new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async (input, init) => {
				const url = String(input);
				if (init?.method !== 'POST' || url.includes('/responses')) {
					return new Response('nope', { status: 404 });
				}
				return new Response(JSON.stringify(payload), { status: 200 });
			},
		});
	}

	it('strips leaked chat-template tokens and leaves watch operators alone', () => {
		assert.equal(
			stripTemplateTokens('think(pay the fee)<tool_call|>use(item=BridgeCrank, target=BridgeLever) <|thought'),
			'think(pay the fee)use(item=BridgeCrank, target=BridgeLever)',
		);
		assert.equal(stripTemplateTokens('<|channel|>go_to(Keep)<|end>'), 'go_to(Keep)');
		assert.equal(stripTemplateTokens('wait(until=a<b||c>d)'), 'wait(until=a<b||c>d)');
		assert.equal(stripTemplateTokens('<|eot|>'), null);
	});

	it('cleans chat content and flags a reply that hit the token cap', async () => {
		const cut = await providerFor({
			choices: [{ message: { content: 'go_to(Keep<|thought' }, finish_reason: 'length' }],
		}).chat({ model: 'guard', messages: [{ role: 'user', content: 'go' }] });
		assert.equal(cut.content, 'go_to(Keep');
		assert.equal(cut.truncated, true);
		const whole = await providerFor({
			choices: [{ message: { content: 'go_to(Keep)' }, finish_reason: 'stop' }],
		}).chat({ model: 'guard', messages: [{ role: 'user', content: 'go' }] });
		assert.equal(whole.truncated, false);
	});
});

describe('response format', () => {
	const format = { name: 'arc', schema: { type: 'object' }, strict: true };

	it('sends the schema on chat completions only when asked', async () => {
		const body = await captureBody({}, 'other-llm', undefined, { responseFormat: format });
		assert.deepEqual(body.response_format, { type: 'json_schema', json_schema: format });
		const plain = await captureBody({}, 'other-llm');
		assert.equal('response_format' in plain, false);
	});

	it('skips the think prefill when a schema grammar would have to accept it', async () => {
		const model = idWithThinkOff('no_think');
		const body = await captureBody({}, model, undefined, { responseFormat: format });
		const messages = body.messages as Array<{ role?:string; content?:string }>;
		assert.equal(messages.at(-1)?.role, 'user');
		assert.equal(messages.some((message) => message.content?.includes('<')), false);
		assert.match(String(messages.find((message) => message.role === 'system')?.content), /\/no_think/);
	});

	it('sends a schema to chat completions even where the responses API is up, which ignores it', async () => {
		const urls:string[] = [];
		let body:Record<string, unknown> | undefined;
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async (input, init) => {
				const url = String(input);
				if (url.endsWith('/api/v1/models') && init?.method !== 'POST') {
					return new Response(JSON.stringify(catalogWithReasoning('m', [])), { status: 200 });
				}
				urls.push(url);
				body = JSON.parse(String(init?.body)) as Record<string, unknown>;
				return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200 });
			},
		});
		await provider.chat({ model: 'm', messages: [{ role: 'user', content: 'pong' }], responseFormat: format });
		assert.deepEqual(urls.filter((url) => /responses|completions/.test(url)), ['http://127.0.0.1:9/v1/chat/completions']);
		assert.deepEqual(body?.response_format, { type: 'json_schema', json_schema: format });
	});

	it('does not count the schema as prompt when clamping max_tokens to the slot', async () => {
		const catalog = { models: [{ key: 'm', loaded_instances: [{ id: 'm', config: { context_length: 4096 } }] }] };
		const maxTokens = (responseFormat:typeof format) => captureBody({}, 'm', catalog, { maxTokens: 4096, responseFormat });
		const big = { ...format, schema: { type: 'object', description: 'x'.repeat(10_000) } };
		assert.equal((await maxTokens(big))['max_tokens'], (await maxTokens(format))['max_tokens']);
	});
});

describe('System One', () => {
	it('asks Jev one choice question and reads its answer', async () => {
		let sent:{ url:string; body:unknown } | undefined;
		const jev = new JevSystemOne({
			baseURL: '/systemone',
			model: 'jev-latest',
			fetch: async (input, init) => {
				sent = { url: String(input), body: JSON.parse(String(init?.body)) };
				return new Response(JSON.stringify({
					model: 'jev-1.13.0',
					answers: { pick: { type: 'choice', choice: 'slash', probabilities: { hold: 0.2, slash: 0.8 }, confidence: 0.8 } },
				}), { status: 200 });
			},
		});
		const name = await jev.pick('Raider: 3 away', 'hold the gate', { hold: 'wait()', slash: 'slash(Raider)' });
		assert.equal(name, 'slash');
		assert.deepEqual(sent, {
			url: '/systemone',
			body: {
				state: 'Raider: 3 away',
				model: 'jev-latest',
				questions: { pick: { type: 'choice', instructions: 'hold the gate', criteria: { hold: 'wait()', slash: 'slash(Raider)' } } },
			},
		});
	});

	it('asks in OpenAI\'s Decisions format where the endpoint is /decisions', async () => {
		let body:unknown;
		const decisions = new JevSystemOne({
			baseURL: 'http://127.0.0.1:9/v1/decisions',
			model: 'laya',
			fetch: async (_input, init) => {
				body = JSON.parse(String(init?.body));
				return new Response(JSON.stringify({ answers: [{ type: 'choice', name: 'pick', choice: 'slash' }] }), { status: 200 });
			},
		});
		assert.equal(await decisions.pick('Raider: 3 away', 'hold the gate', { hold: 'wait()', slash: 'slash(Raider)' }), 'slash');
		assert.deepEqual(body, {
			model: 'laya',
			input: 'Raider: 3 away',
			questions: [{
				type: 'choice',
				name: 'pick',
				instructions: 'hold the gate',
				choices: [{ value: 'hold', description: 'wait()' }, { value: 'slash', description: 'slash(Raider)' }],
			}],
		});
	});

	it('asks a decision model through its System One endpoint, and a chat model by scoring', async () => {
		const chats:string[] = [];
		const provider = { chat: async (req:ChatRequest) => {
			chats.push(req.model);
			return { content: 'B', toolCalls: [] };
		} };
		let model:{ provider:typeof provider; id:string; systemOneURL?:string } = { provider, id: 'gemma' };
		const systemOne = new ModelSystemOne(() => model);
		assert.equal(await systemOne.pick('s', 'g', { hold: 'wait()', slash: 'slash(Raider)' }), 'slash');
		assert.deepEqual(chats, ['gemma']);
		const realFetch = globalThis.fetch;
		const urls:string[] = [];
		globalThis.fetch = async (input) => {
			urls.push(String(input));
			return new Response(JSON.stringify({ answers: { pick: { choice: 'hold' } } }), { status: 200 });
		};
		try {
			model = { provider, id: 'laya', systemOneURL: 'http://127.0.0.1:9/v1/systemone' };
			assert.equal(await systemOne.pick('s', 'g', { hold: 'wait()', slash: 'slash(Raider)' }), 'hold');
		}
		finally {
			globalThis.fetch = realFetch;
		}
		assert.deepEqual(urls, ['http://127.0.0.1:9/v1/systemone']);
		assert.deepEqual(chats, ['gemma'], 'the decision model never chats');
	});

	it('throws when Jev fails', async () => {
		const jev = new JevSystemOne({ baseURL: '/systemone', model: 'm', fetch: async () => new Response('no key', { status: 503 }) });
		await assert.rejects(jev.pick('', 'g', { a: 'wait()' }), /503/);
	});

	it('asks a chat model for one lettered option and takes the best-scored declared letter', async () => {
		const seen:ChatRequest[] = [];
		const chat = new ChatSystemOne(() => ({
			chat: async (req) => {
				seen.push(req);
				return { content: 'A', toolCalls: [], logprobs: { A: -1.2, B: -0.4, C: -0.1 } };
			},
		}), () => 'gemma');
		assert.equal(await chat.pick('state', 'hold the gate', { hold: 'wait()', slash: 'slash(Raider)' }), 'slash', 'C is no option');
		assert.equal(seen[0].model, 'gemma');
		assert.match(String(seen[0].messages[1].content), /Options:\nA\. wait\(\)\nB\. slash\(Raider\)/);
		assert.equal(seen[0].maxTokens, 1);
		assert.equal(seen[0].enableThinking, false);
		assert.ok(seen[0].topLogprobs);
	});

	it('reads the letter a chat model answered where the server returns no log probabilities', async () => {
		const chat = new ChatSystemOne(() => ({ chat: async () => ({ content: ' B', toolCalls: [] }) }), () => 'm');
		assert.equal(await chat.pick('state', 'hold the gate', { hold: 'wait()', slash: 'slash(Raider)' }), 'slash');
	});

	it('reads the first answer token\'s log probabilities from responses and from chat completions, unstreamed', async () => {
		const top = [{ token: ' A', logprob: -2 }, { token: 'B', logprob: -0.1 }];
		for (const responses of [true, false]) {
			let body:Record<string, unknown> | undefined;
			const provider = new HttpProvider({
				baseURL: 'http://127.0.0.1:9/v1',
				fetch: async (input, init) => {
					const url = String(input);
					if (url.endsWith('/api/v1/models') && init?.method !== 'POST') {
						return new Response(JSON.stringify(catalogWithReasoning('m', [])), { status: responses ? 200 : 404 });
					}
					body = JSON.parse(String(init?.body)) as Record<string, unknown>;
					const tokens = [{ token: 'B', logprob: -0.1, top_logprobs: top }];
					return new Response(JSON.stringify(url.endsWith('/responses')
						? { output: [{ type: 'message', content: [{ type: 'output_text', text: 'B', logprobs: tokens }] }] }
						: { choices: [{ message: { content: 'B' }, logprobs: { content: tokens } }] }), { status: 200 });
				},
			});
			const res = await provider.chat({ model: 'm', messages: [{ role: 'user', content: 'pick' }], topLogprobs: 5 });
			assert.deepEqual(res.logprobs, { A: -2, B: -0.1 });
			assert.equal(body?.stream, false);
			assert.equal(body?.top_logprobs, 5);
			assert.deepEqual(responses ? body?.include : body?.logprobs, responses ? ['message.output_text.logprobs'] : true);
		}
	});
});

describe('configured models', () => {
	/** A server with `gemma` loaded at 4096 and `laya` on disk; records every load and unload. */
	function server():{ provider:HttpProvider; posts:{ path:string; body:Record<string, unknown> }[] } {
		const posts:{ path:string; body:Record<string, unknown> }[] = [];
		const loaded = [{ key: 'gemma', loaded_instances: [{ id: 'gemma', config: { context_length: 4096 } }] }, { key: 'laya', loaded_instances: [] as unknown[] }];
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async (input, init) => {
				const url = String(input);
				if (url.endsWith('/api/v1/models') && init?.method !== 'POST') {
					return new Response(JSON.stringify({ models: loaded }), { status: 200 });
				}
				const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
				posts.push({ path: url.replace(/^.*\/api\/v1\/models\//, ''), body });
				if (url.endsWith('/load')) {
					loaded[1].loaded_instances = [{ id: 'laya', config: { context_length: body.context_length } }];
					return new Response(JSON.stringify({ instance_id: 'laya', load_config: { context_length: body.context_length } }), { status: 200 });
				}
				return new Response('{}', { status: 200 });
			},
		});
		return { provider, posts };
	}

	it('loads a second configured model beside the first, each with its own context', async () => {
		const { provider, posts } = server();
		provider.configureModel('gemma', { contextLength: 4096 });
		provider.configureModel('laya', { contextLength: 2048 });
		await provider.ensureLoaded('laya');
		assert.deepEqual(posts.map((p) => p.path), ['load']);
		assert.equal(posts[0].body.model, 'laya');
		assert.equal(posts[0].body.context_length, 2048);
	});

	it('unloads a model that is not configured to make room', async () => {
		const { provider, posts } = server();
		provider.configureModel('laya', {});
		await provider.ensureLoaded('laya');
		assert.deepEqual(posts.map((p) => p.path), ['unload', 'load']);
	});

	it('reloads an idle instance onto the configured context', async () => {
		const posts:{ path:string; context?:number }[] = [];
		let context = 16384;
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async (input, init) => {
				const url = String(input);
				if (url.endsWith('/api/v1/models') && init?.method !== 'POST') {
					const models = [{ key: 'npc', max_context_length: 131072, loaded_instances: context ? [{ id: 'npc', config: { context_length: context } }] : [] }];
					return new Response(JSON.stringify({ models }), { status: 200 });
				}
				const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
				const path = url.replace(/^.*\/api\/v1\/models\//, '');
				posts.push(typeof body.context_length === 'number' ? { path, context: body.context_length } : { path });
				if (path === 'unload') {
					context = 0;
				}
				if (path === 'load') {
					context = Number(body.context_length);
					return new Response(JSON.stringify({ instance_id: 'npc', load_config: { context_length: context } }), { status: 200 });
				}
				return new Response('{}', { status: 200 });
			},
		});
		provider.configureModel('npc', { contextLength: 8192 });
		await provider.ensureLoaded('npc');
		assert.deepEqual(posts, [{ path: 'unload' }, { path: 'load', context: 8192 }]);
	});

	it('keeps the configured context and unloads a larger idle copy', async () => {
		const unloaded:string[] = [];
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async (input, init) => {
				const url = String(input);
				if (url.endsWith('/api/v1/models') && init?.method !== 'POST') {
					return new Response(JSON.stringify({
						models: [{
							key: 'npc',
							loaded_instances: [
								{ id: 'npc', config: { context_length: 8192, flash_attention: true } },
								{ id: 'npc:2', config: { context_length: 65536, flash_attention: true } },
							],
						}],
					}), { status: 200 });
				}
				if (url.includes('/models/unload')) {
					unloaded.push(String(JSON.parse(String(init?.body)).instance_id));
					return new Response(JSON.stringify({ instance_id: unloaded.at(-1) }), { status: 200 });
				}
				return new Response('should not load', { status: 500 });
			},
		});
		provider.configureModel('npc', { contextLength: 8192 });
		await provider.ensureLoaded('npc');
		assert.deepEqual(unloaded, ['npc:2']);
	});

	it('does not unload a different context while a chat is in flight', async () => {
		let context = 8192;
		let chats = 0;
		let release:()=>void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const unloaded:string[] = [];
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async (input, init) => {
				const url = String(input);
				if (url.endsWith('/api/v1/models') && init?.method !== 'POST') {
					return new Response(JSON.stringify({
						models: [{
							key: 'npc',
							max_context_length: 131072,
							loaded_instances: [{ id: 'npc', config: { context_length: context, flash_attention: true, offload_kv_cache_to_gpu: true, eval_batch_size: 512 } }],
						}],
					}), { status: 200 });
				}
				if (url.includes('/models/unload')) {
					unloaded.push(String(JSON.parse(String(init?.body)).instance_id));
					context = 0;
					return new Response(JSON.stringify({ instance_id: 'npc' }), { status: 200 });
				}
				if (url.includes('/models/load')) {
					context = Number(JSON.parse(String(init?.body)).context_length);
					return new Response(JSON.stringify({ instance_id: 'npc', load_config: { context_length: context } }), { status: 200 });
				}
				chats += 1;
				await gate;
				return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
			},
		});
		provider.configureModel('npc', { contextLength: 8192 });
		const first = provider.chat({ model: 'npc', messages: [{ role: 'user', content: 'hi' }] });
		while (chats < 1) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		provider.configureModel('npc', { contextLength: 65536 });
		const second = provider.chat({ model: 'npc', messages: [{ role: 'user', content: 'next' }] });
		while (chats < 2) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		assert.deepEqual(unloaded, []);
		release();
		await Promise.all([first, second]);
		await provider.ensureLoaded('npc');
		assert.deepEqual(unloaded, ['npc']);
	});

	it('keeps a model loaded at the most context it takes when more is asked for', async () => {
		const posts:string[] = [];
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async (input, init) => {
				const url = String(input);
				if (url.endsWith('/api/v1/models') && init?.method !== 'POST') {
					const models = [{ key: 'npc', max_context_length: 4096, loaded_instances: [{ id: 'npc', config: { context_length: 4096 } }] }];
					return new Response(JSON.stringify({ models }), { status: 200 });
				}
				posts.push(url.replace(/^.*\/api\/v1\/models\//, ''));
				return new Response('{}', { status: 200 });
			},
		});
		provider.configureModel('npc', { contextLength: 16384 });
		await provider.ensureLoaded('npc');
		await provider.ensureLoaded('npc');
		assert.deepEqual(posts, [], 'a 4k model never fits a 16k ask exactly: it must not reload on every request');
	});
});

describe('HttpProvider thinking budget', () => {
	/** A streamed chat completion: these thought pieces, then these answer pieces. Reports whether the reader stopped it. */
	function streamOf(thought:string[], answer:string[]):{ res:()=>Response; cancelled:()=>boolean } {
		let cancelled = false;
		const events = [
			...thought.map((piece) => ({ choices: [{ delta: { reasoning_content: piece } }] })),
			...answer.map((piece) => ({ choices: [{ delta: { content: piece } }] })),
			{ choices: [{ delta: {}, finish_reason: 'stop' }] },
		];
		return {
			res: () => new Response(new ReadableStream<Uint8Array>({
				pull(controller) {
					const ev = events.shift();
					if (ev) {
						controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(ev)}\n\n`));
					}
					else {
						controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
						controller.close();
					}
				},
				cancel() {
					cancelled = true;
				},
			}), { status: 200, headers: { 'content-type': 'text/event-stream' } }),
			cancelled: () => cancelled,
		};
	}

	function providerFor(stream:ReturnType<typeof streamOf>, budget:number):HttpProvider {
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			enableThinking: true,
			fetch: async (input) => {
				const url = String(input);
				if (url.endsWith('/models')) {
					return new Response(JSON.stringify({ data: [] }), { status: 200 });
				}
				if (url.includes('/responses')) {
					return new Response('nope', { status: 404 });
				}
				return stream.res();
			},
		});
		provider.configureModel('thinker', { thinkingBudget: budget });
		return provider;
	}

	it('stops a thought at its budget and hands it back for an answer', async () => {
		const stream = streamOf(['The ', 'guard ', 'should ', 'go ', 'to ', 'the ', 'Keep ', 'and '], ['{"steps":[]}']);
		const res = await providerFor(stream, 3).chat({ model: 'thinker', messages: [{ role: 'user', content: 'hi' }] });
		assert.equal(res.truncated, true);
		assert.equal(res.content, null);
		assert.match(res.reasoning ?? '', /^The guard should go/);
		assert.equal(stream.cancelled(), true, 'the server stops generating');
	});

	it('leaves a thought that ends within its budget alone', async () => {
		const stream = streamOf(['Go ', 'to ', 'the Keep.'], ['{"steps"', ':[]}']);
		const res = await providerFor(stream, 8).chat({ model: 'thinker', messages: [{ role: 'user', content: 'hi' }] });
		assert.equal(res.content, '{"steps":[]}');
		assert.equal(res.truncated, false);
		assert.equal(stream.cancelled(), false);
	});
});
