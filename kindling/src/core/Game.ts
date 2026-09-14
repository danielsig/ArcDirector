import { World } from './World.js';
import { Time, MAX_DT } from './Time.js';
import { dispatch, flushStart } from './dispatch.js';
import { stepPhysics } from './physics.js';
import { Renderer } from '../render/Renderer.js';
import type { GameObject } from './GameObject.js';

function canUseCanvas():boolean {
	return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

/** Kindling owns the canvas, the renderer, and the frame loop. Hosts subclass and override `tick`. */
export class Game<W extends World = World> {
	readonly world:W;
	readonly renderer:Renderer | null;
	running = false;
	/** Canvas draws per second while `document` is unfocused. Simulation still runs every RAF. */
	unfocusedHz = 3;
	private raf = 0;
	private last = 0;
	private lastDraw = 0;

	constructor(world?:W) {
		this.world = world ?? (new World() as W);
		this.renderer = canUseCanvas() ? new Renderer(this.world) : null;
	}

	get canvas():HTMLCanvasElement | null {
		return this.renderer?.canvas ?? null;
	}

	mount(parent:ParentNode):this {
		if (this.canvas) {
			parent.appendChild(this.canvas);
		}
		this.renderer?.resize();
		return this;
	}

	start():void {
		if (this.running) {
			return;
		}
		this.running = true;
		this.last = typeof performance !== 'undefined' ? performance.now() : 0;
		this.onStart();
		if (typeof requestAnimationFrame !== 'function') {
			return;
		}
		this.frame(this.last);
	}

	stop():void {
		this.running = false;
		if (this.raf) {
			cancelAnimationFrame(this.raf);
			this.raf = 0;
		}
	}

	/** One simulation step. Hosts override; do not call `super.tick` if you keep your own order. */
	tick(dt:number):void {
		if (dt > MAX_DT) {
			dt = MAX_DT;
		}
		Time.deltaTime = dt;
		Time.time += dt;
		this.simulate(dt);
	}

	/** Component loop: fixedUpdate, update, physics, lateUpdate. */
	protected simulate(dt:number):void {
		while (Time.time - Time.fixedTime >= Time.fixedDeltaTime) {
			Time.fixedTime += Time.fixedDeltaTime;
			dispatch(this.world, 'fixedUpdate', Time.fixedDeltaTime);
		}
		flushStart(this.world);
		dispatch(this.world, 'update', dt);
		stepPhysics(this.world, dt);
		dispatch(this.world, 'lateUpdate', dt);
		this.world.flushDestroy();
	}

	/** Runs once when `start` begins the loop. */
	protected onStart():void {}

	destroy(go:GameObject):void {
		this.world.destroy(go);
	}

	dispose():void {
		this.stop();
		this.world.audio.dispose();
		this.renderer?.dispose();
	}

	private readonly frame = (now:number):void => {
		if (!this.running) {
			return;
		}
		let dt = (now - this.last) / 1000;
		this.last = now;
		if (dt > MAX_DT) {
			dt = MAX_DT;
		}
		this.tick(dt);
		if (typeof document === 'undefined' || document.hasFocus() || now - this.lastDraw >= 1000 / this.unfocusedHz) {
			this.renderer?.render();
			this.lastDraw = now;
		}
		this.raf = requestAnimationFrame(this.frame);
	};
}
