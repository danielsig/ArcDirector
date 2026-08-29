import type { AgentJSON } from 'arc-director';
import {
	BODY_SLOTS,
	BoxCollider,
	Bridge,
	Chest,
	ChunkBound,
	Door,
	HumanBody,
	Lock,
	Named,
	Sickbed,
	Vitals,
	Wallet,
	type BodySlot,
	type OccupiedRef,
	type SlotFill,
} from './components';
import type { GameObject } from './GameObject';
import { chunkKey, worldToChunk, type World } from './World';
import { Container, Harvest, Pickupable } from '../items/components';
import { isOccupied } from '../items/inventory';
import type { ItemInstance } from '../items/instance';
import { GLEN_FEE_DEF, GLEN_FEE_NAME } from '../items/defs';
import { captureItem, spawnWorldItem } from '../world/spawnItem';
import { PlayerInput } from '../actors/PlayerInput';
import type { ViewPose } from './viewPersist';

export const SAVE_VERSION = 1;
export const MAX_USER_SLOTS = 8;
const PREFIX = 'arc-director.save.v1.';

export type FloorItemSave = {
	item:ItemInstance;
	x:number;
	y:number;
	z:number;
	chunkID:string;
};

export type ActorSave = {
	id:string;
	x:number;
	y:number;
	z:number;
	yaw:number;
	hp:number;
	maxHP:number;
	mana:number;
	maxMana:number;
	pockets:ItemInstance[];
	pocketSize:number;
	slots:Record<BodySlot, ItemInstance | OccupiedRef | null>;
	wallet:number;
};

export type WorldSave = {
	doors:{ id:string; open:boolean; locked:boolean; keyID:string }[];
	chests:{ id:string; open:boolean; locked:boolean; keyID:string; contents:ItemInstance[] }[];
	sickbeds:{ id:string; tended:boolean }[];
	bridges:{ id:string; open:boolean }[];
	floorItems:FloorItemSave[];
	actors:ActorSave[];
};

export type GameSave = {
	version:number;
	sceneID:string;
	id:string;
	label:string;
	savedAt:string;
	pose:ViewPose;
	time:number;
	bargainDone:boolean;
	agents:Record<string, AgentJSON>;
	world:WorldSave;
};

export type SaveSlotInfo = {
	id:string;
	label:string;
	savedAt:string;
	auto:boolean;
};

function storageKey(sceneID:string, id:string):string {
	return `${PREFIX}${sceneID}.${id}`;
}

function migrateFeeDef(defID:string):string {
	if (defID === 'mooncap' || defID === 'dewcap' || defID === 'foxfire') {
		return GLEN_FEE_DEF;
	}
	return defID;
}

function migrateFeeName(name:string):string {
	if (name === 'Mooncap' || name === 'Dewcap' || name === 'Foxfire') {
		return GLEN_FEE_NAME;
	}
	return name;
}

function migrateFeeID(id:string):string {
	if (id === 'Mooncap' || id === 'Dewcap' || id === 'Foxfire' || id === 'mooncap' || id === 'dewcap' || id === 'foxfire') {
		return GLEN_FEE_NAME;
	}
	return id;
}

export function rewriteRetiredFeeNames(text:string):string {
	return text
		.replaceAll('Mooncap', GLEN_FEE_NAME)
		.replaceAll('Dewcap', GLEN_FEE_NAME)
		.replaceAll('Foxfire', GLEN_FEE_NAME)
		.replaceAll('mooncap', GLEN_FEE_DEF)
		.replaceAll('dewcap', GLEN_FEE_DEF)
		.replaceAll('foxfire', GLEN_FEE_DEF);
}

export function copyItem(item:ItemInstance):ItemInstance {
	const defID = migrateFeeDef(item.defID);
	const name = migrateFeeName(item.name);
	const raw = item.id || (item as Record<string, unknown>)['ID'];
	const id = migrateFeeID(typeof raw === 'string' ? raw : '');
	return {
		...item,
		id,
		defID,
		name,
		Equipable: item.Equipable
			? { slots: [...item.Equipable.slots], hands: item.Equipable.hands }
			: undefined,
		Container: item.Container
			? {
				size: item.Container.size,
				contents: item.Container.contents.map(copyItem),
			}
			: undefined,
		Weapon: item.Weapon ? { ...item.Weapon } : undefined,
		Armor: item.Armor ? { defense: item.Armor.defense, covers: [...item.Armor.covers] } : undefined,
		Consumable: item.Consumable ? { ...item.Consumable } : undefined,
		Key: item.Key ? { ...item.Key } : undefined,
		Torch: item.Torch ? { ...item.Torch } : undefined,
		Flame: item.Flame ? { ...item.Flame } : undefined,
		Ingredient: item.Ingredient ? { ...item.Ingredient } : undefined,
		Blade: item.Blade ? {} : undefined,
	};
}

function copyFill(fill:SlotFill):ItemInstance | OccupiedRef | null {
	if (!fill) {
		return null;
	}
	if (isOccupied(fill)) {
		return { occupiedBy: fill.occupiedBy };
	}
	return copyItem(fill);
}

function chunkIDOf(world:World, go:GameObject):string {
	const bound = go.getComponent(ChunkBound);
	if (bound?.chunkID) {
		return bound.chunkID;
	}
	const { cx, cz } = worldToChunk(go.transform.position.x, go.transform.position.z);
	return world.chunks.get(chunkKey(cx, cz))?.id ?? '';
}

function captureActor(go:GameObject):ActorSave | null {
	const body = go.getComponent(HumanBody);
	const vitals = go.getComponent(Vitals);
	if (!body || !vitals) {
		return null;
	}
	const pockets = body.pockets;
	const slots = {} as Record<BodySlot, ItemInstance | OccupiedRef | null>;
	for (const slot of BODY_SLOTS) {
		slots[slot] = copyFill(body.slots[slot]);
	}
	const look = go.getComponent(PlayerInput);
	return {
		id: go.id,
		x: go.transform.position.x,
		y: go.transform.position.y,
		z: go.transform.position.z,
		yaw: look?.lookYaw ?? go.transform.yaw,
		hp: vitals.hp,
		maxHP: vitals.maxHP,
		mana: vitals.mana,
		maxMana: vitals.maxMana,
		pockets: (pockets?.contents ?? []).map(copyItem),
		pocketSize: pockets?.size ?? 2,
		slots,
		wallet: go.getComponent(Wallet)?.coins ?? 0,
	};
}

export function mergeWorldSave(prev:WorldSave | undefined, next:WorldSave, world:World):WorldSave {
	if (!prev) {
		return next;
	}
	const named = new Set<string>();
	for (const go of world.objects) {
		const id = go.getComponent(Named)?.id;
		if (id) {
			named.add(id);
		}
	}
	const loaded = new Set<string>();
	for (const chunk of world.chunks.values()) {
		loaded.add(chunk.id);
	}
	const keep = <T extends { id:string }>(oldRows:T[], fresh:T[]):T[] => [
		...oldRows.filter((row) => !named.has(row.id)),
		...fresh,
	];
	return {
		doors: keep(prev.doors, next.doors),
		chests: keep(prev.chests, next.chests),
		sickbeds: keep(prev.sickbeds, next.sickbeds),
		bridges: keep(prev.bridges, next.bridges),
		floorItems: [
			...prev.floorItems.filter((row) => row.chunkID && !loaded.has(row.chunkID)),
			...next.floorItems,
		],
		actors: next.actors,
	};
}

export function captureWorld(world:World):WorldSave {
	const doors:WorldSave['doors'] = [];
	world.forEachComponent(Door, (door, go) => {
		const lock = go.getComponent(Lock);
		doors.push({
			id: go.getComponent(Named)?.id ?? go.id,
			open: door.open,
			locked: !!lock?.locked,
			keyID: lock?.keyID ?? '',
		});
	});
	const chests:WorldSave['chests'] = [];
	world.forEachComponent(Chest, (chest, go) => {
		const lock = go.getComponent(Lock);
		const bag = go.getComponent(Container);
		chests.push({
			id: go.getComponent(Named)?.id ?? go.id,
			open: chest.open,
			locked: !!lock?.locked,
			keyID: lock?.keyID ?? '',
			contents: (bag?.contents ?? []).map(copyItem),
		});
	});
	const sickbeds:WorldSave['sickbeds'] = [];
	world.forEachComponent(Sickbed, (bed, go) => {
		sickbeds.push({
			id: go.getComponent(Named)?.id ?? go.id,
			tended: bed.tended,
		});
	});
	const bridges:WorldSave['bridges'] = [];
	world.forEachComponent(Bridge, (span, go) => {
		bridges.push({
			id: go.getComponent(Named)?.id ?? go.id,
			open: span.open,
		});
	});
	const floorItems:FloorItemSave[] = [];
	for (const go of world.objects) {
		if (!go.getComponent(Pickupable)) {
			continue;
		}
		floorItems.push({
			item: copyItem(captureItem(go)),
			x: go.transform.position.x,
			y: go.transform.position.y,
			z: go.transform.position.z,
			chunkID: chunkIDOf(world, go),
		});
	}
	const actors:ActorSave[] = [];
	for (const go of world.objects) {
		if (go.id !== 'Player' && go.name !== 'NPC') {
			continue;
		}
		const row = captureActor(go);
		if (row) {
			actors.push(row);
		}
	}
	return { doors, chests, sickbeds, bridges, floorItems, actors };
}

function applyNamed(
	world:World,
	id:string,
	fn:(go:GameObject)=>void,
):void {
	const go = world.findNamed(id) ?? world.findByID(id);
	if (go) {
		fn(go);
	}
}

function applyBridgeOpen(go:GameObject, open:boolean):void {
	const span = go.getComponent(Bridge);
	if (!span) {
		return;
	}
	span.open = open;
	const lock = go.getComponent(Lock);
	if (lock) {
		lock.locked = !open;
	}
	const col = go.getComponent(BoxCollider);
	if (col) {
		col.solid = !open;
		col.isTrigger = open;
	}
}

function applyActor(world:World, row:ActorSave):void {
	const go = world.findByID(row.id);
	if (!go) {
		return;
	}
	go.transform.position.x = row.x;
	go.transform.position.y = row.y;
	go.transform.position.z = row.z;
	go.transform.yaw = row.yaw;
	const look = go.getComponent(PlayerInput);
	if (look) {
		look.lookYaw = row.yaw;
		look.moveX = 0;
		look.moveZ = 0;
	}
	const vitals = go.getComponent(Vitals);
	if (vitals) {
		vitals.hp = row.hp;
		vitals.maxHP = row.maxHP;
		vitals.mana = row.mana;
		vitals.maxMana = row.maxMana;
	}
	const body = go.getComponent(HumanBody);
	if (!body) {
		return;
	}
	if (body.pockets) {
		body.pockets.size = row.pocketSize;
		body.pockets.contents = row.pockets.map(copyItem);
	}
	for (const slot of BODY_SLOTS) {
		body.slots[slot] = copyFill(row.slots[slot]);
	}
	const purse = go.getComponent(Wallet);
	if (purse && row.wallet !== undefined) {
		purse.coins = row.wallet;
	}
}

function markHarvest(go:GameObject, defID:string):void {
	if (defID !== 'bitterroot' && migrateFeeDef(defID) !== GLEN_FEE_DEF) {
		return;
	}
	if (go.getComponent(Harvest)) {
		return;
	}
	const crop = go.addComponent(new Harvest());
	crop.harvester = migrateFeeDef(defID) === GLEN_FEE_DEF ? 'Forager' : 'Herbalist';
}

export function applyFloorItems(world:World, items:FloorItemSave[], chunkID?:string):void {
	const doomed:GameObject[] = [];
	for (const go of world.objects) {
		if (!go.getComponent(Pickupable)) {
			continue;
		}
		if (chunkID && chunkIDOf(world, go) !== chunkID) {
			continue;
		}
		doomed.push(go);
	}
	for (const go of doomed) {
		world.remove(go);
	}
	for (const row of items) {
		if (chunkID && row.chunkID !== chunkID) {
			continue;
		}
		const go = spawnWorldItem(world, copyItem(row.item), row.x, row.y, row.z, row.chunkID || undefined);
		markHarvest(go, row.item.defID);
	}
}

export function applyNamedWorld(world:World, snap:WorldSave):void {
	for (const row of snap.doors) {
		applyNamed(world, row.id, (go) => {
			const door = go.getComponent(Door);
			if (door) {
				door.open = row.open;
				door.syncCollision();
			}
			const lock = go.getComponent(Lock);
			if (lock) {
				lock.locked = row.locked;
				if (row.keyID) {
					lock.keyID = row.keyID;
				}
			}
		});
	}
	for (const row of snap.chests) {
		applyNamed(world, row.id, (go) => {
			const chest = go.getComponent(Chest);
			if (chest) {
				chest.open = row.open;
			}
			const lock = go.getComponent(Lock);
			if (lock) {
				lock.locked = row.locked;
				if (row.keyID) {
					lock.keyID = row.keyID;
				}
			}
			const bag = go.getComponent(Container);
			if (bag) {
				bag.contents = row.contents.map(copyItem);
			}
		});
	}
	for (const row of snap.sickbeds) {
		applyNamed(world, row.id, (go) => {
			const bed = go.getComponent(Sickbed);
			if (bed) {
				bed.tended = row.tended;
			}
		});
	}
	for (const row of snap.bridges) {
		applyNamed(world, row.id, (go) => applyBridgeOpen(go, row.open));
	}
}

export function applyActors(world:World, snap:WorldSave):void {
	for (const row of snap.actors) {
		applyActor(world, row);
	}
}

export function applyWorld(world:World, snap:WorldSave):void {
	applyNamedWorld(world, snap);
	applyFloorItems(world, snap.floorItems);
	applyActors(world, snap);
}

/** After a chunk streams in: restore Named flags and that chunk's floor items. */
export function overlayStreamed(world:World, snap:WorldSave, chunkID:string):void {
	applyNamedWorld(world, snap);
	applyFloorItems(world, snap.floorItems, chunkID);
}

function lowerLeadingAcronymKeys(value:unknown):unknown {
	if (Array.isArray(value)) {
		return value.map(lowerLeadingAcronymKeys);
	}
	if (!value || typeof value !== 'object') {
		return value;
	}
	const src = value as Record<string, unknown>;
	const out:Record<string, unknown> = {};
	for (const [k, v] of Object.entries(src)) {
		if (k === 'ID' && typeof src.id === 'string') {
			continue;
		}
		if (k === 'HP' && typeof src.hp === 'number') {
			continue;
		}
		const key = k === 'ID' ? 'id' : k === 'HP' ? 'hp' : k;
		out[key] = lowerLeadingAcronymKeys(v);
	}
	return out;
}

function parseSave(raw:string):GameSave | null {
	try {
		const data = lowerLeadingAcronymKeys(JSON.parse(raw)) as GameSave;
		if (data.version !== SAVE_VERSION || typeof data.sceneID !== 'string' || typeof data.id !== 'string') {
			return null;
		}
		if (!data.pose || !data.world || !data.agents) {
			return null;
		}
		data.agents = JSON.parse(rewriteRetiredFeeNames(JSON.stringify(data.agents))) as GameSave['agents'];
		data.world = JSON.parse(rewriteRetiredFeeNames(JSON.stringify(data.world))) as GameSave['world'];
		return data;
	}
	catch {
		return null;
	}
}

function jsonStringField(raw:string, key:string):string | undefined {
	const m = raw.match(new RegExp(`"${key}":"((?:\\\\.|[^"\\\\])*)"`));
	return m?.[1]?.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

export function listSaves(sceneID:string):SaveSlotInfo[] {
	const out:SaveSlotInfo[] = [];
	const prefix = `${PREFIX}${sceneID}.`;
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key || !key.startsWith(prefix)) {
				continue;
			}
			const id = key.slice(prefix.length);
			if (!id) {
				continue;
			}
			const raw = localStorage.getItem(key);
			if (!raw) {
				continue;
			}
			const listed = jsonStringField(raw, 'sceneID');
			if (listed && listed !== sceneID) {
				continue;
			}
			out.push({
				id,
				label: jsonStringField(raw, 'label') ?? id,
				savedAt: jsonStringField(raw, 'savedAt') ?? '',
				auto: id === 'auto',
			});
		}
	}
	catch {
		return [];
	}
	out.sort((a, b) => {
		if (a.auto !== b.auto) {
			return a.auto ? -1 : 1;
		}
		return a.savedAt < b.savedAt ? 1 : -1;
	});
	return out;
}

export function loadSave(sceneID:string, id:string):GameSave | null {
	try {
		const raw = localStorage.getItem(storageKey(sceneID, id));
		if (!raw) {
			return null;
		}
		const save = parseSave(raw);
		if (!save || save.sceneID !== sceneID) {
			return null;
		}
		return save;
	}
	catch {
		return null;
	}
}

export function writeSave(save:GameSave):boolean {
	try {
		localStorage.setItem(storageKey(save.sceneID, save.id), JSON.stringify(save));
		return true;
	}
	catch {
		return false;
	}
}

export function deleteSave(sceneID:string, id:string):void {
	try {
		localStorage.removeItem(storageKey(sceneID, id));
	}
	catch {
		// private mode
	}
}

export function userSlotCount(sceneID:string):number {
	return listSaves(sceneID).filter((s) => !s.auto).length;
}

export function newUserSlotID():string {
	return `u_${Date.now().toString(36)}`;
}
