import { Door, Interior, Lock, Named } from '../engine/components';
import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';
import { CELL_SIZE } from './constants';
import type { Chunk } from './Chunk';

const DOORWAY = 0.7;

export function interiorContains(box:Interior, x:number, z:number):boolean {
	return x >= box.minX && x < box.maxX && z >= box.minZ && z < box.maxZ;
}

export function innerWallAABB(
	chunk:Chunk,
	minLX:number,
	maxLX:number,
	minLZ:number,
	maxLZ:number,
):{ minX:number; maxX:number; minZ:number; maxZ:number } {
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	return {
		minX: ox + (minLX + 1) * CELL_SIZE,
		maxX: ox + maxLX * CELL_SIZE,
		minZ: oz + (minLZ + 1) * CELL_SIZE,
		maxZ: oz + maxLZ * CELL_SIZE,
	};
}

export function enclosureAt(world:World, x:number, z:number):GameObject | undefined {
	let hit:GameObject | undefined;
	world.forEachComponent(Interior, (box, go) => {
		if (!hit && interiorContains(box, x, z)) {
			hit = go;
		}
	});
	return hit;
}

export function doorOfBuilding(world:World, buildingID:string):GameObject | undefined {
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
	const cx = (box.minX + box.maxX) * 0.5;
	const cz = (box.minZ + box.maxZ) * 0.5;
	const side = door.axis === 'x' ? cx - t.x : cz - t.z;
	if (Math.abs(side) < 1e-4) {
		return 0;
	}
	return side > 0 ? 1 : -1;
}

export function nearestDoorway(world:World, x:number, z:number, range = DOORWAY):GameObject | undefined {
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

function hasInterior(world:World):boolean {
	let any = false;
	world.forEachComponent(Interior, () => {
		any = true;
	});
	return any;
}

function namedOf(go:GameObject):string {
	return go.getComponent(Named)?.id ?? go.id;
}

function doorStatus(doorGo:GameObject):string {
	const lock = doorGo.getComponent(Lock);
	const door = doorGo.getComponent(Door);
	if (lock?.locked) {
		return 'shut and locked';
	}
	if (door && !door.open) {
		return 'shut';
	}
	if (door?.open) {
		return 'open';
	}
	return 'the doorway';
}

/** English line for the think prompt. Empty when the scene has no interiors. */
export function whereabouts(character:GameObject):string {
	const world = character.world;
	if (!world || !hasInterior(world)) {
		return '';
	}
	const p = character.transform.position;
	const inside = enclosureAt(world, p.x, p.z);
	if (inside) {
		const name = namedOf(inside);
		const door = doorOfBuilding(world, name);
		const way = door ? namedOf(door) : 'the door';
		return `You are inside ${name}. You are not outdoors. Do not walk through ${way} unless you mean to leave.`;
	}
	const door = nearestDoorway(world, p.x, p.z);
	if (door) {
		const dname = namedOf(door);
		const building = door.getComponent(Door)?.buildingID;
		const status = doorStatus(door);
		if (building) {
			return `You are in the ${dname} doorway, not inside ${building} yet. ${dname} is ${status}. Inside is ${building}, not this doorway. The other side is outdoors.`;
		}
		return `You are in the ${dname} doorway. ${dname} is ${status}.`;
	}
	let near:GameObject | undefined;
	let nearD = 14;
	world.forEachComponent(Interior, (box, go) => {
		const cx = (box.minX + box.maxX) * 0.5;
		const cz = (box.minZ + box.maxZ) * 0.5;
		const d = Math.hypot(cx - p.x, cz - p.z);
		if (d < nearD) {
			nearD = d;
			near = go;
		}
	});
	if (near) {
		const name = namedOf(near);
		const way = doorOfBuilding(world, name);
		if (way) {
			const doorName = namedOf(way);
			return `You are outdoors, outside ${name}. You are not inside ${name}. ${doorName} is ${doorStatus(way)}. Standing at ${doorName} is still outdoors.`;
		}
		return `You are outdoors, outside ${name}. You are not inside ${name}.`;
	}
	return 'You are outdoors.';
}
