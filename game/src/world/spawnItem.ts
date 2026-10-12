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
import { ChunkBound } from '@arc-director/kindling';
import {
	BoxCollider,
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
import { getDef } from '../items/defs';

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
	go.addComponent(Item, {
		defID: inst.defID,
		count: inst.count,
		stackable: inst.stackable,
		maxStack: inst.maxStack,
	});
	if (inst.Key) {
		go.addComponent(Key, { keyID: inst.Key.keyID });
	}
	if (inst.Equipable) {
		go.addComponent(Equipable, { slots: [...inst.Equipable.slots], hands: inst.Equipable.hands });
	}
	if (inst.Container) {
		go.addComponent(Container, { size: inst.Container.size, contents: inst.Container.contents.slice() });
	}
	if (inst.Weapon) {
		go.addComponent(Weapon, { damage: inst.Weapon.damage, range: inst.Weapon.range });
	}
	if (inst.Blade) {
		go.addComponent(Blade);
	}
	if (inst.Armor) {
		go.addComponent(Armor, { defense: inst.Armor.defense, covers: [...inst.Armor.covers] });
	}
	if (inst.Consumable) {
		go.addComponent(Consumable, { ...inst.Consumable });
	}
	if (inst.Torch) {
		const torch = go.addComponent(Torch, { lit: inst.Torch.lit, baseIntensity: 28 });
		go.addComponent(Light, {
			color: 0xff9a4a,
			intensity: torch.baseIntensity,
			decay: torch.baseDecay * Torch.decayScale,
			range: 7,
			castShadow: true,
			enabled: inst.Torch.lit,
		});
	}
	if (inst.Flame) {
		go.addComponent(Flame, { canIgnite: inst.Flame.canIgnite });
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
	go.recipe = { item: structuredClone(inst), chunkID };
	go.transform.position.x = x;
	go.transform.position.y = y;
	go.transform.position.z = z;
	applyInstance(go, inst);
	go.addComponent(Pickupable);
	go.addComponent(MeshRenderer, { meshID: inst.meshID, color: inst.color });
	go.addComponent(BoxCollider, { size: { x: 0.35, y: 0.35, z: 0.35 }, isTrigger: true, solid: false });
	go.addComponent(RigidBody, { kinematic: true });
	if (chunkID) {
		go.addComponent(ChunkBound, { chunkID });
	}
	const named = go.addComponent(Named, { id: inst.name });
	if (inst.name === 'MagicPotion') {
		named.aliases = ['Magic Potion', 'potion'];
	}
	if (inst.name === 'Bitterroot') {
		named.aliases = ['Bitter Root', 'herb'];
	}
	if (inst.name === 'GoldCoin') {
		named.aliases = ['Gold Coin', 'coin'];
	}
	if (inst.name === 'FireMushroom') {
		named.aliases = ['Fire Mushroom', 'mushroom'];
	}
	if (inst.name === 'MoonMushroom') {
		named.aliases = ['Moon Mushroom', 'blue mushroom'];
	}
	if (inst.name === 'SilverTrout') {
		named.aliases = ['Silver Trout', 'trout', 'fish'];
	}
	if (inst.name === 'BridgeCrank') {
		named.aliases = ['Bridge Crank', 'crank'];
	}
	world.add(go);
	return go;
}
