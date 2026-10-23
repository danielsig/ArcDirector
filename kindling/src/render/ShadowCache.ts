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
	/**
	 * World XZ box the sun's map covers (the playable map, say), so its texels are not spread over scenery far off.
	 * Unset: every still caster.
	 */
	sunArea?:Area | null;
	/**
	 * `dynamic` only: the square (centre and half its side) where moving things cast the sun's shadow, drawn every
	 * frame into a map `sunMoverSize` square of their own, so the sun's map holds still casters only and is never
	 * copied per frame. Unset: they draw over a live copy of the sun's whole map instead.
	 */
	sunFocus?:{ x:number; z:number; half:number } | null;
	sunMoverSize?:number;
};

/** World XZ box, meters. */
export type Area = { minX:number; maxX:number; minZ:number; maxZ:number };

/**
 * Every directional light is shadowed by every directional shadow map together. The sun keeps a map of its still
 * casters, and a dark helper light the cache adds beside it (which casts but gives no light) keeps the moving
 * casters' map; outside its own area a map reads as unshadowed, so together they shadow the sun as one map would.
 */
THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin
	.replace('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )', `#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	float sunShadow = 1.0;
	DirectionalLightShadow sunPart;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		sunPart = directionalLightShadows[ i ];
		sunShadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], sunPart.shadowMapSize, sunPart.shadowIntensity, sunPart.shadowBias, sunPart.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
#endif

#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )`)
	.replace(
		'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;',
		'directLight.color *= directLight.visible ? sunShadow : 1.0;',
	);

/** How far below and above the ground the mover map reaches, in meters. */
const MOVER_DEPTH = { below: 3, above: 12 };

function areaKey(area:Area | null | undefined):string {
	return area ? `${area.minX},${area.maxX},${area.minZ},${area.maxZ}` : '';
}

/** A dark directional light that only casts: the moving part of the sun's shadow (`ShadowSettings.sunFocus`). */
function sunPart(sun:THREE.DirectionalLight):THREE.DirectionalLight {
	const light = new THREE.DirectionalLight(0x000000, 0);
	light.castShadow = true;
	light.shadow.bias = sun.shadow.bias;
	light.shadow.normalBias = sun.shadow.normalBias;
	light.userData.sunPart = true;
	return light;
}

/** Frames a caster holds still before it is baked into the still maps. */
const SETTLE_FRAMES = 12;
/** Marks moving casters, so the live pass draws only them. */
const MOVING_LAYER = 31;
/** From the ground toward the sun. */
const SUN_DIR = new THREE.Vector3(12, 24, 8).normalize();
/** Meters nearer another lamp must be before it takes a casting lamp's place. */
const LAMP_STAY = 3;
/** Meters a lamp moves before its still map bakes again. */
const LAMP_MOVED = 0.1;
/** Meters of slack around the still scene in the sun's map. */
const SUN_PAD = 1;

type ShadowLight = THREE.PointLight | THREE.SpotLight | THREE.DirectionalLight;

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
	/** The sun area the sun's map was last framed to, as a key. */
	private _sunArea = '';
	/**
	 * Dark point lights far below the world, padding the scene's point lights (and shadowed ones) up to the most it
	 * has had, so chunks streaming lamps in and out never change the counts shaders are compiled for.
	 */
	private readonly _spares:THREE.PointLight[] = [];
	private _pointHigh = 0;
	/** Point lights that cast, and that drew moving casters, last frame. */
	private _casting = new Set<THREE.PointLight>();
	private _busy = new Set<THREE.PointLight>();
	private _shadowHigh = 0;
	/** Helper light drawing moving casters round the focus, `dynamic` only. */
	private _mover:THREE.DirectionalLight | null = null;
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
			// Lights this cache does not keep render as three would.
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
		const spots:THREE.SpotLight[] = [];
		const moving:THREE.Mesh[] = [];
		const changed:THREE.Sphere[] = [];
		const eyeAt = focusOf(eye);
		let points = 0;
		scene.traverseVisible((o) => {
			if (o instanceof THREE.PointLight && o.userData.spare) {
				return;
			}
			if (o instanceof THREE.PointLight) {
				points++;
				o.castShadow = false;
				if (o.userData.wantsShadow) {
					const at = o.getWorldPosition(new THREE.Vector3());
					// A lamp that cast last frame keeps its place unless another is clearly nearer, so small steps of the
					// camera never swap which lamps cast (and bake again).
					lamps.push({ lamp: o, at, d: at.distanceTo(eyeAt) - (this._casting.has(o) ? LAMP_STAY : 0) });
				}
			}
			else if (o instanceof THREE.DirectionalLight) {
				if (o.castShadow && !o.userData.sunPart) {
					suns.push(o);
				}
			}
			else if (o instanceof THREE.SpotLight) {
				o.castShadow = !!o.userData.wantsShadow;
				if (o.castShadow) {
					spots.push(o);
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
		const dynamic = settings.mode === 'dynamic';
		this.syncParts(scene, sun, settings, dynamic);
		lamps.sort((x, y) => x.d - y.d);
		// The sun's mover map takes a texture unit a point shadow would have used.
		const casting = lamps.slice(0, Math.max(0, settings.maxPointShadows - (this._mover ? 1 : 0)));
		// Lamps that drew moving casters last frame go first, so a character's shadow does not hop between lamps.
		const busy = new Set(!dynamic ? [] : casting
			.filter(({ lamp, at }) => moving.some((m) => m.getWorldPosition(moverAt).distanceTo(at) < reachOf(lamp) + 1))
			.sort((x, y) => (this._busy.has(y.lamp) ? 1 : 0) - (this._busy.has(x.lamp) ? 1 : 0))
			.slice(0, settings.maxMovingShadows)
			.map((c) => c.lamp));
		this._casting = new Set(casting.map((c) => c.lamp));
		this._busy = busy;
		const bake:ShadowLight[] = [];
		const live:ShadowLight[] = [];
		for (const { lamp, at } of casting) {
			lamp.castShadow = true;
			const maps = this.mapsOf(lamp, frame);
			// A flickering lamp jitters a centimetre or so; it bakes again only once it has truly moved.
			if (!maps.still || maps.at.distanceTo(at) > LAMP_MOVED || changed.some((s) => s.distanceToPoint(at) < reachOf(lamp))) {
				maps.at.copy(at);
				bake.push(lamp);
			}
			if (busy.has(lamp)) {
				live.push(lamp);
			}
		}
		this.padLights(scene, points, casting.length, Math.max(0, settings.maxPointShadows - (this._mover ? 1 : 0)), frame, bake);
		const area = settings.sunArea ?? null;
		const areaMoved = areaKey(area) !== this._sunArea;
		this._sunArea = areaKey(area);
		for (const light of suns) {
			const maps = this.mapsOf(light, frame);
			if (!maps.still || changed.length > 0 || areaMoved) {
				if (light === sun) {
					this.fitSun(light, area);
				}
				bake.push(light);
			}
			if (dynamic && moving.length > 0 && !this._mover) {
				live.push(light);
			}
		}
		// Spot lights are few and placed by hand: each always casts, baked like a lamp.
		for (const spot of spots) {
			const at = spot.getWorldPosition(new THREE.Vector3());
			const maps = this.mapsOf(spot, frame);
			if (!maps.still || maps.at.distanceTo(at) > LAMP_MOVED || changed.some((s) => s.distanceToPoint(at) < reachOf(spot))) {
				maps.at.copy(at);
				bake.push(spot);
			}
			if (dynamic && moving.some((m) => m.getWorldPosition(moverAt).distanceTo(at) < reachOf(spot) + 1)) {
				live.push(spot);
			}
		}
		if (this._mover && settings.sunFocus) {
			const { x, z, half } = settings.sunFocus;
			this.mapsOf(this._mover, frame);
			this.fitBox(this._mover, new THREE.Box3(new THREE.Vector3(x - half, -MOVER_DEPTH.below, z - half), new THREE.Vector3(x + half, MOVER_DEPTH.above, z + half)));
			live.push(this._mover);
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
		for (const spare of this._spares.splice(0)) {
			spare.removeFromParent();
			spare.dispose();
		}
		if (this._mover) {
			this.removePart(this._mover);
			this._mover = null;
		}
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

	/**
	 * Adds the sun's mover map beside `sun` when `dynamic` with a focus, or takes it away. Adding or removing a light
	 * recompiles every lit shader, so a host keeps the focus set for as long as the mode lasts.
	 */
	private syncParts(scene:THREE.Scene, sun:THREE.DirectionalLight | null, settings:ShadowSettings, dynamic:boolean):void {
		const mover = !!sun && dynamic && !!settings.sunFocus;
		if (!mover && this._mover) {
			this.removePart(this._mover);
			this._mover = null;
		}
		if (mover && !this._mover) {
			this._mover = sunPart(sun!);
			scene.add(this._mover, this._mover.target);
		}
		const side = Math.min(settings.sunMoverSize ?? 2048, this._gl.capabilities.maxTextureSize);
		if (this._mover && this._mover.shadow.mapSize.x !== side) {
			this._mover.shadow.mapSize.set(side, side);
			this.drop(this._mover);
		}
	}

	/**
	 * Keeps the scene's point lights at the most it has had (`points` real ones now), and its shadowed point lights at
	 * the most it has had up to `limit` (`casting` real ones now), with spare dark lights far below the world: three
	 * compiles every lit shader for these counts, so a count that drops and rises again freezes the game while it
	 * recompiles. A spare that casts bakes its empty map once.
	 */
	private padLights(scene:THREE.Scene, points:number, casting:number, limit:number, frame:number, bake:ShadowLight[]):void {
		this._shadowHigh = Math.min(limit, Math.max(this._shadowHigh, casting));
		const shadowPad = this._shadowHigh - casting;
		this._pointHigh = Math.max(this._pointHigh, points + shadowPad);
		const spares = this._pointHigh - points;
		while (this._spares.length < spares) {
			const spare = new THREE.PointLight(0x000000, 0, 1);
			spare.position.set(0, -1000, 0);
			spare.userData.spare = true;
			scene.add(spare);
			this._spares.push(spare);
		}
		while (this._spares.length > spares) {
			const spare = this._spares.pop()!;
			this.drop(spare);
			spare.removeFromParent();
			spare.dispose();
		}
		this._spares.forEach((spare, i) => {
			spare.castShadow = i < shadowPad;
			if (spare.castShadow && !this.mapsOf(spare, frame).still) {
				bake.push(spare);
			}
		});
	}

	private removePart(light:THREE.DirectionalLight):void {
		this.drop(light);
		light.removeFromParent();
		light.target.removeFromParent();
		light.dispose();
	}

	/** The box round every baked caster, cut down to `area` on XZ when given. */
	private casterBox(area:Area | null | undefined):THREE.Box3 {
		const box = new THREE.Box3();
		const part = new THREE.Box3();
		for (const caster of this._casters.values()) {
			if (caster.baked) {
				box.union(caster.bounds.getBoundingBox(part));
			}
		}
		if (area) {
			box.intersect(new THREE.Box3(new THREE.Vector3(area.minX, -Infinity, area.minZ), new THREE.Vector3(area.maxX, Infinity, area.maxZ)));
		}
		return box;
	}

	/** Frames every baked caster in the sun's map, seen along {@link SUN_DIR}, cut down to `area` on XZ when given. */
	private fitSun(sun:THREE.DirectionalLight, area:ShadowSettings['sunArea']):void {
		this.fitBox(sun, this.casterBox(area));
	}

	/** Points `light` along {@link SUN_DIR} and frames `box` in its shadow camera. An empty box leaves it as it was. */
	private fitBox(sun:THREE.DirectionalLight, box:THREE.Box3):void {
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

/** How far a point or spot light's shadow reaches. */
function reachOf(lamp:THREE.PointLight | THREE.SpotLight):number {
	return lamp.distance || lamp.shadow.camera.far;
}

function disposeTarget(rt:THREE.WebGLRenderTarget):void {
	rt.depthTexture?.dispose();
	rt.dispose();
}
