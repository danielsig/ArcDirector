import { Belly } from '../engine/Belly';
import { Regen } from '../engine/Regen';
import { CharacterAnimation } from '../characters/CharacterAnimation';
import { CharacterPose } from '../characters/CharacterPose';
import { HeldProps } from '../characters/HeldProps';
import { Raven } from '../characters/Raven';
import { Reading } from '../characters/Reading';
import { Seated } from '../characters/Seated';
import { CharacterMotor } from '../characters/CharacterMotor';
import { NPCInput } from '../characters/NPCInput';
import { PlayerInput } from '../characters/PlayerInput';
import { PlayerPilot } from '../characters/PlayerPilot';
import { TeamRing, type TeamColors } from '../engine/TeamRing';
import { Animator, Camera, StreamingAnchor, Speaker, voiceFor, Rigidbody, type SpeechVoice, GameObject, type Bounds, type XZ } from '@arc-director/kindling';
import {
	BoxCollider,
	FollowCamera,
	HumanBody,
	Appearance,
	HurtFlash,
	Weakness,
	Moves,
	Named,
	Vitals,
	Wallet,
	Merchant,
	MarketplaceNPC,
	Companion,
	HearOnly,
	type MarketplaceNPCKind,
} from '../engine/components';
import { Interior } from '../kit/houses/interior';
import { DemoMeshRenderer } from '../engine/demo-mesh-renderer';
import type { DemoWorld } from '../engine/demo-world';
import { Container } from '../items/item-components';
import { getDef } from '../items/defs';
import { equipItem } from '../items/equip';
import { instantiateDef } from '../items/instance';
import { characterModel, resolvePlayerKind } from '../render/character-models';
import { prefs } from '../prefs';
import { makeLoot } from '../kit/thing';
import { THINGS } from '../kit/thing-registry';
import { CELL_SIZE, TILE_HEIGHT } from './constants';
import type { DemoChunk } from './demo-chunk';
import type { LootSpec } from './decode-glyph-chunk';

/** Every entity on the chunk: each thing spawns its own (`THINGS`, in order). */
export function spawnChunkEntities(world:DemoWorld, chunk:DemoChunk):void {
	for (const thing of THINGS) {
		const ents = chunk.entities.filter((ent) => thing.defs.includes(ent.def));
		if (ents.length > 0) {
			thing.spawn(world, chunk, ents);
		}
	}
}

export type NPCSpawnDef = {
	id:string;
	meshID:string;
	/** The map cell it stands on, `[x, z]` tiles from the map's north-west corner. */
	cell:[number, number];
	/** Meters (world X, Z) it stands off its cell's center. */
	offset?:XZ;
	yaw?:number;
	/** False: nothing on its back. Otherwise a pack, holding `packLoot`. */
	pack?:boolean;
	packLoot?:LootSpec[];
	wallet?:number;
	hp?:number;
	merchant?:{ goods:string[] };
	marketplaceNPC?:{ kind:MarketplaceNPCKind; wants:string[]; leaveGate?:string; post?:string };
	companion?:boolean;
	hearOnly?:string[];
	streams?:boolean;
	/** Attacks it can make beyond its fight role's own, such as `cleave` for a Blade. */
	moves?:string[];
	/** False: it never dodges, so every blow that reaches it lands. */
	evasive?:boolean;
	/** The fight verbs that hurt it most, and how much; every other blow by `others`. */
	weakness?:{ to:string[]; times:number; others:number };
	/** How it sounds when it talks. Fields left out vary by id. */
	voice?:SpeechVoice;
	/** Item defs put in its hands (a knight's sword, an archer's bow). */
	equip?:string[];
	/** Its team's colors, shown in a ring on the ground under it. */
	team?:TeamColors;
	/** Sat on the chair named `on` from the start (`Seated`), with `rod` fishing the water ahead. */
	seated?:{ on:string; rod?:boolean };
	/** Hungry from the start, until it eats (`Belly`). */
	hungry?:boolean;
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
	go.addComponent(DemoMeshRenderer, { meshID });
	go.addComponent(Appearance, { height: model.height });
	go.addComponent(Animator);
	go.addComponent(CharacterAnimation);
	go.addComponent(HeldProps);
	go.addComponent(CharacterPose);
	// Reading first: a seated reader is seen reading (its `sense()` note wins).
	go.addComponent(Reading);
	go.addComponent(Seated);
}

/** How far a streaming NPC keeps chunks loaded: its room and the next, not the whole map. */
const NPC_STREAM_RADIUS = 10;
/** A character's collider: a footprint bodies stand apart by, as tall as a body, which hides what is behind it. */
const BODY_SIZE = { x: 0.45, y: 1.8, z: 0.45 };

/**
 * A body of either side, not yet in the world: `id` drawn as `meshID` at `at`, with `hp`, its motor, collider,
 * pockets, voice and purse. NPCs and the player add what drives them.
 */
function spawnCharacter(id:string, kind:'NPC' | 'Player', meshID:string, at:{ x:number; y:number; z:number }, hp:number):GameObject {
	const go = new GameObject(id, kind);
	go.transform.localPosition = at;
	addAppearance(go, meshID);
	go.addComponent(HurtFlash, { enabled: false });
	go.addComponent(NPCInput);
	go.addComponent(CharacterMotor);
	go.addComponent(Rigidbody, { kinematic: true });
	go.addComponent(BoxCollider, { size: { ...BODY_SIZE }, pad: 0.36 });
	go.addComponent(HumanBody, { pockets: go.addComponent(Container, { size: 2 }) });
	go.addComponent(Vitals, { hp, maxHP: hp });
	go.addComponent(Regen);
	go.addComponent(Named, { id });
	go.addComponent(Speaker, { voice: voiceOf(id, meshID) });
	go.addComponent(Wallet);
	return go;
}

/** Where a character on map cell `[tx, tz]` stands, `offset` from its center on its tile's top. Throws off the map. */
function cellPoint(world:DemoWorld, [tx, tz]:[number, number], offset?:XZ):{ x:number; y:number; z:number } {
	const tile = world.terrain.tileAt({ tx, tz });
	if (!tile) {
		throw new Error(`no map cell ${tx}, ${tz}`);
	}
	const center = world.terrain.tileCenter({ tx, tz });
	return { x: center.x + (offset?.x ?? 0), y: tile.height * TILE_HEIGHT, z: center.z + (offset?.z ?? 0) };
}

export function spawnNPC(world:DemoWorld, opts:NPCSpawnDef):GameObject {
	if (opts.meshID === 'human') {
		throw new Error(`NPC ${opts.id} meshID 'human' is the player; use human_<kind>`);
	}
	const hp = opts.hp && opts.hp > 0 ? Math.round(opts.hp) : 5;
	const go = spawnCharacter(opts.id, 'NPC', opts.meshID, cellPoint(world, opts.cell, opts.offset), hp);
	go.recipe = { npc: structuredClone(opts) };
	if (opts.yaw !== undefined) {
		go.transform.yaw = opts.yaw;
	}
	const body = go.getComponent(HumanBody)!;
	if (opts.pack !== false) {
		const pack = instantiateDef(getDef('traveler_pack'));
		pack.Container?.contents.push(...(opts.packLoot ?? []).map(makeLoot));
		body.slots.back = pack;
	}
	for (const defID of opts.equip ?? []) {
		equipItem(go, instantiateDef(getDef(defID)), world);
	}
	go.getComponent(Vitals)!.evasive = opts.evasive ?? true;
	if (opts.team) {
		go.addComponent(TeamRing, { colors: opts.team });
	}
	const speaker = go.getComponent(Speaker)!;
	speaker.voice = { ...speaker.voice, ...opts.voice };
	go.getComponent(Wallet)!.coins = opts.wallet ?? 0;
	if (opts.merchant) {
		go.addComponent(Merchant, { goods: [...opts.merchant.goods] });
	}
	if (opts.marketplaceNPC) {
		const npc = go.addComponent(MarketplaceNPC, {
			kind: opts.marketplaceNPC.kind,
			wants: [...opts.marketplaceNPC.wants],
			leaveGate: opts.marketplaceNPC.leaveGate ?? '',
			post: opts.marketplaceNPC.post ?? '',
		});
		if (opts.marketplaceNPC.kind === 'vendor') {
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
	if (opts.moves?.length) {
		go.addComponent(Moves, { extra: [...opts.moves] });
	}
	if (opts.weakness) {
		go.addComponent(Weakness, { ...opts.weakness, to: [...opts.weakness.to] });
	}
	if (opts.seated) {
		const seat = go.getComponent(Seated)!;
		seat.seatID = opts.seated.on;
		seat.rod = !!opts.seated.rod;
	}
	if (opts.hungry) {
		go.addComponent(Belly);
	}
	if (opts.streams) {
		go.addComponent(StreamingAnchor, { viewRadius: NPC_STREAM_RADIUS });
	}
	world.add(go);
	return go;
}

export function spawnPlayer(
	world:DemoWorld,
	start:XZ | null,
	chunk:DemoChunk,
):void {
	if (world.findByID('Player')) {
		return;
	}
	const pos = start ?? chunk.worldCellCenter(2, 2);
	const at = { x: pos.x, y: (chunk.tileAtWorld(pos.x, pos.z)?.height ?? 0) * TILE_HEIGHT, z: pos.z };
	const go = spawnCharacter('Player', 'Player', resolvePlayerKind(prefs().playerKind), at, 20);
	go.addComponent(PlayerInput);
	go.addComponent(PlayerPilot);
	world.add(go);
}

/** A raven on the ground at world `x`, `z`, facing `yaw`. Scenery: nobody perceives it. */
export function spawnRaven(world:DemoWorld, id:string, x:number, z:number, yaw = 0):void {
	const go = new GameObject(id, 'Raven');
	go.transform.position.x = x;
	go.transform.position.y = world.terrain.sample(x, z)?.worldY ?? 0;
	go.transform.position.z = z;
	go.transform.yaw = yaw;
	go.addComponent(DemoMeshRenderer, { meshID: 'Raven' });
	go.addComponent(Raven);
	world.add(go);
}

/**
 * A named room of a scene's map, corner cell to corner cell (inclusive). `memory` is what being in it is like, on the
 * mind of whoever stands there ("The Ossuary reeks of rot.").
 */
export type RoomDef = {
	name:string;
	from:[number, number];
	to:[number, number];
	memory?:string;
	/** What it is like for one character in particular, by id, on top of `memory`. */
	memories?:Record<string, string>;
};

/** A room's floor in meters: the outer edges of its corner cells. */
export function roomBounds(room:RoomDef):Bounds {
	return {
		minX: Math.min(room.from[0], room.to[0]) * CELL_SIZE,
		maxX: (Math.max(room.from[0], room.to[0]) + 1) * CELL_SIZE,
		minZ: Math.min(room.from[1], room.to[1]) * CELL_SIZE,
		maxZ: (Math.max(room.from[1], room.to[1]) + 1) * CELL_SIZE,
	};
}

/**
 * A room: somewhere to go to and to be in, with nothing to draw. Not bound to a chunk, so it can be found from
 * anywhere in the scene.
 */
export function spawnRoom(world:DemoWorld, room:RoomDef):void {
	const bounds = roomBounds(room);
	const go = new GameObject(room.name, room.name);
	go.transform.position.x = (bounds.minX + bounds.maxX) / 2;
	go.transform.position.z = (bounds.minZ + bounds.maxZ) / 2;
	go.addComponent(Named, { id: room.name });
	go.addComponent(Interior, { bounds, room: true });
	world.add(go);
}

/** The camera's start. Each is the camera's own default when unset. */
export type CameraLook = {
	/** The way the camera and the player face; 0 is north. */
	yaw?:number;
	/** Distance from the player, in meters. */
	zoom?:number;
};

/** The main camera behind the player. */
export function spawnCamera(world:DemoWorld, look:CameraLook = {}):void {
	if (world.findByID('MainCamera')) {
		return;
	}
	const player = world.findByID('Player');
	const go = new GameObject('MainCamera', 'Camera');
	const cam = go.addComponent(FollowCamera, { targetID: 'Player' });
	cam.distance = look.zoom ?? cam.distance;
	if (player) {
		const input = player.getComponent(PlayerInput);
		if (look.yaw !== undefined) {
			player.transform.yaw = look.yaw;
			if (input) {
				input.lookYaw = look.yaw;
			}
		}
		cam.orbitYaw = input?.lookYaw ?? player.transform.yaw;
	}
	go.addComponent(Camera);
	world.add(go);
	cam.snap();
}
