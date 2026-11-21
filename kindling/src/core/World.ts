import { Input } from './Input.js';
import { Time } from './time.js';
import { Audio } from '../audio/Audio.js';
import * as THREE from 'three';
import { BoxCollider } from './BoxCollider.js';
import { blockerAt, type BlockerOpts } from './physics.js';
import { linecast, type LineHit, type LinecastOpts } from './linecast.js';
import type { Bounds } from './bounds.js';
import { gridKey, Terrain } from './Terrain.js';
import type { Component } from './Component.js';
import type { Renderer } from '../render/Renderer.js';
import type { GameObject } from './GameObject.js';
import type { Vec3 } from './Transform.js';
import type { Constructor, TerrainType, WorldType } from './core-types.js';

const NONE:readonly GameObject[] = [];
const pos = new THREE.Vector3();

export class World {
	public readonly objects:GameObject[] = [];
	public readonly native = new THREE.Scene();
	/** Procedural mixer. Silent when AudioContext is missing. */
	public readonly audio = new Audio();
	/** Keyboard and mouse on the canvas. `Game` attaches it. */
	public readonly input = new Input();
	/** What draws this world, its canvas included. `Game` sets it; null when headless. */
	public renderer:Renderer | null = null;
	/** How bright every light is but the sun. 1 leaves them as authored. Set before `Renderer.applyLook`. */
	public lightLevel = 1;
	/** The ground: chunks, tiles and what stands where. A host sets its own subclass (`KindlingTypes.terrain`). */
	public readonly terrain:TerrainType = new Terrain(this as WorldType) as TerrainType;
	private readonly _doomed:GameObject[] = [];
	/** Calls waiting on game time, soonest first. */
	private _timers:{ at:number; fn:()=>void }[] = [];
	/** Spatial hash: objects by the tile under their position, as of the last `reindex`. */
	private _tiles = new Map<number, GameObject[]>();
	/** Widest collider half-extent plus pad, so `forEachNear` finds boxes centered outside its area. */
	private _reach = 0;

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

	/** Calls `fn` once `seconds` of game time from now (paused time does not count), before that frame's `update`. */
	public after(seconds:number, fn:()=>void):void {
		const at = Time.time + seconds;
		const i = this._timers.findIndex((t) => t.at > at);
		this._timers.splice(i < 0 ? this._timers.length : i, 0, { at, fn });
	}

	/** Runs the `after` calls that are due. `Game.simulate` calls it each frame. */
	public runTimers():void {
		while (this._timers.length > 0 && this._timers[0]!.at <= Time.time) {
			this._timers.shift()!.fn();
		}
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

	/** Calls `fn` with each object's enabled `ctor` component. */
	public forEachComponent<T extends Component>(
		ctor:Constructor<T>,
		fn:(c:T, go:GameObject)=>void,
	):void {
		for (const go of this.objects) {
			const c = go.getComponent(ctor);
			if (c?.enabled) {
				fn(c, go);
			}
		}
	}

	/** Objects whose position is in tile `(tx, tz)`. Tiles are `tileSize` (1 when 0). */
	public objectsInTile(tx:number, tz:number):readonly GameObject[] {
		return this._tiles.get(gridKey(tx, tz)) ?? NONE;
	}

	/** Every object whose collider may overlap `area`, plus the uncollided ones centered in it. Check exactly. */
	public forEachNear(area:Bounds, fn:(go:GameObject)=>void):void {
		const size = this.terrain.tileSize || 1;
		const r = this._reach;
		for (let tz = Math.floor((area.minZ - r) / size); tz <= Math.floor((area.maxZ + r) / size); tz++) {
			for (let tx = Math.floor((area.minX - r) / size); tx <= Math.floor((area.maxX + r) / size); tx++) {
				for (const go of this.objectsInTile(tx, tz)) {
					fn(go);
				}
			}
		}
	}

	/**
	 * What `body` would run into standing at `x`, `z`: a solid collider that never moves (no `Rigidbody`), else
	 * `'terrain'` (a blocked tile's solids, or ground it cannot step to `from` where it is), else nothing. The same
	 * tests physics pushes bodies out with, so routes planned with it are ones bodies can walk; bodies slide around a
	 * cylinder, so it stops one only over its middle. With no `body`, what stands at the point itself. Objects are where the last
	 * `reindex` found them.
	 */
	public blocker(body:GameObject | null, x:number, z:number, opts?:BlockerOpts):GameObject | 'terrain' | undefined {
		return blockerAt(this, body, x, z, opts);
	}

	/** The first thing on the straight line from `from` to `to` ({@link linecast}). Objects are where the last `reindex` found them. */
	public linecast(from:Vec3, to:Vec3, opts?:LinecastOpts):LineHit | undefined {
		return linecast(this, from, to, opts);
	}

	/** Updates the spatial hash. Physics calls this after moving bodies and resolving collisions.
	 * If you've moved things around and need functions such as {@link objectsInTile} or {@link forEachNear}
	 * to use updated positions without waiting for the next step, call this beforehand.
	*/
	public reindex():void {
		const size = this.terrain.tileSize || 1;
		this._tiles = new Map();
		this._reach = 0;
		for (const go of this.objects) {
			const col = go.getComponent(BoxCollider);
			if (col) {
				this._reach = Math.max(this._reach, Math.max(col.size.x, col.size.z) * 0.5 + col.pad);
			}
			const p = go.transform.worldPositionVec(pos);
			const key = gridKey(Math.floor(p.x / size), Math.floor(p.z / size));
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
