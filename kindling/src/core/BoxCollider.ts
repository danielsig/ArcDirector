import { Component } from './Component.js';

export class BoxCollider extends Component {
	public static override saved = ['isTrigger', 'solid'];
	public size = { x: 1, y: 1, z: 1 };
	/** `cylinder`: an upright round obstacle of diameter `size.x` that bodies slide around. Moving bodies stay boxes. */
	public shape:'box' | 'cylinder' = 'box';
	public isTrigger = false;
	public solid = true;
	/** Extra XZ pad vs other padded colliders. Those pairs use a shove instead of hard-blocking. */
	public pad = 0;

	/** Whether the world XZ point lies inside this collider's footprint (pad not included). */
	public contains(x:number, z:number):boolean {
		const p = this.gameObject.transform.position;
		if (this.shape === 'cylinder') {
			return Math.hypot(x - p.x, z - p.z) < this.size.x * 0.5;
		}
		return Math.abs(x - p.x) < this.size.x * 0.5 && Math.abs(z - p.z) < this.size.z * 0.5;
	}
}
