import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { yawToward } from '../core/math.js';

export type LightKind = 'point' | 'directional' | 'spot';

// A cookie lights only what it covers: outside its square, or nearer than the spot's `shadowNear`, is dark.
THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin.replace(
	'directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;',
	'directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : vec3( 0.0 );',
);

type Point = { x:number; y:number; z:number };

/**
 * Aims a spot at `from` to light only through an opening, its corners `through`: the yaw and pitch that face it, the
 * cone round it, a {@link polygonCookie} cut to the opening as the spot sees it, and a `shadowNear` just short of it,
 * so the spot shines through whatever stands between and lights none of it. Set far off, its rays come near
 * parallel, as the moon's do.
 */
export function spotThrough(from:Point, through:readonly Point[]):Pick<Light, 'angle' | 'cookie' | 'shadowNear'> & { yaw:number; pitch:number } {
	const eye = new THREE.Vector3(from.x, from.y, from.z);
	const center = through.reduce((sum:THREE.Vector3, p) => sum.add(new THREE.Vector3(p.x, p.y, p.z)), new THREE.Vector3()).divideScalar(through.length);
	const forward = center.sub(eye).normalize();
	const right = new THREE.Vector3().crossVectors(forward, THREE.Object3D.DEFAULT_UP).normalize();
	const up = new THREE.Vector3().crossVectors(right, forward);
	let near = Infinity;
	// Each corner as the spot sees it: across and up, per meter ahead.
	const seen = through.map((p) => {
		const d = new THREE.Vector3(p.x, p.y, p.z).sub(eye);
		const depth = d.dot(forward);
		near = Math.min(near, depth);
		return { x: d.dot(right) / depth, y: d.dot(up) / depth };
	});
	// The cone just holds every corner.
	const spread = Math.max(...seen.map((c) => Math.hypot(c.x, c.y))) * 1.02;
	return {
		yaw: yawToward(forward.x, forward.z),
		pitch: Math.atan2(forward.y, Math.hypot(forward.x, forward.z)),
		angle: Math.atan(spread),
		cookie: polygonCookie(seen.map((c) => ({ x: c.x / spread, y: c.y / spread }))),
		shadowNear: near - FRAME_SHORT,
	};
}

/** How far short of its opening a {@link spotThrough} spot's light and shadow begin, in meters. */
const FRAME_SHORT = 0.02;

/** Texels a side of a {@link polygonCookie}, and how many of them its edges fade over. */
const COOKIE_RES = 128;
const COOKIE_SOFT = 1.5;

/** The convex hull of `points`, counterclockwise (Andrew's monotone chain). */
function hull(points:readonly { x:number; y:number }[]):{ x:number; y:number }[] {
	const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
	const turn = (o:{ x:number; y:number }, a:{ x:number; y:number }, b:{ x:number; y:number }):number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
	const half = (list:{ x:number; y:number }[]):{ x:number; y:number }[] => {
		const out:{ x:number; y:number }[] = [];
		for (const p of list) {
			while (out.length >= 2 && turn(out[out.length - 2]!, out[out.length - 1]!, p) <= 0) {
				out.pop();
			}
			out.push(p);
		}
		return out.slice(0, -1);
	};
	return [...half(sorted), ...half([...sorted].reverse())];
}

/**
 * A spot light cookie lighting only inside the convex shape round `points` (across and up its square, −1 to 1 each
 * way), its edges softened a little. Light through an opening seen at a slant.
 */
export function polygonCookie(points:readonly { x:number; y:number }[]):THREE.DataTexture {
	const edges = hull(points);
	const data = new Uint8Array(COOKIE_RES * COOKIE_RES * 4);
	for (let y = 0; y < COOKIE_RES; y++) {
		for (let x = 0; x < COOKIE_RES; x++) {
			const px = ((x + 0.5) / COOKIE_RES) * 2 - 1;
			const py = ((y + 0.5) / COOKIE_RES) * 2 - 1;
			// How far inside the nearest edge, in texels (negative outside).
			let inside = Infinity;
			edges.forEach((a, i) => {
				const b = edges[(i + 1) % edges.length]!;
				const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
				inside = Math.min(inside, ((b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x)) / len * COOKIE_RES / 2);
			});
			const v = Math.round(THREE.MathUtils.clamp(inside / COOKIE_SOFT + 0.5, 0, 1) * 255);
			data.set([v, v, v, 255], (y * COOKIE_RES + x) * 4);
		}
	}
	const tex = new THREE.DataTexture(data, COOKIE_RES, COOKIE_RES, THREE.RGBAFormat);
	tex.magFilter = THREE.LinearFilter;
	tex.minFilter = THREE.LinearFilter;
	tex.needsUpdate = true;
	return tex;
}

export class Light extends Component {
	public kind:LightKind = 'point';
	public color = 0xff9a4a;
	public intensity = 48;
	public range = 11;
	public decay = 2;
	/** A spot light's cone: half its width (radians), and how much of its rim fades (0 hard, 1 soft). */
	public angle = Math.PI / 6;
	public penumbra = 0.5;
	/**
	 * A spot light's cookie: a picture cast across its cone (as a square over it, up toward world up), its colors
	 * tinting what it lights, black blocking, and nothing outside it or nearer than `shadowNear` lit at all. Shapes a
	 * spot past round: light through a doorway, a grate.
	 */
	public cookie:THREE.Texture | null = null;
	/**
	 * Wants a shadow, sized by the renderer's `pointShadowMapSize` or `directionalShadowMapSize`. A point light gets one
	 * only while it is among the renderer's nearest `maxPointShadows`; a spot light always does.
	 */
	public castShadow = true;
	/**
	 * A point or spot light's shadow skips what is nearer than this (m): its own lamp or bowl would shade everything
	 * around it, and a spot set far back shines through what stands between.
	 */
	public shadowNear = 0.1;
	/** Local offset. Z is along Kindling forward (−Z). */
	public offsetX = 0;
	public offsetY = 0;
	public offsetZ = 0;
	public native:THREE.Light | null = null;

	private _target:THREE.Object3D | null = null;

	public override onEnable():void {
		this.ensureNative();
		if (this.native) {
			this.native.visible = true;
		}
		this.syncNative();
	}

	public override onDisable():void {
		if (this.native) {
			this.native.visible = false;
		}
	}

	public override update(dt:number):void {
		this.syncNative();
	}

	public override onDestroy():void {
		this.dropNative();
	}

	private ensureNative():void {
		if (this.native && this.kindMatches()) {
			return;
		}
		this.dropNative();
		if (this.kind === 'directional') {
			const d = new THREE.DirectionalLight(this.color, this.intensity);
			d.name = 'castLight';
			d.castShadow = this.castShadow;
			this.gameObject.transform.object3D.add(d);
			this._target = d.target;
			this.gameObject.world?.native.add(d.target);
			this.native = d;
		}
		else if (this.kind === 'spot') {
			const s = new THREE.SpotLight(this.color, this.intensity, this.range, this.angle, this.penumbra, this.decay);
			s.name = 'castLight';
			s.castShadow = false;
			s.shadow.bias = 0;
			s.shadow.normalBias = 0.04;
			this.gameObject.transform.object3D.add(s);
			this._target = s.target;
			this.gameObject.world?.native.add(s.target);
			this.native = s;
		}
		else {
			const p = new THREE.PointLight(this.color, this.intensity, this.range, this.decay);
			p.name = 'castLight';
			p.castShadow = false;
			// No depth bias: a perspective depth map's precision falls with distance, so a fixed depth bias lifted far
			// shadows half a meter off their casters' feet. A normal bias is the same few centimetres everywhere.
			p.shadow.bias = 0;
			p.shadow.normalBias = 0.04;
			this.gameObject.transform.object3D.add(p);
			this.native = p;
		}
	}

	private kindMatches():boolean {
		if (!this.native) {
			return false;
		}
		if (this.kind === 'directional') {
			return this.native instanceof THREE.DirectionalLight;
		}
		if (this.kind === 'spot') {
			return this.native instanceof THREE.SpotLight;
		}
		return this.native instanceof THREE.PointLight;
	}

	private syncNative():void {
		this.ensureNative();
		const lamp = this.native;
		if (!lamp) {
			return;
		}
		lamp.color.setHex(this.color);
		lamp.intensity = this.intensity * (this.gameObject.world?.lightLevel ?? 1);
		if (lamp instanceof THREE.PointLight || lamp instanceof THREE.SpotLight) {
			lamp.userData.wantsShadow = this.castShadow;
		}
		else if (lamp instanceof THREE.DirectionalLight) {
			lamp.castShadow = this.castShadow;
		}
		lamp.visible = this.enabled;
		lamp.position.set(this.offsetX, this.offsetY, -this.offsetZ);
		if (lamp instanceof THREE.PointLight) {
			lamp.distance = this.range;
			lamp.decay = this.decay;
			const cam = lamp.shadow.camera;
			if (cam.near !== this.shadowNear) {
				cam.near = this.shadowNear;
				cam.updateProjectionMatrix();
			}
			cam.far = this.range + 0.1;
		}
		if (lamp instanceof THREE.SpotLight) {
			lamp.distance = this.range;
			lamp.decay = this.decay;
			lamp.angle = this.angle;
			lamp.penumbra = this.penumbra;
			lamp.map = this.cookie;
			const cam = lamp.shadow.camera;
			if (cam.near !== this.shadowNear) {
				cam.near = this.shadowNear;
				cam.updateProjectionMatrix();
			}
			// Along the object's forward, from the lamp itself.
			const f = this.gameObject.transform.forward;
			lamp.getWorldPosition(lamp.target.position).add(new THREE.Vector3(f.x, f.y, f.z));
			lamp.target.updateMatrixWorld();
		}
		if (lamp instanceof THREE.DirectionalLight) {
			const xf = this.gameObject.transform;
			const f = xf.forward;
			lamp.target.position.set(
				xf.position.x + f.x,
				xf.position.y + f.y,
				xf.position.z + f.z,
			);
			lamp.target.updateMatrixWorld();
		}
	}

	private dropNative():void {
		this.native?.removeFromParent();
		this._target?.removeFromParent();
		this.native = null;
		this._target = null;
	}
}
