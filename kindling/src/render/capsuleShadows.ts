import * as THREE from 'three';
import { patchShader } from './shader.js';

/** Most capsules shaded with per frame, nearest the camera first. */
const MAX_CAPSULES = 16;
/** Capsule radius per meter of height: a body's width. */
const RADIUS_PER_HEIGHT = 0.14;
/** Penumbra hardness: higher is sharper. */
const SOFTNESS = 4;
/** Capsule radii a capsule leans toward each light along the ground, so its shadow also pools under the feet. */
const TOWARD_LIGHT = 1;
/** Capsule radii between the feet and the capsule's bottom, so it never grazes the ground it stands on. */
const FOOT_LIFT = 0.75;
/** Most a lean raises a capsule, per unit of lean: the light's slope, capped for lights nearly overhead. */
const MAX_STRETCH = 2;
/** Capsule radii from its axis that still count as its own body, on skinned surfaces. */
const SELF_REACH = 2;

/** Shared by every patched material: capsules in view space, `a` with the radius in `w`. */
const uniforms = {
	uCapsuleCount: { value: 0 },
	uCapsuleA: { value: Array.from({ length: MAX_CAPSULES }, () => new THREE.Vector4()) },
	uCapsuleB: { value: Array.from({ length: MAX_CAPSULES }, () => new THREE.Vector3()) },
};

const COMMON = /* glsl */ `
uniform int uCapsuleCount;
uniform vec4 uCapsuleA[${MAX_CAPSULES}];
uniform vec3 uCapsuleB[${MAX_CAPSULES}];

// Light reaching p along l (toward the light) past the capsules nearer than far: Inigo Quilez's soft capsule shadow.
float capsuleShadow(vec3 p, vec3 l, float far) {
	float lit = 1.0;
	for (int i = 0; i < ${MAX_CAPSULES}; i++) {
		if (i >= uCapsuleCount) {
			break;
		}
		float r = uCapsuleA[i].w;
		vec3 ba = uCapsuleB[i] - uCapsuleA[i].xyz;
		float baba = dot(ba, ba);
		#ifdef CAPSULE_SKINNED
			// A body (arms and legs past the capsule included) is never shaded by its own capsule.
			vec3 body = p - uCapsuleA[i].xyz;
			if (length(body - ba * clamp(dot(body, ba) / baba, 0.0, 1.0)) < r * ${SELF_REACH.toFixed(1)}) {
				continue;
			}
		#endif
		// Lean toward the light across the capsule's upright axis, and grow taller by as much as the lean
		// shortened the shadow (lean times the light's slope), so the shadow's far tip stays put.
		float rise = dot(l, ba) / sqrt(baba);
		vec3 across = l - ba * (rise / sqrt(baba));
		float level = max(length(across), 1e-3);
		float lean = r * ${TOWARD_LIGHT.toFixed(2)};
		vec3 a = uCapsuleA[i].xyz + across * (lean / level);
		ba *= 1.0 + lean * clamp(rise / level, 0.0, ${MAX_STRETCH.toFixed(1)}) / sqrt(baba);
		baba = dot(ba, ba);
		vec3 oa = p - a;
		float oaba = dot(oa, ba);
		// A point inside a capsule is on that body; its own capsule shades only its far side.
		if (length(oa - ba * clamp(oaba / baba, 0.0, 1.0)) < r) {
			continue;
		}
		float oal = dot(oa, l);
		float bal = dot(ba, l);
		vec2 th = vec2(bal * oaba - oal * baba, oaba - bal * oal) / max(baba - bal * bal, 1e-4);
		th.x = max(th.x, 1e-4);
		if (th.x > far) {
			continue;
		}
		float d = length(a + ba * clamp(th.y, 0.0, 1.0) - p - l * th.x) - r;
		float s = clamp(${SOFTNESS.toFixed(1)} * d / th.x + 0.5, 0.0, 1.0);
		lit = min(lit, s * s * (3.0 - 2.0 * s));
	}
	return lit;
}
`;

const LIGHTS = THREE.ShaderChunk.lights_fragment_begin
	.replace(
		'getPointLightInfo( pointLight, geometryPosition, directLight );',
		'$&\n\t\tif ( directLight.visible ) directLight.color *= capsuleShadow( geometryPosition, directLight.direction, distance( pointLight.position, geometryPosition ) );',
	)
	.replace(
		'getDirectionalLightInfo( directionalLight, directLight );',
		'$&\n\t\tdirectLight.color *= capsuleShadow( geometryPosition, directLight.direction, 1e4 );',
	);

/** Lets the point and directional lights on `material` be blocked by the capsules {@link updateCapsuleShadows} sets. */
export function patchCapsuleShadows(material:THREE.Material):void {
	patchShader(material, 'capsuleShadows', (shader) => {
		Object.assign(shader.uniforms, uniforms);
		shader.fragmentShader = shader.fragmentShader
			// Three defines USE_SKINNING for the vertex shader only.
			.replace('#include <common>', `#include <common>\n${shader.skinning ? '#define CAPSULE_SKINNED\n' : ''}${COMMON}`)
			.replace('#include <lights_fragment_begin>', LIGHTS);
	});
}

const eye = new THREE.Vector3();
const end = new THREE.Vector3();

/**
 * One upright capsule per skinned model among `casters` (its meshes merged by skeleton), sized from the
 * bind pose, nearest `camera` first. An empty list turns capsule shadows off.
 */
export function updateCapsuleShadows(casters:readonly THREE.Object3D[], camera:THREE.Camera):void {
	const bodies = new Map<THREE.Object3D, THREE.Box3>();
	for (const o of casters) {
		const mesh = o as THREE.SkinnedMesh;
		if (!mesh.isSkinnedMesh) {
			continue;
		}
		mesh.updateWorldMatrix(true, false);
		if (!mesh.geometry.boundingBox) {
			mesh.geometry.computeBoundingBox();
		}
		const box = mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
		const body = mesh.skeleton.bones[0] ?? mesh;
		const seen = bodies.get(body);
		if (seen) {
			seen.union(box);
		}
		else {
			bodies.set(body, box);
		}
	}
	camera.updateWorldMatrix(true, false);
	camera.getWorldPosition(eye);
	const nearest = [...bodies.values()]
		.sort((x, y) => x.distanceToPoint(eye) - y.distanceToPoint(eye))
		.slice(0, MAX_CAPSULES);
	nearest.forEach((box, i) => {
		const r = (box.max.y - box.min.y) * RADIUS_PER_HEIGHT;
		const center = box.getCenter(end);
		const a = new THREE.Vector3(center.x, box.min.y + r * (1 + FOOT_LIFT), center.z).applyMatrix4(camera.matrixWorldInverse);
		uniforms.uCapsuleA.value[i]!.set(a.x, a.y, a.z, r);
		uniforms.uCapsuleB.value[i]!.set(center.x, box.max.y - r, center.z).applyMatrix4(camera.matrixWorldInverse);
	});
	uniforms.uCapsuleCount.value = nearest.length;
}
