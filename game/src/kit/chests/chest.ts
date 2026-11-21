import * as THREE from 'three';
import { Component, MeshRenderer, type GameObject, type SfxPatch } from '@arc-director/kindling';
import { pascalCase, showNamingText, type NamingText } from 'arc-director';
import { cueAt } from '../../audio/cue';
import { BoxCollider, Lock, lockedNote, Named, setOpen, TAKE_REACHED, idOf } from '../../engine/components';
import { DemoMeshRenderer } from '../../engine/demo-mesh-renderer';
import type { DemoWorld } from '../../engine/demo-world';
import { nameList } from '../../director/names';
import { Container } from '../../items/item-components';
import { itemMatchesName, tryInsert } from '../../items/inventory';
import { itemID, type ItemInstance } from '../../items/instance';
import type { UseResult } from '../../items/use';
import { chestMaterial, getSheet, sheetReady } from '../../render/spritesheet';
import { toon } from '../../render/toon';
import { makeLoot, sharedMesh, thingAt, type Sense, type Thing } from '../thing';

/** A lid's creak, thump and click opening, and its thump shutting. */
const SFX = {
	open: {
		gain: 0.88,
		layers: [
			{ kind: 'creak', dur: 0.32, freq: 60, freqTo: 38, cutoff: 420, q: 6, gain: 0.55 },
			{ kind: 'thump', dur: 0.1, freq: 120, gain: 0.4 },
			{ kind: 'click', dur: 0.05, freq: 880, when: 0.12, cutoff: 2400, gain: 0.5 },
		],
	},
	close: {
		gain: 0.9,
		layers: [
			{ kind: 'thump', dur: 0.16, freq: 95, gain: 0.75 },
			{ kind: 'noise', dur: 0.08, cutoff: 500, gain: 0.35 },
		],
	},
} satisfies Record<string, SfxPatch>;

export class Chest extends Component {
	public static override saved = ['open'];
	public open = false;

	/** Opens or shuts its lid, with its sound. `unlock` turns its key first ({@link Lock.turnKey}). */
	public setOpen(open:boolean, unlock = false):void {
		setOpen(this, open, unlock, SFX);
	}

	/** Its key opens it ({@link Lock.useKey}). */
	public useOn(character:GameObject, item:ItemInstance):UseResult | undefined {
		return this.gameObject.getComponent(Lock)?.useKey(character, item, () => this.setOpen(true, true));
	}

	/** Open, the lid swings up and back on its hinge, a little past upright. */
	public override lateUpdate():void {
		const lid = this.gameObject.getComponent(MeshRenderer)?.mesh?.getObjectByName('lid');
		if (lid) {
			lid.rotation.x = this.open ? 1.9 : 0;
		}
	}

	/** Furniture that holds things, as minds see it. */
	public sense():Sense {
		return {
			tags: ['chest', 'furniture'],
			prominent: true,
			interactable: true,
			movable: false,
			state: { lid: this.open ? 'open' : 'shut' },
			examine: (name, nameOf, viewer) => `${name} is a chest, ${this.open ? 'open' : 'shut'}${lockedNote(this.gameObject, nameOf, viewer)}.${this.inside(viewer)}`,
		};
	}

	/** What the player's E finds in it open and unlocked (` It contains Almanac.`); a mind's `examine` is told nothing of it. */
	protected inside(viewer?:GameObject):string {
		const bag = this.gameObject.getComponent(Container);
		return !viewer && this.open && !this.gameObject.getComponent(Lock)?.locked && bag ? ` It contains ${nameList(bag.contents.map((it) => pascalCase(it.name) || it.name)) || 'nothing'}.` : '';
	}
}

export type ChestHold = {
	chest:GameObject;
	item:ItemInstance;
	bag:Container;
};

/** `name` in `chest`, or nothing. */
export function chestHolding(chest:GameObject, name:string):ChestHold | null {
	const bag = chest.getComponent(Chest) ? chest.getComponent(Container) : undefined;
	const item = bag?.contents.find((it) => itemMatchesName(it, name));
	return bag && item ? { chest, item, bag } : null;
}

export function findChestHolding(world:DemoWorld, name:string):ChestHold | null {
	for (const go of world.objects) {
		const held = chestHolding(go, name);
		if (held) {
			return held;
		}
	}
	return null;
}

/** `character` takes `held` out of its chest: `took Almanac from CottageBookshelf`, or why not, naming by id. */
export function takeFromChest(character:GameObject, held:ChestHold):NamingText {
	const lock = held.chest.getComponent(Lock);
	const chestID = idOf(held.chest);
	if (lock?.locked) {
		return (name) => `${name(chestID)} is locked`;
	}
	if (!tryInsert(character, held.item)) {
		return 'no room';
	}
	// A shut chest's lid is lifted to take from it.
	held.chest.getComponent(Chest)?.setOpen(true);
	const i = held.bag.contents.indexOf(held.item);
	if (i >= 0) {
		held.bag.contents.splice(i, 1);
	}
	character.world?.after(TAKE_REACHED, () => cueAt(character.world, 'take', character));
	return (name) => `took ${name(itemID(held.item))} from ${name(chestID)}`;
}

export function interactChest(character:GameObject, chestGo:GameObject):string {
	const chest = chestGo.getComponent(Chest);
	const bag = chestGo.getComponent(Container);
	const lock = chestGo.getComponent(Lock);
	const name = idOf(chestGo);
	if (!chest || !bag) {
		return 'not a chest';
	}
	if (lock?.locked) {
		const refused = lock.refusal(character);
		if (refused) {
			return refused;
		}
		chest.setOpen(true, true);
		return 'unlocked';
	}
	if (!chest.open) {
		chest.setOpen(true);
		return 'opened';
	}
	const first = bag.contents[0];
	if (!first) {
		return `${name} is empty`;
	}
	return showNamingText(takeFromChest(character, { chest: chestGo, item: first, bag }));
}

function barrelLidGeometry(radius:number, width:number, segs = 12):THREE.BufferGeometry {
	const pos:number[] = [];
	const uv:number[] = [];
	const idx:number[] = [];
	const hw = width * 0.5;
	for (let i = 0; i <= segs; i++) {
		const t = i / segs;
		const ang = Math.PI * t;
		const y = Math.sin(ang) * radius;
		const z = Math.cos(ang) * radius;
		pos.push(-hw, y, z, hw, y, z);
		uv.push(0, 1 - t, 1, 1 - t);
	}
	for (let i = 0; i < segs; i++) {
		const a = i * 2;
		idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	geo.setIndex(idx);
	geo.computeVertexNormals();
	return geo;
}

/**
 * A half disc standing up in its XY plane, flat edge on y = 0: a barrel lid's end. Its texture spans it whole, the
 * bottom of the picture along the flat edge and the top at the crown.
 */
function halfDiscGeometry(radius:number, segs = 12):THREE.BufferGeometry {
	const pos:number[] = [0, 0, 0];
	const uv:number[] = [0.5, 0];
	const idx:number[] = [];
	for (let i = 0; i <= segs; i++) {
		const ang = Math.PI * (i / segs);
		const x = Math.cos(ang) * radius;
		const y = Math.sin(ang) * radius;
		pos.push(x, y, 0);
		uv.push((x / radius + 1) / 2, y / radius);
		if (i > 0) {
			idx.push(0, i, i + 1);
		}
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	geo.setIndex(idx);
	geo.computeVertexNormals();
	return geo;
}

function createChestMesh():THREE.Group {
	const faces = getSheet().chest;
	const nrm = getSheet().chestN;
	const met = getSheet().chestM;
	/** The dark wood inside, its rim, and nothing (the open top of its body). */
	const inside = { wood: toon(0x2a1a10, { side: THREE.BackSide }), rim: toon(0x4a3b2c), none: new THREE.MeshBasicMaterial({ visible: false }) };
	const g = new THREE.Group();

	const width = 0.68;
	const depth = 0.44;
	const bodyH = 0.26;
	const radius = depth * 0.5;
	/** How thick its walls are, as seen down into it open. */
	const wall = 0.035;

	// The body: four sides and a bottom outside, no top, so an open chest shows its hollow.
	const body = new THREE.Mesh(
		new THREE.BoxGeometry(width, bodyH, depth),
		[
			chestMaterial(faces.right, { normalMap: nrm.right, metalnessMap: met.right }),
			chestMaterial(faces.left, { normalMap: nrm.left, metalnessMap: met.left }),
			inside.none,
			chestMaterial(faces.bottom, { normalMap: nrm.bottom, metalnessMap: met.bottom }),
			chestMaterial(faces.back, { normalMap: nrm.back, metalnessMap: met.back }),
			chestMaterial(faces.front, { normalMap: nrm.front, metalnessMap: met.front }),
		],
	);
	body.position.y = bodyH * 0.5;
	body.castShadow = true;
	body.receiveShadow = false;
	g.add(body);

	// Inside: its walls and floor seen from within (the box's back faces), open at the top.
	const innerH = bodyH - wall;
	const inner = new THREE.Mesh(new THREE.BoxGeometry(width - wall * 2, innerH, depth - wall * 2), inside.wood);
	inner.position.y = wall + innerH * 0.5;
	g.add(inner);
	// The rim: the tops of its walls, between the outside and the hollow.
	const rimH = 0.01;
	const rims:[number, number, number, number][] = [
		[width, wall, 0, (depth - wall) * 0.5],
		[width, wall, 0, -(depth - wall) * 0.5],
		[wall, depth - wall * 2, (width - wall) * 0.5, 0],
		[wall, depth - wall * 2, -(width - wall) * 0.5, 0],
	];
	for (const [w, d, x, z] of rims) {
		const rim = new THREE.Mesh(new THREE.BoxGeometry(w, rimH, d), inside.rim);
		rim.position.set(x, bodyH - rimH * 0.5, z);
		g.add(rim);
	}

	// The lid and its two ends hang from a hinge along the back (+Z; the front is −Z), so opening swings them up as one.
	const hinge = new THREE.Group();
	hinge.name = 'lid';
	hinge.position.set(0, bodyH, radius);
	g.add(hinge);

	const lidGeo = barrelLidGeometry(radius, width);
	const lid = new THREE.Mesh(lidGeo, chestMaterial(faces.lid, { normalMap: nrm.lid, metalnessMap: met.lid }));
	lid.position.z = -radius;
	lid.castShadow = true;
	lid.receiveShadow = false;
	hinge.add(lid);
	// Its underside, plain dark wood, for when it stands open.
	const under = new THREE.Mesh(lidGeo, inside.wood);
	under.position.z = -radius;
	hinge.add(under);

	// Its ends: half discs that follow the lid's curve, the lid-end picture on each.
	const endGeo = halfDiscGeometry(radius);
	for (const [side, map, normalMap, metalnessMap] of [
		[-1, faces.lidEndL, nrm.lidEndL, met.lidEndL],
		[1, faces.lidEndR, nrm.lidEndR, met.lidEndR],
	] as const) {
		const end = new THREE.Mesh(endGeo, chestMaterial(map, { normalMap, metalnessMap }));
		end.material.side = THREE.DoubleSide;
		end.position.set(side * width * 0.5, 0, -radius);
		end.rotation.y = side * Math.PI / 2;
		end.castShadow = true;
		hinge.add(end);
	}

	return g;
}

/** Chests, locked with an iron key unless the map says otherwise, holding what the map puts in them. */
export const chest:Thing = {
	defs: ['chest'],
	spawn: (world, chunk, ents) => ents.forEach((ent) => {
		const go = thingAt(chunk, ent, `chest_${chunk.id}_${ent.localX}_${ent.localZ}`, 'Chest');
		go.transform.yaw = ent.yaw ?? Math.PI;
		go.addComponent(DemoMeshRenderer, { meshID: 'chest' });
		go.addComponent(Chest);
		go.addComponent(Container, { size: 8 }).contents.push(...(ent.contents ?? []).map(makeLoot));
		go.addComponent(Lock, { keyID: ent.keyID ?? 'iron', locked: ent.locked ?? true });
		go.addComponent(BoxCollider, { size: { x: 0.7, y: 0.5, z: 0.48 } });
		world.add(go);
	}),
	meshes: { chest: sharedMesh(createChestMesh, sheetReady) },
};
