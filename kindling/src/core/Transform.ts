import * as THREE from 'three';
import { Component, type ComponentState } from './Component.js';

const worldPos = new THREE.Vector3();
const localPos = new THREE.Vector3();
const worldQ = new THREE.Quaternion();
const parentQ = new THREE.Quaternion();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3();

export type Vec3 = {
	x:number;
	y:number;
	z:number;
};

class WorldPosition implements Vec3 {
	constructor(private readonly xf:Transform) {}

	get x():number {
		return this.xf.worldPositionVec(worldPos).x;
	}

	set x(v:number) {
		this.xf.worldPositionVec(worldPos);
		this.xf.setWorldPosition(v, worldPos.y, worldPos.z);
	}

	get y():number {
		return this.xf.worldPositionVec(worldPos).y;
	}

	set y(v:number) {
		this.xf.worldPositionVec(worldPos);
		this.xf.setWorldPosition(worldPos.x, v, worldPos.z);
	}

	get z():number {
		return this.xf.worldPositionVec(worldPos).z;
	}

	set z(v:number) {
		this.xf.worldPositionVec(worldPos);
		this.xf.setWorldPosition(worldPos.x, worldPos.y, v);
	}
}

/** Unity-style Transform on a Three.js Object3D. `position` / `yaw` are world. */
export class Transform extends Component {
	readonly object3D = new THREE.Object3D();
	readonly position:Vec3 = new WorldPosition(this);

	constructor() {
		super();
		this.object3D.matrixAutoUpdate = true;
	}

	override awake():void {
		this.object3D.name = this.gameObject.name;
	}

	/** World pose. */
	override saveState():ComponentState {
		const p = this.position;
		return { x: p.x, y: p.y, z: p.z, yaw: this.yaw, pitch: this.pitch, roll: this.roll };
	}

	override loadState(state:ComponentState):void {
		for (const [key, value] of Object.entries(state)) {
			const target = key === 'x' || key === 'y' || key === 'z' ? this.position : this;
			(target as unknown as ComponentState)[key] = value;
		}
	}

	get localPosition():THREE.Vector3 {
		return this.object3D.position;
	}

	set localPosition(v:Vec3) {
		this.object3D.position.set(v.x, v.y, v.z);
	}

	get localScale():THREE.Vector3 {
		return this.object3D.scale;
	}

	get scale():number {
		return this.object3D.scale.x;
	}

	set scale(n:number) {
		this.object3D.scale.setScalar(n);
	}

	get yaw():number {
		return this.worldEuler().y;
	}

	set yaw(v:number) {
		const e = this.worldEuler();
		this.setWorldRotation(e.x, v, e.z);
	}

	get pitch():number {
		return this.worldEuler().x;
	}

	set pitch(v:number) {
		const e = this.worldEuler();
		this.setWorldRotation(v, e.y, e.z);
	}

	get roll():number {
		return this.worldEuler().z;
	}

	set roll(v:number) {
		const e = this.worldEuler();
		this.setWorldRotation(e.x, e.y, v);
	}

	get localYaw():number {
		return this.localEuler().y;
	}

	set localYaw(v:number) {
		const e = this.localEuler();
		e.y = v;
		this.object3D.quaternion.setFromEuler(e);
	}

	get forward():Vec3 {
		this.object3D.getWorldQuaternion(worldQ);
		fwd.set(0, 0, -1).applyQuaternion(worldQ);
		return { x: fwd.x, y: fwd.y, z: fwd.z };
	}

	get right():Vec3 {
		this.object3D.getWorldQuaternion(worldQ);
		right.set(1, 0, 0).applyQuaternion(worldQ);
		return { x: right.x, y: right.y, z: right.z };
	}

	get up():Vec3 {
		this.object3D.getWorldQuaternion(worldQ);
		up.set(0, 1, 0).applyQuaternion(worldQ);
		return { x: up.x, y: up.y, z: up.z };
	}

	getObjectByName(name:string):THREE.Object3D | undefined {
		return this.object3D.getObjectByName(name);
	}

	worldPositionVec(out:THREE.Vector3):THREE.Vector3 {
		this.object3D.updateWorldMatrix(true, false);
		return this.object3D.getWorldPosition(out);
	}

	setWorldPosition(x:number, y:number, z:number):void {
		worldPos.set(x, y, z);
		const parent = this.object3D.parent;
		if (parent) {
			parent.updateWorldMatrix(true, false);
			parent.worldToLocal(localPos.copy(worldPos));
			this.object3D.position.copy(localPos);
		}
		else {
			this.object3D.position.copy(worldPos);
		}
	}

	setWorldRotation(pitch:number, yaw:number, roll:number):void {
		euler.set(pitch, yaw, roll, 'YXZ');
		worldQ.setFromEuler(euler);
		const parent = this.object3D.parent;
		if (parent) {
			parent.updateWorldMatrix(true, false);
			parent.getWorldQuaternion(parentQ);
			this.object3D.quaternion.copy(parentQ.invert().multiply(worldQ));
		}
		else {
			this.object3D.quaternion.copy(worldQ);
		}
	}

	private worldEuler():THREE.Euler {
		this.object3D.updateWorldMatrix(true, false);
		this.object3D.getWorldQuaternion(worldQ);
		return euler.setFromQuaternion(worldQ, 'YXZ');
	}

	private localEuler():THREE.Euler {
		return euler.setFromQuaternion(this.object3D.quaternion, 'YXZ');
	}
}
