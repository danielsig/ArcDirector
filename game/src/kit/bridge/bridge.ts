import * as THREE from 'three';
import { boundsOf, ChunkBound, Component, GameObject, MeshRenderer, mergeParts, solidMesh, type PathPoint, type PosedPart, type XZ } from '@arc-director/kindling';
import { Barrier, BoxCollider, HumanBody, Named, idOf } from '../../engine/components';
import { DemoMeshRenderer } from '../../engine/demo-mesh-renderer';
import { Pickupable } from '../../items/item-components';
import type { ItemInstance } from '../../items/instance';
import { fail, ok, type UseResult } from '../../items/use';
import { natureReady } from '../../render/nature';
import { PALETTE, plankMat, toon } from '../../render/toon';
import { CELL_SIZE } from '../../world/constants';
import { sharedMesh, thingAt, type Sense, type Thing } from '../thing';

/** Seconds the span takes to swing between raised and lowered. */
const BRIDGE_SWING_SECONDS = 1;

/** World height of the lowered span's planks, where whoever crosses stands. Matches `createBridgeMesh`. */
const BRIDGE_DECK_Y = 0.22;

/** A chain's tip on the deck, the way it runs, and the way a chain points unturned. */
const tip = new THREE.Vector3();
const dir = new THREE.Vector3();
const FORWARD = new THREE.Vector3(0, 0, 1);

/** Drawbridge over water. When raised (`open` false), the river cannot be crossed. */
export class Bridge extends Barrier {
	public static override saved = ['open'];
	/** Where the span is headed: lowered (open) or raised. */
	public open = false;
	/** While it holds, a lowered span may not be raised: someone has paid for it to stay down. A scene sets it. */
	public paidDown:()=>boolean = () => false;
	public cells:XZ[] = [];
	/** Mid-swing lift; undefined when the span rests where `open` says. */
	private _swing:number | undefined;

	public override start():void {
		const world = this.gameObject.world;
		if (!world || this.cells.length === 0) {
			return;
		}
		world.terrain.addCover({
			bounds: boundsOf(this.cells, CELL_SIZE / 2),
			sample: (x, z) => this.enabled && this.open && this.cells.some((c) => Math.abs(c.x - x) < 0.55 && Math.abs(c.z - z) < 0.55) ? BRIDGE_DECK_Y : undefined,
		});
	}

	/** How far up the span is: 0 lowered, 1 raised. */
	public get lift():number {
		return this._swing ?? this.target;
	}

	/** Swinging between raised and lowered. */
	public get moving():boolean {
		return this._swing !== undefined;
	}

	/** Work the lever: swing to the other state over {@link BRIDGE_SWING_SECONDS}. Setting `open` (a load) snaps instead. */
	public toggle():void {
		this._swing = this.lift;
		this.open = !this.open;
		this.syncCollision();
	}

	/** Bodies and loose things standing on the span. */
	public occupants():GameObject[] {
		const half = CELL_SIZE / 2;
		return (this.gameObject.world?.objects ?? []).filter((go) => (
			(go.getComponent(HumanBody) || go.getComponent(Pickupable))
			&& this.cells.some((c) => Math.abs(go.transform.position.x - c.x) <= half && Math.abs(go.transform.position.z - c.z) <= half)
		));
	}

	/** Walkable only once fully lowered; anything else blocks. */
	public syncCollision():void {
		const col = this.gameObject.getComponent(BoxCollider);
		if (!col) {
			return;
		}
		const down = this.open && this.lift === 0;
		col.solid = !down;
		col.isTrigger = down;
	}

	public override update(dt:number):void {
		if (this._swing !== undefined) {
			const step = dt / BRIDGE_SWING_SECONDS;
			const lift = this._swing < this.target ? Math.min(this.target, this._swing + step) : Math.max(this.target, this._swing - step);
			this._swing = lift === this.target ? undefined : lift;
		}
		this.syncCollision();
	}

	/** The span drawn where it is in its swing: the deck on its hinge, and each chain from its pulley to the deck's tip. */
	public override lateUpdate():void {
		const mesh = this.gameObject.getComponent(MeshRenderer)?.mesh;
		const deck = mesh?.getObjectByName('deck');
		if (!mesh || !deck) {
			return;
		}
		deck.rotation.x = -Math.PI / 2 * this.lift;
		deck.updateMatrix();
		for (const chain of mesh.children.filter((c) => c.name === 'chain')) {
			const { from, end } = chain.userData as { from:PathPoint; end:PathPoint };
			tip.set(end.x, end.y, end.z).applyMatrix4(deck.matrix);
			chain.position.set(from.x, from.y, from.z);
			dir.subVectors(tip, chain.position);
			chain.scale.set(1, 1, Math.max(0.01, dir.length()));
			chain.quaternion.setFromUnitVectors(FORWARD, dir.normalize());
		}
	}

	protected blockedText(body:GameObject, name:(id:string)=>string):string {
		return this.open ? `${name(this.label)} is being lowered — wait for it` : `${name(this.label)} is raised — it must be lowered first`;
	}

	/** A landmark everyone sees from anywhere, raised or lowered. */
	public sense():Sense {
		return {
			tags: ['bridge', 'landmark'],
			prominent: true,
			interactable: true,
			movable: false,
			note: `it is ${this.moving ? 'being ' : ''}${this.open ? 'lowered' : 'raised'}`,
			state: { position: this.open ? 'lowered' : 'raised' },
			always: true,
			examine: (name) => (this.open
				? `${name} is a bridge, lowered: you can cross. Working the sluice raises it.`
				: `${name} is a bridge, raised: no one can cross until it is lowered.`),
		};
	}

	private get target():number {
		return this.open ? 0 : 1;
	}
}

/** The sluice that raises and lowers its `bridge`, worked with `BridgeCrank`. */
export class BridgeLever extends Component {
	/** The id of the bridge it works. */
	public bridge = '';

	public sense():Sense {
		return {
			tags: ['sluice', 'landmark'],
			prominent: true,
			interactable: true,
			movable: false,
			examine: (name) => `${name} is the fixed lever that raises and lowers the bridge. Working it again does the other.`,
		};
	}

	/** Swings the bridge the other way, unless it is still moving, paid to stay down, or would drop someone into the river. */
	public useOn(character:GameObject, item:ItemInstance):UseResult {
		const lever = idOf(this.gameObject);
		if (item.defID !== 'bridge_crank') {
			return fail((name) => `use BridgeCrank on ${name(lever)}`);
		}
		const span = character.world?.findByID(this.bridge)?.getComponent(Bridge);
		if (!span) {
			return fail('no bridge');
		}
		const id = idOf(span.gameObject);
		if (span.moving) {
			return fail((name) => `${name(id)} is still moving`);
		}
		if (span.open && span.paidDown()) {
			return fail((name) => `${name(id)} is lowered and paid for, so it stays down: leave it`);
		}
		const on = span.open ? span.occupants().map(idOf) : [];
		if (on.length > 0) {
			return fail((name) => `${on.map(name).join(' and ')} ${on.length > 1 ? 'are' : 'is'} on ${name(id)}; raising it now would drop them in the river`);
		}
		span.toggle();
		return ok((name) => `${span.open ? 'lowered' : 'raised'} ${name(id)}`);
	}
}

const BRIDGE_LEN = 3.28;
const BRIDGE_W = 1.72;
/** Taller than the deck, so a raised deck rests in front of it with the chains pulling down to its tip. */
const GANTRY_H = 3.7;

/**
 * Drawbridge across a three-tile river. The deck hinges on the near (-Z) bank; chains run from a
 * timber gantry over the hinge to the deck's far corners. `Bridge` swings its `deck` and aims its `chain`s.
 */
function createBridgeMesh():THREE.Group {
	const deckWood = toon(PALETTE.woodLight);
	const dark = toon(PALETTE.woodDark);
	const iron = toon(PALETTE.iron, { rim: 0.35 });
	const stone = toon(PALETTE.wall, { pattern: 'stone', patternScale: 0.18, patternInk: 0.5 });
	const g = new THREE.Group();
	const half = BRIDGE_LEN * 0.5;

	// Deck: planks across, slightly uneven, on two stringers; cross-braced rails on both sides.
	// Lowered, the plank tops sit at `BRIDGE_DECK_Y`, where walkers stand.
	const hinge = new THREE.Group();
	hinge.name = 'deck';
	hinge.position.set(0, 0.06, -half);
	const plankN = 11;
	const pitch = BRIDGE_LEN / plankN;
	const plank = new THREE.BoxGeometry(BRIDGE_W, 0.07, pitch - 0.03);
	hinge.add(solidMesh(mergeParts(Array.from({ length: plankN }, (element, i) => ({
		geo: plank,
		x: ((i * 37) % 5 - 2) * 0.012,
		y: 0.1 + ((i * 53) % 3) * 0.006,
		z: (i + 0.5) * pitch,
		ry: ((i * 29) % 5 - 2) * 0.012,
	}))), deckWood));
	const stringer = new THREE.BoxGeometry(0.12, 0.12, BRIDGE_LEN);
	const post = new THREE.BoxGeometry(0.08, 0.62, 0.08);
	const rail = new THREE.BoxGeometry(0.07, 0.07, BRIDGE_LEN - 0.04);
	const bay = (BRIDGE_LEN - 0.1) / 3;
	const brace = new THREE.BoxGeometry(0.05, Math.hypot(bay, 0.42), 0.05);
	const frame:PosedPart[] = [];
	for (const side of [-1, 1]) {
		const x = side * (BRIDGE_W * 0.5 - 0.05);
		frame.push({ geo: stringer, x, y: 0.0, z: half });
		frame.push({ geo: rail, x, y: 0.72, z: half });
		for (let p = 0; p <= 3; p++) {
			frame.push({ geo: post, x, y: 0.44, z: 0.05 + p * bay });
		}
		for (let b = 0; b < 3; b++) {
			const tilt = Math.atan2(bay, 0.42) * (b % 2 === 0 ? 1 : -1);
			frame.push({ geo: brace, x, y: 0.44, z: 0.05 + (b + 0.5) * bay, rx: tilt });
		}
	}
	hinge.add(solidMesh(mergeParts(frame), dark));
	const eye = new THREE.TorusGeometry(0.05, 0.015, 4, 8);
	eye.rotateY(Math.PI / 2);
	hinge.add(solidMesh(mergeParts([-1, 1].map((side) => ({ geo: eye, x: side * (BRIDGE_W * 0.5 - 0.05), y: 0.78, z: BRIDGE_LEN - 0.1 }))), iron, false));
	g.add(hinge);

	// Stone abutments where the deck lands, at both banks: tops just over the grass, under the stringers.
	const pier = new THREE.BoxGeometry(BRIDGE_W + 0.36, 0.6, 0.42);
	g.add(solidMesh(mergeParts([-1, 1].map((side) => ({ geo: pier, x: 0, y: -0.29, z: side * (half + 0.12) }))), stone));

	// Gantry over the hinge: two posts, a beam, a winch drum and pulleys for the chains.
	const gz = -half - 0.32;
	const gPost = new THREE.BoxGeometry(0.16, GANTRY_H, 0.16);
	const gBeam = new THREE.BoxGeometry(BRIDGE_W + 0.6, 0.16, 0.18);
	const gStrut = new THREE.BoxGeometry(0.08, 0.9, 0.08);
	const gx = BRIDGE_W * 0.5 + 0.14;
	g.add(solidMesh(mergeParts([
		{ geo: gPost, x: -gx, y: GANTRY_H * 0.5, z: gz },
		{ geo: gPost, x: gx, y: GANTRY_H * 0.5, z: gz },
		{ geo: gBeam, x: 0, y: GANTRY_H, z: gz },
		{ geo: gStrut, x: -gx + 0.24, y: GANTRY_H - 0.32, z: gz, rz: -0.6 },
		{ geo: gStrut, x: gx - 0.24, y: GANTRY_H - 0.32, z: gz, rz: 0.6 },
	]), dark));
	const drum = new THREE.CylinderGeometry(0.11, 0.11, BRIDGE_W - 0.1, 10);
	drum.rotateZ(Math.PI / 2);
	const pulley = new THREE.CylinderGeometry(0.09, 0.09, 0.06, 10);
	pulley.rotateZ(Math.PI / 2);
	const chainX = BRIDGE_W * 0.5 - 0.05;
	g.add(solidMesh(mergeParts([
		// High under the beam, clear of the walkway; the chains wind onto it over the pulleys.
		{ geo: drum, x: 0, y: GANTRY_H - 0.5, z: gz },
		{ geo: pulley, x: -chainX, y: GANTRY_H - 0.14, z: gz + 0.12 },
		{ geo: pulley, x: chainX, y: GANTRY_H - 0.14, z: gz + 0.12 },
	]), iron));

	// Chains: one unit-long bar each, from its pulley (`from`) to the deck's tip (`end`, on the deck), aimed each frame.
	const link = new THREE.BoxGeometry(0.035, 0.035, 1);
	link.translate(0, 0, 0.5);
	for (const side of [-1, 1]) {
		const chain = solidMesh(link, iron);
		chain.name = 'chain';
		chain.userData = { from: { x: side * chainX, y: GANTRY_H - 0.14, z: gz + 0.12 }, end: { x: side * chainX, y: 0.78, z: BRIDGE_LEN - 0.1 } };
		g.add(chain);
	}
	return g;
}

function createLeverMesh():THREE.Group {
	const wood = plankMat();
	const g = new THREE.Group();
	const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.05, 0.14), wood);
	post.position.y = 0.52;
	post.castShadow = true;
	g.add(post);
	const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.7), toon(0x6a3a22));
	arm.position.set(0, 0.92, 0.2);
	g.add(arm);
	return g;
}

/** The levers, and each chunk's drawbridge: all its spans are one bridge, raised to start with. */
export const bridge:Thing = {
	defs: ['bridge_lever', 'bridge_span'],
	spawn: (world, chunk, ents) => {
		for (const ent of ents.filter((e) => e.def === 'bridge_lever')) {
			const lever = thingAt(chunk, { ...ent, name: ent.name ?? 'BridgeLever' }, 'BridgeLever', 'BridgeLever');
			lever.addComponent(DemoMeshRenderer, { meshID: 'bridge_lever' });
			lever.addComponent(BridgeLever, { bridge: ent.works ?? '' });
			lever.addComponent(BoxCollider, { size: { x: 0.3, y: 1, z: 0.3 }, solid: false, isTrigger: true });
			world.add(lever);
		}
		const spans = ents.filter((e) => e.def === 'bridge_span');
		if (spans.length === 0) {
			return;
		}
		const cells = spans.map((ent) => chunk.worldCellCenter(ent.localX, ent.localZ));
		const box = boundsOf(cells);
		const go = new GameObject(spans[0]!.name ?? 'Bridge', 'Bridge');
		go.transform.localPosition = { x: (box.minX + box.maxX) / 2, y: 0.02, z: (box.minZ + box.maxZ) / 2 };
		go.addComponent(DemoMeshRenderer, { meshID: 'bridge' });
		go.addComponent(Bridge, { open: false, cells });
		go.addComponent(BoxCollider, { size: { x: Math.max(1.4, box.maxX - box.minX + CELL_SIZE), y: 1.2, z: Math.max(1.4, box.maxZ - box.minZ + CELL_SIZE) }, solid: true });
		go.addComponent(Named, { id: go.id });
		go.addComponent(ChunkBound, { chunkID: chunk.id });
		world.add(go);
	},
	meshes: {
		bridge: sharedMesh(createBridgeMesh, natureReady),
		bridge_lever: sharedMesh(createLeverMesh, natureReady),
	},
};
