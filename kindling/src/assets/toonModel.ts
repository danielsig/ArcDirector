import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { ToonMaterial } from '../render/ToonMaterial.js';
import { register } from './meshes.js';

/** One morph target an expression drives, at full expression weight. */
export type ToonExpressionTarget = { target:string; weight:number };

/** One chain of spring bones (hair, skirt, sleeves), with the spheres it collides with. */
export type ToonSpring = {
	bones:string[];
	stiffness:number;
	gravity:number;
	drag:number;
	radius:number;
	colliders:{ bone:string; offset:[number, number, number]; radius:number }[];
};

/** What a rigged character GLB carries on its glTF scene's `extras.toon`. */
export type ToonModelData = {
	/** Humanoid bone (`hips`, `head`, `leftUpperArm`, …) → node name. */
	humanoid:Record<string, string>;
	/** Expression (`joy`, `angry`, `surprised`, `blink`, `a`, …) → the morph targets it sets. */
	expressions:Record<string, ToonExpressionTarget[]>;
	springs:ToonSpring[];
};

export type ToonModelOptions = {
	/**
	 * Scales every color (default 1). Avatar textures are painted to show as-is, so a bright scene
	 * light washes them out unless they are dimmed to match it.
	 */
	brightness?:number;
	/** Ramp steps for every material (default two-tone: a light shadow and full light). */
	bands?:number[];
};

/** Two-tone anime cel: shadow side keeps most of the light, so skin stays clean. */
const CHARACTER_BANDS = [0.7, 1];

/**
 * Load a rigged character GLB (with {@link ToonModelData} on `extras.toon`) and register `meshID` for
 * `MeshRenderer`. Each instance is a skinned clone with its own pose and expression; materials are
 * {@link ToonMaterial}s shared by all instances. Face layers (lashes, brows, highlights) draw
 * without outlines, in the source's order.
 */
export async function registerToonModel(meshID:string, url:string, options:ToonModelOptions = {}):Promise<void> {
	const { brightness = 1, bands = CHARACTER_BANDS } = options;
	const gltf = await new GLTFLoader().loadAsync(url);
	const template = gltf.scene;
	// VRM 0.x avatars face +Z; Kindling's yaw 0 faces −Z.
	template.rotation.y = Math.PI;
	const toons = new Map<THREE.Material, ToonMaterial>();
	template.traverse((obj) => {
		const mesh = obj as THREE.Mesh;
		if (!mesh.isMesh) {
			return;
		}
		const src = mesh.material as THREE.MeshStandardMaterial;
		let toon = toons.get(src);
		if (!toon) {
			const extras = (src.userData.toon ?? {}) as { shade?:[number, number, number] };
			toon = new ToonMaterial({
				name: src.name,
				bands,
				map: src.map,
				color: src.color.clone().multiplyScalar(brightness),
				shade: extras.shade ? new THREE.Color(...extras.shade) : 0xffffff,
				transparent: src.transparent,
				alphaTest: src.alphaTest,
				depthWrite: src.depthWrite,
				side: src.side,
				outline: !src.transparent,
			});
			toons.set(src, toon);
			src.dispose();
		}
		mesh.material = toon;
		mesh.renderOrder = (src.userData.toon?.order as number | undefined) ?? 0;
		mesh.castShadow = !src.transparent;
	});
	register(meshID, () => cloneSkinned(template));
}

/** The converter's data on a toon model instance's root, if it is one. */
export function toonModelData(root:THREE.Object3D):ToonModelData | undefined {
	return root.userData.toon as ToonModelData | undefined;
}

/** A humanoid bone of a toon model instance by its VRM name (`head`, `leftHand`, …). */
export function humanBone(root:THREE.Object3D, bone:string):THREE.Object3D | undefined {
	const name = toonModelData(root)?.humanoid[bone];
	return name ? root.getObjectByName(name) : undefined;
}

/**
 * Set one expression's weight (0–1) on a toon model instance. Expressions add up per morph target,
 * so set the old one to 0 when switching. Unknown names do nothing.
 */
export function setExpression(root:THREE.Object3D, expression:string, weight:number):void {
	const targets = toonModelData(root)?.expressions[expression];
	if (!targets) {
		return;
	}
	root.traverse((obj) => {
		const mesh = obj as THREE.Mesh;
		const dict = mesh.morphTargetDictionary;
		const influences = mesh.morphTargetInfluences;
		if (!dict || !influences) {
			return;
		}
		for (const t of targets) {
			const i = dict[t.target];
			if (i !== undefined) {
				influences[i] = t.weight * weight;
			}
		}
	});
}
