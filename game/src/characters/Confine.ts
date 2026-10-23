import { Component } from '@arc-director/kindling';
import { RigidBody } from '../engine/components';
import { Order } from '../engine/order';

/**
 * Keeps a character inside a box on the ground, such as a monster in its room: at an edge, any step outward is
 * stopped, while it may still walk along the edge or back in. Whatever it chases, it never leaves.
 */
export class Confine extends Component {
	public static override order = Order.leash;
	public minX = 0;
	public maxX = 0;
	public minZ = 0;
	public maxZ = 0;
	/** Meters inside each edge where an outward step is already stopped, so its body never pokes through a doorway. */
	public margin = 0.5;

	public override update():void {
		const rb = this.gameObject.getComponent(RigidBody);
		if (!rb) {
			return;
		}
		const p = this.gameObject.transform.position;
		if ((p.x <= this.minX + this.margin && rb.velocity.x < 0) || (p.x >= this.maxX - this.margin && rb.velocity.x > 0)) {
			rb.velocity.x = 0;
		}
		if ((p.z <= this.minZ + this.margin && rb.velocity.z < 0) || (p.z >= this.maxZ - this.margin && rb.velocity.z > 0)) {
			rb.velocity.z = 0;
		}
	}
}
