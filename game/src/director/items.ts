import { Time, type GameObject } from '@arc-director/kindling';
import { bundleText, pascalCase, type ArcResult, type Outcome } from 'arc-director';
import {
	BODY_SLOTS,
	Bridge,
	BridgeLever,
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
	itemMatchesName,
	removeFromBags,
	slotItem,
	tryInsert,
} from '../items/inventory';
import { cloneItem, type ItemInstance } from '../items/instance';
import { coinsOf, noteWant, transferCoins } from '../items/wallet';
import { dropItem, findChestHolding, pickup, takeFromChest } from '../items/pickup';
import { cueAt } from '../audio/cue';
import { useItem } from '../items/use';
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

/** `character` takes `name` off the ground or out of a chest. ArcDirector already brought it in reach. */
export function takeItem(host:GameHost, character:GameObject, name:string):Outcome {
	const loot = host.world.findNamed(name);
	if (loot?.getComponent(Pickupable)) {
		const crop = loot.getComponent(Harvest);
		if (crop && !characterIs(character, crop.harvester)) {
			return { ok: false, reason: `only ${crop.harvester} can harvest that` };
		}
		const reason = pickup(character, loot);
		const ok = reason !== 'no room' && reason !== 'no world';
		if (ok) {
			character.getComponent(Appearance)?.playClip('take', Time.time, loot);
			host.arc?.pushEvent({ kind: 'PickedUp', text: `{0} picked up ${name}`, who: [idOf(character)], tags: ['item', name], major: false });
			host.hooks.afterPickUp?.(host, character, name);
		}
		return { ok, reason };
	}
	const held = findChestHolding(host.world, name);
	if (held) {
		const chestName = held.chest.getComponent(Named)?.id ?? held.chest.id;
		const lock = held.chest.getComponent(Lock);
		if (lock?.locked) {
			return { ok: false, reason: `${chestName} is locked — unlock it first` };
		}
		const reason = takeFromChest(character, held);
		const ok = reason.startsWith('took ');
		if (ok) {
			character.getComponent(Appearance)?.playClip('take', Time.time, held.chest);
			host.arc?.pushEvent({ kind: 'PickedUp', text: `{0} picked up ${name}`, who: [idOf(character)], tags: ['item', name], major: false });
			host.hooks.afterPickUp?.(host, character, name);
		}
		return { ok, reason };
	}
	const named = host.world.findNamed(name);
	if (named?.getComponent(BridgeLever)) {
		return { ok: false, reason: `${name} is a sluice, not loot. Only BridgeKeeper uses BridgeCrank on BridgeLever` };
	}
	if (named?.getComponent(HumanBody) || named?.getComponent(MarketNPC)) {
		return { ok: false, reason: `cannot pick up ${name}` };
	}
	if (named) {
		const kind = named.getComponent(Door)
			? 'a door'
			: named.getComponent(Bridge)
				? 'a bridge'
				: 'not loot';
		return { ok: false, reason: `${name} is ${kind}` };
	}
	// Someone has it: it is theirs to hand over, and saying where it is beats "no such item".
	const holder = host.world.objects.find((go) => go !== character && !!go.getComponent(HumanBody)
		&& !!findCarried(go, (it) => itemMatchesName(it, name)));
	if (holder) {
		const who = idOf(holder);
		return { ok: false, reason: `${who} carries ${name}. You cannot take it; ${who} must give it to you` };
	}
	return { ok: false, reason: `no such item ${name}` };
}

/** `character` puts a carried item down where it stands. */
export function dropCarried(character:GameObject, name:string):Outcome {
	const item = findItem(character, name);
	if (!item) {
		return { ok: false, reason: `not carrying ${name}` };
	}
	removeFromBags(character, item);
	const human = character.getComponent(HumanBody);
	if (human) {
		for (const slot of BODY_SLOTS) {
			if (slotItem(human, slot) === item) {
				human.slots[slot] = null;
			}
		}
	}
	dropItem(character, item);
	return { ok: true, reason: `dropped ${item.name}` };
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

/** Undo `takeSome`: put `taken` back onto `original`. */
export function restoreSome(character:GameObject, taken:ItemInstance, original:ItemInstance):void {
	if (taken === original) {
		tryInsert(character, taken);
		return;
	}
	original.count += taken.count;
}

export function settleGive(from:GameObject, to:GameObject, itemName:string, quantity = 1):ArcResult {
	if (to === from) {
		return { ok: false, verb: 'give', reason: 'cannot give to yourself' };
	}
	const count = Math.max(1, Math.floor(quantity) || 1);
	if (compactName(itemName) === 'gold' && !findItem(from, itemName)) {
		return settlePay(from, to, count);
	}
	const item = findItem(from, itemName);
	if (!item) {
		return { ok: false, verb: 'give', reason: `not carrying ${itemName}` };
	}
	if (item.count < count) {
		return { ok: false, verb: 'give', reason: `carrying only ${item.count} ${itemName}` };
	}
	const gift = takeSome(from, item, count);
	const roomless = !tryInsert(to, gift);
	if (roomless) {
		// The player and whoever a companion follows get it at their feet; anyone else refuses.
		if (to.id !== 'Player' && idOf(to) !== from.getComponent(Companion)?.targetID) {
			restoreSome(from, gift, item);
			return { ok: false, verb: 'give', reason: `${idOf(to)} has no room` };
		}
		dropItem(to, gift);
	}
	const label = pascalCase(gift.name) || gift.name;
	playHandoff(from, to);
	return { ok: true, verb: 'give', reason: `gave ${label} to ${idOf(to)}${roomless ? ' (left at their feet — no room)' : ''}` };
}

export function settlePay(from:GameObject, to:GameObject, amount:number):ArcResult {
	if (to === from) {
		return { ok: false, verb: 'give', reason: 'cannot give to yourself' };
	}
	const err = transferCoins(from, to, amount);
	if (err) {
		return { ok: false, verb: 'give', reason: err };
	}
	playHandoff(from, to);
	return { ok: true, verb: 'give', reason: `gave ${amount} gold to ${idOf(to)}` };
}

function playHandoff(from:GameObject, to:GameObject):void {
	const t = Time.time;
	from.getComponent(Appearance)?.playClip('give', t, to);
	to.getComponent(Appearance)?.playClip('take', t, from);
	cueAt(from.world, 'give', from);
}

/** Move every entry of `bundle`, pushing how to put each back onto `undo`. `whose` names `from` in a refusal: `you have`, `Baker has`. */
function moveBundle(from:GameObject, to:GameObject, bundle:Record<string, number>, whose:string, undo:Array<()=>void>):string | null {
	for (const [name, count] of Object.entries(bundle)) {
		if (count <= 0) {
			continue;
		}
		if (compactName(name) === 'gold') {
			const have = coinsOf(from);
			if (have < count) {
				return `${whose} only ${have} gold`;
			}
			transferCoins(from, to, count);
			undo.push(() => {
				transferCoins(to, from, count);
			});
			continue;
		}
		const stock = findItem(from, name);
		if (!stock || stock.count < count) {
			return stock ? `${whose} only ${stock.count} ${name}` : `${whose} no ${name}`;
		}
		const gift = takeSome(from, stock, count);
		if (!tryInsert(to, gift)) {
			restoreSome(from, gift, stock);
			return `${idOf(to)} has no room`;
		}
		undo.push(() => {
			const held = findItem(to, name);
			if (held) {
				const back = takeSome(to, held, Math.min(count, held.count));
				if (!tryInsert(from, back)) {
					dropItem(from, back);
				}
			}
		});
	}
	return null;
}

/** `character` took `other`'s offer: `give` and `get` change hands at once, or nothing moves. */
export function settleExchange(host:GameHost, character:GameObject, other:GameObject, give:Record<string, number>, get:Record<string, number>):Outcome {
	const undo:Array<()=>void> = [];
	const otherID = idOf(other);
	const err = moveBundle(character, other, give, 'you have', undo) ?? moveBundle(other, character, get, `${otherID} has`, undo);
	if (err) {
		for (const step of undo.reverse()) {
			step();
		}
		return { ok: false, reason: err };
	}
	playHandoff(character, other);
	for (const name of Object.keys(get)) {
		dropBoughtTag(host, character, name);
	}
	for (const name of Object.keys(give)) {
		dropBoughtTag(host, other, name);
	}
	return { ok: true, reason: `traded ${bundleText(give)} for ${bundleText(get)} with ${otherID}` };
}
