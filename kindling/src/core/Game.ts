import { World } from './World.js';
import { updateEffects } from '../render/effects.js';
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
	public readonly world:W;
	public readonly renderer:Renderer | null;
	public running = false;
	/** Frames still tick and draw, but `Time` stands still and no component runs. */
	public paused = false;
	/** Canvas draws per second while `document` is unfocused. Simulation still runs every RAF. */
	public unfocusedHz = 3;
	private _raf = 0;
	private _last = 0;
	private _lastDraw = 0;

	constructor(world?:W) {
		this.world = world ?? (new World() as W);
		this.renderer = canUseCanvas() ? new Renderer(this.world) : null;
		if (this.renderer) {
			this.world.input.attach(this.renderer.canvas);
		}
	}

	public get canvas():HTMLCanvasElement | null {
		return this.renderer?.canvas ?? null;
	}

	public mount(parent:ParentNode):this {
		if (this.canvas) {
			parent.appendChild(this.canvas);
		}
		this.renderer?.resize();
		return this;
	}

	public start():void {
		if (this.running) {
			return;
		}
		this.running = true;
		this._last = typeof performance !== 'undefined' ? performance.now() : 0;
		this.onStart();
		if (typeof requestAnimationFrame !== 'function') {
			return;
		}
		this._frame(this._last);
	}

	public stop():void {
		this.running = false;
		if (this._raf) {
			cancelAnimationFrame(this._raf);
			this._raf = 0;
		}
	}

	/** One frame: advance `Time` and simulate, unless `paused`. Hosts override to work around it and call `super.tick`. */
	public tick(dt:number):void {
		if (dt > MAX_DT) {
			dt = MAX_DT;
		}
		if (this.paused) {
			return;
		}
		Time.deltaTime = dt;
		Time.time += dt;
		this.simulate(dt);
	}

	/** Component loop: fixedUpdate, start, due `World.after` calls, update, physics, lateUpdate, effects. */
	protected simulate(dt:number):void {
		while (Time.time - Time.fixedTime >= Time.fixedDeltaTime) {
			Time.fixedTime += Time.fixedDeltaTime;
			dispatch(this.world, 'fixedUpdate', Time.fixedDeltaTime);
		}
		flushStart(this.world);
		this.world.runTimers();
		dispatch(this.world, 'update', dt);
		stepPhysics(this.world, dt);
		dispatch(this.world, 'lateUpdate', dt);
		updateEffects();
		this.world.flushDestroy();
	}

	/** Runs once when `start` begins the loop. */
	protected onStart():void {}

	public destroy(go:GameObject):void {
		this.world.destroy(go);
	}

	public dispose():void {
		this.stop();
		this.world.input.detach();
		this.world.audio.dispose();
		this.renderer?.dispose();
	}

	private readonly _frame = (now:number):void => {
		if (!this.running) {
			return;
		}
		let dt = (now - this._last) / 1000;
		this._last = now;
		if (dt > MAX_DT) {
			dt = MAX_DT;
		}
		this.tick(dt);
		this.world.input.endFrame();
		if (typeof document === 'undefined' || document.hasFocus() || now - this._lastDraw >= 1000 / this.unfocusedHz) {
			this.renderer?.render();
			this._lastDraw = now;
		}
		this._raf = requestAnimationFrame(this._frame);
	};
}
