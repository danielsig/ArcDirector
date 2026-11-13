/**
 * Things by name, in the order added: a director's tools (`withTools`) and senses (`withSenses`). The same name again
 * replaces the one there, in its place.
 */
export class Registry<T> {
	private readonly _all:Record<string, T> = {};
	private readonly _changed:()=>void;

	/** `changed` hears every change. */
	constructor(changed:()=>void = () => undefined) {
		this._changed = changed;
	}

	/** Every one by name, live: one added or removed later shows here too. */
	public get all():Readonly<Record<string, T>> {
		return this._all;
	}

	public add(name:string, item:T):this {
		this._all[name] = item;
		this._changed();
		return this;
	}

	public remove(...names:string[]):this {
		for (const name of names) {
			delete this._all[name];
		}
		this._changed();
		return this;
	}

	public get(name:string):T | undefined {
		return this.has(name) ? this._all[name] : undefined;
	}

	public has(name:string):boolean {
		return Object.hasOwn(this._all, name);
	}
}
