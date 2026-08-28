import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MODEL_TIERS, type ThinkOff } from './models.js';
import { OpenAICompatProvider } from './openaiHttp.js';

function idWithThinkOff(mode:ThinkOff):string {
	const row = MODEL_TIERS.find((t) => t.thinking && t.thinkOff === mode);
	assert.ok(row);
	return row.id;
}

async function captureBody(
	config:ConstructorParameters<typeof OpenAICompatProvider>[0],
	model:string,
):Promise<Record<string, unknown>> {
	let body:Record<string, unknown> | undefined;
	const provider = new OpenAICompatProvider({
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

describe('OpenAICompatProvider thinking', () => {
	it('does not send a thinking budget when think-off is no_think', async () => {
		const model = idWithThinkOff('no_think');
		const body = await captureBody({ thinkingBudget: 128, maxTokens: 384 }, model);
		assert.equal(body['thinking_budget'], undefined);
		assert.equal(body['enable_thinking'], false);
		assert.equal(body['reasoning_effort'], 'none');
		const messages = body.messages as Array<{ content?:string }>;
		assert.match(String(messages.at(-1)?.content), /\/no_think/);
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
		const provider = new OpenAICompatProvider({
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

	it('reads reasoning_content when it is a JSON plan and content is empty', async () => {
		const provider = new OpenAICompatProvider({
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

	it('encodes image_url parts and appends /no_think to the last text part', async () => {
		let body:Record<string, unknown> | undefined;
		const provider = new OpenAICompatProvider({
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
		const messages = body.messages as Array<{ content?:unknown }>;
		const content = messages.at(-1)?.content as Array<{
			type?:string;
			text?:string;
			image_url?:{ url?:string };
		}>;
		assert.ok(Array.isArray(content));
		assert.equal(content[0]?.type, 'text');
		assert.match(String(content[0]?.text), /\/no_think/);
		assert.equal(content[1]?.type, 'image_url');
		assert.equal(content[1]?.image_url?.url, 'data:image/png;base64,xx');
	});
});
