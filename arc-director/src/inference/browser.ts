import { stripTemplateTokens, type ModelSettings } from './http.js';
import { ModelDownload, type DownloadProgress } from './download.js';
import { SchemaGrammar, type SchemaConstraint, type TokenizerJSON } from './grammar.js';
import { chatContentText, samplingOf, type ChatMessage, type ChatRequest, type ChatResponse, type InferenceProvider } from './provider.js';

/** Gemma 4 E4B: the best Arcs of any model small enough to run in a browser. */
export const DEFAULT_BROWSER_MODEL = 'onnx-community/gemma-4-E4B-it-ONNX';

/**
 * What this provider uses of transformers.js. Hosts without it installed must not need its types, and the
 * declarations the library emits never name it.
 */
type Transformers = {
	AutoTokenizer:{ from_pretrained(repo:string, opts:LoadOpts):Promise<Tokenizer> };
	AutoConfig:{ from_pretrained(repo:string, opts:{ revision:string }):Promise<Record<string, unknown>> };
	AutoModelForCausalLM:{ from_pretrained(repo:string, opts:LoadOpts & { device:string; dtype:Dtype }):Promise<Model> };
	ModelRegistry:{
		is_cached_files(repo:string, opts:{ revision:string; dtype:Dtype }):Promise<{ files:{ file:string; cached:boolean }[] }>;
		clear_cache(repo:string, opts:{ revision:string; dtype:Dtype }):Promise<unknown>;
	};
	InterruptableStoppingCriteria:new ()=>{ interrupt():void };
};

/** The precision weights load in: one for every file, or one per file (`embed_tokens`, `decoder_model_merged`, …). */
type Dtype = string | Record<string, string>;

type LoadOpts = {
	revision:string;
	progress_callback:(info:{ status:string; progress?:number; loaded?:number; total?:number })=>void;
};

export type Tensor = {
	type:string;
	dims:number[];
	data:ArrayLike<number>;
	to(type:'float32'):Tensor;
	tolist():unknown[];
};

export type LogitsProcessor = (ids:bigint[][], logits:Tensor)=>Tensor;

export type Tokenizer = {
	apply_chat_template(messages:{ role:string; content:string }[], opts:Record<string, unknown>):{ input_ids:Tensor; attention_mask:Tensor };
	encode(text:string, opts:{ add_special_tokens:boolean }):number[];
	decode(ids:number[], opts:{ skip_special_tokens:boolean }):string;
	all_special_tokens:string[];
};

type Model = {
	config:{ vocab_size?:number; text_config?:{ vocab_size?:number } };
	generation_config?:{ eos_token_id?:number | number[] | null };
	generate(opts:Record<string, unknown>):Promise<Tensor>;
	dispose():Promise<unknown>;
};

type Loaded = {
	model:string;
	id:ModelID;
	tokenizer:Tokenizer;
	engine:Model;
	/** Made on the first reply with a schema. */
	grammar?:Promise<SchemaGrammar>;
};

/** A model's Hugging Face repo and the revision it loads at. */
export type ModelID = { repo:string; revision:string };

/** Output tokens when a request names no cap: room to think, then answer. */
const DEFAULT_MAX_TOKENS = 2048;

/**
 * Models that run in the page on the GPU (WebGPU), through transformers.js: `@huggingface/transformers`, an optional
 * peer dependency imported on first use, with xgrammar (`@mlc-ai/web-xgrammar`, {@link SchemaGrammar}) holding replies
 * to their schema. A model is a Hugging Face repo of ONNX weights ({@link modelID}), {@link DEFAULT_BROWSER_MODEL}
 * unless told otherwise; set transformers.js's `env.remoteHost` to load them from elsewhere. It holds one model at a
 * time, so loading another unloads it, and the browser keeps every download, so a second load reads from disk.
 * {@link shared} is the page's one, so a loaded model outlives each director.
 */
export class BrowserProvider implements InferenceProvider {
	private static _shared:BrowserProvider | undefined;
	private readonly _settings = new Map<string, ModelSettings>();
	private readonly _downloads = new Map<string, ModelDownload>();
	/** Loads, chats and deletes, one at a time: the GPU runs one model, one request at a time. */
	private _queue:Promise<unknown> = Promise.resolve();
	private _loaded:Loaded | null = null;

	/** The page's provider: `ArcDirector.addBrowserModel` uses it unless given another. */
	public static get shared():BrowserProvider {
		BrowserProvider._shared ??= new BrowserProvider();
		return BrowserProvider._shared;
	}

	public static set shared(provider:BrowserProvider) {
		BrowserProvider._shared = provider;
	}

	/**
	 * Why models cannot run in this browser, or null when they can: it has no WebGPU, or WebGPU gives it no GPU
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
		return this._loaded?.model ?? null;
	}

	/** Whether `model` is downloaded already, so loading it needs no network. */
	public async isCached(model:string):Promise<boolean> {
		const id = modelID(model);
		const { files } = await (await importTransformers()).ModelRegistry.is_cached_files(id.repo, { revision: id.revision, dtype: await dtypeOf(id) });
		const needed = files.filter((f) => !UNUSED_FILES.test(f.file));
		return needed.length > 0 && needed.every((f) => f.cached);
	}

	/**
	 * Downloads `model` unless the browser has it, then loads it on the GPU in place of the last one. Asking again
	 * while it downloads, or once it is loaded, returns the same download.
	 */
	public download(model:string = DEFAULT_BROWSER_MODEL):ModelDownload {
		const known = this._downloads.get(model);
		if (known && (known.state === 'pending' || (known.state === 'done' && this._loaded?.model === model))) {
			return known;
		}
		const download = new ModelDownload(async (report) => {
			await this.run(() => this.load(model, report));
		});
		this._downloads.set(model, download);
		return download;
	}

	/** Deletes `model`'s download from the browser, unloading it first if it is on the GPU. */
	public delete(model:string):Promise<void> {
		return this.run(async () => {
			if (this._loaded?.model === model) {
				await this.unload();
			}
			this._downloads.delete(model);
			const id = modelID(model);
			await (await importTransformers()).ModelRegistry.clear_cache(id.repo, { revision: id.revision, dtype: await dtypeOf(id) });
		});
	}

	public configureModel(model:string, settings:ModelSettings):void {
		this._settings.set(model, { ...settings });
	}

	public forgetModel(model:string):void {
		this._settings.delete(model);
	}

	public chat(req:ChatRequest):Promise<ChatResponse> {
		return this.run(async () => {
			req.signal?.throwIfAborted();
			// Another model may have loaded since this one's download.
			const loaded = await this.load(req.model);
			const { tokenizer, engine } = loaded;
			const transformers = await importTransformers();
			const settings = this._settings.get(req.model);
			const thinking = req.enableThinking ?? settings?.enableThinking ?? false;
			const inputs = tokenizer.apply_chat_template(textMessages(req.messages), {
				add_generation_prompt: true,
				return_dict: true,
				enable_thinking: thinking,
			});
			const prompt = inputs.input_ids.dims[1];
			// A template may open the thought itself, so the reply holds only its close.
			const tail = tokenizer.decode((inputs.input_ids.tolist()[0] as bigint[]).slice(-8).map(Number), { skip_special_tokens: false }).trimEnd();
			const opened = thinking ? THOUGHTS.find(({ open }) => tail.endsWith(open))?.open : undefined;
			// A 16-bit model scores in 16 bits; the schema forbids a token by setting its score to -Infinity, which needs 32.
			const processors:LogitsProcessor[] = [(_ids, logits) => (logits.type === 'float32' ? logits : logits.to('float32'))];
			let constraint:SchemaConstraint | undefined;
			if (req.responseFormat) {
				loaded.grammar ??= grammarFor(tokenizer, engine);
				// Fed only the answer's tokens, so it starts at 0 whether or not a thought came first.
				constraint = await (await loaded.grammar).constrain(req.responseFormat.schema, 0);
				processors.push(thinking ? afterThought(constraint, tokenizer, prompt, opened) : (ids, logits) => constraint!.process([ids[0].slice(prompt)], logits));
			}
			const n = req.topLogprobs;
			let logprobs:Record<string, number> | undefined;
			if (n) {
				processors.push((_ids, logits) => {
					logprobs ??= topLogprobs(logits, n, tokenizer);
					return logits;
				});
			}
			const stop = new transformers.InterruptableStoppingCriteria();
			const interrupt = ():void => stop.interrupt();
			const budget = thinking ? settings?.thinkingBudget : undefined;
			let cut = false;
			if (budget !== undefined) {
				processors.push((ids, logits) => {
					const made = ids[0].length - prompt;
					if (!cut && made > budget && made % 8 === 0 && inThought(tokenizer.decode(ids[0].slice(prompt).map(Number), { skip_special_tokens: false }), opened)) {
						cut = true;
						stop.interrupt();
					}
					return logits;
				});
			}
			req.signal?.addEventListener('abort', interrupt);
			const maxTokens = req.maxTokens ?? DEFAULT_MAX_TOKENS;
			try {
				const { temperature = 0, topP, topK } = samplingOf(settings?.sampling, req.sampling);
				const out = await engine.generate({
					...inputs,
					max_new_tokens: maxTokens,
					do_sample: temperature > 0,
					...temperature > 0 ? { temperature, top_p: topP, top_k: topK } : {},
					logits_processor: processors,
					stopping_criteria: [stop],
				});
				req.signal?.throwIfAborted();
				const ids = (out.tolist()[0] as bigint[]).slice(prompt).map(Number);
				// Decoded whole, so a thought's markers still show where it ends; the answer then loses its own.
				const { content, reasoning } = splitThought(tokenizer.decode(ids, { skip_special_tokens: false }));
				return {
					content: content && (withoutTokens(content, tokenizer.all_special_tokens).trim() || null),
					reasoning,
					toolCalls: [],
					truncated: cut || ids.length >= maxTokens,
					logprobs,
				};
			}
			finally {
				req.signal?.removeEventListener('abort', interrupt);
				constraint?.dispose();
			}
		});
	}

	private run<T>(job:()=>Promise<T>):Promise<T> {
		const next = this._queue.then(job, job);
		this._queue = next.catch(() => undefined);
		return next;
	}

	/** `model` on the GPU, loading it in place of the last one unless it is there already. */
	private async load(model:string, report?:(progress:DownloadProgress)=>void):Promise<Loaded> {
		if (this._loaded?.model === model) {
			return this._loaded;
		}
		await this.unload();
		const id = modelID(model);
		const transformers = await importTransformers();
		const opts:LoadOpts = {
			revision: id.revision,
			progress_callback: (info) => {
				if (info.status === 'progress_total' && info.progress !== undefined) {
					report?.({ progress: info.progress / 100, text: info.progress < 100 ? `Downloading ${gb(info.loaded)} of ${gb(info.total)} GB` : 'Loading on the GPU' });
				}
			},
		};
		const tokenizer = await transformers.AutoTokenizer.from_pretrained(id.repo, opts);
		const engine = await transformers.AutoModelForCausalLM.from_pretrained(id.repo, { ...opts, device: 'webgpu', dtype: await dtypeOf(id) });
		this._loaded = { model, id, tokenizer, engine };
		return this._loaded;
	}

	private async unload():Promise<void> {
		const loaded = this._loaded;
		this._loaded = null;
		(await loaded?.grammar?.catch(() => undefined))?.dispose();
		await loaded?.engine.dispose();
	}
}

/** The grammar a model's replies with a schema are held to: its vocabulary, every token it scores, and where it stops. */
function grammarFor(tokenizer:Tokenizer, engine:Model):Promise<SchemaGrammar> {
	const vocabSize = engine.config.vocab_size ?? engine.config.text_config?.vocab_size;
	const eos = engine.generation_config?.eos_token_id;
	if (vocabSize === undefined) {
		throw new Error('This model has no vocab_size in its config, so its replies cannot be held to a schema');
	}
	// The tokenizer.json transformers.js keeps on each tokenizer; its own structured output reads it the same way.
	const json = (tokenizer as Tokenizer & Record<string, unknown>)['_tokenizerJSON'] as TokenizerJSON;
	return SchemaGrammar.create(json, vocabSize, eos === null || eos === undefined ? [] : [eos].flat());
}

/**
 * Files a text-only load never fetches: a multimodal model's encoders and image or audio processing. transformers.js
 * lists them for its repo all the same.
 */
const UNUSED_FILES = /(^|\/)(vision_encoder|audio_encoder|embed_vision|embed_audio)[^/]*$|(^|\/)(preprocessor|processor|video_preprocessor)_config\.json$/;

/**
 * `model` as a Hugging Face repo and revision: `org/repo`, `org/repo@<commit>` (so that commit is what loads),
 * `hf://org/repo`, or the repo's page (`…/tree/<commit>`, `…/resolve/<commit>`).
 */
export function modelID(model:string):ModelID {
	const match = /^(?:hf:\/\/|https:\/\/(?:huggingface\.co|hf\.co)\/)?([\w.-]+\/[\w.-]+)(?:@([\w.-]+)|\/(?:tree|resolve|blob)\/([^/]+))?\/*$/.exec(model);
	if (!match) {
		throw new Error(`'${model}' is not a Hugging Face repo (org/repo)`);
	}
	return { repo: match[1], revision: match[2] ?? match[3] ?? 'main' };
}

/**
 * `messages` as a chat template takes them: text only, one system message and only first, no tool turns. Minds that
 * read tool results as written text never send tool turns to a model without native tools anyway.
 */
export function textMessages(messages:ChatMessage[]):{ role:string; content:string }[] {
	return messages.map((m, i) => {
		const content = chatContentText(m.content);
		if (m.role === 'system' && i === 0) {
			return { role: 'system', content };
		}
		if (m.role === 'assistant') {
			return { role: 'assistant', content };
		}
		return { role: 'user', content };
	});
}

/** Each way a model marks its thought: Gemma 4's thought channel, and the `<think>` tags of most others. */
const THOUGHTS = [
	{ open: '<|channel>thought', close: '<channel|>' },
	{ open: '<think>', close: '</think>' },
];

/**
 * A reply as the model wrote it, its thought split off and its template tokens gone. A template may open the thought
 * itself, so a close alone ends one; a thought cut off before its close is all thought.
 */
export function splitThought(text:string):{ content:string | null; reasoning?:string } {
	for (const { open, close } of THOUGHTS) {
		const start = text.indexOf(open);
		const end = text.indexOf(close);
		if (start < 0 && end < 0) {
			continue;
		}
		const from = start >= 0 && (end < 0 || start < end) ? start + open.length : 0;
		const thought = (end < 0 ? text.slice(from) : text.slice(from, end)).trim();
		const answer = end < 0 ? null : stripTemplateTokens(text.slice(end + close.length));
		return thought ? { content: answer, reasoning: thought } : { content: answer };
	}
	return { content: stripTemplateTokens(text) };
}

/**
 * Whether `text`, a reply so far, is still inside its thought: one it opened, or the template did (`opened`, that
 * open marker), and has not yet closed.
 */
export function inThought(text:string, opened?:string):boolean {
	return THOUGHTS.some(({ open, close }) => (opened === open || text.includes(open)) && !text.includes(close));
}

/**
 * `constraint` on the answer after a thought, as servers hold reasoning models to a schema. A reply opened by the
 * template (`opened`) is thought until it closes. Otherwise its first token may start the answer or a thought's open
 * marker, whose rest is then forced. Once the thought closes, the grammar holds every later token.
 */
export function afterThought(constraint:SchemaConstraint, tokenizer:Tokenizer, prompt:number, opened:string | undefined):LogitsProcessor {
	const openers = opened ? [] : THOUGHTS.map(({ open }) => tokenizer.encode(open, { add_special_tokens: false })).filter((ids) => ids.length > 0);
	const closes = THOUGHTS.map(({ close }) => close);
	/** Where the answer starts in the reply; undefined while thinking or not yet known. */
	let from:number | undefined;
	return (ids, logits) => {
		const reply = ids[0].slice(prompt);
		if (from === undefined && !opened) {
			const opener = openers.find((o) => reply.every((id, i) => i >= o.length || Number(id) === o[i]));
			if (!opener) {
				from = 0;
			}
			else if (reply.length === 0) {
				// The answer's first tokens, or a thought's.
				const scores = logits.data as Float32Array;
				const base = scores.length - logits.dims[logits.dims.length - 1];
				const kept = openers.map((o) => scores[base + o[0]]);
				constraint.process([reply], logits);
				openers.forEach((o, i) => scores[base + o[0]] = kept[i]);
				return logits;
			}
			else if (reply.length < opener.length) {
				return onlyToken(logits, opener[reply.length]);
			}
		}
		if (from === undefined) {
			const recent = tokenizer.decode(reply.slice(-8).map(Number), { skip_special_tokens: false });
			if (!closes.some((close) => recent.includes(close))) {
				return logits;
			}
			from = reply.length;
		}
		return constraint.process([reply.slice(from)], logits);
	};
}

/** `logits` with every token but `id` refused. */
function onlyToken(logits:Tensor, id:number):Tensor {
	const scores = logits.data as Float32Array;
	const vocab = logits.dims[logits.dims.length - 1];
	const base = scores.length - vocab;
	const keep = scores[base + id];
	scores.fill(-Infinity, base);
	scores[base + id] = keep;
	return logits;
}

/** `text` without any of `tokens`: a model's end-of-turn and other special tokens. */
export function withoutTokens(text:string, tokens:readonly string[]):string {
	return tokens.reduce((rest, token) => rest.split(token).join(''), text);
}

/** The `n` likeliest first tokens, each (trimmed) to its log probability. */
function topLogprobs(logits:Tensor, n:number, tokenizer:Tokenizer):Record<string, number> {
	const scores = logits.to('float32').data;
	const vocab = logits.dims[logits.dims.length - 1];
	const offset = scores.length - vocab;
	let max = -Infinity;
	for (let i = 0; i < vocab; i++) {
		max = Math.max(max, scores[offset + i]);
	}
	let sum = 0;
	for (let i = 0; i < vocab; i++) {
		sum += Math.exp(scores[offset + i] - max);
	}
	const norm = max + Math.log(sum);
	const best:number[] = [];
	for (let i = 0; i < vocab; i++) {
		if (best.length < n || scores[offset + i] > scores[offset + best[best.length - 1]]) {
			best.push(i);
			best.sort((a, b) => scores[offset + b] - scores[offset + a]);
			best.length = Math.min(best.length, n);
		}
	}
	const out:Record<string, number> = {};
	for (const i of best) {
		const token = tokenizer.decode([i], { skip_special_tokens: false }).trim();
		out[token] = Math.max(out[token] ?? -Infinity, scores[offset + i] - norm);
	}
	return out;
}

function gb(bytes:number | undefined):string {
	return ((bytes ?? 0) / 1e9).toFixed(1);
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

/**
 * The weights to load: those the repo names for transformers.js (a build may hold only some precisions, file by
 * file), else 4-bit with 16-bit math where the GPU runs 16-bit shaders, or 4-bit alone. Without a GPU to ask, the
 * 16-bit ones, the build most likely downloaded, so it can still be found and deleted.
 */
async function dtypeOf(id:ModelID):Promise<Dtype> {
	const config = await (await importTransformers()).AutoConfig.from_pretrained(id.repo, { revision: id.revision }).catch(() => undefined);
	const named = (config?.['transformers.js_config'] as { dtype?:Dtype } | undefined)?.dtype;
	return named ?? ((await gpuAdapter())?.features.has('shader-f16') ?? true ? 'q4f16' : 'q4');
}

function importTransformers():Promise<Transformers> {
	return (import('@huggingface/transformers') as Promise<unknown> as Promise<Transformers>).catch(() => {
		throw new Error('BrowserProvider needs @huggingface/transformers installed');
	});
}
