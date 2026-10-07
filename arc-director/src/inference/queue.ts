import type { InferenceProvider } from './provider.js';

export class InferenceQueue {
	private _active = 0;
	private readonly _waiters:Array<()=>void> = [];

	constructor(public readonly maxInFlight = 2) {}

	public async run<T>(fn:()=>Promise<T>):Promise<T> {
		await this.acquire();
		try {
			return await fn();
		}
		finally {
			this.release();
		}
	}

	private acquire():Promise<void> {
		if (this._active < this.maxInFlight) {
			this._active += 1;
			return Promise.resolve();
		}
		return new Promise((resolve) => {
			this._waiters.push(() => {
				this._active += 1;
				resolve();
			});
		});
	}

	private release():void {
		this._active -= 1;
		const next = this._waiters.shift();
		if (next) {
			next();
		}
	}
}

export function withQueue(inner:InferenceProvider, maxInFlight = 2):InferenceProvider {
	const queue = new InferenceQueue(maxInFlight);
	const embed = inner.embed?.bind(inner);
	return {
		chat(req) {
			return queue.run(() => inner.chat(req));
		},
		embed: embed
			? (texts, model) => queue.run(() => embed(texts, model))
			: undefined,
	};
}
