import { pascalCase, type ArcResult, type Outcome } from 'arc-director';
import {
	BODY_SLOTS,
	Bridge,
	BridgeLever,
	Companion,
	Door,
	HumanBody,
	HumanSprite,
	Lock,
	MarketNPC,
	Merchant,
	Named,
} from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import { Harvest, Pickupable } from '../items/components';
import { getDef } from '../items/defs';
import {
	actorIs,
	compactName,
	distXZ,
	findCarried,
	itemMatchesName,
	removeFromBags,
	slotItem,
	tryInsert,
} from '../items/inventory';
import { cloneItem, type ItemInstance } from '../items/instance';
import { coinsOf, findSaleItem, noteWant, priceFor, transferCoins } from '../items/wallet';
import { dropItem, findChestHolding, pickup, takeFromChest, USE_RANGE } from '../items/pickup';
import { cueAt } from '../audio/cue';
import { useItem } from '../items/use';
import type { GameHost } from './adapter';
import { bodyName } from './names';

/** The game's item rules: what may change hands, how, and what everyone hears about it. NPCs reach them through `withWorld`, the player through slash commands. */

export function findItem(actor:GameObject, name:string):ItemInstance | null {
	return findCarried(actor, (it) => itemMatchesName(it, name));
}

/** `actor` uses a carried item, on `target` if given. ArcDirector already brought it in reach. */
export function useOn(host:GameHost, actor:GameObject, itemName:string, target?:GameObject):Outcome {
	const item = findItem(actor, itemName);
	if (!item) {
		return { ok: false, reason: `not carrying ${itemName}` };
	}
	const result = useItem(actor, item, target ?? null);
	const targetName = target ? target.getComponent(Named)?.id ?? target.id : undefined;
	if (result.ok && result.reason === 'unlocked' && target?.getComponent(Door) && targetName) {
		host.doorOpen.set(targetName, true);
	}
	if (result.ok) {
		// Everyone learns what changed, as with a give or a pick-up: "BridgeKeeper used BridgeCrank on BridgeLever: lowered Bridge".
		const label = pascalCase(item.name) || item.name;
		host.arc?.pushEvent({
			kind: 'Used',
			text: targetName ? `{0} used ${label} on ${targetName}: ${result.reason}` : `{0} used ${label}: ${result.reason}`,
			who: [bodyName(actor)],
			tags: ['use', label, ...(targetName ? [targetName] : [])],
			major: false,
		});
	}
	return { ok: result.ok, reason: result.reason };
}

/** `actor` takes `name` off the ground or out of a chest. ArcDirector already brought it in reach. */
export function takeItem(host:GameHost, actor:GameObject, name:string):Outcome {
	const loot = host.world.findNamed(name);
	if (loot?.getComponent(Pickupable)) {
		const crop = loot.getComponent(Harvest);
		if (crop && !actorIs(actor, crop.harvester)) {
			return { ok: false, reason: `only ${crop.harvester} can harvest that` };
		}
		const reason = pickup(actor, loot);
		const ok = reason !== 'no room' && reason !== 'no world';
		if (ok) {
			actor.getComponent(HumanSprite)?.playClip('take', host.world.time);
			host.arc?.pushEvent({ kind: 'PickedUp', text: `{0} picked up ${name}`, who: [bodyName(actor)], tags: ['item', name], major: false });
			host.hooks.afterPickUp?.(host, actor, name);
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
		const reason = takeFromChest(actor, held);
		const ok = reason.startsWith('took ');
		if (ok) {
			actor.getComponent(HumanSprite)?.playClip('take', host.world.time);
			host.arc?.pushEvent({ kind: 'PickedUp', text: `{0} picked up ${name}`, who: [bodyName(actor)], tags: ['item', name], major: false });
			host.hooks.afterPickUp?.(host, actor, name);
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
	const holder = host.world.objects.find((go) => go !== actor && !!go.getComponent(HumanBody)
		&& !!findCarried(go, (it) => itemMatchesName(it, name)));
	if (holder) {
		const who = bodyName(holder);
		return { ok: false, reason: `${who} carries ${name}. You cannot take it; ${who} must give it to you` };
	}
	return { ok: false, reason: `no such item ${name}` };
}

/** `actor` puts a carried item down where it stands. */
export function dropCarried(actor:GameObject, name:string):Outcome {
	const item = findItem(actor, name);
	if (!item) {
		return { ok: false, reason: `not carrying ${name}` };
	}
	removeFromBags(actor, item);
	const body = actor.getComponent(HumanBody);
	if (body) {
		for (const slot of BODY_SLOTS) {
			if (slotItem(body, slot) === item) {
				body.slots[slot] = null;
			}
		}
	}
	dropItem(actor, item);
	return { ok: true, reason: `dropped ${item.name}` };
}

/** Take `count` off the stack `item` that `actor` carries: a split-off stack, or `item` itself when that is all of it. */
export function takeSome(actor:GameObject, item:ItemInstance, count = 1):ItemInstance {
	const gift = item.count > count ? cloneItem(item, count) : item;
	if (gift === item) {
		removeFromBags(actor, item);
		const body = actor.getComponent(HumanBody);
		if (body) {
			for (const slot of BODY_SLOTS) {
				if (slotItem(body, slot) === item) {
					body.slots[slot] = null;
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
export function restoreSome(actor:GameObject, taken:ItemInstance, original:ItemInstance):void {
	if (taken === original) {
		tryInsert(actor, taken);
		return;
	}
	original.count += taken.count;
}

/** "Bread" or "3 Bread". */
function countedLabel(item:ItemInstance):string {
	const label = pascalCase(item.name) || item.name;
	return item.count > 1 ? `${item.count} ${label}` : label;
}

export function tooFar(actor:GameObject, target:GameObject, name:string):string | null {
	if (distXZ(actor, target) > USE_RANGE) {
		return `too far — go closer to ${name}`;
	}
	return null;
}

function purseGoldAmount():number {
	return getDef('fire_mushroom').components.Goods?.ask ?? 3;
}

export function settleGive(from:GameObject, to:GameObject, itemName:string, host:GameHost):ArcResult {
	if (to === from) {
		return { ok: false, verb: 'give', reason: 'cannot give to yourself' };
	}
	if (compactName(itemName) === 'gold' && !findItem(from, itemName)) {
		return settlePay(from, to, purseGoldAmount(), host);
	}
	const item = findItem(from, itemName);
	if (!item) {
		return { ok: false, verb: 'give', reason: `not carrying ${itemName}` };
	}
	const gift = takeSome(from, item);
	if (!tryInsert(to, gift)) {
		const followedID = from.getComponent(Companion)?.targetID;
		if (to.id === 'Player' || bodyName(to) === followedID) {
			dropItem(to, gift);
			const label = pascalCase(gift.name) || gift.name;
			const t = from.world?.time ?? 0;
			from.getComponent(HumanSprite)?.playClip('give', t);
			to.getComponent(HumanSprite)?.playClip('take', t);
			cueAt(from.world, 'give', from);
			host.arc?.pushEvent({ kind: 'Given', text: `{0} gave ${label} to {1}`, who: [bodyName(from), bodyName(to)], tags: ['give', label], major: false });
			return {
				ok: true,
				verb: 'give',
				reason: `gave ${label} to ${bodyName(to)} (left at their feet — no room)`,
			};
		}
		restoreSome(from, gift, item);
		return { ok: false, verb: 'give', reason: `${bodyName(to)} has no room` };
	}
	const label = pascalCase(gift.name) || gift.name;
	const t = from.world?.time ?? 0;
	from.getComponent(HumanSprite)?.playClip('give', t);
	to.getComponent(HumanSprite)?.playClip('take', t);
	cueAt(from.world, 'give', from);
	host.arc?.pushEvent({ kind: 'Given', text: `{0} gave ${label} to {1}`, who: [bodyName(from), bodyName(to)], tags: ['give', label], major: false });
	return { ok: true, verb: 'give', reason: `gave ${label} to ${bodyName(to)}` };
}

export function settlePay(from:GameObject, to:GameObject, amount:number, host:GameHost):ArcResult {
	if (to === from) {
		return { ok: false, verb: 'give', reason: 'cannot give to yourself' };
	}
	const err = transferCoins(from, to, amount);
	if (err) {
		return { ok: false, verb: 'give', reason: err };
	}
	const t = from.world?.time ?? 0;
	from.getComponent(HumanSprite)?.playClip('give', t);
	to.getComponent(HumanSprite)?.playClip('take', t);
	cueAt(from.world, 'give', from);
	host.arc?.pushEvent({ kind: 'Given', text: `{0} gave ${amount} gold to {1}`, who: [bodyName(from), bodyName(to)], tags: ['give', 'gold'], major: false });
	return { ok: true, verb: 'give', reason: `gave ${amount} gold to ${bodyName(to)}` };
}

export function settleBuy(
	buyer:GameObject,
	seller:GameObject,
	itemName:string,
	offer:number,
	host:GameHost,
	quantity = 1,
):ArcResult {
	const fromName = bodyName(seller);
	const stock = findSaleItem(seller, itemName);
	if (!stock) {
		return { ok: false, verb: 'buy', reason: `${fromName} has no ${itemName}` };
	}
	if (stock.count < quantity) {
		return { ok: false, verb: 'buy', reason: `${fromName} has only ${stock.count} ${itemName}` };
	}
	const buyerID = bodyName(buyer);
	const quote = priceFor(seller, stock, buyerID);
	if (!quote) {
		return { ok: false, verb: 'buy', reason: `${itemName} is not for sale` };
	}
	const offered = Number.isFinite(offer);
	let price = (quote.agreed ?? quote.ask) * quantity;
	if (offered) {
		const floor = quote.floor * quantity;
		if (offer + 1e-6 < floor) {
			return { ok: false, verb: 'buy', reason: `${fromName} will not go below ${floor} gold${quantity > 1 ? ` for ${quantity}` : ''}` };
		}
		price = Math.floor(offer);
	}
	const err = transferCoins(buyer, seller, price);
	if (err) {
		return { ok: false, verb: 'buy', reason: err };
	}
	const gift = takeSome(seller, stock, quantity);
	if (!tryInsert(buyer, gift)) {
		restoreSome(seller, gift, stock);
		transferCoins(seller, buyer, price);
		return { ok: false, verb: 'buy', reason: 'no room' };
	}
	const shop = seller.getComponent(Merchant);
	if (shop) {
		delete shop.deals[buyerID];
	}
	const label = pascalCase(gift.name) || gift.name;
	const counted = countedLabel(gift);
	const t = buyer.world?.time ?? 0;
	buyer.getComponent(HumanSprite)?.playClip('take', t);
	seller.getComponent(HumanSprite)?.playClip('give', t);
	cueAt(seller.world, 'give', seller);
	if (price > 0) {
		host.arc?.pushEvent({ kind: 'Bought', text: `{0} bought ${counted} from {1} for ${price} gold`, who: [bodyName(buyer), bodyName(seller)], tags: ['buy', label], major: false });
	}
	noteWant(buyer, label);
	return { ok: true, verb: 'buy', reason: `bought ${counted} from ${fromName} for ${price} gold` };
}

export function settleSell(
	seller:GameObject,
	buyer:GameObject,
	itemName:string,
	ask:number,
	host:GameHost,
	quantity = 1,
):ArcResult {
	const toName = bodyName(buyer);
	const stock = findSaleItem(seller, itemName) ?? findItem(seller, itemName);
	if (!stock) {
		return { ok: false, verb: 'sell', reason: `not carrying ${itemName}` };
	}
	if (stock.count < quantity) {
		return { ok: false, verb: 'sell', reason: `carrying only ${stock.count} ${itemName}` };
	}
	const quote = priceFor(seller, stock, toName);
	const unit = quote?.ask ?? quote?.floor;
	const price = Number.isFinite(ask) ? Math.floor(ask) : unit === undefined ? undefined : unit * quantity;
	if (price === undefined || price <= 0) {
		return { ok: false, verb: 'sell', reason: `${itemName} has no price — name an ask` };
	}
	const npc = buyer.getComponent(MarketNPC);
	if (npc && npc.wants.length > 0) {
		const want = npc.wants.some((w) => compactName(w) === compactName(itemName));
		if (!want && toName !== 'Player') {
			return { ok: false, verb: 'sell', reason: `${toName} does not want ${itemName}` };
		}
	}
	if (coinsOf(buyer) < price) {
		return { ok: false, verb: 'sell', reason: `${toName} has only ${coinsOf(buyer)} gold` };
	}
	const err = transferCoins(buyer, seller, price);
	if (err) {
		return { ok: false, verb: 'sell', reason: err };
	}
	const gift = takeSome(seller, stock, quantity);
	if (!tryInsert(buyer, gift)) {
		restoreSome(seller, gift, stock);
		transferCoins(seller, buyer, price);
		return { ok: false, verb: 'sell', reason: `${toName} has no room` };
	}
	const label = pascalCase(gift.name) || gift.name;
	const counted = countedLabel(gift);
	const t = seller.world?.time ?? 0;
	seller.getComponent(HumanSprite)?.playClip('give', t);
	buyer.getComponent(HumanSprite)?.playClip('take', t);
	cueAt(seller.world, 'give', seller);
	if (price > 0) {
		host.arc?.pushEvent({ kind: 'Bought', text: `{0} bought ${counted} from {1} for ${price} gold`, who: [bodyName(buyer), bodyName(seller)], tags: ['buy', label], major: false });
	}
	noteWant(buyer, label);
	return { ok: true, verb: 'sell', reason: `sold ${counted} to ${toName} for ${price} gold` };
}
