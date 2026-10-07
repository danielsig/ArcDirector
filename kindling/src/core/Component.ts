import type { GameObject } from './GameObject.js';

/** One component's saved fields. JSON data only. */
export type ComponentState = Record<string, unknown>;

export abstract class Component {
	/** Lower runs first within a dispatch hook. */
	public static order = 0;
	/** Fields a save keeps (`captureWorld`). JSON data only; everything else rebuilds with the scene. */
	public static saved:readonly string[] = [];

	public gameObject!:GameObject;
	/** Set after `awake()` has run. */
	public awoken = false;
	/** Set after `start()` has run. */
	public started = false;

	private _enabled = true;

	public get enabled():boolean {
		return this._enabled;
	}

	public set enabled(value:boolean) {
		if (value === this._enabled) {
			return;
		}
		this._enabled = value;
		if (!this.awoken || !this.gameObject?.world) {
			return;
		}
		if (value) {
			this.onEnable();
		}
		else {
			this.onDisable();
		}
	}

	/** The `saved` fields. Override for state that is not a plain field. */
	public saveState():ComponentState {
		const self = this as unknown as ComponentState;
		const out:ComponentState = {};
		for (const key of (this.constructor as typeof Component).saved) {
			out[key] = structuredClone(self[key]);
		}
		return out;
	}

	/** Apply some or all of what `saveState` returned. */
	public loadState(state:ComponentState):void {
		Object.assign(this, structuredClone(state));
	}

	public awake():void {}
	public start():void {}
	public update(dt:number):void {}
	public fixedUpdate(dt:number):void {}
	/** After physics. */
	public lateUpdate(dt:number):void {}
	public onEnable():void {}
	public onDisable():void {}
	public onDestroy():void {}
}
