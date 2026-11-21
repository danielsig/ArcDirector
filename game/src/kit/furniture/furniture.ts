import { Component, GameObject, yawToForward, type XZ } from '@arc-director/kindling';
import { nameList } from '../../director/names';
import { Named, idOf } from '../../engine/components';
import type { DemoWorld } from '../../engine/demo-world';
import { Container } from '../../items/item-components';
import { BOOKS, getDef } from '../../items/defs';
import { instantiateDef } from '../../items/instance';
import { freeWorldID } from '../../items/pickup';
import { enclosureAt } from '../houses/interior';
import { Chest } from '../chests/chest';
import type { Sense } from '../thing';

/** A chest with no lid: what it holds stands in plain sight, for anyone to take down. */
export class Bookshelf extends Chest {
	public override open = true;

	public override sense():Sense {
		return { ...super.sense(), examine: (name, nameOf, viewer) => `${name} is a bookshelf.${this.inside(viewer)}` };
	}
}

/**
 * Something to rest on: a `chair` to sit on or a `bed` to sleep in, one body at a time; or a bench, a chair with
 * `places` side by side across its `width` (meters).
 */
export class Furniture extends Component {
	public kind:'chair' | 'bed' = 'chair';
	public places = 1;
	public width = 0;
	/** Who rests on each of its places; a free one is null. */
	public occupants:(GameObject | null)[] = [];

	/** The place `body` rests on, else the first free one; -1 when none is left for it. */
	public placeFor(body:GameObject):number {
		const own = this.occupants.indexOf(body);
		if (own >= 0) {
			return own;
		}
		for (let i = 0; i < this.places; i++) {
			if (!this.occupants[i]) {
				return i;
			}
		}
		return -1;
	}

	/** Where place `i` is, world XZ: the places side by side across its width, left to right as one sits. */
	public placeAt(i:number):XZ {
		const p = this.gameObject.transform.position;
		const right = yawToForward(this.gameObject.transform.yaw + Math.PI / 2);
		const along = (i - (this.places - 1) / 2) * this.width / this.places;
		return { x: p.x + right.x * along, z: p.z + right.z * along };
	}

	/** Furniture of its kind, and who rests on it. */
	public sense():Sense {
		const on = occupantNames(this.gameObject);
		const are = on.length > 1 ? 'are' : 'is';
		return {
			tags: ['furniture', this.kind],
			interactable: true,
			movable: false,
			note: on.length > 0 ? `${nameList(on)} ${are} on it` : undefined,
			examine: (name, nameOf) => `${name} is a ${this.places > 1 ? 'bench' : this.kind}${on.length > 0 ? `, and ${nameList(on.map(nameOf))} ${are} on it` : ''}.`,
		};
	}
}

/** Who rests on `seat`, for the words about it. */
export function occupantNames(seat:GameObject):string[] {
	return (seat.getComponent(Furniture)?.occupants ?? []).filter((go) => !!go).map(idOf);
}

/** The dressing props characters can use: what each is called, and what makes it so. */
const USABLE:Partial<Record<string, { word:string; fit:(go:GameObject)=>void }>> = {
	chair: { word: 'Chair', fit: (go) => go.addComponent(Furniture, { kind: 'chair' }) },
	bed: { word: 'Bed', fit: (go) => go.addComponent(Furniture, { kind: 'bed' }) },
	bookshelf: {
		word: 'Bookshelf',
		fit: (go) => {
			go.addComponent(Bookshelf);
			go.addComponent(Container, { size: BOOKS.length }).contents.push(...BOOKS.map((id) => instantiateDef(getDef(id))));
		},
	},
};

/**
 * Each chair, bed and bookshelf in the plan as something characters can name and use, once each: the mesh and the collider stay
 * dressing. Called what the map calls it, else after the house it stands in: `HutChair`. Call it with
 * `syncDressingColliders`, after the chunk's buildings are in.
 */
export function syncFurniture(world:DemoWorld):void {
	for (const spot of world.terrain.plan.props) {
		const usable = USABLE[spot.prop];
		const key = `furniture_${spot.x.toFixed(2)}_${spot.z.toFixed(2)}`;
		if (!usable || spot.topped || world.objects.some((o) => o.name === key)) {
			continue;
		}
		const house = enclosureAt(world, spot.x, spot.z);
		const id = freeWorldID(world, spot.name ?? `${house?.getComponent(Named)?.id ?? ''}${usable.word}`);
		const go = new GameObject(id, key);
		go.transform.localPosition = spot;
		go.transform.yaw = spot.yaw;
		go.addComponent(Named, { id });
		usable.fit(go);
		world.add(go);
	}
}
