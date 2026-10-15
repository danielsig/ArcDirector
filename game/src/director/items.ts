import { Time, type GameObject } from '@arc-director/kindling';
import { pascalCase, type Deal, type Outcome, type Transfer } from 'arc-director';
import {
	BODY_SLOTS,
	Bridge,
	BridgeLever,
	Chest,
	Companion,
	Door,
	HumanBody,
	Appearance,
	Lock,
	MarketNPC,
	Named,
} from '../engine/components';
import { Harvest, Pickupable } from '../items/components';
import {
	characterIs,
	compactName,
	findCarried,
	hasRoom,
	itemMatchesName,
	removeFromBags,
	slotItem,
	tryInsert,
} from '../items/inventory';
import { cloneItem, isBackpack, type ItemInstance } from '../items/instance';
import { coinsOf, noteWant, transferCoins } from '../items/wallet';
import { dropItem, findChestHolding, pickup, takeFromChest } from '../items/pickup';
import { cueAt } from '../audio/cue';
import { useItem } from '../items/use';
import { captureItem } from '../world/spawnItem';
import type { GameHost } from './adapter';
import { idOf } from './names';

/** The want is met, and the tag that would send them back for the same good comes off. */
function dropBoughtTag(host:GameHost, buyer:GameObject, label:string):void {
	noteWant(buyer, label);
	const mind = host.arc?.character(idOf(buyer));
	if (!mind) {
		return;
	}
	const key = compactName(label);
	mind.tags = mind.tags.filter((tag) => compactName(tag) !== key);
}

/** The game's item rules: what may change hands, how, and what everyone hears about it. NPCs reach them through `withWorld`, the player through slash commands. */

export function findItem(character:GameObject, name:string):ItemInstance | null {
	return findCarried(character, (it) => itemMatchesName(it, name));
}

/** `character` uses a carried item, on `target` if given. ArcDirector already brought it in reach. */
export function useOn(host:GameHost, character:GameObject, itemName:string, target?:GameObject):Outcome {
	const item = findItem(character, itemName);
	if (!item) {
		return { ok: false, reason: `not carrying ${itemName}` };
	}
	const result = useItem(character, item, target ?? null);
	const targetName = target ? target.getComponent(Named)?.id ?? target.id : undefined;
	if (result.ok && result.reason === 'unlocked' && target?.getComponent(Door) && targetName) {
		host.doorOpen.set(targetName, true);
	}
	if (result.ok) {
		// Everyone learns what changed, as with a give or a pick-up: "BridgeKeeper used BridgeCrank on BridgeLever: raised Bridge".
		const label = pascalCase(item.name) || item.name;
		host.arc?.pushEvent({
			kind: 'Used',
			text: targetName ? `{0} used ${label} on ${targetName}: ${result.reason}` : `{0} used ${label}: ${result.reason}`,
			who: [idOf(character)],
			tags: ['use', label, ...(targetName ? [targetName] : [])],
			major: false,
		});
	}
	return { ok: result.ok, reason: result.reason };
}

/** Take `count` off the stack `item` that `character` carries: a split-off stack, or `item` itself when that is all of it. */
export function takeSome(character:GameObject, item:ItemInstance, count = 1):ItemInstance {
	const gift = item.count > count ? cloneItem(item, count) : item;
	if (gift === item) {
		removeFromBags(character, item);
		const human = character.getComponent(HumanBody);
		if (human) {
			for (const slot of BODY_SLOTS) {
				if (slotItem(human, slot) === item) {
					human.slots[slot] = null;
				}
			}
		}
	}
	else {
		item.count -= count;
	}
	return gift;
}

function playHandoff(from:GameObject, to:GameObject):void {
	const t = Time.time;
	from.getComponent(Appearance)?.playClip('give', t, to);
	to.getComponent(Appearance)?.playClip('take', t, from);
	cueAt(from.world, 'give', from);
}

/** A thief just takes it; anything else is handed over. */
function handOver(verb:string, from:GameObject, to:GameObject):void {
	if (verb === 'steal') {
		to.getComponent(Appearance)?.playClip('take', Time.time);
	}
	else {
		playHandoff(from, to);
	}
}

const isGold = (name:string):boolean => compactName(name) === 'gold';

/** Whether `to` keeps what it has no room for at its feet: the player, and whoever a companion follows, never refuse a gift. */
function keepsAtFeet(from:GameObject, to:GameObject):boolean {
	return to.id === 'Player' || idOf(to) === from.getComponent(Companion)?.targetID;
}

/**
 * Why `move` cannot happen, or nothing: the game's item rules, for ArcDirector's verbs (`validateTransfer`) and the
 * steal verb alike. `deal` is what else changes hands with it: an item leaving `to` in the same trade frees a slot.
 */
export function transferRefusal(host:GameHost, move:Transfer<GameObject>, deal?:Deal<GameObject>):string | undefined {
	const { verb, thing, from, to } = move;
	if (verb === 'pick_up') {
		return takeRefusal(host, to!, thing);
	}
	if (to === from) {
		return 'cannot give to yourself';
	}
	const count = countOf(move);
	if (isGold(thing) && !findItem(from, thing)) {
		const have = coinsOf(from);
		return have < count ? `${idOf(from)} has only ${have} gold` : undefined;
	}
	const stock = findItem(from, thing);
	if (!stock || stock.count < count) {
		return stock ? `${idOf(from)} has only ${stock.count} ${thing}` : `${idOf(from)} has no ${thing}`;
	}
	// A whole stack leaving `to` in the same trade frees its slot first.
	const room = !to || hasRoom(to, stock, count) || keepsAtFeet(from, to) || !!deal?.leaving(to).some((m) => !isGold(m.thing));
	return room ? undefined : `${idOf(to)} has no room`;
}

/** Why `character` cannot take `name` off the ground or out of a chest, or nothing. */
function takeRefusal(host:GameHost, character:GameObject, name:string):string | undefined {
	const loot = host.world.findNamed(name);
	if (loot?.getComponent(Pickupable)) {
		const crop = loot.getComponent(Harvest);
		if (crop && !characterIs(character, crop.harvester)) {
			return `only ${crop.harvester} can harvest that`;
		}
		const inst = captureItem(loot);
		if (isBackpack(inst)) {
			return character.getComponent(HumanBody) ? undefined : 'cannot equip that';
		}
		return hasRoom(character, inst, inst.count) ? undefined : 'no room';
	}
	const held = findChestHolding(host.world, name);
	if (held) {
		const chestName = held.chest.getComponent(Named)?.id ?? held.chest.id;
		if (held.chest.getComponent(Lock)?.locked) {
			return `${chestName} is locked — unlock it first`;
		}
		if (held.chest.getComponent(Chest)?.open === false) {
			return `${chestName} is closed`;
		}
		return hasRoom(character, held.item, held.item.count) ? undefined : 'no room';
	}
	const named = host.world.findNamed(name);
	if (named?.getComponent(BridgeLever)) {
		return `${name} is a sluice, not loot. Only BridgeKeeper uses BridgeCrank on BridgeLever`;
	}
	if (named?.getComponent(HumanBody) || named?.getComponent(MarketNPC)) {
		return `cannot pick up ${name}`;
	}
	if (named) {
		return `${name} is ${named.getComponent(Door) ? 'a door' : named.getComponent(Bridge) ? 'a bridge' : 'not loot'}`;
	}
	// Someone has it: it is theirs to hand over, and saying where it is beats "no such item".
	const holder = host.world.objects.find((go) => go !== character && !!go.getComponent(HumanBody)
		&& !!findCarried(go, (it) => itemMatchesName(it, name)));
	if (holder) {
		const who = idOf(holder);
		return `${who} carries ${name}. You cannot take it; ${who} must give it to you`;
	}
	return `no such item ${name}`;
}

/**
 * Makes `move`, which `transferRefusal` allowed: with its animation and what everyone hears of it. Returns how to
 * take it back. A pick-up or a drop is alone in its deal, so nothing after it can fail and its undo never runs.
 */
export function doTransfer(host:GameHost, move:Transfer<GameObject>):()=>void {
	const { verb, thing, from, to } = move;
	if (verb === 'pick_up') {
		takeLoot(host, to!, thing);
		return () => undefined;
	}
	if (!to) {
		const item = findItem(from, thing)!;
		takeSome(from, item, item.count);
		dropItem(from, item);
		return () => undefined;
	}
	const count = countOf(move);
	if (isGold(thing) && !findItem(from, thing)) {
		transferCoins(from, to, count);
		handOver(verb, from, to);
		return () => void transferCoins(to, from, count);
	}
	const stock = findItem(from, thing)!;
	const gift = takeSome(from, stock, count);
	if (!tryInsert(to, gift)) {
		dropItem(to, gift);
	}
	handOver(verb, from, to);
	dropBoughtTag(host, to, thing);
	return () => {
		const held = findItem(to, thing);
		if (held) {
			const back = takeSome(to, held, Math.min(count, held.count));
			if (!tryInsert(from, back)) {
				dropItem(from, back);
			}
		}
	};
}

/** `character` takes `name` off the ground or out of a chest, and everyone hears of it. ArcDirector already brought it in reach. */
function takeLoot(host:GameHost, character:GameObject, name:string):void {
	const loot = host.world.findNamed(name);
	const held = loot?.getComponent(Pickupable) ? null : findChestHolding(host.world, name);
	const reason = held ? takeFromChest(character, held) : pickup(character, loot!);
	if (!/^(picked up|equipped|took) /.test(reason)) {
		throw new Error(`taking ${name} failed after its rules allowed it: ${reason}`);
	}
	character.getComponent(Appearance)?.playClip('take', Time.time, held?.chest ?? loot);
	host.arc?.pushEvent({ kind: 'PickedUp', text: `{0} picked up ${name}`, who: [idOf(character)], tags: ['item', name], major: false });
	host.hooks.afterPickUp?.(host, character, name);
}

function countOf(move:Transfer<GameObject>):number {
	return Math.max(1, Math.floor(move.quantity ?? 1) || 1);
}
