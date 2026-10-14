import { Component } from '@arc-director/kindling';
import * as THREE from 'three';
import { Vitals } from './components';

/** A team's colors: the ring's band, and the thin rim round its edge. */
export type TeamColors = { band:number; rim:number };

/** Ring size (m across) and how far it floats off the ground (m). */
const RING_SIZE = 1.1;
const RING_LIFT = 0.03;

const RING_VERTEX = `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// A faint wash of the band color fading out toward the middle, a solid band near the edge, and a
// thin rim outside it.
const RING_FRAGMENT = `
uniform vec3 uBand;
uniform vec3 uRim;
varying vec2 vUv;
void main() {
	float r = length(vUv - 0.5) * 2.0;
	if (r > 1.0) discard;
	float band = smoothstep(0.7, 0.76, r);
	float rim = smoothstep(0.88, 0.92, r);
	float alpha = mix(0.22 * smoothstep(0.2, 0.7, r), 0.85, band) * (1.0 - smoothstep(0.97, 1.0, r));
	gl_FragColor = vec4(mix(uBand, uRim, rim), alpha);
	#include <colorspace_fragment>
}
`;

/** A ring on the ground under a character in its team's colors, so each side reads at a glance. Gone while it is down. */
export class TeamRing extends Component {
	public colors:TeamColors = { band: 0xffffff, rim: 0x000000 };

	private _ring:THREE.Mesh | null = null;

	public override onEnable():void {
		const material = new THREE.ShaderMaterial({
			vertexShader: RING_VERTEX,
			fragmentShader: RING_FRAGMENT,
			uniforms: { uBand: { value: new THREE.Color(this.colors.band) }, uRim: { value: new THREE.Color(this.colors.rim) } },
			transparent: true,
			depthWrite: false,
			toneMapped: false,
			polygonOffset: true,
			polygonOffsetFactor: -2,
		});
		const ring = new THREE.Mesh(new THREE.PlaneGeometry(RING_SIZE, RING_SIZE).rotateX(-Math.PI / 2), material);
		ring.position.y = RING_LIFT;
		ring.castShadow = false;
		ring.receiveShadow = false;
		this.gameObject.transform.object3D.add(ring);
		this._ring = ring;
	}

	public override update():void {
		if (this._ring) {
			this._ring.visible = (this.gameObject.getComponent(Vitals)?.hp ?? 1) > 0;
		}
	}

	public override onDisable():void {
		if (this._ring) {
			this._ring.removeFromParent();
			this._ring.geometry.dispose();
			(this._ring.material as THREE.Material).dispose();
			this._ring = null;
		}
	}
}
