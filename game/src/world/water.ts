import { Bridge } from '../engine/components';
import type { World } from '../engine/World';
import { CELL_SIZE } from './constants';

/** Tiles drawn with water: open water, and footbridge decks (`bridge`) that walk over it. */
export function showsWater(def:string | undefined):boolean {
	return def === 'water' || def === 'bridge';
}

/** How soft riverbank sand's edge is: the blur on the water, in cells. About the radius its corners round to. */
const SHORE_BLUR = 0.3;

/** Normal CDF, by the Abramowitz–Stegun erf (error under 2e-7). */
function normalCdf(x:number):number {
	const y = Math.abs(x) / Math.SQRT2;
	const t = 1 / (1 + 0.3275911 * y);
	const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-y * y);
	return 0.5 * (1 + Math.sign(x) * erf);
}

/** The blurred water a straight bank's sand edge sits on: half a cell from the water. */
const SHORE_LEVEL = normalCdf(-0.5 / SHORE_BLUR);

/** Fraction of a unit-wide blurred cell spanning `a`..`a + 1` that reaches `x`. */
function blurredSpan(a:number, x:number):number {
	return normalCdf((a + 1 - x) / SHORE_BLUR) - normalCdf((a - x) / SHORE_BLUR);
}

/**
 * Riverbank sand as a field: above 0 on sand, below 0 on lawn. It is the water blurred and cut half a cell
 * out, so sand covers half a straight bank's cell, a water corner gets a rounded sand corner, and a lawn corner
 * between two water edges keeps a rounded tip of lawn. Smooth, so meshes can follow its zero line.
 * `defAt` is the tile def at a world point.
 */
export function sandField(defAt:(x:number, z:number)=>string | undefined, x:number, z:number):number {
	const u = x / CELL_SIZE;
	const v = z / CELL_SIZE;
	const ci = Math.floor(u);
	const cj = Math.floor(v);
	let water = 0;
	for (let j = cj - 2; j <= cj + 2; j++) {
		for (let i = ci - 2; i <= ci + 2; i++) {
			if (showsWater(defAt((i + 0.5) * CELL_SIZE, (j + 0.5) * CELL_SIZE))) {
				water += blurredSpan(i, u) * blurredSpan(j, v);
			}
		}
	}
	return water - SHORE_LEVEL;
}

/** Riverbank sand on the lawn at `x`, `z`: where {@link sandField} is above 0. */
export function sandAt(defAt:(x:number, z:number)=>string | undefined, x:number, z:number):boolean {
	return defAt(x, z) === 'grass' && sandField(defAt, x, z) > 0;
}

/** Water at `x`, `z` with a lowered drawbridge over it: walkable, at the deck's height. */
export function onLoweredBridge(world:World, x:number, z:number):boolean {
	const tile = world.tileAtWorld(x, z);
	if (!tile || tile.def !== 'water') {
		return false;
	}
	let open = false;
	world.forEachComponent(Bridge, (span) => {
		if (!span.open) {
			return;
		}
		for (const c of span.cells) {
			if (Math.abs(c.x - x) < 0.55 && Math.abs(c.z - z) < 0.55) {
				open = true;
			}
		}
	});
	return open;
}
