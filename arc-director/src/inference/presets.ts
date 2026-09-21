import { HttpProvider, serverRoot, type HttpProviderConfig } from './http.js';
import {
	PREFERRED_MODELS,
	fetchModelCatalog,
	isVisionModel,
	pickSingleChatModel,
	type ModelInfo,
} from './models.js';
import { FakeProvider, goToNamedInteractable, type FakeChatFn } from './fake.js';
import type { InferenceProvider } from './provider.js';

export const LM_STUDIO_URL = 'http://127.0.0.1:1234/v1';
export const OLLAMA_URL = 'http://127.0.0.1:11434/v1';

export const LM_STUDIO_LOAD = {
	flashAttention: true,
	offloadKvCacheToGpu: true,
	evalBatchSize: 512,
} as const;

export type HttpInferenceOpts = HttpProviderConfig & {
	model?:string;
	/**
	 * Buffer new thinks while any generation is in flight, then start a wave.
	 * Same as `withPriorityQueue({ batchThinks })`. Used when the queue omits it.
	 */
	batchThinks?:boolean;
	/** Seconds (`tick`'s `now`) to wait for idle before starting anyway. Default 20. */
	batchWait?:number;
};

export type ConnectedHttp = {
	provider:HttpProvider;
	model:string;
	catalog:ModelInfo[];
	vision:boolean;
	baseURL:string;
};

export function lmStudioConfig(opts:HttpInferenceOpts = {}):HttpInferenceOpts {
	return {
		baseURL: opts.baseURL ?? LM_STUDIO_URL,
		timeoutMs: opts.timeoutMs ?? 60_000,
		enableThinking: opts.enableThinking ?? false,
		maxTokens: opts.maxTokens,
		load: opts.load ?? { ...LM_STUDIO_LOAD },
		apiKey: opts.apiKey,
		fetch: opts.fetch,
		reasoningEffort: opts.reasoningEffort,
		applyPromptTemplate: opts.applyPromptTemplate,
		onRequest: opts.onRequest,
		batchThinks: opts.batchThinks,
		batchWait: opts.batchWait,
	};
}

export function ollamaConfig(opts:HttpInferenceOpts = {}):HttpInferenceOpts {
	return {
		baseURL: opts.baseURL ?? OLLAMA_URL,
		timeoutMs: opts.timeoutMs ?? 60_000,
		enableThinking: opts.enableThinking ?? false,
		maxTokens: opts.maxTokens,
		load: opts.load,
		apiKey: opts.apiKey,
		fetch: opts.fetch,
		reasoningEffort: opts.reasoningEffort,
		applyPromptTemplate: opts.applyPromptTemplate,
		onRequest: opts.onRequest,
		batchThinks: opts.batchThinks,
		batchWait: opts.batchWait,
	};
}

export async function connectHttpInference(
	config:HttpProviderConfig,
	requested?:string,
):Promise<ConnectedHttp> {
	const provider = new HttpProvider(config);
	const catalog = await fetchModelCatalog(provider.rootURL);
	const model = pickSingleChatModel(catalog, PREFERRED_MODELS, requested);
	if (!model) {
		throw new Error(`ArcDirector: no model at ${provider.baseURL}`);
	}
	const row = catalog.find((m) => m.id === model)
		?? catalog.find((m) => m.id.endsWith(model) || m.id.includes(model));
	const vision = isVisionModel(row ?? model);
	return { provider, model, catalog, vision, baseURL: provider.baseURL };
}

export function fakeInference(chat?:FakeChatFn):InferenceProvider {
	return new FakeProvider(chat ?? goToNamedInteractable());
}

export { serverRoot };
