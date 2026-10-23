import { chunkBounds, hash, ToonMaterial } from '@arc-director/kindling';
import * as THREE from 'three';
import { CELL_SIZE, MOON_WINDOW, TILE_HEIGHT, WALL_HEIGHT } from '../world/constants';
import type { Chunk, Tile } from '../world/Chunk';
import { getNature, toonWaterMat, GRASS_UV_REP, GRASS_Y, SAND_TILE, SURFACE_ORDER, WATER_LOWER_Y, WATER_UPPER_Y } from './nature';
import { dirtMat, sandMat, meadowMat, PALETTE, plankMat, stoneFloorMat, stoneStairMat, stoneWallMat } from './toon';
import { dressingDraws, type DressingDraw } from './dressing';
import { createWaterFlowField, type Flow } from './waterFlow';
import { attachChunkAo } from './bakeAo';
import { addLandforms, BANK_BED, bankFall, bankWet } from './land';
import { LANDFORMS } from '../world/land';
import { bankUV, finishYMesh, makeYBuf, pushGround, pushYPoly, pushYTri, type Point, type YBuf } from './groundMesh';
import { sandField, showsWater } from '../world/water';
import { roadInside, roadLines, ROAD_HALF_WIDTH, ROAD_Y, segmentDistance, type RoadLine } from '../world/dressingPlan';
import { DECK_TOP, PLANK_Y, STONE_Y } from '../engine/World';
import { stairUphill } from '../world/stairs';
import { straightRun, THIN_WALLS, thinWallBoxes, WALL_THICKNESS, wallFloors, wallSide, WINDOW, type FloorQuarter } from '../world/thinWall';

export const CHUNK_MESH_REV = 118;

/** Squares per cell side where lawn meets water, for the sand edge to curve through. */
const SHORE_STEPS = 8;

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
):THREE.InstancedMesh | undefined {
	if (items.length === 0) {
		return undefined;
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
	return mesh;
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

/** How far down from the wall tops the rock ceiling over a stairwell reaches. */
const STAIRWELL_CEILING = 0.3;

/**
 * Stairs: four steps a cell, climbing one tile height from the tile below (so a flight of cells climbs on). Blocked
 * stairs are a stairwell cut into the rock, out of reach: a ceiling at the wall tops hides where they lead.
 */
function addStairs(group:THREE.Group, chunk:Chunk):void {
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const steps = 4;
	const stepLen = CELL_SIZE / steps;
	type Step = { x:number; z:number; h:number; alongZ:boolean; uphill:{ x:number; z:number }; cast:boolean };
	const bySize = new Map<string, Step[]>();
	const ceilings:Slab[] = [];
	chunk.forEachTile((tile, lx, lz) => {
		if (tile.def !== 'stairs') {
			return;
		}
		if (tile.blocked) {
			const x = ox + lx * CELL_SIZE;
			const z = oz + lz * CELL_SIZE;
			ceilings.push({ minX: x, maxX: x + CELL_SIZE, minY: WALL_HEIGHT - STAIRWELL_CEILING, maxY: WALL_HEIGHT, minZ: z, maxZ: z + CELL_SIZE });
		}
		const uphill = stairUphill(chunk, lx, lz);
		const top = tile.height * TILE_HEIGHT;
		const bottom = Math.max(0, top - TILE_HEIGHT);
		const alongZ = uphill.dx === 0;
		for (let i = 0; i < steps; i++) {
			const h = bottom + ((i + 1) / steps) * (top - bottom);
			const along = uphill.dx + uphill.dz < 0
				? CELL_SIZE - (i + 0.5) * stepLen
				: (i + 0.5) * stepLen;
			const x = alongZ ? ox + (lx + 0.5) * CELL_SIZE : ox + lx * CELL_SIZE + along;
			const z = alongZ ? oz + lz * CELL_SIZE + along : oz + (lz + 0.5) * CELL_SIZE;
			const key = `${h},${uphill.dx},${uphill.dz},${tile.blocked}`;
			let list = bySize.get(key);
			if (!list) {
				list = [];
				bySize.set(key, list);
			}
			// A stairwell's steps cast no shadow: light coming down them from far off would have each step shade the next.
			list.push({ x, z, h, alongZ, uphill: { x: uphill.dx, z: uphill.dz }, cast: !tile.blocked });
		}
	});
	for (const list of bySize.values()) {
		const { h, alongZ, uphill, cast } = list[0]!;
		const geom = new THREE.BoxGeometry(alongZ ? CELL_SIZE : stepLen, h, alongZ ? stepLen : CELL_SIZE);
		addInstanced(group, geom, stoneStairMat(uphill), list, cast, (step) => {
			dummy.position.set(step.x, h * 0.5, step.z);
		});
	}
	addSlabs(group, stoneWallMat(), ceilings, true);
}

/** Stone paving: open ground floor that is not lawn, water, stairs or boards. */
function isFlatStone(tile:Tile):boolean {
	return !tile.blocked && tile.def !== 'stairs' && tile.height <= 0 && tile.def !== 'grass' && !showsWater(tile.def) && tile.def !== 'plank';
}

function addFlatFloors(group:THREE.Group, chunk:Chunk):void {
	const squares = [
		...cellsWhere(chunk, isFlatStone).map(({ lx, lz }) => ({ ...chunk.worldCellCenter(lx, lz), size: CELL_SIZE })),
		...wallFloorsOf(chunk, isFlatStone).map((q) => ({ x: (q.x0 + q.x1) / 2, z: (q.z0 + q.z1) / 2, size: q.x1 - q.x0 })),
	];
	addInstanced(group, new THREE.PlaneGeometry(1, 1), stoneFloorMat(), squares, false, ({ x, z, size }) => {
		dummy.position.set(x, 0.002, z);
		dummy.rotation.set(-Math.PI / 2, 0, 0);
		dummy.scale.set(size, size, 1);
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

function addWalls(group:THREE.Group, terrain:Terrain, chunk:Chunk):void {
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const windows = moonWindowWalls(chunk);
	addSlabs(group, stoneWallMat(), [...windows.values()].flat(), true);
	const cells = cellsWhere(chunk, (tile) => tile.blocked && tile.def !== 'water' && tile.def !== 'stairs' && !THIN_WALLS.has(tile.def) && !LANDFORMS.has(tile.def))
		.filter(({ lx, lz }) => !windows.has(lz * chunk.size + lx));
	addInstanced(group, new THREE.BoxGeometry(CELL_SIZE, WALL_HEIGHT, CELL_SIZE), stoneWallMat(), cells, true, ({ lx, lz }) => {
		const h = wallHeight(chunk, lx, lz);
		dummy.position.set(ox + (lx + 0.5) * CELL_SIZE, h * 0.5, oz + (lz + 0.5) * CELL_SIZE);
		dummy.scale.set(1, h / WALL_HEIGHT, 1);
	});
	// The foot of a wall that stands in the river, from the water up into the courses.
	const feet:Slab[] = [];
	const half = CELL_SIZE / 2;
	chunk.forEachTile((tile, lx, lz) => {
		if (!tile.blocked || showsWater(tile.def) || THIN_WALLS.has(tile.def) || LANDFORMS.has(tile.def)) {
			return;
		}
		const c = chunk.worldCellCenter(lx, lz);
		for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
			const n = terrain.tileAtWorld(c.x + dx * CELL_SIZE, c.z + dz * CELL_SIZE);
			if (!n || !showsWater(n.def)) {
				continue;
			}
			const y0 = n.height * TILE_HEIGHT + WATER_UPPER_Y;
			const face = dx !== 0 ? c.x + dx * half : c.z + dz * half;
			feet.push(dx !== 0
				? { minX: face - 0.04, maxX: face + 0.04, minY: y0, maxY: 0.04, minZ: c.z - half, maxZ: c.z + half }
				: { minX: c.x - half, maxX: c.x + half, minY: y0, maxY: 0.04, minZ: face - 0.04, maxZ: face + 0.04 });
		}
	});
	addSlabs(group, stoneWallMat(), feet, true);
}

/** The wall behind each moon window, keyed by cell: stone round its opening, cut right through the cell. */
function moonWindowWalls(chunk:Chunk):Map<number, Slab[]> {
	const out = new Map<number, Slab[]>();
	const { width, height, y } = MOON_WINDOW;
	const half = CELL_SIZE / 2;
	for (const ent of chunk.entities) {
		const side = ent.def === 'moon_window' ? wallSide(chunk, ent.localX, ent.localZ) : undefined;
		if (!side) {
			continue;
		}
		const [dx, dz] = side;
		const lx = ent.localX + dx;
		const lz = ent.localZ + dz;
		const floor = (chunk.tile(ent.localX, ent.localZ)?.height ?? 0) * TILE_HEIGHT;
		const y0 = floor + y - height / 2;
		const y1 = floor + y + height / 2;
		const top = wallHeight(chunk, lx, lz);
		const slab = (u0:number, u1:number, b:number, t:number):Slab => runSlab(chunk.worldCellCenter(lx, lz), dx !== 0 ? 'z' : 'x', u0, u1, b, t, CELL_SIZE);
		out.set(lz * chunk.size + lx, [
			slab(-half, half, 0, y0),
			slab(-half, half, y1, top),
			slab(-half, -width / 2, y0, y1),
			slab(width / 2, half, y0, y1),
		]);
	}
	return out;
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

/** An axis-aligned box in world meters, drawn as a scaled unit cube (patterns are world-space, so boards stay true). */
type Slab = { minX:number; maxX:number; minY:number; maxY:number; minZ:number; maxZ:number };

const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
unitBox.userData.shared = true;

function addSlabs(group:THREE.Group, mat:THREE.Material, slabs:Slab[], castShadow:boolean):THREE.InstancedMesh | undefined {
	return addInstanced(group, unitBox, mat, slabs, castShadow, (s) => {
		dummy.position.set((s.minX + s.maxX) / 2, s.minY, (s.minZ + s.maxZ) / 2);
		dummy.scale.set(s.maxX - s.minX, s.maxY - s.minY, s.maxZ - s.minZ);
	});
}

/** A box spanning `u0`–`u1` along a wall run and `y0`–`y1` up, `depth` thick, about the cell's centre line. */
function runSlab(center:{ x:number; z:number }, run:'x' | 'z', u0:number, u1:number, y0:number, y1:number, depth:number):Slab {
	const across = { min: -depth / 2, max: depth / 2 };
	const [ax, az] = run === 'x' ? [{ min: u0, max: u1 }, across] : [across, { min: u0, max: u1 }];
	return { minX: center.x + ax.min, maxX: center.x + ax.max, minY: y0, maxY: y1, minZ: center.z + az.min, maxZ: center.z + az.max };
}

/**
 * Window glass. It writes depth, so ink outlines see a flat pane and nothing is inked through it; drawn after
 * every other see-through thing ({@link GLASS_ORDER}), so a flame behind the window still shows.
 */
const glassMat = new ToonMaterial({ color: 0xcfe4ee, transparent: true, opacity: 0.22, side: THREE.DoubleSide, outline: false });
glassMat.userData.shared = true;
const GLASS_ORDER = 10;

/**
 * Thin walls, from the same boxes bodies collide with. A window (in a straight run) is the wall around its
 * opening: jambs, a sill wall below and a header above, a dark frame and muntins in a cross, and glass that
 * casts no shadow, so sun and firelight both come through.
 */
function addThinWalls(group:THREE.Group, chunk:Chunk):void {
	const walls:Slab[] = [];
	const frames:Slab[] = [];
	const panes:Slab[] = [];
	const { width, sill, top } = WINDOW;
	const half = CELL_SIZE / 2;
	const w = width / 2;
	const bar = 0.05;
	chunk.forEachTile((tile, lx, lz) => {
		if (!THIN_WALLS.has(tile.def)) {
			return;
		}
		const run = tile.def === 'window' ? straightRun(chunk, lx, lz) : undefined;
		if (!run) {
			walls.push(...thinWallBoxes(chunk, lx, lz).map((b) => ({ ...b, minY: 0, maxY: WALL_HEIGHT })));
			return;
		}
		const c = chunk.worldCellCenter(lx, lz);
		const slab = (u0:number, u1:number, y0:number, y1:number, depth:number):Slab => runSlab(c, run, u0, u1, y0, y1, depth);
		walls.push(
			slab(-half, -w, 0, WALL_HEIGHT, WALL_THICKNESS),
			slab(w, half, 0, WALL_HEIGHT, WALL_THICKNESS),
			slab(-w, w, 0, sill, WALL_THICKNESS),
			slab(-w, w, top, WALL_HEIGHT, WALL_THICKNESS),
		);
		const frame = WALL_THICKNESS + 0.04;
		frames.push(
			slab(-w, -w + bar, sill, top, frame),
			slab(w - bar, w, sill, top, frame),
			slab(-w - 0.04, w + 0.04, sill - 0.03, sill + bar, frame + 0.06),
			slab(-w, w, top - bar, top, frame),
			// The cross: one upright and one rail, through the middle of the glass.
			slab(-0.018, 0.018, sill, top, 0.04),
			slab(-w, w, (sill + top) / 2 - 0.018, (sill + top) / 2 + 0.018, 0.04),
		);
		panes.push(slab(-w, w, sill, top, 0.01));
	});
	addSlabs(group, plankMat(), walls, true);
	addSlabs(group, plankMat(PALETTE.woodDark), frames, true);
	const glass = addSlabs(group, glassMat, panes, false);
	if (glass) {
		glass.renderOrder = GLASS_ORDER;
	}
}

/** The floor quarters under this chunk's thin walls whose floor is one `keep` takes. */
function wallFloorsOf(chunk:Chunk, keep:(tile:Tile)=>boolean):FloorQuarter[] {
	const out:FloorQuarter[] = [];
	chunk.forEachTile((tile, lx, lz) => {
		if (THIN_WALLS.has(tile.def)) {
			out.push(...wallFloors(chunk, lx, lz).filter((q) => keep(q.tile)));
		}
	});
	return out;
}

/** The top of a floor tile. A wall has none. The river is its surface, so a deck skirts down to it. */
function tileTop(tile:Tile | undefined):number | undefined {
	if (tile && showsWater(tile.def)) {
		return tile.height * TILE_HEIGHT + WATER_UPPER_Y;
	}
	if (!tile || tile.blocked || THIN_WALLS.has(tile.def)) {
		return undefined;
	}
	if (tile.def === 'plank') {
		return PLANK_Y;
	}
	if (tile.def === 'bridge') {
		return 0.04;
	}
	if (tile.def === 'grass' || LANDFORMS.has(tile.def)) {
		return tile.height * TILE_HEIGHT + GRASS_Y;
	}
	return tile.height * TILE_HEIGHT + STONE_Y;
}
/** The floor tile under `x, z`. A thin wall is the floor laid on that side of it. A solid wall has none. */
function floorTile(terrain:Terrain, chunks:Chunk[], x:number, z:number):Tile | undefined {
	const tile = terrain.tileAtWorld(x, z);
	if (!tile) {
		return undefined;
	}
	if (THIN_WALLS.has(tile.def)) {
		for (const chunk of chunks) {
			if (!chunk.tileAtWorld(x, z)) {
				continue;
			}
			const { localX, localZ } = chunk.worldToLocal(x, z);
			return wallFloors(chunk, localX, localZ).find((q) => x >= q.x0 && x < q.x1 && z >= q.z0 && z < q.z1)?.tile;
		}
		return undefined;
	}
	if (tile.blocked && !showsWater(tile.def)) {
		return undefined;
	}
	return tile;
}

/** Surfaces piled on a tile after its earth and its own floor, such as a road. */
function makeCovers():{ add(ring:Point[], y:number):void; at(x:number, z:number):number[] } {
	const cells = new Map<string, { ring:Point[]; y:number }[]>();
	const holds = (ring:Point[], x:number, z:number):boolean => {
		let inside = false;
		for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
			const a = ring[i]!;
			const b = ring[j]!;
			if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) {
				inside = !inside;
			}
		}
		return inside;
	};
	return {
		add(ring, y) {
			if (ring.length < 3) {
				return;
			}
			let minX = Infinity;
			let maxX = -Infinity;
			let minZ = Infinity;
			let maxZ = -Infinity;
			for (const p of ring) {
				minX = Math.min(minX, p.x);
				maxX = Math.max(maxX, p.x);
				minZ = Math.min(minZ, p.z);
				maxZ = Math.max(maxZ, p.z);
			}
			const cover = { ring, y };
			for (let x = Math.floor(minX); x <= Math.floor(maxX); x++) {
				for (let z = Math.floor(minZ); z <= Math.floor(maxZ); z++) {
					const key = `${x},${z}`;
					const list = cells.get(key);
					if (list) {
						list.push(cover);
					}
					else {
						cells.set(key, [cover]);
					}
				}
			}
		},
		at(x, z) {
			const list = cells.get(`${Math.floor(x)},${Math.floor(z)}`);
			if (!list) {
				return [];
			}
			const out:number[] = [];
			for (const cover of list) {
				if (holds(cover.ring, x, z)) {
					out.push(cover.y);
				}
			}
			return out;
		},
	};
}

/**
 * Earth, then this tile's own floor, then anything piled on after (a road). Water is only its surface: that is the
 * ground there. A square skirt stops on the highest of these under it; a road skirt goes to the lowest.
 */
function levelsAt(terrain:Terrain, chunks:Chunk[], covers:ReturnType<typeof makeCovers>, x:number, z:number):number[] {
	const extra = covers.at(x, z);
	const tile = floorTile(terrain, chunks, x, z);
	if (!tile) {
		return extra;
	}
	if (showsWater(tile.def)) {
		return [tile.height * TILE_HEIGHT + WATER_UPPER_Y, ...extra];
	}
	const base = tile.height * TILE_HEIGHT;
	const top = tileTop(tile);
	const levels = [base];
	if (top !== undefined && top > base + 0.004) {
		levels.push(top);
	}
	levels.push(...extra);
	return levels;
}

function addPlankFloors(group:THREE.Group, chunk:Chunk, levels:(x:number, z:number)=>number[]):void {
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const boards = makeYBuf();
	const sheet = (x0:number, z0:number, x1:number, z1:number):void => {
		pushGround(boards, [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }], PLANK_Y, levels);
	};
	chunk.forEachTile((tile, lx, lz) => {
		if (tile.def === 'plank') {
			sheet(ox + lx * CELL_SIZE, oz + lz * CELL_SIZE, ox + (lx + 1) * CELL_SIZE, oz + (lz + 1) * CELL_SIZE);
		}
	});
	for (const q of wallFloorsOf(chunk, (tile) => tile.def === 'plank')) {
		sheet(q.x0, q.z0, q.x1, q.z1);
	}
	if (boards.v > 0) {
		group.add(finishYMesh(boards, plankMat(), true));
	}
}

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

/** Tiles by world position across every chunk, so water and lawn edges meet across chunk borders. */
export type Terrain = {
	tileAtWorld(x:number, z:number):Tile | undefined;
};

/** Past the map's edge the land goes on as its edge tiles do (`planOutskirts`), so water and lawn meet the outskirts seamlessly. */
function terrainOf(chunks:Iterable<Chunk>):Terrain {
	const list = [...chunks];
	const map = chunkBounds(list);
	const find = (x:number, z:number):Tile | undefined => {
		for (const chunk of list) {
			const tile = chunk.tileAtWorld(x, z);
			if (tile) {
				return tile;
			}
		}
		return undefined;
	};
	return {
		tileAtWorld(x, z) {
			if (!map) {
				return undefined;
			}
			const e = 1e-6;
			return find(Math.min(Math.max(x, map.minX), map.maxX - e), Math.min(Math.max(z, map.minZ), map.maxZ - e));
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
	waterCells:{ lx:number; lz:number }[],
	levels:(x:number, z:number)=>number[],
):void {
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const grass = makeYBuf();
	const sand = makeYBuf();
	const defAt = (x:number, z:number):string | undefined => terrain.tileAtWorld(x, z)?.def;
	const sandy = (p:Point):number => sandField(defAt, p.x, p.z);
	const lawny = (p:Point):number => -sandField(defAt, p.x, p.z);
	const shallow = (p:Point):number => BANK_BED - sandField(defAt, p.x, p.z);
	// Just under the bed where it meets the water, so no seam shows.
	const bankY = (x:number, z:number):number => GRASS_Y - (GRASS_Y - WATER_LOWER_Y + 0.01) * bankFall(sandField(defAt, x, z));
	const step = CELL_SIZE / SHORE_STEPS;
	const near = (lx:number, lz:number, test:(c:{ x:number; z:number })=>boolean):boolean => (
		[-1, 0, 1].some((dx) => [-1, 0, 1].some((dz) => test(chunk.worldCellCenter(lx + dx, lz + dz))))
	);
	// Beside water: small squares, each split where the sand field crosses its cuts, so the sand edge curves.
	const forEachStep = (x0:number, z0:number, outline:Point[], draw:(piece:Point[])=>void):void => {
		for (let iz = 0; iz < SHORE_STEPS; iz++) {
			for (let ix = 0; ix < SHORE_STEPS; ix++) {
				const sx = x0 + ix * step;
				const sz = z0 + iz * step;
				draw(clipToBox(outline, sx, sz, sx + step, sz + step));
			}
		}
	};
	for (const { lx, lz } of cells) {
		const x0 = ox + lx * CELL_SIZE;
		const z0 = oz + lz * CELL_SIZE;
		const outline = grassOutline(terrain, chunk, lx, lz, x0, z0, x0 + CELL_SIZE, z0 + CELL_SIZE);
		if (!near(lx, lz, (c) => showsWater(defAt(c.x, c.z)))) {
			pushGround(grass, outline, GRASS_Y, levels);
			continue;
		}
		forEachStep(x0, z0, outline, (piece) => {
			pushGround(sand, clipBy(piece, sandy), bankY);
			pushGround(grass, clipBy(piece, lawny));
		});
	}
	// The bank goes on into the river's cells until it sinks under the bed, so the water's corners come out round.
	for (const { lx, lz } of waterCells) {
		if (!near(lx, lz, (c) => defAt(c.x, c.z) === 'grass')) {
			continue;
		}
		const x0 = ox + lx * CELL_SIZE;
		const z0 = oz + lz * CELL_SIZE;
		const x1 = x0 + CELL_SIZE;
		const z1 = z0 + CELL_SIZE;
		forEachStep(x0, z0, [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }], (piece) => {
			pushGround(sand, clipBy(piece, shallow), bankY);
		});
	}
	for (const q of wallFloorsOf(chunk, (tile) => tile.def === 'grass')) {
		pushGround(grass, [{ x: q.x0, z: q.z0 }, { x: q.x1, z: q.z0 }, { x: q.x1, z: q.z1 }, { x: q.x0, z: q.z1 }], GRASS_Y, levels);
	}
	// The bank runs across the way the sand field climbs toward the water.
	const e = 0.05;
	bankUV(sand, 0, SAND_TILE, (x, z) => bankWet(sandField(defAt, x, z)), (x, z) => (
		Math.abs(sandField(defAt, x, z + e) - sandField(defAt, x, z - e)) >= Math.abs(sandField(defAt, x + e, z) - sandField(defAt, x - e, z))
	));
	if (grass.v > 0) {
		group.add(finishYMesh(grass, meadowMat(), true));
	}
	if (sand.v > 0) {
		group.add(finishYMesh(sand, sandMat(), true));
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

/**
 * The road over this chunk's lawn: everything within {@link ROAD_HALF_WIDTH} of its centre lines, the lines
 * blended so inside corners curve. Outside corners and dead ends come out round. Drawn only on lawn, so
 * it stops square at a door or bridge it runs into.
 */
function addRoad(group:THREE.Group, terrain:Terrain, chunk:Chunk, lines:RoadLine[], levels:(x:number, z:number)=>number[], covers:ReturnType<typeof makeCovers>):void {
	if (lines.length === 0) {
		return;
	}
	const inside = (p:Point):number => roadInside(lines, p.x, p.z);
	const ox = chunk.worldOriginX();
	const oz = chunk.worldOriginZ();
	const step = CELL_SIZE / SHORE_STEPS;
	const reach = CELL_SIZE * Math.SQRT1_2 + ROAD_HALF_WIDTH;
	const buf = makeYBuf();
	const polys:Point[][] = [];
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
				const poly = clipBy(clipToBox(outline, sx, sz, sx + step, sz + step), inside);
				if (poly.length >= 3) {
					covers.add(poly, ROAD_Y);
					polys.push(poly);
				}
			}
		}
	});
	for (const poly of polys) {
		pushGround(buf, poly, ROAD_Y, levels);
	}
	if (buf.v > 0) {
		group.add(finishYMesh(buf, dirtMat(), true));
	}
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
	const surface = finishYMesh(upper, toonWaterMat(nature.water, 'upper'), true);
	surface.renderOrder = SURFACE_ORDER;
	group.add(surface);
}

function addGrassAndWater(group:THREE.Group, terrain:Terrain, chunk:Chunk, levels:(x:number, z:number)=>number[]):void {
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
	if (grassCells.length > 0 || waterCells.length > 0) {
		addGrassFloor(group, terrain, chunk, grassCells, waterCells, levels);
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
	const terrain = terrainOf(all);
	const group = new THREE.Group();
	group.name = `chunk_${chunk.id}`;
	const covers = makeCovers();
	const levels = (x:number, z:number):number[] => levelsAt(terrain, all, covers, x, z);
	addFlatFloors(group, chunk);
	addRaisedFloors(group, chunk);
	addWalls(group, terrain, chunk);
	addThinWalls(group, chunk);
	addPlankFloors(group, chunk, levels);
	addFootbridges(group, chunk);
	addStairs(group, chunk);
	addGrassAndWater(group, terrain, chunk, levels);
	addRoad(group, terrain, chunk, roadLines(all), levels, covers);
	addLandforms(group, chunk, (x, z) => terrain.tileAtWorld(x, z));
	addDressing(group, chunk, all);
	attachChunkAo(group, chunk);

	return group;
}
