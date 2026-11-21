import { Camera } from '../render/Camera.js';
import { Component } from './Component.js';
import type { Vec3 } from './Transform.js';

/** Meters past its reach an anchor or a camera keeps a loaded chunk, unless it says otherwise. */
const HYSTERESIS = 8;

/** Keeps the chunks around its object loaded. */
export class StreamingAnchor extends Component {
	/** Unloaded chunks this close (meters to their edge) load. */
	public viewRadius = 20;
	/** Loaded chunks stay until this much past `viewRadius`. */
	public hysteresis = HYSTERESIS;
}

/** Parks with chunk `chunkID` when it unloads, and comes back when it loads. */
export class ChunkBound extends Component {
	public chunkID = '';
}

/**
 * Loads the terrain's chunks near any enabled `StreamingAnchor`, and every chunk an enabled `Camera` could show (within
 * its `sight`), and unloads the rest, each `lateUpdate` (`Terrain.load`, `Terrain.unload`). With neither, nothing
 * changes.
 */
export class ChunkStreamer extends Component {
	public override lateUpdate(dt:number):void {
		this.stream();
	}

	/** Load and unload by anchor and camera distance now. */
	public stream():void {
		const world = this.gameObject.world;
		if (!world) {
			return;
		}
		const reaches:{ at:Vec3; radius:number; hysteresis:number }[] = [];
		world.forEachComponent(StreamingAnchor, (anchor, go) => reaches.push({ at: go.transform.position, radius: anchor.viewRadius, hysteresis: anchor.hysteresis }));
		world.forEachComponent(Camera, (cam, go) => reaches.push({ at: go.transform.position, radius: cam.sight, hysteresis: HYSTERESIS }));
		if (reaches.length === 0) {
			return;
		}
		const terrain = world.terrain;
		for (const chunk of terrain.chunks) {
			const loaded = terrain.loaded.has(chunk);
			const keep = reaches.some(({ at, radius, hysteresis }) => chunk.distanceTo(at.x, at.z) <= radius + (loaded ? hysteresis : 0));
			if (keep && !loaded) {
				terrain.load(chunk);
			}
			else if (!keep && loaded) {
				terrain.unload(chunk);
			}
		}
	}
}
