import { Transform } from './Transform.js';
import { Component } from './Component.js';
import type { ComponentInit, Constructor } from './types.js';
import type { World } from './World.js';

let nextSerial = 1;

export function allocID(prefix = 'go'):string {
	return `${prefix}_${nextSerial++}`;
}

/** The serial the next `allocID` uses. */
export function allocSerial():number {
	return nextSerial;
}

export function resetAllocID(next = 1):void {
	nextSerial = next;
}

export class GameObject {
	public id:string;
	public name:string;
	public transform:Transform;
	public world:World | null = null;
	/** How the host rebuilds this object when a save has it and a fresh scene does not. JSON data only. */
	public recipe:unknown;

	private _parent:GameObject | null = null;
	private readonly _children:GameObject[] = [];
	private readonly _comps:Component[] = [];

	constructor(id?:string, name?:string) {
		this.id = id ?? allocID();
		this.name = name ?? this.id;
		this.transform = new Transform();
		this.transform.gameObject = this;
		this.transform.object3D.name = this.name;
		this._comps.push(this.transform);
	}

	/** Attach a new `ctor()`. `init` fields are set before `awake` / `onEnable` (which run now if this is in a world). */
	public addComponent<T extends Component>(ctor:new ()=>T, init?:ComponentInit<T>):T {
		if (ctor.prototype === Transform.prototype || ctor.prototype instanceof Transform) {
			throw new Error('Transform cannot be added; it is already on the GameObject');
		}
		const c = new ctor();
		Object.assign(c, init);
		c.gameObject = this;
		this._comps.push(c);
		if (this.world) {
			c.awoken = true;
			c.awake();
			if (c.enabled) {
				c.onEnable();
			}
		}
		return c;
	}

	/** Detach now: `onDisable` (if enabled) then `onDestroy`, once awoken. A class removes every instance of it; `Transform` is never removed. */
	public removeComponent(target:Component | Constructor<Component>):void {
		if (target === this.transform) {
			throw new Error('Transform cannot be removed');
		}
		const doomed = this._comps.filter((c) => {
			return c !== this.transform && (target instanceof Component ? c === target : c instanceof target);
		});
		for (const c of doomed) {
			this._comps.splice(this._comps.indexOf(c), 1);
			c.enabled = false;
			if (c.awoken) {
				c.onDestroy();
			}
		}
	}

	public getComponent<T>(ctor:Constructor<T>):T | undefined {
		for (const c of this._comps) {
			if (c instanceof ctor) {
				return c;
			}
		}
		return undefined;
	}

	/** `getComponent`, else a new `ctor()` added now. */
	public getOrAddComponent<T extends Component>(ctor:new ()=>T):T {
		return this.getComponent(ctor) ?? this.addComponent(ctor);
	}

	public getComponentsInChildren<T>(ctor:Constructor<T>):T[] {
		const out:T[] = [];
		const walk = (go:GameObject) => {
			for (const c of go._comps) {
				if (c instanceof ctor) {
					out.push(c);
				}
			}
			for (const child of go.children) {
				walk(child);
			}
		};
		walk(this);
		return out;
	}

	public components():readonly Component[] {
		return this._comps;
	}

	/** Assigning reparents in Kindling and Three.js. World position and rotation stay. */
	public get parent():GameObject | null {
		return this._parent;
	}

	public set parent(parent:GameObject | null) {
		const px = this.transform.position.x;
		const py = this.transform.position.y;
		const pz = this.transform.position.z;
		const pitch = this.transform.pitch;
		const yaw = this.transform.yaw;
		const roll = this.transform.roll;

		if (this._parent) {
			const siblings = this._parent._children;
			const index = siblings.indexOf(this);
			if (index >= 0) {
				siblings.splice(index, 1);
			}
		}
		this._parent = parent;
		if (parent) {
			parent._children.push(this);
			parent.transform.object3D.add(this.transform.object3D);
			if (parent.world && !this.world) {
				parent.world.add(this);
			}
		}
		else if (this.world) {
			this.world.native.add(this.transform.object3D);
		}
		else {
			this.transform.object3D.removeFromParent();
		}

		this.transform.setWorldPosition(px, py, pz);
		this.transform.setWorldRotation(pitch, yaw, roll);
	}

	/** Direct children, in parenting order. */
	public get children():readonly GameObject[] {
		return this._children;
	}

	public awakeAll():void {
		for (const c of this._comps) {
			if (c.awoken) {
				continue;
			}
			c.awoken = true;
			c.awake();
			if (c.enabled) {
				c.onEnable();
			}
		}
		for (const child of this.children) {
			child.awakeAll();
		}
	}
}
