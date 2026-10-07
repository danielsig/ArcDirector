import {
	BODY_SLOTS,
	HumanBody,
	Named,
	type BodySlot,
	type OccupiedRef,
	type SlotFill,
	Vitals,
} from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import { Container } from './components';
import { isBackpack, type ItemInstance } from './instance';

export function compactName(s:string):string {
	return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Spawn id or alias — an NPC's role (`Herbalist`) is an alias of its id (`Fern`). */
export function characterIs(go:GameObject, name:string):boolean {
	const want = name.trim().toLowerCase();
	if (!want) {
		return false;
	}
	const named = go.getComponent(Named);
	const ids = [named?.id, go.id, go.name, ...(named?.aliases ?? [])];
	return ids.some((id) => !!id && id.toLowerCase() === want);
}

export function itemMatchesName(item:ItemInstance, name:string):boolean {
	const want = compactName(name);
	return [item.id, item.name, item.defID].some((id) => {
		if (!id) {
			return false;
		}
		return id === name || compactName(id) === want;
	});
}

export function isOccupied(fill:SlotFill):fill is OccupiedRef {
	return fill !== null && 'occupiedBy' in fill;
}

export function isItemFill(fill:SlotFill):fill is ItemInstance {
	return fill !== null && !('occupiedBy' in fill);
}

export function slotItem(human:HumanBody, slot:BodySlot):ItemInstance | null {
	const fill = human.slots[slot];
	return isItemFill(fill) ? fill : null;
}

export function allEquipped(human:HumanBody):ItemInstance[] {
	const out:ItemInstance[] = [];
	const seen = new Set<string>();
	for (const slot of BODY_SLOTS) {
		const item = slotItem(human, slot);
		if (item && !seen.has(item.id)) {
			seen.add(item.id);
			out.push(item);
		}
	}
	return out;
}

export function carryBags(character:GameObject):{ size:number; contents:ItemInstance[] }[] {
	const bags:{ size:number; contents:ItemInstance[] }[] = [];
	const human = character.getComponent(HumanBody);
	const pockets = human?.pockets ?? character.getComponent(Container);
	if (pockets) {
		bags.push(pockets);
	}
	if (human) {
		const pack = slotItem(human, 'back');
		if (pack?.Container) {
			bags.push(pack.Container);
		}
	}
	return bags;
}

export function countDef(character:GameObject, defID:string):number {
	let n = 0;
	for (const bag of carryBags(character)) {
		for (const it of bag.contents) {
			if (it.defID === defID) {
				n += it.count;
			}
		}
	}
	const human = character.getComponent(HumanBody);
	if (human) {
		for (const it of allEquipped(human)) {
			if (it.defID === defID) {
				n += it.count;
			}
		}
	}
	return n;
}

export function tryInsert(character:GameObject, item:ItemInstance):boolean {
	if (isBackpack(item)) {
		return false;
	}
	for (const bag of carryBags(character)) {
		if (item.stackable) {
			for (const existing of bag.contents) {
				if (existing.defID === item.defID && existing.count < existing.maxStack) {
					const room = existing.maxStack - existing.count;
					const take = Math.min(room, item.count);
					existing.count += take;
					item.count -= take;
					if (item.count <= 0) {
						return true;
					}
				}
			}
		}
	}
	for (const bag of carryBags(character)) {
		if (bag.contents.length < bag.size) {
			bag.contents.push(item);
			return true;
		}
	}
	return item.count <= 0;
}

export function removeFromBags(character:GameObject, item:ItemInstance):boolean {
	for (const bag of carryBags(character)) {
		const i = bag.contents.indexOf(item);
		if (i >= 0) {
			bag.contents.splice(i, 1);
			return true;
		}
	}
	return false;
}

const HELD_SLOTS:BodySlot[] = ['hands.left.held', 'hands.right.held'];

export function inBackpack(character:GameObject, item:ItemInstance):boolean {
	const human = character.getComponent(HumanBody);
	const pack = human ? slotItem(human, 'back') : null;
	return pack?.Container?.contents.includes(item) ?? false;
}

/** Pockets or a held hand — not inside a worn backpack. */
export function findReady(character:GameObject, pred:(it:ItemInstance)=>boolean):ItemInstance | null {
	const human = character.getComponent(HumanBody);
	if (!human) {
		return null;
	}
	for (const slot of HELD_SLOTS) {
		const it = slotItem(human, slot);
		if (it && pred(it)) {
			return it;
		}
	}
	if (human.pockets) {
		for (const it of human.pockets.contents) {
			if (pred(it)) {
				return it;
			}
		}
	}
	return null;
}

export function listCarried(character:GameObject):ItemInstance[] {
	const out:ItemInstance[] = [];
	const seen = new Set<ItemInstance>();
	const add = (it:ItemInstance):void => {
		if (seen.has(it)) {
			return;
		}
		seen.add(it);
		out.push(it);
	};
	const human = character.getComponent(HumanBody);
	if (human) {
		for (const it of allEquipped(human)) {
			add(it);
		}
	}
	for (const bag of carryBags(character)) {
		for (const it of bag.contents) {
			add(it);
		}
	}
	return out;
}

export function findCarried(character:GameObject, pred:(it:ItemInstance)=>boolean):ItemInstance | null {
	const human = character.getComponent(HumanBody);
	if (human) {
		for (const it of allEquipped(human)) {
			if (pred(it)) {
				return it;
			}
		}
	}
	for (const bag of carryBags(character)) {
		for (const it of bag.contents) {
			if (pred(it)) {
				return it;
			}
		}
	}
	return null;
}

export function healCharacter(character:GameObject, amount:number):void {
	const vitals = character.getComponent(Vitals);
	if (!vitals) {
		return;
	}
	vitals.hp = Math.min(vitals.maxHP, vitals.hp + amount);
}

export function distXZ(a:GameObject, b:GameObject):number {
	const pa = a.transform.position;
	const pb = b.transform.position;
	return Math.hypot(pa.x - pb.x, pa.z - pb.z);
}
