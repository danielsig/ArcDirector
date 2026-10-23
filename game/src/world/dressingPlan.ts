import { yawToward } from '@arc-director/kindling';
import { CELL_SIZE, CHUNK_SIZE, TILE_HEIGHT } from './constants';
import type { Chunk } from './Chunk';
import { findBuildings, type DoorAnchor } from './buildings';
import { solidAt, straightRun, WALL_THICKNESS } from './thinWall';
import { showsWater } from './water';
import type { World } from '../engine/World';

/**
 * Where scene dressing goes: the props around a wooden house, the path from its door to the
 * nearest bridge, and the lawn kept clear for both. Pure planning, no rendering: the chunk
 * meshes draw it and `dressingColliders` makes the big pieces solid, from the same plan.
 */

/** Everyday props. These names are what sight would say if they were ever entities. */
export const PROP_IDS = [
	'broom',
	'bucket',
	'barrel',
	'crate',
	'flowerbed',
	'table',
	'chair',
	'bench',
	'well',
	'woodpile',
	'wheelbarrow',
	'sacks',
	'lantern',
	'shelf',
	'jars',
	'weaponRack',
	'bed',
	'trunk',
	'pots',
	'urn',
	'basket',
	'rottenBasket',
	'drums',
	'fallenColumn',
	'rubble',
	'bones',
	'brazier',
	'curtains',
	'wallShelf',
	'plate',
	'fishRack',
	'creel',
	'oars',
	'net',
] as const;

export type PropID = (typeof PROP_IDS)[number];

export function isPropID(def:string):def is PropID {
	return (PROP_IDS as readonly string[]).includes(def);
}

/** Capitalized sight nouns. Dressing must never produce these in a prompt. */
export const DRESSING_SIGHT_WORDS = [
	'Broom',
	'Bucket',
	'Barrel',
	'Crate',
	'Flowerbed',
	'Table',
	'Chair',
	'Bench',
	'Well',
	'Woodpile',
	'Wheelbarrow',
	'Sacks',
	'Lantern',
	'Shelf',
	'Jars',
	'WeaponRack',
	'Bed',
	'Chest',
	'Pots',
	'Urn',
	'Basket',
	'RottenBasket',
	'Drums',
	'FallenColumn',
	'Rubble',
	'Bones',
	'Brazier',
	'Curtains',
	'WallShelf',
	'Plate',
	'FishRack',
	'Creel',
	'Oars',
	'Net',
] as const;

/** Backward tilt, in radians. Lifts the handle top back toward a wall behind the broom. */
export const BROOM_LEAN = 0.24;
/** How far behind its foot the handle top rests: stand the broom this far out from a wall. */
export const BROOM_REACH = 1.3 * Math.sin(BROOM_LEAN);

/** Ground each prop blocks: a cylinder (`round`, diameter `w`) or a box `w` × `d` in its own frame. None: walk through it. */
export const PROP_FOOTPRINT:Record<PropID, { w:number; d:number; round?:boolean } | null> = {
	broom: null,
	bucket: { w: 0.32, d: 0.32, round: true },
	barrel: { w: 0.44, d: 0.44, round: true },
	crate: { w: 0.42, d: 0.42 },
	flowerbed: { w: 0.72, d: 0.36 },
	table: { w: 0.92, d: 0.62 },
	chair: { w: 0.4, d: 0.38 },
	bench: { w: 1.1, d: 0.36 },
	well: { w: 1.24, d: 1.24, round: true },
	woodpile: { w: 0.62, d: 0.45 },
	wheelbarrow: { w: 0.7, d: 1.6 },
	sacks: { w: 0.55, d: 0.5 },
	lantern: null,
	shelf: null,
	jars: null,
	weaponRack: { w: 0.9, d: 0.34 },
	bed: { w: 0.8, d: 1.4 },
	trunk: { w: 0.52, d: 0.34 },
	pots: { w: 0.7, d: 0.6 },
	urn: { w: 0.4, d: 0.4, round: true },
	basket: { w: 0.44, d: 0.44, round: true },
	rottenBasket: { w: 0.44, d: 0.44, round: true },
	drums: { w: 0.9, d: 0.6 },
	fallenColumn: { w: 2.9, d: 0.6 },
	rubble: { w: 0.8, d: 0.7 },
	bones: null,
	brazier: { w: 0.56, d: 0.56, round: true },
	curtains: null,
	wallShelf: null,
	plate: null,
	fishRack: { w: 1.3, d: 0.3 },
	creel: { w: 0.4, d: 0.4, round: true },
	oars: null,
	net: { w: 1.1, d: 0.5 },
};

/** Props fixed to a wall, by depth: a map glyph puts its back flat on the nearest wall (`onWall`), facing out. */
const WALL_MOUNTED:Partial<Record<PropID, number>> = {
	shelf: 0.2,
	wallShelf: 0.38,
};

/** Height of the top of props that something hovers over, such as flies over rotten fruit. */
export const PROP_HEIGHT:Partial<Record<PropID, number>> = {
	rottenBasket: 0.27,
};

/** Height of the top of props other props can rest on (`on` in a map legend). */
export const PROP_TOP:Partial<Record<PropID, number>> = {
	chair: 0.47,
	table: 0.63,
	shelf: 1.32,
	wallShelf: 0.645,
	crate: 0.42,
	barrel: 0.62,
};

export type DressingProp = {
	prop:PropID;
	x:number;
	y:number;
	z:number;
	yaw:number;
};

function chunkAt(chunks:Chunk[], x:number, z:number):Chunk | undefined {
	for (const chunk of chunks) {
		if (chunk.tileAtWorld(x, z)) {
			return chunk;
		}
	}
	return undefined;
}

type Cell = { x:number; z:number };

function lawnAt(chunks:Chunk[], x:number, z:number):boolean {
	const tile = chunkAt(chunks, x, z)?.tileAtWorld(x, z);
	return !!tile && !tile.blocked && tile.def === 'grass';
}

/** The lawn tile in front of the bridge span nearest `from`. */
function bridgeApproach(chunks:Chunk[], from:Cell):Cell | undefined {
	let best:Cell | undefined;
	let bestD = Infinity;
	for (const chunk of chunks) {
		for (const ent of chunk.entities) {
			if (ent.def !== 'bridge_span') {
				continue;
			}
			const span = chunk.worldCellCenter(ent.localX, ent.localZ);
			for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
				const c = { x: span.x + dx * CELL_SIZE, z: span.z + dz * CELL_SIZE };
				const d = Math.hypot(c.x - from.x, c.z - from.z);
				if (d < bestD && lawnAt(chunks, c.x, c.z)) {
					best = c;
					bestD = d;
				}
			}
		}
	}
	return best;
}

/** Straight run of cells from `a` to `b` along one axis, both ends included; empty if any is not lawn. */
function run(chunks:Chunk[], a:Cell, b:Cell):Cell[] {
	const steps = Math.round((Math.abs(b.x - a.x) + Math.abs(b.z - a.z)) / CELL_SIZE);
	const sx = Math.sign(b.x - a.x) * CELL_SIZE;
	const sz = Math.sign(b.z - a.z) * CELL_SIZE;
	const cells:Cell[] = [];
	for (let i = 0; i <= steps; i++) {
		const c = { x: a.x + sx * i, z: a.z + sz * i };
		if (!lawnAt(chunks, c.x, c.z)) {
			return [];
		}
		cells.push(c);
	}
	return cells;
}

/**
 * Path from the door: out from the house, turn halfway, then on to the bridge (an L, never a
 * staircase). Without a reachable bridge it runs straight out until the lawn ends.
 */
export function roadCells(chunks:Chunk[], door:DoorAnchor):Cell[] {
	const start = { x: door.x + door.dx * CELL_SIZE, z: door.z + door.dz * CELL_SIZE };
	const target = bridgeApproach(chunks, start);
	if (target && door.dx === 0 && Math.sign(target.z - start.z) === door.dz) {
		const half = Math.round((target.z - start.z) / 2 / CELL_SIZE) * CELL_SIZE;
		for (const shift of [0, CELL_SIZE, -CELL_SIZE, 2 * CELL_SIZE, -2 * CELL_SIZE]) {
			const elbow = { x: start.x, z: start.z + half + shift };
			const turn = { x: target.x, z: elbow.z };
			const legs = [run(chunks, start, elbow), run(chunks, elbow, turn), run(chunks, turn, target)];
			if (legs.every((leg) => leg.length > 0)) {
				return [...legs[0]!, ...legs[1]!.slice(1), ...legs[2]!.slice(1)];
			}
		}
	}
	const cells:Cell[] = [];
	for (let c = start; cells.length < 24 && lawnAt(chunks, c.x, c.z); c = { x: c.x + door.dx * CELL_SIZE, z: c.z + door.dz * CELL_SIZE }) {
		cells.push(c);
	}
	return cells;
}

/** A straight stretch of road centre line, from `a` to `b` (the same point for a lone cell). */
export type RoadLine = { a:Cell; b:Cell };

/**
 * Each house's door and its road (`roadCells`), then each trailhead (a `trail` tile, `out` toward the open lawn) and
 * its road: straight out across the lawn until it meets another road.
 */
function roadsOf(chunks:Chunk[]):{ door:DoorAnchor; cells:Cell[] }[] {
	const roads = findBuildings(chunks).map(({ out }) => ({ door: out, cells: roadCells(chunks, out) }));
	const key = (c:Cell):string => `${Math.round(c.x)},${Math.round(c.z)}`;
	for (const head of trailheads(chunks)) {
		const taken = new Set(roads.flatMap((r) => r.cells).map(key));
		const cells:Cell[] = [];
		for (let c = { x: head.x + head.dx * CELL_SIZE, z: head.z + head.dz * CELL_SIZE }; lawnAt(chunks, c.x, c.z) && !taken.has(key(c)); c = { x: c.x + head.dx * CELL_SIZE, z: c.z + head.dz * CELL_SIZE }) {
			cells.push(c);
		}
		roads.push({ door: head, cells });
	}
	return roads;
}

/** Where each `trail` tile leads in: its cell, and the way to the open ground beside it. */
function trailheads(chunks:Chunk[]):DoorAnchor[] {
	const out:DoorAnchor[] = [];
	for (const chunk of chunks) {
		chunk.forEachTile((tile, lx, lz) => {
			if (tile.def !== 'trail') {
				return;
			}
			const c = chunk.worldCellCenter(lx, lz);
			const open = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).find(([dx, dz]) => lawnAt(chunks, c.x + dx * CELL_SIZE, c.z + dz * CELL_SIZE));
			if (open) {
				out.push({ x: c.x, z: c.z, dx: open[0], dz: open[1] });
			}
		});
	}
	return out;
}

/** Every road cell, from every door. */
export function allRoadCells(chunks:Iterable<Chunk>):Cell[] {
	return roadsOf([...chunks]).flatMap((road) => road.cells);
}

/**
 * The roads as straight centre lines: each road cell joins its road neighbours, a road's first cell runs on to
 * its door and any cell beside a bridge span on to the span, and every straight run is one line. Turns,
 * T-junctions (where roads meet), crossings and dead ends all follow from the lines; the edge of the cell is
 * where a door or span link stops.
 */
export function roadLines(chunks:Iterable<Chunk>):RoadLine[] {
	const list = [...chunks];
	const roads = roadsOf(list);
	const key = (x:number, z:number):string => `${Math.round(x * 2)},${Math.round(z * 2)}`;
	const byKey = new Map(roads.flatMap((r) => r.cells).map((c) => [key(c.x, c.z), c] as const));
	const cells = [...byKey.values()];
	const spans = new Set(list.flatMap((chunk) => chunk.entities
		.filter((e) => e.def === 'bridge_span')
		.map((e) => chunk.worldCellCenter(e.localX, e.localZ))
		.map((c) => key(c.x, c.z))));
	/** How far the road runs from cell `c` toward `d`: a whole cell to another road cell, half to a door or span, else none. */
	const reach = (c:Cell, [dx, dz]:readonly [number, number]):number => {
		const x = c.x + dx * CELL_SIZE;
		const z = c.z + dz * CELL_SIZE;
		if (byKey.has(key(x, z))) {
			return CELL_SIZE;
		}
		const toDoor = roads.some(({ door, cells: own }) => own[0] && key(own[0].x, own[0].z) === key(c.x, c.z) && dx === -door.dx && dz === -door.dz);
		return toDoor || spans.has(key(x, z)) ? CELL_SIZE / 2 : 0;
	};
	const lines:RoadLine[] = [];
	for (const c of cells) {
		let alone = true;
		for (const u of [[1, 0], [0, 1]] as const) {
			const back = [-u[0], -u[1]] as const;
			if (reach(c, u) === 0 && reach(c, back) === 0) {
				continue;
			}
			alone = false;
			if (reach(c, back) === CELL_SIZE) {
				// Not where this run starts.
				continue;
			}
			let end = c;
			while (reach(end, u) === CELL_SIZE) {
				end = byKey.get(key(end.x + u[0] * CELL_SIZE, end.z + u[1] * CELL_SIZE))!;
			}
			const from = reach(c, back);
			const to = reach(end, u);
			lines.push({
				a: { x: c.x - u[0] * from, z: c.z - u[1] * from },
				b: { x: end.x + u[0] * to, z: end.z + u[1] * to },
			});
		}
		if (alone) {
			lines.push({ a: c, b: c });
		}
	}
	return lines;
}

/** Road height: a clear step above the lawn. The mesh and the feet use this. */
export const ROAD_Y = 0.04;
/** Half the road's width, in meters. */
export const ROAD_HALF_WIDTH = 0.46;
/** How round the road's inside corners are. */
export const ROAD_FILLET = 0.35;

function smoothMin(a:number, b:number, k:number):number {
	const h = Math.max(k - Math.abs(a - b), 0) / k;
	return Math.min(a, b) - (h * h * k) / 4;
}

export function segmentDistance(p:{ x:number; z:number }, a:{ x:number; z:number }, b:{ x:number; z:number }):number {
	const dx = b.x - a.x;
	const dz = b.z - a.z;
	const len2 = dx * dx + dz * dz;
	const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2)) : 0;
	return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
}

/** Signed meters inside the cobbled road: positive on the stones, the same test the mesh is clipped with. */
export function roadInside(lines:RoadLine[], x:number, z:number):number {
	return ROAD_HALF_WIDTH - lines.reduce((d, l) => smoothMin(d, segmentDistance({ x, z }, l.a, l.b), ROAD_FILLET), Infinity);
}

const roadSteps = Symbol.for('arc.roadStep');

/** The cobbled road as one step. Replanned over every loaded chunk, same as the other dressing. */
export function syncRoadStep(world:World):void {
	const lines = roadLines(world.chunks.values());
	if (lines.length === 0) {
		return;
	}
	const xs = lines.flatMap((l) => [l.a.x, l.b.x]);
	const zs = lines.flatMap((l) => [l.a.z, l.b.z]);
	const pad = ROAD_HALF_WIDTH + ROAD_FILLET;
	const step = {
		a: { x: Math.min(...xs) - pad, z: Math.min(...zs) - pad },
		b: { x: Math.max(...xs) + pad, z: Math.max(...zs) + pad },
		sample: (x:number, z:number) => world.tileAtWorld(x, z)?.def === 'grass' && roadInside(lines, x, z) >= 0 ? ROAD_Y : undefined,
	};
	const host = world as World & { [roadSteps]?:{ a:{ x:number; z:number }; b:{ x:number; z:number }; sample:(x:number, z:number)=>number | undefined } };
	const prev = host[roadSteps];
	if (prev) {
		prev.a = step.a;
		prev.b = step.b;
		prev.sample = step.sample;
		return;
	}
	host[roadSteps] = step;
	world.addStepOn(step);
}

function place(prop:PropID, x:number, y:number, z:number, yaw = 0):DressingProp {
	return { prop, x, y, z, yaw };
}

/**
 * Every dressing prop over these chunks: the cottage clusters, the goods around each market stall, and the
 * props a chunk map places itself with a prop glyph.
 */
export function planProps(chunks:Iterable<Chunk>):DressingProp[] {
	const list = [...chunks];
	return [...cottageProps(list), ...stallProps(list), ...glyphProps(list), ...windowProps(list)];
}

/**
 * The farmyard of the first house on the map whose door opens onto lawn (shops on a paved square, and smaller
 * houses, furnish themselves with prop glyphs): one cluster at its door, one in the room, one where the path meets
 * the water. Offsets are meters from the door, in the door's outside frame (forward, right).
 */
function cottageProps(list:Chunk[]):DressingProp[] {
	const door = findBuildings(list).map((b) => b.out).find((out) => lawnAt(list, out.x + out.dx * CELL_SIZE, out.z + out.dz * CELL_SIZE));
	if (!door) {
		return [];
	}
	const rightX = door.dz;
	const rightZ = -door.dx;
	const at = (forward:number, right:number, y = 0):{ x:number; y:number; z:number } => ({
		x: door.x + door.dx * forward + rightX * right,
		y,
		z: door.z + door.dz * forward + rightZ * right,
	});
	const yard = [
		place('flowerbed', at(0.85, -1.35).x, 0, at(0.85, -1.35).z),
		place('bench', at(1.7, -2.15).x, 0, at(1.7, -2.15).z),
		...onWall(list, ['broom'], at(0.75, 1.45), BROOM_REACH * 2),
		place('bucket', at(1.1, 1.7).x, 0, at(1.1, 1.7).z),
		place('barrel', at(0.8, 2.35).x, 0, at(0.8, 2.35).z),
	];
	const room = [
		// Long side to the chair.
		place('table', at(-2.15, -0.35).x, 0, at(-2.15, -0.35).z, Math.PI / 2),
		place('chair', at(-2.15, -0.95).x, 0, at(-2.15, -0.95).z, Math.atan2(rightX, rightZ)),
		place('lantern', at(-2.35, -0.15).x, 0.64, at(-2.35, -0.15).z),
		...onWall(list, ['shelf', 'jars'], at(-3.15, 0.7), 0.2, [0, 1.32]),
		// Head to the wall: a bed's origin is its middle, so its back is half its length behind it.
		...onWall(list, ['bed'], at(-2.3, 1.7), PROP_FOOTPRINT.bed!.d),
		place('trunk', at(-1.15, 1.75).x, 0, at(-1.15, 1.75).z, 0.4),
		...onWall(list, ['broom'], at(-1.05, -1.15), BROOM_REACH * 2),
	];
	const road = roadCells(list, door);
	const along = Math.atan2(door.dx, door.dz);
	const across = Math.atan2(rightX, rightZ);
	const spot = (prop:PropID, forward:number, right:number, yaw:number, radius:number):DressingProp | null => {
		const p = at(forward, right);
		return openGround(list, road, p.x, p.z, radius) ? place(prop, p.x, 0, p.z, yaw) : null;
	};
	// Halfway down the path: a work yard on one side, the well on the other. Woodpile against the house.
	const roadside = [
		spot('wheelbarrow', 4.6, 2.4, along, 0.8),
		spot('crate', 5.6, 3.3, along + 0.3, 0.35),
		spot('sacks', 4.1, 3.5, 0, 0.4),
		...onWall(list, ['woodpile'], at(-1.6, 3.6), 0.45),
		spot('weaponRack', 4.6, -1.8, across, 0.5),
		// Near the house, not the river: you dig a well where you live.
		spot('well', 3.2, -3.4, 0, 0.75),
	].filter((p):p is DressingProp => p !== null);
	return [...yard, ...room, ...roadside];
}

/** Curtains on the inside of every window: the side whose floor is a room's boards. */
function windowProps(list:Chunk[]):DressingProp[] {
	const out:DressingProp[] = [];
	for (const chunk of list) {
		chunk.forEachTile((tile, lx, lz) => {
			const run = tile.def === 'window' ? straightRun(chunk, lx, lz) : undefined;
			if (!run) {
				return;
			}
			const [ax, az] = run === 'x' ? [0, 1] : [1, 0];
			const inward = [1, -1].find((s) => chunk.tile(lx + ax * s, lz + az * s)?.def === 'plank');
			if (inward === undefined) {
				return;
			}
			const c = chunk.worldCellCenter(lx, lz);
			const off = WALL_THICKNESS / 2 + 0.02;
			out.push(place('curtains', c.x + ax * inward * off, 0, c.z + az * inward * off, yawToward(-ax * inward, -az * inward)));
		});
	}
	return out;
}

/** A stall faces the middle of its chunk: stalls in the north half turn round to face south. */
export function stallYaw(localZ:number):number {
	return localZ > CHUNK_SIZE / 2 ? Math.PI : 0;
}

/** One prop beside a stall: `right` and `forward` in meters in the stall's frame (+Z its customer side). */
type StallSpot = { prop:PropID; right:number; forward:number; yaw?:number; y?:number };

/** Each stall's wares spill out beside its counter, never in front of it where customers stand. */
const STALL_GOODS:Record<string, StallSpot[]> = {
	BakerStall: [
		{ prop: 'sacks', right: -1.35, forward: -0.1, yaw: 0.3 },
		{ prop: 'barrel', right: 1.25, forward: -0.25 },
		{ prop: 'crate', right: 1.3, forward: 0.4, yaw: 0.2 },
	],
	WeaverStall: [
		{ prop: 'basket', right: -1.25, forward: 0.2 },
		{ prop: 'crate', right: 1.3, forward: -0.1, yaw: -0.15 },
	],
	PotterStall: [
		{ prop: 'pots', right: -1.45, forward: 0.05, yaw: 0.4 },
		{ prop: 'urn', right: -1.2, forward: -0.75 },
		{ prop: 'urn', right: 1.2, forward: -0.35, yaw: 1.2 },
		{ prop: 'pots', right: 1.5, forward: 0.45, yaw: 2.2 },
	],
	CutlerStall: [
		{ prop: 'weaponRack', right: 1.45, forward: -0.15, yaw: -Math.PI / 2 },
		{ prop: 'crate', right: -1.3, forward: -0.05 },
		{ prop: 'bucket', right: -1.25, forward: 0.5 },
	],
	FruitStall: [
		{ prop: 'basket', right: -1.25, forward: 0.25 },
		{ prop: 'crate', right: -1.3, forward: -0.45, yaw: 0.3 },
		{ prop: 'basket', right: 1.3, forward: -0.05 },
		{ prop: 'wheelbarrow', right: 1.9, forward: -0.9, yaw: 0.9 },
	],
};

function stallProps(list:Chunk[]):DressingProp[] {
	const out:DressingProp[] = [];
	for (const chunk of list) {
		for (const ent of chunk.entities) {
			const goods = ent.def === 'stall' && ent.name ? STALL_GOODS[ent.name] : undefined;
			if (!goods) {
				continue;
			}
			const center = chunk.worldCellCenter(ent.localX, ent.localZ);
			const yaw = stallYaw(ent.localZ);
			const cos = Math.cos(yaw);
			const sin = Math.sin(yaw);
			for (const spot of goods) {
				// The stall's own frame turned by its yaw, as Three.js turns the mesh.
				const x = center.x + spot.right * cos + spot.forward * sin;
				const z = center.z - spot.right * sin + spot.forward * cos;
				out.push(place(spot.prop, x, spot.y ?? 0, z, yaw + (spot.yaw ?? 0)));
			}
		}
	}
	return out;
}

/**
 * How far from a wall a prop stands with its back flat on it, twice over (as `onWall` takes it): a box its depth, the
 * broom where its handle rests on the wall. Round props and loose small things stand where their cell puts them.
 */
function standDepth(def:PropID):number | undefined {
	if (def === 'broom') {
		return BROOM_REACH * 2;
	}
	const foot = PROP_FOOTPRINT[def];
	return foot && !foot.round ? foot.d : undefined;
}

/**
 * Props a chunk map places with a glyph whose entity `def` is a prop id. A legend `yaw` turns it; without
 * one it faces away from a wall it stands against, flush on it, else turns by a hash of its cell.
 */
function glyphProps(list:Chunk[]):DressingProp[] {
	const out:DressingProp[] = [];
	for (const chunk of list) {
		for (const ent of chunk.entities) {
			if (!isPropID(ent.def)) {
				continue;
			}
			const center = chunk.worldCellCenter(ent.localX, ent.localZ);
			const x = center.x + (ent.offset?.x ?? 0);
			const z = center.z + (ent.offset?.z ?? 0);
			const y = (chunk.tile(ent.localX, ent.localZ)?.height ?? 0) * TILE_HEIGHT + (ent.offset?.y ?? 0);
			const def = ent.def;
			const on = (ent.on ?? []).filter(isPropID);
			const beside = ent.yaw === undefined && wallBeside(chunk, ent.localX, ent.localZ);
			const depth = WALL_MOUNTED[def] ?? (beside ? standDepth(def) : undefined);
			if (depth !== undefined) {
				out.push(...onWall(list, [def, ...on], { x, z }, depth, [y, ...on.map(() => y + (PROP_TOP[def] ?? 0))]));
				continue;
			}
			const yaw = ent.yaw ?? glyphYaw(chunk, ent.localX, ent.localZ);
			out.push(place(ent.def, x, y, z, yaw));
			for (const top of on) {
				out.push(place(top, x, y + (PROP_TOP[ent.def] ?? 0), z, yaw));
			}
		}
	}
	return out;
}

/** Whether a wall stands on one of the cell's four sides. */
function wallBeside(chunk:Chunk, lx:number, lz:number):boolean {
	return ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).some(([dx, dz]) => !!chunk.tile(lx + dx, lz + dz)?.blocked);
}

function glyphYaw(chunk:Chunk, lx:number, lz:number):number {
	for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
		if (chunk.tile(lx + dx, lz + dz)?.blocked) {
			return yawToward(dx, dz);
		}
	}
	const n = Math.sin(chunk.origin.cx * 913.1 + chunk.origin.cz * 271.3 + lx * 127.1 + lz * 311.7) * 43758.5453;
	return (n - Math.floor(n)) * Math.PI * 2;
}

/**
 * Wall-mounted props: march out from `p` along the four grid directions to the nearest wall,
 * put the props' backs (half `depth` behind their origin) flat against it, and face them away.
 * `heights` lifts each prop (e.g. jars onto the shelf). Nothing within a meter and a half: none placed.
 */
function onWall(chunks:Chunk[], props:PropID[], p:{ x:number; z:number }, depth:number, heights:number[] = []):DressingProp[] {
	const step = 0.05;
	let best:{ x:number; z:number; yaw:number; d:number } | undefined;
	for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
		for (let d = 0; d <= 1.5; d += step) {
			const x = p.x + dx * d;
			const z = p.z + dz * d;
			const chunk = chunkAt(chunks, x, z);
			if (chunk && solidAt(chunk, x, z)) {
				if (!best || d < best.d) {
					// The wall face sits where the march entered the blocked tile.
					const face = d - step * 0.5;
					best = { x: p.x + dx * (face - depth * 0.5), z: p.z + dz * (face - depth * 0.5), yaw: yawToward(dx, dz), d };
				}
				break;
			}
		}
	}
	return best ? props.map((prop, i) => place(prop, best.x, heights[i] ?? 0, best.z, best.yaw)) : [];
}

/** Lawn under a circle of `radius`, off the path, and at least a meter from water. */
function openGround(chunks:Chunk[], road:{ x:number; z:number }[], x:number, z:number, radius:number):boolean {
	const onRoad = (px:number, pz:number):boolean => road.some((c) => Math.abs(c.x - px) < 0.5 + radius && Math.abs(c.z - pz) < 0.5 + radius);
	if (onRoad(x, z)) {
		return false;
	}
	for (let i = 0; i <= 8; i++) {
		const a = (i / 8) * Math.PI * 2;
		for (const [r, want] of [[i === 8 ? 0 : radius, 'grass'], [radius + 1, 'dry']] as const) {
			const px = x + (i === 8 ? 0 : Math.cos(a) * r);
			const pz = z + (i === 8 ? 0 : Math.sin(a) * r);
			const tile = chunkAt(chunks, px, pz)?.tileAtWorld(px, pz);
			if (want === 'grass' && (!tile || tile.blocked || tile.def !== 'grass')) {
				return false;
			}
			if (want === 'dry' && tile && showsWater(tile.def)) {
				return false;
			}
		}
	}
	return true;
}

let clearedKey = '';
let clearedCells = new Set<string>();

function cellKey(x:number, z:number):string {
	return `${Math.floor(x)},${Math.floor(z)}`;
}

/** Grass cards stay off the path and off the ground a prop is standing on. */
export function grassCleared(chunks:Iterable<Chunk>, x:number, z:number):boolean {
	const list = [...chunks];
	const key = list.map((chunk) => chunk.id).join(',');
	if (key !== clearedKey) {
		clearedKey = key;
		clearedCells = new Set();
		for (const cell of allRoadCells(list)) {
			clearedCells.add(cellKey(cell.x, cell.z));
		}
		for (const spot of planProps(list)) {
			for (let dz = -1; dz <= 1; dz++) {
				for (let dx = -1; dx <= 1; dx++) {
					const cx = spot.x + dx;
					const cz = spot.z + dz;
					if (Math.hypot(cx - spot.x, cz - spot.z) < 1.05) {
						clearedCells.add(cellKey(cx, cz));
					}
				}
			}
		}
	}
	return clearedCells.has(cellKey(x, z));
}

