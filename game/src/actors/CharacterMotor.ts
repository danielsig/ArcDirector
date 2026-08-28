import { RigidBody, HumanSprite } from '../engine/components';
import { Component } from '../engine/Component';
import { Order } from '../engine/order';
import { yawToward } from '../engine/math';
import { conversePoint, facePeer } from '../npc/talkAttend';
import { TILE_HEIGHT } from '../world/constants';
import { NpcInput } from './NpcInput';
import { PlayerInput } from './PlayerInput';

export class CharacterMotor extends Component {
	static override order = Order.motor;
	destinationName:string | null = null;
	destinationPoint:{ x:number; z:number } | null = null;
	arriveEpsilon = 0.35;
	stepHeight = TILE_HEIGHT + 0.05;
	maxSpeed = 4.2;

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
			if (player) {
				this.gameObject.transform.yaw = player.lookYaw;
			}
			return;
		}

		if (player) {
			rb.velocity.x = player.moveX * this.maxSpeed;
			rb.velocity.z = player.moveZ * this.maxSpeed;
			this.gameObject.transform.yaw = player.lookYaw;
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

		const dest = this.resolveDestination() ?? conversePoint(this.gameObject);
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

	private resolveDestination():{ x:number; z:number } | null {
		if (this.destinationPoint) {
			return this.destinationPoint;
		}
		const npc = this.gameObject.getComponent(NpcInput);
		if (npc?.destinationPoint) {
			return npc.destinationPoint;
		}
		const name = this.destinationName ?? npc?.destinationName;
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
