import * as THREE from 'three';
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

export class World {
	readonly objects:GameObject[] = [];
	readonly native = new THREE.Scene();
	/** 0 = no tile collision. Hosts set this to their cell size. */
	tileSize = 0;
	private readonly doomed:GameObject[] = [];

	sampleTerrain(_x:number, _z:number):TerrainSample | undefined {
		return undefined;
	}

	add(go:GameObject):GameObject {
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
	destroy(go:GameObject):void {
		if (!this.doomed.includes(go)) {
			this.doomed.push(go);
		}
	}

	/** Unregister this object now. Does not destroy children or fire `onDestroy`. */
	remove(go:GameObject):void {
		const queued = this.doomed.indexOf(go);
		if (queued >= 0) {
			this.doomed.splice(queued, 1);
		}
		if (go.parent) {
			go.parent.children = go.parent.children.filter((c) => c !== go);
			go.parent = null;
		}
		const i = this.objects.indexOf(go);
		if (i >= 0) {
			this.objects.splice(i, 1);
		}
		go.transform.object3D.removeFromParent();
		go.world = null;
	}

	flushDestroy():void {
		const pending = this.doomed.splice(0);
		for (const go of pending) {
			this.destroyNow(go);
		}
	}

	findByID(id:string):GameObject | undefined {
		for (const go of this.objects) {
			if (go.id === id) {
				return go;
			}
		}
		return undefined;
	}

	forEachComponent<T extends Component>(
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
			go.parent.children = go.parent.children.filter((c) => c !== go);
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
