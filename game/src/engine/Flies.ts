import { Component, Time } from '@arc-director/kindling';
import * as THREE from 'three';

/** One fly's loop: how wide and how fast on each axis, and where on it it starts. */
type Fly = { mesh:THREE.Mesh; wx:number; wz:number; wy:number; speed:number; phase:number };

/**
 * Flies over something rotten: a few black specks darting round the object's origin, never still. Only to look at:
 * no one sees them as a thing.
 */
export class Flies extends Component {
	public count = 7;
	/** How far round the origin they roam (m), and how high above it. */
	public radius = 0.22;
	public height = 0.32;

	private _flies:Fly[] = [];

	public override onEnable():void {
		const geo = new THREE.SphereGeometry(0.012, 4, 3);
		const mat = new THREE.MeshBasicMaterial({ color: 0x0c0c0c });
		this._flies = Array.from({ length: this.count }, (_, i) => {
			const mesh = new THREE.Mesh(geo, mat);
			this.gameObject.transform.object3D.add(mesh);
			return { mesh, wx: 0.6 + (i % 3) * 0.2, wz: 0.8 + (i % 2) * 0.3, wy: 1.7 + (i % 4) * 0.4, speed: 3 + (i % 5) * 0.6, phase: i * 1.7 };
		});
	}

	public override update():void {
		const t = Time.time;
		for (const fly of this._flies) {
			const a = t * fly.speed + fly.phase;
			// Two loops at odd rates, and a quick twitch on top, so no fly ever settles into a circle.
			fly.mesh.position.set(
				Math.sin(a * fly.wx) * this.radius + Math.sin(a * 7.3) * 0.02,
				this.height * (0.55 + 0.45 * Math.sin(a * fly.wy)),
				Math.cos(a * fly.wz) * this.radius + Math.cos(a * 6.1) * 0.02,
			);
		}
	}

	public override onDisable():void {
		const mesh = this._flies[0]?.mesh;
		mesh?.geometry.dispose();
		(mesh?.material as THREE.Material | undefined)?.dispose();
		for (const fly of this._flies) {
			fly.mesh.removeFromParent();
		}
		this._flies = [];
	}
}
