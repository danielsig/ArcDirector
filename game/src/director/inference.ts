import { reactive } from 'vue';
import wllamaWasm from '@wllama/wllama/esm/wasm/wllama.wasm?url';
import { BrowserProvider, Skaldic, SKALDIC_BROWSER_MODELS, fittingModel, gpuMemory, recommendedSampling, type ModelDownload, type ModelSpec } from 'arc-director';
import { prefs, setPrefs, watchPrefs, type InferenceKind, type Prefs } from '../prefs';

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
	{ model: SKALDIC_BROWSER_MODELS[Skaldic.Gemma4E4B], label: 'Skaldic Gemma 4 E4B', downloadGB: 4.6, memoryGB: 6 },
	// A community split of unsloth's Q4_K_M, pinned to the commit checked.
	{ model: 'https://huggingface.co/888rok/gemma-4-12b-it-Q4_K_M-wllama-split/resolve/f53c74af7a1f7bde67e17d1fbede0c8eece29b35/gemma-4-12b-it-Q4_K_M-00001-of-00004.gguf', label: 'Gemma 4 12B', downloadGB: 7.1, memoryGB: 9 },
];

/**
 * Skaldic Laya: a decision model trained on the game's quick decisions, offered beside the main model as the System
 * One. LM Studio's is found by its id; the browser's is the library's own (`Skaldic.Laya`), on its own engine.
 */
export const SKALDIC_LAYA = { match: /skaldic-laya/i, label: 'Skaldic Laya', sizeGB: 0.45, model: SKALDIC_BROWSER_MODELS[Skaldic.Laya] };

// The engine runs from the game's own copy of wllama, not a CDN.
BrowserProvider.shared = new BrowserProvider({ wasm: wllamaWasm });

/**
 * The decision model the menu picked for where NPCs think, or `''` for the main model scoring its own choices:
 * Skaldic Laya's download in the browser, an LM Studio model's id with LM Studio.
 */
export function decisionModelOf(p:Pick<Prefs, 'inference' | 'systemOne' | 'decisionModel'>):string {
	if (p.systemOne !== 'local') {
		return '';
	}
	const inPage = p.decisionModel === SKALDIC_LAYA.model;
	return p.inference === 'browser' ? (inPage ? p.decisionModel : '') : (inPage ? '' : p.decisionModel);
}

/**
 * How a model picks its tokens: its makers' settings with the menu's temperature, as in play, or its makers' alone, as
 * a bench runs every model so their scores compare.
 */
export type SamplingSource = 'menu' | 'makers';

/**
 * How the menu runs its chat model, wherever it runs: context, thinking (off at a budget of 0, unbounded below it),
 * temperature, and thinks at once.
 */
export function menuModel(p:Prefs, sampling:SamplingSource = 'menu'):Pick<ModelSpec, 'contextLength' | 'thinking' | 'thinkingBudget' | 'sampling' | 'maxParallel'> {
	return {
		contextLength: p.contextLength,
		thinking: p.thinkingBudget !== 0,
		thinkingBudget: p.thinkingBudget > 0 ? p.thinkingBudget : undefined,
		sampling: sampling === 'menu' ? { temperature: p.temperature } : undefined,
		maxParallel: p.maxParallel,
	};
}

/** The model the LM Studio steps ask for: the best that runs on most GPUs. */
export const LM_STUDIO_MODEL = { id: 'google/gemma-4-e4b', label: 'Gemma 4 E4B' };

export type BrowserModelState = {
	/** Downloaded already: a load reads it from disk. */
	cached:boolean;
	/** On the GPU now, ready to answer: picked alone it is only ready, and loads when a scene needs it. */
	loaded:boolean;
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
	models: Object.fromEntries(BROWSER_MODELS.map((m) => [m.model, { cached: false, loaded: false, progress: null, error: '' }])) as Record<string, BrowserModelState>,
	/** Skaldic Laya's download, apart from the models: it runs on its own engine, beside whichever one is picked. */
	laya: { cached: false, loaded: false, progress: null, error: '' } as BrowserModelState,
});

watchPrefs((next) => {
	inferenceSetup.inference = next.inference;
	inferenceSetup.browserModel = next.browserModel;
});

void (async () => {
	inferenceSetup.unsupported = await BrowserProvider.unsupported() ?? '';
	// Models the game no longer offers would fill the browser's storage for good, and a full store fails a download.
	await BrowserProvider.shared.keepOnly([...BROWSER_MODELS.map((m) => m.model), SKALDIC_LAYA.model]).catch(() => undefined);
	// Downloads stay deletable even when models cannot run here.
	for (const m of [...BROWSER_MODELS.map((b) => b.model), SKALDIC_LAYA.model]) {
		await checkCached(m);
	}
})();

/** The download state `model` shows: a browser model's, or Skaldic Laya's. */
function stateOf(model:string):BrowserModelState | undefined {
	return model === SKALDIC_LAYA.model ? inferenceSetup.laya : inferenceSetup.models[model];
}

async function checkCached(model:string):Promise<void> {
	const state = stateOf(model);
	if (state) {
		// The browser keeps every engine's downloads in one store.
		state.cached = await BrowserProvider.shared.isCached(model).catch(() => false);
	}
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
/** The downloads under way, by model: what Cancel stops. */
const underWay = new Map<string, ModelDownload>();

/** Stops `model`'s download; a picked model goes back to the last one picked, as on any failed download. */
export function cancelDownload(model:string):void {
	underWay.get(model)?.cancel();
}

export function showDownload(model:string, download:ModelDownload):void {
	const state = stateOf(model);
	if (!state) {
		return;
	}
	state.error = '';
	underWay.set(model, download);
	const ended = ():void => {
		if (underWay.get(model) === download) {
			underWay.delete(model);
		}
	};
	download.subscribe({
		next: (p) => {
			state.progress = p.progress;
		},
		complete: () => {
			ended();
			state.progress = null;
			state.cached = true;
			// The main models share one engine: loading one unloads the last. Laya runs on its own.
			if (state !== inferenceSetup.laya) {
				for (const other of Object.values(inferenceSetup.models)) {
					other.loaded = other === state;
				}
			}
			state.loaded = true;
		},
		error: (err) => {
			ended();
			state.progress = null;
			// Cancelled is not a failure: nothing to show.
			state.error = download.cancelled ? '' : errorText(err);
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
	BrowserProvider.shared.configureModel(model, { ...settings, sampling: { ...recommendedSampling(model, thinking), ...settings.sampling }, enableThinking: thinking });
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
		state.loaded = false;
		state.error = '';
	}
	catch (err:unknown) {
		state.error = errorText(err);
	}
}

/**
 * Downloads Skaldic Laya into the browser unless it is there, loads it on its own engine, and makes it the System
 * One. A failed download leaves the System One as it was.
 */
export async function useBrowserLaya():Promise<boolean> {
	const download = BrowserProvider.decisions.download(SKALDIC_LAYA.model);
	showDownload(SKALDIC_LAYA.model, download);
	try {
		await download.done;
	}
	catch {
		return false;
	}
	setPrefs({ systemOne: 'local', decisionModel: SKALDIC_LAYA.model });
	return true;
}

/** Deletes Skaldic Laya's download from the browser (offered once it is off), turning it off first if it is on. */
export async function deleteBrowserLaya():Promise<void> {
	if (prefs().decisionModel === SKALDIC_LAYA.model) {
		setPrefs({ decisionModel: '' });
	}
	const state = inferenceSetup.laya;
	try {
		await BrowserProvider.decisions.delete(SKALDIC_LAYA.model);
		state.cached = false;
		state.loaded = false;
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
