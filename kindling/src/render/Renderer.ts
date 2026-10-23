import * as THREE from 'three';
import type { World } from '../core/World.js';
import { Camera } from './Camera.js';
import { OutlinePass } from './OutlinePass.js';
import { ShadowCache, type ShadowMode, type ShadowSettings } from './ShadowCache.js';
import { updateCapsuleShadows } from './capsuleShadows.js';

const CLEAR_COLOR = 0x000000;
const hit = new THREE.Vector3();
const ndc = new THREE.Vector2();
const bufferSize = new THREE.Vector2();
const ray = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

export type RendererLook = {
	background:number;
	fogNear:number;
	fogFar:number;
	exposure:number;
	hemiSky:number;
	hemiGround:number;
	hemiIntensity:number;
	fillColor:number;
	fillIntensity:number;
	sun?:{
		color:number;
		intensity:number;
	};
	/** Outline ink. Omitted keeps the current one. */
	ink?:number;
};

/** What the last frame cost the GPU, plus the average frame time. */
export type RenderStats = {
	/** Draw calls in the last frame. */
	calls:number;
	triangles:number;
	/** Geometries and textures alive on the GPU. */
	geometries:number;
	textures:number;
	/** Estimated GPU bytes of the drawing buffers, which scale with window size. */
	framebufferMemory:number;
	/** Estimated GPU bytes of shadow maps, mesh geometry, and material textures. */
	sceneMemory:number;
	/** Average ms between rendered frames over the last {@link FRAME_WINDOW_MS}. */
	frameMS:number;
	/** Average ms between rendered frames over the last second: steady cost, without old stalls. */
	frameMSNow:number;
};

const FRAME_WINDOW_MS = 30_000;

const DETAIL_STASH = 'kindlingDetailMaps';

type DetailStash = {
	normalMap:THREE.Texture | null;
	metalnessMap:THREE.Texture | null;
	metalness:number | undefined;
};

type LightWithShadow = THREE.Light & { shadow?:THREE.LightShadow };

function textureBytes(tex:THREE.Texture):number {
	const img = tex.image as { width?:number; height?:number; naturalWidth?:number; naturalHeight?:number } | undefined;
	const w = img?.naturalWidth ?? img?.width ?? 0;
	const h = img?.naturalHeight ?? img?.height ?? 0;
	if (w < 1 || h < 1) {
		return 0;
	}
	let bytes = w * h * 4;
	const mip = tex.generateMipmaps
		&& tex.minFilter !== THREE.NearestFilter
		&& tex.minFilter !== THREE.LinearFilter;
	if (mip) {
		bytes = (bytes * 4 / 3) | 0;
	}
	return bytes;
}

export class Renderer {
	public readonly gl:THREE.WebGLRenderer;
	public readonly canvas:HTMLCanvasElement;
	/** Normal and metalness maps. Off disposes them from the GPU. */
	public detailMaps = true;
	/** See {@link ShadowCache}: still casters are baked per light, moving ones drawn live (`dynamic`) or not at all (`static`). */
	public shadows:ShadowMode = 'dynamic';
	/** World XZ box the sun's shadow map covers (see `ShadowSettings.sunArea`); null frames every still caster. */
	public sunArea:ShadowSettings['sunArea'] = null;
	/** Where moving things cast the sun's shadow, into their own map `sunMoverSize` square (`ShadowSettings.sunFocus`). */
	public sunFocus:ShadowSettings['sunFocus'] = null;
	public sunMoverSize = 2048;
	/** Shadow map side for point lights, and for directional lights (the sun covers far more ground). Clamped to what the GPU allows. */
	public pointShadowMapSize = 256;
	public directionalShadowMapSize = 1024;
	/**
	 * Most point lights casting shadows at once, nearest the camera first. Each one costs a texture unit in every
	 * lit shader, and too many fail to compile (everything renders black).
	 */
	public maxPointShadows = 8;
	/**
	 * Point lights whose shadows also show moving things (`dynamic` only), nearest where the camera looks first
	 * among those with one in range. The sun always does.
	 */
	public maxMovingShadows = 8;
	/** Ink outlines. Disabled renders straight to the canvas. */
	public readonly outline = new OutlinePass();

	private readonly _shadowCache:ShadowCache;
	private readonly _scene:World;
	private readonly _hemi:THREE.HemisphereLight;
	private readonly _fill:THREE.AmbientLight;
	private readonly _stripped = new Set<THREE.Texture>();
	private readonly _ro:ResizeObserver | null;
	private _sun:THREE.DirectionalLight | null = null;
	private _disposed = false;
	/** Render timestamps inside the frame window, oldest first from `_frameHead`. */
	private readonly _frames:number[] = [];
	private _frameHead = 0;

	constructor(world:World) {
		const canvas = document.createElement('canvas');
		canvas.tabIndex = 0;
		canvas.style.display = 'block';
		canvas.style.width = '100%';
		canvas.style.height = '100%';
		canvas.style.outline = 'none';
		this.canvas = canvas;
		this._scene = world;
		this.gl = new THREE.WebGLRenderer({
			canvas,
			antialias: false,
		});
		this.gl.info.autoReset = false;
		this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.gl.setClearColor(CLEAR_COLOR);
		this.gl.outputColorSpace = THREE.SRGBColorSpace;
		this.gl.toneMapping = THREE.ACESFilmicToneMapping;
		this.gl.toneMappingExposure = 1.15;
		this.gl.shadowMap.enabled = true;
		this.gl.shadowMap.type = THREE.PCFShadowMap;
		this._shadowCache = new ShadowCache(this.gl);

		world.native.background = new THREE.Color(CLEAR_COLOR);
		world.native.fog = new THREE.Fog(CLEAR_COLOR, 18, 42);

		this._hemi = new THREE.HemisphereLight(0x6a7d98, 0x1a1410, 0.55);
		world.native.add(this._hemi);
		this._fill = new THREE.AmbientLight(0x243044, 0.18);
		world.native.add(this._fill);

		this._ro = typeof ResizeObserver === 'undefined'
			? null
			: new ResizeObserver(() => {
				this.resize();
			});
		this._ro?.observe(canvas);
		this.resize();
	}

	public get scene():THREE.Scene {
		return this._scene.native;
	}

	public applyLook(look:RendererLook):void {
		this.gl.setClearColor(look.background);
		this._scene.native.background = new THREE.Color(look.background);
		this._scene.native.fog = new THREE.Fog(look.background, look.fogNear, look.fogFar);
		this.gl.toneMappingExposure = look.exposure;
		this._hemi.color.setHex(look.hemiSky);
		this._hemi.groundColor.setHex(look.hemiGround);
		const level = this._scene.lightLevel;
		this._hemi.intensity = look.hemiIntensity * level;
		this._fill.color.setHex(look.fillColor);
		this._fill.intensity = look.fillIntensity * level;
		if (look.ink !== undefined) {
			this.outline.color.setHex(look.ink);
		}
		if (!look.sun) {
			if (this._sun) {
				this._sun.visible = false;
			}
			return;
		}
		if (!this._sun) {
			this._sun = new THREE.DirectionalLight(look.sun.color, look.sun.intensity);
			this._sun.castShadow = true;
			this._sun.shadow.bias = -0.0008;
			this._sun.shadow.normalBias = 0.04;
			this._sun.shadow.camera.near = 2;
			this._sun.shadow.camera.far = 70;
			this._sun.shadow.camera.left = -22;
			this._sun.shadow.camera.right = 22;
			this._sun.shadow.camera.top = 22;
			this._sun.shadow.camera.bottom = -22;
			this._sun.shadow.camera.updateProjectionMatrix();
			this._shadowCache.placeSun(this._sun);
			this._scene.native.add(this._sun);
			this._scene.native.add(this._sun.target);
		}
		this._sun.color.setHex(look.sun.color);
		this._sun.intensity = look.sun.intensity;
		this._sun.visible = true;
	}

	public projectToCanvas(x:number, y:number, z:number):{ x:number; y:number; visible:boolean } {
		const cam = this.findCamera();
		if (!cam) {
			return { x: 0, y: 0, visible: false };
		}
		hit.set(x, y, z).project(cam.native);
		const w = this.canvas.clientWidth;
		const h = this.canvas.clientHeight;
		const onScreen = hit.x > -1.2 && hit.x < 1.2 && hit.y > -1.2 && hit.y < 1.2;
		const inFront = hit.z >= -1 && hit.z <= 1;
		return {
			x: (hit.x * 0.5 + 0.5) * w,
			y: (-hit.y * 0.5 + 0.5) * h,
			visible: onScreen && inFront,
		};
	}

	public pickGround(ndcX:number, ndcY:number, planeY:number):{ x:number; z:number } | null {
		const cam = this.findCamera();
		if (!cam) {
			return null;
		}
		ndc.set(ndcX, ndcY);
		ray.setFromCamera(ndc, cam.native);
		plane.constant = -planeY;
		const point = ray.ray.intersectPlane(plane, hit);
		return point ? { x: point.x, z: point.z } : null;
	}

	public resize():void {
		const w = Math.max(1, this.canvas.clientWidth);
		const h = Math.max(1, this.canvas.clientHeight);
		this.gl.setSize(w, h, false);
		const buffer = this.gl.getDrawingBufferSize(bufferSize);
		this.outline.setSize(buffer.x, buffer.y);
		const cam = this.findCamera();
		if (cam) {
			cam.native.aspect = w / h;
			cam.native.updateProjectionMatrix();
		}
	}

	public render():void {
		if (this._disposed) {
			return;
		}
		this.resize();
		const cam = this.findCamera();
		if (!cam) {
			return;
		}
		this.applyQuality();
		this._shadowCache.update(this._scene.native, cam.native, {
			mode: this.shadows,
			maxPointShadows: this.maxPointShadows,
			maxMovingShadows: this.maxMovingShadows,
			sunArea: this.sunArea,
			sunFocus: this.sunFocus,
			sunMoverSize: this.sunMoverSize,
		}, this._sun);
		// `static` maps leave moving things out; capsules stand in for them, blocking every light that reaches them.
		updateCapsuleShadows(this.shadows === 'static' ? this._shadowCache.moving : [], cam.native);
		this.gl.info.reset();
		this.outline.impact = cam.impactFrame;
		this.outline.render(this.gl, this._scene.native, cam.native);
		this.markFrame(performance.now());
	}

	public stats():RenderStats {
		const info = this.gl.info;
		return {
			calls: info.render.calls,
			triangles: info.render.triangles,
			geometries: info.memory.geometries,
			textures: info.memory.textures,
			framebufferMemory: this.framebufferMemory(),
			sceneMemory: this.sceneMemory(),
			frameMS: this.frameMS(),
			frameMSNow: this.frameMS(1000),
		};
	}

	/** Estimated GPU bytes in use: {@link framebufferMemory} plus {@link sceneMemory}. */
	public graphicsMemory():number {
		return this.framebufferMemory() + this.sceneMemory();
	}

	/** Estimated GPU bytes of the drawing buffers (color, multisample, depth). */
	public framebufferMemory():number {
		const ctx = this.gl.getContext();
		const w = ctx.drawingBufferWidth;
		const h = ctx.drawingBufferHeight;
		const msaa = ctx.getContextAttributes()?.antialias ? 4 : 1;
		return w * h * 4 * (msaa + 1) + w * h * 4 * msaa + this.outline.memory;
	}

	/** Estimated GPU bytes of shadow maps, mesh geometry, and textures on scene materials. */
	public sceneMemory():number {
		this.applyQuality();
		let bytes = 0;
		const seen = new Set<object>();
		const addTex = (tex:THREE.Texture | null | undefined):void => {
			if (!tex || seen.has(tex)) {
				return;
			}
			seen.add(tex);
			bytes += textureBytes(tex);
		};
		const addTarget = (rt:THREE.RenderTarget | null | undefined):void => {
			if (!rt || seen.has(rt)) {
				return;
			}
			seen.add(rt);
			const faces = rt instanceof THREE.WebGLCubeRenderTarget ? 6 : 1;
			const layer = rt.width * rt.height * 4 * faces;
			bytes += layer;
			if (rt.depthTexture) {
				bytes += layer;
			}
		};
		const addAttribute = (attr:THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null | undefined):void => {
			const array = attr && ('data' in attr ? attr.data : attr);
			if (!array || seen.has(array)) {
				return;
			}
			seen.add(array);
			bytes += array.array.byteLength;
		};
		const addGeometry = (geo:THREE.BufferGeometry):void => {
			if (seen.has(geo)) {
				return;
			}
			seen.add(geo);
			addAttribute(geo.index);
			for (const attr of Object.values(geo.attributes)) {
				addAttribute(attr);
			}
		};
		for (const rt of this._shadowCache.targets()) {
			addTarget(rt);
		}
		this._scene.native.traverse((obj) => {
			if ((obj as THREE.Light).isLight) {
				addTarget((obj as LightWithShadow).shadow?.map ?? null);
			}
			if (!(obj as THREE.Mesh).isMesh) {
				return;
			}
			const mesh = obj as THREE.Mesh;
			addGeometry(mesh.geometry);
			if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
				addAttribute((mesh as THREE.InstancedMesh).instanceMatrix);
				addAttribute((mesh as THREE.InstancedMesh).instanceColor);
			}
			const mats = mesh.material;
			for (const mat of (Array.isArray(mats) ? mats : [mats])) {
				const std = mat as THREE.MeshStandardMaterial;
				addTex(std.map);
				addTex(std.normalMap);
				addTex(std.metalnessMap);
				addTex(std.roughnessMap);
				addTex(std.aoMap);
				addTex(std.emissiveMap);
				addTex(std.alphaMap);
				addTex(std.bumpMap);
			}
		});
		return bytes;
	}

	private markFrame(now:number):void {
		const frames = this._frames;
		frames.push(now);
		while (frames[this._frameHead]! < now - FRAME_WINDOW_MS) {
			this._frameHead++;
		}
		if (this._frameHead > 1024) {
			frames.splice(0, this._frameHead);
			this._frameHead = 0;
		}
	}

	/** Average ms between rendered frames over the last `windowMS` (at most {@link FRAME_WINDOW_MS}). Cheap, unlike {@link stats}. */
	public frameMS(windowMS = FRAME_WINDOW_MS):number {
		const frames = this._frames;
		const last = frames[frames.length - 1];
		if (last === undefined) {
			return 0;
		}
		let first = frames.length - 1;
		while (first > this._frameHead && frames[first - 1]! >= last - windowMS) {
			first--;
		}
		const count = frames.length - 1 - first;
		return count < 1 ? 0 : (last - frames[first]!) / count;
	}

	private applyQuality():void {
		const on = this.shadows !== 'off';
		const shadowsChanged = this.gl.shadowMap.enabled !== on;
		this.gl.shadowMap.enabled = on;
		if (shadowsChanged) {
			this.gl.shadowMap.needsUpdate = true;
		}
		if (this.detailMaps && this._stripped.size > 0) {
			for (const tex of this._stripped) {
				tex.needsUpdate = true;
			}
			this._stripped.clear();
		}
		const seen = new Set<THREE.Material>();
		this._scene.native.traverse((obj) => {
			const shadow = (obj as THREE.Light).isLight ? (obj as LightWithShadow).shadow : undefined;
			// The shadow cache sizes the sun's parts itself.
			if (shadow && !obj.userData.sunPart) {
				const size = Math.min(this.gl.capabilities.maxTextureSize,
					(obj as THREE.DirectionalLight).isDirectionalLight ? this.directionalShadowMapSize : this.pointShadowMapSize);
				if (shadow.mapSize.x !== size || !on) {
					shadow.mapSize.set(size, size);
					this._shadowCache.drop(obj as THREE.Light);
				}
			}
			if (!(obj as THREE.Mesh).isMesh) {
				return;
			}
			const mats = (obj as THREE.Mesh).material;
			for (const mat of (Array.isArray(mats) ? mats : [mats])) {
				if (seen.has(mat)) {
					continue;
				}
				seen.add(mat);
				this.applyDetailMaps(mat);
				if (shadowsChanged) {
					mat.needsUpdate = true;
				}
			}
		});
	}

	private applyDetailMaps(mat:THREE.Material):void {
		const std = mat as THREE.MeshStandardMaterial;
		if (!('normalMap' in std) && !('metalnessMap' in std)) {
			return;
		}
		if (this.detailMaps) {
			const stash = std.userData[DETAIL_STASH] as DetailStash | undefined;
			if (!stash) {
				return;
			}
			if (stash.normalMap) {
				std.normalMap = stash.normalMap;
				std.normalMap.needsUpdate = true;
			}
			if (stash.metalnessMap) {
				std.metalnessMap = stash.metalnessMap;
				std.metalnessMap.needsUpdate = true;
				if (stash.metalness !== undefined) {
					std.metalness = stash.metalness;
				}
			}
			delete std.userData[DETAIL_STASH];
			std.needsUpdate = true;
			return;
		}
		const stash = (std.userData[DETAIL_STASH] as DetailStash | undefined) ?? {
			normalMap: null,
			metalnessMap: null,
			metalness: undefined,
		};
		let changed = false;
		if (std.normalMap) {
			stash.normalMap = std.normalMap;
			this.stripTexture(std.normalMap);
			std.normalMap = null;
			changed = true;
		}
		if (std.metalnessMap) {
			stash.metalnessMap = std.metalnessMap;
			stash.metalness = std.metalness;
			this.stripTexture(std.metalnessMap);
			std.metalnessMap = null;
			std.metalness = 0;
			changed = true;
		}
		std.userData[DETAIL_STASH] = stash;
		if (changed) {
			std.needsUpdate = true;
		}
	}

	private stripTexture(tex:THREE.Texture):void {
		if (this._stripped.has(tex)) {
			return;
		}
		this._stripped.add(tex);
		tex.dispose();
	}

	public dispose():void {
		this._disposed = true;
		this._ro?.disconnect();
		if (this._sun) {
			this._scene.native.remove(this._sun);
			this._scene.native.remove(this._sun.target);
			this._sun.dispose();
			this._sun = null;
		}
		this._shadowCache.dispose();
		this.outline.dispose();
		this.gl.dispose();
		this.canvas.remove();
	}

	public findCamera():Camera | undefined {
		for (const go of this._scene.objects) {
			const cam = go.getComponent(Camera);
			if (cam?.enabled) {
				return cam;
			}
		}
		return undefined;
	}
}
