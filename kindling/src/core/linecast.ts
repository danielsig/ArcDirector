import { BoxCollider } from './BoxCollider.js';
import type { TileType } from './core-types.js';
import type { GameObject } from './GameObject.js';
import type { Terrain, TileSpec } from './Terrain.js';
import type { TileCoord } from './tile-coord.js';
import type { Vec3 } from './Transform.js';
import type { World } from './World.js';
import type { XZ } from './xz.js';

/** What a `linecast` ran into: a collider's object, or `'terrain'`; `t` along the line, 0 at `from` to 1 at `to`. */
export type LineHit = { hit:GameObject | 'terrain'; t:number; point:Vec3 };

export type LinecastOpts = {
	/** Colliders the line can run into; every enabled, solid, non-trigger `BoxCollider` when left out. */
	filter?:(go:GameObject, col:BoxCollider)=>boolean;
};

/**
 * Walks the tiles the straight line from `a` to `b` crosses, in order from `a`'s to `b`'s: `visit` gets each with
 * the stretch of the line in it (`t0` to `t1`; 0 at `a`, 1 at `b`), and stops the walk by returning `false`.
 * Through a corner exactly, the walk steps both ways at once, to the tile across it.
 */
export function tilesAlong(terrain:Terrain, a:XZ, b:XZ, visit:(at:TileCoord, t0:number, t1:number)=>boolean | void):void {
	const size = terrain.tileSize || 1;
	const [dx, dz] = [b.x - a.x, b.z - a.z];
	let { tx, tz } = terrain.tileCoordAt(a.x, a.z);
	const [stepX, stepZ] = [Math.sign(dx), Math.sign(dz)];
	const [deltaX, deltaZ] = [stepX ? size / Math.abs(dx) : Infinity, stepZ ? size / Math.abs(dz) : Infinity];
	let nextX = stepX ? ((stepX > 0 ? tx + 1 : tx) * size - a.x) / dx : Infinity;
	let nextZ = stepZ ? ((stepZ > 0 ? tz + 1 : tz) * size - a.z) / dz : Infinity;
	for (let t0 = 0; t0 < 1;) {
		const t1 = Math.min(nextX, nextZ, 1);
		if (visit({ tx, tz }, t0, t1) === false) {
			return;
		}
		if (nextX <= nextZ) {
			tx += stepX;
			nextX += deltaX;
		}
		if (nextZ <= t1) {
			tz += stepZ;
			nextZ += deltaZ;
		}
		t0 = t1;
	}
}

/** The part of the line `p + d * t`, `t` in `[t0, t1]`, between `lo` and `hi` on one axis, or `undefined`. */
function clip([t0, t1]:[number, number], p:number, d:number, lo:number, hi:number):[number, number] | undefined {
	if (d === 0) {
		return p < lo || p > hi ? undefined : [t0, t1];
	}
	const [a, b] = [(lo - p) / d, (hi - p) / d];
	const span:[number, number] = [Math.max(t0, Math.min(a, b)), Math.min(t1, Math.max(a, b))];
	return span[0] <= span[1] ? span : undefined;
}

/** Where along `from` → `to` the line enters the box `lo`–`hi`, or `undefined` if it misses it. */
function entersBox(from:Vec3, to:Vec3, lo:Vec3, hi:Vec3):number | undefined {
	let span:[number, number] | undefined = [0, 1];
	for (const k of ['x', 'y', 'z'] as const) {
		span = span && clip(span, from[k], to[k] - from[k], lo[k], hi[k]);
	}
	return span?.[0];
}

/** Where along `from` → `to` the line enters an upright cylinder standing on `foot`, or `undefined` if it misses it. */
function entersCylinder(from:Vec3, to:Vec3, foot:Vec3, radius:number, height:number):number | undefined {
	const [dx, dz] = [to.x - from.x, to.z - from.z];
	const [fx, fz] = [from.x - foot.x, from.z - foot.z];
	const a = dx * dx + dz * dz;
	const b = fx * dx + fz * dz;
	const disc = b * b - a * (fx * fx + fz * fz - radius * radius);
	if (disc < 0 || (a === 0 && fx * fx + fz * fz > radius * radius)) {
		return undefined;
	}
	const round:[number, number] = a === 0 ? [0, 1] : [Math.max(0, (-b - Math.sqrt(disc)) / a), Math.min(1, (-b + Math.sqrt(disc)) / a)];
	return round[0] <= round[1] ? clip(round, from.y, to.y - from.y, foot.y, foot.y + height)?.[0] : undefined;
}

/** Where the line enters `go`'s collider, `undefined` if it misses it or either end is inside it. */
function entersCollider(go:GameObject, col:BoxCollider, from:Vec3, to:Vec3):number | undefined {
	const p = go.transform.position;
	const inside = (q:Vec3) => q.y >= p.y && q.y < p.y + col.size.y && col.contains(q.x, q.z);
	if (inside(from) || inside(to)) {
		return undefined;
	}
	if (col.shape === 'cylinder') {
		return entersCylinder(from, to, p, col.size.x / 2, col.size.y);
	}
	const [hx, hz] = [col.size.x / 2, col.size.z / 2];
	return entersBox(from, to, { x: p.x - hx, y: p.y, z: p.z - hz }, { x: p.x + hx, y: p.y + col.size.y, z: p.z + hz });
}

/**
 * The first thing on the straight line from `from` to `to` (Unity's `Physics.Linecast`): a collider (a box or an
 * upright cylinder from its object's Y up `size.y`), a block (a blocked tile with no `deck`, `top` meters above its
 * height, `Terrain.blockHeight` when the tile names none) or a blocked tile's `solids` (as tall), or the ground where
 * the line dips under the top of a tile's floor (a climb's head; a cover is a deck it may pass under). What either
 * end is inside never stops it: the eyes of the one looking, the thing looked at.
 * The terrain is walked tile by tile along the line (`tilesAlong`), and colliders are looked up near each tile.
 */
export function linecast(world:World, from:Vec3, to:Vec3, opts:LinecastOpts = {}):LineHit | undefined {
	const terrain = world.terrain;
	const size = terrain.tileSize || 1;
	const [dx, dy, dz] = [to.x - from.x, to.y - from.y, to.z - from.z];
	const at = (t:number):Vec3 => ({ x: from.x + dx * t, y: from.y + dy * t, z: from.z + dz * t });
	let best:LineHit | undefined;
	const consider = (hit:GameObject | 'terrain', t:number | undefined):void => {
		if (t !== undefined && (!best || t < best.t)) {
			best = { hit, t, point: at(t) };
		}
	};
	const seen = new Set<GameObject>();
	/** A blocked tile's solids, or the whole of a block, standing to its top: the line runs into them unless an end is inside. */
	const blocks = (tx:number, tz:number, tile:TileSpec):void => {
		const solids = terrain.solidsAt(tile as TileType, { tx, tz });
		const boxes = solids ?? (tile.deck === undefined ? [{ minX: tx * size, maxX: (tx + 1) * size, minZ: tz * size, maxZ: (tz + 1) * size }] : []);
		const top = tile.height * terrain.tileHeight + (tile.top ?? terrain.blockHeight);
		for (const b of boxes) {
			const inside = (q:Vec3) => q.x >= b.minX && q.x <= b.maxX && q.z >= b.minZ && q.z <= b.maxZ && q.y < top;
			if (!inside(from) && !inside(to)) {
				consider('terrain', entersBox(from, to, { x: b.minX, y: -Infinity, z: b.minZ }, { x: b.maxX, y: top, z: b.maxZ }));
			}
		}
	};
	/** What stops the line in tile `tx`, `tz`, which it crosses from `t0` to `t1`. */
	const visit = (tx:number, tz:number, t0:number, t1:number):void => {
		const tile = terrain.tileAt({ tx, tz }) as TileSpec | undefined;
		if (tile?.blocked) {
			blocks(tx, tz, tile);
		}
		else if (tile) {
			// The top of the tile's floor (a climb's head); a cover is a deck the line may pass under.
			const ground = tile.height * terrain.tileHeight + (tile.deck ?? 0);
			const [ya, yb] = [from.y + dy * t0, from.y + dy * t1];
			consider('terrain', ya < ground ? t0 : yb < ground ? t0 + (t1 - t0) * (ya - ground) / (ya - yb) : undefined);
		}
		world.forEachNear({ minX: tx * size, maxX: (tx + 1) * size, minZ: tz * size, maxZ: (tz + 1) * size }, (go) => {
			const col = go.getComponent(BoxCollider);
			if (!seen.has(go) && col?.enabled && col.solid && !col.isTrigger && (!opts.filter || opts.filter(go, col))) {
				seen.add(go);
				consider(go, entersCollider(go, col, from, to));
			}
		});
	};
	/** A block at a corner the line passes exactly through. */
	const corner = (tx:number, tz:number):void => {
		const tile = terrain.tileAt({ tx, tz }) as TileSpec | undefined;
		if (tile?.blocked) {
			blocks(tx, tz, tile);
		}
	};
	let last:TileCoord | undefined;
	tilesAlong(terrain, from, to, (at, t0, t1) => {
		if (last && last.tx !== at.tx && last.tz !== at.tz) {
			// Through a corner: the two tiles beside it touch the line there.
			corner(at.tx, last.tz);
			corner(last.tx, at.tz);
		}
		last = at;
		visit(at.tx, at.tz, t0, t1);
		return !(best && best.t < t1);
	});
	return best;
}
