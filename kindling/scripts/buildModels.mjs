// Turns a folder of source GLBs (Tripo exports, Mixamo-rigged) into slim game GLBs.
//
//   node kindling/scripts/buildModels.mjs <srcDir> <outDir> [config.json]
//
// Needs Kindling built (`tsc`): it reuses `dist/assets/retarget.js`.
//
// The config (optional) holds the texture size and per-model fixes:
//   { "textureSize": 1024, "models": { "KnightMale": { "cloth": ["Skirt"] }, "Robe": { "innerShell": true } } }
// - `cloth`: these mesh nodes hang from the hips and blend into the leg on their side toward the hem
//   (for skirts and coat tails that were skinned to the wrong bones).
// - `humanoid`: VRM bone → node name, for a humanoid rigged off Mixamo; it then plays the shared clips.
// - `rigid`: mesh node → bone that carries all of it (a quiver Tripo smeared over the arm and head).
// - `innerShell`: a pitch-black inside for hollow garments (a robe with no legs reads as shadow).
// - `bow`: rig an unrigged bow (long axis +Y, string on −X) with five bones: `Grip`, `LimbUpper` and
//   `LimbLower` (weights fading out toward the grip), and `StringUpper` / `StringLower` from each tip
//   to the nock (the string's own vertices, all on one of them). The game draws it from code.
// - `bird`: rig an unrigged bird (facing +Z, wings spread along X): `Body`, `Head`, `Tail`, and
//   `WingL` / `WingTipL` / `WingR` / `WingTipR`. The game flaps, hops and pecks it from code.
// - `textureSize`: this model's largest texture side, instead of the config's (small props need less).
// - `keepMagenta`: skip the magenta cleanup (on by default: Tripo leaves hot-pink smears in
//   textures, e.g. in hair, which get repainted from the colors around them).
//
// Per model: base color textures only, shrunk to JPEG; no animations. A model in several parts
// becomes one skinned mesh per kind of material (opaque, see-through, the black inner shell), its
// textures packed into one atlas (up to twice the texture size), so it costs one draw call per pass. Rigged models get
// `extras.toon.humanoid` (VRM bone name → node name) on the scene, so `humanBone` works.
// All Mixamo-rigged models share one skeleton, so their clips go once into `<outDir>/clips.glb`
// (rotations for every bone, position for the hips only, so clips fit any body; the hips sway over
// the planted foot, as Tripo exports pin them and slide the feet instead). Models on another
// skeleton keep their own clips.
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { dedup, joinPrimitives, prune, resample, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import { poseRetargeter, qinv, qmul } from '../dist/assets/retarget.js';

const [srcDir, outDir, configPath] = process.argv.slice(2);
if (!srcDir || !outDir) {
	console.error('usage: node buildModels.mjs <srcDir> <outDir> [config.json]');
	process.exit(1);
}
const config = configPath ? JSON.parse(await readFile(configPath, 'utf8')) : {};
const maxSize = config.textureSize ?? 1024;
const MIXAMO = 'mixamorig:';
/** Meters above a clip's lowest ankle within which a foot is on the ground (see `plantFeet`). */
const GROUNDED = 0.04;
/** Meters lower the other foot must get before the weight moves onto it. */
const SHIFT = 0.01;

/** VRM humanoid bone → Mixamo bone. */
const HUMANOID = {
	hips: 'Hips', spine: 'Spine', chest: 'Spine1', upperChest: 'Spine2', neck: 'Neck', head: 'Head',
	leftShoulder: 'LeftShoulder', leftUpperArm: 'LeftArm', leftLowerArm: 'LeftForeArm', leftHand: 'LeftHand',
	rightShoulder: 'RightShoulder', rightUpperArm: 'RightArm', rightLowerArm: 'RightForeArm', rightHand: 'RightHand',
	leftUpperLeg: 'LeftUpLeg', leftLowerLeg: 'LeftLeg', leftFoot: 'LeftFoot', leftToes: 'LeftToeBase',
	rightUpperLeg: 'RightUpLeg', rightLowerLeg: 'RightLeg', rightFoot: 'RightFoot', rightToes: 'RightToeBase',
	...fingers('left', 'LeftHand'),
	...fingers('right', 'RightHand'),
};

/** VRM finger bones → Mixamo's (`leftIndexProximal` → `LeftHandIndex1`). */
function fingers(side, hand) {
	const out = {};
	for (const [vrm, mixamo] of [['Thumb', 'Thumb'], ['Index', 'Index'], ['Middle', 'Middle'], ['Ring', 'Ring'], ['Little', 'Pinky']]) {
		['Proximal', 'Intermediate', 'Distal'].forEach((joint, i) => {
			out[`${side}${vrm}${joint}`] = `${hand}${mixamo}${i + 1}`;
		});
	}
	return out;
}

/** `walk.001` → `walk`; Tripo's prompt-named clips get short names. */
function clipName(name) {
	const n = name.replace(/\.\d+$/, '');
	return /receive an item/i.test(n) ? 'receive' : n;
}

const io = new NodeIO();
await mkdir(outDir, { recursive: true });

/** The shared clip library: the first Mixamo-rigged model's skeleton, plus every distinct clip. */
let library = null;

for (const file of (await readdir(srcDir)).filter((f) => f.toLowerCase().endsWith('.glb')).sort()) {
	const doc = await io.read(join(srcDir, file));
	const root = doc.getRoot();
	const nodes = root.listNodes();
	const mixamo = nodes.some((n) => n.getName() === `${MIXAMO}Hips`);
	const fixes = config.models?.[basename(file, '.glb')] ?? {};
	if (mixamo) {
		adoptStrayWeights(doc);
	}
	for (const name of fixes.cloth ?? []) {
		hangFromHips(nodes.find((n) => n.getName() === name));
	}
	for (const [name, bone] of Object.entries(fixes.rigid ?? {})) {
		weightToBone(nodes.find((n) => n.getName() === name), MIXAMO + bone);
	}
	if (fixes.innerShell) {
		addInnerShell(doc);
	}
	if (fixes.bow) {
		rigBow(doc);
	}
	if (fixes.bird) {
		rigBird(doc);
	}

	for (const material of root.listMaterials()) {
		material.setNormalTexture(null);
		material.setMetallicRoughnessTexture(null);
		material.setOcclusionTexture(null);
		material.setEmissiveTexture(null);
	}
	for (const ext of root.listExtensionsUsed()) {
		ext.dispose();
	}
	if (mixamo) {
		const humanoid = {};
		for (const [bone, name] of Object.entries(HUMANOID)) {
			if (nodes.some((n) => n.getName() === MIXAMO + name)) {
				humanoid[bone] = MIXAMO + name;
			}
		}
		root.listScenes()[0].setExtras({ toon: { humanoid } });
		if (!library) {
			library = await skeletonOnly(join(srcDir, file));
			// The bone map gives runtime fitting the library's hip height.
			library.getRoot().listScenes()[0].setExtras({ toon: { humanoid } });
		}
		addClips(library, doc);
		root.listAnimations().forEach(dropAnimation);
	} else if (fixes.humanoid) {
		// A humanoid on its own skeleton: the shared clips reach it through this bone map.
		root.listScenes()[0].setExtras({ toon: { humanoid: fixes.humanoid } });
		root.listAnimations().forEach(dropAnimation);
	} else {
		for (const anim of root.listAnimations()) {
			anim.setName(clipName(anim.getName()));
		}
	}

	if (!fixes.keepMagenta) {
		await cleanMagenta(doc);
	}
	const atlased = await mergeParts(doc);
	const size = (fixes.textureSize ?? maxSize) * (atlased ? 2 : 1);

	await doc.transform(
		prune(),
		dedup(),
		textureCompress({ encoder: sharp, targetFormat: 'jpeg', quality: 85, resize: [size, size] }),
		prune(),
	);
	const out = join(outDir, basename(file));
	await io.write(out, doc);
	const own = !mixamo && !fixes.humanoid && root.listAnimations().length;
	console.log(`${basename(file)}: ${((await stat(out)).size / 1048576).toFixed(2)} MB${own ? ` (own clips: ${own})` : ''}`);
}

if (library) {
	await library.transform(resample(), prune({ keepLeaves: true }), dedup());
	const out = join(outDir, 'clips.glb');
	await io.write(out, library);
	console.log(`clips.glb: ${library.getRoot().listAnimations().map((a) => a.getName()).join(', ')}`);
}

/** Hot pink to magenta (hue 295–350°, saturated, blue at least half of red, so burgundy is spared). */
function isMagenta(r, g, b) {
	const mx = Math.max(r, g, b);
	const mn = Math.min(r, g, b);
	if (mx < 70 || mx === mn || (mx - mn) / mx < 0.35 || b < 0.5 * r) {
		return false;
	}
	const hue = mx === r ? (60 * (g - b)) / (mx - mn) : mx === g ? 120 + (60 * (b - r)) / (mx - mn) : 240 + (60 * (r - g)) / (mx - mn);
	const h = (hue + 360) % 360;
	return h > 295 && h < 350;
}

/**
 * Repaints magenta pixels (grown by one pixel to catch blended fringes) from their neighbors,
 * layer by layer from the edge of each smear inward.
 */
async function cleanMagenta(doc) {
	const colorMaps = new Set(doc.getRoot().listMaterials().map((m) => m.getBaseColorTexture()).filter(Boolean));
	for (const tex of colorMaps) {
		const { data, info } = await sharp(Buffer.from(tex.getImage())).raw().toBuffer({ resolveWithObject: true });
		const { width: w, height: h, channels: c } = info;
		const bad = new Uint8Array(w * h);
		let count = 0;
		for (let i = 0; i < w * h; i++) {
			if (isMagenta(data[i * c], data[i * c + 1], data[i * c + 2])) {
				bad[i] = 1;
				count++;
			}
		}
		if (!count) {
			continue;
		}
		const grown = bad.slice();
		for (let i = 0; i < w * h; i++) {
			if (!bad[i]) {
				continue;
			}
			const x = i % w;
			for (const n of [i - 1, i + 1, i - w, i + w]) {
				if (n >= 0 && n < w * h && Math.abs((n % w) - x) <= 1) {
					grown[n] = 1;
				}
			}
		}
		let front = [];
		for (let i = 0; i < w * h; i++) {
			if (grown[i]) {
				front.push(i);
			}
		}
		while (front.length) {
			const filled = [];
			const rest = [];
			for (const i of front) {
				const x = i % w;
				const sum = [0, 0, 0];
				let k = 0;
				for (const n of [i - 1, i + 1, i - w, i + w]) {
					if (n >= 0 && n < w * h && Math.abs((n % w) - x) <= 1 && !grown[n]) {
						sum[0] += data[n * c];
						sum[1] += data[n * c + 1];
						sum[2] += data[n * c + 2];
						k++;
					}
				}
				if (k) {
					filled.push([i, sum.map((v) => Math.round(v / k))]);
				} else {
					rest.push(i);
				}
			}
			if (!filled.length) {
				break;
			}
			for (const [i, rgb] of filled) {
				data.set(rgb, i * c);
				grown[i] = 0;
			}
			front = rest;
		}
		const png = await sharp(data, { raw: { width: w, height: h, channels: c } }).png().toBuffer();
		tex.setImage(new Uint8Array(png)).setMimeType('image/png');
		console.log(`  ${tex.getName() || 'texture'}: repainted ${count} magenta pixels`);
	}
}

/**
 * Tripo sometimes weights a few vertices to an extra joint outside the Mixamo set (`neutral_bone`
 * at the origin) that never moves; their triangles then stretch into spikes as the body animates.
 * Such vertices take the weights of a vertex they share a triangle with.
 */
function adoptStrayWeights(doc) {
	for (const node of doc.getRoot().listNodes()) {
		const skin = node.getSkin();
		if (!skin) {
			continue;
		}
		const stray = new Set(skin.listJoints().flatMap((j, i) => (j.getName().startsWith(MIXAMO) ? [] : [i])));
		if (!stray.size) {
			continue;
		}
		for (const prim of node.getMesh().listPrimitives()) {
			const J = prim.getAttribute('JOINTS_0');
			const W = prim.getAttribute('WEIGHTS_0');
			const idx = prim.getIndices().getArray();
			const j = [];
			const w = [];
			const isStray = (v) => {
				J.getElement(v, j);
				W.getElement(v, w);
				return j.some((x, k) => stray.has(x) && w[k] > 0);
			};
			for (let t = 0; t < idx.length; t += 3) {
				const tri = [idx[t], idx[t + 1], idx[t + 2]];
				const donor = tri.find((v) => !isStray(v));
				if (donor === undefined) {
					continue;
				}
				J.getElement(donor, j);
				W.getElement(donor, w);
				const dj = j.slice();
				const dw = w.slice();
				for (const v of tri.filter(isStray)) {
					J.setElement(v, dj);
					W.setElement(v, dw);
				}
			}
		}
	}
}

/**
 * Reweights a skinned garment: hips at the waist, blending toward the hem into the leg on each
 * vertex's side (+x is the model's left), half each at the middle.
 */
function hangFromHips(node) {
	const skin = node?.getSkin();
	if (!skin) {
		throw new Error(`cloth: no skinned node ${node?.getName()}`);
	}
	const joints = skin.listJoints().map((j) => j.getName());
	const [hips, left, right] = ['Hips', 'LeftUpLeg', 'RightUpLeg'].map((b) => joints.indexOf(MIXAMO + b));
	for (const prim of node.getMesh().listPrimitives()) {
		const pos = prim.getAttribute('POSITION');
		const J = prim.getAttribute('JOINTS_0');
		const W = prim.getAttribute('WEIGHTS_0');
		const top = pos.getMax([])[1];
		const hem = pos.getMin([])[1];
		const p = [];
		for (let i = 0; i < pos.getCount(); i++) {
			pos.getElement(i, p);
			const down = Math.min(1, Math.max(0, (top - p[1]) / (top - hem || 1)));
			const leg = 0.75 * down * down;
			const side = Math.min(1, Math.max(-1, p[0] / 0.1));
			J.setElement(i, [hips, left, right, 0]);
			W.setElement(i, [1 - leg, (leg * (1 + side)) / 2, (leg * (1 - side)) / 2, 0]);
		}
	}
}

/** Every vertex of a skinned mesh node on one bone. */
function weightToBone(node, bone) {
	const joint = node?.getSkin()?.listJoints().findIndex((j) => j.getName() === bone) ?? -1;
	if (joint < 0) {
		throw new Error(`rigid: no skinned node ${node?.getName()} with bone ${bone}`);
	}
	for (const prim of node.getMesh().listPrimitives()) {
		const J = prim.getAttribute('JOINTS_0');
		const W = prim.getAttribute('WEIGHTS_0');
		for (let i = 0; i < J.getCount(); i++) {
			J.setElement(i, [joint, 0, 0, 0]);
			W.setElement(i, [1, 0, 0, 0]);
		}
	}
}

function clamp01(v) {
	return Math.min(1, Math.max(0, v));
}

/** 0 at `a`, 1 at `b`, smooth between (`a` > `b` runs downhill). */
function smoothstep(a, b, v) {
	const t = clamp01((v - a) / (b - a));
	return t * t * (3 - 2 * t);
}

/**
 * Skins the scene's one unrigged mesh node. `bones` are `{ name, parent?, at }` (rest positions in
 * the mesh's space, no rotation), parents first; `weigh(position, vertex)` gives up to four
 * `[bone index, weight]` pairs.
 */
function addSkin(doc, bones, weigh) {
	const root = doc.getRoot();
	const scene = root.listScenes()[0];
	const node = root.listNodes().find((n) => n.getMesh() && !n.getSkin());
	if (!node) {
		throw new Error('addSkin: no unrigged mesh node');
	}
	const buffer = root.listBuffers()[0];
	const joints = [];
	for (const bone of bones) {
		const parent = bone.parent === undefined ? null : bones[bone.parent];
		const at = parent ? bone.at.map((v, k) => v - parent.at[k]) : bone.at;
		const joint = doc.createNode(bone.name).setTranslation(at);
		(parent ? joints[bone.parent] : scene).addChild(joint);
		joints.push(joint);
	}
	const ibm = new Float32Array(bones.length * 16);
	bones.forEach((bone, i) => {
		ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -bone.at[0], -bone.at[1], -bone.at[2], 1], i * 16);
	});
	const skin = doc.createSkin('rig').setSkeleton(joints[0])
		.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buffer));
	joints.forEach((j) => skin.addJoint(j));
	node.setSkin(skin);
	for (const prim of node.getMesh().listPrimitives()) {
		const pos = prim.getAttribute('POSITION');
		const n = pos.getCount();
		const J = new Uint16Array(n * 4);
		const W = new Float32Array(n * 4);
		const p = [];
		for (let i = 0; i < n; i++) {
			pos.getElement(i, p);
			const pairs = weigh(p, i).filter(([, w]) => w > 1e-4).slice(0, 4);
			const sum = pairs.reduce((s, [, w]) => s + w, 0) || 1;
			pairs.forEach(([b, w], k) => {
				J[i * 4 + k] = b;
				W[i * 4 + k] = w / sum;
			});
			if (!pairs.length) {
				W[i * 4] = 1;
			}
		}
		prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(J).setBuffer(buffer));
		prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(W).setBuffer(buffer));
	}
}

/** Vertex groups of a primitive joined by triangles or by sharing a position: [vertex indices]. */
function islands(prim) {
	const pos = prim.getAttribute('POSITION');
	const n = pos.getCount();
	const up = Int32Array.from({ length: n }, (_, i) => i);
	const find = (i) => {
		while (up[i] !== i) {
			up[i] = up[up[i]];
			i = up[i];
		}
		return i;
	};
	const join = (a, b) => {
		up[find(a)] = find(b);
	};
	const seen = new Map();
	const p = [];
	for (let i = 0; i < n; i++) {
		const key = pos.getElement(i, p).map((v) => v.toFixed(5)).join();
		if (seen.has(key)) {
			join(i, seen.get(key));
		} else {
			seen.set(key, i);
		}
	}
	const idx = prim.getIndices().getArray();
	for (let t = 0; t < idx.length; t += 3) {
		join(idx[t], idx[t + 1]);
		join(idx[t], idx[t + 2]);
	}
	const groups = new Map();
	for (let i = 0; i < n; i++) {
		const r = find(i);
		groups.set(r, [...(groups.get(r) ?? []), i]);
	}
	return [...groups.values()];
}

function rigBow(doc) {
	const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
	const pos = prim.getAttribute('POSITION');
	const [min, max] = [pos.getMin([]), pos.getMax([])];
	const height = max[1] - min[1];
	const mid = (min[1] + max[1]) / 2;
	// Grip half-length: both Tripo bows hold about 0.19 of their height on each side of the middle.
	const grip = 0.19 * height;
	const p = [];
	const box = (vs) => {
		const lo = [Infinity, Infinity, Infinity];
		const hi = [-Infinity, -Infinity, -Infinity];
		for (const v of vs) {
			pos.getElement(v, p);
			p.forEach((c, k) => {
				lo[k] = Math.min(lo[k], c);
				hi[k] = Math.max(hi[k], c);
			});
		}
		return { lo, hi };
	};
	// The string: one long, thin island.
	const string = islands(prim).map((vs) => ({ vs, ...box(vs) })).find(({ lo, hi }) =>
		hi[1] - lo[1] > 0.6 * height && hi[0] - lo[0] < 0.05 * height && hi[2] - lo[2] < 0.05 * height);
	if (!string) {
		throw new Error('bow: no string found');
	}
	const onString = new Set(string.vs);
	const stringX = (string.lo[0] + string.hi[0]) / 2;
	const stringZ = (string.lo[2] + string.hi[2]) / 2;
	// The grip's middle, where the hand and the arrow sit.
	let gripX = 0;
	let k = 0;
	for (let i = 0; i < pos.getCount(); i++) {
		if (!onString.has(i) && Math.abs(pos.getElement(i, p)[1] - mid) < 0.05 * height) {
			gripX += p[0];
			k++;
		}
	}
	gripX /= k || 1;
	addSkin(doc, [
		{ name: 'Grip', at: [gripX, mid, 0] },
		{ name: 'LimbUpper', parent: 0, at: [gripX, mid + grip, 0] },
		{ name: 'LimbLower', parent: 0, at: [gripX, mid - grip, 0] },
		{ name: 'StringUpper', parent: 1, at: [stringX, string.hi[1], stringZ] },
		{ name: 'StringLower', parent: 2, at: [stringX, string.lo[1], stringZ] },
	], (v, i) => {
		const upper = v[1] >= mid;
		if (onString.has(i)) {
			return [[upper ? 3 : 4, 1]];
		}
		const limb = clamp01((Math.abs(v[1] - mid) - grip) / (height / 2 - grip));
		return [[0, 1 - limb], [upper ? 1 : 2, limb]];
	});
}

/** Rigs a bird by regions of its bounding box (fractions fitted to Tripo's raven, wings spread). */
function rigBird(doc) {
	const pos = doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION');
	const [min, max] = [pos.getMin([]), pos.getMax([])];
	const span = max[0] - min[0];
	const h = max[1] - min[1];
	const d = max[2] - min[2];
	const X = (f) => f * span;
	const Y = (f) => min[1] + f * h;
	const Z = (f) => f * d;
	const shoulder = Y(0.75);
	addSkin(doc, [
		{ name: 'Body', at: [0, Y(0.55), 0] },
		{ name: 'Head', parent: 0, at: [0, Y(0.8), Z(0.06)] },
		{ name: 'Tail', parent: 0, at: [0, Y(0.42), Z(-0.12)] },
		{ name: 'WingL', parent: 0, at: [X(0.07), shoulder, 0] },
		{ name: 'WingTipL', parent: 3, at: [X(0.27), shoulder, 0] },
		{ name: 'WingR', parent: 0, at: [-X(0.07), shoulder, 0] },
		{ name: 'WingTipR', parent: 5, at: [-X(0.27), shoulder, 0] },
	], ([x, y, z]) => {
		const ax = Math.abs(x);
		const left = x > 0;
		const wing = smoothstep(X(0.06), X(0.12), ax) * smoothstep(Y(0.42), Y(0.52), y);
		const tip = smoothstep(X(0.22), X(0.32), ax);
		const rest = 1 - wing;
		const head = rest * smoothstep(Y(0.74), Y(0.84), y);
		const tail = rest * (1 - smoothstep(Y(0.44), Y(0.58), y)) * smoothstep(Z(-0.1), Z(-0.25), z);
		return [
			[0, Math.max(0, rest - head - tail)],
			[1, head],
			[2, tail],
			[left ? 3 : 5, wing * (1 - tip)],
			[left ? 4 : 6, wing * tip],
		];
	});
}

/**
 * Joins a model's skinned parts into one mesh on the first part's node, one primitive per kind of
 * material, packing each kind's base color textures into one atlas. Returns whether it made an atlas.
 */
async function mergeParts(doc) {
	const root = doc.getRoot();
	const parts = root.listNodes().filter((n) => n.getMesh() && n.getSkin());
	const prims = parts.flatMap((n) => n.getMesh().listPrimitives());
	const skin = parts[0]?.getSkin();
	if (prims.length < 2) {
		return false;
	}
	const still = (n) => n.getTranslation().every((v) => Math.abs(v) < 1e-6) && n.getScale().every((v) => Math.abs(v - 1) < 1e-6)
		&& Math.abs(n.getRotation()[3]) > 1 - 1e-6;
	if (parts.some((n) => n.getSkin() !== skin || !still(n))) {
		console.warn('  parts differ in skin or transform: not merged');
		return false;
	}
	const kinds = new Map();
	for (const prim of prims) {
		const m = prim.getMaterial();
		const kind = [m?.getAlphaMode(), m?.getDoubleSided(), m?.getName() === 'inner_shell'].join();
		kinds.set(kind, [...(kinds.get(kind) ?? []), prim]);
	}
	let atlased = false;
	const mesh = doc.createMesh(parts[0].getMesh().getName());
	for (const group of kinds.values()) {
		const materials = [...new Set(group.map((p) => p.getMaterial()))];
		const material = materials.length > 1 ? await atlas(doc, materials, group) : materials[0];
		atlased ||= materials.length > 1;
		group.forEach((prim) => prim.setMaterial(material));
		const joined = group.length > 1 ? joinPrimitives(group) : group[0];
		mesh.addPrimitive(joined);
	}
	for (const part of parts) {
		const old = part.getMesh();
		part.setMesh(null);
		if (part !== parts[0]) {
			part.setSkin(null);
		}
		old.dispose();
	}
	parts[0].setMesh(mesh);
	return atlased;
}

/**
 * One material for `materials` (used by `prims`): their base color textures (tinted by their color
 * factors; a flat swatch where there is none) packed into one square atlas of power-of-two tiles,
 * each primitive's UVs moved into its tile.
 */
async function atlas(doc, materials, prims) {
	const tiles = [];
	for (const m of materials) {
		const tex = m.getBaseColorTexture();
		const [r, g, b] = m.getBaseColorFactor();
		let img;
		let side = 16;
		if (tex) {
			const meta = await sharp(Buffer.from(tex.getImage())).metadata();
			side = 2 ** Math.round(Math.log2(Math.max(meta.width, meta.height)));
			img = await sharp(Buffer.from(tex.getImage())).removeAlpha().resize(side, side, { fit: 'fill' }).linear([r, g, b], [0, 0, 0]).raw().toBuffer();
		} else {
			img = Buffer.alloc(side * side * 3);
			for (let i = 0; i < side * side; i++) {
				img.set([r, g, b].map((c) => Math.round(255 * c ** (1 / 2.2))), i * 3);
			}
		}
		tiles.push({ m, side, img });
	}
	// Quadtree packing: power-of-two squares, biggest first, always fit a square of their total area.
	tiles.sort((x, y) => y.side - x.side);
	const area = tiles.reduce((sum, t) => sum + t.side * t.side, 0);
	const S = 2 ** Math.ceil(Math.log2(Math.sqrt(area)));
	const free = [{ x: 0, y: 0, side: S }];
	for (const t of tiles) {
		free.sort((p, q) => p.side - q.side);
		let cell = free.splice(free.findIndex((f) => f.side >= t.side), 1)[0];
		while (cell.side > t.side) {
			const h = cell.side / 2;
			free.push({ x: cell.x + h, y: cell.y, side: h }, { x: cell.x, y: cell.y + h, side: h }, { x: cell.x + h, y: cell.y + h, side: h });
			cell = { x: cell.x, y: cell.y, side: h };
		}
		Object.assign(t, { x: cell.x, y: cell.y });
	}
	const png = await sharp({ create: { width: S, height: S, channels: 3, background: '#000' } })
		.composite(tiles.map((t) => ({ input: t.img, raw: { width: t.side, height: t.side, channels: 3 }, left: t.x, top: t.y })))
		.png().toBuffer();
	// Into each tile, half a texel in from its edges so neighbors do not bleed in.
	const done = new Set();
	for (const prim of prims) {
		const t = tiles.find((tile) => tile.m === prim.getMaterial());
		const uv = prim.getAttribute('TEXCOORD_0');
		if (!uv || done.has(uv)) {
			continue;
		}
		done.add(uv);
		const flat = !t.m.getBaseColorTexture();
		const a = [];
		for (let i = 0; i < uv.getCount(); i++) {
			uv.getElement(i, a);
			const [u, v] = flat ? [0.5, 0.5] : a;
			uv.setElement(i, [(t.x + 0.5 + u * (t.side - 1)) / S, (t.y + 0.5 + v * (t.side - 1)) / S]);
		}
	}
	const texture = doc.createTexture('atlas').setImage(new Uint8Array(png)).setMimeType('image/png');
	return doc.createMaterial(materials[0].getName()).setBaseColorTexture(texture)
		.setAlphaMode(materials[0].getAlphaMode()).setDoubleSided(materials[0].getDoubleSided())
		.setRoughnessFactor(1).setMetallicFactor(0);
}

/** Single-sided materials plus a pitch-black copy of every surface facing inward. */
function addInnerShell(doc) {
	const black = doc.createMaterial('inner_shell').setBaseColorFactor([0, 0, 0, 1]).setRoughnessFactor(1).setMetallicFactor(0);
	for (const material of doc.getRoot().listMaterials()) {
		material.setDoubleSided(false);
	}
	for (const mesh of doc.getRoot().listMeshes()) {
		for (const prim of mesh.listPrimitives()) {
			const inner = doc.createPrimitive().setMaterial(black).setMode(prim.getMode());
			for (const semantic of prim.listSemantics()) {
				inner.setAttribute(semantic, prim.getAttribute(semantic));
			}
			const idx = prim.getIndices().getArray();
			const flipped = idx.slice();
			for (let i = 0; i < flipped.length; i += 3) {
				flipped[i + 1] = idx[i + 2];
				flipped[i + 2] = idx[i + 1];
			}
			inner.setIndices(doc.createAccessor().setType('SCALAR').setArray(flipped).setBuffer(prim.getIndices().getBuffer()));
			mesh.addPrimitive(inner);
		}
	}
}

/** Disposes a clip with its samplers, so `prune` can drop the keyframe data. */
function dropAnimation(anim) {
	for (const sampler of anim.listSamplers()) {
		sampler.dispose();
	}
	anim.dispose();
}

/** A copy of a model with its skeleton nodes and nothing else. */
async function skeletonOnly(path) {
	const doc = await io.read(path);
	const root = doc.getRoot();
	for (const node of root.listNodes()) {
		node.setMesh(null);
		node.setSkin(null);
	}
	root.listAnimations().forEach(dropAnimation);
	for (const prop of [...root.listMeshes(), ...root.listSkins(), ...root.listMaterials(), ...root.listTextures()]) {
		prop.dispose();
	}
	for (const ext of root.listExtensionsUsed()) {
		ext.dispose();
	}
	return doc;
}

/**
 * Removes the hips' steady drift across the ground (x, z), keeping sway and bob, so a walk plays in
 * place and the game moves the character.
 */
function inPlace(times, xyz) {
	const n = times.length;
	const span = times[n - 1] - times[0] || 1;
	const dx = xyz[(n - 1) * 3] - xyz[0];
	const dz = xyz[(n - 1) * 3 + 2] - xyz[2];
	for (let i = 0; i < n; i++) {
		const t = (times[i] - times[0]) / span;
		xyz[i * 3] -= dx * t;
		xyz[i * 3 + 2] -= dz * t;
	}
}

/**
 * Tripo pins the hips on the ground (x, z), so a weight shift slides the feet under a still body.
 * Moves the hips (`xyz`, one per key) so the foot bearing the weight (the lower one, while on the
 * ground) stays put. `feet` holds both ankles' positions at each key.
 */
function plantFeet(xyz, feet) {
	const ground = Math.min(...feet.flat().map((p) => p[1])) + GROUNDED;
	let support = feet[0][0][1] < feet[0][1][1] ? 0 : 1;
	let dx = 0;
	let dz = 0;
	for (let f = 1; f < feet.length; f++) {
		if (feet[f][1 - support][1] < feet[f][support][1] - SHIFT) {
			support = 1 - support;
		}
		const [before, now] = [feet[f - 1][support], feet[f][support]];
		if (now[1] < ground) {
			dx += before[0] - now[0];
			dz += before[2] - now[2];
		}
		xyz[f * 3] += dx;
		xyz[f * 3 + 2] += dz;
	}
}

/** `node`'s position in the scene for one pose: `local` gives each node's rotation, the hips stand at `hips`. */
function positionOf(node, local, hips) {
	const chain = [];
	for (let n = node; n; n = n.getParentNode()) {
		chain.unshift(n);
	}
	let turn = [0, 0, 0, 1];
	let at = [0, 0, 0];
	for (const n of chain) {
		const offset = n.getName() === `${MIXAMO}Hips` ? hips : n.getTranslation();
		const moved = qmul(qmul(turn, [...offset, 0]), qinv(turn));
		at = at.map((v, k) => v + moved[k]);
		turn = qmul(turn, local(n));
	}
	return at;
}

/** A track's value at time `t`: a lerp between keys of `size` numbers; rotations (4) take the short way, normalized. */
function sampleTrack(times, keys, t, size) {
	let i = 0;
	while (i < times.length - 1 && times[i + 1] <= t) {
		i++;
	}
	const j = Math.min(i + 1, times.length - 1);
	const u = j === i ? 0 : Math.min(1, Math.max(0, (t - times[i]) / (times[j] - times[i])));
	const a = Array.from(keys.subarray(i * size, i * size + size));
	const b = Array.from(keys.subarray(j * size, j * size + size));
	if (size !== 4) {
		return a.map((v, k) => v + (b[k] - v) * u);
	}
	const sign = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
	const q = a.map((v, k) => v + (sign * b[k] - v) * u);
	const len = Math.hypot(...q) || 1;
	return q.map((v) => v / len);
}

/** A gltf-transform document's rest pose, for `poseRetargeter`. */
function rigOf(doc) {
	const order = [];
	const parent = new Map();
	const rest = new Map();
	const visit = (node, up) => {
		order.push(node.getName());
		parent.set(node.getName(), up?.getName());
		rest.set(node.getName(), node.getRotation());
		node.listChildren().forEach((c) => visit(c, node));
	};
	doc.getRoot().listScenes()[0].listChildren().forEach((n) => visit(n, undefined));
	return { order, parent, rest };
}

/** Height of a document's Mixamo hips above its scene. */
function hipsHeight(doc) {
	return doc.getRoot().listNodes().find((n) => n.getName() === `${MIXAMO}Hips`)?.getWorldMatrix()[13] || 1;
}

/**
 * Copies `src`'s clips that `lib` lacks onto `lib`'s rig, retargeted; hips keep position (scaled to
 * `lib`'s hip height, moved over the planted foot, see {@link plantFeet}), other bones rotation only.
 */
function addClips(lib, src) {
	const libRoot = lib.getRoot();
	const have = new Set(libRoot.listAnimations().map((a) => a.getName()));
	const byName = new Map(libRoot.listNodes().map((n) => [n.getName(), n]));
	const hips = byName.get(`${MIXAMO}Hips`);
	const ankles = [byName.get(`${MIXAMO}LeftFoot`), byName.get(`${MIXAMO}RightFoot`)];
	const buffer = libRoot.listBuffers()[0] ?? lib.createBuffer();
	const retarget = poseRetargeter(rigOf(src), rigOf(lib));
	const hipsScale = hipsHeight(lib) / hipsHeight(src);
	for (const anim of src.getRoot().listAnimations()) {
		const name = clipName(anim.getName());
		if (have.has(name)) {
			continue;
		}
		have.add(name);
		const clip = lib.createAnimation(name);
		// Tripo rigs share bone names but not rest orientations: carry rotations over in world space,
		// pose by pose at the densest track's key times.
		const tracks = new Map(anim.listChannels()
			.filter((c) => c.getTargetPath() === 'rotation')
			.map((c) => [c.getTargetNode().getName(), c.getSampler()]));
		const times = [...tracks.values()].reduce((best, t) => (t.getInput().getCount() > best.length ? t.getInput().getArray() : best), []);
		const retargeted = new Map([...tracks.keys()].map((bone) => [bone, new Float32Array(times.length * 4)]));
		const hipsTrack = anim.listChannels()
			.find((c) => c.getTargetPath() === 'translation' && c.getTargetNode().getName() === hips.getName())
			?.getSampler();
		const hipsKeys = new Float32Array(times.length * 3);
		const feet = [];
		times.forEach((t, f) => {
			const pose = retarget((bone) => {
				const sampler = tracks.get(bone);
				return sampler && sampleTrack(sampler.getInput().getArray(), sampler.getOutput().getArray(), t, 4);
			});
			for (const [bone, keys] of retargeted) {
				keys.set(pose.get(bone) ?? [0, 0, 0, 1], f * 4);
			}
			const at = hipsTrack
				? sampleTrack(hipsTrack.getInput().getArray(), hipsTrack.getOutput().getArray(), t, 3).map((v) => v * hipsScale)
				: hips.getTranslation();
			hipsKeys.set(at, f * 3);
			const local = (n) => (tracks.has(n.getName()) ? pose.get(n.getName()) : n.getRotation());
			feet.push(ankles.map((ankle) => positionOf(ankle, local, at)));
		});
		plantFeet(hipsKeys, feet);
		inPlace(times, hipsKeys);
		const input = lib.createAccessor().setType('SCALAR').setArray(Float32Array.from(times)).setBuffer(buffer);
		const keyed = [...retargeted].map(([bone, keys]) => [byName.get(bone), 'rotation', keys]);
		for (const [node, path, keys] of [...keyed, [hips, 'translation', hipsKeys]]) {
			if (!node) {
				continue;
			}
			const output = lib.createAccessor().setType(path === 'rotation' ? 'VEC4' : 'VEC3').setArray(keys).setBuffer(buffer);
			const sampler = lib.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
			clip.addSampler(sampler).addChannel(lib.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
		}
	}
}

