import { pascalCase, type ActionResult, type Step } from 'arc-director';
import { NPCInput } from '../actors/NPCInput';
import {
	BODY_SLOTS,
	Bridge,
	HumanBody,
	HumanSprite,
	Lock,
	MillLever,
	Named,
	Companion,
	Crowd,
	Merchant,
	Door,
	Wanted,
	type BodySlot,
} from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import { Harvest, Pickupable } from '../items/components';
import {
	distXZ,
	findCarried,
	itemMatchesName,
	removeFromBags,
	slotItem,
	tryInsert,
	compactName,
	actorIs,
} from '../items/inventory';
import { cloneItem, type ItemInstance } from '../items/instance';
import { coinsOf, findSaleItem, noteWant, priceFor, transferCoins } from '../items/wallet';
import { dropItem, findChestHolding, pickup, takeFromChest, USE_RANGE } from '../items/pickup';
import { cueAt } from '../audio/cue';
import { equipItem, unequipSlot } from '../items/equip';
import { useItem } from '../items/use';
import type { GameHost } from './adapter';
import { bodyName, findBody } from './names';
import { poseFact } from './kernels';
import { doExamine } from './perception';
import type { HostCtx } from './types';
import {
	formatWanderSeen,
	namesAlongPath,
	pickWanderPoint,
	wanderUntilMet,
} from './wander';

function findItem(actor:GameObject, name:string):ItemInstance | null {
	return findCarried(actor, (it) => itemMatchesName(it, name));
}

function asSlot(raw:string):BodySlot | undefined {
	return (BODY_SLOTS as readonly string[]).includes(raw) ? raw as BodySlot : undefined;
}

function setOverhead(host:GameHost, id:string, text:string, seconds:number):ActionResult {
	const agent = host.agentByID(id);
	if (!agent) {
		return { ok: false, verb: 'set_status', reason: 'no mind' };
	}
	const label = text.trim().slice(0, 72);
	if (!label) {
		return { ok: false, verb: 'set_status', reason: 'nothing to show' };
	}
	const life = Math.min(60, Math.max(1, seconds));
	host.labels.set(agent.id, { text: label, until: host.world.time + life });
	return { ok: true, verb: 'set_status', reason: `${life}s` };
}

export async function executeStep(host:GameHost, step:Step, ctx:HostCtx):Promise<ActionResult> {
	const npc = ctx.actor.getComponent(NPCInput);
	if (!npc) {
		return { ok: false, verb: step.verb, reason: 'no NPCInput' };
	}
	if (step.verb !== 'think') {
		const agent = host.agentByID(ctx.actor.id) ?? host.agentByID(bodyName(ctx.actor));
		agent?.noteVerb(step.verb);
	}
	switch (step.verb) {
		case 'go_to': {
			return npc.goTo(String(step.args.name ?? ''));
		}
		case 'follow': {
			const name = String(step.args.name ?? '');
			const bond = ctx.actor.getComponent(Companion);
			if (bond?.hold && (name === bond.targetID || name === 'Player')) {
				return npc.wait(8);
			}
			return npc.follow(name);
		}
		case 'wander': {
			const bond = ctx.actor.getComponent(Companion);
			if (bond?.hold) {
				return npc.wait(8);
			}
			if (bond) {
				return npc.follow(bond.targetID);
			}
			const until = (typeof step.args.for === 'string' ? step.args.for : typeof step.args.until === 'string' ? step.args.until : '')
				.replace(/\s+/g, ' ')
				.trim();
			const seconds = typeof step.args.seconds === 'number'
				? step.args.seconds
				: until ? 20 : 6;
			const seen = new Set<string>();
			const note = () => {
				for (const name of namesAlongPath(ctx.actor)) {
					seen.add(name);
				}
			};
			const result = await npc.wander(seconds, until ? {
				stop: () => wanderUntilMet(ctx, host.posedEvents, until),
				dest: () => pickWanderPoint(ctx.actor, until),
				note,
			} : { note });
			note();
			const saw = formatWanderSeen(seen);
			if (result.reason === 'until') {
				return { ...result, verb: 'wander', reason: saw ? `until — ${saw}` : 'until' };
			}
			return { ...result, verb: 'wander', reason: saw || result.reason };
		}
		case 'wait': {
			return npc.wait(typeof step.args.seconds === 'number' ? step.args.seconds : 1);
		}
		case 'say': {
			const text = String(step.args.text ?? '');
			const to = String(step.args.to ?? '');
			return host.talk.say(
				bodyName(ctx.actor),
				text,
				to || undefined,
				ctx.world.time,
			);
		}
		case 'use':
			return doUse(host, ctx, npc, String(step.args.item ?? ''), String(step.args.target ?? '') || undefined);
		case 'equip':
			return doEquip(ctx, String(step.args.item ?? ''), String(step.args.slot ?? '') || undefined);
		case 'unequip':
			return doUnequip(ctx, String(step.args.slot ?? ''));
		case 'pick_up':
			return doPickUp(host, ctx, npc, String(step.args.name ?? ''));
		case 'drop':
			return doDrop(ctx, String(step.args.name ?? ''));
		case 'give':
			return doGive(host, ctx, npc, String(step.args.item ?? ''), String(step.args.to ?? ''));
		case 'examine':
			return doExamine(ctx, String(step.args.name ?? ''));
		case 'buy':
			return doBuy(
				host,
				ctx,
				npc,
				String(step.args.item ?? ''),
				String(step.args.from ?? ''),
				typeof step.args.offer === 'number' ? step.args.offer : NaN,
			);
		case 'sell':
			return doSell(
				host,
				ctx,
				npc,
				String(step.args.item ?? ''),
				String(step.args.to ?? ''),
				typeof step.args.ask === 'number' ? step.args.ask : NaN,
			);
		case 'steal':
			return doSteal(host, ctx, npc, String(step.args.item ?? ''), String(step.args.from ?? ''));
		case 'set_status':
			return setOverhead(
				host,
				bodyName(ctx.actor),
				String(step.args.text ?? ''),
				typeof step.args.seconds === 'number' ? step.args.seconds : 6,
			);
		case 'rest':
			return {
				ok: true,
				verb: 'rest',
				reason: host.hooks.goalDone?.(host, bodyName(ctx.actor)) ? 'done — still listening' : 'goal still open',
			};
		default:
			return { ok: false, verb: step.verb, reason: `unhandled verb ${step.verb}` };
	}
}

async function ensureRange(
	npc:NPCInput,
	actor:GameObject,
	target:GameObject,
	name:string,
):Promise<ActionResult> {
	if (distXZ(actor, target) <= USE_RANGE) {
		return { ok: true };
	}
	return npc.goTo(name);
}

async function doUse(
	host:GameHost,
	ctx:HostCtx,
	npc:NPCInput,
	itemName:string,
	targetName?:string,
):Promise<ActionResult> {
	const item = findItem(ctx.actor, itemName);
	if (!item) {
		return { ok: false, verb: 'use', reason: `not carrying ${itemName}` };
	}
	let target:GameObject | null = null;
	if (targetName) {
		target = ctx.world.findNamed(targetName) ?? null;
		if (!target) {
			return { ok: false, verb: 'use', reason: `no such target ${targetName}` };
		}
		const walk = await ensureRange(npc, ctx.actor, target, targetName);
		if (!walk.ok) {
			return { ...walk, verb: 'use' };
		}
	}
	const result = useItem(ctx.actor, item, target);
	if (result.ok && result.reason === 'unlocked' && target?.getComponent(Door)) {
		const name = target.getComponent(Named)?.id ?? target.id;
		host.doorOpen.set(name, true);
		host.pushEvent({
			kind: 'DoorOpened',
			text: `${name} opened`,
			tags: ['door', name],
			major: true,
		});
	}
	return { ok: result.ok, verb: 'use', reason: result.reason };
}

async function doEquip(ctx:HostCtx, itemName:string, slotName?:string):Promise<ActionResult> {
	const item = findItem(ctx.actor, itemName);
	if (!item) {
		return { ok: false, verb: 'equip', reason: `not carrying ${itemName}` };
	}
	const slot = slotName ? asSlot(slotName) : undefined;
	if (slotName && !slot) {
		return { ok: false, verb: 'equip', reason: `no slot ${slotName}` };
	}
	const err = equipItem(ctx.actor, item, ctx.world, slot);
	if (err) {
		return { ok: false, verb: 'equip', reason: err };
	}
	removeFromBags(ctx.actor, item);
	return { ok: true, verb: 'equip' };
}

async function doUnequip(ctx:HostCtx, slotName:string):Promise<ActionResult> {
	const slot = asSlot(slotName);
	if (!slot) {
		return { ok: false, verb: 'unequip', reason: `no slot ${slotName}` };
	}
	unequipSlot(ctx.actor, slot, ctx.world);
	return { ok: true, verb: 'unequip' };
}

async function doPickUp(host:GameHost, ctx:HostCtx, npc:NPCInput, name:string):Promise<ActionResult> {
	const loot = ctx.world.findNamed(name);
	if (loot?.getComponent(Pickupable)) {
		const crop = loot.getComponent(Harvest);
		if (crop && !actorIs(ctx.actor, crop.harvester)) {
			return { ok: false, verb: 'pick_up', reason: `only ${crop.harvester} can harvest that` };
		}
		const walk = await ensureRange(npc, ctx.actor, loot, name);
		if (!walk.ok) {
			return { ...walk, verb: 'pick_up' };
		}
		const reason = pickup(ctx.actor, loot);
		const ok = reason !== 'no room' && reason !== 'no world';
		if (ok) {
			ctx.actor.getComponent(HumanSprite)?.playClip('take', ctx.world.time);
			host.pushEvent({
				kind: 'PickedUp',
				text: `${bodyName(ctx.actor)} picked up ${name}`,
				tags: ['item', name, bodyName(ctx.actor)],
				major: true,
			});
			host.hooks.afterPickUp?.(host, ctx.actor, name);
		}
		return { ok, verb: 'pick_up', reason };
	}
	const held = findChestHolding(ctx.world, name);
	if (held) {
		const chestName = held.chest.getComponent(Named)?.id ?? held.chest.id;
		const lock = held.chest.getComponent(Lock);
		if (lock?.locked) {
			return { ok: false, verb: 'pick_up', reason: `${chestName} is locked — unlock it first` };
		}
		const walk = await ensureRange(npc, ctx.actor, held.chest, chestName);
		if (!walk.ok) {
			return { ...walk, verb: 'pick_up' };
		}
		const reason = takeFromChest(ctx.actor, held);
		const ok = reason.startsWith('took ');
		if (ok) {
			ctx.actor.getComponent(HumanSprite)?.playClip('take', ctx.world.time);
			host.pushEvent({
				kind: 'PickedUp',
				text: `${bodyName(ctx.actor)} picked up ${name}`,
				tags: ['item', name, bodyName(ctx.actor)],
				major: true,
			});
			host.hooks.afterPickUp?.(host, ctx.actor, name);
		}
		return { ok, verb: 'pick_up', reason };
	}
	const named = ctx.world.findNamed(name);
	if (named?.getComponent(MillLever)) {
		return {
			ok: false,
			verb: 'pick_up',
			reason: `${name} is a sluice, not loot. Only Miller uses MillCrank on MillLever`,
		};
	}
	if (named?.getComponent(HumanBody) || named?.getComponent(Crowd)) {
		return { ok: false, verb: 'pick_up', reason: `cannot pick up ${name}` };
	}
	if (named) {
		const kind = named.getComponent(Door)
			? 'a door'
			: named.getComponent(Bridge)
				? 'a bridge'
				: 'not loot';
		return { ok: false, verb: 'pick_up', reason: `${name} is ${kind}` };
	}
	return { ok: false, verb: 'pick_up', reason: `no such item ${name}` };
}

async function doDrop(ctx:HostCtx, name:string):Promise<ActionResult> {
	const item = findItem(ctx.actor, name);
	if (!item) {
		return { ok: false, verb: 'drop', reason: `not carrying ${name}` };
	}
	removeFromBags(ctx.actor, item);
	const body = ctx.actor.getComponent(HumanBody);
	if (body) {
		for (const slot of BODY_SLOTS) {
			if (slotItem(body, slot) === item) {
				body.slots[slot] = null;
			}
		}
	}
	dropItem(ctx.actor, item);
	return { ok: true, verb: 'drop', reason: `dropped ${item.name}` };
}

export function takeOne(actor:GameObject, item:ItemInstance):ItemInstance {
	const gift = item.count > 1 ? cloneItem(item, 1) : item;
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
		item.count -= 1;
	}
	return gift;
}

function restoreOne(actor:GameObject, item:ItemInstance, original:ItemInstance):void {
	if (item === original) {
		tryInsert(actor, item);
		return;
	}
	original.count += 1;
}

export function tooFar(actor:GameObject, target:GameObject, name:string):string | null {
	if (distXZ(actor, target) > USE_RANGE) {
		return `too far — walk closer to ${name}`;
	}
	return null;
}

export function settleGive(from:GameObject, to:GameObject, itemName:string, host:GameHost):ActionResult {
	if (to === from) {
		return { ok: false, verb: 'give', reason: 'cannot give to yourself' };
	}
	const item = findItem(from, itemName);
	if (!item) {
		return { ok: false, verb: 'give', reason: `not carrying ${itemName}` };
	}
	const gift = takeOne(from, item);
	if (!tryInsert(to, gift)) {
		const followedID = from.getComponent(Companion)?.targetID;
		if (to.id === 'Player' || bodyName(to) === followedID) {
			dropItem(to, gift);
			const label = pascalCase(gift.name) || gift.name;
			const t = from.world?.time ?? 0;
			from.getComponent(HumanSprite)?.playClip('give', t);
			to.getComponent(HumanSprite)?.playClip('take', t);
			cueAt(from.world, 'give', from);
			host.pushEvent({
				kind: 'Given',
				text: `${bodyName(from)} gave ${label} to ${bodyName(to)}`,
				tags: ['give', label, bodyName(from), bodyName(to)],
				major: true,
			});
			return {
				ok: true,
				verb: 'give',
				reason: `gave ${label} to ${bodyName(to)} (left at their feet — no room)`,
			};
		}
		restoreOne(from, gift, item);
		return { ok: false, verb: 'give', reason: `${bodyName(to)} has no room` };
	}
	const label = pascalCase(gift.name) || gift.name;
	const t = from.world?.time ?? 0;
	from.getComponent(HumanSprite)?.playClip('give', t);
	to.getComponent(HumanSprite)?.playClip('take', t);
	cueAt(from.world, 'give', from);
	host.pushEvent({
		kind: 'Given',
		text: `${bodyName(from)} gave ${label} to ${bodyName(to)}`,
		tags: ['give', label, bodyName(from), bodyName(to)],
		major: true,
	});
	return { ok: true, verb: 'give', reason: `gave ${label} to ${bodyName(to)}` };
}

export function settlePay(from:GameObject, to:GameObject, amount:number, host:GameHost):ActionResult {
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
	host.pushEvent({
		kind: 'Given',
		text: `${bodyName(from)} gave ${amount} gold to ${bodyName(to)}`,
		tags: ['give', 'gold', bodyName(from), bodyName(to)],
		major: true,
	});
	return { ok: true, verb: 'give', reason: `gave ${amount} gold to ${bodyName(to)}` };
}

export function settleBuy(
	buyer:GameObject,
	seller:GameObject,
	itemName:string,
	offer:number,
	host:GameHost,
):ActionResult {
	const fromName = bodyName(seller);
	const stock = findSaleItem(seller, itemName);
	if (!stock) {
		return { ok: false, verb: 'buy', reason: `${fromName} has no ${itemName}` };
	}
	const buyerID = bodyName(buyer);
	const quote = priceFor(seller, stock, buyerID);
	if (!quote) {
		return { ok: false, verb: 'buy', reason: `${itemName} is not for sale` };
	}
	const offered = Number.isFinite(offer);
	let price = quote.agreed ?? quote.ask;
	if (offered) {
		if (offer + 1e-6 < quote.floor) {
			return { ok: false, verb: 'buy', reason: `${fromName} will not go below ${quote.floor} gold` };
		}
		price = Math.floor(offer);
	}
	const err = transferCoins(buyer, seller, price);
	if (err) {
		return { ok: false, verb: 'buy', reason: err };
	}
	const gift = takeOne(seller, stock);
	if (!tryInsert(buyer, gift)) {
		restoreOne(seller, gift, stock);
		transferCoins(seller, buyer, price);
		return { ok: false, verb: 'buy', reason: 'no room' };
	}
	const shop = seller.getComponent(Merchant);
	if (shop) {
		delete shop.deals[buyerID];
	}
	const label = pascalCase(gift.name) || gift.name;
	const t = buyer.world?.time ?? 0;
	buyer.getComponent(HumanSprite)?.playClip('take', t);
	seller.getComponent(HumanSprite)?.playClip('give', t);
	cueAt(seller.world, 'give', seller);
	if (price > 0) {
		host.pushEvent({
			kind: 'Bought',
			text: `${bodyName(buyer)} bought ${label} from ${bodyName(seller)} for ${price} gold`,
			tags: ['buy', label, bodyName(buyer), bodyName(seller)],
			major: true,
		});
	}
	noteWant(buyer, label);
	return { ok: true, verb: 'buy', reason: `bought ${label} from ${fromName} for ${price} gold` };
}

export function settleSell(
	seller:GameObject,
	buyer:GameObject,
	itemName:string,
	ask:number,
	host:GameHost,
):ActionResult {
	const toName = bodyName(buyer);
	const stock = findSaleItem(seller, itemName) ?? findItem(seller, itemName);
	if (!stock) {
		return { ok: false, verb: 'sell', reason: `not carrying ${itemName}` };
	}
	const quote = priceFor(seller, stock, toName);
	const price = Number.isFinite(ask) ? Math.floor(ask) : (quote?.ask ?? quote?.floor);
	if (price === undefined || price <= 0) {
		return { ok: false, verb: 'sell', reason: `${itemName} has no price — name an ask` };
	}
	const crowd = buyer.getComponent(Crowd);
	if (crowd && crowd.wants.length > 0) {
		const want = crowd.wants.some((w) => compactName(w) === compactName(itemName));
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
	const gift = takeOne(seller, stock);
	if (!tryInsert(buyer, gift)) {
		restoreOne(seller, gift, stock);
		transferCoins(seller, buyer, price);
		return { ok: false, verb: 'sell', reason: `${toName} has no room` };
	}
	const label = pascalCase(gift.name) || gift.name;
	const t = seller.world?.time ?? 0;
	seller.getComponent(HumanSprite)?.playClip('give', t);
	buyer.getComponent(HumanSprite)?.playClip('take', t);
	cueAt(seller.world, 'give', seller);
	if (price > 0) {
		host.pushEvent({
			kind: 'Bought',
			text: `${bodyName(buyer)} bought ${label} from ${bodyName(seller)} for ${price} gold`,
			tags: ['buy', label, bodyName(buyer), bodyName(seller)],
			major: true,
		});
	}
	noteWant(buyer, label);
	return { ok: true, verb: 'sell', reason: `sold ${label} to ${toName} for ${price} gold` };
}

export async function doGive(
	host:GameHost,
	ctx:HostCtx,
	npc:NPCInput,
	itemName:string,
	toName:string,
):Promise<ActionResult> {
	if (!toName) {
		return { ok: false, verb: 'give', reason: 'give to whom?' };
	}
	const target = findBody(ctx.world, toName);
	if (!target) {
		return { ok: false, verb: 'give', reason: `no such person ${toName}` };
	}
	const walk = await ensureRange(npc, ctx.actor, target, toName);
	if (!walk.ok) {
		return { ...walk, verb: 'give' };
	}
	return settleGive(ctx.actor, target, itemName, host);
}

export async function doBuy(
	host:GameHost,
	ctx:HostCtx,
	npc:NPCInput,
	itemName:string,
	fromName:string,
	offer:number,
):Promise<ActionResult> {
	if (!fromName) {
		return { ok: false, verb: 'buy', reason: 'buy from whom?' };
	}
	const seller = findBody(ctx.world, fromName);
	if (!seller) {
		return { ok: false, verb: 'buy', reason: `no such person ${fromName}` };
	}
	const walk = await ensureRange(npc, ctx.actor, seller, fromName);
	if (!walk.ok) {
		return { ...walk, verb: 'buy' };
	}
	return settleBuy(ctx.actor, seller, itemName, offer, host);
}

export async function doSell(
	host:GameHost,
	ctx:HostCtx,
	npc:NPCInput,
	itemName:string,
	toName:string,
	ask:number,
):Promise<ActionResult> {
	if (!toName) {
		return { ok: false, verb: 'sell', reason: 'sell to whom?' };
	}
	const buyer = findBody(ctx.world, toName);
	if (!buyer) {
		return { ok: false, verb: 'sell', reason: `no such person ${toName}` };
	}
	const walk = await ensureRange(npc, ctx.actor, buyer, toName);
	if (!walk.ok) {
		return { ...walk, verb: 'sell' };
	}
	return settleSell(ctx.actor, buyer, itemName, ask, host);
}

export async function doSteal(
	host:GameHost,
	ctx:HostCtx,
	npc:NPCInput,
	itemName:string,
	fromName:string,
):Promise<ActionResult> {
	if (!fromName) {
		return { ok: false, verb: 'steal', reason: 'steal from whom?' };
	}
	if (ctx.actor.getComponent(Crowd)?.kind === 'guard') {
		return { ok: false, verb: 'steal', reason: 'the watch does not steal' };
	}
	const victim = findBody(ctx.world, fromName);
	if (!victim) {
		return { ok: false, verb: 'steal', reason: `no such person ${fromName}` };
	}
	if (victim === ctx.actor) {
		return { ok: false, verb: 'steal', reason: 'cannot steal from yourself' };
	}
	const walk = await ensureRange(npc, ctx.actor, victim, fromName);
	if (!walk.ok) {
		return { ...walk, verb: 'steal' };
	}
	const stock = findSaleItem(victim, itemName) ?? findItem(victim, itemName);
	if (!stock) {
		return { ok: false, verb: 'steal', reason: `${fromName} has no ${itemName}` };
	}
	const gift = takeOne(victim, stock);
	if (!tryInsert(ctx.actor, gift)) {
		restoreOne(victim, gift, stock);
		return { ok: false, verb: 'steal', reason: 'no room' };
	}
	const label = pascalCase(gift.name) || gift.name;
	ctx.actor.getComponent(HumanSprite)?.playClip('take', ctx.world.time);
	reportTheft(host, ctx.actor, label, fromName, 'stole without paying');
	return { ok: true, verb: 'steal', reason: `stole ${label} from ${fromName}` };
}

export function reportTheft(
	host:GameHost,
	thief:GameObject,
	item:string,
	fromID:string,
	reason:string,
):void {
	if (!host.hooks.allowTheft) {
		return;
	}
	if (thief.getComponent(Crowd)?.kind === 'guard') {
		return;
	}
	let mark = thief.getComponent(Wanted);
	if (!mark) {
		mark = thief.addComponent(new Wanted());
	}
	mark.enabled = true;
	mark.reason = reason;
	if (fromID) {
		mark.fromID = fromID;
	}
	if (!mark.items.some((it) => compactName(it) === compactName(item))) {
		mark.items.push(item);
	}
	const who = bodyName(thief);
	host.pushEvent({
		kind: 'Theft',
		text: `${who} ${reason}: ${item}${fromID ? ` from ${fromID}` : ''}`,
		tags: ['steal', item, who, fromID],
		major: true,
	});
	const p = thief.transform.position;
	poseFact(host, { id: `Theft:${who}`, tags: ['theft', 'event'], x: p.x, z: p.z });
	host.world.setMessage(`Theft — ${who} took ${item}`);
}
