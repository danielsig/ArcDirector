import * as THREE from 'three';
import { Component } from '../core/Component.js';

export class Camera extends Component {
	public fov = 50;
	public near = 0.1;
	public far = 120;
	public readonly native = new THREE.PerspectiveCamera(50, 1, 0.1, 120);

	public override awake():void {
		this.native.name = 'Camera';
		this.syncNative();
		this.gameObject.transform.object3D.add(this.native);
	}

	public override update(dt:number):void {
		this.syncNative();
	}

	public override onDestroy():void {
		this.native.removeFromParent();
	}

	private syncNative():void {
		this.native.fov = this.fov;
		this.native.near = this.near;
		this.native.far = this.far;
		this.native.updateProjectionMatrix();
	}
}
