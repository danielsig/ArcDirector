import { type Renderer, Time, Component } from '@arc-director/kindling';
import { Order } from './order';
import { patchGoals, patchInspect, patchHud, patchInfer, patchSlates, patchThinks, statusLabels, type Overheads } from './patch-hud';
import type { GameHost } from '../director/adapter';
import { WorldPresent } from '../render/WorldPresent';
import type { OutskirtHeights, Surface } from '../kit/land/land';
import type { HudView } from '../ui/hud-model';
import type { DemoWorld } from './demo-world';
import { FollowCamera } from './components';
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
		const start = performance.now();
		this.director.pulse(dt);
		this.gameObject.world.perf.add('director', performance.now() - start);
	}
}

export class GroundPick extends Component {
	public static override order = Order.pick;

	public override update(dt:number):void {
		const world = this.gameObject.world;
		const renderer = world?.renderer;
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

	public override update(dt:number):void {
		const world = this.gameObject.world;
		const input = world?.input;
		const player = world?.findByID('Player');
		const cam = world?.findByID('MainCamera')?.getComponent(FollowCamera);
		const view = world?.renderer;
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
	/** The scene's land behind its walls (`Scene.ground`). */
	public ground?:Surface;
	/** Heights past the map's edge (`Scene.outskirts`). */
	public outskirts?:OutskirtHeights;

	public override lateUpdate(dt:number):void {
		const world = this.gameObject.world;
		const renderer = world?.renderer;
		if (!world || !renderer) {
			return;
		}
		this.present.detailMaps = renderer.detailMaps;
		this.present.syncChunks(world);
		this.present.mountOutskirts(world, this.ground, this.outskirts);
		// The sun's shadows cover the map and a margin; the woods past it are shaded by the outskirts' own shade.
		const map = world.terrain.bounds();
		renderer.sunArea = map && { minX: map.minX - SUN_MARGIN, maxX: map.maxX + SUN_MARGIN, minZ: map.minZ - SUN_MARGIN, maxZ: map.maxZ + SUN_MARGIN };
		this.syncSunParts(world, renderer);
		const cam = renderer.findCamera();
		if (cam) {
			this.present.sync(world, cam.native);
		}
		this.present.tickNature(Time.time);
	}

	public override onDestroy():void {
		this.present.dispose();
	}

	/**
	 * The square moving things cast the sun's shadow in follows the player, wider as the camera pulls back. It stays
	 * set (on the map's middle without a player), so its light never comes and goes and shaders never recompile.
	 */
	private syncSunParts(world:DemoWorld, renderer:Renderer):void {
		const player = world.findByID('Player');
		const cam = world.findByID('MainCamera')?.getComponent(FollowCamera);
		const area = renderer.sunArea;
		const { x, z } = player?.transform.position ?? (area ? { x: (area.minX + area.maxX) / 2, z: (area.minZ + area.maxZ) / 2 } : { x: 0, z: 0 });
		const t = cam ? (cam.distance - cam.minDistance) / Math.max(1e-3, cam.maxDistance - cam.minDistance) : 0.5;
		renderer.sunFocus = { x, z, half: (MOVER_SIDE.near + (MOVER_SIDE.far - MOVER_SIDE.near) * Math.min(1, Math.max(0, t))) / 2 };
	}
}

/** Writes the HUD's frame after present; reads the UI's state only to skip what no panel shows. */
export class Hud extends Component {
	public static override order = Order.hud;
	public model!:HudView;
	public director!:GameHost;
	/** Health bars and carried things over the characters (`Scene`). */
	public overheads:Overheads = { healthBars: false };
	/** What the minimap and the goal track last showed. */
	private readonly _shown = { minimapStamp: '', goalsSwapped: false };

	public override lateUpdate(dt:number):void {
		const world = this.gameObject.world;
		const renderer = world?.renderer;
		if (!world || !renderer) {
			return;
		}
		patchHud(world, this.model, renderer, statusLabels(this.director), this.overheads, this._shown);
		patchSlates(world, this.model, renderer, this.director);
		patchThinks(this.model, this.director);
		patchInfer(this.director, this.model);
		patchGoals(world, this.model, renderer, this.director.hooks.goals?.(this.director), this._shown);
		patchInspect(world, this.model, renderer, this.director, this.overheads.inspect ?? false);
	}
}
