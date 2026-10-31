import { addEffect, shockwave } from '@arc-director/kindling';
import * as THREE from 'three';
import { addSprite, glowSprite, healGlint, middleOf, sparkle, type Stance } from './spellFx';

/**
 * What it looks like when a mind calls a tool, on whoever it thinks for: a sonar ring for a look round,
 * rings going out from the ear for listening, a memory turning over the head, and a map to hold up.
 */

/** A turning swirl of memory: how far over the head (m), how big (m), how fast it turns (radians/s), its sparkles per second. */
const SWIRL_LIFT = 0.45;
const SWIRL_SIZE = 1.1;
const SWIRL_SPIN = 2.4;
const SWIRL_SPARKLES = 7;
const MEMORY = 0xc9a6ff;
const LOOKUP = 0xe9c46a;
/** A look round: how many sonar rings, how far apart (s), and how each looks. */
const SWEEPS = 2;
const SWEEP_GAP = 0.45;
const SWEEP = { radius: 5, width: 0.14, life: 1.1, color: 0xbfe6ff };
/** Listening: how many rings out from the head, how far apart (s), how long each lives (s), how big it gets (m), and their colour. */
const LISTENS = 4;
const LISTEN_GAP = 0.5;
const LISTEN_LIFE = 0.9;
const LISTEN_SIZE = 2;
const LISTEN = 0x9fffd0;
/** How long the swirl takes to come and go (s). */
const FADE = 0.3;

/** The map: its size (m), and how much it bows (m). */
const MAP_SIZE:[number, number] = [0.5, 0.36];
const MAP_BOW = 0.06;

/** A rough route on old parchment, ending in a red cross: every map any character holds. */
function mapPicture():THREE.CanvasTexture {
	const canvas = document.createElement('canvas');
	canvas.width = 256;
	canvas.height = 180;
	const draw = canvas.getContext('2d')!;
	draw.fillStyle = '#f4e7c5';
	draw.fillRect(0, 0, 256, 180);
	draw.strokeStyle = '#5a3a20';
	draw.lineWidth = 8;
	draw.strokeRect(4, 4, 248, 172);
	draw.fillStyle = '#e8d4a4';
	draw.beginPath();
	draw.ellipse(70, 120, 46, 30, 0.3, 0, Math.PI * 2);
	draw.fill();
	draw.beginPath();
	draw.ellipse(190, 60, 40, 26, -0.2, 0, Math.PI * 2);
	draw.fill();
	draw.setLineDash([10, 9]);
	draw.lineWidth = 6;
	draw.beginPath();
	draw.moveTo(34, 146);
	draw.bezierCurveTo(100, 60, 130, 150, 188, 62);
	draw.stroke();
	draw.setLineDash([]);
	draw.strokeStyle = '#c8432f';
	draw.lineWidth = 9;
	draw.beginPath();
	draw.moveTo(174, 48);
	draw.lineTo(202, 76);
	draw.moveTo(202, 48);
	draw.lineTo(174, 76);
	draw.stroke();
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;
}

let mapTexture:THREE.CanvasTexture | null = null;

/** Where a held map is this frame: the palm holding it, the eyes reading it, how far out it is (0–1); null once it is put away. */
export type MapHold = { palm:THREE.Vector3; eyes:THREE.Vector3; weight:number } | null;

/** A map held in the palm and read from the eyes `hold` says, unrolling as it comes up and rolling back up as it goes. */
export function heldMap(scene:THREE.Object3D, hold:()=>MapHold):void {
	const geometry = new THREE.PlaneGeometry(MAP_SIZE[0], MAP_SIZE[1], 10, 1);
	const place = geometry.getAttribute('position') as THREE.BufferAttribute;
	for (let i = 0; i < place.count; i += 1) {
		// Bowed across, as parchment held in one hand is.
		const x = place.getX(i) / MAP_SIZE[0];
		place.setZ(i, MAP_BOW * (1 - 4 * x * x));
	}
	const material = new THREE.MeshBasicMaterial({ map: mapTexture ??= mapPicture(), side: THREE.DoubleSide, toneMapped: false });
	const map = new THREE.Mesh(geometry, material);
	map.visible = false;
	addEffect(scene, map, () => {
		const now = hold();
		if (!now) {
			return false;
		}
		map.visible = now.weight > 0.02;
		map.position.copy(now.palm);
		map.lookAt(now.eyes);
		map.scale.set(Math.max(0.05, now.weight), 1, 1);
		return true;
	}, () => {
		geometry.dispose();
		material.dispose();
	});
}

/** Sonar rings racing out across the ground from the feet of `body`, one after another. */
function sweeping(scene:THREE.Object3D, body:()=>Stance | null):void {
	let swept = 0;
	addEffect(scene, new THREE.Object3D(), (age) => {
		const stance = body();
		for (; stance && swept < SWEEPS && swept * SWEEP_GAP <= age; swept += 1) {
			shockwave(scene, stance.feet, SWEEP);
		}
		return !!stance && swept < SWEEPS;
	}, () => {});
}

/** Rings going out from the head of `body`, one after another, flat to the eye. */
function listening(scene:THREE.Object3D, body:()=>Stance | null):void {
	for (let i = 0; i < LISTENS; i += 1) {
		const ring = glowSprite('ring', LISTEN);
		addSprite(scene, ring, (age) => {
			const t = age - i * LISTEN_GAP;
			const stance = body();
			if (t >= LISTEN_LIFE || !stance) {
				return false;
			}
			const u = Math.max(0, t) / LISTEN_LIFE;
			ring.visible = t >= 0;
			ring.position.copy(stance.feet).setY(stance.feet.y + stance.height * 0.92);
			ring.scale.setScalar(Math.max(0.01, LISTEN_SIZE * (0.2 + 0.8 * u)));
			ring.material.opacity = 1 - u;
			return true;
		});
	}
}

/** A swirl in `color` turning over the head of `body` for `seconds`, shedding sparkles. */
function swirl(scene:THREE.Object3D, body:()=>Stance | null, seconds:number, color:number):void {
	const sprite = glowSprite('swirl', color);
	let shed = 0;
	addSprite(scene, sprite, (age) => {
		const stance = body();
		if (age >= seconds || !stance) {
			return false;
		}
		sprite.visible = true;
		sprite.position.copy(stance.feet).setY(stance.feet.y + stance.height + SWIRL_LIFT);
		sprite.scale.setScalar(SWIRL_SIZE);
		sprite.material.rotation = age * SWIRL_SPIN;
		sprite.material.opacity = Math.min(1, age / FADE, (seconds - age) / FADE);
		for (; shed < age * SWIRL_SPARKLES; shed += 1) {
			sparkle(scene, sprite.position.clone());
		}
		return true;
	});
}

/** The light that shows `tool` being called by `body`, for `seconds`. */
export function toolFx(scene:THREE.Object3D, tool:string, body:()=>Stance | null, seconds:number):void {
	const stance = body();
	if (!stance) {
		return;
	}
	if (tool === 'see_map') {
		healGlint(scene, middleOf(stance));
	}
	else if (tool === 'observe') {
		sweeping(scene, body);
	}
	else if (tool === 'earshot') {
		listening(scene, body);
	}
	else {
		swirl(scene, body, seconds, tool === 'recall' ? MEMORY : LOOKUP);
	}
}
