import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MODEL_TIERS, type ThinkOff } from './models.js';
import { HttpProvider, loadConfigFits, parseChatTimings, type ModelSettings } from './http.js';
import { cleanThought, loops, stripTemplateTokens } from './wire-formats.js';
import { ChatSystemOne, JevSystemOne, ModelSystemOne } from './system-one.js';
import type { ChatDelta, ChatRequest } from './provider.js';
import { PREFILL_MARKER, clearAssistantThinkCache } from './assistant-think.js';

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

	it("samples as the model says, else by the default, and a request may override it", async () => {
		const bodies:Record<string, unknown>[] = [];
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async (input, init) => {
				if (String(input).includes('/models') || String(input).includes('/responses')) {
					return new Response('nope', { status: 404 });
				}
				bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
				return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
			},
		});
		provider.configureModel('gemma', { sampling: { temperature: 1, topK: 64, topP: 0.95 } });
		const ask = (model:string, req?:Partial<ChatRequest>) => provider.chat({ model, messages: [{ role: 'user', content: 'hi' }], ...req });
		await ask('other');
		await ask('gemma');
		await ask('gemma', { sampling: { temperature: 0 } });
		const sampled = bodies.map((b) => [b['temperature'], b['top_p'], b['top_k']]);
		assert.deepEqual(sampled, [[1, 0.95, undefined], [1, 0.95, 64], [0, 0.95, 64]]);
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
		assert.equal(messages.at(-1)?.content, '<think>\n\n</think>\n\n');
	});

	it('reports the prepared body before the HTTP send', async () => {
		const order:string[] = [];
		let logged:Record<string, unknown> | undefined;
		const model = idWithThinkOff('strength');
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
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
			onRequest: ({ body, path }) => {
				order.push('request');
				logged = body;
				assert.match(path, /chat\/completions$/);
			},
		});
		assert.deepEqual(order, ['request', 'fetch']);
		const messages = logged?.messages as Array<{ role?:string; content?:string }>;
		assert.equal(messages.at(-1)?.role, 'assistant');
		assert.equal(messages.at(-1)?.content, '<|channel|>analysis<|message|><|end|>');
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

	it('asks an unlisted model for its default effort, or none, rather than leaving it out', async () => {
		const model = idWithThinkOff('strength');
		const body = await captureBody({
			enableThinking: true,
			maxTokens: 384,
		}, model);
		assert.equal(body['reasoning_effort'], 'medium');
		assert.equal((await captureBody({}, model))['reasoning_effort'], 'none');
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
		assert.equal(messages.at(-1)?.content, '<|channel|>analysis<|message|><|end|>');
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

	it('turns thinking off for one request even when the provider has it on', async () => {
		const model = idWithThinkOff('strength');
		const body = await captureBody({
			enableThinking: true,
			maxTokens: 384,
		}, model, catalogWithReasoning(model, ['off', 'on', 'low', 'medium', 'high']), { enableThinking: false });
		assert.equal(body['reasoning_effort'], 'none');
		const messages = body.messages as Array<{ role?:string; content?:string }>;
		assert.equal(messages.at(-1)?.role, 'assistant');
		assert.equal(messages.at(-1)?.content, '<|channel|>analysis<|message|><|end|>');
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
		assert.equal(messages.at(-1)?.content, '<think>\n\n</think>\n\n');
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

	it('loads a model with as many slots as it thinks at once, again when a copy loaded earlier has fewer', async () => {
		const bodies:Record<string, unknown>[] = [];
		const urls:string[] = [];
		let loaded:Record<string, unknown> = { flash_attention: true, offload_kv_cache_to_gpu: true, eval_batch_size: 512, parallel: 1 };
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async (input, init) => {
				const url = String(input);
				urls.push(url);
				if (url.endsWith('/api/v1/models') && init?.method !== 'POST') {
					return new Response(JSON.stringify({
						models: [{ key: 'my-llm', type: 'llm', loaded_instances: [{ id: 'my-llm', config: loaded }] }],
					}), { status: 200 });
				}
				if (url.includes('/api/v1/models/unload')) {
					return new Response(JSON.stringify({ instance_id: 'my-llm' }), { status: 200 });
				}
				if (url.includes('/api/v1/models/load')) {
					const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
					bodies.push(body);
					// This server gives a model three slots at most.
					loaded = { ...loaded, parallel: Math.min(Number(body.parallel), 3) };
					return new Response(JSON.stringify({ status: 'loaded', instance_id: 'my-llm', load_config: loaded }), { status: 200 });
				}
				return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
			},
		});
		provider.configureModel('my-llm', { maxParallel: 4 });
		await provider.chat({ model: 'my-llm', messages: [{ role: 'user', content: 'hi' }] });
		assert.ok(urls.some((u) => u.includes('/models/unload')), 'the copy with one slot goes');
		assert.equal(bodies[0]?.parallel, 4);
		await provider.chat({ model: 'my-llm', messages: [{ role: 'user', content: 'hi' }] });
		assert.equal(bodies.length, 1, 'given fewer than it asked for, it keeps what it got rather than loading again');
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
		assert.deepEqual(bodies.map((body) => body.reasoning), [{ effort: 'none' }, { effort: 'none' }], 'every turn says its effort, a model the catalog lists no options for too');
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

	it('reads a stream that opens with keepalive comments, as a server that thinks long sends', async () => {
		const chunk = (delta:Record<string, unknown>, finish:string | null = null):string => `data: ${JSON.stringify({ object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}

`;
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async (input, init) => (init?.method === 'POST'
				? new Response(`: keepalive

: keepalive

${chunk({ reasoning_content: 'Hurt.' })}${chunk({ content: '{"steps":[]}' })}${chunk({}, 'stop')}data: [DONE]

`, { status: 200, headers: { 'content-type': 'text/event-stream' } })
				: new Response('nope', { status: 404 })),
		});
		const res = await provider.chat({ model: 'grok', messages: [{ role: 'user', content: 'hi' }] });
		assert.equal(res.content, '{"steps":[]}');
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
			timings: { prompt_ms: 90, predicted_ms: 210, predicted_n: 42 },
		});
		assert.equal(t.promptMs, 90);
		assert.equal(t.generateMs, 210);
		assert.equal(t.outputTokens, 42);
	});

	it('counts what was generated from the usage when there are no timings', () => {
		assert.equal(parseChatTimings({ usage: { completion_tokens: 17 } }).outputTokens, 17);
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
		// Qwen's tool calls written as text are no tokens: the mind reads them as tools.
		const call = '<tool_call>\n<function=earshot>\n</function>\n</tool_call>';
		assert.equal(stripTemplateTokens(call), call);
	});

	it('drops the channel header a model leaks at the start of its thought', () => {
		assert.equal(cleanThought('<|channel>thought\nThe bridge is up.<channel|>'), 'The bridge is up.');
		assert.equal(cleanThought('<|channel|>analysis\nGo.'), 'Go.');
		assert.equal(cleanThought('I think a < b.'), 'I think a < b.');
		assert.equal(cleanThought('<|channel>thought'), undefined);
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

	it('clamps max_tokens to one slot\'s share of a model loaded with parallel slots', async () => {
		const loaded = (parallel:number) => ({ models: [{ key: 'm', loaded_instances: [{ id: 'm', config: { context_length: 32768, parallel } }] }] });
		const cap = async (parallel:number) => Number((await captureBody({}, 'm', loaded(parallel), { maxTokens: 30000 }))['max_tokens']);
		assert.equal(await cap(1), 30000, 'one slot holds the whole context');
		const quarter = await cap(4);
		assert.ok(quarter < 8192 && quarter > 8000, 'each of 4 slots holds a quarter');
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
			fetch: async (input, init) => {
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
		await provider.chat({ model: 'npc', messages: [{ role: 'user', content: 'again' }] });
		assert.deepEqual(unloaded, ['npc']);
	});
});

describe('HttpProvider thinking budget', () => {
	/** A streamed chat completion: these thought pieces, then these answer pieces. Reports whether the reader stopped it. */
	function streamOf(thought:string[], answer:string[]):{ res:()=>Response; canceled:()=>boolean } {
		let canceled = false;
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
					canceled = true;
				},
			}), { status: 200, headers: { 'content-type': 'text/event-stream' } }),
			canceled: () => canceled,
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
		assert.equal(stream.canceled(), true, 'the server stops generating');
	});

	it('leaves a thought that ends within its budget alone', async () => {
		const stream = streamOf(['Go ', 'to ', 'the Keep.'], ['{"steps"', ':[]}']);
		const res = await providerFor(stream, 8).chat({ model: 'thinker', messages: [{ role: 'user', content: 'hi' }] });
		assert.equal(res.content, '{"steps":[]}');
		assert.equal(res.truncated, false);
		assert.equal(stream.canceled(), false);
	});

	it('hands over each piece of a streamed reply as it comes', async () => {
		const stream = streamOf(['Go ', 'there.'], ['{"steps"', ':[]}']);
		const pieces:ChatDelta[] = [];
		const res = await providerFor(stream, 8).chat({ model: 'thinker', messages: [{ role: 'user', content: 'hi' }], onDelta: (piece) => pieces.push(piece) });
		assert.deepEqual(pieces, [{ reasoning: 'Go ' }, { reasoning: 'there.' }, { content: '{"steps"' }, { content: ':[]}' }]);
		assert.equal(res.content, '{"steps":[]}');
	});

	it('streams a thought without the channel header the model leaks', async () => {
		const stream = streamOf(['<|chan', 'nel>', 'thought', '\n', 'Go ', 'there <', '3.'], ['{"steps":[]}']);
		const pieces:ChatDelta[] = [];
		const res = await providerFor(stream, 16).chat({ model: 'thinker', messages: [{ role: 'user', content: 'hi' }], onDelta: (piece) => pieces.push(piece) });
		const thought = pieces.map((piece) => piece.reasoning ?? '').join('');
		assert.equal(thought, 'Go there <3.');
		assert.equal(res.reasoning, 'Go there <3.');
	});

	/** A provider that answers each chat with the next of `streams`, and keeps the bodies it was sent. */
	function providerOver(streams:ReturnType<typeof streamOf>[], settings:ModelSettings = {}):{ provider:HttpProvider; bodies:Record<string, unknown>[] } {
		const bodies:Record<string, unknown>[] = [];
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async (input, init) => {
				const url = String(input);
				if (url.endsWith('/models') || url.includes('/responses')) {
					return new Response('nope', { status: 404 });
				}
				bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
				return streams[bodies.length - 1]!.res();
			},
		});
		provider.configureModel('thinker', settings);
		return { provider, bodies };
	}

	const words = (n:number):string[] => Array.from({ length: n }, (element, i) => `step${i} `);
	const hi:ChatRequest = { model: 'thinker', messages: [{ role: 'user', content: 'hi' }] };

	it('cuts a thought short when thinking is off, and hands it back as a budget cut is', async () => {
		const stream = streamOf(words(40), ['{}']);
		const { provider, bodies } = providerOver([stream]);
		const res = await provider.chat(hi);
		assert.equal(bodies[0]?.['reasoning_effort'], 'none');
		assert.equal(res.truncated, true);
		assert.equal(res.content, null);
		assert.match(res.reasoning ?? '', /^step0 step1/);
		assert.equal(stream.canceled(), true);
	});

	it("gives each request what its think's earlier requests left of the budget, and no thinking once it is spent", async () => {
		const { provider, bodies } = providerOver([streamOf(words(12), ['{}']), streamOf(words(12), ['{}'])], { enableThinking: true, thinkingBudget: 20, thinkingFloor: 0 });
		assert.equal((await provider.chat({ ...hi, thinkingSpent: 10 })).truncated, true, 'ten tokens left, twelve thought');
		assert.equal((await provider.chat({ ...hi, thinkingSpent: 20 })).content, '{}', 'thought within the few a turn without thinking may');
		assert.deepEqual(bodies.map((body) => body['reasoning_effort']), ['medium', 'none']);
	});

	it('lets a later request think half what the last that thought was allowed, if that is more than is left, and never under the floor', async () => {
		const { provider, bodies } = providerOver([0, 1, 2].map(() => streamOf([], ['{}'])), { enableThinking: true, thinkingBudget: 256 });
		const allowed:(number | undefined)[] = [];
		for (const [spent, last] of [[200, 256], [300, 128], [400, 64]] as const) {
			allowed.push((await provider.chat({ ...hi, thinkingSpent: spent, lastThinkingAllowance: last })).thinkingAllowance);
		}
		assert.deepEqual(allowed, [128, 64, 64], '56 left, but half of 256; then half of 128; then the floor of 64, over half of 64');
		assert.deepEqual(bodies.map((body) => [body['reasoning_effort'], body['max_tokens']]), [['medium', 128 + 512], ['medium', 64 + 512], ['medium', 64 + 512]]);
		const low = providerOver([streamOf([], ['{}'])], { enableThinking: true, thinkingBudget: 256, thinkingFloor: 32 });
		assert.equal((await low.provider.chat({ ...hi, thinkingSpent: 400, lastThinkingAllowance: 64 })).thinkingAllowance, 32, 'a floor of 32 lets it think 32');
	});

	it('lowers the floor to a budget under it', async () => {
		const { provider, bodies } = providerOver([0, 1].map(() => streamOf([], ['{}'])), { enableThinking: true, thinkingBudget: 32 });
		assert.equal((await provider.chat(hi)).thinkingAllowance, 32, 'all 32, under the floor of 64');
		assert.equal((await provider.chat({ ...hi, thinkingSpent: 32, lastThinkingAllowance: 32 })).thinkingAllowance, 32, 'the floor, clamped to 32, over half of 32');
		assert.deepEqual(bodies.map((body) => body['reasoning_effort']), ['medium', 'medium']);
	});

	it('asks the server to stop at what the budget leaves, plus room to answer', async () => {
		const { provider, bodies } = providerOver([streamOf([], ['{}']), streamOf([], ['{}'])], { enableThinking: true, thinkingBudget: 256 });
		await provider.chat({ ...hi, thinkingSpent: 56 });
		await provider.chat({ ...hi, enableThinking: false });
		assert.equal(bodies[0]?.['max_tokens'], 200 + 512);
		assert.equal('max_tokens' in bodies[1]!, false, 'a turn that does not think is sent as before');
	});

	it('hands back a thought the server stopped at its cap, with no answer, as a budget cut', async () => {
		const thought = 'The bridge is closed, so';
		const chat = { choices: [{ message: { content: '', reasoning_content: thought }, finish_reason: 'length' }] };
		const responses = `event: response.incomplete\ndata: ${JSON.stringify({ type: 'response.incomplete', response: {
			status: 'incomplete',
			output: [{ type: 'reasoning', content: [{ type: 'reasoning_text', text: thought }] }],
		} })}\n\n`;
		const bodies:Record<string, unknown>[] = [];
		const over = (responsesAPI:boolean):HttpProvider => {
			const provider = new HttpProvider({
				baseURL: 'http://127.0.0.1:9/v1',
				fetch: async (input, init) => {
					const url = String(input);
					if (url.endsWith('/api/v1/models') && init?.method !== 'POST') {
						return responsesAPI
							? new Response(JSON.stringify({ models: [{ key: 'thinker', loaded_instances: [{ id: 'thinker' }] }] }), { status: 200 })
							: new Response('nope', { status: 404 });
					}
					if (url.includes('/responses') !== responsesAPI) {
						return new Response('nope', { status: 404 });
					}
					bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
					return responsesAPI
						? new Response(responses, { status: 200, headers: { 'content-type': 'text/event-stream' } })
						: new Response(JSON.stringify(chat), { status: 200 });
				},
			});
			provider.configureModel('thinker', { enableThinking: true, thinkingBudget: 256 });
			return provider;
		};
		for (const responsesAPI of [false, true]) {
			const res = await over(responsesAPI).chat(hi);
			assert.deepEqual([res.truncated, res.content, res.reasoning], [true, null, thought], responsesAPI ? 'responses' : 'chat completions');
		}
		assert.deepEqual(bodies.map((body) => body['max_tokens'] ?? body['max_output_tokens']), [768, 768]);
	});

	it('asks a reply stuck repeating its thought again, once, without thinking', async () => {
		const looping = streamOf(Array.from({ length: 30 }, () => 'thought\n'), ['{}']);
		const { provider, bodies } = providerOver([looping, streamOf([], ['{"steps":[]}'])], { enableThinking: true });
		const res = await provider.chat(hi);
		assert.equal(looping.canceled(), true);
		assert.deepEqual(bodies.map((body) => body['reasoning_effort']), ['medium', 'none']);
		assert.equal(res.content, '{"steps":[]}');
	});

	it('fails a reply stuck repeating its answer', async () => {
		const { provider } = providerOver([streamOf([], Array.from({ length: 30 }, () => 'and '))]);
		await assert.rejects(provider.chat(hi), / repeats itself in its answer/);
	});

	it('asks again without an effort when the server takes none', async () => {
		const bodies:Record<string, unknown>[] = [];
		const provider = new HttpProvider({
			baseURL: 'http://127.0.0.1:9/v1',
			fetch: async (input, init) => {
				if (String(input).includes('/models') || String(input).includes('/responses')) {
					return new Response('nope', { status: 404 });
				}
				bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
				return bodies.length === 1
					? new Response(JSON.stringify({ error: { message: "Unsupported parameter: 'reasoning_effort' is not supported with this model." } }), { status: 400 })
					: new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200 });
			},
		});
		assert.equal((await provider.chat(hi)).content, '{}');
		assert.deepEqual(bodies.map((body) => body['reasoning_effort']), ['none', undefined]);
	});
});

describe('loops', () => {
	it('catches a short run said over and over', () => {
		assert.equal(loops(`Let me see.\n${'thought\n'.repeat(12)}`), true);
		assert.equal(loops(`{"a":${'}'.repeat(80)}`), true);
		assert.equal(loops(`I will go ${'and '.repeat(20)}`), true);
	});

	it('leaves real lists, indentation and short runs alone', () => {
		const arc = ['Farm', 'Mill', 'Bridge', 'Well', 'Inn', 'Keep', 'Gate', 'Smithy', 'Dock', 'Shrine'].map((place) => `\tgo_to(${place})\n`).join('');
		assert.equal(loops(arc), false);
		assert.equal(loops(`${arc}${'\t'.repeat(12)}`), false);
		assert.equal(loops(`${arc}]]]`), false);
		assert.equal(loops('thought\n'.repeat(7)), false, 'seven times is not yet a loop');
	});
});
