import { Chest, Door, Lock, Named } from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';
import { Container, Harvest, Item, Pickupable } from './components';
import { getDef } from './defs';
import { equipItem } from './equip';
import { characterIs, distXZ, findCarried, findReady, itemMatchesName, tryInsert } from './inventory';
import { instantiateDef, isBackpack, type ItemInstance } from './instance';
import { captureItem, spawnWorldItem } from '../world/spawnItem';
import { cueAt } from '../audio/cue';

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
		const d = distXZ(character, go);
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
	const crop = loot.getComponent(Harvest);
	if (crop && !characterIs(character, crop.harvester)) {
		return `only ${crop.harvester} can harvest that`;
	}
	const inst = captureItem(loot);
	if (isBackpack(inst)) {
		const err = equipItem(character, inst, world, 'back');
		if (err) {
			return err;
		}
		world.remove(loot);
		cueAt(world, 'take', character);
		return `equipped ${inst.name}`;
	}
	if (!tryInsert(character, inst)) {
		return 'no room';
	}
	world.remove(loot);
	cueAt(world, 'take', character);
	return `picked up ${inst.name}`;
}

export function dropItem(character:GameObject, item:import('./instance').ItemInstance):void {
	const world = character.world;
	if (!world) {
		return;
	}
	const p = character.transform.position;
	const fwd = { x: -Math.sin(character.transform.yaw), z: -Math.cos(character.transform.yaw) };
	spawnWorldItem(world, item, p.x + fwd.x * 0.7, p.y, p.z + fwd.z * 0.7);
	cueAt(world, 'drop', character);
}

export function spawnDefAt(
	world:World,
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
		inst.id = name;
	}
	return spawnWorldItem(world, inst, x, y, z, chunkID);
}

export function interactDoor(character:GameObject, doorGo:GameObject):string {
	const world = character.world;
	const lock = doorGo.getComponent(Lock);
	const door = doorGo.getComponent(Door);
	if (!door) {
		return 'not a door';
	}
	if (lock?.locked) {
		if (!findReady(character, (it) => it.Key?.keyID === lock.keyID)) {
			if (findCarried(character, (it) => it.Key?.keyID === lock.keyID)) {
				return 'the key is in your pack';
			}
			return lock.keyID ? `locked — needs a ${lock.keyID} key` : 'locked';
		}
		lock.locked = false;
		door.open = true;
		door.syncCollision();
		if (world) {
			cueAt(world, 'unlock', doorGo);
			cueAt(world, 'doorOpen', doorGo);
		}
		return 'unlocked';
	}
	door.open = !door.open;
	door.syncCollision();
	if (world) {
		cueAt(world, door.open ? 'doorOpen' : 'doorClose', doorGo);
	}
	return door.open ? 'opened' : 'closed';
}

export type ChestHold = {
	chest:GameObject;
	item:ItemInstance;
	bag:Container;
};

export function findChestHolding(world:World, name:string):ChestHold | null {
	for (const go of world.objects) {
		if (!go.getComponent(Chest)) {
			continue;
		}
		const bag = go.getComponent(Container);
		if (!bag) {
			continue;
		}
		const item = bag.contents.find((it) => itemMatchesName(it, name));
		if (item) {
			return { chest: go, item, bag };
		}
	}
	return null;
}

/** Walk target for a name: floor object, or the open unlocked chest that holds it. */
export function resolveNamedTarget(world:World, name:string):GameObject | undefined {
	const go = world.findNamed(name);
	if (go) {
		return go;
	}
	const held = findChestHolding(world, name);
	if (!held) {
		return undefined;
	}
	const lock = held.chest.getComponent(Lock);
	const chest = held.chest.getComponent(Chest);
	if (lock?.locked || (chest && !chest.open)) {
		return undefined;
	}
	return held.chest;
}

export function takeFromChest(character:GameObject, held:ChestHold):string {
	const lock = held.chest.getComponent(Lock);
	const chest = held.chest.getComponent(Chest);
	const chestName = held.chest.getComponent(Named)?.id ?? held.chest.id;
	if (lock?.locked) {
		return `${chestName} is locked`;
	}
	if (chest && !chest.open) {
		return `${chestName} is closed`;
	}
	if (!tryInsert(character, held.item)) {
		return 'no room';
	}
	const i = held.bag.contents.indexOf(held.item);
	if (i >= 0) {
		held.bag.contents.splice(i, 1);
	}
	cueAt(character.world, 'take', character);
	return `took ${held.item.name} from ${chestName}`;
}

export function interactChest(character:GameObject, chestGo:GameObject):string {
	const chest = chestGo.getComponent(Chest);
	const bag = chestGo.getComponent(Container);
	const lock = chestGo.getComponent(Lock);
	const name = chestGo.getComponent(Named)?.id ?? chestGo.id;
	if (!chest || !bag) {
		return 'not a chest';
	}
	if (lock?.locked) {
		if (!findReady(character, (it) => it.Key?.keyID === lock.keyID)) {
			if (findCarried(character, (it) => it.Key?.keyID === lock.keyID)) {
				return 'the key is in your pack';
			}
			return lock.keyID ? `locked — needs a ${lock.keyID} key` : 'locked';
		}
		lock.locked = false;
		chest.open = true;
		cueAt(character.world, 'unlock', chestGo);
		cueAt(character.world, 'chestOpen', chestGo);
		return 'unlocked';
	}
	if (!chest.open) {
		chest.open = true;
		cueAt(character.world, 'chestOpen', chestGo);
		return 'opened';
	}
	const first = bag.contents[0];
	if (!first) {
		return `${name} is empty`;
	}
	return takeFromChest(character, { chest: chestGo, item: first, bag });
}
