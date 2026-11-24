import { MeshRenderer, Time, closeHand, create, degrees, holdInHand, otherHand, type Grip, type Hand, Component } from '@arc-director/kindling';
import * as THREE from 'three';
import { HumanBody, Light } from '../engine/components';
import { bindMesh } from '../engine/demo-mesh-renderer';
import { Order } from '../engine/order';
import { slotItem } from '../items/inventory';
import type { ItemInstance } from '../items/instance';
import { showFlameFrame } from '../render/spritesheet';
import { addFlameLight } from '../kit/torches/torch';

/**
 * What an item looks like in the hand, by item def: its model, how the right fist holds it (handles in the model's own
 * meters, turns in degrees), the hand it shows in whichever hand slot holds it (a bow is gripped in the left, a staff in
 * the right).
 */
const HELD:Record<string, { meshID:string; grip:Grip; hand?:Hand }> = {
	iron_sword: { meshID: 'Sword', grip: { handle: new THREE.Vector3(0, 0.87, 0), turn: degrees(-90, 0, 120.3) } },
	// Straight through the fist, so a hand hanging at the side carries it level.
	short_bow: { meshID: 'ShamanBow', grip: { turn: degrees(-90, 0, 0) }, hand: 'left' },
	bone_bow: { meshID: 'SkeletalBow', grip: { turn: degrees(-90, 0, 0) }, hand: 'left' },
	oak_staff: { meshID: 'Staff', grip: { handle: new THREE.Vector3(0, 1.054, 0), turn: degrees(90, 0, 180) }, hand: 'right' },
	shaman_staff: { meshID: 'ShamanStaff', grip: { handle: new THREE.Vector3(0, 0.96, 0), turn: degrees(90, 0, 180) }, hand: 'right' },
	// Straight through the fist, out ahead of a hanging one.
	wooden_torch: { meshID: 'held_torch', grip: { turn: degrees(90, 0, 179.7) } },
};

/** Torch flame frames per second. */
const FLAME_FPS = 10;

type Held = { item:ItemInstance; prop:THREE.Object3D };

/** Shows the items in a character's hands on its model's hand bones, fists closed round them, and keeps held torches burning and lighting the way. */
export class HeldProps extends Component {
	// Before `CharacterPose`, which poses the hands holding them (a bow drawn from this carry).
	public static override order = Order.present - 2;

	private _root:THREE.Object3D | null = null;
	private readonly _held:Partial<Record<Hand, Held>> = {};

	/** The model in `hand`, if it shows one (the archer's bow, for drawing). */
	public prop(hand:Hand):THREE.Object3D | undefined {
		return this._held[hand]?.prop;
	}

	/**
	 * The point `share` of the way up the long axis of the model in `hand`, from its bottom end (0: a sword's tip) to its
	 * top (1: a staff's head), in world space; undefined with nothing there.
	 */
	public along(hand:Hand, share:number):THREE.Vector3 | undefined {
		const prop = this.prop(hand);
		if (!prop) {
			return undefined;
		}
		prop.updateMatrixWorld(true);
		const box = (prop.userData.box ??= localBox(prop)) as THREE.Box3;
		return prop.localToWorld(new THREE.Vector3(0, THREE.MathUtils.lerp(box.min.y, box.max.y, share), 0));
	}

	/** The item shown in `hand`. */
	public item(hand:Hand):ItemInstance | undefined {
		return this._held[hand]?.item;
	}

	/** The hand holding a lit torch, if one does. */
	public litHand():Hand | undefined {
		return (['right', 'left'] as const).find((hand) => this.item(hand)?.Torch?.lit);
	}

	/** A lit torch in either hand lights its holder's way: a flickering light by that hand (host-local +X is body-right). */
	public override update(dt:number):void {
		const hand = this.litHand();
		const light = this.gameObject.getComponent(Light) ?? (hand ? addFlameLight(this.gameObject, { range: 9, decay: 1, offsetY: 0.5, offsetZ: 0.3 }) : undefined);
		if (light) {
			light.enabled = !!hand;
			light.intensity = 32 * light.pulse(dt);
			light.offsetX = hand === 'right' ? 0.4 : -0.4;
		}
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
		// What one hand must grip (a bow, the left) takes it first; anything else its own hand, or the other one if taken.
		const want:Partial<Record<Hand, ItemInstance>> = {};
		for (const fixed of [true, false]) {
			for (const hand of ['left', 'right'] as const) {
				const item = slotItem(body, `hands.${hand}.held`);
				const look = item && HELD[item.defID];
				if (item && look && !!look.hand === fixed) {
					want[look.hand ?? (want[hand] ? otherHand(hand) : hand)] ??= item;
				}
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
				// The fist closes round it, whatever the clip does with the fingers.
				closeHand(root, hand, 1);
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

/** The box a prop's meshes fill, in the prop's own space. */
function localBox(prop:THREE.Object3D):THREE.Box3 {
	const toProp = prop.matrixWorld.clone().invert();
	const box = new THREE.Box3();
	prop.traverse((obj) => {
		const mesh = obj as THREE.Mesh;
		if (mesh.isMesh) {
			mesh.geometry.computeBoundingBox();
			box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(toProp.clone().multiply(mesh.matrixWorld)));
		}
	});
	return box;
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
		showFlameFrame(mat, Time.time, FLAME_FPS);
	}
}
