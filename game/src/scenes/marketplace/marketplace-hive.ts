import { type GameObject, type XZ } from '@arc-director/kindling';
import type { CharacterSpec, MemoryDraft } from 'arc-director';
import { Door, MarketNPC, Named } from '../../engine/components';
import { DemoMeshRenderer } from '../../engine/demo-mesh-renderer';
import type { DemoWorld } from '../../engine/demo-world';
import { idOf } from '../../director/names';
import { spawnNPC, type NPCSpawnOpts } from '../../world/spawn';
import { SELLERS, type Seller } from '../../items/wares';

/** Where `seller` serves from, and what they sell at what price. */
function stallOf(seller:Seller):{ place:string; prices:string } {
	const place = seller.shop ? `${seller.post}, inside ${seller.shop}` : seller.post;
	return { place, prices: seller.wares.map((ware) => `${ware.name} for ${ware.ask} gold, never under ${ware.floor}`).join('; ') };
}

/**
 * The sellers, units of the `Sellers` hive: each at their post, each ware's posted offer standing, serving one buyer
 * at a time at their serving spot while the rest line up behind.
 */
export const SELLER_UNITS:Pick<CharacterSpec, 'id' | 'tags' | 'offers' | 'crowd' | 'servingSpot'>[] = SELLERS.map((seller) => ({
	id: seller.vendor,
	tags: ['Seller', seller.post],
	offers: seller.wares.map((ware) => ({ give: { [ware.name]: 1 }, get: { gold: ware.ask } })),
	crowd: 'line',
	servingSpot: seller.servingSpot,
}));

/** What the `Sellers` hive knows of each seller: their place, their prices, and how they talk. */
export const SELLER_MEMORIES:MemoryDraft[] = SELLERS.flatMap((seller) => {
	const { place, prices } = stallOf(seller);
	return [{
		text: `${seller.vendor}'s place is ${place}, and ${seller.vendor} never leaves it, not to shop and not to chase anyone. ${seller.vendor} sells ${prices}. ${seller.vendor} does not walk off to get ${seller.want}.`,
		tags: ['backstory', seller.post, ...seller.wares.map((ware) => ware.name)],
		pinned: true,
	}, {
		text: `${seller.vendor}: ${seller.manner}`,
		tags: ['manner', seller.vendor],
		pinned: true,
	}];
});

/**
 * Where a guard stands: one meter inside the gate and one meter off the opening, so the pair flanks the
 * door. The opening itself stays clear for people walking out.
 */
export function guardPost(world:DemoWorld, guard:GameObject):XZ | undefined {
	const npc = guard.getComponent(MarketNPC);
	if (npc?.kind !== 'guard' || !npc.leaveGate) {
		return undefined;
	}
	const gate = world.findNamed(npc.leaveGate);
	if (!gate) {
		return undefined;
	}
	const mates:GameObject[] = [];
	world.forEachComponent(MarketNPC, (other, go) => {
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
	const clear = (sign:number) => world.sampleTerrain(p.x + passageX * sign, p.z + passageZ * sign)?.blocked === false;
	const inward = clear(1) ? 1 : -1;
	return {
		x: p.x + passageX * inward + passageZ * side * span,
		z: p.z + passageZ * inward + passageX * side * span,
	};
}

/** Hold the gate until a thief or a security cry shows. A law on the Guards collective outranks this and runs first. */
function guard(id:string, gate:string):Pick<CharacterSpec, 'id' | 'tags' | 'choose'> {
	return {
		id,
		tags: ['Guard', gate],
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

export const HIVE_UNITS:Pick<CharacterSpec, 'id' | 'tags'>[] = [
	{ id: 'Mira', tags: ['Shopper', 'wanting', 'Loaf', 'EastGate'] },
	{ id: 'Tomas', tags: ['Shopper', 'wanting', 'Knife', 'Bowl', 'WestGate'] },
	{ id: 'Nell', tags: ['Shopper', 'wanting', 'Scarf', 'WestGate'] },
	{ id: 'Rook', tags: ['Shopper', 'wanting', 'Loaf', 'WestGate'] },
	{ id: 'Ferris', tags: ['Shopper', 'wanting', 'Tonic', 'EastGate'] },
	{ id: 'Lisa', tags: ['Shopper', 'wanting', 'WoodenHorse', 'WestGate'] },
];

/** One guard holds each gate; a thief or a cry still pulls them off post. */
export const GUARD_UNITS:Pick<CharacterSpec, 'id' | 'tags' | 'choose'>[] = [
	guard('Holt', 'WestGate'),
	guard('Brant', 'EastGate'),
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
	{ wants: ['Apple'] },
	{ wants: ['Pear', 'Plum'] },
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
	world.forEachComponent(MarketNPC, (npc) => {
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
	const chunk = world.chunkAtWorld(spawnGate.transform.position.x, spawnGate.transform.position.z);
	if (!chunk) {
		return null;
	}
	const local = chunk.worldToLocal(spawnGate.transform.position.x, spawnGate.transform.position.z);
	// Past the jamb and the guards. The opening is a passage, not a lobby.
	const inward = spawnGate.getComponent(Named)?.id === 'WestGate' ? 4 : -4;
	const template = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
	const [low, high] = purseFor(template.wants);
	const wallet = low + Math.floor(Math.random() * (high - low + 1));
	const opts:NPCSpawnOpts = {
		id,
		meshID: pickMesh(world),
		localX: local.localX + inward,
		localZ: local.localZ,
		yaw: inward > 0 ? Math.PI / 2 : -Math.PI / 2,
		pack: true,
		packLoot: template.loot ? [template.loot] : undefined,
		wallet,
		marketNPC: { kind: 'customer', wants: [...template.wants], leaveGate },
	};
	const go = spawnNPC(world, chunk, opts);
	return {
		go,
		id,
		tags: ['Shopper', 'wanting', ...template.wants, leaveGate],
	};
}
