import type { AgentIdentity, Goal } from 'arc-director';
import { Crowd, Merchant, Named } from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';
import { findCarried } from '../items/inventory';
import { coinsOf } from '../items/wallet';
import { spawnNpc, type NpcSpawnOpts } from '../world/spawn';
import type { Chunk } from '../world/Chunk';

export type MindSeed = {
	id:string;
	rank?:number;
	identity:AgentIdentity;
	goals:Goal[];
	memories:{ text:string; tags:string[]; pinned?:boolean }[];
	watches?:string[];
	skipHeartbeat?:boolean;
	skipMajor?:boolean;
};

const PRICES = 'List prices in gold: Loaf 5 (haggle floor 3), Scarf 6 (floor 4), Bowl 4 (floor 2), Knife 7 (floor 4), Apple 3, Candle 2.';

const TRADE = 'Gold lives in your purse. buy(item, from, offer) pays gold and takes the good. If you cannot afford the ask, first haggle(with, item, offer) at or above the floor, then buy at that offer. sell(item, to, ask) if you brought goods. give() is a gift, not a sale. Do not steal — Holt and Pike watch WestGate, Brant and Cass watch EastGate, and they will catch a thief. Use names, never coordinates.';

function vendorRole(name:string, stall:string, good:string, ask:number, floor:number, want:string, coins:number):string {
	return `You are ${name}, a street vendor at ${stall}. You sell ${good} for ${ask} gold (you may haggle down to ${floor}, never lower). You have ${coins} gold in your purse. You want ${want} for yourself — buy it when you can. Stay at ${stall}. Do not leave through WestGate or EastGate. ${TRADE} Act; do not only talk.`;
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
):MindSeed {
	return {
		id,
		identity: {
			name: id,
			role: vendorRole(id, stall, good, ask, floor, want, coins),
			traits,
		},
		goals: [{
			text: `Sell ${good} from ${stall}. Buy ${want} if you can afford it. Stay at your stall.`,
			priority: 2,
		}],
		memories: [
			{
				text: `${PRICES} I sell ${good}. I want ${want}. I keep the stall; customers leave through the gates when they are done.`,
				tags: [good, want, stall, 'WestGate', 'EastGate'],
				pinned: true,
			},
		],
	};
}

function customerRole(name:string, wants:string[], coins:number, leave:string, extra:string):string {
	const need = wants.length > 0 ? `You came for ${wants.join(' and ')}.` : 'You already have what you came for.';
	return `You are ${name}, a visitor at the flea market. ${need} You have ${coins} gold in your purse. ${extra}${TRADE} When you hold everything you came for, go_to(${leave}) and walk to that gate. Do not linger. ${PRICES} Act; do not only talk.`;
}

function customerSeed(
	id:string,
	wants:string[],
	coins:number,
	leave:string,
	extra:string,
	traits:string[],
	memory:string,
):MindSeed {
	const goal = wants.length > 0
		? `Get ${wants.join(' and ')} by buying (haggle if you cannot pay the ask). Then go_to(${leave}).`
		: `go_to(${leave}) and leave. Do not linger.`;
	return {
		id,
		identity: {
			name: id,
			role: customerRole(id, wants, coins, leave, extra),
			traits,
		},
		goals: [{ text: goal, priority: 2 }],
		memories: [
			{
				text: memory,
				tags: [...wants, leave, 'market'],
				pinned: true,
			},
		],
	};
}

function guardSeed(id:string, post:string, traits:string[]):MindSeed {
	return {
		id,
		identity: {
			name: id,
			role: `You are ${id}, market watch posted at ${post}. Stay at ${post}. Do not follow shoppers. Do not shop. Do not leave through the gates. Do not steal. Only leave the post when a Theft is reported — go_to the thief; the watch seizes the goods. Then return to ${post}. ${PRICES} Use names, never coordinates.`,
			traits,
		},
		goals: [{
			text: `Stay at ${post}. Do not follow anyone. If a Theft is reported, go_to the thief, then return to ${post}.`,
			priority: 2,
		}],
		memories: [
			{
				text: `My post is ${post}. Holt and Pike cover WestGate. Brant and Cass cover EastGate. Theft is steal(item, from) or taking a Loaf, Scarf, Bowl, or Knife off the ground.`,
				tags: [post, 'WestGate', 'EastGate', 'watch'],
				pinned: true,
			},
		],
		watches: ['some(events.filter("theft").nearby(16))'],
		skipHeartbeat: true,
		skipMajor: true,
	};
}

export const MARKET_SEEDS:MindSeed[] = [
	vendorSeed('Baker', 'BakerStall', 'Loaf', 5, 3, 'Knife', 18, ['warm', 'busy', 'fair']),
	vendorSeed('Weaver', 'WeaverStall', 'Scarf', 6, 4, 'Loaf', 14, ['sharp', 'proud', 'thrifty']),
	vendorSeed('Potter', 'PotterStall', 'Bowl', 4, 2, 'Scarf', 16, ['quiet', 'kind', 'dusty']),
	vendorSeed('Cutler', 'CutlerStall', 'Knife', 7, 4, 'Bowl', 22, ['gruff', 'honest', 'impatient']),
	customerSeed(
		'Mira',
		['Loaf'],
		4,
		'EastGate',
		'A Loaf is 5 gold and you only have 4 — you must haggle with Baker. ',
		['shy', 'hungry', 'polite'],
		'I want a Loaf. Baker asks 5. I have 4 gold. I will haggle, then leave through EastGate.',
	),
	customerSeed(
		'Tomas',
		['Knife', 'Bowl'],
		15,
		'WestGate',
		'You need both a Knife and a Bowl. You can pay list if you must. ',
		['brisk', 'practical', 'loud'],
		'I want a Knife and a Bowl. Cutler and Potter sell them. Then WestGate.',
	),
	customerSeed(
		'Nell',
		['Scarf'],
		3,
		'WestGate',
		'You sell Apple (3 gold). A Scarf is 6 — sell your apples and/or haggle. ',
		['wily', 'cheerful', 'broke'],
		'I have Apples to sell. I want a Scarf from Weaver. I am short on gold. Then WestGate.',
	),
	customerSeed(
		'Rook',
		['Loaf'],
		8,
		'WestGate',
		'You can pay Baker list price. ',
		['calm', 'brief', 'fed'],
		'I want a Loaf. I have enough gold. Then leave through WestGate.',
	),
	guardSeed('Holt', 'WestGate', ['stern', 'watchful']),
	guardSeed('Pike', 'WestGate', ['quiet', 'sharp']),
	guardSeed('Brant', 'EastGate', ['loud', 'firm']),
	guardSeed('Cass', 'EastGate', ['calm', 'unsmiling']),
];

const POOL_NAMES = ['Pip', 'Gwen', 'Cal', 'Ivo', 'Bess', 'Quin', 'Odo', 'Faye', 'Lars', 'Nia', 'Wim', 'Tess'];
const POOL_MESH = ['human', 'human_merchant', 'human_robe', 'human_princess', 'human_sorceress'];

type CustomerTemplate = {
	wants:string[];
	wallet:[number, number];
	loot?:{ defID:string; name:string; count:number };
	note:string;
};

const TEMPLATES:CustomerTemplate[] = [
	{ wants: ['Loaf'], wallet: [3, 4], note: 'Short on gold for a Loaf — haggle with Baker.' },
	{ wants: ['Scarf'], wallet: [8, 12], note: 'Buy a Scarf; pay list if you must.' },
	{ wants: ['Bowl', 'Apple'], wallet: [6, 9], note: 'You want a Bowl and an Apple if anyone sells one.' },
	{ wants: ['Knife'], wallet: [4, 6], note: 'Knife list is 7; haggle with Cutler.' },
	{ wants: ['Bowl'], wallet: [5, 8], note: 'Buy a Bowl from Potter.' },
	{ wants: ['Candle', 'Loaf'], wallet: [8, 11], note: 'You want a Candle and a Loaf. Ask around.' },
	{
		wants: ['Scarf'],
		wallet: [2, 4],
		loot: { defID: 'candle', name: 'Candle', count: 2 },
		note: 'Sell Candles (2 gold) and haggle for a Scarf.',
	},
	{
		wants: ['Knife'],
		wallet: [3, 5],
		loot: { defID: 'apple', name: 'Apple', count: 2 },
		note: 'Sell Apples and haggle for a Knife.',
	},
];

export function customerCount(world:World):number {
	let n = 0;
	world.forEachComponent(Crowd, (crowd) => {
		if (crowd.kind === 'customer') {
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

export function seedFromBody(go:GameObject):MindSeed | null {
	const id = go.getComponent(Named)?.id ?? go.id;
	const crowd = go.getComponent(Crowd);
	if (!crowd) {
		return null;
	}
	const coins = coinsOf(go);
	const shop = go.getComponent(Merchant);
	if (crowd.kind === 'vendor' && shop) {
		return vendorSeed(id, `${id}Stall`, shop.specialty, shop.ask, shop.floor, crowd.wants[0] ?? 'nothing', coins, ['busy']);
	}
	if (crowd.kind === 'guard') {
		return guardSeed(id, crowd.leaveGate || 'WestGate', ['watchful']);
	}
	const held:string[] = [];
	if (findCarried(go, (it) => it.defID === 'apple')) {
		held.push('Apple');
	}
	if (findCarried(go, (it) => it.defID === 'candle')) {
		held.push('Candle');
	}
	const extra = held.length > 0 ? `You also sell ${held.join(' and ')}. ` : '';
	return customerSeed(
		id,
		[...crowd.wants],
		coins,
		crowd.leaveGate || 'EastGate',
		extra,
		['curious', 'thrifty'],
		`I came to the market for ${crowd.wants.join(' and ') || 'nothing'}. Then ${crowd.leaveGate}.`,
	);
}

export function spawnRandomCustomer(world:World):{ go:GameObject; seed:MindSeed } | null {
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
	const opts:NpcSpawnOpts = {
		id,
		meshID: POOL_MESH[Math.floor(Math.random() * POOL_MESH.length)],
		localX: local.localX + inward,
		localZ: local.localZ,
		yaw: inward > 0 ? Math.PI / 2 : -Math.PI / 2,
		pack: true,
		packLoot: tmpl.loot ? [tmpl.loot] : undefined,
		wallet,
		crowd: { kind: 'customer', wants: [...tmpl.wants], leaveGate },
	};
	const go = spawnNpc(world, chunk as Chunk, opts);
	const extra = tmpl.loot ? `You also sell ${tmpl.loot.name}. ` : '';
	const seed = customerSeed(id, tmpl.wants, wallet, leaveGate, `${tmpl.note} ${extra}`, ['new', 'eager'], tmpl.note);
	return { go, seed };
}
