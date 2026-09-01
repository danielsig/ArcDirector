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
import { HUMAN_KINDS, type CrowdKind, type HumanKind } from '../engine/components';
import type { GameHost, HostCtx } from '../npc/adapter';
import { createDirector as createAbbeyDirector } from '../npc/scenes/abbey';
import { createDirector as createGlenDirector } from '../npc/scenes/glen';
import { createDirector as createMarketDirector } from '../npc/scenes/market';

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
	merchant?:{ specialty:string; ask:number; floor:number };
	crowd?:{ kind:CrowdKind; wants:string[]; leaveGate?:string };
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
	createDirector:(host:GameHost)=>ArcDirector<HostCtx>;
};

export const ABBEY_VAULT:SceneDef = {
	id: 'abbey_vault',
	title: 'Abbey Vault',
	look: 'dungeon',
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
	message: 'E pick up / unlock   F use   Enter talk   /give   Tab chat',
	createDirector: createAbbeyDirector,
};

export const RIVER_GLEN:SceneDef = {
	id: 'glen',
	title: 'River Glen',
	look: 'glen',
	chunks: [glen_0_0, glen_1_0, glen_0_1, glen_1_1],
	npcs: [
		{ id: 'Forager', meshID: 'human', chunkID: 'glen_1_1', localX: 9, localZ: 3, pack: true },
		{
			id: 'Miller',
			meshID: 'human_robe',
			chunkID: 'glen_1_0',
			localX: 8,
			localZ: 9,
			pack: true,
			packLoot: [{ defID: 'mill_crank', name: 'MillCrank' }],
		},
		{
			id: 'Angler',
			meshID: 'human_merchant',
			chunkID: 'glen_1_1',
			localX: 8,
			localZ: 10,
			yaw: Math.PI,
			pack: true,
			packLoot: [{ defID: 'silver_trout', name: 'SilverTrout' }],
		},
		{
			id: 'Servant',
			meshID: 'human_sorceress',
			chunkID: 'glen_1_0',
			localX: 5,
			localZ: 11,
			pack: true,
			companion: true,
		},
	],
	ambient: 'A windy river glen.',
	message: 'E pick up / unlock   F use   Enter talk   /give   Tab chat',
	createDirector: createGlenDirector,
};

export const MARKETPLACE:SceneDef = {
	id: 'marketplace',
	title: 'Marketplace',
	look: 'market',
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
			crowd: { kind: 'vendor', wants: ['Knife'] },
		},
		{
			id: 'Weaver',
			meshID: 'human_princess',
			chunkID: 'market_0_0',
			localX: 8,
			localZ: 3,
			yaw: Math.PI,
			pack: true,
			packLoot: [{ defID: 'scarf', name: 'Scarf', count: 2 }],
			wallet: 14,
			merchant: { specialty: 'Scarf', ask: 6, floor: 4 },
			crowd: { kind: 'vendor', wants: ['Loaf'] },
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
			crowd: { kind: 'vendor', wants: ['Scarf'] },
		},
		{
			id: 'Cutler',
			meshID: 'human_guard',
			chunkID: 'market_0_0',
			localX: 8,
			localZ: 10,
			pack: true,
			packLoot: [{ defID: 'kitchen_knife', name: 'Knife', count: 2 }],
			wallet: 22,
			merchant: { specialty: 'Knife', ask: 7, floor: 4 },
			crowd: { kind: 'vendor', wants: ['Bowl'] },
		},
		{
			id: 'Mira',
			meshID: 'human',
			chunkID: 'market_0_0',
			localX: 6,
			localZ: 7,
			pack: true,
			wallet: 4,
			crowd: { kind: 'customer', wants: ['Loaf'], leaveGate: 'EastGate' },
		},
		{
			id: 'Tomas',
			meshID: 'human_merchant',
			chunkID: 'market_0_0',
			localX: 12,
			localZ: 7,
			yaw: Math.PI / 2,
			pack: true,
			wallet: 15,
			crowd: { kind: 'customer', wants: ['Knife', 'Bowl'], leaveGate: 'WestGate' },
		},
		{
			id: 'Nell',
			meshID: 'human_princess',
			chunkID: 'market_1_0',
			localX: 4,
			localZ: 7,
			yaw: -Math.PI / 2,
			pack: true,
			packLoot: [{ defID: 'apple', name: 'Apple', count: 2 }],
			wallet: 3,
			crowd: { kind: 'customer', wants: ['Scarf'], leaveGate: 'WestGate' },
		},
		{
			id: 'Rook',
			meshID: 'human',
			chunkID: 'market_1_0',
			localX: 10,
			localZ: 8,
			pack: true,
			wallet: 8,
			crowd: { kind: 'customer', wants: ['Loaf'], leaveGate: 'WestGate' },
		},
		{
			id: 'Holt',
			meshID: 'human_guard',
			chunkID: 'market_0_0',
			localX: 2,
			localZ: 5,
			yaw: -Math.PI / 2,
			pack: true,
			crowd: { kind: 'guard', wants: [], leaveGate: 'WestGate' },
		},
		{
			id: 'Pike',
			meshID: 'human_guard',
			chunkID: 'market_0_0',
			localX: 2,
			localZ: 9,
			yaw: -Math.PI / 2,
			pack: true,
			crowd: { kind: 'guard', wants: [], leaveGate: 'WestGate' },
		},
		{
			id: 'Brant',
			meshID: 'human_guard',
			chunkID: 'market_1_0',
			localX: 13,
			localZ: 5,
			yaw: Math.PI / 2,
			pack: true,
			crowd: { kind: 'guard', wants: [], leaveGate: 'EastGate' },
		},
		{
			id: 'Cass',
			meshID: 'human_guard',
			chunkID: 'market_1_0',
			localX: 13,
			localZ: 9,
			yaw: Math.PI / 2,
			pack: true,
			crowd: { kind: 'guard', wants: [], leaveGate: 'EastGate' },
		},
	],
	ambient: 'A busy street flea market.',
	message: 'E pick up / unlock   F use   Enter talk   /give   Tab chat',
	createDirector: createMarketDirector,
};

export const SCENES:Record<string, SceneDef> = {
	abbey_vault: ABBEY_VAULT,
	glen: RIVER_GLEN,
	marketplace: MARKETPLACE,
};

export const DEFAULT_SCENE_ID = 'abbey_vault';

export function sceneByID(id:string):SceneDef {
	return SCENES[id] ?? ABBEY_VAULT;
}

export function humanKindsForScene(scene:SceneDef):HumanKind[] {
	const set = new Set<HumanKind>(['player']);
	for (const npc of scene.npcs) {
		if (npc.meshID === 'human') {
			set.add('player');
			continue;
		}
		if (npc.meshID.startsWith('human_')) {
			const kind = npc.meshID.slice('human_'.length);
			if ((HUMAN_KINDS as readonly string[]).includes(kind)) {
				set.add(kind as HumanKind);
			}
		}
	}
	return [...set];
}
