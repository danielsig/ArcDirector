import { NEIGHBORS4, yawToward, type XZ } from '@arc-director/kindling';
import { CELL_SIZE, CHUNK_SIZE, TILE_HEIGHT } from '../../world/constants';
import type { DemoChunk } from '../../world/demo-chunk';
import type { GlyphTerrain, ScenePlan } from '../../world/GlyphTerrain';
import { findBuildings } from '../houses/buildings';
import { allRoadCells, lawnAt, roadCells } from '../houses/roads';
import { solidAt, straightRun, WALL_THICKNESS } from '../walls/thin-wall';
import { TERRAIN } from '../../world/terrain-kinds';

/**
 * Where scene dressing goes: the props around a wooden house and the lawn kept clear of them and of the roads
 * (`roads.ts`). Pure planning, no rendering: the chunk meshes draw it and `dressing-colliders.ts` makes the big
 * pieces solid, from the same plan.
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
	'bookshelf',
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
	'leanTo',
	'bedroll',
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
	'LeanTo',
	'Bedroll',
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
	bookshelf: null,
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
	// Too low to stand under: a bedroll under it is got into from its open front.
	leanTo: { w: 1.95, d: 1.2 },
	bedroll: null,
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

/** Height of a table's top: tall enough for the thighs and knees of whoever sits at it, robes included. */
export const TABLE_TOP = 0.84;

/** Height of the top of props other props can rest on (`on` in a map legend). */
export const PROP_TOP:Partial<Record<PropID, number>> = {
	chair: 0.47,
	table: TABLE_TOP,
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
	/** What the map calls it, if anything. */
	name?:string;
	/** Something else stands on it, so it is no use to sit on. */
	topped?:boolean;
};

function place(prop:PropID, x:number, y:number, z:number, yaw = 0):DressingProp {
	return { prop, x, y, z, yaw };
}

/**
 * Every dressing prop over these chunks: the cottage clusters, the goods around each marketplace stall, and the
 * props a chunk map places itself with a prop glyph.
 */
export function planProps(terrain:GlyphTerrain):DressingProp[] {
	return [...cottageProps(terrain), ...stallProps(terrain), ...glyphProps(terrain), ...windowProps(terrain)];
}

/**
 * The farmyard of the first house on the map whose door opens onto lawn (shops on a paved square, and smaller
 * houses, furnish themselves with prop glyphs): one cluster at its door, one in the room, one where the path meets
 * the water. Offsets are meters from the door, in the door's outside frame (forward, right).
 */
function cottageProps(terrain:GlyphTerrain):DressingProp[] {
	const door = findBuildings(terrain.chunks).map((b) => b.out).find((out) => lawnAt(terrain, out.x + out.dx * CELL_SIZE, out.z + out.dz * CELL_SIZE));
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
		...onWall(terrain, ['broom'], at(0.75, 1.45), BROOM_REACH * 2),
		place('bucket', at(1.1, 1.7).x, 0, at(1.1, 1.7).z),
		place('barrel', at(0.8, 2.35).x, 0, at(0.8, 2.35).z),
	];
	const room = [
		// Long side to the chair.
		place('table', at(-2.15, -0.32).x, 0, at(-2.15, -0.32).z, Math.PI / 2),
		place('chair', at(-2.15, -0.95).x, 0, at(-2.15, -0.95).z, Math.atan2(rightX, rightZ)),
		place('lantern', at(-2.35, -0.12).x, TABLE_TOP, at(-2.35, -0.12).z),
		...onWall(terrain, ['bookshelf'], at(-3.15, 0.7), 0.2, [0]),
		// Head to the wall: a bed's origin is its middle, so its back is half its length behind it.
		...onWall(terrain, ['bed'], at(-2.3, 1.7), PROP_FOOTPRINT.bed!.d),
		// In the far corner, leaving room to stand on either side of the bed.
		place('trunk', at(-3.2, -1.1).x, 0, at(-3.2, -1.1).z),
		...onWall(terrain, ['broom'], at(-1.05, -1.15), BROOM_REACH * 2),
	];
	const road = roadCells(terrain, door);
	const along = Math.atan2(door.dx, door.dz);
	const across = Math.atan2(rightX, rightZ);
	const spot = (prop:PropID, forward:number, right:number, yaw:number, radius:number):DressingProp | null => {
		const p = at(forward, right);
		return openGround(terrain, road, p.x, p.z, radius) ? place(prop, p.x, 0, p.z, yaw) : null;
	};
	// Halfway down the path: a work yard on one side, the well on the other. Woodpile against the house.
	const roadside = [
		spot('wheelbarrow', 4.6, 2.4, along, 0.8),
		spot('crate', 5.6, 3.3, along + 0.3, 0.35),
		spot('sacks', 4.1, 3.5, 0, 0.4),
		...onWall(terrain, ['woodpile'], at(-1.6, 3.6), 0.45),
		spot('weaponRack', 4.6, -1.8, across, 0.5),
		// Near the house, not the river: you dig a well where you live.
		spot('well', 3.2, -3.4, 0, 0.75),
	].filter((p):p is DressingProp => p !== null);
	return [...yard, ...room, ...roadside];
}

/** Curtains on the inside of every window: the side whose floor is a room's boards. */
function windowProps(terrain:GlyphTerrain):DressingProp[] {
	const out:DressingProp[] = [];
	for (const chunk of terrain.chunks) {
		chunk.forEachTile((tile, lx, lz) => {
			const run = tile.def === 'window' ? straightRun(terrain, chunk.tileCoord(lx, lz)) : undefined;
			if (!run) {
				return;
			}
			const [ax, az] = run === 'x' ? [0, 1] : [1, 0];
			const inward = [1, -1].find((s) => terrain.tileAt(chunk.tileCoord(lx + ax * s, lz + az * s))?.def === 'plank');
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
export type BesideProp = { prop:PropID; right:number; forward:number; yaw?:number };

function stallProps(terrain:GlyphTerrain):DressingProp[] {
	const out:DressingProp[] = [];
	for (const chunk of terrain.chunks) {
		for (const ent of chunk.entities) {
			if (!ent.beside) {
				continue;
			}
			const center = chunk.worldCellCenter(ent.localX, ent.localZ);
			const yaw = stallYaw(ent.localZ);
			const cos = Math.cos(yaw);
			const sin = Math.sin(yaw);
			for (const spot of ent.beside) {
				// The stall's own frame turned by its yaw, as Three.js turns the mesh.
				const x = center.x + spot.right * cos + spot.forward * sin;
				const z = center.z - spot.right * sin + spot.forward * cos;
				out.push(place(spot.prop, x, 0, z, yaw + (spot.yaw ?? 0)));
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
function glyphProps(terrain:GlyphTerrain):DressingProp[] {
	const out:DressingProp[] = [];
	for (const chunk of terrain.chunks) {
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
				const [own, ...tops] = onWall(terrain, [def, ...on], { x, z }, depth, [y, ...on.map(() => y + (PROP_TOP[def] ?? 0))]);
				out.push({ ...own!, name: ent.name, topped: on.length > 0 }, ...tops);
				continue;
			}
			const yaw = ent.yaw ?? glyphYaw(chunk, ent.localX, ent.localZ);
			out.push({ ...place(ent.def, x, y, z, yaw), name: ent.name, topped: on.length > 0 });
			for (const top of on) {
				out.push(place(top, x, y + (PROP_TOP[ent.def] ?? 0), z, yaw));
			}
		}
	}
	return out;
}

/** Whether a wall stands on one of the cell's four sides. */
function wallBeside(chunk:DemoChunk, lx:number, lz:number):boolean {
	return NEIGHBORS4.some(([dx, dz]) => !!chunk.tile(lx + dx, lz + dz)?.blocked);
}

function glyphYaw(chunk:DemoChunk, lx:number, lz:number):number {
	for (const [dx, dz] of NEIGHBORS4) {
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
function onWall(terrain:GlyphTerrain, props:PropID[], p:XZ, depth:number, heights:number[] = []):DressingProp[] {
	const step = 0.05;
	let best:{ x:number; z:number; yaw:number; d:number } | undefined;
	for (const [dx, dz] of NEIGHBORS4) {
		for (let d = 0; d <= 1.5; d += step) {
			const x = p.x + dx * d;
			const z = p.z + dz * d;
			if (solidAt(terrain, x, z)) {
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
function openGround(terrain:GlyphTerrain, road:XZ[], x:number, z:number, radius:number):boolean {
	const onRoad = (px:number, pz:number):boolean => road.some((c) => Math.abs(c.x - px) < 0.5 + radius && Math.abs(c.z - pz) < 0.5 + radius);
	if (onRoad(x, z)) {
		return false;
	}
	for (let i = 0; i <= 8; i++) {
		const a = (i / 8) * Math.PI * 2;
		for (const [r, want] of [[i === 8 ? 0 : radius, 'grass'], [radius + 1, 'dry']] as const) {
			const px = x + (i === 8 ? 0 : Math.cos(a) * r);
			const pz = z + (i === 8 ? 0 : Math.sin(a) * r);
			const tile = terrain.tileAtWorld(px, pz);
			if (want === 'grass' && (!tile || tile.blocked || tile.def !== 'grass')) {
				return false;
			}
			if (want === 'dry' && tile && TERRAIN[tile.def].water) {
				return false;
			}
		}
	}
	return true;
}

let clearedFor:ScenePlan | undefined;
let clearedCells = new Set<string>();

function cellKey(x:number, z:number):string {
	return `${Math.floor(x)},${Math.floor(z)}`;
}

/** Grass cards stay off the path and off the ground a prop is standing on. */
export function grassCleared(terrain:GlyphTerrain, x:number, z:number):boolean {
	if (terrain.plan !== clearedFor) {
		clearedFor = terrain.plan;
		clearedCells = new Set();
		for (const cell of allRoadCells(terrain)) {
			clearedCells.add(cellKey(cell.x, cell.z));
		}
		for (const spot of terrain.plan.props) {
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

