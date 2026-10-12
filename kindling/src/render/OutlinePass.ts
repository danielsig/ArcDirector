import * as THREE from 'three';

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
uniform vec2 uStep;
uniform vec3 uInk;
uniform float uNear;
uniform float uFar;
uniform float uFogNear;
uniform float uFogFar;
varying vec2 vUv;

float distanceAt(vec2 uv) {
	return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar);
}

void main() {
	vec4 color = texture2D(tColor, vUv);
	float edge = 0.0;
	if (color.a > 0.5) {
		float z = distanceAt(vUv);
		vec2 dx = vec2(uStep.x, 0.0);
		vec2 dy = vec2(0.0, uStep.y);
		// 1/z is linear across any flat surface on screen, so its Laplacian is zero
		// on planes and spikes at silhouettes (negative on the near side) and creases.
		float lap = (1.0 / distanceAt(vUv - dx) + 1.0 / distanceAt(vUv + dx)
			+ 1.0 / distanceAt(vUv - dy) + 1.0 / distanceAt(vUv + dy) - 4.0 / z) * z;
		// Next to a surface that opts out (alpha 0), ink only the near side.
		float clean = min(
			min(texture2D(tColor, vUv - dx).a, texture2D(tColor, vUv + dx).a),
			min(texture2D(tColor, vUv - dy).a, texture2D(tColor, vUv + dy).a)
		);
		float e = clean > 0.5 ? abs(lap) : max(-lap, 0.0);
		edge = smoothstep(0.015, 0.05, e) * (1.0 - smoothstep(uFogNear, uFogFar, z));
	}
	gl_FragColor = vec4(color.rgb, 1.0);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	gl_FragColor.rgb = mix(gl_FragColor.rgb, uInk, edge);
}
`;

/** Window height the outline `width` is given at. */
const REFERENCE_HEIGHT = 1080;

/**
 * Screen-space ink outlines from scene depth: one offscreen render plus one fullscreen pass,
 * so outlines cost no extra draw calls per object. Tone mapping and color space happen here.
 */
export class OutlinePass {
	public enabled = true;
	/** Ink color (sRGB hex as authored). */
	public readonly color = new THREE.Color(0x23170f);
	/** Line width in pixels at a 1080-pixel-tall window; scales with the drawing buffer. */
	public width = 2.2;

	private readonly _target:THREE.WebGLRenderTarget;
	private readonly _material:THREE.ShaderMaterial;
	private readonly _quad:THREE.Mesh;
	private readonly _camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
	private readonly _ink = new THREE.Color();

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
				uStep: { value: new THREE.Vector2() },
				uInk: { value: this._ink },
				uNear: { value: 0.1 },
				uFar: { value: 100 },
				uFogNear: { value: 1e6 },
				uFogFar: { value: 1e6 + 1 },
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
		const px = Math.max(1, this.width * this._target.height / REFERENCE_HEIGHT);
		(u.uStep!.value as THREE.Vector2).set(px / this._target.width, px / this._target.height);
		this._ink.copy(this.color).convertLinearToSRGB();
		u.uNear!.value = camera.near;
		u.uFar!.value = camera.far;
		const fog = scene.fog as THREE.Fog | null;
		u.uFogNear!.value = fog?.near ?? 1e6;
		u.uFogFar!.value = fog?.far ?? 1e6 + 1;
		gl.render(this._quad, this._camera);
	}

	public dispose():void {
		this._target.depthTexture?.dispose();
		this._target.dispose();
		this._material.dispose();
		this._quad.geometry.dispose();
	}
}
