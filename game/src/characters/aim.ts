import { distanceXZ, type GameObject, type XZ } from '@arc-director/kindling';
import { HumanBody, Vitals } from '../engine/components';
import type { DemoWorld } from '../engine/demo-world';
import { Pickupable } from '../items/item-components';
import { USE_RANGE } from '../items/pickup';
import { sensesOf } from '../kit/thing';

/** How far off the line straight ahead someone may stand and still be aimed at along it (m). */
const AIM_WIDTH = 2;

/**
 * The living person `character` aims at along `forward` (flat, unit length) within `range`: the
 * one nearest the line straight ahead, at most {@link AIM_WIDTH} off it. Null when no one is.
 */
export function aimAlong(world:DemoWorld, character:GameObject, forward:XZ, range:number):GameObject | null {
	const p = character.transform.position;
	let best:GameObject | null = null;
	let bestOff = AIM_WIDTH;
	world.forEachNear({ minX: p.x - range, maxX: p.x + range, minZ: p.z - range, maxZ: p.z + range }, (go) => {
		if (go === character || !go.getComponent(HumanBody) || (go.getComponent(Vitals)?.hp ?? 1) <= 0) {
			return;
		}
		const dx = go.transform.position.x - p.x;
		const dz = go.transform.position.z - p.z;
		const off = Math.abs(dx * forward.z - dz * forward.x);
		if (dx * forward.x + dz * forward.z > 0 && Math.hypot(dx, dz) <= range && off < bestOff) {
			best = go;
			bestOff = off;
		}
	});
	return best;
}

export function aimTarget(world:DemoWorld, character:GameObject):GameObject | null {
	const hit = world.groundHit;
	let best:GameObject | null = null;
	let bestScore = Infinity;
	for (const go of world.objects) {
		const near = distanceXZ(character, go);
		const human = go.getComponent(HumanBody);
		if (go === character || near > USE_RANGE || (human && (go.getComponent(Vitals)?.hp ?? 1) <= 0)) {
			continue;
		}
		// Things that tell minds they can be acted on; the prominent ones win close calls.
		const sensed = sensesOf(go);
		const thing = sensed.some((s) => s.interactable);
		if (!thing && !human && !go.getComponent(Pickupable)) {
			continue;
		}
		const score = (hit ? distanceXZ(go.transform.position, hit) + near * 0.25 : near) - (sensed.some((s) => s.prominent) ? 0.8 : 0);
		if (score < bestScore) {
			bestScore = score;
			best = go;
		}
	}
	if (best && hit) {
		const p = best.transform.position;
		if (distanceXZ(p, hit) > 1.8 && distanceXZ(character, best) > 1.4) {
			return null;
		}
	}
	return best;
}
