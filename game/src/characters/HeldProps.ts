import { MeshRenderer, Time, closeHand, create, holdInHand, type Grip, type Hand, Component } from '@arc-director/kindling';
import * as THREE from 'three';
import { HumanBody } from '../engine/components';
import { bindMesh } from '../engine/MeshRenderer';
import { Order } from '../engine/order';
import { slotItem } from '../items/inventory';
import type { ItemInstance } from '../items/instance';
import { getSheet } from '../render/spritesheet';

/**
 * What an item looks like in the hand, by item def: its model, how the fist holds it, the hand it
 * shows in whichever hand slot holds it (a bow is gripped in the left, a staff in the right).
 */
const HELD:Record<string, { meshID:string; grip:Grip; hand?:Hand }> = {
	iron_sword: { meshID: 'Sword', grip: { at: 0.87, tilt: 2.1 } },
	// Straight through the fist, so a hand hanging at the side carries it level.
	short_bow: { meshID: 'ShamanBow', grip: {}, hand: 'left' },
	bone_bow: { meshID: 'SkeletalBow', grip: {}, hand: 'left' },
	oak_staff: { meshID: 'Staff', grip: { at: 0.62 }, hand: 'right' },
	shaman_staff: { meshID: 'ShamanStaff', grip: { at: 0.6 }, hand: 'right' },
	// Out ahead and up, away from the body: tipped toward the elbow it runs up the hanging arm, flame at the shoulder.
	wooden_torch: { meshID: 'held_torch', grip: { at: 0.3, tilt: 0.7 } },
};

/** Torch flame frames per second. */
const FLAME_FPS = 10;

type Held = { item:ItemInstance; prop:THREE.Object3D; mount:{ quaternion:THREE.Quaternion; position:THREE.Vector3 } };

/** Shows the items in a character's hands on its model's hand bones, fists closed round them, and keeps held torches burning. */
export class HeldProps extends Component {
	// Before `CharacterPose`, which poses held things further (a bow drawn from this carry).
	public static override order = Order.present - 2;

	private _root:THREE.Object3D | null = null;
	private readonly _held:Partial<Record<Hand, Held>> = {};

	/** The model in `hand`, if it shows one (the archer's bow, for drawing). */
	public prop(hand:Hand):THREE.Object3D | undefined {
		return this._held[hand]?.prop;
	}

	/** The top end of the model in `hand` (a staff's head), in world space; undefined with nothing there. */
	public tip(hand:Hand):THREE.Vector3 | undefined {
		const prop = this.prop(hand);
		if (!prop) {
			return undefined;
		}
		prop.updateMatrixWorld(true);
		const top = (prop.userData.top ??= localTop(prop)) as number;
		return prop.localToWorld(new THREE.Vector3(0, top, 0));
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
						this._held[hand] = { item, prop, mount: { quaternion: prop.quaternion.clone(), position: prop.position.clone() } };
					}
				}
			}
			const held = this._held[hand];
			if (held) {
				// Back in the fist as `holdInHand` put it; `CharacterPose` may turn it again this frame (a bow raised).
				held.prop.quaternion.copy(held.mount.quaternion);
				held.prop.position.copy(held.mount.position);
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

/** Turns a held prop about its `Grip` node to `turn` (world rotation), the grip staying in the fist. */
export function turnAboutGrip(prop:THREE.Object3D, turn:THREE.Quaternion):void {
	const parent = prop.parent;
	const grip = prop.getObjectByName('Grip');
	if (!parent || !grip) {
		return;
	}
	prop.updateMatrixWorld(true);
	const gripAt = grip.getWorldPosition(new THREE.Vector3());
	const gripLocal = prop.worldToLocal(gripAt.clone());
	prop.quaternion.copy(parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(turn));
	prop.position.copy(parent.worldToLocal(gripAt)).sub(gripLocal.multiply(prop.scale).applyQuaternion(prop.quaternion));
	prop.updateMatrixWorld(true);
}

/** How far up its long axis (+Y) a prop's meshes reach, in the prop's own space. */
function localTop(prop:THREE.Object3D):number {
	const toProp = prop.matrixWorld.clone().invert();
	const box = new THREE.Box3();
	prop.traverse((obj) => {
		const mesh = obj as THREE.Mesh;
		if (mesh.isMesh) {
			mesh.geometry.computeBoundingBox();
			box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(toProp.clone().multiply(mesh.matrixWorld)));
		}
	});
	return box.max.y;
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
