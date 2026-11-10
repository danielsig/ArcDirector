import { addEffect, effectMaterial, shockwave } from '@arc-director/kindling';
import * as THREE from 'three';
import type { GoalColor } from '../ui/hudModel';
import { glowSprite, middleOf, runeCircle, sparkle, type Stance } from './spellFx';

/**
 * An order on its way: a ribbon of the order's own Arc text flying from whoever gave it to whoever
 * takes it along an arc, in the side's color, and the magic circle and sparkles it lands in. Built
 * from Kindling's effects and the spell pictures.
 */

/** A side's color in the world, as the HUD draws it (`.hue-*`). */
const HUES:Record<GoalColor, number> = { gold: 0xe9c46a, blue: 0x6cb8ff, red: 0xf07a5c };

/**
 * The flight: how fast (m/s) within how long (s); how high the arc rises for each meter it spans and
 * at least (m); how wide the ribbon is (m), how long it draws out behind its head (m, at most half the
 * arc), and how long its tail takes to arrive after the head has landed (s).
 */
const SPEED = 24;
const SECONDS:[number, number] = [0.3, 0.6];
const RISE = 0.28;
const RISE_MIN = 1.2;
const RIBBON_WIDTH = 0.42;
const RIBBON_LENGTH = 7;
const TAIL_ARRIVES = 0.12;
/** The light at the ribbon's head: the spikes' size and turn (m, radians/s), and the glow round them (m, how opaque). */
const HEAD_SPIKES = 0.55;
const HEAD_SPIN = 7;
const HEAD_GLOW = 0.8;
const HEAD_GLOW_OPACITY = 0.45;
/** The landing: how long its circle stays open (s), its sparkles, and the ring across the ground. */
const LAND_CIRCLE = 0.2;
const LAND_SPARKLES = 6;
const LAND_WAVE = { radius: 1.1, width: 0.1, life: 0.28 };

/** The ribbon's text: its picture's height and font size (px), and the most of it the picture holds. */
const TEXT_HEIGHT = 64;
const TEXT_FONT = 44;
const TEXT_WIDTH = 2048;

// One strip along the arc from uA to uB, uLift high in the middle, drawn flat to the eye between
// uTail and uHead (shares of the way). aCorner is (0 at the tail … 1 at the head, −1 / +1 across).
const RIBBON_VERTEX = `
uniform vec3 uA;
uniform vec3 uB;
uniform float uLift;
uniform float uHead;
uniform float uTail;
uniform float uWidth;
attribute vec2 aCorner;
varying vec2 vRibbon;
varying float vLeftward;
vec3 along(float t) {
	vec3 p = mix(uA, uB, t);
	p.y += uLift * 4.0 * t * (1.0 - t);
	return p;
}
void main() {
	float t = mix(uTail, uHead, aCorner.x);
	vec4 here = viewMatrix * vec4(along(t), 1.0);
	vec4 ahead = viewMatrix * vec4(along(t + 0.01), 1.0);
	vec2 way = ahead.xy - here.xy;
	vec2 side = length(way) > 1e-5 ? normalize(vec2(-way.y, way.x)) : vec2(0.0, 1.0);
	here.xy += side * aCorner.y * uWidth * 0.5;
	vRibbon = aCorner;
	// Text always reads left to right and upright, whichever way across the screen it flies.
	vLeftward = (viewMatrix * vec4(uB, 1.0)).x < (viewMatrix * vec4(uA, 1.0)).x ? 1.0 : 0.0;
	gl_Position = projectionMatrix * here;
}
`;

// Cel look, hard edges: an ink line, a band of the side's color, and the Arc in pale ink on it,
// the head end carrying the end of the text when it flies right and the start when it flies left.
const RIBBON_FRAGMENT = `
uniform sampler2D uText;
uniform vec3 uColor;
uniform float uShown;
uniform float uFade;
varying vec2 vRibbon;
varying float vLeftward;
void main() {
	float across = abs(vRibbon.y);
	float behind = (1.0 - vRibbon.x) * uShown;
	vec2 at = vLeftward > 0.5
		? vec2(behind, 0.5 - 0.5 * vRibbon.y)
		: vec2(1.0 - behind, 0.5 + 0.5 * vRibbon.y);
	float letter = at.x >= 0.0 && at.x <= 1.0 ? texture2D(uText, at).a : 0.0;
	vec3 band = across > 0.82 ? vec3(0.13, 0.08, 0.1) : uColor * 0.55;
	vec3 color = mix(band, vec3(1.0, 0.98, 0.9), letter);
	float alpha = (1.0 - smoothstep(0.92, 1.0, across)) * smoothstep(0.0, 0.3, vRibbon.x) * uFade;
	gl_FragColor = vec4(color, alpha);
	#include <colorspace_fragment>
}
`;

/** `text` in white on nothing, as a picture one line tall, and how long it is for how tall (its width over its height). */
function textPicture(text:string):{ texture:THREE.CanvasTexture; aspect:number } {
	const canvas = document.createElement('canvas');
	const draw = canvas.getContext('2d')!;
	const font = `700 ${TEXT_FONT}px ui-monospace, "Cascadia Code", monospace`;
	draw.font = font;
	const line = text.replace(/\s+/g, ' ').trim();
	canvas.width = Math.min(TEXT_WIDTH, Math.max(TEXT_HEIGHT, Math.ceil(draw.measureText(line).width) + TEXT_HEIGHT));
	canvas.height = TEXT_HEIGHT;
	// Sizing the canvas cleared the font.
	draw.font = font;
	draw.fillStyle = '#fff';
	draw.textBaseline = 'middle';
	draw.fillText(line, TEXT_HEIGHT / 2, TEXT_HEIGHT / 2);
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	return { texture, aspect: canvas.width / canvas.height };
}

let ribbonStrip:THREE.BufferGeometry | null = null;

/** The strip every ribbon draws, enough corners that an arc reads as a curve; each places it in its own shader. */
function ribbonGeometry():THREE.BufferGeometry {
	if (ribbonStrip) {
		return ribbonStrip;
	}
	const steps = 40;
	const corners:number[] = [];
	const index:number[] = [];
	for (let i = 0; i <= steps; i += 1) {
		corners.push(i / steps, -1, i / steps, 1);
		if (i < steps) {
			const at = i * 2;
			index.push(at, at + 2, at + 1, at + 1, at + 2, at + 3);
		}
	}
	const geometry = new THREE.BufferGeometry();
	// Positions only bound the draw; the vertex shader places every corner.
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Array(corners.length / 2 * 3).fill(0), 3));
	geometry.setAttribute('aCorner', new THREE.Float32BufferAttribute(corners, 2));
	geometry.setIndex(index);
	ribbonStrip = geometry;
	return geometry;
}

/** The order landing on the body at `stance`: its circle opening under it, sparkles round it, a ring across the ground. */
function landing(scene:THREE.Object3D, body:()=>Stance | null, color:number):void {
	const stance = body();
	if (!stance) {
		return;
	}
	runeCircle(scene, body, (age) => (age >= LAND_CIRCLE ? { at: LAND_CIRCLE, outcome: 'hit', landed: true } : null), color);
	shockwave(scene, stance.feet, { ...LAND_WAVE, color });
	for (let i = 0; i < LAND_SPARKLES; i += 1) {
		sparkle(scene, middleOf(stance), 0.2 * Math.random());
	}
}

/**
 * `text`, an order, flying to each of `to` in turn, `stagger` s apart, from `from` as it stands when
 * given. `landed(i)` is told as it reaches `to[i]`. Someone gone by then still gets it where they
 * last stood, with no landing.
 */
export function orderArcs(scene:THREE.Object3D, from:Stance, to:(()=>Stance | null)[], text:string, side:GoalColor, stagger:number, landed:(i:number)=>void):void {
	const color = HUES[side];
	const { texture, aspect } = textPicture(text);
	const textLength = RIBBON_WIDTH * aspect;
	let flying = to.length;
	const start = from.feet.clone().setY(from.feet.y + from.height * 1.05);
	to.forEach((body, i) => {
		const material = effectMaterial(RIBBON_VERTEX, RIBBON_FRAGMENT, {
			uA: { value: start.clone() },
			uB: { value: start.clone() },
			uLift: { value: RISE_MIN },
			uHead: { value: 0 },
			uTail: { value: 0 },
			uWidth: { value: RIBBON_WIDTH },
			uText: { value: texture },
			uColor: { value: new THREE.Color(color) },
			uShown: { value: 0 },
			uFade: { value: 1 },
		});
		const uniforms = material.uniforms;
		const ribbon = new THREE.Mesh(ribbonGeometry(), material);
		ribbon.visible = false;
		const spikes = glowSprite('spikes');
		const glow = glowSprite('glow', color);
		const group = new THREE.Group();
		group.add(ribbon, glow, spikes);
		let last = body();
		let seconds = 0;
		let hit = false;
		addEffect(scene, group, (age) => {
			const t = age - i * stagger;
			if (t < 0) {
				return true;
			}
			last = body() ?? last;
			const goal = last ? middleOf(last) : start;
			const span = start.distanceTo(goal);
			seconds ||= THREE.MathUtils.clamp(span / SPEED, SECONDS[0], SECONDS[1]);
			const u = Math.min(1, t / seconds);
			// Slow off the mark, then racing in.
			const head = u * u * (3 - 2 * u);
			const reach = Math.min(0.5, RIBBON_LENGTH / Math.max(0.01, span));
			const after = Math.max(0, t - seconds) / TAIL_ARRIVES;
			const tail = u < 1 ? Math.max(0, head - reach) : THREE.MathUtils.lerp(1 - reach, 1, Math.min(1, after));
			const lift = Math.max(RISE_MIN, span * RISE);
			uniforms.uB!.value.copy(goal);
			uniforms.uLift!.value = lift;
			uniforms.uHead!.value = head;
			uniforms.uTail!.value = tail;
			uniforms.uShown!.value = ((head - tail) * span) / textLength;
			uniforms.uFade!.value = 1 - Math.min(1, after);
			ribbon.visible = true;
			const at = start.clone().lerp(goal, head);
			at.y += lift * 4 * head * (1 - head);
			const bright = 1 - Math.min(1, after * 2);
			spikes.visible = glow.visible = bright > 0;
			spikes.position.copy(at);
			glow.position.copy(at);
			spikes.scale.setScalar(HEAD_SPIKES * (0.85 + 0.15 * Math.sin(age * 30)));
			glow.scale.setScalar(HEAD_GLOW);
			spikes.material.rotation = age * HEAD_SPIN;
			spikes.material.opacity = bright;
			glow.material.opacity = HEAD_GLOW_OPACITY * bright;
			if (u >= 1 && !hit) {
				hit = true;
				landing(scene, body, color);
				landed(i);
			}
			return after < 1;
		}, () => {
			material.dispose();
			spikes.material.dispose();
			glow.material.dispose();
			flying -= 1;
			if (flying === 0) {
				texture.dispose();
			}
		});
	});
}
