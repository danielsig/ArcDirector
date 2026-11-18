import type { Sighting } from '../perception/perception-types.js';
import { displayName } from './text-with-ids.js';

/** What a mind knows about a character it is about to name. `id` is the only identifier; the name is the mind's own. */
export type NameTarget = {
	id:string;
	tags?:string[];
	hp?:number;
	maxHP?:number;
	/** Where it is from the one naming, when it is seen (side and face are the policy's to read); watches and hearing leave it out. */
	sighting?:Sighting;
};

type NameRow = { base:string; name:string };

/** How a name is given: `seen`, its persona made the one named out by sight; `character`, it is a character, not a thing or a place. */
export type Naming = { seen?:boolean; character?:boolean };

export type NameBookJSON = {
	rows:Record<string, NameRow>;
	/** Every name given to an id the book still names, old ones included, so a model's old word still resolves. */
	names:Record<string, string>;
	/** Each vague label held now, by id ({@link NameBook.vague}). */
	vague?:Record<string, string>;
	/** The ids named or labeled that are characters, as each was when named. */
	characters?:string[];
	/** The ids whose own names it learned ({@link NameBook.learned}). */
	learned?:string[];
	/** The word its mind last wrote for each id ({@link NameBook.read}). */
	wrote?:Record<string, string>;
};

/**
 * One persona's names for other characters. The host policy gives a base name; the book keeps it
 * stable, numbers collisions (`EnemyWitch2`), and maps each name back to the real id. What its persona sees but cannot
 * make out it labels by kind ({@link vague}): a name to act on that tells nothing of who it is.
 */
export class NameBook {
	private readonly _rows = new Map<string, NameRow>();
	private readonly _names = new Map<string, string>();
	private readonly _vague = new Map<string, string>();
	/** Each id named or labeled so far, and whether it is a character ({@link isCharacter}). */
	private readonly _characters = new Map<string, boolean>();
	/** The ids it knows by their own names: made out while the policy named them so. Never pruned. */
	private readonly _learned = new Set<string>();
	/** The word its mind last wrote for each id ({@link read}), by which its code shows that id ({@link inCode}). */
	private readonly _wrote = new Map<string, string>();

	/**
	 * This book's name for `id`, given the policy's current `base`. `seen`: its persona made `id` out by sight, so the book
	 * keeps it even under its own id, {@link peek} knows it (a voice it heard is one it can name), and its vague label goes.
	 * Seen under its own id (`base` is `id`), its name is learned: the book keeps it for good ({@link learned}).
	 */
	public name(id:string, base:string, { seen = false, character = false }:Naming = {}):string {
		this.note(id, character);
		const label = seen ? this._vague.get(id) : undefined;
		if (label !== undefined) {
			this._vague.delete(id);
			this._names.delete(label);
		}
		if (seen && base === id) {
			this._learned.add(id);
		}
		const had = this._rows.get(id);
		if (had?.base === base) {
			return had.name;
		}
		if (!had && base === id) {
			if (seen) {
				this._rows.set(id, { base, name: id });
			}
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

	/**
	 * This book's label for `id` while its persona sees it but cannot make it out: `kind` and the first letters, run as
	 * spreadsheet columns, that no name here holds (`FigureA`, `FigureB`, … `FigureAA`; `BookA`). It stays while `id` is
	 * not made out, out of sight too, and goes once it is ({@link name} with `seen`), its letters free again. It resolves
	 * to `id`, so the mind can act on it, but is never its name in what the mind knows ({@link peek} with `vague` off).
	 */
	public vague(id:string, kind:string, character = false):string {
		this.note(id, character);
		const had = this._vague.get(id);
		if (had !== undefined) {
			return had;
		}
		let label = `${kind}A`;
		for (let n = 2; this._names.has(label) || this._rows.has(label); n++) {
			label = kind + columnLetters(n);
		}
		this._vague.set(id, label);
		this._names.set(label, id);
		return label;
	}

	/** The name shown for `id` now, if any: while it is vague (`vague`, default) its label, else the name given. Never assigns. */
	public peek(id:string, vague = true):string | undefined {
		return (vague ? this._vague.get(id) : undefined) ?? this._rows.get(id)?.name;
	}

	/**
	 * The id behind `word`, a word its mind wrote, as {@link resolve} reads it; kept as the word it wrote for that id
	 * ({@link inCode}). Written by its vague label, an id is one it acts on without knowing who it is; written by any
	 * other name, one whose name it knows (from its goals, say).
	 */
	public read(word:string):string {
		const id = this.resolve(word);
		this._wrote.set(id, word);
		return id;
	}

	/**
	 * `id` as code shows it to its mind (arcs, laws, watches, whoever wrote them): its vague label while the mind last
	 * wrote that ({@link read}); else the name it gave; else, while vague, its label, unless the mind wrote the id itself
	 * (a name it knows, from its goals, say); else the id.
	 */
	public inCode(id:string):string {
		const wrote = this._wrote.get(id);
		const label = this._vague.get(id);
		return (wrote === label ? label : undefined) ?? this._rows.get(id)?.name ?? (wrote === undefined ? label : undefined) ?? id;
	}

	private note(id:string, character:boolean):void {
		this._characters.set(id, character || this._characters.get(id) === true);
	}

	/** Whether `id` is a character, as the book recorded when it named it; `undefined` for an id it never named. */
	public isCharacter(id:string):boolean | undefined {
		return this._characters.get(id);
	}

	/** Whether it learned `id`'s own name: made it out while its naming policy called it by its id (an introduction, a known face). */
	public learned(id:string):boolean {
		return this._learned.has(id);
	}

	/** `id` as a screen shows this book's name for it, a vague label too: `Old Bram`, `silver trout`, `Figure A`, `book A` ({@link displayName}). */
	public display(id:string):string {
		return displayName(this.peek(id) ?? id, this.isCharacter(id));
	}

	/**
	 * The id a name this book gave (not a vague label) stands for, or the id of one it made out under its own id (a
	 * learned name); `undefined` for any other word. What a mind's own words are kept by ({@link parseTextWithIDs}).
	 */
	public idOf(name:string):string | undefined {
		const id = this._names.get(name);
		if (id !== undefined) {
			return this._vague.get(id) === name ? undefined : id;
		}
		return this._learned.has(name) ? name : undefined;
	}

	/**
	 * Drops each name whose id `used` lacks (nothing its mind still holds names it), so the book does not grow with every
	 * passer-by. Kept anyway: a name it learned ({@link learned}), and an unsuffixed name while a suffixed sibling
	 * (`Bram2`) stays, so the two never swap. A vague label goes with its id, and when made out; the word its mind wrote, with its id.
	 */
	public prune(used:ReadonlySet<string>):void {
		for (const [id, label] of this._vague) {
			if (!used.has(id)) {
				this._vague.delete(id);
				this._names.delete(label);
			}
		}
		const rows = [...this._rows];
		const kept = new Set(rows.filter(([id]) => used.has(id) || this._learned.has(id)).map(([id]) => id));
		for (const [id, row] of rows) {
			if (kept.has(id) || (row.name === row.base && rows.some(([other, sibling]) => kept.has(other) && sibling.base === row.base))) {
				continue;
			}
			this._rows.delete(id);
		}
		for (const [name, id] of this._names) {
			if (!this._rows.has(id) && !this._vague.has(id)) {
				this._names.delete(name);
			}
		}
		for (const id of this._wrote.keys()) {
			if (!used.has(id)) {
				this._wrote.delete(id);
			}
		}
		for (const id of this._characters.keys()) {
			if (!this._rows.has(id) && !this._vague.has(id) && !used.has(id) && !this._learned.has(id)) {
				this._characters.delete(id);
			}
		}
	}

	/** Every id this book has named. */
	public ids():string[] {
		return [...this._rows.keys()];
	}

	/** Real id for a name this book gave, its vague labels too unless `vague` is off. Anything else passes through. */
	public resolve(name:string, vague = true):string {
		const id = this._names.get(name);
		return id === undefined || (!vague && this._vague.get(id) === name) ? name : id;
	}

	public toJSON():NameBookJSON {
		return { rows: Object.fromEntries(this._rows), names: Object.fromEntries(this._names), vague: Object.fromEntries(this._vague), characters: [...this._characters].filter(([, character]) => character).map(([id]) => id), learned: [...this._learned], wrote: Object.fromEntries(this._wrote) };
	}

	public load(json:NameBookJSON | undefined):void {
		for (const [id, row] of Object.entries(json?.rows ?? {})) {
			this._rows.set(id, { ...row });
		}
		for (const [name, id] of Object.entries(json?.names ?? {})) {
			this._names.set(name, id);
		}
		for (const [id, label] of Object.entries(json?.vague ?? {})) {
			this._vague.set(id, label);
		}
		for (const id of json?.learned ?? []) {
			this._learned.add(id);
		}
		for (const [id, word] of Object.entries(json?.wrote ?? {})) {
			this._wrote.set(id, word);
		}
		for (const id of [...Object.keys(json?.rows ?? {}), ...Object.keys(json?.vague ?? {})]) {
			this.note(id, json?.characters?.includes(id) ?? false);
		}
	}
}

/** The `n`th spreadsheet column's letters, from 1: `A` … `Z`, `AA`, `AB`. */
function columnLetters(n:number):string {
	let letters = '';
	for (let left = n; left > 0; left = Math.floor((left - 1) / 26)) {
		letters = String.fromCharCode(65 + ((left - 1) % 26)) + letters;
	}
	return letters;
}
