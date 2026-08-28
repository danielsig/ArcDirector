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
	mill_crank: {
		id: 'mill_crank',
		name: 'Mill crank',
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
		meshID: 'item_potion',
		color: 0xe07030,
		components: {},
	},
	silver_trout: {
		id: 'silver_trout',
		name: 'Silver trout',
		stackable: true,
		maxStack: 9,
		meshID: 'item_potion',
		color: 0x9eb4c8,
		components: {},
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
		meshID: 'item_bomb',
		color: 0xc4a05a,
		components: { Goods: { ask: 5 } },
	},
	scarf: {
		id: 'scarf',
		name: 'Scarf',
		stackable: true,
		maxStack: 9,
		meshID: 'item_glove',
		color: 0xb03a4a,
		components: { Goods: { ask: 6 } },
	},
	bowl: {
		id: 'bowl',
		name: 'Bowl',
		stackable: true,
		maxStack: 9,
		meshID: 'item_potion',
		color: 0xb88858,
		components: { Goods: { ask: 4 } },
	},
	kitchen_knife: {
		id: 'kitchen_knife',
		name: 'Knife',
		stackable: true,
		maxStack: 9,
		meshID: 'item_sword',
		color: 0xb8c0c8,
		components: { Goods: { ask: 7 } },
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

export const GLEN_FEE_DEF = 'fire_mushroom';
export const GLEN_FEE_NAME = 'FireMushroom';

export function getDef(defID:string):ItemDef {
	const def = ITEM_DEFS[defID];
	if (!def) {
		throw new Error(`unknown item def '${defID}'`);
	}
	return def;
}
