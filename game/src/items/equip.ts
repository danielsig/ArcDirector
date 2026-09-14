import {
	BODY_SLOTS,
	HumanBody,
	type BodySlot,
} from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';
import { spawnWorldItem } from '../world/spawnItem';
import { isItemFill, isOccupied, slotItem, tryInsert } from './inventory';
import { isBackpack, type ItemInstance } from './instance';

function displace(actor:GameObject, item:ItemInstance, world:World):void {
	if (tryInsert(actor, item)) {
		return;
	}
	const p = actor.transform.position;
	spawnWorldItem(world, item, p.x, p.y, p.z);
}

function clearSlot(body:HumanBody, slot:BodySlot):ItemInstance | null {
	const fill = body.slots[slot];
	if (isOccupied(fill)) {
		body.slots[slot] = null;
		return null;
	}
	if (isItemFill(fill)) {
		body.slots[slot] = null;
		for (const s of BODY_SLOTS) {
			const other = body.slots[s];
			if (isOccupied(other) && other.occupiedBy === slot) {
				body.slots[s] = null;
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

export function unequipSlot(actor:GameObject, slot:BodySlot, world:World):void {
	const body = actor.getComponent(HumanBody);
	if (!body) {
		return;
	}
	const item = clearSlot(body, slot);
	if (item) {
		displace(actor, item, world);
	}
}

export function equipItem(
	actor:GameObject,
	item:ItemInstance,
	world:World,
	named?:BodySlot,
):string | null {
	const body = actor.getComponent(HumanBody);
	if (!body || !item.Equipable) {
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
			if (!body.slots[slot]) {
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
	const prev = clearSlot(body, dest);
	if (prev) {
		displace(actor, prev, world);
	}
	body.slots[dest] = item;
	if (hands === 2) {
		const other = dest === 'hands.left.held' ? 'hands.right.held' : 'hands.left.held';
		const extra = clearSlot(body, other);
		if (extra) {
			displace(actor, extra, world);
		}
		body.slots[other] = { occupiedBy: dest };
	}
	return null;
}

export function itemInHeldSlot(actor:GameObject, item:ItemInstance):boolean {
	const body = actor.getComponent(HumanBody);
	if (!body) {
		return false;
	}
	return slotItem(body, 'hands.left.held') === item
		|| slotItem(body, 'hands.right.held') === item;
}

export function swapHeldHands(actor:GameObject):string {
	const body = actor.getComponent(HumanBody);
	if (!body) {
		return 'no hands';
	}
	const left = body.slots['hands.left.held'];
	const right = body.slots['hands.right.held'];
	if (isOccupied(left) || isOccupied(right)) {
		return 'both hands are busy';
	}
	if (!left && !right) {
		return 'empty hands';
	}
	body.slots['hands.left.held'] = right;
	body.slots['hands.right.held'] = left;
	return 'swapped hands';
}
