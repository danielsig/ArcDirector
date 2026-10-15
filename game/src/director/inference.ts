import { reactive } from 'vue';
import wllamaWasm from '@wllama/wllama/esm/wasm/wllama.wasm?url';
import { BrowserProvider, DEFAULT_BROWSER_MODEL, fittingModel, gpuMemory, type ModelDownload, type ModelSpec, type Sampling } from 'arc-director';
import { prefs, setPrefs, watchPrefs, type InferenceKind, type Prefs } from '../prefs';

/**
 * A model the game offers to run in the browser: its name as `addBrowserModel` takes it, what it costs to download,
 * roughly how much GPU memory it holds once loaded (weights, cache and working space), and how its makers say to
 * sample it (the menu sets the temperature).
 */
export type BrowserModel = {
	model:string;
	label:string;
	downloadGB:number;
	memoryGB:number;
	sampling:Omit<Sampling, 'temperature'>;
};

/** Google's recommended sampling for Gemma, which LM Studio runs too. */
const GEMMA_SAMPLING = { topK: 64, topP: 0.95 };

export const BROWSER_MODELS:BrowserModel[] = [
	// unsloth's Q4_K_M, split by us, pinned to the commit uploaded. Its cache costs about 2.5 times Gemma E4B's per token of context.
	{ model: 'https://huggingface.co/DanielSig/Qwen3-4B-Thinking-2507-Q4_K_M-wllama-split/resolve/8f5ccc2156aeebd729e267e7ac2a31dd21385c5a/Qwen3-4B-Thinking-2507-Q4_K_M-00001-of-00005.gguf', label: 'Qwen3 4B Thinking', downloadGB: 2.5, memoryGB: 5, sampling: { topK: 20, topP: 0.95 } },
	{ model: DEFAULT_BROWSER_MODEL, label: 'Gemma 4 E4B', downloadGB: 5.0, memoryGB: 6, sampling: GEMMA_SAMPLING },
	// A community split of unsloth's Q4_K_M, pinned to the commit checked.
	{ model: 'https://huggingface.co/888rok/gemma-4-12b-it-Q4_K_M-wllama-split/resolve/f53c74af7a1f7bde67e17d1fbede0c8eece29b35/gemma-4-12b-it-Q4_K_M-00001-of-00004.gguf', label: 'Gemma 4 12B', downloadGB: 7.1, memoryGB: 9, sampling: GEMMA_SAMPLING },
];

// The engine runs from the game's own copy of wllama, not a CDN.
BrowserProvider.shared = new BrowserProvider({ wasm: wllamaWasm });

/**
 * How the menu runs its chat model, wherever it runs: context, thinking (off at a budget of 0, unbounded below it),
 * sampling, and thinks at once.
 */
export function menuModel(p:Prefs):Pick<ModelSpec, 'contextLength' | 'thinking' | 'thinkingBudget' | 'sampling' | 'maxParallel'> {
	return {
		contextLength: p.contextLength,
		thinking: p.thinkingBudget !== 0,
		thinkingBudget: p.thinkingBudget > 0 ? p.thinkingBudget : undefined,
		sampling: { ...(browserModel(p)?.sampling ?? GEMMA_SAMPLING), temperature: p.temperature },
		maxParallel: p.maxParallel,
	};
}

/** The model the LM Studio steps ask for: the best that runs on most GPUs. */
export const LM_STUDIO_MODEL = { id: 'google/gemma-4-e4b', label: 'Gemma 4 E4B' };

export type BrowserModelState = {
	/** Downloaded already: a load reads it from disk. */
	cached:boolean;
	/** 0 to 1 while it downloads and loads; null otherwise. */
	progress:number | null;
	error:string;
};

/** What the inference picker shows: the choice in prefs, and each browser model's download. */
export const inferenceSetup = reactive({
	inference: prefs().inference as InferenceKind,
	browserModel: prefs().browserModel,
	/** Why this browser cannot run the models; empty when it can. */
	unsupported: '',
	/** The biggest model this device runs with a gigabyte left over for the game, or null when none fits or it cannot tell. */
	recommended: fittingModel(BROWSER_MODELS, gpuMemory())?.model ?? null,
	models: Object.fromEntries(BROWSER_MODELS.map((m) => [m.model, { cached: false, progress: null, error: '' }])) as Record<string, BrowserModelState>,
});

watchPrefs((next) => {
	inferenceSetup.inference = next.inference;
	inferenceSetup.browserModel = next.browserModel;
});

void (async () => {
	inferenceSetup.unsupported = await BrowserProvider.unsupported() ?? '';
	// Downloads stay deletable even when models cannot run here.
	for (const m of BROWSER_MODELS) {
		await checkCached(m.model);
	}
})();

async function checkCached(model:string):Promise<void> {
	inferenceSetup.models[model].cached = await BrowserProvider.shared.isCached(model).catch(() => false);
}

/**
 * What NPCs think with, and where: a browser model by its name, else the model LM Studio runs, as the director
 * resolved it (`activeModel`, empty until it has).
 */
export function thinksWith(activeModel:string):string {
	const name = mainModelName(activeModel);
	if (inferenceSetup.inference === 'browser') {
		return `${name} · in your browser`;
	}
	return name ? `${name} · LM Studio` : 'LM Studio';
}

/** The model NPCs think with, by name: the browser model's, or the one LM Studio runs (empty until it is known). */
export function mainModelName(activeModel:string):string {
	if (inferenceSetup.inference === 'browser') {
		return browserModel(inferenceSetup)?.label ?? inferenceSetup.browserModel;
	}
	return activeModel;
}

/** The offered browser model NPCs think with, if they think in the browser. */
function browserModel(setup:Pick<Prefs, 'inference' | 'browserModel'>):BrowserModel | undefined {
	return setup.inference === 'browser' ? BROWSER_MODELS.find((m) => m.model === setup.browserModel) : undefined;
}

/** Whether a browser model is downloading or loading now: one at a time, since the engine holds one. */
export function browserModelBusy():boolean {
	return Object.values(inferenceSetup.models).some((m) => m.progress !== null);
}

/** Shows `download` on `model`'s button, wherever it started. */
export function showDownload(model:string, download:ModelDownload):void {
	const state = inferenceSetup.models[model];
	if (!state) {
		return;
	}
	state.error = '';
	download.subscribe({
		next: (p) => {
			state.progress = p.progress;
		},
		complete: () => {
			state.progress = null;
			state.cached = true;
		},
		error: (err) => {
			state.progress = null;
			state.error = errorText(err);
			// It may have got far enough to leave files behind.
			void checkCached(model);
		},
	});
}

/**
 * Makes `model` the one NPCs think with, then downloads it unless the browser has it and loads it. Picked first, so
 * a running scene's director starts this same download and its thinks wait for it. A failed one picks the last again.
 */
export async function useBrowserModel(model:string):Promise<boolean> {
	const { inference, browserModel } = prefs();
	setPrefs({ inference: 'browser', browserModel: model });
	// As a scene will run it, so starting one does not load it again.
	const { thinking, ...settings } = menuModel(prefs());
	BrowserProvider.shared.configureModel(model, { ...settings, enableThinking: thinking });
	const download = BrowserProvider.shared.download(model);
	showDownload(model, download);
	try {
		await download.done;
		return true;
	}
	catch {
		setPrefs({ inference, browserModel });
		return false;
	}
}

/**
 * Deletes `model`'s download and unpicks it, so nothing downloads it again: NPCs thinking with it go back to
 * LM Studio.
 */
export async function deleteBrowserModel(model:string):Promise<void> {
	if (prefs().browserModel === model) {
		setPrefs({ inference: 'lmstudio', browserModel: '' });
	}
	const state = inferenceSetup.models[model];
	try {
		await BrowserProvider.shared.delete(model);
		state.cached = false;
		state.error = '';
	}
	catch (err:unknown) {
		state.error = errorText(err);
	}
}

/** An error's message, as a model's button and its tooltip show it. */
function errorText(err:unknown):string {
	return err instanceof Error ? err.message : String(err);
}
