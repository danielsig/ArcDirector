import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contextCap, inPageFetch, loadFailure, storedModels, type Wllama } from './browser.js';
import { ggufMetadata } from './gguf.js';
import { HttpProvider } from './http.js';
import { JevSystemOne } from './systemone.js';
import { ModelDownload } from './download.js';
import { showLoadingBar } from './loadingBar.js';

/** A wllama that answers every chat with `chunks`, as one reply or streamed, and records what it was asked. */
function fakeWllama(chunks:{ reasoning_content?:string; content?:string }[]):{ wllama:Wllama; asked:Record<string, unknown>[]; stopped:()=>boolean } {
	const asked:Record<string, unknown>[] = [];
	let signal:AbortSignal | undefined;
	const wllama:Wllama = {
		modelManager: { cacheManager: { list: async () => [], open: async () => null, deleteMany: async () => undefined } },
		loadModel: async () => undefined,
		// eslint-disable-next-line no-restricted-syntax -- wllama's own name
		loadModelFromUrl: async () => undefined,
		exit: async () => undefined,
		getModelMetadata: () => ({ meta: {} }),
		// A decision model's answer: the likeliest choice, as Laya's head picks it.
		createSystemOne: async (params) => {
			asked.push(params);
			const questions = params['questions'] as Record<string, { criteria:Record<string, string> }>;
			const choice = Object.keys(questions['pick'].criteria).at(-1)!;
			return { model: 'laya', answers: { pick: { type: 'choice', choice, probabilities: { [choice]: 0.9 }, confidence: 0.9 } } };
		},
		createChatCompletion: async (params) => {
			asked.push(params);
			signal = params['abortSignal'] as AbortSignal;
			if (!params['stream']) {
				return {
					choices: [{
						message: { content: chunks.map((c) => c.content ?? '').join('') },
						logprobs: { content: [{ token: 'A', logprob: -0.1, top_logprobs: [{ token: 'A', logprob: -0.1 }, { token: 'B', logprob: -2.5 }] }] },
						finish_reason: 'stop',
					}],
				};
			}
			return (async function* () {
				for (const delta of chunks) {
					if (signal?.aborted) {
						return;
					}
					yield { choices: [{ index: 0, delta, finish_reason: null }] };
				}
				yield { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
			})();
		},
	};
	return { wllama, asked, stopped: () => !!signal?.aborted };
}

/** A GGUF header with `entries`: a string, a number as a u32, an array of strings, or an array of numbers as u32s. */
function gguf(entries:Record<string, string | number | string[] | number[]>):Blob {
	const bytes:number[] = [];
	const u32 = (n:number):void => { bytes.push(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255); };
	const u64 = (n:number):void => { u32(n); u32(0); };
	const str = (text:string):void => { const b = new TextEncoder().encode(text); u64(b.length); bytes.push(...b); };
	u32(0x46554747);
	u32(3);
	u64(0);
	u64(Object.keys(entries).length);
	for (const [key, value] of Object.entries(entries)) {
		str(key);
		if (typeof value === 'string') { u32(8); str(value); }
		else if (typeof value === 'number') { u32(4); u32(value); }
		else if (typeof value[0] === 'string') { u32(9); u32(8); u64(value.length); (value as string[]).forEach(str); }
		else { u32(9); u32(4); u64(value.length); (value as number[]).forEach(u32); }
	}
	return new Blob([new Uint8Array(bytes)]);
}

function providerOn(wllama:Wllama):HttpProvider {
	return new HttpProvider({ baseURL: 'http://browser.invalid/v1', fetch: inPageFetch(() => Promise.resolve(wllama)) });
}

describe('browser', () => {
	it('reads the store as models, a half-downloaded split one incomplete instead of hiding the rest', () => {
		const part = (url:string, size = 10, originalSize = size) => ({ name: url.split('/').pop()!, size, metadata: { originalURL: url, originalSize } });
		const gemma = 'https://hf.co/g/gemma-00001-of-00003.gguf';
		const laya = 'https://hf.co/l/laya-Q8_0.gguf';
		const models = storedModels([
			part(gemma),
			part('https://hf.co/g/gemma-00003-of-00003.gguf', 4, 10),
			// Still downloading: no URL until it is whole.
			{ name: 'gemma-00002', size: 3, metadata: { originalURL: '', originalSize: 0 } },
			part(laya),
		]);
		assert.deepEqual([...models.keys()], [gemma, laya]);
		assert.equal(models.get(gemma)!.complete, false, 'a part missing, another cut short');
		assert.deepEqual(models.get(gemma)!.parts.map((p) => p.slice(-19)), ['00001-of-00003.gguf', '00002-of-00003.gguf', '00003-of-00003.gguf']);
		assert.equal(models.get(laya)!.complete, true);
	});

	it('answers a streamed chat from the model in the page, its thought apart', async () => {
		const { wllama, asked } = fakeWllama([{ reasoning_content: 'The gate is shut.' }, { content: '{"steps":' }, { content: '[]}' }]);
		const res = await providerOn(wllama).chat({ model: 'gemma', messages: [{ role: 'user', content: 'hi' }], enableThinking: true });
		assert.equal(res.content, '{"steps":[]}');
		assert.equal(res.reasoning, 'The gate is shut.');
		assert.equal(asked[0]?.['stream'], true);
	});

	it('answers a System One pick from a decision model in the page', async () => {
		const { wllama, asked } = fakeWllama([]);
		const pick = new JevSystemOne({ baseURL: 'http://browser.invalid/v1/systemone', model: 'laya', fetch: inPageFetch(() => Promise.resolve(wllama)) });
		assert.equal(await pick.pick('You are hurt.', 'stay alive', { stab: 'stab(Orc)', flee: 'flee(Orc)' }), 'flee');
		assert.deepEqual(asked[0], { state: 'You are hurt.', questions: { pick: { type: 'choice', instructions: 'stay alive', criteria: { stab: 'stab(Orc)', flee: 'flee(Orc)' } } } });
	});

	it('answers in one piece when the caller wants scores, as System One does', async () => {
		const { wllama } = fakeWllama([{ content: 'A' }]);
		const res = await providerOn(wllama).chat({ model: 'gemma', messages: [{ role: 'user', content: 'pick' }], maxTokens: 1, topLogprobs: 2, sampling: { temperature: 0 } });
		assert.equal(res.content, 'A');
		assert.ok((res.logprobs?.['A'] ?? -Infinity) > (res.logprobs?.['B'] ?? -Infinity));
	});

	it('stops the model once the thinking budget runs out', async () => {
		const thought = Array.from({ length: 40 }, () => ({ reasoning_content: 'I need to lower the Bridge. ' }));
		const { wllama, stopped } = fakeWllama([...thought, { content: '{}' }]);
		const provider = providerOn(wllama);
		provider.configureModel('gemma', { thinkingBudget: 16 });
		const res = await provider.chat({ model: 'gemma', messages: [{ role: 'user', content: 'hi' }], enableThinking: true });
		assert.equal(res.truncated, true);
		assert.equal(res.content, null);
		assert.ok(stopped(), 'the model stops thinking too, not only the reader');
	});

	it('fails a load that llama.cpp failed, or that put no layer on the GPU, and passes one on the GPU', () => {
		const oom = ['ggml_aligned_malloc: insufficient memory (attempted to allocate 4873.55 MB)', "srv    load_model: failed to load model, 'models/model-00001-of-00009.gguf'"];
		assert.match(loadFailure(oom) ?? '', /could not load: .*insufficient memory/);
		assert.match(loadFailure(['ggml_webgpu: Failed to get an adapter: none', 'load_tensors: offloaded 0/43 layers to GPU']) ?? '', /got no GPU.*: .*Failed to get an adapter/);
		assert.equal(loadFailure(['load_tensors: offloaded 43/43 layers to GPU']), null);
		assert.equal(loadFailure([]), null, 'an engine that says nothing of layers is taken at its word');
	});

	it("reads a model's header, and caps each think's context below what one GPU dispatch can re-rope", async () => {
		const meta = await ggufMetadata(gguf({
			'general.architecture': 'gemma4',
			'tokenizer.ggml.tokens': ['<pad>', '<eos>', 'hi'],
			'gemma4.attention.head_count_kv': 2,
			'gemma4.attention.key_length': 512,
			'gemma4.attention.value_length': 512,
			'gemma4.attention.sliding_window_pattern': [1, 1, 0],
		}));
		assert.equal(meta.get('gemma4.attention.key_length'), 512);
		assert.equal(meta.has('tokenizer.ggml.tokens'), false, 'arrays of strings are skipped');
		// Gemma 4 E4B: 16 384 tokens x 2 heads x 512 is 65 536 workgroups of 256, one past WebGPU's most.
		assert.equal(contextCap(meta), 16128);
		assert.equal(contextCap(new Map([['general.architecture', 'gemma4']])), null, 'a header that names no heads caps nothing');
	});

	it('is not found at any other path, as on a server without it', async () => {
		const res = await inPageFetch(() => Promise.resolve(fakeWllama([]).wllama))('http://browser.invalid/api/v1/models', { method: 'GET' });
		assert.equal(res.status, 404);
	});
});

/** A page with just what a loading bar uses: nodes that record their children and text. */
type FakeNode = { tag:string; textContent:string | null; style:{ cssText:string }; children:FakeNode[]; parent?:FakeNode; value?:number; max?:number; childElementCount:number; append(...nodes:FakeNode[]):void; remove():void };

function fakeNode(tag:string):FakeNode {
	const node:FakeNode = {
		tag,
		textContent: null,
		style: { cssText: '' },
		children: [],
		get childElementCount() {
			return node.children.length;
		},
		append(...nodes) {
			for (const child of nodes) {
				child.parent = node;
				node.children.push(child);
			}
		},
		remove() {
			node.parent?.children.splice(node.parent.children.indexOf(node), 1);
			node.parent = undefined;
		},
	};
	return node;
}

describe('loading bar', () => {
	it('shows one bar per download while it loads, with what it is doing, and goes once it is loaded', async () => {
		const body = fakeNode('body');
		(globalThis as { document?:unknown }).document = { body, createElement: fakeNode };
		try {
			let finish = ():void => undefined;
			let report:(p:{ progress:number; text:string })=>void = () => undefined;
			const download = new ModelDownload((r) => new Promise<void>((resolve) => {
				report = r;
				finish = resolve;
			}));
			const model = 'https://example.org/skaldic-gemma-4-e4b-Q4_K_M-00001-of-00009.gguf';
			showLoadingBar(download, model);
			showLoadingBar(download, model);
			const panel = body.children[0];
			assert.equal(panel.children.length, 1, 'one bar for a download, however many models share it');
			const [name, bar, , label] = panel.children[0].children;
			assert.equal(name.textContent, 'skaldic-gemma-4-e4b-Q4_K_M');
			report({ progress: 0.25, text: 'Downloading 1.2 of 4.6 GB' });
			assert.equal(bar.value, 0.25);
			assert.equal(label.textContent, 'Downloading 1.2 of 4.6 GB');
			finish();
			await download.done;
			assert.equal(body.children.length, 0, 'the panel goes with its last bar');
			const stopped = new ModelDownload(() => new Promise<void>(() => undefined));
			showLoadingBar(stopped, model);
			const button = body.children[0].children[0].children[2] as FakeNode & { onclick?:()=>void };
			button.onclick?.();
			assert.equal(stopped.cancelled, true);
			assert.equal(body.children.length, 0, 'a cancelled download takes its bar with it');
		}
		finally {
			delete (globalThis as { document?:unknown }).document;
		}
	});
});
