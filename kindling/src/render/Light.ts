import * as THREE from 'three';
import { Component } from '../core/Component.js';

export type LightKind = 'point' | 'directional';

export class Light extends Component {
	kind:LightKind = 'point';
	color = 0xff9a4a;
	intensity = 48;
	range = 11;
	decay = 2;
	castShadow = true;
	/** Local offset. Z is along Kindling forward (−Z). */
	offsetX = 0;
	offsetY = 0;
	offsetZ = 0;

	native:THREE.Light | null = null;
	private target:THREE.Object3D | null = null;

	override onEnable():void {
		this.ensureNative();
		if (this.native) {
			this.native.visible = true;
		}
		this.syncNative();
	}

	override onDisable():void {
		if (this.native) {
			this.native.visible = false;
		}
	}

	override update(dt:number):void {
		this.syncNative();
	}

	override onDestroy():void {
		this.dropNative();
	}

	private ensureNative():void {
		if (this.native && this.kindMatches()) {
			return;
		}
		this.dropNative();
		if (this.kind === 'directional') {
			const d = new THREE.DirectionalLight(this.color, this.intensity);
			d.name = 'castLight';
			d.castShadow = this.castShadow;
			this.gameObject.transform.object3D.add(d);
			this.target = d.target;
			this.gameObject.world?.native.add(d.target);
			this.native = d;
		}
		else {
			const p = new THREE.PointLight(this.color, this.intensity, this.range, this.decay);
			p.name = 'castLight';
			p.castShadow = this.castShadow;
			p.shadow.mapSize.set(512, 512);
			p.shadow.bias = -0.001;
			p.shadow.normalBias = 0.01;
			p.shadow.camera.near = 0.01;
			this.gameObject.transform.object3D.add(p);
			this.native = p;
		}
	}

	private kindMatches():boolean {
		if (!this.native) {
			return false;
		}
		if (this.kind === 'directional') {
			return this.native instanceof THREE.DirectionalLight;
		}
		return this.native instanceof THREE.PointLight;
	}

	private syncNative():void {
		this.ensureNative();
		const lamp = this.native;
		if (!lamp) {
			return;
		}
		lamp.color.setHex(this.color);
		lamp.intensity = this.intensity;
		lamp.castShadow = this.castShadow;
		lamp.visible = this.enabled;
		lamp.position.set(this.offsetX, this.offsetY, -this.offsetZ);
		if (lamp instanceof THREE.PointLight) {
			lamp.distance = this.range;
			lamp.decay = this.decay;
			lamp.shadow.camera.near = 0.1;
			lamp.shadow.camera.far = this.range + 0.1;
		}
		if (lamp instanceof THREE.DirectionalLight) {
			const xf = this.gameObject.transform;
			const f = xf.forward;
			lamp.target.position.set(
				xf.position.x + f.x,
				xf.position.y + f.y,
				xf.position.z + f.z,
			);
			lamp.target.updateMatrixWorld();
		}
	}

	private dropNative():void {
		this.native?.removeFromParent();
		this.target?.removeFromParent();
		this.native = null;
		this.target = null;
	}
}
