import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { Time } from '../core/Time.js';
import { applyShaderFeatures, type ShaderInsert, type ShaderUniforms } from './shader.js';
import { create as createMesh, meshReady } from '../assets/meshes.js';

export class MeshRenderer extends Component {
	public meshID = 'cube';
	public color:number | undefined;
	public visible = true;
	public shaderInserts:ShaderInsert[] = [];
	public shaderUniforms:ShaderUniforms = {};
	public mesh:THREE.Object3D | null = null;

	private _builtID:string | null = null;
	private _painted:number | undefined = undefined;

	public override update(dt:number):void {
		const uTime = this.shaderUniforms.uTime;
		if (uTime) {
			uTime.value = Time.time;
		}
		this.syncMesh();
	}

	public override onEnable():void {
		if (this.mesh) {
			this.mesh.visible = this.visible;
		}
	}

	public override onDisable():void {
		if (this.mesh) {
			this.mesh.visible = false;
		}
	}

	public override onDestroy():void {
		this.dropMesh();
	}

	private syncMesh():void {
		if (this._builtID !== this.meshID) {
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
			this._builtID = this.meshID;
			this._painted = undefined;
		}
		this.mesh.visible = this.enabled && this.visible;
		if (this.color !== this._painted) {
			this.applyColor(this.mesh);
			this._painted = this.color;
		}
	}

	private dropMesh():void {
		this.mesh?.removeFromParent();
		this.mesh = null;
		this._builtID = null;
		this._painted = undefined;
	}

	private applyColor(root:THREE.Object3D):void {
		if (this.color === undefined) {
			return;
		}
		const hex = this.color;
		root.traverse((o) => {
			if (!(o instanceof THREE.Mesh) || o.userData.lockColor === true) {
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
