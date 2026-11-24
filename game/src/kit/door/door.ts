import * as THREE from 'three';
import { bevelBox, GameObject, MeshRenderer, mergeParts, solidMesh, tube, type PosedPart, type SfxPatch, type XZ } from '@arc-director/kindling';
import { showNamingText } from 'arc-director';
import { cueAt } from '../../audio/cue';
import { Barrier, BoxCollider, Lock, lockedNote, lockedReason, setOpen } from '../../engine/components';
import { DemoMeshRenderer } from '../../engine/demo-mesh-renderer';
import { Order } from '../../engine/order';
import { findCarried } from '../../items/inventory';
import type { ItemInstance } from '../../items/instance';
import type { UseResult } from '../../items/use';
import { PALETTE, plankMat, toon } from '../../render/toon';
import { doorInteriorAlong, nearestDoorway } from '../houses/interior';
import { sharedMesh, thingAt, type Sense, type Thing } from '../thing';

/** A door's creak and thud opening, and its creak, slam and latch shutting. */
const SFX = {
	open: {
		gain: 0.9,
		layers: [
			{ kind: 'creak', dur: 0.62, freq: 38, freqTo: 22, cutoff: 260, q: 5, gain: 0.8 },
			{ kind: 'creak', dur: 0.4, when: 0.12, freq: 70, freqTo: 45, cutoff: 480, q: 7, gain: 0.35 },
			{ kind: 'thump', dur: 0.12, freq: 90, when: 0.02, gain: 0.35 },
		],
	},
	close: {
		gain: 0.95,
		layers: [
			{ kind: 'creak', dur: 0.24, freq: 45, freqTo: 30, cutoff: 280, q: 5, gain: 0.5 },
			{ kind: 'thump', dur: 0.14, freq: 78, when: 0.08, gain: 0.8 },
			{ kind: 'click', dur: 0.04, freq: 280, when: 0.16, gain: 0.35 },
		],
	},
} satisfies Record<string, SfxPatch>;

/** How near a walker comes to a shut door before it reaches out and opens it. */
const DOOR_REACH = 1.2;
/** How far past a door a walker stands before shutting it behind itself, clear of the leaf. */
const LEAF_CLEAR = 0.6;

export class Door extends Barrier {
	public static override order = Order.door;
	public static override saved = ['open'];
	public open = false;
	public axis:'x' | 'z' = 'x';
	public panel:GameObject | null = null;
	/** Hung from the other side of its doorway. */
	public flipped = false;
	/** Named building this door opens into, if any. */
	public buildingID = '';
	/** Who walked up and opened it, and from which side ({@link sideOf}), to shut it behind them once through unless still locked. */
	private _openedBy:{ body:GameObject; side:number } | null = null;

	/**
	 * Opens or shuts it, with its creak. `unlock` turns its key first ({@link Lock.turnKey}). Every hand, key, walker and
	 * riddle opens a door through here.
	 */
	public setOpen(open:boolean, unlock = false):void {
		if (setOpen(this, open, unlock, SFX)) {
			this._openedBy = null;
			this.syncCollision();
		}
	}

	/**
	 * Called as `body` walks toward `to` near this door. If the door is shut and in the way, `body` opens it (and unlocks
	 * it, if it carries the key). Once `body` is through, it shuts the door behind itself, unless the door is still locked:
	 * then it is left open, so whoever follows can get through.
	 */
	public walkThrough(body:GameObject, to:XZ):void {
		const p = body.transform.position;
		const side = this.sideOf(p);
		if (!this.open) {
			const d = this.gameObject.transform.position;
			if ((to.x - p.x) * (d.x - p.x) + (to.z - p.z) * (d.z - p.z) > 0 && this.opensFrom(body, p)) {
				this.setOpen(true, true);
				this._openedBy = { body, side };
			}
		}
		else if (this._openedBy?.body === body && side * this._openedBy.side < 0 && Math.abs(side) > LEAF_CLEAR && !this.gameObject.getComponent(Lock)?.locked) {
			this.setOpen(false);
		}
	}

	/** How far `at` stands out from it along its passage: positive one way, negative the other. */
	private sideOf(at:XZ):number {
		const p = this.gameObject.transform.position;
		return this.axis === 'x' ? at.x - p.x : at.z - p.z;
	}

	/** Its key opens it ({@link Lock.useKey}). */
	public useOn(character:GameObject, item:ItemInstance):UseResult | undefined {
		return this.gameObject.getComponent(Lock)?.useKey(character, item, () => this.setOpen(true, true));
	}

	/** Keep the AABB in sync the moment the leaf moves — do not wait for the next tick. */
	public syncCollision():void {
		if (!this.panel) {
			return;
		}
		const yaw = this.leafYaw;
		this.panel.transform.localYaw = yaw;
		const offset = Math.sin(yaw) * 0.5;
		this.panel.transform.localPosition.z = this.flipped ? -offset : offset;
		this.panel.transform.localPosition.x = offset;
		const collider = this.panel.getComponent(BoxCollider);
		if (collider) {
			// The leaf, thin across the doorway when shut and along the wall when open.
			const thinX = (this.axis === 'x') !== this.open;
			collider.size = { x: thinX ? 0.16 : 1, y: 2.12, z: thinX ? 1 : 0.16 };
		}
	}

	public override update(dt:number):void {
		this.syncCollision();
	}

	/** After physics: the leaf on its hinge (a gate's second leaf the other way, on its own pier), and the sheet that stops light while it is shut. */
	public override lateUpdate():void {
		const mesh = this.gameObject.getComponent(MeshRenderer)?.mesh;
		if (!mesh) {
			return;
		}
		const yaw = this.leafYaw;
		const hinge = mesh.getObjectByName('hinge');
		const hinge2 = mesh.getObjectByName('hinge2');
		if (hinge) {
			hinge.rotation.y = yaw;
		}
		if (hinge2) {
			hinge2.rotation.y = -yaw;
		}
		const occluder = mesh.getObjectByName('doorOccluder');
		if (occluder) {
			occluder.visible = !this.open;
		}
	}

	/** The leaf's yaw on its hinge: a quarter turn open, else across the doorway (from the other side when `flipped`). */
	private get leafYaw():number {
		return this.open ? -Math.PI / 2 : this.flipped ? Math.PI : 0;
	}

	/** Shut. Its open leaf clears nothing by walking up to it. */
	public override get standsInWay():boolean {
		return !this.open;
	}

	/**
	 * Whether `body` at `from` can open it: no lock holds it, `body` carries its key, or its lock bars only the other
	 * side.
	 */
	public override opensFrom(body:GameObject, from:XZ):boolean {
		const lock = this.gameObject.getComponent(Lock);
		if (!lock?.locked || findCarried(body, (it) => lock.fits(it))) {
			return true;
		}
		const inward = doorInteriorAlong(this.gameObject);
		return lock.lockedFrom === 'outside' && inward !== 0 && this.sideOf(from) * inward >= 0;
	}

	/** Locked, and `body` lacks the key. */
	protected blockedText(body:GameObject, name:(id:string)=>string):string {
		const lock = this.gameObject.getComponent(Lock)!;
		return `${name(this.label)} is ${showNamingText(lockedReason(this.gameObject.world, lock, body), name)}`;
	}

	/** A landmark to open and shut, as minds see it. */
	public sense():Sense {
		const state = this.open ? 'open' : 'shut';
		return {
			tags: ['door', 'landmark'],
			prominent: true,
			interactable: true,
			movable: false,
			note: state,
			state: { door: state },
			examine: (name, nameOf, viewer) => `${name} is a door, ${state}${lockedNote(this.gameObject, nameOf, viewer)}.`,
		};
	}
}

/** A walker heading for `to` within arm's reach of a door walks through it ({@link Door.walkThrough}). */
export function openDoorAhead(character:GameObject, to:XZ):void {
	const p = character.transform.position;
	const doorGo = character.world && nearestDoorway(character.world, p.x, p.z, DOOR_REACH);
	doorGo?.getComponent(Door)?.walkThrough(character, to);
}

export function interactDoor(character:GameObject, doorGo:GameObject):string {
	const lock = doorGo.getComponent(Lock);
	const door = doorGo.getComponent(Door);
	if (!door) {
		return 'not a door';
	}
	// Anyone can close a door; a lock only has a say in opening it.
	if (!door.open && lock && !door.opensFrom(character, character.transform.position)) {
		const refused = lock.refusal(character);
		if (refused) {
			return refused;
		}
		door.setOpen(true, true);
		return lock.locked ? 'opened' : 'unlocked';
	}
	door.setOpen(!door.open);
	return door.open ? 'opened' : 'closed';
}

const DOOR_LEAF_W = 0.86;
const DOOR_LEAF_T = 0.1;
const DOOR_LEAF_H = 2.12;

function createDoorMesh(flipped = false):THREE.Group {
	const g = new THREE.Group();
	const frameMat = toon(0x3a2416);
	const leafMat = toon(0x6b3f22);
	const lintelMat = plankMat();
	const post = new THREE.BoxGeometry(0.12, 2.22, 0.12);
	const left = solidMesh(post, frameMat);
	left.position.set(0, 1, -0.47);
	const right = solidMesh(post, frameMat);
	right.position.set(0, 1, 0.47);
	const lintel = solidMesh(new THREE.BoxGeometry(0.12, 0.35, 1), lintelMat);
	lintel.position.set(0, 2.28, 0);
	g.add(left, right, lintel);

	const sign = flipped ? 1 : -1;
	const hinge = new THREE.Group();
	hinge.name = 'hinge';
	hinge.position.set(0, 0, DOOR_LEAF_W * 0.5 * sign);
	const leaf = solidMesh(new THREE.BoxGeometry(DOOR_LEAF_T, DOOR_LEAF_H, DOOR_LEAF_W), leafMat);
	leaf.position.set(DOOR_LEAF_T * 0.5 * sign, DOOR_LEAF_H * 0.5, DOOR_LEAF_W * 0.5);
	hinge.add(leaf);
	g.add(hinge);
	const occH = DOOR_LEAF_H - 0.06;
	const occ = new THREE.Mesh(
		new THREE.PlaneGeometry(0.98, occH),
		toon(0x000000, { colorWrite: false, side: THREE.DoubleSide }),
	);
	occ.name = 'doorOccluder';
	occ.rotation.y = Math.PI / 2 * -sign;
	// Above the floor, so the sheet does not slice the threshold.
	occ.position.y = 0.06 + occH * 0.5;
	occ.castShadow = true;
	occ.receiveShadow = false;
	g.add(occ);
	return g;
}

/** How far a gate's leaves swing: each on its own pier, flat against the wall outside when open. */
const GATE_LEAF_W = 0.44;
const GATE_H = 2.1;
/** A gate pier's face, from the passage's middle: a little proud of the wall's end, never in its plane. */
const PIER_FACE = 0.5 - 0.03;

/** One barred iron leaf of a gate, hung on a hinge at its own `z` edge: frame, bars, and spear tips along the top. */
function gateLeaf(hingeZ:number, sign:number):THREE.Group {
	const iron = toon(PALETTE.iron, { rim: 0.35 });
	const hinge = new THREE.Group();
	hinge.position.set(0, 0, hingeZ);
	const bar = 0.022;
	const z = (t:number):number => sign * t;
	const parts:PosedPart[] = [
		{ geo: new THREE.BoxGeometry(0.04, GATE_H, 0.04), y: GATE_H * 0.5, z: z(0.02) },
		{ geo: new THREE.BoxGeometry(0.04, GATE_H, 0.04), y: GATE_H * 0.5, z: z(GATE_LEAF_W - 0.02) },
		{ geo: new THREE.BoxGeometry(0.035, 0.05, GATE_LEAF_W), y: 0.12, z: z(GATE_LEAF_W * 0.5) },
		{ geo: new THREE.BoxGeometry(0.035, 0.05, GATE_LEAF_W), y: GATE_H - 0.32, z: z(GATE_LEAF_W * 0.5) },
		{ geo: new THREE.BoxGeometry(0.035, 0.05, GATE_LEAF_W), y: 1.0, z: z(GATE_LEAF_W * 0.5) },
	];
	for (let i = 1; i <= 3; i++) {
		const t = (GATE_LEAF_W * i) / 4;
		parts.push({ geo: new THREE.BoxGeometry(bar, GATE_H - 0.2, bar), y: (GATE_H - 0.2) * 0.5 + 0.1, z: z(t) });
		parts.push({ geo: new THREE.ConeGeometry(0.03, 0.12, 4), y: GATE_H - 0.04, z: z(t) });
	}
	hinge.add(solidMesh(mergeParts(parts), iron));
	return hinge;
}

/**
 * A gate in a town wall, its passage along X: two stone piers with caps, an iron arch between them with a finial
 * on top, and a pair of barred leaves (`hinge`, `hinge2`) that swing out to lie flat against the wall when open.
 */
function createGateMesh():THREE.Group {
	const g = new THREE.Group();
	const stone = toon(PALETTE.wall, { pattern: 'stone', patternScale: 0.18, patternInk: 0.5 });
	const iron = toon(PALETTE.iron, { rim: 0.35 });
	const pierZ = PIER_FACE + 0.17;
	const piers:PosedPart[] = [-1, 1].flatMap((s) => [
		{ geo: new THREE.BoxGeometry(0.44, 2.5, 0.34), y: 1.25, z: s * pierZ },
		{ geo: bevelBox(0.56, 0.14, 0.46, 0.03), y: 2.57, z: s * pierZ },
		{ geo: new THREE.ConeGeometry(0.2, 0.22, 4), y: 2.75, z: s * pierZ, ry: Math.PI / 4 },
	]);
	g.add(solidMesh(mergeParts(piers), stone));
	// The arch: a half ring over the opening, between the pier caps, with a lantern hook at its crown.
	const arch = Array.from({ length: 9 }, (element, i) => {
		const a = (i / 8) * Math.PI;
		return { x: 0, y: 2.3 + Math.sin(a) * 0.5, z: -Math.cos(a) * 0.52 };
	});
	const ironwork = new THREE.Mesh(mergeParts([
		{ geo: tube(arch, 0.03, 6) },
		{ geo: tube([{ x: 0, y: 2.8, z: 0 }, { x: 0, y: 3.02, z: 0 }], 0.02, 5) },
		{ geo: new THREE.ConeGeometry(0.05, 0.14, 4), y: 3.08 },
	]), iron);
	ironwork.castShadow = true;
	g.add(ironwork);
	// Hung half a stile in front of each pier, so an open leaf lies on its face, not in it.
	const left = gateLeaf(-(PIER_FACE - 0.02), 1);
	left.name = 'hinge';
	g.add(left);
	const right = gateLeaf(PIER_FACE - 0.02, -1);
	right.name = 'hinge2';
	g.add(right);
	return g;
}

/** Doors in walls, and gates (`gate`: stone piers and iron leaves) in town walls. Both open and shut as a `Door`. */
export const door:Thing = {
	defs: ['door', 'door_flipped', 'gate'],
	spawn: (world, chunk, ents) => ents.forEach((ent) => {
		const axis = ent.axis ?? 'x';
		const go = thingAt(chunk, ent, `${ent.def}_${chunk.id}_${ent.localX}_${ent.localZ}`, 'Door');
		const panel = new GameObject();
		panel.addComponent(BoxCollider);
		const door = go.addComponent(Door, { axis, open: !!ent.open, panel, flipped: ent.def.includes('flipped') });
		// Its open leaf lies to its left: a legend's `yaw` turns it around, to open the other way.
		go.transform.yaw = ent.yaw ?? (axis === 'x' ? 0 : Math.PI / 2);
		panel.parent = go;
		go.addComponent(Lock, { keyID: ent.keyID ?? 'brass', locked: ent.locked ?? true, lockedFrom: ent.lockedFrom ?? 'both' });
		go.addComponent(DemoMeshRenderer, { meshID: ent.def });
		world.add(go);
		door.syncCollision();
	}),
	meshes: {
		door: sharedMesh(() => createDoorMesh(false)),
		door_flipped: sharedMesh(() => createDoorMesh(true)),
		gate: sharedMesh(createGateMesh),
	},
};
