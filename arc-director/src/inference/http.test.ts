import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MODEL_TIERS, type ThinkOff } from './models.js';
import { HttpProvider, loadConfigFits, parseChatTimings } from './http.js';
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
	extra?:{ enableThinking?:boolean; fakeThought?:boolean },
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
		assert.equal(body.reasoning, 'on');
		assert.equal(body['max_tokens'], 512);
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
		assert.equal(bodies[0]?.reasoning, 'on');
		assert.equal(bodies[0]?.['max_tokens'], 512);
		assert.equal(bodies[1]?.reasoning, 'off');
		assert.equal(bodies[1]?.['max_tokens'], 256);
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
		assert.equal(body.reasoning, undefined);
	});

	it('sends reasoning low when the listed model allows low', async () => {
		const model = idWithThinkOff('strength');
		const body = await captureBody({
			enableThinking: true,
			maxTokens: 384,
		}, model, catalogWithReasoning(model, ['off', 'on', 'low', 'medium', 'high']));
		assert.equal(body.reasoning, 'low');
		assert.equal(body['reasoning_effort'], 'low');
		assert.equal(body['enable_thinking'], undefined);
		assert.deepEqual(body['chat_template_kwargs'], { reasoning_strength: 'low' });
	});

	it('sends reasoning off when thinking is off and off is allowed', async () => {
		const model = idWithThinkOff('strength');
		const body = await captureBody({
			maxTokens: 384,
		}, model, catalogWithReasoning(model, ['off', 'on', 'low', 'medium', 'high']));
		assert.equal(body.reasoning, 'off');
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
		assert.equal(body.reasoning, 'low');
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
		assert.equal(body.reasoning, 'off');
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
		assert.equal(body.reasoning, 'low');
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
		assert.equal(body.reasoning, 'on');
	});

	it('does not send reasoning off when the model only allows on', async () => {
		const model = 'deepseek-r1';
		const body = await captureBody({
			maxTokens: 384,
		}, model, catalogWithReasoning(model, ['on']));
		assert.equal(body.reasoning, undefined);
	});

	it('sends reasoning low on the responses API when the catalog allows it', async () => {
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
		assert.equal(body.reasoning, 'low');
	});

	it('puts /no_think on the system message, not image user parts', async () => {
		let body:Record<string, unknown> | undefined;
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async (_input, init) => {
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
