export type ItemDef = {
	id:string;
	name:string;
	stackable?:boolean;
	maxStack?:number;
	meshID?:string;
	color?:number;
	/** What looking it over tells, beyond its name. */
	about?:string;
	/** What else it is called, lying about. */
	aliases?:string[];
	components:{
		Key?:{ keyID:string };
		Equipable?:{ slots:string[]; hands:0 | 1 | 2 };
		Container?:{ size:number };
		Weapon?:{ damage:number; range:number };
		Blade?:Record<string, never>;
		Bow?:Record<string, never>;
		Armor?:{ defense:number; covers:string[] };
		Consumable?:{ effect:string; amount:number; consumeOnUse:boolean };
		Torch?:{ lit:boolean };
		Flame?:{ canIgnite:boolean };
		Goods?:{ ask:number };
		/** What reading it may turn up, a page at a time. */
		Book?:{ pages:string[] };
	};
};

const HELD = ['hands.left.held', 'hands.right.held'];
const WORN_HANDS = ['hands.left.worn', 'hands.right.worn'];

export const ITEM_DEFS:Record<string, ItemDef> = {
	brass_key: {
		id: 'brass_key',
		name: 'Brass key',
		stackable: true,
		maxStack: 9,
		meshID: 'item_key',
		color: 0xc4a35a,
		components: {
			Key: { keyID: 'brass' },
			Equipable: { slots: HELD, hands: 1 },
		},
	},
	iron_key: {
		id: 'iron_key',
		name: 'Iron key',
		stackable: true,
		maxStack: 9,
		meshID: 'item_key',
		color: 0x8a9098,
		components: {
			Key: { keyID: 'iron' },
			Equipable: { slots: HELD, hands: 1 },
		},
	},
	health_potion: {
		id: 'health_potion',
		name: 'Health potion',
		stackable: true,
		maxStack: 9,
		meshID: 'item_potion',
		color: 0xc23b4a,
		components: {
			Consumable: { effect: 'heal', amount: 2, consumeOnUse: true },
		},
	},
	bomb: {
		id: 'bomb',
		name: 'Bomb',
		stackable: true,
		maxStack: 9,
		meshID: 'item_bomb',
		color: 0x3a3230,
		components: {
			Weapon: { damage: 8, range: 3.5 },
		},
	},
	traveler_pack: {
		id: 'traveler_pack',
		name: "Traveler's pack",
		meshID: 'item_pack',
		color: 0x6b4423,
		components: {
			Equipable: { slots: ['back'], hands: 0 },
			Container: { size: 8 },
		},
	},
	wooden_torch: {
		id: 'wooden_torch',
		name: 'Wooden torch',
		meshID: 'item_torch',
		color: 0xb07a3a,
		components: {
			Equipable: { slots: HELD, hands: 1 },
			Torch: { lit: false },
			Flame: { canIgnite: true },
		},
	},
	iron_sword: {
		id: 'iron_sword',
		name: 'Iron sword',
		meshID: 'item_sword',
		color: 0xb8c0c8,
		components: {
			Equipable: { slots: ['hands.right.held', 'hands.left.held'], hands: 1 },
			Weapon: { damage: 3, range: 1.7 },
			Blade: {},
		},
	},
	bone_bow: {
		id: 'bone_bow',
		name: 'Bone bow',
		meshID: 'item_bow',
		color: 0xd8cfb8,
		components: {
			Equipable: { slots: HELD, hands: 2 },
			Weapon: { damage: 4, range: 12 },
			Bow: {},
		},
	},
	oak_staff: {
		id: 'oak_staff',
		name: 'Oak staff',
		meshID: 'Staff',
		color: 0x8a5a32,
		components: {
			Equipable: { slots: HELD, hands: 1 },
		},
	},
	shaman_staff: {
		id: 'shaman_staff',
		name: 'Shaman staff',
		meshID: 'ShamanStaff',
		color: 0x8a5a32,
		components: {
			Equipable: { slots: HELD, hands: 1 },
		},
	},
	short_bow: {
		id: 'short_bow',
		name: 'Short bow',
		meshID: 'item_bow',
		color: 0x8a5a32,
		components: {
			Equipable: { slots: HELD, hands: 2 },
			Weapon: { damage: 4, range: 12 },
			Bow: {},
		},
	},
	sun_crown: {
		id: 'sun_crown',
		name: 'Sun crown',
		meshID: 'item_key',
		color: 0xf2c84a,
		components: { Goods: { ask: 100 } },
	},
	wooden_shield: {
		id: 'wooden_shield',
		name: 'Wooden shield',
		meshID: 'item_shield',
		color: 0x8a5a32,
		components: {
			Equipable: { slots: HELD, hands: 1 },
			Armor: { defense: 1, covers: HELD },
		},
	},
	leather_glove: {
		id: 'leather_glove',
		name: 'Leather glove',
		meshID: 'item_glove',
		color: 0x9a6b3c,
		components: {
			Equipable: { slots: WORN_HANDS, hands: 0 },
		},
	},
	gold_coin: {
		id: 'gold_coin',
		aliases: ['Gold Coin', 'coin'],
		name: 'Gold coin',
		stackable: true,
		maxStack: 9,
		meshID: 'item_key',
		color: 0xe6c34a,
		components: {},
	},
	almanac: {
		id: 'almanac',
		name: 'Almanac',
		meshID: 'item_key',
		color: 0x6b4423,
		about: 'An old almanac of tides, tolls and weather, thumbed soft at the corners.',
		components: {
			Book: { pages: [
				'A toll unpaid is a debt remembered.',
				'When the river runs high, raise the bridge before dusk.',
				'Trout bite best after rain, and worst for the impatient.',
				'Blue mushrooms favor the lucky, or make them so.',
				'He who crosses without paying will cross back without welcome.',
				'A red sky at evening means a dry morning for the bridge.',
			] },
		},
	},
	river_tales: {
		id: 'river_tales',
		name: 'RiverTales',
		meshID: 'item_key',
		color: 0x2f6f8f,
		about: 'Tall stories of the river, with a fish on every page.',
		components: {
			Book: { pages: [
				'The trout of the old falls grew so fat they wore the riverbed smooth.',
				'A boatman once bargained with the river, and it has kept his hat ever since.',
				'They say the water remembers every name said over it.',
				'No one has ever landed the great pike of the glen, though many have told of it.',
			] },
		},
	},
	toll_book: {
		id: 'toll_book',
		name: 'TollBook',
		meshID: 'item_key',
		color: 0x7a2f2f,
		about: 'Column after column of tolls paid at this bridge, some in a hand long dead.',
		components: {
			Book: { pages: [
				'Paid in full: one goat, in the year of the long frost.',
				'Refused passage: a tinker who offered a song.',
				'Ten gold, as ever. It has been ten gold longer than anyone remembers.',
				'A note in the margin: the keeper before me never once raised the toll.',
			] },
		},
	},
	mushroom_lore: {
		id: 'mushroom_lore',
		name: 'MushroomLore',
		meshID: 'item_key',
		color: 0xb5651d,
		about: 'A forager\'s notes on what grows under the trees, with small careful drawings.',
		components: {
			Book: { pages: [
				'The orange cap is warm to the hand even on a cold morning.',
				'The blue cap glows faintly at dusk, and is easiest found then.',
				'Never take the last one from a ring: it will not come back.',
				'What grows under the pine will not grow under the oak.',
			] },
		},
	},
	old_songs: {
		id: 'old_songs',
		name: 'OldSongs',
		meshID: 'item_key',
		color: 0x4f7a3a,
		about: 'Songs of the glen, written down by someone who could not quite carry a tune.',
		components: {
			Book: { pages: [
				'Low the river, high the moon, the keeper sleeps and wakes too soon.',
				'Come across and pay your due, the bridge goes down for me and you.',
				'A trout for you, a cap for me, and home before the owls are free.',
				'Sing it slow, for it is long, and no one knows the end of the song.',
			] },
		},
	},
	bridge_crank: {
		id: 'bridge_crank',
		aliases: ['Bridge Crank', 'crank'],
		name: 'Bridge crank',
		meshID: 'item_key',
		color: 0x8a5a32,
		components: {
			Equipable: { slots: HELD, hands: 1 },
		},
	},
	fire_mushroom: {
		id: 'fire_mushroom',
		aliases: ['Fire Mushroom', 'mushroom'],
		name: 'FireMushroom',
		stackable: true,
		maxStack: 9,
		meshID: 'item_mushroom',
		color: 0xe07030,
		about: 'An orange cap, warm to the touch, smelling of smoke. They say it lightens the feet.',
		components: { Goods: { ask: 10 }, Consumable: { effect: 'swift', amount: 0.25, consumeOnUse: true } },
	},
	moon_mushroom: {
		id: 'moon_mushroom',
		aliases: ['Moon Mushroom', 'blue mushroom'],
		name: 'MoonMushroom',
		stackable: true,
		maxStack: 9,
		meshID: 'item_mushroom',
		color: 0x3a6ad8,
		about: 'A blue cap, cool and faintly glowing. They say whoever eats one has luck for a while.',
		components: { Goods: { ask: 1 }, Consumable: { effect: 'lucky', amount: 0.25, consumeOnUse: true } },
	},
	silver_trout: {
		id: 'silver_trout',
		aliases: ['Silver Trout', 'trout', 'fish'],
		name: 'Silver trout',
		stackable: true,
		maxStack: 9,
		meshID: 'item_potion',
		color: 0x9eb4c8,
		about: 'Bright scales and clear eyes: fresh from the river.',
		components: { Goods: { ask: 5 }, Consumable: { effect: 'food', amount: 0, consumeOnUse: true } },
	},
	sushi: {
		id: 'sushi',
		name: 'Sushi',
		stackable: true,
		maxStack: 9,
		meshID: 'item_sushi',
		color: 0xf3efe4,
		about: 'Rice and raw fish, rolled tight: eaten at the stall, sitting down.',
		components: { Goods: { ask: 6 }, Consumable: { effect: 'food', amount: 0, consumeOnUse: true } },
	},
	loaf: {
		id: 'loaf',
		name: 'Loaf',
		stackable: true,
		maxStack: 9,
		meshID: 'item_loaf',
		color: 0xc4893a,
		components: { Goods: { ask: 5 } },
	},
	bun: {
		id: 'bun',
		name: 'Bun',
		stackable: true,
		maxStack: 9,
		meshID: 'item_bun',
		color: 0xe0b060,
		components: { Goods: { ask: 2 } },
	},
	pie: {
		id: 'pie',
		name: 'Pie',
		stackable: true,
		maxStack: 9,
		meshID: 'item_pie',
		color: 0xd4a05a,
		components: { Goods: { ask: 8 } },
	},
	cake: {
		id: 'cake',
		name: 'Cake',
		stackable: true,
		maxStack: 9,
		meshID: 'item_cake',
		color: 0xf3efe4,
		components: { Goods: { ask: 10 } },
	},
	scarf: {
		id: 'scarf',
		name: 'Scarf',
		stackable: true,
		maxStack: 9,
		meshID: 'item_scarf',
		color: 0xb03a4a,
		components: { Goods: { ask: 6 } },
	},
	hood: {
		id: 'hood',
		name: 'Hood',
		stackable: true,
		maxStack: 9,
		meshID: 'item_hood',
		color: 0x6a3058,
		components: { Goods: { ask: 9 } },
	},
	ribbon: {
		id: 'ribbon',
		name: 'Ribbon',
		stackable: true,
		maxStack: 9,
		meshID: 'item_ribbon',
		color: 0xd45078,
		components: { Goods: { ask: 3 } },
	},
	bowl: {
		id: 'bowl',
		name: 'Bowl',
		stackable: true,
		maxStack: 9,
		meshID: 'item_bowl',
		color: 0xc4885a,
		components: { Goods: { ask: 4 } },
	},
	jug: {
		id: 'jug',
		name: 'Jug',
		stackable: true,
		maxStack: 9,
		meshID: 'item_jug',
		color: 0xc47a4a,
		components: { Goods: { ask: 7 } },
	},
	kitchen_knife: {
		id: 'kitchen_knife',
		name: 'Knife',
		stackable: true,
		maxStack: 9,
		meshID: 'item_knife',
		color: 0xc5ced6,
		components: { Goods: { ask: 7 } },
	},
	cleaver: {
		id: 'cleaver',
		name: 'Cleaver',
		stackable: true,
		maxStack: 9,
		meshID: 'item_cleaver',
		color: 0xb0b8c0,
		components: { Goods: { ask: 11 } },
	},
	shears: {
		id: 'shears',
		name: 'Shears',
		stackable: true,
		maxStack: 9,
		meshID: 'item_shears',
		color: 0x9aa3ac,
		components: { Goods: { ask: 5 } },
	},
	hook: {
		id: 'hook',
		name: 'Hook',
		stackable: true,
		maxStack: 9,
		meshID: 'item_hook',
		color: 0x8a9098,
		components: { Goods: { ask: 6 } },
	},
	apple: {
		id: 'apple',
		name: 'Apple',
		stackable: true,
		maxStack: 9,
		meshID: 'item_apple',
		color: 0xc23b3a,
		components: { Goods: { ask: 3 } },
	},
	pear: {
		id: 'pear',
		name: 'Pear',
		stackable: true,
		maxStack: 9,
		meshID: 'item_pear',
		color: 0xb8c44a,
		components: { Goods: { ask: 4 } },
	},
	plum: {
		id: 'plum',
		name: 'Plum',
		stackable: true,
		maxStack: 9,
		meshID: 'item_plum',
		color: 0x5a2a6a,
		components: { Goods: { ask: 2 } },
	},
	tonic: {
		id: 'tonic',
		name: 'Tonic',
		stackable: true,
		maxStack: 9,
		meshID: 'item_tonic',
		color: 0x4ac27a,
		components: { Goods: { ask: 6 } },
	},
	salve: {
		id: 'salve',
		name: 'Salve',
		stackable: true,
		maxStack: 9,
		meshID: 'item_salve',
		color: 0xb8a060,
		components: { Goods: { ask: 4 } },
	},
	lavender: {
		id: 'lavender',
		name: 'Lavender',
		stackable: true,
		maxStack: 9,
		meshID: 'item_lavender',
		color: 0x8a6ac8,
		components: { Goods: { ask: 3 } },
	},
	soap: {
		id: 'soap',
		name: 'Soap',
		stackable: true,
		maxStack: 9,
		meshID: 'item_soap',
		color: 0xe8d8b8,
		components: { Goods: { ask: 2 } },
	},
	wooden_horse: {
		id: 'wooden_horse',
		name: 'WoodenHorse',
		stackable: true,
		maxStack: 9,
		meshID: 'item_wooden_horse',
		color: 0xa86a38,
		components: { Goods: { ask: 8 } },
	},
	doll: {
		id: 'doll',
		name: 'Doll',
		stackable: true,
		maxStack: 9,
		meshID: 'item_doll',
		color: 0xd89a7a,
		components: { Goods: { ask: 6 } },
	},
	whistle: {
		id: 'whistle',
		name: 'Whistle',
		stackable: true,
		maxStack: 9,
		meshID: 'item_whistle',
		color: 0xc8a050,
		components: { Goods: { ask: 2 } },
	},
	spinning_top: {
		id: 'spinning_top',
		name: 'SpinningTop',
		stackable: true,
		maxStack: 9,
		meshID: 'item_spinning_top',
		color: 0xc84a3a,
		components: { Goods: { ask: 3 } },
	},
	candle: {
		id: 'candle',
		name: 'Candle',
		stackable: true,
		maxStack: 9,
		meshID: 'item_torch',
		color: 0xe8d9a8,
		components: { Goods: { ask: 2 } },
	},
};

/** What one of an item is worth in gold, if it is goods: what it sells for. */
export function worthOf(defID:string):number | undefined {
	return ITEM_DEFS[defID]?.components.Goods?.ask;
}

/** The books on a bookshelf, by item def. */
export const BOOKS = ['almanac', 'river_tales', 'toll_book', 'mushroom_lore', 'old_songs'];

export function getDef(defID:string):ItemDef {
	const def = ITEM_DEFS[defID];
	if (!def) {
		throw new Error(`unknown item def '${defID}'`);
	}
	return def;
}
