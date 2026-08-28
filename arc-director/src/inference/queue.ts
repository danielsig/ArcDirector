import type { InferenceProvider } from './provider.js';

export class InferenceQueue {
	private active = 0;
	private readonly waiters:Array<()=>void> = [];

	constructor(readonly maxInFlight = 2) {}

	async run<T>(fn:()=>Promise<T>):Promise<T> {
		await this.acquire();
		try {
			return await fn();
		}
		finally {
			this.release();
		}
	}

	private acquire():Promise<void> {
		if (this.active < this.maxInFlight) {
			this.active += 1;
			return Promise.resolve();
		}
		return new Promise((resolve) => {
			this.waiters.push(() => {
				this.active += 1;
				resolve();
			});
		});
	}

	private release():void {
		this.active -= 1;
		const next = this.waiters.shift();
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
