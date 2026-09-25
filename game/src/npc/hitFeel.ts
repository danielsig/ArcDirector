import { resolveBody } from '@arc-director/kindling';
import { HurtFlash, RigidBody } from '../engine/components';
import { yawToForward } from '../engine/math';
import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';
import { cueAt } from '../audio/cue';

const KNOCK_SPEED = 6.2;
const KNOCK_SHOVE = 0.38;

/** Knock the hurt body away from the striker. `knock` scales shove and speed (cleave is heavier). */
export function applyHit(world:World, striker:GameObject, hurt:GameObject, knock = 1):void {
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
	const scale = Math.max(0.2, knock);
	const shove = KNOCK_SHOVE * scale;
	const speed = KNOCK_SPEED * scale;
	const rb = hurt.getComponent(RigidBody);
	if (rb) {
		rb.prevX = b.x;
		rb.prevZ = b.z;
	}
	b.x += nx * shove;
	b.z += nz * shove;
	resolveBody(world, hurt);
	const flash = hurt.getComponent(HurtFlash) ?? hurt.addComponent(new HurtFlash());
	flash.strike(nx * speed, nz * speed, world.time);
	if (rb) {
		rb.velocity.x = nx * speed;
		rb.velocity.z = nz * speed;
	}
	cueAt(world, 'knock', hurt);
}
