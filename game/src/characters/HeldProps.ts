import { MeshRenderer, Time, create, holdInHand, type Grip, type Hand } from '@arc-director/kindling';
import { Component } from '../engine/Component';
import type * as THREE from 'three';
import { HumanBody } from '../engine/components';
import { bindMesh } from '../engine/MeshRenderer';
import { Order } from '../engine/order';
import { slotItem } from '../items/inventory';
import type { ItemInstance } from '../items/instance';
import { getSheet } from '../render/spritesheet';

/**
 * What an item looks like in the hand, by item def: its model, how the fist holds it, and the hand
 * it shows in whichever hand slot holds it (a bow is gripped in the left, a staff in the right).
 */
const HELD:Record<string, { meshID:string; grip:Grip; hand?:Hand }> = {
	iron_sword: { meshID: 'Sword', grip: { at: 0.87, tilt: 2.1 } },
	short_bow: { meshID: 'ShamanBow', grip: { tilt: 1 }, hand: 'left' },
	bone_bow: { meshID: 'SkeletalBow', grip: { tilt: 1 }, hand: 'left' },
	oak_staff: { meshID: 'Staff', grip: { at: 0.62, tilt: 1.4 }, hand: 'right' },
	shaman_staff: { meshID: 'ShamanStaff', grip: { at: 0.6, tilt: 1.4 }, hand: 'right' },
	wooden_torch: { meshID: 'held_torch', grip: { at: 0.3, tilt: 1.4 } },
};

/** Torch flame frames per second. */
const FLAME_FPS = 10;

type Held = { item:ItemInstance; prop:THREE.Object3D };

/** Shows the items in a character's hands on its model's hand bones, and keeps held torches burning. */
export class HeldProps extends Component {
	public static override order = Order.present - 1;

	private _root:THREE.Object3D | null = null;
	private readonly _held:Partial<Record<Hand, Held>> = {};

	/** The model in `hand`, if it shows one (the archer's bow, for drawing). */
	public prop(hand:Hand):THREE.Object3D | undefined {
		return this._held[hand]?.prop;
	}

	/** The item def shown in `hand`. */
	public defID(hand:Hand):string | undefined {
		return this._held[hand]?.item.defID;
	}

	public override lateUpdate():void {
		const root = this.gameObject.getComponent(MeshRenderer)?.mesh ?? null;
		const body = this.gameObject.getComponent(HumanBody);
		if (root !== this._root) {
			this.drop('left');
			this.drop('right');
			this._root = root;
		}
		if (!root || !body) {
			return;
		}
		const want:Partial<Record<Hand, ItemInstance>> = {};
		for (const hand of ['left', 'right'] as const) {
			const item = slotItem(body, `hands.${hand}.held`);
			const look = item && HELD[item.defID];
			if (item && look) {
				want[look.hand ?? hand] = item;
			}
		}
		for (const hand of ['left', 'right'] as const) {
			const item = want[hand];
			if (this._held[hand]?.item !== item) {
				this.drop(hand);
				const look = item && HELD[item.defID];
				if (item && look) {
					bindMesh(look.meshID);
					const prop = create(look.meshID);
					if (prop && holdInHand(root, hand, prop, look.grip)) {
						this._held[hand] = { item, prop };
					}
				}
			}
			const held = this._held[hand];
			if (held) {
				burn(held.prop, held.item.Torch?.lit === true);
			}
		}
	}

	public override onDestroy():void {
		this.drop('left');
		this.drop('right');
	}

	private drop(hand:Hand):void {
		this._held[hand]?.prop.removeFromParent();
		delete this._held[hand];
	}
}

/** Shows and flickers a held torch's flame while it is lit. */
function burn(prop:THREE.Object3D, lit:boolean):void {
	const flame = prop.userData.flame as THREE.Object3D | undefined;
	const mat = prop.userData.flameMaterial as THREE.MeshBasicMaterial | undefined;
	if (!flame || !mat) {
		return;
	}
	flame.visible = lit;
	if (lit) {
		const frames = getSheet().flame;
		const map = frames[Math.floor(Time.time * FLAME_FPS) % frames.length];
		if (map && mat.map !== map) {
			mat.map = map;
			mat.needsUpdate = true;
		}
	}
}
