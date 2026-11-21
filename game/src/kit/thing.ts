import type * as THREE from 'three';
import { ChunkBound, GameObject, hash, type MeshFactory } from '@arc-director/kindling';
import { BoxCollider, Named } from '../engine/components';
import { DemoMeshRenderer } from '../engine/demo-mesh-renderer';
import type { DemoWorld } from '../engine/demo-world';
import { getDef } from '../items/defs';
import { instantiateDef, type ItemInstance } from '../items/instance';
import type { UseResult } from '../items/use';
import { TILE_HEIGHT } from '../world/constants';
import type { LootSpec } from '../world/decode-glyph-chunk';
import type { ChunkEntity, DemoChunk } from '../world/demo-chunk';

/** A kind of thing on the maps (a door, a chest, a bridge): what it spawns from, and how it looks. */
export type Thing = {
	/** Legend `def`s it spawns from. */
	defs:readonly string[];
	/** Once per chunk, with every entity of `defs` on it: one door each, every span of one bridge, a counter's row. */
	spawn(world:DemoWorld, chunk:DemoChunk, ents:ChunkEntity[]):void;
	/** Mesh factories by mesh id, registered before a scene spawns. Each returns `undefined` until its art is loaded; Kindling asks again next frame. */
	meshes?:Record<string, MeshFactory>;
};

/** What a component tells the minds that see its object. Perception gathers it from every enabled component with `sense()`, in component order. */
export type Sense = {
	tags?:string[];
	interactable?:boolean;
	movable?:boolean;
	/** Said beside it in sight ("open", "it is raised"); the first one wins. */
	note?:string;
	/** Aimed at before what stands near it (a door, a chest, a web, the bridge and its lever). */
	prominent?:true;
	/** Seen however far off (the bridge). */
	always?:boolean;
	/** What `examine` says of it: `name` is what the viewer calls it, `nameOf` how it names anyone else. */
	examine?:(name:string, nameOf:(id:string)=>string, viewer?:GameObject)=>string;
};

/** A component that tells minds of its object. */
const senses = (c:object):c is { sense():Sense } => 'sense' in c && typeof c.sense === 'function';

/** What each enabled component of `go` tells minds of it (`sense()`), in component order. */
export function sensesOf(go:GameObject):Sense[] {
	return go.components().flatMap((c) => (c.enabled && senses(c) ? [c.sense()] : []));
}

/** Where a glyph entity stands: its cell's center moved by its `offset`, on its tile's top. */
export function entityPoint(chunk:DemoChunk, ent:ChunkEntity):{ x:number; y:number; z:number } {
	const center = chunk.worldCellCenter(ent.localX, ent.localZ);
	return {
		x: center.x + (ent.offset?.x ?? 0),
		y: (chunk.tile(ent.localX, ent.localZ)?.height ?? 0) * TILE_HEIGHT + (ent.offset?.y ?? 0),
		z: center.z + (ent.offset?.z ?? 0),
	};
}

/** A new object for `ent`, where it stands, bound to its chunk, with the legend's `components`: called as the map names it (and `Named` so), else `id`. */
export function thingAt(chunk:DemoChunk, ent:ChunkEntity, id:string, name:string):GameObject {
	const go = new GameObject(ent.name ?? id, name);
	go.transform.localPosition = entityPoint(chunk, ent);
	go.addComponent(ChunkBound, { chunkID: chunk.id });
	if (ent.name) {
		go.addComponent(Named, { id: ent.name });
	}
	ent.components?.forEach((c) => go.addComponent(c));
	return go;
}

/**
 * A prop for `ent`, not yet in the world: `meshID`, turned `yaw` (else any way, by where it stands), solid `across` m
 * wide and `tall` m high (what stands taller than the eyes hides what is behind it).
 */
export function spawnProp(chunk:DemoChunk, ent:ChunkEntity, meshID:string, across:number, yaw?:number, tall = 1):GameObject {
	const go = thingAt(chunk, ent, `${meshID}_${chunk.id}_${ent.localX}_${ent.localZ}`, 'Prop');
	go.transform.yaw = yaw ?? hash(go.transform.position.x, go.transform.position.z) * Math.PI * 2;
	go.addComponent(DemoMeshRenderer, { meshID });
	go.addComponent(BoxCollider, { size: { x: across, y: tall, z: across } });
	return go;
}

function copyDepthMats(src:THREE.Object3D, dst:THREE.Object3D):void {
	(dst as THREE.Mesh).customDepthMaterial ??= (src as THREE.Mesh).customDepthMaterial;
	src.children.forEach((child, i) => copyDepthMats(child, dst.children[i]!));
}

/** Marks every geometry and material under `root` `userData.shared`, so releasing a copy never frees them. */
function markShared(root:THREE.Object3D):THREE.Object3D {
	root.traverse((node) => {
		const mesh = node as THREE.Mesh;
		if (mesh.isMesh) {
			mesh.geometry.userData.shared = true;
			[mesh.material].flat().forEach((mat) => {
				mat.userData.shared = true;
			});
		}
	});
	return root;
}

/**
 * A kind's mesh, built once (when `ready`) and copied for every object that shows it, the copies sharing its geometry
 * and materials. A copy's `userData` is copied as JSON, so a thing finds its moving parts by name.
 */
export function sharedMesh(build:()=>THREE.Object3D, ready = ():boolean => true):MeshFactory {
	let template:THREE.Object3D | undefined;
	return () => {
		if (!ready()) {
			return undefined;
		}
		template ??= markShared(build());
		const copy = template.clone(true);
		copyDepthMats(template, copy);
		return copy;
	};
}

/** A fresh item from a loot line, called by its given name. */
export function makeLoot(loot:LootSpec):ItemInstance {
	const inst = instantiateDef(getDef(loot.defID), loot.count ?? 1);
	inst.name = loot.name;
	inst.id = loot.name;
	return inst;
}
