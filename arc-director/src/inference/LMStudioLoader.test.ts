import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contextPerSlot, LMStudioLoader, type HttpLoadConfig } from './LMStudioLoader.js';

type Instance = { id:string; config:Record<string, unknown> };

type Server = {
	/** A loader on this server, each model loaded as `load` says; `configured` (default: those) are never unloaded for room. */
	loader:(load?:Record<string, HttpLoadConfig>, configured?:string[])=>LMStudioLoader;
	/** Each load and unload asked for: `load gemma`, `unload stray`. */
	calls:string[];
	/** The body of each load and unload. */
	bodies:Record<string, unknown>[];
};

/**
 * An LM Studio server in memory, through a fake fetch: its models by key, each with its loaded instances. Without
 * `manages`, `api/v1/models` is a 404, as on Ollama or a plain OpenAI server. It gives a load at most `maxParallel` slots.
 */
function server(models:Record<string, Instance[]>, opts:{ manages?:boolean; maxParallel?:number } = {}):Server {
	const calls:string[] = [];
	const bodies:Record<string, unknown>[] = [];
	const manages = opts.manages ?? true;
	const fetch = (async () => ({
		ok: manages,
		status: manages ? 200 : 404,
		json: async () => ({ models: Object.entries(models).map(([key, loaded]) => ({ key, type: 'llm', loaded_instances: loaded })) }),
	})) as unknown as typeof globalThis.fetch;
	const post = async (url:string, body:Record<string, unknown>):Promise<Record<string, unknown>> => {
		const unload = url.endsWith('unload');
		calls.push(`${unload ? 'unload' : 'load'} ${String(body.instance_id ?? body.model)}`);
		bodies.push(body);
		if (unload) {
			for (const list of Object.values(models)) {
				list.splice(0, list.length, ...list.filter((inst) => inst.id !== body.instance_id));
			}
			return {};
		}
		const model = String(body.model);
		const config = { ...body, parallel: Math.min(Number(body.parallel ?? 1), opts.maxParallel ?? Infinity) };
		(models[model] ??= []).push({ id: model, config });
		return { instance_id: model, type: 'llm', load_config: config };
	};
	return {
		calls,
		bodies,
		loader: (load = {}, configured = Object.keys(load)) => new LMStudioLoader({
			url: (path) => path,
			fetch,
			timeoutMs: 1000,
			headers: () => ({}),
			post,
			loadOf: (model) => load[model] ?? {},
			load: {},
			configured: () => configured,
			catalog: () => undefined,
		}),
	};
}

describe('LMStudioLoader', () => {
	it('loads a model as configured once, and reuses it after', async () => {
		const { loader, calls, bodies } = server({});
		const lm = loader({ gemma: { contextLength: 8192, parallel: 4 } });
		await lm.ensureReady('gemma');
		await lm.ensureReady('gemma');
		assert.equal(lm.present, true);
		assert.deepEqual(calls, ['load gemma']);
		assert.deepEqual(bodies[0], { model: 'gemma', flash_attention: true, offload_kv_cache_to_gpu: true, eval_batch_size: 512, echo_load_config: true, parallel: 4, context_length: 8192 });
	});

	it('reloads an instance of another context, and makes room by unloading only what no configured model is', async () => {
		const { loader, calls } = server({ gemma: [{ id: 'gemma', config: { context_length: 4096 } }], qwen: [{ id: 'qwen', config: {} }], stray: [{ id: 'stray', config: {} }] });
		await loader({ gemma: { contextLength: 8192 }, qwen: {} }).ensureReady('gemma');
		assert.deepEqual(calls, ['unload gemma', 'unload stray', 'load gemma']);
	});

	it('does not reload an instance a request is using', async () => {
		const { loader, calls } = server({ gemma: [{ id: 'gemma', config: { context_length: 4096 } }] });
		const lm = loader({ gemma: { contextLength: 8192 } });
		lm.hold('gemma');
		await lm.ensureReady('gemma');
		assert.deepEqual(calls, [], 'busy: left as it is');
		lm.release('gemma');
		await lm.ensureReady('gemma');
		assert.deepEqual(calls, ['unload gemma', 'load gemma'], 'idle again: reloaded');
	});

	it('gives each request its slot\'s share of the context, by the slots the load got', async () => {
		assert.equal(contextPerSlot(8192, 4), 2048);
		assert.equal(contextPerSlot(8192, undefined), 8192);
		const lm = server({}, { maxParallel: 2 }).loader({ gemma: { contextLength: 8192, parallel: 4 } });
		assert.equal(lm.contextOf('gemma'), undefined, 'not loaded yet');
		await lm.ensureReady('gemma');
		assert.equal(lm.maxParallel.get('gemma'), 2);
		assert.deepEqual(lm.contextOf('gemma'), { whole: 8192, slot: 4096 }, 'two slots, not the four asked for');
	});

	it('loads nothing where the server has no model management, and counts a model a request JIT-loaded as loaded', async () => {
		const { loader, calls } = server({}, { manages: false });
		const lm = loader({ gemma: { contextLength: 8192 } });
		await lm.ensureReady('gemma');
		assert.equal(lm.present, false);
		assert.deepEqual(calls, []);
		assert.equal(lm.hasReusable('gemma'), false);
		lm.loadedByRequest('gemma');
		assert.equal(lm.hasReusable('gemma'), true);
		assert.equal(lm.contextOf('gemma'), undefined, 'how it was loaded is not known');
	});
});
