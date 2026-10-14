import { Camera as RenderCamera, resolveBody, Time, yawToForward, type GameObject } from '@arc-director/kindling';
import * as THREE from 'three';
import { Appearance, HurtFlash, RigidBody, Vitals } from '../engine/components';
import type { World } from '../engine/World';
import { cueAt, cueVoice } from '../audio/cue';
import { dustKick, fallDust, heavyWave, impactBurst } from '../render/fightFx';

const KNOCK_SPEED = 6.2;
const KNOCK_SHOVE = 0.38;
/** Hitstop on striker and struck (s): an ordinary blow, and a heavy one (knock from `HEAVY_KNOCK`) or one that downs. */
const HITSTOP = 0.07;
const HITSTOP_HEAVY = 0.12;
const HEAVY_KNOCK = 1.3;
/** View shake (m, s) for a heavy blow and for one that downs; a downing blow also punches the view in (m, s) and shows an impact frame (s). */
const SHAKE_HEAVY:[number, number] = [0.05, 0.25];
const SHAKE_DOWN:[number, number] = [0.09, 0.35];
const PUNCH_DOWN:[number, number] = [0.5, 0.35];
const IMPACT_FRAME = 0.1;
/** How near the view a blow must land to shake it (m). */
const FEEL_RANGE = 26;
/** Seconds from a downing blow to the body hitting the ground. */
const FALL_LAND = 0.55;

/** Knock the hurt character away from the striker, and make the blow felt. `knock` scales shove and speed (cleave is heavier). */
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
	const flash = hurt.getOrAddComponent(HurtFlash);
	flash.strike(nx * speed, nz * speed, Time.time);
	if (rb) {
		rb.velocity.x = nx * speed;
		rb.velocity.z = nz * speed;
	}
	cueAt(world, 'knock', hurt);
	feel(world, striker, hurt, new THREE.Vector3(nx, 0, nz), knock);
}

/**
 * How a blow that lands on `hurt` (shoved along `away`) feels: both bodies stop for a hitstop, a
 * starburst flashes and dust kicks up where it lands; a heavy blow sends a shockwave across the
 * ground and shakes the view; one that downs them punches the view in on a black-and-white impact
 * frame, and raises dust where they fall.
 */
function feel(world:World, striker:GameObject, hurt:GameObject, away:THREE.Vector3, knock:number):void {
	const scene = world.native;
	const feet = new THREE.Vector3().copy(hurt.transform.position);
	const middle = feet.clone().setY(feet.y + (hurt.getComponent(Appearance)?.height ?? 1.7) * 0.55);
	const down = (hurt.getComponent(Vitals)?.hp ?? 1) <= 0;
	const heavy = down || knock >= HEAVY_KNOCK;
	const stop = heavy ? HITSTOP_HEAVY : HITSTOP;
	striker.hitstop(stop);
	hurt.hitstop(stop);
	impactBurst(scene, middle);
	cueVoice(world, down ? 'deathCry' : 'hurt', hurt);
	dustKick(scene, feet, away, undefined, 0.8);
	if (heavy) {
		heavyWave(scene, feet);
	}
	if (down) {
		world.after(FALL_LAND, () => {
			fallDust(scene, new THREE.Vector3().copy(hurt.transform.position));
			cueAt(world, 'bodyFall', hurt);
		});
	}
	const view = world.findByID('MainCamera');
	const camera = view?.getComponent(RenderCamera);
	if (!camera || !heavy || view!.transform.object3D.getWorldPosition(new THREE.Vector3()).distanceTo(feet) > FEEL_RANGE) {
		return;
	}
	camera.shake(...(down ? SHAKE_DOWN : SHAKE_HEAVY));
	if (down) {
		camera.punch(...PUNCH_DOWN);
		camera.impact(middle, IMPACT_FRAME);
	}
}
