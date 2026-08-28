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

export { BoxCollider };

export class RigidBody extends Rigidbody {
	useGravity = false;
}

export class Light extends KindlingLight {
	static override order = Order.light;
	/** Scale of the intensity random-walk. 0 = steady light. */
	intensityFlicker = 1;
	/** Lamp-only positional random-walk amplitude in meters. 0 = no motion. */
	positionalFlicker = 0;
	/**
	 * How fast intensity chases its random-walk target.
	 * Unit: fraction of remaining gap per second when in (0, 1).
	 * 0 = freeze, 1 = snap to target.
	 */
	intensityFlickerSpeed = 1;
	/**
	 * How fast lamp position chases its random-walk target.
	 * Unit: fraction of remaining gap per second when in (0, 1).
	 * 0 = freeze, 1 = snap to target.
	 */
	positionalFlickerSpeed = 1;
	flicker = 1;
	private flickerTo = 1;
	private flickerIn = 0;
	private posX = 0;
	private posY = 0;
	private posZ = 0;
	private posToX = 0;
	private posToY = 0;
	private posToZ = 0;
	private posIn = 0;

	/** Random-walk intensity pulse; not a looping sine. */
	pulse(dt:number):number {
		this.flickerIn -= dt;
		if (this.flickerIn <= 0) {
			this.flickerTo = 0.72 + Math.random() * 0.4;
			this.flickerIn = 0.03 + Math.random() * 0.12;
		}
		const ik = Light.chaseK(this.intensityFlickerSpeed, dt);
		this.flicker += (this.flickerTo - this.flicker) * ik;
		this.walkPosition(dt);
		return 1 + (this.flicker - 1) * this.intensityFlicker;
	}

	/** Lamp jitter in host-local meters: x right, y up, z yaw-forward (into the room). */
	lampJitter():{ x:number; y:number; z:number } {
		const a = this.positionalFlicker;
		if (a <= 0) {
			return { x: 0, y: 0, z: 0 };
		}
		return { x: this.posX * a, y: this.posY * a, z: Math.max(0, this.posZ) * a };
	}

	override update(dt:number):void {
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
		this.posIn -= dt;
		if (this.posIn <= 0) {
			this.posToX = Math.random() * 2 - 1;
			this.posToY = Math.random() * 2 - 1;
			this.posToZ = Math.random();
			this.posIn = 0.04 + Math.random() * 0.14;
		}
		const k = Light.chaseK(this.positionalFlickerSpeed, dt);
		this.posX += (this.posToX - this.posX) * k;
		this.posY += (this.posToY - this.posY) * k;
		this.posZ += (this.posToZ - this.posZ) * k;
	}
}

export class Named extends Component {
	id = '';
	aliases:string[] | undefined;
}

export class StreamingAnchor extends Component {
	viewRadius = 20;
	hysteresis = 8;
}

export class ChunkBound extends Component {
	chunkID = '';
}

export class Attached extends Component {
	toID = '';
	mode:'on' | 'in' | 'worn' | 'held' = 'on';
}

export class Door extends Component {
	static override order = Order.door;
	open = false;
	axis:'x' | 'z' = 'x';
	blockedWhenClosed = true;
	closedYaw = 0;
	openYaw = 0;
	/** Named building this door opens into, if any. */
	buildingID = '';

	/** Keep the AABB in sync the moment the leaf moves — do not wait for the next tick. */
	syncCollision():void {
		const col = this.gameObject.getComponent(BoxCollider);
		if (!col) {
			return;
		}
		const blocking = this.blockedWhenClosed && !this.open;
		col.solid = blocking;
		col.isTrigger = !blocking;
	}

	override update(_dt:number):void {
		this.syncCollision();
	}
}

/** Walkable AABB of a named building (world XZ, walls excluded). */
export class Interior extends Component {
	minX = 0;
	maxX = 0;
	minZ = 0;
	maxZ = 0;
}

export class Lock extends Component {
	keyID = '';
	locked = true;
}

export class Chest extends Component {
	open = false;
}

/** Drawbridge over water. When closed, the river cannot be crossed. */
export class Bridge extends Component {
	open = false;
	cells:{ x:number; z:number }[] = [];
}

export class MillLever extends Component {}

/** Coins on a person — not an inventory stack. */
export class Wallet extends Component {
	coins = 0;
}

/** Street vendor with a list price and a haggle floor. */
export class Merchant extends Component {
	specialty = '';
	ask = 0;
	floor = 0;
	/** Buyer id → agreed coin price after a successful haggle. */
	deals:Record<string, number> = {};
}

export type CrowdKind = 'vendor' | 'customer' | 'guard';

/** Flea-market role: vendors stay; customers leave through a gate when satisfied. */
export class Crowd extends Component {
	kind:CrowdKind = 'customer';
	wants:string[] = [];
	leaveGate = '';
	leaving = false;
}

/** Walking into this door despawns a satisfied customer. */
export class CrowdExit extends Component {}

/** Marked for the market watch — stolen goods, unpaid take. */
export class Wanted extends Component {
	reason = '';
	items:string[] = [];
	fromID = '';
}

/** Stays with a named body when idle. Always perceives that body, even in observer. */
export class Companion extends Component {
	targetID = 'Player';
	/** When true, idle steering does not follow the master (stay/wait orders). */
	hold = false;
}

export class BrewHearth extends Component {}

export class Sickbed extends Component {
	caretaker = '';
	tended = false;
}

export class Flame extends Component {
	canIgnite = true;
}

export class Flammable extends Component {
	burning = false;
	spread = false;
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

export const HUMAN_KINDS = ['player', 'guard', 'robe', 'merchant', 'princess', 'sorceress'] as const;
export type HumanKind = typeof HUMAN_KINDS[number];
export type HumanClip = 'auto' | 'idle' | 'walk' | 'take' | 'give';
/** 0 = camera-relative. Idle authors 1–6 and 12; walk stays 2/4/6/12. */
export type HumanHour = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 12;
export const POCKET_FRAMES = 8;

/** Which character art to show and which clip to play. Complements HumanBody (slots), not a renderer. */
export class HumanSprite extends Component {
	static override order = Order.humanSprite;
	kind:HumanKind = 'player';
	clip:HumanClip = 'auto';
	walkFps = 8;
	/** Pocket take/give is slower than walk (walk is 8). */
	takeFps = 5;
	hour:HumanHour = 0;
	/** 0 = FlipX from camera. 1 / -1 lock. */
	flip:-1 | 0 | 1 = 0;
	animOffset = 0;
	clipT0 = 0;

	playClip(clip:'take' | 'give', t:number):void {
		this.clip = clip;
		this.clipT0 = t;
	}

	override update(_dt:number):void {
		if (this.clip !== 'take' && this.clip !== 'give') {
			return;
		}
		const t = this.gameObject.world?.time ?? 0;
		if (t - this.clipT0 >= POCKET_FRAMES / this.takeFps) {
			this.clip = 'auto';
		}
	}
}

export class HumanBody extends Component {
	slots:Record<BodySlot, SlotFill> = {
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
	pockets:import('../items/components').Container | null = null;
}

export class Vitals extends Component {
	hp = 5;
	maxHP = 5;
	mana = 5;
	maxMana = 5;
}

export class SpeechBubble extends Component {
	text = '';
	until = 0;
	height = 1.42;
}

/** Hop in place after a win — applied after ground snap so it stays visible. */
export class Celebrating extends Component {
	until = 0;

	static override order = Order.celebrating;

	override lateUpdate(_dt:number):void {
		const world = this.gameObject.world;
		const p = this.gameObject.transform.position;
		const tile = world?.tileAtWorld(p.x, p.z);
		const base = (tile?.height ?? 0) * TILE_HEIGHT;
		if (!world || world.time >= this.until) {
			p.y = base;
			this.enabled = false;
			return;
		}
		p.y = base + Math.abs(Math.sin(world.time * 12)) * 0.38;
	}

	stop():void {
		this.until = 0;
		this.lateUpdate(0);
	}
}

export class Torch extends Component {
	static override order = Order.torch;
	lit = true;
	baseIntensity = 48;
	baseDecay = 2;
	/** 0–1 start phase so flame loops are not globally synced. */
	animOffset = Math.random();
	/** Frames per second for the flame sprite. */
	flickerRate = 7.2 + Math.random() * 6.5;

	override update(dt:number):void {
		const light = this.gameObject.getComponent(Light);
		if (!light) {
			return;
		}
		light.enabled = this.lit;
		if (!this.lit) {
			return;
		}
		light.intensity = this.baseIntensity * light.pulse(dt);
		light.decay = this.baseDecay * 0.5;
	}
}

const CAMERA_HEIGHT = 11;
const CAMERA_BEHIND = 7.4;

export class Camera extends Component {
	static override order = Order.camera;
	targetID = 'Player';
	height = CAMERA_HEIGHT;
	behind = CAMERA_BEHIND;
	/** Radians down from horizontal. */
	pitch = 40 * Math.PI / 180;
	easeBehind = 3.2;
	/** Independent of player yaw; eases to stay behind. */
	yaw = 0;
	/** Dolly along the follow offset; pitch stays fixed. */
	distance = Math.hypot(CAMERA_HEIGHT, CAMERA_BEHIND);
	minDistance = 3;
	maxDistance = 24;
	dollySens = 0.028;
	wheelSens = 0.012;
	/** Look-at height above the target's feet (torso, not the ground). */
	lookHeight = 2.0;

	override lateUpdate(dt:number):void {
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
			target.transform.yaw,
			1 - Math.exp(-this.easeBehind * dt),
		);
		const t = target.transform.position;
		this.gameObject.transform.position.x = t.x + Math.sin(this.yaw) * this.behind;
		this.gameObject.transform.position.y = t.y + this.lookHeight + this.height;
		this.gameObject.transform.position.z = t.z + Math.cos(this.yaw) * this.behind;
		this.gameObject.transform.yaw = this.yaw;
		this.gameObject.transform.pitch = -this.pitch;
	}
}
