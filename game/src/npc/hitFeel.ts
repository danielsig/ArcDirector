import { HurtFlash, RigidBody } from '../engine/components';
import { yawToForward } from '../engine/math';
import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';
import { cueAt } from '../audio/cue';

const KNOCK_SPEED = 6.2;
const KNOCK_SHOVE = 0.38;

/** Knock the hurt body away from the striker. No attack clips. */
export function applyHit(world:World, striker:GameObject, hurt:GameObject):void {
	const a = striker.transform.position;
	const b = hurt.transform.position;
	let dx = b.x - a.x;
	let dz = b.z - a.z;
	let len = Math.hypot(dx, dz);
	if (len < 0.05) {
		const fwd = yawToForward(striker.transform.yaw);
		dx = fwd.x;
		dz = fwd.z;
		len = 1;
	}
	const nx = dx / len;
	const nz = dz / len;
	b.x += nx * KNOCK_SHOVE;
	b.z += nz * KNOCK_SHOVE;
	const flash = hurt.getComponent(HurtFlash) ?? hurt.addComponent(new HurtFlash());
	flash.strike(nx * KNOCK_SPEED, nz * KNOCK_SPEED, world.time);
	const rb = hurt.getComponent(RigidBody);
	if (rb) {
		rb.velocity.x = nx * KNOCK_SPEED;
		rb.velocity.z = nz * KNOCK_SPEED;
	}
	cueAt(world, 'knock', hurt);
}
