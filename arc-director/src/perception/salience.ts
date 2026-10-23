import { distance } from '../world/vec.js';
import type { Sight } from './types.js';

/** How salient what a mind carries is: about as much as what stands right in front of it. */
export const CARRIED_SALIENCE = 0.8;
/** Paces at which a thing straight ahead is half as salient as one at arm's length. */
const HALF_PACES = 6;
/** How salient a thing behind is next to the same thing ahead. */
const BEHIND = 0.4;

/**
 * How much each thing `snap` shows should bring memories of it to mind, 0–1, kept in `into` where higher than what
 * is there: close and straight ahead most, far off or behind least. Seeing Hilde reminds you of Hilde.
 */
export function sightSalience(snap:Sight, into:Map<string, number>):void {
	const { point: at, facing } = snap.self;
	for (const o of snap.objects) {
		const away = distance(at, o.point);
		const ahead = facing && away > 0
			? (facing[0] * (o.point[0] - at[0]) + facing[1] * (o.point[1] - at[1])) / away
			: 1;
		const weight = (1 / (1 + away / HALF_PACES)) * (BEHIND + (1 - BEHIND) * Math.max(0, ahead));
		if (weight > (into.get(o.id) ?? 0)) {
			into.set(o.id, weight);
		}
	}
}
