import * as THREE from 'three';

/**
 * How shadows render. `off` disposes the maps. `static` casts the still scene only: moving things cast none.
 * `dynamic` also draws moving things (characters, what they hold, anything in motion) every frame, in the
 * sun and the nearest busy point lights.
 */
export type ShadowMode = 'off' | 'static' | 'dynamic';

export type ShadowSettings = {
	mode:ShadowMode;
	/** Most point lights casting at once, nearest where the camera looks first. */
	maxPointShadows:number;
	/** Point lights that also draw moving things (`dynamic` only), nearest first among those with one in range. */
	maxMovingShadows:number;
};

/** Frames a caster holds still before it is baked into the still maps. */
const SETTLE_FRAMES = 12;
/** Marks moving casters, so the live pass draws only them. */
const MOVING_LAYER = 31;
/** From the ground toward the sun. */
const SUN_DIR = new THREE.Vector3(12, 24, 8).normalize();
/** Meters of slack around the still scene in the sun's map. */
const SUN_PAD = 1;

type ShadowLight = THREE.PointLight | THREE.DirectionalLight;

/** A light's still map (static casters only) and live map (still plus moving casters, `dynamic` only). */
type LightMaps = {
	still:THREE.WebGLRenderTarget | null;
	live:THREE.WebGLRenderTarget | null;
	/** Where the light was when `still` was baked. */
	at:THREE.Vector3;
	/** Last frame the light cast; one that stops casting loses its maps. */
	frame:number;
};

/** A caster that is not skinned: where it was, and whether it has held still long enough to be baked. */
type Caster = {
	matrix:THREE.Matrix4;
	bounds:THREE.Sphere;
	still:number;
	baked:boolean;
	frame:number;
};

const moverAt = new THREE.Vector3();

/** Skinned, or held by a skinned model's bone: a character, its gear, a bird. Never baked. */
function isAnimated(o:THREE.Object3D):boolean {
	if ((o as THREE.SkinnedMesh).isSkinnedMesh) {
		return true;
	}
	for (let p = o.parent; p; p = p.parent) {
		if ((p as THREE.Bone).isBone) {
			return true;
		}
	}
	return false;
}

function worldBounds(mesh:THREE.Mesh):THREE.Sphere {
	const batch = mesh as THREE.InstancedMesh;
	if (batch.isInstancedMesh && !batch.boundingSphere) {
		batch.computeBoundingSphere();
	}
	if (!mesh.geometry.boundingSphere) {
		mesh.geometry.computeBoundingSphere();
	}
	const local = (batch.isInstancedMesh ? batch.boundingSphere : mesh.geometry.boundingSphere) ?? new THREE.Sphere();
	return local.clone().applyMatrix4(mesh.matrixWorld);
}

/** Where a camera looks: its view ray on the ground plane (y = 0), else the camera itself. */
function focusOf(eye:THREE.Camera):THREE.Vector3 {
	const at = eye.getWorldPosition(new THREE.Vector3());
	const dir = eye.getWorldDirection(new THREE.Vector3());
	return dir.y < -1e-3 ? at.addScaledVector(dir, -at.y / dir.y) : at;
}

/**
 * Mixed cached shadow maps. Each shadowed light keeps a still map of the casters that hold still, baked
 * again only when one in its reach appears, moves, or goes, or when the light itself moves. A caster in
 * motion (a swinging door, a thrown thing) is a moving caster until it settles, then it is baked in.
 * `static` samples the still maps as they are. `dynamic` copies a still map into the light's live map each
 * frame and draws only the moving casters on top, so the still scene is never redrawn per frame.
 *
 * An `InstancedMesh` counts as one caster: moving its instances does not rebake.
 */
export class ShadowCache {
	private readonly _gl:THREE.WebGLRenderer;
	private readonly _maps = new Map<ShadowLight, LightMaps>();
	private readonly _casters = new Map<THREE.Mesh, Caster>();
	/** Draws only {@link MOVING_LAYER} in the live pass. */
	private readonly _movingEye = new THREE.Camera();
	private _frame = 0;
	/** This frame's work, run inside three's shadow pass (where its light state exists). */
	private _scene:THREE.Scene | null = null;
	private _bake:ShadowLight[] = [];
	private _live:ShadowLight[] = [];
	private _lights:ShadowLight[] = [];
	private _moving:THREE.Object3D[] = [];
	private _readFBO:WebGLFramebuffer | null = null;
	private _drawFBO:WebGLFramebuffer | null = null;

	constructor(gl:THREE.WebGLRenderer) {
		this._gl = gl;
		this._movingEye.layers.set(MOVING_LAYER);
		const pass = gl.shadowMap.render.bind(gl.shadowMap);
		gl.shadowMap.render = (lights, scene, camera):void => {
			if (scene === this._scene) {
				this._scene = null;
				this.renderMaps(pass, scene, camera);
			}
			// Lights this cache does not keep (spot lights) render as three would.
			pass(lights, scene, camera);
		};
	}

	/** Picks this frame's casting lights and moving casters, and which still maps are stale. Call before rendering. */
	public update(scene:THREE.Scene, eye:THREE.Camera, settings:ShadowSettings, sun:THREE.DirectionalLight | null):void {
		this._scene = null;
		if (settings.mode === 'off') {
			// The renderer drops every map while shadows are off.
			return;
		}
		const frame = ++this._frame;
		const lamps:{ lamp:THREE.PointLight; at:THREE.Vector3; d:number }[] = [];
		const suns:THREE.DirectionalLight[] = [];
		const moving:THREE.Mesh[] = [];
		const changed:THREE.Sphere[] = [];
		const eyeAt = focusOf(eye);
		scene.traverseVisible((o) => {
			if (o instanceof THREE.PointLight) {
				o.castShadow = false;
				if (o.userData.wantsShadow) {
					const at = o.getWorldPosition(new THREE.Vector3());
					lamps.push({ lamp: o, at, d: at.distanceToSquared(eyeAt) });
				}
			}
			else if (o instanceof THREE.DirectionalLight) {
				if (o.castShadow) {
					suns.push(o);
				}
			}
			else if ((o as THREE.Mesh).isMesh && o.castShadow && this.track(o as THREE.Mesh, frame, changed)) {
				moving.push(o as THREE.Mesh);
			}
		});
		for (const [mesh, caster] of this._casters) {
			if (caster.frame !== frame) {
				if (caster.baked) {
					changed.push(caster.bounds);
				}
				this._casters.delete(mesh);
			}
		}
		lamps.sort((x, y) => x.d - y.d);
		const casting = lamps.slice(0, settings.maxPointShadows);
		const dynamic = settings.mode === 'dynamic';
		const busy = new Set(!dynamic ? [] : casting
			.filter(({ lamp, at }) => moving.some((m) => m.getWorldPosition(moverAt).distanceTo(at) < reachOf(lamp) + 1))
			.slice(0, settings.maxMovingShadows)
			.map((c) => c.lamp));
		const bake:ShadowLight[] = [];
		const live:ShadowLight[] = [];
		for (const { lamp, at } of casting) {
			lamp.castShadow = true;
			const maps = this.mapsOf(lamp, frame);
			if (!maps.still || maps.at.distanceToSquared(at) > 1e-6 || changed.some((s) => s.distanceToPoint(at) < reachOf(lamp))) {
				maps.at.copy(at);
				bake.push(lamp);
			}
			if (busy.has(lamp)) {
				live.push(lamp);
			}
		}
		for (const light of suns) {
			const maps = this.mapsOf(light, frame);
			if (!maps.still || changed.length > 0) {
				if (light === sun) {
					this.fitSun(light);
				}
				bake.push(light);
			}
			if (dynamic && moving.length > 0) {
				live.push(light);
			}
		}
		for (const [light, maps] of this._maps) {
			if (maps.frame !== frame) {
				this.drop(light);
			}
			else if (!dynamic && maps.live) {
				disposeTarget(maps.live);
				maps.live = null;
			}
		}
		this._scene = scene;
		this._bake = bake;
		this._live = live;
		this._lights = [...this._maps.keys()];
		this._moving = moving;
	}

	/** Places the sun along its fixed direction, before any baked caster gives it the scene to frame. */
	public placeSun(sun:THREE.DirectionalLight):void {
		sun.target.position.set(0, 0, 0);
		sun.position.copy(SUN_DIR).multiplyScalar(30);
	}

	/** This frame's moving casters: skinned models, what they hold, and anything not yet settled. */
	public get moving():readonly THREE.Object3D[] {
		return this._moving;
	}

	/** Every map this cache holds, for memory estimates. */
	public targets():THREE.WebGLRenderTarget[] {
		return [...this._maps.values()].flatMap((m) => [m.still, m.live].filter((t) => t !== null));
	}

	/** Frees `light`'s maps; the next frame it casts bakes them again. */
	public drop(light:THREE.Light):void {
		const shadow = (light as ShadowLight).shadow as THREE.LightShadow | undefined;
		const maps = this._maps.get(light as ShadowLight);
		this._maps.delete(light as ShadowLight);
		if (shadow?.map && shadow.map !== maps?.still && shadow.map !== maps?.live) {
			disposeTarget(shadow.map as THREE.WebGLRenderTarget);
		}
		if (shadow) {
			shadow.map = null;
		}
		if (maps?.still) {
			disposeTarget(maps.still);
		}
		if (maps?.live) {
			disposeTarget(maps.live);
		}
	}

	public dispose():void {
		this.dropAll();
		const gl = this._gl.getContext();
		gl.deleteFramebuffer(this._readFBO);
		gl.deleteFramebuffer(this._drawFBO);
	}

	private dropAll():void {
		for (const light of [...this._maps.keys()]) {
			this.drop(light);
		}
	}

	private mapsOf(light:ShadowLight, frame:number):LightMaps {
		let maps = this._maps.get(light);
		if (!maps) {
			maps = { still: null, live: null, at: new THREE.Vector3(), frame };
			this._maps.set(light, maps);
		}
		maps.frame = frame;
		// Only this cache decides when a map renders.
		light.shadow.autoUpdate = false;
		return maps;
	}

	/** Follows a caster. True while it moves (or is skinned); false once it is baked into the still maps. */
	private track(mesh:THREE.Mesh, frame:number, changed:THREE.Sphere[]):boolean {
		if (isAnimated(mesh)) {
			mesh.layers.enable(MOVING_LAYER);
			return true;
		}
		let caster = this._casters.get(mesh);
		if (!caster) {
			caster = { matrix: mesh.matrixWorld.clone(), bounds: worldBounds(mesh), still: 0, baked: false, frame };
			this._casters.set(mesh, caster);
		}
		else if (!caster.matrix.equals(mesh.matrixWorld)) {
			if (caster.baked) {
				changed.push(caster.bounds);
			}
			caster.matrix.copy(mesh.matrixWorld);
			caster.bounds = worldBounds(mesh);
			caster.still = 0;
			caster.baked = false;
		}
		else if (!caster.baked && ++caster.still >= SETTLE_FRAMES) {
			caster.baked = true;
			changed.push(caster.bounds);
		}
		caster.frame = frame;
		if (caster.baked) {
			mesh.layers.disable(MOVING_LAYER);
		}
		else {
			mesh.layers.enable(MOVING_LAYER);
		}
		return !caster.baked;
	}

	/** Frames every baked caster in the sun's map, seen along {@link SUN_DIR}. */
	private fitSun(sun:THREE.DirectionalLight):void {
		const box = new THREE.Box3();
		const part = new THREE.Box3();
		for (const caster of this._casters.values()) {
			if (caster.baked) {
				box.union(caster.bounds.getBoundingBox(part));
			}
		}
		if (box.isEmpty()) {
			return;
		}
		const center = box.getCenter(new THREE.Vector3());
		sun.target.position.copy(center);
		sun.position.copy(center).addScaledVector(SUN_DIR, box.getSize(new THREE.Vector3()).length() + 1);
		sun.updateMatrixWorld();
		sun.target.updateMatrixWorld();
		const cam = sun.shadow.camera;
		cam.position.copy(sun.position);
		cam.lookAt(center);
		cam.updateMatrixWorld();
		const seen = box.applyMatrix4(cam.matrixWorldInverse);
		cam.left = seen.min.x - SUN_PAD;
		cam.right = seen.max.x + SUN_PAD;
		cam.bottom = seen.min.y - SUN_PAD;
		cam.top = seen.max.y + SUN_PAD;
		cam.near = Math.max(0.1, -seen.max.z - SUN_PAD);
		cam.far = -seen.min.z + SUN_PAD;
		cam.updateProjectionMatrix();
	}

	/** Bakes stale still maps without moving casters, then draws moving casters over live copies of them. */
	private renderMaps(pass:THREE.WebGLShadowMap['render'], scene:THREE.Scene, camera:THREE.Camera):void {
		if (this._bake.length > 0) {
			for (const m of this._moving) {
				m.castShadow = false;
			}
			this.renderInto(pass, this._bake, 'still', scene, camera);
			for (const m of this._moving) {
				m.castShadow = true;
			}
		}
		for (const light of this._lights) {
			light.shadow.map = this._maps.get(light)?.still ?? null;
		}
		if (this._live.length > 0) {
			// Three clears each map before drawing into it; a live map starts as its still map instead.
			const clear = this._gl.clear;
			this._gl.clear = ():void => {
				if (!this.restoreStill()) {
					clear.call(this._gl);
				}
			};
			try {
				this.renderInto(pass, this._live, 'live', scene, this._movingEye);
			}
			finally {
				this._gl.clear = clear;
			}
		}
	}

	/** Three renders (and allocates, when missing) each light's `which` map. */
	private renderInto(pass:THREE.WebGLShadowMap['render'], lights:ShadowLight[], which:'still' | 'live', scene:THREE.Scene, camera:THREE.Camera):void {
		for (const light of lights) {
			light.shadow.map = this._maps.get(light)![which];
			light.shadow.needsUpdate = true;
		}
		pass(lights, scene, camera);
		for (const light of lights) {
			this._maps.get(light)![which] = light.shadow.map as THREE.WebGLRenderTarget;
		}
	}

	/** Copies the bound live map's still map into it (the face three is about to draw). False when it has none. */
	private restoreStill():boolean {
		const live = this._gl.getRenderTarget() as THREE.WebGLRenderTarget | null;
		const face = this._gl.getActiveCubeFace();
		// A live map three just allocated is only on its light so far.
		const light = this._live.find((l) => l.shadow.map === live);
		const still = light && this._maps.get(light)?.still;
		if (!live || !still) {
			return false;
		}
		const gl = this._gl.getContext() as WebGL2RenderingContext;
		const state = this._gl.state;
		const side = live instanceof THREE.WebGLCubeRenderTarget ? gl.TEXTURE_CUBE_MAP_POSITIVE_X + face : gl.TEXTURE_2D;
		// Three keeps a texture's GL handle in its renderer properties.
		const texture = (rt:THREE.WebGLRenderTarget):WebGLTexture => (
			this._gl.properties.get(rt.depthTexture!) as Record<string, WebGLTexture>
		)['__webglTexture']!;
		this._readFBO ??= gl.createFramebuffer();
		this._drawFBO ??= gl.createFramebuffer();
		state.bindFramebuffer(gl.READ_FRAMEBUFFER, this._readFBO);
		gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.DEPTH_ATTACHMENT, side, texture(still), 0);
		state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._drawFBO);
		gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.DEPTH_ATTACHMENT, side, texture(live), 0);
		gl.blitFramebuffer(0, 0, still.width, still.height, 0, 0, live.width, live.height, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
		state.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
		state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
		this._gl.setRenderTarget(live, face);
		return true;
	}
}

/** How far a point light's shadow reaches. */
function reachOf(lamp:THREE.PointLight):number {
	return lamp.distance || lamp.shadow.camera.far;
}

function disposeTarget(rt:THREE.WebGLRenderTarget):void {
	rt.depthTexture?.dispose();
	rt.dispose();
}
