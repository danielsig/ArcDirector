/** Where a frame's time goes, as {@link PerfHistory} splits it. */
export type FramePhase = 'director' | 'simulate' | 'render';

/** Frame history on top of the renderer's stats: read live over `render_stats`. */
export type PerfStats = {
	/** Frames drawn in each of the last {@link PerfHistory.seconds} whole seconds, oldest first. */
	fps:number[];
	/** Average ms per frame over the last whole second, per phase. */
	phaseMS:Record<FramePhase, number>;
	/** Used JS heap in MB, where the browser tells (Chrome). */
	heapMB:number | undefined;
};

const PHASES:readonly FramePhase[] = ['director', 'simulate', 'render'];

/** Per-second frame counts in a ring, and phase times averaged over the last second. Allocates nothing per frame. */
export class PerfHistory {
	public readonly seconds:number;
	/** Ms added to each phase since the start, so a caller can subtract a phase nested inside its own span. */
	public readonly totalMS:Record<FramePhase, number> = { director: 0, simulate: 0, render: 0 };
	private readonly _ring:Int32Array;
	/** Seconds written so far, so the ring's oldest entry is at `_written % seconds` once full. */
	private _written = 0;
	private _secondStart = -1;
	private _frames = 0;
	private readonly _sums:Record<FramePhase, number> = { director: 0, simulate: 0, render: 0 };
	private readonly _counts:Record<FramePhase, number> = { director: 0, simulate: 0, render: 0 };
	private readonly _phaseMS:Record<FramePhase, number> = { director: 0, simulate: 0, render: 0 };

	constructor(seconds = 600) {
		this.seconds = seconds;
		this._ring = new Int32Array(seconds);
	}

	/** Adds `ms` to `phase` for the current second. */
	public add(phase:FramePhase, ms:number):void {
		this._sums[phase] += ms;
		this.totalMS[phase] += ms;
		this._counts[phase]++;
	}

	/** Counts one drawn frame at `now` (ms); closes every second that has passed since the last. */
	public frame(now:number):void {
		if (this._secondStart < 0) {
			this._secondStart = now;
		}
		while (now - this._secondStart >= 1000) {
			this.closeSecond();
			this._secondStart += 1000;
		}
		this._frames++;
	}

	public stats():PerfStats {
		const count = Math.min(this._written, this.seconds);
		const fps:number[] = [];
		for (let i = this._written - count; i < this._written; i++) {
			fps.push(this._ring[i % this.seconds]!);
		}
		const memory = (performance as { memory?:{ usedJSHeapSize:number } }).memory;
		return {
			fps,
			phaseMS: { ...this._phaseMS },
			heapMB: memory ? Math.round(memory.usedJSHeapSize / 1048576) : undefined,
		};
	}

	private closeSecond():void {
		this._ring[this._written % this.seconds] = this._frames;
		this._written++;
		this._frames = 0;
		for (const phase of PHASES) {
			this._phaseMS[phase] = this._counts[phase] ? this._sums[phase] / this._counts[phase] : 0;
			this._sums[phase] = 0;
			this._counts[phase] = 0;
		}
	}
}
