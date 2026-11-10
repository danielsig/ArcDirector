import * as THREE from 'three';
import type { ImpactFrame } from './Camera.js';

const VERTEX = `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT = `
#include <common>
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uWidth;
uniform vec3 uInk;
uniform float uNear;
uniform float uFar;
uniform float uFogNear;
uniform float uFogFar;
uniform float uImpact;
uniform vec2 uImpactAt;
uniform vec3 uImpactPoint;
uniform float uImpactInvert;
uniform mat4 uProjectionInverse;
uniform mat4 uCameraWorld;
uniform float uImpactSeed;
uniform float uAspect;
varying vec2 vUv;

float distanceAt(vec2 uv) {
	return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar);
}

const vec2 SIDES[4] = vec2[4](vec2(-1.0, 0.0), vec2(1.0, 0.0), vec2(0.0, -1.0), vec2(0.0, 1.0));

// How much ink the edge test finds at this pixel, looking reach texels to each side.
float edgeAt(float reach, float z, float mask) {
	float sum = 0.0;
	float nearest = 0.0;
	vec2 nearestUv = vUv;
	for (int i = 0; i < 4; i++) {
		vec2 uv = vUv + SIDES[i] * uTexel * reach;
		float closeness = 1.0 / distanceAt(uv);
		sum += closeness;
		if (closeness > nearest) {
			nearest = closeness;
			nearestUv = uv;
		}
	}
	// 1/z is linear across any flat surface on screen, so its Laplacian is zero
	// on planes and spikes at silhouettes (negative on the near side) and creases.
	float lap = (sum - 4.0 / z) * z;
	// An edge belongs to the surface in front. The near side inks itself; the far side takes the
	// ink of its nearest neighbor, even on a surface that opts out (alpha -1).
	float owner = lap < 0.0 ? mask : texture2D(tColor, nearestUv).a;
	return owner > 0.5 ? smoothstep(0.015, 0.05, abs(lap)) : 0.0;
}

void main() {
	vec4 color = texture2D(tColor, vUv);
	float edge = 0.0;
	float clear = abs(color.a);
	if (clear > 0.5) {
		float z = distanceAt(vUv);
		// Depth is point-sampled, so reach comes in whole texels: blend the two around the width.
		float reach = floor(uWidth);
		edge = edgeAt(reach, z, color.a);
		if (uWidth > reach) {
			edge = mix(edge, edgeAt(reach + 1.0, z, color.a), uWidth - reach);
		}
		// Under see-through effects drawn with overInk, as faint as they let it through.
		edge *= (1.0 - smoothstep(uFogNear, uFogFar, z)) * smoothstep(0.5, 1.0, clear);
	}
	gl_FragColor = vec4(color.rgb, 1.0);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	gl_FragColor.rgb = mix(gl_FragColor.rgb, uInk, edge);
	if (uImpact > 0.5) {
		// The impact frame: whatever stands off the ground near the blow is a white silhouette inked
		// black, the rest black, with white speed lines bursting out from the blow behind it. Every
		// other frame inverted.
		vec4 view = uProjectionInverse * vec4(vUv * 2.0 - 1.0, texture2D(tDepth, vUv).x * 2.0 - 1.0, 1.0);
		vec3 world = (uCameraWorld * vec4(view.xyz / view.w, 1.0)).xyz;
		float body = step(distance(world, uImpactPoint), 2.2) * step(uImpactPoint.y - 0.75, world.y) * step(0.5, color.a);
		vec2 d = (vUv - uImpactAt) * vec2(uAspect, 1.0);
		float a = (atan(d.y, d.x) / 6.28318 + 0.5) * 90.0;
		float h = fract(sin((floor(a) + uImpactSeed) * 78.233) * 43758.5453);
		float r = length(d);
		float start = 0.12 + 0.3 * fract(h * 7.31);
		float width = (0.06 + 0.22 * h) * smoothstep(start, start + 0.35, r);
		float line = step(0.5, h) * (1.0 - smoothstep(width * 0.6, width, abs(fract(a) - 0.5)));
		float white = body > 0.5 ? step(edge, 0.5) : line;
		gl_FragColor.rgb = vec3(abs(white - uImpactInvert));
	}
}
`;

/**
 * Draws see-through `material` (an effect: a flame, a glow, a trail) over the ink outlines, which
 * otherwise come after everything: it wipes the ink beneath it as much as it covers it. Sets its
 * blending.
 */
export function overInk(material:THREE.Material):void {
	material.blending = THREE.CustomBlending;
	material.blendEquation = THREE.AddEquation;
	material.blendSrc = THREE.SrcAlphaFactor;
	material.blendDst = THREE.OneMinusSrcAlphaFactor;
	material.blendSrcAlpha = THREE.ZeroFactor;
	material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
}

/**
 * Draws see-through `material` (a ground decal, a thin line, a pane) under the ink outlines: ink falls
 * on it as on whatever is behind it. Keeps additive blending additive; anything else blends normally.
 */
export function underInk(material:THREE.Material):void {
	const additive = material.blending === THREE.AdditiveBlending;
	material.blending = THREE.CustomBlending;
	material.blendEquation = THREE.AddEquation;
	material.blendSrc = THREE.SrcAlphaFactor;
	material.blendDst = additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor;
	material.blendSrcAlpha = THREE.ZeroFactor;
	material.blendDstAlpha = THREE.OneFactor;
}

/** Window height the outline `width` is given at. */
const REFERENCE_HEIGHT = 1080;
/** Camera height in meters the outline `width` is given at. */
const REFERENCE_CAMERA_HEIGHT = 10;

/**
 * Screen-space ink outlines from scene depth: one offscreen render plus one fullscreen pass,
 * so outlines cost no extra draw calls per object. Tone mapping and color space happen here.
 */
export class OutlinePass {
	public enabled = true;
	/** Ink color (sRGB hex as authored). */
	public readonly color = new THREE.Color(0x23170f);
	/**
	 * How far ink reaches to each side of an edge, in pixels, with the camera 10 meters up in a
	 * 1080-pixel-tall window. Scales with the drawing buffer and with one over the square root of
	 * camera height, never under one pixel. The same for the whole frame.
	 */
	public width = 1.2;
	/** The black-and-white impact frame to draw over this frame (the camera's), or null. */
	public impact:ImpactFrame | null = null;

	private readonly _target:THREE.WebGLRenderTarget;
	private readonly _material:THREE.ShaderMaterial;
	private readonly _quad:THREE.Mesh;
	private readonly _camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
	private readonly _ink = new THREE.Color();
	private _impactAt:THREE.Vector3 | null = null;

	constructor() {
		this._target = new THREE.WebGLRenderTarget(1, 1, {
			type: THREE.HalfFloatType,
			depthTexture: new THREE.DepthTexture(1, 1, THREE.FloatType),
		});
		this._material = new THREE.ShaderMaterial({
			vertexShader: VERTEX,
			fragmentShader: FRAGMENT,
			depthTest: false,
			depthWrite: false,
			uniforms: {
				tColor: { value: this._target.texture },
				tDepth: { value: this._target.depthTexture },
				uTexel: { value: new THREE.Vector2() },
				uWidth: { value: 1 },
				uInk: { value: this._ink },
				uNear: { value: 0.1 },
				uFar: { value: 100 },
				uFogNear: { value: 1e6 },
				uFogFar: { value: 1e6 + 1 },
				uImpact: { value: 0 },
				uImpactAt: { value: new THREE.Vector2() },
				uImpactPoint: { value: new THREE.Vector3() },
				uProjectionInverse: { value: new THREE.Matrix4() },
				uCameraWorld: { value: new THREE.Matrix4() },
				uImpactInvert: { value: 0 },
				uImpactSeed: { value: 0 },
				uAspect: { value: 1 },
			},
		});
		this._quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._material);
		this._quad.frustumCulled = false;
	}

	/** GPU bytes of the offscreen color and depth. */
	public get memory():number {
		return this.enabled ? this._target.width * this._target.height * (8 + 4) : 0;
	}

	public setSize(width:number, height:number):void {
		if (this._target.width !== width || this._target.height !== height) {
			this._target.setSize(width, height);
		}
	}

	public render(gl:THREE.WebGLRenderer, scene:THREE.Scene, camera:THREE.PerspectiveCamera):void {
		if (!this.enabled) {
			gl.setRenderTarget(null);
			gl.render(scene, camera);
			return;
		}
		gl.setRenderTarget(this._target);
		gl.render(scene, camera);
		gl.setRenderTarget(null);
		const u = this._material.uniforms;
		(u.uTexel!.value as THREE.Vector2).set(1 / this._target.width, 1 / this._target.height);
		const cameraHeight = Math.max(1, camera.matrixWorld.elements[13]!);
		u.uWidth!.value = Math.max(1, this.width * this._target.height / REFERENCE_HEIGHT * Math.sqrt(REFERENCE_CAMERA_HEIGHT / cameraHeight));
		this._ink.copy(this.color).convertLinearToSRGB();
		u.uNear!.value = camera.near;
		u.uFar!.value = camera.far;
		const fog = scene.fog as THREE.Fog | null;
		u.uFogNear!.value = fog?.near ?? 1e6;
		u.uFogFar!.value = fog?.far ?? 1e6 + 1;
		this.placeImpact(camera);
		gl.render(this._quad, this._camera);
	}

	/** Where on screen and how deep the impact frame strikes. A new one gets new speed lines. */
	private placeImpact(camera:THREE.PerspectiveCamera):void {
		const u = this._material.uniforms;
		const impact = this.impact;
		u.uImpact!.value = impact ? 1 : 0;
		if (!impact) {
			this._impactAt = null;
			return;
		}
		if (this._impactAt !== impact.at) {
			this._impactAt = impact.at;
			u.uImpactSeed!.value = Math.floor(Math.random() * 1000);
		}
		const ndc = impact.at.clone().project(camera);
		(u.uImpactAt!.value as THREE.Vector2).set(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5);
		(u.uImpactPoint!.value as THREE.Vector3).copy(impact.at);
		(u.uProjectionInverse!.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
		(u.uCameraWorld!.value as THREE.Matrix4).copy(camera.matrixWorld);
		u.uImpactInvert!.value = impact.invert ? 1 : 0;
		u.uAspect!.value = this._target.width / Math.max(1, this._target.height);
	}

	public dispose():void {
		this._target.depthTexture?.dispose();
		this._target.dispose();
		this._material.dispose();
		this._quad.geometry.dispose();
	}
}
