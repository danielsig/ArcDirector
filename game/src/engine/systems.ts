import { Component } from './Component';
import { ChunkStreamer, type Renderer } from '@arc-director/kindling';
import { Order } from './order';
import { patchHud, patchInfer, statusLabels } from './patchHud';
import { syncHeldTorchLight } from '../items/heldLight';
import type { GameHost } from '../npc/adapter';
import { WorldPresent } from '../render/present';
import type { HudModel } from '../ui/hudModel';
import type { Chunk } from '../world/Chunk';
import { spawnChunkEntities } from '../world/spawn';
import type { World } from './World';

export class DirectorPulse extends Component {
	static override order = Order.director;
	director!:GameHost;

	override update(dt:number):void {
		this.director.observe(dt);
		if (!this.gameObject.world?.arcDirectorOn) {
			return;
		}
		this.director.pulse(dt);
	}
}

export class WorldStream extends ChunkStreamer<Chunk> {
	static override order = Order.streaming;

	override spawn(chunk:Chunk):void {
		spawnChunkEntities(this.gameObject.world as World, chunk);
	}
}

export class GroundPick extends Component {
	static override order = Order.pick;
	getRenderer:()=>Renderer | null = () => null;

	override update(dt:number):void {
		this.pickGround();
	}

	pickGround():void {
		const world = this.gameObject.world;
		const renderer = this.getRenderer();
		if (!world || !renderer) {
			if (world) {
				world.input.groundHit = null;
			}
			return;
		}
		const y = world.findByID('Player')?.transform.position.y ?? 0;
		const locked = world.input.pointerLocked;
		world.input.groundHit = renderer.pickGround(
			locked ? 0 : world.input.mouseNdcX,
			locked ? 0 : world.input.mouseNdcY,
			y,
		);
	}
}

export class WorldView extends Component {
	static override order = Order.present;
	present = new WorldPresent();
	getRenderer:()=>Renderer | null = () => null;

	override lateUpdate(dt:number):void {
		this.sync();
	}

	sync():void {
		const world = this.gameObject.world;
		const renderer = this.getRenderer();
		if (!world || !renderer) {
			return;
		}
		this.present.detailMaps = renderer.detailMaps;
		this.present.syncChunks(world);
		this.present.mountGroundBox(world);
		const player = world.findByID('Player');
		if (player) {
			renderer.aimSun(player.transform.position.x, player.transform.position.z);
		}
		const cam = renderer.findCamera();
		if (cam) {
			this.present.sync(world, cam.native);
		}
		this.present.tickNature(world.time);
	}
}

/** Writes HudModel after present. Vue SFCs only read that model. */
export class Hud extends Component {
	static override order = Order.hud;
	model!:HudModel;
	director!:GameHost;
	getRenderer:()=>Renderer | null = () => null;

	override lateUpdate(dt:number):void {
		this.sync();
	}

	sync():void {
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
	static override order = Order.heldTorch;

	override update(dt:number):void {
		syncHeldTorchLight(this.gameObject, dt);
	}
}
