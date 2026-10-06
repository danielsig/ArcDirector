/** What an agent knows about a body it is about to name. `id` is the only identifier; the name is the agent's own. */
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
 * One agent's names for other bodies. The host policy gives a base name; the book keeps it
 * stable, numbers collisions (`EnemyWitch2`), and maps each name back to the real id.
 */
export class NameBook {
	private readonly rows = new Map<string, NameRow>();
	private readonly names = new Map<string, string>();

	/** This agent's name for `id`, given the policy's current `base`. */
	name(id:string, base:string):string {
		const had = this.rows.get(id);
		if (had?.base === base) {
			return had.name;
		}
		if (!had && base === id) {
			return id;
		}
		let name = base;
		for (let n = 2; (this.names.get(name) ?? id) !== id; n++) {
			name = `${base}${n}`;
		}
		this.rows.set(id, { base, name });
		this.names.set(name, id);
		return name;
	}

	/** The name already given to `id`, if any. Never assigns. */
	peek(id:string):string | undefined {
		return this.rows.get(id)?.name;
	}

	/** Real id for a name this book gave. Anything else passes through. */
	resolve(name:string):string {
		return this.names.get(name) ?? name;
	}

	toJSON():NameBookJSON {
		return { rows: Object.fromEntries(this.rows), names: Object.fromEntries(this.names) };
	}

	load(json:NameBookJSON | undefined):void {
		for (const [id, row] of Object.entries(json?.rows ?? {})) {
			this.rows.set(id, { ...row });
		}
		for (const [name, id] of Object.entries(json?.names ?? {})) {
			this.names.set(name, id);
		}
	}
}
