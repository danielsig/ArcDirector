import { isRecord } from '../json.js';

export type ThinkOff = 'no_think' | 'effort_low';

export type ModelTier = {
	id:string;
	thinking?:boolean;
	/** How to disable CoT when `enableThinking` is false. */
	thinkOff?:ThinkOff;
};

/** Prefer these when nothing is already loaded. Speed first, then tool-use, then size. */
export const MODEL_TIERS:ModelTier[] = [
	{ id: 'meta/muse-glimmer', thinking: true, thinkOff: 'effort_low' },
	{ id: 'muse-glimmer', thinking: true, thinkOff: 'effort_low' },
	{ id: 'qwen/qwen3.8-27b', thinking: true, thinkOff: 'no_think' },
	{ id: 'qwen3.8-27b', thinking: true, thinkOff: 'no_think' },
	{ id: 'google/gemma-4-31b-qat' },
	{ id: 'gemma-4-31b-qat' },
];

export const PREFERRED_MODELS = MODEL_TIERS.map((t) => t.id);

export type ModelInfo = {
	id:string;
	state?:string;
	type?:string;
	loaded?:boolean;
	/** Host/catalog: this id accepts image parts. `false` wins over the id heuristic. */
	vision?:boolean;
};

export function isVisionModel(model:ModelInfo | string):boolean {
	if (typeof model === 'string') {
		return visionNameHint(model);
	}
	if (model.vision === false) {
		return false;
	}
	if (model.vision === true) {
		return true;
	}
	if (model.type && /vlm|vision/i.test(model.type)) {
		return true;
	}
	return visionNameHint(model.id);
}

function visionNameHint(id:string):boolean {
	return /vlm|\bvision\b|-vl-|llava|moondream|pixtral|internvl|qwen2-vl|qwen2\.5-vl|qwen3-vl/i.test(id);
}

export function isEmbeddingModel(model:ModelInfo):boolean {
	return model.type === 'embeddings' || /embed/i.test(model.id);
}

function matchingTier(id:string):ModelTier | undefined {
	const lower = id.toLowerCase();
	return MODEL_TIERS.find((t) => {
		const name = t.id.toLowerCase();
		return lower === name || lower.endsWith(name) || lower.includes(name);
	});
}

export function isThinkingModel(id:string):boolean {
	return matchingTier(id)?.thinking === true;
}

export function thinkOffMode(id:string):ThinkOff | undefined {
	const row = matchingTier(id);
	if (!row?.thinking) {
		return undefined;
	}
	return row.thinkOff ?? 'no_think';
}

export function isLoadedModel(model:ModelInfo):boolean {
	if (model.loaded === true) {
		return true;
	}
	const state = model.state?.toLowerCase();
	return state === 'loaded' || state === 'ready';
}

function rowVision(row:Record<string, unknown>):boolean | undefined {
	if (typeof row.vision === 'boolean') {
		return row.vision;
	}
	if (isRecord(row.capabilities) && typeof row.capabilities.vision === 'boolean') {
		return row.capabilities.vision;
	}
	const type = typeof row.type === 'string' ? row.type.toLowerCase() : '';
	if (type === 'vlm' || type === 'vision') {
		return true;
	}
	return undefined;
}

export function asModelList(payload:unknown):ModelInfo[] {
	if (!isRecord(payload) || !Array.isArray(payload.data)) {
		return [];
	}
	const out:ModelInfo[] = [];
	for (const row of payload.data) {
		if (!isRecord(row) || typeof row.id !== 'string' || !row.id) {
			continue;
		}
		out.push({
			id: row.id,
			state: typeof row.state === 'string' ? row.state : undefined,
			type: typeof row.type === 'string' ? row.type : undefined,
			loaded: typeof row.loaded === 'boolean' ? row.loaded : undefined,
			vision: rowVision(row),
		});
	}
	return out;
}

function matchesName(model:ModelInfo, name:string):boolean {
	return model.id === name || model.id.endsWith(name) || model.id.includes(name);
}

function findNamed(pool:ModelInfo[], name:string):ModelInfo | undefined {
	return pool.find((m) => matchesName(m, name));
}

/**
 * One chat model only. If anything is already in VRAM, stay on it — requesting
 * a different catalog id can unload the one that is already loaded.
 * Preferred names only rank *within* the loaded set, or the full catalog when
 * the server does not report load state.
 */
export function pickSingleChatModel(
	models:ModelInfo[],
	preferred:string[] = PREFERRED_MODELS,
	requested?:string,
):string | undefined {
	const chat = models.filter((m) => !isEmbeddingModel(m));
	const loaded = chat.filter(isLoadedModel);
	const pool = loaded.length > 0 ? loaded : chat;
	if (requested) {
		const hit = findNamed(pool, requested);
		if (hit) {
			return hit.id;
		}
	}
	for (const pref of preferred) {
		const hit = findNamed(pool, pref);
		if (hit) {
			return hit.id;
		}
	}
	return pool[0]?.id;
}

function catalogURLs(root:string):string[] {
	const r = root.replace(/\/+$/, '');
	return [`${r}/api/v0/models`, `${r}/v1/models`];
}

/** LM Studio `/api/v0/models` includes `state`; OpenAI `/v1/models` does not. */
export async function fetchModelCatalog(
	root:string,
	opts:{ timeoutMs?:number; headers?:Record<string, string> } = {},
):Promise<ModelInfo[]> {
	const timeoutMs = opts.timeoutMs ?? 4000;
	let fallback:ModelInfo[] = [];
	for (const url of catalogURLs(root)) {
		try {
			const res = await fetch(url, {
				headers: opts.headers,
				signal: AbortSignal.timeout(timeoutMs),
			});
			if (!res.ok) {
				continue;
			}
			const list = asModelList(await res.json());
			if (list.length === 0) {
				continue;
			}
			if (list.some(isLoadedModel) || list.some((m) => m.state !== undefined || m.loaded !== undefined)) {
				return list;
			}
			if (fallback.length === 0) {
				fallback = list;
			}
		}
		catch {
			continue;
		}
	}
	return fallback;
}
