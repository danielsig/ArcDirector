import { serverRoot, type HttpProviderConfig } from './http.js';
import { FakeProvider, goToNamedInteractable, type FakeChatFn } from './fake.js';
import type { InferenceProvider } from './provider.js';

export const LM_STUDIO_URL = 'http://127.0.0.1:1234/v1';
export const OLLAMA_URL = 'http://127.0.0.1:11434/v1';

export const LM_STUDIO_LOAD = {
	flashAttention: true,
	offloadKvCacheToGpu: true,
	evalBatchSize: 512,
} as const;

/** A chat server. `enableThinking`, `reasoningEffort` and `load.contextLength` are defaults its models may override. */
export type HttpInferenceOpts = HttpProviderConfig;

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
	};
}

export function fakeInference(chat?:FakeChatFn):InferenceProvider {
	return new FakeProvider(chat ?? goToNamedInteractable());
}

export { serverRoot };
