import { Time, type GameObject } from '@arc-director/kindling';
import { showNamingText, type Deal, type NamingText, type Outcome, type Transfer } from 'arc-director';
import { BODY_SLOTS, Companion, HumanBody, Appearance, Lock, MarketplaceNPC, Named, idOf } from '../engine/components';
import { Pickupable } from '../items/item-components';
import {
	compactName,
	findCarried,
	hasRoom,
	itemMatchesName,
	removeFromBags,
	slotItem,
	tryInsert,
} from '../items/inventory';
import { cloneItem, isBackpack, itemID, type ItemInstance } from '../items/instance';
import { coinsOf, noteWant, transferCoins } from '../items/wallet';
import { dropItem, pickup } from '../items/pickup';
import { cueAt } from '../audio/cue';
import { isFood, useItem } from '../items/use';
import { captureItem } from '../world/spawn-item';
import type { GameHost } from './adapter';
import { findObject } from './names';
import { Bridge, BridgeLever } from '../kit/bridge/bridge';
import { Chest, chestHolding, takeFromChest } from '../kit/chests/chest';
import { Door } from '../kit/door/door';

/** The want is met, and the tag that would send them back for the same good comes off. */
function dropBoughtTag(host:GameHost, buyer:GameObject, label:string):void {
	noteWant(buyer, label);
	const mind = host.arc?.character(idOf(buyer));
	if (!mind) {
		return;
	}
	const key = compactName(label);
	const stillLooking = (buyer.getComponent(MarketplaceNPC)?.wants.length ?? 0) > 0;
	mind.tags = mind.tags.filter((tag) => compactName(tag) !== key && (stillLooking || tag !== 'wanting'));
}

/** The game's item rules: what may change hands, how, and what everyone hears about it. NPCs reach them through `withWorld`, the player through slash commands. */

export function findItem(character:GameObject, name:string):ItemInstance | null {
	return findCarried(character, (it) => itemMatchesName(it, name));
}

/** `character` uses a carried item, on `target` if given. ArcDirector already brought it in reach. */
export function useOn(host:GameHost, character:GameObject, itemName:string, targetID?:string):Outcome {
	const item = findItem(character, itemName);
	if (!item) {
		return { ok: false, reason: `not carrying ${itemName}` };
	}
	const named = targetID ? findObject(host.world, targetID) : undefined;
	// Carried things are not in the world; no item here works on another.
	if (targetID && !named) {
		return { ok: false, reason: 'nothing happens' };
	}
	// Used on oneself is simply used.
	const target = named === character ? undefined : named;
	const result = useItem(character, item, target ?? null);
	const targetName = target ? idOf(target) : undefined;
	if (result.ok && (result.reason === 'unlocked' || result.reason === 'opened') && target?.getComponent(Door) && targetName) {
		host.doorOpen.set(targetName, true);
	}
	if (result.ok && isFood(item) && !target) {
		dropBoughtTag(host, character, itemID(item));
	}
	if (result.ok) {
		// Everyone learns what changed, as with a give or a pick-up: "BridgeKeeper used BridgeCrank on BridgeLever: raised Bridge".
		const label = itemID(item);
		host.arc?.pushEvent({
			kind: 'Used',
			text: (name) => `${name(idOf(character))} used ${name(label)}${targetName ? ` on ${name(targetName)}` : ''}: ${showNamingText(result.reason, name)}`,
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
 * Why `move` cannot happen, or nothing: the game's item rules, for ArcDirector's verbs (`validateTransfer`). `deal` is
 * what else changes hands with it: an item leaving `to` in the same trade frees a slot.
 */
export function transferRefusal(move:Transfer<GameObject>, deal?:Deal<GameObject>):NamingText | undefined {
	const { verb, thing, from, to } = move;
	if (verb === 'pick_up') {
		return takeRefusal(to!, thing, from);
	}
	if (verb === 'steal' && to?.getComponent(MarketplaceNPC)?.kind === 'guard') {
		return 'the watch does not steal';
	}
	if (verb === 'drop') {
		// Coins have no body to put down or put away; only a hand takes them.
		if (isGold(thing) && !findItem(from, thing)) {
			return 'gold stays in your purse; give or offer it';
		}
		const shut = to && (to.getComponent(Chest) ? chestRefusal(to) : (name:(id:string)=>string) => `${name(idOf(to))} cannot hold things`);
		if (shut) {
			return shut;
		}
	}
	const count = countOf(move);
	if (isGold(thing) && !findItem(from, thing)) {
		const have = coinsOf(from);
		return have < count ? (name) => `${name(idOf(from))} has only ${have} gold` : undefined;
	}
	const stock = findItem(from, thing);
	if (!stock || stock.count < count) {
		return stock ? (name) => `${name(idOf(from))} has only ${stock.count} ${name(thing)}` : (name) => `${name(idOf(from))} has no ${name(thing)}`;
	}
	const unwanted = verb === 'drop' ? to?.getComponent(Chest)?.refuses(stock) : undefined;
	if (unwanted) {
		return unwanted;
	}
	// A whole stack leaving `to` in the same trade frees its slot first.
	const room = !to || hasRoom(to, stock, count) || keepsAtFeet(from, to) || !!deal?.leaving(to).some((m) => !isGold(m.thing));
	return room ? undefined : (name) => `${name(idOf(to))} has no room`;
}

/** Why nothing goes into or out of `chest` now, or nothing. */
function chestRefusal(chest:GameObject):NamingText | undefined {
	if (chest.getComponent(Lock)?.locked) {
		return (name) => `${name(idOf(chest))} is locked — unlock it first`;
	}
	return chest.getComponent(Chest)?.open === false ? (name) => `${name(idOf(chest))} is closed` : undefined;
}

/** Why `character` cannot take `thing` from `from` (the loot itself on the ground, or the chest it is in), or nothing. */
function takeRefusal(character:GameObject, thing:string, from:GameObject):NamingText | undefined {
	const fromID = idOf(from);
	if (from.getComponent(Chest)) {
		const held = chestHolding(from, thing);
		if (!held) {
			return (name) => `${name(fromID)} has no ${name(thing)}`;
		}
		// Shut is no bar: the lid is lifted to take it. Locked is.
		if (from.getComponent(Lock)?.locked) {
			return chestRefusal(from);
		}
		return hasRoom(character, held.item, held.item.count) ? undefined : 'no room';
	}
	if (from.getComponent(Pickupable)) {
		const inst = captureItem(from);
		if (fromID !== thing && !itemMatchesName(inst, thing)) {
			return (name) => `${name(fromID)} is not ${name(thing)}`;
		}
		if (isBackpack(inst)) {
			return character.getComponent(HumanBody) ? undefined : 'cannot equip that';
		}
		return hasRoom(character, inst, inst.count) ? undefined : 'no room';
	}
	if (from.getComponent(BridgeLever)) {
		return (name) => `${name(thing)} is a sluice, not loot. Use ${name('BridgeCrank')} on ${name(idOf(from))}`;
	}
	if (from.getComponent(HumanBody)) {
		// A fallen body (the library refuses the living ones): what it carries stays its own, and saying so beats "no such item".
		return findCarried(from, (it) => itemMatchesName(it, thing))
			? (name) => `${name(fromID)} carries ${name(thing)}. You cannot take it; ${name(fromID)} must give it to you`
			: (name) => `cannot pick up ${name(fromID)}`;
	}
	return (name) => `${name(fromID)} is ${from.getComponent(Door) ? 'a door' : from.getComponent(Bridge) ? 'a bridge' : 'not loot'}`;
}

/**
 * Makes `move`, which `transferRefusal` allowed: with its animation and what everyone hears of it. Returns how to
 * take it back. A pick-up or a drop is alone in its deal, so nothing after it can fail and its undo never runs.
 */
export function doTransfer(host:GameHost, move:Transfer<GameObject>):()=>void {
	const { verb, thing, from, to } = move;
	if (verb === 'pick_up') {
		takeLoot(host, to!, thing, from);
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
	// Put in a chest, it is stored, not bought.
	// Food is wanted until it is eaten (`useOn`).
	if (verb !== 'drop' && !isFood(gift)) {
		dropBoughtTag(host, to, thing);
	}
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

/**
 * `character` takes `name` from `from` (the loot itself on the ground, or the chest it is in), and everyone hears of it.
 * ArcDirector already brought it in reach.
 */
function takeLoot(host:GameHost, character:GameObject, name:string, from:GameObject):void {
	const held = chestHolding(from, name);
	const reason = held ? showNamingText(takeFromChest(character, held)) : pickup(character, from);
	if (!/^(picked up|equipped|took) /.test(reason)) {
		throw new Error(`taking ${name} failed after its rules allowed it: ${reason}`);
	}
	character.getComponent(Appearance)?.playClip('take', Time.time, from);
	host.arc?.pushEvent({ kind: 'PickedUp', text: (who) => `${who(idOf(character))} picked up ${name}`, tags: ['item', name], major: false });
	host.hooks.afterPickUp?.(host, character, name);
}

function countOf(move:Transfer<GameObject>):number {
	return Math.max(1, Math.floor(move.quantity ?? 1) || 1);
}
