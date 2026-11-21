import { yawToForward, type GameObject, type XZ } from '@arc-director/kindling';
import type { MemoryDraft } from 'arc-director';
import { MarketplaceNPC, Named, idOf } from '../../engine/components';
import { DemoMeshRenderer } from '../../engine/demo-mesh-renderer';
import type { DemoWorld } from '../../engine/demo-world';
import { spawnNPC, type NPCSpawnDef } from '../../world/spawn';
import { SWORD, type CastMember, type SceneCast } from '../scene';
import { SELLERS, type Seller } from './wares';
import { Door } from '../../kit/door/door';

/** Where `seller` serves from, and what they sell at what price. */
function stallOf(seller:Seller):{ place:string; prices:string } {
	const place = seller.shop ? `${seller.post}, inside ${seller.shop}` : seller.post;
	return { place, prices: seller.wares.map((ware) => `${ware.name} for ${ware.ask} gold, never under ${ware.floor}`).join('; ') };
}

/** How far a stall's seller stands forward of their cell's middle, up to the counter's back (meters). */
const UP_TO_COUNTER = 0.45;

/**
 * A seller, a unit of the `Sellers` hive: at their post with every ware in their pack, each ware's posted offer
 * standing, serving one buyer at a time at their serving spot while the rest line up behind.
 */
function vendor(seller:Seller):CastMember {
	return {
		id: seller.vendor,
		tags: ['Seller', seller.post],
		offers: seller.wares.map((ware) => ({ give: { [ware.name]: 1 }, get: { gold: ware.ask } })),
		crowd: 'line',
		servingSpot: seller.servingSpot,
		of: 'Sellers',
		body: {
			meshID: seller.model,
			cell: seller.cell,
			offset: seller.offset ?? (seller.shop ? undefined : { x: yawToForward(seller.yaw).x * UP_TO_COUNTER, z: yawToForward(seller.yaw).z * UP_TO_COUNTER }),
			yaw: seller.yaw,
			voice: seller.voice,
			packLoot: seller.wares.map((ware) => ({ defID: ware.defID, name: ware.name, count: 99 })),
			wallet: seller.wallet,
			merchant: { goods: seller.wares.map((ware) => ware.name) },
			marketplaceNPC: { kind: 'vendor', wants: [seller.want], post: seller.post },
		},
	};
}

/** What the `Sellers` hive knows of each seller: their place, their prices, and how they talk. */
export const SELLER_MEMORIES:MemoryDraft[] = SELLERS.flatMap((seller) => {
	const { place, prices } = stallOf(seller);
	return [{
		text: `${seller.vendor}'s place is ${place}, and ${seller.vendor} never leaves it, not to shop and not to chase anyone. ${seller.vendor} sells ${prices}. ${seller.vendor} does not walk off to get ${seller.want}.`,
		tags: ['backstory', seller.post, ...seller.wares.map((ware) => ware.name)],
		pinned: true,
	}, {
		// Told of them by name: lines of their own are lines the hive recites.
		text: `${seller.vendor} ${seller.manner}`,
		tags: ['manner', seller.vendor],
		pinned: true,
	}];
});

/**
 * Where a guard stands: one meter inside the gate and one meter off the opening, so the pair flanks the
 * door. The opening itself stays clear for people walking out.
 */
export function guardPost(world:DemoWorld, guard:GameObject):XZ | undefined {
	const npc = guard.getComponent(MarketplaceNPC);
	if (npc?.kind !== 'guard' || !npc.leaveGate) {
		return undefined;
	}
	const gate = world.findNamed(npc.leaveGate);
	if (!gate) {
		return undefined;
	}
	const mates:GameObject[] = [];
	world.forEachComponent(MarketplaceNPC, (other, go) => {
		if (other.kind === 'guard' && other.leaveGate === npc.leaveGate) {
			mates.push(go);
		}
	});
	mates.sort((a, b) => idOf(a).localeCompare(idOf(b)));
	const index = Math.max(0, mates.indexOf(guard));
	const side = index % 2 === 0 ? -1 : 1;
	const span = 1 + Math.floor(index / 2);
	const p = gate.transform.position;
	const passageX = gate.getComponent(Door)?.axis === 'z' ? 0 : 1;
	const passageZ = passageX === 0 ? 1 : 0;
	const clear = (sign:number) => world.terrain.sample(p.x + passageX * sign, p.z + passageZ * sign)?.blocked === false;
	const inward = clear(1) ? 1 : -1;
	return {
		x: p.x + passageX * inward + passageZ * side * span,
		z: p.z + passageZ * inward + passageX * side * span,
	};
}

/**
 * A guard of the `Guards`, at map cell `cell` by `gate`: it holds the gate until a thief or a security cry shows. A law
 * on the Guards collective outranks this and runs first.
 */
function guard(id:string, gate:string, cell:[number, number], yaw:number):CastMember {
	return {
		id,
		tags: ['Guard', gate],
		of: 'Guards',
		body: { meshID: 'KnightMale', cell, yaw, marketplaceNPC: { kind: 'guard', wants: [], leaveGate: gate }, equip: SWORD },
		choose: {
			goal: `Guard ${gate} from beside the doorway, never in it. A thief outranks a cry. Chase a thief you see, else run to whoever cried a security word, else hold`,
			choices: {
				hold: 'stand() && wait(until=some(others.filter("thief")) || some(others.filter("alarm")))',
				chase: 'go_to(others.filter("thief").minBy(u => distance(me, u)))',
				answer: 'go_to(others.filter("alarm").minBy(u => distance(me, u)))',
			},
		},
	};
}

/** A shopper's tags: wanting each of `wants` until bought, and leaving by `gate`. */
function shopperTags(wants:string[], gate:string):string[] {
	return ['Shopper', 'wanting', ...wants, gate];
}

/** A shopper of the `MarketplaceHive` at map cell `cell` with `wallet` gold, come for `wants`, who leaves by `gate`. */
function shopper(id:string, meshID:string, cell:[number, number], wallet:number, wants:string[], gate:string, extra:Partial<NPCSpawnDef> = {}):CastMember {
	const body:Omit<NPCSpawnDef, 'id'> = { meshID, cell, wallet, marketplaceNPC: { kind: 'customer', wants, leaveGate: gate }, ...extra };
	return { id, tags: shopperTags(wants, gate), of: 'MarketplaceHive', body };
}

/** The sellers at their posts, the shoppers in the square at the start, and one guard at each gate. */
export const MARKETPLACE_CAST:SceneCast = [
	...SELLERS.map(vendor),
	shopper('Mira', 'Scout', [9, 13], 6, ['Loaf'], 'EastGate'),
	shopper('Tomas', 'Merchant', [22, 12], 15, ['Knife', 'Bowl'], 'WestGate', { yaw: Math.PI / 2 }),
	shopper('Nell', 'VillagerFemale', [9, 20], 7, ['Scarf'], 'WestGate', { yaw: -Math.PI / 2, packLoot: [{ defID: 'apple', name: 'Apple', count: 2 }] }),
	shopper('Rook', 'Rogue', [24, 20], 8, ['Loaf'], 'WestGate'),
	shopper('Ferris', 'KnightFemale', [28, 20], 7, ['Tonic'], 'EastGate'),
	shopper('Lisa', 'VillagerFemale', [3, 10], 9, ['WoodenHorse'], 'WestGate'),
	guard('Holt', 'WestGate', [1, 8], -Math.PI / 2),
	guard('Brant', 'EastGate', [30, 22], Math.PI / 2),
];

const POOL_NAMES = ['Pip', 'Gwen', 'Cal', 'Ivo', 'Bess', 'Quin', 'Odo', 'Faye', 'Lars', 'Nia', 'Wim', 'Tess', 'Juno', 'Brack', 'Marlow', 'Emry'];
/** Who can walk in to shop. Picked least-used first, so the square stays varied. */
const POOL_MESH = ['VillagerMale', 'VillagerFemale', 'Merchant', 'Blacksmith', 'Robe', 'Shaman', 'Scout', 'Rogue', 'Sorceress', 'KnightFemale'];

function pickMesh(world:DemoWorld):string {
	const uses = new Map(POOL_MESH.map((m) => [m, 0]));
	world.forEachComponent(DemoMeshRenderer, (r) => {
		const n = uses.get(r.meshID);
		if (n !== undefined) {
			uses.set(r.meshID, n + 1);
		}
	});
	const fewest = Math.min(...uses.values());
	const least = POOL_MESH.filter((m) => uses.get(m) === fewest);
	return least[Math.floor(Math.random() * least.length)]!;
}

type CustomerTemplate = {
	/** Only what a stall sells: a want nobody sells keeps the shopper in the square for good. */
	wants:string[];
	loot?:{ defID:string; name:string; count:number };
};

/** What they came hoping to buy. The purse is rolled separately, and it does not always cover the asking price. */
const TEMPLATES:CustomerTemplate[] = [
	{ wants: ['Loaf'] },
	{ wants: ['Bun'] },
	{ wants: ['Pie'] },
	{ wants: ['Cake', 'Bun'] },
	{ wants: ['Scarf'] },
	{ wants: ['Hood'] },
	{ wants: ['Ribbon'] },
	{ wants: ['Bowl', 'Loaf'] },
	{ wants: ['Jug'] },
	{ wants: ['Knife'] },
	{ wants: ['Cleaver'] },
	{ wants: ['Shears'] },
	{ wants: ['Hook'] },
	{ wants: ['Tonic'] },
	{ wants: ['Salve'] },
	{ wants: ['Lavender', 'Soap'] },
	{ wants: ['Sushi'] },
	{ wants: ['WoodenHorse'] },
	{ wants: ['Doll'] },
	{ wants: ['Whistle', 'SpinningTop'] },
	{ wants: ['Scarf'], loot: { defID: 'candle', name: 'Candle', count: 2 } },
];

/**
 * Gold from the sellers' floor up to a little over the ask. Some can pay what is posted, some have to bargain or
 * look at something else.
 */
function purseFor(wants:readonly string[]):[number, number] {
	let floor = 0;
	let ask = 0;
	for (const want of wants) {
		const ware = SELLERS.flatMap((seller) => seller.wares).find((w) => w.name === want);
		if (!ware) {
			continue;
		}
		floor += ware.floor;
		ask += ware.ask;
	}
	return [Math.max(1, floor), ask + Math.max(1, Math.round(ask * 0.4))];
}

export function customerCount(world:DemoWorld):number {
	let n = 0;
	world.forEachComponent(MarketplaceNPC, (npc) => {
		if (npc.kind === 'customer') {
			n += 1;
		}
	});
	return n;
}

function usedNames(world:DemoWorld):Set<string> {
	const names = new Set<string>();
	for (const go of world.objects) {
		const id = go.getComponent(Named)?.id;
		if (id) {
			names.add(id);
		}
	}
	return names;
}

function pickName(world:DemoWorld):string | null {
	const used = usedNames(world);
	const free = POOL_NAMES.filter((n) => !used.has(n));
	if (free.length === 0) {
		return null;
	}
	return free[Math.floor(Math.random() * free.length)];
}

export function spawnRandomCustomer(world:DemoWorld):{ go:GameObject; id:string; tags:string[] } | null {
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
	const { tx, tz } = world.terrain.tileCoordAt(spawnGate.transform.position.x, spawnGate.transform.position.z);
	// Past the jamb and the guards. The opening is a passage, not a lobby.
	const inward = spawnGate.getComponent(Named)?.id === 'WestGate' ? 4 : -4;
	const template = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
	const [low, high] = purseFor(template.wants);
	const wallet = low + Math.floor(Math.random() * (high - low + 1));
	const go = spawnNPC(world, {
		id,
		meshID: pickMesh(world),
		cell: [tx + inward, tz],
		yaw: inward > 0 ? Math.PI / 2 : -Math.PI / 2,
		packLoot: template.loot ? [template.loot] : undefined,
		wallet,
		marketplaceNPC: { kind: 'customer', wants: [...template.wants], leaveGate },
	});
	return {
		go,
		id,
		tags: shopperTags(template.wants, leaveGate),
	};
}
