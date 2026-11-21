import * as THREE from 'three';
import { Component, inBounds, MeshRenderer, type Bounds, type GameObject } from '@arc-director/kindling';
import { Lock, Named, idOf } from '../../engine/components';
import type { DemoWorld } from '../../engine/demo-world';
import { passageWhereabouts } from '../../world/passages';
import { Door } from '../door/door';

/** A named building, or a `room`: the walkable box inside it (walls excluded). */
export class Interior extends Component {
	public bounds:Bounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
	/** A room of a larger place (a crypt hall), not a building with an outdoors around it. */
	public room = false;

	/** A house's roof fades while the player stands under it. */
	public override lateUpdate():void {
		const mesh = this.gameObject.getComponent(MeshRenderer)?.mesh;
		const roof = mesh?.getObjectByName('roof');
		if (!mesh || !roof) {
			return;
		}
		const player = this.gameObject.world?.findByID('Player');
		const hw = mesh.userData.roofHalfW as number;
		const hd = mesh.userData.roofHalfD as number;
		const p = this.gameObject.transform.position;
		const under = !!player
			&& Math.abs(player.transform.position.x - p.x) <= hw
			&& Math.abs(player.transform.position.z - p.z) <= hd;
		roof.traverse((child) => {
			const mat = child instanceof THREE.Mesh ? child.material : undefined;
			if (!mat || Array.isArray(mat)) {
				return;
			}
			mat.transparent = under;
			mat.opacity = under ? 0.08 : 1;
			mat.depthWrite = !under;
		});
	}
}

const DOORWAY = 0.7;

export function enclosureAt(world:DemoWorld, x:number, z:number):GameObject | undefined {
	let hit:GameObject | undefined;
	world.forEachComponent(Interior, (box, go) => {
		if (!hit && inBounds(box.bounds, x, z)) {
			hit = go;
		}
	});
	return hit;
}

export function doorOfBuilding(world:DemoWorld, buildingID:string):GameObject | undefined {
	let hit:GameObject | undefined;
	world.forEachComponent(Door, (door, go) => {
		if (!hit && door.buildingID === buildingID) {
			hit = go;
		}
	});
	return hit;
}

export function buildingOfDoor(doorGo:GameObject):GameObject | undefined {
	const world = doorGo.world;
	const id = doorGo.getComponent(Door)?.buildingID;
	if (!world || !id) {
		return undefined;
	}
	return world.findNamed(id) ?? world.findByID(id);
}

/** +1 if +axis points toward the interior, −1 if the other way, 0 if unknown. */
export function doorInteriorAlong(doorGo:GameObject):number {
	const door = doorGo.getComponent(Door);
	const building = buildingOfDoor(doorGo);
	const box = building?.getComponent(Interior);
	if (!door || !box) {
		return 0;
	}
	const t = doorGo.transform.position;
	const cx = (box.bounds.minX + box.bounds.maxX) * 0.5;
	const cz = (box.bounds.minZ + box.bounds.maxZ) * 0.5;
	const side = door.axis === 'x' ? cx - t.x : cz - t.z;
	if (Math.abs(side) < 1e-4) {
		return 0;
	}
	return side > 0 ? 1 : -1;
}

export function nearestDoorway(world:DemoWorld, x:number, z:number, range = DOORWAY):GameObject | undefined {
	let best:GameObject | undefined;
	let bestD = range;
	world.forEachComponent(Door, (door, go) => {
		const p = go.transform.position;
		const d = Math.hypot(p.x - x, p.z - z);
		if (d < bestD) {
			bestD = d;
			best = go;
		}
	});
	return best;
}

/** Whether the world has any interior, or with `buildingsOnly`, any building (rooms aside). */
function hasInterior(world:DemoWorld, buildingsOnly = false):boolean {
	let any = false;
	world.forEachComponent(Interior, (box) => {
		any ||= !buildingsOnly || !box.room;
	});
	return any;
}

function doorStatus(doorGo:GameObject):string {
	const lock = doorGo.getComponent(Lock);
	const door = doorGo.getComponent(Door);
	if (door?.open) {
		return 'open';
	}
	if (lock?.locked) {
		return 'shut and locked';
	}
	if (door) {
		return 'shut';
	}
	return 'the doorway';
}

/** English line for the think prompt. Empty when the scene has no interiors, and between rooms. */
export function whereabouts(character:GameObject):string {
	const world = character.world;
	if (!world || !hasInterior(world)) {
		return '';
	}
	const p = character.transform.position;
	const inside = enclosureAt(world, p.x, p.z);
	if (inside) {
		const name = idOf(inside);
		if (inside.getComponent(Interior)?.room) {
			return `You are in ${name}.`;
		}
		const door = doorOfBuilding(world, name);
		const way = door ? idOf(door) : 'the door';
		return `You are inside ${name}. You are not outdoors. Do not walk through ${way} unless you mean to leave.`;
	}
	// Between the rooms of a place: which passage, where it leads, and the doors on it.
	const passage = passageWhereabouts(world, p.x, p.z);
	if (passage) {
		return passage;
	}
	const door = nearestDoorway(world, p.x, p.z);
	if (door) {
		const dname = idOf(door);
		const building = door.getComponent(Door)?.buildingID;
		const status = doorStatus(door);
		if (building) {
			return `You are in the ${dname} doorway, not inside ${building} yet. ${dname} is ${status}. Inside is ${building}, not this doorway. The other side is outdoors.`;
		}
		return `You are in the ${dname} doorway. ${dname} is ${status}.`;
	}
	// Between rooms is not outdoors.
	if (!hasInterior(world, true)) {
		return '';
	}
	let near:GameObject | undefined;
	let nearD = 14;
	world.forEachComponent(Interior, (box, go) => {
		if (box.room) {
			return;
		}
		const cx = (box.bounds.minX + box.bounds.maxX) * 0.5;
		const cz = (box.bounds.minZ + box.bounds.maxZ) * 0.5;
		const d = Math.hypot(cx - p.x, cz - p.z);
		if (d < nearD) {
			nearD = d;
			near = go;
		}
	});
	if (near) {
		const name = idOf(near);
		const way = doorOfBuilding(world, name);
		if (way) {
			const doorName = idOf(way);
			return `You are outdoors, outside ${name}. You are not inside ${name}. ${doorName} is ${doorStatus(way)}. Standing at ${doorName} is still outdoors.`;
		}
		return `You are outdoors, outside ${name}. You are not inside ${name}.`;
	}
	return 'You are outdoors.';
}
