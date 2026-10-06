import { Door, HumanBody, Lock, Vitals } from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';
import { Pickupable } from '../items/components';
import { distXZ } from '../items/inventory';
import { USE_RANGE } from '../items/pickup';

export function aimTarget(world:World, actor:GameObject):GameObject | null {
	const hit = world.input.groundHit;
	let best:GameObject | null = null;
	let bestScore = Infinity;
	for (const go of world.objects) {
		if (go === actor) {
			continue;
		}
		const door = go.getComponent(Door) || go.getComponent(Lock);
		const loot = go.getComponent(Pickupable);
		const body = go.getComponent(HumanBody);
		if (body && (go.getComponent(Vitals)?.hp ?? 1) <= 0) {
			continue;
		}
		if (!door && !loot && !body) {
			continue;
		}
		if (distXZ(actor, go) > USE_RANGE) {
			continue;
		}
		let score = distXZ(actor, go);
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
		if (Math.hypot(p.x - hit.x, p.z - hit.z) > 1.8 && distXZ(actor, best) > 1.4) {
			return null;
		}
	}
	return best;
}
