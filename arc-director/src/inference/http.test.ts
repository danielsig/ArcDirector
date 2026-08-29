import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MODEL_TIERS, type ThinkOff } from './models.js';
import { HttpProvider, parseChatTimings } from './http.js';

function idWithThinkOff(mode:ThinkOff):string {
	const row = MODEL_TIERS.find((t) => t.thinking && t.thinkOff === mode);
	assert.ok(row);
	return row.id;
}

async function captureBody(
	config:ConstructorParameters<typeof HttpProvider>[0],
	model:string,
):Promise<Record<string, unknown>> {
	let body:Record<string, unknown> | undefined;
	const provider = new HttpProvider({
		...config,
		baseURL: 'http://127.0.0.1:9/v1',
		fetch: async (_input, init) => {
			body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			return new Response(JSON.stringify({
				choices: [{ message: { content: '{"ok":true}' } }],
			}), { status: 200 });
		},
	});
	await provider.chat({
		model,
		messages: [{ role: 'user', content: 'pong' }],
	});
	assert.ok(body);
	return body;
}

describe('HttpProvider thinking', () => {
	it('does not send a thinking budget when think-off is no_think', async () => {
		const model = idWithThinkOff('no_think');
		const body = await captureBody({ thinkingBudget: 128, maxTokens: 384 }, model);
		assert.equal(body['thinking_budget'], undefined);
		assert.equal(body['enable_thinking'], false);
		assert.equal(body['reasoning_effort'], 'none');
		const messages = body.messages as Array<{ role?:string; content?:string }>;
		const system = messages.find((m) => m.role === 'system');
		assert.match(String(system?.content), /\/no_think/);
		assert.equal(String(messages.at(-1)?.content), 'pong');
	});

	it('uses a low reasoning effort when think-off is effort_low', async () => {
		const model = idWithThinkOff('effort_low');
		const body = await captureBody({ thinkingBudget: 128, maxTokens: 384 }, model);
		assert.equal(body['thinking_budget'], undefined);
		assert.equal(body['enable_thinking'], undefined);
		assert.equal(body['reasoning_effort'], 'low');
		const messages = body.messages as Array<{ content?:string }>;
		assert.equal(String(messages.at(-1)?.content), 'pong');
	});

	it('ignores reasoning_content that is not a JSON plan', async () => {
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
			model: idWithThinkOff('effort_low'),
			messages: [{ role: 'user', content: 'pong' }],
		});
		assert.equal(res.content, null);
	});

	it('reads reasoning_content when a JSON plan is only in reasoning_content', async () => {
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
			model: idWithThinkOff('effort_low'),
			messages: [{ role: 'user', content: 'pong' }],
		});
		assert.equal(res.content, '{"head":{"verb":"wait","args":{"seconds":1}}}');
	});

	it('sends a thinking budget only when thinking is enabled', async () => {
		const body = await captureBody({
			enableThinking: true,
			thinkingBudget: 128,
			maxTokens: 384,
		}, idWithThinkOff('no_think'));
		assert.equal(body['thinking_budget'], 128);
		assert.equal(body['enable_thinking'], undefined);
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
		const content = messages.at(-1)?.content as Array<{
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
