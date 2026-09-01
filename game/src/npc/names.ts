import { Named } from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';

export function bodyName(go:GameObject):string {
	return go.getComponent(Named)?.id ?? go.id;
}

export function findBody(world:World, name:string):GameObject | undefined {
	return world.findNamed(name) ?? world.findByID(name);
}
