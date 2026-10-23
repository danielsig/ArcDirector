import { hash } from '@arc-director/kindling';
import * as THREE from 'three';
import type { Chunk, Tile } from '../world/Chunk';
import { CELL_SIZE, TILE_HEIGHT, WALL_HEIGHT } from '../world/constants';
import { landOf, LANDFORMS, type Land, type LandRect, type Outskirts, type Rect } from '../world/land';
import { sandField, showsWater } from '../world/water';
import { bankUV, finishRock, finishYMesh, makeYBuf, pushGround, pushRockFace, pushWaterBox, type Point, type YBuf } from './groundMesh';
import { CLIFF_TILE, getNature, GRASS_Y, natureReady, pieceAt, SAND_TILE, SURFACE_ORDER, toonWaterMat, WATER_LOWER_Y, WATER_UPPER_Y } from './nature';
import { BOULDER_ACROSS } from './natureMeshes';
import { cliffMat, dirtMat, meadowMat, sandMat, stoneFloorMat, tileMat } from './toon';
import { farCrown, treeParts } from './trees';

/**
 * Landforms drawn from tiles (cliffs, rivers on clifftops, forest) and the outskirts past the map's edge, which
 * carry the edge tiles on to the horizon. Wherever two lands meet at different heights a cliff stands between
 * them (a row of `Cliff.glb` tiles sloping back into the high side), so a cliff is just high land beside low land.
 */

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** A river's bed, `height` tiles up. */
function bedY(height:number):number {
	return height * TILE_HEIGHT + WATER_LOWER_Y;
}

/** Where a tile's surface is: a meadow's grass, a river's bed, the top of a block. */
function surfaceY(tile:Tile):number {
	if (isWaterTile(tile)) {
		return bedY(tile.height);
	}
	if (tile.blocked && !LANDFORMS.has(tile.def)) {
		return WALL_HEIGHT;
	}
	return tile.height * TILE_HEIGHT + GRASS_Y;
}

/** Where the outskirts meet an edge tile: a stone floor at its own top, grass on the grass line. */
function edgeTop(tile:Tile):number {
	if ((tile.blocked && !LANDFORMS.has(tile.def)) || showsWater(tile.def) || tile.def === 'cliff_water') {
		return surfaceY(tile);
	}
	if (tile.def === 'plank') {
		return tile.height * TILE_HEIGHT + 0.03;
	}
	if (tile.def === 'bridge') {
		return 0.04;
	}
	if (tile.def === 'grass' || LANDFORMS.has(tile.def)) {
		return tile.height * TILE_HEIGHT + GRASS_Y;
	}
	return tile.height * TILE_HEIGHT + 0.002;
}

function isWaterTile(tile:Tile):boolean {
	return tile.def === 'cliff_water' || showsWater(tile.def);
}

/** Whether the chunk draws `tile` as a block, faces and all (a stone wall). */
function isBlock(tile:Tile):boolean {
	return tile.blocked && !LANDFORMS.has(tile.def) && !showsWater(tile.def);
}

function landY(land:Land):number {
	return land.surface === 'water' ? bedY(land.height) : land.height * TILE_HEIGHT + (land.deck ?? GRASS_Y);
}

function quad(r:Rect):Point[] {
	return [{ x: r.minX, z: r.minZ }, { x: r.maxX, z: r.minZ }, { x: r.maxX, z: r.maxZ }, { x: r.minX, z: r.maxZ }];
}

type Draws = {
	meadow:YBuf;
	/** Riverbank sand on the land beside a river. */
	sand:YBuf;
	/** Where that sand lies: strips along the land's edge, left out of its ground. */
	banks:Rect[];
	trail:YBuf;
	floor:YBuf;
	lower:YBuf;
	upper:YBuf;
	rockPos:number[];
	rockUV:number[];
	rockIdx:number[];
	/** Cliff tiles, posed: centre, turn, and scale of the 1 m tile. */
	cliffs:{ x:number; y:number; z:number; yaw:number; pitch:number; sx:number; sy:number; sz:number }[];
	boulders:{ x:number; z:number; s:number; yaw:number }[];
	/** Trees: whole ones (`trunk`), crowns only, or crowns at low detail (`far`), at a scale. */
	trees:{ x:number; y:number; z:number; s:number; yaw:number; variant:number; trunk:boolean; far?:boolean }[];
	shadePos:number[];
	shadeColor:number[];
	shadeIdx:number[];
};

function makeDraws():Draws {
	return { meadow: makeYBuf(), sand: makeYBuf(), banks: [], trail: makeYBuf(), floor: makeYBuf(), lower: makeYBuf(), upper: makeYBuf(), rockPos: [], rockUV: [], rockIdx: [], cliffs: [], boulders: [], trees: [], shadePos: [], shadeColor: [], shadeIdx: [] };
}

/**
 * A cliff tile as modelled: its width along the wall and where its foot is (local Z). It slopes back from that foot;
 * tipped forward on it by `pitch` it stands upright, `up` tall (at scale 1), its rock bulging out past the foot.
 */
const CLIFF_TILE_SIZE = { across: 0.59, foot: 0.47, pitch: 0.775, up: 1.385 };
/** How far a cliff tile's foot sinks into the ground below, so no sliver of sky shows under it. */
const CLIFF_SINK = 0.05;
/** How much neighbouring cliff tiles overlap, so their edges hide each other. */
const CLIFF_OVERLAP = 1.03;
/** Cliffs lower than this are a flat rock step, not cliff tiles (which would lie nearly flat). */
const CLIFF_MIN = 0.6;
/** Bands a riverbank's slope is drawn in. */
const BANK_STEPS = 8;

/**
 * How far riverbank sand down in the glen has fallen toward the riverbed (0 level, 1 at the bed), by its `sandField`
 * (0 at the lawn, about 0.45 at the water on a straight bank): level and walkable to 0.11, then sloping down to meet
 * the riverbed at 0.45.
 */
export function bankFall(sand:number):number {
	return THREE.MathUtils.smoothstep(sand, 0.11, BANK_BED);
}

/** The `sandField` where riverbank sand down in the glen meets the riverbed: past it the bank is under the river. */
export const BANK_BED = 0.45;

/** How wet riverbank sand down in the glen is (0 the dry top, 1 at the water), by its `sandField`. */
export function bankWet(sand:number):number {
	return sand / BANK_BED;
}

/**
 * A riverbank's sand across its edge: where its bands break, in meters into the river from the edge (below 0 over the
 * land, from where the sand starts), how far it has fallen toward the riverbed at each (0 level, 1 the bed), and how
 * wet it is (0 the dry top, 1 at the water: the sand picture's top to bottom).
 */
type Bank = { breaks:number[]; fall:(s:number)=>number; wet:(s:number)=>number };

/** The breaks of a slope from `a` to `b` meters into the river. */
function slope(a:number, b:number):number[] {
	return Array.from({ length: BANK_STEPS + 1 }, (_, k) => a + (k / BANK_STEPS) * (b - a));
}

/**
 * Down in the glen, as the map's lawn draws it beside a long straight river (water where z > 0): half a cell of sand,
 * level, then sloping down to the bed at the river's cells.
 */
const straightSand = (s:number):number => sandField((_x, z) => (z > 0 ? 'water' : undefined), 0, s);
const GLEN_BANK:Bank = {
	breaks: [-0.5, ...slope(-0.3, 0)],
	fall: (s) => bankFall(straightSand(s)),
	wet: (s) => bankWet(straightSand(s)),
};

/**
 * Up on a clifftop: level over the grass 30 cm out from the river's cells, then sloping down to under its bed 20 cm in.
 * The water's edge, where the slope dips under it, comes out about 15 cm in from the cells' edge, so the river is as
 * wide as the waterfall it feeds.
 */
const CLIFFTOP_BANK:Bank = {
	breaks: [-0.3, ...slope(0, 0.2)],
	fall: (s) => THREE.MathUtils.smoothstep(s, 0, 0.2),
	wet: (s) => (s + 0.3) / 0.5,
};

/** A point on a cliff tile's end, tipped upright at scale 1: how high above its foot, and how far out past its foot line. */
type RimPoint = { up:number; out:number };

const capOutlines = new Map<number, { edge:number; rim:RimPoint[] }>();

/**
 * A cliff tile's `side` end (-1 or 1, its model X), at scale 1, once tipped upright: where the end is (`edge`, model X)
 * and the open edge of its rock there, foot to top (`rim`): every model vertex on that end. The end is flat and its
 * edge climbs all the way, so they are all on the edge, in order of height.
 */
function capOutline(side:number):{ edge:number; rim:RimPoint[] } {
	const hit = capOutlines.get(side);
	if (hit) {
		return hit;
	}
	const pos = getNature().cliffTile.geom.getAttribute('position');
	let edge = 0;
	for (let i = 0; i < pos.count; i++) {
		edge = Math.max(edge, pos.getX(i) * side);
	}
	const { pitch, foot } = CLIFF_TILE_SIZE;
	// One point per place: the model splits a vertex where its picture has a seam.
	const rim = new Map<string, RimPoint>();
	for (let i = 0; i < pos.count; i++) {
		if (pos.getX(i) * side < edge - 1e-4) {
			continue;
		}
		const y = pos.getY(i);
		const z = pos.getZ(i) - foot;
		rim.set(`${y.toFixed(4)},${z.toFixed(4)}`, { up: y * Math.cos(pitch) - z * Math.sin(pitch), out: y * Math.sin(pitch) + z * Math.cos(pitch) });
	}
	const outline = { edge, rim: [...rim.values()].sort((a, b) => a.up - b.up) };
	capOutlines.set(side, outline);
	return outline;
}

/**
 * The end of a row of cliff tiles at `at` (where the tile's end reaches, on the cliff's edge): a sheet of rock in
 * that upright plane, from the edge out along `out` to the tile's own end edge (`capOutline` of its `side`), through
 * its every vertex, so the tile's end shows rock, never sky.
 */
function pushRockCap(d:Draws, at:Point, out:Point, y0:number, scale:number, side:number):void {
	const first = d.rockPos.length / 3;
	capOutline(side).rim.forEach((p, k) => {
		const y = y0 - CLIFF_SINK + p.up * scale;
		const r = p.out * scale;
		d.rockPos.push(at.x, y, at.z, at.x + out.x * r, y, at.z + out.z * r);
		// The picture in meters: out from the edge, up from the foot.
		d.rockUV.push(0, (y - y0) / CLIFF_TILE.up, r / CLIFF_TILE.across, (y - y0) / CLIFF_TILE.up);
		if (k > 0) {
			const a = first + (k - 1) * 2;
			d.rockIdx.push(a, a + 1, a + 3, a, a + 3, a + 2);
		}
	});
}

/** The box around `points`. */
function boxOf(points:Point[]):Rect {
	const xs = points.map((c) => c.x);
	const zs = points.map((c) => c.z);
	return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

/** `r` without `cut`, where `cut` is a strip along the whole of one of its sides (a riverbank's sand); else `r`. */
function trim<R extends Rect>(r:R, cut:Rect):R {
	if (cut.minZ <= r.minZ && cut.maxZ >= r.maxZ) {
		if (cut.minX === r.minX) {
			return { ...r, minX: cut.maxX };
		}
		if (cut.maxX === r.maxX) {
			return { ...r, maxX: cut.minX };
		}
	}
	if (cut.minX <= r.minX && cut.maxX >= r.maxX) {
		if (cut.minZ === r.minZ) {
			return { ...r, minZ: cut.maxZ };
		}
		if (cut.maxZ === r.maxZ) {
			return { ...r, maxZ: cut.minZ };
		}
	}
	return r;
}

/**
 * A riverbank on the edge `p`–`q` (`into` toward the land, at `y1`; the river's bed at `y0`), shaped as `bank`: sand
 * from the land's edge sloping down to under the river's bed, and rock closing the slope's ends (seen where the bank
 * meets a waterfall's lip). The land leaves its sand out of its ground (`banks`).
 */
function pushSandBank(d:Draws, p:Point, q:Point, into:Point, y0:number, y1:number, bank:Bank):void {
	const foot = y0 - 0.01;
	/** The bank's height `s` meters into the river from the edge (out over the land where below 0). */
	const heightAt = (s:number):number => y1 - (y1 - foot) * bank.fall(s);
	const across = (v:Point):number => -((v.x - p.x) * into.x + (v.z - p.z) * into.z);
	const at = (v:Point, s:number):Point => ({ x: v.x - into.x * s, z: v.z - into.z * s });
	const { breaks } = bank;
	const from = d.sand.v;
	for (let k = 1; k < breaks.length; k++) {
		const band = boxOf([at(p, breaks[k - 1]!), at(q, breaks[k - 1]!), at(p, breaks[k]!), at(q, breaks[k]!)]);
		pushGround(d.sand, quad(band), (x, z) => heightAt(across({ x, z })));
	}
	bankUV(d.sand, from, SAND_TILE, (x, z) => bank.wet(across({ x, z })), () => into.z !== 0);
	d.banks.push(boxOf([p, q, at(p, breaks[0]!), at(q, breaks[0]!)]));
	for (const end of [p, q]) {
		const first = d.rockPos.length / 3;
		breaks.slice(1).forEach((s, k) => {
			const c = at(end, s);
			const top = heightAt(s);
			d.rockPos.push(c.x, foot, c.z, c.x, top, c.z);
			d.rockUV.push(s / CLIFF_TILE.across, 0, s / CLIFF_TILE.across, (top - foot) / CLIFF_TILE.up);
			if (k > 0) {
				const a = first + (k - 1) * 2;
				d.rockIdx.push(a, a + 1, a + 3, a, a + 3, a + 2);
			}
		});
	}
}

/** One side of a cliff edge: its box, its surface height, and whether it is water (a river cut into its top). */
type FaceSide = { r:Rect; y:number; water:boolean };

/**
 * The cliff on the shared edge of two touching boxes, from the lower surface up to the higher: a row of cliff tiles
 * standing on the edge, each as tall as the cliff and tipped upright, its rock bulging out over the low side.
 * Under a river (the lip of a waterfall) it is a flat rock face; land a low step over a river is its sand bank.
 */
function faceBetween(d:Draws, a:FaceSide, b:FaceSide):void {
	if (Math.abs(a.y - b.y) < 0.01) {
		return;
	}
	const [lo, hi] = a.y < b.y ? [a, b] : [b, a];
	const y0 = lo.y;
	const y1 = hi.y;
	let line:[Point, Point];
	let into:Point;
	if (lo.r.maxX === hi.r.minX || lo.r.minX === hi.r.maxX) {
		const z0 = Math.max(lo.r.minZ, hi.r.minZ);
		const z1 = Math.min(lo.r.maxZ, hi.r.maxZ);
		if (z1 - z0 <= 1e-6) {
			return;
		}
		const x = lo.r.maxX === hi.r.minX ? lo.r.maxX : lo.r.minX;
		line = [{ x, z: z0 }, { x, z: z1 }];
		into = { x: Math.sign(hi.r.minX - lo.r.minX), z: 0 };
	}
	else if (lo.r.maxZ === hi.r.minZ || lo.r.minZ === hi.r.maxZ) {
		const x0 = Math.max(lo.r.minX, hi.r.minX);
		const x1 = Math.min(lo.r.maxX, hi.r.maxX);
		if (x1 - x0 <= 1e-6) {
			return;
		}
		const z = lo.r.maxZ === hi.r.minZ ? lo.r.maxZ : lo.r.minZ;
		line = [{ x: x0, z }, { x: x1, z }];
		into = { x: 0, z: Math.sign(hi.r.minZ - lo.r.minZ) };
	}
	else {
		return;
	}
	const [p, q] = line;
	// Land a low step over a river: its bank. Up on a clifftop the river narrows to the waterfall it feeds.
	if (lo.water && !hi.water && y1 - y0 < CLIFF_MIN) {
		pushSandBank(d, p, q, into, y0, y1, lo.y > 0 ? CLIFFTOP_BANK : GLEN_BANK);
		return;
	}
	// Under a river (a waterfall's lip) and on another low step: flat rock, cut nothing back.
	if (hi.water || y1 - y0 < CLIFF_MIN) {
		pushRockFace(d.rockPos, d.rockUV, d.rockIdx, p, q, y0, y1, into);
		return;
	}
	// One tile from the foot to the top, tipped upright on its foot, as wide as that makes it. Foot and lip stand on
	// the edge, so the high ground runs right up to it; the rock bulges out over the low ground.
	const scale = (y1 - y0 + CLIFF_SINK) / CLIFF_TILE_SIZE.up;
	const len = Math.hypot(q.x - p.x, q.z - p.z);
	const across = Math.max(1, Math.round(len / (CLIFF_TILE_SIZE.across * scale)));
	// Turn the tile's foot (+Z) away from the high side.
	const yaw = Math.atan2(-into.x, -into.z);
	// Close both ends of the row, each with the outline of the tile end it meets (the model's X, turned by `yaw`).
	if (natureReady()) {
		const out = { x: -into.x, z: -into.z };
		const sx = (len / across / CLIFF_TILE_SIZE.across) * CLIFF_OVERLAP;
		for (const [end, other] of [[p, q], [q, p]] as const) {
			const side = Math.sign((end.x - other.x) * Math.cos(yaw) - (end.z - other.z) * Math.sin(yaw)) || 1;
			// The end tile's centre, then out along the row to where its end reaches.
			const toEnd = { x: (end.x - other.x) / len, z: (end.z - other.z) / len };
			const reach = len / across / 2 - capOutline(side).edge * sx;
			pushRockCap(d, { x: end.x - toEnd.x * reach, z: end.z - toEnd.z * reach }, out, y0, scale, side);
		}
	}
	// The model's origin, from its foot, once tipped: up and in.
	const up = CLIFF_TILE_SIZE.foot * scale * Math.sin(CLIFF_TILE_SIZE.pitch);
	const inward = CLIFF_TILE_SIZE.foot * scale * Math.cos(CLIFF_TILE_SIZE.pitch);
	for (let k = 0; k < across; k++) {
		const t = (k + 0.5) / across;
		d.cliffs.push({
			x: p.x + (q.x - p.x) * t + into.x * inward,
			y: y0 - CLIFF_SINK + up,
			z: p.z + (q.z - p.z) * t + into.z * inward,
			yaw,
			pitch: CLIFF_TILE_SIZE.pitch,
			sx: (len / across / CLIFF_TILE_SIZE.across) * CLIFF_OVERLAP,
			sy: scale,
			sz: scale,
		});
	}
}

/** How far trees beside a trail stand from its centre line: trunks just off the cobbles (half a meter wide each side). */
const TRAIL_TREE = 0.8;

/** Packed crowns over a forest box, far from the map sparser and bigger, so no ground shows between them. */
function scatterForest(d:Draws, r:LandRect, map:Rect, y:number, clear:Rect[]):void {
	const spacing = (dist:number):number => 1.7 + dist * 0.1;
	const beyond = (v:number, lo:number, hi:number):number => Math.max(lo - v, v - hi, 0);
	/** Centres across `lo`–`hi` from the end nearer the map: spaced by distance past `mapLo`–`mapHi`, or every `fixed` meters. */
	const steps = (lo:number, hi:number, mapLo:number, mapHi:number, fixed?:number):number[] => {
		const out:number[] = [];
		const dir = beyond(lo, mapLo, mapHi) <= beyond(hi, mapLo, mapHi) ? 1 : -1;
		for (let p = dir > 0 ? lo : hi; p >= lo && p <= hi;) {
			const s = fixed ?? spacing(beyond(p, mapLo, mapHi));
			out.push(p + (dir * s) / 2);
			p += dir * s;
		}
		return out.filter((v) => v >= lo && v <= hi);
	};
	// Rows run away from the map (along X off the east and west sides), each row spaced by its own distance.
	const xOut = r.out.x !== 0;
	const corner = r.out.x !== 0 && r.out.z !== 0;
	const [oLo, oHi, mLo, mHi] = xOut ? [r.minX, r.maxX, map.minX, map.maxX] : [r.minZ, r.maxZ, map.minZ, map.maxZ];
	const [aLo, aHi, amLo, amHi] = xOut ? [r.minZ, r.maxZ, map.minZ, map.maxZ] : [r.minX, r.maxX, map.minX, map.maxX];
	for (const o of steps(oLo, oHi, mLo, mHi)) {
		const od = beyond(o, mLo, mHi);
		for (const a of corner ? steps(aLo, aHi, amLo, amHi) : steps(aLo, aHi, aLo, aHi, spacing(od))) {
			const [x, z] = xOut ? [o, a] : [a, o];
			// Room for the trees lining a trail; past them, trees seen from the trail stand whole.
			const toTrail = Math.min(Infinity, ...clear.map((c) => Math.max(c.minX - x, x - c.maxX, c.minZ - z, z - c.maxZ)));
			if (toTrail < TRAIL_TREE + 0.2) {
				continue;
			}
			const s = spacing(Math.max(od, beyond(a, amLo, amHi)));
			const scale = (s / 1.7) * (0.95 + hash(x, z, 23) * 0.25);
			// The first rows are whole trees (their trunks show from the glade and the trails); past them crowns only,
			// sunk to the ground.
			const trunk = od < 2.5 || toTrail < 4;
			d.trees.push({
				x: x + (hash(x, z, 21) - 0.5) * s * 0.45,
				y: y + (trunk ? 0 : -0.95 * (scale - 1) - 0.35),
				z: z + (hash(x, z, 22) - 0.5) * s * 0.45,
				s: scale,
				yaw: hash(x, z, 24) * Math.PI * 2,
				variant: Math.floor(hash(x, z, 25) * 2),
				trunk,
				far: od > 8,
			});
		}
	}
}

/**
 * Whole trees lining a trail on both sides, trunks just off its edge and crowns meeting over it, so it runs on
 * into the woods as a dark tunnel.
 */
function archTrail(d:Draws, r:LandRect, y:number):void {
	const along = r.out.x !== 0 ? { x: r.out.x, z: 0 } : { x: 0, z: r.out.z };
	const across = { x: along.z, z: along.x };
	const length = Math.max(r.maxX - r.minX, r.maxZ - r.minZ);
	const mid = { x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 };
	const start = { x: mid.x - (along.x * length) / 2, z: mid.z - (along.z * length) / 2 };
	for (let t = 0.6; t < length; t += 1.3 + t * 0.03) {
		for (const s of [-1, 1]) {
			const x = start.x + along.x * t + across.x * s * TRAIL_TREE;
			const z = start.z + along.z * t + across.z * s * TRAIL_TREE;
			d.trees.push({ x, y, z, s: 0.95 + hash(x, z, 51) * 0.2, yaw: hash(x, z, 52) * Math.PI * 2, variant: Math.floor(hash(x, z, 53) * 2), trunk: true, far: t > 8 });
		}
	}
}

/**
 * Tops of `land` over `r`: grass, flagstones, a river, or forest floor under trees. After its faces: the ground stops
 * where a riverbank's sand starts (`banks`).
 */
function topOf(d:Draws, r:LandRect | (Rect & Land), land:(x:number, z:number)=>boolean, map?:Rect, trails:Rect[] = [], under?:(x:number, z:number)=>number):void {
	if (r.surface === 'water') {
		// Up on a clifftop the river stops short of the land beside it, where its bank stands (`faceBetween`).
		pushWaterBox(d.lower, d.upper, r, landY(r), r.height * TILE_HEIGHT + WATER_UPPER_Y, r.flow ?? { x: 0, z: 0 }, land);
		return;
	}
	if (r.surface === 'void') {
		return;
	}
	const y = landY(r);
	pushGround(r.surface === 'floor' ? d.floor : r.surface === 'trail' ? d.trail : d.meadow, quad(d.banks.reduce(trim, r)), y, under && ((x, z) => [under(x, z) ?? y]));
	if (r.surface === 'forest' && map && 'out' in r) {
		scatterForest(d, r, map, r.height * TILE_HEIGHT, trails);
	}
	if (r.surface === 'trail' && 'out' in r) {
		archTrail(d, r, r.height * TILE_HEIGHT);
	}
}

function addDraws(group:THREE.Group, d:Draws):void {
	if (d.meadow.v > 0) {
		group.add(finishYMesh(d.meadow, meadowMat(), true));
	}
	if (d.sand.v > 0 && natureReady()) {
		group.add(finishYMesh(d.sand, sandMat(), true));
	}
	if (d.trail.v > 0) {
		group.add(finishYMesh(d.trail, dirtMat(), true));
	}
	if (d.floor.v > 0) {
		group.add(finishYMesh(d.floor, stoneFloorMat(), true));
	}
	if (d.lower.v > 0 && natureReady()) {
		const nature = getNature();
		group.add(finishYMesh(d.lower, toonWaterMat(nature.water, 'lower'), true));
		const surface = finishYMesh(d.upper, toonWaterMat(nature.water, 'upper'), true);
		surface.renderOrder = SURFACE_ORDER;
		group.add(surface);
	}
	const rock = natureReady() ? finishRock(d.rockPos, d.rockUV, d.rockIdx, cliffMat(getNature().cliff)) : undefined;
	if (rock) {
		group.add(rock);
	}
	if (d.shadeIdx.length > 0) {
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.Float32BufferAttribute(d.shadePos, 3));
		geo.setAttribute('color', new THREE.Float32BufferAttribute(d.shadeColor, 4));
		geo.setIndex(d.shadeIdx);
		const shade = new THREE.Mesh(geo, shadeMat);
		shade.name = 'forestShade';
		group.add(shade);
	}
	const dummy = new THREE.Object3D();
	const instance = <T>(geom:THREE.BufferGeometry, mat:THREE.Material, items:T[], place:(item:T)=>void):void => {
		if (items.length === 0) {
			return;
		}
		const mesh = new THREE.InstancedMesh(geom, mat, items.length);
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		items.forEach((item, i) => {
			dummy.position.set(0, 0, 0);
			dummy.rotation.set(0, 0, 0);
			dummy.scale.set(1, 1, 1);
			place(item);
			dummy.updateMatrix();
			mesh.setMatrixAt(i, dummy.matrix);
		});
		mesh.computeBoundingSphere();
		group.add(mesh);
	};
	if (natureReady()) {
		const { cliffTile, boulders } = getNature();
		instance(cliffTile.geom, tileMat(cliffTile.map), d.cliffs, (c) => {
			dummy.position.set(c.x, c.y, c.z);
			// Tipped forward on its own X axis, then turned to face out.
			dummy.rotation.set(c.pitch, c.yaw, 0, 'YXZ');
			dummy.scale.set(c.sx, c.sy, c.sz);
		});
		for (const piece of boulders) {
			instance(piece.geom, tileMat(piece.map), d.boulders.filter((b) => pieceAt(boulders, b.x, b.z) === piece), (b) => {
				dummy.position.set(b.x, -0.05, b.z);
				dummy.rotation.y = b.yaw;
				dummy.scale.setScalar((b.s * BOULDER_ACROSS) / piece.across);
			});
		}
	}
	for (const variant of [0, 1]) {
		const [trunk, crown] = treeParts('oak', variant);
		const mine = d.trees.filter((t) => t.variant === variant);
		const place = (t:Draws['trees'][number]):void => {
			dummy.position.set(t.x, t.y, t.z);
			dummy.rotation.y = t.yaw;
			dummy.scale.setScalar(t.s);
		};
		const far = farCrown(variant);
		instance(trunk!.geom, trunk!.mat, mine.filter((t) => t.trunk), place);
		instance(crown!.geom, crown!.mat, mine.filter((t) => !t.far), place);
		instance(far.geom, far.mat, mine.filter((t) => t.far), place);
	}
}

/**
 * The chunk's landforms: clifftops (meadow or river), forest floor and its trees, and a rock face down to every
 * lower neighbour on the map (the outskirts face the ones past its edge). Boulders lie at the foot of tall faces.
 */
export function addLandforms(group:THREE.Group, chunk:Chunk, tileAtWorld:(x:number, z:number)=>Tile | undefined):void {
	const d = makeDraws();
	// Off the map is not land: past a river's edge tile the outskirts carry the river on.
	const isLand = (x:number, z:number):boolean => {
		const t = tileAtWorld(x, z);
		return !!t && !isWaterTile(t);
	};
	chunk.forEachTile((tile, lx, lz) => {
		if (!LANDFORMS.has(tile.def)) {
			return;
		}
		const c = chunk.worldCellCenter(lx, lz);
		const cell:Rect = { minX: c.x - CELL_SIZE / 2, maxX: c.x + CELL_SIZE / 2, minZ: c.z - CELL_SIZE / 2, maxZ: c.z + CELL_SIZE / 2 };
		const surface = landOf(tile, 'meadow').surface;
		const top = surfaceY(tile);
		for (const [dx, dz] of SIDES) {
			const n = tileAtWorld(c.x + dx * CELL_SIZE, c.z + dz * CELL_SIZE);
			if (!n || isBlock(n) || surfaceY(n) >= top) {
				continue;
			}
			const other:Rect = { minX: cell.minX + dx, maxX: cell.maxX + dx, minZ: cell.minZ + dz, maxZ: cell.maxZ + dz };
			faceBetween(d, { r: cell, y: top, water: surface === 'water' }, { r: other, y: surfaceY(n), water: isWaterTile(n) });
			if (top - surfaceY(n) > 1 && !showsWater(n.def) && hash(c.x + dx * 0.5, c.z + dz * 0.5, 31) > 0.45) {
				const along = hash(c.x, c.z, 32) - 0.5;
				d.boulders.push({
					x: c.x + dx * 0.55 + dz * along * 0.7,
					z: c.z + dz * 0.55 + dx * along * 0.7,
					s: 0.45 + hash(c.x, c.z, 33) * 0.4,
					yaw: hash(c.x, c.z, 34) * Math.PI * 2,
				});
			}
		}
		topOf(d, { ...cell, surface, height: tile.height, flow: tile.flow }, isLand);
		if (surface === 'forest' || surface === 'trail') {
			// Shade from the treeline: clear on the side open to the glade, a tile deep on the far side.
			const open = SIDES.filter(([dx, dz]) => {
				const n = tileAtWorld(c.x + dx, c.z + dz);
				return !!n && !n.blocked;
			});
			pushShade(d, [cell.minX, cell.maxX], [cell.minZ, cell.maxZ], top, (x, z) => (
				open.length === 0 ? CELL_SIZE : Math.min(...open.map(([dx, dz]) => (dx ? Math.abs(x - (c.x + dx * CELL_SIZE / 2)) : Math.abs(z - (c.z + dz * CELL_SIZE / 2)))))
			));
		}
		if (surface === 'forest') {
			// Two whole trees to a cell, crowns locked together; beside a trail only jittered along it, so they stay
			// a meter from its middle, just off the cobbles.
			const trail = SIDES.find(([dx, dz]) => tileAtWorld(c.x + dx, c.z + dz)?.def === 'trail');
			for (const k of [0, 1]) {
				d.trees.push({
					x: c.x + (hash(c.x, c.z, 40 + k) - 0.5) * (trail?.[0] ? 0.2 : 0.8),
					y: tile.height * TILE_HEIGHT,
					z: c.z + (hash(c.x, c.z, 42 + k) - 0.5) * (trail?.[1] ? 0.2 : 0.8),
					s: 1 + hash(c.x, c.z, 44 + k) * 0.2,
					yaw: hash(c.x, c.z, 46 + k) * Math.PI * 2,
					variant: k,
					trunk: true,
				});
			}
		}
	});
	addDraws(group, d);
}

/**
 * Ground shade gradient for the woods: clear at the treeline (the woods' edge on the open ground), dark green this
 * many meters in, so the forest has no lit floor to see through to.
 */
const SHADE_DEPTH = 3;

function shadeAlpha(depth:number):number {
	return Math.min(1, depth / SHADE_DEPTH) ** 0.7;
}

/** The colour the woods go to: the deep green of a forest floor out of the sun. */
const shadeMat = new THREE.MeshBasicMaterial({
	color: 0x0b2410,
	vertexColors: true,
	transparent: true,
	depthWrite: false,
	polygonOffset: true,
	polygonOffsetFactor: -2,
	polygonOffsetUnits: -8,
});
shadeMat.userData.shared = true;

/** A sheet of shade at `y` over the grid of `xs` × `zs`, each corner as dark as `depth` meters into the woods. */
function pushShade(d:Draws, xs:number[], zs:number[], y:number, depth:(x:number, z:number)=>number):void {
	const first = d.shadePos.length / 3;
	for (const z of zs) {
		for (const x of xs) {
			d.shadePos.push(x, y, z);
			d.shadeColor.push(1, 1, 1, shadeAlpha(depth(x, z)));
		}
	}
	const row = xs.length;
	for (let j = 0; j < zs.length - 1; j++) {
		for (let i = 0; i < row - 1; i++) {
			const a = first + j * row + i;
			// CCW from +Y.
			d.shadeIdx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
		}
	}
}

/**
 * Shade over the outskirts' woods (and trails into them). Each grew out of a forest edge tile, so its floor is one
 * tile deeper in than the map's edge.
 */
function shadeOutskirts(d:Draws, rects:LandRect[], map:Rect):void {
	const beyond = (v:number, lo:number, hi:number):number => Math.max(lo - v, v - hi, 0);
	/** `lo`, `hi`, and every meter of the first {@link SHADE_DEPTH} past the map inside them: where the shade changes. */
	const breaks = (lo:number, hi:number, mapLo:number, mapHi:number):number[] => {
		const at = new Set([lo, hi]);
		for (let k = 0; k <= SHADE_DEPTH; k++) {
			for (const v of [mapLo - k, mapHi + k]) {
				if (v > lo && v < hi) {
					at.add(v);
				}
			}
		}
		return [...at].sort((a, b) => a - b);
	};
	for (const r of rects) {
		pushShade(d, breaks(r.minX, r.maxX, map.minX, map.maxX), breaks(r.minZ, r.maxZ, map.minZ, map.maxZ), landY(r), (x, z) => (
			CELL_SIZE + Math.max(beyond(x, map.minX, map.maxX), beyond(z, map.minZ, map.maxZ))
		));
	}
}

/** Depth only: what it covers is not drawn, so the background shows. */
const curtainMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
curtainMat.userData.shared = true;

/**
 * Where the map meets void (a dungeon's solid rock), a curtain over its edge as high as the walls, so the background
 * shows there as it does over the void: no rock face ends the world, and none catches a light shining in from past it.
 */
function addVoidCurtains(group:THREE.Group, voids:LandRect[]):void {
	for (const r of voids) {
		// Corners touch the map at a point only.
		if (r.out.x !== 0 && r.out.z !== 0) {
			continue;
		}
		const alongX = r.out.z !== 0;
		const length = alongX ? r.maxX - r.minX : r.maxZ - r.minZ;
		const curtain = new THREE.Mesh(new THREE.PlaneGeometry(length, WALL_HEIGHT), curtainMat);
		// On the map's edge, a hair out from it.
		curtain.position.set(
			alongX ? (r.minX + r.maxX) / 2 : (r.out.x > 0 ? r.minX : r.maxX) + r.out.x * 0.01,
			WALL_HEIGHT / 2,
			alongX ? (r.out.z > 0 ? r.minZ : r.maxZ) + r.out.z * 0.01 : (r.minZ + r.maxZ) / 2,
		);
		curtain.rotation.y = alongX ? 0 : Math.PI / 2;
		// Before what it covers, so that fails the depth test.
		curtain.renderOrder = -1;
		group.add(curtain);
	}
}

/** The land past the map's edge, out to the horizon, and the rock faces where it meets the map or itself at another height. */
export function createOutskirts(plan:Outskirts):THREE.Group {
	const group = new THREE.Group();
	group.name = 'outskirts';
	const d = makeDraws();
	const inside = (r:Rect, x:number, z:number):boolean => x >= r.minX && x < r.maxX && z >= r.minZ && z < r.maxZ;
	const isLand = (x:number, z:number):boolean => {
		const r = plan.land.find((l) => inside(l, x, z));
		if (r) {
			return r.surface !== 'water';
		}
		const e = plan.edge.find((c) => inside(c, x, z));
		return !e?.tile || !(e.tile.def === 'cliff_water' || showsWater(e.tile.def));
	};
	plan.land.forEach((a, i) => {
		for (const b of plan.land.slice(i + 1)) {
			faceBetween(d, { r: a, y: landY(a), water: a.surface === 'water' }, { r: b, y: landY(b), water: b.surface === 'water' });
		}
		for (const e of plan.edge) {
			if (!e.tile) {
				continue;
			}
			const ey = edgeTop(e.tile);
			// A block (a wall) stands with its own faces; the outskirts face it only where they rise over it.
			if (!isBlock(e.tile) || landY(a) > ey) {
				faceBetween(d, { r: a, y: landY(a), water: a.surface === 'water' }, { r: e, y: ey, water: isWaterTile(e.tile) });
			}
		}
	});
	const trails = plan.land.filter((r) => r.surface === 'trail');
	const edgeFloor = (tile:Tile):number | undefined => {
		if ((tile.blocked && !LANDFORMS.has(tile.def)) || showsWater(tile.def) || tile.def === 'cliff_water') {
			return undefined;
		}
		return edgeTop(tile);
	};
	for (const r of plan.land) {
		const y = landY(r);
		topOf(d, r, isLand, plan.map, trails, (x, z) => {
			const tile = plan.edge.find((c) => inside(c, x, z))?.tile;
			return tile ? edgeFloor(tile) ?? y : y;
		});
	}
	shadeOutskirts(d, plan.land.filter((r) => r.surface === 'forest' || r.surface === 'trail'), plan.map);
	addDraws(group, d);
	addVoidCurtains(group, plan.land.filter((r) => r.surface === 'void'));
	for (const mesh of group.children) {
		mesh.frustumCulled = false;
	}
	return group;
}
