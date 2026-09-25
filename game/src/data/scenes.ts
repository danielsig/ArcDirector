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
import type { GameHost, HostCtx } from '../npc/adapter';
import { createDirector as createAbbeyDirector } from '../npc/scenes/abbey';
import { createDirector as createGlenDirector } from '../npc/scenes/glen';
import { createDirector as createMarketDirector } from '../npc/scenes/market';
import { createDirector as createRuinsDirector } from '../npc/scenes/ruins';

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
};

export type SceneLook = 'dungeon' | 'glen' | 'market';

export type SceneDef = {
	id:string;
	title:string;
	look:SceneLook;
	chunks:ChunkFile[];
	npcs:NPCSpawnDef[];
	ambient:string;
	message:string;
	playerWallet?:number;
	/** Player stays centered and the chunk-sized map scrolls. `false` = current chunk, moving arrow. */
	minimapFollow?:boolean;
	createDirector:(host:GameHost)=>ArcDirector<HostCtx>;
};

export const ABBEY_VAULT:SceneDef = {
	id: 'abbey_vault',
	title: 'Abbey Vault',
	look: 'dungeon',
	minimapFollow: true,
	chunks: [dungeon_0_0, dungeon_1_0],
	npcs: [
		{ id: 'Herbalist', meshID: 'human_princess', chunkID: 'dungeon_0_0', localX: 5, localZ: 10, pack: true },
		{ id: 'Alchemist', meshID: 'human_sorceress', chunkID: 'dungeon_0_0', localX: 8, localZ: 10, pack: true },
		{
			id: 'Captain',
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
	ambient: 'A damp stone hall of the abbey.',
	message: 'E pick up / unlock   F use   X swap hands   Enter talk   /give   Tab chat',
	createDirector: createAbbeyDirector,
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
			id: 'Miller',
			meshID: 'human_robe',
			chunkID: 'glen_1_0',
			localX: 8,
			localZ: 9,
			pack: true,
			packLoot: [{ defID: 'mill_crank', name: 'MillCrank' }],
			merchant: { specialty: 'FireMushroom', ask: 10, floor: 10 },
			marketNPC: { kind: 'vendor', wants: ['FireMushroom'] },
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
		},
	],
	ambient: 'A windy river glen.',
	message: 'E pick up / unlock   F use   X swap hands   Enter talk   /give   Tab chat',
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
	message: 'E pick up / unlock   F use   X swap hands   Enter talk   /give   Tab chat',
	createDirector: createMarketDirector,
};

const SWORD = [{ defID: 'iron_sword', name: 'IronSword' }];

export const RUINS:SceneDef = {
	id: 'ruins',
	title: 'Ruin Fight',
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
	ambient: 'Two companies fight to the death in a ruined forest colonnade. No quarter.',
	message: 'E pick up / unlock   F use   X swap hands   Enter talk   /give   Tab chat',
	createDirector: createRuinsDirector,
};

export const SCENES:Record<string, SceneDef> = {
	abbey_vault: ABBEY_VAULT,
	glen: RIVER_GLEN,
	marketplace: MARKETPLACE,
	ruins: RUINS,
};

export const DEFAULT_SCENE_ID = 'abbey_vault';

export function sceneByID(id:string):SceneDef {
	return SCENES[id] ?? ABBEY_VAULT;
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
