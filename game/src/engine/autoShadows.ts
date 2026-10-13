import { lsGet, lsSet, type ShadowTier } from '../prefs';

/** Tiers Auto climbs, cheapest first. It never picks Off. */
const LADDER:readonly ShadowTier[] = ['simple', 'low', 'high'];
const KEY = 'arc-director.autoShadows.v1';
/** Seconds a tier runs before its frame rate counts (bakes and shader compiles settle first). */
const DWELL = 3;
/** Slowest average frame, in ms, a tier may run at and still be kept: 50 fps. */
const KEEP_MS = 20;
/** Average frames slower than this are a hidden tab or a stall, not the tier's cost. */
const STALL_MS = 200;

/**
 * The `auto` shadow quality: the best tier this browser holds 50 fps with. The first run climbs from
 * Simple one tier per {@link DWELL} seconds and stops below the first that drops frames; the pick is
 * remembered, so later runs start on it.
 */
export class AutoShadows {
	public tier:ShadowTier;
	private _done:boolean;
	private _t = 0;

	constructor() {
		const saved = LADDER.find((t) => t === lsGet(KEY));
		this.tier = saved ?? LADDER[0]!;
		this._done = saved !== undefined;
	}

	/** `frameMS`: the renderer's average frame over the last second. */
	public tick(dt:number, frameMS:number):void {
		if (this._done) {
			return;
		}
		if (frameMS > STALL_MS) {
			this._t = 0;
			return;
		}
		this._t += dt;
		if (this._t < DWELL) {
			return;
		}
		this._t = 0;
		const i = LADDER.indexOf(this.tier);
		if (frameMS <= KEEP_MS && i < LADDER.length - 1) {
			this.tier = LADDER[i + 1]!;
			return;
		}
		this.tier = frameMS <= KEEP_MS ? this.tier : LADDER[Math.max(0, i - 1)]!;
		this._done = true;
		lsSet(KEY, this.tier);
	}
}
