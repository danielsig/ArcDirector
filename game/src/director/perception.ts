import { Time, yawToForward, type GameObject } from '@arc-director/kindling';
import {
	pascalCase,
	type ArcResult,
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
	Named,
	Sickbed,
	Vitals,
	Torch,
	Bridge,
	BridgeLever,
	Flammable,
	Inscription,
	Wallet,
	Merchant,
	MarketNPC,
	Companion,
	Wanted,
	alarmActive,
	Interior,
} from '../engine/components';
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
import { coinsOf } from '../items/wallet';
import { findChestHolding, keyNameFor } from '../items/pickup';
import { whereabouts } from '../world/interior';
import { talkCanSee } from './talkAttend';
import { findObject, idOf, isLiving } from './names';
import type { CharacterCtx } from './types';
import type { GameHost } from './adapter';
import { fightExprTags, fightProximityNote, fightRole } from './fight';

const SIGHT = 24;

export function itemLabel(item:ItemInstance):string {
	const id = pascalCase(item.name) || pascalCase(item.defID);
	return item.count > 1 ? `${id} x${item.count}` : id;
}

export function carriedLabels(character:GameObject):string[] {
	const seen = new Set<string>();
	const out:string[] = [];
	for (const it of listCarried(character)) {
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

/** Each object's tags for the frame they were worked out in: the director asks for every object, for every character, every frame. */
const frameTags = new WeakMap<GameObject, { time:number; tags:string[] }>();

/** What kind of thing `go` is, as tags (`person`, `item`, `door`, `tree`, …). A fresh array the caller may change. */
export function tagsOf(go:GameObject):string[] {
	const time = Time.time;
	let known = frameTags.get(go);
	if (!known || known.time !== time) {
		known = { time, tags: tagsNow(go) };
		frameTags.set(go, known);
	}
	return [...known.tags];
}

function tagsNow(go:GameObject):string[] {
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
	if (go.getComponent(BridgeLever)) {
		tags.push('sluice', 'landmark');
	}
	if (go.getComponent(Chest)) {
		tags.push('chest', 'furniture');
	}
	if (go.getComponent(Inscription)) {
		tags.push('inscription', 'landmark');
	}
	if (go.getComponent(Flammable)) {
		tags.push('flammable', 'obstacle');
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
	if (go.getComponent(Wanted)?.enabled) {
		tags.push('thief');
	}
	if (alarmActive(go, Time.time)) {
		tags.push('alarm');
	}
	if (go.getComponent(Torch) && !go.getComponent(Item)) {
		tags.push('torch');
	}
	const mesh = go.getComponent(MeshRenderer)?.meshID ?? '';
	if (mesh === 'tree_oak' || mesh === 'tree_pine') {
		tags.push('tree');
	}
	if (mesh.startsWith('pillar')) {
		tags.push('pillar');
	}
	if (mesh === 'boulder') {
		tags.push('boulder', 'rock');
	}
	if (mesh === 'waterfall') {
		tags.push('waterfall', 'river', 'water');
	}
	return tags;
}

function poseXZ(go:GameObject):{ point:number[]; facing:number[] } {
	const p = go.transform.position;
	const f = yawToForward(go.transform.yaw);
	return { point: [p.x, p.z], facing: [f.x, f.z] };
}

function seenOf(go:GameObject, observer?:GameObject, host?:GameHost):SeenObject {
	const tags = host && observer ? [...tagsOf(go), ...fightExprTags(host, observer, go)] : tagsOf(go);
	const agent = tags.includes('agent') || tags.includes('person');
	const interactable = agent
		|| !!go.getComponent(Door)
		|| !!go.getComponent(Chest)
		|| !!go.getComponent(Pickupable)
		|| !!go.getComponent(BrewHearth)
		|| !!go.getComponent(Sickbed)
		|| !!go.getComponent(Inscription)
		|| !!go.getComponent(Flammable)
		|| go.id === 'BridgeLever'
		|| go.id === 'Bridge'
		|| !!go.getComponent(MarketNPC)
		|| !!go.getComponent(Merchant)
		|| !!go.getComponent(Interior);
	const pose = poseXZ(go);
	const row:SeenObject = {
		id: go.getComponent(Named)?.id || go.id,
		point: pose.point,
		facing: pose.facing,
		tags,
	};
	if (interactable) {
		row.interactable = true;
		row.interesting = 1;
	}
	if (host && observer && agent) {
		const vitals = go.getComponent(Vitals);
		if (vitals && fightRole(host, go)) {
			row.hp = vitals.hp;
			row.maxHP = vitals.maxHP;
		}
		const note = fightProximityNote(host, observer, go);
		if (note) {
			row.note = note;
		}
	}
	const carved = go.getComponent(Inscription);
	if (carved?.text && !row.note) {
		row.note = `carved: "${carved.text}"`;
		row.always = true;
	}
	const fuel = go.getComponent(Flammable);
	if (fuel && !row.note) {
		row.note = fuel.burning ? 'burning away' : 'it blocks the way; a flame burns it';
	}
	const span = go.getComponent(Bridge);
	if (span && !row.note) {
		row.note = `it is ${span.moving ? 'being ' : ''}${span.open ? 'lowered' : 'raised'}`;
		row.always = true;
	}
	if (
		go.getComponent(Door)
		|| go.getComponent(Chest)
		|| go.getComponent(Interior)
		|| span
		|| go.getComponent(BridgeLever)
		|| carved
		|| fuel
	) {
		row.movable = false;
	}
	else if (go.getComponent(Pickupable)) {
		row.movable = true;
	}
	return row;
}

export function lookWorld(character:GameObject, ambient:string, host?:GameHost):Sight {
	const pose = poseXZ(character);
	const self = { id: character.getComponent(Named)?.id ?? character.id, point: pose.point, facing: pose.facing };
	const place = [whereabouts(character), ambient].filter(Boolean).join(' ');
	const world = character.world;
	const objects:SeenObject[] = [];
	if (!world) {
		return { self, ambient: place || undefined, objects };
	}
	const ax = character.transform.position.x;
	const az = character.transform.position.z;
	// Whoever stands on a span reads as on it: `Forager and Angler on Bridge, it is lowered`.
	const onSpan = new Map<GameObject, string>();
	world.forEachComponent(Bridge, (span, go) => {
		for (const occupant of span.occupants()) {
			onSpan.set(occupant, idOf(go));
		}
	});
	for (const go of world.objects) {
		if (go === character || go.id === 'MainCamera') {
			continue;
		}
		if (go.getComponent(HumanBody) && !isLiving(go)) {
			continue;
		}
		const named = go.getComponent(Named);
		const torch = go.getComponent(Torch) && !go.getComponent(Item);
		if (!named && !torch) {
			continue;
		}
		const gp = go.transform.position;
		if (!go.getComponent(Bridge) && Math.hypot(gp.x - ax, gp.z - az) > SIGHT) {
			continue;
		}
		const row = seenOf(go, character, host);
		if (row.tags.includes('tree') || row.tags.includes('boulder') || row.tags.includes('pillar')) {
			continue;
		}
		const span = onSpan.get(go);
		if (span) {
			row.attachedTo = span;
			row.attachMode = 'on';
		}
		objects.push(row);
		const chest = go.getComponent(Chest);
		const bag = go.getComponent(Container);
		const lock = go.getComponent(Lock);
		if (chest?.open && bag && !lock?.locked) {
			for (const it of bag.contents) {
				objects.push({
					id: pascalCase(it.name) || pascalCase(it.defID) || it.id,
					point: row.point,
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

export function inventoryOf(character:GameObject):Inventory {
	const worn:Record<string, string> = {};
	const human = character.getComponent(HumanBody);
	if (human) {
		for (const slot of BODY_SLOTS) {
			const fill = human.slots[slot];
			if (!fill) {
				continue;
			}
			worn[slot] = isOccupied(fill) ? `occupied by ${fill.occupiedBy}` : itemLabel(fill);
		}
	}
	const purse = character.getComponent(Wallet);
	const pocketItems = human?.pockets?.contents.map(itemLabel) ?? [];
	const packItem = human ? slotItem(human, 'back') : null;
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
	if (findObject(world, bID)?.getComponent(Bridge)) {
		return true;
	}
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
	return talkCanSee(world, aID, idOf(held.chest));
}

export function followedCarry(ctx:CharacterCtx):string {
	const bond = ctx.character.getComponent(Companion);
	if (!bond) {
		return '';
	}
	const followed = ctx.world.findByID(bond.targetID);
	if (!followed) {
		return '';
	}
	const items = carriedLabels(followed);
	return `${bond.targetID} is carrying: ${items.length > 0 ? items.join(', ') : 'nothing you can see'}.`;
}

/** What `character` learns examining `name`: an item it carries, or a thing in sight. */
export function doExamine(world:World, character:GameObject, name:string):ArcResult {
	const held = findCarried(character, (it) => itemMatchesName(it, name));
	if (held) {
		return { ok: true, verb: 'examine', reason: examineItem(world, held) };
	}
	const go = world.findNamed(name);
	if (!go) {
		return { ok: false, verb: 'examine', reason: `unknown name ${name}` };
	}
	if (!go.getComponent(Bridge) && (!hostCanSee(world, idOf(character), idOf(go)) || distXZ(character, go) > SIGHT)) {
		return { ok: false, verb: 'examine', reason: `${name} is not in sight` };
	}
	return { ok: true, verb: 'examine', reason: examineWorld(go) };
}

/** `A, B and C`, or `nothing`. */
function listed(names:string[]):string {
	return names.length === 0 ? 'nothing' : names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** The named doors and chests a key with `keyID` opens. */
function locksFor(world:World, keyID:string):string[] {
	return world.objects
		.filter((go) => go.getComponent(Lock)?.keyID === keyID && go.getComponent(Named))
		.map((go) => go.getComponent(Named)?.id ?? go.id);
}

/** What `examine` tells about an item you carry, in sentences. */
function examineItem(world:World, item:ItemInstance):string {
	const id = pascalCase(item.name) || pascalCase(item.defID);
	return [
		item.count > 1 ? `You carry ${item.count} ${id}.` : `You carry ${id}.`,
		item.Key && `It opens ${listed(locksFor(world, item.Key.keyID))}.`,
		item.Equipable && (item.Equipable.hands === 2 ? 'You can equip it, with both hands.' : 'You can equip it.'),
		item.Container && `It holds ${item.Container.size}: ${listed(item.Container.contents.map(itemLabel))}.`,
		item.Ingredient && `${item.Ingredient.brewer} brews ${item.Ingredient.yield} ${item.Ingredient.brew} from it, for ${item.Ingredient.fee}.`,
	].filter(Boolean).join(' ');
}

function saleLine(name:string, shop:Merchant):string | false {
	return shop.goods.length > 0 ? `${name} trades in ${listed(shop.goods)}.` : false;
}

/** What `examine` tells about something in sight, in sentences. */
function examineWorld(go:GameObject):string {
	const name = go.getComponent(Named)?.id ?? go.id;
	const lock = go.getComponent(Lock);
	const locked = lock?.locked ? ` and locked${lock.keyID ? `; it needs ${keyNameFor(go.world, lock)}` : ''}` : '';
	const door = go.getComponent(Door);
	const bridge = go.getComponent(Bridge);
	const chest = go.getComponent(Chest);
	const item = go.getComponent(Item);
	const lines:(string | false | undefined)[] = [];
	if (door) {
		lines.push(`${name} is a door, ${door.open ? 'open' : 'shut'}${locked}.`);
	}
	const carved = go.getComponent(Inscription);
	if (carved) {
		lines.push(`Carved on ${name}: "${carved.text}"`);
	}
	if (go.getComponent(Flammable)) {
		lines.push(`${name} blocks the way. Use a flame on it, such as a WoodenTorch, and it burns away.`);
	}
	if (go.getComponent(BridgeLever)) {
		lines.push(`${name} is the fixed lever that raises and lowers the bridge. Working it again does the other.`);
	}
	if (bridge) {
		lines.push(bridge.open
			? `${name} is a bridge, lowered: you can cross. Working the sluice raises it.`
			: `${name} is a bridge, raised: no one can cross until it is lowered.`);
	}
	if (item) {
		lines.push(item.count > 1 ? `${item.count} ${name} lie here.` : `${name} lies here.`);
	}
	if (chest) {
		const bag = go.getComponent(Container);
		const inside = chest.open && !lock?.locked && bag ? ` It holds ${listed(bag.contents.map((it) => pascalCase(it.name) || it.name))}.` : '';
		lines.push(`${name} is a chest, ${chest.open ? 'open' : 'shut'}${locked}.${inside}`);
	}
	if (go.getComponent(MarketNPC) || go.getComponent(HumanBody)) {
		const npc = go.getComponent(MarketNPC);
		const shop = go.getComponent(Merchant);
		const mark = go.getComponent(Wanted);
		lines.push(
			npc && `${name} is a ${npc.kind}${npc.wants.length > 0 ? ` who wants ${listed(npc.wants)}` : ''}.`,
			shop && saleLine(name, shop),
			`${name} carries ${listed(carriedLabels(go))} and ${coinsOf(go)} gold.`,
			mark?.enabled && `${name} is wanted for ${mark.reason || 'theft'}${mark.items.length > 0 ? `: ${listed(mark.items)}` : ''}.`,
		);
	}
	const text = lines.filter(Boolean).join(' ');
	return text || `${name} is nothing out of the ordinary.`;
}
