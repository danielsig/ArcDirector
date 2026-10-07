import { Audio } from '../audio/Audio.js';
import * as THREE from 'three';
import { BoxCollider } from './BoxCollider.js';
import type { Chunk } from './Chunk.js';
import type { Component } from './Component.js';
import type { GameObject } from './GameObject.js';
import type { Constructor } from './types.js';

export type TerrainSample = {
	/** Discrete tile height (stairs / cliffs). */
	height:number;
	/** World Y in meters. */
	worldY:number;
	blocked:boolean;
	climbable:boolean;
};

const NONE:readonly GameObject[] = [];
const pos = new THREE.Vector3();

/** One number per tile; exact while |tz| < 2^25. */
function tileKey(tx:number, tz:number):number {
	return tx * 0x4000000 + tz;
}

export class World {
	public readonly objects:GameObject[] = [];
	public readonly native = new THREE.Scene();
	/** Procedural mixer. Silent when AudioContext is missing. */
	public readonly audio = new Audio();
	/** 0 = no tile collision. Hosts set this to their cell size. */
	public tileSize = 0;
	/** Tiles per chunk side. 0 = no chunks. Hosts set this with `tileSize` when they use `Chunk`s. */
	public chunkSize = 0;
	/** Loaded chunks. Look one up with `chunkAt` / `chunkAtWorld`. */
	public readonly chunks = new Map<number, Chunk>();
	private readonly _doomed:GameObject[] = [];
	/** Spatial hash: objects by the tile under their position, as of the last `reindex`. */
	private _tiles = new Map<number, GameObject[]>();
	/** Widest collider half-extent plus pad, so `forEachNear` finds boxes centred outside its area. */
	private _reach = 0;

	public sampleTerrain(x:number, z:number):TerrainSample | undefined {
		return undefined;
	}

	/** Tile coordinate of a world XZ point (`tileSize`, or 1 when 0). */
	public tileCoordAt(x:number, z:number):{ tx:number; tz:number } {
		const size = this.tileSize || 1;
		return { tx: Math.floor(x / size), tz: Math.floor(z / size) };
	}

	/** World XZ center of tile `(tx, tz)`. */
	public tileCenter(tx:number, tz:number):{ x:number; z:number } {
		const size = this.tileSize || 1;
		return { x: (tx + 0.5) * size, z: (tz + 0.5) * size };
	}

	/** Chunk coordinate of a world XZ point. */
	public chunkCoordAt(x:number, z:number):{ cx:number; cz:number } {
		const span = this.chunkSize * (this.tileSize || 1);
		return { cx: Math.floor(x / span), cz: Math.floor(z / span) };
	}

	public chunkAt(cx:number, cz:number):Chunk | undefined {
		return this.chunks.get(tileKey(cx, cz));
	}

	public chunkAtWorld(x:number, z:number):Chunk | undefined {
		if (this.chunkSize === 0) {
			return undefined;
		}
		const { cx, cz } = this.chunkCoordAt(x, z);
		return this.chunkAt(cx, cz);
	}

	/** World XZ box around every loaded chunk, or `undefined` when none is. */
	public chunkBounds():{ minX:number; minZ:number; maxX:number; maxZ:number } | undefined {
		let bounds:{ minX:number; minZ:number; maxX:number; maxZ:number } | undefined;
		for (const chunk of this.chunks.values()) {
			const x = chunk.worldOriginX();
			const z = chunk.worldOriginZ();
			const span = chunk.size * chunk.cellSize;
			bounds ??= { minX: x, minZ: z, maxX: x + span, maxZ: z + span };
			bounds.minX = Math.min(bounds.minX, x);
			bounds.minZ = Math.min(bounds.minZ, z);
			bounds.maxX = Math.max(bounds.maxX, x + span);
			bounds.maxZ = Math.max(bounds.maxZ, z + span);
		}
		return bounds;
	}

	/** The tile under a world XZ point, if its chunk is loaded. */
	public tileAtWorld(x:number, z:number):unknown {
		return this.chunkAtWorld(x, z)?.tileAtWorld(x, z);
	}

	/** Load a chunk. Its `size` and `cellSize` must match `chunkSize` and `tileSize`. */
	public addChunk(chunk:Chunk):void {
		if (chunk.size !== this.chunkSize || chunk.cellSize !== (this.tileSize || 1)) {
			throw new Error(`chunk ${chunk.id} is ${chunk.size}×${chunk.cellSize}m; world is ${this.chunkSize}×${this.tileSize || 1}m`);
		}
		this.chunks.set(tileKey(chunk.origin.cx, chunk.origin.cz), chunk);
	}

	public removeChunk(chunk:Chunk):void {
		const key = tileKey(chunk.origin.cx, chunk.origin.cz);
		if (this.chunks.get(key) === chunk) {
			this.chunks.delete(key);
		}
	}

	public add(go:GameObject):GameObject {
		if (go.world && go.world !== this) {
			throw new Error('GameObject already belongs to another World');
		}
		if (this.objects.includes(go)) {
			go.awakeAll();
			return go;
		}
		this.registerTree(go);
		if (!go.parent) {
			this.native.add(go.transform.object3D);
		}
		go.awakeAll();
		return go;
	}

	/** Queue destroy; flushed at the end of `Game.tick`. Children follow. */
	public destroy(go:GameObject):void {
		if (!this._doomed.includes(go)) {
			this._doomed.push(go);
		}
	}

	/** Unregister this object now. Does not destroy children or fire `onDestroy`. */
	public remove(go:GameObject):void {
		const queued = this._doomed.indexOf(go);
		if (queued >= 0) {
			this._doomed.splice(queued, 1);
		}
		if (go.parent) {
			go.parent = null;
		}
		const i = this.objects.indexOf(go);
		if (i >= 0) {
			this.objects.splice(i, 1);
		}
		go.transform.object3D.removeFromParent();
		go.world = null;
	}

	public flushDestroy():void {
		const pending = this._doomed.splice(0);
		for (const go of pending) {
			this.destroyNow(go);
		}
	}

	public findByID(id:string):GameObject | undefined {
		for (const go of this.objects) {
			if (go.id === id) {
				return go;
			}
		}
		return undefined;
	}

	public forEachComponent<T extends Component>(
		ctor:Constructor<T>,
		fn:(c:T, go:GameObject)=>void,
	):void {
		for (const go of this.objects) {
			const c = go.getComponent(ctor);
			if (c) {
				fn(c, go);
			}
		}
	}

	/** Objects whose position is in tile `(tx, tz)`. Tiles are `tileSize` (1 when 0). */
	public objectsInTile(tx:number, tz:number):readonly GameObject[] {
		return this._tiles.get(tileKey(tx, tz)) ?? NONE;
	}

	/** Every object whose collider may overlap the XZ box, plus the uncollided ones centred in it. Check exactly. */
	public forEachNear(minX:number, minZ:number, maxX:number, maxZ:number, fn:(go:GameObject)=>void):void {
		const size = this.tileSize || 1;
		const r = this._reach;
		for (let tz = Math.floor((minZ - r) / size); tz <= Math.floor((maxZ + r) / size); tz++) {
			for (let tx = Math.floor((minX - r) / size); tx <= Math.floor((maxX + r) / size); tx++) {
				for (const go of this.objectsInTile(tx, tz)) {
					fn(go);
				}
			}
		}
	}

	/** Updates the spatial hash. Physics calls this after moving bodies and resolving collisions.
	 * If you've moved things around and need functions such as {@link objectsInTile} or {@link forEachNear}
	 * to use updated positions without waiting for the next step, call this beforehand.
	*/
	public reindex():void {
		const size = this.tileSize || 1;
		this._tiles = new Map();
		this._reach = 0;
		for (const go of this.objects) {
			const col = go.getComponent(BoxCollider);
			if (col) {
				this._reach = Math.max(this._reach, Math.max(col.size.x, col.size.z) * 0.5 + col.pad);
			}
			const p = go.transform.worldPositionVec(pos);
			const key = tileKey(Math.floor(p.x / size), Math.floor(p.z / size));
			const tile = this._tiles.get(key);
			if (tile) {
				tile.push(go);
			}
			else {
				this._tiles.set(key, [go]);
			}
		}
	}

	private registerTree(go:GameObject):void {
		if (!this.objects.includes(go)) {
			this.objects.push(go);
		}
		go.world = this;
		go.transform.object3D.name = go.name;
		for (const child of go.children) {
			this.registerTree(child);
		}
	}

	private destroyNow(go:GameObject):void {
		if (go.world !== this) {
			return;
		}
		for (const child of [...go.children]) {
			this.destroyNow(child);
		}
		if (go.parent) {
			go.parent = null;
		}
		for (const c of go.components()) {
			if (c.enabled) {
				c.onDisable();
			}
			c.onDestroy();
		}
		const i = this.objects.indexOf(go);
		if (i >= 0) {
			this.objects.splice(i, 1);
		}
		go.transform.object3D.removeFromParent();
		go.world = null;
	}
}
