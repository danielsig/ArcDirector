function wrap(value:number, span:number):number {
	if (!(span > 0)) {
		return 0;
	}
	const w = value % span;
	return w < 0 ? w + span : w;
}

/**
 * Where a recording playhead sits. `position` is the unwrapped start plus
 * elapsed seconds. Playback runs up to `loopEnd`, then jumps to `loopStart`.
 */
export function placeRecording(position:number, loopStart:number, loopEnd:number):number {
	if (!(loopEnd > 0)) {
		return 0;
	}
	if (position < loopEnd) {
		return position < 0 ? 0 : position;
	}
	const span = loopEnd - loopStart;
	if (!(span > 0)) {
		return loopStart;
	}
	let into = (position - loopEnd) % span;
	if (into < 0) {
		into += span;
	}
	if (into > span - 1e-4) {
		into = 0;
	}
	return loopStart + into;
}

/**
 * A finished file looping on `Audio`'s music output: its playhead, pause and seek, in seconds. It plays from 0 to
 * `loop.end` (default: the end of the file), then repeats from `loop.start` (default: 0).
 */
export class Recording {
	private _ctx:BaseAudioContext | null = null;
	private _dest:AudioNode | null = null;
	private _buffer:AudioBuffer | null = null;
	/** Live while it sounds; none before it is decoded and while paused. */
	private _node:AudioBufferSourceNode | null = null;
	/** Seconds into the file where the node started, or where the playhead stands when none plays. */
	private _offset = 0;
	/** Context time the node started. */
	private _origin = 0;
	private _paused = false;

	constructor(public readonly id:string, public readonly gain:number, private readonly _loop:{ start?:number; end?:number } = {}, public readonly title = id) {}

	public get paused():boolean {
		return this._paused;
	}

	public get sounding():boolean {
		return !!this._node;
	}

	/** The span it loops. `end` is 0 until the file is decoded. */
	public get bounds():{ start:number; end:number } {
		const dur = this._buffer?.duration ?? 0;
		if (!(dur > 0)) {
			return { start: 0, end: 0 };
		}
		const end = this._loop.end ? Math.min(this._loop.end, dur) : dur;
		const start = this._loop.start ?? 0;
		return start >= 0 && end > start ? { start, end } : { start: 0, end: dur };
	}

	/** Seconds into the file. */
	public sec():number {
		const { start, end } = this.bounds;
		const elapsed = this._node && this._ctx ? this._ctx.currentTime - this._origin : 0;
		return placeRecording(this._offset + elapsed, start, end);
	}

	/** The decoded file into `dest`, from its start; it sounds unless paused. */
	public attach(ctx:BaseAudioContext, dest:AudioNode, buffer:AudioBuffer):void {
		this.stop();
		this._ctx = ctx;
		this._dest = dest;
		this._buffer = buffer;
		this._offset = 0;
		this.start();
	}

	public pause():void {
		if (this._paused) {
			return;
		}
		this._offset = this.sec();
		this._paused = true;
		this.stop();
	}

	public unpause():void {
		if (!this._paused) {
			return;
		}
		this._paused = false;
		this.start();
	}

	/** Moves the playhead `sec` seconds into the file, wrapped into the loop's end. */
	public seek(sec:number):void {
		const { end } = this.bounds;
		this._offset = end > 0 ? wrap(sec, end) : 0;
		if (!this._paused) {
			this.stop();
			this.start();
		}
	}

	/** Silences it; `seek` and `attach` sound it again. */
	public stop():void {
		const node = this._node;
		this._node = null;
		try {
			node?.stop();
			node?.disconnect();
		}
		catch {
			// already stopped
		}
	}

	private start():void {
		const ctx = this._ctx;
		const buffer = this._buffer;
		if (!ctx || !buffer || !this._dest || this._paused) {
			return;
		}
		const { start, end } = this.bounds;
		let offset = end > 0 ? wrap(this._offset, end) : 0;
		if (offset >= end - 0.001) {
			offset = start;
		}
		const node = ctx.createBufferSource();
		node.buffer = buffer;
		node.loop = true;
		if (start > 0 || end < buffer.duration - 0.0005) {
			node.loopStart = start;
			node.loopEnd = end;
		}
		node.connect(this._dest);
		node.start(ctx.currentTime, offset);
		this._node = node;
		this._origin = ctx.currentTime;
		this._offset = offset;
	}
}
