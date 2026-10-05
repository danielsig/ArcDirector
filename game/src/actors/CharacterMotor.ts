import { RigidBody, HumanSprite } from '../engine/components';
import { Component } from '../engine/Component';
import { Order } from '../engine/order';
import { lerpAngle, yawToward } from '../engine/math';
import { facePeer } from '../npc/talkAttend';
import { TILE_HEIGHT } from '../world/constants';
import { cueAt, stepKind } from '../audio/cue';
import { NPCInput } from './NPCInput';
import { PlayerInput } from './PlayerInput';

export class CharacterMotor extends Component {
	static override order = Order.motor;
	destinationName:string | null = null;
	destinationPoint:{ x:number; z:number } | null = null;
	arriveEpsilon = 0.35;
	stepHeight = TILE_HEIGHT + 0.05;
	maxSpeed = 4.2;
	private stepPhase = 0.4;
	/** Seconds to ease body yaw toward WASD. Staggers A+S release so we keep ~8, not 6 or 9. */
	private static readonly faceTurn = 0.09;

	override awake():void {
		const rb = this.gameObject.getComponent(RigidBody);
		if (!rb) {
			return;
		}
		rb.grounded = true;
		rb.stepHeight = this.stepHeight;
	}

	override update(dt:number):void {
		const rb = this.gameObject.getComponent(RigidBody);
		if (!rb) {
			return;
		}

		const appearance = this.gameObject.getComponent(HumanSprite);
		const pocket = appearance?.clip === 'take' || appearance?.clip === 'give';
		const player = this.gameObject.getComponent(PlayerInput);

		if (pocket) {
			rb.velocity.x = 0;
			rb.velocity.z = 0;
			return;
		}

		if (player) {
			rb.velocity.x = player.moveX * this.maxSpeed;
			rb.velocity.z = player.moveZ * this.maxSpeed;
			this.turnTowardWish(player.moveX, player.moveZ, dt);
			return;
		}

		if (!this.gameObject.world?.arcDirectorOn) {
			rb.velocity.x = 0;
			rb.velocity.z = 0;
			return;
		}

		const p = this.gameObject.transform.position;
		if (!this.gameObject.world?.tileAtWorld(p.x, p.z)) {
			rb.velocity.x = 0;
			rb.velocity.z = 0;
			return;
		}

		const dest = this.resolveDestination();
		if (!dest) {
			rb.velocity.x = 0;
			rb.velocity.z = 0;
			facePeer(this.gameObject, dt);
			return;
		}
		if (!this.gameObject.world?.tileAtWorld(dest.x, dest.z)) {
			rb.velocity.x = 0;
			rb.velocity.z = 0;
			return;
		}
		const dx = dest.x - p.x;
		const dz = dest.z - p.z;
		const dist = Math.hypot(dx, dz);
		if (dist <= this.arriveEpsilon) {
			rb.velocity.x = 0;
			rb.velocity.z = 0;
			facePeer(this.gameObject, dt);
			return;
		}
		rb.velocity.x = (dx / dist) * this.maxSpeed;
		rb.velocity.z = (dz / dist) * this.maxSpeed;
		this.gameObject.transform.yaw = yawToward(dx, dz);
	}

	override lateUpdate(dt:number):void {
		const world = this.gameObject.world;
		const rb = this.gameObject.getComponent(RigidBody);
		if (!world || !rb) {
			return;
		}
		const speed = Math.hypot(rb.velocity.x, rb.velocity.z);
		if (speed < 0.55) {
			this.stepPhase = 0.35;
			return;
		}
		this.stepPhase += speed * dt;
		if (this.stepPhase < 1.55) {
			return;
		}
		this.stepPhase %= 1.55;
		const p = this.gameObject.transform.position;
		cueAt(world, stepKind(world.tileAtWorld(p.x, p.z)?.def), this.gameObject, {
			gain: 0.52 + Math.random() * 0.22,
			freq: 72 + Math.random() * 36,
		});
	}

	private turnTowardWish(moveX:number, moveZ:number, dt:number):void {
		if (Math.hypot(moveX, moveZ) < 1e-6) {
			return;
		}
		const k = 1 - Math.exp(-dt / CharacterMotor.faceTurn);
		this.gameObject.transform.yaw = lerpAngle(
			this.gameObject.transform.yaw,
			yawToward(moveX, moveZ),
			k,
		);
	}

	private resolveDestination():{ x:number; z:number } | null {
		if (this.destinationPoint) {
			return this.destinationPoint;
		}
		const npc = this.gameObject.getComponent(NPCInput);
		if (npc?.destinationPoint) {
			return npc.destinationPoint;
		}
		const name = this.destinationName;
		if (!name || !this.gameObject.world) {
			return null;
		}
		const named = this.gameObject.world.findNamed(name);
		if (named && this.gameObject.world.npcCanSee(named)) {
			return { x: named.transform.position.x, z: named.transform.position.z };
		}
		return null;
	}
}
