import { Armor, Blade, Bow, Consumable, Container, Equipable, Item, Key, Pickupable, Weapon } from '../items/item-components';
import { ChunkBound, GameObject, Rigidbody, type Component, type ComponentInit } from '@arc-director/kindling';
import { BoxCollider, Flame, Named } from '../engine/components';
import { DemoMeshRenderer } from '../engine/demo-mesh-renderer';
import type { DemoWorld } from '../engine/demo-world';
import { ITEM_DEFS } from '../items/defs';
import type { ItemInstance } from '../items/instance';
import { Torch } from '../kit/torches/torch';

/** How one part of an item goes between an instance and a component: read off `go`, or added to it. */
type ItemPart<D> = { read(go:GameObject):D | undefined; add(go:GameObject, data:D):void };

/** `fields` of `from`, lists copied, so the copy shares none of them. */
function pick<T, F extends keyof T>(from:T, fields:readonly F[]):Pick<T, F> {
	const out = {} as Pick<T, F>;
	for (const field of fields) {
		const value = from[field];
		out[field] = (Array.isArray(value) ? [...value] : value) as T[F];
	}
	return out;
}

/** Component `type` as an item part: `fields` copied both ways, `extra` set on it as it is added. */
function part<C extends Component, F extends keyof C>(type:new ()=>C, fields:readonly F[], extra:ComponentInit<C> = {}):ItemPart<Pick<C, F>> {
	return {
		read: (go) => {
			const c = go.getComponent(type);
			return c && pick(c, fields);
		},
		add: (go, data) => {
			go.addComponent(type, { ...extra, ...data });
		},
	};
}

type PartName = Exclude<keyof ItemInstance, 'id' | 'defID' | 'name' | 'count' | 'stackable' | 'maxStack' | 'meshID' | 'color'>;
/** Each part as an instance keeps it. */
type PartData = { [K in PartName]-?:NonNullable<ItemInstance[K]> };

type PartMap = { [K in PartName]:ItemPart<PartData[K]> };
let parts:PartMap | undefined;

/**
 * Every part an item can have, each as its component and the fields an instance keeps of it. Built on first use: some of
 * the components come in through an import cycle.
 */
function itemParts():PartMap {
	return (parts ??= {
		Key: part(Key, ['keyID']),
		Equipable: part(Equipable, ['slots', 'hands']),
		Container: part(Container, ['size', 'contents']),
		Weapon: part(Weapon, ['damage', 'range']),
		Blade: part(Blade, []),
		Bow: part(Bow, []),
		Armor: part(Armor, ['defense', 'covers']),
		Consumable: part(Consumable, ['effect', 'amount', 'consumeOnUse']),
		Torch: part(Torch, ['lit'], { baseIntensity: 28, range: 7 }),
		Flame: part(Flame, ['canIgnite']),
	});
}

function partNames():PartName[] {
	return Object.keys(itemParts()) as PartName[];
}

function readPart<K extends PartName>(go:GameObject, parts:Partial<PartData>, name:K):void {
	const data = itemParts()[name].read(go);
	if (data) {
		parts[name] = data;
	}
}

function addPart<K extends PartName>(go:GameObject, parts:Partial<PartData>, name:K):void {
	const data = parts[name];
	if (data) {
		itemParts()[name].add(go, data);
	}
}

/** What an item in the world is, as an instance to carry. */
export function captureItem(go:GameObject):ItemInstance {
	const item = go.getComponent(Item);
	if (!item) {
		throw new Error(`captureItem: ${go.id} has no Item`);
	}
	const mesh = go.getComponent(DemoMeshRenderer);
	const inst:ItemInstance = {
		id: go.id,
		defID: item.defID,
		name: go.getComponent(Named)?.id || go.name,
		count: item.count,
		stackable: item.stackable,
		maxStack: item.maxStack,
		meshID: mesh?.meshID ?? 'item',
		color: mesh?.color,
	};
	partNames().forEach((name) => readPart(go, inst, name));
	return inst;
}

/** `inst` lying at `x`, `y`, `z`, called what its def's `aliases` say besides its name. */
export function spawnWorldItem(world:DemoWorld, inst:ItemInstance, x:number, y:number, z:number, chunkID?:string):GameObject {
	const go = new GameObject(inst.id, inst.name);
	go.recipe = { item: structuredClone(inst), chunkID };
	go.transform.localPosition = { x, y, z };
	go.addComponent(Item, { defID: inst.defID, count: inst.count, stackable: inst.stackable, maxStack: inst.maxStack });
	partNames().forEach((name) => addPart(go, inst, name));
	go.addComponent(Pickupable);
	go.addComponent(DemoMeshRenderer, { meshID: inst.meshID, color: inst.color });
	go.addComponent(BoxCollider, { size: { x: 0.35, y: 0.35, z: 0.35 }, isTrigger: true, solid: false });
	go.addComponent(Rigidbody, { kinematic: true });
	if (chunkID) {
		go.addComponent(ChunkBound, { chunkID });
	}
	go.addComponent(Named, { id: inst.name, aliases: ITEM_DEFS[inst.defID]?.aliases?.slice() });
	world.add(go);
	return go;
}
