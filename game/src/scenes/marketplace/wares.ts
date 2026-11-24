import type { SpeechVoice, XZ } from '@arc-director/kindling';
import type { ServingSpot } from 'arc-director';
import { nameList } from '../../director/names';
import type { BesideProp } from '../../kit/props/dressing-plan';
import type { EntityLegend } from '../../world/decode-glyph-chunk';

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
 * `cell` is the map cell they stand on, behind the post, `offset` meters off its center.
 */
export type Seller = {
	vendor:string;
	/** Their character model. */
	model:string;
	/** How they sound. */
	voice?:SpeechVoice;
	/** The named stall or counter they serve from. */
	post:string;
	/** The post's look, its map def: a `stall_*` in the square, or a `counter_*` indoors. */
	postMesh:string;
	/** The house the counter stands in: a shop, not a stall. */
	shop?:string;
	/**
	 * Where a buyer stands to be served, in front of the seller ({@link ServingSpot}). Left out, just before the counter's
	 * front, which the seller's pose measures; a seller beside their counter adds an `aside`.
	 */
	servingSpot?:ServingSpot;
	square:'north' | 'south';
	cell:[number, number];
	offset?:XZ;
	yaw:number;
	wallet:number;
	aliases:string[];
	traits:string[];
	/** How they talk and carry themselves, as told after their name (`calls everyone love, …`), never in their own words. */
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
		traits: ['smothering', 'motherly', 'dramatic'],
		manner: 'smothers everyone like a doting grandmother: calls them love, sweetie or little dumpling, is sure every soul in the square is starving, tuts at the state of their sleeves, swears the bread could mend a broken heart, and tells everyone which of seven grandchildren is the cleverest.',
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
		traits: ['snobbish', 'theatrical', 'stingy'],
		manner: 'is a snob: looks everyone up and down before speaking and says exactly what is wrong with their outfit, treats the cloth as royalty (a scarf with feelings, a hood that has been to court), gasps out loud when grubby hands touch the goods, and counts every coin twice, slowly, staring at whoever paid.',
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
		traits: ['spooky', 'theatrical', 'nosy'],
		manner: 'claims to have known each customer would come because the toads said so, whispers, cackles, speaks in rhymes that almost rhyme, sniffs the air and announces what ails a customer before they say a word, usually wrong and always certain, and sells every tonic with a tragic tale and a warning never to drink it under a full moon.',
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
		cell: [6, 27],
		yaw: FACE_NORTH,
		wallet: 16,
		aliases: ['potter stall'],
		traits: ['serene', 'slow', 'philosophical'],
		manner: 'speaks very, very slowly and finds deep meaning in everything, a bowl being only emptiness with good manners; calls everyone friend of the clay, pauses mid sentence to admire a crack in the cobbles, sighs contentedly, and never hurries, not even when someone shouts.',
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
		cell: [13, 27],
		yaw: FACE_NORTH,
		wallet: 22,
		aliases: ['cutler stall'],
		traits: ['gruff', 'grizzled', 'impatient'],
		manner: 'grunts more than talks and names a price in one word, take it or walk; tests every edge on a hair from the beard, glares at dawdlers, tells anyone who haggles that the knife has seen more than they ever will, and cannot stand small talk.',
		want: 'Bowl',
		wares: [
			{ name: 'Knife', defID: 'kitchen_knife', meshID: 'item_knife', ask: 7, floor: 4, aliases: ['knives', 'blade'] },
			{ name: 'Cleaver', defID: 'cleaver', meshID: 'item_cleaver', ask: 11, floor: 7, aliases: ['cleavers'] },
			{ name: 'Shears', defID: 'shears', meshID: 'item_shears', ask: 5, floor: 3, aliases: ['scissors'] },
			{ name: 'Hook', defID: 'hook', meshID: 'item_hook', ask: 6, floor: 4, aliases: ['hooks'] },
		],
	},
	{
		vendor: 'SushiChef',
		model: 'VillagerFemale',
		voice: { pitch: 260, rate: 6.4, range: 2 },
		post: 'SushiStall',
		postMesh: 'stall_sushi',
		square: 'south',
		cell: [20, 27],
		yaw: FACE_NORTH,
		wallet: 12,
		aliases: ['sushi stand', 'sushi bar'],
		traits: ['perfectionist', 'solemn', 'proud'],
		manner: 'has trained thirty years to cut one fish, bows before speaking, calls the knife by its name, presents every roll with a grand flourish as if it were a firstborn child, takes ordering on your feet as an insult (sit at the bench or do not eat), and sighs as if wounded at a haggle, giving in only a little.',
		want: 'Shears',
		wares: [
			{ name: 'Sushi', defID: 'sushi', meshID: 'item_sushi', ask: 6, floor: 4, aliases: ['sushi roll', 'roll'] },
		],
	},
	{
		vendor: 'Toymaker',
		model: 'Robe',
		voice: { pitch: 230, rate: 5.6, range: 2.2 },
		post: 'ToyCounter',
		// The shop is a pace deep before its counter, so its buyer stands a pace to Toymaker's right, inside ToyShopDoor,
		// and the line runs out through the door.
		servingSpot: { aside: 1 },
		postMesh: 'counter_toys',
		shop: 'ToyShop',
		square: 'south',
		cell: [27, 29],
		yaw: FACE_NORTH,
		wallet: 9,
		aliases: ['toy counter'],
		traits: ['giddy', 'hyper', 'generous'],
		manner: 'bounces, giggles and talks in nothing but exclamations, calls every customer little one, even the guards, gives every toy a silly name, a silly voice and a trick before handing it over, counts one, two, THREE! out loud, and gasps with delight at anything at all, even a pebble.',
		want: 'Ribbon',
		wares: [
			{ name: 'WoodenHorse', defID: 'wooden_horse', meshID: 'item_wooden_horse', ask: 8, floor: 5, aliases: ['horse', 'toy horse', 'hobby horse'] },
			{ name: 'Doll', defID: 'doll', meshID: 'item_doll', ask: 6, floor: 4, aliases: ['dolls', 'rag doll', 'poppet'] },
			{ name: 'Whistle', defID: 'whistle', meshID: 'item_whistle', ask: 2, floor: 1, aliases: ['whistles', 'pipe'] },
			{ name: 'SpinningTop', defID: 'spinning_top', meshID: 'item_spinning_top', ask: 3, floor: 2, aliases: ['top', 'tops', 'spinning top'] },
		],
	},
];

/** A seller's post on the map: its look and the wares on its counter; a counter stands on its shop's floorboards. */
export function postLegend(post:string, beside?:BesideProp[]):EntityLegend {
	const s = SELLERS.find((seller) => seller.post === post)!;
	return { kind: 'entity', def: s.postMesh, over: s.shop ? 'P' : '.', on: s.wares.map((ware) => ware.meshID), beside };
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
