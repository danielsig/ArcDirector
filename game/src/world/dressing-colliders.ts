import { BoxCollider, GameObject } from '@arc-director/kindling';
import { Bookshelf, Furniture, Named } from '../engine/components';
import { Flies } from '../engine/Flies';
import type { DemoWorld } from '../engine/demo-world';
import { Container } from '../items/item-components';
import { BOOKS, getDef } from '../items/defs';
import { instantiateDef } from '../items/instance';
import { freeWorldID } from '../items/pickup';
import { planProps, PROP_FOOTPRINT, PROP_HEIGHT } from './dressing-plan';
import { enclosureAt } from './interior';

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
export function syncDressingColliders(world:DemoWorld):void {
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

/** The dressing props characters can use: what each is called, and what makes it so. */
const USABLE:Partial<Record<string, { word:string; fit:(go:GameObject)=>void }>> = {
	chair: { word: 'Chair', fit: (go) => go.addComponent(Furniture, { kind: 'chair' }) },
	bed: { word: 'Bed', fit: (go) => go.addComponent(Furniture, { kind: 'bed' }) },
	bookshelf: {
		word: 'Bookshelf',
		fit: (go) => {
			go.addComponent(Bookshelf);
			go.addComponent(Container, { size: BOOKS.length }).contents.push(...BOOKS.map((id) => instantiateDef(getDef(id))));
		},
	},
};

/**
 * Each chair, bed and bookshelf in the plan as something characters can name and use, once each: the mesh and the collider stay
 * dressing. Called what the map calls it, else after the house it stands in: `HutChair`. Call it with
 * `syncDressingColliders`, after the chunk's buildings are in.
 */
export function syncFurniture(world:DemoWorld):void {
	for (const spot of planProps(world.chunks.values())) {
		const usable = USABLE[spot.prop];
		const key = `furniture_${spot.x.toFixed(2)}_${spot.z.toFixed(2)}`;
		if (!usable || spot.topped || world.objects.some((o) => o.name === key)) {
			continue;
		}
		const house = enclosureAt(world, spot.x, spot.z);
		const id = freeWorldID(world, spot.name ?? `${house?.getComponent(Named)?.id ?? ''}${usable.word}`);
		const go = new GameObject(id, key);
		go.transform.position.x = spot.x;
		go.transform.position.y = spot.y;
		go.transform.position.z = spot.z;
		go.transform.yaw = spot.yaw;
		go.addComponent(Named, { id });
		usable.fit(go);
		world.add(go);
	}
}

/** Props flies hover over. */
const FLY_BAIT = new Set(['rottenBasket']);

/**
 * Flies over each rotten thing in the plan, once each: they are looks only, so a spot that already has them keeps
 * them. Call it with `syncDressingColliders`.
 */
export function syncDressingFlies(world:DemoWorld):void {
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
