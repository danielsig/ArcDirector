import { envGet } from '../env.js';
import {
	PREFERRED_MODELS,
	fetchModelCatalog,
	pickSingleChatModel,
} from '../inference/models.js';

export { PREFERRED_MODELS } from '../inference/models.js';

const LM_STUDIO_URL = 'http://127.0.0.1:1234/v1';
const OLLAMA_URL = 'http://127.0.0.1:11434/v1';

export async function probeHttp(baseURL:string, timeoutMs = 2500):Promise<boolean> {
	const root = baseURL.replace(/\/+$/, '').replace(/\/v1$/, '');
	const urls = [`${baseURL.replace(/\/+$/, '')}/models`, `${root}/api/tags`];
	for (const url of urls) {
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
			if (res.ok) {
				return true;
			}
		}
		catch {
			continue;
		}
	}
	return false;
}

export function defaultInferenceBaseURL():string {
	return envGet('ARC_DIRECTOR_BASE_URL') ?? envGet('OLLAMA_HOST') ?? LM_STUDIO_URL;
}

export async function resolveInferenceBaseURL():Promise<string> {
	const override = envGet('ARC_DIRECTOR_BASE_URL');
	if (override) {
		return override;
	}
	if (await probeHttp(LM_STUDIO_URL)) {
		return LM_STUDIO_URL;
	}
	if (await probeHttp(OLLAMA_URL)) {
		return OLLAMA_URL;
	}
	return defaultInferenceBaseURL();
}

function authHeaders():Record<string, string> | undefined {
	const key = envGet('ARC_DIRECTOR_API_KEY') ?? envGet('OPENAI_API_KEY');
	return key ? { authorization: `Bearer ${key}` } : undefined;
}

export async function listModelIDs(baseURL:string, timeoutMs = 4000):Promise<string[]> {
	const root = baseURL.replace(/\/+$/, '').replace(/\/v1$/, '');
	const catalog = await fetchModelCatalog(root, { timeoutMs, headers: authHeaders() });
	return catalog.map((m) => m.id);
}

export async function resolveLiveModel(baseURL:string):Promise<string> {
	const requested = envGet('ARC_DIRECTOR_MODEL');
	const root = baseURL.replace(/\/+$/, '').replace(/\/v1$/, '');
	const catalog = await fetchModelCatalog(root, { headers: authHeaders() });
	const picked = pickSingleChatModel(catalog, PREFERRED_MODELS, requested);
	if (picked) {
		return picked;
	}
	return requested ?? '';
}
