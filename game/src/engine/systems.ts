import { ChunkStreamer, chunkBounds, type Renderer, Time, Component } from '@arc-director/kindling';
import { Order } from './order';
import { patchGoals, patchInspect, patchHud, patchInfer, statusLabels, type Overheads } from './patchHud';
import { syncHeldTorchLight } from '../items/heldLight';
import type { GameHost } from '../director/adapter';
import { WorldPresent } from '../render/present';
import type { OutskirtHeights, Surface } from '../world/land';
import type { HudModel } from '../ui/hudModel';
import type { Chunk } from '../world/Chunk';
import { spawnChunkEntities } from '../world/spawn';
import { syncDressingColliders, syncDressingFlies } from '../world/dressingColliders';
import { syncRoadStep } from '../world/dressingPlan';
import type { World } from './World';
import { Camera } from './components';
import { CELL_SIZE, CHUNK_SIZE } from '../world/constants';

export class DirectorPulse extends Component {
	public static override order = Order.director;
	public director!:GameHost;

	public override update(dt:number):void {
		this.director.observe(dt);
		if (!this.gameObject.world?.arcDirectorOn) {
			return;
		}
		this.director.pulse(dt);
	}
}

export class WorldStream extends ChunkStreamer {
	public static override order = Order.streaming;

	public override spawn(chunk:Chunk):void {
		const world = this.gameObject.world!;
		spawnChunkEntities(world, chunk);
		syncDressingColliders(world);
		syncDressingFlies(world);
	}
}

export class GroundPick extends Component {
	public static override order = Order.pick;
	public getRenderer:()=>Renderer | null = () => null;

	public override update(dt:number):void {
		this.pickGround();
	}

	public pickGround():void {
		const world = this.gameObject.world;
		const renderer = this.getRenderer();
		if (!world || !renderer) {
			if (world) {
				world.groundHit = null;
			}
			return;
		}
		const y = world.findByID('Player')?.transform.position.y ?? 0;
		const locked = world.input.pointerLocked;
		world.groundHit = renderer.pickGround(
			locked ? 0 : world.input.mouseNdcX,
			locked ? 0 : world.input.mouseNdcY,
			y,
		);
	}
}

/** Meters past the map's edge the sun's shadow map still covers. */
const SUN_MARGIN = 5;
/** The side of the square moving things cast the sun's shadow in, at the camera's nearest and farthest: 1 to 16 chunks. */
const MOVER_SIDE = { near: CHUNK_SIZE * CELL_SIZE, far: 4 * CHUNK_SIZE * CELL_SIZE };

export class WorldView extends Component {
	public static override order = Order.present;
	public present = new WorldPresent();
	public getRenderer:()=>Renderer | null = () => null;
	/** The scene's land behind its walls (`SceneDef.ground`). */
	public ground?:Surface;
	/** Heights past the map's edge (`SceneDef.outskirts`). */
	public outskirts?:OutskirtHeights;

	public override lateUpdate(dt:number):void {
		this.sync();
	}

	public sync():void {
		const world = this.gameObject.world;
		const renderer = this.getRenderer();
		if (!world || !renderer) {
			return;
		}
		this.present.detailMaps = renderer.detailMaps;
		this.present.syncChunks(world);
		const chunks = this.gameObject.getComponent(WorldStream)?.chunks ?? [];
		this.present.mountOutskirts(world, chunks, this.ground, this.outskirts);
		// The sun's shadows cover the map and a margin; the woods past it are shaded by the outskirts' own shade.
		const map = chunkBounds(chunks);
		renderer.sunArea = map && { minX: map.minX - SUN_MARGIN, maxX: map.maxX + SUN_MARGIN, minZ: map.minZ - SUN_MARGIN, maxZ: map.maxZ + SUN_MARGIN };
		this.syncSunParts(world, renderer);
		const cam = renderer.findCamera();
		if (cam) {
			this.present.sync(world, cam.native);
		}
		this.present.tickNature(Time.time);
	}

	/**
	 * The square moving things cast the sun's shadow in follows the player, wider as the camera pulls back. It stays
	 * set (on the map's middle without a player), so its light never comes and goes and shaders never recompile.
	 */
	private syncSunParts(world:World, renderer:Renderer):void {
		const player = world.findByID('Player');
		const cam = world.findByID('MainCamera')?.getComponent(Camera);
		const area = renderer.sunArea;
		const { x, z } = player?.transform.position ?? (area ? { x: (area.minX + area.maxX) / 2, z: (area.minZ + area.maxZ) / 2 } : { x: 0, z: 0 });
		const t = cam ? (cam.distance - cam.minDistance) / Math.max(1e-3, cam.maxDistance - cam.minDistance) : 0.5;
		renderer.sunFocus = { x, z, half: (MOVER_SIDE.near + (MOVER_SIDE.far - MOVER_SIDE.near) * Math.min(1, Math.max(0, t))) / 2 };
	}
}

/** Writes HudModel after present. Vue SFCs only read that model. */
export class Hud extends Component {
	public static override order = Order.hud;
	public model!:HudModel;
	public director!:GameHost;
	public getRenderer:()=>Renderer | null = () => null;
	/** Health bars and carried things over the characters (`SceneDef`). */
	public overheads:Overheads = { healthBars: false };

	public override lateUpdate(dt:number):void {
		this.sync();
	}

	public sync():void {
		const world = this.gameObject.world;
		const renderer = this.getRenderer();
		if (!world || !renderer) {
			return;
		}
		patchHud(world, this.model, renderer, statusLabels(this.director), this.overheads);
		patchInfer(this.director, this.model);
		patchGoals(world, this.model, renderer, this.director.hooks.goals?.(this.director));
		patchInspect(world, this.model, renderer, this.director, this.overheads.inspect ?? false);
	}
}

export class HeldTorchLight extends Component {
	public static override order = Order.heldTorch;

	public override update(dt:number):void {
		syncHeldTorchLight(this.gameObject, dt);
	}
}
