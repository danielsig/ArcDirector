import { afterimage, puff, puffPicture, shockwave, starburst } from '@arc-director/kindling';
import * as THREE from 'three';

/**
 * Fight effects any blow can leave, built from Kindling's effect primitives: the starburst where a
 * blow lands, dust kicked up by feet, blades and falls, the shockwave of a heavy blow, and the ghost a
 * lunge leaves behind.
 */

/** The starburst where a blow lands: white spikes, inked behind so they read on light ground. */
const BURST = { spikes: 18, length: [0.25, 0.8] as [number, number], out: 0.06, life: 0.32, color: 0xffffff, ink: 0x241a14 };
/** Dust colors, middle to rim. */
const DUST_COLORS:[string, string, string] = ['#a88a64', '#8c6e4b', '#5e4630'];
/**
 * Dust: puffs per kick, per blade line and per fall, the arc behind the feet a kick fans across
 * (radians), how far puffs billow out (m), how long one lives (s) and the share of that it stays thick
 * before it slowly thins away, its size from birth to end (m), and how much it spins and curls on the
 * way (radians).
 */
const DUST_PUFFS = 12;
const DUST_LINE_PUFFS = 10;
const DUST_FALL_PUFFS = 14;
const DUST_ARC = 2.3;
const DUST_REACH:[number, number] = [0.3, 0.7];
const DUST_LIFE = 0.9;
const DUST_THICK = 0.2;
const DUST_SIZE:[number, number] = [0.15, 0.55];
const DUST_SPIN = 2.5;
const DUST_CURL = 0.45;
/** A heavy blow's shockwave on the ground, and a fall's. */
const HEAVY_WAVE = { radius: 1.8, width: 0.22, life: 0.35, color: 0xfff6e0 };
const FALL_WAVE = { radius: 1.2, width: 0.12, life: 0.4, color: 0xe8dcc4 };
/** A lunge's ghost: pale, half see-through, gone in a blink. */
const GHOST = { color: 0xcfe2ff, opacity: 0.45, life: 0.22 };

/** A white starburst where a blow lands, at `at` (world). */
export function impactBurst(scene:THREE.Object3D, at:THREE.Vector3):void {
	starburst(scene, at, BURST);
}

/**
 * One thick dust puff from `from` (world, on the ground), billowing out along the flat `heading`
 * (radians round Y, 0 toward +X), `scale` times as big and far.
 */
function dustPuff(scene:THREE.Object3D, from:THREE.Vector3, heading:number, scale = 1):void {
	const end = THREE.MathUtils.lerp(DUST_SIZE[0], DUST_SIZE[1], 0.5 + 0.5 * Math.random()) * scale;
	puff(scene, from, heading, {
		map: puffPicture(DUST_COLORS),
		reach: THREE.MathUtils.lerp(DUST_REACH[0], DUST_REACH[1], Math.random()) * scale,
		rise: 0.04 + 0.1 * Math.random(),
		size: [DUST_SIZE[0] * scale, end],
		life: DUST_LIFE,
		thick: DUST_THICK,
		spin: DUST_SPIN * (Math.random() < 0.5 ? -1 : 1) * (0.6 + 0.4 * Math.random()),
		curl: DUST_CURL * (Math.random() < 0.5 ? -1 : 1) * (0.5 + 0.5 * Math.random()),
		delay: 0.04 * Math.random(),
	});
}

/**
 * Dust kicked up from the feet at `at` (world, on the ground): puffs fanned across an `arc` (radians;
 * a full turn rings the feet) centered on `away` (flat), `scale` times as big.
 */
export function dustKick(scene:THREE.Object3D, at:THREE.Vector3, away:THREE.Vector3, arc = DUST_ARC, scale = 1):void {
	const base = Math.atan2(away.z, away.x);
	const puffs = Math.round(DUST_PUFFS * Math.min(1.5, arc / DUST_ARC));
	for (let i = 0; i < puffs; i++) {
		// Spread evenly across the arc, a little jittered.
		dustPuff(scene, at, base + arc * ((i + 0.5 + (Math.random() - 0.5) * 0.6) / puffs - 0.5), scale);
	}
}

/**
 * Dust thrown up along the ground under a blade that strikes down to it, from `a` to `b` (world, on
 * the ground): puffs all along the line, billowing out to either side of it.
 */
export function dustLine(scene:THREE.Object3D, a:THREE.Vector3, b:THREE.Vector3):void {
	const along = Math.atan2(b.z - a.z, b.x - a.x);
	for (let i = 0; i < DUST_LINE_PUFFS; i++) {
		const from = a.clone().lerp(b, (i + Math.random()) / DUST_LINE_PUFFS);
		const side = i % 2 === 0 ? 1 : -1;
		dustPuff(scene, from, along + side * (Math.PI / 2 + (Math.random() - 0.5) * 0.9));
	}
}

/** A heavy blow landing on someone standing at `feet`: a shockwave out across the ground under them. */
export function heavyWave(scene:THREE.Object3D, feet:THREE.Vector3):void {
	shockwave(scene, feet, HEAVY_WAVE);
}

/** Someone hitting the ground at `feet`: a ring of dust all round, and a low shockwave. */
export function fallDust(scene:THREE.Object3D, feet:THREE.Vector3):void {
	for (let i = 0; i < DUST_FALL_PUFFS; i++) {
		dustPuff(scene, feet, (i / DUST_FALL_PUFFS) * Math.PI * 2 + Math.random() * 0.4, 1.3);
	}
	shockwave(scene, feet, FALL_WAVE);
}

/** A ghost of `model` where it is now, left behind by a lunge. */
export function lungeGhost(scene:THREE.Object3D, model:THREE.Object3D):void {
	afterimage(scene, model, GHOST);
}
