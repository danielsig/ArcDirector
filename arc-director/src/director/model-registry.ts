import { loggedProvider } from '../inference/chat-log.js';
import type { InferenceProvider } from '../inference/provider.js';
import { ModelSystemOne } from '../inference/system-one.js';
import { emptyInferClock, type DirectorLog, type InferClock } from './director-types.js';
import type { ModelProvider, ProvidedModel } from './ModelProvider.js';
import { URGENT, type ModelChat, type ModelRun } from './ModelSlots.js';

/** How long a System One that failed is skipped, so each pick does not wait on it again. */
const SYSTEM_ONE_REST_MS = 30_000;

/** A model as a director thinks with it: as its provider answered it, with leases on its slots (`ModelSlots.on`) logged here. */
export type LiveModel = ProvidedModel & { chat:ModelChat; run:ModelRun };

/** A provider on this director: its transport timed and logged here, and how to stop hearing its roles. */
type Held = { provider:ModelProvider; logged:InferenceProvider; unwatch:()=>void };

/**
 * A director's providers and the one index of roles to them, each held by one provider at a time; minds without a
 * role, or whose role went away, use the default (the README's Inference). Every request is timed and logged here.
 */
export class ModelRegistry {
	private readonly _providers = new Map<string, Held>();
	private readonly _leases = new WeakMap<ProvidedModel, LiveModel>();
	/** When each System One that failed may be asked again (`performance.now()`). */
	private readonly _systemOneRest = new Map<string, number>();
	private _defaultSystemOne:string | null = null;
	private _default:string | null = null;
	private _started = false;
	private readonly _infer:InferClock = emptyInferClock();

	constructor(private readonly _log:(entry:DirectorLog)=>void) {}

	/** How long the servers took, all requests together and per mind, since the start or `resetInferStats`. */
	public get infer():InferClock {
		return this._infer;
	}

	public resetInferStats():void {
		Object.assign(this._infer, emptyInferClock());
	}

	/** `provider` under its name, any time, in place of one named alike; each of its roles moves to it. */
	public addProvider(provider:ModelProvider):this {
		this._providers.get(provider.name)?.unwatch();
		const logged = loggedProvider(provider.transport, this._infer, this._log);
		this._providers.set(provider.name, { provider, logged, unwatch: provider.watch((role) => this.heard(provider, role)) });
		provider.roles.forEach((role) => this.heard(provider, role));
		return this;
	}

	public getProvider(name:string):ModelProvider | undefined {
		return this._providers.get(name)?.provider;
	}

	/** Every provider, in the order added: another director thinks on them as they are with `addProvider`. */
	public get providers():ModelProvider[] {
		return [...this._providers.values()].map(({ provider }) => provider);
	}

	/** Stop hearing every provider: the director is gone, and they may outlive it. */
	public dispose():void {
		this._providers.forEach((held) => held.unwatch());
	}

	/** The model minds think with when their settings name none. */
	public withDefault(role:string):this {
		this.held(role);
		this._default = role;
		return this;
	}

	/** The System One of every runner without one of its own, any time; `null` for none, which withholds `choose`. */
	public withDefaultSystemOne(role:string | null):this {
		if (role !== null) {
			this.held(role);
		}
		this._defaultSystemOne = role;
		return this;
	}

	public get defaultSystemOne():string | null {
		return this._defaultSystemOne;
	}

	/** Every role, on whichever provider holds it. */
	public get roles():string[] {
		return this.providers.flatMap((provider) => provider.roles);
	}

	public has(role:string):boolean {
		return this.roles.includes(role);
	}

	/** `role`'s model, or the default's when `role` is omitted or gone. Undefined until its provider answered. */
	public live(role?:string):LiveModel | undefined {
		const own = [role, this._default].find((name):name is string => name != null && this.has(name));
		return own !== undefined ? this.exact(own) : this.roles.map((name) => this.exact(name)).find((model) => model && !model.decision && !model.embedding);
	}

	/**
	 * Which of `criteria`'s choices serves `goal` given `state`: System One `own` answers first; when it fails or names
	 * no choice, every other decision model not resting in turn, then chat model `chat`. One that failed rests a while.
	 * Undefined `name` when none named a choice; `misses` says why each did not.
	 */
	public async pick(own:string, state:string, goal:string, criteria:Record<string, string>, chat?:string):Promise<{ name?:string; by?:string; misses:string[] }> {
		const now = performance.now();
		const others = this.roles.filter((role) => this.exact(role)?.decision && (this._systemOneRest.get(role) ?? 0) <= now);
		const asked = [...new Set([own, ...others, this.live(chat)?.name])].filter((by) => by !== undefined);
		const misses:string[] = [];
		for (const by of asked) {
			try {
				const systemOne = this.held(by).provider.systemOne;
				const ask = ():Promise<string> => (systemOne ?? new ModelSystemOne(() => ({ ...this.need(by), provider: this.held(by).logged }))).pick(state, goal, criteria);
				// A model's pick takes one of its slots, ahead of every think.
				const name = await (systemOne ? ask() : this.need(by).run(URGENT, ask));
				if (Object.hasOwn(criteria, name)) {
					return { name, by, misses };
				}
				misses.push(`${by} named '${name}'`);
			}
			catch (err) {
				misses.push(`${by}: ${errorText(err)}`);
				this._systemOneRest.set(by, performance.now() + SYSTEM_ONE_REST_MS);
			}
		}
		return { misses };
	}

	/** Vectors from the one model flagged `embedding`; rejects without one, so recall matches text. */
	public async embed(texts:string[]):Promise<number[][]> {
		const model = this.roles.map((role) => this.exact(role)).find((live) => live?.embedding);
		const embed = model && this.held(model.name).logged.embed;
		if (!model || !embed) {
			throw new Error('ArcDirector: no embedding model');
		}
		return embed(texts, model.id);
	}

	/**
	 * Load model `role`, or the default, now: one request a token long, so the first think is not the one that waits
	 * for it, as before a bench times thinks. Rejects when the model cannot answer.
	 */
	public async warmUp(role?:string):Promise<void> {
		const model = this.live(role);
		if (!model) {
			throw new Error(`ArcDirector: no chat model '${role ?? 'default'}'`);
		}
		await model.run(URGENT, (chat) => chat({ messages: [{ role: 'user', content: 'Reply with OK.' }], maxTokens: 1, enableThinking: false }));
	}

	/**
	 * Look up every role; with none on any chat provider, the first takes its own pick, named after it. Rejects when one
	 * cannot be looked up, or two models embed.
	 */
	public async start():Promise<void> {
		const chat = this.providers.filter((provider) => !provider.systemOne);
		if (chat[0] && chat.every((provider) => provider.roles.length === 0)) {
			chat[0].addModel(chat[0].name, {});
		}
		this._started = true;
		await Promise.all(this.roles.filter((role) => !this.exact(role)).map((role) => this.resolve(role)));
		const embedding = this.roles.filter((role) => this.exact(role)?.embedding);
		if (embedding.length > 1) {
			throw new Error(`ArcDirector: one model embeds, not ${embedding.join(' and ')}`);
		}
	}

	private log(message:string, error?:boolean):void {
		this._log({ name: 'ArcDirector', message, error });
	}

	/** A role added to `provider` leaves every other provider here, and is looked up once the director started. */
	private heard(provider:ModelProvider, role:string):void {
		if (!provider.has(role)) {
			return;
		}
		for (const { provider: other } of this._providers.values()) {
			if (other !== provider && other.has(role)) {
				other.removeModel(role);
				this.log(`${role}: moved from ${other.name} to ${provider.name}`);
			}
		}
		if (this._started) {
			void this.resolve(role).catch((err:unknown) => this.log(errorText(err), true));
		}
	}

	private async resolve(role:string):Promise<void> {
		const { id, vision } = await this.held(role).provider.resolve(role);
		this.log(`${role}: ${id}${vision ? ' (vision)' : ''}`);
	}

	/** The provider here that holds `role`. Throws when none does. */
	private held(role:string):Held {
		const held = [...this._providers.values()].find(({ provider }) => provider.has(role));
		if (!held) {
			throw new Error(`ArcDirector: no model '${role}'`);
		}
		return held;
	}

	/** Exactly `role`'s model, with its leases here; undefined while its provider has not answered. */
	private exact(role:string):LiveModel | undefined {
		const held = this.has(role) ? this.held(role) : undefined;
		const model = held?.provider.model(role);
		if (!held || !model) {
			return undefined;
		}
		const live = this._leases.get(model) ?? { ...model, ...model.slots.on(held.logged, model.id) };
		this._leases.set(model, live);
		return live;
	}

	/** `role`'s model; throws while there is none. */
	private need(role:string):LiveModel {
		const model = this.exact(role);
		if (!model) {
			throw new Error(`ArcDirector: no chat model '${role}'`);
		}
		return model;
	}
}

function errorText(err:unknown):string {
	return err instanceof Error ? err.message : String(err);
}
