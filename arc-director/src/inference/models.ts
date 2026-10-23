import { isRecord } from '../json.js';
import type { Sampling } from './provider.js';

export type ThinkOff = 'no_think' | 'strength';

export type ModelTier = {
	id:string;
	thinking?:boolean;
	/** How to shrink CoT when `enableThinking` is false. Default `no_think`. */
	thinkOff?:ThinkOff;
};

/** Think-off hints. Not a model preference; `modelGrade` picks the default. */
export const MODEL_TIERS:ModelTier[] = [
	/** Harmony think-off. Not chosen unless a catalog id contains this string. */
	{ id: 'harmony/think-off', thinking: true, thinkOff: 'strength' },
];

export const PREFERRED_MODELS = MODEL_TIERS
	.filter((t) => t.thinkOff !== 'strength')
	.map((t) => t.id);

/** Public LM Studio reasoning settings. Sending any other value errors. */
export const REASONING_OPTIONS = ['off', 'on', 'low', 'medium', 'high'] as const;
export type ReasoningOption = typeof REASONING_OPTIONS[number];

export type ModelInfo = {
	id:string;
	state?:string;
	type?:string;
	loaded?:boolean;
	/** Host/catalog: this id accepts image parts. `false` wins over the id heuristic. */
	vision?:boolean;
	/** From `capabilities.reasoning`. Absent when the catalog does not expose it. */
	reasoning?:{
		allowed:ReasoningOption[];
		default?:ReasoningOption;
	};
	/** File size, from the native catalog. */
	sizeBytes?:number;
	/** How many parameters, as the native catalog writes it: `421M`, `4B`, `26B-A4B` (26 billion, 4 billion active). */
	params?:string;
	/** From `capabilities.trained_for_tool_use`. */
	toolUse?:boolean;
	/** The native catalog's `architecture` (`gemma4`, `modern-bert`). */
	architecture?:string;
	/** The most context the model takes, from the native catalog. */
	maxContextLength?:number;
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
	if (matchingTier(id)?.thinking === true) {
		return true;
	}
	return thinkOffMode(id) === 'no_think';
}

export function thinkOffMode(id:string):ThinkOff | undefined {
	const row = matchingTier(id);
	if (row?.thinking) {
		return row.thinkOff ?? 'no_think';
	}
	if (row) {
		return undefined;
	}
	// Hybrid Qwen3 takes /no_think; its Instruct and Thinking splits (2507 on) never or always think, and ignore it.
	if (/qwen3|qwq/i.test(id) && !/instruct|thinking/i.test(id)) {
		return 'no_think';
	}
	return undefined;
}

/**
 * Whether `id`'s template opens a think block on every reply, whatever `enable_thinking` says: Qwen3's Thinking split
 * (2507 on) and QwQ. With thinking off, only a closed think block before its answer keeps it from thinking.
 */
export function alwaysThinks(id:string):boolean {
	return /qwq|qwen3.*thinking/i.test(id);
}

/**
 * What each family's makers say to sample it with, first match wins. Qwen3 splits by reasoning: its thinking mode
 * runs cooler and wider than its instruct mode. Fine-tunes keep their base's settings.
 */
const RECOMMENDED_SAMPLING:{ match:RegExp; thinking?:boolean; sampling:Sampling }[] = [
	{ match: /gemma/i, sampling: { temperature: 1, topP: 0.95, topK: 64 } },
	{ match: /qwq/i, sampling: { temperature: 0.6, topP: 0.95, topK: 40 } },
	{ match: /qwen3.*instruct/i, sampling: { temperature: 0.7, topP: 0.8, topK: 20 } },
	{ match: /qwen3/i, thinking: false, sampling: { temperature: 0.7, topP: 0.8, topK: 20 } },
	{ match: /qwen3/i, sampling: { temperature: 0.6, topP: 0.95, topK: 20 } },
	{ match: /qwen2\.5/i, sampling: { temperature: 0.7, topP: 0.8, topK: 20 } },
	{ match: /gpt-oss/i, sampling: { temperature: 1, topP: 1 } },
	{ match: /deepseek-r1/i, sampling: { temperature: 0.6, topP: 0.95 } },
	{ match: /magistral/i, sampling: { temperature: 0.7, topP: 0.95 } },
	{ match: /mistral-small|devstral/i, sampling: { temperature: 0.15 } },
	{ match: /llama-?3/i, sampling: { temperature: 0.6, topP: 0.9 } },
	{ match: /phi-?4.*reasoning/i, sampling: { temperature: 0.8, topP: 0.95, topK: 50 } },
];

/**
 * The sampling `id`'s makers recommend, reasoning or not (Qwen3 differs by mode); `undefined` for a family this
 * library does not know. What a model spec without `sampling` runs with.
 */
/**
 * Whether `id` was trained on ArcDirector's own prompts (a Skaldic model). Such a model only ever read the compact
 * prompt and wrote JSON Arcs, so its minds get just those, whatever the host asks.
 */
export function trainedOnArcDirector(id:string):boolean {
	return /skaldic/i.test(id);
}

export function recommendedSampling(id:string, thinking?:boolean):Sampling | undefined {
	const reasons = alwaysThinks(id) || thinking === true;
	const row = RECOMMENDED_SAMPLING.find((r) => r.match.test(id) && (r.thinking === undefined || r.thinking === reasons));
	return row && { ...row.sampling };
}

export function isLoadedModel(model:ModelInfo):boolean {
	if (model.loaded === true) {
		return true;
	}
	const state = model.state?.toLowerCase();
	return state === 'loaded' || state === 'ready';
}

function isReasoningOption(value:unknown):value is ReasoningOption {
	return typeof value === 'string' && (REASONING_OPTIONS as readonly string[]).includes(value);
}

function rowReasoning(row:Record<string, unknown>):ModelInfo['reasoning'] {
	const caps = isRecord(row.capabilities) ? row.capabilities : {};
	const raw = isRecord(caps.reasoning) ? caps.reasoning
		: isRecord(row.reasoning) ? row.reasoning : undefined;
	if (!raw) {
		return undefined;
	}
	const allowed = Array.isArray(raw.allowed_options)
		? raw.allowed_options.filter(isReasoningOption)
		: [];
	if (allowed.length === 0) {
		return undefined;
	}
	return {
		allowed,
		default: isReasoningOption(raw.default) ? raw.default : undefined,
	};
}

/** Pick a listed option. `prefer` is used when thinking is on (`low` if allowed). */
export function pickReasoningOption(
	allowed:ReasoningOption[] | undefined,
	thinking:boolean,
	prefer?:ReasoningOption,
):ReasoningOption | undefined {
	if (!allowed || allowed.length === 0) {
		return undefined;
	}
	if (!thinking) {
		return allowed.includes('off') ? 'off' : undefined;
	}
	if (prefer && allowed.includes(prefer)) {
		return prefer;
	}
	if (allowed.includes('low')) {
		return 'low';
	}
	if (allowed.includes('on')) {
		return 'on';
	}
	return undefined;
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
	const fromData = asChatCompletionsList(payload);
	if (fromData.length > 0) {
		return fromData;
	}
	return asNativeList(payload);
}

function asChatCompletionsList(payload:unknown):ModelInfo[] {
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
			reasoning: rowReasoning(row),
		});
	}
	return out;
}

function asNativeList(payload:unknown):ModelInfo[] {
	if (!isRecord(payload) || !Array.isArray(payload.models)) {
		return [];
	}
	const out:ModelInfo[] = [];
	for (const row of payload.models) {
		if (!isRecord(row)) {
			continue;
		}
		const id = typeof row.key === 'string' ? row.key
			: typeof row.id === 'string' ? row.id : '';
		if (!id) {
			continue;
		}
		const instances = Array.isArray(row.loaded_instances) ? row.loaded_instances : [];
		const caps = isRecord(row.capabilities) ? row.capabilities : {};
		out.push({
			id,
			type: typeof row.type === 'string' ? row.type : undefined,
			loaded: instances.length > 0,
			vision: typeof caps.vision === 'boolean' ? caps.vision : rowVision(row),
			reasoning: rowReasoning(row),
			sizeBytes: typeof row.size_bytes === 'number' ? row.size_bytes : undefined,
			params: typeof row.params_string === 'string' ? row.params_string : undefined,
			toolUse: typeof caps.trained_for_tool_use === 'boolean' ? caps.trained_for_tool_use : undefined,
			architecture: typeof row.architecture === 'string' ? row.architecture : undefined,
			maxContextLength: typeof row.max_context_length === 'number' ? row.max_context_length : undefined,
		});
	}
	return out;
}

function matchesName(model:ModelInfo, name:string):boolean {
	return modelIDsMatch(model.id, name);
}

export function modelIDsMatch(id:string, name:string):boolean {
	if (id === name) {
		return true;
	}
	return id.endsWith(name) || name.endsWith(id) || id.includes(name) || name.includes(id);
}

/** The catalog row `name` means: exactly that id, else a close spelling of it. */
export function findModel(pool:ModelInfo[], name:string):ModelInfo | undefined {
	return pool.find((m) => m.id === name) ?? pool.find((m) => matchesName(m, name));
}

/** A decision model (LM Studio's `decision` type): it answers through the server's System One endpoint, not chat. */
export function isDecisionModel(model:ModelInfo):boolean {
	return model.type === 'decision';
}

/** An encoder (BERT and kin) only scores or embeds; a chat server cannot make it answer. */
export function isEncoderModel(model:ModelInfo):boolean {
	return /bert|encoder/i.test(model.architecture ?? '');
}

/** Higher is a better default. Active params near 4B, then total size near `targetB` (20). */
export function modelGrade(id:string, targetB = 20):number {
	const active = Number(id.match(/\W[ae](\d+)b(?:-|$)/i)?.[1]);
	const total = Number(id.match(/(?:^|\W)(\d+)b(?:-|$)/i)?.[1]);
	return (Number.isFinite(active) ? -Math.abs(active - 4) : -8)
		+ (Number.isFinite(total) ? -Math.abs(total - targetB) / 10 : -4);
}

/**
 * One chat model only. An explicit `requested` id wins if it is in the catalog
 * (loading it may unload whatever is in VRAM). Otherwise stay on a loaded
 * model. Within that set — or the full catalog when load state is unknown —
 * `modelGrade` picks the default.
 */
export function pickSingleChatModel(
	models:ModelInfo[],
	preferred:string[] = PREFERRED_MODELS,
	requested?:string,
):string | undefined {
	const chat = models.filter((m) => !isEmbeddingModel(m) && !isEncoderModel(m));
	const loaded = chat.filter(isLoadedModel);
	const pool = loaded.length > 0 ? loaded : chat;
	if (requested) {
		const hit = findModel(chat, requested) ?? findModel(pool, requested);
		if (hit) {
			return hit.id;
		}
	}
	return pool.slice().sort((a, b) => modelGrade(b.id) - modelGrade(a.id))[0]?.id;
}

function catalogURLs(root:string):string[] {
	const r = root.replace(/\/+$/, '');
	return [`${r}/api/v1/models`, `${r}/api/v0/models`, `${r}/v1/models`];
}

/** Native `/api/v0/models` includes `state`; `/v1/models` often does not. */
export async function fetchModelCatalog(
	root:string,
	opts:{ timeoutMs?:number; headers?:Record<string, string>; fetch?:typeof fetch } = {},
):Promise<ModelInfo[]> {
	const timeoutMs = opts.timeoutMs ?? 4000;
	const get = opts.fetch ?? fetch;
	let fallback:ModelInfo[] = [];
	for (const url of catalogURLs(root)) {
		try {
			const res = await get(url, {
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
