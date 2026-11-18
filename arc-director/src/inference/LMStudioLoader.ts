import { isRecord } from '../json.js';
import { modelIDsMatch } from './models.js';

export type HttpLoadConfig = {
	flashAttention?:boolean;
	offloadKvCacheToGpu?:boolean;
	evalBatchSize?:number;
	parallel?:number;
	/** LM Studio `context_length` (`n_ctx`). An idle instance with any other length is reloaded. */
	contextLength?:number;
};

type LoadedInstance = {
	id:string;
	key:string;
	type:string;
	config:Record<string, unknown>;
};

export function loadConfigFits(got:Record<string, unknown>, want:HttpLoadConfig):boolean {
	if (want.flashAttention !== false && got['flash_attention'] === false) {
		return false;
	}
	if (want.offloadKvCacheToGpu !== false && got['offload_kv_cache_to_gpu'] === false) {
		return false;
	}
	const batch = want.evalBatchSize ?? 512;
	if (typeof got['eval_batch_size'] === 'number' && got['eval_batch_size'] < batch) {
		return false;
	}
	if (want.parallel !== undefined && typeof got['parallel'] === 'number' && got['parallel'] < want.parallel) {
		return false;
	}
	if (want.contextLength !== undefined) {
		const gotCtx = instanceContextLength(got);
		if (gotCtx !== undefined && gotCtx !== want.contextLength) {
			return false;
		}
	}
	return true;
}

function readLoadedInstances(models:unknown[]):LoadedInstance[] {
	const out:LoadedInstance[] = [];
	for (const row of models) {
		if (!isRecord(row)) {
			continue;
		}
		const key = typeof row.key === 'string' ? row.key
			: typeof row.id === 'string' ? row.id : '';
		const type = typeof row.type === 'string' ? row.type : 'llm';
		const instances = Array.isArray(row.loaded_instances) ? row.loaded_instances : [];
		for (const inst of instances) {
			if (!isRecord(inst) || typeof inst.id !== 'string' || !inst.id) {
				continue;
			}
			out.push({
				id: inst.id,
				key: key || inst.id,
				type,
				config: isRecord(inst.config) ? inst.config : {},
			});
		}
	}
	return out;
}

function configNumber(config:Record<string, unknown>, ...keys:string[]):number | undefined {
	for (const key of keys) {
		const n = config[key];
		if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
			return n;
		}
	}
	return undefined;
}

function instanceContextLength(config:Record<string, unknown>):number | undefined {
	return configNumber(config, 'context_length', 'contextLength', 'n_ctx', 'max_context_length');
}

/**
 * Tokens one request may fill on a model loaded with `contextLength` and `parallel` slots: its share of the context.
 * LM Studio's Max Concurrent Predictions (REST `parallel`) runs the slots on one KV cache of `context_length`: split
 * evenly without Unified KV Cache, and shared by all of them with it ("not hard-partitioned per concurrent request",
 * https://lmstudio.ai/blog/0.4.0), so with every slot busy each holds this much either way.
 */
export function contextPerSlot(contextLength:number, parallel:number | undefined):number {
	return Math.floor(contextLength / Math.max(1, parallel ?? 1));
}

/** What the loader asks of its provider. */
export type LoaderDeps = {
	/** The server's URL for `path`, from its root. */
	url(path:string):string;
	fetch:typeof fetch;
	timeoutMs:number;
	headers():Record<string, string>;
	/** A JSON POST to the server, retried as the provider retries. */
	post(url:string, body:Record<string, unknown>):Promise<Record<string, unknown>>;
	/** How `model` is to be loaded. */
	loadOf(model:string):HttpLoadConfig;
	load:HttpLoadConfig;
	/** The models the provider is configured with: never unloaded to make room. */
	configured():string[];
	/** The catalog `api/v1/models` gave, each time it is read. */
	catalog(models:unknown[]):void;
};

/**
 * LM Studio's own model management (`api/v1/models`, `…/load`, `…/unload`), when the server has it: which instances
 * are loaded and how, loading a model as configured and dropping what is in the way, and which models are in use.
 * Ollama and plain OpenAI servers have none: `present` stays false after the first look.
 */
export class LMStudioLoader {
	/** Whether the server manages its models (`api/v1/models` answered). */
	public present = false;
	/** Slots a model got fewer of than it asked for. */
	public readonly maxParallel = new Map<string, number>();
	private _probed = false;
	private _instances:LoadedInstance[] = [];
	/** Requests per model that passed `ensureReady` and have not finished. */
	private readonly _inFlight = new Map<string, number>();
	private _readyChain:Promise<void> = Promise.resolve();

	constructor(private readonly _deps:LoaderDeps) {}

	/** `model` loaded as configured, one instance of it: one call at a time. */
	public async ensureReady(model:string):Promise<void> {
		const run = this._readyChain.then(() => this.ensureReadyLocked(model));
		this._readyChain = run.then(() => undefined, () => undefined);
		await run;
	}

	/** Tokens one request to `model` may fill, as it is loaded ({@link contextPerSlot}); undefined when not known. */
	public slotContext(model:string):number | undefined {
		const inst = this._instances.find((row) => this.instanceMatches(row, model));
		const context = inst && instanceContextLength(inst.config);
		return inst && context !== undefined ? contextPerSlot(context, configNumber(inst.config, 'parallel') ?? this._deps.loadOf(model).parallel) : undefined;
	}

	public hasReusable(model:string):boolean {
		return this._instances.some((inst) => this.instanceMatches(inst, model) && loadConfigFits(inst.config, this._deps.loadOf(model)));
	}

	/** A first request JIT-loaded `model`: it counts as loaded from now on. */
	public loadedByRequest(model:string):void {
		if (!this._instances.some((inst) => this.instanceMatches(inst, model))) {
			this._instances.push({ id: model, key: model, type: 'llm', config: {} });
		}
	}

	public hold(model:string):void {
		this._inFlight.set(model, (this._inFlight.get(model) ?? 0) + 1);
	}

	public release(model:string):void {
		const left = (this._inFlight.get(model) ?? 1) - 1;
		if (left <= 0) {
			this._inFlight.delete(model);
		}
		else {
			this._inFlight.set(model, left);
		}
	}

	private async ensureReadyLocked(model:string):Promise<void> {
		if (!this._probed) {
			await this.probe();
		}
		if (!this.present) {
			return;
		}
		if (this.hasReusable(model)) {
			await this.keepOneInstance(model);
			return;
		}
		await this.loadModel(model);
	}

	private instanceMatches(inst:LoadedInstance, model:string):boolean {
		return modelIDsMatch(inst.id, model) || modelIDsMatch(inst.key, model);
	}

	private async probe():Promise<void> {
		this._probed = true;
		try {
			await this.refreshInstances();
			this.present = true;
		}
		catch {
			this.present = false;
		}
	}

	private async refreshInstances():Promise<void> {
		const res = await this._deps.fetch(this._deps.url('api/v1/models'), {
			method: 'GET',
			headers: this._deps.headers(),
			signal: AbortSignal.timeout(Math.min(4000, this._deps.timeoutMs)),
		});
		if (!res.ok) {
			throw new Error(`inference models ${res.status}`);
		}
		const json:unknown = await res.json();
		if (!isRecord(json) || !Array.isArray(json.models)) {
			throw new Error('inference models: no catalog');
		}
		this._instances = readLoadedInstances(json.models);
		this._deps.catalog(json.models);
	}

	private async loadModel(model:string):Promise<void> {
		try {
			await this.refreshInstances();
		}
		catch {
			// keep whatever probe already saw
		}
		if (this.hasReusable(model)) {
			await this.keepOneInstance(model);
			return;
		}
		const same = this._instances.filter((inst) => this.instanceMatches(inst, model));
		if (same.length > 0 && this.isBusy(model)) {
			return;
		}
		const stale = same.filter((inst) => !loadConfigFits(inst.config, this._deps.loadOf(model)));
		for (const inst of stale) {
			await this.unloadInstance(inst.id);
		}
		await this.freeVram(model);
		const body = this.loadBody(model);
		let lastErr:unknown;
		for (let round = 0; round < 4; round++) {
			try {
				await this.postLoad(model, body);
				await this.keepOneInstance(model);
				return;
			}
			catch (err) {
				lastErr = err;
				const msg = err instanceof Error ? err.message : String(err);
				if (round === 0 && body.parallel !== undefined && / 400:/.test(msg)) {
					delete body.parallel;
					continue;
				}
				if (/ 404:| 405:/.test(msg)) {
					this.present = false;
					return;
				}
				try {
					await this.refreshInstances();
				}
				catch {
					// still use the in-memory list
				}
				if (await this.freeVram(model)) {
					continue;
				}
				throw err;
			}
		}
		throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
	}

	private loadBody(model:string):Record<string, unknown> {
		const load = this._deps.loadOf(model);
		const body:Record<string, unknown> = {
			model,
			flash_attention: this._deps.load.flashAttention !== false,
			offload_kv_cache_to_gpu: this._deps.load.offloadKvCacheToGpu !== false,
			eval_batch_size: this._deps.load.evalBatchSize ?? 512,
			echo_load_config: true,
		};
		if (load.parallel !== undefined) {
			body.parallel = load.parallel;
		}
		if (load.contextLength !== undefined) {
			body.context_length = load.contextLength;
		}
		return body;
	}

	private async postLoad(model:string, body:Record<string, unknown>):Promise<void> {
		const json = await this._deps.post(this._deps.url('api/v1/models/load'), body);
		const id = typeof json['instance_id'] === 'string' ? json['instance_id'] : model;
		const config = isRecord(json['load_config']) ? json['load_config'] : {};
		if (typeof config['parallel'] === 'number' && typeof body.parallel === 'number' && config['parallel'] < body.parallel) {
			this.maxParallel.set(model, config['parallel']);
		}
		this.forgetInstance(id);
		this._instances.push({
			id,
			key: model,
			type: typeof json.type === 'string' ? json.type : 'llm',
			config,
		});
	}

	/** Unload what is in the way of `keep`: anything loaded that is neither it nor another configured model. */
	private async freeVram(keep:string):Promise<boolean> {
		const configured = this._deps.configured();
		const victims = this._instances.filter((inst) => !this.instanceMatches(inst, keep)
			&& !configured.some((model) => this.instanceMatches(inst, model))
			&& !this.isBusy(inst.key) && !this.isBusy(inst.id));
		if (victims.length === 0) {
			return false;
		}
		for (const inst of victims) {
			await this.unloadInstance(inst.id);
		}
		return true;
	}

	private async keepOneInstance(model:string):Promise<void> {
		const remembered = this._instances.filter((inst) => this.instanceMatches(inst, model));
		try {
			await this.refreshInstances();
		}
		catch {
			// keep remembered
		}
		const seen = new Set(this._instances.map((inst) => inst.id));
		for (const inst of remembered) {
			if (!seen.has(inst.id)) {
				this._instances.push(inst);
				seen.add(inst.id);
			}
		}
		const same = this._instances.filter((inst) => this.instanceMatches(inst, model));
		const want = this._deps.loadOf(model);
		const fitting = same.filter((inst) => loadConfigFits(inst.config, want));
		const exact = want.contextLength === undefined ? undefined : fitting.find((inst) => instanceContextLength(inst.config) === want.contextLength);
		const keep = exact ?? fitting[0];
		if (!keep || this.isBusy(model)) {
			return;
		}
		for (const extra of same) {
			if (extra.id !== keep.id) {
				await this.unloadInstance(extra.id);
			}
		}
	}

	/** A chat or embed on `model` has passed `ensureReady` and not finished. */
	private isBusy(model:string):boolean {
		for (const [id, n] of this._inFlight) {
			if (n > 0 && modelIDsMatch(id, model)) {
				return true;
			}
		}
		return false;
	}

	private async unloadInstance(instanceID:string):Promise<void> {
		try {
			await this._deps.post(this._deps.url('api/v1/models/unload'), { instance_id: instanceID });
		}
		catch {
			// already gone
		}
		this.forgetInstance(instanceID);
	}

	private forgetInstance(instanceID:string):void {
		this._instances = this._instances.filter((inst) => inst.id !== instanceID);
	}
}
