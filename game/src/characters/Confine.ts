import { Component, type Bounds } from '@arc-director/kindling';
import { RigidBody } from '../engine/components';
import { Order } from '../engine/order';

/**
 * Keeps a character inside a box on the ground, such as a monster in its room: at an edge, any step outward is
 * stopped, while it may still walk along the edge or back in. Whatever it chases, it never leaves.
 */
export class Confine extends Component {
	public static override order = Order.leash;
	public bounds:Bounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
	/** Meters inside each edge where an outward step is already stopped, so its body never pokes through a doorway. */
	public margin = 0.5;

	public override update():void {
		const rb = this.gameObject.getComponent(RigidBody);
		if (!rb) {
			return;
		}
		const p = this.gameObject.transform.position;
		const b = this.bounds;
		if ((p.x <= b.minX + this.margin && rb.velocity.x < 0) || (p.x >= b.maxX - this.margin && rb.velocity.x > 0)) {
			rb.velocity.x = 0;
		}
		if ((p.z <= b.minZ + this.margin && rb.velocity.z < 0) || (p.z >= b.maxZ - this.margin && rb.velocity.z > 0)) {
			rb.velocity.z = 0;
		}
	}
}
