import * as THREE from 'three';
import { Time, mergeParts, tube, type GameObject, type PosedPart } from '@arc-director/kindling';
import type { NamingText } from 'arc-director';
import { BoxCollider, idOf } from '../../engine/components';
import { DemoMeshRenderer } from '../../engine/demo-mesh-renderer';
import { getDef } from '../../items/defs';
import { instantiateDef, itemID, type ItemInstance } from '../../items/instance';
import { Container } from '../../items/item-components';
import { createMesh } from '../../items/item-meshes';
import { consume, cookingOf, fail, isFood, ok, type UseResult } from '../../items/use';
import { toon } from '../../render/toon';
import { Chest } from '../chests/chest';
import { Fire } from '../torches/fire';
import { sharedMesh, thingAt, type Sense, type Thing } from '../thing';

/** How high over the ground the spit holds what roasts on it (m): in the tips of the flames. */
const SPIT_HEIGHT = 0.56;
/** How far out from the middle the ring of stones lies (m), hugging the logs. */
const RING = 0.3;
/** How far apart the spit's forked uprights stand (m), along its length. */
const SPIT_SPAN = 1.1;

/**
 * A fire to cook on: a chest with no lid that holds one thing at a time, and only food, on its spit. Put on it with
 * `drop` or `use`, it turns into what its def cooks into (`Cookable`) after that many seconds, and so on, raw to
 * cooked to burnt, until someone takes it off with `pick_up` as from any chest.
 */
export class Campfire extends Chest {
	public static override saved = ['cooking', 'since'];
	public override open = true;
	/** The id of the item on the spit when it last went on or turned into what it is now, at `since` (game seconds). */
	public cooking = '';
	public since = 0;
	/** The spit's fish as drawn, and what it was drawn from. */
	private _shown:{ meshID:string; mesh:THREE.Object3D } | null = null;

	/** What is on the spit, if anything. */
	public get onSpit():ItemInstance | undefined {
		return this.gameObject.getComponent(Container)?.contents[0];
	}

	/** Only food goes on the spit, and only while it is free. */
	public override refuses(item:ItemInstance):NamingText | undefined {
		const on = this.onSpit;
		if (on) {
			return (name) => `${name(itemID(on))} is already on the spit over ${name(idOf(this.gameObject))}; take it off first`;
		}
		return isFood(item) ? undefined : (name) => `only food goes on the spit over ${name(idOf(this.gameObject))}`;
	}

	/** Food goes on the spit, one of it. Anything else is not for the fire. */
	public override useOn(character:GameObject, item:ItemInstance):UseResult | undefined {
		if (!isFood(item)) {
			return undefined;
		}
		const refusal = this.refuses(item);
		if (refusal) {
			return fail(refusal);
		}
		consume(character, item);
		this.gameObject.getComponent(Container)!.contents.push(instantiateDef(getDef(item.defID)));
		const cook = cookingOf(item);
		return ok((name) => `${name(itemID(item))} is on the spit over ${name(idOf(this.gameObject))}${cook ? `; in ${cook.seconds} seconds it is ${getDef(cook.into).name.toLowerCase()}` : ''}`);
	}

	/** What is on the spit cooks on, from the moment it went on: raw to cooked, cooked to burnt. */
	public override update():void {
		const bag = this.gameObject.getComponent(Container);
		const on = bag?.contents[0];
		if (!bag || !on) {
			this.cooking = '';
			return;
		}
		if (on.id !== this.cooking) {
			this.cooking = on.id;
			this.since = Time.time;
		}
		const next = cookingOf(on);
		if (next && Time.time - this.since >= next.seconds) {
			const turned = instantiateDef(getDef(next.into), on.count);
			bag.contents[0] = turned;
			this.cooking = turned.id;
			this.since += next.seconds;
		}
	}

	/** The fish on the spit, as what it now is. */
	public override lateUpdate():void {
		const meshID = this.onSpit?.meshID;
		if (meshID === this._shown?.meshID) {
			return;
		}
		this.unshow();
		if (meshID) {
			const mesh = createMesh(meshID);
			mesh.position.y = SPIT_HEIGHT - 0.035;
			this.gameObject.transform.object3D.add(mesh);
			this._shown = { meshID, mesh };
		}
	}

	public override onDisable():void {
		this.unshow();
	}

	/** What roasts, as minds see it: they are told when it changes. */
	public override sense():Sense {
		const on = this.onSpit;
		const what = on ? itemID(on) : undefined;
		return {
			tags: ['fire', 'cooking'],
			prominent: true,
			interactable: true,
			movable: false,
			note: what ? `${what} on the spit` : 'the spit is empty',
			state: { spit: what ?? 'empty' },
			examine: (name, nameOf) => `${name} is a cooking fire with a spit over it${what ? `, ${nameOf(what)} roasting on it` : ', empty'}.`,
		};
	}

	private unshow():void {
		if (!this._shown) {
			return;
		}
		this._shown.mesh.removeFromParent();
		this._shown.mesh.traverse((node) => {
			const mesh = node as THREE.Mesh;
			if (mesh.isMesh) {
				mesh.geometry.dispose();
				[mesh.material].flat().forEach((mat) => mat.dispose());
			}
		});
		this._shown = null;
	}
}

/**
 * A ring of fieldstones round a few logs burning down, and a spit across it (+X) on two forked sticks. The flames are
 * a `Fire`; what roasts on the spit, `Campfire` draws.
 */
function createCampfireMesh():THREE.Group {
	const g = new THREE.Group();
	const stone = toon(0x8a8478);
	const wood = toon(0x6b4423);
	const char = toon(0x2a2018);
	const ash = toon(0x6a625a, { outline: false });
	const rocks:PosedPart[] = Array.from({ length: 9 }, (unused, i) => {
		const a = (i / 9) * Math.PI * 2;
		const geo = new THREE.IcosahedronGeometry(0.09 + (i % 3) * 0.015, 0).scale(1.2, 0.75, 1);
		return { geo: geo.rotateY(a).translate(Math.cos(a) * RING, 0.05, Math.sin(a) * RING) };
	});
	const logs:PosedPart[] = [0.4, 2.1, 3.7, 5.2].map((a) => ({
		geo: tube([{ x: Math.cos(a) * 0.22, y: 0.03, z: Math.sin(a) * 0.22 }, { x: Math.cos(a) * 0.04, y: 0.16, z: Math.sin(a) * 0.04 }], 0.04, 6),
	}));
	// A forked stick at each end of the spit: a post, and two tines splayed across it.
	const forks:PosedPart[] = [-1, 1].flatMap((side) => {
		const x = side * SPIT_SPAN / 2;
		return [
			{ geo: tube([{ x, y: 0, z: 0 }, { x, y: SPIT_HEIGHT, z: 0 }], 0.022, 5) },
			...[-1, 1].map((tine) => ({ geo: tube([{ x, y: SPIT_HEIGHT - 0.04, z: 0 }, { x, y: SPIT_HEIGHT + 0.09, z: tine * 0.06 }], 0.014, 4) })),
		];
	});
	const spit = tube([{ x: -SPIT_SPAN / 2 - 0.12, y: SPIT_HEIGHT, z: 0 }, { x: SPIT_SPAN / 2 + 0.08, y: SPIT_HEIGHT, z: 0 }], 0.011, 5);
	const parts:[THREE.BufferGeometry, THREE.Material][] = [
		[mergeParts(rocks), stone],
		[mergeParts(logs), char],
		[mergeParts([...forks, { geo: spit }]), wood],
		[new THREE.CircleGeometry(RING - 0.05, 14).rotateX(-Math.PI / 2).translate(0, 0.012, 0), ash],
	];
	for (const [geo, mat] of parts) {
		const mesh = new THREE.Mesh(geo, mat);
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		g.add(mesh);
	}
	return g;
}

/** A campfire to cook on, named by the map, its spit turned by the legend's `yaw`. */
export const campfire:Thing = {
	defs: ['campfire'],
	spawn: (world, chunk, ents) => ents.forEach((ent) => {
		const go = thingAt(chunk, ent, `campfire_${chunk.id}_${ent.localX}_${ent.localZ}`, 'Campfire');
		go.transform.yaw = ent.yaw ?? 0;
		go.addComponent(DemoMeshRenderer, { meshID: 'campfire' });
		go.addComponent(BoxCollider, { size: { x: RING * 2 + 0.2, y: 0.4, z: RING * 2 + 0.2 }, shape: 'cylinder' });
		go.addComponent(Fire, { size: 0.62, height: 0.3, glow: 30 });
		go.addComponent(Container, { size: 1 });
		go.addComponent(Campfire);
		world.add(go);
	}),
	meshes: { campfire: sharedMesh(createCampfireMesh) },
};
