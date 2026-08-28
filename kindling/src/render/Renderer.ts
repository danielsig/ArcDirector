import * as THREE from 'three';
import type { World } from '../core/World.js';
import { Camera } from './Camera.js';

const CLEAR_COLOR = 0x000000;
const _hit = new THREE.Vector3();
const _ndc = new THREE.Vector2();
const _ray = new THREE.Raycaster();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

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

export class Renderer {
	readonly gl:THREE.WebGLRenderer;
	readonly canvas:HTMLCanvasElement;
	private readonly world:World;
	private readonly hemi:THREE.HemisphereLight;
	private readonly fill:THREE.AmbientLight;
	private sun:THREE.DirectionalLight | null = null;
	private disposed = false;
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
		_hit.set(x, y, z).project(cam.native);
		const w = this.canvas.clientWidth;
		const h = this.canvas.clientHeight;
		const onScreen = _hit.x > -1.2 && _hit.x < 1.2 && _hit.y > -1.2 && _hit.y < 1.2;
		const inFront = _hit.z >= -1 && _hit.z <= 1;
		return {
			x: (_hit.x * 0.5 + 0.5) * w,
			y: (-_hit.y * 0.5 + 0.5) * h,
			visible: onScreen && inFront,
		};
	}

	pickGround(ndcX:number, ndcY:number, planeY:number):{ x:number; z:number } | null {
		const cam = this.findCamera();
		if (!cam) {
			return null;
		}
		_ndc.set(ndcX, ndcY);
		_ray.setFromCamera(_ndc, cam.native);
		_plane.constant = -planeY;
		const hit = _ray.ray.intersectPlane(_plane, _hit);
		return hit ? { x: hit.x, z: hit.z } : null;
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
		this.gl.render(this.world.native, cam.native);
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
