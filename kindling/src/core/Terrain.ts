import { ChunkBound } from './ChunkStreamer.js';
import { inBounds, type Bounds } from './bounds.js';
import { opposite, SIDE_OFFSETS, SIDES, type Side } from './side.js';
import { applyState, captureObjects, diffState, type ChunkSave, type WorldState } from './save.js';
import type { GameObject } from './GameObject.js';
import type { ChunkCoord, TileCoord } from './tile-coord.js';
import type { XZ } from './xz.js';
import type { ChunkType, TileType, WorldType } from './core-types.js';

/** What Kindling reads off a tile. A host's tile type adds its own fields (a def, a current). */
export type TileSpec<S = unknown> = {
	/** The host's own word for the top: what footsteps, grass and the map read. Never interpreted here. */
	surface:S;
	/** Whole tile heights up. Feet rest at `height * tileHeight + deck`. */
	height:number;
	/** Meters the standing surface sits above `height * tileHeight`: a floor sheet, a river's bed. Left out on a block. */
	deck?:number;
	/** Routes and bodies do not enter it (but `wade`, and `solids` smaller than the tile). A block is a blocked tile with no `deck`. */
	blocked:boolean;
	/** How tall a block, or a blocked tile's `solids`, stands above `height * tileHeight`, for `linecast`. `Terrain.blockHeight` when left out. */
	top?:number;
	climb?:Climb;
	/** Blocked only to bodies outside it: one already in a `wade` tile walks on through others, and out. */
	wade?:boolean;
	/** Tiles a change to this tile reaches: what else must redraw (a tall pillar's long shadow). `Terrain.reach` when left out. */
	reach?:number;
};

/**
 * One flight of a climb, in tile-local units: `x` 0 at the west edge to 1 at the east, `z` 0 at the north edge to 1 at
 * the south. Its middle line runs from `foot` to `head`, `width` wide across it (1 when left out). It rises from the
 * `from` share of its climb's rise at the foot to the `to` share at the head (0 and 1 when left out), in `steps` (the
 * climb's when left out; 0 is a smooth slope).
 */
export type Flight = { foot:XZ; head:XZ; from?:number; to?:number; steps?:number; width?:number };

/**
 * How a tile climbs. Its head is at the tile's own height; its foot `rise` meters lower (`Terrain.tileHeight` when left
 * out), `steps` from foot to head (`Terrain.steps` when left out). `flights` left out: one straight flight across the
 * tile, up toward `climbAt`. Where no flight covers the tile, it is plain ground at the foot.
 */
export type Climb = { rise?:number; steps?:number; flights?:Flight[] };

/** The middle of each edge of a tile, tile-local. */
const EDGE_MIDDLE:Readonly<Record<Side, XZ>> = { north: { x: 0.5, z: 0 }, east: { x: 1, z: 0.5 }, south: { x: 0.5, z: 1 }, west: { x: 0, z: 0.5 } };

/** How far up its climb tile-local `p` stands on flight `f`, 0 at the foot to 1 at the head; `undefined` off it. */
function flightShare(f:Flight, p:XZ, steps:number):number | undefined {
	const dx = f.head.x - f.foot.x;
	const dz = f.head.z - f.foot.z;
	const length = Math.hypot(dx, dz);
	const t = ((p.x - f.foot.x) * dx + (p.z - f.foot.z) * dz) / (length * length);
	if (t < 0 || t > 1 || Math.abs((p.x - f.foot.x) * dz - (p.z - f.foot.z) * dx) / length > (f.width ?? 1) / 2) {
		return undefined;
	}
	const n = f.steps ?? steps;
	const from = f.from ?? 0;
	return from + ((f.to ?? 1) - from) * (n > 0 ? Math.min(n, Math.floor(t * n) + 1) / n : t);
}

/** The tile-local box a flight running along X or Z covers; `undefined` for a slanted one. */
function corridor(f:Flight):Bounds | undefined {
	const half = (f.width ?? 1) / 2;
	const [x0, x1, z0, z1] = [Math.min(f.foot.x, f.head.x), Math.max(f.foot.x, f.head.x), Math.min(f.foot.z, f.head.z), Math.max(f.foot.z, f.head.z)];
	if (x0 !== x1 && z0 !== z1) {
		return undefined;
	}
	return x0 === x1
		? { minX: Math.max(0, x0 - half), maxX: Math.min(1, x0 + half), minZ: z0, maxZ: z1 }
		: { minX: x0, maxX: x1, minZ: Math.max(0, z0 - half), maxZ: Math.min(1, z0 + half) };
}

/** The edge of its tile a tile-local point lies on, if any. */
function edgeOf(p:XZ):Side | undefined {
	return p.z === 0 ? 'north' : p.z === 1 ? 'south' : p.x === 0 ? 'west' : p.x === 1 ? 'east' : undefined;
}

/** A surface laid over tiles that feet rest on where it answers: a lowered drawbridge, a road. */
export type Cover = { bounds:Bounds; sample(x:number, z:number):number | undefined };

export type TerrainSample<S = unknown> = {
	surface:S;
	/** Whole tile heights up (stairs, cliffs). */
	height:number;
	/** World Y where feet rest. */
	worldY:number;
	blocked:boolean;
	climbable:boolean;
	wade:boolean;
	/**
	 * Where a tile is solid to bodies, as world XZ boxes, when that is less than the whole tile (a thin wall's boards, a
	 * stair's side strips). Bodies collide with these and may stand in the rest of the tile; routes go by `blocked`.
	 */
	solids?:readonly Bounds[];
};

/** World XZ box around `chunks`, or `undefined` when there are none. */
export function chunkBounds(chunks:Iterable<ChunkType>):Bounds | undefined {
	let bounds:Bounds | undefined;
	for (const chunk of chunks) {
		const x = chunk.worldOriginX();
		const z = chunk.worldOriginZ();
		const span = chunk.size * chunk.cellSize;
		bounds ??= { minX: x, maxX: x + span, minZ: z, maxZ: z + span };
		bounds.minX = Math.min(bounds.minX, x);
		bounds.minZ = Math.min(bounds.minZ, z);
		bounds.maxX = Math.max(bounds.maxX, x + span);
		bounds.maxZ = Math.max(bounds.maxZ, z + span);
	}
	return bounds;
}

/** One number per coordinate pair; exact while |z| < 2^25. */
export function gridKey(x:number, z:number):number {
	return x * 0x4000000 + z;
}

/**
 * The ground of a world: every chunk of its scene (`register`ed: their tiles answer whether or not their objects are
 * in the world), what stands where (`sample`, which physics and routes ask), and the chunks' objects, which the
 * streamer `load`s near its anchors and `unload`s (parks) far from them. A host subclasses it to `spawn` a chunk's
 * objects, to fetch chunks on first touch, or to add solids inside its tiles, and names its subclass in
 * `KindlingTypes.terrain`. Generic over the host's surface word, which it stores but never reads.
 */
export class Terrain<S = unknown> {
	/** Meters per tile. 0 = no tiles. */
	public tileSize = 0;
	/** Meters per whole tile height. */
	public tileHeight = 1;
	/** Tiles per chunk side. 0 = no chunks. */
	public chunkSize = 0;
	/** Steps per flight when a climb names none. */
	public steps = 4;
	/** A block's height above its base when its tile names no `top`. */
	public blockHeight = 2;
	/** Meters a flight's side strips reach in from its edges, and stay back from an open foot or head. */
	public stairSide = 0.16;
	public stairMouth = 0.3;
	/** A flight rising no more than this (meters) gets no side strips: a body steps onto it from any side. */
	public stepOver = 0.3;
	/** Tiles a change reaches when the tile names no `reach`. */
	public reach = 2;
	/** Every chunk of the scene, registered. */
	public readonly chunks:ChunkType[] = [];
	/** Chunks whose objects are in the world. */
	public readonly loaded:Set<ChunkType> = new Set();
	private readonly _byCoord = new Map<number, ChunkType | null>();
	private readonly _covers:Cover[] = [];
	private _bounds:Bounds | undefined;
	private readonly _solids = new Map<number, readonly Bounds[] | undefined>();
	private readonly _revisions = new Map<ChunkType, number>();
	private _revision = 0;
	private readonly _parked = new Map<ChunkType, GameObject[]>();
	private readonly _fresh = new Map<ChunkType, WorldState>();
	private readonly _pending = new Map<string, ChunkSave>();
	private _respawn:(recipe:unknown)=>GameObject | undefined = () => undefined;

	constructor(public readonly world:WorldType) {}

	/** Add a chunk of the scene. Its `size` and `cellSize` must match `chunkSize` and `tileSize`. */
	public register(chunk:ChunkType):void {
		if (chunk.size !== this.chunkSize || chunk.cellSize !== (this.tileSize || 1)) {
			throw new Error(`chunk ${chunk.id} is ${chunk.size}×${chunk.cellSize}m; terrain is ${this.chunkSize}×${this.tileSize || 1}m`);
		}
		this.chunks.push(chunk);
		this._byCoord.set(gridKey(chunk.origin.cx, chunk.origin.cz), chunk);
		this._bounds = undefined;
		// The tiles beside it may join it across the border now.
		this.invalidate(chunkBounds([chunk])!, this.reach);
	}

	/** The chunk at a chunk coordinate: registered, else fetched (`fetch`) once; a miss is remembered. */
	public chunkAt(cx:number, cz:number):ChunkType | undefined {
		const key = gridKey(cx, cz);
		let chunk = this._byCoord.get(key);
		if (chunk === undefined) {
			chunk = this.fetch(cx, cz) ?? null;
			if (chunk) {
				this.register(chunk);
			}
			else {
				this._byCoord.set(key, null);
			}
		}
		return chunk ?? undefined;
	}

	/** Override to bring a chunk's tiles in on first touch (decode it, download it). Default: none, the map ends. */
	protected fetch(cx:number, cz:number):ChunkType | undefined {
		return undefined;
	}

	/** Chunk coordinate of a world XZ point. */
	public chunkCoordAt(x:number, z:number):ChunkCoord {
		const span = this.chunkSize * (this.tileSize || 1);
		return { cx: Math.floor(x / span), cz: Math.floor(z / span) };
	}

	public chunkAtWorld(x:number, z:number):ChunkType | undefined {
		if (this.chunkSize === 0) {
			return undefined;
		}
		const { cx, cz } = this.chunkCoordAt(x, z);
		return this.chunkAt(cx, cz);
	}

	/** World XZ box around every registered chunk, or `undefined` when there is none. */
	public bounds():Bounds | undefined {
		return (this._bounds ??= chunkBounds(this.chunks));
	}

	/** Tile coordinate of a world XZ point (`tileSize`, or 1 when 0). */
	public tileCoordAt(x:number, z:number):TileCoord {
		const size = this.tileSize || 1;
		return { tx: Math.floor(x / size), tz: Math.floor(z / size) };
	}

	/** World XZ center of a tile. */
	public tileCenter({ tx, tz }:TileCoord):XZ {
		const size = this.tileSize || 1;
		return { x: (tx + 0.5) * size, z: (tz + 0.5) * size };
	}

	/** The tile under a world XZ point, `undefined` off the map. */
	public tileAtWorld(x:number, z:number):TileType | undefined {
		return this.chunkAtWorld(x, z)?.tileAtWorld(x, z) as TileType | undefined;
	}

	/** The tile at a tile coordinate, `undefined` off the map. */
	public tileAt(at:TileCoord):TileType | undefined {
		const { x, z } = this.tileCenter(at);
		return this.tileAtWorld(x, z);
	}

	/** The tile under a world XZ point; past the map's edge, the edge tile there, so land and water carry on out. */
	public tileNear(x:number, z:number):TileType | undefined {
		const map = this.bounds();
		const e = 1e-6;
		return map && this.tileAtWorld(Math.min(Math.max(x, map.minX), map.maxX - e), Math.min(Math.max(z, map.minZ), map.maxZ - e));
	}

	/** Kindling's part of the tile at `at`. */
	private spec(at:TileCoord):TileSpec<S> | undefined {
		return this.tileAt(at) as TileSpec<S> | undefined;
	}

	/**
	 * Which way a climbing tile with no `flights` goes up, from its neighbors across chunk borders: toward open ground at
	 * its height, else toward a higher climb, else away from lower ground, else north. `undefined` on a tile that does not climb.
	 */
	public climbAt(at:TileCoord):Side | undefined {
		const self = this.spec(at);
		if (!self?.climb) {
			return undefined;
		}
		const near = (['north', 'south', 'east', 'west'] as const).map((side) => [side, this.spec({ tx: at.tx + SIDE_OFFSETS[side].tx, tz: at.tz + SIDE_OFFSETS[side].tz })] as const);
		const up = near.find(([, n]) => n && !n.blocked && !n.climb && n.height >= self.height)
			?? near.find(([, n]) => n?.climb && n.height > self.height);
		if (up) {
			return up[0];
		}
		const down = near.find(([, n]) => n && (!n.blocked || n.climb) && n.height < self.height);
		return down ? opposite(down[0]) : 'north';
	}

	/** A climbing tile's flights, the shorthand spelled out (what a stair is drawn from). Empty on a tile that does not climb. */
	public flightsAt(at:TileCoord):readonly Flight[] {
		const climb = this.spec(at)?.climb;
		const up = climb && !climb.flights ? this.climbAt(at)! : 'north';
		return climb?.flights ?? (climb ? [{ foot: EDGE_MIDDLE[opposite(up)], head: EDGE_MIDDLE[up] }] : []);
	}

	/**
	 * The sides a tile is entered and left by: where its flights' feet and heads meet its edges, or every side where some
	 * of it is plain ground (a tile that does not climb, or a step in the middle of one).
	 */
	public climbEnds(at:TileCoord):readonly Side[] {
		const flights = this.flightsAt(at);
		const grid = [0.125, 0.375, 0.625, 0.875];
		const plain = grid.some((x) => grid.some((z) => flights.every((f) => flightShare(f, { x, z }, 1) === undefined)));
		return plain ? SIDES : SIDES.filter((side) => flights.some((f) => edgeOf(f.foot) === side || edgeOf(f.head) === side));
	}

	/** Everything physics, routes and the host need at a point. `undefined` off the map. */
	public sample(x:number, z:number):TerrainSample<S> | undefined {
		const tile = this.tileAtWorld(x, z) as TileSpec<S> | undefined;
		if (!tile) {
			return undefined;
		}
		const at = this.tileCoordAt(x, z);
		const over = this.coverAt(x, z);
		let y = tile.height * this.tileHeight + (tile.deck ?? 0);
		if (tile.climb) {
			// The highest flight over the point is the one stood on; off every flight, the foot.
			const size = this.tileSize || 1;
			const p = { x: x / size - at.tx, z: z / size - at.tz };
			const steps = tile.climb.steps ?? this.steps;
			const share = Math.max(0, ...this.flightsAt(at).map((f) => flightShare(f, p, steps) ?? 0));
			const rise = tile.climb.rise ?? this.tileHeight;
			y += rise * share - rise;
		}
		return {
			surface: tile.surface,
			height: tile.height,
			worldY: over ?? y,
			blocked: tile.blocked && over === undefined,
			climbable: !!tile.climb && !tile.blocked,
			wade: !!tile.wade && over === undefined,
			solids: this.solidsAt(tile as TileType, at),
		};
	}

	/**
	 * Override to add solid boxes inside a blocked tile (a thin wall's boards). Default: an open climb's side strips, along
	 * the long edges of each flight that runs along X or Z and rises more than `stepOver`, kept back `stairMouth` from an
	 * open foot or head (inside the tile, or on an edge whose neighbor does not climb), and dropped inside another
	 * flight's way (the inside of a corner). Else none: the whole tile. Asked once per tile, again after a chunk registers.
	 */
	protected solidsOf(tile:TileType, at:TileCoord):readonly Bounds[] | undefined {
		const climb = (tile as TileSpec<S>).climb;
		if (!climb || (tile as TileSpec<S>).blocked) {
			return undefined;
		}
		const size = this.tileSize || 1;
		const [side, mouth] = [this.stairSide / size, this.stairMouth / size];
		const open = (end:XZ):boolean => {
			const edge = edgeOf(end);
			return !edge || !this.spec({ tx: at.tx + SIDE_OFFSETS[edge].tx, tz: at.tz + SIDE_OFFSETS[edge].tz })?.climb;
		};
		const flights = this.flightsAt(at);
		const ways = flights.map(corridor);
		const strips:Bounds[] = [];
		flights.forEach((f, i) => {
			const way = ways[i];
			if (!way || (climb.rise ?? this.tileHeight) * ((f.to ?? 1) - (f.from ?? 0)) <= this.stepOver) {
				return;
			}
			const alongX = f.foot.z === f.head.z;
			const [lowEnd, highEnd] = (alongX ? f.foot.x < f.head.x : f.foot.z < f.head.z) ? [f.foot, f.head] : [f.head, f.foot];
			const lo = (alongX ? way.minX : way.minZ) + (open(lowEnd) ? mouth : 0);
			const hi = (alongX ? way.maxX : way.maxZ) - (open(highEnd) ? mouth : 0);
			if (lo >= hi) {
				return;
			}
			const sides = alongX
				? [{ minX: lo, maxX: hi, minZ: way.minZ, maxZ: way.minZ + side }, { minX: lo, maxX: hi, minZ: way.maxZ - side, maxZ: way.maxZ }]
				: [{ minX: way.minX, maxX: way.minX + side, minZ: lo, maxZ: hi }, { minX: way.maxX - side, maxX: way.maxX, minZ: lo, maxZ: hi }];
			strips.push(...sides.filter((s) => !ways.some((w, j) => j !== i && w && inBounds(w, (s.minX + s.maxX) / 2, (s.minZ + s.maxZ) / 2))));
		});
		return strips.length > 0
			? strips.map((s) => ({ minX: (at.tx + s.minX) * size, maxX: (at.tx + s.maxX) * size, minZ: (at.tz + s.minZ) * size, maxZ: (at.tz + s.maxZ) * size }))
			: undefined;
	}

	/** `tile`'s `solidsOf` (`tile` stands at `at`), asked once and kept. */
	public solidsAt(tile:TileType, at:TileCoord):readonly Bounds[] | undefined {
		const key = gridKey(at.tx, at.tz);
		if (!this._solids.has(key)) {
			this._solids.set(key, this.solidsOf(tile, at));
		}
		return this._solids.get(key);
	}

	/** Replace the tile at `at` (on a registered chunk) and tell every reader: see `invalidate`, out to the larger of the two tiles' `reach`. */
	public setTile(at:TileCoord, tile:TileType):void {
		const { x, z } = this.tileCenter(at);
		const chunk = this.chunkAtWorld(x, z);
		if (!chunk) {
			throw new Error(`no chunk at tile ${at.tx}, ${at.tz}`);
		}
		const { localX, localZ } = chunk.worldToLocal(x, z);
		const reach = (t:unknown):number => (t as TileSpec<S>).reach ?? this.reach;
		const was = chunk.tiles[localZ * chunk.size + localX];
		chunk.tiles[localZ * chunk.size + localX] = tile;
		const size = this.tileSize || 1;
		this.invalidate({ minX: at.tx * size, maxX: (at.tx + 1) * size, minZ: at.tz * size, maxZ: (at.tz + 1) * size }, Math.max(reach(was), reach(tile)));
	}

	/**
	 * Tiles in `area` (world XZ) changed in place: the revision of every chunk within `reach` tiles of it moves (the
	 * largest `reach` of the tiles in it when left out), and the scene's, and their solids are asked again.
	 */
	public invalidate(area:Bounds, reach?:number):void {
		if (reach === undefined) {
			const lo = this.tileCoordAt(area.minX, area.minZ);
			const hi = this.tileCoordAt(area.maxX - 1e-6, area.maxZ - 1e-6);
			reach = 0;
			for (let tx = lo.tx; tx <= hi.tx; tx++) {
				for (let tz = lo.tz; tz <= hi.tz; tz++) {
					reach = Math.max(reach, this.spec({ tx, tz })?.reach ?? this.reach);
				}
			}
		}
		const r = reach * (this.tileSize || 1);
		this._revision++;
		for (const chunk of this.chunks) {
			const [x, z, span] = [chunk.worldOriginX(), chunk.worldOriginZ(), chunk.size * chunk.cellSize];
			if (x < area.maxX + r && x + span > area.minX - r && z < area.maxZ + r && z + span > area.minZ - r) {
				this._revisions.set(chunk, this._revision);
			}
		}
		this._solids.clear();
	}

	/** A number that moves whenever a tile of `chunk`, or one within reach of it, changes; with no chunk, the scene's. */
	public revision(chunk?:ChunkType):number {
		return chunk ? this._revisions.get(chunk) ?? 0 : this._revision;
	}

	/** Where the first cover that answers at a point puts feet, if one does. */
	protected coverAt(x:number, z:number):number | undefined {
		for (const cover of this._covers) {
			const y = inBounds(cover.bounds, x, z) ? cover.sample(x, z) : undefined;
			if (y !== undefined) {
				return y;
			}
		}
		return undefined;
	}

	public addCover(cover:Cover):void {
		this._covers.push(cover);
	}

	public removeCover(cover:Cover):void {
		const i = this._covers.indexOf(cover);
		if (i >= 0) {
			this._covers.splice(i, 1);
		}
	}

	/** The first time `chunk` loads. Override to populate it. */
	protected spawn(chunk:ChunkType):void {}

	/** Add the chunk's objects: spawn them the first time (and take its fresh state), else unpark them; then apply its pending save. */
	public load(chunk:ChunkType):void {
		if (this.loaded.has(chunk)) {
			return;
		}
		this.loaded.add(chunk);
		const parked = this._parked.get(chunk);
		if (parked) {
			this._parked.delete(chunk);
			parked.forEach((go) => this.world.add(go));
		}
		else {
			this.spawn(chunk);
			this._fresh.set(chunk, captureObjects(this.objectsOf(chunk)));
		}
		const pending = this._pending.get(chunk.id);
		if (pending) {
			this._pending.delete(chunk.id);
			applyState(this.world, this.objectsOf(chunk), pending, this._respawn);
		}
	}

	/** Park the chunk's `ChunkBound` objects. */
	public unload(chunk:ChunkType):void {
		if (!this.loaded.delete(chunk)) {
			return;
		}
		const parked = this.objectsOf(chunk);
		parked.forEach((go) => this.world.remove(go));
		this._parked.set(chunk, [...parked]);
	}

	public loadAll():void {
		this.chunks.forEach((chunk) => this.load(chunk));
	}

	/** The chunk's `ChunkBound` objects: in the world while it is loaded, parked while it is not. */
	public objectsOf(chunk:ChunkType):readonly GameObject[] {
		return this._parked.get(chunk) ?? this.world.objects.filter((go) => go.getComponent(ChunkBound)?.chunkID === chunk.id);
	}

	/** Each chunk against its fresh state (taken right after its first `spawn`), parked ones included, and the restored slices still waiting for their chunk. Unchanged chunks are left out. */
	public save():Record<string, ChunkSave> {
		const out:Record<string, ChunkSave> = {};
		for (const [chunk, fresh] of this._fresh) {
			const diff = diffState(fresh, captureObjects(this.objectsOf(chunk)));
			if (diff.removed.length > 0 || Object.keys(diff.changed).length > 0) {
				out[chunk.id] = diff;
			}
		}
		return { ...out, ...Object.fromEntries(this._pending) };
	}

	/** Apply a save's chunk slices: now to loaded chunks, to the rest when they next load. `spawn` rebuilds an object from its `recipe`. */
	public restore(chunks:Record<string, ChunkSave>, spawn:(recipe:unknown)=>GameObject | undefined):void {
		this._respawn = spawn;
		for (const [id, slice] of Object.entries(chunks)) {
			const chunk = this.chunks.find((c) => c.id === id);
			if (chunk && this.loaded.has(chunk)) {
				applyState(this.world, this.objectsOf(chunk), slice, spawn);
			}
			else {
				this._pending.set(id, slice);
			}
		}
	}
}
