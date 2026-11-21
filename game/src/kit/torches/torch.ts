import * as THREE from 'three';
import { Component, MeshRenderer, mergeParts, Time, type GameObject, type MeshFactory, type PosedPart, type Vec3 } from '@arc-director/kindling';
import { BoxCollider, Light } from '../../engine/components';
import { DemoMeshRenderer } from '../../engine/demo-mesh-renderer';
import { Order } from '../../engine/order';
import { Item } from '../../items/item-components';
import { flameMaterial, getSheet, sheetReady, showFlameFrame, unlitSpriteMaterial } from '../../render/spritesheet';
import { toon } from '../../render/toon';
import { sharedMesh, thingAt, type Sense, type Thing } from '../thing';
import { wallOffset } from '../walls/thin-wall';

/** Where the camera is, and a flame or stick turned to it. */
const eye = new THREE.Vector3();
const at = new THREE.Vector3();

/** A flame's light (a torch's, a fire's, one held): warm, flickering and casting shadows, `opts` aside. */
export function addFlameLight(go:GameObject, opts:Partial<Light>):Light {
	return go.addComponent(Light, {
		color: 0xff9a4a,
		// How fast it falls off with distance (three.js `decay`: 1 is inverse-linear, 2 inverse-square).
		decay: 1.3,
		range: 11,
		castShadow: true,
		intensityFlicker: 0.75,
		intensityFlickerSpeed: 0.5,
		...opts,
	});
}

export class Torch extends Component {
	// Its `lateUpdate` too: after the camera's (`Order.camera`), so the flame faces where the camera is this frame.
	public static override order = Order.torch;
	public static override saved = ['lit'];
	public lit = true;
	public baseIntensity = 48;
	/** 0–1 start phase so flame loops are not globally synced. */
	public animOffset = Math.random();
	/** Frames per second for the flame sprite. */
	public flickerRate = 7.2 + Math.random() * 6.5;
	/** How far its light reaches (m). */
	public range = 11;
	/** Where its light burns, from its object's origin (m, its own axes). */
	public offset:Vec3 = { x: 0, y: 0, z: 0 };

	/** Its light, at its flame, on while it is lit. */
	public override awake():void {
		const { x, y, z } = this.offset;
		addFlameLight(this.gameObject, { intensity: this.baseIntensity, range: this.range, offsetX: x, offsetY: y, offsetZ: z, positionalFlicker: 0.012, positionalFlickerSpeed: 0.012, enabled: this.lit });
	}

	public override update(dt:number):void {
		const light = this.gameObject.getComponent(Light);
		if (!light) {
			return;
		}
		light.enabled = this.lit;
		if (!this.lit) {
			return;
		}
		light.intensity = this.baseIntensity * light.pulse(dt);
	}

	/**
	 * A wall or standing torch's look (one carried is an item's, `WorldPresent`): the holster turned to the wall, the
	 * flame's frame while it is lit, and flame and stick turned to face the camera.
	 */
	public override lateUpdate():void {
		const mesh = this.gameObject.getComponent(MeshRenderer)?.mesh;
		const flame = mesh?.getObjectByName('flame') as THREE.Mesh | undefined;
		if (!mesh || !flame || this.gameObject.getComponent(Item)) {
			return;
		}
		const yaw = this.gameObject.transform.yaw;
		mesh.rotation.y = -yaw;
		const holster = mesh.getObjectByName('holsterRig');
		if (holster) {
			holster.rotation.y = yaw;
		}
		flame.visible = this.lit;
		const camera = this.gameObject.world?.renderer?.findCamera()?.native;
		if (!this.lit || !camera) {
			return;
		}
		showFlameFrame(flame.material as THREE.MeshBasicMaterial, Time.time, this.flickerRate, this.animOffset);
		camera.getWorldPosition(eye);
		for (const part of [flame, mesh.getObjectByName('stick')]) {
			part?.lookAt(eye.x, part.getWorldPosition(at).y, eye.z);
		}
	}

	/** Seen as a torch on a wall or a pole; one carried as an item is an item. */
	public sense():Sense {
		return { tags: this.gameObject.getComponent(Item) ? [] : ['torch'] };
	}
}

/** The iron sleeve, rings and plate and the wooden arm and back that hold a wall torch, turned to the wall (`holsterRig`). */
function addTorchHolster(g:THREE.Group):void {
	const y = 0.04;
	const armLen = 0.14;
	const ring = new THREE.TorusGeometry(0.092, 0.024, 6, 12);
	const rig = new THREE.Group();
	rig.name = 'holsterRig';
	const iron:PosedPart[] = [
		{ geo: new THREE.CylinderGeometry(0.078, 0.086, 0.12, 8), y },
		{ geo: ring, y: y - 0.055, rx: Math.PI / 2 },
		{ geo: ring, y: y + 0.055, rx: Math.PI / 2 },
		{ geo: new THREE.BoxGeometry(0.34, 0.42, 0.055), y, z: 0.128 },
	];
	const wood:PosedPart[] = [
		{ geo: new THREE.CylinderGeometry(0.042, 0.05, armLen, 8), y, z: armLen * 0.5, rx: Math.PI / 2 },
		{ geo: new THREE.BoxGeometry(0.22, 0.28, 0.03), y, z: 0.096 },
	];
	for (const [parts, color] of [[iron, 0x8a7060], [wood, 0x7a4e2a]] as const) {
		const mesh = new THREE.Mesh(mergeParts(parts), toon(color));
		mesh.castShadow = true;
		rig.add(mesh);
	}
	g.add(rig);
}

function createTorchMesh():THREE.Group {
	const sheet = getSheet();
	const g = new THREE.Group();

	const stick = new THREE.Mesh(
		new THREE.PlaneGeometry(0.16, 0.42),
		unlitSpriteMaterial(sheet.torchStick),
	);
	stick.name = 'stick';
	stick.position.y = 0.02;
	stick.castShadow = false;
	g.add(stick);

	const flame = new THREE.Mesh(
		new THREE.PlaneGeometry(0.28, 0.38),
		flameMaterial(sheet.flame[0]),
	);
	flame.name = 'flame';
	flame.position.y = 0.4;
	flame.castShadow = false;
	flame.renderOrder = 2;
	g.add(flame);
	addTorchHolster(g);
	return g;
}

/**
 * A torch on a pole, standing on the floor: iron foot, wooden pole, iron cup, and the wall torch's flame. Unlit, like
 * the wall torch's stick: its own light burns a hand over the cup and would wash it white. Casts no shadow either, or
 * the cup would shade the floor around it.
 */
function createStandingTorchMesh():THREE.Group {
	const g = new THREE.Group();
	const iron = new THREE.MeshBasicMaterial({ color: 0x2e2620 });
	const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.08, 8).translate(0, 0.04, 0), iron);
	const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.34, 7).translate(0, 0.75, 0), new THREE.MeshBasicMaterial({ color: 0x4a2e18 }));
	const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.06, 0.12, 8).translate(0, 1.48, 0), iron);
	g.add(foot, pole, cup);

	const flame = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.38), flameMaterial(getSheet().flame[0]));
	flame.name = 'flame';
	flame.position.y = 1.7;
	flame.renderOrder = 2;
	g.add(flame);
	return g;
}

/** A copy of `shared`'s mesh whose flame has a material of its own, to show its own frame. */
function ownFlame(shared:MeshFactory):MeshFactory {
	return () => {
		const mesh = shared();
		const flame = mesh?.getObjectByName('flame') as THREE.Mesh | undefined;
		if (flame) {
			flame.material = flameMaterial(getSheet().flame[0]);
		}
		return mesh;
	};
}

/** Lit torches: on the wall beside their cell (`wall_torch`), or on a pole in the middle of it (`standing_torch`). */
export const torch:Thing = {
	defs: ['wall_torch', 'standing_torch'],
	spawn: (world, chunk, ents) => ents.forEach((ent) => {
		const standing = ent.def === 'standing_torch';
		const off = standing ? { x: 0, z: 0, yaw: 0 } : wallOffset(world.terrain, chunk.tileCoord(ent.localX, ent.localZ));
		const go = thingAt(chunk, ent, `torch_${chunk.id}_${ent.localX}_${ent.localZ}`, 'Torch');
		go.transform.position.x += off.x;
		go.transform.position.y += standing ? 0 : 1.15;
		go.transform.position.z += off.z;
		go.transform.yaw = off.yaw;
		go.addComponent(DemoMeshRenderer, { meshID: standing ? 'torch_stand' : 'torch' });
		if (standing) {
			go.addComponent(BoxCollider, { size: { x: 0.4, y: 1, z: 0.4 }, shape: 'cylinder' });
		}
		go.addComponent(Torch, { lit: true, offset: standing ? { x: 0, y: 1.62, z: 0 } : { x: 0, y: 0.35, z: 0.18 } });
		world.add(go);
	}),
	meshes: {
		torch: ownFlame(sharedMesh(createTorchMesh, sheetReady)),
		torch_stand: ownFlame(sharedMesh(createStandingTorchMesh, sheetReady)),
	},
};
