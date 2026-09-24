import { CharacterMotor } from '../actors/CharacterMotor';
import { NPCInput } from '../actors/NPCInput';
import { PlayerInput } from '../actors/PlayerInput';
import { Camera as RenderCamera } from '@arc-director/kindling';
import {
	BoxCollider,
	Bridge,
	Camera,
	Chest,
	ChunkBound,
	Door,
	HumanBody,
	HumanSprite,
	HurtFlash,
	Light,
	Lock,
	MillLever,
	BrewHearth,
	Sickbed,
	Named,
	Interior,
	RigidBody,
	StreamingAnchor,
	Torch,
	Vitals,
	Wallet,
	Merchant,
	MarketNPC,
	MarketGate,
	Companion,
	type MarketNPCKind,
} from '../engine/components';
import { MeshRenderer } from '../engine/MeshRenderer';
import { HeldTorchLight } from '../engine/systems';
import { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';
import { Container, Harvest } from '../items/components';
import { getDef } from '../items/defs';
import { instantiateDef } from '../items/instance';
import { spawnDefAt } from '../items/pickup';
import { animIDFromMeshID } from '../render/humanAnims';
import { characterHeight, resolvePlayerKind } from '../render/artCache';
import { prefs } from '../prefs';
import { CELL_SIZE, CHUNK_SIZE, TILE_HEIGHT } from './constants';
import { innerWallAABB } from './interior';
import type { Chunk, ChunkEntity } from './Chunk';
import type { DecodedChunk } from './decodeGlyphChunk';

function wallOffset(chunk:Chunk, localX:number, localZ:number):{ x:number; z:number; yaw:number } {
	const dirs = [
		{ dx: 1, dz: 0, yaw: Math.PI / 2 },
		{ dx: -1, dz: 0, yaw: -Math.PI / 2 },
		{ dx: 0, dz: 1, yaw: 0 },
		{ dx: 0, dz: -1, yaw: Math.PI },
	];
	for (const d of dirs) {
		const n = chunk.tile(localX + d.dx, localZ + d.dz);
		if (n?.blocked) {
			return { x: d.dx * 0.38, z: d.dz * 0.38, yaw: d.yaw };
		}
	}
	return { x: 0, z: 0, yaw: 0 };
}

function bindChunk(go:GameObject, chunkID:string):void {
	const bound = go.addComponent(new ChunkBound());
	bound.chunkID = chunkID;
}

function spawnTorch(world:World, chunk:Chunk, ent:ChunkEntity):void {
	const center = chunk.worldCellCenter(ent.localX, ent.localZ);
	const off = wallOffset(chunk, ent.localX, ent.localZ);
	const tile = chunk.tile(ent.localX, ent.localZ);
	const go = new GameObject(ent.name ?? `torch_${chunk.id}_${ent.localX}_${ent.localZ}`, 'Torch');
	go.transform.position.x = center.x + off.x;
	go.transform.position.y = (tile?.height ?? 0) * TILE_HEIGHT + 1.15;
	go.transform.position.z = center.z + off.z;
	go.transform.yaw = off.yaw;
	go.addComponent(new MeshRenderer()).meshID = 'torch';
	const torch = go.addComponent(new Torch());
	torch.lit = true;
	const light = go.addComponent(new Light());
	light.color = 0xff9a4a;
	light.intensity = torch.baseIntensity;
	light.decay = torch.baseDecay * Torch.decayScale;
	light.range = 11;
	light.castShadow = true;
	light.offsetY = 0.35;
	light.offsetZ = 0.18;
	light.intensityFlicker = 0.75;
	light.intensityFlickerSpeed = 0.5;
	light.positionalFlicker = 0.012;
	light.positionalFlickerSpeed = 0.012;
	if (ent.name) {
		const named = go.addComponent(new Named());
		named.id = ent.name;
	}
	bindChunk(go, chunk.id);
	world.add(go);
}

function spawnChest(world:World, chunk:Chunk, ent:ChunkEntity):void {
	const center = chunk.worldCellCenter(ent.localX, ent.localZ);
	const tile = chunk.tile(ent.localX, ent.localZ);
	const go = new GameObject(ent.name ?? `chest_${chunk.id}_${ent.localX}_${ent.localZ}`, 'Chest');
	go.transform.position.x = center.x;
	go.transform.position.y = (tile?.height ?? 0) * TILE_HEIGHT;
	go.transform.position.z = center.z;
	go.transform.yaw = Math.PI;
	go.addComponent(new MeshRenderer()).meshID = 'chest';
	go.addComponent(new Chest());
	const bag = go.addComponent(new Container());
	bag.size = 8;
	const lock = go.addComponent(new Lock());
	lock.keyID = 'iron';
	lock.locked = true;
	const doorKey = instantiateDef(getDef('brass_key'));
	doorKey.name = 'BrassKey';
	doorKey.id = 'BrassKey';
	bag.contents.push(doorKey);
	const col = go.addComponent(new BoxCollider());
	col.size = { x: 0.7, y: 0.5, z: 0.48 };
	if (ent.name) {
		const named = go.addComponent(new Named());
		named.id = ent.name;
	}
	bindChunk(go, chunk.id);
	world.add(go);
}

function spawnDoor(world:World, chunk:Chunk, ent:ChunkEntity):void {
	const center = chunk.worldCellCenter(ent.localX, ent.localZ);
	const tile = chunk.tile(ent.localX, ent.localZ);
	const axis = ent.axis ?? 'x';
	const go = new GameObject(ent.name ?? `door_${chunk.id}_${ent.localX}_${ent.localZ}`, 'Door');
	go.transform.position.x = center.x;
	go.transform.position.y = (tile?.height ?? 0) * TILE_HEIGHT;
	go.transform.position.z = center.z;
	const door = go.addComponent(new Door());
	door.axis = axis;
	door.open = false;
	if (axis === 'x') {
		door.closedYaw = 0;
		door.openYaw = -Math.PI / 2;
		go.transform.yaw = 0;
		const col = go.addComponent(new BoxCollider());
		col.size = { x: 0.16, y: 2.12, z: 0.9 };
	}
	else {
		door.closedYaw = 0;
		door.openYaw = -Math.PI / 2;
		go.transform.yaw = Math.PI / 2;
		const col = go.addComponent(new BoxCollider());
		col.size = { x: 0.9, y: 2.12, z: 0.16 };
	}
	const lock = go.addComponent(new Lock());
	lock.keyID = ent.keyID ?? 'brass';
	lock.locked = ent.locked ?? true;
	go.addComponent(new MeshRenderer()).meshID = 'door';
	if (ent.exit) {
		go.addComponent(new MarketGate());
	}
	if (ent.name) {
		const named = go.addComponent(new Named());
		named.id = ent.name;
	}
	bindChunk(go, chunk.id);
	world.add(go);
	if (ent.open) {
		door.open = true;
	}
	door.syncCollision();
}

const ITEM_DEFS_SPAWN = new Set([
	'brass_key',
	'iron_key',
	'health_potion',
	'magic_potion',
	'gold_coin',
	'bitterroot',
	'fire_mushroom',
	'mill_crank',
	'silver_trout',
	'bomb',
	'traveler_pack',
	'wooden_torch',
	'iron_sword',
	'wooden_shield',
	'leather_glove',
	'loaf',
	'scarf',
	'bowl',
	'kitchen_knife',
	'apple',
	'candle',
]);

export function spawnChunkEntities(world:World, decoded:DecodedChunk):void {
	const chunk = decoded.chunk;
	const bridgeSpans:ChunkEntity[] = [];
	for (const ent of chunk.entities) {
		if (ent.def === 'wall_torch') {
			spawnTorch(world, chunk, ent);
		}
		else if (ent.def === 'chest') {
			spawnChest(world, chunk, ent);
		}
		else if (ent.def === 'door') {
			spawnDoor(world, chunk, ent);
		}
		else if (ent.def === 'stall') {
			spawnStall(world, chunk, ent);
		}
		else if (ent.def === 'tree') {
			spawnProp(world, chunk, ent, (ent.localX + ent.localZ) % 2 === 0 ? 'tree_oak' : 'tree_pine', 0.35);
		}
		else if (ent.def === 'boulder') {
			spawnProp(world, chunk, ent, 'boulder', 0.4);
		}
		else if (ent.def === 'waterfall') {
			spawnProp(world, chunk, ent, 'waterfall', 0.2, Math.PI / 2);
		}
		else if (ent.def === 'mill_lever') {
			spawnLever(world, chunk, ent);
		}
		else if (ent.def === 'brew_hearth') {
			spawnHearth(world, chunk, ent);
		}
		else if (ent.def === 'sickbed') {
			spawnCot(world, chunk, ent);
		}
		else if (ent.def === 'bridge_span') {
			bridgeSpans.push(ent);
		}
		else if (ITEM_DEFS_SPAWN.has(ent.def)) {
			const center = chunk.worldCellCenter(ent.localX, ent.localZ);
			const tile = chunk.tile(ent.localX, ent.localZ);
			const y = (tile?.height ?? 0) * TILE_HEIGHT + 0.12;
			const count = ent.def === 'health_potion' || ent.def === 'bomb' ? 2 : 1;
			const go = spawnDefAt(world, ent.def, center.x, y, center.z, chunk.id, count, ent.name);
			if (ent.def === 'bitterroot' || ent.def === 'fire_mushroom') {
				const crop = go.addComponent(new Harvest());
				crop.harvester = ent.def === 'fire_mushroom' ? 'Forager' : 'Herbalist';
			}
		}
	}
	if (bridgeSpans.length > 0) {
		spawnBridge(world, chunk, bridgeSpans);
	}
	spawnCottage(world, chunk);
}

function spawnCottage(world:World, chunk:Chunk):void {
	if (!chunk.entities.some((e) => e.name === 'CottageDoor')) {
		return;
	}
	let minX = CHUNK_SIZE;
	let maxX = -1;
	let minZ = CHUNK_SIZE;
	let maxZ = -1;
	for (let lz = 0; lz < CHUNK_SIZE; lz++) {
		for (let lx = 0; lx < CHUNK_SIZE; lx++) {
			if (chunk.tile(lx, lz)?.def !== 'wood_wall') {
				continue;
			}
			if (lx < minX) {
				minX = lx;
			}
			if (lx > maxX) {
				maxX = lx;
			}
			if (lz < minZ) {
				minZ = lz;
			}
			if (lz > maxZ) {
				maxZ = lz;
			}
		}
	}
	if (maxX < minX) {
		return;
	}
	const go = new GameObject('Cottage', 'Cottage');
	go.transform.position.x = chunk.worldOriginX() + (minX + maxX + 1) * 0.5 * CELL_SIZE;
	go.transform.position.y = 0;
	go.transform.position.z = chunk.worldOriginZ() + (minZ + maxZ + 1) * 0.5 * CELL_SIZE;
	go.addComponent(new MeshRenderer()).meshID = 'cottage';
	const col = go.addComponent(new BoxCollider());
	col.size = { x: 0.4, y: 1, z: 0.4 };
	col.solid = false;
	col.isTrigger = true;
	const named = go.addComponent(new Named());
	named.id = 'Cottage';
	const room = go.addComponent(new Interior());
	const inner = innerWallAABB(chunk, minX, maxX, minZ, maxZ);
	room.minX = inner.minX;
	room.maxX = inner.maxX;
	room.minZ = inner.minZ;
	room.maxZ = inner.maxZ;
	bindChunk(go, chunk.id);
	world.add(go);
	const door = world.findNamed('CottageDoor');
	const leaf = door?.getComponent(Door);
	if (leaf) {
		leaf.buildingID = 'Cottage';
	}
}

function spawnProp(
	world:World,
	chunk:Chunk,
	ent:ChunkEntity,
	meshID:string,
	radius:number,
	yaw?:number,
):void {
	const center = chunk.worldCellCenter(ent.localX, ent.localZ);
	const tile = chunk.tile(ent.localX, ent.localZ);
	const go = new GameObject(ent.name ?? `${meshID}_${chunk.id}_${ent.localX}_${ent.localZ}`, 'Prop');
	go.transform.position.x = center.x;
	go.transform.position.y = (tile?.height ?? 0) * TILE_HEIGHT;
	go.transform.position.z = center.z;
	if (yaw !== undefined) {
		go.transform.yaw = yaw;
	}
	else if (meshID === 'tree_oak' || meshID === 'tree_pine' || meshID === 'boulder') {
		const n = Math.sin(center.x * 127.1 + center.z * 311.7) * 43758.5453;
		go.transform.yaw = (n - Math.floor(n)) * Math.PI * 2;
	}
	if (meshID === 'waterfall') {
		go.transform.position.x -= 0.46;
		go.transform.position.z += 0.48;
		go.transform.position.y = 0;
	}
	go.addComponent(new MeshRenderer()).meshID = meshID;
	const col = go.addComponent(new BoxCollider());
	col.size = { x: radius, y: 1, z: radius };
	if (meshID === 'waterfall') {
		col.solid = false;
		col.isTrigger = true;
	}
	const namedID = ent.name
		?? (meshID === 'tree_oak' || meshID === 'tree_pine' ? go.id : '');
	if (namedID) {
		const named = go.addComponent(new Named());
		named.id = namedID;
	}
	bindChunk(go, chunk.id);
	world.add(go);
}

function spawnLever(world:World, chunk:Chunk, ent:ChunkEntity):void {
	const center = chunk.worldCellCenter(ent.localX, ent.localZ);
	const tile = chunk.tile(ent.localX, ent.localZ);
	const go = new GameObject(ent.name ?? 'MillLever', 'MillLever');
	go.transform.position.x = center.x;
	go.transform.position.y = (tile?.height ?? 0) * TILE_HEIGHT;
	go.transform.position.z = center.z;
	go.addComponent(new MeshRenderer()).meshID = 'mill_lever';
	go.addComponent(new MillLever());
	const col = go.addComponent(new BoxCollider());
	col.size = { x: 0.3, y: 1, z: 0.3 };
	col.solid = false;
	col.isTrigger = true;
	const named = go.addComponent(new Named());
	named.id = ent.name ?? 'MillLever';
	bindChunk(go, chunk.id);
	world.add(go);
}

function spawnHearth(world:World, chunk:Chunk, ent:ChunkEntity):void {
	const center = chunk.worldCellCenter(ent.localX, ent.localZ);
	const tile = chunk.tile(ent.localX, ent.localZ);
	const go = new GameObject(ent.name ?? 'BrewHearth', 'BrewHearth');
	go.transform.position.x = center.x;
	go.transform.position.y = (tile?.height ?? 0) * TILE_HEIGHT;
	go.transform.position.z = center.z;
	go.addComponent(new MeshRenderer()).meshID = 'hearth';
	go.addComponent(new BrewHearth());
	const col = go.addComponent(new BoxCollider());
	col.size = { x: 0.7, y: 0.6, z: 0.7 };
	col.solid = false;
	col.isTrigger = true;
	const named = go.addComponent(new Named());
	named.id = ent.name ?? 'BrewHearth';
	bindChunk(go, chunk.id);
	world.add(go);
}

function spawnCot(world:World, chunk:Chunk, ent:ChunkEntity):void {
	const center = chunk.worldCellCenter(ent.localX, ent.localZ);
	const tile = chunk.tile(ent.localX, ent.localZ);
	const id = ent.name ?? 'Sickbed';
	const go = new GameObject(id, 'Sickbed');
	go.transform.position.x = center.x;
	go.transform.position.y = (tile?.height ?? 0) * TILE_HEIGHT;
	go.transform.position.z = center.z;
	go.addComponent(new MeshRenderer()).meshID = 'cot';
	const bed = go.addComponent(new Sickbed());
	bed.caretaker = id === 'LinaCot' ? 'Captain' : 'Herbalist';
	const col = go.addComponent(new BoxCollider());
	col.size = { x: 1.2, y: 0.4, z: 0.7 };
	col.solid = false;
	col.isTrigger = true;
	const named = go.addComponent(new Named());
	named.id = id;
	bindChunk(go, chunk.id);
	world.add(go);
}

function spawnBridge(world:World, chunk:Chunk, spans:ChunkEntity[]):void {
	const cells:{ x:number; z:number }[] = [];
	let sx = 0;
	let sz = 0;
	let minX = Infinity;
	let maxX = -Infinity;
	let minZ = Infinity;
	let maxZ = -Infinity;
	for (const ent of spans) {
		const c = chunk.worldCellCenter(ent.localX, ent.localZ);
		cells.push(c);
		sx += c.x;
		sz += c.z;
		minX = Math.min(minX, c.x);
		maxX = Math.max(maxX, c.x);
		minZ = Math.min(minZ, c.z);
		maxZ = Math.max(maxZ, c.z);
	}
	const go = new GameObject(spans[0].name ?? 'MillBridge', 'Bridge');
	go.transform.position.x = sx / spans.length;
	go.transform.position.y = 0.02;
	go.transform.position.z = sz / spans.length;
	go.transform.yaw = 0;
	go.addComponent(new MeshRenderer()).meshID = 'bridge';
	const span = go.addComponent(new Bridge());
	span.open = false;
	span.cells = cells;
	const col = go.addComponent(new BoxCollider());
	col.size = {
		x: Math.max(1.4, maxX - minX + CELL_SIZE),
		y: 1.2,
		z: Math.max(1.4, maxZ - minZ + CELL_SIZE),
	};
	col.solid = true;
	const named = go.addComponent(new Named());
	named.id = spans[0].name ?? 'MillBridge';
	bindChunk(go, chunk.id);
	world.add(go);
}

const STALL_MESH:Record<string, string> = {
	BakerStall: 'stall',
	WeaverStall: 'stall_pink',
	PotterStall: 'stall_yellow',
	CutlerStall: 'stall_blue',
	SpiceStall: 'stall_green',
	CandleStall: 'stall_yellow',
	FruitStall: 'stall_green',
	RibbonStall: 'stall_pink',
};

function stallMeshFor(name:string | undefined):string {
	return (name && STALL_MESH[name]) || 'stall';
}

function spawnStall(world:World, chunk:Chunk, ent:ChunkEntity):void {
	const center = chunk.worldCellCenter(ent.localX, ent.localZ);
	const tile = chunk.tile(ent.localX, ent.localZ);
	const go = new GameObject(ent.name ?? `stall_${chunk.id}_${ent.localX}_${ent.localZ}`, 'Stall');
	go.transform.position.x = center.x;
	go.transform.position.y = (tile?.height ?? 0) * TILE_HEIGHT;
	go.transform.position.z = center.z;
	go.transform.yaw = ent.localZ < 8 ? Math.PI : 0;
	go.addComponent(new MeshRenderer()).meshID = stallMeshFor(ent.name);
	const col = go.addComponent(new BoxCollider());
	col.size = { x: 0.55, y: 0.9, z: 0.4 };
	if (ent.name) {
		const named = go.addComponent(new Named());
		named.id = ent.name;
	}
	bindChunk(go, chunk.id);
	world.add(go);
}

export type NPCSpawnOpts = {
	id:string;
	meshID:string;
	localX:number;
	localZ:number;
	destLocalX?:number;
	destLocalZ?:number;
	yaw?:number;
	pack?:boolean;
	packKey?:boolean;
	packLoot?:{ defID:string; name:string; count?:number }[];
	wallet?:number;
	hp?:number;
	merchant?:{ specialty:string; ask:number; floor:number };
	marketNPC?:{ kind:MarketNPCKind; wants:string[]; leaveGate?:string };
	companion?:boolean;
};

export function spawnNPC(world:World, chunk:Chunk, opts:NPCSpawnOpts):GameObject {
	const pos = chunk.worldCellCenter(opts.localX, opts.localZ);
	const tile = chunk.tile(opts.localX, opts.localZ);
	const go = new GameObject(opts.id, 'NPC');
	go.transform.position.x = pos.x;
	go.transform.position.y = (tile?.height ?? 0) * TILE_HEIGHT;
	go.transform.position.z = pos.z;
	if (opts.yaw !== undefined) {
		go.transform.yaw = opts.yaw;
	}
	if (opts.meshID === 'human') {
		throw new Error(`NPC ${opts.id} meshID 'human' is the player; use human_<kind>`);
	}
	go.addComponent(new MeshRenderer()).meshID = opts.meshID;
	const sprite = go.addComponent(new HumanSprite());
	sprite.kind = animIDFromMeshID(opts.meshID);
	sprite.height = characterHeight(sprite.kind);
	const flash = go.addComponent(new HurtFlash());
	flash.enabled = false;
	go.addComponent(new NPCInput());
	const motor = go.addComponent(new CharacterMotor());
	if (opts.destLocalX !== undefined && opts.destLocalZ !== undefined) {
		const dest = chunk.worldCellCenter(opts.destLocalX, opts.destLocalZ);
		motor.destinationPoint = { x: dest.x, z: dest.z };
	}
	const rb = go.addComponent(new RigidBody());
	rb.kinematic = true;
	const col = go.addComponent(new BoxCollider());
	col.size = { x: 0.45, y: 1.1, z: 0.45 };
	col.pad = 0.36;
	const body = go.addComponent(new HumanBody());
	const pockets = go.addComponent(new Container());
	pockets.size = 2;
	body.pockets = pockets;
	if (opts.pack || opts.packKey || opts.packLoot) {
		const pack = instantiateDef(getDef('traveler_pack'));
		if (opts.packKey) {
			const key = instantiateDef(getDef('brass_key'));
			key.name = 'BrassKey';
			pack.Container?.contents.push(key);
		}
		for (const loot of opts.packLoot ?? []) {
			const inst = instantiateDef(getDef(loot.defID), loot.count ?? 1);
			inst.name = loot.name;
			inst.id = loot.name;
			pack.Container?.contents.push(inst);
		}
		body.slots.back = pack;
	}
	const vitals = go.addComponent(new Vitals());
	const hp = opts.hp && opts.hp > 0 ? Math.round(opts.hp) : 5;
	vitals.hp = hp;
	vitals.maxHP = hp;
	const named = go.addComponent(new Named());
	named.id = opts.id;
	const wallet = go.addComponent(new Wallet());
	wallet.coins = opts.wallet ?? 0;
	if (opts.merchant) {
		const shop = go.addComponent(new Merchant());
		shop.specialty = opts.merchant.specialty;
		shop.ask = opts.merchant.ask;
		shop.floor = opts.merchant.floor;
	}
	if (opts.marketNPC) {
		const npc = go.addComponent(new MarketNPC());
		npc.kind = opts.marketNPC.kind;
		npc.wants = [...opts.marketNPC.wants];
		npc.leaveGate = opts.marketNPC.leaveGate ?? '';
	}
	if (opts.companion) {
		go.addComponent(new Companion());
	}
	world.add(go);
	return go;
}

export function spawnPlayer(
	world:World,
	start:{ x:number; z:number } | null,
	chunk:Chunk,
):void {
	if (world.findByID('Player')) {
		return;
	}
	const pos = start ?? chunk.worldCellCenter(2, 2);
	const tile = chunk.tileAtWorld(pos.x, pos.z);
	const go = new GameObject('Player', 'Player');
	go.transform.position.x = pos.x;
	go.transform.position.y = (tile?.height ?? 0) * TILE_HEIGHT;
	go.transform.position.z = pos.z;
	go.addComponent(new MeshRenderer()).meshID = 'human';
	const sprite = go.addComponent(new HumanSprite());
	const kind = resolvePlayerKind(prefs().playerKind);
	sprite.kind = kind;
	sprite.height = characterHeight(kind);
	const flash = go.addComponent(new HurtFlash());
	flash.enabled = false;
	go.addComponent(new PlayerInput());
	go.addComponent(new CharacterMotor());
	const rb = go.addComponent(new RigidBody());
	rb.kinematic = true;
	const col = go.addComponent(new BoxCollider());
	col.size = { x: 0.45, y: 1.1, z: 0.45 };
	col.pad = 0.36;
	const body = go.addComponent(new HumanBody());
	const pockets = go.addComponent(new Container());
	pockets.size = 2;
	body.pockets = pockets;
	const vitals = go.addComponent(new Vitals());
	vitals.hp = 5;
	vitals.maxHP = 5;
	go.addComponent(new StreamingAnchor());
	const named = go.addComponent(new Named());
	named.id = 'Player';
	go.addComponent(new Wallet());
	const light = go.addComponent(new Light());
	light.enabled = false;
	light.castShadow = true;
	light.range = 9;
	light.intensity = 32;
	go.addComponent(new HeldTorchLight());
	world.add(go);
}

export function spawnCamera(world:World):void {
	if (world.findByID('MainCamera')) {
		return;
	}
	const player = world.findByID('Player');
	const go = new GameObject('MainCamera', 'Camera');
	const cam = go.addComponent(new Camera());
	cam.targetID = 'Player';
	if (player) {
		cam.yaw = player.transform.yaw;
		cam.orbitYaw = player.getComponent(PlayerInput)?.lookYaw ?? player.transform.yaw;
	}
	go.addComponent(new RenderCamera());
	world.add(go);
	cam.lateUpdate(1);
}
