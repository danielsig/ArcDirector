import { lerpAngle, yawToward, Component } from '@arc-director/kindling';
import { RigidBody, Appearance, Vitals } from '../engine/components';
import { Order } from '../engine/order';
import { facePeer } from '../director/talkAttend';
import { TILE_HEIGHT } from '../world/constants';
import { cueAt, stepKind } from '../audio/cue';
import { WALK_STRIDE } from './CharacterAnimation';
import { NPCInput } from './NPCInput';
import { PlayerInput } from './PlayerInput';
import { PlayerPilot } from './PlayerPilot';

/** Under this fraction of `maxSpeed`, a walker counts as held in place. */
const HELD_SPEED = 0.25;
/** Seconds held in place by someone walking the other way before stepping right to pass them. */
const HELD_FOR = 0.2;
/** How far ahead, centre to centre in meters, an oncoming walker can be in the way. */
const ONCOMING_REACH = 1.1;
/** How far to one side, centre to centre in meters, an oncoming walker is no longer in the way. */
const PASS_CLEARANCE = 0.85;
/** Headings this opposed (cosine below minus this) are walking toward each other. */
const HEAD_ON = 0.7;

export class CharacterMotor extends Component {
	public static override order = Order.motor;
	public destinationName:string | null = null;
	public destinationPoint:{ x:number; z:number } | null = null;
	public arriveEpsilon = 0.35;
	public maxSpeed = 3.4;
	/** Distance accumulated toward the next plant. Rests halfway, where a fresh `walk` clip plants. */
	private _stepPhase = WALK_STRIDE / 2;
	/** Seconds to ease body yaw toward WASD. Staggers A+S release so we keep ~8, not 6 or 9. */
	private static readonly _faceTurn = 0.09;
	private _heading:{ x:number; z:number } | null = null;
	/** Seconds walking without getting anywhere. */
	private _heldFor = 0;
	/** Stepping right past an oncoming walker. */
	private _passing = false;

	/** Unit direction this character means to walk this frame (not a sidestep), or `null` standing. */
	public get heading():{ x:number; z:number } | null {
		return this._heading;
	}

	public override awake():void {
		const rb = this.gameObject.getComponent(RigidBody);
		if (!rb) {
			return;
		}
		rb.grounded = true;
	}

	public override update(dt:number):void {
		const rb = this.gameObject.getComponent(RigidBody);
		if (!rb) {
			return;
		}
		this._heading = null;

		const appearance = this.gameObject.getComponent(Appearance);
		const pocket = appearance?.clip === 'take' || appearance?.clip === 'give';
		const dead = (this.gameObject.getComponent(Vitals)?.hp ?? 1) <= 0;
		const player = this.gameObject.getComponent(PlayerInput);
		const piloted = this.gameObject.getComponent(PlayerPilot)?.claimed === true;

		if (pocket || dead) {
			rb.velocity.x = 0;
			rb.velocity.z = 0;
			return;
		}

		if (player && !piloted) {
			rb.velocity.x = player.moveX * this.maxSpeed;
			rb.velocity.z = player.moveZ * this.maxSpeed;
			const wish = Math.hypot(player.moveX, player.moveZ);
			this._heading = wish > 1e-6 ? { x: player.moveX / wish, z: player.moveZ / wish } : null;
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
		const ux = dx / dist;
		const uz = dz / dist;
		this._heading = { x: ux, z: uz };
		// Held head-on by someone walking the other way: both step to their right, as fast, until they pass.
		const [vx, vz] = this.passing(rb, ux, uz, dt) ? [-uz, ux] : [ux, uz];
		rb.velocity.x = vx * this.maxSpeed;
		rb.velocity.z = vz * this.maxSpeed;
		this.gameObject.transform.yaw = yawToward(dx, dz);
	}

	public override lateUpdate(dt:number):void {
		const world = this.gameObject.world;
		const rb = this.gameObject.getComponent(RigidBody);
		if (!world || !rb) {
			return;
		}
		const speed = rb.speed;
		if (speed < 0.55) {
			this._stepPhase = WALK_STRIDE / 2;
			return;
		}
		this._stepPhase += speed * dt;
		if (this._stepPhase < WALK_STRIDE) {
			return;
		}
		this._stepPhase %= WALK_STRIDE;
		const p = this.gameObject.transform.position;
		cueAt(world, stepKind(world, p.x, p.z), this.gameObject, 0.52 + Math.random() * 0.22);
	}

	/** Whether to step right this frame: held in place with someone in the way walking the other way, until clear of them. */
	private passing(rb:RigidBody, ux:number, uz:number, dt:number):boolean {
		const p = this.gameObject.transform.position;
		const moved = Math.hypot(p.x - rb.prevX, p.z - rb.prevZ);
		this._heldFor = moved < HELD_SPEED * this.maxSpeed * dt ? this._heldFor + dt : 0;
		this._passing = this.oncoming(ux, uz) && (this._passing || this._heldFor >= HELD_FOR);
		return this._passing;
	}

	/** Someone just ahead, in the way of walking along `ux`, `uz`, walking the other way. */
	private oncoming(ux:number, uz:number):boolean {
		const p = this.gameObject.transform.position;
		let found = false;
		this.gameObject.world?.forEachNear(p.x - ONCOMING_REACH, p.z - ONCOMING_REACH, p.x + ONCOMING_REACH, p.z + ONCOMING_REACH, (go) => {
			const other = go === this.gameObject ? null : go.getComponent(CharacterMotor)?.heading;
			if (found || !other || other.x * ux + other.z * uz > -HEAD_ON) {
				return;
			}
			const ox = go.transform.position.x - p.x;
			const oz = go.transform.position.z - p.z;
			const ahead = ox * ux + oz * uz;
			found = ahead > 0 && ahead < ONCOMING_REACH && Math.abs(oz * ux - ox * uz) < PASS_CLEARANCE;
		});
		return found;
	}

	private turnTowardWish(moveX:number, moveZ:number, dt:number):void {
		if (Math.hypot(moveX, moveZ) < 1e-6) {
			return;
		}
		const k = 1 - Math.exp(-dt / CharacterMotor._faceTurn);
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
