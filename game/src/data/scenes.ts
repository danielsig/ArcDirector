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
import type { HumanKind } from '../engine/components';
import type { NPCSpawnOpts } from '../world/spawn';
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

export type SceneDef = {
	id:string;
	title:string;
	look:SceneLook;
	chunks:ChunkFile[];
	npcs:NPCSpawnDef[];
	ambient:string;
	/** Player keys for this scene, besides the ones every scene shares. */
	keys:SceneKey[];
	/** One paragraph: what this scene is for, and how the characters usually get there. */
	brief:string;
	player?:PlayerDef;
	/** Player stays centered and the chunk-sized map scrolls. `false` = current chunk, moving arrow. */
	minimapFollow?:boolean;
	createDirector:(host:GameHost)=>ArcDirector<CharacterCtx>;
};

/** Someone in the crypt at map cell `x`, `z`. */
function delver(id:string, meshID:string, x:number, z:number, hp:number, extra:Partial<NPCSpawnDef> = {}):NPCSpawnDef {
	return { id, meshID, ...mapCell('dungeon', x, z), hp, pack: true, ...extra };
}

export const DUNGEON_VAULT:SceneDef = {
	id: 'dungeon_vault',
	title: 'Dungeon Crawl',
	look: 'dungeon',
	minimapFollow: true,
	// Turn Observer off and the company's archer, Derek, is you.
	player: { name: 'Derek', tags: ['Archer'], equip: ['short_bow'] },
	chunks: DUNGEON_CHUNKS,
	npcs: [
		// The company, in the Gatehouse.
		delver('Bram', 'human_guard', 8, 40, 28, { yaw: 0, streams: true }),
		delver('Maren', 'human_robe', 6, 40, 14, { yaw: 0, streams: true, packLoot: [{ defID: 'health_potion', name: 'HealthPotion', count: 2 }] }),
		delver('Wren', 'human_witch', 7, 39, 14, { yaw: 0, streams: true }),
		// Pillared Hall.
		delver('Ghoul1', 'human_mannequin', 10, 17, 16),
		delver('Ghoul2', 'human_mannequin', 13, 21, 10),
		delver('BoneArcher1', 'human_scout', 16, 13, 8),
		// Ossuary.
		delver('Skeleton1', 'human_mannequin', 31, 19, 8),
		delver('Skeleton2', 'human_mannequin', 37, 19, 8),
		delver('CultWitch', 'human_sorceress', 34, 15, 8),
		// Throne Crypt.
		delver('HollowKing', 'human_guard', 54, 11, 36, {
			yaw: Math.PI,
			weakness: { to: ['hex'], times: 3, others: 0.5 },
			// A dead king: the lowest voice here, slow and flat.
			voice: { pitch: 140, rate: 3.8, range: 0.4 },
		}),
		delver('BoneArcher2', 'human_scout', 56, 11, 8, { yaw: Math.PI }),
		delver('Skeleton3', 'human_mannequin', 50, 20, 8),
		delver('Ghoul3', 'human_mannequin', 59, 20, 14),
	],
	ambient: 'The Sunken Crypt: black stone halls under the hills, lit by old torches.',
	keys: SCENE_KEYS,
	brief: `A company of three, Bram the knight, Maren the healer and Wren the witch, goes down into the Sunken Crypt for the SunCrown in its treasury. Derek, their archer, is you: turn Observer off to join them, or leave it on and watch.

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
			meshID: 'human_scout',
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
			meshID: 'human_robe',
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
			meshID: 'human_merchant',
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
			meshID: 'human_sorceress',
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
			meshID: 'human_robe',
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
			meshID: 'human_princess',
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
			meshID: 'human_sorceress',
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
			meshID: 'human_guard',
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
			meshID: 'human_mannequin',
			chunkID: 'market_0_0',
			localX: 9,
			localZ: 13,
			pack: true,
			wallet: 4,
			marketNPC: { kind: 'customer', wants: ['Loaf'], leaveGate: 'EastGate' },
		},
		{
			id: 'Tomas',
			meshID: 'human_merchant',
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
			meshID: 'human_princess',
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
			meshID: 'human_mannequin',
			chunkID: 'market_1_1',
			localX: 8,
			localZ: 4,
			pack: true,
			wallet: 8,
			marketNPC: { kind: 'customer', wants: ['Loaf'], leaveGate: 'WestGate' },
		},
		{
			id: 'Holt',
			meshID: 'human_guard',
			chunkID: 'market_0_0',
			localX: 1,
			localZ: 8,
			yaw: -Math.PI / 2,
			pack: true,
			marketNPC: { kind: 'guard', wants: [], leaveGate: 'WestGate' },
		},
		{
			id: 'Pike',
			meshID: 'human_guard',
			chunkID: 'market_0_0',
			localX: 1,
			localZ: 10,
			yaw: -Math.PI / 2,
			pack: true,
			marketNPC: { kind: 'guard', wants: [], leaveGate: 'WestGate' },
		},
		{
			id: 'Brant',
			meshID: 'human_guard',
			chunkID: 'market_1_1',
			localX: 14,
			localZ: 6,
			yaw: Math.PI / 2,
			pack: true,
			marketNPC: { kind: 'guard', wants: [], leaveGate: 'EastGate' },
		},
		{
			id: 'Cass',
			meshID: 'human_guard',
			chunkID: 'market_1_1',
			localX: 14,
			localZ: 8,
			yaw: Math.PI / 2,
			pack: true,
			marketNPC: { kind: 'guard', wants: [], leaveGate: 'EastGate' },
		},
	],
	ambient: 'An open-air market split by a canal, crossed by three footbridges.',
	keys: SCENE_KEYS,
	brief: `Four sellers think for themselves. Everyone else in the square is steered by one mind that has no character of its own.

The baker, the weaver, the potter, and the knife-seller each stay at their stall and never leave it. The baker sells four goods, the weaver three, the potter two, and the knife-seller four, each for a gold price. Shoppers show up wanting a specific item, trade for it, and leave through a gate. New shoppers keep arriving. Guards stand beside the gates, one on each side of the doorway, and take back anything stolen.

That mind sends each shopper to the stall that sells what they tagged, then to the gate they leave by, and keeps the guards at their posts. The sellers do not leave their stalls. It is working when shoppers leave with their goods, and someone who grabs something without paying gets caught.`,
	createDirector: createMarketDirector,
};

const SWORD = [{ defID: 'iron_sword', name: 'IronSword' }];

/** A fighter in the ruins at map cell `x`, `z`. */
function fighter(id:string, meshID:string, x:number, z:number, hp:number, sword = false):NPCSpawnDef {
	return { id, meshID, ...mapCell('ruins', x, z), yaw: x < 16 ? -Math.PI / 2 : Math.PI / 2, pack: true, packLoot: sword ? SWORD : undefined, hp };
}

export const RUINS:SceneDef = {
	id: 'ruins',
	title: '5v5 Combat',
	look: 'glen',
	minimapFollow: true,
	player: { equip: ['iron_sword'] },
	chunks: RUINS_CHUNKS,
	// Dawn holds the west colonnade, Dusk the east; the sanctum and its dais lie between them.
	npcs: [
		fighter('Dawn', 'human_robe', 5, 15, 12),
		fighter('Cinder', 'human_witch', 6, 18, 12),
		fighter('Brune', 'human_guard', 9, 14, 28, true),
		fighter('Wisp', 'human_scout', 6, 12, 12),
		fighter('Cade', 'human_mannequin', 9, 17, 20, true),
		fighter('Dusk', 'human_sorceress', 26, 15, 12),
		fighter('Nyx', 'human_witch', 25, 18, 12),
		fighter('Helms', 'human_guard', 22, 14, 28, true),
		fighter('Ash', 'human_scout', 25, 12, 12),
		fighter('Flint', 'human_mannequin', 22, 17, 20, true),
	],
	ambient: 'Two parties fight to the death in a ruined forest temple. No quarter.',
	keys: SCENE_KEYS,
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

export function humanKindsForScene(scene:SceneDef):HumanKind[] {
	const set = new Set<HumanKind>(['player']);
	for (const npc of scene.npcs) {
		if (npc.meshID === 'human') {
			throw new Error(`${scene.id} NPC ${npc.id} meshID 'human' is the player; use human_<kind>`);
		}
		if (npc.meshID.startsWith('human_')) {
			set.add(npc.meshID.slice('human_'.length));
		}
	}
	return [...set];
}
