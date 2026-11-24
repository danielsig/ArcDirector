import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash, lathe, ToonMaterial, tube } from '@arc-director/kindling';
import type { ChunkEntity } from '../../world/demo-chunk';
import { Named } from '../../engine/components';
import { windSway } from '../../render/nature';
import { spawnProp, type Thing } from '../thing';

/**
 * Stylized trees (wind bends trunk and leaves alike, so branches stay inside the crown), built once and drawn instanced. Canopies use normals that point out of the
 * whole crown, so toon bands paint one soft volume; the outline pass inks the silhouette and
 * the gaps between leaf clumps. Vertex colors run dark under the crown to sunlit on top.
 */

export type TreeKind = 'oak' | 'pine';

export type TreePart = {
	geom:THREE.BufferGeometry;
	mat:THREE.Material;
};

const OAK_DARK = new THREE.Color(0x1a4220);
const OAK_LIGHT = new THREE.Color(0x6a9639);
const PINE_DARK = new THREE.Color(0x173f30);
const PINE_LIGHT = new THREE.Color(0x5f9a4c);
const BARK = 0x6b4a32;

/** Variants per kind; a tree picks one by hash. */
export const TREE_VARIANTS = 2;

function rand(seed:number):()=>number {
	let s = seed * 9301 + 49297;
	return () => {
		s = (s * 9301 + 49297) % 233280;
		return s / 233280;
	};
}

function noise3(x:number, y:number, z:number):number {
	const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
	return n - Math.floor(n);
}

/** Smooth-ish value noise on a direction, so welded duplicates displace identically. */
function lump(n:THREE.Vector3, seed:number):number {
	const f = 2.4;
	let sum = 0;
	for (let i = 0; i < 3; i++) {
		const k = f * (i + 1);
		sum += (noise3(Math.round(n.x * k), Math.round(n.y * k), Math.round(n.z * k) + seed) - 0.5) / (i + 1);
	}
	return sum;
}

/** Position, normal and color only, so parts merge. */
function bare(geo:THREE.BufferGeometry):THREE.BufferGeometry {
	const flat = geo.index ? geo.toNonIndexed() : geo;
	for (const name of Object.keys(flat.attributes)) {
		if (name !== 'position' && name !== 'normal' && name !== 'color') {
			flat.deleteAttribute(name);
		}
	}
	return flat;
}

type Clump = { x:number; y:number; z:number; r:number };

/** Leaf clumps around `center`, lit as one crown, shaded from `dark` (under) to `light` (top). */
function canopy(clumps:Clump[], center:THREE.Vector3, dark:THREE.Color, light:THREE.Color, seed:number, detail = 2):THREE.BufferGeometry {
	const rnd = rand(seed);
	const parts:THREE.BufferGeometry[] = [];
	let minY = Infinity;
	let maxY = -Infinity;
	for (const c of clumps) {
		minY = Math.min(minY, c.y - c.r);
		maxY = Math.max(maxY, c.y + c.r);
	}
	const p = new THREE.Vector3();
	const n = new THREE.Vector3();
	const crown = new THREE.Vector3();
	const color = new THREE.Color();
	clumps.forEach((c, ci) => {
		const geo = bare(new THREE.IcosahedronGeometry(c.r, detail));
		const pos = geo.getAttribute('position');
		const nrm = geo.getAttribute('normal');
		const col = new Float32Array(pos.count * 3);
		const tint = (rnd() - 0.5) * 0.12;
		for (let i = 0; i < pos.count; i++) {
			n.fromBufferAttribute(pos, i).normalize();
			const bump = 1 + 0.22 * lump(n, seed * 31 + ci);
			p.copy(n).multiplyScalar(c.r * bump);
			if (p.y < 0) {
				p.y *= 0.72;
			}
			p.x += c.x;
			p.y += c.y;
			p.z += c.z;
			pos.setXYZ(i, p.x, p.y, p.z);
			// Mostly the crown's normal, a little of the clump's: one volume with soft lobes.
			crown.copy(p).sub(center).normalize();
			n.multiplyScalar(0.3).addScaledVector(crown, 0.7).normalize();
			nrm.setXYZ(i, n.x, n.y, n.z);
			const height = (p.y - minY) / Math.max(0.01, maxY - minY);
			const t = THREE.MathUtils.clamp(height * 0.75 + n.y * 0.25 + tint, 0, 1);
			color.copy(dark).lerp(light, t * t * (3 - 2 * t));
			col[i * 3] = color.r;
			col[i * 3 + 1] = color.g;
			col[i * 3 + 2] = color.b;
		}
		geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
		parts.push(geo);
	});
	const merged = mergeGeometries(parts)!;
	for (const g of parts) {
		g.dispose();
	}
	merged.computeBoundingSphere();
	return merged;
}

/** An oak's crown; `detail` 1 is a quarter of the triangles, for crowns only ever seen far off. */
function oakCanopy(seed:number, detail = 2):THREE.BufferGeometry {
	const rnd = rand(seed + 7);
	const clumps:Clump[] = [{ x: 0, y: 2.45, z: 0, r: 0.72 }];
	const ring = 5 + (seed % 2);
	const turn = rnd() * Math.PI * 2;
	for (let i = 0; i < ring; i++) {
		const a = turn + (i / ring) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
		const d = 0.6 + rnd() * 0.18;
		clumps.push({ x: Math.cos(a) * d, y: 1.95 + rnd() * 0.3, z: Math.sin(a) * d, r: 0.48 + rnd() * 0.14 });
	}
	clumps.push({ x: (rnd() - 0.5) * 0.4, y: 1.6, z: (rnd() - 0.5) * 0.4, r: 0.42 });
	return canopy(clumps, new THREE.Vector3(0, 2.05, 0), OAK_DARK, OAK_LIGHT, seed, detail);
}

function oakTrunk(seed:number):THREE.BufferGeometry {
	const rnd = rand(seed + 3);
	const parts = [bare(lathe([
		{ r: 0.22, y: 0 },
		{ r: 0.14, y: 0.14 },
		{ r: 0.11, y: 0.8 },
		{ r: 0.08, y: 1.55 },
		{ r: 0.03, y: 1.9 },
	], 7))];
	const turn = rnd() * Math.PI * 2;
	for (let i = 0; i < 3; i++) {
		const a = turn + (i / 3) * Math.PI * 2;
		const y0 = 1.05 + i * 0.12;
		parts.push(bare(tube([
			{ x: 0, y: y0, z: 0 },
			{ x: Math.cos(a) * 0.28, y: y0 + 0.32, z: Math.sin(a) * 0.28 },
			{ x: Math.cos(a) * 0.5, y: y0 + 0.62, z: Math.sin(a) * 0.5 },
		], 0.045, 5)));
	}
	return mergeGeometries(parts)!;
}

/** One tier: a star-shaped cone with drooping branch tips and a shallow underside. */
function pineTier(y:number, height:number, radius:number, turn:number, t:number):THREE.BufferGeometry {
	const branches = 8;
	const rim:THREE.Vector3[] = [];
	for (let i = 0; i < branches * 2; i++) {
		const a = turn + (i / (branches * 2)) * Math.PI * 2;
		const tip = i % 2 === 0;
		const r = tip ? radius : radius * 0.66;
		rim.push(new THREE.Vector3(Math.cos(a) * r, y + (tip ? -0.1 : 0.06), Math.sin(a) * r));
	}
	const apex = new THREE.Vector3(0, y + height, 0);
	const under = new THREE.Vector3(0, y + height * 0.25, 0);
	const pos:number[] = [];
	const nrm:number[] = [];
	const col:number[] = [];
	const color = new THREE.Color();
	const n = new THREE.Vector3();
	const push = (v:THREE.Vector3, shade:number, up:number):void => {
		pos.push(v.x, v.y, v.z);
		n.set(v.x, 0, v.z);
		if (n.lengthSq() < 1e-6) {
			n.set(0, 1, 0);
		}
		else {
			n.normalize().multiplyScalar(0.75);
			n.y = up;
			n.normalize();
		}
		nrm.push(n.x, n.y, n.z);
		color.copy(PINE_DARK).lerp(PINE_LIGHT, THREE.MathUtils.clamp(shade * (0.55 + 0.45 * t), 0, 1));
		col.push(color.r, color.g, color.b);
	};
	for (let i = 0; i < rim.length; i++) {
		const a = rim[i]!;
		const b = rim[(i + 1) % rim.length]!;
		const aTip = i % 2 === 0;
		push(apex, 0.75, 1);
		push(b, aTip ? 0.55 : 1, 0.45);
		push(a, aTip ? 1 : 0.55, 0.45);
		push(under, 0, -1);
		push(a, 0.3, -0.4);
		push(b, 0.3, -0.4);
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
	geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
	return geo;
}

/**
 * A grown pine's tiers of branches and a sapling's, more as it grows (`treeParts`), and how far apart they stand (m)
 * above the first.
 */
const PINE_TIERS = { grown: 5, sapling: 3 };
const TIER_STEP = 0.58;
const FIRST_TIER = 0.75;

/**
 * A pine's crown of `tiers` tiers of branches, wide at the foot and narrowing to the top. Only a full-grown one comes to
 * a point: a younger one's top tier is as a grown one's second.
 */
function pineCanopy(seed:number, tiers:number):THREE.BufferGeometry {
	const rnd = rand(seed + 11);
	const parts:THREE.BufferGeometry[] = [];
	const highest = tiers === PINE_TIERS.grown ? 1 : (PINE_TIERS.grown - 2) / (PINE_TIERS.grown - 1);
	for (let i = 0; i < tiers; i++) {
		const t = (i / (tiers - 1)) * highest;
		const y = FIRST_TIER + i * TIER_STEP;
		parts.push(pineTier(y, 0.95 - t * 0.25, 1.0 - t * 0.68, rnd() * Math.PI, t));
	}
	const merged = mergeGeometries(parts)!;
	merged.computeBoundingSphere();
	return merged;
}

/** A pine's trunk, up to the top of `tiers` tiers. */
function pineTrunk(tiers:number):THREE.BufferGeometry {
	const top = FIRST_TIER + (tiers - 1) * TIER_STEP + 0.13;
	return bare(lathe([
		{ r: 0.14, y: 0 },
		{ r: 0.09, y: 0.12 },
		{ r: 0.06, y: top / 2 },
		{ r: 0.02, y: top },
	], 6));
}

/** Oaks by variant; pines by tier count, then variant. */
interface Built {
	oak:TreePart[][];
	pine:TreePart[][][];
	farCrowns:TreePart[];
}
let built:Built | null = null;

function build():Built {
	const bark = new ToonMaterial({ color: BARK, rim: 0.1 });
	windSway(bark, 0.01);
	const leaves = new ToonMaterial({
		vertexColors: true,
		bands: [0.5, 0.8, 1],
		shade: 0xa9c4e8,
		rim: 0.22,
	});
	windSway(leaves, 0.01);
	const oak:TreePart[][] = [];
	for (let v = 0; v < TREE_VARIANTS; v++) {
		oak.push([{ geom: oakTrunk(v + 1), mat: bark }, { geom: oakCanopy(v + 1), mat: leaves }]);
	}
	const pine:TreePart[][][] = [];
	for (let tiers = PINE_TIERS.sapling; tiers <= PINE_TIERS.grown; tiers++) {
		const trunk = pineTrunk(tiers);
		pine[tiers] = Array.from({ length: TREE_VARIANTS }, (unused, v) => [{ geom: trunk, mat: bark }, { geom: pineCanopy(v + 1, tiers), mat: leaves }]);
	}
	const farCrowns = oak.map((parts, v) => ({ geom: oakCanopy(v + 1, 1), mat: leaves }));
	for (const { geom, mat } of [...oak.flat(), ...pine.flat(2), ...farCrowns]) {
		geom.userData.shared = true;
		mat.userData.shared = true;
	}
	return { oak, pine, farCrowns };
}

/**
 * Parts of one tree, `age` 0 a sapling to 1 full grown: a younger pine has fewer tiers. Shared geometry and materials: instance them, never tint or dispose.
 */
export function treeParts(kind:TreeKind, variant:number, age = 1):TreePart[] {
	built ??= build();
	const set = kind === 'oak' ? built.oak : built.pine[Math.round(THREE.MathUtils.lerp(PINE_TIERS.sapling, PINE_TIERS.grown, age))]!;
	return set[((variant % set.length) + set.length) % set.length]!;
}

/** A sapling's width and height against a full-grown tree's: slender sooner than short, a pine shorter for its fewer tiers too. */
const SAPLING:Record<TreeKind, { wide:number; tall:number }> = { oak: { wide: 0.25, tall: 0.45 }, pine: { wide: 0.35, tall: 0.5 } };

/** How wide and tall a tree of `age` (0 a sapling, 1 full grown) is drawn, against a full-grown one of its kind. */
export function treeGrowth(kind:TreeKind, age:number):{ wide:number; tall:number } {
	const sapling = SAPLING[kind];
	return { wide: THREE.MathUtils.lerp(sapling.wide, 1, age), tall: THREE.MathUtils.lerp(sapling.tall, 1, age) };
}

/** An oak crown at a quarter of the triangles, for packed woods seen only from afar. Shared, like `treeParts`. */
export function farCrown(variant:number):TreePart {
	built ??= build();
	const set = built.farCrowns;
	return set[((variant % set.length) + set.length) % set.length]!;
}

/**
 * What tree `ent` is: an oak on every other cell, a pine on the rest, as many as its legend's `pines` share (0.5, all
 * of them, when unset); the others are oaks too. `center` is its cell's middle.
 */
export function treeKind(ent:ChunkEntity, center:{ x:number; z:number }):TreeKind {
	const pineCell = (ent.localX + ent.localZ) % 2 !== 0;
	return pineCell && hash(center.x, center.z, 15) < (ent.pines ?? 0.5) * 2 ? 'pine' : 'oak';
}

/** A tree's trunk, over the eyes: it hides what is right behind it, and one sees between trees. Its cell stays blocked to bodies. */
const TRUNK = { across: 0.3, tall: 3 };

/** A tree: a collider and a name. Its mesh is an anchor only: the canopy is drawn instanced with the chunk (`dressing.ts`). */
export const tree:Thing = {
	defs: ['tree'],
	spawn: (world, chunk, ents) => ents.forEach((ent) => {
		const go = spawnProp(chunk, ent, `tree_${treeKind(ent, chunk.worldCellCenter(ent.localX, ent.localZ))}`, TRUNK.across, undefined, TRUNK.tall);
		if (!ent.name) {
			go.addComponent(Named, { id: go.id });
		}
		world.add(go);
	}),
	meshes: { tree_oak: () => new THREE.Group(), tree_pine: () => new THREE.Group() },
};
