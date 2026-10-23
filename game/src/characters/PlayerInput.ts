import { MOUSE_LEFT, Time, yawToForward, yawToward, Component, type GameObject } from '@arc-director/kindling';
import * as THREE from 'three';
import { Camera, Chest, Door, Guard, HumanBody, Appearance, Named, Vitals, type BodySlot } from '../engine/components';
import { attackFor } from '../director/fight';
import { inReach, strikeWith, useItem } from '../items/use';
import { CharacterAnimation } from './CharacterAnimation';
import { CharacterPose } from './CharacterPose';
import { Order } from '../engine/order';
import { aimAlong, aimTarget } from './aim';
import { carryBags, slotItem } from '../items/inventory';
import type { ItemInstance } from '../items/instance';
import { swapHeldHands } from '../items/equip';
import { dropItem, interactChest, interactDoor, nearestPickup, pickup } from '../items/pickup';
import { PlayerPilot } from './PlayerPilot';
import { examineWorld } from '../director/perception';

const YAW_SENS = 0.0024;
/** A held guard: renewed this far ahead each frame Shift is down; the pose holds it up this long at most. */
const GUARD_REFRESH = 0.1;
const GUARD_HELD = 3600;

export class PlayerInput extends Component {
	public static override order = Order.playerInput;
	public moveX = 0;
	public moveZ = 0;
	public lookYaw = 0;
	public selected = 0;
	public cursorName = '';
	/** False for a camera player: it walks and looks, nothing else. */
	public embodied = true;
	/** When the next swing may start. */
	private _readyAt = 0;
	private _guarding = false;
	/** The shot being drawn: when the draw began, and whether the trigger is let go (it looses once fully drawn). */
	private _draw:{ t0:number; released:boolean } | null = null;

	public override update(dt:number):void {
		const world = this.gameObject.world;
		if (!world) {
			this.moveX = 0;
			this.moveZ = 0;
			return;
		}
		const cam = world.findByID('MainCamera')?.getComponent(Camera);
		if (world.sayOpen) {
			this.moveX = 0;
			this.moveZ = 0;
			this.lowerArms();
			if (cam) {
				cam.orbitYaw = this.lookYaw;
			}
			return;
		}
		const input = world.input;
		let wishX = 0;
		let wishZ = 0;
		if (input.key('KeyW') || input.key('ArrowUp')) {
			wishZ += 1;
		}
		if (input.key('KeyS') || input.key('ArrowDown')) {
			wishZ -= 1;
		}
		if (input.key('KeyD') || input.key('ArrowRight')) {
			wishX += 1;
		}
		if (input.key('KeyA') || input.key('ArrowLeft')) {
			wishX -= 1;
		}
		const len = Math.hypot(wishX, wishZ);
		if (len > 1e-6) {
			wishX /= len;
			wishZ /= len;
		}

		const yaw = cam?.yaw ?? 0;
		const fwd = yawToForward(yaw);
		const rightX = -fwd.z;
		const rightZ = fwd.x;
		this.moveX = fwd.x * wishZ + rightX * wishX;
		this.moveZ = fwd.z * wishZ + rightZ * wishX;

		if (input.pointerLocked) {
			this.lookYaw -= input.lookDeltaX * YAW_SENS;
		}
		if (cam) {
			cam.orbitYaw = this.lookYaw;
		}
		// The dead only look around.
		if ((this.gameObject.getComponent(Vitals)?.hp ?? 1) <= 0) {
			this.moveX = 0;
			this.moveZ = 0;
			this.lowerArms();
			return;
		}
		if (!this.embodied) {
			this.lowerArms();
			return;
		}

		for (let d = 1; d <= 8; d++) {
			if (input.pressed(`Digit${d}`)) {
				this.selected = d - 1;
			}
		}

		const aimed = aimTarget(world, this.gameObject);
		this.cursorName = aimed?.getComponent(Named)?.id ?? aimed?.name ?? '';

		if (input.pressed('KeyE')) {
			const loot = nearestPickup(this.gameObject);
			if (loot) {
				const lootName = loot.getComponent(Named)?.id ?? loot.name;
				const msg = pickup(this.gameObject, loot);
				world.setMessage(msg);
				if (msg.startsWith('picked up') || msg.startsWith('equipped')) {
					this.gameObject.getComponent(Appearance)?.playClip('take', Time.time, loot);
					world.pickedUp(this.gameObject, lootName);
				}
			}
			else if (aimed?.getComponent(Chest)) {
				const msg = interactChest(this.gameObject, aimed);
				world.setMessage(msg);
				if (msg.startsWith('took ')) {
					this.gameObject.getComponent(Appearance)?.playClip('take', Time.time, aimed);
				}
			}
			else if (aimed?.getComponent(Door)) {
				world.setMessage(interactDoor(this.gameObject, aimed));
			}
			else if (aimed) {
				// Anything else aimed at is looked over, as an NPC's `examine` would; long reads stay up longer.
				const seen = examineWorld(aimed);
				world.setMessage(seen, Math.max(3.2, seen.length / 15));
			}
		}

		const yielded = this.gameObject.getComponent(PlayerPilot)?.consumeYield() === true;
		const clicked = input.pressed('KeyF') || (input.pressed(MOUSE_LEFT) && !yielded);
		// A sword in hand: Shift holds the guard up; a click stabs on the move, slices standing, cleaves with Shift.
		const weapon = this.heldWeapon();
		const sword = weapon?.Blade ? weapon : null;
		const shift = input.key('ShiftLeft') || input.key('ShiftRight');
		this.holdGuard(!!sword && shift && !clicked && Time.time >= this._readyAt);
		if (!weapon?.Bow) {
			this.cutShot();
		}
		if (weapon?.Bow) {
			this.drawBow(weapon, clicked, input.key('KeyF') || input.key(MOUSE_LEFT), len > 1e-6, fwd);
		}
		else if (sword && clicked) {
			this.attack(sword, shift ? 'cleave' : len > 1e-6 ? 'stab' : 'slice', aimed);
		}
		else if (clicked) {
			const item = this.activeItem();
			if (item) {
				const result = useItem(this.gameObject, item, aimed);
				world.setMessage(result.reason);
			}
			else if (aimed?.getComponent(Door)) {
				world.setMessage(interactDoor(this.gameObject, aimed));
			}
			else {
				world.setMessage('empty hands');
			}
		}

		if (input.pressed('KeyT')) {
			this.gameObject.getComponent(Appearance)?.playClip('take', Time.time);
		}
		if (input.pressed('KeyY')) {
			this.gameObject.getComponent(Appearance)?.playClip('give', Time.time);
		}

		if (input.pressed('KeyX')) {
			world.setMessage(swapHeldHands(this.gameObject));
		}

		if (input.pressed('KeyG')) {
			const item = this.activeItem();
			if (item) {
				this.takeActive();
				dropItem(this.gameObject, item);
				world.setMessage(`dropped ${item.name}`);
			}
		}
	}

	/** The selected item when it is a weapon in hand. */
	private heldWeapon():ItemInstance | null {
		const item = this.activeItem();
		const body = this.gameObject.getComponent(HumanBody);
		const inHand = !!body && (slotItem(body, 'hands.left.held') === item || slotItem(body, 'hands.right.held') === item);
		return item?.Weapon && inHand ? item : null;
	}

	/** Faces `target` and plays `verb`'s move with `weapon` at them; the blow lands once the wind-up is done. */
	private attack(weapon:ItemInstance, verb:string, target:GameObject | null):void {
		const world = this.gameObject.world;
		if (!world || Time.time < this._readyAt) {
			return;
		}
		const { castTime, cooldown } = attackFor(verb, undefined);
		this._readyAt = Time.time + castTime + cooldown;
		if (target) {
			this.face(target);
		}
		this.gameObject.getComponent(CharacterAnimation)?.strike(verb, castTime, target ?? undefined);
		world.after(castTime, () => this.land(weapon, verb, target));
	}

	/**
	 * A bow in hand: a click starts the draw (standing still), and letting go looses it once fully
	 * drawn; moving lowers it. All the while it turns on whoever stands nearest the line straight
	 * ahead of the camera, or along that line when no one does.
	 */
	private drawBow(bow:ItemInstance, clicked:boolean, held:boolean, moving:boolean, forward:{ x:number; z:number }):void {
		const world = this.gameObject.world;
		if (moving) {
			this.cutShot();
		}
		if (!world || moving || (!this._draw && (!clicked || Time.time < this._readyAt))) {
			return;
		}
		const { castTime, cooldown } = attackFor('shoot', undefined);
		const range = bow.Weapon!.range;
		const target = aimAlong(world, this.gameObject, forward, range) ?? this.groundAhead(forward, range);
		const pose = this.gameObject.getComponent(CharacterPose);
		this.face(target);
		if (!this._draw) {
			this._draw = { t0: Time.time, released: false };
			pose?.shoot(target, castTime, true);
			return;
		}
		pose?.aimShot(target);
		this._draw.released ||= !held;
		if (this._draw.released && Time.time >= this._draw.t0 + castTime) {
			this._draw = null;
			this._readyAt = Time.time + cooldown;
			this.land(bow, 'shoot', target);
		}
	}

	/** Lowers the bow being drawn, its arrow unloosed. */
	private cutShot():void {
		if (this._draw) {
			this._draw = null;
			this.gameObject.getComponent(CharacterPose)?.resolve('cut');
		}
	}

	/** Lowers the guard and the bow: the dead, the bodiless and the talking fight no more. */
	private lowerArms():void {
		this.holdGuard(false);
		this.cutShot();
	}

	/**
	 * The blow of `verb` with `weapon` lands on `target`: now, or for a shot once its arrow gets
	 * there (wide of them when out of reach, into the ground at a spot).
	 */
	private land(weapon:ItemInstance, verb:string, target:GameObject | THREE.Vector3 | null):void {
		const world = this.gameObject.world;
		const pose = this.gameObject.getComponent(CharacterPose);
		if (!world || !target || target instanceof THREE.Vector3) {
			pose?.resolve('miss');
			return;
		}
		const flight = pose?.flightTime() ?? 0;
		pose?.resolve(inReach(this.gameObject, weapon, target, verb) ? 'hit' : 'miss');
		world.after(flight, () => world.setMessage(strikeWith(this.gameObject, weapon, target, verb)));
	}

	/** Turns the body to face `target` now. */
	private face(target:GameObject | THREE.Vector3):void {
		const to = target instanceof THREE.Vector3 ? target : target.transform.position;
		const p = this.gameObject.transform.position;
		this.gameObject.transform.yaw = yawToward(to.x - p.x, to.z - p.z);
	}

	/** The ground `range` m off along `forward`: where a shot at no one lands. */
	private groundAhead(forward:{ x:number; z:number }, range:number):THREE.Vector3 {
		const p = this.gameObject.transform.position;
		const x = p.x + forward.x * range;
		const z = p.z + forward.z * range;
		return new THREE.Vector3(x, this.gameObject.world?.sampleTerrain(x, z)?.worldY ?? p.y, z);
	}

	/** Keeps the guard up while `up`, and lowers it when not. */
	private holdGuard(up:boolean):void {
		if (up) {
			this.gameObject.getOrAddComponent(Guard).raise(GUARD_REFRESH);
		}
		if (up !== this._guarding) {
			this._guarding = up;
			this.gameObject.getComponent(CharacterPose)?.guard(up ? GUARD_HELD : 0);
		}
	}

	public hotbar():ItemInstance[] {
		const list:ItemInstance[] = [];
		const body = this.gameObject.getComponent(HumanBody);
		if (body) {
			const left = slotItem(body, 'hands.left.held');
			const right = slotItem(body, 'hands.right.held');
			if (left) {
				list.push(left);
			}
			if (right && right !== left) {
				list.push(right);
			}
		}
		for (const bag of carryBags(this.gameObject)) {
			for (const it of bag.contents) {
				list.push(it);
			}
		}
		return list;
	}

	public activeItem():ItemInstance | null {
		const bar = this.hotbar();
		if (bar.length === 0) {
			return null;
		}
		return bar[this.selected % bar.length] ?? bar[0];
	}

	private takeActive():void {
		const item = this.activeItem();
		if (!item) {
			return;
		}
		const body = this.gameObject.getComponent(HumanBody);
		if (body) {
			for (const slot of ['hands.left.held', 'hands.right.held'] as BodySlot[]) {
				if (slotItem(body, slot) === item) {
					body.slots[slot] = null;
					return;
				}
			}
		}
		for (const bag of carryBags(this.gameObject)) {
			const i = bag.contents.indexOf(item);
			if (i >= 0) {
				bag.contents.splice(i, 1);
				return;
			}
		}
	}
}
