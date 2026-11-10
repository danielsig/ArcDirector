/** What a mind knows about a character it is about to name. `id` is the only identifier; the name is the mind's own. */
export type NameTarget = {
	id:string;
	tags?:string[];
	hp?:number;
	maxHP?:number;
};

type NameRow = { base:string; name:string };

export type NameBookJSON = {
	rows:Record<string, NameRow>;
	/** Every name ever given, old ones included, so memories still resolve. */
	names:Record<string, string>;
};

/**
 * One persona's names for other characters. The host policy gives a base name; the book keeps it
 * stable, numbers collisions (`EnemyWitch2`), and maps each name back to the real id.
 */
export class NameBook {
	private readonly _rows = new Map<string, NameRow>();
	private readonly _names = new Map<string, string>();

	/** This book's name for `id`, given the policy's current `base`. */
	public name(id:string, base:string):string {
		const had = this._rows.get(id);
		if (had?.base === base) {
			return had.name;
		}
		if (!had && base === id) {
			return id;
		}
		let name = base;
		for (let n = 2; (this._names.get(name) ?? id) !== id; n++) {
			name = `${base}${n}`;
		}
		this._rows.set(id, { base, name });
		this._names.set(name, id);
		return name;
	}

	/** The name already given to `id`, if any. Never assigns. */
	public peek(id:string):string | undefined {
		return this._rows.get(id)?.name;
	}

	/** Every id this book has named. */
	public ids():string[] {
		return [...this._rows.keys()];
	}

	/** Real id for a name this book gave. Anything else passes through. */
	public resolve(name:string):string {
		return this._names.get(name) ?? name;
	}

	public toJSON():NameBookJSON {
		return { rows: Object.fromEntries(this._rows), names: Object.fromEntries(this._names) };
	}

	public load(json:NameBookJSON | undefined):void {
		for (const [id, row] of Object.entries(json?.rows ?? {})) {
			this._rows.set(id, { ...row });
		}
		for (const [name, id] of Object.entries(json?.names ?? {})) {
			this._names.set(name, id);
		}
	}
}
