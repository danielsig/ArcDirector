import type { SfxPatch } from '@arc-director/kindling';
import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';
import { CELL_SIZE } from '../world/constants';
import { findDoor, roadCells } from '../world/dressingPlan';
import { SFX, type SfxName } from './sfx';

/** Play a sound effect at `go` (a random take, if it has several), optionally louder or softer. */
export function cueAt(world:World | null | undefined, name:SfxName, go:GameObject, gain?:number):void {
	if (!world) {
		return;
	}
	const sound:SfxPatch | readonly SfxPatch[] = SFX[name];
	const patch = 'layers' in sound ? sound : sound[Math.floor(Math.random() * sound.length)]!;
	const p = go.transform.position;
	world.audio.playSfx(patch, { x: p.x, y: p.y, z: p.z, gain });
}

const roads = new WeakMap<World, { x:number; z:number }[]>();

/** Whether `x`, `z` is on the cobbled road from the cottage door: dressing drawn over grass, planned in `dressingPlan`. */
function onRoad(world:World, x:number, z:number):boolean {
	let cells = roads.get(world);
	if (!cells) {
		const chunks = [...world.chunks.values()];
		const door = findDoor(chunks);
		cells = door ? roadCells(chunks, door) : [];
		roads.set(world, cells);
	}
	return cells.some((c) => Math.abs(c.x - x) <= CELL_SIZE / 2 && Math.abs(c.z - z) <= CELL_SIZE / 2);
}

/** The footstep at `x`, `z`. The cobbled road is stone; walkable water is a bridge span, so it sounds like wood. */
export function stepKind(world:World, x:number, z:number):'stepStone' | 'stepGrass' | 'stepWood' {
	if (onRoad(world, x, z)) {
		return 'stepStone';
	}
	const def = world.tileAtWorld(x, z)?.def;
	if (def === 'grass' || def === 'dirt' || def === 'path' || def === 'sand') {
		return 'stepGrass';
	}
	if (def === 'plank' || def === 'wood' || def === 'wood_wall' || def === 'bridge' || def === 'water') {
		return 'stepWood';
	}
	return 'stepStone';
}
