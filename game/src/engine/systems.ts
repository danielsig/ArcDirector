import { Component } from './Component';
import type { World } from './World';
import type { Renderer } from '@arc-director/kindling';
import { Order } from './order';
import { patchHud } from './patchHud';
import { syncHeldTorchLight } from '../items/heldLight';
import type { NPCDirector } from '../npc/adapter';
import { WorldPresent } from '../render/present';
import type { HudModel } from '../ui/hudModel';
import { ChunkStreamer } from '../world/ChunkStreamer';

export class DirectorPulse extends Component {
	static override order = Order.director;
	director!:NPCDirector;

	override update(dt:number):void {
		this.director.observe(dt);
		if (!this.gameObject.world?.arcDirectorOn) {
			return;
		}
		this.director.pulse();
	}
}

export class WorldStream extends Component {
	static override order = Order.streaming;
	streamer!:ChunkStreamer;
	onGained:(keys:string[])=>void = () => undefined;
	private stamp = '';

	override lateUpdate(_dt:number):void {
		const world = this.gameObject.world;
		if (!world) {
			return;
		}
		const before = this.stamp;
		this.streamer.tick(world);
		const after = [...world.chunks.keys()].sort().join(';');
		if (after === before) {
			return;
		}
		this.stamp = after;
		const prev = new Set(before.split(';').filter(Boolean));
		const gained:string[] = [];
		for (const key of world.chunks.keys()) {
			if (!prev.has(key)) {
				gained.push(key);
			}
		}
		this.onGained(gained);
	}

	mark(world:World):void {
		this.stamp = [...world.chunks.keys()].sort().join(';');
	}
}

export class GroundPick extends Component {
	static override order = Order.pick;
	getRenderer:()=>Renderer | null = () => null;

	override update(_dt:number):void {
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

	override lateUpdate(_dt:number):void {
		this.sync();
	}

	sync():void {
		const world = this.gameObject.world;
		const renderer = this.getRenderer();
		if (!world || !renderer) {
			return;
		}
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
	director!:NPCDirector;
	getRenderer:()=>Renderer | null = () => null;

	override lateUpdate(_dt:number):void {
		this.sync();
	}

	sync():void {
		const world = this.gameObject.world;
		const renderer = this.getRenderer();
		if (!world || !renderer) {
			return;
		}
		patchHud(world, this.model, renderer, this.director.statusLabels());
		this.director.patchInfer(this.model);
	}
}

export class HeldTorchLight extends Component {
	static override order = Order.heldTorch;

	override update(dt:number):void {
		syncHeldTorchLight(this.gameObject, dt);
	}
}
