/** One thing a stall sells, and the gold price a standing offer posts. */
export type Ware = {
	name:string;
	defID:string;
	meshID:string;
	ask:number;
	/** A counter below this is refused. */
	floor:number;
	aliases:string[];
};

/** A vendor, the stall they never leave, and the goods on that counter. */
export type Stall = {
	vendor:string;
	stall:string;
	meshID:string;
	aliases:string[];
	traits:string[];
	/** Something they would like, and will not walk off to fetch. */
	want:string;
	wares:Ware[];
};

/**
 * Baker four, weaver three, potter two, cutler four.
 * Every name here is a standing offer, a shopper tag, and a counter mesh.
 */
export const STALLS:Stall[] = [
	{
		vendor: 'Baker',
		stall: 'BakerStall',
		meshID: 'stall_baker',
		aliases: ['bakery', 'baker stall'],
		traits: ['warm', 'busy', 'fair'],
		want: 'Knife',
		wares: [
			{ name: 'Loaf', defID: 'loaf', meshID: 'item_loaf', ask: 5, floor: 3, aliases: ['bread', 'loaves'] },
			{ name: 'Bun', defID: 'bun', meshID: 'item_bun', ask: 2, floor: 1, aliases: ['buns', 'roll'] },
			{ name: 'Pie', defID: 'pie', meshID: 'item_pie', ask: 8, floor: 5, aliases: ['pies'] },
			{ name: 'Cake', defID: 'cake', meshID: 'item_cake', ask: 10, floor: 6, aliases: ['cakes'] },
		],
	},
	{
		vendor: 'Weaver',
		stall: 'WeaverStall',
		meshID: 'stall_weaver',
		aliases: ['weaver stall'],
		traits: ['sharp', 'proud', 'thrifty'],
		want: 'Loaf',
		wares: [
			{ name: 'Scarf', defID: 'scarf', meshID: 'item_scarf', ask: 6, floor: 4, aliases: ['scarves'] },
			{ name: 'Hood', defID: 'hood', meshID: 'item_hood', ask: 9, floor: 6, aliases: ['hoods', 'cowl'] },
			{ name: 'Ribbon', defID: 'ribbon', meshID: 'item_ribbon', ask: 3, floor: 2, aliases: ['ribbons'] },
		],
	},
	{
		vendor: 'Potter',
		stall: 'PotterStall',
		meshID: 'stall_potter',
		aliases: ['potter stall'],
		traits: ['quiet', 'kind', 'dusty'],
		want: 'Scarf',
		wares: [
			{ name: 'Bowl', defID: 'bowl', meshID: 'item_bowl', ask: 4, floor: 2, aliases: ['bowls', 'pottery'] },
			{ name: 'Jug', defID: 'jug', meshID: 'item_jug', ask: 7, floor: 4, aliases: ['jugs', 'pitcher'] },
		],
	},
	{
		vendor: 'Cutler',
		stall: 'CutlerStall',
		meshID: 'stall_cutler',
		aliases: ['cutler stall'],
		traits: ['gruff', 'honest', 'impatient'],
		want: 'Bowl',
		wares: [
			{ name: 'Knife', defID: 'kitchen_knife', meshID: 'item_knife', ask: 7, floor: 4, aliases: ['knives', 'blade'] },
			{ name: 'Cleaver', defID: 'cleaver', meshID: 'item_cleaver', ask: 11, floor: 7, aliases: ['cleavers'] },
			{ name: 'Shears', defID: 'shears', meshID: 'item_shears', ask: 5, floor: 3, aliases: ['scissors'] },
			{ name: 'Hook', defID: 'hook', meshID: 'item_hook', ask: 6, floor: 4, aliases: ['hooks'] },
		],
	},
];

export function stallOf(vendor:string):Stall {
	const stall = STALLS.find((s) => s.vendor === vendor);
	if (!stall) {
		throw new Error(`no stall for ${vendor}`);
	}
	return stall;
}

export function packOf(vendor:string):{ defID:string; name:string; count:number }[] {
	return stallOf(vendor).wares.map((ware) => ({ defID: ware.defID, name: ware.name, count: 99 }));
}

export function goodsOf(vendor:string):string[] {
	return stallOf(vendor).wares.map((ware) => ware.name);
}

/** Mesh ids laid on that stall's counter, in order. */
export function waresForMesh(meshID:string):string[] {
	return STALLS.find((s) => s.meshID === meshID)?.wares.map((ware) => ware.meshID) ?? [];
}

export function nameList(names:string[]):string {
	if (names.length <= 1) {
		return names[0] ?? '';
	}
	return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Who sells what, and for how much gold, in one sentence per stall. */
export function priceList():string {
	return STALLS.map((s) => `${s.vendor} at ${s.stall} sells ${nameList(s.wares.map((w) => `${w.name} for ${w.ask} gold`))}`).join('. ');
}
