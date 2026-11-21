import * as THREE from 'three';
import {
	BoxCollider,
	clamp,
	lerpAngle,
	Light as KindlingLight,
	MeshRenderer,
	Rigidbody,
	Time,
	Component,
	type GameObject,
	type SfxPatch,
	type XZ,
} from '@arc-director/kindling';
import { showNamingText, type NamingText } from 'arc-director';
import { Order } from './order';
import { cueAt } from '../audio/cue';
import type { DemoWorld } from './demo-world';
import { Item } from '../items/item-components';
import { getDef } from '../items/defs';
import { equipItem } from '../items/equip';
import { findCarried, findReady, inBackpack, removeFromBags } from '../items/inventory';
import { itemID, type ItemInstance } from '../items/instance';
import type { UseResult } from '../items/use';
import { characterModel } from '../render/character-models';
export { BoxCollider };

/** Ground speed (m/s) below which a character stands. */
const WALKING_SPEED = 0.35;

/** Whether `go` moves fast enough to walk rather than stand. */
export function isWalking(go:GameObject):boolean {
	return (go.getComponent(Rigidbody)?.speed ?? 0) > WALKING_SPEED;
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

/** `go`'s id as minds know it: its `Named` id, else its own. */
export function idOf(go:GameObject):string {
	return go.getComponent(Named)?.id || go.id;
}

export class Attached extends Component {
	public toID = '';
	public mode:'on' | 'in' | 'worn' | 'held' = 'on';
}

/**
 * What stands in the way until it is cleared (a shut door, a raised bridge, a web to burn): a route that meets one is
 * told how to get past it. Anything else a body runs into is no way at all.
 */
export abstract class Barrier extends Component {
	/** Each body's {@link whyBlocked}, made once. */
	private readonly _whyBlocked = new WeakMap<GameObject, NamingText>();

	/**
	 * Why it stops `body`, in words the agent can act on, each mind in its own names ({@link blockedText}). Worded only
	 * when shown, so a route search past it looks nothing up; the same one for the same body, so the search meets it
	 * as one blocker.
	 */
	public whyBlocked(body:GameObject):NamingText {
		let why = this._whyBlocked.get(body);
		if (!why) {
			why = (name) => this.blockedText(body, name);
			this._whyBlocked.set(body, why);
		}
		return why;
	}

	/** Whether someone at `from` clears it just by walking up, so a route may go through it. */
	public opensFrom(from:XZ):boolean {
		return false;
	}

	/** Whether it is in the way as a barrier now. Once cleared (an open door), what is left of it is an ordinary obstacle a route goes round. */
	public get standsInWay():boolean {
		return true;
	}

	/** Why it stops `body` now, as it stands, each id written as `name` calls it. */
	protected abstract blockedText(body:GameObject, name:(id:string)=>string):string;

	/** Its id, as ArcDirector knows it. */
	protected get label():string {
		return idOf(this.gameObject);
	}
}

export class Lock extends Component {
	public static override saved = ['keyID', 'locked'];
	public keyID = '';
	public locked = true;
	/** Which side of a door the lock bars opening from. From `outside`, anyone inside opens it, and it stays locked. */
	public lockedFrom:'both' | 'outside' = 'both';

	/** Its key turns, with its sound: it unlocks, unless it bars one side only (`lockedFrom`), which stays locked for the next one out there. */
	public turnKey():void {
		if (this.locked) {
			this.locked = this.lockedFrom === 'outside';
			cueAt(this.gameObject.world, 'unlock', this.gameObject);
		}
	}

	/** Whether `item` (or an item def) is its key. */
	public fits(item:{ Key?:{ keyID:string } }):boolean {
		return item.Key?.keyID === this.keyID;
	}

	/** Why `character` cannot open it by hand, or nothing: unlocked, or its key ready in a hand. One in the pack has to come out first. */
	public refusal(character:GameObject):string | undefined {
		if (!this.locked || findReady(character, (it) => this.fits(it))) {
			return undefined;
		}
		return findCarried(character, (it) => this.fits(it)) ? 'the key is in your pack' : showNamingText(lockedReason(this.gameObject.world, this, character));
	}

	/**
	 * `character` uses `item` on what it holds shut: its key, taken into a hand from the pack if need be, turns and
	 * `open`s it; a wrong key, or anything else while it is locked, says what it needs. Nothing for anything else.
	 */
	public useKey(character:GameObject, item:ItemInstance, open:()=>void):UseResult | undefined {
		const world = this.gameObject.world;
		if (!item.Key) {
			return this.locked ? { ok: false, reason: lockedReason(world, this, character) } : undefined;
		}
		if (world && inBackpack(character, item)) {
			const err = equipItem(character, item, world);
			if (err) {
				return { ok: false, reason: err };
			}
			removeFromBags(character, item);
		}
		if (!this.fits(item)) {
			const id = this.gameObject.getComponent(Named)?.id;
			return { ok: false, reason: (name) => `wrong key — ${id ? name(id) : 'it'} needs ${showNamingText(keyNameFor(world, this, character), name)}` };
		}
		open();
		return { ok: true, reason: this.locked ? 'opened' : 'unlocked' };
	}
}

/** A door's or chest's: open or not, with the sounds it makes either way. */
type Openable = Component & { open:boolean };

/** Opens or shuts `c` with its `sfx`; `unlock` turns its lock's key first ({@link Lock.turnKey}). Whether it moved. */
export function setOpen(c:Openable, open:boolean, unlock:boolean, sfx:{ open:SfxPatch; close:SfxPatch }):boolean {
	if (unlock) {
		c.gameObject.getComponent(Lock)?.turnKey();
	}
	if (open === c.open) {
		return false;
	}
	c.open = open;
	cueAt(c.gameObject.world, open ? sfx.open : sfx.close, c.gameObject);
	return true;
}

/**
 * The key that opens `lock`, wherever it lies, so a locked thing says `BrassKey` and not just "a brass key"; with who
 * carries it or what holds it, where `viewer` knows (`BrassKey, carried by William`, `BrassKey; it's in CellarChest`).
 * Each mind reads it in its own names, and the key is looked for only then: a route search past locked doors only
 * holds it.
 */
export function keyNameFor(world:DemoWorld | null, lock:Lock, viewer?:GameObject):NamingText {
	return (name) => {
		for (const go of world?.objects ?? []) {
			const id = idOf(go);
			const item = go.getComponent(Item);
			if (item && lock.fits(getDef(item.defID).components)) {
				return name(id);
			}
			const held = findCarried(go, (it) => lock.fits(it));
			if (held) {
				const known = viewer && go !== viewer && world!.canSeeInventoryOf(viewer, go);
				return !known ? name(itemID(held)) : `${name(itemID(held))}${go.getComponent(HumanBody) ? ', carried by' : "; it's in"} ${name(id)}`;
			}
		}
		return `a ${lock.keyID} key`;
	};
}

/** `locked — needs BrassKey`, the one failure every locked door and chest gives, worded for `viewer` ({@link keyNameFor}). */
export function lockedReason(world:DemoWorld | null, lock:Lock, viewer?:GameObject):NamingText {
	return lock.keyID ? (name) => `locked — needs ${showNamingText(keyNameFor(world, lock, viewer), name)}` : 'locked';
}

/** What `examine` adds of `go`'s lock while it holds (` and locked; it needs BrassKey`), worded for `viewer`. */
export function lockedNote(go:GameObject, nameOf:(id:string)=>string, viewer?:GameObject):string {
	const lock = go.getComponent(Lock);
	return lock?.locked ? ` and locked${lock.keyID ? `; it needs ${showNamingText(keyNameFor(go.world, lock, viewer), nameOf)}` : ''}` : '';
}

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

export type MarketplaceNPCKind = 'vendor' | 'customer' | 'guard';

/** Flea-marketplace role: vendors stay; customers leave through a gate when satisfied. */
export class MarketplaceNPC extends Component {
	public static override saved = ['wants', 'leaveGate', 'leaving', 'postX', 'postZ', 'post'];
	public kind:MarketplaceNPCKind = 'customer';
	public wants:string[] = [];
	public leaveGate = '';
	public leaving = false;
	/** Where a vendor stands. They are not sent off this post. */
	public postX = 0;
	public postZ = 0;
	public post = '';
}

/** Walking into this doorway despawns a customer who is leaving through it. */
export class MarketplaceGate extends Component {}

/** Marked for the marketplace watch — stolen goods, unpaid take. */
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

/** Serves `targetID`: always notices them, and hands them what will not fit in their bags. Following is the mind's program, not this component. */
export class Companion extends Component {
	public targetID = 'Player';
}

/** Whitelist of speakers this body hears. Anyone else is silent to them. */
export class HearOnly extends Component {
	public from:string[] = [];
}

export class Flame extends Component {
	public canIgnite = true;
}

/** Hurt `times` over by the attacks in `to` (a fight verb, such as hex), and `others` times by every other blow. */
export class Weakness extends Component {
	public to:string[] = [];
	public times = 3;
	public others = 0.5;
}

/** Attacks it can make beyond its fight role's own (a Blade who can also cleave). */
export class Moves extends Component {
	public extra:string[] = [];
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

export type SlotFill = ItemInstance | OccupiedRef | null;

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
	public pockets:import('../items/item-components').Container | null = null;
}

export class Vitals extends Component {
	public static override saved = ['hp', 'maxHP'];
	public hp = 5;
	public maxHP = 5;
	/** Whether it can dodge a blow at all. A dull brute cannot: every blow that reaches it lands. */
	public evasive = true;
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
		const rb = this.gameObject.getComponent(Rigidbody);
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

	/** While its speaker walks, the line stays up twice as long: its countdown runs at half speed. */
	public override update(dt:number):void {
		if (this.text && Time.time < this.until && isWalking(this.gameObject)) {
			this.until += dt / 2;
		}
	}
}

/** How a character celebrates: jumping for joy (the `jump` clip, whose hips leave the ground) or cheering. */
export type CelebrationStyle = 'jump' | 'cheer';

/** Seconds per hop of the `jump` clip (five in its 2.2 s), and how long a counted cheer lasts. */
const JUMP_PERIOD = 0.44;
const CHEER_SECONDS = 3;

/**
 * Celebrating until `until` (world time): `CharacterAnimation` plays the style's clip. Each time it
 * starts, a feminine model picks jumping or cheering at random; the rest only cheer. Starting to walk ends it early.
 */
export class Celebrating extends Component {
	public static override order = Order.celebrating;
	public until = 0;
	public style:CelebrationStyle = 'cheer';
	private _wasWalking = false;

	/** Celebrates `seconds` long. */
	public celebrateFor(seconds:number):void {
		this.enabled = true;
		this.until = Time.time + seconds;
	}

	/** Celebrates about `count` jumps long (a cheer lasts a few seconds instead). */
	public beginHops(count:number):void {
		this.enabled = true;
		this.until = Time.time + (this.style === 'jump' ? count * JUMP_PERIOD : CHEER_SECONDS);
	}

	public override onEnable():void {
		const feminine = characterModel(this.gameObject.getComponent(MeshRenderer)?.meshID ?? '')?.feminine;
		this.style = feminine && Math.random() < 0.6 ? 'jump' : 'cheer';
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
		return isWalking(this.gameObject);
	}

	public stop():void {
		this.until = 0;
		this.enabled = false;
	}
}

const CAMERA_HEIGHT = 11;
const CAMERA_BEHIND = 7.4;
/** The camera's default distance from its target, in meters. */
export const CAMERA_DISTANCE = Math.hypot(CAMERA_HEIGHT, CAMERA_BEHIND);

export class FollowCamera extends Component {
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
	public distance = CAMERA_DISTANCE;
	public minDistance = 3;
	public maxDistance = 24;
	public dollySens = 0.028;
	public wheelSens = 0.012;
	/** Look-at height above the target's feet (torso, not the ground). */
	public lookHeight = 2.0;

	public override lateUpdate(dt:number):void {
		const input = this.gameObject.world?.input;
		if (!input) {
			return;
		}
		const dolly = input.wheelDelta * this.wheelSens + input.lookDeltaY * this.dollySens;
		this.distance = clamp(
			(this.distance + dolly) / input.pinch,
			this.minDistance,
			this.maxDistance,
		);
		this.yaw = lerpAngle(this.yaw, this.orbitYaw, 1 - Math.exp(-this.easeBehind * dt));
		this.place();
	}

	/** Jumps to where the camera eases to: behind its target at `orbitYaw`, `distance` away. */
	public snap():void {
		this.yaw = this.orbitYaw;
		this.place();
	}

	private place():void {
		this.behind = this.distance * Math.cos(this.pitch);
		this.height = this.distance * Math.sin(this.pitch);
		const target = this.gameObject.world?.findByID(this.targetID);
		if (!target) {
			return;
		}
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
