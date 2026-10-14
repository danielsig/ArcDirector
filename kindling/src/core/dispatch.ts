import { Component } from './Component.js';
import type { ComponentClass } from './types.js';
import type { World } from './World.js';

type Hook = 'update' | 'fixedUpdate' | 'lateUpdate';

function overridden(c:Component, hook:Hook):boolean {
	return c[hook] !== Component.prototype[hook];
}

function staticHook<T extends Component>(
	ctor:ComponentClass<T>,
	hook:Hook,
):((dt:number, list:T[])=>void) | undefined {
	if (!Object.hasOwn(ctor, hook)) {
		return undefined;
	}
	const fn = ctor[hook];
	if (typeof fn === 'function') {
		return fn as (dt:number, list:T[])=>void;
	}
	return undefined;
}

export function dispatch(
	world:World,
	hook:Hook,
	dt:number,
):void {
	const groups = new Map<ComponentClass<Component>, Component[]>();
	for (const go of world.objects) {
		for (const c of go.components()) {
			if (!c.enabled) {
				continue;
			}
			const ctor = c.constructor as ComponentClass<Component>;
			let list = groups.get(ctor);
			if (!list) {
				list = [];
				groups.set(ctor, list);
			}
			list.push(c);
		}
	}
	const ordered = [...groups.entries()].sort((a, b) => {
		return (a[0].order ?? 0) - (b[0].order ?? 0);
	});
	for (const [ctor, list] of ordered) {
		const batch = staticHook(ctor, hook);
		if (batch) {
			batch(dt, list);
		}
		for (const c of list) {
			if (c.enabled && overridden(c, hook)) {
				c[hook](dt * c.gameObject.timeRate);
			}
		}
	}
}

export function flushStart(world:World):void {
	for (const go of world.objects) {
		for (const c of go.components()) {
			if (!c.enabled || c.started) {
				continue;
			}
			c.started = true;
			c.start();
		}
	}
}
