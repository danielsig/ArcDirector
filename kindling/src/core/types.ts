import type { Component } from './Component.js';

/** Any class, abstract ones included (for lookups such as `getComponent`). */
export type Constructor<T> = abstract new (...args:never[])=>T;

/** Fields `addComponent` sets before `awake`. */
export type ComponentInit<T> = Partial<Omit<T, keyof Component>> & { enabled?:boolean };

export type ComponentClass<T> = Constructor<T> & {
	/** Lower runs first within `update` / `fixedUpdate` / `lateUpdate`. */
	order?:number;
	update?(dt:number, list:T[]):void;
	fixedUpdate?(dt:number, list:T[]):void;
	lateUpdate?(dt:number, list:T[]):void;
};
