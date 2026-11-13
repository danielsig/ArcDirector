import type { ArcDirector } from '../director/ArcDirector.js';
import { ModelProvider, providerShortcuts, type ProviderConfig } from '../director/ModelProvider.js';
import { chatContentText, type ChatRequest, type ChatResponse, type InferenceProvider } from './provider.js';
import type { SystemOne } from './system-one.js';

export type FakeChatFn = (req:ChatRequest)=>ChatResponse | Promise<ChatResponse>;
export type FakeEmbedFn = (texts:string[], model?:string)=>number[][] | Promise<number[][]>;

function abortError():Error {
	const err = new Error('aborted');
	err.name = 'AbortError';
	return err;
}

export class FakeProvider implements InferenceProvider {
	constructor(
		private readonly _chatFn:FakeChatFn,
		private readonly _embedFn?:FakeEmbedFn,
	) {}

	public chat(req:ChatRequest):Promise<ChatResponse> {
		const run = Promise.resolve(this._chatFn(req));
		const signal = req.signal;
		if (!signal) {
			return run;
		}
		if (signal.aborted) {
			return Promise.reject(abortError());
		}
		return Promise.race([
			run,
			new Promise<ChatResponse>((resolve, reject) => {
				signal.addEventListener('abort', () => reject(abortError()), { once: true });
			}),
		]);
	}

	public embed(texts:string[], model?:string):Promise<number[][]> {
		if (!this._embedFn) {
			return Promise.reject(new Error('FakeProvider has no embeddings'));
		}
		return Promise.resolve(this._embedFn(texts, model));
	}
}

/** Deterministic helper: go_to the first PascalCase name in the last user message. */
export function goToNamedInteractable():FakeChatFn {
	return (req) => {
		const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
		const text = chatContentText(lastUser?.content);
		const names = text.match(/\b[A-Z][A-Za-z0-9]+(?:[A-Z][A-Za-z0-9]+)+\b/g) ?? [];
		const name = names.find((n) => n !== 'Arc') ?? 'EastGate';
		return {
			content: JSON.stringify({ steps: [{ verb: 'go_to', target: name }] }),
			toolCalls: [],
		};
	};
}

export function hashEmbed(text:string, dims = 8):number[] {
	const vec = new Array<number>(dims).fill(0);
	for (let i = 0; i < text.length; i++) {
		vec[i % dims] += text.charCodeAt(i) / 255;
	}
	let n = 0;
	for (const v of vec) {
		n += v * v;
	}
	const s = Math.sqrt(n) || 1;
	return vec.map((v) => v / s);
}

/**
 * What `addFake` takes: canned replies (default {@link goToNamedInteractable}), vectors, whether its models see, and
 * `pick`, with which it is a System One instead, under its one role, its name.
 */
export type FakeConfig = ProviderConfig & { chat?:FakeChatFn; embed?:FakeEmbedFn; pick?:SystemOne['pick']; vision?:boolean };

/** Canned replies for tests (`addFake`): each model's id is `fake` unless its spec says. */
export class Fake extends ModelProvider {
	constructor(private readonly _config:FakeConfig = {}) {
		super(_config.name ?? 'fake', new FakeProvider(_config.chat ?? goToNamedInteractable(), _config.embed), _config, _config.pick && { pick: _config.pick });
	}

	protected override defaultID():string {
		return 'fake';
	}

	protected override sees():boolean {
		return this._config.vision ?? false;
	}
}

declare module '../director/ArcDirector.js' {
	interface ArcDirector<TCtx, TEntity> {
		/** {@link Fake}: `addFake({ chat: (req) => reply })`. */
		addFake(config?:FakeConfig):this;
		getFake(name?:string):Fake | undefined;
	}
}
export const { add: addFake, get: getFake } = providerShortcuts(Fake, 'fake');
