import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { ToonMaterial } from '../render/ToonMaterial.js';
import { register } from './meshes.js';
import { poseRetargeter, type Quat, type RigRest } from './retarget.js';
import { patchShader } from '../render/shader.js';

/** One morph target an expression drives, at full expression weight. */
export type ToonExpressionTarget = { target:string; weight:number };

/** What a rigged character GLB carries on its glTF scene's `extras.toon` (`scripts/buildModels.mjs` writes it). */
export type ToonModelData = {
	/** Humanoid bone (`hips`, `head`, `leftUpperArm`, …) → node name. */
	humanoid:Record<string, string>;
	/** Expression (`joy`, `angry`, …) → the morph targets it sets. Models without face shapes have none. */
	expressions?:Record<string, ToonExpressionTarget[]>;
};

export type ToonModelOptions = {
	/** Scale the model so it stands this tall, in meters. Omitted keeps the file's size. */
	height?:number;
	/** Scales every color (default 1), to keep painted textures from washing out under bright light. */
	brightness?:number;
	/** Ramp steps for every material (default two-tone: a light shadow and full light). */
	bands?:number[];
};

/** Two-tone anime cel: shadow side keeps most of the light, so skin stays clean. */
const CHARACTER_BANDS = [0.7, 1];

/**
 * Rest pose of a rig (nodes by name), its humanoid map, and its hips: node name, rest position,
 * the turn of their parent (all relative to the model's scene), and height above the scene origin.
 */
type Rest = {
	rig:RigRest;
	humanoid:Record<string, string>;
	hips:string;
	hipsAt:THREE.Vector3;
	hipsParent:THREE.Quaternion;
	hipsY:number;
};

/** Per registered model: its own clips (models off the shared skeleton), its rest pose, and the file's turn inside an instance's root. */
const models = new Map<string, { clips:THREE.AnimationClip[]; rest:Rest; turn:THREE.Quaternion }>();
/** Clips shared by every humanoid model, from {@link registerToonClips}. */
const library:{ clips:Map<string, THREE.AnimationClip>; rest:Rest | null } = { clips: new Map(), rest: null };
/** Frame rate library clips are resampled at when fitted to a model. */
const FIT_FPS = 30;

function restOf(scene:THREE.Object3D):Rest {
	// Every node below the scene, not only bones: the clip library has no skin, so its joints load as
	// plain nodes.
	const rig:RigRest = { order: [], parent: new Map(), rest: new Map() };
	scene.traverse((obj) => {
		if (obj === scene || !obj.name) {
			return;
		}
		rig.order.push(obj.name);
		rig.parent.set(obj.name, obj.parent && obj.parent !== scene ? obj.parent.name : undefined);
		rig.rest.set(obj.name, obj.quaternion.toArray() as Quat);
	});
	const humanoid = Object.fromEntries(Object.entries(toonModelData(scene)?.humanoid ?? {})
		.map(([bone, node]) => [bone, THREE.PropertyBinding.sanitizeNodeName(node)]));
	const hips = humanBone(scene, 'hips');
	const hipsAt = hips?.position.clone() ?? new THREE.Vector3();
	const hipsParent = new THREE.Quaternion();
	let hipsY = 1;
	if (hips) {
		// Relative to the scene, whatever turn and scale the host gave it.
		scene.updateMatrixWorld(true);
		const toScene = new THREE.Matrix4().copy(scene.matrixWorld).invert();
		hipsY = hips.getWorldPosition(new THREE.Vector3()).applyMatrix4(toScene).y;
		if (hips.parent) {
			new THREE.Matrix4().multiplyMatrices(toScene, hips.parent.matrixWorld).decompose(new THREE.Vector3(), hipsParent, new THREE.Vector3());
		}
	}
	return { rig, humanoid, hips: hips?.name ?? '', hipsAt, hipsParent, hipsY: hipsY || 1 };
}

/**
 * A shared clip fitted to one model: rotations retargeted onto its rig through the two humanoid
 * maps (same-named bones match directly), resampled at {@link FIT_FPS}; hips motion turned into the
 * model's frame and scaled to its hip height.
 */
function fit(shared:THREE.AnimationClip, from:Rest, to:Rest):THREE.AnimationClip {
	const byRole = new Map(Object.entries(to.humanoid).map(([role, node]) => [node, from.humanoid[role]]));
	const retarget = poseRetargeter(from.rig, to.rig, (bone) => byRole.get(bone) ?? bone);
	const rotations = new Map<string, THREE.Interpolant>();
	const tracks:THREE.KeyframeTrack[] = [];
	for (const track of shared.tracks) {
		const [bone, property] = track.name.split('.');
		if (property === 'quaternion' && bone) {
			rotations.set(bone, new THREE.QuaternionLinearInterpolant(track.times, track.values, 4, new Float32Array(4)));
		}
		else if (property === 'position' && bone === from.hips && to.hips) {
			tracks.push(fitHips(track, from, to));
		}
	}
	// Target bones driven by a source bone with keys; the rest only follow their parents.
	const driven = to.rig.order.filter((bone) => rotations.has(byRole.get(bone) ?? bone));
	const frames = Math.max(2, Math.round(shared.duration * FIT_FPS) + 1);
	const times = Float32Array.from({ length: frames }, (_, f) => (f / (frames - 1)) * shared.duration);
	const keys = new Map(driven.map((bone) => [bone, new Float32Array(frames * 4)]));
	times.forEach((t, f) => {
		const pose = retarget((bone) => {
			const v = rotations.get(bone)?.evaluate(t);
			return v ? [v[0]!, v[1]!, v[2]!, v[3]!] : undefined;
		});
		for (const [bone, k] of keys) {
			k.set(pose.get(bone) ?? [0, 0, 0, 1], f * 4);
		}
	});
	for (const [bone, k] of keys) {
		tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, k));
	}
	return new THREE.AnimationClip(shared.name, shared.duration, tracks);
}

/** The hips' sway and bob, moved from one rig's hips frame into another's and scaled to its height. */
function fitHips(track:THREE.KeyframeTrack, from:Rest, to:Rest):THREE.KeyframeTrack {
	const ratio = to.hipsY / from.hipsY;
	// Offsets in the source hips' parent frame → scene → the target hips' parent frame.
	const turn = to.hipsParent.clone().invert().multiply(from.hipsParent);
	const values = new Float32Array(track.values.length);
	const d = new THREE.Vector3();
	for (let i = 0; i < values.length; i += 3) {
		d.fromArray(track.values, i).sub(from.hipsAt).multiplyScalar(ratio).applyQuaternion(turn).add(to.hipsAt);
		d.toArray(values, i);
	}
	return new THREE.VectorKeyframeTrack(`${to.hips}.position`, track.times, values);
}

/** Library clips fitted to a model, per `meshID`. */
const fitted = new Map<string, Map<string, THREE.AnimationClip>>();

/**
 * Load a character or prop GLB and register `meshID` for `MeshRenderer`. Rigged models get skinned
 * clones, so each instance poses on its own; materials are {@link ToonMaterial}s shared by all
 * instances. Play clips with {@link Animator}.
 */
export async function registerToonModel(meshID:string, url:string, options:ToonModelOptions = {}):Promise<void> {
	const { height, brightness = 1, bands = CHARACTER_BANDS } = options;
	const gltf = await new GLTFLoader().loadAsync(url);
	const scene = gltf.scene;
	// Mixamo-rigged and VRM 0.x models face +Z; Kindling's yaw 0 faces −Z.
	scene.rotation.y = Math.PI;
	if (height) {
		const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
		scene.scale.setScalar(height / (size.y || 1));
	}
	// The turn and scale stay on the loaded scene, under a plain root the host may pose freely.
	const template = new THREE.Group();
	template.userData = { ...scene.userData };
	template.add(scene);
	const toons = new Map<THREE.Material, ToonMaterial>();
	template.traverse((obj) => {
		const mesh = obj as THREE.Mesh;
		if (!mesh.isMesh) {
			return;
		}
		const src = mesh.material as THREE.MeshStandardMaterial;
		let toon = toons.get(src);
		if (!toon) {
			toon = new ToonMaterial({
				name: src.name,
				bands,
				map: src.map,
				color: src.color.clone().multiplyScalar(brightness),
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
		mesh.castShadow = !src.transparent;
		mesh.receiveShadow = true;
		patchShader(toon, 'othersShadow', (shader) => {
			shader.fragmentShader = shader.fragmentShader.replace(
				'sunShadow *= receiveShadow ? getShadow(',
				'sunShadow *= (receiveShadow && dot(directionalLights[ i ].color, directionalLights[ i ].color) > 0.0) ? getShadow(',
			);
		});
	});
	// The scene, not the root: rest poses must match the clip library's, which has no turn above it.
	models.set(meshID, { clips: gltf.animations, rest: restOf(scene), turn: scene.quaternion.clone() });
	fitted.delete(meshID);
	register(meshID, () => {
		const inst = cloneSkinned(template);
		inst.userData.meshID = meshID;
		return inst;
	});
}

/**
 * Load the clip library shared by every model on the common skeleton (`clips.glb` from
 * `scripts/buildModels.mjs`). Later calls add clips; same names replace.
 */
export async function registerToonClips(url:string):Promise<void> {
	const gltf = await new GLTFLoader().loadAsync(url);
	for (const clip of gltf.animations) {
		library.clips.set(clip.name, clip);
	}
	library.rest = restOf(gltf.scene);
	fitted.clear();
}

/** A clip for a model instance: the model's own clip of that name, else the shared one fitted to it. */
export function toonClip(root:THREE.Object3D, name:string):THREE.AnimationClip | undefined {
	const meshID = root.userData.meshID as string | undefined;
	const model = meshID ? models.get(meshID) : undefined;
	const own = model?.clips.find((c) => c.name === name);
	if (own || !meshID || !model) {
		return own;
	}
	let cache = fitted.get(meshID);
	if (!cache) {
		cache = new Map();
		fitted.set(meshID, cache);
	}
	let clip = cache.get(name);
	if (!clip) {
		const shared = library.clips.get(name);
		if (!shared) {
			return undefined;
		}
		clip = library.rest ? fit(shared, library.rest, model.rest) : shared;
		cache.set(name, clip);
	}
	return clip;
}

/**
 * A node's rest rotation relative to an instance's root (which faces −Z, like every Kindling
 * model), for an instance of a registered model. A T-posed hand's rest says which way its fist and
 * palm point.
 */
export function restTurn(root:THREE.Object3D, node:string):THREE.Quaternion | undefined {
	const model = models.get(root.userData.meshID as string);
	const rig = model?.rest.rig;
	if (!model || !rig?.rest.has(node)) {
		return undefined;
	}
	const turn = new THREE.Quaternion();
	for (let n:string | undefined = node; n; n = rig.parent.get(n)) {
		turn.premultiply(new THREE.Quaternion().fromArray(rig.rest.get(n) ?? [0, 0, 0, 1]));
	}
	return turn.premultiply(model.turn);
}

/** The converter's data on a toon model instance's root, if it is one. */
export function toonModelData(root:THREE.Object3D):ToonModelData | undefined {
	return root.userData.toon as ToonModelData | undefined;
}

/** A humanoid bone of a toon model instance by its VRM name (`head`, `leftHand`, …). */
export function humanBone(root:THREE.Object3D, bone:string):THREE.Object3D | undefined {
	const name = toonModelData(root)?.humanoid[bone];
	return name ? root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name)) : undefined;
}

/**
 * Set one expression's weight (0–1) on a toon model instance. Expressions add up per morph target,
 * so set the old one to 0 when switching. Unknown names do nothing.
 */
export function setExpression(root:THREE.Object3D, expression:string, weight:number):void {
	const targets = toonModelData(root)?.expressions?.[expression];
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
