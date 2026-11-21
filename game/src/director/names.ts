import { type GameObject } from '@arc-director/kindling';
import { Named, Vitals } from '../engine/components';
import type { DemoWorld } from '../engine/demo-world';

export function findObject(world:DemoWorld, name:string):GameObject | undefined {
	return world.findNamed(name) ?? world.findByID(name);
}

/** `A`, `A and B`, `A, B and C`, or `none` for no names. */
export function nameList(names:readonly string[], none = ''):string {
	return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? none;
}

/** No vitals counts as living (non-combat characters and objects). HP 0 is down. */
export function isLiving(go:GameObject | undefined):go is GameObject {
	return !!go && (go.getComponent(Vitals)?.hp ?? 1) > 0;
}
