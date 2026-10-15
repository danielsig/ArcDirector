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
import type { NPCSpawnOpts, RoomDef } from '../world/spawn';
import type { GroundTile } from '../render/groundBox';
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

export type SceneDef = {
	id:string;
	title:string;
	look:SceneLook;
	/** Tile drawn around the map, out to the horizon. Grass when unset. */
	ground?:GroundTile;
	/** Health bars over the characters, for scenes that fight. */
	healthBars?:boolean;
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
	/** Camera distance from the player at the start, in meters; the camera's default when unset. */
	zoom?:number;
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
function delver(id:string, meshID:string, x:number, z:number, hp:number, extra:Partial<NPCSpawnDef> = {}):NPCSpawnDef {
	return { id, meshID, ...mapCell('dungeon', x, z), hp, pack: true, ...extra };
}

export const DUNGEON_VAULT:SceneDef = {
	id: 'dungeon_vault',
	title: 'Dungeon Crawl',
	look: 'dungeon',
	ground: 'floor',
	healthBars: true,
	minimapFollow: true,
	// Play as Participant and the company's archer, Derek, is you.
	player: { name: 'Derek', tags: ['Archer'], equip: ['short_bow'] },
	chunks: DUNGEON_CHUNKS,
	rooms: [
		{ name: 'Gatehouse', from: [3, 37], to: [12, 44] },
		{ name: 'PillaredHall', from: [2, 12], to: [19, 26] },
		{ name: 'Ossuary', from: [29, 13], to: [40, 24] },
		{ name: 'ThroneCrypt', from: [46, 9], to: [62, 31] },
		{ name: 'Treasury', from: [51, 33], to: [58, 40] },
	],
	npcs: [
		// The company, in the Gatehouse.
		delver('Bram', 'KnightMale', 8, 40, 28, { yaw: 0, streams: true, equip: SWORD }),
		delver('Maren', 'Shaman', 6, 40, 14, { yaw: 0, streams: true, equip: ['shaman_staff'], packLoot: [{ defID: 'health_potion', name: 'HealthPotion', count: 2 }] }),
		delver('Wren', 'Witch', 7, 39, 14, { yaw: 0, streams: true, equip: STAFF }),
		// Pillared Hall.
		delver('Ghoul1', 'Ghoul', 10, 17, 16),
		delver('Ghoul2', 'Ghoul', 13, 21, 10),
		delver('BoneArcher1', 'SkeletonArcher', 16, 13, 8, { equip: BONE_BOW }),
		// Ossuary.
		delver('Skeleton1', 'SkeletonWarrior', 31, 19, 8, { equip: SWORD }),
		delver('Skeleton2', 'SkeletonWarrior', 37, 19, 8, { equip: SWORD }),
		delver('CultWitch', 'Sorceress', 34, 15, 8, { equip: STAFF }),
		// Throne Crypt.
		delver('HollowKing', 'SkeletonKing', 54, 11, 36, {
			yaw: Math.PI,
			equip: SWORD,
			weakness: { to: ['hex'], times: 3, others: 0.5 },
			// A dead king: the lowest voice here, slow and flat.
			voice: { pitch: 140, rate: 3.8, range: 0.4 },
		}),
		delver('BoneArcher2', 'SkeletonArcher', 56, 11, 8, { yaw: Math.PI, equip: BONE_BOW }),
		delver('Skeleton3', 'SkeletonWarrior', 50, 20, 8, { equip: SWORD }),
		delver('Ghoul3', 'Ghoul', 59, 20, 14),
	],
	ambient: 'The Sunken Crypt: black stone halls under the hills, lit by old torches.',
	keys: SCENE_KEYS,
	brief: `A company of three, Bram the knight, Maren the healer and Wren the witch, goes down into the Sunken Crypt for the SunCrown in its treasury. Derek, their archer, is you: set Player to Participant to join them, or stay an Observer and watch.

Five rooms lie between them and the crown, joined by winding passages with dead ends. A Cobweb chokes the way north out of the Gatehouse; a flame burns it, and a WoodenTorch lies in the Gatehouse. In the Pillared Hall, SealedDoor opens to whoever speaks the answer to the riddle on RiddleStone (footsteps). The Ossuary keeps CryptKey in OssuaryChest, and CryptKey opens CryptGate. Beyond it the HollowKing guards the Throne Crypt. Everyone knows his weakness: steel and arrows barely scratch him, but witchfire burns, so Wren's hex does triple damage. When he falls, HoardGate opens on the Treasury, and the SunCrown waits in HoardChest.

Monsters in each room wake when the company comes in sight and fight to the death. It is done when someone in the company holds the SunCrown.`,
	createDirector: createDungeonDirector,
};

export const RIVER_GLEN:SceneDef = {
	id: 'glen',
	title: 'River Glen',
	look: 'glen',
	minimapFollow: true,
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
			localX: 8,
			localZ: 10,
			yaw: Math.PI,
			pack: true,
			wallet: 5,
			packLoot: [{ defID: 'silver_trout', name: 'SilverTrout' }],
			merchant: { goods: ['SilverTrout'] },
			// Easygoing: warm and sing-song.
			voice: { pitch: 195, rate: 5, range: 1.6 },
		},
		{
			id: 'Assistant',
			meshID: 'Sorceress',
			chunkID: 'glen_1_0',
			localX: 5,
			localZ: 11,
			pack: true,
			companion: true,
			hearOnly: ['Player'],
			// Crisp and clear: the highest.
			voice: { pitch: 390, rate: 6 },
		},
	],
	ravens: [{ x: 8.5, z: 12.5, yaw: 1 }, { x: 9.3, z: 13.4, yaw: -2 }, { x: 15.5, z: 26.5 }],
	ambient: 'A windy river glen.',
	keys: SCENE_KEYS,
	brief: `The forager, the bridge keeper, and the angler each need a different end to the same errand. The assistant only does what you ask.

The angler is on the other side of the river, so the forager must cross the bridge to reach him. Lowering it costs 10 gold. The forager is carrying 5, enough for the trout and not the bridge. A mushroom in the west woods is worth 10, and the keeper accepts anything of equal value, so the forager pays with one, crosses, and spends their 5 on the trout.

The angler wants that mushroom, which the keeper sells for 10 gold. The angler starts with 5, takes 5 for the trout, and spends that 10 buying it.

End condition: the bridge is down, the keeper has 10 gold, the forager has a trout, and the angler has a mushroom.`,
	createDirector: createGlenDirector,
};

export const MARKETPLACE:SceneDef = {
	id: 'marketplace',
	title: 'Marketplace',
	look: 'market',
	minimapFollow: true,
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
			localX: 12,
			localZ: 3,
			yaw: Math.PI,
			pack: true,
			packLoot: packOf('Weaver'),
			wallet: 14,
			merchant: { goods: goodsOf('Weaver') },
			marketNPC: { kind: 'vendor', wants: ['Loaf'], post: 'WeaverStall' },
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
			id: 'Mira',
			meshID: 'Scout',
			chunkID: 'market_0_0',
			localX: 9,
			localZ: 13,
			pack: true,
			wallet: 4,
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
			wallet: 3,
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
			id: 'Pike',
			meshID: 'KnightMale',
			chunkID: 'market_0_0',
			localX: 1,
			localZ: 10,
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
		{
			id: 'Cass',
			meshID: 'KnightFemale',
			chunkID: 'market_1_1',
			localX: 14,
			localZ: 8,
			yaw: Math.PI / 2,
			pack: true,
			marketNPC: { kind: 'guard', wants: [], leaveGate: 'EastGate' },
			equip: SWORD,
		},
	],
	ambient: 'An open-air market split by a canal, crossed by three footbridges.',
	keys: SCENE_KEYS,
	brief: `Four sellers think for themselves. Everyone else in the square is steered by one mind that has no character of its own.

The baker, the weaver, the potter, and the knife-seller each stay at their stall and never leave it. The baker sells four goods, the weaver three, the potter two, and the knife-seller four, each for a gold price. Shoppers show up wanting a specific item, trade for it, and leave through a gate. New shoppers keep arriving. Guards stand beside the gates, one on each side of the doorway, and take back anything stolen.

That mind sends each shopper to the stall that sells what they tagged, then to the gate they leave by, and keeps the guards at their posts. The sellers do not leave their stalls. It is working when shoppers leave with their goods, and someone who grabs something without paying gets caught.`,
	createDirector: createMarketDirector,
};

/** The ruins parties' colors: Dawn gold and crimson, Dusk teal and indigo. */
const DAWN_COLORS = { band: 0xf2c14e, rim: 0xb3262e };
const DUSK_COLORS = { band: 0x2bb3a6, rim: 0x3b2a8c };

/** A fighter in the ruins at map cell `x`, `z`, with `equip` in hand: Dawn's on the west half, Dusk's on the east. */
function fighter(id:string, meshID:string, x:number, z:number, hp:number, equip:string[]):NPCSpawnDef {
	const dawn = x < 16;
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
	// Dawn holds the west colonnade, Dusk the east; the sanctum and its dais lie between them.
	npcs: [
		fighter('Dawn', 'Shaman', 5, 15, 12, ['shaman_staff']),
		fighter('Cinder', 'Witch', 6, 18, 12, STAFF),
		fighter('Brune', 'KnightMale', 9, 14, 28, SWORD),
		fighter('Wisp', 'Scout', 6, 12, 12, BOW),
		fighter('Cade', 'Blacksmith', 9, 17, 20, SWORD),
		fighter('Dusk', 'Robe', 26, 15, 12, ['shaman_staff']),
		fighter('Nyx', 'Sorceress', 25, 18, 12, STAFF),
		fighter('Helms', 'KnightFemale', 22, 14, 28, SWORD),
		fighter('Ash', 'Rogue', 25, 12, 12, BOW),
		fighter('Flint', 'VillagerMale', 22, 17, 20, SWORD),
	],
	ravens: [{ x: 15.5, z: 3.5, yaw: 2.4 }, { x: 16.4, z: 4.1 }],
	// The middle of the 2×2 map: the sanctum and its dais.
	orbit: { x: 16, z: 16 },
	// Back far enough to see both parties from the start, south of the dais.
	zoom: 15.5,
	ambient: 'Two parties fight to the death in a ruined forest temple. No quarter.',
	keys: [...SCENE_KEYS, ...SWORD_KEYS],
	brief: `Dawn and Dusk are the two captains. Each leads a squad of five: a knight, a swordsman, an archer, a witch, and the captain, who also heals. Both sides are trying to kill the other. Nobody has a scripted attack.

A captain writes orders the squad keeps following, who to hit and who stays back, and changes those orders as the fight moves. The usual way a side wins is the knight and the swordsman hold the nearest enemies, the archer and the witch shoot from behind them, and the captain stays clear and heals. Hurt fighters walk back to their captain instead of standing in the melee.

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
