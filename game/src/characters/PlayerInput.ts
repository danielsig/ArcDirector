import { Camera, Chest, Door, HumanBody, Appearance, Named, type BodySlot } from '../engine/components';
import { Component } from '../engine/Component';
import { Order } from '../engine/order';
import { yawToForward } from '../engine/math';
import { aimTarget } from './aim';
import { carryBags, slotItem } from '../items/inventory';
import type { ItemInstance } from '../items/instance';
import { swapHeldHands } from '../items/equip';
import { dropItem, interactChest, interactDoor, nearestPickup, pickup } from '../items/pickup';
import { useItem } from '../items/use';
import { PlayerPilot } from './PlayerPilot';

const YAW_SENS = 0.0024;

export class PlayerInput extends Component {
	public static override order = Order.playerInput;
	public moveX = 0;
	public moveZ = 0;
	public lookYaw = 0;
	public selected = 0;
	public cursorName = '';

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
					this.gameObject.getComponent(Appearance)?.playClip('take', world.time, loot);
					world.pickedUp(this.gameObject, lootName);
				}
			}
			else if (aimed?.getComponent(Chest)) {
				const msg = interactChest(this.gameObject, aimed);
				world.setMessage(msg);
				if (msg.startsWith('took ')) {
					this.gameObject.getComponent(Appearance)?.playClip('take', world.time, aimed);
				}
			}
			else if (aimed?.getComponent(Door)) {
				world.setMessage(interactDoor(this.gameObject, aimed));
			}
		}

		const yielded = this.gameObject.getComponent(PlayerPilot)?.consumeYield() === true;
		if (input.pressed('KeyF') || (input.justClick && !yielded)) {
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
			this.gameObject.getComponent(Appearance)?.playClip('take', world.time);
		}
		if (input.pressed('KeyY')) {
			this.gameObject.getComponent(Appearance)?.playClip('give', world.time);
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
