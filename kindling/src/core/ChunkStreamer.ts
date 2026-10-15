import { Component } from './Component.js';
import type { GameObject } from './GameObject.js';
import type { ChunkType } from './types.js';
import { chunkBounds, type ChunkBounds } from './World.js';

/** Keeps the chunks around its object loaded. */
export class StreamingAnchor extends Component {
	/** Unloaded chunks this close (meters to their edge) load. */
	public viewRadius = 20;
	/** Loaded chunks stay until this much past `viewRadius`. */
	public hysteresis = 8;
}

/** Parks with chunk `chunkID` when it unloads, and comes back when it loads. */
export class ChunkBound extends Component {
	public chunkID = '';
}

/**
 * Loads `chunks` near any enabled `StreamingAnchor` and unloads the rest, each `lateUpdate`.
 * With no anchors, nothing changes. Unloading parks the chunk's `ChunkBound` objects
 * (`World.remove`); loading adds them back as they were. Override `spawn` to populate a chunk the first time it loads.
 */
export class ChunkStreamer extends Component {
	/** Every chunk of the scene, loaded or not. */
	public chunks:ChunkType[] = [];
	private readonly _parked = new Map<ChunkType, GameObject[]>();

	/** The first time `chunk` loads, right after `World.addChunk`. */
	public spawn(chunk:ChunkType):void {}

	/** World XZ box around every chunk of the scene, loaded or not. */
	public bounds():ChunkBounds | undefined {
		return chunkBounds(this.chunks);
	}

	/** Load every chunk, so the whole scene is in the world (e.g. before a save). The next `stream` unloads far ones again. */
	public loadAll():void {
		for (const chunk of this.chunks) {
			if (!this.loaded(chunk)) {
				this.load(chunk);
			}
		}
	}

	public override lateUpdate(dt:number):void {
		this.stream();
	}

	/** Load and unload by anchor distance now. */
	public stream():void {
		const world = this.gameObject.world;
		if (!world) {
			return;
		}
		const anchors:{ go:GameObject; anchor:StreamingAnchor }[] = [];
		world.forEachComponent(StreamingAnchor, (anchor, go) => {
			if (anchor.enabled) {
				anchors.push({ go, anchor });
			}
		});
		if (anchors.length === 0) {
			return;
		}
		for (const chunk of this.chunks) {
			const loaded = this.loaded(chunk);
			const keep = anchors.some(({ go, anchor }) => {
				const p = go.transform.position;
				return chunk.distanceTo(p.x, p.z) <= anchor.viewRadius + (loaded ? anchor.hysteresis : 0);
			});
			if (keep && !loaded) {
				this.load(chunk);
			}
			else if (!keep && loaded) {
				this.unload(chunk);
			}
		}
	}

	private loaded(chunk:ChunkType):boolean {
		return this.gameObject.world?.chunkAt(chunk.origin.cx, chunk.origin.cz) === chunk;
	}

	private load(chunk:ChunkType):void {
		const world = this.gameObject.world!;
		world.addChunk(chunk);
		const parked = this._parked.get(chunk);
		if (!parked) {
			this.spawn(chunk);
			return;
		}
		this._parked.delete(chunk);
		for (const go of parked) {
			world.add(go);
		}
	}

	private unload(chunk:ChunkType):void {
		const world = this.gameObject.world!;
		const parked = world.objects.filter((go) => go.getComponent(ChunkBound)?.chunkID === chunk.id);
		for (const go of parked) {
			world.remove(go);
		}
		this._parked.set(chunk, parked);
		world.removeChunk(chunk);
	}
}
