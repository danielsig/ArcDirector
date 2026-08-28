import * as THREE from 'three';
import { Component } from './Component.js';

const _worldPos = new THREE.Vector3();
const _localPos = new THREE.Vector3();
const _worldQ = new THREE.Quaternion();
const _parentQ = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

export type Vec3 = {
	x:number;
	y:number;
	z:number;
};

class WorldPosition implements Vec3 {
	constructor(private readonly xf:Transform) {}

	get x():number {
		return this.xf.worldPositionVec(_worldPos).x;
	}

	set x(v:number) {
		this.xf.worldPositionVec(_worldPos);
		this.xf.setWorldPosition(v, _worldPos.y, _worldPos.z);
	}

	get y():number {
		return this.xf.worldPositionVec(_worldPos).y;
	}

	set y(v:number) {
		this.xf.worldPositionVec(_worldPos);
		this.xf.setWorldPosition(_worldPos.x, v, _worldPos.z);
	}

	get z():number {
		return this.xf.worldPositionVec(_worldPos).z;
	}

	set z(v:number) {
		this.xf.worldPositionVec(_worldPos);
		this.xf.setWorldPosition(_worldPos.x, _worldPos.y, v);
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
		this.object3D.getWorldQuaternion(_worldQ);
		_fwd.set(0, 0, -1).applyQuaternion(_worldQ);
		return { x: _fwd.x, y: _fwd.y, z: _fwd.z };
	}

	get right():Vec3 {
		this.object3D.getWorldQuaternion(_worldQ);
		_right.set(1, 0, 0).applyQuaternion(_worldQ);
		return { x: _right.x, y: _right.y, z: _right.z };
	}

	get up():Vec3 {
		this.object3D.getWorldQuaternion(_worldQ);
		_up.set(0, 1, 0).applyQuaternion(_worldQ);
		return { x: _up.x, y: _up.y, z: _up.z };
	}

	getObjectByName(name:string):THREE.Object3D | undefined {
		return this.object3D.getObjectByName(name);
	}

	worldPositionVec(out:THREE.Vector3):THREE.Vector3 {
		this.object3D.updateWorldMatrix(true, false);
		return this.object3D.getWorldPosition(out);
	}

	setWorldPosition(x:number, y:number, z:number):void {
		_worldPos.set(x, y, z);
		const parent = this.object3D.parent;
		if (parent) {
			parent.updateWorldMatrix(true, false);
			parent.worldToLocal(_localPos.copy(_worldPos));
			this.object3D.position.copy(_localPos);
		}
		else {
			this.object3D.position.copy(_worldPos);
		}
	}

	setWorldRotation(pitch:number, yaw:number, roll:number):void {
		_euler.set(pitch, yaw, roll, 'YXZ');
		_worldQ.setFromEuler(_euler);
		const parent = this.object3D.parent;
		if (parent) {
			parent.updateWorldMatrix(true, false);
			parent.getWorldQuaternion(_parentQ);
			this.object3D.quaternion.copy(_parentQ.invert().multiply(_worldQ));
		}
		else {
			this.object3D.quaternion.copy(_worldQ);
		}
	}

	private worldEuler():THREE.Euler {
		this.object3D.updateWorldMatrix(true, false);
		this.object3D.getWorldQuaternion(_worldQ);
		return _euler.setFromQuaternion(_worldQ, 'YXZ');
	}

	private localEuler():THREE.Euler {
		return _euler.setFromQuaternion(this.object3D.quaternion, 'YXZ');
	}
}
