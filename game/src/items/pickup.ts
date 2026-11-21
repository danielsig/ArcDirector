import { distanceXZ, yawToForward, type GameObject } from '@arc-director/kindling';
import { Named, TAKE_REACHED } from '../engine/components';
import type { DemoWorld } from '../engine/demo-world';
import { Item, Pickupable } from './item-components';
import { getDef, ITEM_DEFS } from './defs';
import { equipItem } from './equip';
import { tryInsert } from './inventory';
import { instantiateDef, isBackpack, itemID, type ItemInstance } from './instance';
import { captureItem, spawnWorldItem } from '../world/spawn-item';
import { cueAt } from '../audio/cue';
import { entityPoint, type Thing } from '../kit/thing';

export const PICKUP_RANGE = 1.7;
export const USE_RANGE = 2.2;

export function nearestPickup(character:GameObject):GameObject | null {
	const world = character.world;
	if (!world) {
		return null;
	}
	let best:GameObject | null = null;
	let bestD = PICKUP_RANGE;
	for (const go of world.objects) {
		if (go === character || !go.getComponent(Pickupable)) {
			continue;
		}
		const d = distanceXZ(character, go);
		if (d < bestD) {
			bestD = d;
			best = go;
		}
	}
	return best;
}

export function pickupLabel(loot:GameObject):string {
	const name = loot.getComponent(Named)?.id ?? loot.name;
	const item = loot.getComponent(Item);
	if (item && item.count > 1) {
		return `${name} ×${item.count}`;
	}
	return name;
}

export function pickup(character:GameObject, loot:GameObject):string {
	const world = character.world;
	if (!world) {
		return 'no world';
	}
	const inst = captureItem(loot);
	if (isBackpack(inst)) {
		const err = equipItem(character, inst, world, 'back');
		if (err) {
			return err;
		}
		takeAway(world, character, loot);
		return `equipped ${itemID(inst)}`;
	}
	if (!tryInsert(character, inst)) {
		return 'no room';
	}
	takeAway(world, character, loot);
	return `picked up ${itemID(inst)}`;
}

/** The taken `loot` cannot be picked up again; it leaves the ground, with its sound, when the hand reaches it. */
function takeAway(world:DemoWorld, character:GameObject, loot:GameObject):void {
	loot.removeComponent(Pickupable);
	world.after(TAKE_REACHED, () => {
		world.remove(loot);
		cueAt(world, 'take', character);
	});
}

export function dropItem(character:GameObject, item:ItemInstance):void {
	const world = character.world;
	if (!world) {
		return;
	}
	const p = character.transform.position;
	const fwd = yawToForward(character.transform.yaw);
	spawnWorldItem(world, item, p.x + fwd.x * 0.7, p.y, p.z + fwd.z * 0.7);
	cueAt(world, 'drop', character);
}

/** First spawn keeps `name`. Later ones of that name get `name2`, `name3`, so each object id stays unique. */
export function freeWorldID(world:DemoWorld, name:string):string {
	if (!world.findByID(name)) {
		return name;
	}
	let n = 2;
	while (world.findByID(`${name}${n}`)) {
		n++;
	}
	return `${name}${n}`;
}

export function spawnDefAt(
	world:DemoWorld,
	defID:string,
	x:number,
	y:number,
	z:number,
	chunkID:string | undefined,
	count?:number,
	name?:string,
):GameObject {
	const inst = instantiateDef(getDef(defID), count);
	if (name) {
		inst.name = name;
		inst.id = freeWorldID(world, name);
	}
	return spawnWorldItem(world, inst, x, y, z, chunkID);
}

/** An item a map lays on the floor, as a dropped one lands: as many as its legend's `count`, `wild` where it grows. */
export const looseItem:Thing = {
	defs: Object.keys(ITEM_DEFS),
	spawn: (world, chunk, ents) => ents.forEach((ent) => {
		const { x, y, z } = entityPoint(chunk, ent);
		spawnDefAt(world, ent.def, x, y, z, chunk.id, ent.count, ent.name).getComponent(Pickupable)!.wild = !!ent.wild;
	}),
};
