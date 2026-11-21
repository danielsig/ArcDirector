import { lungeGhost } from '../../render/fight-fx';
import { THREE, crouch, move, type MoveTiming, type XZ, cueAt, UP, aheadOf, frameOf, heightOf, PoseMove } from './pose-body';

/**
 * A dodge: the body snaps aside as the blow or shot arrives, holds, drifts a little further and eases
 * back. It starts up to `DODGE_LEAD` s before the blow; the sidestep and drop are shares of the
 * body's height, the lean (back, away from the attacker) and twist in radians.
 */
const DODGE:MoveTiming = { sink: 0, snap: 0.07, hold: 0.14, carry: 0.15, follow: 0.12, settle: 0.4 };
const DODGE_LEAD = 0.16;
const DODGE_STEP = 0.24;
const DODGE_DROP = 0.07;
const DODGE_LEAN = 0.35;
const DODGE_TWIST = 0.45;

/**
 * Dodging a blow that misses: the body steps aside (`aside`, level, unit), drops a little, leans back from the blow
 * (`away` from the attacker) and turns off it, leaving a ghost where it stood, with a whoosh.
 */
export class Dodge extends PoseMove<{ t0:number; windUp:number; aside:THREE.Vector3; away:THREE.Vector3; ghosted:boolean }> {
	/** Dodges a blow from `from` (world XZ) arriving `delay` s from now, to a random side. */
	public from(from:XZ, delay:number):void {
		const p = this.go.transform.position;
		const away = new THREE.Vector3(p.x - from.x, 0, p.z - from.z);
		if (away.lengthSq() < 1e-6) {
			away.copy(aheadOf(this.go, -1));
		}
		away.normalize();
		const aside = new THREE.Vector3(-away.z, 0, away.x).multiplyScalar(Math.random() < 0.5 ? 1 : -1);
		const windUp = Math.max(DODGE.snap * 2, Math.min(delay, DODGE_LEAD));
		this.current = { t0: this.now + Math.max(0, delay - windUp), windUp, aside, away, ghosted: false };
	}

	public override update(root:THREE.Object3D, alive:boolean):void {
		const dodge = this.current;
		if (!dodge) {
			return;
		}
		const t = this.now - dodge.t0;
		if (t < 0) {
			return;
		}
		const { phase, u, weight } = move(DODGE, dodge.windUp, t);
		if (!alive || phase === 'done') {
			this.current = null;
			return;
		}
		const world = this.go.world;
		// As it snaps aside: a ghost of the body where it stood, and the whoosh of it going.
		if (!dodge.ghosted && phase !== 'anticipate' && world) {
			dodge.ghosted = true;
			lungeGhost(world.native, root);
			cueAt(world, 'swish', this.go);
		}
		const height = heightOf(this.go);
		const { ahead, right } = frameOf(this.go);
		// Lean back from a blow in front, forward from one behind; twist toward the side it goes.
		const facing = -ahead.dot(dodge.away);
		const twist = DODGE_TWIST * Math.sign(right.dot(dodge.aside) || 1);
		const amount = u * weight;
		crouch(root, { lean: -DODGE_LEAN * facing * u, drop: DODGE_DROP * height * u, twist: twist * u }, weight);
		this.body.step(root, dodge.aside.clone().multiplyScalar(DODGE_STEP * height * amount));
	}
}
