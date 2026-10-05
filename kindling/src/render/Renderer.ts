import * as THREE from 'three';
import type { World } from '../core/World.js';
import { Camera } from './Camera.js';

const CLEAR_COLOR = 0x000000;
const hit = new THREE.Vector3();
const ndc = new THREE.Vector2();
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
};

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
	readonly gl:THREE.WebGLRenderer;
	readonly canvas:HTMLCanvasElement;
	/** Normal and metalness maps. Off disposes them from the GPU. */
	detailMaps = true;
	/** Realtime shadow maps. Off disposes light shadow targets. */
	shadows = true;
	private readonly world:World;
	private readonly hemi:THREE.HemisphereLight;
	private readonly fill:THREE.AmbientLight;
	private sun:THREE.DirectionalLight | null = null;
	private disposed = false;
	private readonly stripped = new Set<THREE.Texture>();
	private readonly ro:ResizeObserver | null;

	constructor(world:World) {
		const canvas = document.createElement('canvas');
		canvas.tabIndex = 0;
		canvas.style.display = 'block';
		canvas.style.width = '100%';
		canvas.style.height = '100%';
		canvas.style.outline = 'none';
		this.canvas = canvas;
		this.world = world;
		this.gl = new THREE.WebGLRenderer({
			canvas,
			antialias: true,
		});
		this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.gl.setClearColor(CLEAR_COLOR);
		this.gl.outputColorSpace = THREE.SRGBColorSpace;
		this.gl.toneMapping = THREE.ACESFilmicToneMapping;
		this.gl.toneMappingExposure = 1.15;
		this.gl.shadowMap.enabled = true;
		this.gl.shadowMap.type = THREE.PCFShadowMap;

		world.native.background = new THREE.Color(CLEAR_COLOR);
		world.native.fog = new THREE.Fog(CLEAR_COLOR, 18, 42);

		this.hemi = new THREE.HemisphereLight(0x6a7d98, 0x1a1410, 0.55);
		world.native.add(this.hemi);
		this.fill = new THREE.AmbientLight(0x243044, 0.18);
		world.native.add(this.fill);

		this.ro = typeof ResizeObserver === 'undefined'
			? null
			: new ResizeObserver(() => {
				this.resize();
			});
		this.ro?.observe(canvas);
		this.resize();
	}

	get scene():THREE.Scene {
		return this.world.native;
	}

	applyLook(look:RendererLook):void {
		this.gl.setClearColor(look.background);
		this.world.native.background = new THREE.Color(look.background);
		this.world.native.fog = new THREE.Fog(look.background, look.fogNear, look.fogFar);
		this.gl.toneMappingExposure = look.exposure;
		this.hemi.color.setHex(look.hemiSky);
		this.hemi.groundColor.setHex(look.hemiGround);
		this.hemi.intensity = look.hemiIntensity;
		this.fill.color.setHex(look.fillColor);
		this.fill.intensity = look.fillIntensity;
		if (!look.sun) {
			if (this.sun) {
				this.sun.visible = false;
			}
			return;
		}
		if (!this.sun) {
			this.sun = new THREE.DirectionalLight(look.sun.color, look.sun.intensity);
			this.sun.castShadow = true;
			this.sun.shadow.mapSize.set(2048, 2048);
			this.sun.shadow.bias = -0.0008;
			this.sun.shadow.normalBias = 0.04;
			this.sun.shadow.camera.near = 2;
			this.sun.shadow.camera.far = 70;
			this.sun.shadow.camera.left = -22;
			this.sun.shadow.camera.right = 22;
			this.sun.shadow.camera.top = 22;
			this.sun.shadow.camera.bottom = -22;
			this.sun.shadow.camera.updateProjectionMatrix();
			this.world.native.add(this.sun);
			this.world.native.add(this.sun.target);
		}
		this.sun.color.setHex(look.sun.color);
		this.sun.intensity = look.sun.intensity;
		this.sun.visible = true;
	}

	aimSun(x:number, z:number):void {
		if (!this.sun?.visible) {
			return;
		}
		this.sun.target.position.set(x, 0, z);
		this.sun.position.set(x + 12, 24, z + 8);
		this.sun.target.updateMatrixWorld();
	}

	projectToCanvas(x:number, y:number, z:number):{ x:number; y:number; visible:boolean } {
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

	pickGround(ndcX:number, ndcY:number, planeY:number):{ x:number; z:number } | null {
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

	resize():void {
		const w = Math.max(1, this.canvas.clientWidth);
		const h = Math.max(1, this.canvas.clientHeight);
		this.gl.setSize(w, h, false);
		const cam = this.findCamera();
		if (cam) {
			cam.native.aspect = w / h;
			cam.native.updateProjectionMatrix();
		}
	}

	render():void {
		if (this.disposed) {
			return;
		}
		this.resize();
		const cam = this.findCamera();
		if (!cam) {
			return;
		}
		this.applyQuality();
		this.gl.render(this.world.native, cam.native);
	}

	/** Estimated GPU bytes: framebuffer, shadow maps, and textures on scene materials. */
	graphicsMemory():number {
		this.applyQuality();
		const ctx = this.gl.getContext();
		const w = ctx.drawingBufferWidth;
		const h = ctx.drawingBufferHeight;
		const msaa = ctx.getContextAttributes()?.antialias ? 4 : 1;
		let bytes = w * h * 4 * (msaa + 1) + w * h * 4 * msaa;
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
		this.world.native.traverse((obj) => {
			if ((obj as THREE.Light).isLight) {
				addTarget((obj as LightWithShadow).shadow?.map ?? null);
			}
			if (!(obj as THREE.Mesh).isMesh) {
				return;
			}
			const mats = (obj as THREE.Mesh).material;
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

	private applyQuality():void {
		const shadowsChanged = this.gl.shadowMap.enabled !== this.shadows;
		this.gl.shadowMap.enabled = this.shadows;
		if (shadowsChanged) {
			this.gl.shadowMap.needsUpdate = true;
		}
		if (this.detailMaps && this.stripped.size > 0) {
			for (const tex of this.stripped) {
				tex.needsUpdate = true;
			}
			this.stripped.clear();
		}
		const seen = new Set<THREE.Material>();
		this.world.native.traverse((obj) => {
			const shadow = (obj as THREE.Light).isLight ? (obj as LightWithShadow).shadow : undefined;
			if (shadow?.map && !this.shadows) {
				shadow.map.dispose();
				shadow.map = null;
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
		if (this.stripped.has(tex)) {
			return;
		}
		this.stripped.add(tex);
		tex.dispose();
	}

	dispose():void {
		this.disposed = true;
		this.ro?.disconnect();
		if (this.sun) {
			this.world.native.remove(this.sun);
			this.world.native.remove(this.sun.target);
			this.sun.dispose();
			this.sun = null;
		}
		this.gl.dispose();
		this.canvas.remove();
	}

	findCamera():Camera | undefined {
		for (const go of this.world.objects) {
			const cam = go.getComponent(Camera);
			if (cam?.enabled) {
				return cam;
			}
		}
		return undefined;
	}
}
