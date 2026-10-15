import { reactive } from 'vue';
import { BrowserProvider, DEFAULT_BROWSER_MODEL, fittingModel, gpuMemory, type ModelDownload } from 'arc-director';
import { prefs, setPrefs, watchPrefs, type InferenceKind } from '../prefs';

/**
 * A model the game offers to run in the browser: its name as `addBrowserModel` takes it, what it costs to download,
 * and roughly how much GPU memory it holds once loaded (weights, cache and working space).
 */
export type BrowserModel = {
	model:string;
	label:string;
	downloadGB:number;
	memoryGB:number;
};

export const BROWSER_MODELS:BrowserModel[] = [
	{ model: DEFAULT_BROWSER_MODEL, label: 'Gemma 4 E4B', downloadGB: 4.9, memoryGB: 5.5 },
	// A community build (onnx-community has no 12B), pinned to the commit checked.
	{ model: 'Dramatik999/gemma-4-12B-it-ONNX@3fbee2e3b9da496f8a717e32460fbc2607e45967', label: 'Gemma 4 12B', downloadGB: 8.7, memoryGB: 9.7 },
];

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
	if (inferenceSetup.inference === 'browser') {
		const model = BROWSER_MODELS.find((m) => m.model === inferenceSetup.browserModel);
		return `${model?.label ?? inferenceSetup.browserModel} · in your browser`;
	}
	return activeModel ? `${activeModel} · LM Studio` : 'LM Studio';
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
	const { inference, browserModel, contextLength } = prefs();
	setPrefs({ inference: 'browser', browserModel: model });
	BrowserProvider.shared.configureModel(model, { contextLength });
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
