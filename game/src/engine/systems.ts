import { ChunkStreamer, chunkBounds, type Renderer, Time, Component } from '@arc-director/kindling';
import { Order } from './order';
import { patchGoals, patchInspect, patchHud, patchInfer, patchSlates, patchThinks, statusLabels, type Overheads } from './patch-hud';
import { syncHeldTorchLight } from '../items/held-light';
import type { GameHost } from '../director/adapter';
import { WorldPresent } from '../render/WorldPresent';
import type { OutskirtHeights, Surface } from '../world/land';
import type { HudModel } from '../ui/hud-model';
import type { DemoChunk } from '../world/demo-chunk';
import { spawnChunkEntities } from '../world/spawn';
import { syncDressingColliders, syncDressingFlies, syncFurniture } from '../world/dressing-colliders';
import { syncRoadStep } from '../world/dressing-plan';
import type { DemoWorld } from './demo-world';
import { Camera } from './components';
import { CELL_SIZE, CHUNK_SIZE } from '../world/constants';
import { PlayerInput } from '../characters/PlayerInput';

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

	public override spawn(chunk:DemoChunk):void {
		const world = this.gameObject.world!;
		spawnChunkEntities(world, chunk);
		syncDressingColliders(world);
		syncDressingFlies(world);
		syncFurniture(world);
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

/**
 * A bodiless player on a touch screen moves over the world as on a phone's map: the ground follows the finger. It
 * takes the drag before anything else reads it, so the drag neither turns nor dollies the camera.
 */
export class MapPan extends Component {
	public static override order = Order.pick;
	public getRenderer:()=>Renderer | null = () => null;

	public override update(dt:number):void {
		const world = this.gameObject.world;
		const input = world?.input;
		const player = world?.findByID('Player');
		const cam = world?.findByID('MainCamera')?.getComponent(Camera);
		const view = this.getRenderer();
		const fov = view?.findCamera()?.fov;
		if (!input?.touch || !player || !cam || !view || !fov || player.getComponent(PlayerInput)?.embodied !== false) {
			return;
		}
		// The meters of ground one pixel covers where the camera looks; up the screen, the ground is foreshortened.
		const across = (2 * cam.distance * Math.tan((fov * Math.PI) / 360)) / Math.max(1, view.canvas.clientHeight);
		const right = input.lookDeltaX * across;
		const ahead = (input.lookDeltaY * across) / Math.max(0.1, Math.sin(cam.pitch));
		const sin = Math.sin(cam.yaw);
		const cos = Math.cos(cam.yaw);
		const p = player.transform.position;
		p.x += -right * cos - ahead * sin;
		p.z += right * sin - ahead * cos;
		input.lookDeltaX = 0;
		input.lookDeltaY = 0;
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
	private syncSunParts(world:DemoWorld, renderer:Renderer):void {
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
		patchSlates(world, this.model, renderer, this.director);
		patchThinks(this.model, this.director);
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
