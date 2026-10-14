import { allocID } from '@arc-director/kindling';
import type { ItemDef } from './defs';

export type ItemInstance = {
	id:string;
	defID:string;
	name:string;
	count:number;
	stackable:boolean;
	maxStack:number;
	meshID:string;
	color:number | undefined;
	Key?:{ keyID:string };
	Equipable?:{ slots:string[]; hands:0 | 1 | 2 };
	Container?:{ size:number; contents:ItemInstance[] };
	Weapon?:{ damage:number; range:number };
	Blade?:Record<string, never>;
	Armor?:{ defense:number; covers:string[] };
	Consumable?:{ effect:string; amount:number; consumeOnUse:boolean };
	Torch?:{ lit:boolean };
	Flame?:{ canIgnite:boolean };
	Ingredient?:{ brewer:string; fee:string; brew:string; yield:number };
};

export function isBackpack(item:ItemInstance):boolean {
	return !!item.Equipable && !!item.Container;
}

export function cloneItem(item:ItemInstance, count = item.count):ItemInstance {
	return {
		...item,
		id: allocID('item'),
		count,
		Container: item.Container
			? {
				size: item.Container.size,
				contents: item.Container.contents.map((c) => cloneItem(c)),
			}
			: undefined,
	};
}

export function instantiateDef(def:ItemDef, count?:number):ItemInstance {
	const n = count ?? 1;
	const inst:ItemInstance = {
		id: allocID('item'),
		defID: def.id,
		name: def.name,
		count: n,
		stackable: def.stackable ?? false,
		maxStack: def.maxStack ?? (def.stackable ? 9 : 1),
		meshID: def.meshID ?? 'item',
		color: def.color,
	};
	const c = def.components;
	if (c.Key) {
		inst.Key = { keyID: c.Key.keyID };
	}
	if (c.Equipable) {
		inst.Equipable = { slots: [...c.Equipable.slots], hands: c.Equipable.hands };
	}
	if (c.Container) {
		inst.Container = { size: c.Container.size, contents: [] };
	}
	if (c.Weapon) {
		inst.Weapon = { damage: c.Weapon.damage, range: c.Weapon.range };
	}
	if (c.Blade) {
		inst.Blade = {};
	}
	if (c.Armor) {
		inst.Armor = { defense: c.Armor.defense, covers: [...c.Armor.covers] };
	}
	if (c.Consumable) {
		inst.Consumable = {
			effect: c.Consumable.effect,
			amount: c.Consumable.amount,
			consumeOnUse: c.Consumable.consumeOnUse,
		};
	}
	if (c.Torch) {
		inst.Torch = { lit: c.Torch.lit };
	}
	if (c.Flame) {
		inst.Flame = { canIgnite: c.Flame.canIgnite };
	}
	if (c.Ingredient) {
		inst.Ingredient = { ...c.Ingredient };
	}
	return inst;
}
