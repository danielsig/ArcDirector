import { Component, type GameObject } from '@arc-director/kindling';
import { RigidBody } from '../engine/components';
import { Order } from '../engine/order';
import { walkClear } from '../world/path';

/**
 * Keeps a character from walking alone where foes are: while one is within `wary` of it with a walkable straight line
 * between them, and it is farther than `reach` from all of its company, it is held. Held, it may only step toward the
 * nearest of them, until it is back within `regroup` of one: the gap between the two keeps it from flickering on and
 * off at the edge. A foe seen through a web or a shut door does not count. Away from foes it walks free. It never
 * stands stuck, since the way back is open.
 */
export class Leash extends Component {
	public static override order = Order.leash;
	/** Meters from the nearest companion past which it is held. */
	public reach = 8;
	/** Meters from the nearest companion within which a held one walks free again. */
	public regroup = 6;
	/** Meters from a foe with a walkable line here within which the leash holds. */
	public wary = 14;
	/** Its living companions now, itself among them or not. None: it walks free. */
	public company:()=>GameObject[] = () => [];
	/** The living foes now. */
	public foes:()=>GameObject[] = () => [];
	private _held = false;

	public override update():void {
		const nearest = this.nearestCompanion();
		if (!nearest || nearest.d <= this.regroup || !this.nearFoe()) {
			this._held = false;
			return;
		}
		this._held ||= nearest.d > this.reach;
		const rb = this.gameObject.getComponent(RigidBody);
		if (this._held && rb && rb.velocity.x * nearest.dx + rb.velocity.z * nearest.dz <= 0) {
			rb.velocity.x = 0;
			rb.velocity.z = 0;
		}
	}

	private nearestCompanion():{ dx:number; dz:number; d:number } | undefined {
		const p = this.gameObject.transform.position;
		let nearest:{ dx:number; dz:number; d:number } | undefined;
		for (const go of this.company()) {
			if (go === this.gameObject) {
				continue;
			}
			const q = go.transform.position;
			const dx = q.x - p.x;
			const dz = q.z - p.z;
			const d = Math.hypot(dx, dz);
			if (!nearest || d < nearest.d) {
				nearest = { dx, dz, d };
			}
		}
		return nearest;
	}

	/** A foe near, with a straight line it could walk to here: no wall, web or shut door on it. */
	private nearFoe():boolean {
		const world = this.gameObject.world;
		const p = this.gameObject.transform.position;
		return !!world && this.foes().some((go) => {
			const q = go.transform.position;
			return Math.hypot(q.x - p.x, q.z - p.z) <= this.wary && walkClear(world, go, q, p);
		});
	}
}
