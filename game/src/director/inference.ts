import { reactive } from 'vue';
import wllamaWasm from '@wllama/wllama/esm/wasm/wllama.wasm?url';
import {
	BrowserProvider,
	LM_STUDIO_URL,
	Skaldic,
	SKALDIC_BROWSER_MODELS,
	fetchModelCatalog,
	fittingModel,
	gpuMemory,
	isDecisionModel,
	isEmbeddingModel,
	isEncoderModel,
	isLoadedModel,
	recommendedSampling,
	type ModelDownload,
	type ModelInfo,
	type ModelSpec,
} from 'arc-director';
import { prefs, setPrefs, watchPrefs, type InferenceKind, type Prefs, type SystemOneKind } from '../prefs';
import type { HudModelOption } from '../ui/hudModel';

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
 * Skaldic Laya: a decision model trained on the game's quick decisions, offered beside the main model as the System One.
 * LM Studio's is found by its id; the browser's is the library's own (`Skaldic.Laya`), on its own engine.
 */
export const SKALDIC_LAYA = { match: /skaldic-laya/i, label: 'Skaldic Laya', sizeGB: 0.45, model: SKALDIC_BROWSER_MODELS[Skaldic.Laya] };

// The engine runs from the game's own copy of wllama, not a CDN.
BrowserProvider.shared = new BrowserProvider({ wasm: wllamaWasm });

/**
 * The decision model the menu picked, or `''` for the main model scoring its own choices: Skaldic Laya's download,
 * which runs in the browser beside either, or with LM Studio also one of its models by id.
 */
export function decisionModelOf(p:Pick<Prefs, 'inference' | 'systemOne' | 'decisionModel'>):string {
	if (p.systemOne !== 'local') {
		return '';
	}
	// The browser has no LM Studio models.
	return p.inference === 'browser' && p.decisionModel !== SKALDIC_LAYA.model ? '' : p.decisionModel;
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

/** Where LM Studio answers: through the dev server's `/inference` proxy, or straight from a hosted build (LM Studio's CORS must be on). */
export const LM_STUDIO_ROOT = import.meta.env.DEV ? '/inference' : LM_STUDIO_URL.replace(/\/v1$/, '');

/** LM Studio's models as its server last listed them: loaded ones first, embeddings left out. */
export const lmStudio = reactive({
	models: [] as HudModelOption[],
	/** Asked at least once, so an empty list means it is off rather than unknown. */
	listed: false,
	listing: false,
});

/**
 * Lists LM Studio's models into {@link lmStudio}, only once LM Studio is where NPCs think: contacting it makes the
 * browser ask leave to reach apps on this device.
 */
export async function listLMStudioModels():Promise<void> {
	if (prefs().inference !== 'lmstudio' || lmStudio.listing) {
		return;
	}
	lmStudio.listing = true;
	try {
		const catalog = await fetchModelCatalog(LM_STUDIO_ROOT);
		// A model on this machine and on a linked one is listed once per machine, alike: one row, with its count.
		const chat = catalog.filter((m, i) => !isEmbeddingModel(m) && catalog.findIndex((other) => other.id === m.id) === i);
		lmStudio.models = chat
			.map((m) => ({
				id: m.id,
				loaded: isLoadedModel(m),
				decision: isDecisionModel(m),
				devices: catalog.filter((other) => other.id === m.id).length,
				encoder: isEncoderModel(m),
				params: paramsOf(m),
				gb: m.sizeBytes === undefined ? undefined : m.sizeBytes / 1e9,
			}))
			.sort((a, b) => Number(b.loaded) - Number(a.loaded) || a.id.localeCompare(b.id));
		lmStudio.listed = true;
	}
	finally {
		lmStudio.listing = false;
	}
}

/**
 * Billions of parameters, all and active, from LM Studio's `26B-A4B`; else guessed from the file at about a byte each,
 * as most models are quantized; unknown without either.
 */
function paramsOf(m:ModelInfo):HudModelOption['params'] {
	const billions = (n:string, unit:string):number => Number(n) / (unit.toUpperCase() === 'M' ? 1000 : 1);
	const match = /^([\d.]+)([MB])(?:-A([\d.]+)([MB]))?/i.exec(m.params ?? '');
	if (match) {
		const total = billions(match[1], match[2]);
		return { total, active: match[3] ? billions(match[3], match[4]) : total };
	}
	return m.sizeBytes ? { total: m.sizeBytes / 1e9, active: m.sizeBytes / 1e9 } : undefined;
}

/** Unloads every loaded copy of each model LM Studio has whose id `which` picks, and waits until it has. */
export async function unloadLMStudio(which:(id:string)=>boolean):Promise<void> {
	const res = await fetch(`${LM_STUDIO_ROOT}/api/v1/models`).catch(() => undefined);
	const rows = res?.ok ? ((await res.json()) as { models?:{ key:string; loaded_instances?:{ id:string }[] }[] }).models ?? [] : [];
	for (const instance of rows.filter((m) => which(m.key)).flatMap((m) => m.loaded_instances ?? [])) {
		await fetch(`${LM_STUDIO_ROOT}/api/v1/models/unload`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ instance_id: instance.id }),
		}).catch(() => undefined);
	}
}

/**
 * What scores `choose` picks, as one choice: `off`, `jev`, or `model:` and a decision model (an LM Studio model's
 * id, or Skaldic Laya's download in the browser), empty for the one NPCs think with (`mainModel`).
 */
export function decisionChoice(p:Pick<Prefs, 'inference' | 'systemOne' | 'decisionModel'>, mainModel:string):string {
	if (p.systemOne !== 'local') {
		return p.systemOne;
	}
	const own = decisionModelOf(p);
	return `model:${own === mainModel ? '' : own}`;
}

/** The decision model making NPCs' quick decisions apart from their main model, by name; empty when there is none. */
export function decisionModelName(p:Pick<Prefs, 'inference' | 'systemOne' | 'decisionModel'>):string {
	const own = decisionModelOf(p);
	return SKALDIC_LAYA.match.test(own) ? SKALDIC_LAYA.label : own;
}

/** Makes `choice` (as {@link decisionChoice} gives it) the System One; Skaldic Laya in the browser downloads first. */
export function pickDecisionChoice(choice:string):void {
	const model = choice.startsWith('model:') ? choice.slice('model:'.length) : undefined;
	if (model === SKALDIC_LAYA.model) {
		void useBrowserLaya();
		return;
	}
	setPrefs(model !== undefined ? { systemOne: 'local', decisionModel: model } : { systemOne: choice as SystemOneKind });
}

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
	/** The browser model picked before was taken up again as the page opened: its download finishing, or its load. */
	resumed: false,
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
	resumeBrowserModel();
})();

/**
 * Takes up the browser model picked before, so it need not be picked again: a download left unfinished goes on, and
 * the one model downloaded loads into memory. With others downloaded too, which to load is left to the picker.
 */
function resumeBrowserModel():void {
	const { inference, browserModel } = prefs();
	const state = inferenceSetup.models[browserModel];
	if (inference !== 'browser' || !state || inferenceSetup.unsupported) {
		return;
	}
	const downloaded = BROWSER_MODELS.filter((m) => inferenceSetup.models[m.model].cached);
	if (!state.cached || (downloaded.length === 1 && downloaded[0].model === browserModel)) {
		inferenceSetup.resumed = true;
		void useBrowserModel(browserModel);
	}
}

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
