import { Time, type GameObject } from '@arc-director/kindling';
import * as THREE from 'three';
import { Chest, Door, Torch, Bridge } from '../engine/components';
import { MeshRenderer } from '../engine/MeshRenderer';
import type { World } from '../engine/World';
import { buildChunkMesh, CHUNK_MESH_REV } from './buildChunkMesh';
import { getSheet, sheetReady } from './spritesheet';
import { natureReady, tickNature, untrackNature } from './nature';
import { createOutskirts } from './land';
import { LANDFORMS, planOutskirts, type OutskirtHeights, type Surface } from '../world/land';
import type { Chunk } from '../world/Chunk';
import { disposeGrassBatch, syncGrassBatch } from './grassBatch';
import { nearestPickup } from '../items/pickup';
import { THIN_WALLS } from '../world/thinWall';

const worldPos = new THREE.Vector3();
const camPos = new THREE.Vector3();
const camQuat = new THREE.Quaternion();

/** Door, chunk, torch, item, and glow presentation on Kindling's scene graph. */
export class WorldPresent {
	public detailMaps = true;
	private _camera:THREE.Camera = new THREE.PerspectiveCamera();
	private _host:THREE.Scene | null = null;
	private readonly _chunkMeshes = new Map<string, THREE.Group>();
	private readonly _liveChunks = new Set<string>();
	private _chunkMeshRev = CHUNK_MESH_REV;
	private _outskirtsHadNature = false;
	private _outskirts:THREE.Group | null = null;
	private _pickupGlow:THREE.Mesh | null = null;
	private _pickupGlowMap:THREE.CanvasTexture | null = null;
	private _camPitch = 0;

	/** The land past the map's edge, once (again when the river art arrives); `chunks` is every chunk of the scene, loaded or not. */
	public mountOutskirts(world:World, chunks:Chunk[], ground:Surface = 'meadow', heights?:OutskirtHeights):void {
		if (!sheetReady() || chunks.length === 0) {
			return;
		}
		const nature = natureReady();
		if (this._outskirts && this._outskirtsHadNature === nature) {
			return;
		}
		if (this._outskirts) {
			this.releaseObject(this._outskirts);
			this._outskirts = null;
		}
		// Out as far as the fog lets anyone see.
		const fog = world.native.fog as THREE.Fog | null;
		this._outskirts = createOutskirts(planOutskirts(chunks, ground, heights, fog?.far));
		this._outskirtsHadNature = nature;
		world.native.add(this._outskirts);
	}

	public syncChunks(world:World):void {
		if (!sheetReady()) {
			return;
		}
		if (worldNeedsNature(world) && !natureReady()) {
			return;
		}
		if (this._chunkMeshRev !== CHUNK_MESH_REV) {
			for (const mesh of this._chunkMeshes.values()) {
				this.releaseObject(mesh);
			}
			this._chunkMeshes.clear();
			this._chunkMeshRev = CHUNK_MESH_REV;
		}
		this._liveChunks.clear();
		for (const chunk of world.chunks.values()) {
			this._liveChunks.add(chunk.id);
			if (!this._chunkMeshes.has(chunk.id)) {
				const mesh = buildChunkMesh(chunk, world.chunks.values());
				world.native.add(mesh);
				this._chunkMeshes.set(chunk.id, mesh);
			}
		}
		for (const [id, mesh] of this._chunkMeshes) {
			if (!this._liveChunks.has(id)) {
				this.releaseObject(mesh);
				this._chunkMeshes.delete(id);
			}
		}
		syncGrassBatch(world.native, world);
	}

	public sync(world:World, camera:THREE.Camera):void {
		this._host = world.native;
		this._camera = camera;
		this._camera.getWorldPosition(camPos);
		this._camera.getWorldQuaternion(camQuat);
		const e = new THREE.Euler().setFromQuaternion(camQuat, 'YXZ');
		this._camPitch = e.x;
		const player = world.findByID('Player');
		const focus = player ? nearestPickup(player) : null;
		let focusObj:THREE.Object3D | null = null;
		for (const go of world.objects) {
			const mv = go.getComponent(MeshRenderer);
			const obj = mv?.mesh;
			if (!mv || !mv.visible || !obj) {
				continue;
			}
			const kind = obj.userData.kind as string | undefined;
			const yaw = go.transform.yaw;
			if (kind === 'torch') {
				obj.rotation.y = -yaw;
				this.syncTorch(obj, go);
			}
			else if (kind === 'item') {
				obj.rotation.y = -yaw;
				this.syncItem(obj, go, go === focus, Time.time);
			}
			else if (kind === 'door') {
				obj.rotation.y = 0;
				const door = go.getComponent(Door);
				const hinge = obj.userData.hinge as THREE.Object3D | undefined;
				if (hinge && door) {
					hinge.rotation.y = door.open ? door.openYaw : door.closedYaw;
				}
				// A gate's second leaf swings the other way on its own pier.
				const hinge2 = obj.userData.hinge2 as THREE.Object3D | undefined;
				if (hinge2 && door) {
					hinge2.rotation.y = -(door.open ? door.openYaw : door.closedYaw);
				}
				const occ = obj.getObjectByName('doorOccluder');
				if (occ && door) {
					occ.visible = !door.open;
				}
			}
			else if (kind === 'bridge') {
				obj.rotation.y = 0;
				const span = go.getComponent(Bridge);
				const setLift = obj.userData.setLift as ((lift:number)=>void) | undefined;
				if (setLift && span) {
					setLift(span.lift);
				}
			}
			else if (kind === 'house') {
				obj.rotation.y = 0;
				this.syncRoof(obj, go, world);
			}
			else if (kind === 'chest') {
				obj.rotation.y = 0;
				const chest = go.getComponent(Chest);
				// Open, the lid swings up and back on its hinge, a little past upright.
				const lid = obj.getObjectByName('lid');
				if (lid && chest) {
					lid.rotation.x = chest.open ? 1.9 : 0;
				}
			}
			else {
				obj.rotation.y = 0;
			}
			if (go === focus) {
				focusObj = obj;
			}
		}
		this.syncPickupGlow(focusObj, Time.time);
	}

	public tickNature(time:number):void {
		tickNature(time);
	}

	public dispose():void {
		for (const mesh of this._chunkMeshes.values()) {
			this.releaseObject(mesh);
		}
		this._chunkMeshes.clear();
		if (this._outskirts) {
			this.releaseObject(this._outskirts);
			this._outskirts = null;
		}
		disposeGrassBatch();
		if (this._pickupGlow) {
			const mat = this._pickupGlow.material as THREE.MeshBasicMaterial;
			mat.map?.dispose();
			this.releaseObject(this._pickupGlow);
			this._pickupGlow = null;
			this._pickupGlowMap = null;
		}
	}

	private releaseObject(obj:THREE.Object3D):void {
		const ao = obj.userData.aoMap as THREE.Texture | undefined;
		if (ao) {
			ao.dispose();
			obj.userData.aoMap = undefined;
		}
		this._host?.remove(obj);
		obj.removeFromParent();
		obj.traverse((node) => {
			if (node instanceof THREE.Light) {
				node.dispose();
			}
			const mesh = node as THREE.Mesh;
			if (mesh.geometry && !mesh.geometry.userData.shared) {
				mesh.geometry.dispose();
			}
			const mat = mesh.material;
			const list = Array.isArray(mat) ? mat : mat ? [mat] : [];
			for (const m of list) {
				if (m && !m.userData.shared) {
					untrackNature(m);
					m.dispose();
				}
			}
			const clip = node.userData.clipMask as THREE.Texture | undefined;
			if (clip && !clip.userData.shared) {
				clip.dispose();
			}
		});
	}

	private syncRoof(obj:THREE.Object3D, go:GameObject, world:World):void {
		const roof = obj.userData.roof as THREE.Object3D | undefined;
		if (!roof) {
			return;
		}
		const player = world.findByID('Player');
		const hw = (obj.userData.roofHalfW as number | undefined) ?? 2.5;
		const hd = (obj.userData.roofHalfD as number | undefined) ?? 2;
		const p = go.transform.position;
		const under = !!player
			&& Math.abs(player.transform.position.x - p.x) <= hw
			&& Math.abs(player.transform.position.z - p.z) <= hd;
		const opacity = under ? 0.08 : 1;
		roof.traverse((child) => {
			if (!(child instanceof THREE.Mesh)) {
				return;
			}
			const mat = child.material;
			if (Array.isArray(mat)) {
				return;
			}
			if (child.name === 'ceiling') {
				mat.colorWrite = !under;
				mat.depthWrite = !under;
				return;
			}
			const fade = opacity < 1;
			mat.transparent = fade;
			mat.opacity = opacity;
			mat.depthWrite = !fade;
		});
	}

	private billboardY(obj:THREE.Object3D | undefined | null):void {
		if (!obj) {
			return;
		}
		obj.getWorldPosition(worldPos);
		obj.lookAt(camPos.x, worldPos.y, camPos.z);
	}

	private playHeldFlame(flame:THREE.Mesh, lit:boolean, t:number):void {
		flame.visible = lit;
		if (!lit || !sheetReady()) {
			return;
		}
		const frames = getSheet().flame;
		const n = frames.length;
		const map = frames[(Math.floor(t * 10) % n + n) % n];
		const mat = flame.material as THREE.MeshBasicMaterial;
		if (mat.map !== map) {
			mat.map = map;
			mat.needsUpdate = true;
		}
	}

	private syncTorch(obj:THREE.Object3D, go:GameObject):void {
		const holster = obj.getObjectByName('holsterRig');
		if (holster) {
			holster.rotation.y = go.transform.yaw;
		}
		const torch = go.getComponent(Torch);
		const flame = obj.userData.flame as THREE.Mesh | undefined;
		if (!flame) {
			return;
		}
		flame.visible = !torch || torch.lit;
		if (!flame.visible) {
			return;
		}
		const sheet = getSheet();
		const n = sheet.flame.length;
		const t = Time.time;
		const rate = torch?.flickerRate ?? 10;
		const offset = torch?.animOffset ?? 0;
		const frame = Math.floor(t * rate + offset * n) % n;
		const map = sheet.flame[(frame + n) % n];
		const mat = flame.material as THREE.MeshBasicMaterial;
		if (mat.map !== map) {
			mat.map = map;
			mat.needsUpdate = true;
		}
		this.billboardY(flame);
		this.billboardY(obj.getObjectByName('stick'));
	}

	private syncItem(obj:THREE.Object3D, go:GameObject, highlighted:boolean, t:number):void {
		const body = obj.userData.body as THREE.Object3D | undefined;
		if (body) {
			const pulse = highlighted ? 1.04 + Math.sin(t * 3.4) * 0.03 : 1;
			body.scale.setScalar(pulse);
			const shine = obj.userData.shine as THREE.Material[] | undefined;
			for (const mat of shine ?? []) {
				if (!('emissive' in mat) || !('emissiveIntensity' in mat)) {
					continue;
				}
				const lit = mat as THREE.MeshToonMaterial;
				if (highlighted) {
					lit.emissive.setHex(0xd4b45c);
					lit.emissiveIntensity = 0.55 + (0.5 + 0.5 * Math.sin(t * 3.4)) * 0.7;
				}
				else {
					lit.emissive.setHex(0x000000);
					lit.emissiveIntensity = 0;
				}
			}
			return;
		}
		const sprite = obj.userData.sprite as THREE.Mesh | undefined;
		if (!sprite) {
			return;
		}
		this.billboardY(sprite);
		const pitch = Math.abs(this._camPitch);
		const unflat = 1 / Math.max(Math.cos(pitch), 0.45);
		const pulse = highlighted ? 1.04 + Math.sin(t * 3.4) * 0.03 : 1;
		sprite.scale.x = pulse;
		sprite.scale.y = unflat * pulse;
		const h = (obj.userData.itemH as number | undefined) ?? 0.36;
		sprite.position.y = h * unflat * 0.5 + 0.02;
		const mat = sprite.material;
		if (mat instanceof THREE.MeshLambertMaterial) {
			if (highlighted) {
				mat.emissive.setHex(0xd4b45c);
				mat.emissiveIntensity = 0.24 + (0.5 + 0.5 * Math.sin(t * 3.4)) * 0.22;
			}
			else {
				mat.emissive.setHex(0x000000);
				mat.emissiveIntensity = 0;
			}
		}
		const flame = obj.userData.flame as THREE.Mesh | undefined;
		if (flame) {
			this.playHeldFlame(flame, go.getComponent(Torch)?.lit === true, t);
		}
	}

	private syncPickupGlow(focus:THREE.Object3D | null, t:number):void {
		const glow = this.ensurePickupGlow();
		if (!focus) {
			glow.visible = false;
			return;
		}
		glow.visible = true;
		focus.getWorldPosition(worldPos);
		glow.position.copy(worldPos);
		glow.position.y += 0.04;
		const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
		glow.scale.setScalar(0.92 + pulse * 0.1);
		const mat = glow.material as THREE.MeshBasicMaterial;
		mat.opacity = 0.72 + pulse * 0.28;
	}

	private ensurePickupGlow():THREE.Mesh {
		if (this._pickupGlow) {
			return this._pickupGlow;
		}
		this._pickupGlowMap = makePickupGlowMap();
		const mat = new THREE.MeshBasicMaterial({
			map: this._pickupGlowMap,
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			toneMapped: false,
			side: THREE.DoubleSide,
		});
		const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95), mat);
		mesh.rotation.x = -Math.PI / 2;
		mesh.renderOrder = 2;
		mesh.frustumCulled = false;
		this._host?.add(mesh);
		this._pickupGlow = mesh;
		return mesh;
	}
}

function worldNeedsNature(world:World):boolean {
	for (const chunk of world.chunks.values()) {
		for (const tile of chunk.tiles) {
			if (
				tile.def === 'grass'
				|| tile.def === 'water'
				|| THIN_WALLS.has(tile.def)
				|| LANDFORMS.has(tile.def)
				|| tile.def === 'plank'
			) {
				return true;
			}
		}
	}
	return false;
}

function makePickupGlowMap():THREE.CanvasTexture {
	const size = 128;
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		return new THREE.CanvasTexture(canvas);
	}
	const cx = size / 2;
	const cy = size / 2;
	const fill = ctx.createRadialGradient(cx, cy, 8, cx, cy, 62);
	fill.addColorStop(0, 'rgba(255, 244, 196, 0.72)');
	fill.addColorStop(0.42, 'rgba(232, 196, 110, 0.28)');
	fill.addColorStop(1, 'rgba(180, 130, 50, 0)');
	ctx.fillStyle = fill;
	ctx.fillRect(0, 0, size, size);
	ctx.beginPath();
	ctx.arc(cx, cy, 40, 0, Math.PI * 2);
	ctx.strokeStyle = 'rgba(255, 236, 180, 0.95)';
	ctx.lineWidth = 3.2;
	ctx.stroke();
	ctx.beginPath();
	ctx.arc(cx, cy, 33, 0, Math.PI * 2);
	ctx.strokeStyle = 'rgba(255, 250, 230, 0.32)';
	ctx.lineWidth = 1.25;
	ctx.stroke();
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}
