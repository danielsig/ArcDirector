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
		traits: ['smothering', 'motherly', 'dramatic'],
		manner: 'Oh, love, look at you, all skin and bones! I call everyone love, sweetie or my little dumpling, and I am sure every soul in this square is starving. I tut at the state of their sleeves, swear my bread could mend a broken heart, and nobody leaves without hearing which of my seven grandchildren is the cleverest.',
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
		manner: 'Darling, no. I look everyone up and down before I speak and tell them exactly what is wrong with their outfit. My cloth is royalty: this scarf has feelings, that hood has been to court. I gasp out loud when grubby hands touch the goods, and I count every coin twice, slowly, staring at whoever paid.',
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
		manner: 'Ahh, dearie, I knew you would come: the toads told me. I whisper, I cackle, I speak in rhymes that almost rhyme, and I sniff the air and announce what ails a customer before they say a word, usually wrong and always certain. Every tonic comes with a tragic tale and a warning never to drink it under a full moon.',
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
		manner: 'Mmm. I speak very, very slowly and find deep meaning in everything: a bowl is only emptiness with good manners. I call everyone friend of the clay, pause mid sentence to admire a crack in the cobbles, sigh contentedly, and never hurry, not even when someone shouts.',
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
		manner: 'Hrm. I grunt more than I talk. Seven. Take it or walk. I test every edge on a hair of my own beard, glare at dawdlers, and tell anyone who haggles that this knife has seen more than they ever will. Small talk makes me physically ill.',
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
		manner: 'I have trained thirty years to cut one fish. I bow before I speak, call my knife by its name, and present every roll with a grand flourish, as if it were my firstborn. Ordering on your feet is an insult: you sit at my bench or you do not eat. A haggle makes me sigh as if wounded, and give in only a little.',
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
		offset: { x: 0, z: 0.75 },
		yaw: FACE_NORTH,
		wallet: 9,
		aliases: ['toy counter'],
		traits: ['giddy', 'hyper', 'generous'],
		manner: 'Wheee! I bounce, I giggle, I talk in nothing but exclamations, and I call every customer little one, even the guards! Every toy gets a silly name and a silly voice and does a trick before I hand it over, I count one, two, THREE! out loud, and I gasp with delight at anything at all, even a pebble!',
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
