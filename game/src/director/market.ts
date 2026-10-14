import { type GameObject } from '@arc-director/kindling';
import type { CharacterSpec } from 'arc-director';
import { Door, MarketNPC, Named } from '../engine/components';
import { MeshRenderer } from '../engine/MeshRenderer';
import type { World } from '../engine/World';
import { idOf } from './names';
import { spawnNPC, type NPCSpawnOpts } from '../world/spawn';
import type { Chunk } from '../world/Chunk';
import { STALLS, type Stall } from '../items/wares';

function vendorSeed(stall:Stall):CharacterSpec {
	const prices = stall.wares.map((ware) => `${ware.name} for ${ware.ask} gold, never under ${ware.floor}`).join('; ');
	return {
		id: stall.vendor,
		mind: {},
		identity: { role: 'Vendor', traits: stall.traits },
		goals: [
			{ text: `Stay at ${stall.stall}. Never leave it.`, priority: 2 },
			{ text: `Sell ${prices}.`, priority: 2 },
		],
		offers: stall.wares.map((ware) => ({ give: { [ware.name]: 1 }, get: { gold: ware.ask } })),
		memories: [{
			text: `I am a street vendor. My place is ${stall.stall} and I never leave it, not to shop and not to chase anyone. I sell ${prices}. Each offer stands, so whoever pays it gets one at once. Someone who offers less waits for my answer: I accept with the reverse offer, or counter. I do not walk off to get ${stall.want}.`,
			tags: ['backstory', stall.stall, ...stall.wares.map((ware) => ware.name)],
			pinned: true,
		}],
	};
}

export const MARKET_SEEDS:CharacterSpec[] = STALLS.map(vendorSeed);

/**
 * Where a guard stands: one meter inside the gate and one meter off the opening, so the pair flanks the
 * door. The opening itself stays clear for people walking out.
 */
export function guardPost(world:World, guard:GameObject):{ x:number; z:number } | undefined {
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
			hold: 'stand() && wait(until=some(others.filter("thief")) || some(others.filter("alarm")))',
			chase: 'go_to(others.filter("thief").minBy(u => distance(me, u)))',
			answer: 'go_to(others.filter("alarm").minBy(u => distance(me, u)))',
		},
	};
}

export const HIVE_UNITS:Pick<CharacterSpec, 'id' | 'tags'>[] = [
	{ id: 'Mira', tags: ['Shopper', 'Loaf', 'EastGate'] },
	{ id: 'Tomas', tags: ['Shopper', 'Knife', 'Bowl', 'WestGate'] },
	{ id: 'Nell', tags: ['Shopper', 'Scarf', 'WestGate'] },
	{ id: 'Rook', tags: ['Shopper', 'Loaf', 'WestGate'] },
];

export const GUARD_UNITS:Pick<CharacterSpec, 'id' | 'tags' | 'choose'>[] = [
	guard('Holt', 'WestGate'),
	guard('Pike', 'WestGate'),
	guard('Brant', 'EastGate'),
	guard('Cass', 'EastGate'),
];

const POOL_NAMES = ['Pip', 'Gwen', 'Cal', 'Ivo', 'Bess', 'Quin', 'Odo', 'Faye', 'Lars', 'Nia', 'Wim', 'Tess'];
/** Who can walk in to shop. Picked least-used first, so the square stays varied. */
const POOL_MESH = ['VillagerMale', 'VillagerFemale', 'Merchant', 'Blacksmith', 'Robe', 'Shaman', 'Scout', 'Rogue', 'Sorceress', 'KnightFemale'];

function pickMesh(world:World):string {
	const uses = new Map(POOL_MESH.map((m) => [m, 0]));
	world.forEachComponent(MeshRenderer, (r) => {
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
	wallet:[number, number];
	loot?:{ defID:string; name:string; count:number };
};

const TEMPLATES:CustomerTemplate[] = [
	{ wants: ['Loaf'], wallet: [3, 6] },
	{ wants: ['Bun'], wallet: [1, 4] },
	{ wants: ['Pie'], wallet: [6, 12] },
	{ wants: ['Cake', 'Bun'], wallet: [8, 16] },
	{ wants: ['Scarf'], wallet: [4, 10] },
	{ wants: ['Hood'], wallet: [6, 12] },
	{ wants: ['Ribbon'], wallet: [2, 5] },
	{ wants: ['Bowl', 'Loaf'], wallet: [6, 12] },
	{ wants: ['Jug'], wallet: [4, 10] },
	{ wants: ['Knife'], wallet: [4, 9] },
	{ wants: ['Cleaver'], wallet: [8, 14] },
	{ wants: ['Shears'], wallet: [3, 8] },
	{ wants: ['Hook'], wallet: [4, 8] },
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
	// Past the jamb and the guards. The opening is a passage, not a lobby.
	const inward = spawnGate.getComponent(Named)?.id === 'WestGate' ? 4 : -4;
	const tmpl = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
	const wallet = tmpl.wallet[0] + Math.floor(Math.random() * (tmpl.wallet[1] - tmpl.wallet[0] + 1));
	const opts:NPCSpawnOpts = {
		id,
		meshID: pickMesh(world),
		localX: local.localX + inward,
		localZ: local.localZ,
		yaw: inward > 0 ? Math.PI / 2 : -Math.PI / 2,
		pack: true,
		packLoot: tmpl.loot ? [tmpl.loot] : undefined,
		wallet,
		marketNPC: { kind: 'customer', wants: [...tmpl.wants], leaveGate },
	};
	const go = spawnNPC(world, chunk, opts);
	return {
		go,
		id,
		tags: ['Shopper', ...tmpl.wants, leaveGate],
	};
}
