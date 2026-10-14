import { addEffect, effectMaterial, streaks, type Streak } from '@arc-director/kindling';
import * as THREE from 'three';

/**
 * Spell effects, drawn from the pictures in `textures/vfx.png` and the burning fireball in
 * `textures/fireball.png` (both see-through where they were black): lightning that crackles on a
 * staff and leaps at the target, a fireball that swells on a staff and flies, the glint that charges
 * on a drawn arrow's head, and the light that rises from the ground under a healer and whoever they
 * heal, with a circle of runes turning on the ground under whoever casts lightning or fire. Built
 * on Kindling's effects.
 */

/** Where something is now (world), or null once it is gone (the caster down, the arrow loosed). */
export type Anchor = ()=>THREE.Vector3 | null;

/** Where a character stands now: its feet (world) and its height (m). */
export type Stance = { feet:THREE.Vector3; height:number };

/**
 * How an attack or spell turned out, once settled: `hit` it reached the target (a hit, a block, a
 * heal that took), `miss` it was loosed and went wide (or the heal failed), `cut` it never went
 * (cut short before its blow: by the caster's next move, or never told).
 */
export type Outcome = 'hit' | 'miss' | 'cut';

/**
 * A spell under way: where it leaves from (a staff's head), where the caster and the target stand,
 * the seconds until its blow is settled, and how that went once it is. `from` and `caster` are
 * null once the caster is down.
 */
export type Cast = { from:Anchor; caster:()=>Stance | null; target:()=>Stance; seconds:number; outcome:()=>Outcome | undefined };

/** Seconds past its wind-up a shot or spell waits to be told how it went before it counts as cut. */
export const RELEASE_GRACE = 0.3;
/** A miss: how far wide of the target it goes (m, to one side), and how far past it it lands (m). */
const MISS_WIDE:[number, number] = [0.7, 1.2];
const MISS_PAST = 2.5;

/** A cast once settled: when (its effect's age, s), how it went, and whether it landed (a hit). */
type Settled = { at:number; outcome:Outcome; landed:boolean };

/** Seconds a cut spell takes to die out where it gathered. */
const FIZZLE = 0.25;

/**
 * Watches `cast` settle, asked with its effect's age: null until it does. One never told counts as
 * cut once its wind-up is over by {@link RELEASE_GRACE}.
 */
function settling(cast:Cast):(age:number)=>Settled | null {
	let settled:Settled | null = null;
	return (age) => {
		const told = cast.outcome();
		if (!settled && (told !== undefined || age >= cast.seconds + RELEASE_GRACE)) {
			const outcome = told ?? 'cut';
			settled = { at: age, outcome, landed: outcome === 'hit' };
		}
		return settled;
	};
}

/** The pictures in the atlas: the lightning strip across the top, then 256-px cells, four to a row. */
type Picture = 'fireball' | 'ring' | 'spikes' | 'glow' | 'sparkle' | 'swirl' | 'diamond';
const CELLS:Picture[] = ['fireball', 'ring', 'spikes', 'glow', 'sparkle', 'swirl', 'diamond'];
const ATLAS_SIZE = [1024, 768] as const;
const CELL = 256;
/** The lightning strip's share of the atlas height, from the top, and its length over its height. */
const STRIP_HEIGHT = CELL / ATLAS_SIZE[1];
const STRIP_ASPECT = ATLAS_SIZE[0] / CELL;

/**
 * Lightning: the bolt's width (m) and how long it lasts (s); the arcs that crackle on the staff while
 * the spell gathers, how many, how long (m) and wide; and how often every arc jumps to a new shape (s).
 */
const BOLT_WIDTH = 0.75;
const BOLT_LIFE = 0.3;
const CRACKLE_ARCS = 3;
const CRACKLE_LENGTH:[number, number] = [0.2, 0.45];
const CRACKLE_WIDTH = 0.2;
const FLICKER = 0.05;

/**
 * Fireball: its burning picture, frames in a grid of `FIRE_GRID` (columns, rows) with the flame up
 * and the ball in the middle, played at `FIRE_FPS`; its size at full swell (m, the whole picture,
 * the ball about a third of it) and how far its flame draws out behind it in flight (times); how fast
 * embers turn (radians/s); its flight speed (m/s), how
 * big it bursts (times its size) and how long the burst lasts (s), and its embers: how many burst
 * out, how often one trails the flight (s).
 */
const FIRE_FILE = 'fireball.png';
const FIRE_GRID = [4, 2] as const;
const FIRE_FPS = 14;
const FIREBALL_SIZE = 1.4;
const FIREBALL_STRETCH = 1.3;
const FIREBALL_SPIN = 7;
export const FIREBALL_SPEED = 14;
const FIREBALL_BURST = 2;
const FIREBALL_BURST_LIFE = 0.35;
const FIREBALL_EMBERS = 12;
const FIREBALL_TRAIL = 0.03;
const FIRE_GLOW = 0xff6a20;

/**
 * The circle of runes under a caster while lightning or fire gathers: how wide (m), how long it
 * takes to open and to go once the spell is loosed or cut (s), how fast its rings and its star turn
 * (radians/s), and its color per spell.
 */
const RUNE_SIZE = 2.2;
const RUNE_IN = 0.35;
const RUNE_OUT = 0.3;
const RUNE_TURN = 0.6;
const RUNE_STAR_TURN = -0.4;
const RUNE_FIRE = 0xff8a3a;
const RUNE_LIGHTNING = 0x9fe8ff;

/**
 * An arrow's charge glint: the light spikes' size (m) and turn (radians/s); the ring's size as it
 * starts (m) and the seconds it takes to close in, again and again; how fast it all fades (s).
 */
const GLINT_SPIKES = 0.55;
const GLINT_SPIN = 2.2;
const GLINT_RING = 0.7;
const GLINT_CYCLE = 0.65;
const GLINT_FADE = 0.12;

/**
 * Healing sparkles: how many a second twinkle round each body, how far out from its middle (m, out
 * and up/down), their sizes (m), how long one twinkle takes (s), and how many each does before it
 * goes. The bloom on the healed: its size (m), how long (s), and the sparkles that burst round it.
 */
const SPARKLES_PER_SECOND = 22;
const SPARKLE_SPREAD = 0.5;
const SPARKLE_BAND:[number, number] = [-0.8, 0.6];
const SPARKLE_SIZE:[number, number] = [0.18, 0.42];
const TWINKLE:[number, number] = [0.3, 0.55];
const TWINKLES = 2;
const BLOOM_SIZE = 1.4;
const BLOOM_LIFE = 0.6;
const BLOOM_SPARKLES = 18;
/**
 * Heal's light from the ground: the shaft of light round each body (radius and height, as shares of
 * its height), the glow on the ground under it (m across), how long the light takes to come up, to
 * go once the heal lands and to go when it fails (s), and how much the healed one's swells as it lands. Then the spikes of light shooting
 * up from the ground: how many a second, how far from the feet (m), how long (m), how wide (m), how
 * long each lives (s), and how many burst up as the heal lands. The shaft is a pale light, the spikes gold.
 */
const SHAFT_RADIUS = 0.3;
const SHAFT_HEIGHT = 1.6;
const HALO_SIZE = 1.8;
const LIGHT_IN = 0.4;
const LIGHT_OUT = 0.7;
const LIGHT_CUT = 0.25;
const LIGHT_SWELL = 0.5;
const SPIKES_PER_SECOND = 10;
const SPIKE_SPREAD = 0.5;
const SPIKE_LENGTH:[number, number] = [0.6, 1.6];
const SPIKE_WIDTH:[number, number] = [0.06, 0.12];
const SPIKE_LIFE = 0.5;
const SPIKE_BURST = 16;
const HEAL_LIGHT = 0xffefc2;
const HEAL_SPIKE = 0xffd060;

// A strip of the lightning picture laid from uA to uB (world), uWidth across and flat to the eye;
// aCorner is (0 at A … 1 at B, −1 / +1 across). It shows the stretch of the strip from uU0, uSpan
// long, flipped over when uFlip is −1.
const BEAM_VERTEX = `
uniform vec3 uA;
uniform vec3 uB;
uniform float uWidth;
uniform float uU0;
uniform float uSpan;
uniform float uFlip;
uniform float uStrip;
attribute vec2 aCorner;
varying vec2 vUv;
void main() {
	vec4 a = viewMatrix * vec4(uA, 1.0);
	vec4 b = viewMatrix * vec4(uB, 1.0);
	vec2 along = b.xy - a.xy;
	vec2 side = length(along) > 1e-5 ? normalize(vec2(-along.y, along.x)) : vec2(0.0, 1.0);
	vec4 at = mix(a, b, aCorner.x);
	at.xy += side * aCorner.y * uWidth * 0.5;
	vUv = vec2(uU0 + aCorner.x * uSpan, 1.0 - uStrip * (0.5 + 0.5 * aCorner.y * uFlip));
	gl_Position = projectionMatrix * at;
}
`;

// The shaft: a tube of light standing on the ground (uv.y 0 at the foot, 1 at the top), thickest
// low down and gone by the top, in slow-turning rays round it.
const SHAFT_VERTEX = `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SHAFT_FRAGMENT = `
uniform float uTime;
uniform float uOpacity;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
	float up = vUv.y;
	float fall = pow(1.0 - up, 1.6) * smoothstep(0.0, 0.06, up);
	float turn = vUv.x * 6.28318;
	float rays = 0.1 + 0.9 * pow(0.5 + 0.5 * sin(turn * 9.0 + uTime * 1.3) * sin(turn * 4.0 - uTime * 2.1 + 1.7), 1.5);
	gl_FragColor = vec4(uColor, fall * rays * uOpacity * 0.4);
	#include <colorspace_fragment>
}
`;

// A magic circle flat on the ground (r 0 at the middle, 1 at the rim): a double rim with a band of
// rune marks turning between its rings, an inner ring, and a six-pointed star turning the other way.
const RUNE_FRAGMENT = `
uniform float uTurn;
uniform float uStarTurn;
uniform float uOpacity;
uniform vec3 uColor;
varying vec2 vUv;
float ring(float r, float at, float w) {
	return 1.0 - smoothstep(0.0, w, abs(r - at));
}
float segment(vec2 p, vec2 a, vec2 b, float w) {
	vec2 pa = p - a;
	vec2 ba = b - a;
	float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
	return 1.0 - smoothstep(0.0, w, length(pa - ba * h));
}
void main() {
	vec2 p = (vUv - 0.5) * 2.0;
	float r = length(p);
	if (r > 1.0) discard;
	float lines = ring(r, 0.96, 0.03) + ring(r, 0.8, 0.02) + ring(r, 0.46, 0.02);
	float cell = fract((atan(p.y, p.x) + uTurn) * 20.0 / 6.28318);
	float runes = step(0.84, r) * step(r, 0.92) * (step(0.2, cell) * step(cell, 0.45) + step(0.6, cell) * step(cell, 0.7));
	float star = 0.0;
	for (int i = 0; i < 6; i++) {
		float a0 = uStarTurn + float(i / 3) * 1.0472 + float(i - (i / 3) * 3) * 2.0944;
		vec2 a = 0.8 * vec2(cos(a0), sin(a0));
		vec2 b = 0.8 * vec2(cos(a0 + 2.0944), sin(a0 + 2.0944));
		star = max(star, segment(p, a, b, 0.025));
	}
	float alpha = clamp(lines + runes + star, 0.0, 1.0) + 0.08 * (1.0 - r);
	gl_FragColor = vec4(uColor, alpha * uOpacity);
	#include <colorspace_fragment>
}
`;

const BEAM_FRAGMENT = `
uniform sampler2D uMap;
uniform float uOpacity;
varying vec2 vUv;
void main() {
	vec4 color = texture2D(uMap, vUv);
	gl_FragColor = vec4(color.rgb, color.a * uOpacity);
	#include <colorspace_fragment>
}
`;

/**
 * The texture images by file, each loaded once, and the textures still waiting for theirs. Every
 * texture on a file is a window on it, sharing one upload; none is marked for upload before the
 * image is in, so none draws half-loaded.
 */
const images = new Map<string, THREE.Source<HTMLImageElement | null>>();
const waiting = new Map<string, THREE.Texture[]>();
let wholeSheet:THREE.Texture | null = null;
const pictures = new Map<Picture, THREE.Texture>();

/** A new texture showing `textures/<file>`, the whole of it until its repeat and offset say otherwise. */
function sheet(file = 'vfx.png'):THREE.Texture {
	let source = images.get(file);
	if (!source) {
		const loading = new THREE.Source<HTMLImageElement | null>(null);
		source = loading;
		images.set(file, loading);
		waiting.set(file, []);
		new THREE.ImageLoader().load(`${import.meta.env.BASE_URL}textures/${file}`, (image) => {
			loading.data = image;
			waiting.get(file)?.forEach((texture) => (texture.needsUpdate = true));
			waiting.delete(file);
		});
	}
	const texture = new THREE.Texture();
	texture.source = source;
	texture.colorSpace = THREE.SRGBColorSpace;
	if (source.data) {
		texture.needsUpdate = true;
	}
	else {
		waiting.get(file)?.push(texture);
	}
	return texture;
}

/** One cell of the atlas, as its own texture. */
function picture(name:Picture):THREE.Texture {
	let texture = pictures.get(name);
	if (!texture) {
		const i = CELLS.indexOf(name);
		texture = sheet();
		texture.repeat.set(CELL / ATLAS_SIZE[0], CELL / ATLAS_SIZE[1]);
		texture.offset.set(((i % 4) * CELL) / ATLAS_SIZE[0], 1 - (CELL * (2 + Math.floor(i / 4))) / ATLAS_SIZE[1]);
		pictures.set(name, texture);
	}
	return texture;
}

/** A sprite of `name`, tinted `color`, hidden until placed. */
function glowSprite(name:Picture, color = 0xffffff):THREE.Sprite {
	const material = new THREE.SpriteMaterial({ map: picture(name), color, transparent: true, depthWrite: false, toneMapped: false });
	const sprite = new THREE.Sprite(material);
	sprite.visible = false;
	return sprite;
}

/** Adds a sprite effect; its material goes with it (the picture is shared). */
function addSprite(scene:THREE.Object3D, sprite:THREE.Sprite, update:(age:number)=>boolean):void {
	addEffect(scene, sprite, update, () => sprite.material.dispose());
}

/** The middle of a body standing at `stance`, where spells strike it. */
const middleOf = ({ feet, height }:Stance):THREE.Vector3 => feet.clone().setY(feet.y + height * 0.55);
const easeOut = (x:number):number => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
const between = ([a, b]:[number, number]):number => THREE.MathUtils.lerp(a, b, Math.random());
const randomDirection = ():THREE.Vector3 => new THREE.Vector3().randomDirection();

/** Where a shot from `from` at someone standing at `feet` lands when it misses: wide to one side and `past` m beyond, on the ground. */
export function missPoint(from:THREE.Vector3, feet:THREE.Vector3, past = MISS_PAST):THREE.Vector3 {
	const ahead = feet.clone().sub(from).setY(0);
	if (ahead.lengthSq() < 1e-6) {
		ahead.set(0, 0, -1);
	}
	ahead.normalize();
	const wide = between(MISS_WIDE) * (Math.random() < 0.5 ? -1 : 1);
	return feet.clone().add(new THREE.Vector3(-ahead.z, 0, ahead.x).multiplyScalar(wide)).addScaledVector(ahead, past).setY(feet.y + 0.05);
}

type Beam = { mesh:THREE.Mesh; uniforms:Record<string, THREE.IUniform> };

/** A lightning strip, unplaced; {@link layBeam} puts it somewhere. */
function beam():Beam {
	const geometry = new THREE.BufferGeometry();
	// Positions only bound the draw; the vertex shader places every corner.
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Array(12).fill(0), 3));
	geometry.setAttribute('aCorner', new THREE.Float32BufferAttribute([0, -1, 0, 1, 1, -1, 1, 1], 2));
	geometry.setIndex([0, 2, 1, 1, 2, 3]);
	const uniforms = {
		uA: { value: new THREE.Vector3() },
		uB: { value: new THREE.Vector3() },
		uWidth: { value: 0 },
		uU0: { value: 0 },
		uSpan: { value: 1 },
		uFlip: { value: 1 },
		uStrip: { value: STRIP_HEIGHT },
		uMap: { value: wholeSheet ??= sheet() },
		uOpacity: { value: 1 },
	};
	return { mesh: new THREE.Mesh(geometry, effectMaterial(BEAM_VERTEX, BEAM_FRAGMENT, uniforms)), uniforms };
}

/** Lays `b` from `from` to `to`, `width` across, on a fresh stretch of the strip: a new shape of bolt. */
function layBeam(b:Beam, from:THREE.Vector3, to:THREE.Vector3, width:number):void {
	const span = Math.min(1, from.distanceTo(to) / (width * STRIP_ASPECT));
	b.uniforms.uA!.value.copy(from);
	b.uniforms.uB!.value.copy(to);
	b.uniforms.uWidth!.value = width;
	b.uniforms.uSpan!.value = span;
	b.uniforms.uU0!.value = Math.random() * (1 - span);
	b.uniforms.uFlip!.value = Math.random() < 0.5 ? -1 : 1;
}

/**
 * Smite's lightning: arcs crackle round a turning spark at `from` while the spell gathers, then, as
 * its blow is settled, a bolt leaps from it to the target (or, on a miss, the ground beside them),
 * sparking and crackling where it struck as it fades.
 */
export function lightning(scene:THREE.Object3D, cast:Cast):void {
	const settled = settling(cast);
	runeCircle(scene, cast.caster, settled, RUNE_LIGHTNING);
	const group = new THREE.Group();
	const arcs = Array.from({ length: CRACKLE_ARCS }, beam);
	const bolts = [beam(), beam()];
	const spark = glowSprite('spikes');
	for (const b of [...arcs, ...bolts]) {
		b.mesh.frustumCulled = false;
		b.mesh.renderOrder = 10;
		group.add(b.mesh);
	}
	group.add(spark);
	let flicker = -1;
	let source = cast.from();
	// Where it strikes on a miss: the ground beside the target.
	let wide:THREE.Vector3 | null = null;
	addEffect(scene, group, (age) => {
		const bolt = settled(age);
		if (bolt?.outcome === 'miss' && source) {
			wide ??= missPoint(source, cast.target().feet, 0.3);
		}
		// Cut short: the arcs die out where they gathered, and no bolt.
		const fizzle = bolt?.outcome === 'cut' ? (age - bolt.at) / FIZZLE : -1;
		if (fizzle >= 1) {
			return false;
		}
		const gathering = !bolt || fizzle >= 0;
		const from = cast.from() ?? (gathering ? null : source);
		if (!from) {
			return false;
		}
		source = from;
		const struck = wide ?? middleOf(cast.target());
		const step = Math.floor(age / FLICKER);
		const jump = step !== flicker;
		flicker = step;
		if (gathering) {
			// Building up: more of each arc, and brighter, as the cast goes on.
			const charge = easeOut(age / Math.max(0.05, cast.seconds));
			if (jump) {
				for (const arc of arcs) {
					layBeam(arc, from, from.clone().addScaledVector(randomDirection(), between(CRACKLE_LENGTH) * (0.4 + 0.6 * charge)), CRACKLE_WIDTH);
				}
			}
			arcs.forEach((arc) => (arc.uniforms.uOpacity!.value = (0.5 + 0.5 * charge) * (fizzle >= 0 ? 1 - fizzle : 1)));
			bolts.forEach((bolt) => (bolt.mesh.visible = false));
			spark.visible = true;
			spark.position.copy(from);
			spark.scale.setScalar(0.25 + 0.35 * charge);
			spark.material.opacity = 0.6 * charge * (fizzle >= 0 ? 1 - fizzle : 1);
			spark.material.rotation = age * 3;
			return true;
		}
		const u = (age - bolt!.at) / BOLT_LIFE;
		if (u >= 1) {
			return false;
		}
		if (jump) {
			layBeam(bolts[0]!, from, struck, BOLT_WIDTH);
			layBeam(bolts[1]!, from, struck, BOLT_WIDTH * 0.6);
			for (const arc of arcs) {
				layBeam(arc, struck, struck.clone().addScaledVector(randomDirection(), between(CRACKLE_LENGTH)), CRACKLE_WIDTH);
			}
		}
		const fade = 1 - THREE.MathUtils.smoothstep(u, 0.5, 1);
		bolts.forEach((bolt, i) => {
			bolt.mesh.visible = true;
			bolt.uniforms.uOpacity!.value = fade * (i === 0 ? 1 : 0.6);
		});
		arcs.forEach((arc) => (arc.uniforms.uOpacity!.value = fade));
		spark.position.copy(struck);
		spark.scale.setScalar(1.1);
		spark.material.opacity = 0.8 * fade;
		return true;
	}, () => {
		for (const b of [...arcs, ...bolts]) {
			b.mesh.geometry.dispose();
			(b.mesh.material as THREE.Material).dispose();
		}
		spark.material.dispose();
	});
}

/**
 * A circle of runes, `color`, turning on the ground under `body` while a spell gathers: it opens
 * out, and goes once the spell is `settled` (loosed or cut), or at once if the body is gone.
 */
function runeCircle(scene:THREE.Object3D, body:()=>Stance | null, settled:(age:number)=>Settled | null, color:number):void {
	const uniforms = { uTurn: { value: 0 }, uStarTurn: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color(color) } };
	const material = effectMaterial(SHAFT_VERTEX, RUNE_FRAGMENT, uniforms);
	material.polygonOffset = true;
	material.polygonOffsetFactor = -2;
	const circle = new THREE.Mesh(new THREE.PlaneGeometry(RUNE_SIZE, RUNE_SIZE).rotateX(-Math.PI / 2), material);
	addEffect(scene, circle, (age) => {
		const stance = body();
		const done = settled(age);
		const end = done ? (age - done.at) / RUNE_OUT : 0;
		if (!stance || end >= 1) {
			return false;
		}
		const open = easeOut(age / RUNE_IN);
		circle.position.copy(stance.feet).setY(stance.feet.y + 0.03);
		circle.scale.setScalar(0.6 + 0.4 * open + 0.15 * end);
		uniforms.uTurn.value = age * RUNE_TURN;
		uniforms.uStarTurn.value = age * RUNE_STAR_TURN;
		uniforms.uOpacity.value = open * (1 - end);
		return true;
	}, () => {
		circle.geometry.dispose();
		material.dispose();
	});
}

/** A spark of fire at `at` (world) drifting by `velocity` (m/s) and falling a little, `size` m, shrinking and fading over `life` s. */
function ember(scene:THREE.Object3D, at:THREE.Vector3, velocity:THREE.Vector3, size:number, life:number):void {
	const spark = glowSprite('fireball');
	const turn = Math.random() * Math.PI * 2;
	addSprite(scene, spark, (age) => {
		const u = age / life;
		spark.visible = true;
		spark.position.copy(at).addScaledVector(velocity, age).setY(at.y + velocity.y * age - 3 * age * age);
		spark.scale.setScalar(size * (1 - u));
		spark.material.rotation = turn + age * FIREBALL_SPIN;
		spark.material.opacity = 1 - u * u;
		return u < 1;
	});
}

/** A burning fireball sprite, flame up, hidden until placed; `burn(age)` moves its flames on. It owns its texture. */
export function flameSprite():{ sprite:THREE.Sprite; burn:(age:number)=>void } {
	const texture = sheet(FIRE_FILE);
	const [columns, rows] = FIRE_GRID;
	texture.repeat.set(1 / columns, 1 / rows);
	const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
	sprite.visible = false;
	const start = Math.floor(Math.random() * columns * rows);
	return {
		sprite,
		burn: (age) => {
			const frame = (start + Math.floor(age * FIRE_FPS)) % (columns * rows);
			texture.offset.set((frame % columns) / columns, 1 - (Math.floor(frame / columns) + 1) / rows);
		},
	};
}

/** Frees a flame sprite's material and its own texture. */
export function disposeFlame(sprite:THREE.Sprite):void {
	sprite.material.map?.dispose();
	sprite.material.dispose();
}

/** A fireball bursting at `at` (world): its flames swelling up and fading, its glow, and embers flung out. */
function fireBurst(scene:THREE.Object3D, at:THREE.Vector3):void {
	const { sprite: flash, burn } = flameSprite();
	const glow = glowSprite('glow', FIRE_GLOW);
	flash.add(glow);
	glow.scale.setScalar(0.9);
	addEffect(scene, flash, (age) => {
		const u = age / FIREBALL_BURST_LIFE;
		flash.visible = glow.visible = true;
		flash.position.copy(at);
		flash.scale.setScalar(FIREBALL_SIZE * THREE.MathUtils.lerp(1, FIREBALL_BURST, easeOut(u * 2)));
		burn(age);
		flash.material.opacity = 1 - u * u;
		glow.material.opacity = 0.8 * (1 - u);
		return u < 1;
	}, () => {
		disposeFlame(flash);
		glow.material.dispose();
	});
	for (let i = 0; i < FIREBALL_EMBERS; i++) {
		const out = randomDirection();
		out.y = Math.abs(out.y);
		ember(scene, at, out.multiplyScalar(between([2, 4])), between([0.1, 0.2]), between([0.35, 0.6]));
	}
}

/**
 * Hex's fireball: it swells on `from` through the cast, burning upward, then, as its blow is settled,
 * flies at the target (or wide of them, to burst on the ground behind) with its flame streaming out
 * behind it and trailing embers, and bursts where it lands. It goes out if the caster falls first.
 */
export function fireball(scene:THREE.Object3D, cast:Cast):void {
	if (!cast.from()) {
		return;
	}
	const { sprite: ball, burn } = flameSprite();
	const glow = glowSprite('glow', FIRE_GLOW);
	ball.add(glow);
	glow.scale.setScalar(0.9);
	glow.material.opacity = 0.5;
	// Once it flies: when, from where, to a fixed point on a miss (null follows the target), how long.
	let flight:{ t0:number; from:THREE.Vector3; wide:THREE.Vector3 | null; seconds:number } | null = null;
	const heading = new THREE.Vector3();
	// In flight the flame streams back: the picture's up turned, on screen, against the way it flies.
	ball.onBeforeRender = (_renderer, _scene, camera):void => {
		if (!flight) {
			ball.material.rotation = 0;
			return;
		}
		const here = ball.position.clone().project(camera);
		const ahead = ball.position.clone().add(heading).project(camera);
		const aspect = (camera as THREE.PerspectiveCamera).aspect ?? 1;
		ball.material.rotation = Math.atan2(here.y - ahead.y, (here.x - ahead.x) * aspect) - Math.PI / 2;
	};
	let trailed = 0;
	const settled = settling(cast);
	runeCircle(scene, cast.caster, settled, RUNE_FIRE);
	addEffect(scene, ball, (age) => {
		ball.visible = glow.visible = true;
		burn(age);
		if (!flight) {
			const at = cast.from();
			if (!at) {
				return false;
			}
			const shot = settled(age);
			// Cut short: it shrinks out on the staff.
			const fizzle = shot?.outcome === 'cut' ? (age - shot.at) / FIZZLE : 0;
			if (fizzle >= 1) {
				return false;
			}
			if (!shot || shot.outcome === 'cut') {
				const s = FIREBALL_SIZE * easeOut(age / Math.max(0.05, cast.seconds * 0.8)) * (1 - fizzle);
				ball.position.copy(at);
				ball.scale.setScalar(Math.max(0.01, s));
				return true;
			}
			const wide = shot.landed ? null : missPoint(at, cast.target().feet);
			const aim = wide ?? middleOf(cast.target());
			flight = { t0: age, from: at.clone(), wide, seconds: Math.max(0.08, at.distanceTo(aim) / FIREBALL_SPEED) };
		}
		const goal = flight.wide ?? middleOf(cast.target());
		const u = (age - flight.t0) / flight.seconds;
		if (u >= 1) {
			fireBurst(scene, goal);
			return false;
		}
		heading.subVectors(goal, flight.from).normalize();
		ball.scale.set(FIREBALL_SIZE, FIREBALL_SIZE * FIREBALL_STRETCH, 1);
		ball.position.lerpVectors(flight.from, goal, u * u);
		for (; trailed * FIREBALL_TRAIL < age - flight.t0; trailed++) {
			ember(scene, ball.position.clone(), randomDirection().multiplyScalar(0.4), 0.25, 0.3);
		}
		return true;
	}, () => {
		disposeFlame(ball);
		glow.material.dispose();
	});
}

/**
 * The glint charging on a drawn arrow's head at `tip`: light spikes turning for as long as it lasts,
 * and a ring that closes in on them, sucking in light, over and over. It fades once `tip` is gone.
 */
export function chargeGlint(scene:THREE.Object3D, tip:Anchor):void {
	const spikes = glowSprite('spikes');
	const ring = glowSprite('ring');
	const group = new THREE.Group();
	group.add(spikes, ring);
	let gone = -1;
	addEffect(scene, group, (age) => {
		const at = gone < 0 ? tip() : null;
		if (at) {
			group.position.copy(at);
		}
		else if (gone < 0) {
			gone = age;
		}
		const fade = gone < 0 ? 1 : 1 - (age - gone) / GLINT_FADE;
		if (fade <= 0) {
			return false;
		}
		const on = THREE.MathUtils.smoothstep(age, 0, 0.25) * fade;
		spikes.visible = ring.visible = true;
		spikes.scale.setScalar(GLINT_SPIKES * (0.8 + 0.2 * Math.sin(age * 9)));
		spikes.material.rotation = age * GLINT_SPIN;
		spikes.material.opacity = on;
		// Closing in faster and faster, showing up as it starts and gone as it meets the spikes.
		const u = (age % GLINT_CYCLE) / GLINT_CYCLE;
		ring.scale.setScalar(Math.max(0.01, GLINT_RING * (1 - u * u)));
		ring.material.opacity = on * THREE.MathUtils.smoothstep(u, 0, 0.2) * (1 - THREE.MathUtils.smoothstep(u, 0.8, 1));
		return true;
	}, () => {
		spikes.material.dispose();
		ring.material.dispose();
	});
}

/**
 * One sparkle twinkling in place round the body whose middle is `middle`, `delay` s from now: a
 * star or a diamond of light that pops up and shrinks away, once or a few times, turning a little.
 */
function sparkle(scene:THREE.Object3D, middle:THREE.Vector3, delay = 0):void {
	const star = glowSprite(Math.random() < 0.7 ? 'sparkle' : 'diamond');
	const turn = Math.random() * Math.PI * 2;
	const at = middle.clone().add(new THREE.Vector3(Math.cos(turn), 0, Math.sin(turn)).multiplyScalar(SPARKLE_SPREAD * Math.sqrt(Math.random())));
	at.y += between(SPARKLE_BAND);
	const size = between(SPARKLE_SIZE);
	const twinkle = between(TWINKLE);
	const times = 1 + Math.floor(Math.random() * TWINKLES);
	const spin = (Math.random() - 0.5) * 2;
	addSprite(scene, star, (age) => {
		const t = age - delay;
		if (t >= twinkle * times) {
			return false;
		}
		star.visible = t >= 0;
		star.position.copy(at);
		// Quick to pop up, slower to shrink away.
		const u = (Math.max(0, t) / twinkle) % 1;
		const pop = u < 0.3 ? easeOut(u / 0.3) : 1 - THREE.MathUtils.smoothstep(u, 0.3, 1);
		star.scale.setScalar(Math.max(0.01, size * pop));
		star.material.rotation = turn + spin * t;
		return true;
	});
}

/** A point of health coming back to the body whose middle is `middle` (`Regen`): a few sparkles twinkling up. */
export function healGlint(scene:THREE.Object3D, middle:THREE.Vector3):void {
	for (let i = 0; i < 5; i += 1) {
		sparkle(scene, middle, 0.08 * i);
	}
}

/** The healed one lighting up as the heal lands at `middle`: a golden swell that fades, and sparkles bursting all round. */
function healBloom(scene:THREE.Object3D, middle:THREE.Vector3):void {
	const glow = glowSprite('glow');
	addSprite(scene, glow, (age) => {
		const u = age / BLOOM_LIFE;
		glow.visible = true;
		glow.position.copy(middle);
		glow.scale.setScalar(BLOOM_SIZE * easeOut(u * 3));
		glow.material.opacity = 1 - u;
		return u < 1;
	});
	for (let i = 0; i < BLOOM_SPARKLES; i++) {
		sparkle(scene, middle, 0.25 * Math.random());
	}
}

/** Spikes of light shooting up from the ground round `feet`: `count` of them, `reach` times as long as most. */
function lightSpikes(scene:THREE.Object3D, feet:THREE.Vector3, count:number, reach = 1):void {
	const list = Array.from({ length: count }, ():Streak => {
		const turn = Math.random() * Math.PI * 2;
		const out = new THREE.Vector3(Math.cos(turn), 0, Math.sin(turn));
		return {
			root: feet.clone().addScaledVector(out, SPIKE_SPREAD * Math.sqrt(Math.random())),
			// Straight up, leaning a little out.
			dir: out.multiplyScalar(0.12 * Math.random()).setY(1).normalize(),
			length: between(SPIKE_LENGTH) * reach,
			width: between(SPIKE_WIDTH),
			delay: count > 1 ? 0.15 * Math.random() : 0,
		};
	});
	streaks(scene, list, SPIKE_LIFE, HEAL_SPIKE);
}

/**
 * Light rising from the ground under `body` until the heal is `settled`: a shaft of slow-turning rays,
 * a glow on the ground, and spikes of light shooting up. On the one `healed`, a heal that lands
 * swells it and throws up a burst of spikes; then it fades. A heal that fails puts it out quickly,
 * and it goes at once if the body is gone (the healer down).
 */
function healPillar(scene:THREE.Object3D, body:()=>Stance | null, settled:(age:number)=>Settled | null, healed:boolean):void {
	const uniforms = { uTime: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color(HEAL_LIGHT) } };
	const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 32, 1, true).translate(0, 0.5, 0), effectMaterial(SHAFT_VERTEX, SHAFT_FRAGMENT, uniforms));
	const haloMaterial = new THREE.MeshBasicMaterial({ map: picture('glow'), transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 });
	const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), haloMaterial);
	halo.position.y = 0.02;
	shaft.frustumCulled = halo.frustumCulled = false;
	shaft.renderOrder = halo.renderOrder = 10;
	const group = new THREE.Group();
	group.add(shaft, halo);
	let spiked = 0;
	let burst = false;
	addEffect(scene, group, (age) => {
		const stance = body();
		const done = settled(age);
		const end = done ? age - done.at : -1;
		const out = done?.landed ? LIGHT_OUT : LIGHT_CUT;
		if (!stance || end >= out) {
			return false;
		}
		group.position.copy(stance.feet);
		const on = THREE.MathUtils.smoothstep(age, 0, LIGHT_IN) * (done ? 1 - end / out : 1);
		const swell = healed && done?.landed ? 1 + LIGHT_SWELL * (1 - end / out) : 1;
		const radius = SHAFT_RADIUS * stance.height * swell;
		shaft.scale.set(radius, SHAFT_HEIGHT * stance.height * swell, radius);
		uniforms.uTime.value = age;
		uniforms.uOpacity.value = on * swell;
		halo.scale.setScalar(HALO_SIZE * swell);
		haloMaterial.opacity = on;
		for (; !done && spiked < age * SPIKES_PER_SECOND; spiked++) {
			lightSpikes(scene, stance.feet, 1);
		}
		if (healed && done?.landed && !burst) {
			burst = true;
			lightSpikes(scene, stance.feet, SPIKE_BURST, 1.4);
		}
		return true;
	}, () => {
		shaft.geometry.dispose();
		(shaft.material as THREE.Material).dispose();
		halo.geometry.dispose();
		haloMaterial.dispose();
	});
}

/**
 * Heal's light: under the healer and the one being healed, a shaft of light and spikes of light
 * shooting up from the ground, with golden sparkles twinkling round them, until the heal is settled;
 * one that lands swells the healed one's light and blooms, one that fails (or is cut short by the
 * healer's next spell) goes out. It stops if the healer falls first.
 */
export function healLight(scene:THREE.Object3D, cast:Cast):void {
	const caster = cast.caster();
	if (!caster) {
		return;
	}
	const self = cast.target().feet.distanceToSquared(caster.feet) < 0.01;
	const settled = settling(cast);
	healPillar(scene, cast.caster, settled, self);
	if (!self) {
		healPillar(scene, cast.target, settled, true);
	}
	let emitted = 0;
	addEffect(scene, new THREE.Object3D(), (age) => {
		const healer = cast.caster();
		if (!healer) {
			return false;
		}
		const done = settled(age);
		if (done) {
			if (done.landed) {
				healBloom(scene, middleOf(cast.target()));
			}
			return false;
		}
		for (; emitted < age * SPARKLES_PER_SECOND; emitted++) {
			sparkle(scene, middleOf(healer));
			if (!self) {
				sparkle(scene, middleOf(cast.target()));
			}
		}
		return true;
	}, () => {});
}
