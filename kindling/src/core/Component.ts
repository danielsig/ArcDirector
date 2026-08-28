import type { GameObject } from './GameObject.js';

export class Component {
	/** Lower runs first within a dispatch hook. */
	static order = 0;
	gameObject!:GameObject;
	private _enabled = true;
	/** Set after `awake()` has run. */
	awoken = false;
	/** Set after `start()` has run. */
	started = false;

	get enabled():boolean {
		return this._enabled;
	}

	set enabled(value:boolean) {
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

	awake():void {}
	start():void {}
	update(_dt:number):void {}
	fixedUpdate(_dt:number):void {}
	/** After physics. */
	lateUpdate(_dt:number):void {}
	onEnable():void {}
	onDisable():void {}
	onDestroy():void {}
}
