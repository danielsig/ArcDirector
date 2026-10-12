export type ItemDef = {
	id:string;
	name:string;
	stackable?:boolean;
	maxStack?:number;
	meshID?:string;
	color?:number;
	components:{
		Key?:{ keyID:string };
		Equipable?:{ slots:string[]; hands:0 | 1 | 2 };
		Container?:{ size:number };
		Weapon?:{ damage:number; range:number };
		Blade?:Record<string, never>;
		Armor?:{ defense:number; covers:string[] };
		Consumable?:{ effect:string; amount:number; consumeOnUse:boolean };
		Torch?:{ lit:boolean };
		Flame?:{ canIgnite:boolean };
		Ingredient?:{ brewer:string; fee:string; brew:string; yield:number };
		Goods?:{ ask:number };
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
	magic_potion: {
		id: 'magic_potion',
		name: 'Magic potion',
		stackable: true,
		maxStack: 9,
		meshID: 'item_potion',
		color: 0x7b3cc2,
		components: {
			Consumable: { effect: 'heal', amount: 3, consumeOnUse: true },
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
	short_bow: {
		id: 'short_bow',
		name: 'Short bow',
		meshID: 'item_bow',
		color: 0x8a5a32,
		components: {
			Equipable: { slots: HELD, hands: 2 },
			Weapon: { damage: 4, range: 12 },
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
		name: 'Gold coin',
		stackable: true,
		maxStack: 9,
		meshID: 'item_key',
		color: 0xe6c34a,
		components: {},
	},
	bridge_crank: {
		id: 'bridge_crank',
		name: 'Bridge crank',
		meshID: 'item_key',
		color: 0x8a5a32,
		components: {
			Equipable: { slots: HELD, hands: 1 },
		},
	},
	fire_mushroom: {
		id: 'fire_mushroom',
		name: 'FireMushroom',
		stackable: true,
		maxStack: 9,
		meshID: 'item_mushroom',
		color: 0xe07030,
		components: { Goods: { ask: 10 } },
	},
	moon_mushroom: {
		id: 'moon_mushroom',
		name: 'MoonMushroom',
		stackable: true,
		maxStack: 9,
		meshID: 'item_mushroom',
		color: 0x3a6ad8,
		components: { Goods: { ask: 10 } },
	},
	silver_trout: {
		id: 'silver_trout',
		name: 'Silver trout',
		stackable: true,
		maxStack: 9,
		meshID: 'item_potion',
		color: 0x9eb4c8,
		components: { Goods: { ask: 5 } },
	},
	bitterroot: {
		id: 'bitterroot',
		name: 'Bitterroot',
		stackable: true,
		maxStack: 9,
		meshID: 'item_potion',
		color: 0x4a8f4a,
		components: {
			Ingredient: { brewer: 'Alchemist', fee: 'gold_coin', brew: 'magic_potion', yield: 2 },
		},
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
		meshID: 'item_potion',
		color: 0xc23b3a,
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

export function getDef(defID:string):ItemDef {
	const def = ITEM_DEFS[defID];
	if (!def) {
		throw new Error(`unknown item def '${defID}'`);
	}
	return def;
}
