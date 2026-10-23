import { BoxCollider, Component, MeshRenderer, closeHand, create, crouch, humanBone, palmOf, placeFoot, reach, restFoot, yawToForward } from '@arc-director/kindling';
import * as THREE from 'three';
import { bindMesh } from '../engine/MeshRenderer';
import { Order } from '../engine/order';

/** Hip joint height over the floor when sat (a chair seat is about 0.47 m), and how far ahead of the seat's middle it sits, so the seat of the trousers clears the backrest. */
const HIP_SEAT = 0.65;
const HIP_AHEAD = 0.1;
/** Seconds to stand up. */
const STAND_SECONDS = 0.8;
/** How far to the side a body steps to get up out of its chair. */
const STEP_ASIDE = 0.45;
/** The rod's length, and how steeply it points up over the water (radians). */
const ROD_LENGTH = 2.2;
const ROD_RISE = 0.55;
/** Where the line meets the water, meters ahead. */
const CAST = 2.7;

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Sits where it stands (on a chair put there), knees bent and feet forward, and with `rod` fishes the water
 * ahead: a rod in both hands, its line out to a bobbing float. Its body stops being solid so the chair does
 * not push it off. `stand` gets up: the rod goes, it steps aside out of the chair and is solid again, and the
 * component does nothing more.
 */
export class Seated extends Component {
	// After the clip and the hands' props, before `CharacterPose` turns the head.
	public static override order = Order.present - 1.5;

	public rod = false;
	/** 1 sat, 0 stood; eases down as it stands. */
	private _sit = 1;
	private _standing = false;
	private _gear:{ rod:THREE.Object3D; line:THREE.Line; float:THREE.Mesh } | null = null;
	private _time = 0;
	/** World XZ of the middle of the seat: where it stood when it sat. */
	private _seat:{ x:number; z:number } | null = null;

	public get standing():boolean {
		return this._standing;
	}

	/** Gets up: the rod is put away now, and the pose eases out over {@link STAND_SECONDS}. */
	public stand():void {
		if (this._standing) {
			return;
		}
		this._standing = true;
		this.dropGear();
	}

	public override onEnable():void {
		this.setSolid(false);
	}

	public override onDestroy():void {
		this.dropGear();
		this.setSolid(true);
	}

	public override lateUpdate(dt:number):void {
		this._time += dt;
		const go = this.gameObject;
		if (this._standing && this._sit === 0) {
			return;
		}
		const model = go.getComponent(MeshRenderer)?.mesh;
		// The seat is where it sat down; the model slides over it each frame (below), so start from where the body is.
		this._seat ??= { x: go.transform.position.x, z: go.transform.position.z };
		model?.position.set(0, 0, 0);
		if (this._standing) {
			const before = this._sit;
			this._sit = Math.max(0, this._sit - dt / STAND_SECONDS);
			// Step aside out of the chair as the knees straighten.
			const right = yawToForward(go.transform.yaw - Math.PI / 2);
			const moved = (before - this._sit) * STEP_ASIDE;
			go.transform.position.x += right.x * moved;
			go.transform.position.z += right.z * moved;
			if (this._sit === 0) {
				this.setSolid(true);
				model?.position.set(0, 0, 0);
				return;
			}
		}
		const root = model;
		if (!root) {
			return;
		}
		const w = THREE.MathUtils.smoothstep(this._sit, 0, 1);
		const p = go.transform.position;
		const f = yawToForward(go.transform.yaw);
		const ahead = new THREE.Vector3(f.x, 0, f.z);
		const side = new THREE.Vector3(-f.z, 0, f.x);
		root.updateMatrixWorld(true);
		const hipBone = humanBone(root, 'hips');
		const hips = hipBone?.getWorldPosition(new THREE.Vector3());
		if (hipBone && hips) {
			crouch(root, { drop: Math.max(0, hips.y - p.y - HIP_SEAT), lean: 0.12 }, w);
			// Crouching sends the hips back; slide the whole model so they land just ahead of the seat's middle.
			root.updateMatrixWorld(true);
			const sat = hipBone.getWorldPosition(new THREE.Vector3());
			const parent = root.parent;
			if (parent) {
				const at = parent.getWorldPosition(new THREE.Vector3());
				at.x += (this._seat.x + ahead.x * HIP_AHEAD - sat.x) * w;
				at.z += (this._seat.z + ahead.z * HIP_AHEAD - sat.z) * w;
				root.position.copy(parent.worldToLocal(at));
				root.updateMatrixWorld(true);
			}
		}
		for (const s of [-1, 1] as const) {
			const foot = new THREE.Vector3(p.x, p.y + 0.14, p.z).addScaledVector(ahead, 0.5).addScaledVector(side, s * 0.13);
			placeFoot(root, s < 0 ? 'left' : 'right', foot, w, ahead);
			restFoot(root, s < 0 ? 'left' : 'right', w);
		}
		if (!this.rod || this._standing) {
			return;
		}
		// Both fists on the butt in the lap, the rod pointing up and out over the water.
		const dir = ahead.clone().multiplyScalar(Math.cos(ROD_RISE)).addScaledVector(UP, Math.sin(ROD_RISE));
		const grip = new THREE.Vector3(p.x, p.y + 0.62, p.z).addScaledVector(ahead, 0.3).addScaledVector(side, 0.06);
		reach(root, 'right', grip, w, side.clone().negate());
		reach(root, 'left', grip.clone().addScaledVector(dir, 0.28).addScaledVector(side, -0.06), w);
		closeHand(root, 'right', 1);
		closeHand(root, 'left', 1);
		// The rod runs through both fists: from the lower palm through the upper one, unless the arms left them crossed.
		root.updateMatrixWorld(true);
		const lower = palmOf(root, 'right') ?? grip;
		const upper = palmOf(root, 'left');
		const axis = upper ? upper.clone().sub(lower).normalize() : dir;
		this.poseGear(lower.clone().addScaledVector(axis.dot(dir) > 0.6 ? axis : dir, -0.15), axis.dot(dir) > 0.6 ? axis : dir, ahead);
	}

	/** The rod from `butt` along `dir`, and its line sagging from the tip to the float bobbing `CAST` m out. */
	private poseGear(butt:THREE.Vector3, dir:THREE.Vector3, ahead:THREE.Vector3):void {
		const scene = this.gameObject.world?.native;
		if (!scene) {
			return;
		}
		const gear = this._gear ??= this.makeGear(scene);
		gear.rod.position.copy(butt);
		gear.rod.quaternion.setFromUnitVectors(UP, dir);
		const tip = butt.clone().addScaledVector(dir, ROD_LENGTH);
		const p = this.gameObject.transform.position;
		const float = new THREE.Vector3(p.x, 0.02 + Math.sin(this._time * 2.3) * 0.015, p.z).addScaledVector(ahead, CAST);
		gear.float.position.copy(float);
		const pos = gear.line.geometry.getAttribute('position') as THREE.BufferAttribute;
		for (let i = 0; i < pos.count; i++) {
			const t = i / (pos.count - 1);
			const at = tip.clone().lerp(float, t);
			// A slack line hangs lowest past its middle.
			at.y -= Math.sin(Math.PI * t) * 0.25 * t;
			pos.setXYZ(i, at.x, at.y, at.z);
		}
		pos.needsUpdate = true;
		gear.line.geometry.computeBoundingSphere();
	}

	private makeGear(scene:THREE.Object3D):NonNullable<Seated['_gear']> {
		bindMesh('fishing_rod');
		const rod = create('fishing_rod') ?? new THREE.Group();
		const line = new THREE.Line(
			new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12 * 3), 3)),
			new THREE.LineBasicMaterial({ color: 0xe8e2d0, transparent: true, opacity: 0.8 }),
		);
		line.frustumCulled = false;
		const float = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xd8402a }));
		scene.add(rod, line, float);
		return { rod, line, float };
	}

	private dropGear():void {
		const gear = this._gear;
		if (!gear) {
			return;
		}
		for (const part of [gear.rod, gear.line, gear.float]) {
			part.removeFromParent();
			part.traverse((node) => {
				const mesh = node as THREE.Mesh;
				mesh.geometry?.dispose();
				(Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []).forEach((m) => m.dispose());
			});
		}
		this._gear = null;
	}

	private setSolid(solid:boolean):void {
		const col = this.gameObject.getComponent(BoxCollider);
		if (col) {
			col.enabled = solid;
		}
	}
}
