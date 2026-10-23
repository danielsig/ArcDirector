import type { ArcDirector } from 'arc-director';
import { mapCell, type ChunkFile } from '../world/decodeGlyphChunk';
import { DUNGEON_CHUNKS } from './chunks/dungeon';
import { glen_0_0 } from './chunks/glen_0_0';
import { glen_0_1 } from './chunks/glen_0_1';
import { glen_1_0 } from './chunks/glen_1_0';
import { glen_1_1 } from './chunks/glen_1_1';
import { market_0_0 } from './chunks/market_0_0';
import { market_1_0 } from './chunks/market_1_0';
import { market_0_1 } from './chunks/market_0_1';
import { market_1_1 } from './chunks/market_1_1';
import { RUINS_CHUNKS } from './chunks/ruins';
import type { CameraLook, NPCSpawnOpts, RoomDef } from '../world/spawn';
import type { OutskirtHeights, Surface } from '../world/land';
import { goodsOf, packOf } from '../items/wares';
import type { GameHost, CharacterCtx } from '../director/adapter';
import { createDirector as createDungeonDirector } from '../director/scenes/dungeon';
import { createDirector as createGlenDirector } from '../director/scenes/glen';
import { createDirector as createMarketDirector } from '../director/scenes/market';
import { createDirector as createRuinsDirector } from '../director/scenes/ruins';

/** One NPC of a scene, in the chunk it starts in. */
export type NPCSpawnDef = NPCSpawnOpts & { chunkID:string };

/** How the player starts in a scene. */
export type PlayerDef = {
	wallet?:number;
	/** Item defs put in the player's hands. */
	equip?:string[];
	/** What the cast calls the player, besides Player. */
	name?:string;
	/** The player's character tags, such as a fight role. */
	tags?:string[];
};

export type SceneLook = 'dungeon' | 'glen' | 'market';

export type SceneKey = {
	key:string;
	action:string;
};

/** Shared by the current scenes. A scene can pass its own list. */
const SCENE_KEYS:SceneKey[] = [
	{ key: 'E', action: 'Pick Up or Unlock' },
	{ key: 'F', action: 'Use' },
	{ key: 'X', action: 'Swap Hands' },
];

/** With a sword in hand: the moves a click makes, and the guard. */
const SWORD_KEYS:SceneKey[] = [
	{ key: 'Click', action: 'Slice' },
	{ key: 'Move + Click', action: 'Stab' },
	{ key: 'Shift + Click', action: 'Cleave' },
	{ key: 'Hold Shift', action: 'Block' },
];

export type CarriedOverhead = 'everyone' | 'shoppers';

export type SceneDef = {
	id:string;
	title:string;
	look:SceneLook;
	/** The land behind the map's walls, out to the horizon (`landOf`). Meadow when unset. */
	ground?:Surface;
	/** Heights of the land past the map's edge, per edge tile; each edge tile's own where unset. */
	outskirts?:OutskirtHeights;
	/** How bright every light is but the sun, 1 (the default) as full. */
	lightLevel?:number;
	/** Health bars over the characters, for scenes that fight. */
	healthBars?:boolean;
	/** Tiny icons over each head for the gold and `CARRY_ICONS` items they carry; `shoppers` leaves out whoever sells. */
	carried?:CarriedOverhead;
	/** A card beside whoever the player points at or stands close to: their name, traits, goal and what they carry. */
	inspect?:boolean;
	chunks:ChunkFile[];
	npcs:NPCSpawnDef[];
	ambient:string;
	/** Player keys for this scene, besides the ones every scene shares. */
	keys:SceneKey[];
	/** One paragraph: what this scene is for, and how the characters usually get there. */
	brief:string;
	player?:PlayerDef;
	/** Named rooms, by the cells of the scene's map: places to go to and to be in. */
	rooms?:RoomDef[];
	/** Ravens on the ground at the start, at world `x`, `z`. */
	ravens?:{ x:number; z:number; yaw?:number }[];
	/** World `x`, `z` the main-menu backdrop's camera circles (`Showcase`); the player's start when unset. */
	orbit?:{ x:number; z:number };
	/** How the camera starts. */
	camera?:CameraLook;
	/** Player stays centered and the chunk-sized map scrolls. `false` = current chunk, moving arrow. */
	minimapFollow?:boolean;
	createDirector:(host:GameHost)=>ArcDirector<CharacterCtx>;
};

/** What fighters carry in hand. */
const SWORD = ['iron_sword'];
const STAFF = ['oak_staff'];
const BONE_BOW = ['bone_bow'];
const BOW = ['short_bow'];

/** Someone in the crypt at map cell `x`, `z`. */
/** A low monster of the crypt: too dull to dodge. */
const DULL:Partial<NPCSpawnDef> = { evasive: false };

function delver(id:string, meshID:string, x:number, z:number, hp:number, extra:Partial<NPCSpawnDef> = {}):NPCSpawnDef {
	return { id, meshID, ...mapCell('dungeon', x, z), hp, pack: true, ...extra };
}

export const DUNGEON_VAULT:SceneDef = {
	id: 'dungeon_vault',
	title: 'Dungeon Crawl',
	look: 'dungeon',
	// Solid rock past the crypt's walls: black, not more floor.
	ground: 'void',
	healthBars: true,
	minimapFollow: true,
	// Play as Participant and the company's archer, Kaelen, is you.
	player: { name: 'Kaelen', tags: ['Archer'], equip: ['short_bow'] },
	chunks: DUNGEON_CHUNKS,
	rooms: [
		{ name: 'Gatehouse', from: [3, 37], to: [12, 44], memory: 'The Gatehouse, where we came down into the crypt. Cold air breathes up from the north.' },
		{ name: 'Storeroom', from: [3, 30], to: [13, 35], memory: 'Dusty old junk fills the Storeroom, dry as tinder, and a thick web chokes the passage north.', memories: { Morrigan: 'A cobweb. I hate the very sight of cobwebs: they make my skin crawl, and I want that one gone.' } },
		{ name: 'PillaredHall', from: [2, 12], to: [19, 26], memory: 'Claw marks score the pillars of the Pillared Hall, and something shuffles in the dark between them.' },
		{ name: 'Ossuary', from: [29, 13], to: [40, 24], memory: 'The Ossuary reeks of rot, and old bones crunch underfoot.' },
		{ name: 'ThroneCrypt', from: [46, 9], to: [62, 31], memory: 'The HollowKing\'s throne room, cold as the grave. Here he dies, and the treasure is ours.', memories: {
			Valerius: 'Steel barely scratches the HollowKing; Morrigan\'s witchfire burns him. I keep him off her while she hexes.',
			Seraphine: 'Steel barely scratches the HollowKing; Morrigan\'s witchfire burns him. I keep Morrigan alive above all.',
			Morrigan: 'Steel barely scratches the HollowKing, but my witchfire burns him: I hex him from behind Valerius.',
		} },
		{ name: 'Treasury', from: [51, 33], to: [58, 40], memory: 'Gold glints everywhere in the Treasury.' },
	],
	npcs: [
		// The company, in the Gatehouse.
		delver('Valerius', 'KnightMale', 8, 40.9, 90, { yaw: 0, streams: true, equip: SWORD, moves: ['cleave'] }),
		delver('Seraphine', 'Shaman', 6, 41, 50, { yaw: 0, streams: true, equip: ['shaman_staff'], packLoot: [{ defID: 'health_potion', name: 'HealthPotion', count: 2 }] }),
		delver('Morrigan', 'Witch', 7, 40, 50, { yaw: 0, streams: true, equip: STAFF }),
		// Pillared Hall.
		// Only the CultWitch and the HollowKing are quick enough to dodge; the rest take every blow that reaches them.
		delver('Ghoul1', 'Ghoul', 10, 17, 16, DULL),
		delver('Ghoul2', 'Ghoul', 13, 21, 10, DULL),
		delver('BoneArcher1', 'SkeletonArcher', 16, 13, 8, { ...DULL, equip: BONE_BOW }),
		// Ossuary.
		delver('Skeleton1', 'SkeletonWarrior', 31, 19, 8, { ...DULL, equip: SWORD }),
		delver('Skeleton2', 'SkeletonWarrior', 37, 19, 8, { ...DULL, equip: SWORD }),
		delver('CultWitch', 'Sorceress', 34, 15, 8, { equip: STAFF }),
		// Throne Crypt.
		delver('HollowKing', 'SkeletonKing', 54, 11, 36, {
			yaw: Math.PI,
			equip: SWORD,
			weakness: { to: ['hex'], times: 3, others: 0.5 },
			// A dead king: the lowest voice here, slow and flat.
			voice: { pitch: 140, rate: 3.8, range: 0.4 },
		}),
		delver('BoneArcher2', 'SkeletonArcher', 56, 11, 8, { ...DULL, yaw: Math.PI, equip: BONE_BOW }),
		delver('Skeleton3', 'SkeletonWarrior', 50, 20, 8, { ...DULL, equip: SWORD }),
		delver('Ghoul3', 'Ghoul', 59, 20, 14, DULL),
	],
	ambient: 'Black stone halls of the crypt, deep under the hills, lit by old torches.',
	keys: SCENE_KEYS,
	brief: `A company of three, Valerius the knight, Seraphine the healer and Morrigan the witch, goes down into the Sunken Crypt for the SunCrown in its treasury. Kaelen, their archer, is you: set Player to Participant to join them, or stay an Observer and watch. Valerius gives the orders and Seraphine solves every puzzle; if either falls, Morrigan takes the post.

Five rooms lie between them and the crown, joined by winding passages with dead ends. North of the Gatehouse, a Cobweb chokes the way out of the Storeroom; a flame burns it, and a WoodenTorch lies among the Storeroom's junk. In the Pillared Hall, SealedDoor opens to whoever speaks the answer to the riddle on RiddleStone (footsteps). The Ossuary keeps CryptKey in OssuaryChest, and CryptKey opens CryptGate. Beyond it the HollowKing guards the Throne Crypt. Everyone knows his weakness: steel and arrows barely scratch him, but witchfire burns, so Morrigan's hex does triple damage. When he falls, HoardGate opens on the Treasury, and the SunCrown waits in HoardChest.

Monsters in each room wake when the company comes in sight and fight to the death. It is done when someone in the company holds the SunCrown.`,
	createDirector: createDungeonDirector,
};

export const RIVER_GLEN:SceneDef = {
	id: 'glen',
	title: 'River Glen',
	look: 'glen',
	minimapFollow: true,
	// Looking south-east across the river, the glen's first sight.
	camera: { yaw: Math.PI * 1.33, zoom: 20 },
	carried: 'everyone',
	inspect: true,
	chunks: [glen_0_0, glen_1_0, glen_0_1, glen_1_1],
	npcs: [
		{
			id: 'Forager',
			meshID: 'Scout',
			chunkID: 'glen_1_1',
			localX: 9,
			localZ: 3,
			pack: true,
			wallet: 5,
			// Young and quick: a bright, mousy squeak.
			voice: { pitch: 340, rate: 6.6, range: 1.4 },
		},
		{
			id: 'BridgeKeeper',
			meshID: 'Robe',
			chunkID: 'glen_1_0',
			localX: 8,
			localZ: 9,
			pack: true,
			packLoot: [{ defID: 'bridge_crank', name: 'BridgeCrank' }],
			merchant: { goods: ['FireMushroom'] },
			// Old and slow: low and flat.
			voice: { pitch: 170, rate: 4.4, range: 0.6 },
		},
		{
			id: 'Angler',
			meshID: 'VillagerMale',
			chunkID: 'glen_1_1',
			// On the chair on the bank, fishing, until the bridge comes down.
			localX: 11,
			localZ: 8,
			yaw: 0,
			seated: { rod: true },
			pack: true,
			wallet: 5,
			packLoot: [{ defID: 'silver_trout', name: 'SilverTrout' }],
			merchant: { goods: ['SilverTrout'] },
			// Easygoing: warm and sing-song.
			voice: { pitch: 195, rate: 5, range: 1.6 },
		},
		// Toggled off with ASSISTANT in `director/scenes/glen.ts`.
		// {
		// 	id: 'Assistant',
		// 	meshID: 'Sorceress',
		// 	chunkID: 'glen_1_0',
		// 	localX: 5,
		// 	localZ: 11,
		// 	pack: true,
		// 	companion: true,
		// 	hearOnly: ['Player'],
		// 	// Crisp and clear: the highest.
		// 	voice: { pitch: 390, rate: 6 },
		// },
	],
	ravens: [{ x: 8.5, z: 12.5, yaw: 1 }, { x: 9.3, z: 13.4, yaw: -2 }, { x: 15.5, z: 26.5 }],
	ambient: 'A windy river glen.',
	keys: SCENE_KEYS,
	brief: `The forager, the bridge keeper, and the angler each need a different end to the same errand.

The angler is on the other side of the river, so the forager must cross the bridge to reach him. Lowering it costs 10 gold. The forager is carrying 5, enough for the trout and not the bridge. A mushroom in the west woods is worth 10, and the keeper accepts anything of equal value, so the forager pays with one, crosses, and spends their 5 on the trout.

The angler wants that mushroom, which the keeper sells for 10 gold. The angler starts with 5, takes 5 for the trout, and spends that 10 buying it.

End condition: the bridge is down, the keeper has 10 gold, the forager has a trout, and the angler has a mushroom.`,
	createDirector: createGlenDirector,
};

export const MARKETPLACE:SceneDef = {
	id: 'marketplace',
	title: 'Marketplace',
	look: 'market',
	lightLevel: 0.1,
	minimapFollow: true,
	carried: 'shoppers',
	inspect: true,
	player: { wallet: 20 },
	chunks: [market_0_0, market_1_0, market_0_1, market_1_1],
	npcs: [
		{
			id: 'Baker',
			meshID: 'VillagerMale',
			chunkID: 'market_0_0',
			localX: 5,
			localZ: 3,
			yaw: Math.PI,
			pack: true,
			packLoot: packOf('Baker'),
			wallet: 18,
			merchant: { goods: goodsOf('Baker') },
			marketNPC: { kind: 'vendor', wants: ['Knife'], post: 'BakerStall' },
		},
		{
			id: 'Weaver',
			meshID: 'Shaman',
			chunkID: 'market_0_0',
			localX: 9,
			localZ: 3,
			yaw: Math.PI,
			pack: true,
			packLoot: packOf('Weaver'),
			wallet: 14,
			merchant: { goods: goodsOf('Weaver') },
			marketNPC: { kind: 'vendor', wants: ['Loaf'], post: 'WeaverStall' },
		},
		{
			id: 'Apothecary',
			meshID: 'Witch',
			chunkID: 'market_1_0',
			localX: 10,
			localZ: 3,
			yaw: Math.PI,
			pack: true,
			packLoot: packOf('Apothecary'),
			wallet: 20,
			merchant: { goods: goodsOf('Apothecary') },
			marketNPC: { kind: 'vendor', wants: ['Jug'], post: 'ApothecaryCounter' },
		},
		{
			id: 'Potter',
			meshID: 'Sorceress',
			chunkID: 'market_0_1',
			localX: 6,
			localZ: 11,
			pack: true,
			packLoot: packOf('Potter'),
			wallet: 16,
			merchant: { goods: goodsOf('Potter') },
			marketNPC: { kind: 'vendor', wants: ['Scarf'], post: 'PotterStall' },
		},
		{
			id: 'Cutler',
			meshID: 'Blacksmith',
			chunkID: 'market_0_1',
			localX: 13,
			localZ: 11,
			pack: true,
			packLoot: packOf('Cutler'),
			wallet: 22,
			merchant: { goods: goodsOf('Cutler') },
			marketNPC: { kind: 'vendor', wants: ['Bowl'], post: 'CutlerStall' },
		},
		{
			id: 'Grocer',
			meshID: 'Merchant',
			chunkID: 'market_1_1',
			localX: 4,
			localZ: 11,
			pack: true,
			packLoot: packOf('Grocer'),
			wallet: 12,
			merchant: { goods: goodsOf('Grocer') },
			marketNPC: { kind: 'vendor', wants: ['Shears'], post: 'FruitStall' },
		},
		{
			id: 'Toymaker',
			meshID: 'Robe',
			chunkID: 'market_1_1',
			localX: 11,
			localZ: 13,
			offset: { x: 0, z: 0.75 },
			pack: true,
			packLoot: packOf('Toymaker'),
			wallet: 9,
			merchant: { goods: goodsOf('Toymaker') },
			marketNPC: { kind: 'vendor', wants: ['Ribbon'], post: 'ToyCounter' },
		},
		{
			id: 'Mira',
			meshID: 'Scout',
			chunkID: 'market_0_0',
			localX: 9,
			localZ: 13,
			pack: true,
			wallet: 6,
			marketNPC: { kind: 'customer', wants: ['Loaf'], leaveGate: 'EastGate' },
		},
		{
			id: 'Tomas',
			meshID: 'Merchant',
			chunkID: 'market_1_0',
			localX: 6,
			localZ: 12,
			yaw: Math.PI / 2,
			pack: true,
			wallet: 15,
			marketNPC: { kind: 'customer', wants: ['Knife', 'Bowl'], leaveGate: 'WestGate' },
		},
		{
			id: 'Nell',
			meshID: 'VillagerFemale',
			chunkID: 'market_0_1',
			localX: 9,
			localZ: 4,
			yaw: -Math.PI / 2,
			pack: true,
			packLoot: [{ defID: 'apple', name: 'Apple', count: 2 }],
			wallet: 7,
			marketNPC: { kind: 'customer', wants: ['Scarf'], leaveGate: 'WestGate' },
		},
		{
			id: 'Rook',
			meshID: 'Rogue',
			chunkID: 'market_1_1',
			localX: 8,
			localZ: 4,
			pack: true,
			wallet: 8,
			marketNPC: { kind: 'customer', wants: ['Loaf'], leaveGate: 'WestGate' },
		},
		{
			id: 'Ferris',
			meshID: 'KnightFemale',
			chunkID: 'market_1_1',
			localX: 12,
			localZ: 4,
			pack: true,
			wallet: 7,
			marketNPC: { kind: 'customer', wants: ['Tonic'], leaveGate: 'EastGate' },
		},
		{
			id: 'Lisa',
			meshID: 'VillagerFemale',
			chunkID: 'market_0_0',
			localX: 3,
			localZ: 10,
			pack: true,
			wallet: 9,
			marketNPC: { kind: 'customer', wants: ['WoodenHorse'], leaveGate: 'WestGate' },
		},
		{
			id: 'Holt',
			meshID: 'KnightMale',
			chunkID: 'market_0_0',
			localX: 1,
			localZ: 8,
			yaw: -Math.PI / 2,
			pack: true,
			marketNPC: { kind: 'guard', wants: [], leaveGate: 'WestGate' },
			equip: SWORD,
		},
		{
			id: 'Brant',
			meshID: 'KnightMale',
			chunkID: 'market_1_1',
			localX: 14,
			localZ: 6,
			yaw: Math.PI / 2,
			pack: true,
			marketNPC: { kind: 'guard', wants: [], leaveGate: 'EastGate' },
			equip: SWORD,
		},
	],
	ambient: 'An open-air market split by a canal, crossed by three footbridges.',
	keys: SCENE_KEYS,
	brief: `Seven sellers think for themselves, each with their own voice. Everyone else in the square is steered by one mind that has no character of its own.

The baker, the weaver, the apothecary, the potter, the knife-seller, the grocer and the toymaker each stay at their post and never leave it: a stall in the open square, or a counter inside their own shop (the apothecary's and the toymaker's, built to their own shape and roof, bigger and smaller than the stalls around them). Each sells a few goods for a gold price, and answers a lower offer themselves. Shoppers arrive wanting something, with a purse that may not cover it, look around, and buy when the price suits them. New shoppers keep arriving. A single guard holds each gate and takes back anything stolen.

That mind sees what each shopper wants and how much gold they carry, and what the stalls have posted. It sends them to look, to offer, and out by their own gate, and it keeps the guards at their posts. The sellers do not leave their posts. It is working when shoppers leave with their goods, some of them after a haggle, and someone who grabs something without paying gets caught.`,
	createDirector: createMarketDirector,
};

/** The ruins parties' colors: Dawn gold and crimson, Dusk teal and indigo. */
const DAWN_COLORS = { band: 0xf2c14e, rim: 0xb3262e };
const DUSK_COLORS = { band: 0x2bb3a6, rim: 0x3b2a8c };

/** A fighter in the ruins at map cell `x`, `z`, with `equip` in hand: Dawn's on the west half, Dusk's on the east. */
function fighter(id:string, meshID:string, x:number, z:number, hp:number, equip:string[]):NPCSpawnDef {
	const dawn = x < 32;
	return { id, meshID, ...mapCell('ruins', x, z), yaw: dawn ? -Math.PI / 2 : Math.PI / 2, pack: true, equip, hp, team: dawn ? DAWN_COLORS : DUSK_COLORS };
}

export const RUINS:SceneDef = {
	id: 'ruins',
	title: '5v5 Combat',
	look: 'glen',
	healthBars: true,
	minimapFollow: true,
	player: { equip: ['iron_sword'] },
	chunks: RUINS_CHUNKS,
	// Each party starts in its colonnade a couple of paces behind its places by the sanctum's gap: Dawn in the west,
	// Dusk in the east. The sanctum and its dais lie between them.
	npcs: [
		fighter('Brune', 'KnightMale', 24, 14, 28, SWORD),
		fighter('Cade', 'Blacksmith', 24, 17, 20, SWORD),
		fighter('Wisp', 'Scout', 23, 12, 12, BOW),
		fighter('Cinder', 'Witch', 23, 19, 12, STAFF),
		fighter('Dawn', 'Shaman', 22, 16, 12, ['shaman_staff']),
		fighter('Helms', 'KnightFemale', 39, 14, 28, SWORD),
		fighter('Flint', 'VillagerMale', 39, 17, 20, SWORD),
		fighter('Ash', 'Rogue', 40, 12, 12, BOW),
		fighter('Nyx', 'Sorceress', 40, 19, 12, STAFF),
		fighter('Dusk', 'Robe', 41, 16, 12, ['shaman_staff']),
	],
	ravens: [{ x: 31.5, z: 3.5, yaw: 2.4 }, { x: 32.4, z: 4.1 }],
	// The middle of the 4×2 map: the sanctum and its dais.
	orbit: { x: 32, z: 16 },
	// Back far enough to see the ruins whole, south of the dais.
	camera: { zoom: 20 },
	ambient: 'Two parties fight to the death in a ruined forest temple. No quarter.',
	keys: [...SCENE_KEYS, ...SWORD_KEYS],
	brief: `Dawn and Dusk are the two captains. Each leads a squad of five: a knight, a swordsman, an archer, a witch, and the captain, who also heals. Both squads start in the ruined temple's colonnades, each a few steps from its line by the sanctum, and hold their ground: nobody moves on the enemy or attacks until their captain orders it. On their own they only block, keep the back line back, and the captain heals.

A captain writes orders the squad keeps following, who to hit and who stays back, and standing rules for the whole fight, and changes those orders as the fight moves. The usual way a side wins is the knight and the swordsman hold the nearest enemies, the archer and the witch shoot from behind them, and the captain stays clear and heals.

If a captain dies, someone else in the squad takes over. It ends when one squad is gone.`,
	createDirector: createRuinsDirector,
};

export const SCENES:Record<string, SceneDef> = {
	dungeon_vault: DUNGEON_VAULT,
	glen: RIVER_GLEN,
	marketplace: MARKETPLACE,
	ruins: RUINS,
};

export const DEFAULT_SCENE_ID = 'dungeon_vault';

export function sceneByID(id:string):SceneDef {
	return SCENES[id] ?? DUNGEON_VAULT;
}
