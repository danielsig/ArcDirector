import { HumanBody, Light, Torch } from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import { slotItem } from './inventory';

export function syncHeldTorchLight(actor:GameObject, dt:number):void {
	if (actor.getComponent(Torch)) {
		return;
	}
	const body = actor.getComponent(HumanBody);
	const light = actor.getComponent(Light);
	if (!body || !light) {
		return;
	}
	const left = slotItem(body, 'hands.left.held');
	const right = slotItem(body, 'hands.right.held');
	const torch = left?.Torch ?? right?.Torch;
	if (!torch?.lit) {
		light.enabled = false;
		return;
	}
	light.enabled = true;
	light.color = 0xff9a4a;
	light.castShadow = true;
	light.range = 9;
	light.intensity = 32 * light.pulse(dt);
	light.decay = 1;
	light.offsetY = 0.5;
	light.offsetZ = 0.3;
	light.offsetX = -0.4;

}
