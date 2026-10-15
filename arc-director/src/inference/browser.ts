import { HttpProvider, type ModelSettings } from './http.js';
import { ModelDownload, type DownloadProgress } from './download.js';
import type { ChatRequest, ChatResponse, InferenceProvider } from './provider.js';

/** Gemma 4 E4B (Q4_K_M), split into files a browser can hold: the best Arcs of any model small enough to run there. */
export const DEFAULT_BROWSER_MODEL = 'https://huggingface.co/888rok/gemma-4-E4B-it-Q4_K_M-wllama-split/resolve/1394d405e4d8e0dd06dae64f506461f15e0a970b/gemma-4-E4B-it-Q4_K_M-00001-of-00004.gguf';

/** Tokens each think may fill when the model's spec names no `contextLength`. */
const DEFAULT_CONTEXT = 8192;

/**
 * What this provider uses of wllama (`@wllama/wllama`, an optional peer dependency imported on first use): llama.cpp's
 * own server, compiled to run in the page. Hosts without it installed must not need its types.
 */
type WllamaModule = { Wllama:new (paths:{ default:string }, config?:{ logger?:WllamaLogger })=>Wllama };

type WllamaLogger = Pick<Console, 'debug' | 'log' | 'warn' | 'error'>;

/** The parts of a `Wllama` this provider calls. */
export type Wllama = {
	modelManager:{ getModels():Promise<{ url:string; validate():string; remove():Promise<void> }[]> };
	// eslint-disable-next-line no-restricted-syntax -- wllama's own name
	loadModelFromUrl(url:string, params:LoadParams & { progressCallback?:(p:{ loaded:number; total:number })=>void }):Promise<void>;
	createChatCompletion(params:Record<string, unknown>):Promise<unknown>;
	exit():Promise<void>;
};

type LoadParams = {
	n_ctx:number;
	n_parallel:number;
	kv_unified:boolean;
	n_batch:number;
	n_ubatch:number;
	swa_full:boolean;
	n_cache_reuse:number;
	reasoning_format:'deepseek';
	reasoning_budget_tokens:number;
};

/** Prompt tokens the GPU takes in one pass. Bigger passes read a cold prompt faster, at a bigger working buffer. */
const PROMPT_CHUNK = 1024;
/** Smallest piece of a cached prompt worth moving into place when it no longer sits at the same spot. */
const CACHE_REUSE_CHUNK = 256;
/** The engine's last lines a crash report carries, and how long it may get: the stack traces alone run long. */
const CRASH_LINES = 12;
const CRASH_CHARS = 4000;

export type BrowserProviderOptions = {
	/**
	 * Where the host serves `wllama.wasm`, from the installed `@wllama/wllama` so the two match. With Vite:
	 * `import wasm from '@wllama/wllama/esm/wasm/wllama.wasm?url'`.
	 */
	wasm:string;
};

/**
 * Models that run in the page, on the GPU through WebGPU, with wllama: llama.cpp's server compiled to WebAssembly,
 * answering several thinks at once. A model is the URL of a GGUF, or of its first part when split
 * (`…-00001-of-00004.gguf`); a browser holds no file over 2 GB, so bigger models must be split
 * (`llama-gguf-split --split-max-size 1G`). Requests go through {@link HttpProvider}, as to any OpenAI-style server,
 * so the schema, sampling, thinking and its budget work as they do with LM Studio. It holds one model at a time, so
 * loading another unloads it, and the browser keeps every download, so a second load reads from disk. {@link shared}
 * is the page's one, so a loaded model outlives each director; the host sets it once, saying where it serves the
 * engine: `BrowserProvider.shared = new BrowserProvider({ wasm })`.
 */
export class BrowserProvider implements InferenceProvider {
	private static _shared:BrowserProvider | undefined;
	private readonly _settings = new Map<string, ModelSettings>();
	private readonly _downloads = new Map<string, ModelDownload>();
	private readonly _http:HttpProvider;
	private readonly _wasm:string;
	private _wllama:Promise<Wllama> | undefined;
	/**
	 * The engine's last lines: it only tells its logger why it crashed, and llama.cpp prints the reason (a GPU error,
	 * a failed check) as a plain line, a few before the stack traces.
	 */
	private _lines:string[] = [];
	/** The model loading or loaded now, and the settings it loaded with. */
	private _current:{ model:string; key:string; ready:Promise<Wllama> } | undefined;
	private _loaded:string | null = null;

	constructor(opts:BrowserProviderOptions) {
		this._wasm = opts.wasm;
		this._http = new HttpProvider({ baseURL: 'http://browser.invalid/v1', fetch: inPageFetch(() => this._current?.ready) });
	}

	/** The page's provider: `ArcDirector.addBrowserModel` uses it unless given another. The host sets it first. */
	public static get shared():BrowserProvider {
		if (!BrowserProvider._shared) {
			throw new Error('Set BrowserProvider.shared = new BrowserProvider({ wasm }) first: wasm is where you serve wllama.wasm');
		}
		return BrowserProvider._shared;
	}

	public static set shared(provider:BrowserProvider) {
		BrowserProvider._shared = provider;
	}

	/**
	 * Why models cannot run well in this browser, or null when they can: it has no WebGPU, or WebGPU gives it no GPU
	 * (hardware acceleration off, or a blocked driver). Ask before offering a download.
	 */
	public static async unsupported():Promise<string | null> {
		if (!(globalThis as { navigator?:{ gpu?:unknown } }).navigator?.gpu) {
			return "This browser can't run AI models.\nTry Chrome or Edge.";
		}
		return await gpuAdapter() ? null : "Your browser can't use the graphics card.\nRestarting it may help.";
	}

	/** The model on the GPU now, as it was named, or null. */
	public get loadedModel():string | null {
		return this._loaded;
	}

	/** Whether `model` is downloaded already, so loading it needs no network. */
	public async isCached(model:string):Promise<boolean> {
		const models = await (await this.wllama()).modelManager.getModels();
		return models.some((m) => m.url === model && m.validate() === 'valid');
	}

	/**
	 * Downloads `model` unless the browser has it, then loads it on the GPU in place of the last one. Asking again
	 * while it downloads, or once it is loaded, returns the same download.
	 */
	public download(model:string = DEFAULT_BROWSER_MODEL):ModelDownload {
		const known = this._downloads.get(model);
		if (known && (known.state === 'pending' || (known.state === 'done' && this._loaded === model))) {
			return known;
		}
		const download = new ModelDownload(async (report) => {
			await this.load(model, report);
		});
		this._downloads.set(model, download);
		return download;
	}

	/** Deletes `model`'s download from the browser, unloading it first if it is on the GPU. */
	public async delete(model:string):Promise<void> {
		if (this._current?.model === model) {
			const ready = this._current.ready;
			this._current = undefined;
			this._loaded = null;
			await ready.then((w) => w.exit(), () => undefined);
		}
		this._downloads.delete(model);
		const models = await (await this.wllama()).modelManager.getModels();
		await Promise.all(models.filter((m) => m.url === model).map((m) => m.remove()));
	}

	public configureModel(model:string, settings:ModelSettings):void {
		this._settings.set(model, { ...settings });
		// The engine ends a thought at its budget and answers in the same request, so the client never cuts one.
		this._http.configureModel(model, { ...settings, thinkingBudget: undefined });
	}

	public forgetModel(model:string):void {
		this._settings.delete(model);
		this._http.forgetModel(model);
	}

	/**
	 * Loads `req.model` first: a download can take longer than a request may wait. An engine that crashed is dropped,
	 * so the next think starts a new one and loads the model again, from disk.
	 */
	public async chat(req:ChatRequest):Promise<ChatResponse> {
		await this.load(req.model);
		const engine = this._wllama;
		try {
			return await this._http.chat(req);
		}
		catch (err) {
			if (!isCrash(err)) {
				throw err;
			}
			const why = [err instanceof Error ? err.message : String(err), ...this._lines].join(' | ').slice(0, CRASH_CHARS);
			// Several thinks die with one engine; only the first drops it, not the one that replaced it.
			if (this._wllama === engine) {
				this.discard();
			}
			throw new Error(`the model in the page crashed${why ? `: ${why}` : ''}. It loads again on the next think`);
		}
	}

	/** Forgets the engine and its model, as after a crash: the next request makes both anew. */
	private discard():void {
		const engine = this._wllama;
		this._wllama = undefined;
		this._current = undefined;
		this._loaded = null;
		this._downloads.clear();
		void engine?.then((w) => w.exit()).catch(() => undefined);
	}

	/**
	 * `model` on the GPU, as its settings say, loading it in place of the last one unless it is there already. Each
	 * of its parallel thinks gets the whole `contextLength`.
	 */
	private load(model:string, report?:(progress:DownloadProgress)=>void):Promise<Wllama> {
		const settings = this._settings.get(model);
		const parallel = Math.max(1, settings?.maxParallel ?? 1);
		const params:LoadParams = {
			n_ctx: (settings?.contextLength ?? DEFAULT_CONTEXT) * parallel,
			n_parallel: parallel,
			kv_unified: false,
			n_batch: 2 * PROMPT_CHUNK,
			n_ubatch: PROMPT_CHUNK,
			// Sliding-window layers (Gemma's) keep only their last few hundred tokens, so a cached prompt could not be
			// taken up again once a reply ran past them: every think read its whole prompt anew. Keeping them whole lets
			// each think reuse what an earlier one read, at more cache memory.
			swa_full: true,
			n_cache_reuse: CACHE_REUSE_CHUNK,
			// The thought comes back apart from the answer, as `reasoning_content`.
			reasoning_format: 'deepseek',
			reasoning_budget_tokens: settings?.thinkingBudget ?? -1,
		};
		const key = JSON.stringify(params);
		if (this._current?.model === model && this._current.key === key) {
			return this._current.ready;
		}
		const previous = this._current?.ready;
		const ready = (async () => {
			await previous?.then((w) => w.exit(), () => undefined);
			this._loaded = null;
			const wllama = await this.wllama();
			// eslint-disable-next-line no-restricted-syntax -- wllama's own name
			await wllama.loadModelFromUrl(model, {
				...params,
				progressCallback: ({ loaded, total }) => report?.({
					progress: total > 0 ? loaded / total : 0,
					text: loaded < total ? `Downloading ${gb(loaded)} of ${gb(total)} GB` : 'Loading on the GPU',
				}),
			});
			this._loaded = model;
			return wllama;
		})();
		const current = { model, key, ready };
		this._current = current;
		// A failed load is tried again next time.
		ready.catch(() => {
			if (this._current === current) {
				this._current = undefined;
			}
		});
		return ready;
	}

	private wllama():Promise<Wllama> {
		this._wllama ??= (async () => {
			const { Wllama } = await importWllama();
			this._lines = [];
			const remember = (print:(...args:unknown[])=>void) => (...args:unknown[]):void => {
				this._lines = [...this._lines, args.map(describe).join(' ')].slice(-CRASH_LINES);
				print(...args);
			};
			const logger = { debug: () => undefined, log: remember(console.log), warn: remember(console.warn), error: remember(console.error) };
			return new Wllama({ default: this._wasm }, { logger });
		})();
		return this._wllama;
	}
}

/**
 * A `fetch` that answers chat completions from the model in the page, as an OpenAI-style server would: JSON, or a
 * stream of server-sent events, whose cancel stops the model. Anything else is not found, as on a server without it.
 */
export function inPageFetch(engine:()=>Promise<Wllama> | undefined):typeof fetch {
	return async (input, init) => {
		const ready = engine();
		if (!String(input instanceof Request ? input.url : input).endsWith('/chat/completions') || init?.method !== 'POST' || !ready) {
			return new Response('not found', { status: 404 });
		}
		const body = JSON.parse(String(init.body)) as Record<string, unknown>;
		const stop = new AbortController();
		init.signal?.addEventListener('abort', () => stop.abort(init.signal?.reason));
		const wllama = await ready;
		const params = { ...body, abortSignal: stop.signal };
		if (!body['stream']) {
			return json(await wllama.createChatCompletion({ ...params, stream: false }));
		}
		const chunks = (await wllama.createChatCompletion({ ...params, stream: true }) as AsyncIterable<unknown>)[Symbol.asyncIterator]();
		const encoder = new TextEncoder();
		return new Response(new ReadableStream<Uint8Array>({
			async pull(controller) {
				const next = await chunks.next();
				if (next.done) {
					controller.enqueue(encoder.encode('data: [DONE]\n\n'));
					controller.close();
					return;
				}
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(next.value)}\n\n`));
			},
			cancel() {
				stop.abort();
			},
		}), { status: 200, headers: { 'content-type': 'text/event-stream' } });
	};
}

/** A logged value as text: an `Error`, or an `ErrorEvent` (a worker that died), by its message, not `[object …]`. */
function describe(value:unknown):string {
	if (typeof value === 'object' && value !== null && 'message' in value) {
		const { message, filename, lineno } = value as { message:unknown; filename?:unknown; lineno?:unknown };
		return filename ? `${String(message)} (${String(filename)}:${String(lineno)})` : String(message);
	}
	return String(value);
}

/** Whether `err` says the engine itself died, not just this request. */
function isCrash(err:unknown):boolean {
	return err instanceof Error && (err.name === 'RuntimeError' || /has crashed|\(ABORT\)/.test(err.message));
}

function json(value:unknown):Response {
	return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}

function gb(bytes:number):string {
	return (bytes / 1e9).toFixed(1);
}

type GPUAdapter = { features:{ has(name:string):boolean } };

let adapter:Promise<GPUAdapter | null> | undefined;

/** The GPU WebGPU gives, or null when there is no WebGPU or it gives none. */
function gpuAdapter():Promise<GPUAdapter | null> {
	type GPU = { requestAdapter(opts:{ powerPreference:string }):Promise<GPUAdapter | null> };
	const gpu = (globalThis as { navigator?:{ gpu?:GPU } }).navigator?.gpu;
	adapter ??= gpu ? gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null) : Promise.resolve(null);
	return adapter;
}

function importWllama():Promise<WllamaModule> {
	// Its package names no entry point that exists, so the built module is named outright.
	return (import('@wllama/wllama/esm/index.js' as string) as Promise<WllamaModule>).catch(() => {
		throw new Error('BrowserProvider needs @wllama/wllama installed');
	});
}
