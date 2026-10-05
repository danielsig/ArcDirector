import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { Time } from '../core/Time.js';
import { applyShaderFeatures, type ShaderInsert, type ShaderUniforms } from './shader.js';
import { create as createMesh, meshReady } from '../assets/meshes.js';

export class MeshRenderer extends Component {
	meshID = 'cube';
	color:number | undefined;
	visible = true;
	shaderInserts:ShaderInsert[] = [];
	shaderUniforms:ShaderUniforms = {};

	mesh:THREE.Object3D | null = null;
	private builtID:string | null = null;
	private painted:number | undefined = undefined;

	override update(dt:number):void {
		const uTime = this.shaderUniforms.uTime;
		if (uTime) {
			uTime.value = Time.time;
		}
		this.syncMesh();
	}

	override onEnable():void {
		if (this.mesh) {
			this.mesh.visible = this.visible;
		}
	}

	override onDisable():void {
		if (this.mesh) {
			this.mesh.visible = false;
		}
	}

	override onDestroy():void {
		this.dropMesh();
	}

	private syncMesh():void {
		if (this.builtID !== this.meshID) {
			this.dropMesh();
		}
		if (!this.mesh) {
			if (!meshReady(this.meshID)) {
				return;
			}
			const inst = createMesh(this.meshID);
			if (!inst) {
				return;
			}
			inst.name = 'Mesh';
			inst.userData.meshID = this.meshID;
			this.applyShaders(inst);
			this.gameObject.transform.object3D.add(inst);
			this.mesh = inst;
			this.builtID = this.meshID;
			this.painted = undefined;
		}
		this.mesh.visible = this.enabled && this.visible;
		if (this.color !== this.painted) {
			this.applyColor(this.mesh);
			this.painted = this.color;
		}
	}

	private dropMesh():void {
		this.mesh?.removeFromParent();
		this.mesh = null;
		this.builtID = null;
		this.painted = undefined;
	}

	private applyColor(root:THREE.Object3D):void {
		if (this.color === undefined) {
			return;
		}
		const hex = this.color;
		root.traverse((o) => {
			if (!(o instanceof THREE.Mesh)) {
				return;
			}
			const mats = Array.isArray(o.material) ? o.material : [o.material];
			for (const m of mats) {
				if ('color' in m && m.color instanceof THREE.Color) {
					m.color.setHex(hex);
				}
			}
		});
	}

	private applyShaders(root:THREE.Object3D):void {
		if (this.shaderInserts.length === 0) {
			return;
		}
		root.traverse((o) => {
			if (!(o instanceof THREE.Mesh)) {
				return;
			}
			const mats = Array.isArray(o.material) ? o.material : [o.material];
			for (const m of mats) {
				applyShaderFeatures(m, this.shaderInserts, this.shaderUniforms);
			}
		});
	}
}
