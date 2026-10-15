import { Regen } from '../engine/Regen';
import { CharacterAnimation } from '../characters/CharacterAnimation';
import { CharacterPose } from '../characters/CharacterPose';
import { HeldProps } from '../characters/HeldProps';
import { Raven } from '../characters/Raven';
import { CharacterMotor } from '../characters/CharacterMotor';
import { NPCInput } from '../characters/NPCInput';
import { PlayerInput } from '../characters/PlayerInput';
import { PlayerPilot } from '../characters/PlayerPilot';
import { Fire } from '../engine/Fire';
import { TeamRing, type TeamColors } from '../engine/TeamRing';
import { Animator, ChunkBound, Camera as RenderCamera, StreamingAnchor, Speaker, voiceFor, type SpeechVoice, hash, GameObject } from '@arc-director/kindling';
import {
	BoxCollider,
	Bridge,
	BridgeLever,
	Camera,
	Chest,
	Door,
	HumanBody,
	Appearance,
	HurtFlash,
	Light,
	Lock,
	BrewHearth,
	Sickbed,
	Flammable,
	Inscription,
	Weakness,
	Named,
	Interior,
	RigidBody,
	Torch,
	Vitals,
	Wallet,
	Merchant,
	MarketNPC,
	MarketGate,
	Companion,
	HearOnly,
	type MarketNPCKind,
} from '../engine/components';
import { MeshRenderer } from '../engine/MeshRenderer';
import { HeldTorchLight } from '../engine/systems';
import type { World } from '../engine/World';
import { Container, Harvest } from '../items/components';
import { getDef } from '../items/defs';
import { equipItem } from '../items/equip';
import { instantiateDef, type ItemInstance } from '../items/instance';
import { spawnDefAt } from '../items/pickup';
import { characterModel, resolvePlayerKind } from '../render/characterModels';
import { STALL_COUNTER } from '../render/meshRegistry';
import { prefs } from '../prefs';
import { CELL_SIZE, CHUNK_SIZE, TILE_HEIGHT } from './constants';
import { innerWallAABB } from './interior';
import { stallYaw } from './dressingPlan';
import type { Chunk, ChunkEntity } from './Chunk';
import type { LootSpec } from './decodeGlyphChunk';

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
	go.addComponent(ChunkBound, { chunkID });
}

/** A lit torch: on the wall beside its cell (`wall_torch`), or on a pole in the middle of it (`standing_torch`). */
function spawnTorch(world:World, chunk:Chunk, ent:ChunkEntity):void {
	const standing = ent.def === 'standing_torch';
	const center = chunk.worldCellCenter(ent.localX, ent.localZ);
	const off = standing ? { x: 0, z: 0, yaw: 0 } : wallOffset(chunk, ent.localX, ent.localZ);
	const tile = chunk.tile(ent.localX, ent.localZ);
	const go = new GameObject(ent.name ?? `torch_${chunk.id}_${ent.localX}_${ent.localZ}`, 'Torch');
	go.transform.position.x = center.x + off.x;
	go.transform.position.y = (tile?.height ?? 0) * TILE_HEIGHT + (standing ? 0 : 1.15);
	go.transform.position.z = center.z + off.z;
	go.transform.yaw = off.yaw;
	go.addComponent(MeshRenderer, { meshID: standing ? 'torch_stand' : 'torch' });
	if (standing) {
		go.addComponent(BoxCollider, { size: { x: 0.4, y: 1, z: 0.4 }, shape: 'cylinder' });
	}
	const torch = go.addComponent(Torch, { lit: true });
	go.addComponent(Light, {
		color: 0xff9a4a,
		intensity: torch.baseIntensity,
		decay: torch.baseDecay * Torch.decayScale,
		range: 11,
		castShadow: true,
		offsetY: standing ? 1.62 : 0.35,
		offsetZ: standing ? 0 : 0.18,
		intensityFlicker: 0.75,
		intensityFlickerSpeed: 0.5,
		positionalFlicker: 0.012,
		positionalFlickerSpeed: 0.012,
	});
	if (ent.name) {
		go.addComponent(Named, { id: ent.name });
	}
	bindChunk(go, chunk.id);
	world.add(go);
}

/** The fire in a brazier (its bowl and coals are chunk dressing): flames only, which no one sees as a thing. */
function spawnFire(world:World, chunk:Chunk, ent:ChunkEntity):void {
	const center = chunk.worldCellCenter(ent.localX, ent.localZ);
	const tile = chunk.tile(ent.localX, ent.localZ);
	const go = new GameObject(`fire_${chunk.id}_${ent.localX}_${ent.localZ}`, 'Fire');
	go.transform.position.x = center.x;
	go.transform.position.y = (tile?.height ?? 0) * TILE_HEIGHT;
	go.transform.position.z = center.z;
	go.addComponent(Fire);
	bindChunk(go, chunk.id);
	world.add(go);
}

/** A fresh item from a loot line, called by its given name. */
function makeLoot(loot:LootSpec):ItemInstance {
	const inst = instantiateDef(getDef(loot.defID), loot.count ?? 1);
	inst.name = loot.name;
	inst.id = loot.name;
	return inst;
}

function spawnChest(world:World, chunk:Chunk, ent:ChunkEntity):void {
	const center = chunk.worldCellCenter(ent.localX, ent.localZ);
	const tile = chunk.tile(ent.localX, ent.localZ);
	const go = new GameObject(ent.name ?? `chest_${chunk.id}_${ent.localX}_${ent.localZ}`, 'Chest');
	go.transform.position.x = center.x;
	go.transform.position.y = (tile?.height ?? 0) * TILE_HEIGHT;
	go.transform.position.z = center.z;
	go.transform.yaw = ent.yaw ?? Math.PI;
	go.addComponent(MeshRenderer, { meshID: 'chest' });
	go.addComponent(Chest);
	const bag = go.addComponent(Container, { size: 8 });
	go.addComponent(Lock, { keyID: ent.keyID ?? 'iron', locked: ent.locked ?? true });
	bag.contents.push(...(ent.contents ?? []).map(makeLoot));
	go.addComponent(BoxCollider, { size: { x: 0.7, y: 0.5, z: 0.48 } });
	if (ent.name) {
		go.addComponent(Named, { id: ent.name });
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
	const door = go.addComponent(Door, { axis, open: false });
	if (axis === 'x') {
		door.closedYaw = 0;
		door.openYaw = -Math.PI / 2;
		go.transform.yaw = 0;
		go.addComponent(BoxCollider, { size: { x: 0.16, y: 2.12, z: 0.9 } });
	}
	else {
		door.closedYaw = 0;
		door.openYaw = -Math.PI / 2;
		go.transform.yaw = Math.PI / 2;
		go.addComponent(BoxCollider, { size: { x: 0.9, y: 2.12, z: 0.16 } });
	}
	go.addComponent(Lock, { keyID: ent.keyID ?? 'brass', locked: ent.locked ?? true });
	go.addComponent(MeshRenderer, { meshID: 'door' });
	if (ent.exit) {
		go.addComponent(MarketGate);
	}
	if (ent.name) {
		go.addComponent(Named, { id: ent.name });
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
	'moon_mushroom',
	'bridge_crank',
	'silver_trout',
	'bomb',
	'traveler_pack',
	'wooden_torch',
	'iron_sword',
	'wooden_shield',
	'leather_glove',
	'loaf',
	'bun',
	'pie',
	'cake',
	'scarf',
	'hood',
	'ribbon',
	'bowl',
	'jug',
	'kitchen_knife',
	'cleaver',
	'shears',
	'hook',
	'apple',
	'candle',
]);

export function spawnChunkEntities(world:World, chunk:Chunk):void {
	const bridgeSpans:ChunkEntity[] = [];
	for (const ent of chunk.entities) {
		if (ent.def === 'wall_torch' || ent.def === 'standing_torch') {
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
		else if (ent.def === 'pillar' || ent.def === 'pillar_broken') {
			spawnProp(world, chunk, ent, ent.def, 0.6);
		}
		else if (ent.def === 'brazier') {
			spawnFire(world, chunk, ent);
		}
		else if (ent.def === 'cobweb') {
			// Wall to wall across its cell, until a flame burns it away.
			spawnProp(world, chunk, ent, 'cobweb', 1, ent.yaw ?? 0).addComponent(Flammable);
		}
		else if (ent.def === 'inscription') {
			spawnProp(world, chunk, ent, 'stone_tablet', 0.5, ent.yaw ?? wallOffset(chunk, ent.localX, ent.localZ).yaw + Math.PI)
				.addComponent(Inscription, { text: ent.text ?? '' });
		}
		else if (ent.def === 'boulder') {
			spawnProp(world, chunk, ent, 'boulder', 0.4);
		}
		else if (ent.def === 'waterfall') {
			spawnProp(world, chunk, ent, 'waterfall', 0.2, Math.PI / 2);
		}
		else if (ent.def === 'bridge_lever') {
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
			if (ent.def === 'bitterroot' || ent.def === 'fire_mushroom' || ent.def === 'moon_mushroom') {
				go.addComponent(Harvest, { harvester: ent.def === 'bitterroot' ? 'Herbalist' : 'Forager' });
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
	chunk.forEachTile((tile, lx, lz) => {
		if (tile.def !== 'wood_wall') {
			return;
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
	});
	if (maxX < minX) {
		return;
	}
	const go = new GameObject('Cottage', 'Cottage');
	go.transform.position.x = chunk.worldOriginX() + (minX + maxX + 1) * 0.5 * CELL_SIZE;
	go.transform.position.y = 0;
	go.transform.position.z = chunk.worldOriginZ() + (minZ + maxZ + 1) * 0.5 * CELL_SIZE;
	go.addComponent(MeshRenderer, { meshID: 'cottage' });
	go.addComponent(BoxCollider, { size: { x: 0.4, y: 1, z: 0.4 }, solid: false, isTrigger: true });
	go.addComponent(Named, { id: 'Cottage' });
	go.addComponent(Interior, innerWallAABB(chunk, minX, maxX, minZ, maxZ));
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
):GameObject {
	const center = chunk.worldCellCenter(ent.localX, ent.localZ);
	const tile = chunk.tile(ent.localX, ent.localZ);
	const go = new GameObject(ent.name ?? `${meshID}_${chunk.id}_${ent.localX}_${ent.localZ}`, 'Prop');
	go.transform.position.x = center.x;
	go.transform.position.y = (tile?.height ?? 0) * TILE_HEIGHT;
	go.transform.position.z = center.z;
	if (yaw !== undefined) {
		go.transform.yaw = yaw;
	}
	else if (meshID === 'tree_oak' || meshID === 'tree_pine' || meshID === 'boulder' || meshID.startsWith('pillar')) {
		go.transform.yaw = hash(center.x, center.z) * Math.PI * 2;
	}
	if (meshID === 'waterfall') {
		go.transform.position.x -= 0.46;
		go.transform.position.z += 0.48;
		go.transform.position.y = 0;
	}
	go.addComponent(MeshRenderer, { meshID });
	const col = go.addComponent(BoxCollider, { size: { x: radius, y: 1, z: radius } });
	if (meshID === 'waterfall') {
		col.solid = false;
		col.isTrigger = true;
	}
	const namedID = ent.name
		?? (meshID === 'tree_oak' || meshID === 'tree_pine' ? go.id : '');
	if (namedID) {
		go.addComponent(Named, { id: namedID });
	}
	bindChunk(go, chunk.id);
	world.add(go);
	return go;
}

function spawnLever(world:World, chunk:Chunk, ent:ChunkEntity):void {
	const center = chunk.worldCellCenter(ent.localX, ent.localZ);
	const tile = chunk.tile(ent.localX, ent.localZ);
	const go = new GameObject(ent.name ?? 'BridgeLever', 'BridgeLever');
	go.transform.position.x = center.x;
	go.transform.position.y = (tile?.height ?? 0) * TILE_HEIGHT;
	go.transform.position.z = center.z;
	go.addComponent(MeshRenderer, { meshID: 'bridge_lever' });
	go.addComponent(BridgeLever);
	go.addComponent(BoxCollider, { size: { x: 0.3, y: 1, z: 0.3 }, solid: false, isTrigger: true });
	go.addComponent(Named, { id: ent.name ?? 'BridgeLever' });
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
	go.addComponent(MeshRenderer, { meshID: 'hearth' });
	go.addComponent(BrewHearth);
	go.addComponent(BoxCollider, { size: { x: 0.7, y: 0.6, z: 0.7 }, solid: false, isTrigger: true });
	go.addComponent(Named, { id: ent.name ?? 'BrewHearth' });
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
	go.addComponent(MeshRenderer, { meshID: 'cot' });
	go.addComponent(Sickbed, { caretaker: id === 'LinaCot' ? 'Captain' : 'Herbalist' });
	go.addComponent(BoxCollider, { size: { x: 1.2, y: 0.4, z: 0.7 }, solid: false, isTrigger: true });
	go.addComponent(Named, { id });
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
	const go = new GameObject(spans[0].name ?? 'Bridge', 'Bridge');
	go.transform.position.x = sx / spans.length;
	go.transform.position.y = 0.02;
	go.transform.position.z = sz / spans.length;
	go.transform.yaw = 0;
	go.addComponent(MeshRenderer, { meshID: 'bridge' });
	go.addComponent(Bridge, { open: false, cells });
	go.addComponent(BoxCollider, {
		size: {
			x: Math.max(1.4, maxX - minX + CELL_SIZE),
			y: 1.2,
			z: Math.max(1.4, maxZ - minZ + CELL_SIZE),
		},
		solid: true,
	});
	go.addComponent(Named, { id: spans[0].name ?? 'Bridge' });
	bindChunk(go, chunk.id);
	world.add(go);
}

const STALL_MESH:Record<string, string> = {
	BakerStall: 'stall_baker',
	WeaverStall: 'stall_weaver',
	PotterStall: 'stall_potter',
	CutlerStall: 'stall_cutler',
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
	go.transform.yaw = stallYaw(ent.localZ);
	go.addComponent(MeshRenderer, { meshID: stallMeshFor(ent.name) });
	const counter = new GameObject(`${go.id} counter`, 'Stall');
	counter.parent = go;
	counter.transform.localPosition = { x: 0, y: STALL_COUNTER.h * 0.5, z: STALL_COUNTER.z };
	counter.addComponent(BoxCollider, { size: { x: STALL_COUNTER.w, y: STALL_COUNTER.h, z: STALL_COUNTER.d } });
	if (ent.name) {
		go.addComponent(Named, { id: ent.name });
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
	packLoot?:LootSpec[];
	wallet?:number;
	hp?:number;
	merchant?:{ goods:string[] };
	marketNPC?:{ kind:MarketNPCKind; wants:string[]; leaveGate?:string; post?:string };
	companion?:boolean;
	hearOnly?:string[];
	streams?:boolean;
	/** The fight verbs that hurt it most, and how much; every other blow by `others`. */
	weakness?:{ to:string[]; times:number; others:number };
	/** How it sounds when it talks. Fields left out vary by id. */
	voice?:SpeechVoice;
	/** Item defs put in its hands (a knight's sword, an archer's bow). */
	equip?:string[];
	/** Its team's colors, shown in a ring on the ground under it. */
	team?:TeamColors;
};

/** The voice `id` gets by default: varied by id, higher for characters drawn as women. */
function voiceOf(id:string, meshID:string):SpeechVoice {
	return voiceFor(id, characterModel(meshID)?.feminine ? [300, 420] : [170, 240]);
}

/** A character's model, its height, and the clips picked from what it does. */
function addAppearance(go:GameObject, meshID:string):void {
	const model = characterModel(meshID);
	if (!model) {
		throw new Error(`${go.id}: no character model ${meshID}`);
	}
	go.addComponent(MeshRenderer, { meshID });
	go.addComponent(Appearance, { height: model.height });
	go.addComponent(Animator);
	go.addComponent(CharacterAnimation);
	go.addComponent(HeldProps);
	go.addComponent(CharacterPose);
}

/** How far a streaming NPC keeps chunks loaded: its room and the next, not the whole map. */
const NPC_STREAM_RADIUS = 10;

export function spawnNPC(world:World, chunk:Chunk, opts:NPCSpawnOpts):GameObject {
	const pos = chunk.worldCellCenter(opts.localX, opts.localZ);
	const tile = chunk.tile(opts.localX, opts.localZ);
	const go = new GameObject(opts.id, 'NPC');
	go.recipe = { npc: structuredClone(opts), chunkID: chunk.id };
	go.transform.position.x = pos.x;
	go.transform.position.y = (tile?.height ?? 0) * TILE_HEIGHT;
	go.transform.position.z = pos.z;
	if (opts.yaw !== undefined) {
		go.transform.yaw = opts.yaw;
	}
	if (opts.meshID === 'human') {
		throw new Error(`NPC ${opts.id} meshID 'human' is the player; use human_<kind>`);
	}
	addAppearance(go, opts.meshID);
	go.addComponent(HurtFlash, { enabled: false });
	go.addComponent(NPCInput);
	const motor = go.addComponent(CharacterMotor);
	if (opts.destLocalX !== undefined && opts.destLocalZ !== undefined) {
		const dest = chunk.worldCellCenter(opts.destLocalX, opts.destLocalZ);
		motor.destinationPoint = { x: dest.x, z: dest.z };
	}
	go.addComponent(RigidBody, { kinematic: true });
	go.addComponent(BoxCollider, { size: { x: 0.45, y: 1.1, z: 0.45 }, pad: 0.36 });
	const body = go.addComponent(HumanBody, { pockets: go.addComponent(Container, { size: 2 }) });
	if (opts.pack || opts.packKey || opts.packLoot) {
		const pack = instantiateDef(getDef('traveler_pack'));
		if (opts.packKey) {
			const key = instantiateDef(getDef('brass_key'));
			key.name = 'BrassKey';
			pack.Container?.contents.push(key);
		}
		pack.Container?.contents.push(...(opts.packLoot ?? []).map(makeLoot));
		body.slots.back = pack;
	}
	for (const defID of opts.equip ?? []) {
		equipItem(go, instantiateDef(getDef(defID)), world);
	}
	const hp = opts.hp && opts.hp > 0 ? Math.round(opts.hp) : 5;
	go.addComponent(Vitals, { hp, maxHP: hp });
	go.addComponent(Regen);
	if (opts.team) {
		go.addComponent(TeamRing, { colors: opts.team });
	}
	go.addComponent(Named, { id: opts.id });
	go.addComponent(Speaker, { voice: { ...voiceOf(opts.id, opts.meshID), ...opts.voice } });
	go.addComponent(Wallet, { coins: opts.wallet ?? 0 });
	if (opts.merchant) {
		go.addComponent(Merchant, { goods: [...opts.merchant.goods] });
	}
	if (opts.marketNPC) {
		const npc = go.addComponent(MarketNPC, {
			kind: opts.marketNPC.kind,
			wants: [...opts.marketNPC.wants],
			leaveGate: opts.marketNPC.leaveGate ?? '',
			post: opts.marketNPC.post ?? '',
		});
		if (opts.marketNPC.kind === 'vendor') {
			npc.postX = go.transform.position.x;
			npc.postZ = go.transform.position.z;
		}
	}
	if (opts.companion) {
		go.addComponent(Companion);
	}
	if (opts.hearOnly) {
		go.addComponent(HearOnly, { from: [...opts.hearOnly] });
	}
	if (opts.weakness) {
		go.addComponent(Weakness, { ...opts.weakness, to: [...opts.weakness.to] });
	}
	if (opts.streams) {
		go.addComponent(StreamingAnchor, { viewRadius: NPC_STREAM_RADIUS });
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
	const meshID = resolvePlayerKind(prefs().playerKind);
	addAppearance(go, meshID);
	go.addComponent(HurtFlash, { enabled: false });
	go.addComponent(PlayerInput);
	go.addComponent(PlayerPilot);
	go.addComponent(NPCInput);
	go.addComponent(CharacterMotor);
	go.addComponent(RigidBody, { kinematic: true });
	go.addComponent(BoxCollider, { size: { x: 0.45, y: 1.1, z: 0.45 }, pad: 0.36 });
	go.addComponent(HumanBody, { pockets: go.addComponent(Container, { size: 2 }) });
	go.addComponent(Vitals, { hp: 20, maxHP: 20 });
	go.addComponent(Regen);
	go.addComponent(StreamingAnchor);
	go.addComponent(Named, { id: 'Player' });
	go.addComponent(Speaker, { voice: voiceOf('Player', meshID) });
	go.addComponent(Wallet);
	go.addComponent(Light, { enabled: false, castShadow: true, range: 9, intensity: 32 });
	go.addComponent(HeldTorchLight);
	world.add(go);
}

/** A raven on the ground at world `x`, `z`, facing `yaw`. Scenery: nobody perceives it. */
export function spawnRaven(world:World, id:string, x:number, z:number, yaw = 0):void {
	const go = new GameObject(id, 'Raven');
	go.transform.position.x = x;
	go.transform.position.y = world.sampleTerrain(x, z)?.worldY ?? 0;
	go.transform.position.z = z;
	go.transform.yaw = yaw;
	go.addComponent(MeshRenderer, { meshID: 'Raven' });
	go.addComponent(Raven);
	world.add(go);
}

/** A named room of a scene's map, corner cell to corner cell (inclusive). */
export type RoomDef = { name:string; from:[number, number]; to:[number, number] };

/**
 * A room: somewhere to go to and to be in, with nothing to draw. Not bound to a chunk, so it can be found from
 * anywhere in the scene.
 */
export function spawnRoom(world:World, room:RoomDef):void {
	const minX = Math.min(room.from[0], room.to[0]) * CELL_SIZE;
	const maxX = (Math.max(room.from[0], room.to[0]) + 1) * CELL_SIZE;
	const minZ = Math.min(room.from[1], room.to[1]) * CELL_SIZE;
	const maxZ = (Math.max(room.from[1], room.to[1]) + 1) * CELL_SIZE;
	const go = new GameObject(room.name, room.name);
	go.transform.position.x = (minX + maxX) / 2;
	go.transform.position.z = (minZ + maxZ) / 2;
	go.addComponent(Named, { id: room.name });
	go.addComponent(Interior, { minX, maxX, minZ, maxZ, room: true });
	world.add(go);
}

/** The main camera behind the player, `distance` meters back (the camera's default when unset). */
export function spawnCamera(world:World, distance?:number):void {
	if (world.findByID('MainCamera')) {
		return;
	}
	const player = world.findByID('Player');
	const go = new GameObject('MainCamera', 'Camera');
	const cam = go.addComponent(Camera, { targetID: 'Player' });
	if (distance !== undefined) {
		cam.distance = distance;
	}
	if (player) {
		cam.yaw = player.transform.yaw;
		cam.orbitYaw = player.getComponent(PlayerInput)?.lookYaw ?? player.transform.yaw;
	}
	go.addComponent(RenderCamera);
	world.add(go);
	cam.lateUpdate(1);
}
