/// <reference lib="esnext.disposable" />

/**
 * Calls `tick(dt)` at a fixed interval. For games that don't call `tick(dt)` from their own loop.
 * It starts on construction and never keeps a Node process alive. Time is scaled by `timeScale`.
 * `using ticker = new Ticker(director)` stops it at the end of the scope.
 */
export class Ticker {
	/** How fast game time runs against the wall clock: `0` pauses, `0.3` is slow motion. */
	public timeScale:number;
	private _wall = performance.now();
	private _timer:ReturnType<typeof setInterval> | undefined;

	constructor(director:{ tick(dt:number):void }, { interval = 0.05, timeScale = 1 } = {}) {
		this.timeScale = timeScale;
		this._timer = setInterval(() => {
			const wall = performance.now();
			director.tick(((wall - this._wall) / 1000) * this.timeScale);
			this._wall = wall;
		}, interval * 1000);
		(this._timer as { unref?:()=>void }).unref?.();
	}

	public get running():boolean {
		return this._timer !== undefined;
	}

	public stop():void {
		clearInterval(this._timer);
		this._timer = undefined;
	}

	public [Symbol.dispose]():void {
		this.stop();
	}
}
