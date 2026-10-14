import { ChunkStreamer, type Renderer, Time, Component } from '@arc-director/kindling';
import { Order } from './order';
import { patchHud, patchInfer, statusLabels } from './patchHud';
import { syncHeldTorchLight } from '../items/heldLight';
import type { GameHost } from '../director/adapter';
import { WorldPresent } from '../render/present';
import type { HudModel } from '../ui/hudModel';
import type { Chunk } from '../world/Chunk';
import { spawnChunkEntities } from '../world/spawn';
import { syncDressingColliders } from '../world/dressingColliders';
import type { World } from './World';

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
		// Props are planned over every loaded chunk, so their colliders follow each load.
		syncDressingColliders(world);
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

export class WorldView extends Component {
	public static override order = Order.present;
	public present = new WorldPresent();
	public getRenderer:()=>Renderer | null = () => null;

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
		this.present.mountGroundBox(world);
		const cam = renderer.findCamera();
		if (cam) {
			this.present.sync(world, cam.native);
		}
		this.present.tickNature(Time.time);
	}
}

/** Writes HudModel after present. Vue SFCs only read that model. */
export class Hud extends Component {
	public static override order = Order.hud;
	public model!:HudModel;
	public director!:GameHost;
	public getRenderer:()=>Renderer | null = () => null;

	public override lateUpdate(dt:number):void {
		this.sync();
	}

	public sync():void {
		const world = this.gameObject.world;
		const renderer = this.getRenderer();
		if (!world || !renderer) {
			return;
		}
		patchHud(world, this.model, renderer, statusLabels(this.director), this.director.scene === 'ruins');
		patchInfer(this.director, this.model);
	}
}

export class HeldTorchLight extends Component {
	public static override order = Order.heldTorch;

	public override update(dt:number):void {
		syncHeldTorchLight(this.gameObject, dt);
	}
}
