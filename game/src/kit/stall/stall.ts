import * as THREE from 'three';
import { bevelBox, Component, GameObject, mergeParts, register, solidMesh, yawToForward, type PosedPart } from '@arc-director/kindling';
import { BoxCollider, Named } from '../../engine/components';
import { Furniture } from '../furniture/furniture';
import { DemoMeshRenderer } from '../../engine/demo-mesh-renderer';
import type { DemoWorld } from '../../engine/demo-world';
import { goodsMesh } from '../../items/goods';
import { findCarried } from '../../items/inventory';
import { PALETTE, toon } from '../../render/toon';
import { CELL_SIZE } from '../../world/constants';
import type { ChunkEntity, DemoChunk } from '../../world/demo-chunk';
import { stallYaw } from '../props/dressing-plan';
import { wallFaceInset } from '../walls/thin-wall';
import { thingAt, type Thing } from '../thing';

/** A stall's look, by its def. `bench` adds a bench before the counter that customers sit on (restaurant stalls). */
type StallStyle = { canvas:number; stripe:number; bench?:boolean; shelf?:boolean };

const STALL_STYLES:Record<string, StallStyle> = {
	stall_baker: { canvas: 0xd45a3a, stripe: 0xf0e0a8 },
	stall_weaver: { canvas: 0xc45a8a, stripe: 0xf5d4dc },
	stall_potter: { canvas: 0xe8c040, stripe: 0xfff3c0 },
	stall_cutler: { canvas: 0x4a7ec8, stripe: 0xe8f0f8 },
	stall_fruit: { canvas: 0x5aaa5a, stripe: 0xd8f0c8 },
	stall_sushi: { canvas: 0x2a3550, stripe: 0xf3efe4, bench: true },
};

/** A shop counter's look, by its def: the boards, the front panels' paint, and what lines the front. */
type CounterStyle = { wood:number; shelf?:boolean };

const COUNTER_STYLES:Record<string, CounterStyle> = {
	counter_apothecary: { wood: 0x3e2a1e, shelf: true },
	counter_toys: { wood: 0xc49a5a, shelf: true },
};

/** Uniform scale on the whole stall mesh. */
const STALL_SCALE = 1.1;
const STALL_W = 1.5;
const STALL_D = 0.6;
const COUNTER_Z = 0.12;
const COUNTER_H = 0.86;

/** The counter solid, in meters. */
const STALL_COUNTER = {
	w: (STALL_W + 0.14) * STALL_SCALE,
	h: COUNTER_H * STALL_SCALE,
	d: (STALL_D + 0.12) * STALL_SCALE,
};
/** How wide a place on a bench is: one body's. */
const PLACE_WIDTH = 0.6;
const BACK_Z = -0.3;
const FRONT_Z = 0.7;
/** The customers' bench: its middle, clear of the counter top so someone sat on it leans over the top and does not sit up through it; and on a stall, its board's width between the front posts. */
const BENCH_Z = 0.8;
const BENCH_DEPTH = 0.3;
const STALL_BENCH_W = STALL_W - 0.1;
/** How far a sitter's serving sits from their place on the bench, toward the counter: just inside its front edge (meters). */
const SERVING_REACH = 0.45;
const BACK_H = 1.9;
const FRONT_H = 2.3;
/** How far the awning reaches past the posts on each side, over the merchant and the customer. */
const EAVE = 0.7;
const EAVE_OFFSET = -0.1;
const ROOF_BACK_Z = BACK_Z - EAVE + EAVE_OFFSET;
const ROOF_FRONT_Z = FRONT_Z + EAVE + EAVE_OFFSET;

/** Awning height over the back and front posts, continued as one plane past both. */
function roofPlaneY(z:number):number {
	return BACK_H + 0.04 + (FRONT_H + 0.02 - BACK_H) * (z - BACK_Z) / (FRONT_Z + 0.08 - BACK_Z);
}

/** How far the canvas sags at its middle. */
const AWNING_SAG = 0.12;

/** Across-stall depth along the awning, 0 at the back edge and 1 at the front edge. */
function roofV(z:number):number {
	return (z - ROOF_BACK_Z) / (ROOF_FRONT_Z - ROOF_BACK_Z);
}

/** Center Y of a 6 cm cross beam at `z`, clear of the canvas where it sags lowest. */
function beamY(z:number):number {
	return roofPlaneY(z) - AWNING_SAG * Math.sin(Math.PI * roofV(z)) - 0.06;
}

/**
 * Striped canvas from past the back posts (over the merchant) down past the front posts,
 * sagging between its edges, with a valance of rounded tongues, one per stripe, on both edges.
 */
function stripedAwning(paint:StallStyle):THREE.BufferGeometry {
	const stripes = 7;
	const width = STALL_W + 0.24;
	const nu = 3;
	const nz = 8;
	const valance = 0.22;
	const pos:number[] = [];
	const col:number[] = [];
	const idx:number[] = [];
	const colors = [new THREE.Color(paint.canvas), new THREE.Color(paint.stripe)];
	const roofZ = (v:number):number => ROOF_BACK_Z + (ROOF_FRONT_Z - ROOF_BACK_Z) * v;
	const roofY = (u:number, v:number):number => roofPlaneY(roofZ(v)) - AWNING_SAG * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
	for (let s = 0; s < stripes; s++) {
		const c = colors[s % 2]!;
		const base = pos.length / 3;
		const rows:number[][] = [];
		const vertex = (x:number, y:number, z:number):number => {
			pos.push(x, y, z);
			col.push(c.r, c.g, c.b);
			return pos.length / 3 - 1 - base;
		};
		const valanceRow = (v:number, t:number, z:number):number[] => Array.from({ length: nu + 1 }, (element, i) => {
			const u = (s + i / nu) / stripes;
			const tongue = t < 1 ? 1 : 0.5 + 0.5 * Math.sin(Math.PI * (i / nu));
			return vertex((u - 0.5) * width, roofY(u, v) - valance * t * tongue, z);
		});
		rows.push(valanceRow(0, 1, ROOF_BACK_Z - 0.005), valanceRow(0, 0.5, ROOF_BACK_Z - 0.005));
		for (let j = 0; j <= nz; j++) {
			const v = j / nz;
			rows.push(Array.from({ length: nu + 1 }, (element, i) => {
				const u = (s + i / nu) / stripes;
				return vertex((u - 0.5) * width, roofY(u, v), roofZ(v));
			}));
		}
		rows.push(valanceRow(1, 0.5, ROOF_FRONT_Z + 0.005), valanceRow(1, 1, ROOF_FRONT_Z + 0.005));
		for (let j = 0; j < rows.length - 1; j++) {
			for (let i = 0; i < nu; i++) {
				const a = base + rows[j]![i]!;
				const b = base + rows[j]![i + 1]!;
				const d = base + rows[j + 1]![i]!;
				const e = base + rows[j + 1]![i + 1]!;
				idx.push(a, d, b, b, d, e);
			}
		}
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
	geo.setIndex(idx);
	geo.computeVertexNormals();
	return geo;
}

function box(w:number, h:number, d:number):THREE.BoxGeometry {
	return new THREE.BoxGeometry(w, h, d);
}

/**
 * Marketplace stall facing +Z (the customer): a plank counter, corner posts,
 * and a striped, scalloped awning, its own stock on the counter.
 */
function createStallMesh(style:StallStyle, wares:readonly string[]):THREE.Group {
	const g = new THREE.Group();
	const boards = toon(PALETTE.wood, { pattern: 'plank', patternScale: 0.1, patternInk: 0.4 });
	const dark = toon(PALETTE.woodDark);
	const canvas = toon(0xffffff, { vertexColors: true, side: THREE.DoubleSide, rim: 0.15 });
	const add = (geo:THREE.BufferGeometry, mat:THREE.Material):void => {
		g.add(solidMesh(geo, mat));
	};
	const hw = STALL_W * 0.5;
	const cz = COUNTER_Z;
	add(mergeParts([
		{ geo: box(STALL_W, 0.8, 0.05), y: 0.4, z: cz - STALL_D * 0.5 },
		{ geo: box(0.05, 0.8, STALL_D), x: -hw, y: 0.4, z: cz },
		{ geo: box(0.05, 0.8, STALL_D), x: hw, y: 0.4, z: cz },
		{ geo: box(STALL_W + 0.14, 0.06, STALL_D + 0.12), y: COUNTER_H - 0.03, z: cz },
		style.bench // A bench for customers
			? { geo: box(STALL_BENCH_W, 0.04, BENCH_DEPTH), y: 0.4, z: BENCH_Z }
			: { geo: box(STALL_W, 0.8, 0.05), y: 0.4, z: cz + STALL_D * 0.5 },
		...style.shelf // A shelf behind the counter
			? [ { geo: box(STALL_W + 0.05, 0.04, 0.2), y: 0.6, z: cz - STALL_D * 0.5 - 0.1 } ]
			: [],
	]), boards);
	const backPost = box(0.08, BACK_H, 0.08);
	const frontPost = box(0.08, FRONT_H, 0.08);
	const px = hw + 0.06;
	// Eave beam under the awning past a row of posts, held by a diagonal brace off each post.
	const eave = (postZ:number, postH:number, eaveZ:number):PosedPart[] => {
		const eaveY = beamY(eaveZ);
		const braceY = postH - 0.5;
		const brace = box(0.05, Math.hypot(eaveZ - postZ, eaveY - braceY), 0.05);
		const rx = Math.atan2(eaveZ - postZ, eaveY - braceY);
		return [
			{ geo: box(STALL_W + 0.2, 0.06, 0.06), y: eaveY, z: eaveZ },
			...[-px, px].map((x) => ({ geo: brace, x, y: (braceY + eaveY) * 0.5, z: (postZ + eaveZ) * 0.5, rx })),
		];
	};
	add(mergeParts([
		{ geo: backPost, x: -px, y: BACK_H * 0.5, z: BACK_Z },
		{ geo: backPost, x: px, y: BACK_H * 0.5, z: BACK_Z },
		{ geo: frontPost, x: -px, y: FRONT_H * 0.5, z: FRONT_Z },
		{ geo: frontPost, x: px, y: FRONT_H * 0.5, z: FRONT_Z },
		{ geo: box(STALL_W + 0.2, 0.06, 0.06), y: beamY(BACK_Z), z: BACK_Z },
		{ geo: box(STALL_W + 0.2, 0.06, 0.06), y: beamY(FRONT_Z), z: FRONT_Z },
		...(style.bench ? [-0.5, 0.5].map((side) => ({ geo: box(0.05, 0.38, BENCH_DEPTH - 0.04), x: side * (STALL_BENCH_W - 0.2), y: 0.19, z: BENCH_Z })) : []),
		...eave(BACK_Z, BACK_H, ROOF_BACK_Z + 0.08),
		...eave(FRONT_Z, FRONT_H, ROOF_FRONT_Z - 0.08),
	]), dark);
	add(stripedAwning(style), canvas);
	placeWares(g, wares, style.bench);
	g.scale.setScalar(STALL_SCALE);
	return g;
}

/** A shop counter's mesh `length` meters long, its own stock on the counter. */
function createCounterMesh(style:CounterStyle, length:number, wares:readonly string[]):THREE.Group {
	const g = new THREE.Group();
	const width = length / STALL_SCALE;
	const boards = toon(style.wood, { pattern: 'plank', patternScale: 0.1, patternInk: 0.4 });
	const add = (geo:THREE.BufferGeometry, mat:THREE.Material):void => {
		g.add(solidMesh(geo, mat));
	};
	const cz = COUNTER_Z;
	// The body: a closed box under a thick top that overhangs on the customer's side.
	add(mergeParts([
		{ geo: bevelBox(width + 0.16, 0.08, STALL_D + 0.16, 0.02), y: COUNTER_H - 0.04, z: cz + 0.02 },
		{ geo: box(width, COUNTER_H - 0.08, STALL_D), y: (COUNTER_H - 0.08) * 0.5, z: cz },
		...style.shelf // A shelf behind the counter
			? [ { geo: box(width, 0.04, 0.2), y: 0.6, z: cz - STALL_D * 0.5 - 0.1 } ]
			: [],
	]), boards);
	placeWares(g, wares);
	g.scale.setScalar(STALL_SCALE);
	return g;
}

/** Goods on the counter, in the stall's local frame (before the stall scale): back by the seller where customers sit and lean over the front. */
function placeWares(g:THREE.Group, ids:readonly string[], bench = false):void {
	const n = ids.length;
	if (n === 0) {
		return;
	}
	const span = Math.min(1.15, 0.36 * (n - 1));
	ids.forEach((id, i) => {
		const ware = goodsMesh(id);
		if (!ware) {
			return;
		}
		const x = n === 1 ? 0 : -span / 2 + (span * i) / (n - 1);
		ware.position.set(x, 0.86, bench ? 0 : 0.2);
		ware.rotation.y = (i - (n - 1) / 2) * 0.4;
		g.add(ware);
	});
}

/** On a counter's bench: whatever of the counter's wares each sitter carries, set on the counter before them, gone once eaten. */
class Servings extends Component {
	public wares:readonly string[] = [];
	private readonly _plates:(THREE.Object3D | null)[] = [];

	public override lateUpdate():void {
		const furniture = this.gameObject.getComponent(Furniture);
		const scene = this.gameObject.world?.native;
		if (!furniture || !scene) {
			return;
		}
		const yaw = this.gameObject.transform.yaw;
		const toCounter = yawToForward(yaw + Math.PI);
		for (let i = 0; i < furniture.places; i++) {
			const sitter = furniture.occupants[i];
			const meshID = sitter ? findCarried(sitter, (it) => this.wares.includes(it.meshID))?.meshID : undefined;
			let plate = this._plates[i] ?? null;
			if (plate?.name !== meshID) {
				plate?.removeFromParent();
				plate = meshID ? goodsMesh(meshID) ?? null : null;
				if (plate) {
					plate.name = meshID!;
					plate.rotation.y = yaw;
					scene.add(plate);
				}
				this._plates[i] = plate;
			}
			const at = furniture.placeAt(i);
			plate?.position.set(at.x + toCounter.x * SERVING_REACH, COUNTER_H * STALL_SCALE, at.z + toCounter.z * SERVING_REACH);
		}
	}

	public override onDestroy():void {
		this._plates.forEach((plate) => plate?.removeFromParent());
	}
}

/**
 * A seller's post: a stall in the square, or a counter inside a shop (`yaw` in its legend turns it to the door). A
 * counter drawn over a row of cells (one glyph, so one name) is one counter along them, out to the face of any wall
 * at either end.
 */
function spawnStall(world:DemoWorld, chunk:DemoChunk, run:ChunkEntity[]):void {
	const ent = run[0]!;
	const alongZ = run.some((e) => e.localZ !== ent.localZ);
	const along = (e:ChunkEntity):number => (alongZ ? e.localZ : e.localX);
	const first = run.reduce((a, b) => (along(b) < along(a) ? b : a));
	const last = run.reduce((a, b) => (along(b) > along(a) ? b : a));
	const [sx, sz] = alongZ ? [0, 1] : [1, 0];
	const reach = (e:ChunkEntity, step:number):number => wallFaceInset(chunk.tile(e.localX + sx * step, e.localZ + sz * step));
	const start = along(first) * CELL_SIZE - reach(first, -1);
	const end = (along(last) + 1) * CELL_SIZE + reach(last, 1);
	const go = thingAt(chunk, ent, `stall_${chunk.id}_${ent.localX}_${ent.localZ}`, 'Stall');
	// Along its row, in the middle of the whole run.
	const axis = alongZ ? 'z' : 'x';
	go.transform.position[axis] = (alongZ ? chunk.worldOriginZ() : chunk.worldOriginX()) + (start + end) / 2 + (ent.offset?.[axis] ?? 0);
	go.transform.yaw = ent.yaw ?? stallYaw(ent.localZ);
	const counter = COUNTER_STYLES[ent.def];
	const style = counter ?? STALL_STYLES[ent.def]!;
	// Only a stall seats customers; a shop counter has no bench.
	const benched = !counter && !!STALL_STYLES[ent.def]!.bench;
	const width = counter ? end - start : STALL_COUNTER.w;
	// Solid from the shelf behind the counter, or the counter's back, out to the bench's front, or the counter's: nobody walks through any.
	const middle = COUNTER_Z * STALL_SCALE;
	const back = middle - STALL_COUNTER.d / 2 - (style.shelf ? 0.15 : 0);
	const front = benched ? (BENCH_Z + BENCH_DEPTH / 2) * STALL_SCALE : middle + STALL_COUNTER.d / 2;
	const wares = ent.on ?? [];
	register(go.id, () => (counter ? createCounterMesh(counter, width, wares) : createStallMesh(STALL_STYLES[ent.def]!, wares)));
	go.addComponent(DemoMeshRenderer, { meshID: go.id });
	const solid = new GameObject(`${go.id} counter`, 'Stall');
	solid.parent = go;
	solid.transform.localPosition = { x: 0, y: STALL_COUNTER.h * 0.5, z: (back + front) / 2 };
	solid.addComponent(BoxCollider, { size: { x: width, y: STALL_COUNTER.h, z: front - back } });
	if (benched) {
		// Customers sit on it side by side, facing the counter: as many as its width fits.
		const bench = new GameObject(`${ent.name ?? go.id}Bench`, 'Bench');
		bench.parent = go;
		bench.transform.localPosition = { x: 0, y: 0, z: BENCH_Z * STALL_SCALE };
		bench.transform.yaw = go.transform.yaw + Math.PI;
		bench.addComponent(Named, { id: bench.id });
		const seat = STALL_BENCH_W * STALL_SCALE;
		bench.addComponent(Furniture, { kind: 'chair', places: Math.floor(seat / PLACE_WIDTH), width: seat });
		bench.addComponent(Servings, { wares });
	}
	world.add(go);
}

/** Every seller's post on the chunk: its cells, by the name they share. Its def is its look; `on`, the wares on its counter. */
export const stall:Thing = {
	defs: [...Object.keys(STALL_STYLES), ...Object.keys(COUNTER_STYLES)],
	spawn: (world, chunk, ents) => {
		const posts = new Map<string, ChunkEntity[]>();
		for (const ent of ents) {
			const key = ent.name ?? `${ent.localX},${ent.localZ}`;
			posts.set(key, [...(posts.get(key) ?? []), ent]);
		}
		posts.forEach((run) => spawnStall(world, chunk, run));
	},
};

