import { Regen } from '../engine/Regen';
import { CharacterAnimation } from '../characters/CharacterAnimation';
import { CharacterPose } from '../characters/CharacterPose';
import { HeldProps } from '../characters/HeldProps';
import { Raven } from '../characters/Raven';
import { Seated } from '../characters/Seated';
import { CharacterMotor } from '../characters/CharacterMotor';
import { NPCInput } from '../characters/NPCInput';
import { PlayerInput } from '../characters/PlayerInput';
import { PlayerPilot } from '../characters/PlayerPilot';
import { Burns, Fire } from '../engine/Fire';
import { TeamRing, type TeamColors } from '../engine/TeamRing';
import { Animator, ChunkBound, Camera as RenderCamera, StreamingAnchor, Speaker, voiceFor, type SpeechVoice, hash, GameObject, spotThrough } from '@arc-director/kindling';
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
	Moves,
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
import { counterMeshID, getPostStyle, riverBoulderMeshID, roofMeshID, STALL_COUNTER } from '../render/meshRegistry';
import { prefs } from '../prefs';
import { BOULDER_SIZE, CELL_SIZE, MOON_BLUE, MOON_WINDOW, TILE_HEIGHT, WALL_HEIGHT } from './constants';
import { findBuildings } from './buildings';
import { WALL_THICKNESS, wallFaceInset, wallSide } from './thinWall';
import { stallYaw } from './dressingPlan';
import { POST_MESH } from '../items/wares';
import { showsWater } from './water';
import type { Chunk, ChunkEntity } from './Chunk';
import type { LootSpec } from './decodeGlyphChunk';

function wallOffset(chunk:Chunk, localX:number, localZ:number):{ x:number; z:number; yaw:number } {
	const side = wallSide(chunk, localX, localZ);
	if (!side) {
		return { x: 0, z: 0, yaw: 0 };
	}
	const [dx, dz] = side;
	const out = CELL_SIZE / 2 + wallFaceInset(chunk.tile(localX + dx, localZ + dz)?.def) - 0.12;
	return { x: dx * out, z: dz * out, yaw: dz !== 0 ? (dz > 0 ? 0 : Math.PI) : (dx * Math.PI) / 2 };
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

/**
 * How far off the moon stands from what it shines through: down a stairwell far, so its rays come near parallel; at a
 * window near, so they spread and light a patch some times the window's size. And how far behind a window's face it
 * is framed: just past the bars, so they cast their shadows.
 */
const MOON_BACK = 30;
const MOON_WINDOW_BACK = 2.5;
const MOON_FRAME_DEPTH = 0.12;
/** A `moonbeam`'s stairwell: how far under the wall tops (the ceiling) its light comes in, and how wide its flight is. */
const MOONBEAM_DROP = 0.45;
const MOONBEAM_WIDTH = 4;
/** How fast moonlight fades with distance, and how far past the moonlight cell it reaches. */
const MOON_DECAY = 1.2;
const MOON_REACH = 6;

/** What of its light a spot or point light gives at `d` meters with `range` (three.js's falloff). */
function falloff(d:number, range:number):number {
	return Math.max(0, 1 - (d / range) ** 4) ** 2 / Math.max(d ** MOON_DECAY, 0.01);
}

/** Where a glyph entity stands: its cell's centre moved by its `offset`, on its tile's top. */
function entityPoint(chunk:Chunk, ent:ChunkEntity):{ x:number; y:number; z:number } {
	const center = chunk.worldCellCenter(ent.localX, ent.localZ);
	return {
		x: center.x + (ent.offset?.x ?? 0),
		y: (chunk.tile(ent.localX, ent.localZ)?.height ?? 0) * TILE_HEIGHT + (ent.offset?.y ?? 0),
		z: center.z + (ent.offset?.z ?? 0),
	};
}

type Point = { x:number; y:number; z:number };

/**
 * Calls `fn` with the `moonlight` cell nearest `p`, on the ground, once every chunk is in (it may lie in the next
 * one); never without one.
 */
function withNearestMoonlight(world:World, p:Point, fn:(to:Point)=>void):void {
	world.after(0, () => {
		let to:Point | undefined;
		for (const chunk of world.chunks.values()) {
			for (const lit of chunk.entities) {
				const at = lit.def === 'moonlight' || lit.def === 'moonbeam_target' ? entityPoint(chunk, lit) : undefined;
				if (at && (!to || Math.hypot(at.x - p.x, at.z - p.z) < Math.hypot(to.x - p.x, to.z - p.z))) {
					to = at;
				}
			}
		}
		if (to) {
			fn(to);
		}
	});
}

/** `meters` on from `p`, away from `from` (level, when `level`). */
function beyond(p:Point, from:Point, meters:number, level = false):Point {
	const d = { x: p.x - from.x, y: level ? 0 : p.y - from.y, z: p.z - from.z };
	const k = meters / (Math.hypot(d.x, d.y, d.z) || 1);
	return { x: p.x + d.x * k, y: p.y + d.y * k, z: p.z + d.z * k };
}

/**
 * Moonlight from `lamp`, far off, shining through an opening (its corners `through`) onto the moonlight cell at `to`:
 * it lights only through the opening (`spotThrough`), as brightly there as a lamp 3 m off would, and every body in it
 * casts its shadow.
 */
function spawnMoonbeam(world:World, chunk:Chunk, id:string, lamp:Point, through:Point[], to:Point):void {
	const aim = spotThrough(lamp, through);
	const beam = new GameObject(id, 'Moonbeam');
	beam.transform.position.x = lamp.x;
	beam.transform.position.y = lamp.y;
	beam.transform.position.z = lamp.z;
	beam.transform.yaw = aim.yaw;
	beam.transform.pitch = aim.pitch;
	const far = Math.hypot(to.x - lamp.x, to.y - lamp.y, to.z - lamp.z);
	const range = far + MOON_REACH;
	beam.addComponent(Light, {
		kind: 'spot',
		color: MOON_BLUE,
		intensity: 40 * falloff(3, 9) / falloff(far, range),
		range,
		decay: MOON_DECAY,
		angle: aim.angle,
		penumbra: 0,
		cookie: aim.cookie,
		shadowNear: aim.shadowNear,
		castShadow: true,
		intensityFlicker: 0,
	});
	bindChunk(beam, chunk.id);
	world.add(beam);
}

/** A rectangle's corners: `width` along `across` (level) and `height` up, about `c`. */
function rectCorners(c:Point, across:{ x:number; z:number }, width:number, height:number):Point[] {
	return [-1, 1].flatMap((s) => [-1, 1].map((t) => ({ x: c.x + across.x * s * width / 2, y: c.y + t * height / 2, z: c.z + across.z * s * width / 2 })));
}

/** The moonlight down a stairwell, from its top (`from`): level with it, under the ceiling, so it never lights the rock over. */
function spawnStairwellMoonbeam(world:World, chunk:Chunk, id:string, from:Point):void {
	withNearestMoonlight(world, from, (to) => {
		const reach = Math.hypot(from.x - to.x, from.z - to.z) || 1;
		const across = { x: -(from.z - to.z) / reach, z: (from.x - to.x) / reach };
		// The band from where it comes in, under the ceiling, down to the moonlight at the stairs' foot.
		const through = [...rectCorners(from, across, MOONBEAM_WIDTH, 0), ...rectCorners(to, across, MOONBEAM_WIDTH, 0)];
		spawnMoonbeam(world, chunk, id, beyond(from, to, MOON_BACK, true), through, to);
	});
}

/**
 * A barred window through the wall beside its cell (the chunk mesh cuts the opening), with moonlight falling through
 * it onto the chunk's `moonlight` cell: bars on the wall face, and a spot light on them, shining down into the room.
 */
function spawnMoonWindow(world:World, chunk:Chunk, ent:ChunkEntity):void {
	const center = chunk.worldCellCenter(ent.localX, ent.localZ);
	const off = wallOffset(chunk, ent.localX, ent.localZ);
	const floor = (chunk.tile(ent.localX, ent.localZ)?.height ?? 0) * TILE_HEIGHT;
	const reach = Math.hypot(off.x, off.z) || 1;
	const out = { x: off.x / reach, z: off.z / reach };
	const face = CELL_SIZE / 2 + wallFaceInset(chunk.tile(ent.localX + Math.round(out.x), ent.localZ + Math.round(out.z))?.def);
	const pane = new GameObject(`moon_window_${chunk.id}_${ent.localX}_${ent.localZ}`, 'Window');
	pane.transform.position.x = center.x + out.x * face;
	pane.transform.position.y = floor + MOON_WINDOW.y;
	pane.transform.position.z = center.z + out.z * face;
	pane.transform.yaw = off.yaw + Math.PI;
	pane.addComponent(MeshRenderer, { meshID: 'moon_window' });
	bindChunk(pane, chunk.id);
	world.add(pane);
	const frame = { x: pane.transform.position.x + out.x * MOON_FRAME_DEPTH, y: floor + MOON_WINDOW.y, z: pane.transform.position.z + out.z * MOON_FRAME_DEPTH };
	const through = rectCorners(frame, { x: -out.z, z: out.x }, MOON_WINDOW.width, MOON_WINDOW.height);
	withNearestMoonlight(world, frame, (to) => {
		spawnMoonbeam(world, chunk, `moonbeam_${chunk.id}_${ent.localX}_${ent.localZ}`, beyond(frame, to, MOON_WINDOW_BACK), through, to);
	});
}

/** Where moonlight lands: a very faint blue glow about it, as if the moonlight spilled into the room. */
function spawnMoonlight(world:World, chunk:Chunk, ent:ChunkEntity):void {
	const at = entityPoint(chunk, ent);
	const go = new GameObject(`moonlight_${chunk.id}_${ent.localX}_${ent.localZ}`, 'Moonlight');
	go.transform.position.x = at.x;
	go.transform.position.y = at.y + 0.1;
	go.transform.position.z = at.z;
	go.addComponent(Light, { color: 0x6f8fff, intensity: 5, range: 4.5, decay: 0.05, castShadow: false, intensityFlicker: 0 });
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
	go.transform.position.x = center.x + (ent.offset?.x ?? 0);
	go.transform.position.y = (tile?.height ?? 0) * TILE_HEIGHT + (ent.offset?.y ?? 0);
	go.transform.position.z = center.z + (ent.offset?.z ?? 0);
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

/** A door in a wall, or a gate (`gate`: stone piers and iron leaves) in a town wall. Both open and shut as a `Door`. */
function spawnDoor(world:World, chunk:Chunk, ent:ChunkEntity):void {
	const center = chunk.worldCellCenter(ent.localX, ent.localZ);
	const tile = chunk.tile(ent.localX, ent.localZ);
	const axis = ent.axis ?? 'x';
	const go = new GameObject(ent.name ?? `${ent.def}_${chunk.id}_${ent.localX}_${ent.localZ}`, 'Door');
	go.transform.position.x = center.x;
	go.transform.position.y = (tile?.height ?? 0) * TILE_HEIGHT;
	go.transform.position.z = center.z;
	const door = go.addComponent(Door, { axis, open: false });
	const panel = new GameObject();
	panel.addComponent(BoxCollider);
	door.panel = panel;
	door.flipped = ent.def.includes('flipped');
	door.closedYaw = (door.flipped ? Math.PI : 0);
	door.openYaw = -Math.PI / 2;
	door.size = axis === 'x' ? { x: 0.16, y: 2.12, z: 1 } : { x: 1, y: 2.12, z: 0.16 };
	go.transform.yaw = axis === 'x' ? 0 : Math.PI / 2;
	panel.parent = go;
	go.addComponent(Lock, { keyID: ent.keyID ?? 'brass', locked: ent.locked ?? true });
	go.addComponent(MeshRenderer, { meshID: ent.def });
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
	'pear',
	'plum',
	'candle',
	'tonic',
	'salve',
	'lavender',
	'soap',
	'wooden_horse',
	'doll',
	'whistle',
	'spinning_top',
]);

export function spawnChunkEntities(world:World, chunk:Chunk):void {
	const bridgeSpans:ChunkEntity[] = [];
	const posts = new Map<string, ChunkEntity[]>();
	for (const ent of chunk.entities) {
		if (ent.def === 'wall_torch' || ent.def === 'standing_torch') {
			spawnTorch(world, chunk, ent);
		}
		else if (ent.def === 'chest') {
			spawnChest(world, chunk, ent);
		}
		else if (ent.def === 'door' || ent.def === 'gate' || ent.def === 'door_flipped') {
			spawnDoor(world, chunk, ent);
		}
		else if (ent.def === 'stall') {
			const key = ent.name ?? `${ent.localX},${ent.localZ}`;
			posts.set(key, [...(posts.get(key) ?? []), ent]);
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
		else if (ent.def === 'moon_window') {
			spawnMoonWindow(world, chunk, ent);
		}
		else if (ent.def === 'moonlight') {
			spawnMoonlight(world, chunk, ent);
		}
		else if (ent.def === 'moonbeam') {
			// Moonlight from above, as down a stairwell from the night outside.
			spawnStairwellMoonbeam(world, chunk, `moonbeam_${chunk.id}_${ent.localX}_${ent.localZ}`, { ...entityPoint(chunk, ent), y: WALL_HEIGHT - MOONBEAM_DROP });
		}
		else if (ent.def === 'cobweb') {
			// Wall to wall across the passage, however wide, and up to the ceiling, until a flame burns it away.
			const web = spawnProp(world, chunk, ent, 'cobweb', 1, ent.yaw ?? 0);
			const open = (dx:number):boolean => {
				const tile = chunk.tile(ent.localX + dx, ent.localZ);
				return !!tile && !tile.blocked;
			};
			let west = 0;
			let east = 0;
			while (open(-west - 1)) {
				west++;
			}
			while (open(east + 1)) {
				east++;
			}
			const span = west + east + 1;
			web.transform.position.x += ((east - west) * CELL_SIZE) / 2;
			web.transform.localScale.x = span;
			const col = web.getComponent(BoxCollider)!;
			col.size.x = span * CELL_SIZE;
			col.size.y = WALL_HEIGHT;
			web.addComponent(Flammable);
			web.addComponent(Burns);
		}
		else if (ent.def === 'inscription') {
			spawnProp(world, chunk, ent, 'stone_tablet', 0.5, ent.yaw ?? wallOffset(chunk, ent.localX, ent.localZ).yaw + Math.PI)
				.addComponent(Inscription, { text: ent.text ?? '' });
		}
		else if (ent.def === 'boulder') {
			const at = chunk.worldCellCenter(ent.localX, ent.localZ);
			const size = BOULDER_SIZE.min + (BOULDER_SIZE.max - BOULDER_SIZE.min) * hash(at.x, at.z, 71) ** 1.5;
			// Standing in the river, it sits on the bed and looks wet.
			const meshID = showsWater(chunk.tile(ent.localX, ent.localZ)?.def) ? riverBoulderMeshID(ent.wake) : 'boulder';
			spawnProp(world, chunk, ent, meshID, 0.4 * size).transform.scale = size;
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
			// On the floor, as a dropped item lands.
			const y = (tile?.height ?? 0) * TILE_HEIGHT;
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
	for (const run of posts.values()) {
		spawnStall(world, chunk, run);
	}
	spawnBuildings(world, chunk);
}

/** Each house on the chunk: its roof (sized to its wall line), its inside, its name, and its door told whose it is. */
function spawnBuildings(world:World, chunk:Chunk):void {
	for (const b of findBuildings([chunk])) {
		const name = b.name || `House_${chunk.id}_${b.door.localX}_${b.door.localZ}`;
		const go = new GameObject(name, 'Building');
		go.transform.position.x = (b.walls.minX + b.walls.maxX) * 0.5;
		go.transform.position.y = 0;
		go.transform.position.z = (b.walls.minZ + b.walls.maxZ) * 0.5;
		go.addComponent(MeshRenderer, { meshID: roofMeshID(b.walls.maxX - b.walls.minX + 0.18, b.walls.maxZ - b.walls.minZ, b.roof, b.chimney) });
		go.addComponent(BoxCollider, { size: { x: 0.4, y: 1, z: 0.4 }, solid: false, isTrigger: true });
		go.addComponent(Named, { id: name });
		go.addComponent(Interior, { ...b.inside });
		bindChunk(go, chunk.id);
		world.add(go);
		const leaf = b.door.name ? world.findNamed(b.door.name)?.getComponent(Door) : undefined;
		if (leaf) {
			leaf.buildingID = name;
		}
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
	else if (meshID === 'tree_oak' || meshID === 'tree_pine' || meshID.includes('boulder') || meshID.startsWith('pillar')) {
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

/**
 * A seller's post: a stall in the square, or a counter inside a shop (`yaw` in its legend turns it to the door). A
 * counter drawn over a row of cells (one glyph, so one name) is one counter along them, out to the face of any wall
 * at either end.
 */
function spawnStall(world:World, chunk:Chunk, run:ChunkEntity[]):void {
	const ent = run[0]!;
	const alongZ = run.some((e) => e.localZ !== ent.localZ);
	const along = (e:ChunkEntity):number => (alongZ ? e.localZ : e.localX);
	const first = run.reduce((a, b) => (along(b) < along(a) ? b : a));
	const last = run.reduce((a, b) => (along(b) > along(a) ? b : a));
	const [sx, sz] = alongZ ? [0, 1] : [1, 0];
	const reach = (e:ChunkEntity, step:number):number => wallFaceInset(chunk.tile(e.localX + sx * step, e.localZ + sz * step)?.def);
	const start = along(first) * CELL_SIZE - reach(first, -1);
	const end = (along(last) + 1) * CELL_SIZE + reach(last, 1);
	const center = chunk.worldCellCenter(ent.localX, ent.localZ);
	const middle = (alongZ ? chunk.worldOriginZ() : chunk.worldOriginX()) + (start + end) / 2;
	const tile = chunk.tile(ent.localX, ent.localZ);
	const go = new GameObject(ent.name ?? `stall_${chunk.id}_${ent.localX}_${ent.localZ}`, 'Stall');
	go.transform.position.x = (alongZ ? center.x : middle) + (ent.offset?.x ?? 0);
	go.transform.position.y = (tile?.height ?? 0) * TILE_HEIGHT;
	go.transform.position.z = (alongZ ? middle : center.z) + (ent.offset?.z ?? 0);
	go.transform.yaw = ent.yaw ?? stallYaw(ent.localZ);
	const meshID = (ent.name && POST_MESH[ent.name]) || 'stall';
	const style = getPostStyle(meshID);
	const counterMesh = meshID.startsWith('counter_');
	const width = counterMesh ? end - start : STALL_COUNTER.w;
	const depth = STALL_COUNTER.d + (style.bench ? 0.35 : 0) + (style.shelf ? 0.2 : 0);
	go.addComponent(MeshRenderer, { meshID: counterMesh ? counterMeshID(meshID, width) : meshID });
	const counter = new GameObject(`${go.id} counter`, 'Stall');
	counter.parent = go;
	counter.transform.localPosition = { x: 0, y: STALL_COUNTER.h * 0.5, z: (depth - STALL_COUNTER.d) * 0.5 };
	counter.addComponent(BoxCollider, { size: { x: width, y: STALL_COUNTER.h, z: depth } });
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
	offset?:{ x:number; z:number };
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
	/** Sat on the chair where it starts (`Seated`), with `rod` fishing the water ahead. */
	seated?:{ rod?:boolean };
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
	go.transform.position.x = pos.x + (opts.offset?.x ?? 0);
	go.transform.position.y = (tile?.height ?? 0) * TILE_HEIGHT;
	go.transform.position.z = pos.z + (opts.offset?.z ?? 0);
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
	go.addComponent(Vitals, { hp, maxHP: hp, evasive: opts.evasive ?? true });
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
	if (opts.moves?.length) {
		go.addComponent(Moves, { extra: [...opts.moves] });
	}
	if (opts.weakness) {
		go.addComponent(Weakness, { ...opts.weakness, to: [...opts.weakness.to] });
	}
	if (opts.seated) {
		go.addComponent(Seated, { rod: !!opts.seated.rod });
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
export function roomBounds(room:RoomDef):{ minX:number; maxX:number; minZ:number; maxZ:number } {
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
export function spawnRoom(world:World, room:RoomDef):void {
	const { minX, maxX, minZ, maxZ } = roomBounds(room);
	const go = new GameObject(room.name, room.name);
	go.transform.position.x = (minX + maxX) / 2;
	go.transform.position.z = (minZ + maxZ) / 2;
	go.addComponent(Named, { id: room.name });
	go.addComponent(Interior, { minX, maxX, minZ, maxZ, room: true });
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
export function spawnCamera(world:World, look:CameraLook = {}):void {
	if (world.findByID('MainCamera')) {
		return;
	}
	const player = world.findByID('Player');
	const go = new GameObject('MainCamera', 'Camera');
	const cam = go.addComponent(Camera, { targetID: 'Player' });
	cam.distance = look.zoom ?? cam.distance;
	if (player) {
		const input = player.getComponent(PlayerInput);
		if (look.yaw !== undefined) {
			player.transform.yaw = look.yaw;
			if (input) {
				input.lookYaw = look.yaw;
			}
		}
		cam.yaw = player.transform.yaw;
		cam.orbitYaw = input?.lookYaw ?? player.transform.yaw;
	}
	go.addComponent(RenderCamera);
	world.add(go);
	cam.lateUpdate(1);
}
