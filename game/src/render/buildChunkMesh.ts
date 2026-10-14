import { hash } from '@arc-director/kindling';
import * as THREE from 'three';
import { CELL_SIZE, TILE_HEIGHT, WALL_HEIGHT } from '../world/constants';
import type { Chunk, Tile } from '../world/Chunk';
import { getNature, toonWaterMat, GRASS_UV_REP, GRASS_Y, WATER_LOWER_Y, WATER_UPPER_Y } from './nature';
import { wetRockGeometry } from './natureMeshes';
import { dirtMat, sandMat, meadowMat, PALETTE, plankMat, stoneFloorMat, stoneStairMat, stoneWallMat, wetRockMat } from './toon';
import { dressingDraws, type DressingDraw } from './dressing';
import { createWaterFlowField, type Flow } from './waterFlow';
import { attachChunkAo } from './bakeAo';
import { sandField, showsWater } from '../world/water';
import { planBankRocks } from '../world/bankRocks';
import { roadLines, type RoadLine } from '../world/dressingPlan';

export const CHUNK_MESH_REV = 81;

/** Squares per cell side where lawn meets water, for the sand edge to curve through. */
const SHORE_STEPS = 8;

function stairUphill(chunk:Chunk, lx:number, lz:number):{ dx:number; dz:number } {
	const self = chunk.tile(lx, lz);
	const dirs = [
		{ dx: 0, dz: -1 },
		{ dx: 0, dz: 1 },
		{ dx: 1, dz: 0 },
		{ dx: -1, dz: 0 },
	];
	if (!self) {
		return { dx: 0, dz: -1 };
	}
	for (const d of dirs) {
		const n = chunk.tile(lx + d.dx, lz + d.dz);
		if (n && !n.blocked && n.def !== 'stairs' && n.height >= self.height) {
			return d;
		}
	}
	for (const d of dirs) {
		const n = chunk.tile(lx + d.dx, lz + d.dz);
		if (n?.def === 'stairs') {
			return d;
		}
	}
	for (const d of dirs) {
		const n = chunk.tile(lx + d.dx, lz + d.dz);
		if (n && !n.blocked && n.height < self.height) {
			return { dx: -d.dx, dz: -d.dz };
		}
	}
	return { dx: 0, dz: -1 };
}

type Cell = { lx:number; lz:number };

const dummy = new THREE.Object3D();

/** One instanced mesh drawing `geom` once per item; `place` poses `dummy` (reset to identity first). */
function addInstanced<T>(
	group:THREE.Group,
	geom:THREE.BufferGeometry,
	mat:THREE.Material | THREE.Material[],
	items:T[],
	castShadow:boolean,
	place:(item:T)=>void,
):void {
	if (items.length === 0) {
		return;
	}
	const mesh = new THREE.InstancedMesh(geom, mat, items.length);
	mesh.castShadow = castShadow;
	mesh.receiveShadow = true;
	for (let i = 0; i < items.length; i++) {
		dummy.position.set(0, 0, 0);
		dummy.rotation.order = 'XYZ';
		dummy.rotation.set(0, 0, 0);
		dummy.scale.set(1, 1, 1);
		place(items[i]!);
		dummy.updateMatrix();
		mesh.setMatrixAt(i, dummy.matrix);
	}
	mesh.instanceMatrix.needsUpdate = true;
	mesh.computeBoundingSphere();
	group.add(mesh);
}

function cellsWhere(chunk:Chunk, keep:(tile:NonNullable<ReturnType<Chunk['tile']>>)=>boolean):Cell[] {
	const cells:Cell[] = [];
	chunk.forEachTile((tile, lx, lz) => {
		if (keep(tile)) {
			cells.push({ lx, lz });
		}
	});
	return cells;
}

function addStairs(group:THREE.Group, chunk:Chunk):void {
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const steps = 4;
	const stepLen = CELL_SIZE / steps;
	type Step = { x:number; z:number; h:number; alongZ:boolean; uphill:{ x:number; z:number } };
	const bySize = new Map<string, Step[]>();
	chunk.forEachTile((tile, lx, lz) => {
		if (tile.def !== 'stairs') {
			return;
		}
		const uphill = stairUphill(chunk, lx, lz);
		const top = tile.height * TILE_HEIGHT;
		const alongZ = uphill.dx === 0;
		for (let i = 0; i < steps; i++) {
			const h = ((i + 1) / steps) * top;
			const along = uphill.dx + uphill.dz < 0
				? CELL_SIZE - (i + 0.5) * stepLen
				: (i + 0.5) * stepLen;
			const x = alongZ ? ox + (lx + 0.5) * CELL_SIZE : ox + lx * CELL_SIZE + along;
			const z = alongZ ? oz + lz * CELL_SIZE + along : oz + (lz + 0.5) * CELL_SIZE;
			const key = `${h},${uphill.dx},${uphill.dz}`;
			let list = bySize.get(key);
			if (!list) {
				list = [];
				bySize.set(key, list);
			}
			list.push({ x, z, h, alongZ, uphill: { x: uphill.dx, z: uphill.dz } });
		}
	});
	for (const list of bySize.values()) {
		const { h, alongZ, uphill } = list[0]!;
		const geom = new THREE.BoxGeometry(alongZ ? CELL_SIZE : stepLen, h, alongZ ? stepLen : CELL_SIZE);
		addInstanced(group, geom, stoneStairMat(uphill), list, true, (step) => {
			dummy.position.set(step.x, h * 0.5, step.z);
		});
	}
}

function addFlatFloors(group:THREE.Group, chunk:Chunk):void {
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const cells = cellsWhere(chunk, (tile) => !tile.blocked && tile.def !== 'stairs' && tile.height <= 0
		&& tile.def !== 'grass' && !showsWater(tile.def) && tile.def !== 'plank');
	addInstanced(group, new THREE.PlaneGeometry(CELL_SIZE, CELL_SIZE), stoneFloorMat(), cells, false, ({ lx, lz }) => {
		dummy.position.set(ox + (lx + 0.5) * CELL_SIZE, 0.002, oz + (lz + 0.5) * CELL_SIZE);
		dummy.rotation.set(-Math.PI / 2, 0, 0);
	});
}

function addRaisedFloors(group:THREE.Group, chunk:Chunk):void {
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const byHeight = new Map<number, Cell[]>();
	chunk.forEachTile((tile, lx, lz) => {
		if (tile.blocked || tile.def === 'stairs' || tile.height <= 0) {
			return;
		}
		const h = tile.height * TILE_HEIGHT;
		let cells = byHeight.get(h);
		if (!cells) {
			cells = [];
			byHeight.set(h, cells);
		}
		cells.push({ lx, lz });
	});
	const wall = stoneWallMat();
	const floor = stoneFloorMat();
	for (const [h, cells] of byHeight) {
		const geom = new THREE.BoxGeometry(CELL_SIZE, h, CELL_SIZE);
		addInstanced(group, geom, [wall, wall, floor, floor, wall, wall], cells, true, ({ lx, lz }) => {
			dummy.position.set(ox + (lx + 0.5) * CELL_SIZE, h * 0.5, oz + (lz + 0.5) * CELL_SIZE);
		});
	}
}

function addWalls(group:THREE.Group, chunk:Chunk):void {
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const cells = cellsWhere(chunk, (tile) => tile.blocked && tile.def !== 'water' && tile.def !== 'wood_wall');
	addInstanced(group, new THREE.BoxGeometry(CELL_SIZE, WALL_HEIGHT, CELL_SIZE), stoneWallMat(), cells, true, ({ lx, lz }) => {
		const h = wallHeight(chunk, lx, lz);
		dummy.position.set(ox + (lx + 0.5) * CELL_SIZE, h * 0.5, oz + (lz + 0.5) * CELL_SIZE);
		dummy.scale.set(1, h / WALL_HEIGHT, 1);
	});
}

/** A ruined wall stands as high as its tile, give or take a broken course; every other wall is full height. */
function wallHeight(chunk:Chunk, lx:number, lz:number):number {
	const tile = chunk.tile(lx, lz);
	if (tile?.def !== 'ruin_wall') {
		return WALL_HEIGHT;
	}
	const courses = Math.round(hash(chunk.worldOriginX() + lx, chunk.worldOriginZ() + lz, 5) * 2) - 1;
	return Math.max(TILE_HEIGHT / 2, tile.height * TILE_HEIGHT + (courses * TILE_HEIGHT) / 4);
}

function addWoodWalls(group:THREE.Group, chunk:Chunk):void {
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const cells = cellsWhere(chunk, (tile) => tile.def === 'wood_wall');
	const geom = new THREE.BoxGeometry(CELL_SIZE * 1.04, WALL_HEIGHT, CELL_SIZE * 1.04);
	addInstanced(group, geom, plankMat(), cells, true, ({ lx, lz }) => {
		dummy.position.set(ox + (lx + 0.5) * CELL_SIZE, WALL_HEIGHT * 0.5, oz + (lz + 0.5) * CELL_SIZE);
	});
}

function addPlankFloors(group:THREE.Group, chunk:Chunk):void {
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const cells = cellsWhere(chunk, (tile) => tile.def === 'plank');
	addInstanced(group, new THREE.PlaneGeometry(CELL_SIZE, CELL_SIZE), plankMat(), cells, false, ({ lx, lz }) => {
		dummy.position.set(ox + (lx + 0.5) * CELL_SIZE, 0.03, oz + (lz + 0.5) * CELL_SIZE);
		dummy.rotation.set(-Math.PI / 2, 0, 0);
	});
}

const DECK_TOP = 0.04;
const RAIL_Y = 0.62;
const POST = 0.09;

/** Footbridge decks over water, with a rail along every edge that faces open water. */
function addFootbridges(group:THREE.Group, chunk:Chunk):void {
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const decks = cellsWhere(chunk, (tile) => tile.def === 'bridge');
	if (decks.length === 0) {
		return;
	}
	const wood = plankMat();
	addInstanced(group, new THREE.BoxGeometry(CELL_SIZE, 0.12, CELL_SIZE), wood, decks, true, ({ lx, lz }) => {
		dummy.position.set(ox + (lx + 0.5) * CELL_SIZE, DECK_TOP - 0.06, oz + (lz + 0.5) * CELL_SIZE);
	});
	type Edge = { x:number; z:number; alongX:boolean };
	const edges:Edge[] = [];
	for (const { lx, lz } of decks) {
		for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
			if (chunk.tile(lx + dx, lz + dz)?.def !== 'water') {
				continue;
			}
			edges.push({
				x: ox + (lx + 0.5 + dx * 0.45) * CELL_SIZE,
				z: oz + (lz + 0.5 + dz * 0.45) * CELL_SIZE,
				alongX: dz !== 0,
			});
		}
	}
	const rail = plankMat(PALETTE.woodDark);
	addInstanced(group, new THREE.BoxGeometry(CELL_SIZE, 0.08, 0.08), rail, edges, true, (e) => {
		dummy.position.set(e.x, RAIL_Y, e.z);
		dummy.rotation.y = e.alongX ? 0 : Math.PI / 2;
	});
	const posts = edges.flatMap((e) => [-0.42, 0.42].map((t) => ({
		x: e.x + (e.alongX ? t : 0),
		z: e.z + (e.alongX ? 0 : t),
	})));
	addInstanced(group, new THREE.BoxGeometry(POST, RAIL_Y + 0.08, POST), rail, posts, true, (p) => {
		dummy.position.set(p.x, (RAIL_Y + 0.08) * 0.5, p.z);
	});
}

type YBuf = { pos:number[]; nrm:number[]; uv:number[]; flow:number[]; shore:number[]; idx:number[]; v:number };

function makeYBuf():YBuf {
	return { pos: [], nrm: [], uv: [], flow: [], shore: [], idx: [], v: 0 };
}

function pushYTri(
	buf:YBuf,
	ax:number,
	az:number,
	bx:number,
	bz:number,
	cx:number,
	cz:number,
	y:number,
	rep:number,
	fa?:Flow,
	fb?:Flow,
	fc?:Flow,
	sa?:number,
	sb?:number,
	sc?:number,
):void {
	buf.pos.push(ax, y, az, bx, y, bz, cx, y, cz);
	buf.nrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
	buf.uv.push(ax / rep, az / rep, bx / rep, bz / rep, cx / rep, cz / rep);
	if (fa && fb && fc) {
		buf.flow.push(fa.x, fa.z, fb.x, fb.z, fc.x, fc.z);
	}
	if (sa !== undefined && sb !== undefined && sc !== undefined) {
		buf.shore.push(sa, sb, sc);
	}
	buf.idx.push(buf.v, buf.v + 1, buf.v + 2);
	buf.v += 3;
}

function pushYPoly(
	buf:YBuf,
	pts:{ x:number; z:number }[],
	y:number,
	rep:number,
	flowAt?:(x:number, z:number)=>Flow,
	shoreAt?:(x:number, z:number)=>number,
):void {
	if (pts.length < 3) {
		return;
	}
	const at = (x:number, z:number):Flow | undefined => flowAt?.(x, z);
	const sh = (x:number, z:number):number | undefined => shoreAt?.(x, z);
	const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
	const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
	for (let i = 0; i < pts.length; i++) {
		const a = pts[i];
		const b = pts[(i + 1) % pts.length];
		pushYTri(buf, cx, cz, b.x, b.z, a.x, a.z, y, rep, at(cx, cz), at(b.x, b.z), at(a.x, a.z), sh(cx, cz), sh(b.x, b.z), sh(a.x, a.z));
	}
}

function finishYMesh(buf:YBuf, mat:THREE.Material, shadows:boolean):THREE.Mesh {
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
	geo.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nrm, 3));
	geo.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
	if (buf.flow.length === buf.v * 2) {
		geo.setAttribute('flow', new THREE.Float32BufferAttribute(buf.flow, 2));
	}
	if (buf.shore.length === buf.v) {
		geo.setAttribute('shore', new THREE.Float32BufferAttribute(buf.shore, 1));
	}
	geo.setIndex(buf.idx);
	const mesh = new THREE.Mesh(geo, mat);
	mesh.receiveShadow = shadows;
	return mesh;
}

/** Tiles by world position across every chunk, so water and lawn edges meet across chunk borders. */
export type Terrain = {
	tileAtWorld(x:number, z:number):Tile | undefined;
};

function terrainOf(chunks:Iterable<Chunk>):Terrain {
	const list = [...chunks];
	return {
		tileAtWorld(x, z) {
			for (const chunk of list) {
				const tile = chunk.tileAtWorld(x, z);
				if (tile) {
					return tile;
				}
			}
			return undefined;
		},
	};
}

function isWater(terrain:Terrain, chunk:Chunk, lx:number, lz:number):boolean {
	const c = chunk.worldCellCenter(lx, lz);
	return showsWater(terrain.tileAtWorld(c.x, c.z)?.def);
}

function isWaterWorld(terrain:Terrain, x:number, z:number):boolean {
	return showsWater(terrain.tileAtWorld(x, z)?.def);
}

function shoreAmt(terrain:Terrain, x:number, z:number):number {
	let land = 0;
	let n = 0;
	for (const dx of [-0.42, -0.18, 0, 0.18, 0.42]) {
		for (const dz of [-0.42, -0.18, 0, 0.18, 0.42]) {
			n += 1;
			if (!isWaterWorld(terrain, x + dx, z + dz)) {
				land += 1;
			}
		}
	}
	return land / n;
}

function grassOutline(
	terrain:Terrain,
	chunk:Chunk,
	lx:number,
	lz:number,
	x0:number,
	z0:number,
	x1:number,
	z1:number,
):{ x:number; z:number }[] {
	const cut = CELL_SIZE * 0.52;
	const n = isWater(terrain, chunk, lx, lz - 1);
	const s = isWater(terrain, chunk, lx, lz + 1);
	const e = isWater(terrain, chunk, lx + 1, lz);
	const w = isWater(terrain, chunk, lx - 1, lz);
	const pts:{ x:number; z:number }[] = [];
	if (n && w) {
		pts.push({ x: x0, z: z0 + cut }, { x: x0 + cut, z: z0 });
	}
	else {
		pts.push({ x: x0, z: z0 });
	}
	if (n && e) {
		pts.push({ x: x1 - cut, z: z0 }, { x: x1, z: z0 + cut });
	}
	else {
		pts.push({ x: x1, z: z0 });
	}
	if (s && e) {
		pts.push({ x: x1, z: z1 - cut }, { x: x1 - cut, z: z1 });
	}
	else {
		pts.push({ x: x1, z: z1 });
	}
	if (s && w) {
		pts.push({ x: x0 + cut, z: z1 }, { x: x0, z: z1 - cut });
	}
	else {
		pts.push({ x: x0, z: z1 });
	}
	return pts;
}

function addGrassFloor(
	group:THREE.Group,
	terrain:Terrain,
	chunk:Chunk,
	cells:{ lx:number; lz:number }[],
	sandMap:THREE.Texture,
):void {
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const grass = makeYBuf();
	const sand = makeYBuf();
	const defAt = (x:number, z:number):string | undefined => terrain.tileAtWorld(x, z)?.def;
	const sandy = (p:Point):number => sandField(defAt, p.x, p.z);
	const lawny = (p:Point):number => -sandField(defAt, p.x, p.z);
	const step = CELL_SIZE / SHORE_STEPS;
	for (const { lx, lz } of cells) {
		const x0 = ox + lx * CELL_SIZE;
		const z0 = oz + lz * CELL_SIZE;
		const outline = grassOutline(terrain, chunk, lx, lz, x0, z0, x0 + CELL_SIZE, z0 + CELL_SIZE);
		if (![-1, 0, 1].some((dx) => [-1, 0, 1].some((dz) => isWater(terrain, chunk, lx + dx, lz + dz)))) {
			pushGround(grass, outline);
			continue;
		}
		// Beside water: small squares, each split where the sand field crosses zero, so the sand edge curves.
		for (let iz = 0; iz < SHORE_STEPS; iz++) {
			for (let ix = 0; ix < SHORE_STEPS; ix++) {
				const sx = x0 + ix * step;
				const sz = z0 + iz * step;
				const piece = clipToBox(outline, sx, sz, sx + step, sz + step);
				pushGround(sand, clipBy(piece, sandy));
				pushGround(grass, clipBy(piece, lawny));
			}
		}
	}
	group.add(finishYMesh(grass, meadowMat(), true));
	if (sand.v > 0) {
		group.add(finishYMesh(sand, sandMat(sandMap), true));
	}
}

type Point = { x:number; z:number };

/** A flat outline on the ground, its corners in order (NW, NE, SE, SW for a cell): two triangles for a quad, else a fan. */
function pushGround(buf:YBuf, pts:Point[], y = GRASS_Y):void {
	if (pts.length === 4) {
		// CCW from +Y so Lambert/sun hit the top face.
		pushYTri(buf, pts[0].x, pts[0].z, pts[2].x, pts[2].z, pts[1].x, pts[1].z, y, GRASS_UV_REP);
		pushYTri(buf, pts[0].x, pts[0].z, pts[3].x, pts[3].z, pts[2].x, pts[2].z, y, GRASS_UV_REP);
	}
	else {
		pushYPoly(buf, pts, y, GRASS_UV_REP);
	}
}

/**
 * The part of `pts` where `inside` is not below zero, in the same winding: one Sutherland–Hodgman step,
 * cutting each edge where `inside` crosses zero (linear between its ends, so exact for straight cuts).
 */
function clipBy(pts:Point[], inside:(p:Point)=>number):Point[] {
	const d = pts.map(inside);
	const out:Point[] = [];
	pts.forEach((a, i) => {
		const j = (i + 1) % pts.length;
		const b = pts[j]!;
		if (d[i]! >= 0) {
			out.push(a);
		}
		if ((d[i]! > 0 && d[j]! < 0) || (d[i]! < 0 && d[j]! > 0)) {
			const t = d[i]! / (d[i]! - d[j]!);
			out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
		}
	});
	return out;
}

/** The part of convex `pts` inside the box, in the same winding. */
function clipToBox(pts:Point[], x0:number, z0:number, x1:number, z1:number):Point[] {
	return [(p:Point) => p.x - x0, (p:Point) => x1 - p.x, (p:Point) => p.z - z0, (p:Point) => z1 - p.z].reduce(clipBy, pts);
}

/** Half the road's width, in meters. */
const ROAD_HALF_WIDTH = 0.46;
/** How round the road's inside corners are: about the radius of the curve where two stretches meet. */
const ROAD_FILLET = 0.35;
/** Road height: just over the lawn, as the path always sat. */
const ROAD_Y = 0.03;

/** Smooth minimum: the smaller of `a` and `b`, rounded off within `k` of where they cross. */
function smoothMin(a:number, b:number, k:number):number {
	const h = Math.max(k - Math.abs(a - b), 0) / k;
	return Math.min(a, b) - (h * h * k) / 4;
}

function segmentDistance(p:Point, a:Point, b:Point):number {
	const dx = b.x - a.x;
	const dz = b.z - a.z;
	const len2 = dx * dx + dz * dz;
	const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2)) : 0;
	return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
}

/**
 * The road over this chunk's lawn: everything within {@link ROAD_HALF_WIDTH} of its centre lines, the lines
 * blended so inside corners curve. Outside corners and dead ends come out round. Drawn only on lawn, so
 * it stops square at a door or bridge it runs into.
 */
function addRoad(group:THREE.Group, terrain:Terrain, chunk:Chunk, lines:RoadLine[]):void {
	if (lines.length === 0) {
		return;
	}
	const inside = (p:Point):number => ROAD_HALF_WIDTH - lines.reduce((d, l) => smoothMin(d, segmentDistance(p, l.a, l.b), ROAD_FILLET), Infinity);
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const step = CELL_SIZE / SHORE_STEPS;
	const reach = CELL_SIZE * Math.SQRT1_2 + ROAD_HALF_WIDTH;
	const buf = makeYBuf();
	chunk.forEachTile((tile, lx, lz) => {
		const x0 = ox + lx * CELL_SIZE;
		const z0 = oz + lz * CELL_SIZE;
		const center = { x: x0 + CELL_SIZE / 2, z: z0 + CELL_SIZE / 2 };
		if (tile.def !== 'grass' || !lines.some((l) => segmentDistance(center, l.a, l.b) < reach)) {
			return;
		}
		const outline = grassOutline(terrain, chunk, lx, lz, x0, z0, x0 + CELL_SIZE, z0 + CELL_SIZE);
		for (let iz = 0; iz < SHORE_STEPS; iz++) {
			for (let ix = 0; ix < SHORE_STEPS; ix++) {
				const sx = x0 + ix * step;
				const sz = z0 + iz * step;
				pushGround(buf, clipBy(clipToBox(outline, sx, sz, sx + step, sz + step), inside), ROAD_Y);
			}
		}
	});
	if (buf.v > 0) {
		group.add(finishYMesh(buf, dirtMat(), true));
	}
}

function addBankRocks(group:THREE.Group, chunk:Chunk):void {
	addInstanced(group, wetRockGeometry(), wetRockMat(), planBankRocks(chunk), true, (rock) => {
		dummy.position.set(rock.x, GRASS_Y, rock.z);
		dummy.rotation.set(0, rock.yaw, 0);
		dummy.scale.setScalar(rock.scale);
	});
}

function fillWaterSheet(
	buf:YBuf,
	terrain:Terrain,
	chunk:Chunk,
	cells:{ lx:number; lz:number }[],
	y:number,
	flowAt:(x:number, z:number)=>Flow,
	shoreAt:(x:number, z:number)=>number,
):void {
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const cut = CELL_SIZE * 0.82;
	const waterRep = 1;
	const div = 4;
	for (const { lx, lz } of cells) {
		const x0 = ox + lx * CELL_SIZE;
		const z0 = oz + lz * CELL_SIZE;
		const x1 = x0 + CELL_SIZE;
		const z1 = z0 + CELL_SIZE;
		const cellF = flowAt(x0 + CELL_SIZE * 0.5, z0 + CELL_SIZE * 0.5);
		for (let iz = 0; iz < div; iz++) {
			for (let ix = 0; ix < div; ix++) {
				const xa = x0 + (x1 - x0) * (ix / div);
				const xb = x0 + (x1 - x0) * ((ix + 1) / div);
				const za = z0 + (z1 - z0) * (iz / div);
				const zb = z0 + (z1 - z0) * ((iz + 1) / div);
				const quad = [{ x: xa, z: za }, { x: xb, z: za }, { x: xb, z: zb }, { x: xa, z: zb }];
				pushYPoly(buf, quad, y, waterRep, (x, z) => cellF, shoreAt);
			}
		}
	}
	chunk.forEachTile((tile, lx, lz) => {
		if (tile.def !== 'grass') {
			return;
		}
		const x0 = ox + lx * CELL_SIZE;
		const z0 = oz + lz * CELL_SIZE;
		const x1 = x0 + CELL_SIZE;
		const z1 = z0 + CELL_SIZE;
		const n = isWater(terrain, chunk, lx, lz - 1);
		const s = isWater(terrain, chunk, lx, lz + 1);
		const e = isWater(terrain, chunk, lx + 1, lz);
		const w = isWater(terrain, chunk, lx - 1, lz);
		const nF = n ? flowAt(x0 + CELL_SIZE * 0.5, z0 - CELL_SIZE * 0.5) : undefined;
		const sF = s ? flowAt(x0 + CELL_SIZE * 0.5, z1 + CELL_SIZE * 0.5) : undefined;
		const eF = e ? flowAt(x1 + CELL_SIZE * 0.5, z0 + CELL_SIZE * 0.5) : undefined;
		const wF = w ? flowAt(x0 - CELL_SIZE * 0.5, z0 + CELL_SIZE * 0.5) : undefined;
		const cornerFlow = (a?:Flow, b?:Flow):Flow => a ?? b ?? { x: 0, z: 0 };
		const pushCorner = (pts:[number, number][], f:Flow):void => {
			pushYTri(
				buf,
				pts[0][0],
				pts[0][1],
				pts[1][0],
				pts[1][1],
				pts[2][0],
				pts[2][1],
				y,
				waterRep,
				f,
				f,
				f,
				shoreAt(pts[0][0], pts[0][1]),
				shoreAt(pts[1][0], pts[1][1]),
				shoreAt(pts[2][0], pts[2][1]),
			);
		};
		if (n && w) {
			pushCorner([[x0, z0], [x0 + cut, z0], [x0, z0 + cut]], cornerFlow(nF, wF));
		}
		if (n && e) {
			pushCorner([[x1, z0], [x1 - cut, z0], [x1, z0 + cut]], cornerFlow(nF, eF));
		}
		if (s && e) {
			pushCorner([[x1, z1], [x1, z1 - cut], [x1 - cut, z1]], cornerFlow(sF, eF));
		}
		if (s && w) {
			pushCorner([[x0, z1], [x0 + cut, z1], [x0, z1 - cut]], cornerFlow(sF, wF));
		}
	});
}

function addWater(group:THREE.Group, terrain:Terrain, chunk:Chunk, cells:{ lx:number; lz:number }[], nature:ReturnType<typeof getNature>):void {
	const field = createWaterFlowField(terrain);
	const flowAt = (x:number, z:number):Flow => field.sample(x, z);
	const shoreAt = (x:number, z:number):number => shoreAmt(terrain, x, z);
	const lower = makeYBuf();
	const upper = makeYBuf();
	fillWaterSheet(lower, terrain, chunk, cells, WATER_LOWER_Y, flowAt, shoreAt);
	fillWaterSheet(upper, terrain, chunk, cells, WATER_UPPER_Y, flowAt, shoreAt);
	group.add(finishYMesh(lower, toonWaterMat(nature.water, 'lower'), true));
	group.add(finishYMesh(upper, toonWaterMat(nature.water, 'upper'), true));
	addBankRocks(group, chunk);
}

function addGrassAndWater(group:THREE.Group, terrain:Terrain, chunk:Chunk):void {
	let nature;
	try {
		nature = getNature();
	}
	catch {
		return;
	}
	const grassCells:{ lx:number; lz:number }[] = [];
	const waterCells:{ lx:number; lz:number }[] = [];
	chunk.forEachTile((tile, lx, lz) => {
		if (tile.def === 'grass') {
			grassCells.push({ lx, lz });
		}
		else if (showsWater(tile.def)) {
			waterCells.push({ lx, lz });
		}
	});
	if (grassCells.length > 0) {
		addGrassFloor(group, terrain, chunk, grassCells, nature.sand);
	}
	if (waterCells.length > 0) {
		addWater(group, terrain, chunk, waterCells, nature);
	}
}

function addDressing(group:THREE.Group, chunk:Chunk, chunks:Iterable<Chunk>):void {
	const buckets = new Map<string, DressingDraw[]>();
	for (const draw of dressingDraws(chunk, chunks)) {
		const key = `${draw.geom.uuid}|${draw.mat.uuid}|${draw.cast ? 1 : 0}`;
		let list = buckets.get(key);
		if (!list) {
			list = [];
			buckets.set(key, list);
		}
		list.push(draw);
	}
	for (const list of buckets.values()) {
		const first = list[0]!;
		addInstanced(group, first.geom, first.mat, list, first.cast, (item) => {
			// Part tilt first (X, Z), then the prop's yaw (Y): YXZ order.
			dummy.rotation.set(item.rx, item.ry, item.rz, 'YXZ');
			dummy.position.set(item.x, item.y, item.z);
			dummy.scale.set(item.sx, item.sy, item.sz);
		});
	}
}

export function buildChunkMesh(chunk:Chunk, chunks:Iterable<Chunk> = [chunk]):THREE.Group {
	// Callers may pass a one-shot iterator (`world.chunks.values()`); several steps below read it.
	const all = [...chunks];
	const group = new THREE.Group();
	group.name = `chunk_${chunk.id}`;
	addFlatFloors(group, chunk);
	addRaisedFloors(group, chunk);
	addWalls(group, chunk);
	addWoodWalls(group, chunk);
	addPlankFloors(group, chunk);
	addFootbridges(group, chunk);
	addStairs(group, chunk);
	const terrain = terrainOf(all);
	addGrassAndWater(group, terrain, chunk);
	addRoad(group, terrain, chunk, roadLines(all));
	addDressing(group, chunk, all);
	attachChunkAo(group, chunk);

	return group;
}
