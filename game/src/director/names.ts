import { Named, Vitals } from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';

export function idOf(go:GameObject):string {
	return go.getComponent(Named)?.id ?? go.id;
}

export function findObject(world:World, name:string):GameObject | undefined {
	return world.findNamed(name) ?? world.findByID(name);
}

/** No vitals counts as living (non-combat characters and objects). HP 0 is down. */
export function isLiving(go:GameObject | undefined):go is GameObject {
	return !!go && (go.getComponent(Vitals)?.hp ?? 1) > 0;
}
