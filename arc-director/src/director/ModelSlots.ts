import { thoughtTokens, type ChatRequest, type ChatResponse, type InferenceProvider } from '../inference/provider.js';

/** A chat with the model a lease holds: it names the model, and the lease's signal ends it too. */
export type ModelChat = (req:Omit<ChatRequest, 'model'>)=>Promise<ChatResponse>;

/**
 * Runs `work` once a slot of the model is free, highest `priority` first, and hands it a chat with the model for every
 * request it makes; `signal` drops it while it waits, and ends its requests.
 */
export type ModelRun = <T>(priority:number, work:(chat:ModelChat)=>Promise<T>, signal?:AbortSignal)=>Promise<T>;

/**
 * The priority of a System One's pick, `thinkNow` and `warmUp`: above every think, whose scores run
 * up to 1. Such a lease starts at once while a slot is free, and is never held for a wave.
 */
export const URGENT = 2;

/** The priority of a lone request through {@link ModelSlots.on}'s `chat`: among the thinks. */
const CHAT_PRIORITY = 0.5;

type Waiter = { priority:number; start:()=>void };

/**
 * One model's slots on one server: `maxParallel` leases at a time, highest priority first, first come first within one.
 * A lease holds its slot for all its work: a whole think, its tool rounds and repairs. With `batchWait` (wall-clock
 * seconds; 0 for off), once a slot frees while others still generate, new leases wait until every slot is idle or that
 * long has passed, then start as one wave: a new prompt's prefill stalls every slot already decoding. Single-threaded.
 */
export class ModelSlots {
	private _running = 0;
	private readonly _waiting:Waiter[] = [];
	/** When leases began waiting for the slots to go idle, while some still run. */
	private _heldSince:number | undefined;
	private _timer:ReturnType<typeof setTimeout> | undefined;

	constructor(public readonly maxParallel:number, public readonly batchWait:number) {}

	/** Runs `work` once a slot is free, and frees the slot when it ends; `signal` drops it while it waits. */
	public run<T>(priority:number, work:()=>Promise<T>, signal?:AbortSignal):Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const waiter:Waiter = {
				priority,
				start: () => {
					signal?.removeEventListener('abort', drop);
					this._running += 1;
					work().then(resolve, reject).finally(() => {
						this._running -= 1;
						this.drain();
					});
				},
			};
			const drop = ():void => {
				this._waiting.splice(this._waiting.indexOf(waiter), 1);
				reject(signal!.reason ?? new Error('aborted'));
			};
			if (signal?.aborted) {
				reject(signal.reason ?? new Error('aborted'));
				return;
			}
			signal?.addEventListener('abort', drop, { once: true });
			const after = this._waiting.findIndex((other) => other.priority < priority);
			this._waiting.splice(after < 0 ? this._waiting.length : after, 0, waiter);
			// An urgent one starts at once if a slot is free. Others asked for together start together: their drain waits for
			// the caller's own synchronous work.
			if (priority >= URGENT) {
				this.drain();
			}
			else {
				queueMicrotask(() => this.drain());
			}
		});
	}

	/** Leases on these slots for model `id` on `provider`, and a lone request as a lease of its own. */
	public on(provider:InferenceProvider, id:string):{ run:ModelRun; chat:ModelChat } {
		const run:ModelRun = (priority, work, signal) => this.run(priority, () => {
			// Its requests share one thinking budget: each is told how much the ones before it thought, and what the last
			// that thought was allowed.
			let thinkingSpent = 0;
			let lastThinkingAllowance:number | undefined;
			return work(async (req) => {
				const res = await provider.chat({
					model: id,
					...req,
					thinkingSpent: thinkingSpent || undefined,
					lastThinkingAllowance,
					signal: req.signal && signal ? AbortSignal.any([req.signal, signal]) : req.signal ?? signal,
				});
				// A reply the budget cut short spent all it was allowed, whatever the count says: 1.3 a word falls short of the
				// tokens a stream counts.
				const cut = !!res.truncated && !res.content;
				thinkingSpent += Math.max(thoughtTokens(res.reasoning), cut ? res.thinkingAllowance ?? 0 : 0);
				lastThinkingAllowance = res.thinkingAllowance ?? lastThinkingAllowance;
				return res;
			});
		}, signal);
		return { run, chat: (req) => run(CHAT_PRIORITY, (chat) => chat(req)) };
	}

	private drain():void {
		clearTimeout(this._timer);
		const held = this.batchWait > 0 && this._running > 0 && this._waiting.some((waiter) => waiter.priority < URGENT);
		this._heldSince = held ? this._heldSince ?? performance.now() : undefined;
		const left = held ? this.batchWait * 1000 - (performance.now() - this._heldSince!) : 0;
		while (this._running < this.maxParallel && this._waiting[0] && (left <= 0 || this._waiting[0].priority >= URGENT)) {
			this._waiting.shift()!.start();
		}
		if (left > 0) {
			this._timer = setTimeout(() => this.drain(), left);
			(this._timer as { unref?:()=>void }).unref?.();
		}
		else {
			this._heldSince = undefined;
		}
	}
}
