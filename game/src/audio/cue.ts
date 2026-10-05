import type { GameObject } from '../engine/GameObject';
import type { World } from '../engine/World';
import { SFX, type SfxName } from './sfx';

type CueExtra = { gain?:number; freq?:number; freqTo?:number; dur?:number };

export function cue(world:World, name:SfxName, point?:{ x:number; y?:number; z:number }, extra?:CueExtra):void {
	world.audio.playSfx(SFX[name], {
		x: point?.x,
		y: point?.y,
		z: point?.z,
		gain: extra?.gain,
		freq: extra?.freq,
		freqTo: extra?.freqTo,
		dur: extra?.dur,
	});
}

export function cueAt(world:World | null | undefined, name:SfxName, go:GameObject, extra?:CueExtra):void {
	if (!world) {
		return;
	}
	const p = go.transform.position;
	cue(world, name, { x: p.x, y: p.y, z: p.z }, extra);
}

export function talkHz(id:string):number {
	let h = 2166136261;
	for (let i = 0; i < id.length; i++) {
		h ^= id.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return 130 + (h >>> 0) % 90;
}

export function talkDur(text:string):number {
	const words = text.trim().split(/\s+/).filter(Boolean).length;
	return Math.min(2.2, 0.32 + words * 0.16);
}

export function talkAsks(text:string):boolean {
	return /\?[?!]*\s*$/.test(text.trim());
}

export function stepKind(def:string | undefined):'stepStone' | 'stepDirt' | 'stepWood' {
	if (def === 'grass' || def === 'dirt' || def === 'path' || def === 'sand') {
		return 'stepDirt';
	}
	if (def === 'plank' || def === 'wood' || def === 'wood_wall' || def === 'bridge') {
		return 'stepWood';
	}
	return 'stepStone';
}
