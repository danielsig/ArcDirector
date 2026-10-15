import { type GameObject } from '@arc-director/kindling';
import { Door, Flammable, HumanBody, Lock, Vitals } from '../engine/components';
import type { World } from '../engine/World';
import { Pickupable } from '../items/components';
import { distXZ } from '../items/inventory';
import { USE_RANGE } from '../items/pickup';

/** How far off the line straight ahead someone may stand and still be aimed at along it (m). */
const AIM_WIDTH = 2;

/**
 * The living person `character` aims at along `forward` (flat, unit length) within `range`: the
 * one nearest the line straight ahead, at most {@link AIM_WIDTH} off it. Null when no one is.
 */
export function aimAlong(world:World, character:GameObject, forward:{ x:number; z:number }, range:number):GameObject | null {
	const p = character.transform.position;
	let best:GameObject | null = null;
	let bestOff = AIM_WIDTH;
	world.forEachNear(p.x - range, p.z - range, p.x + range, p.z + range, (go) => {
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

export function aimTarget(world:World, character:GameObject):GameObject | null {
	const hit = world.groundHit;
	let best:GameObject | null = null;
	let bestScore = Infinity;
	for (const go of world.objects) {
		if (go === character) {
			continue;
		}
		// Doors, chests and webs: things your hands or a held item act on, and they win close calls.
		const door = go.getComponent(Door) || go.getComponent(Lock) || go.getComponent(Flammable);
		const loot = go.getComponent(Pickupable);
		const human = go.getComponent(HumanBody);
		if (human && (go.getComponent(Vitals)?.hp ?? 1) <= 0) {
			continue;
		}
		if (!door && !loot && !human) {
			continue;
		}
		if (distXZ(character, go) > USE_RANGE) {
			continue;
		}
		let score = distXZ(character, go);
		if (hit) {
			const p = go.transform.position;
			score = Math.hypot(p.x - hit.x, p.z - hit.z) + score * 0.25;
		}
		if (door) {
			score -= 0.8;
		}
		if (score < bestScore) {
			bestScore = score;
			best = go;
		}
	}
	if (best && hit) {
		const p = best.transform.position;
		if (Math.hypot(p.x - hit.x, p.z - hit.z) > 1.8 && distXZ(character, best) > 1.4) {
			return null;
		}
	}
	return best;
}
