import { HttpProvider, type ModelSettings } from './http.js';
import { ModelDownload, type DownloadProgress } from './download.js';
import { ggufMetadata } from './gguf.js';
import type { ChatRequest, ChatResponse, InferenceProvider, SystemOneEndpoint } from './provider.js';

/**
 * ArcDirector's own models, trained on its prompts: `addBrowserModel('main', Skaldic.Gemma4E4B)` runs one.
 * - `Gemma4E4B`: Skaldic Gemma 4 E4B, the best Arcs of any model small enough to run in a browser.
 * - `Laya`: Skaldic Laya (0.45 GB), a decision model: a System One that picks `choose` choices in one pass, in well
 *   under a tenth of a second.
 */
// Each value is the model's own name, as LM Studio and its files call it: never one an original model could share.
export const Skaldic = { Gemma4E4B: 'skaldic-gemma-4-e4b', Laya: 'skaldic-laya' } as const;
export type Skaldic = (typeof Skaldic)[keyof typeof Skaldic];

/** Each Skaldic model's browser build (Q4_K_M split into files a browser can hold; Laya's Q8_0), pinned to its `v1` release. */
export const SKALDIC_BROWSER_MODELS:Readonly<Record<Skaldic, string>> = {
	[Skaldic.Gemma4E4B]: 'https://huggingface.co/arc-director/Skaldic-Gemma-4-E4B/resolve/v1/browser/skaldic-gemma-4-e4b-Q4_K_M-00001-of-00009.gguf',
	[Skaldic.Laya]: 'https://huggingface.co/arc-director/Skaldic-Laya/resolve/v1/skaldic-laya-Q8_0.gguf',
};

/**
 * The browser models the library knows to be decision models (a decision head, no chat): `addBrowserModel` makes
 * them a System One on their own engine ({@link BrowserProvider.decisions}).
 */
export const BROWSER_DECISION_MODELS:readonly string[] = [SKALDIC_BROWSER_MODELS[Skaldic.Laya]];

/** A browser model as given (a {@link Skaldic} model, or a GGUF's URL) as the URL it downloads. */
export function browserModelURL(model:Skaldic | string):string {
	return SKALDIC_BROWSER_MODELS[model as Skaldic] ?? model;
}

/** What `addBrowserModel` runs when given no model: Skaldic Gemma 4 E4B. */
export const DEFAULT_BROWSER_MODEL = SKALDIC_BROWSER_MODELS[Skaldic.Gemma4E4B];

/** Tokens each think may fill when the model's spec names no `contextLength`. */
const DEFAULT_CONTEXT = 8192;

/**
 * What this provider uses of wllama (`@wllama/wllama`, an optional peer dependency imported on first use): llama.cpp's
 * own server, compiled to run in the page. Hosts without it installed must not need its types.
 */
type WllamaModule = { Wllama:new (paths:{ default:string }, config?:{ logger?:WllamaLogger })=>Wllama };

type WllamaLogger = Pick<Console, 'debug' | 'log' | 'warn' | 'error'>;

/**
 * A file in wllama's store: a whole part of a model once its metadata names the URL it came from, a download under
 * way before then.
 */
export type StoredFile = { name:string; size:number; metadata:{ originalURL:string; originalSize:number } };

/** The parts of a `Wllama` this provider calls. */
export type Wllama = {
	modelManager:{
		cacheManager:{
			list():Promise<StoredFile[]>;
			open(name:string):Promise<Blob | null>;
			deleteMany(which:(file:StoredFile)=>boolean):Promise<void>;
		};
	};
	loadModel(parts:Blob[], params:LoadParams):Promise<void>;
	// eslint-disable-next-line no-restricted-syntax -- wllama's own name
	loadModelFromUrl(url:string, params:LoadParams & { useCache?:boolean; progressCallback?:(p:{ loaded:number; total:number })=>void; signal?:AbortSignal }):Promise<void>;
	createChatCompletion(params:Record<string, unknown>):Promise<unknown>;
	createSystemOne(params:Record<string, unknown>):Promise<unknown>;
	getModelMetadata():{ meta:Record<string, string> };
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

/** Where requests to the model in the page go: {@link inPageFetch} answers them, nothing leaves the page. */
const IN_PAGE_URL = 'http://browser.invalid/v1';

/** Prompt tokens the GPU takes in one pass. Bigger passes read a cold prompt faster, at a bigger working buffer. */
const PROMPT_CHUNK = 1024;
/** Smallest piece of a cached prompt worth moving into place when it no longer sits at the same spot. */
const CACHE_REUSE_CHUNK = 256;
/** WebGPU's most workgroups in one dispatch dimension, and the threads in each of ggml-webgpu's. */
const MAX_WORKGROUPS = 65535;
const WORKGROUP = 256;
/** The engine's last lines a crash report carries, and how long it may get: the stack traces alone run long. */
const CRASH_LINES = 12;
const CRASH_CHARS = 4000;
/** The engine's lines that say where a model went as it loaded (its GPU, or why none) and why a load failed. */
const LOAD_LINE = /ggml_webgpu|offload|fitting|fail|insufficient memory/;
/** llama.cpp's count of the layers it put on the GPU. */
const OFFLOADED = /offloaded (\d+)\/\d+ layers to GPU/;
/**
 * The slowest a chat model may write and still finish a think (a few hundred tokens) before its request times out.
 * A browser that runs it on the CPU, or a GPU the browser handles badly, writes a token every few seconds.
 */
const MIN_TOKENS_PER_SECOND = 3;
/** Tokens the speed check asks for, and how long it waits for them, the GPU's first-run warm-up included. */
const SPEED_CHECK_TOKENS = 16;
const SPEED_CHECK_MS = 30_000;

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
	private static _decisions:BrowserProvider | undefined;
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
	/** The {@link LOAD_LINE}s of the last load, kept apart: a crash's stack traces push them out of {@link _lines}. */
	private _loadLines:string[] = [];
	/** A model that cannot load as its settings say, by model: tried again only once they change, or on `download`. */
	private readonly _failed = new Map<string, { key:string; error:Error }>();
	/** Each model's {@link contextCap}, once read from its stored header: null when the header does not say. */
	private readonly _caps = new Map<string, number | null>();
	/** The model loading or loaded now, and the settings it loaded with. */
	private _current:{ model:string; key:string; ready:Promise<Wllama> } | undefined;
	private _loaded:string | null = null;
	private readonly _fetch:typeof fetch;
	/** Whether each model loaded so far has a decision head, read from its GGUF. */
	private readonly _decides = new Map<string, boolean>();

	constructor(opts:BrowserProviderOptions) {
		this._wasm = opts.wasm;
		this._fetch = inPageFetch(() => this._current?.ready);
		this._http = new HttpProvider({ baseURL: IN_PAGE_URL, fetch: this._fetch });
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
	 * The page's engine for decision models, apart from {@link shared}'s, so a System One decides beside the chat
	 * model instead of unloading it. Made on first use, from where {@link shared} serves the engine.
	 */
	public static get decisions():BrowserProvider {
		BrowserProvider._decisions ??= new BrowserProvider({ wasm: BrowserProvider.shared._wasm });
		return BrowserProvider._decisions;
	}

	/**
	 * Why models cannot run well in this browser, and how the player can fix it, or null when they can: a short first
	 * line, then what to do. Ask before offering a download. Without JSPI and 64-bit memory wllama turns WebGPU off
	 * and the model crawls on the CPU (Firefox by default; Safari has wllama's slower compat build instead). With them
	 * but no GPU, the browser has turned it off, most often after the GPU crashed, until the browser restarts.
	 */
	public static async unsupported():Promise<string | null> {
		const agent = (globalThis as { navigator?:{ userAgent?:string } }).navigator?.userAgent ?? '';
		const firefox = /Firefox\//.test(agent);
		if (firefox && !fastWasm()) {
			return "Firefox can't run AI models on the graphics card yet.\n"
				+ 'Use Chrome or Edge. Or, in Firefox, open about:config, turn on javascript.options.wasm_js_promise_integration, and restart Firefox.';
		}
		if (!(globalThis as { navigator?:{ gpu?:unknown } }).navigator?.gpu) {
			return firefox
				? "This version of Firefox can't run AI models.\nUpdate Firefox, or use Chrome or Edge."
				: "This browser can't run AI models.\nUse Chrome or Edge.";
		}
		if (!fastWasm() && !/Version\/[\d.]+.*Safari/.test(agent)) {
			return 'This browser is too old to run AI models.\nUpdate it, or use Chrome or Edge.';
		}
		return await gpuAdapter() ? null : 'Your browser has turned off the graphics card, most often after a crash.\n'
			+ 'Quit the browser completely (every window) and open it again. If that does not help, turn on graphics acceleration in its settings.';
	}

	/** The model on the GPU now, as it was named, or null. */
	public get loadedModel():string | null {
		return this._loaded;
	}

	/** Whether `model` is downloaded already, so loading it needs no network. */
	public async isCached(model:string):Promise<boolean> {
		return (await this.stored()).get(model)?.complete ?? false;
	}

	/** The browser's store, by model: one store for every engine in the page. */
	private async stored():Promise<Map<string, StoredModel>> {
		return storedModels(await (await this.wllama()).modelManager.cacheManager.list());
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
		this._failed.delete(model);
		const download = new ModelDownload(async (report, signal) => {
			await this.load(model, report, signal);
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
		const files = new Set((await this.stored()).get(model)?.files.map((f) => f.name));
		await (await this.wllama()).modelManager.cacheManager.deleteMany((f) => files.has(f.name));
	}

	/**
	 * Deletes every downloaded model but `keep`, parts of half-done downloads too, unloading it first if it is on the
	 * GPU: models a host no longer offers hold browser storage it can never use, and a full store fails the next
	 * download.
	 */
	public async keepOnly(keep:readonly string[]):Promise<void> {
		const stale = [...(await this.stored()).keys()].filter((url) => !keep.includes(url));
		for (const model of stale) {
			await this.delete(model);
		}
	}

	/**
	 * For a decision model (a GGUF whose metadata names a decision head, such as Laya's): the System One endpoint the
	 * page answers it on. Loads it first, in place of the last model, so a decision model gets a provider of its own
	 * (`new BrowserProvider({ wasm })`) beside the chat model's. Undefined for a chat model.
	 */
	public async systemOneEndpoint(model:string):Promise<SystemOneEndpoint | undefined> {
		let decides = this._decides.get(model);
		if (decides === undefined) {
			decides = hasDecisionHead(await this.load(model));
			this._decides.set(model, decides);
		}
		if (!decides) {
			return undefined;
		}
		await this.load(model);
		return { url: `${IN_PAGE_URL}/systemone`, fetch: this._fetch };
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
			const why = [err instanceof Error ? err.message : String(err), ...new Set([...this._loadLines, ...this._lines])].join(' | ').slice(0, CRASH_CHARS);
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
	 * of its parallel thinks gets the whole `contextLength`, up to its {@link contextCap}.
	 */
	private load(model:string, report?:(progress:DownloadProgress)=>void, signal?:AbortSignal):Promise<Wllama> {
		const key = JSON.stringify(this.params(model));
		if (this._current?.model === model && this._current.key === key) {
			return this._current.ready;
		}
		const failed = this._failed.get(model);
		if (failed?.key === key) {
			return Promise.reject(failed.error);
		}
		const previous = this._current?.ready;
		// Started a step later, so the load can rename `current` as the cap it learns changes its params.
		const ready = Promise.resolve().then(async () => {
			await previous?.then((w) => w.exit(), () => undefined);
			this._loaded = null;
			const wllama = await this.wllama();
			// A stored model's cap is known before it loads; a downloading one's only once the store holds it whole,
			// so it loads again if the cap cuts its context.
			await this.readCap(model);
			const downloading = !this._caps.has(model);
			current.key = JSON.stringify(this.params(model));
			await this.start(wllama, model, report, signal);
			if (downloading) {
				await this.readCap(model);
				if (JSON.stringify(this.params(model)) !== current.key) {
					await wllama.exit();
					current.key = JSON.stringify(this.params(model));
					await this.start(wllama, model, report);
				}
			}
			this._loaded = model;
			return wllama;
		});
		const current = { model, key, ready };
		this._current = current;
		// A failed load is tried again next time, unless it cannot load as its settings say ({@link _failed}).
		ready.catch(() => {
			if (this._current === current) {
				this._current = undefined;
			}
		});
		return ready;
	}

	/** What `model` loads with, as its settings and its {@link contextCap} say. */
	private params(model:string):LoadParams {
		const settings = this._settings.get(model);
		// llama.cpp's `LLAMA_MAX_SEQ`: the engine fails to load with more.
		const parallel = Math.min(256, Math.max(1, settings?.maxParallel ?? 1));
		const context = Math.min(settings?.contextLength ?? DEFAULT_CONTEXT, this._caps.get(model) ?? Infinity);
		return {
			n_ctx: context * parallel,
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
	}

	/** Loads `model` as {@link params} says, from the store or the network, failing a load that left no model. */
	private async start(wllama:Wllama, model:string, report?:(progress:DownloadProgress)=>void, signal?:AbortSignal):Promise<void> {
		const params = this.params(model);
		const stored = (await this.stored()).get(model);
		this._loadLines = [];
		try {
			if (stored?.complete) {
				report?.({ progress: 1, text: 'Loading on the GPU' });
				await wllama.loadModel(await openParts(wllama, stored), params);
			}
			else {
				// Not `useCache`: wllama's lookup throws while any split model in the store is half downloaded (one
				// engine's download beside another's load). Without it, the parts already stored are kept, and only the
				// rest download.
				// eslint-disable-next-line no-restricted-syntax -- wllama's own name
				await wllama.loadModelFromUrl(model, {
					...params,
					useCache: false,
					// A cancelled download stops fetching; the load fails, and the next asks again.
					signal,
					progressCallback: ({ loaded, total }) => report?.({
						progress: total > 0 ? loaded / total : 0,
						text: loaded < total ? `Downloading ${gb(loaded)} of ${gb(total)} GB` : 'Loading on the GPU',
					}),
				});
			}
			const failure = loadFailure(this._loadLines);
			if (failure) {
				throw new ModelLoadError(failure);
			}
			// A decision model answers in one step; a chat model that writes too slowly never finishes a think.
			if (!hasDecisionHead(wllama)) {
				report?.({ progress: 1, text: 'Checking its speed' });
				const perSecond = await tokensPerSecond(wllama);
				if (perSecond < MIN_TOKENS_PER_SECOND) {
					throw new ModelLoadError(tooSlow(perSecond));
				}
			}
		}
		catch (err) {
			// A failed load leaves the engine started, and a started engine loads nothing more.
			await wllama.exit().catch(() => undefined);
			if (err instanceof ModelLoadError) {
				this._failed.set(model, { key: JSON.stringify(params), error: err });
			}
			throw err;
		}
	}

	/** Learns `model`'s {@link contextCap} from the header of its first part, once the store holds it whole. */
	private async readCap(model:string):Promise<void> {
		const stored = (await this.stored()).get(model);
		const first = !this._caps.has(model) && stored?.complete ? stored.files.find((f) => f.metadata.originalURL === stored.parts[0]) : undefined;
		const blob = first && await (await this.wllama()).modelManager.cacheManager.open(first.name);
		if (blob) {
			this._caps.set(model, contextCap(await ggufMetadata(blob)));
		}
	}

	private wllama():Promise<Wllama> {
		this._wllama ??= (async () => {
			const { Wllama } = await importWllama();
			this._lines = [];
			const remember = (print:(...args:unknown[])=>void) => (...args:unknown[]):void => {
				const line = args.map(describe).join(' ');
				this._lines = [...this._lines, line].slice(-CRASH_LINES);
				if (LOAD_LINE.test(line)) {
					this._loadLines = [...this._loadLines, line].slice(-CRASH_LINES);
				}
				print(...args);
			};
			const logger = { debug: () => undefined, log: remember(console.log), warn: remember(console.warn), error: remember(console.error) };
			return new Wllama({ default: this._wasm }, { logger });
		})();
		return this._wllama;
	}
}

/**
 * A `fetch` that answers from the model in the page, as an OpenAI-style server would: chat completions as JSON, or a
 * stream of server-sent events whose cancel stops the model, and a decision model's System One answers
 * (`/systemone`). Anything else is not found, as on a server without it.
 */
export function inPageFetch(engine:()=>Promise<Wllama> | undefined):typeof fetch {
	return async (input, init) => {
		const ready = engine();
		const url = String(input instanceof Request ? input.url : input);
		const route = url.endsWith('/chat/completions') ? 'chat' : url.endsWith('/systemone') ? 'systemone' : undefined;
		if (!route || init?.method !== 'POST' || !ready) {
			return new Response('not found', { status: 404 });
		}
		const body = JSON.parse(String(init.body)) as Record<string, unknown>;
		if (route === 'systemone') {
			return json(await (await ready).createSystemOne({ state: body['state'], questions: body['questions'] }));
		}
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

/**
 * Why a load left no model to answer with, from the engine's {@link LOAD_LINE}s, or null when it loaded: wllama
 * resolves a load that llama.cpp failed, and the first request then aborts the engine. A model with no layer on the
 * GPU fails too: on the CPU it is far too slow to think with, and too big for the page's memory besides.
 */
export function loadFailure(lines:readonly string[]):string | null {
	const why = lines.join(' | ');
	if (lines.some((line) => OFFLOADED.exec(line)?.[1] === '0')) {
		return `the model in the page got no GPU, and on the CPU it is far too slow: ${why}`;
	}
	return lines.some((line) => line.includes('failed to load model')) ? `the model in the page could not load: ${why}` : null;
}

/** Whether the loaded model is a decision model: its GGUF names a decision head (Laya's). */
function hasDecisionHead(wllama:Wllama):boolean {
	return Object.keys(wllama.getModelMetadata().meta).some((key) => key.endsWith('.decision.type'));
}

/**
 * How fast the loaded model writes, in tokens a second, from a short reply: timed from its first token, so the GPU's
 * warm-up does not count against it. Zero when it wrote under two tokens in {@link SPEED_CHECK_MS}.
 */
async function tokensPerSecond(wllama:Wllama):Promise<number> {
	const stop = new AbortController();
	const timer = setTimeout(() => stop.abort(), SPEED_CHECK_MS);
	const stamps:number[] = [];
	try {
		const chunks = await wllama.createChatCompletion({
			messages: [{ role: 'user', content: 'Count from 1 to 30.' }],
			max_tokens: SPEED_CHECK_TOKENS,
			stream: true,
			abortSignal: stop.signal,
		}) as AsyncIterable<unknown>;
		for await (const _ of chunks) {
			stamps.push(performance.now());
		}
	}
	catch (err) {
		if (!stop.signal.aborted) {
			throw err;
		}
	}
	finally {
		clearTimeout(timer);
	}
	const seconds = stamps.length < 2 ? 0 : (stamps[stamps.length - 1] - stamps[0]) / 1000;
	return seconds > 0 ? (stamps.length - 1) / seconds : 0;
}

/** What a player sees when the model writes `perSecond` tokens a second: too slow to think with, and what to do. */
function tooSlow(perSecond:number):string {
	const speed = perSecond > 0 ? `${perSecond.toFixed(1)} words a second` : 'almost nothing';
	return `It writes too slowly in this browser to think with (${speed}).\n`
		+ 'Use Chrome or Edge with graphics acceleration on, close other tabs that use the graphics card, or run models in LM Studio instead.';
}

/**
 * The most tokens one think's cache may hold, from a model's GGUF metadata, or null when it does not say: past it,
 * moving a reused cached chunk re-ropes the cache in one ggml-webgpu dispatch of more workgroups than WebGPU allows
 * (`Dispatch workgroup count X (65536) exceeds max compute workgroups per dimension (65535)`), which kills the engine.
 * ggml-webgpu does not split that dispatch (wllama 3.8.1). A whole number of reuse chunks: 16 128 for Gemma 4 E4B.
 */
export function contextCap(meta:ReadonlyMap<string, string | number>):number | null {
	const arch = meta.get('general.architecture');
	const num = (key:string):number => {
		const value = meta.get(`${String(arch)}.${key}`);
		return typeof value === 'number' ? value : 0;
	};
	const heads = num('attention.head_count_kv') || num('attention.head_count');
	const width = Math.max(num('attention.key_length'), num('attention.value_length')) || num('embedding_length') / (num('attention.head_count') || 1);
	if (!heads || !width) {
		return null;
	}
	return Math.floor(MAX_WORKGROUPS * WORKGROUP / (heads * width) / CACHE_REUSE_CHUNK) * CACHE_REUSE_CHUNK;
}

/** A model that cannot load as its settings say: loading it again the same way fails the same way. */
class ModelLoadError extends Error {}

/** Whether `err` says the engine itself died, not just this request. */
function isCrash(err:unknown):boolean {
	return err instanceof Error && (err.name === 'RuntimeError' || /has crashed|\(ABORT\)/.test(err.message));
}

/** A model in the browser's store: its files, and whether every part is there whole. */
export type StoredModel = { parts:string[]; files:StoredFile[]; complete:boolean };

/** A model's part URLs: the model itself, or every `-0000i-of-0000n.gguf` of a split one, first to last. */
function modelParts(model:string):string[] {
	const split = /-(\d{5})-of-(\d{5})\.gguf$/.exec(model);
	if (!split) {
		return [model];
	}
	const count = Number(split[2]);
	return Array.from({ length: count }, (_, i) => model.replace(split[0], `-${String(i + 1).padStart(5, '0')}-of-${split[2]}.gguf`));
}

/**
 * The store's files as models, by URL (a split model's first part), each whole only when all of its parts are. A file
 * still downloading names no URL yet, so it belongs to none. wllama's own list throws on a split model with a part
 * missing instead, so one model half downloaded would hide every other.
 */
export function storedModels(files:readonly StoredFile[]):Map<string, StoredModel> {
	const models = new Map<string, StoredModel>();
	for (const file of files) {
		const url = file.metadata.originalURL;
		if (!url) {
			continue;
		}
		const model = modelParts(url)[0]!;
		const entry = models.get(model) ?? { parts: modelParts(model), files: [], complete: false };
		entry.files.push(file);
		models.set(model, entry);
	}
	for (const entry of models.values()) {
		entry.complete = entry.parts.every((part) => entry.files.some((f) => f.metadata.originalURL === part && f.size === f.metadata.originalSize));
	}
	return models;
}

/** A whole stored model's parts, in order, to load. */
async function openParts(wllama:Wllama, model:StoredModel):Promise<Blob[]> {
	return Promise.all(model.parts.map(async (part) => {
		const file = model.files.find((f) => f.metadata.originalURL === part);
		const blob = file && await wllama.modelManager.cacheManager.open(file.name);
		if (!blob) {
			throw new Error(`a part of the model is missing from the browser's storage: ${part}`);
		}
		return blob;
	}));
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

/** Whether wllama can run its WebGPU build here: it needs JSPI (`WebAssembly.Suspending`) and 64-bit memory. */
function fastWasm():boolean {
	const wasm = (globalThis as { WebAssembly?:{ Suspending?:unknown; Memory:new (descriptor:object)=>unknown } }).WebAssembly;
	if (!wasm?.Suspending) {
		return false;
	}
	try {
		new wasm.Memory({ address: 'i64', initial: BigInt(1) });
		return true;
	}
	catch {
		return false;
	}
}

function importWllama():Promise<WllamaModule> {
	// Its package names no entry point that exists, so the built module is named outright.
	return (import('@wllama/wllama/esm/index.js' as string) as Promise<WllamaModule>).catch(() => {
		throw new Error('BrowserProvider needs @wllama/wllama installed');
	});
}
