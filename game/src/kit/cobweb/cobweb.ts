import * as THREE from 'three';
import { Component, MeshRenderer, clamp, mergeParts, tube, type GameObject, type PosedPart } from '@arc-director/kindling';
import { Barrier, BoxCollider } from '../../engine/components';
import type { ItemInstance } from '../../items/instance';
import { fail, ok, type UseResult } from '../../items/use';
import { flameMaterial, getSheet, showFlameFrame } from '../../render/spritesheet';
import { toon } from '../../render/toon';
import { CELL_SIZE, WALL_HEIGHT } from '../../world/constants';
import { addFireLight, Fire } from '../torches/fire';
import { sharedMesh, spawnProp, type Sense, type Thing } from '../thing';

/** Set alight with a flame, it burns for `burnSeconds` and is gone, and whatever it blocked with it. */
export class Flammable extends Barrier {
	public static override saved = ['burning'];
	public burning = false;
	public burnSeconds = 1.6;
	private _burnt = 0;

	public override update(dt:number):void {
		if (!this.burning) {
			return;
		}
		this._burnt += dt;
		if (this._burnt >= this.burnSeconds) {
			this.gameObject.world?.destroy(this.gameObject);
		}
	}

	protected blockedText(body:GameObject, name:(id:string)=>string):string {
		return `${name(this.label)} blocks the way — burn it with a flame first`;
	}

	/** An obstacle that would burn, as minds see it. */
	public sense():Sense {
		return {
			tags: ['flammable', 'obstacle'],
			prominent: true,
			interactable: true,
			movable: false,
			note: this.burning ? 'burning away' : 'it blocks the way; dry as tinder',
			examine: (name) => `${name} blocks the way. It is old and dry as tinder.`,
		};
	}

	/** A flame sets it alight. Anything else only tangles in it: a hint that it takes something else, never what. */
	public useOn(character:GameObject, item:ItemInstance):UseResult | undefined {
		if (item.Flame?.canIgnite) {
			this.burning = true;
			return ok('ignited');
		}
		return this.burning ? undefined : fail('nothing happens; it only tangles in the sticky strands');
	}
}


/** How big a burning web's fire is, and how high its ball (m). */
const BLAZE = { size: 1.4, height: 1.1 };

/** How many torch flames lick across a burning web, and how far they reach out from where it caught (m). */
const LICKS = 14;
const LICK_SPREAD = { x: 0.5, y: 2.2 };
/** Torch-flame frames per second, as a held torch's. */
const LICK_FPS = 10;

/**
 * Shows its `Flammable` burning: the fireball's flames (a `Fire`) roaring in the middle, torch flames spreading out
 * from where it caught across its face, and the thing itself fading to nothing as it burns away.
 */
export class Burns extends Component {
	private _licks:{ mesh:THREE.Mesh; at:number }[] = [];
	private _faded:THREE.Material[] = [];
	private _age = 0;

	/**
	 * Its fire's light is there from the start, dark and casting no shadow: a light that appears mid-game recompiles
	 * every lit shader, and the frame it catches would stall.
	 */
	public override awake():void {
		addFireLight(this.gameObject, BLAZE.height, { intensity: 0, castShadow: false });
	}

	public override update(dt:number):void {
		const flam = this.gameObject.getComponent(Flammable);
		if (!flam?.burning) {
			return;
		}
		if (!this.gameObject.getComponent(Fire)) {
			this.ignite();
		}
		this._age += dt;
		const u = Math.min(1, this._age / flam.burnSeconds);
		for (const [i, lick] of this._licks.entries()) {
			// Each catches as the spreading fire reaches it, flares, and dies down as the web goes.
			const life = clamp((u - lick.at) / (1 - lick.at), 0, 1);
			lick.mesh.visible = life > 0;
			lick.mesh.scale.setScalar(Math.sin(Math.PI * Math.sqrt(life)) * (1.6 + 0.4 * Math.sin(this._age * 9 + i)));
			showFlameFrame(lick.mesh.material as THREE.MeshBasicMaterial, this._age, LICK_FPS, i / LICKS);
		}
		for (const mat of this._faded) {
			mat.opacity = (mat.userData.opacity as number) * (1 - u * u);
		}
	}

	public override onDisable():void {
		for (const lick of this._licks) {
			lick.mesh.removeFromParent();
			lick.mesh.geometry.dispose();
			(lick.mesh.material as THREE.Material).dispose();
		}
		this._licks = [];
		for (const mat of this._faded) {
			mat.dispose();
		}
		this._faded = [];
	}

	private ignite():void {
		this.gameObject.addComponent(Fire, BLAZE);
		const root = this.gameObject.transform.object3D;
		const sheet = getSheet();
		for (let i = 0; i < LICKS; i++) {
			const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.38), flameMaterial(sheet.flame[0]!));
			mesh.position.set((Math.random() * 2 - 1) * LICK_SPREAD.x, 0.15 + Math.random() * LICK_SPREAD.y, 0.02);
			mesh.renderOrder = 2;
			mesh.visible = false;
			root.add(mesh);
			// Caught from the foot of the web in the middle, the fire climbing it.
			const reach = Math.hypot(mesh.position.x / LICK_SPREAD.x, mesh.position.y / LICK_SPREAD.y);
			this._licks.push({ mesh, at: 0.5 * Math.min(1, reach) });
		}
		// Its own copies of the web's materials, to fade without fading every other web.
		this.gameObject.getComponent(MeshRenderer)?.mesh?.traverse((obj) => {
			const mesh = obj as THREE.Mesh;
			if (mesh.isMesh) {
				const mat = (mesh.material as THREE.Material).clone();
				mat.transparent = true;
				mat.userData.opacity = mat.opacity;
				mesh.material = mat;
				this._faded.push(mat);
			}
		});
	}
}


/**
 * A web strung across a corridor, in its XY plane: a pale sheet behind spokes from the middle to the walls and
 * a few rings. Wide enough to meet both walls of a one-cell passage.
 */
function createCobwebMesh():THREE.Group {
	const g = new THREE.Group();
	const silk = toon(0xe8e6ee, { rim: 0.4 });
	const sheetMat = toon(0xd8d6e0, { transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, outline: false });
	const center = { x: 0.05, y: 1.15 };
	const spokes = 9;
	const ends = Array.from({ length: spokes }, (element, i) => {
		const a = (i / spokes) * Math.PI * 2 + 0.2;
		return { x: Math.max(-0.5, Math.min(0.5, Math.cos(a) * 0.9)), y: Math.max(0.02, Math.min(2.3, center.y + Math.sin(a) * 1.3)) };
	});
	const parts:PosedPart[] = ends.map((end) => ({ geo: tube([{ x: center.x, y: center.y, z: 0 }, { x: end.x, y: end.y, z: 0 }], 0.008, 3) }));
	for (const t of [0.3, 0.55, 0.8]) {
		const ring = ends.map((end) => ({ x: center.x + (end.x - center.x) * t, y: center.y + (end.y - center.y) * t, z: 0 }));
		parts.push({ geo: tube([...ring, ring[0]!], 0.006, 3) });
	}
	const strands = new THREE.Mesh(mergeParts(parts), silk);
	g.add(strands);
	const sheet = new THREE.Mesh(new THREE.PlaneGeometry(1, 2.3), sheetMat);
	sheet.position.y = 1.15;
	g.add(sheet);
	return g;
}


/** Webs wall to wall across their passage, however wide, and up to the ceiling, until a flame burns them away. */
export const cobweb:Thing = {
	defs: ['cobweb'],
	spawn: (world, chunk, ents) => ents.forEach((ent) => {
		const web = spawnProp(chunk, ent, 'cobweb', 1, ent.yaw ?? 0, WALL_HEIGHT);
		const open = (dx:number):boolean => {
			const tile = chunk.tile(ent.localX + dx, ent.localZ);
			return !!tile && !tile.blocked;
		};
		let west = 0;
		let east = 0;
		while (open(-west - 1)) {
			west++;
		}
		while (open(east + 1)) {
			east++;
		}
		const span = west + east + 1;
		web.transform.position.x += ((east - west) * CELL_SIZE) / 2;
		web.transform.localScale.x = span;
		const col = web.getComponent(BoxCollider)!;
		col.size.x = span * CELL_SIZE;
		web.addComponent(Flammable);
		web.addComponent(Burns);
		world.add(web);
	}),
	meshes: { cobweb: sharedMesh(createCobwebMesh) },
};
