import { Bridge } from '../engine/components';
import type { World } from '../engine/World';

/** Tiles drawn with water: open water, and footbridge decks (`bridge`) that walk over it. */
export function showsWater(def:string | undefined):boolean {
	return def === 'water' || def === 'bridge';
}

export function waterOpenAt(world:World, x:number, z:number):boolean {
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
