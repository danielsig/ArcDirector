import type { ArcDirector } from 'arc-director';
import type { ChunkFile } from '../world/decodeGlyphChunk';
import { dungeon_0_0 } from './chunks/dungeon_0_0';
import { dungeon_1_0 } from './chunks/dungeon_1_0';
import { glen_0_0 } from './chunks/glen_0_0';
import { glen_0_1 } from './chunks/glen_0_1';
import { glen_1_0 } from './chunks/glen_1_0';
import { glen_1_1 } from './chunks/glen_1_1';
import { market_0_0 } from './chunks/market_0_0';
import { market_1_0 } from './chunks/market_1_0';
import { ruins_0_0 } from './chunks/ruins_0_0';
import { ruins_1_0 } from './chunks/ruins_1_0';
import { type MarketNPCKind, type HumanKind } from '../engine/components';
import type { GameHost, CharacterCtx } from '../director/adapter';
import { createDirector as createDungeonDirector } from '../director/scenes/dungeon';
import { createDirector as createGlenDirector } from '../director/scenes/glen';
import { createDirector as createMarketDirector } from '../director/scenes/market';
import { createDirector as createRuinsDirector } from '../director/scenes/ruins';

export type NPCSpawnDef = {
	id:string;
	meshID:string;
	chunkID:string;
	localX:number;
	localZ:number;
	yaw?:number;
	pack?:boolean;
	packLoot?:{ defID:string; name:string; count?:number }[];
	wallet?:number;
	hp?:number;
	merchant?:{ specialty:string; ask:number; floor:number };
	marketNPC?:{ kind:MarketNPCKind; wants:string[]; leaveGate?:string };
	companion?:boolean;
	/** Speaker ids this NPC hears. Omit to hear everyone in earshot. */
	hearOnly?:string[];
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
	playerWallet?:number;
	/** Player stays centered and the chunk-sized map scrolls. `false` = current chunk, moving arrow. */
	minimapFollow?:boolean;
	createDirector:(host:GameHost)=>ArcDirector<CharacterCtx>;
};

export const DUNGEON_VAULT:SceneDef = {
	id: 'dungeon_vault',
	title: 'Dungeon Vault',
	look: 'dungeon',
	minimapFollow: true,
	chunks: [dungeon_0_0, dungeon_1_0],
	npcs: [
		{ id: 'Fern', meshID: 'human_princess', chunkID: 'dungeon_0_0', localX: 5, localZ: 10, pack: true },
		{ id: 'Sable', meshID: 'human_sorceress', chunkID: 'dungeon_0_0', localX: 8, localZ: 10, pack: true },
		{
			id: 'Lys',
			meshID: 'human_guard',
			chunkID: 'dungeon_0_0',
			localX: 11,
			localZ: 10,
			yaw: Math.PI,
			pack: true,
			packLoot: [
				{ defID: 'gold_coin', name: 'GoldCoin' },
				{ defID: 'iron_key', name: 'ChestKey' },
			],
		},
	],
	ambient: 'A damp stone hall of the dungeon. Vault, with the sickbeds, lies beyond EastGate.',
	keys: SCENE_KEYS,
	brief: `Three people in this dungeon each want one thing, and none of them can do it alone. Each one only knows their own goal. They have to talk and hand things to each other.

Fern wants her son Noll to get well. Lys, captain of the watch, wants her sister Lina to get well. Both are lying sick in beds in a back room, behind a locked gate, and the herb they need grows in that room. Lys is carrying gold and the key to a locked chest. Sable is the alchemist. She brews at her fireplace only once she is paid: the herb and that gold coin become two potions. She keeps the coin and gives the potions away. Only she knows the chest holds the key to the gate.

The usual way through is to open the chest, unlock the gate, pick the herb, pay Sable, brew, and give one potion to each patient.`,
	createDirector: createDungeonDirector,
};

export const RIVER_GLEN:SceneDef = {
	id: 'glen',
	title: 'River Glen',
	look: 'glen',
	minimapFollow: true,
	chunks: [glen_0_0, glen_1_0, glen_0_1, glen_1_1],
	npcs: [
		{ id: 'Forager', meshID: 'human_scout', chunkID: 'glen_1_1', localX: 9, localZ: 3, pack: true, wallet: 5 },
		{
			id: 'BridgeKeeper',
			meshID: 'human_robe',
			chunkID: 'glen_1_0',
			localX: 8,
			localZ: 9,
			pack: true,
			packLoot: [{ defID: 'bridge_crank', name: 'BridgeCrank' }],
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
	playerWallet: 20,
	chunks: [market_0_0, market_1_0],
	npcs: [
		{
			id: 'Baker',
			meshID: 'human_robe',
			chunkID: 'market_0_0',
			localX: 3,
			localZ: 3,
			yaw: Math.PI,
			pack: true,
			packLoot: [{ defID: 'loaf', name: 'Loaf', count: 3 }],
			wallet: 18,
			merchant: { specialty: 'Loaf', ask: 5, floor: 3 },
			marketNPC: { kind: 'vendor', wants: ['Knife'] },
		},
		{
			id: 'Weaver',
			meshID: 'human_princess',
			chunkID: 'market_0_0',
			localX: 12,
			localZ: 3,
			yaw: Math.PI,
			pack: true,
			packLoot: [{ defID: 'scarf', name: 'Scarf', count: 2 }],
			wallet: 14,
			merchant: { specialty: 'Scarf', ask: 6, floor: 4 },
			marketNPC: { kind: 'vendor', wants: ['Loaf'] },
		},
		{
			id: 'Potter',
			meshID: 'human_sorceress',
			chunkID: 'market_0_0',
			localX: 3,
			localZ: 10,
			pack: true,
			packLoot: [{ defID: 'bowl', name: 'Bowl', count: 3 }],
			wallet: 16,
			merchant: { specialty: 'Bowl', ask: 4, floor: 2 },
			marketNPC: { kind: 'vendor', wants: ['Scarf'] },
		},
		{
			id: 'Cutler',
			meshID: 'human_guard',
			chunkID: 'market_0_0',
			localX: 12,
			localZ: 10,
			pack: true,
			packLoot: [{ defID: 'kitchen_knife', name: 'Knife', count: 2 }],
			wallet: 22,
			merchant: { specialty: 'Knife', ask: 7, floor: 4 },
			marketNPC: { kind: 'vendor', wants: ['Bowl'] },
		},
		{
			id: 'Mira',
			meshID: 'human_mannequin',
			chunkID: 'market_0_0',
			localX: 8,
			localZ: 4,
			pack: true,
			wallet: 4,
			marketNPC: { kind: 'customer', wants: ['Loaf'], leaveGate: 'EastGate' },
		},
		{
			id: 'Tomas',
			meshID: 'human_merchant',
			chunkID: 'market_0_0',
			localX: 10,
			localZ: 8,
			yaw: Math.PI / 2,
			pack: true,
			wallet: 15,
			marketNPC: { kind: 'customer', wants: ['Knife', 'Bowl'], leaveGate: 'WestGate' },
		},
		{
			id: 'Nell',
			meshID: 'human_princess',
			chunkID: 'market_1_0',
			localX: 8,
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
			chunkID: 'market_1_0',
			localX: 10,
			localZ: 8,
			pack: true,
			wallet: 8,
			marketNPC: { kind: 'customer', wants: ['Loaf'], leaveGate: 'WestGate' },
		},
		{
			id: 'Holt',
			meshID: 'human_guard',
			chunkID: 'market_0_0',
			localX: 2,
			localZ: 7,
			yaw: -Math.PI / 2,
			pack: true,
			marketNPC: { kind: 'guard', wants: [], leaveGate: 'WestGate' },
		},
		{
			id: 'Pike',
			meshID: 'human_guard',
			chunkID: 'market_0_0',
			localX: 2,
			localZ: 8,
			yaw: -Math.PI / 2,
			pack: true,
			marketNPC: { kind: 'guard', wants: [], leaveGate: 'WestGate' },
		},
		{
			id: 'Brant',
			meshID: 'human_guard',
			chunkID: 'market_1_0',
			localX: 13,
			localZ: 7,
			yaw: Math.PI / 2,
			pack: true,
			marketNPC: { kind: 'guard', wants: [], leaveGate: 'EastGate' },
		},
		{
			id: 'Cass',
			meshID: 'human_guard',
			chunkID: 'market_1_0',
			localX: 13,
			localZ: 8,
			yaw: Math.PI / 2,
			pack: true,
			marketNPC: { kind: 'guard', wants: [], leaveGate: 'EastGate' },
		},
	],
	ambient: 'A canal-side market plaza under colored awnings.',
	keys: SCENE_KEYS,
	brief: `Four sellers think for themselves. Everyone else in the square is steered by one mind that has no character of its own.

The baker, the weaver, the potter, and the knife-seller each stay at a stall, sell one thing, and want something from another stall. Shoppers show up wanting a specific item, buy it, and leave through a gate. New shoppers keep arriving. Guards stand at the gates and take back anything stolen.

That mind sends each shopper to the stall that sells what they came for, then to the gate they leave by, and keeps the guards at their posts. The sellers haggle and can buy for themselves. It is working when shoppers leave with their goods, and someone who grabs something without paying gets caught.`,
	createDirector: createMarketDirector,
};

const SWORD = [{ defID: 'iron_sword', name: 'IronSword' }];

export const RUINS:SceneDef = {
	id: 'ruins',
	title: '5v5 Combat',
	look: 'glen',
	minimapFollow: true,
	chunks: [ruins_0_0, ruins_1_0],
	npcs: [
		{ id: 'Dawn', meshID: 'human_robe', chunkID: 'ruins_0_0', localX: 4, localZ: 8, yaw: -Math.PI / 2, pack: true, hp: 12 },
		{ id: 'Cinder', meshID: 'human_witch', chunkID: 'ruins_0_0', localX: 5, localZ: 11, yaw: -Math.PI / 2, pack: true, hp: 12 },
		{ id: 'Brune', meshID: 'human_guard', chunkID: 'ruins_0_0', localX: 10, localZ: 9, yaw: -Math.PI / 2, pack: true, packLoot: SWORD, hp: 28 },
		{ id: 'Wisp', meshID: 'human_scout', chunkID: 'ruins_0_0', localX: 5, localZ: 5, yaw: -Math.PI / 2, pack: true, hp: 12 },
		{ id: 'Cade', meshID: 'human_mannequin', chunkID: 'ruins_0_0', localX: 10, localZ: 7, yaw: -Math.PI / 2, pack: true, packLoot: SWORD, hp: 20 },
		{ id: 'Dusk', meshID: 'human_sorceress', chunkID: 'ruins_1_0', localX: 11, localZ: 8, yaw: Math.PI / 2, pack: true, hp: 12 },
		{ id: 'Nyx', meshID: 'human_witch', chunkID: 'ruins_1_0', localX: 10, localZ: 4, yaw: Math.PI / 2, pack: true, hp: 12 },
		{ id: 'Helms', meshID: 'human_guard', chunkID: 'ruins_1_0', localX: 5, localZ: 6, yaw: Math.PI / 2, pack: true, packLoot: SWORD, hp: 28 },
		{ id: 'Ash', meshID: 'human_scout', chunkID: 'ruins_1_0', localX: 10, localZ: 12, yaw: Math.PI / 2, pack: true, hp: 12 },
		{ id: 'Flint', meshID: 'human_mannequin', chunkID: 'ruins_1_0', localX: 5, localZ: 10, yaw: Math.PI / 2, pack: true, packLoot: SWORD, hp: 20 },
	],
	ambient: 'Two parties fight to the death in a ruined forest colonnade. No quarter.',
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
