import { Transform } from './Transform.js';
import { Component } from './Component.js';
import type { Constructor } from './types.js';
import type { World } from './World.js';

let nextSerial = 1;

export function allocID(prefix = 'go'):string {
	return `${prefix}_${nextSerial++}`;
}

export function resetAllocID():void {
	nextSerial = 1;
}

export class GameObject {
	id:string;
	name:string;
	transform:Transform;
	parent:GameObject | null = null;
	children:GameObject[] = [];
	world:World | null = null;

	private readonly comps:Component[] = [];

	constructor(id?:string, name?:string) {
		this.id = id ?? allocID();
		this.name = name ?? this.id;
		this.transform = new Transform();
		this.transform.gameObject = this;
		this.transform.object3D.name = this.name;
		this.comps.push(this.transform);
	}

	addComponent<T extends Component>(c:T):T {
		if (c instanceof Transform) {
			throw new Error('Transform cannot be added; it is already on the GameObject');
		}
		c.gameObject = this;
		this.comps.push(c);
		if (this.world) {
			c.awoken = true;
			c.awake();
			if (c.enabled) {
				c.onEnable();
			}
		}
		return c;
	}

	getComponent<T>(ctor:Constructor<T>):T | undefined {
		for (const c of this.comps) {
			if (c instanceof ctor) {
				return c;
			}
		}
		return undefined;
	}

	getComponentsInChildren<T>(ctor:Constructor<T>):T[] {
		const out:T[] = [];
		const walk = (go:GameObject) => {
			for (const c of go.comps) {
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

	components():readonly Component[] {
		return this.comps;
	}

	setParent(parent:GameObject | null, worldPositionStays = true):void {
		const px = this.transform.position.x;
		const py = this.transform.position.y;
		const pz = this.transform.position.z;
		const pitch = this.transform.pitch;
		const yaw = this.transform.yaw;
		const roll = this.transform.roll;

		if (this.parent) {
			this.parent.children = this.parent.children.filter((c) => c !== this);
		}
		this.parent = parent;
		if (parent) {
			parent.children.push(this);
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

		if (worldPositionStays) {
			this.transform.setWorldPosition(px, py, pz);
			this.transform.setWorldRotation(pitch, yaw, roll);
		}
	}

	awakeAll():void {
		for (const c of this.comps) {
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
