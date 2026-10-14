import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { Time } from '../core/Time.js';
import { overInk } from './OutlinePass.js';

/**
 * Short-lived effects in the scene (sword trails, dust, spells, shockwaves). Each lives on its own:
 * `update(age)` moves it on once a frame (game time, so it stands still while paused) and returns
 * false when it is done; then it leaves the scene and `dispose` frees what it owns. `Game` moves them
 * on after `lateUpdate`. Hosts compose the primitives here into their own effects.
 */

type Effect = { object:THREE.Object3D; t0:number; update:(age:number)=>boolean; dispose:()=>void };

const live:Effect[] = [];

/** A see-through, unlit shader material drawn on both sides, for effect meshes. */
export function effectMaterial(vertex:string, fragment:string, uniforms:Record<string, THREE.IUniform>):THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		vertexShader: vertex,
		fragmentShader: fragment,
		uniforms,
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
		toneMapped: false,
	});
}

/** Adds `object` to `scene` as an effect, drawn over the world and its ink outlines, casting no shadow. */
export function addEffect(scene:THREE.Object3D, object:THREE.Object3D, update:(age:number)=>boolean, dispose:()=>void):void {
	object.traverse((part) => {
		for (const material of [(part as THREE.Mesh).material ?? []].flat()) {
			overInk(material);
		}
		part.castShadow = false;
		part.receiveShadow = false;
		part.frustumCulled = false;
	});
	object.renderOrder = 10;
	scene.add(object);
	live.push({ object, t0: Time.time, update, dispose });
}

/** Adds a mesh effect that owns its geometry and material. */
export function addMeshEffect(scene:THREE.Object3D, mesh:THREE.Mesh, update:(age:number)=>boolean):void {
	addEffect(scene, mesh, update, () => {
		mesh.geometry.dispose();
		(mesh.material as THREE.Material).dispose();
	});
}

/** Moves every live effect on. `Game` calls it once a frame. */
export function updateEffects():void {
	for (let i = live.length - 1; i >= 0; i--) {
		const fx = live[i]!;
		if (!fx.update(Time.time - fx.t0)) {
			fx.object.removeFromParent();
			fx.dispose();
			live.splice(i, 1);
		}
	}
}

/** One streak of light: from `root` (world) it shoots `length` m along `dir` (unit), `width` m across at its thickest, `delay` s late. */
export type Streak = { root:THREE.Vector3; dir:THREE.Vector3; length:number; width:number; delay:number };

// One streak per six corners: its root (aRoot), the way it shoots (aDir), its full length
// (aLength), width (aWidth) and start delay (aDelay); aCorner is (0 root … 1 head, −1 / +1 across).
// The head shoots out from the root, slowing, the whole time; the streak is drawn flat to the eye,
// thickest just behind its head and needle-thin at both ends.
const STREAK_VERTEX = `
uniform float uAge;
uniform float uLife;
attribute float aWidth;
attribute vec3 aRoot;
attribute vec3 aDir;
attribute float aLength;
attribute float aDelay;
attribute vec2 aCorner;
varying float vAlong;
varying float vAcross;
varying float vFade;
void main() {
	float t = clamp((uAge - aDelay) / uLife, 0.0, 1.0);
	float reach = aLength * (1.0 - pow(1.0 - t, 3.0));
	vec3 head = aRoot + aDir * reach;
	vec4 root4 = viewMatrix * vec4(aRoot, 1.0);
	vec4 head4 = viewMatrix * vec4(head, 1.0);
	vec2 along = head4.xy - root4.xy;
	vec2 side = length(along) > 1e-5 ? normalize(vec2(-along.y, along.x)) : vec2(0.0, 1.0);
	vec4 at = mix(root4, head4, aCorner.x);
	at.xy += side * aCorner.y * aWidth * sin(3.14159 * clamp(aCorner.x * 0.85 + 0.1, 0.0, 1.0));
	vAlong = aCorner.x;
	vAcross = aCorner.y;
	vFade = uAge < aDelay ? 0.0 : 1.0 - t * t;
	gl_Position = projectionMatrix * at;
}
`;

const STREAK_FRAGMENT = `
uniform vec3 uColor;
varying float vAlong;
varying float vAcross;
varying float vFade;
void main() {
	float alpha = vFade * (1.0 - abs(vAcross)) * mix(0.35, 1.0, vAlong);
	gl_FragColor = vec4(uColor, alpha);
	#include <colorspace_fragment>
}
`;

/**
 * Streaks of light, `color`, drawn flat to the eye, thickest just behind their heads and needle-thin
 * at both ends: each head shoots out from its root, slowing, over `life` s while the streak fades.
 */
export function streaks(scene:THREE.Object3D, list:Streak[], life:number, color:THREE.ColorRepresentation = 0xffffff):void {
	const roots:number[] = [];
	const dirs:number[] = [];
	const lengths:number[] = [];
	const widths:number[] = [];
	const delays:number[] = [];
	const corners:number[] = [];
	const index:number[] = [];
	list.forEach(({ root, dir, length, width, delay }, i) => {
		for (const [a, b] of [[0, -1], [0, 1], [0.5, -1], [0.5, 1], [1, -1], [1, 1]] as const) {
			roots.push(root.x, root.y, root.z);
			dirs.push(dir.x, dir.y, dir.z);
			lengths.push(length);
			widths.push(width);
			delays.push(delay);
			corners.push(a, b);
		}
		const v = i * 6;
		index.push(v, v + 2, v + 1, v + 1, v + 2, v + 3, v + 2, v + 4, v + 3, v + 3, v + 4, v + 5);
	});
	const geometry = new THREE.BufferGeometry();
	// Positions only bound the draw; the vertex shader places every corner.
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(roots, 3));
	geometry.setAttribute('aRoot', new THREE.Float32BufferAttribute(roots, 3));
	geometry.setAttribute('aDir', new THREE.Float32BufferAttribute(dirs, 3));
	geometry.setAttribute('aLength', new THREE.Float32BufferAttribute(lengths, 1));
	geometry.setAttribute('aWidth', new THREE.Float32BufferAttribute(widths, 1));
	geometry.setAttribute('aDelay', new THREE.Float32BufferAttribute(delays, 1));
	geometry.setAttribute('aCorner', new THREE.Float32BufferAttribute(corners, 2));
	geometry.setIndex(index);
	const uniforms = { uAge: { value: 0 }, uLife: { value: life }, uColor: { value: new THREE.Color(color) } };
	const last = life + Math.max(0, ...list.map((s) => s.delay));
	addMeshEffect(scene, new THREE.Mesh(geometry, effectMaterial(STREAK_VERTEX, STREAK_FRAGMENT, uniforms)), (age) => {
		uniforms.uAge.value = age;
		return age < last;
	});
}

const SURFACE_VERTEX = `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// u runs along the sweep (0 where it began), v across it (0 at the inner edge, 1 at the outer).
// Thickest past the middle and thin at both ends; its outer edge crisp, its inner edge soft.
const SWEEP_FRAGMENT = `
uniform float uHead;
uniform float uTail;
uniform vec3 uInner;
uniform vec3 uOuter;
varying vec2 vUv;
void main() {
	float along = vUv.x;
	if (along > uHead || along < uTail) discard;
	float body = pow(sin(3.14159 * clamp(along * 0.85 + 0.1, 0.0, 1.0)), 0.8);
	float inner = 1.0 - body;
	if (vUv.y < inner) discard;
	float t = (vUv.y - inner) / max(body, 0.001);
	float alpha = smoothstep(0.0, 0.55, t) * smoothstep(uTail, uTail + 0.3, along);
	gl_FragColor = vec4(mix(uInner, uOuter, smoothstep(0.3, 0.9, t)), alpha);
	#include <colorspace_fragment>
}
`;

/** How a {@link sweep} looks: drawn along its path in `draw` s, erased tail first over `fade` s, `inner` shading to `outer` across it. */
export type SweepLook = { draw:number; fade:number; inner:THREE.ColorRepresentation; outer:THREE.ColorRepresentation };

/**
 * A crescent ribbon swept between two edges of a motion (a blade's swing): `inner[i]` and `outer[i]`
 * (world) at the same moment `i` of it, first to last.
 */
export function sweep(scene:THREE.Object3D, inner:THREE.Vector3[], outer:THREE.Vector3[], look:SweepLook):void {
	const n = Math.min(inner.length, outer.length);
	if (n < 2) {
		return;
	}
	const positions = new Float32Array(n * 2 * 3);
	const uvs = new Float32Array(n * 2 * 2);
	const index:number[] = [];
	for (let i = 0; i < n; i++) {
		inner[i]!.toArray(positions, i * 6);
		outer[i]!.toArray(positions, i * 6 + 3);
		uvs.set([i / (n - 1), 0, i / (n - 1), 1], i * 4);
		if (i > 0) {
			const a = (i - 1) * 2;
			index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
		}
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
	geometry.setIndex(index);
	const uniforms = { uHead: { value: 0 }, uTail: { value: 0 }, uInner: { value: new THREE.Color(look.inner) }, uOuter: { value: new THREE.Color(look.outer) } };
	addMeshEffect(scene, new THREE.Mesh(geometry, effectMaterial(SURFACE_VERTEX, SWEEP_FRAGMENT, uniforms)), (age) => {
		uniforms.uHead.value = Math.min(1, age / look.draw);
		const fade = Math.max(0, (age - look.draw) / look.fade);
		// Erased tail first, easing out.
		uniforms.uTail.value = 1 - (1 - Math.min(1, fade)) ** 2;
		return fade < 1;
	});
}

/** One star of spikes round the origin in the XY plane, each `width` m wide at its root; lengths from `lengths`. */
function spikes(lengths:number[], width:number):THREE.BufferGeometry {
	const positions:number[] = [];
	lengths.forEach((length, i) => {
		const turn = (i / lengths.length) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
		const out = [Math.cos(turn), Math.sin(turn)] as const;
		const side = [-out[1] * width / 2, out[0] * width / 2] as const;
		positions.push(side[0], side[1], 0, -side[0], -side[1], 0, out[0] * length, out[1] * length, 0);
	});
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	return geometry;
}

/**
 * How a {@link starburst} looks: how many spikes and their length range (m), how fast they burst out
 * and how long they fade (s), and their color with an `ink` rim behind so they read on light ground.
 */
export type StarburstLook = { spikes:number; length:[number, number]; out:number; life:number; color:THREE.ColorRepresentation; ink:THREE.ColorRepresentation };

/** A starburst at `at` (world): sharp spikes of uneven length, rimmed in ink, flat to the eye. */
export function starburst(scene:THREE.Object3D, at:THREE.Vector3, look:StarburstLook):void {
	const lengths = Array.from({ length: look.spikes }, (_, i) => THREE.MathUtils.lerp(look.length[0], look.length[1], i % 3 === 0 ? 0.7 + 0.3 * Math.random() : 0.4 * Math.random()));
	const star = new THREE.Group();
	const ink = new THREE.MeshBasicMaterial({ color: look.ink, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
	const fill = new THREE.MeshBasicMaterial({ color: look.color, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
	const back = new THREE.Mesh(spikes(lengths.map((l) => l * 1.08), 0.09), ink);
	const front = new THREE.Mesh(spikes(lengths, 0.055), fill);
	front.position.z = 0.01;
	star.add(back, front);
	star.position.copy(at);
	// Always flat to the camera.
	back.onBeforeRender = (_renderer, _scene, camera):void => {
		star.quaternion.copy(camera.quaternion);
		star.updateMatrixWorld(true);
	};
	star.scale.setScalar(0.01);
	addEffect(scene, star, (age) => {
		const out = Math.min(1, age / look.out);
		star.scale.setScalar(Math.max(0.01, 1 - (1 - out) ** 3));
		const fade = Math.max(0, (age - look.out) / look.life);
		fill.opacity = 1 - fade * fade;
		ink.opacity = 0.8 * (1 - fade);
		return fade < 1;
	}, () => {
		back.geometry.dispose();
		front.geometry.dispose();
		ink.dispose();
		fill.dispose();
	});
	back.renderOrder = 10;
	front.renderOrder = 11;
}

const puffPictures = new Map<string, THREE.Texture>();

/**
 * A soft round cloud with bumps round its rim, shaded from `colors[0]` in the middle through
 * `colors[1]` to `colors[2]` at the rim (CSS colors), so it reads the same however it spins. Drawn
 * once per set of colors.
 */
export function puffPicture(colors:[string, string, string]):THREE.Texture {
	const key = colors.join();
	const cached = puffPictures.get(key);
	if (cached) {
		return cached;
	}
	const size = 128;
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const g = canvas.getContext('2d')!;
	const c = size / 2;
	const shade = g.createRadialGradient(c, c, 0, c, c, size * 0.45);
	shade.addColorStop(0, colors[0]);
	shade.addColorStop(0.55, colors[1]);
	shade.addColorStop(1, colors[2]);
	g.filter = 'blur(2px)';
	g.fillStyle = shade;
	g.beginPath();
	g.arc(c, c, size * 0.33, 0, Math.PI * 2);
	g.fill();
	for (let i = 0; i < 9; i++) {
		const turn = (i / 9) * Math.PI * 2;
		g.beginPath();
		g.arc(c + Math.cos(turn) * size * 0.3, c + Math.sin(turn) * size * 0.3, size * (0.1 + 0.03 * (i % 3)), 0, Math.PI * 2);
		g.fill();
	}
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	puffPictures.set(key, texture);
	return texture;
}

/**
 * How a {@link puff} moves: how far it billows out (m) and rises, its size from birth to end (m),
 * how long it lives (s) and the share of that it stays thick before thinning away, how much it spins
 * and curls on the way (radians), and how late it starts (s).
 */
export type PuffLook = { map:THREE.Texture; reach:number; rise:number; size:[number, number]; life:number; thick:number; spin:number; curl:number; delay:number };

/**
 * One puff of dust or smoke from `from` (world), billowing out along the flat `heading` (radians
 * round Y, 0 toward +X) and up, spinning and curling like a gust as it swells, then thinning away.
 */
export function puff(scene:THREE.Object3D, from:THREE.Vector3, heading:number, look:PuffLook):void {
	const material = new THREE.SpriteMaterial({ map: look.map, transparent: true, depthWrite: false, toneMapped: false });
	const cloud = new THREE.Sprite(material);
	const turn0 = Math.random() * Math.PI * 2;
	cloud.visible = false;
	addEffect(scene, cloud, (age) => {
		const u = Math.min(1, Math.max(0, (age - look.delay) / look.life));
		const out = 1 - (1 - u) ** 3;
		const s = THREE.MathUtils.lerp(look.size[0], look.size[1], out);
		const angle = heading + look.curl * out;
		cloud.visible = age >= look.delay;
		cloud.scale.set(s, s, 1);
		cloud.position.set(
			from.x + Math.cos(angle) * look.reach * out,
			from.y + look.rise * out + s * 0.35,
			from.z + Math.sin(angle) * look.reach * out,
		);
		material.rotation = turn0 + look.spin * out;
		material.opacity = 1 - THREE.MathUtils.smoothstep(u, look.thick, 1);
		return u < 1;
	}, () => material.dispose());
}

// r is 0 at the middle, 1 at the plane's edge. A crisp ring at uRing, uWidth thick, soft inside,
// with a faint wash behind it.
const SHOCKWAVE_FRAGMENT = `
uniform float uRing;
uniform float uWidth;
uniform float uOpacity;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
	float r = length(vUv - 0.5) * 2.0;
	if (r > 1.0) discard;
	float d = (r - uRing) / uWidth;
	float ring = d > 0.0 ? 1.0 - smoothstep(0.0, 0.25, d) : 1.0 - smoothstep(0.0, 1.0, -d);
	float wash = 0.18 * smoothstep(0.0, uRing, r) * step(r, uRing);
	gl_FragColor = vec4(uColor, max(ring, wash) * uOpacity);
	#include <colorspace_fragment>
}
`;

/** How a {@link shockwave} looks: how far it spreads (m), how thick its ring starts (m), how long it lives (s), its color. */
export type ShockwaveLook = { radius:number; width:number; life:number; color:THREE.ColorRepresentation };

/** A ring flat on the ground at `at` (world) racing out from it, thinning and fading as it slows. */
export function shockwave(scene:THREE.Object3D, at:THREE.Vector3, look:ShockwaveLook):void {
	const uniforms = { uRing: { value: 0 }, uWidth: { value: 1 }, uOpacity: { value: 1 }, uColor: { value: new THREE.Color(look.color) } };
	const material = effectMaterial(SURFACE_VERTEX, SHOCKWAVE_FRAGMENT, uniforms);
	material.polygonOffset = true;
	material.polygonOffsetFactor = -2;
	const ring = new THREE.Mesh(new THREE.PlaneGeometry(look.radius * 2, look.radius * 2).rotateX(-Math.PI / 2), material);
	ring.position.copy(at).setY(at.y + 0.03);
	addMeshEffect(scene, ring, (age) => {
		const u = Math.min(1, age / look.life);
		const out = 1 - (1 - u) ** 3;
		uniforms.uRing.value = Math.max(0.02, out);
		uniforms.uWidth.value = Math.max(0.01, (look.width / look.radius) * (1 - 0.7 * u));
		uniforms.uOpacity.value = 1 - u * u;
		return u < 1;
	});
}

/** How an {@link afterimage} looks: its flat color, how opaque it starts and how long it takes to fade (s). */
export type AfterimageLook = { color:THREE.ColorRepresentation; opacity:number; life:number };

/**
 * A ghost of `model` (a skinned toon model, or any object) frozen in its pose right now: one flat
 * color, fading where it stood.
 */
export function afterimage(scene:THREE.Object3D, model:THREE.Object3D, look:AfterimageLook):void {
	model.updateMatrixWorld(true);
	const ghost = cloneSkinned(model);
	model.matrixWorld.decompose(ghost.position, ghost.quaternion, ghost.scale);
	const material = new THREE.MeshBasicMaterial({ color: look.color, transparent: true, depthWrite: false, toneMapped: false, opacity: look.opacity });
	ghost.traverse((part) => {
		if ((part as THREE.Mesh).isMesh) {
			(part as THREE.Mesh).material = material;
		}
	});
	addEffect(scene, ghost, (age) => {
		const u = Math.min(1, age / look.life);
		material.opacity = look.opacity * (1 - u);
		return u < 1;
	}, () => {
		material.dispose();
		ghost.traverse((part) => (part as THREE.SkinnedMesh).skeleton?.dispose());
	});
}
