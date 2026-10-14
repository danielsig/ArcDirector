import { yawToward } from '@arc-director/kindling';
import { CELL_SIZE, CHUNK_SIZE, TILE_HEIGHT } from './constants';
import type { Chunk } from './Chunk';
import { showsWater } from './water';

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
	'chest',
	'pots',
	'urn',
	'basket',
	'drums',
	'fallenColumn',
	'rubble',
	'bones',
	'brazier',
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
	'Drums',
	'FallenColumn',
	'Rubble',
	'Bones',
	'Brazier',
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
	chest: { w: 0.52, d: 0.34 },
	pots: { w: 0.7, d: 0.6 },
	urn: { w: 0.4, d: 0.4, round: true },
	basket: { w: 0.44, d: 0.44, round: true },
	drums: { w: 0.9, d: 0.6 },
	fallenColumn: { w: 2.9, d: 0.6 },
	rubble: { w: 0.8, d: 0.7 },
	bones: null,
	brazier: { w: 0.56, d: 0.56, round: true },
};

export type DressingProp = {
	prop:PropID;
	x:number;
	y:number;
	z:number;
	yaw:number;
};

export type DoorAnchor = {
	x:number;
	z:number;
	dx:number;
	dz:number;
};

function chunkAt(chunks:Chunk[], x:number, z:number):Chunk | undefined {
	for (const chunk of chunks) {
		if (chunk.tileAtWorld(x, z)) {
			return chunk;
		}
	}
	return undefined;
}

function insideTile(def:string | undefined):boolean {
	return def === 'plank' || def === 'wood_wall';
}

/** Wood building with a door. Outside is the grass side of that door. */
export function findDoor(chunks:Chunk[]):DoorAnchor | undefined {
	for (const chunk of chunks) {
		let wooden = false;
		chunk.forEachTile((tile) => {
			if (tile.def === 'wood_wall') {
				wooden = true;
			}
		});
		if (!wooden) {
			continue;
		}
		for (const ent of chunk.entities) {
			if (ent.def !== 'door') {
				continue;
			}
			const north = insideTile(chunk.tile(ent.localX, ent.localZ - 1)?.def);
			const south = insideTile(chunk.tile(ent.localX, ent.localZ + 1)?.def);
			const west = insideTile(chunk.tile(ent.localX - 1, ent.localZ)?.def);
			let dx = 0;
			let dz = 1;
			if (north || south || ent.axis === 'z') {
				dx = 0;
				dz = north ? 1 : -1;
			}
			else {
				dx = west ? 1 : -1;
				dz = 0;
			}
			const center = chunk.worldCellCenter(ent.localX, ent.localZ);
			return { x: center.x, z: center.z, dx, dz };
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
 * The road as straight centre lines: each road cell joins its road neighbours, the first cell runs on to its
 * door and any cell beside a bridge span on to the span, and every straight run is one line. Turns,
 * T-junctions, crossings and dead ends all follow from the lines; the edge of the cell is where a door or
 * span link stops.
 */
export function roadLines(chunks:Iterable<Chunk>):RoadLine[] {
	const list = [...chunks];
	const door = findDoor(list);
	const cells = door ? roadCells(list, door) : [];
	const key = (x:number, z:number):string => `${Math.round(x * 2)},${Math.round(z * 2)}`;
	const road = new Set(cells.map((c) => key(c.x, c.z)));
	const spans = new Set(list.flatMap((chunk) => chunk.entities
		.filter((e) => e.def === 'bridge_span')
		.map((e) => chunk.worldCellCenter(e.localX, e.localZ))
		.map((c) => key(c.x, c.z))));
	/** How far the road runs from cell `c` toward `d`: a whole cell to another road cell, half to a door or span, else none. */
	const reach = (c:Cell, [dx, dz]:readonly [number, number]):number => {
		const x = c.x + dx * CELL_SIZE;
		const z = c.z + dz * CELL_SIZE;
		if (road.has(key(x, z))) {
			return CELL_SIZE;
		}
		const toDoor = door && c === cells[0] && dx === -door.dx && dz === -door.dz;
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
				end = cells.find((o) => key(o.x, o.z) === key(end.x + u[0] * CELL_SIZE, end.z + u[1] * CELL_SIZE))!;
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

function place(prop:PropID, x:number, y:number, z:number, yaw = 0):DressingProp {
	return { prop, x, y, z, yaw };
}

/**
 * Every dressing prop over these chunks: the cottage clusters, the goods around each market stall, and the
 * props a chunk map places itself with a prop glyph.
 */
export function planProps(chunks:Iterable<Chunk>):DressingProp[] {
	const list = [...chunks];
	return [...cottageProps(list), ...stallProps(list), ...glyphProps(list)];
}

/**
 * One cluster at the cottage door, one in the room, one where the path meets the water.
 * Offsets are meters from the door, in the door's outside frame (forward, right).
 */
function cottageProps(list:Chunk[]):DressingProp[] {
	const door = findDoor(list);
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
		place('table', at(-2.15, -0.35).x, 0, at(-2.15, -0.35).z),
		place('chair', at(-2.15, -0.95).x, 0, at(-2.15, -0.95).z, Math.atan2(rightX, rightZ)),
		place('lantern', at(-2.35, -0.15).x, 0.64, at(-2.35, -0.15).z),
		...onWall(list, ['shelf', 'jars'], at(-3.15, 0.7), 0.2, [0, 1.32]),
		place('bed', at(-2.3, 1.7).x, 0, at(-2.3, 1.7).z),
		place('chest', at(-1.15, 1.75).x, 0, at(-1.15, 1.75).z, 0.4),
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

/** A stall faces the middle of its chunk: stalls in the north half turn round to face south. */
export function stallYaw(localZ:number):number {
	return localZ < CHUNK_SIZE / 2 ? Math.PI : 0;
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
	SpiceStall: [
		{ prop: 'sacks', right: -1.35, forward: 0, yaw: -0.4 },
		{ prop: 'crate', right: 1.3, forward: 0 },
		{ prop: 'jars', right: 1.3, forward: 0, y: 0.42 },
	],
	CandleStall: [
		{ prop: 'crate', right: 1.3, forward: 0, yaw: 0.25 },
		{ prop: 'lantern', right: 1.3, forward: 0, y: 0.42 },
		{ prop: 'barrel', right: -1.25, forward: -0.1 },
	],
	FruitStall: [
		{ prop: 'basket', right: -1.25, forward: 0.25 },
		{ prop: 'crate', right: -1.3, forward: -0.45, yaw: 0.3 },
		{ prop: 'basket', right: 1.3, forward: -0.05 },
	],
	RibbonStall: [
		{ prop: 'basket', right: 1.25, forward: 0.1 },
		{ prop: 'barrel', right: -1.3, forward: -0.1 },
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
 * Props a chunk map places with a glyph whose entity `def` is a prop id. A legend `yaw` turns it; without
 * one it faces away from a wall it stands against, else turns by a hash of its cell.
 */
function glyphProps(list:Chunk[]):DressingProp[] {
	const out:DressingProp[] = [];
	for (const chunk of list) {
		for (const ent of chunk.entities) {
			if (!isPropID(ent.def)) {
				continue;
			}
			const center = chunk.worldCellCenter(ent.localX, ent.localZ);
			const height = chunk.tile(ent.localX, ent.localZ)?.height ?? 0;
			out.push(place(ent.def, center.x, height * TILE_HEIGHT, center.z, ent.yaw ?? glyphYaw(chunk, ent.localX, ent.localZ)));
		}
	}
	return out;
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
			const tile = chunkAt(chunks, p.x + dx * d, p.z + dz * d)?.tileAtWorld(p.x + dx * d, p.z + dz * d);
			if (tile?.blocked) {
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
		const door = findDoor(list);
		if (door) {
			for (const cell of roadCells(list, door)) {
				clearedCells.add(cellKey(cell.x, cell.z));
			}
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

