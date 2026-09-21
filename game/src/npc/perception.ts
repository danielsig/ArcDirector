import {
	pascalCase,
	type ActionResult,
	type Inventory,
	type SeenObject,
	type Sight,
} from 'arc-director';
import {
	BODY_SLOTS,
	BrewHearth,
	Chest,
	Door,
	HumanBody,
	Lock,
	MillLever,
	Named,
	Sickbed,
	Torch,
	Bridge,
	Wallet,
	Merchant,
	MarketNPC,
	Companion,
	Wanted,
	Interior,
} from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';
import { MeshRenderer } from '../engine/MeshRenderer';
import { Container, Item, Pickupable } from '../items/components';
import {
	distXZ,
	findCarried,
	isOccupied,
	itemMatchesName,
	listCarried,
	slotItem,
	compactName,
} from '../items/inventory';
import type { ItemInstance } from '../items/instance';
import { coinsOf, goodsAsk } from '../items/wallet';
import { findChestHolding } from '../items/pickup';
import { yawToForward } from '../engine/math';
import { whereabouts } from '../world/interior';
import { talkCanSee } from './talkAttend';
import { bodyName } from './names';
import type { HostCtx } from './types';
import type { GameHost } from './adapter';
import { seenFightName } from './fight';

const SIGHT = 24;

export function itemLabel(item:ItemInstance):string {
	const id = pascalCase(item.name) || pascalCase(item.defID);
	return item.count > 1 ? `${id} x${item.count}` : id;
}

export function carriedLabels(actor:GameObject):string[] {
	const seen = new Set<string>();
	const out:string[] = [];
	for (const it of listCarried(actor)) {
		const label = pascalCase(it.name) || it.name;
		const key = compactName(label);
		if (!key || seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push(label);
	}
	return out;
}

export function tagsOf(go:GameObject):string[] {
	const tags:string[] = [];
	if (go.getComponent(Interior)) {
		tags.push('building', 'house', 'landmark');
	}
	if (go.getComponent(Door)) {
		tags.push('door', 'landmark');
	}
	if (go.getComponent(Bridge)) {
		tags.push('bridge', 'landmark');
	}
	if (go.getComponent(MillLever)) {
		tags.push('sluice', 'landmark');
	}
	if (go.getComponent(Chest)) {
		tags.push('chest', 'furniture');
	}
	if (go.getComponent(BrewHearth) || go.getComponent(Sickbed)) {
		tags.push('furniture', 'landmark');
	}
	if (go.getComponent(Pickupable) || go.getComponent(Item)) {
		tags.push('item');
	}
	if (go.getComponent(HumanBody)) {
		tags.push('agent', 'person');
	}
	if (go.getComponent(Torch) && !go.getComponent(Item)) {
		tags.push('torch');
	}
	const mesh = go.getComponent(MeshRenderer)?.meshID ?? '';
	if (mesh === 'tree_oak' || mesh === 'tree_pine') {
		tags.push('tree');
	}
	if (mesh === 'boulder') {
		tags.push('boulder', 'rock');
	}
	if (mesh === 'waterfall') {
		tags.push('waterfall', 'river', 'water');
	}
	return tags;
}

function poseXZ(go:GameObject):{ at:number[]; facing:number[] } {
	const p = go.transform.position;
	const f = yawToForward(go.transform.yaw);
	return { at: [p.x, p.z], facing: [f.x, f.z] };
}

function seenOf(go:GameObject, observer?:GameObject, host?:GameHost):SeenObject {
	const tags = tagsOf(go);
	const agent = tags.includes('agent') || tags.includes('person');
	const interactable = agent
		|| !!go.getComponent(Door)
		|| !!go.getComponent(Chest)
		|| !!go.getComponent(Pickupable)
		|| !!go.getComponent(BrewHearth)
		|| !!go.getComponent(Sickbed)
		|| go.id === 'MillLever'
		|| go.id === 'MillBridge'
		|| !!go.getComponent(MarketNPC)
		|| !!go.getComponent(Merchant)
		|| !!go.getComponent(Interior);
	const pose = poseXZ(go);
	const id = host && observer ? seenFightName(host, observer, go) : go.getComponent(Named)?.id || go.id;
	const row:SeenObject = {
		id,
		at: pose.at,
		facing: pose.facing,
		tags,
	};
	if (interactable) {
		row.interactable = true;
		row.interesting = 1;
	}
	if (
		go.getComponent(Door)
		|| go.getComponent(Chest)
		|| go.getComponent(Interior)
		|| go.getComponent(Bridge)
		|| go.getComponent(MillLever)
	) {
		row.movable = false;
	}
	else if (!!go.getComponent(Pickupable)) {
		row.movable = true;
	}
	return row;
}

export function lookWorld(actor:GameObject, ambient:string, host?:GameHost):Sight {
	const pose = poseXZ(actor);
	const self = { id: actor.getComponent(Named)?.id ?? actor.id, at: pose.at, facing: pose.facing };
	const place = [whereabouts(actor), ambient].filter(Boolean).join(' ');
	const world = actor.world;
	const objects:SeenObject[] = [];
	if (!world) {
		return { self, ambient: place || undefined, objects };
	}
	const ax = actor.transform.position.x;
	const az = actor.transform.position.z;
	for (const go of world.objects) {
		if (go === actor || go.id === 'MainCamera') {
			continue;
		}
		const named = go.getComponent(Named);
		const torch = go.getComponent(Torch) && !go.getComponent(Item);
		if (!named && !torch) {
			continue;
		}
		const gp = go.transform.position;
		if (Math.hypot(gp.x - ax, gp.z - az) > SIGHT) {
			continue;
		}
		const row = seenOf(go, actor, host);
		objects.push(row);
		const chest = go.getComponent(Chest);
		const bag = go.getComponent(Container);
		const lock = go.getComponent(Lock);
		if (chest?.open && bag && !lock?.locked) {
			for (const it of bag.contents) {
				objects.push({
					id: pascalCase(it.name) || pascalCase(it.defID) || it.id,
					at: row.at,
					tags: ['item'],
					interesting: 1,
					interactable: true,
					movable: true,
					attachedTo: row.id,
					attachMode: 'in',
				});
			}
		}
	}
	return { self, ambient: place || undefined, objects };
}

export function inventoryOf(actor:GameObject):Inventory {
	const worn:Record<string, string> = {};
	const body = actor.getComponent(HumanBody);
	if (body) {
		for (const slot of BODY_SLOTS) {
			const fill = body.slots[slot];
			if (!fill) {
				continue;
			}
			worn[slot] = isOccupied(fill) ? `occupied by ${fill.occupiedBy}` : itemLabel(fill);
		}
	}
	const purse = actor.getComponent(Wallet);
	const pocketItems = body?.pockets?.contents.map(itemLabel) ?? [];
	const packItem = body ? slotItem(body, 'back') : null;
	const packItems = packItem?.Container?.contents.map(itemLabel) ?? [];
	return {
		worn: Object.keys(worn).length > 0 ? worn : undefined,
		purse: purse ? purse.coins : undefined,
		pockets: pocketItems.length > 0 ? pocketItems : undefined,
		pack: packItem && packItems.length > 0
			? { name: itemLabel(packItem), items: packItems }
			: undefined,
	};
}

export function hostCanSee(world:World, aID:string, bID:string):boolean {
	if (talkCanSee(world, aID, bID)) {
		return true;
	}
	const held = findChestHolding(world, bID);
	if (!held) {
		return false;
	}
	const lock = held.chest.getComponent(Lock);
	const chest = held.chest.getComponent(Chest);
	if (lock?.locked || (chest && !chest.open)) {
		return false;
	}
	return talkCanSee(world, aID, bodyName(held.chest));
}

export function followedCarry(ctx:HostCtx):string {
	const bond = ctx.actor.getComponent(Companion);
	if (!bond || bond.hold) {
		return '';
	}
	const followed = ctx.world.findByID(bond.targetID);
	if (!followed) {
		return '';
	}
	const items = carriedLabels(followed);
	return `${bond.targetID} is carrying: ${items.length > 0 ? items.join(', ') : 'nothing you can see'}.`;
}

export function doExamine(ctx:HostCtx, name:string):ActionResult {
	const held = findCarried(ctx.actor, (it) => itemMatchesName(it, name));
	if (held) {
		return { ok: true, verb: 'examine', reason: JSON.stringify(examineItem(held)) };
	}
	const go = ctx.world.findNamed(name);
	if (!go) {
		return { ok: false, verb: 'examine', reason: `unknown name ${name}` };
	}
	if (!hostCanSee(ctx.world, bodyName(ctx.actor), bodyName(go)) || distXZ(ctx.actor, go) > SIGHT) {
		return { ok: false, verb: 'examine', reason: `${name} is not in sight` };
	}
	return { ok: true, verb: 'examine', reason: JSON.stringify(examineWorld(go)) };
}

function examineItem(item:ItemInstance):Record<string, unknown> {
	return {
		id: pascalCase(item.name) || item.id,
		name: item.name,
		defID: item.defID,
		count: item.count,
		keyID: item.Key?.keyID,
		equipable: item.Equipable ? { slots: item.Equipable.slots, hands: item.Equipable.hands } : undefined,
		container: item.Container
			? { size: item.Container.size, contents: item.Container.contents.map(itemLabel) }
			: undefined,
		ingredient: item.Ingredient
			? {
				brewer: item.Ingredient.brewer,
				fee: item.Ingredient.fee,
				brew: item.Ingredient.brew,
				yield: item.Ingredient.yield,
			}
			: undefined,
		ask: goodsAsk(item),
	};
}

function examineWorld(go:GameObject):Record<string, unknown> {
	const named = go.getComponent(Named)?.id ?? go.id;
	const lock = go.getComponent(Lock);
	const door = go.getComponent(Door);
	const item = go.getComponent(Item);
	const row:Record<string, unknown> = { name: named };
	if (door) {
		row.kind = 'door';
		row.open = door.open;
	}
	if (go.getComponent(MillLever)) {
		row.kind = 'sluice';
		row.note = 'not loot';
	}
	if (go.getComponent(Bridge)) {
		row.kind = 'bridge';
		row.open = !!go.getComponent(Bridge)?.open;
	}
	if (lock) {
		row.locked = lock.locked;
		row.needs = lock.keyID ? `${lock.keyID} key` : undefined;
	}
	if (item) {
		row.kind = 'item';
		row.defID = item.defID;
		row.count = item.count;
	}
	if (go.getComponent(Chest)) {
		row.kind = 'chest';
		row.open = !!go.getComponent(Chest)?.open;
		const bag = go.getComponent(Container);
		row.contents = bag && go.getComponent(Chest)?.open && !lock?.locked
			? bag.contents.map((it) => pascalCase(it.name) || it.name)
			: lock?.locked ? 'locked' : 'closed';
	}
	if (go.getComponent(MarketNPC) || go.getComponent(HumanBody)) {
		row.purse = coinsOf(go);
		row.carrying = carriedLabels(go);
		const npc = go.getComponent(MarketNPC);
		if (npc) {
			row.role = npc.kind;
			row.wants = npc.wants;
		}
		const shop = go.getComponent(Merchant);
		if (shop) {
			row.sells = shop.specialty;
			row.ask = shop.ask;
			row.lowest = shop.floor;
		}
		const mark = go.getComponent(Wanted);
		if (mark?.enabled) {
			row.wanted = mark.reason || 'theft';
			row.stolen = mark.items;
		}
	}
	return row;
}
