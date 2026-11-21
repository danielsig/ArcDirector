import { AudioSource, Speaker, type SfxHandle, type SfxPatch, type GameObject, type XZ } from '@arc-director/kindling';
import type { DemoWorld } from '../engine/demo-world';
import { CELL_SIZE } from '../world/constants';
import { allRoadCells } from '../kit/houses/roads';
import { SFX, type SfxName } from './sfx';

/** One take of `sound`, a shared one by name or a thing's own patch (a random take, if it has several). */
function take(sound:SfxName | SfxPatch):SfxPatch {
	const patch:SfxPatch | readonly SfxPatch[] = typeof sound === 'string' ? SFX[sound] : sound;
	return 'layers' in patch ? patch : patch[Math.floor(Math.random() * patch.length)]!;
}

/**
 * Play a sound effect at `go` (a random take, if it has several), optionally louder or softer, or
 * cut to `dur` s (every layer). Through `go`'s `AudioSource` when it has one (characters do: their
 * `Speaker`), so a disabled source keeps it silent. Returns a handle to stop it early, or null when it is not playing.
 */
export function cueAt(world:DemoWorld | null | undefined, name:SfxName | SfxPatch, go:GameObject, gain?:number, dur?:number):SfxHandle | null {
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
export function cueVoice(world:DemoWorld | null | undefined, name:SfxName, go:GameObject):void {
	const speaker = go.getComponent(Speaker);
	if (world && speaker) {
		const ratio = speaker.pitch / VOICED_AT;
		speaker.play(take(name), { pitch: ratio < 1 ? ratio ** DEEPEN : ratio, tract: Math.min(1, ratio ** THROAT) });
		return;
	}
	cueAt(world, name, go);
}

/** Play a sound effect at the point `at` (world), as {@link cueAt} does at an object. */
export function cueAtPoint(world:DemoWorld | null | undefined, name:SfxName | SfxPatch, at:{ x:number; y:number; z:number }, gain?:number, dur?:number):SfxHandle | null {
	return world?.audio.playSfx(take(name), { x: at.x, y: at.y, z: at.z, gain, dur }) ?? null;
}

const roads = new WeakMap<DemoWorld, XZ[]>();

/** Whether `x`, `z` is on a cobbled road from a house door: dressing drawn over grass, planned in `dressing-plan.ts`. */
function onRoad(world:DemoWorld, x:number, z:number):boolean {
	let cells = roads.get(world);
	if (!cells) {
		cells = allRoadCells(world.terrain);
		roads.set(world, cells);
	}
	return cells.some((c) => Math.abs(c.x - x) <= CELL_SIZE / 2 && Math.abs(c.z - z) <= CELL_SIZE / 2);
}

/** The footstep at `x`, `z`. The cobbled road is stone; walkable water is a bridge span, so it sounds like wood. */
export function stepKind(world:DemoWorld, x:number, z:number):'stepStone' | 'stepGrass' | 'stepWood' {
	if (onRoad(world, x, z)) {
		return 'stepStone';
	}
	const surface = world.terrain.tileAtWorld(x, z)?.surface;
	if (surface === 'meadow' || surface === 'forest' || surface === 'trail') {
		return 'stepGrass';
	}
	if (surface === 'wood' || surface === 'water') {
		return 'stepWood';
	}
	return 'stepStone';
}
