import type { ArcDirector } from '../director/ArcDirector.js';
import { ModelProvider, providerShortcuts, type ProviderConfig } from '../director/ModelProvider.js';
import { HttpProvider, type HttpProviderConfig } from './http.js';
import { fetchModelCatalog, pickSingleChatModel, PREFERRED_MODELS, type ModelInfo } from './models.js';

export const LM_STUDIO_URL = 'http://127.0.0.1:1234/v1';
export const OLLAMA_URL = 'http://127.0.0.1:11434/v1';

export const LM_STUDIO_LOAD = {
	flashAttention: true,
	offloadKvCacheToGpu: true,
	evalBatchSize: 512,
} as const;

export function lmStudioConfig(opts:HttpProviderConfig = {}):HttpProviderConfig {
	return { ...opts, baseURL: opts.baseURL ?? LM_STUDIO_URL, timeoutMs: opts.timeoutMs ?? 60_000, enableThinking: opts.enableThinking ?? false, load: opts.load ?? { ...LM_STUDIO_LOAD } };
}

export function ollamaConfig(opts:HttpProviderConfig = {}):HttpProviderConfig {
	return { ...opts, baseURL: opts.baseURL ?? OLLAMA_URL, timeoutMs: opts.timeoutMs ?? 60_000, enableThinking: opts.enableThinking ?? false };
}

/** What `addHttp`, `addLMStudio` and `addOllama` take. `enableThinking` and `load.contextLength` are its models' defaults. */
export type HttpConfig = HttpProviderConfig & ProviderConfig;

/**
 * Any OpenAI-compatible chat server (`addHttp`). It lists its models, so a spec may name one loosely, and one without
 * an id runs its best loaded chat model; a decision model on it answers at its `/systemone`.
 */
export class Http extends ModelProvider<HttpProvider> {
	constructor(private readonly _config:HttpConfig = {}, kind = 'http') {
		super(_config.name ?? kind, new HttpProvider(_config), _config);
		this.defaults = { thinking: _config.enableThinking === true, contextLength: _config.load?.contextLength };
		this.systemOneURL = `${this.transport.baseURL}/systemone`;
	}

	protected override catalog():Promise<ModelInfo[]> {
		const { apiKey, fetch } = this._config;
		return fetchModelCatalog(this.transport.rootURL, { fetch, headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined });
	}

	protected override defaultID(catalog:ModelInfo[]):string | undefined {
		return pickSingleChatModel(catalog, PREFERRED_MODELS);
	}
}

/** LM Studio (`addLMStudio`): at {@link LM_STUDIO_URL} unless `baseURL` says, loading models with flash attention. */
export class LMStudio extends Http {
	constructor(config:HttpConfig = {}) {
		super(lmStudioConfig(config), 'lmstudio');
	}
}

/** Ollama (`addOllama`): at {@link OLLAMA_URL} unless `baseURL` says. */
export class Ollama extends Http {
	constructor(config:HttpConfig = {}) {
		super(ollamaConfig(config), 'ollama');
	}
}

declare module '../director/ArcDirector.js' {
	interface ArcDirector<TCtx, TEntity> {
		/** {@link LMStudio}: `addLMStudio({ baseURL, load, models: { main: 'google/gemma-4-e4b' } })`. */
		addLMStudio(config?:HttpConfig):this;
		getLMStudio(name?:string):LMStudio | undefined;
		/** {@link Ollama}. */
		addOllama(config?:HttpConfig):this;
		getOllama(name?:string):Ollama | undefined;
		/** {@link Http}. */
		addHttp(config:HttpConfig):this;
		getHttp(name?:string):Http | undefined;
	}
}
export const { add: addLMStudio, get: getLMStudio } = providerShortcuts(LMStudio, 'lmstudio');
export const { add: addOllama, get: getOllama } = providerShortcuts(Ollama, 'ollama');
export const { add: addHttp, get: getHttp } = providerShortcuts(Http, 'http');
