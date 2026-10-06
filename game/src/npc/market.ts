import type { AgentSpec } from 'arc-director';
import { MarketNPC, Named } from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';
import { spawnNPC, type NPCSpawnOpts } from '../world/spawn';
import type { Chunk } from '../world/Chunk';

/** Each vendor's stall, by what it sells. */
const STALL_OF:Record<string, string> = { Loaf: 'BakerStall', Scarf: 'WeaverStall', Bowl: 'PotterStall', Knife: 'CutlerStall' };

function vendorSeed(id:string, good:string, ask:number, floor:number, want:string, traits:string[]):AgentSpec {
	const stall = STALL_OF[good];
	return {
		id,
		identity: { role: 'Vendor', traits },
		goals: [
			{ text: `Sell ${good} at ${stall}.`, priority: 2 },
			{ text: `Buy ${want} for yourself at ${STALL_OF[want]}, then go back to ${stall}.`, priority: 1 },
		],
		memories: [{
			text: `I am a street vendor at ${stall}. I sell ${good} for ${ask} gold and never take less than ${floor}. I want ${want} for myself.`,
			tags: ['backstory', good, stall],
			pinned: true,
		}],
	};
}

export const MARKET_SEEDS:AgentSpec[] = [
	vendorSeed('Baker', 'Loaf', 5, 3, 'Knife', ['warm', 'busy', 'fair']),
	vendorSeed('Weaver', 'Scarf', 6, 4, 'Loaf', ['sharp', 'proud', 'thrifty']),
	vendorSeed('Potter', 'Bowl', 4, 2, 'Scarf', ['quiet', 'kind', 'dusty']),
	vendorSeed('Cutler', 'Knife', 7, 4, 'Bowl', ['gruff', 'honest', 'impatient']),
];

export const HIVE_UNITS:{ id:string; tags:string[] }[] = [
	{ id: 'Mira', tags: ['Shopper', 'Loaf', 'EastGate'] },
	{ id: 'Tomas', tags: ['Shopper', 'Knife', 'Bowl', 'WestGate'] },
	{ id: 'Nell', tags: ['Shopper', 'Scarf', 'WestGate'] },
	{ id: 'Rook', tags: ['Shopper', 'Loaf', 'WestGate'] },
	{ id: 'Holt', tags: ['Guard', 'WestGate'] },
	{ id: 'Pike', tags: ['Guard', 'WestGate'] },
	{ id: 'Brant', tags: ['Guard', 'EastGate'] },
	{ id: 'Cass', tags: ['Guard', 'EastGate'] },
];

const POOL_NAMES = ['Pip', 'Gwen', 'Cal', 'Ivo', 'Bess', 'Quin', 'Odo', 'Faye', 'Lars', 'Nia', 'Wim', 'Tess'];
const POOL_MESH = ['human_mannequin', 'human_merchant', 'human_robe', 'human_princess', 'human_sorceress'];

type CustomerTemplate = {
	/** Only what a stall sells: a want nobody sells keeps the shopper in the square for good. */
	wants:string[];
	wallet:[number, number];
	loot?:{ defID:string; name:string; count:number };
};

const TEMPLATES:CustomerTemplate[] = [
	{ wants: ['Loaf'], wallet: [3, 4] },
	{ wants: ['Scarf'], wallet: [8, 12] },
	{ wants: ['Bowl', 'Loaf'], wallet: [8, 11] },
	{ wants: ['Knife'], wallet: [4, 6] },
	{ wants: ['Bowl'], wallet: [5, 8] },
	{ wants: ['Scarf'], wallet: [2, 4], loot: { defID: 'candle', name: 'Candle', count: 2 } },
	{ wants: ['Knife'], wallet: [3, 5], loot: { defID: 'apple', name: 'Apple', count: 2 } },
];

export function customerCount(world:World):number {
	let n = 0;
	world.forEachComponent(MarketNPC, (npc) => {
		if (npc.kind === 'customer') {
			n += 1;
		}
	});
	return n;
}

function usedNames(world:World):Set<string> {
	const names = new Set<string>();
	for (const go of world.objects) {
		const id = go.getComponent(Named)?.id;
		if (id) {
			names.add(id);
		}
	}
	return names;
}

function pickName(world:World):string | null {
	const used = usedNames(world);
	const free = POOL_NAMES.filter((n) => !used.has(n));
	if (free.length === 0) {
		return null;
	}
	return free[Math.floor(Math.random() * free.length)];
}

export function spawnRandomCustomer(world:World):{ go:GameObject; id:string; tags:string[] } | null {
	const id = pickName(world);
	if (!id) {
		return null;
	}
	const west = world.findNamed('WestGate');
	const east = world.findNamed('EastGate');
	const spawnGate = Math.random() < 0.5 ? west : east;
	if (!spawnGate) {
		return null;
	}
	const leaveGate = spawnGate.getComponent(Named)?.id === 'WestGate' ? 'EastGate' : 'WestGate';
	const chunk = world.chunkAtWorld(spawnGate.transform.position.x, spawnGate.transform.position.z);
	if (!chunk) {
		return null;
	}
	const local = chunk.worldToLocal(spawnGate.transform.position.x, spawnGate.transform.position.z);
	const inward = spawnGate.getComponent(Named)?.id === 'WestGate' ? 2 : -2;
	const tmpl = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
	const wallet = tmpl.wallet[0] + Math.floor(Math.random() * (tmpl.wallet[1] - tmpl.wallet[0] + 1));
	const opts:NPCSpawnOpts = {
		id,
		meshID: POOL_MESH[Math.floor(Math.random() * POOL_MESH.length)],
		localX: local.localX + inward,
		localZ: local.localZ,
		yaw: inward > 0 ? Math.PI / 2 : -Math.PI / 2,
		pack: true,
		packLoot: tmpl.loot ? [tmpl.loot] : undefined,
		wallet,
		marketNPC: { kind: 'customer', wants: [...tmpl.wants], leaveGate },
	};
	const go = spawnNPC(world, chunk as Chunk, opts);
	return {
		go,
		id,
		tags: ['Shopper', ...tmpl.wants, leaveGate],
	};
}
