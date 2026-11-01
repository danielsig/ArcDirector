import { MOUSE_LEFT, TOUCH_TAP, Time, yawToForward, yawToward, Component, type GameObject } from '@arc-director/kindling';
import * as THREE from 'three';
import { Camera, Chest, Door, Furniture, Guard, HumanBody, Appearance, Named, Vitals, type BodySlot } from '../engine/components';
import { attackFor } from '../director/fight';
import { inReach, strikeWith, useItem } from '../items/use';
import { CharacterAnimation } from './CharacterAnimation';
import { CharacterPose } from './CharacterPose';
import { Order } from '../engine/order';
import { aimAlong, aimTarget } from './aim';
import { carryBags, slotItem } from '../items/inventory';
import type { ItemInstance } from '../items/instance';
import { itemInHeldSlot, swapHeldHands, toggleHeld } from '../items/equip';
import { dropItem, interactChest, interactDoor, nearestPickup, pickup } from '../items/pickup';
import { PlayerPilot } from './PlayerPilot';
import { Reading } from './Reading';
import { occupantName, overWater, Seated } from './Seated';
import { examineWorld } from '../director/perception';

const YAW_SENS = 0.0024;
/** A held guard: renewed this far ahead each frame Shift is down; the pose holds it up this long at most. */
const GUARD_REFRESH = 0.1;
const GUARD_HELD = 3600;
/** How many times faster a bodiless player moves with Shift down. */
const CAMERA_RUSH = 3;

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
		let wishX = input.stickX;
		let wishZ = input.stickY;
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
			// A stick short of its rim walks slower.
			wishX /= Math.max(1, len);
			wishZ /= Math.max(1, len);
			this.gameObject.getComponent(Seated)?.stand();
			this.gameObject.getComponent(Reading)?.stop();
		}

		const yaw = cam?.yaw ?? 0;
		const fwd = yawToForward(yaw);
		const rightX = -fwd.z;
		const rightZ = fwd.x;
		const shift = input.key('ShiftLeft') || input.key('ShiftRight');
		const rush = shift && !this.embodied ? CAMERA_RUSH : 1;
		this.moveX = (fwd.x * wishZ + rightX * wishX) * rush;
		this.moveZ = (fwd.z * wishZ + rightZ * wishX) * rush;

		this.lookYaw += input.twist - input.lookDeltaX * YAW_SENS;
		if (cam) {
			// Fingers turning the view hold on to it; only the rest of the look eases in.
			cam.yaw += input.twist;
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

		const seated = this.gameObject.getComponent(Seated);
		const yielded = this.gameObject.getComponent(PlayerPilot)?.consumeYield() === true;
		const tapped = input.pressed(TOUCH_TAP) && !yielded;
		const interacted = (input.pressed('KeyE') || tapped) && this.interact(aimed, tapped);
		const clicked = input.pressed('KeyF') || ((input.pressed(MOUSE_LEFT) || tapped) && !yielded && !interacted);
		const fishingSeat = seated?.resting ? world.findByID(seated.seatID) : undefined;
		if (input.pressed('KeyF') && seated && fishingSeat && !seated.asleep && overWater(fishingSeat)) {
			seated.rod = !seated.rod;
			world.setMessage(seated.rod ? 'casting a line' : 'reeling in');
			return;
		}
		// A sword in hand: Shift holds the guard up; a click stabs on the move, slices standing, cleaves with Shift.
		const weapon = this.heldWeapon();
		const sword = weapon?.Blade ? weapon : null;
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

	/**
	 * Does what's at hand here: gets up, picks up, or works what is aimed at. False when there is nothing to do.
	 * A tap looks things over only with empty hands: what is in hand is for its click.
	 */
	private interact(aimed:GameObject | null, tapped:boolean):boolean {
		const world = this.gameObject.world;
		if (!world) {
			return false;
		}
		const seated = this.gameObject.getComponent(Seated);
		const loot = nearestPickup(this.gameObject);
		if (seated?.resting) {
			seated.stand();
		}
		else if (loot) {
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
		else if (aimed?.getComponent(Furniture)) {
			this.restOn(aimed);
		}
		else if (aimed && !(tapped && this.handItem())) {
			// Anything else aimed at is looked over, as an NPC's `examine` would; long reads stay up longer.
			const seen = examineWorld(aimed);
			world.setMessage(seen, Math.max(3.2, seen.length / 15));
		}
		else {
			return false;
		}
		return true;
	}

	/** Walks to beside `seat` and sits on it or lies down in it, as an NPC would, unless someone already has. With no director to walk it, it settles from where it stands. */
	private restOn(seat:GameObject):void {
		const world = this.gameObject.world;
		const taken = occupantName(seat);
		if (!world || taken) {
			world?.setMessage(`${taken} is there`);
			return;
		}
		const verb = seat.getComponent(Furniture)?.kind === 'bed' ? 'sleep' : 'sit';
		world.enact(`${verb}(target=${seat.id})`).then(
			(result) => {
				if (!result.ok && result.reason) {
					world.setMessage(result.reason);
				}
			},
			() => this.gameObject.getComponent(Seated)?.settle(seat),
		);
	}

	/** The selected item when it is in hand. */
	private handItem():ItemInstance | null {
		const item = this.activeItem();
		return item && itemInHeldSlot(this.gameObject, item) ? item : null;
	}

	/** The selected item when it is a weapon in hand. */
	private heldWeapon():ItemInstance | null {
		const item = this.handItem();
		return item?.Weapon ? item : null;
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

	/** Takes the hotbar's `index`th item in hand, selected, or puts it back; what cannot be held is only selected. */
	public toggleItem(index:number):void {
		const world = this.gameObject.world;
		const item = this.hotbar()[index];
		if (!world || !item || (this.gameObject.getComponent(Vitals)?.hp ?? 1) <= 0) {
			return;
		}
		if (item.Equipable) {
			world.setMessage(toggleHeld(this.gameObject, item, world));
		}
		const kept = !item.Equipable || itemInHeldSlot(this.gameObject, item);
		this.selected = kept ? Math.max(0, this.hotbar().indexOf(item)) : 0;
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
