import { HttpProvider, type ReasoningEffort } from '../inference/http.js';
import { fakeInference, type HttpInferenceOpts } from '../inference/presets.js';
import { fetchModelCatalog, findModel, isDecisionModel, isVisionModel, pickSingleChatModel, PREFERRED_MODELS, type ModelInfo } from '../inference/models.js';
import type { FakeChatFn } from '../inference/fake.js';
import type { InferenceProvider } from '../inference/provider.js';

/** How to reach a chat server: `add*Inference`. */
export type InferenceSource =
	| { kind:'http'; opts:HttpInferenceOpts }
	| { kind:'fake'; chat?:FakeChatFn }
	| { kind:'custom'; provider:InferenceProvider; vision?:boolean };

/** Argument to `ArcDirector.addModel`: one model on one server, and what it runs with. A mind never changes these. */
export type ModelSpec = {
	/** The server, by its `add*Inference` name. Default: the first one added. */
	inference?:string;
	/** The server's model id. Default: the server's pick (LM Studio: the best loaded chat model, which scores choices well and is loaded already). */
	id?:string;
	/** A System One's model: it picks `choose` choices, reasoning off, and is never the minds' default. */
	decision?:boolean;
	/** LM Studio `context_length` it loads with. Default: the server's `load.contextLength`. */
	contextLength?:number;
	/** Reason before answering. Default: the server's `enableThinking`. */
	thinking?:boolean;
	reasoningEffort?:ReasoningEffort;
	/** Thinks on this model at once. Default {@link DEFAULT_MAX_PARALLEL}. */
	maxParallel?:number;
};

/** Argument to `ArcDirector.withEmbeddings`: the one model every memory is embedded with. */
export type EmbeddingSpec = {
	/** The server, by its `add*Inference` name. Default: the first one added. */
	inference?:string;
	id:string;
};

export const DEFAULT_MAX_PARALLEL = 2;

/** A configured model once its server answered: what a mind thinking with it needs. */
export type LiveModel = {
	name:string;
	id:string;
	provider:InferenceProvider;
	vision:boolean;
	thinking:boolean;
	maxParallel:number;
	/** Context window it loads with, when the host or the server set one. */
	contextLength?:number;
	/** A decision model's System One endpoint on its server; absent for a chat model. */
	systemOneURL?:string;
};

type Server = {
	source:InferenceSource;
	provider:InferenceProvider;
	http?:HttpProvider;
};

/** What the registry needs from its director. */
export type RegistryHooks = {
	/** The director's logging and timing around a provider. `http` ones log their own request bodies. */
	wrap(provider:InferenceProvider, http:boolean):InferenceProvider;
	/** Sees the exact JSON an HTTP server is sent. */
	onRequest:NonNullable<HttpInferenceOpts['onRequest']>;
	/** A model resolved, changed or went away: minds re-read theirs. */
	changed():void;
	log(message:string, error?:boolean):void;
};

/**
 * The chat servers a director talks to and the models configured on them, each by name. A mind is assigned one
 * by name; one without an assignment, or whose model went away, uses the default: the first model added unless
 * `setDefault` says otherwise. With no chat model added at all, `start` adds the first server's own pick.
 */
export class ModelRegistry {
	private readonly _servers = new Map<string, Server>();
	private readonly _specs = new Map<string, ModelSpec>();
	private readonly _live = new Map<string, LiveModel>();
	private readonly _hooks:RegistryHooks;
	private _default:string | null = null;
	private _embeddings:EmbeddingSpec | undefined;
	private _started = false;

	constructor(hooks:RegistryHooks) {
		this._hooks = hooks;
	}

	/** The default model's name, or null with none. */
	public get defaultName():string | null {
		return this._default;
	}

	public get hasServers():boolean {
		return this._servers.size > 0;
	}

	public addInference(name:string, source:InferenceSource):void {
		const http = source.kind === 'http' ? new HttpProvider({ ...source.opts, onRequest: this._hooks.onRequest }) : undefined;
		const inner = source.kind === 'fake' ? fakeInference(source.chat) : source.kind === 'custom' ? source.provider : http!;
		this._servers.set(name, { source, http, provider: this._hooks.wrap(inner, !!http) });
		this.resolveOn(name);
	}

	/** Drops the server and every model on it. */
	public removeInference(name:string):void {
		this._servers.delete(name);
		for (const model of [...this._specs.keys()]) {
			if (this.serverName(this._specs.get(model)!) === undefined) {
				this.removeModel(model);
			}
		}
	}

	/** Adds or replaces `name`. The first one added is the default until `setDefault` says otherwise. */
	public addModel(name:string, spec:ModelSpec = {}):void {
		this._specs.set(name, { ...spec });
		if (!spec.decision) {
			this._default ??= name;
		}
		if (this._started) {
			void this.resolve(name).catch((err:unknown) => this._hooks.log(errorText(err), true));
		}
	}

	public removeModel(name:string):void {
		const live = this._live.get(name);
		this._specs.delete(name);
		this._live.delete(name);
		if (live && ![...this._live.values()].some((other) => other.id === live.id)) {
			this.serverOf(name)?.http?.forgetModel(live.id);
		}
		if (this._default === name) {
			this._default = [...this._specs].find(([, other]) => !other.decision)?.[0] ?? null;
		}
		this._hooks.changed();
	}

	public setDefault(name:string):void {
		if (!this._specs.has(name)) {
			throw new Error(`ArcDirector: no model '${name}' (addModel)`);
		}
		this._default = name;
		this._hooks.changed();
	}

	public has(name:string):boolean {
		return this._specs.has(name);
	}

	/** `name`'s model, or the default when `name` is omitted or gone. Undefined until its server answered. */
	public live(name?:string):LiveModel | undefined {
		const own = name !== undefined && this._specs.has(name) ? name : this._default;
		return own === null ? undefined : this._live.get(own);
	}

	/** Every model resolved so far. */
	public all():LiveModel[] {
		return [...this._live.values()];
	}

	public setEmbeddings(spec:EmbeddingSpec | undefined):void {
		this._embeddings = spec;
	}

	/** Vectors from the director's one embedding model, or undefined without one. */
	public embedder():((texts:string[])=>Promise<number[][]>) | undefined {
		const spec = this._embeddings;
		if (!spec) {
			return undefined;
		}
		return async (texts) => {
			const server = this.serverFor(spec.inference);
			if (!server?.provider.embed) {
				throw new Error(`ArcDirector: no server for embeddings '${spec.id}'`);
			}
			return server.provider.embed(texts, spec.id);
		};
	}

	/** Resolve every model; with none added, add the first server's own pick. Rejects when one cannot resolve. */
	public async start():Promise<void> {
		this._started = true;
		const first = this._servers.keys().next().value;
		if (this._default === null && first !== undefined && !this._specs.has(first)) {
			this._specs.set(first, {});
			this._default = first;
		}
		await Promise.all([...this._specs.keys()].map((name) => this.resolve(name)));
	}

	private serverName(spec:ModelSpec):string | undefined {
		const name = spec.inference ?? this._servers.keys().next().value;
		return name !== undefined && this._servers.has(name) ? name : undefined;
	}

	private serverFor(name:string | undefined):Server | undefined {
		return this._servers.get(name ?? this._servers.keys().next().value ?? '');
	}

	private serverOf(model:string):Server | undefined {
		const spec = this._specs.get(model);
		const name = spec && this.serverName(spec);
		return name === undefined ? undefined : this._servers.get(name);
	}

	/** After a server is added again, its models resolve against it. */
	private resolveOn(server:string):void {
		if (!this._started) {
			return;
		}
		for (const [name, spec] of this._specs) {
			if (this.serverName(spec) === server) {
				void this.resolve(name).catch((err:unknown) => this._hooks.log(errorText(err), true));
			}
		}
	}

	private async catalogOf(server:Server):Promise<ModelInfo[]> {
		if (!server.http || server.source.kind !== 'http') {
			return [];
		}
		const { apiKey, fetch } = server.source.opts;
		return fetchModelCatalog(server.http.rootURL, { fetch, headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined });
	}

	private async resolve(name:string):Promise<void> {
		const spec = this._specs.get(name);
		const serverName = spec && this.serverName(spec);
		const server = serverName === undefined ? undefined : this._servers.get(serverName);
		if (!spec || !server) {
			throw new Error(`ArcDirector: model '${name}' has no server (add*Inference)`);
		}
		const { source } = server;
		const catalog = await this.catalogOf(server);
		const id = spec.id
			? findModel(catalog, spec.id)?.id ?? spec.id
			: source.kind === 'fake' ? 'fake' : source.kind === 'custom' ? name
				: pickSingleChatModel(catalog, PREFERRED_MODELS);
		if (!id) {
			throw new Error(`ArcDirector: no model at ${server.http?.baseURL ?? serverName}`);
		}
		const info = findModel(catalog, id);
		const vision = source.kind === 'custom' && source.vision !== undefined
			? source.vision
			: source.kind !== 'fake' && isVisionModel(info ?? id);
		const thinking = spec.thinking ?? (source.kind === 'http' && source.opts.enableThinking === true);
		// A decision model answers through the System One endpoint, which loads it itself.
		const systemOneURL = info && isDecisionModel(info) && server.http ? `${server.http.baseURL.replace(/\/+$/, '')}/systemone` : undefined;
		if (!systemOneURL) {
			server.http?.configureModel(id, { contextLength: spec.contextLength, enableThinking: spec.thinking, reasoningEffort: spec.reasoningEffort });
		}
		const contextLength = spec.contextLength
			?? (source.kind === 'http' ? source.opts.load?.contextLength : undefined);
		this._live.set(name, {
			name,
			id,
			provider: server.provider,
			vision,
			thinking,
			maxParallel: spec.maxParallel ?? DEFAULT_MAX_PARALLEL,
			contextLength,
			systemOneURL,
		});
		this._hooks.log(`${name}: ${id}${vision ? ' (vision)' : ''}`);
		// Its first request loads it, so a model nobody uses takes no VRAM.
		this._hooks.changed();
	}
}

function errorText(err:unknown):string {
	return err instanceof Error ? err.message : String(err);
}
