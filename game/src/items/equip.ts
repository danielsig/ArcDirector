import { type GameObject } from '@arc-director/kindling';
import {
	BODY_SLOTS,
	HumanBody,
	type BodySlot,
} from '../engine/components';
import type { World } from '../engine/World';
import { spawnWorldItem } from '../world/spawnItem';
import { isItemFill, isOccupied, slotItem, tryInsert } from './inventory';
import { isBackpack, type ItemInstance } from './instance';

function displace(character:GameObject, item:ItemInstance, world:World):void {
	if (tryInsert(character, item)) {
		return;
	}
	const p = character.transform.position;
	spawnWorldItem(world, item, p.x, p.y, p.z);
}

function clearSlot(human:HumanBody, slot:BodySlot):ItemInstance | null {
	const fill = human.slots[slot];
	if (isOccupied(fill)) {
		human.slots[slot] = null;
		return null;
	}
	if (isItemFill(fill)) {
		human.slots[slot] = null;
		for (const s of BODY_SLOTS) {
			const other = human.slots[s];
			if (isOccupied(other) && other.occupiedBy === slot) {
				human.slots[s] = null;
			}
		}
		return fill;
	}
	return null;
}

function legalSlots(item:ItemInstance):BodySlot[] {
	const names = item.Equipable?.slots ?? [];
	return names.filter((s):s is BodySlot => (BODY_SLOTS as readonly string[]).includes(s));
}

export function unequipSlot(character:GameObject, slot:BodySlot, world:World):void {
	const human = character.getComponent(HumanBody);
	if (!human) {
		return;
	}
	const item = clearSlot(human, slot);
	if (item) {
		displace(character, item, world);
	}
}

export function equipItem(
	character:GameObject,
	item:ItemInstance,
	world:World,
	named?:BodySlot,
):string | null {
	const human = character.getComponent(HumanBody);
	if (!human || !item.Equipable) {
		return 'cannot equip that';
	}
	if (isBackpack(item) && named && named !== 'back') {
		return 'backpacks go on your back';
	}
	const slots = named ? [named] : legalSlots(item);
	const hands = item.Equipable.hands;
	let dest:BodySlot | undefined;
	if (!named && item.Weapon && slots.includes('hands.right.held')) {
		dest = 'hands.right.held';
	}
	else {
		for (const slot of slots) {
			if (!human.slots[slot]) {
				dest = slot;
				break;
			}
		}
	}
	if (!dest) {
		dest = slots[0];
	}
	if (!dest || !(BODY_SLOTS as readonly string[]).includes(dest)) {
		return 'no slot for that';
	}
	const prev = clearSlot(human, dest);
	if (prev) {
		displace(character, prev, world);
	}
	human.slots[dest] = item;
	if (hands === 2) {
		const other = dest === 'hands.left.held' ? 'hands.right.held' : 'hands.left.held';
		const extra = clearSlot(human, other);
		if (extra) {
			displace(character, extra, world);
		}
		human.slots[other] = { occupiedBy: dest };
	}
	return null;
}

export function itemInHeldSlot(character:GameObject, item:ItemInstance):boolean {
	const human = character.getComponent(HumanBody);
	if (!human) {
		return false;
	}
	return slotItem(human, 'hands.left.held') === item
		|| slotItem(human, 'hands.right.held') === item;
}

export function swapHeldHands(character:GameObject):string {
	const human = character.getComponent(HumanBody);
	if (!human) {
		return 'no hands';
	}
	const left = human.slots['hands.left.held'];
	const right = human.slots['hands.right.held'];
	if (isOccupied(left) || isOccupied(right)) {
		return 'both hands are busy';
	}
	if (!left && !right) {
		return 'empty hands';
	}
	human.slots['hands.left.held'] = right;
	human.slots['hands.right.held'] = left;
	return 'swapped hands';
}
