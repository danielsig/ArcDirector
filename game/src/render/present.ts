import * as THREE from 'three';
import { Chest, Door, HumanBody, HUMAN_KINDS, HumanSprite, RigidBody, Torch, Bridge, type HumanKind } from '../engine/components';
import { MeshRenderer } from '../engine/MeshRenderer';
import { yawToForward, yawToward } from '../engine/math';
import type { World } from '../engine/World';
import type { GameObject } from '../engine/GameObject';
import { buildChunkMesh, CHUNK_MESH_REV } from './buildChunkMesh';
import { ensureHeldSprites, HUMAN_PLANE_H, HUMAN_PLANE_W, HUMAN_SPRITE_SIZE, PLAYER_SPRITE_SIZE, PLAYER_SPRITE_SLIM } from './meshRegistry';
import { getSheet, sheetReady } from './spritesheet';
import {
	getHumanAnims,
	pickClockMaps,
	pickPocketMaps,
	snapWalkHour,
	walkFrameIndex,
	type IdleHour,
	type WalkHour,
} from './humanAnims';
import { natureReady, tickNature, untrackNature } from './nature';
import { createGroundBox } from './groundBox';
import { disposeGrassBatch, syncGrassBatch } from './grassBatch';
import { nearestPickup } from '../items/pickup';
import { slotItem } from '../items/inventory';
import { handsAt, SWORD_HILT, swordClockHour } from './attachPoints';
import { getSwordMaps } from './swordAnims';

const worldPos = new THREE.Vector3();
const camPos = new THREE.Vector3();
const camRight = new THREE.Vector3();
const camQuat = new THREE.Quaternion();

/** Sprite, door, chunk, and glow presentation on Kindling's scene graph. */
export class WorldPresent {
	private camera:THREE.Camera = new THREE.PerspectiveCamera();
	private host:THREE.Scene | null = null;
	private readonly chunkMeshes = new Map<string, THREE.Group>();
	private readonly liveChunks = new Set<string>();
	private chunkMeshRev = CHUNK_MESH_REV;
	private groundHadGrass = false;
	private groundBox:THREE.Group | null = null;
	private pickupGlow:THREE.Mesh | null = null;
	private pickupGlowMap:THREE.CanvasTexture | null = null;
	private camPitch = 0;

	mountGroundBox(world:World):void {
		if (!sheetReady()) {
			return;
		}
		const grass = natureReady();
		if (this.groundBox && this.groundHadGrass === grass) {
			return;
		}
		if (this.groundBox) {
			this.releaseObject(this.groundBox);
			this.groundBox = null;
		}
		try {
			this.groundBox = createGroundBox(world);
			this.groundHadGrass = grass;
			world.native.add(this.groundBox);
		}
		catch {
			this.groundBox = null;
		}
	}

	syncChunks(world:World):void {
		if (!sheetReady()) {
			return;
		}
		if (worldNeedsNature(world) && !natureReady()) {
			return;
		}
		if (this.chunkMeshRev !== CHUNK_MESH_REV) {
			for (const mesh of this.chunkMeshes.values()) {
				this.releaseObject(mesh);
			}
			this.chunkMeshes.clear();
			this.chunkMeshRev = CHUNK_MESH_REV;
		}
		this.liveChunks.clear();
		for (const chunk of world.chunks.values()) {
			this.liveChunks.add(chunk.id);
			if (!this.chunkMeshes.has(chunk.id)) {
				const mesh = buildChunkMesh(chunk);
				world.native.add(mesh);
				this.chunkMeshes.set(chunk.id, mesh);
			}
		}
		for (const [id, mesh] of this.chunkMeshes) {
			if (!this.liveChunks.has(id)) {
				this.releaseObject(mesh);
				this.chunkMeshes.delete(id);
			}
		}
		syncGrassBatch(world.native, world);
	}

	sync(world:World, camera:THREE.Camera):void {
		this.host = world.native;
		this.camera = camera;
		this.camera.getWorldPosition(camPos);
		this.camera.getWorldQuaternion(camQuat);
		const e = new THREE.Euler().setFromQuaternion(camQuat, 'YXZ');
		this.camPitch = e.x;
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
			if (kind === 'human') {
				obj.rotation.y = -yaw;
				this.syncHuman(obj, go);
			}
			else if (kind === 'torch') {
				obj.rotation.y = -yaw;
				this.syncTorch(obj, go);
			}
			else if (kind === 'item') {
				obj.rotation.y = -yaw;
				this.syncItem(obj, go === focus, world.time);
			}
			else if (kind === 'door') {
				obj.rotation.y = 0;
				const door = go.getComponent(Door);
				const hinge = obj.userData.hinge as THREE.Object3D | undefined;
				if (hinge && door) {
					hinge.rotation.y = door.open ? door.openYaw : door.closedYaw;
				}
				const occ = obj.getObjectByName('doorOccluder');
				if (occ && door) {
					occ.visible = !door.open;
				}
			}
			else if (kind === 'bridge') {
				obj.rotation.y = 0;
				const span = go.getComponent(Bridge);
				const hinge = obj.userData.hinge as THREE.Object3D | undefined;
				if (hinge && span) {
					hinge.rotation.x = span.open ? 0 : -Math.PI / 2;
				}
			}
			else if (kind === 'cottage') {
				obj.rotation.y = 0;
				this.syncCottageRoof(obj, go, world);
			}
			else if (kind === 'chest') {
				obj.rotation.y = 0;
				const chest = go.getComponent(Chest);
				const lid = obj.getObjectByName('lid');
				if (lid && chest) {
					lid.rotation.x = chest.open ? -1.15 : 0;
				}
			}
			else {
				obj.rotation.y = 0;
			}
			if (go === focus) {
				focusObj = obj;
			}
		}
		this.syncPickupGlow(focusObj, world.time);
	}

	tickNature(time:number):void {
		tickNature(time);
	}

	dispose():void {
		for (const mesh of this.chunkMeshes.values()) {
			this.releaseObject(mesh);
		}
		this.chunkMeshes.clear();
		if (this.groundBox) {
			this.releaseObject(this.groundBox);
			this.groundBox = null;
		}
		disposeGrassBatch();
		if (this.pickupGlow) {
			const mat = this.pickupGlow.material as THREE.MeshBasicMaterial;
			mat.map?.dispose();
			this.releaseObject(this.pickupGlow);
			this.pickupGlow = null;
			this.pickupGlowMap = null;
		}
	}

	private releaseObject(obj:THREE.Object3D):void {
		const ao = obj.userData.aoMap as THREE.Texture | undefined;
		if (ao) {
			ao.dispose();
			obj.userData.aoMap = undefined;
		}
		this.host?.remove(obj);
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

	private syncCottageRoof(obj:THREE.Object3D, go:GameObject, world:World):void {
		const roof = obj.userData.roof as THREE.Object3D | undefined;
		if (!roof) {
			return;
		}
		const player = world.findByID('Player');
		const hw = (obj.userData.roofHalfW as number | undefined) ?? 3;
		const hd = (obj.userData.roofHalfD as number | undefined) ?? 2.5;
		const p = go.transform.position;
		const under = !!player
			&& Math.abs(player.transform.position.x - p.x) <= hw
			&& Math.abs(player.transform.position.z - p.z) <= hd;
		const opacity = under ? 0.2 : 1;
		roof.traverse((child) => {
			if (!(child instanceof THREE.Mesh)) {
				return;
			}
			const mat = child.material;
			if (Array.isArray(mat) || !(mat instanceof THREE.MeshStandardMaterial)) {
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

	private camRightXZ():THREE.Vector3 | null {
		camRight.set(1, 0, 0).applyQuaternion(camQuat);
		camRight.y = 0;
		if (camRight.lengthSq() < 1e-8) {
			return null;
		}
		return camRight.normalize();
	}

	private viewAngle(yaw:number, x:number, z:number):{ deg:number } {
		const right = this.camRightXZ();
		const fwd = yawToForward(yaw);
		const dx = camPos.x - x;
		const dz = camPos.z - z;
		const len = Math.hypot(dx, dz);
		const toward = len < 1e-4 ? 0 : (fwd.x * dx + fwd.z * dz) / len;
		const side = right ? fwd.x * right.x + fwd.z * right.z : 0;
		return { deg: Math.atan2(side, toward) * (180 / Math.PI) };
	}

	/** Twelve idle views: 1–6 and 12 authored, 7–11 as FlipX of 5–1. */
	private idleFacing(yaw:number, x:number, z:number):{ hour:IdleHour; flip:number } {
		const deg = this.viewAngle(yaw, x, z).deg;
		const a = Math.abs(deg);
		const bins:IdleHour[] = [6, 5, 4, 3, 2, 1, 12];
		const i = Math.min(6, Math.round(a / 30));
		const hour = bins[i];
		// Front and back are the same drawing on both sides. FlipX only
		// mirrors the normal map, so a torch on the right shades the left.
		const flip = hour === 6 || hour === 12 ? 1 : (deg < 0 ? -1 : 1);
		return { hour, flip };
	}

	/** Six walk views: 12/2/4/6 from art, 8/10 as FlipX of 4/2. */
	private walkFacing(yaw:number, x:number, z:number):{ hour:WalkHour; flip:number } {
		const deg = this.viewAngle(yaw, x, z).deg;
		if (deg > -30 && deg <= 30) {
			return { hour: 6, flip: 1 };
		}
		if (deg > 30 && deg <= 90) {
			return { hour: 4, flip: 1 };
		}
		if (deg > 90 && deg <= 150) {
			return { hour: 2, flip: 1 };
		}
		if (deg > 150 || deg <= -150) {
			return { hour: 12, flip: 1 };
		}
		if (deg > -150 && deg <= -90) {
			return { hour: 2, flip: -1 };
		}
		return { hour: 4, flip: -1 };
	}

	private isIdleHour(hour:number):hour is IdleHour {
		return hour === 1 || hour === 2 || hour === 3 || hour === 4
			|| hour === 5 || hour === 6 || hour === 12;
	}

	private syncHuman(obj:THREE.Object3D, go:GameObject):void {
		const sprite = obj.userData.sprite as THREE.Mesh | undefined;
		if (!sprite) {
			return;
		}
		const appearance = go.getComponent(HumanSprite);
		const kind = appearance?.kind ?? ((obj.userData.animID as string | undefined) ?? 'player');
		const anims = getHumanAnims(kind);
		const rb = go.getComponent(RigidBody);
		const speed = rb ? Math.hypot(rb.velocity.x, rb.velocity.z) : 0;
		const clip = appearance?.clip ?? 'auto';
		const pocket = clip === 'take' || clip === 'give';
		const walking = !pocket && (clip === 'walk' || (clip === 'auto' && speed > 0.35));
		const yaw = walking && rb && speed > 0.35
			? yawToward(rb.velocity.x, rb.velocity.z)
			: go.transform.yaw;
		const p = go.transform.position;
		const t = go.world?.time ?? 0;
		const fps = appearance?.walkFps ?? 8;
		const offset = appearance?.animOffset ?? 0;
		const clock = anims.clock;
		let maps = clock.idle[6];
		let flip = 1;
		let hour:IdleHour = 6;
		if (pocket && appearance) {
			maps = pickPocketMaps(clock, clip, appearance.clipT0, t, appearance.takeFps)
				?? pickClockMaps(clock, 6, false, t, fps, offset);
			flip = appearance.flip ? appearance.flip : 1;
		}
		else {
			const autoView = walking
				? this.walkFacing(yaw, p.x, p.z)
				: this.idleFacing(yaw, p.x, p.z);
			const locked = appearance?.hour ?? 0;
			hour = this.isIdleHour(locked)
				? (walking ? snapWalkHour(locked) : locked)
				: autoView.hour;
			flip = appearance?.flip ? appearance.flip : autoView.flip;
			maps = pickClockMaps(clock, hour, walking, t, fps, offset);
		}
		sprite.receiveShadow = true;
		const mat = sprite.material as THREE.MeshLambertMaterial;
		if (mat.map !== maps.map || mat.normalMap !== maps.nrm) {
			mat.map = maps.map;
			mat.normalMap = maps.nrm;
			mat.needsUpdate = true;
		}
		const img = maps.map.image as HTMLCanvasElement | undefined;
		const aspect = img && img.height > 0 ? img.width / img.height : 0.64;
		const pitch = Math.abs(this.camPitch);
		const unflat = 1 / Math.max(Math.cos(pitch), 0.45);
		const size = kind === 'player' ? PLAYER_SPRITE_SIZE : HUMAN_SPRITE_SIZE;
		const slim = kind === 'player' ? PLAYER_SPRITE_SLIM : 1;
		sprite.scale.x = flip * (HUMAN_PLANE_H * aspect * size * slim) / HUMAN_PLANE_W;
		sprite.scale.y = unflat * size;
		// Y-billboard feet sit at the origin, which is the far rim of the ground
		// blob from a 40° camera. Pull the card toward the camera so boots land
		// in the shadow; tiny Y sink covers the 1–2px pack pad.
		obj.getWorldPosition(worldPos);
		const toCamX = camPos.x - worldPos.x;
		const toCamZ = camPos.z - worldPos.z;
		const toCam = Math.hypot(toCamX, toCamZ) || 1;
		const lead = 0.11;
		sprite.position.set(
			(toCamX / toCam) * lead,
			HUMAN_PLANE_H * sprite.scale.y * 0.5 - 0.02,
			(toCamZ / toCam) * lead,
		);
		this.billboardY(sprite);
		const walkHour = snapWalkHour(hour);
		const walkCount = clock.walk[walkHour]?.length ?? 0;
		const frame = walking ? walkFrameIndex(t, fps, walkCount, offset) : 0;
		this.syncHeldSwords(sprite, go, kind, hour, walking, frame);
	}

	private syncHeldSwords(
		sprite:THREE.Mesh,
		go:GameObject,
		kind:string,
		hour:IdleHour,
		walking:boolean,
		walkFrame:number,
	):void {
		let leftMesh = sprite.getObjectByName('heldLeft') as THREE.Mesh | undefined;
		let rightMesh = sprite.getObjectByName('heldRight') as THREE.Mesh | undefined;
		if (!leftMesh || !rightMesh) {
			ensureHeldSprites(sprite);
			leftMesh = sprite.getObjectByName('heldLeft') as THREE.Mesh | undefined;
			rightMesh = sprite.getObjectByName('heldRight') as THREE.Mesh | undefined;
			if (!leftMesh || !rightMesh) {
				return;
			}
		}
		const body = go.getComponent(HumanBody);
		const leftItem = body ? slotItem(body, 'hands.left.held') : null;
		const rightItem = body ? slotItem(body, 'hands.right.held') : null;
		const twoHand = !!(leftItem && leftItem === rightItem);
		const bodyKind:HumanKind = (HUMAN_KINDS as readonly string[]).includes(kind)
			? kind as HumanKind
			: 'player';
		this.placeHeldSword(sprite, leftMesh, bodyKind, hour, leftItem?.meshID, 'left', !twoHand, walking, walkFrame);
		this.placeHeldSword(sprite, rightMesh, bodyKind, hour, rightItem?.meshID, 'right', true, walking, walkFrame);
	}

	private placeHeldSword(
		sprite:THREE.Mesh,
		mesh:THREE.Mesh,
		kind:HumanKind,
		hour:IdleHour,
		meshID:string | undefined,
		side:'left' | 'right',
		include:boolean,
		walking:boolean,
		walkFrame:number,
	):void {
		const show = include && meshID === 'item_sword';
		mesh.visible = show;
		if (!show) {
			return;
		}
		const clockHour = swordClockHour(hour);
		const maps = getSwordMaps(clockHour);
		if (!maps) {
			mesh.visible = false;
			return;
		}
		const mat = mesh.material as THREE.MeshLambertMaterial;
		if (mat.map !== maps.map || mat.normalMap !== maps.nrm) {
			mat.map = maps.map;
			mat.normalMap = maps.nrm;
			mat.needsUpdate = true;
		}
		const charImg = (sprite.material as THREE.MeshLambertMaterial).map?.image as HTMLCanvasElement | undefined;
		const swordImg = maps.map.image as HTMLCanvasElement | undefined;
		if (!charImg?.width || !charImg.height || !swordImg?.width || !swordImg.height) {
			return;
		}
		const mpp = HUMAN_PLANE_H / charImg.height;
		const sw = swordImg.width * mpp;
		const sh = swordImg.height * mpp;
		mesh.scale.set(sw, sh, 1);
		const hands = handsAt(kind, hour, walking, walkFrame);
		const hand = side === 'left' ? hands.left : hands.right;
		const hilt = SWORD_HILT[clockHour];
		const hx = (hand.x / charImg.width - 0.5) * HUMAN_PLANE_W;
		const hy = (0.5 - hand.y / charImg.height) * HUMAN_PLANE_H;
		const ox = (hilt.x / swordImg.width - 0.5) * sw;
		const oy = (0.5 - hilt.y / swordImg.height) * sh;
		mesh.position.set(hx - ox, hy - oy, 0.02);
	}

	private syncTorch(obj:THREE.Object3D, go:GameObject):void {
		const holster = obj.getObjectByName('holsterRig');
		if (holster) {
			holster.rotation.y = go.transform.yaw;
		}
		const flame = obj.userData.flame as THREE.Mesh | undefined;
		if (!flame) {
			return;
		}
		const torch = go.getComponent(Torch);
		const sheet = getSheet();
		const n = sheet.flame.length;
		const t = go.world?.time ?? 0;
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

	private syncItem(obj:THREE.Object3D, highlighted:boolean, t:number):void {
		const sprite = obj.userData.sprite as THREE.Mesh | undefined;
		if (!sprite) {
			return;
		}
		this.billboardY(sprite);
		const pitch = Math.abs(this.camPitch);
		const unflat = 1 / Math.max(Math.cos(pitch), 0.45);
		const pulse = highlighted ? 1.04 + Math.sin(t * 3.4) * 0.03 : 1;
		sprite.scale.x = pulse;
		sprite.scale.y = unflat * pulse;
		const h = (obj.userData.itemH as number | undefined) ?? 0.36;
		sprite.position.y = h * unflat * 0.5 + 0.02;
		const mat = sprite.material as THREE.MeshLambertMaterial;
		if (highlighted) {
			mat.emissive.setHex(0xd4b45c);
			mat.emissiveIntensity = 0.24 + (0.5 + 0.5 * Math.sin(t * 3.4)) * 0.22;
		}
		else {
			mat.emissive.setHex(0x000000);
			mat.emissiveIntensity = 0;
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
		if (this.pickupGlow) {
			return this.pickupGlow;
		}
		this.pickupGlowMap = makePickupGlowMap();
		const mat = new THREE.MeshBasicMaterial({
			map: this.pickupGlowMap,
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
		this.host?.add(mesh);
		this.pickupGlow = mesh;
		return mesh;
	}
}

function worldNeedsNature(world:World):boolean {
	for (const chunk of world.chunks.values()) {
		for (const tile of chunk.tiles) {
			if (
				tile.def === 'grass'
				|| tile.def === 'water'
				|| tile.def === 'wood_wall'
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
