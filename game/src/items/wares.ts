import type { SpeechVoice } from '@arc-director/kindling';

/** One thing a seller sells, and the gold price a standing offer posts. */
export type Ware = {
	name:string;
	defID:string;
	meshID:string;
	ask:number;
	/** A counter below this is refused. */
	floor:number;
	aliases:string[];
};

/**
 * A seller, the post they never leave (a stall in the square, or a counter inside their shop), and the goods on it.
 * `cell` is the map cell they stand on, behind the post.
 */
export type Seller = {
	vendor:string;
	/** Their character model. */
	model:string;
	/** How they sound. */
	voice?:SpeechVoice;
	/** The named stall or counter they serve from. */
	post:string;
	/** The post's look: a `stall_*` in the square, or a `counter_*` indoors. */
	postMesh:string;
	/** The house the counter stands in: a shop, not a stall. */
	shop?:string;
	square:'north' | 'south';
	cell:[number, number];
	yaw:number;
	wallet:number;
	aliases:string[];
	traits:string[];
	/** How they talk and carry themselves, in their own words. */
	manner:string;
	/** Something they would like, and will not walk off to fetch. */
	want:string;
	wares:Ware[];
};

const FACE_SOUTH = Math.PI;
const FACE_NORTH = 0;

/**
 * Two stalls and a shop on the north square, three stalls and a shop on the south. Every ware name here is a
 * standing offer, a shopper tag, and a mesh on the counter.
 */
export const SELLERS:Seller[] = [
	{
		vendor: 'Baker',
		model: 'VillagerMale',
		voice: { pitch: 190, rate: 5.2, range: 1.3 },
		post: 'BakerStall',
		postMesh: 'stall_baker',
		square: 'north',
		cell: [5, 3],
		yaw: FACE_SOUTH,
		wallet: 18,
		aliases: ['bakery', 'baker stall'],
		traits: ['warm', 'motherly', 'fussing'],
		manner: 'I call everyone love, hum while I work, and dust flour off my hands before I take any coin. I fret that the bread is going cold and press a word of advice on whoever buys.',
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
		model: 'Shaman',
		voice: { pitch: 330, rate: 6.2, range: 0.8 },
		post: 'WeaverStall',
		postMesh: 'stall_weaver',
		square: 'north',
		cell: [9, 3],
		yaw: FACE_SOUTH,
		wallet: 14,
		aliases: ['weaver stall'],
		traits: ['sharp', 'proud', 'thrifty'],
		manner: 'I speak in short clipped sentences and count every coin twice. I praise my own cloth, never anyone else\'s, and I sniff at a shopper who handles the goods.',
		want: 'Loaf',
		wares: [
			{ name: 'Scarf', defID: 'scarf', meshID: 'item_scarf', ask: 6, floor: 4, aliases: ['scarves'] },
			{ name: 'Hood', defID: 'hood', meshID: 'item_hood', ask: 9, floor: 6, aliases: ['hoods', 'cowl'] },
			{ name: 'Ribbon', defID: 'ribbon', meshID: 'item_ribbon', ask: 3, floor: 2, aliases: ['ribbons'] },
		],
	},
	{
		vendor: 'Apothecary',
		model: 'Witch',
		voice: { pitch: 250, rate: 4.2, range: 1.8 },
		post: 'ApothecaryCounter',
		postMesh: 'counter_apothecary',
		shop: 'ApothecaryShop',
		square: 'north',
		cell: [26, 3],
		yaw: FACE_SOUTH,
		wallet: 20,
		aliases: ['apothecary counter', 'herb counter'],
		traits: ['cryptic', 'theatrical', 'nosy'],
		manner: 'I whisper, I call every customer dearie, and I speak in little rhymes when the mood takes me. I sniff the air when someone comes in and hint that I know what ails them before they say it. I pry.',
		want: 'Jug',
		wares: [
			{ name: 'Tonic', defID: 'tonic', meshID: 'item_tonic', ask: 6, floor: 4, aliases: ['tonics', 'potion', 'remedy', 'cure'] },
			{ name: 'Salve', defID: 'salve', meshID: 'item_salve', ask: 4, floor: 2, aliases: ['salves', 'ointment', 'balm'] },
			{ name: 'Lavender', defID: 'lavender', meshID: 'item_lavender', ask: 3, floor: 2, aliases: ['herbs', 'flowers', 'bundle'] },
			{ name: 'Soap', defID: 'soap', meshID: 'item_soap', ask: 2, floor: 1, aliases: ['soaps', 'bar of soap'] },
		],
	},
	{
		vendor: 'Potter',
		model: 'Sorceress',
		voice: { pitch: 280, rate: 4.6, range: 0.5 },
		post: 'PotterStall',
		postMesh: 'stall_potter',
		square: 'south',
		cell: [9, 27],
		yaw: FACE_NORTH,
		wallet: 16,
		aliases: ['potter stall'],
		traits: ['quiet', 'kind', 'dusty'],
		manner: 'I say little: mostly mm, there now, and mind the rim. I never raise my voice, I turn a bowl in my hands while I think, and there is clay dust on everything I own.',
		want: 'Scarf',
		wares: [
			{ name: 'Bowl', defID: 'bowl', meshID: 'item_bowl', ask: 4, floor: 2, aliases: ['bowls', 'pottery'] },
			{ name: 'Jug', defID: 'jug', meshID: 'item_jug', ask: 7, floor: 4, aliases: ['jugs', 'pitcher'] },
		],
	},
	{
		vendor: 'Cutler',
		model: 'Blacksmith',
		voice: { pitch: 160, rate: 4.8, range: 0.6 },
		post: 'CutlerStall',
		postMesh: 'stall_cutler',
		square: 'south',
		cell: [14, 27],
		yaw: FACE_NORTH,
		wallet: 22,
		aliases: ['cutler stall'],
		traits: ['gruff', 'honest', 'impatient'],
		manner: 'I bark in half sentences: Seven. Take it or don\'t. No small talk, no haggling past the second word, and I tell anyone who dithers to move along.',
		want: 'Bowl',
		wares: [
			{ name: 'Knife', defID: 'kitchen_knife', meshID: 'item_knife', ask: 7, floor: 4, aliases: ['knives', 'blade'] },
			{ name: 'Cleaver', defID: 'cleaver', meshID: 'item_cleaver', ask: 11, floor: 7, aliases: ['cleavers'] },
			{ name: 'Shears', defID: 'shears', meshID: 'item_shears', ask: 5, floor: 3, aliases: ['scissors'] },
			{ name: 'Hook', defID: 'hook', meshID: 'item_hook', ask: 6, floor: 4, aliases: ['hooks'] },
		],
	},
	{
		vendor: 'Grocer',
		model: 'Merchant',
		voice: { pitch: 210, rate: 6.4, range: 2 },
		post: 'FruitStall',
		postMesh: 'stall_fruit',
		square: 'south',
		cell: [21, 27],
		yaw: FACE_NORTH,
		wallet: 12,
		aliases: ['fruit stall', 'grocer stall', 'greengrocer'],
		traits: ['loud', 'boastful', 'haggler'],
		manner: 'I shout my wares at the whole square in rhymes, call Baker\'s loaves stale and my fruit the sweetest on either bank, and never give a price without a boast. I love a haggle and act wounded by every counter.',
		want: 'Shears',
		wares: [
			{ name: 'Apple', defID: 'apple', meshID: 'item_apple', ask: 3, floor: 2, aliases: ['apples', 'fruit'] },
			{ name: 'Pear', defID: 'pear', meshID: 'item_pear', ask: 4, floor: 2, aliases: ['pears'] },
			{ name: 'Plum', defID: 'plum', meshID: 'item_plum', ask: 2, floor: 1, aliases: ['plums'] },
		],
	},
	{
		vendor: 'Toymaker',
		model: 'Robe',
		voice: { pitch: 230, rate: 5.6, range: 2.2 },
		post: 'ToyCounter',
		postMesh: 'counter_toys',
		shop: 'ToyShop',
		square: 'south',
		cell: [3, 26],
		yaw: FACE_NORTH,
		wallet: 9,
		aliases: ['toy counter'],
		traits: ['giddy', 'childlike', 'generous'],
		manner: 'I giggle, I talk in exclamations, and I call every customer little one whatever their age. I count one, two, three! when I hand something over, and I make the toy do a trick first.',
		want: 'Ribbon',
		wares: [
			{ name: 'WoodenHorse', defID: 'wooden_horse', meshID: 'item_wooden_horse', ask: 8, floor: 5, aliases: ['horse', 'toy horse', 'hobby horse'] },
			{ name: 'Doll', defID: 'doll', meshID: 'item_doll', ask: 6, floor: 4, aliases: ['dolls', 'rag doll', 'poppet'] },
			{ name: 'Whistle', defID: 'whistle', meshID: 'item_whistle', ask: 2, floor: 1, aliases: ['whistles', 'pipe'] },
			{ name: 'SpinningTop', defID: 'spinning_top', meshID: 'item_spinning_top', ask: 3, floor: 2, aliases: ['top', 'tops', 'spinning top'] },
		],
	},
];

export function sellerOf(vendor:string):Seller {
	const seller = SELLERS.find((s) => s.vendor === vendor);
	if (!seller) {
		throw new Error(`no seller ${vendor}`);
	}
	return seller;
}

export function packOf(vendor:string):{ defID:string; name:string; count:number }[] {
	return sellerOf(vendor).wares.map((ware) => ({ defID: ware.defID, name: ware.name, count: 99 }));
}

export function goodsOf(vendor:string):string[] {
	return sellerOf(vendor).wares.map((ware) => ware.name);
}

/** Mesh ids laid on that post's counter, in order. */
export function waresForMesh(meshID:string):string[] {
	return SELLERS.find((s) => s.postMesh === meshID)?.wares.map((ware) => ware.meshID) ?? [];
}

/** Each named post's look, for the map's stall glyphs. */
export const POST_MESH:Record<string, string> = Object.fromEntries(SELLERS.map((s) => [s.post, s.postMesh]));

export function nameList(names:string[]):string {
	if (names.length <= 1) {
		return names[0] ?? '';
	}
	return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Where a seller is found: their stall, or the counter inside their shop. */
export function placeOf(s:Seller):string {
	return s.shop ? `${s.post} inside ${s.shop}` : s.post;
}

/** Who sells what, and for how much gold, in one sentence per seller. */
export function priceList():string {
	return SELLERS.map((s) => `${s.vendor} at ${placeOf(s)} sells ${nameList(s.wares.map((w) => `${w.name} for ${w.ask} gold`))}`).join('. ');
}

/** The stalls and shops on each square, and the gate on that side. */
export function squareList():string {
	return (['north', 'south'] as const).map((square) => {
		const here = SELLERS.filter((s) => s.square === square).map((s) => s.shop ?? s.post);
		return `${nameList([...here, square === 'north' ? 'WestGate' : 'EastGate'])} are on the ${square} square`;
	}).join('; ');
}
