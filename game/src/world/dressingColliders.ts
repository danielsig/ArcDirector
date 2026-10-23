import { BoxCollider, GameObject } from '@arc-director/kindling';
import { Flies } from '../engine/Flies';
import type { World } from '../engine/World';
import { planProps, PROP_FOOTPRINT, PROP_HEIGHT } from './dressingPlan';

/** Name of the invisible obstacle objects, so paths can tell them apart. */
export const DRESSING_NAME = 'Dressing';

/** Props resting this far above the ground under them (jars on a shelf, a lantern on a table) block nothing. */
const ON_THE_GROUND = 0.3;

/**
 * Solid footprints for the big dressing props: a cylinder for round ones, a box (widened to stay
 * axis-aligned when turned) for the rest. Rebuilt from the
 * whole plan, so call it whenever chunks load. Unnamed for sight: NPCs never see them, they only
 * walk around them.
 */
export function syncDressingColliders(world:World):void {
	for (const go of world.objects.filter((o) => o.name === DRESSING_NAME)) {
		world.remove(go);
	}
	planProps(world.chunks.values()).forEach((spot, i) => {
		const foot = PROP_FOOTPRINT[spot.prop];
		if (!foot || spot.y - (world.sampleTerrain(spot.x, spot.z)?.worldY ?? 0) > ON_THE_GROUND) {
			return;
		}
		const go = new GameObject(`dressing_${spot.prop}_${i}`, DRESSING_NAME);
		go.transform.position.x = spot.x;
		go.transform.position.y = spot.y;
		go.transform.position.z = spot.z;
		const cos = Math.abs(Math.cos(spot.yaw));
		const sin = Math.abs(Math.sin(spot.yaw));
		go.addComponent(BoxCollider, foot.round
			? { size: { x: foot.w, y: 1, z: foot.w }, shape: 'cylinder' }
			: { size: { x: foot.w * cos + foot.d * sin, y: 1, z: foot.w * sin + foot.d * cos } });
		world.add(go);
	});
}

/** Props flies hover over. */
const FLY_BAIT = new Set(['rottenBasket']);

/**
 * Flies over each rotten thing in the plan, once each: they are looks only, so a spot that already has them keeps
 * them. Call it with `syncDressingColliders`.
 */
export function syncDressingFlies(world:World):void {
	for (const spot of planProps(world.chunks.values())) {
		if (!FLY_BAIT.has(spot.prop)) {
			continue;
		}
		const name = `flies_${spot.x.toFixed(2)}_${spot.z.toFixed(2)}`;
		if (world.objects.some((o) => o.name === name)) {
			continue;
		}
		const go = new GameObject(name, 'Flies');
		go.transform.position.x = spot.x;
		go.transform.position.y = spot.y + (PROP_HEIGHT[spot.prop] ?? 0);
		go.transform.position.z = spot.z;
		go.addComponent(Flies);
		world.add(go);
	}
}
