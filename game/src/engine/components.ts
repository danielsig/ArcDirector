import * as THREE from 'three';
import { Component } from './Component';
import {
	BoxCollider,
	Light as KindlingLight,
	Rigidbody,
} from '@arc-director/kindling';
import { Order } from './order';
import { clamp, lerpAngle } from './math';
import { TILE_HEIGHT } from '../world/constants';
import { characterHeight, characterTakeFps } from '../render/artCache';

export { BoxCollider };

export class RigidBody extends Rigidbody {
	public useGravity = false;
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

/** Drawbridge over water. When raised (`open` false), the river cannot be crossed. */
export class Bridge extends Component {
	public static override saved = ['open'];
	public open = false;
	public cells:{ x:number; z:number }[] = [];

	/** A lowered span is a trigger. A raised span blocks. */
	public syncCollision():void {
		const col = this.gameObject.getComponent(BoxCollider);
		if (!col) {
			return;
		}
		col.solid = !this.open;
		col.isTrigger = this.open;
	}

	public override update(dt:number):void {
		this.syncCollision();
	}
}

export class BridgeLever extends Component {}

/** Coins on a person — not an inventory stack. */
export class Wallet extends Component {
	public static override saved = ['coins'];
	public coins = 0;
}

/** Street vendor with a list price and a lowest they will take. */
export class Merchant extends Component {
	public static override saved = ['deals'];
	public specialty = '';
	public ask = 0;
	public floor = 0;
	/** Buyer id → agreed coin price, if any. */
	public deals:Record<string, number> = {};
}

export type MarketNPCKind = 'vendor' | 'customer' | 'guard';

/** Flea-market role: vendors stay; customers leave through a gate when satisfied. */
export class MarketNPC extends Component {
	public static override saved = ['wants', 'leaveGate', 'leaving'];
	public kind:MarketNPCKind = 'customer';
	public wants:string[] = [];
	public leaveGate = '';
	public leaving = false;
}

/** Walking into this door despawns a satisfied customer. */
export class MarketGate extends Component {}

/** Marked for the market watch — stolen goods, unpaid take. */
export class Wanted extends Component {
	public reason = '';
	public items:string[] = [];
	public fromID = '';
}

/** Stays with a named body when idle. Always perceives that body, even in observer. */
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

export class Flammable extends Component {
	public static override saved = ['burning', 'spread'];
	public burning = false;
	public spread = false;
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

export type HumanKind = string;
export type HumanClip = 'auto' | 'idle' | 'walk' | 'take' | 'give';
/** 0 = body yaw vs camera. 8 octants; 2/4/8/10 = 1:30/4:30/7:30/10:30 (45° diagonals). */
export type HumanHour = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 9 | 10 | 12;
export const POCKET_FRAMES = 8;
/** Fallback when `character.json` omits walkFps. Witch sets 16; pixel kinds stay at 8. */
export const PLAYER_WALK_FPS = 16;

/** Which character art to show and which clip to play. Complements HumanBody (slots), not a renderer. */
export class HumanSprite extends Component {
	public static override order = Order.humanSprite;
	public kind:HumanKind = 'player';
	/** Meters. `0` uses the character folder's `character.json` height. */
	public height = 0;
	public clip:HumanClip = 'auto';
	/** Cells/sec. `0` uses `character.json` walkFps (per hour when set). */
	public walkFps = 0;
	/** Cells/sec. `0` uses `character.json` takeFps. */
	public takeFps = 0;
	public hour:HumanHour = 0;
	/** 0 = FlipX from camera. 1 / -1 lock. */
	public flip:-1 | 0 | 1 = 0;
	public animOffset = 0;
	public clipT0 = 0;

	public playClip(clip:'take' | 'give', t:number):void {
		this.clip = clip;
		this.clipT0 = t;
	}

	public override update(dt:number):void {
		if (this.clip !== 'take' && this.clip !== 'give') {
			return;
		}
		const t = this.gameObject.world?.time ?? 0;
		const fps = this.takeFps > 0 ? this.takeFps : characterTakeFps(this.kind);
		if (t - this.clipT0 >= POCKET_FRAMES / fps) {
			this.clip = 'auto';
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

const HURT_LIFE = 0.42;

/** Knockback + blink after a hit. Runs after the motor so the shove wins that frame. */
export class HurtFlash extends Component {
	public static override order = Order.hurt;
	public until = 0;
	public vx = 0;
	public vz = 0;

	public get active():boolean {
		const now = this.gameObject.world?.time ?? 0;
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
		if (!world || !rb || world.time >= this.until) {
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
		const u = Math.max(0, (this.until - world.time) / HURT_LIFE);
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

/** One up-and-down hop. `abs(sin(ω t))` lands when `ω t = π`. */
const HOP_OMEGA = 12;
const HOP_PERIOD = Math.PI / HOP_OMEGA;

/** Hop in place after a win — applied after ground snap so it stays visible. */
export class Celebrating extends Component {
	public until = 0;
	/** Counted hops from rest. 0 = until-only, phase locked to world time. */
	public hops = 0;
	public timestamp = 0;

	public static override order = Order.celebrating;

	public beginHops(time:number, count:number):void {
		this.hops = count;
		this.timestamp = time;
		this.until = time + count * HOP_PERIOD + 0.02;
		this.enabled = true;
	}

	public override lateUpdate(dt:number):void {
		const world = this.gameObject.world;
		const p = this.gameObject.transform.position;
		const tile = world?.tileAtWorld(p.x, p.z);
		const base = (tile?.height ?? 0) * TILE_HEIGHT;
		if (!world) {
			p.y = base;
			this.enabled = false;
			return;
		}
		if (this.hops > 0) {
			const elapsed = world.time - this.timestamp;
			if (elapsed >= this.hops * HOP_PERIOD) {
				p.y = base;
				this.enabled = false;
				return;
			}
			p.y = base + Math.abs(Math.sin(elapsed * HOP_OMEGA)) * 0.38;
			return;
		}
		if (world.time >= this.until) {
			p.y = base;
			this.enabled = false;
			return;
		}
		p.y = base + Math.abs(Math.sin(world.time * HOP_OMEGA)) * 0.38;
	}

	public stop():void {
		this.until = 0;
		this.hops = 0;
		this.lateUpdate(0);
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
		const body = target.getComponent(HumanSprite);
		const lookAt = body
			? (body.height > 0 ? body.height : characterHeight(body.kind)) * 0.82
			: this.lookHeight;
		this.gameObject.transform.position.x = t.x + Math.sin(this.yaw) * this.behind;
		this.gameObject.transform.position.y = t.y + lookAt + this.height;
		this.gameObject.transform.position.z = t.z + Math.cos(this.yaw) * this.behind;
		this.gameObject.transform.yaw = this.yaw;
		this.gameObject.transform.pitch = -this.pitch;
	}
}
