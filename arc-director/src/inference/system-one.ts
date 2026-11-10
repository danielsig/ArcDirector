import { isRecord } from '../json.js';
import type { InferenceProvider } from './provider.js';

/**
 * A fast model that picks one name from a set of criteria: the System One behind `choose`.
 * `criteria` maps each choice name to what it does; the answer is one of those names.
 */
export type SystemOne = {
	pick(state:string, goal:string, criteria:Record<string, string>):Promise<string>;
};

export type JevOpts = {
	/**
	 * The full endpoint. Default `/systemone`: a page posts to its own proxy, which adds the key. One ending in
	 * `/decisions` is asked in OpenAI's Decisions format instead (LM Studio serves both).
	 */
	baseURL:string;
	/** Default `jev-latest`. */
	model:string;
	fetch?:typeof fetch;
	/** Sent with every pick: `Authorization` where no proxy adds it. */
	headers?:Record<string, string>;
};

/**
 * A decision model behind the System One API (`POST /v1/systemone`: TypeSafe's Jev, or a decision model LM Studio
 * serves) or OpenAI's Decisions API (`POST /v1/decisions`), one `choice` question per pick.
 */
export class JevSystemOne implements SystemOne {
	private readonly _opts:JevOpts;
	private readonly _fetch:typeof fetch;

	constructor(opts:Partial<JevOpts> = {}) {
		this._opts = { baseURL: '/systemone', model: 'jev-latest', ...opts };
		const impl = opts.fetch ?? fetch;
		this._fetch = (input, init) => impl(input, init);
	}

	public async pick(state:string, goal:string, criteria:Record<string, string>):Promise<string> {
		const decisions = /\/decisions\/?$/.test(this._opts.baseURL);
		const res = await this._fetch(this._opts.baseURL, {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...this._opts.headers },
			body: JSON.stringify(decisions
				? {
					model: this._opts.model,
					input: state,
					questions: [{
						type: 'choice',
						name: 'pick',
						instructions: goal,
						choices: Object.entries(criteria).map(([value, description]) => ({ value, description })),
					}],
				}
				: { state, model: this._opts.model, questions: { pick: { type: 'choice', instructions: goal, criteria } } }),
		});
		if (!res.ok) {
			throw new Error(`System One ${res.status}: ${(await res.text()).slice(0, 200)}`);
		}
		const json:unknown = await res.json();
		const answers = isRecord(json) ? json.answers : undefined;
		const answer = Array.isArray(answers) ? answers[0] : isRecord(answers) ? answers.pick : undefined;
		if (!isRecord(answer) || typeof answer.choice !== 'string') {
			throw new Error('System One answered without a choice');
		}
		return answer.choice;
	}
}

/** What {@link ModelSystemOne} asks: a model on a server, and that server's System One endpoint when it is a decision model. */
export type DecidingModel = {
	provider:InferenceProvider;
	id:string;
	/** A decision model's endpoint (`…/v1/systemone`); absent for a chat model. */
	systemOneURL?:string;
};

/**
 * A model on a server as a System One: a decision model through its System One endpoint (its server's, or the one
 * its provider serves it on, as a browser does), any other scored as a {@link ChatSystemOne}. A getter, so it follows
 * the model as it changes.
 */
export class ModelSystemOne implements SystemOne {
	private readonly _model:()=>DecidingModel;
	private readonly _chat:ChatSystemOne;

	constructor(model:()=>DecidingModel) {
		this._model = model;
		this._chat = new ChatSystemOne(() => model().provider, () => model().id);
	}

	public async pick(state:string, goal:string, criteria:Record<string, string>):Promise<string> {
		const { provider, id, systemOneURL } = this._model();
		const endpoint = systemOneURL ? { url: systemOneURL } : await provider.systemOneEndpoint?.(id);
		return endpoint
			? new JevSystemOne({ baseURL: endpoint.url, model: id, fetch: endpoint.fetch }).pick(state, goal, criteria)
			: this._chat.pick(state, goal, criteria);
	}
}

/** Option labels: a pick reads the first answer token's log probabilities over these. */
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * A chat model as a System One. The choices are lettered options, the answer is one token with reasoning off, and
 * the declared letter the model scores highest wins, so no schema, reasoning or chatty reply gets in the way.
 * A server that returns no log probabilities is read by the letter it answered.
 */
export class ChatSystemOne implements SystemOne {
	private readonly _provider:()=>InferenceProvider;
	private readonly _model:()=>string;

	/** Getters, so it follows the director's provider and model as they change. */
	constructor(provider:()=>InferenceProvider, model:()=>string) {
		this._provider = provider;
		this._model = model;
	}

	public async pick(state:string, goal:string, criteria:Record<string, string>):Promise<string> {
		const names = Object.keys(criteria);
		if (names.length > LETTERS.length) {
			throw new Error(`System One takes at most ${LETTERS.length} choices`);
		}
		const letters = [...LETTERS.slice(0, names.length)];
		const options = names.map((name, i) => `${letters[i]}. ${criteria[name]}`).join('\n');
		const res = await this._provider().chat({
			model: this._model(),
			messages: [
				{ role: 'system', content: 'Pick the option that best serves the goal. Answer with its letter only.' },
				{ role: 'user', content: `${state}\n\nGoal: ${goal}\nOptions:\n${options}` },
			],
			sampling: { temperature: 0 },
			maxTokens: 1,
			enableThinking: false,
			// xAI allows at most 8; a letter outside the top 8 would not win anyway.
			topLogprobs: 8,
		});
		const scored = letters.filter((letter) => res.logprobs?.[letter] !== undefined);
		const letter = scored.length > 0
			? scored.reduce((best, next) => (res.logprobs![next] > res.logprobs![best] ? next : best))
			: res.content?.trim()[0];
		const i = letter ? letters.indexOf(letter) : -1;
		return i >= 0 ? names[i] : (res.content ?? '');
	}
}
