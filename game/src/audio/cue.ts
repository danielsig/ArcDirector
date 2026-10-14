import { AudioSource, Speaker, type SfxHandle, type SfxPatch, type GameObject } from '@arc-director/kindling';
import type { World } from '../engine/World';
import { CELL_SIZE } from '../world/constants';
import { findDoor, roadCells } from '../world/dressingPlan';
import { SFX, type SfxName } from './sfx';

/** One take of `name` (a random one, if it has several). */
function take(name:SfxName):SfxPatch {
	const sound:SfxPatch | readonly SfxPatch[] = SFX[name];
	return 'layers' in sound ? sound : sound[Math.floor(Math.random() * sound.length)]!;
}

/**
 * Play a sound effect at `go` (a random take, if it has several), optionally louder or softer, or
 * cut to `dur` s (every layer). Through `go`'s `AudioSource` when it has one (characters do: their
 * `Speaker`), so a disabled source keeps it silent. Returns a handle to stop it early, or null when it is not playing.
 */
export function cueAt(world:World | null | undefined, name:SfxName, go:GameObject, gain?:number, dur?:number):SfxHandle | null {
	if (!world) {
		return null;
	}
	const source = go.getComponent(AudioSource);
	if (source) {
		return source.play(take(name), { gain, dur });
	}
	return cueAtPoint(world, name, go.transform.position, gain, dur);
}

/**
 * The speaking pitch (Hz) voice sounds (`hurt`, `deathCry`) are made for; a speaker's own pitch
 * scales them from it. Below it, the cry drops faster than the speech does (`DEEPEN`), and the
 * throat grows (`THROAT`): a man's cry is low and big, not a woman's played slow.
 */
const VOICED_AT = 360;
const DEEPEN = 1.12;
const THROAT = 0.2;

/** Play a voice sound (a cry of pain) from `go` in its own voice: lower and from a bigger throat for a low speaker. */
export function cueVoice(world:World | null | undefined, name:SfxName, go:GameObject):void {
	const speaker = go.getComponent(Speaker);
	if (world && speaker) {
		const ratio = speaker.pitch / VOICED_AT;
		speaker.play(take(name), { pitch: ratio < 1 ? ratio ** DEEPEN : ratio, tract: Math.min(1, ratio ** THROAT) });
		return;
	}
	cueAt(world, name, go);
}

/** Play a sound effect at the point `at` (world), as {@link cueAt} does at an object. */
export function cueAtPoint(world:World | null | undefined, name:SfxName, at:{ x:number; y:number; z:number }, gain?:number, dur?:number):SfxHandle | null {
	return world?.audio.playSfx(take(name), { x: at.x, y: at.y, z: at.z, gain, dur }) ?? null;
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
