import type { AgentSpec } from 'arc-director';
import { MarketNPC, Named } from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';
import { spawnNPC, type NPCSpawnOpts } from '../world/spawn';
import type { Chunk } from '../world/Chunk';

const TRADE = 'Gold lives in my purse. Buying is a sale; give() is a gift. Use names, never coordinates.';

function vendorStory(stall:string, good:string, ask:number, floor:number, want:string, coins:number):string {
	return `I am a street vendor at ${stall}. I sell ${good} for ${ask} gold. I will not take less than ${floor}. I have ${coins} gold in my purse. I want ${want} for myself. I stay at ${stall}. ${TRADE}`;
}

function vendorSeed(
	id:string,
	stall:string,
	good:string,
	ask:number,
	floor:number,
	want:string,
	coins:number,
	traits:string[],
):AgentSpec {
	return {
		id,
		identity: { role: 'Vendor', traits },
		goals: [{
			text: `Sell ${good} from ${stall}. Buy ${want} if you can afford it. Stay at your stall.`,
			priority: 2,
		}],
		memories: [
			{
				text: vendorStory(stall, good, ask, floor, want, coins),
				tags: ['backstory', good, stall],
				pinned: true,
			},
			{
				text: `I sell ${good}. I want ${want}. I keep the stall.`,
				tags: [good, want, stall],
				pinned: true,
			},
		],
	};
}

export const MARKET_SEEDS:AgentSpec[] = [
	vendorSeed('Baker', 'BakerStall', 'Loaf', 5, 3, 'Knife', 18, ['warm', 'busy', 'fair']),
	vendorSeed('Weaver', 'WeaverStall', 'Scarf', 6, 4, 'Loaf', 14, ['sharp', 'proud', 'thrifty']),
	vendorSeed('Potter', 'PotterStall', 'Bowl', 4, 2, 'Scarf', 16, ['quiet', 'kind', 'dusty']),
	vendorSeed('Cutler', 'CutlerStall', 'Knife', 7, 4, 'Bowl', 22, ['gruff', 'honest', 'impatient']),
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
	wants:string[];
	wallet:[number, number];
	loot?:{ defID:string; name:string; count:number };
	note:string;
};

const TEMPLATES:CustomerTemplate[] = [
	{ wants: ['Loaf'], wallet: [3, 4], note: 'Short on gold for a Loaf.' },
	{ wants: ['Scarf'], wallet: [8, 12], note: 'You want a Scarf.' },
	{ wants: ['Bowl', 'Apple'], wallet: [6, 9], note: 'You want a Bowl and an Apple.' },
	{ wants: ['Knife'], wallet: [4, 6], note: 'You want a Knife.' },
	{ wants: ['Bowl'], wallet: [5, 8], note: 'You want a Bowl.' },
	{ wants: ['Candle', 'Loaf'], wallet: [8, 11], note: 'You want a Candle and a Loaf.' },
	{
		wants: ['Scarf'],
		wallet: [2, 4],
		loot: { defID: 'candle', name: 'Candle', count: 2 },
		note: 'You have Candles. You want a Scarf.',
	},
	{
		wants: ['Knife'],
		wallet: [3, 5],
		loot: { defID: 'apple', name: 'Apple', count: 2 },
		note: 'You have Apples. You want a Knife.',
	},
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
