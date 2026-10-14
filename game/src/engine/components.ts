import * as THREE from 'three';
import {
	BoxCollider,
	clamp,
	lerpAngle,
	Light as KindlingLight,
	Rigidbody,
	Time,
	Component,
	type GameObject,
} from '@arc-director/kindling';
import { Order } from './order';
import { CELL_SIZE, TILE_HEIGHT } from '../world/constants';
import { Pickupable } from '../items/components';

export { BoxCollider };

/** Ground speed (m/s) below which a character stands. */
const WALKING_SPEED = 0.35;

export class RigidBody extends Rigidbody {
	public useGravity = false;

	/** Ground speed in m/s. */
	public get speed():number {
		return Math.hypot(this.velocity.x, this.velocity.z);
	}

	/** Moving fast enough to walk rather than stand. */
	public get walking():boolean {
		return this.speed > WALKING_SPEED;
	}
}

export class Light extends KindlingLight {
	public static override order = Order.light;
	/** Scale of the intensity random-walk. 0 = steady light. */
	public intensityFlicker = 1;
	/** Lamp-only positional random-walk amplitude in meters. 0 = no motion. */
	public positionalFlicker = 0;
	/**
	 * How fast intensity chases its random-walk target.
	 * Unit: fraction of remaining gap per second when in (0, 1).
	 * 0 = freeze, 1 = snap to target.
	 */
	public intensityFlickerSpeed = 1;
	/**
	 * How fast lamp position chases its random-walk target.
	 * Unit: fraction of remaining gap per second when in (0, 1).
	 * 0 = freeze, 1 = snap to target.
	 */
	public positionalFlickerSpeed = 1;
	public flicker = 1;
	private _flickerTo = 1;
	private _flickerIn = 0;
	private _posX = 0;
	private _posY = 0;
	private _posZ = 0;
	private _posToX = 0;
	private _posToY = 0;
	private _posToZ = 0;
	private _posIn = 0;

	/** Random-walk intensity pulse; not a looping sine. */
	public pulse(dt:number):number {
		this._flickerIn -= dt;
		if (this._flickerIn <= 0) {
			this._flickerTo = 0.72 + Math.random() * 0.4;
			this._flickerIn = 0.03 + Math.random() * 0.12;
		}
		const ik = Light.chaseK(this.intensityFlickerSpeed, dt);
		this.flicker += (this._flickerTo - this.flicker) * ik;
		this.walkPosition(dt);
		return 1 + (this.flicker - 1) * this.intensityFlicker;
	}

	/** Lamp jitter in host-local meters: x right, y up, z yaw-forward (into the room). */
	public lampJitter():{ x:number; y:number; z:number } {
		const a = this.positionalFlicker;
		if (a <= 0) {
			return { x: 0, y: 0, z: 0 };
		}
		return { x: this._posX * a, y: this._posY * a, z: Math.max(0, this._posZ) * a };
	}

	public override update(dt:number):void {
		super.update(dt);
		const lamp = this.native;
		if (!(lamp instanceof THREE.PointLight)) {
			return;
		}
		const j = this.lampJitter();
		lamp.position.set(this.offsetX + j.x, this.offsetY + j.y, -(this.offsetZ + j.z));
	}

	/** 0 = freeze, 1 = snap; else `min(1, speed * dt)` of the remaining gap. */
	private static chaseK(speed:number, dt:number):number {
		if (speed <= 0) {
			return 0;
		}
		if (speed >= 1) {
			return 1;
		}
		return Math.min(1, speed * Math.max(0, dt));
	}

	private walkPosition(dt:number):void {
		if (this.positionalFlicker <= 0) {
			return;
		}
		this._posIn -= dt;
		if (this._posIn <= 0) {
			this._posToX = Math.random() * 2 - 1;
			this._posToY = Math.random() * 2 - 1;
			this._posToZ = Math.random();
			this._posIn = 0.04 + Math.random() * 0.14;
		}
		const k = Light.chaseK(this.positionalFlickerSpeed, dt);
		this._posX += (this._posToX - this._posX) * k;
		this._posY += (this._posToY - this._posY) * k;
		this._posZ += (this._posToZ - this._posZ) * k;
	}
}

export class Named extends Component {
	public id = '';
	public aliases:string[] | undefined;
}

export class Attached extends Component {
	public toID = '';
	public mode:'on' | 'in' | 'worn' | 'held' = 'on';
}

export class Door extends Component {
	public static override order = Order.door;
	public static override saved = ['open'];
	public open = false;
	public axis:'x' | 'z' = 'x';
	public blockedWhenClosed = true;
	public closedYaw = 0;
	public openYaw = 0;
	/** Named building this door opens into, if any. */
	public buildingID = '';

	/** Keep the AABB in sync the moment the leaf moves — do not wait for the next tick. */
	public syncCollision():void {
		const col = this.gameObject.getComponent(BoxCollider);
		if (!col) {
			return;
		}
		const blocking = this.blockedWhenClosed && !this.open;
		col.solid = blocking;
		col.isTrigger = !blocking;
	}

	public override update(dt:number):void {
		this.syncCollision();
	}
}

/** Walkable AABB of a named building (world XZ, walls excluded). */
export class Interior extends Component {
	public minX = 0;
	public maxX = 0;
	public minZ = 0;
	public maxZ = 0;
}

export class Lock extends Component {
	public static override saved = ['keyID', 'locked'];
	public keyID = '';
	public locked = true;
}

export class Chest extends Component {
	public static override saved = ['open'];
	public open = false;
}

/** Seconds the span takes to swing between raised and lowered. */
export const BRIDGE_SWING_SECONDS = 1;

/** World height of the lowered span's planks, where whoever crosses stands. Matches `createBridgeMesh`. */
export const BRIDGE_DECK_Y = 0.22;

/** Drawbridge over water. When raised (`open` false), the river cannot be crossed. */
export class Bridge extends Component {
	public static override saved = ['open'];
	/** Where the span is headed: lowered (open) or raised. */
	public open = false;
	public cells:{ x:number; z:number }[] = [];
	/** Mid-swing lift; undefined when the span rests where `open` says. */
	private _swing:number | undefined;

	/** How far up the span is: 0 lowered, 1 raised. */
	public get lift():number {
		return this._swing ?? this.target;
	}

	/** Swinging between raised and lowered. */
	public get moving():boolean {
		return this._swing !== undefined;
	}

	/** Work the lever: swing to the other state over {@link BRIDGE_SWING_SECONDS}. Setting `open` (a load) snaps instead. */
	public toggle():void {
		this._swing = this.lift;
		this.open = !this.open;
		this.syncCollision();
	}

	/** Bodies and loose things standing on the span. */
	public occupants():GameObject[] {
		const half = CELL_SIZE / 2;
		return (this.gameObject.world?.objects ?? []).filter((go) => (
			(go.getComponent(HumanBody) || go.getComponent(Pickupable))
			&& this.cells.some((c) => Math.abs(go.transform.position.x - c.x) <= half && Math.abs(go.transform.position.z - c.z) <= half)
		));
	}

	/** Walkable only once fully lowered; anything else blocks. */
	public syncCollision():void {
		const col = this.gameObject.getComponent(BoxCollider);
		if (!col) {
			return;
		}
		const down = this.open && this.lift === 0;
		col.solid = !down;
		col.isTrigger = down;
	}

	public override update(dt:number):void {
		if (this._swing !== undefined) {
			const step = dt / BRIDGE_SWING_SECONDS;
			const lift = this._swing < this.target ? Math.min(this.target, this._swing + step) : Math.max(this.target, this._swing - step);
			this._swing = lift === this.target ? undefined : lift;
		}
		this.syncCollision();
	}

	private get target():number {
		return this.open ? 0 : 1;
	}
}

export class BridgeLever extends Component {}

/** Coins on a person — not an inventory stack. */
export class Wallet extends Component {
	public static override saved = ['coins'];
	public coins = 0;
}

/** Goods this person sells. Taking one from them without a trade is theft. */
export class Merchant extends Component {
	public static override saved = ['goods'];
	public goods:string[] = [];
}

export type MarketNPCKind = 'vendor' | 'customer' | 'guard';

/** Flea-market role: vendors stay; customers leave through a gate when satisfied. */
export class MarketNPC extends Component {
	public static override saved = ['wants', 'leaveGate', 'leaving', 'postX', 'postZ', 'post'];
	public kind:MarketNPCKind = 'customer';
	public wants:string[] = [];
	public leaveGate = '';
	public leaving = false;
	/** Where a vendor stands. They are not sent off this post. */
	public postX = 0;
	public postZ = 0;
	public post = '';
}

/** Walking into this doorway despawns a customer who is leaving through it. */
export class MarketGate extends Component {}

/** Marked for the market watch — stolen goods, unpaid take. */
export class Wanted extends Component {
	public reason = '';
	public items:string[] = [];
	public fromID = '';
}

/** Someone cried a security word. Guards run here until `until` (game time) or one of them arrives. */
export class Alarm extends Component {
	public until = 0;
	public word = '';
}

/** A cry the watch still answers: enabled, and not yet expired. */
export function alarmActive(go:GameObject, now:number):boolean {
	const alarm = go.getComponent(Alarm);
	return !!alarm?.enabled && now < alarm.until;
}

/** Stays with a named body when idle. Always perceives that body, even when other NPCs cannot notice the player. */
/** Serves `targetID`: always notices them, and hands them what will not fit in their bags. Following is the mind's program, not this component. */
export class Companion extends Component {
	public targetID = 'Player';
}

/** Whitelist of speakers this body hears. Anyone else is silent to them. */
export class HearOnly extends Component {
	public from:string[] = [];
}

export class BrewHearth extends Component {}

export class Sickbed extends Component {
	public static override saved = ['tended'];
	public caretaker = '';
	public tended = false;
}

export class Flame extends Component {
	public canIgnite = true;
}

/** Set alight with a flame, it burns for `burnSeconds` and is gone, and whatever it blocked with it. */
export class Flammable extends Component {
	public static override saved = ['burning', 'spread'];
	public burning = false;
	public spread = false;
	public burnSeconds = 1.6;
	private _burnt = 0;

	public override update(dt:number):void {
		if (!this.burning) {
			return;
		}
		this._burnt += dt;
		if (this._burnt >= this.burnSeconds) {
			this.gameObject.world?.destroy(this.gameObject);
		}
	}
}

/** Hurt `times` over by the attacks in `to` (a fight verb, such as hex), and `others` times by every other blow. */
export class Weakness extends Component {
	public to:string[] = [];
	public times = 3;
	public others = 0.5;
}

/** Words carved on it. Sight and `examine` read them out. */
export class Inscription extends Component {
	public text = '';
}

export const BODY_SLOTS = [
	'head',
	'torso',
	'legs',
	'feet',
	'back',
	'hands.left.worn',
	'hands.right.worn',
	'hands.left.held',
	'hands.right.held',
] as const;

export type BodySlot = typeof BODY_SLOTS[number];

export type OccupiedRef = {
	occupiedBy:BodySlot;
};

export type SlotFill = import('../items/instance').ItemInstance | OccupiedRef | null;

/** A pose the character holds for a moment instead of standing or walking. */
export type PoseClip = 'auto' | 'walk' | 'take' | 'give';
/** Seconds a take or a give lasts. */
export const POSE_SECONDS:Record<'take' | 'give', number> = { take: 0.8, give: 1.6 };
/** Seconds into a take when the hand reaches the thing: it leaves the ground (or the chest) then, with its sound. */
export const TAKE_REACHED = 0.2;

/** How tall the character's model stands, and a held pose (take, give) its animation plays. */
export class Appearance extends Component {
	public static override order = Order.appearance;
	/** Meters, hat included. */
	public height = 1.7;
	public clip:PoseClip = 'auto';
	public clipT0 = 0;
	/** Who or what a give or take reaches toward: the other person, or the thing picked up. */
	public clipToward:GameObject | null = null;

	public playClip(clip:'take' | 'give', t:number, toward:GameObject | null = null):void {
		this.clip = clip;
		this.clipT0 = t;
		this.clipToward = toward;
	}

	public override update(dt:number):void {
		if (this.clip !== 'take' && this.clip !== 'give') {
			return;
		}
		const t = Time.time;
		if (t - this.clipT0 >= POSE_SECONDS[this.clip]) {
			this.clip = 'auto';
			this.clipToward = null;
		}
	}
}

export class HumanBody extends Component {
	public static override saved = ['slots'];
	public slots:Record<BodySlot, SlotFill> = {
		head: null,
		torso: null,
		legs: null,
		feet: null,
		back: null,
		'hands.left.worn': null,
		'hands.right.worn': null,
		'hands.left.held': null,
		'hands.right.held': null,
	};
	public pockets:import('../items/components').Container | null = null;
}

export class Vitals extends Component {
	public static override saved = ['hp', 'maxHP'];
	public hp = 5;
	public maxHP = 5;
}

/** A raised guard (the `block` verb): until `until`, blows from in front of where the character faces do nothing. */
export class Guard extends Component {
	public until = 0;
	/** Blows stopped since it last went up. */
	public blocked = 0;

	public get up():boolean {
		return this.enabled && Time.time < this.until;
	}

	public raise(seconds:number):void {
		this.until = Time.time + seconds;
		this.blocked = 0;
		this.enabled = true;
	}

	public lower():void {
		this.until = 0;
	}
}

const HURT_LIFE = 0.42;

/** Knockback + blink after a hit. Runs after the motor so the shove wins that frame. */
export class HurtFlash extends Component {
	public static override order = Order.hurt;
	public until = 0;
	public vx = 0;
	public vz = 0;

	public get active():boolean {
		const now = Time.time;
		return this.enabled && now < this.until;
	}

	public strike(vx:number, vz:number, now:number, life = HURT_LIFE):void {
		this.vx = vx;
		this.vz = vz;
		this.until = now + life;
		this.enabled = true;
	}

	public override update(dt:number):void {
		const world = this.gameObject.world;
		const rb = this.gameObject.getComponent(RigidBody);
		if (!world || !rb || Time.time >= this.until) {
			this.enabled = false;
			if ((this.gameObject.getComponent(Vitals)?.hp ?? 1) <= 0) {
				if (rb) {
					rb.velocity.x = 0;
					rb.velocity.z = 0;
				}
				const col = this.gameObject.getComponent(BoxCollider);
				if (col) {
					col.enabled = false;
				}
			}
			return;
		}
		const u = Math.max(0, (this.until - Time.time) / HURT_LIFE);
		rb.velocity.x = this.vx * u;
		rb.velocity.z = this.vz * u;
	}
}

export class SpeechBubble extends Component {
	public text = '';
	public until = 0;
	/** World time the current line was shown. */
	public timestamp = 0;
	public height = 2.2;
}

/** How a character celebrates: jumping for joy (the `jump` clip, whose hips leave the ground) or cheering. */
export type CelebrationStyle = 'jump' | 'cheer';

/** Seconds per hop of the `jump` clip (five in its 2.2 s), and how long a counted cheer lasts. */
const JUMP_PERIOD = 0.44;
const CHEER_SECONDS = 3;

/**
 * Celebrating until `until` (world time): `CharacterAnimation` plays the style's clip. Each time it
 * starts it picks jumping or cheering at random. Starting to walk ends it early.
 */
export class Celebrating extends Component {
	public static override order = Order.celebrating;
	public until = 0;
	public style:CelebrationStyle = 'jump';
	private _wasWalking = false;

	/** Celebrates about `count` jumps long (a cheer lasts a few seconds instead). */
	public beginHops(time:number, count:number):void {
		this.enabled = true;
		this.until = time + (this.style === 'jump' ? count * JUMP_PERIOD : CHEER_SECONDS);
	}

	public override onEnable():void {
		this.style = Math.random() < 0.5 ? 'jump' : 'cheer';
		this._wasWalking = this.walking();
	}

	public override update():void {
		if (Time.time >= this.until) {
			this.enabled = false;
		}
	}

	/** After physics, so the step that set off a walk ends the celebration before the next frame's animation. */
	public override lateUpdate():void {
		const walking = this.walking();
		if (walking && !this._wasWalking) {
			this.stop();
		}
		this._wasWalking = walking;
	}

	private walking():boolean {
		return this.gameObject.getComponent(RigidBody)?.walking === true;
	}

	public stop():void {
		this.until = 0;
		this.enabled = false;
	}
}

export class Torch extends Component {
	public static override order = Order.torch;
	public static override saved = ['lit'];
	public lit = true;
	public baseIntensity = 48;
	public baseDecay = 2;
	/** `baseDecay` scale. 0.5 is inverse-linear; 1 is inverse-square. */
	public static decayScale = 0.65;
	/** 0–1 start phase so flame loops are not globally synced. */
	public animOffset = Math.random();
	/** Frames per second for the flame sprite. */
	public flickerRate = 7.2 + Math.random() * 6.5;

	public override update(dt:number):void {
		const light = this.gameObject.getComponent(Light);
		if (!light) {
			return;
		}
		light.enabled = this.lit;
		if (!this.lit) {
			return;
		}
		light.intensity = this.baseIntensity * light.pulse(dt);
		light.decay = this.baseDecay * Torch.decayScale;
	}
}

const CAMERA_HEIGHT = 11;
const CAMERA_BEHIND = 7.4;

export class Camera extends Component {
	public static override order = Order.camera;
	public targetID = 'Player';
	public height = CAMERA_HEIGHT;
	public behind = CAMERA_BEHIND;
	/** Radians down from horizontal. */
	public pitch = 40 * Math.PI / 180;
	public easeBehind = 3.2;
	/** Independent of player body yaw; eases toward `orbitYaw` (mouse look). */
	public yaw = 0;
	/** Desired orbit yaw in radians. PlayerInput writes look here; body facing does not. */
	public orbitYaw = 0;
	/** Dolly along the follow offset; pitch stays fixed. */
	public distance = Math.hypot(CAMERA_HEIGHT, CAMERA_BEHIND);
	public minDistance = 3;
	public maxDistance = 24;
	public dollySens = 0.028;
	public wheelSens = 0.012;
	/** Look-at height above the target's feet (torso, not the ground). */
	public lookHeight = 2.0;

	public override lateUpdate(dt:number):void {
		const world = this.gameObject.world;
		if (!world) {
			return;
		}
		const input = world.input;
		let dolly = input.wheelDelta * this.wheelSens;
		if (input.pointerLocked) {
			dolly += input.lookDeltaY * this.dollySens;
		}
		if (dolly !== 0) {
			this.distance = clamp(
				this.distance + dolly,
				this.minDistance,
				this.maxDistance,
			);
		}
		this.behind = this.distance * Math.cos(this.pitch);
		this.height = this.distance * Math.sin(this.pitch);

		const target = world.findByID(this.targetID);
		if (!target) {
			return;
		}
		this.yaw = lerpAngle(
			this.yaw,
			this.orbitYaw,
			1 - Math.exp(-this.easeBehind * dt),
		);
		const t = target.transform.position;
		const body = target.getComponent(Appearance);
		const lookAt = body ? body.height * 0.82 : this.lookHeight;
		this.gameObject.transform.position.x = t.x + Math.sin(this.yaw) * this.behind;
		this.gameObject.transform.position.y = t.y + lookAt + this.height;
		this.gameObject.transform.position.z = t.z + Math.cos(this.yaw) * this.behind;
		this.gameObject.transform.yaw = this.yaw;
		this.gameObject.transform.pitch = -this.pitch;
	}
}
