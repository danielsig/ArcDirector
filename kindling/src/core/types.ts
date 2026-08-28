export type Constructor<T> = new (...args:never[])=>T;

export type ComponentClass<T> = Constructor<T> & {
	/** Lower runs first within `update` / `fixedUpdate` / `lateUpdate`. */
	order?:number;
	update?(dt:number, list:T[]):void;
	fixedUpdate?(dt:number, list:T[]):void;
	lateUpdate?(dt:number, list:T[]):void;
};
