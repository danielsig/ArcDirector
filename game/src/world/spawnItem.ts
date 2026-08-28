import {
	Armor,
	Blade,
	Consumable,
	Container,
	Equipable,
	Item,
	Key,
	Pickupable,
	Weapon,
} from '../items/components';
import {
	BoxCollider,
	ChunkBound,
	Flame,
	Light,
	Named,
	RigidBody,
	Torch,
} from '../engine/components';
import { MeshRenderer } from '../engine/MeshRenderer';
import { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';
import type { ItemInstance } from '../items/instance';
import { getDef, GLEN_FEE_NAME } from '../items/defs';

export function captureItem(go:GameObject):ItemInstance {
	const item = go.getComponent(Item);
	if (!item) {
		throw new Error(`captureItem: ${go.id} has no Item`);
	}
	const eq = go.getComponent(Equipable);
	const pack = go.getComponent(Container);
	const wpn = go.getComponent(Weapon);
	const arm = go.getComponent(Armor);
	const con = go.getComponent(Consumable);
	const key = go.getComponent(Key);
	const torch = go.getComponent(Torch);
	const flame = go.getComponent(Flame);
	const ingredient = getDef(item.defID).components.Ingredient;
	return {
		id: go.id,
		defID: item.defID,
		name: go.getComponent(Named)?.id || go.name,
		count: item.count,
		stackable: item.stackable,
		maxStack: item.maxStack,
		meshID: go.getComponent(MeshRenderer)?.meshID ?? 'item',
		color: go.getComponent(MeshRenderer)?.color,
		Key: key ? { keyID: key.keyID } : undefined,
		Equipable: eq ? { slots: [...eq.slots], hands: eq.hands } : undefined,
		Container: pack ? { size: pack.size, contents: pack.contents.slice() } : undefined,
		Weapon: wpn ? { damage: wpn.damage, range: wpn.range } : undefined,
		Blade: go.getComponent(Blade) ? {} : undefined,
		Armor: arm ? { defense: arm.defense, covers: [...arm.covers] } : undefined,
		Consumable: con
			? { effect: con.effect, amount: con.amount, consumeOnUse: con.consumeOnUse }
			: undefined,
		Torch: torch ? { lit: torch.lit } : undefined,
		Flame: flame ? { canIgnite: flame.canIgnite } : undefined,
		Ingredient: ingredient ? { ...ingredient } : undefined,
	};
}

export function applyInstance(go:GameObject, inst:ItemInstance):void {
	const item = go.addComponent(new Item());
	item.defID = inst.defID;
	item.count = inst.count;
	item.stackable = inst.stackable;
	item.maxStack = inst.maxStack;
	if (inst.Key) {
		const key = go.addComponent(new Key());
		key.keyID = inst.Key.keyID;
	}
	if (inst.Equipable) {
		const eq = go.addComponent(new Equipable());
		eq.slots = [...inst.Equipable.slots];
		eq.hands = inst.Equipable.hands;
	}
	if (inst.Container) {
		const pack = go.addComponent(new Container());
		pack.size = inst.Container.size;
		pack.contents = inst.Container.contents.slice();
	}
	if (inst.Weapon) {
		const wpn = go.addComponent(new Weapon());
		wpn.damage = inst.Weapon.damage;
		wpn.range = inst.Weapon.range;
	}
	if (inst.Blade) {
		go.addComponent(new Blade());
	}
	if (inst.Armor) {
		const arm = go.addComponent(new Armor());
		arm.defense = inst.Armor.defense;
		arm.covers = [...inst.Armor.covers];
	}
	if (inst.Consumable) {
		const con = go.addComponent(new Consumable());
		con.effect = inst.Consumable.effect;
		con.amount = inst.Consumable.amount;
		con.consumeOnUse = inst.Consumable.consumeOnUse;
	}
	if (inst.Torch) {
		const torch = go.addComponent(new Torch());
		torch.lit = inst.Torch.lit;
		torch.baseIntensity = 28;
		const light = go.addComponent(new Light());
		light.color = 0xff9a4a;
		light.intensity = torch.baseIntensity;
		light.decay = torch.baseDecay * 0.5;
		light.range = 7;
		light.castShadow = true;
		light.enabled = inst.Torch.lit;
	}
	if (inst.Flame) {
		const flame = go.addComponent(new Flame());
		flame.canIgnite = inst.Flame.canIgnite;
	}
}

export function spawnWorldItem(
	world:World,
	inst:ItemInstance,
	x:number,
	y:number,
	z:number,
	chunkID?:string,
):GameObject {
	const go = new GameObject(inst.id, inst.name);
	go.transform.position.x = x;
	go.transform.position.y = y;
	go.transform.position.z = z;
	applyInstance(go, inst);
	go.addComponent(new Pickupable());
	const mv = go.addComponent(new MeshRenderer());
	mv.meshID = inst.meshID;
	mv.color = inst.color;
	const col = go.addComponent(new BoxCollider());
	col.size = { x: 0.35, y: 0.35, z: 0.35 };
	col.isTrigger = true;
	col.solid = false;
	const rb = go.addComponent(new RigidBody());
	rb.kinematic = true;
	if (chunkID) {
		const bound = go.addComponent(new ChunkBound());
		bound.chunkID = chunkID;
	}
	const named = go.addComponent(new Named());
	named.id = inst.name;
	if (inst.name === 'MagicPotion') {
		named.aliases = ['Magic Potion', 'potion'];
	}
	if (inst.name === 'Bitterroot') {
		named.aliases = ['Bitter Root', 'herb'];
	}
	if (inst.name === 'GoldCoin') {
		named.aliases = ['Gold Coin', 'coin'];
	}
	if (inst.name === GLEN_FEE_NAME) {
		named.aliases = ['Fire Mushroom', 'mushroom'];
	}
	if (inst.name === 'SilverTrout') {
		named.aliases = ['Silver Trout', 'trout', 'fish'];
	}
	if (inst.name === 'MillCrank') {
		named.aliases = ['Mill Crank', 'crank'];
	}
	world.add(go);
	return go;
}
