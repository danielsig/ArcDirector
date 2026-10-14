import { BoxCollider, GameObject } from '@arc-director/kindling';
import type { World } from '../engine/World';
import { BANK_ROCK_WIDTH, planBankRocks } from './bankRocks';
import { planProps, PROP_FOOTPRINT } from './dressingPlan';

/** Name of the invisible obstacle objects, so paths can tell them apart. */
export const DRESSING_NAME = 'Dressing';

/** Props resting this far above the ground under them (jars on a shelf, a lantern on a table) block nothing. */
const ON_THE_GROUND = 0.3;

/**
 * Solid footprints for the big dressing props: a cylinder for round ones, a box (widened to stay
 * axis-aligned when turned) for the rest, and a cylinder for each riverbank rock. Rebuilt from the
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
	[...world.chunks.values()].flatMap(planBankRocks).forEach((rock, i) => {
		const go = new GameObject(`dressing_rock_${i}`, DRESSING_NAME);
		go.transform.position.x = rock.x;
		go.transform.position.z = rock.z;
		const width = BANK_ROCK_WIDTH * rock.scale;
		go.addComponent(BoxCollider, { size: { x: width, y: 1, z: width }, shape: 'cylinder' });
		world.add(go);
	});
}
