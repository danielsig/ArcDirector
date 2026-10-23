/** How far a {@link ModelDownload} has come. */
export type DownloadProgress = {
	/** 0 to 1. */
	progress:number;
	/** What it is doing, as its runtime says it. */
	text:string;
};

/** What a {@link ModelDownload} tells: progress, then its end. Every callback is optional. */
export type DownloadObserver = {
	next?(progress:DownloadProgress):void;
	error?(err:unknown):void;
	/** The model answers now. */
	complete?():void;
};

export type DownloadSubscription = {
	unsubscribe():void;
	readonly closed:boolean;
};

/** How a download that was cancelled ({@link ModelDownload.cancel}) ends: not a failure to show anyone. */
export class DownloadCancelled extends Error {
	constructor() {
		super('the download was cancelled');
		this.name = 'DownloadCancelled';
	}
}

/**
 * A model's download and load. It is an Observable (the TC39 shape, so `from(download)` in RxJS takes it): progress
 * as `next`, then `complete` once the model answers, or `error`. A late subscriber gets the last progress at once,
 * then the end if it came. `done` is the same as a promise. {@link cancel} stops it.
 */
export class ModelDownload {
	private readonly _observers = new Set<DownloadObserver>();
	private _progress:DownloadProgress = { progress: 0, text: '' };
	private _state:'pending' | 'done' | 'failed' = 'pending';
	private _error:unknown;
	private _done:Promise<void> | null = null;
	private _settle:{ resolve():void; reject(err:unknown):void } | null = null;
	private readonly _abort = new AbortController();

	/** Starts `job`, which reports its progress to `report` and stops when `signal` aborts. */
	constructor(job:(report:(progress:DownloadProgress)=>void, signal:AbortSignal)=>Promise<void>) {
		void job((progress) => this.emit(progress), this._abort.signal).then(() => this.finish('done'), (err:unknown) => this.finish('failed', err));
	}

	/**
	 * Stops it while it is under way: it ends at once, failed with a {@link DownloadCancelled}, and what was fetched so
	 * far is dropped. Every model sharing it stops too. Nothing once it has ended.
	 */
	public cancel():void {
		if (this._state === 'pending') {
			this._abort.abort();
			this.finish('failed', new DownloadCancelled());
		}
	}

	/** Whether it ended by {@link cancel}. */
	public get cancelled():boolean {
		return this._error instanceof DownloadCancelled;
	}

	public get progress():DownloadProgress {
		return this._progress;
	}

	public get state():'pending' | 'done' | 'failed' {
		return this._state;
	}

	/** Resolves once the model answers; rejects if it never will. */
	public get done():Promise<void> {
		if (!this._done) {
			this._done = this._state === 'done' ? Promise.resolve()
				: this._state === 'failed' ? Promise.reject(this._error)
					: new Promise((resolve, reject) => {
						this._settle = { resolve, reject };
					});
		}
		return this._done;
	}

	/** `next` alone, or an observer with any of `next`, `error` and `complete`. */
	public subscribe(observer:DownloadObserver | ((progress:DownloadProgress)=>void)):DownloadSubscription {
		const own:DownloadObserver = typeof observer === 'function' ? { next: observer } : observer;
		own.next?.(this._progress);
		if (this._state === 'done') {
			own.complete?.();
		}
		else if (this._state === 'failed') {
			own.error?.(this._error);
		}
		else {
			this._observers.add(own);
		}
		const observers = this._observers;
		return {
			unsubscribe: () => {
				observers.delete(own);
			},
			get closed() {
				return !observers.has(own);
			},
		};
	}

	/** Interop: RxJS and other Observable libraries find it by this key where `Symbol.observable` is absent. */
	public ['@@observable']():this {
		return this;
	}

	private emit(progress:DownloadProgress):void {
		this._progress = progress;
		for (const observer of this._observers) {
			observer.next?.(progress);
		}
	}

	private finish(state:'done' | 'failed', err?:unknown):void {
		// A cancelled one has ended already; its job ending after is nothing new.
		if (this._state !== 'pending') {
			return;
		}
		this._state = state;
		this._error = err;
		const observers = [...this._observers];
		this._observers.clear();
		for (const observer of observers) {
			if (state === 'done') {
				observer.complete?.();
			}
			else {
				observer.error?.(err);
			}
		}
		if (state === 'done') {
			this._settle?.resolve();
		}
		else {
			this._settle?.reject(err);
		}
	}
}

/** Interop: where `Symbol.observable` exists, it finds the download as `@@observable` does. */
const observableKey = (Symbol as { observable?:symbol }).observable;
if (observableKey) {
	Object.defineProperty(ModelDownload.prototype, observableKey, {
		value(this:ModelDownload):ModelDownload {
			return this;
		},
	});
}
