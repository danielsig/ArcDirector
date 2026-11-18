import type { ReasoningEffort } from '../inference/http.js';
import type { ArcDirector } from './ArcDirector.js';
import { findModel, isDecisionModel, isVisionModel, recommendedSampling, trainedOnArcDirector, type ModelInfo } from '../inference/models.js';
import { contextPerSlot } from '../inference/LMStudioLoader.js';
import { samplingOf, type InferenceProvider, type Sampling } from '../inference/provider.js';
import type { SystemOne } from '../inference/system-one.js';
import type { PromptStyle } from '../mind/prompt.js';
import { ModelSlots } from './ModelSlots.js';

/** One model on a provider, by role, and what it runs with (the README's Inference); a mind never changes these. */
export type ModelSpec = {
	/** Default: the provider's pick (LM Studio: its best loaded chat model). */
	id?:string;
	/** The one model every memory is embedded with. */
	embedding?:boolean;
	/** Default: the server's `load.contextLength`. */
	contextLength?:number;
	/** Default: the server's `enableThinking`. */
	thinking?:boolean;
	/** Most tokens a thought may run; the mind answers from what it thought so far. */
	thinkingBudget?:number;
	/** The lowest the thinking cap may go after a tool call (`ModelSettings.thinkingFloor`). Default 64. */
	thinkingFloor?:number;
	/** Over its makers' ({@link recommendedSampling}), setting by setting; then {@link DEFAULT_SAMPLING}'s. */
	sampling?:Sampling;
	reasoningEffort?:ReasoningEffort;
	/**
	 * Requests on it at once. Default {@link DEFAULT_MAX_PARALLEL}. Its id's slots keep the first value until the page
	 * reloads: another means LM Studio unloads and reloads the model.
	 */
	maxParallel?:number;
	/** Wall-clock seconds new thinks wait to start as one wave ({@link ModelSlots}). Default {@link DEFAULT_BATCH_WAIT}. */
	batchWait?:number;
	/** Default `full`; always `compact` for a model trained on ArcDirector's prompts ({@link trainedOnArcDirector}). */
	prompt?:PromptStyle;
};

/** What every provider's `add*` takes: its name (default its kind), and its models by role, an id or a spec. */
export type ProviderConfig = { name?:string; models?:Readonly<Record<string, string | ModelSpec>> };

export const DEFAULT_MAX_PARALLEL = 4;
export const DEFAULT_BATCH_WAIT = 20;

/** A model once its provider answered, as every director sharing the provider sees it. `name` is its role. */
export type ProvidedModel = Required<Pick<ModelSpec, 'id' | 'thinking' | 'maxParallel' | 'prompt' | 'sampling' | 'embedding'>> & {
	name:string;
	vision:boolean;
	contextLength?:number;
	/** Tokens one of its requests may fill, when its context is known: its share with every slot busy ({@link ModelProvider.slotContext}). */
	slotContext?:number;
	/** A decision model (Skaldic Laya, Jev): it only picks `choose` choices, so it is never the default. */
	decision:boolean;
	/** A decision model's System One endpoint on its server, when the server serves one. */
	systemOneURL?:string;
	/** Shared by every role with its id on this provider. */
	slots:ModelSlots;
};

/**
 * A transport (`InferenceProvider`) and its models by role, each looked up once, with its slots. Nothing of a
 * director's (no log, no clock), so directors may share it. A game's own transport is wrapped, not subclassed:
 * `new ModelProvider('mine', transport).configure({ models })`.
 */
export class ModelProvider<TTransport extends InferenceProvider = InferenceProvider> {
	private readonly _specs = new Map<string, ModelSpec>();
	private readonly _models = new Map<string, ProvidedModel>();
	private readonly _lookups = new WeakMap<ModelSpec, Promise<ProvidedModel>>();
	private readonly _slots = new Map<string, ModelSlots>();
	/** Each director it is on. */
	private readonly _watchers = new Set<(role:string)=>void>();
	/** What the server lists, for a spec without its own: whether models reason, and their context. */
	protected defaults:ModelSpec = {};
	/** Where the server answers a decision model as a System One, when it does. */
	protected systemOneURL:string | undefined;

	/**
	 * `_options`: what reaches its models, which `sameAs` compares (everything its `add*` took but its models).
	 * `systemOne`: what a provider that only picks (Jev) picks with, under its one role, its name.
	 */
	constructor(public readonly name:string, public readonly transport:TTransport, private readonly _options:Record<string, unknown> = {}, public readonly systemOne?:SystemOne) {}

	public get roles():string[] {
		return [...this._specs.keys()];
	}

	public has(role:string):boolean {
		return this._specs.has(role);
	}

	/** Model `role` as the provider answered it; undefined until it did. */
	public model(role:string):ProvidedModel | undefined {
		return this._models.get(role);
	}

	/** Whether `other` reaches its models as this one does: the same kind, with the same settings. */
	public sameAs(other:ModelProvider):boolean {
		const same = (a:unknown, b:unknown):boolean => a === b || (typeof a === 'object' && JSON.stringify(a) === JSON.stringify(b));
		return other.constructor === this.constructor && other.name === this.name
			&& Object.keys({ ...this._options, ...other._options }).every((key) => key === 'models' || same(this._options[key], other._options[key]));
	}

	/** Its models from `config` from now on: each added again, and roles it leaves out dropped. */
	public configure({ models = {} }:ProviderConfig = {}):this {
		const listed = this.systemOne ? { [this.name]: {} } : models;
		this.roles.filter((role) => !Object.hasOwn(listed, role)).forEach((role) => this.removeModel(role));
		Object.entries(listed).forEach(([role, model]) => this.addModel(role, model));
		return this;
	}

	/**
	 * Model `role`, any time: an id, or a spec. The same role again sets it anew; one whose id did not change stays
	 * loaded. On a director, it takes the role from any other provider there.
	 */
	public addModel(role:string, model:string | ModelSpec):this {
		this._specs.set(role, typeof model === 'string' ? { id: model } : { ...model });
		this._watchers.forEach((heard) => heard(role));
		return this;
	}

	/** Minds assigned `role` think with the default until it is added again. */
	public removeModel(role:string):this {
		const model = this._models.get(role);
		this._specs.delete(role);
		this._models.delete(role);
		this.forget(model?.id);
		this._watchers.forEach((heard) => heard(role));
		return this;
	}

	/** Hear each role added or removed, until the returned function is called. */
	public watch(heard:(role:string)=>void):()=>void {
		this._watchers.add(heard);
		return () => this._watchers.delete(heard);
	}

	/** Model `role` looked up as its spec says, once per spec. Rejects when the server cannot say what to run. */
	public resolve(role:string):Promise<ProvidedModel> {
		const spec = this._specs.get(role);
		if (!spec) {
			return Promise.reject(new Error(`ArcDirector: no model '${role}' on ${this.name}`));
		}
		const lookup = this._lookups.get(spec) ?? this.lookUp(role, spec);
		this._lookups.set(spec, lookup);
		lookup.catch(() => this._lookups.delete(spec));
		return lookup;
	}

	/** What the server lists, to find a model by name and tell what it is: nothing, unless it says. */
	protected catalog():Promise<ModelInfo[]> {
		return Promise.resolve([]);
	}

	/** The model it runs for `role` when the spec names none. */
	protected defaultID(catalog:ModelInfo[], role:string):string | undefined {
		return role;
	}

	/** Whether model `id` sees images. */
	protected sees(id:string, info:ModelInfo | undefined):boolean {
		return isVisionModel(info ?? id);
	}

	/** Tokens each of `maxParallel` requests at once may fill of a model loaded with `contextLength`: LM Studio's rule, {@link contextPerSlot}. */
	protected slotContext(contextLength:number, maxParallel:number):number {
		return contextPerSlot(contextLength, maxParallel);
	}

	private async lookUp(role:string, own:ModelSpec):Promise<ProvidedModel> {
		const spec = { ...this.defaults, ...own };
		const catalog = await this.catalog();
		const id = spec.id ? findModel(catalog, spec.id)?.id ?? spec.id : this.defaultID(catalog, role);
		if (!id) {
			throw new Error(`ArcDirector: no model on ${this.name}`);
		}
		const info = findModel(catalog, id);
		const decision = !!this.systemOne || (!!info && isDecisionModel(info));
		const thinking = spec.thinking ?? false;
		const sampling = { ...recommendedSampling(id, thinking), ...spec.sampling };
		// A decision model on its server's System One endpoint is loaded by it.
		const systemOneURL = decision ? this.systemOneURL : undefined;
		if (!systemOneURL && !spec.embedding) {
			this.transport.configureModel?.(id, { contextLength: spec.contextLength, enableThinking: spec.thinking, reasoningEffort: spec.reasoningEffort, thinkingBudget: spec.thinkingBudget, thinkingFloor: spec.thinkingFloor, sampling, maxParallel: spec.maxParallel });
		}
		const maxParallel = spec.maxParallel ?? DEFAULT_MAX_PARALLEL;
		const slots = this._slots.get(id) ?? new ModelSlots(maxParallel, spec.batchWait ?? DEFAULT_BATCH_WAIT);
		this._slots.set(id, slots);
		const model:ProvidedModel = {
			name: role,
			id,
			vision: this.sees(id, info),
			thinking,
			maxParallel,
			prompt: trainedOnArcDirector(id) ? 'compact' : spec.prompt ?? 'full',
			sampling: samplingOf(sampling, undefined),
			contextLength: spec.contextLength,
			slotContext: spec.contextLength === undefined ? undefined : this.slotContext(spec.contextLength, maxParallel),
			decision,
			embedding: spec.embedding === true,
			systemOneURL,
			slots,
		};
		// A spec set anew meanwhile has its own lookup. Its first request loads it, so a model nobody uses takes no VRAM.
		if (this._specs.get(role) === own) {
			const was = this._models.get(role);
			this._models.set(role, model);
			this.forget(was?.id);
		}
		return model;
	}

	/** The server may unload `id` once no role here runs it. */
	private forget(id:string | undefined):void {
		if (id !== undefined && ![...this._models.values()].some((model) => model.id === id)) {
			this.transport.forgetModel?.(id);
		}
	}
}

/**
 * Provider `type`'s `add*` and `get*` shortcuts, which its file declares on `ArcDirector`. `add*(config)` sets the
 * models of the provider of its name when it reaches them alike (same kind and settings), so they stay loaded, else
 * adds a new one in its place; `get*(name = kind)` gives it typed.
 */
export function providerShortcuts<C extends ProviderConfig, P extends ModelProvider>(type:new (config?:C)=>P, kind:string):{
	add<TCtx>(this:ArcDirector<TCtx>, config?:C):ArcDirector<TCtx>;
	get<TCtx>(this:ArcDirector<TCtx>, name?:string):P | undefined;
} {
	return {
		add(config) {
			const made = new type(config);
			const known = this.getProvider(made.name);
			const provider = known?.sameAs(made) ? known : made;
			provider.configure(config);
			return provider === known ? this : this.addProvider(provider);
		},
		get(name = kind) {
			const provider = this.getProvider(name);
			return provider instanceof type ? provider : undefined;
		},
	};
}
