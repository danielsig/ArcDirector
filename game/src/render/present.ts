import * as THREE from 'three';
import { HurtFlash, Chest, Door, HumanBody, HumanSprite, RigidBody, Torch, Bridge, Vitals, type HumanKind } from '../engine/components';
import { MeshRenderer } from '../engine/MeshRenderer';
import { yawToForward } from '../engine/math';
import type { World } from '../engine/World';
import type { GameObject } from '../engine/GameObject';
import { buildChunkMesh, CHUNK_MESH_REV } from './buildChunkMesh';
import { ensureHeldFlame, ensureHeldSprites, HUMAN_PLANE_H, HUMAN_PLANE_W } from './meshRegistry';
import { getSheet, sheetReady, unlitSpriteMaterial } from './spritesheet';
import {
	getHumanAnims,
	hasHumanAnims,
	hourFromViewDeg,
	pickClockMaps,
	pickPocketMaps,
	resolveClockHour,
	snapWalkHour,
	walkFrameIndex,
	type ClockAnims,
	type ClockHour,
	type ClockMaps,
} from './humanAnims';
import { natureReady, tickNature, untrackNature } from './nature';
import { createGroundBox } from './groundBox';
import { disposeGrassBatch, syncGrassBatch } from './grassBatch';
import { nearestPickup } from '../items/pickup';
import { slotItem } from '../items/inventory';
import { handsAt, heldItemDepth, heldItemGrip, PLAYER_CARD } from './attachPoints';
import { getSwordMaps } from './swordAnims';
import { characterHeight, characterTakeFps, characterWalkFps, isPackedKind } from './artCache';

const worldPos = new THREE.Vector3();
const camPos = new THREE.Vector3();
const camRight = new THREE.Vector3();
const camQuat = new THREE.Quaternion();

function torchMesh(meshID:string | undefined):boolean {
	return meshID === 'item_torch';
}

/** Sprite, door, chunk, and glow presentation on Kindling's scene graph. */
export class WorldPresent {
	detailMaps = true;
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
				this.syncItem(obj, go, go === focus, world.time);
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

	/** 45° octant (2=1:30, 4=4:30, 8=7:30, 10=10:30); FlipX only if that hour's art is missing. */
	private clockFacing(
		clock:ClockAnims,
		walking:boolean,
		yaw:number,
		x:number,
		z:number,
	):{ hour:ClockHour; flip:number; face:ClockHour } {
		const face = hourFromViewDeg(this.viewAngle(yaw, x, z).deg);
		return { ...resolveClockHour(clock, face, walking), face };
	}

	private isClockHour(hour:number):hour is ClockHour {
		return Number.isInteger(hour) && hour >= 1 && hour <= 12;
	}

	private syncHuman(obj:THREE.Object3D, go:GameObject):void {
		const sprite = obj.userData.sprite as THREE.Mesh | undefined;
		if (!sprite) {
			return;
		}
		const appearance = go.getComponent(HumanSprite);
		const kind = appearance?.kind ?? ((obj.userData.animID as string | undefined) ?? 'player');
		if (!hasHumanAnims(kind)) {
			return;
		}
		const anims = getHumanAnims(kind);
		const rb = go.getComponent(RigidBody);
		const speed = rb ? Math.hypot(rb.velocity.x, rb.velocity.z) : 0;
		const down = (go.getComponent(Vitals)?.hp ?? 1) <= 0;
		const clip = appearance?.clip ?? 'auto';
		const pocket = !down && (clip === 'take' || clip === 'give');
		const hurting = !down && go.getComponent(HurtFlash)?.active === true;
		const walking = !down && !pocket && !hurting && (clip === 'walk' || (clip === 'auto' && speed > 0.35));
		const yaw = go.transform.yaw;
		const p = go.transform.position;
		const t = go.world?.time ?? 0;
		const offset = appearance?.animOffset ?? 0;
		const lockedWalkFps = appearance && appearance.walkFps > 0 ? appearance.walkFps : 0;
		const takeFps = appearance && appearance.takeFps > 0
			? appearance.takeFps
			: characterTakeFps(kind);
		const clock = anims.clock;
		let maps = clock.idle[6] ?? clock.idle[12] ?? clock.idle[4];
		if (!maps) {
			return;
		}
		let flip = 1;
		let hour:ClockHour = 6;
		let face:ClockHour = 6;
		let fps = lockedWalkFps || characterWalkFps(kind, 6);
		if (down) {
			maps = clock.idle[6] ?? clock.idle[12] ?? clock.idle[4] ?? maps;
			flip = 1;
			hour = 6;
			face = 6;
		}
		else if (pocket && appearance) {
			maps = pickPocketMaps(clock, clip, appearance.clipT0, t, takeFps)
				?? pickClockMaps(clock, 6, false, t, fps, offset);
			flip = appearance.flip ? appearance.flip : 1;
		}
		else {
			const autoView = this.clockFacing(clock, walking, yaw, p.x, p.z);
			const locked = appearance?.hour ?? 0;
			hour = this.isClockHour(locked)
				? (walking ? snapWalkHour(locked) : locked)
				: autoView.hour;
			face = this.isClockHour(locked)
				? (walking ? snapWalkHour(locked) : locked)
				: autoView.face;
			flip = appearance?.flip ? appearance.flip : autoView.flip;
			fps = lockedWalkFps || characterWalkFps(kind, hour);
			maps = pickClockMaps(clock, hour, walking, t, fps, offset);
		}
		sprite.receiveShadow = true;
		const mat = sprite.material as THREE.MeshLambertMaterial;
		const cel = maps.map.userData.cel === true;
		const nrm = this.detailMaps ? maps.nrm : null;
		if (mat.map !== maps.map || mat.normalMap !== nrm) {
			mat.map = maps.map;
			mat.normalMap = nrm;
			mat.normalScale.set(cel ? 0.55 : 0.85, cel ? 0.55 : 0.85);
			mat.needsUpdate = true;
		}
		this.paintHurt(mat, go, t, cel);
		const img = maps.map.image as { width?:number; height?:number } | undefined;
		const iw = img?.width ?? 0;
		const ih = img?.height ?? 0;
		const box = maps.map.userData.content as { x:number; y:number; w:number; h:number } | undefined;
		const contentH = box && box.h > 0 ? box.h : ih;
		// Size the person from idle_06, not each clip. Per-cel fillH made idle
		// and walk of the same hour different heights.
		const frameFillH = ih > 0 ? Math.min(1, Math.max(0.4, contentH / ih)) : 1;
		const fillH = clock.lockFillH && clock.lockFillH > 0 ? clock.lockFillH : frameFillH;
		const aspect = iw && ih ? iw / ih : 0.64;
		const pitch = Math.abs(this.camPitch);
		const unflat = 1 / Math.max(Math.cos(pitch), 0.45);
		const heightKey:HumanKind = isPackedKind(kind) ? kind : 'player';
		const heightM = appearance && appearance.height > 0
			? appearance.height
			: characterHeight(heightKey);
		if (down) {
			sprite.scale.x = (heightM * aspect) / HUMAN_PLANE_W / fillH;
			sprite.scale.y = (heightM / HUMAN_PLANE_H) / fillH;
			sprite.position.set(0, 0.36, 0);
			sprite.rotation.set(-Math.PI / 2, 0, 0);
			this.hideHeld(sprite);
			return;
		}
		const size = heightM / HUMAN_PLANE_H;
		sprite.scale.x = flip * (heightM * aspect) / HUMAN_PLANE_W / fillH;
		sprite.scale.y = unflat * size / fillH;
		// ImageBitmap is flipY: empty below the opaque box is PNG headroom.
		// Plant the crown, not the feet, so idle and walk of the same hour
		// share a head height against walls. Stride may dip a boot.
		const padTop = ih > 0 && box ? Math.max(0, (ih - box.y - box.h) / ih) : 0;
		const planeH = HUMAN_PLANE_H * sprite.scale.y;
		const headWorld = unflat * heightM - 0.02;
		obj.getWorldPosition(worldPos);
		const toCamX = camPos.x - worldPos.x;
		const toCamZ = camPos.z - worldPos.z;
		const toCam = Math.hypot(toCamX, toCamZ) || 1;
		const lead = 0.11;
		sprite.position.set(
			(toCamX / toCam) * lead,
			headWorld - planeH * (0.5 - padTop),
			(toCamZ / toCam) * lead,
		);
		this.billboardY(sprite);
		const walkHour = snapWalkHour(hour);
		const walkCount = clock.walk[walkHour]?.length ?? 0;
		const frame = walking ? walkFrameIndex(t, fps, walkCount, offset) : 0;
		this.syncHeldSwords(sprite, go, kind, hour, face, walking, frame, t);
	}

	private hideHeld(sprite:THREE.Mesh):void {
		for (const name of ['heldLeft', 'heldRight'] as const) {
			const mesh = sprite.getObjectByName(name);
			if (!mesh) {
				continue;
			}
			mesh.visible = false;
			const flame = mesh.getObjectByName('heldFlame');
			if (flame) {
				flame.visible = false;
			}
		}
	}

	private paintHurt(mat:THREE.MeshLambertMaterial, go:GameObject, t:number, cel:boolean):void {
		if ((go.getComponent(Vitals)?.hp ?? 1) <= 0) {
			mat.color.setHex(0xffffff);
			mat.emissive.setHex(0x000000);
			mat.transparent = false;
			mat.opacity = 1;
			mat.alphaTest = cel ? 0.12 : 0.28;
			mat.depthWrite = true;
			return;
		}
		const flash = go.getComponent(HurtFlash);
		if (flash?.active) {
			const blink = Math.floor(t * 14) % 2 === 0;
			mat.color.setHex(blink ? 0xff1408 : 0xff6a4a);
			mat.emissive.setHex(blink ? 0x5a0800 : 0x2a0400);
			mat.transparent = true;
			mat.opacity = blink ? 0.22 : 0.62;
			mat.alphaTest = 0.02;
			mat.depthWrite = false;
			return;
		}
		mat.color.setHex(0xffffff);
		mat.emissive.setHex(0x000000);
		mat.transparent = false;
		mat.opacity = 1;
		mat.alphaTest = cel ? 0.12 : 0.28;
		mat.depthWrite = true;
	}

	private syncHeldSwords(
		sprite:THREE.Mesh,
		go:GameObject,
		kind:string,
		hour:ClockHour,
		face:ClockHour,
		walking:boolean,
		walkFrame:number,
		t:number,
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
		const bodyKind:HumanKind = isPackedKind(kind) ? kind : 'player';
		this.placeHeldItem(sprite, leftMesh, bodyKind, hour, face, leftItem, 'left', !twoHand, walking, walkFrame, t);
		this.placeHeldItem(sprite, rightMesh, bodyKind, hour, face, rightItem, 'right', true, walking, walkFrame, t);
	}

	private heldItemMaps(meshID:string, hour:ClockHour):ClockMaps | null {
		if (sheetReady()) {
			const sheet = getSheet().items[meshID];
			if (sheet) {
				return sheet;
			}
		}
		if (meshID === 'item_sword') {
			return getSwordMaps(6) ?? getSwordMaps(12) ?? null;
		}
		return null;
	}

	private placeHeldItem(
		sprite:THREE.Mesh,
		mesh:THREE.Mesh,
		kind:HumanKind,
		hour:ClockHour,
		face:ClockHour,
		item:{ meshID:string; Torch?:{ lit:boolean; animOffset?:number; flickerRate?:number } } | null,
		side:'left' | 'right',
		include:boolean,
		walking:boolean,
		walkFrame:number,
		t:number,
	):void {
		const meshID = include ? item?.meshID : undefined;
		const maps = meshID && !torchMesh(meshID) ? this.heldItemMaps(meshID, hour) : null;
		const torch = torchMesh(meshID);
		if ((!maps && !torch) || !meshID) {
			mesh.visible = false;
			const flame = mesh.getObjectByName('heldFlame');
			if (flame) {
				flame.visible = false;
			}
			return;
		}
		mesh.visible = true;
		const sheet = sheetReady() ? getSheet() : null;
		const stickMap = torch ? sheet?.torchStick : maps?.map;
		const itemImg = stickMap?.image as HTMLCanvasElement | undefined;
		if (torch && sheet && stickMap) {
			let unlit = mesh.userData.heldUnlit as THREE.MeshBasicMaterial | undefined;
			if (!unlit) {
				unlit = unlitSpriteMaterial(stickMap);
				unlit.depthTest = true;
				unlit.depthWrite = false;
				mesh.userData.heldUnlit = unlit;
			}
			else if (unlit.map !== stickMap) {
				unlit.map = stickMap;
				unlit.needsUpdate = true;
			}
			mesh.material = unlit;
			this.playHeldFlame(ensureHeldFlame(mesh), item?.Torch?.lit === true, t);
		}
		else {
			const flame = mesh.getObjectByName('heldFlame');
			if (flame) {
				flame.visible = false;
			}
			const lambert = (mesh.userData.heldLambert as THREE.MeshLambertMaterial | undefined)
				?? (mesh.material as THREE.MeshLambertMaterial);
			mesh.material = lambert;
			lambert.depthTest = true;
			lambert.depthWrite = false;
			if (maps && (lambert.map !== maps.map || lambert.normalMap !== (this.detailMaps ? maps.nrm : null))) {
				lambert.map = maps.map;
				lambert.normalMap = this.detailMaps ? maps.nrm : null;
				lambert.needsUpdate = true;
			}
		}
		const charImg = (sprite.material as THREE.MeshLambertMaterial).map?.image as HTMLCanvasElement | undefined;
		if (!charImg?.width || !charImg.height || !itemImg?.width || !itemImg.height) {
			return;
		}
		const cardW = kind === 'player' ? PLAYER_CARD.w : charImg.width;
		const cardH = kind === 'player' ? PLAYER_CARD.h : charImg.height;
		const mpp = HUMAN_PLANE_H / cardH;
		const sw = itemImg.width * mpp;
		const sh = itemImg.height * mpp;
		mesh.scale.set(sw, sh, 1);
		const hands = handsAt(kind, hour, walking, walkFrame);
		const hand = side === 'left' ? hands.left : hands.right;
		const grip = heldItemGrip(meshID, hour) ?? { x: itemImg.width * 0.5, y: itemImg.height * 0.65 };
		const hx = (hand.x / cardW - 0.5) * HUMAN_PLANE_W;
		const hy = (0.5 - hand.y / cardH) * HUMAN_PLANE_H;
		const heading = hand.r ?? 0;
		const z = -heading;
		const ox = (grip.x / itemImg.width - 0.5) * sw;
		const oy = (0.5 - grip.y / itemImg.height) * sh;
		const c = Math.cos(z);
		const s = Math.sin(z);
		mesh.rotation.z = z;
		mesh.position.set(
			hx - (ox * c - oy * s),
			hy - (ox * s + oy * c),
			heldItemDepth(side, face),
		);
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

	private syncItem(obj:THREE.Object3D, go:GameObject, highlighted:boolean, t:number):void {
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
