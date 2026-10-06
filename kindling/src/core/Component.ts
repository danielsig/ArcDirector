import type { GameObject } from './GameObject.js';

/** One component's saved fields. JSON data only. */
export type ComponentState = Record<string, unknown>;

export abstract class Component {
	/** Lower runs first within a dispatch hook. */
	static order = 0;
	/** Fields a save keeps (`captureWorld`). JSON data only; everything else rebuilds with the scene. */
	static saved:readonly string[] = [];
	gameObject!:GameObject;
	private isEnabled = true;
	/** Set after `awake()` has run. */
	awoken = false;
	/** Set after `start()` has run. */
	started = false;

	get enabled():boolean {
		return this.isEnabled;
	}

	set enabled(value:boolean) {
		if (value === this.isEnabled) {
			return;
		}
		this.isEnabled = value;
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
	saveState():ComponentState {
		const self = this as unknown as ComponentState;
		const out:ComponentState = {};
		for (const key of (this.constructor as typeof Component).saved) {
			out[key] = structuredClone(self[key]);
		}
		return out;
	}

	/** Apply some or all of what `saveState` returned. */
	loadState(state:ComponentState):void {
		Object.assign(this, structuredClone(state));
	}

	awake():void {}
	start():void {}
	update(dt:number):void {}
	fixedUpdate(dt:number):void {}
	/** After physics. */
	lateUpdate(dt:number):void {}
	onEnable():void {}
	onDisable():void {}
	onDestroy():void {}
}
