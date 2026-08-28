import * as THREE from 'three';
import { Component } from '../core/Component.js';

export class Camera extends Component {
	fov = 50;
	near = 0.1;
	far = 120;
	readonly native = new THREE.PerspectiveCamera(50, 1, 0.1, 120);

	override awake():void {
		this.native.name = 'Camera';
		this.syncNative();
		this.gameObject.transform.object3D.add(this.native);
	}

	override update(_dt:number):void {
		this.syncNative();
	}

	override onDestroy():void {
		this.native.removeFromParent();
	}

	private syncNative():void {
		this.native.fov = this.fov;
		this.native.near = this.near;
		this.native.far = this.far;
		this.native.updateProjectionMatrix();
	}
}
