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

/** Spawn id, chosen name, or alias — after set_identity, Named.id may be Oat while go.id stays Miller. */
export function actorIs(go:GameObject, name:string):boolean {
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

export function slotItem(body:HumanBody, slot:BodySlot):ItemInstance | null {
	const fill = body.slots[slot];
	return isItemFill(fill) ? fill : null;
}

export function allEquipped(body:HumanBody):ItemInstance[] {
	const out:ItemInstance[] = [];
	const seen = new Set<string>();
	for (const slot of BODY_SLOTS) {
		const item = slotItem(body, slot);
		if (item && !seen.has(item.id)) {
			seen.add(item.id);
			out.push(item);
		}
	}
	return out;
}

export function carryBags(actor:GameObject):{ size:number; contents:ItemInstance[] }[] {
	const bags:{ size:number; contents:ItemInstance[] }[] = [];
	const body = actor.getComponent(HumanBody);
	const pockets = body?.pockets ?? actor.getComponent(Container);
	if (pockets) {
		bags.push(pockets);
	}
	if (body) {
		const pack = slotItem(body, 'back');
		if (pack?.Container) {
			bags.push(pack.Container);
		}
	}
	return bags;
}

export function countDef(actor:GameObject, defID:string):number {
	let n = 0;
	for (const bag of carryBags(actor)) {
		for (const it of bag.contents) {
			if (it.defID === defID) {
				n += it.count;
			}
		}
	}
	const body = actor.getComponent(HumanBody);
	if (body) {
		for (const it of allEquipped(body)) {
			if (it.defID === defID) {
				n += it.count;
			}
		}
	}
	return n;
}

export function tryInsert(actor:GameObject, item:ItemInstance):boolean {
	if (isBackpack(item)) {
		return false;
	}
	for (const bag of carryBags(actor)) {
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
	for (const bag of carryBags(actor)) {
		if (bag.contents.length < bag.size) {
			bag.contents.push(item);
			return true;
		}
	}
	return item.count <= 0;
}

export function removeFromBags(actor:GameObject, item:ItemInstance):boolean {
	for (const bag of carryBags(actor)) {
		const i = bag.contents.indexOf(item);
		if (i >= 0) {
			bag.contents.splice(i, 1);
			return true;
		}
	}
	return false;
}

const HELD_SLOTS:BodySlot[] = ['hands.left.held', 'hands.right.held'];

export function inBackpack(actor:GameObject, item:ItemInstance):boolean {
	const body = actor.getComponent(HumanBody);
	const pack = body ? slotItem(body, 'back') : null;
	return pack?.Container?.contents.includes(item) ?? false;
}

/** Pockets or a held hand — not inside a worn backpack. */
export function findReady(actor:GameObject, pred:(it:ItemInstance)=>boolean):ItemInstance | null {
	const body = actor.getComponent(HumanBody);
	if (!body) {
		return null;
	}
	for (const slot of HELD_SLOTS) {
		const it = slotItem(body, slot);
		if (it && pred(it)) {
			return it;
		}
	}
	if (body.pockets) {
		for (const it of body.pockets.contents) {
			if (pred(it)) {
				return it;
			}
		}
	}
	return null;
}

export function listCarried(actor:GameObject):ItemInstance[] {
	const out:ItemInstance[] = [];
	const seen = new Set<ItemInstance>();
	const add = (it:ItemInstance):void => {
		if (seen.has(it)) {
			return;
		}
		seen.add(it);
		out.push(it);
	};
	const body = actor.getComponent(HumanBody);
	if (body) {
		for (const it of allEquipped(body)) {
			add(it);
		}
	}
	for (const bag of carryBags(actor)) {
		for (const it of bag.contents) {
			add(it);
		}
	}
	return out;
}

export function findCarried(actor:GameObject, pred:(it:ItemInstance)=>boolean):ItemInstance | null {
	const body = actor.getComponent(HumanBody);
	if (body) {
		for (const it of allEquipped(body)) {
			if (pred(it)) {
				return it;
			}
		}
	}
	for (const bag of carryBags(actor)) {
		for (const it of bag.contents) {
			if (pred(it)) {
				return it;
			}
		}
	}
	return null;
}

export function healActor(actor:GameObject, amount:number):void {
	const vitals = actor.getComponent(Vitals);
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
