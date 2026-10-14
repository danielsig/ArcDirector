import { type GameObject } from '@arc-director/kindling';
import { HumanBody, Light, Torch } from '../engine/components';
import { slotItem } from './inventory';

export function syncHeldTorchLight(character:GameObject, dt:number):void {
	if (character.getComponent(Torch)) {
		return;
	}
	const human = character.getComponent(HumanBody);
	const light = character.getComponent(Light);
	if (!human || !light) {
		return;
	}
	const left = slotItem(human, 'hands.left.held');
	const right = slotItem(human, 'hands.right.held');
	const rightLit = right?.Torch?.lit === true;
	const leftLit = left?.Torch?.lit === true;
	if (!rightLit && !leftLit) {
		light.enabled = false;
		return;
	}
	light.enabled = true;
	light.color = 0xff9a4a;
	light.castShadow = true;
	light.range = 9;
	light.intensity = 32 * light.pulse(dt);
	light.decay = 1;
	/** Host-local +X is body-right. */
	light.offsetX = rightLit ? 0.4 : -0.4;
	light.offsetY = 0.5;
	light.offsetZ = 0.3;
}
