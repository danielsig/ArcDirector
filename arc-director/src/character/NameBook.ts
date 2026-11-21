import type { Sighting } from '../perception/perception-types.js';
import { displayName, personOf, voiceOf } from './text-with-ids.js';

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

/** What a mind may know of a character, each apart: how they look, how they sound, what they are called. */
export enum Knows {
	Look = 'look',
	Voice = 'voice',
	Name = 'name',
}

/** All of it: one known wholly. */
export const KNOWS_ALL:readonly Knows[] = [Knows.Look, Knows.Voice, Knows.Name];

/** What a mind knows of everyone where no rules say otherwise: their look and their name, and a voice once it sees them speak. */
const KNOWS_BY_DEFAULT:readonly Knows[] = [Knows.Look, Knows.Name];

/** The label of one it makes out but cannot tell who it is, lettered as a vague one is: `StrangerA`. */
export const STRANGER = 'Stranger';

/** What an {@link unknownName} starts with. */
const UNKNOWN = '$';

/**
 * The real name `id` as a mind wrote it of one it could not tell by it (`$Bram`, {@link NameBook.read}), where who knows
 * whom is the game's (`withAcquaintance`). A watch finds no one by it, and a step aimed by it fails, until the mind would
 * know them ({@link NameBook.unmark}); its model reads the name.
 */
export function unknownName(id:string):string {
	return UNKNOWN + id;
}

/** `text` (an error that quotes a reply as kept) with each {@link unknownName} as its mind wrote it: `$Joe the smith` is `Joe the smith`. */
export function writtenNames(text:string):string {
	return text.replace(/\$(?=[A-Za-z_])/g, '');
}

/** A stranger's row's base: no naming policy's word. */
const STRANGER_BASE = '\u0000stranger';

/**
 * How a name is given: `seen`, its persona made the one named out by sight; `faced`, from in front, as only a face teaches
 * a look (default yes); `character`, it is a character, not a thing or a place.
 */
export type Naming = { seen?:boolean; faced?:boolean; character?:boolean };

/** How its persona heard someone speak: `face`, it saw their face as they did; `named`, they said their own name. */
export type Heard = { face?:boolean; named?:boolean };

export type NameBookJSON = {
	rows:Record<string, NameRow>;
	/** Every name given to an id the book still names, old ones included, so a model's old word still resolves. */
	names:Record<string, string>;
	/** Each vague label held now, by id ({@link NameBook.vague}). */
	vague?:Record<string, string>;
	/** The ids named or labeled that are characters, as each was when named. */
	characters?:string[];
	/** What it learned of each id ({@link NameBook.learn}). */
	knows?:Record<string, Knows[][]>;
	/** The word its mind last wrote for each id ({@link NameBook.read}). */
	wrote?:Record<string, string>;
};

/**
 * One persona's names for other characters. The host policy gives a base name; the book keeps it
 * stable, numbers collisions (`EnemyWitch2`), and maps each name back to the real id. What its persona sees but cannot
 * make out it labels by kind ({@link vague}): a name to act on that tells nothing of who it is. A voice it cannot place
 * goes by a name of its own the same way ({@link hear}): sight and sound name apart until it sees them speak. What it
 * knows of each character, their look, voice and name ({@link Knows}), it holds apart, learned in play ({@link learn})
 * and given by rules ({@link knowsByRule}): one whose look it knows but not whose it is goes by a label ({@link STRANGER}).
 */
export class NameBook {
	private readonly _rows = new Map<string, NameRow>();
	private readonly _names = new Map<string, string>();
	private readonly _vague = new Map<string, string>();
	/** Each id named or labeled so far, and whether it is a character ({@link isCharacter}). */
	private readonly _characters = new Map<string, boolean>();
	/**
	 * What it learned of each id ({@link learn}), each set one way it knows them, its facets met together and so tied (a
	 * look and a voice from seeing them speak); two ways that share a facet are one.
	 */
	private readonly _knows = new Map<string, Set<Knows>[]>();
	/** The word its mind last wrote for each id ({@link read}), by which its code shows that id ({@link inCode}). */
	private readonly _wrote = new Map<string, string>();

	/**
	 * What its persona knows of `id` by standing rules, all of it tied, besides what it learns (`withAcquaintance`).
	 * Unset, everyone's look and name, and whose name the naming policy gives is theirs.
	 */
	public knowsByRule:((id:string)=>readonly Knows[]) | undefined;

	/** Each way it knows `id`: by rule ({@link knowsByRule}), and as it learned them. */
	private ways(id:string):ReadonlySet<Knows>[] {
		return [new Set(this.knowsByRule?.(id) ?? KNOWS_BY_DEFAULT), ...this._knows.get(id) ?? []];
	}

	/** What it knows of `id`, tied or not. */
	public knows(id:string):ReadonlySet<Knows> {
		return new Set(this.ways(id).flatMap((way) => [...way]));
	}

	/** What it knows of `id` tied to `facet` ({@link learn}), `facet` too: every way that holds it, and every way sharing one of theirs. */
	private tiedTo(id:string, facet:Knows):Set<Knows> {
		const ways = this.ways(id);
		const tied = new Set([facet]);
		for (let grew = true; grew;) {
			grew = false;
			for (const way of ways) {
				if ([...way].some((f) => tied.has(f)) && [...way].some((f) => !tied.has(f))) {
					way.forEach((f) => tied.add(f));
					grew = true;
				}
			}
		}
		return tied;
	}

	/** Whether it knows `a` and `b` of `id` as one: the look it sees as the one whose name it knows, say. */
	public ties(id:string, a:Knows, b:Knows):boolean {
		return this.knows(id).has(a) && this.tiedTo(id, a).has(b);
	}

	/** Whether it learned `facet` of `id` in play (or from another book), not by rule. */
	public learned(id:string, facet = Knows.Name):boolean {
		return this._knows.get(id)?.some((way) => way.has(facet)) ?? false;
	}

	/**
	 * What it learns of `id` from meeting `teaches` together (seeing them speak: their look and voice): tied to each way
	 * it knew them that shares one of them (the voice it hears is one it knows, the name it is told one it knew), else a
	 * way of its own, so a look, a voice and a name it met apart are never tied by mistake. What it now knows of them as
	 * one, where that grew; else nothing.
	 */
	public learn(id:string, teaches:readonly Knows[]):Knows[] {
		const ways = this._knows.get(id) ?? [];
		const joined = ways.filter((way) => teaches.some((facet) => way.has(facet)));
		const tie = new Set([...teaches, ...joined.flatMap((way) => [...way])]);
		if (joined.length === 1 && joined[0].size === tie.size) {
			return [];
		}
		const before = this.tiedTo(id, teaches[0]);
		this._knows.set(id, [...ways.filter((way) => !joined.includes(way)), tie]);
		const after = this.tiedTo(id, teaches[0]);
		return after.size > before.size ? [...after] : [];
	}

	/** The name it knows `id` by, where it knows their name: the name it gave, else their own (while their look is a stranger's). */
	public knownName(id:string):string | undefined {
		const row = this._rows.get(id);
		return !this.knows(id).has(Knows.Name) ? undefined : row && row.base !== STRANGER_BASE ? row.name : id;
	}

	/** Whether it can tell who `id` is on sight: their look, as whose it is. */
	public tells(id:string):boolean {
		return this.ties(id, Knows.Look, Knows.Name);
	}

	/** Whether it ties `id`'s voice to their look or their name. */
	private tied(id:string):boolean {
		return this.ties(id, Knows.Voice, Knows.Look) || this.ties(id, Knows.Voice, Knows.Name);
	}

	/**
	 * This book's name for `id`, given the policy's current `base`. `seen`: its persona made `id` out by sight, so the book
	 * keeps it even under its own id, {@link peek} knows it (a voice it heard is one it can name), and its vague label goes;
	 * a character seen `faced` teaches its look. Under its own id only once it can tell who that is, else a label kept for
	 * good ({@link STRANGER}). Seen under its own id, its name is learned: the book keeps it for good.
	 */
	public name(id:string, base:string, { seen = false, faced = true, character = false }:Naming = {}):string {
		this.note(id, character);
		const label = seen ? this._vague.get(id) : undefined;
		if (label !== undefined) {
			this._vague.delete(id);
			this._names.delete(label);
		}
		// Without rules everyone's look is known: a look learned is kept, so only where there are rules is it learned.
		if (seen && faced && character && this.knowsByRule) {
			this.learn(id, [Knows.Look]);
		}
		const given = base === id && !this.tells(id) ? STRANGER_BASE : base;
		if (seen && given === id) {
			this.learn(id, [Knows.Name]);
		}
		const had = this._rows.get(id);
		if (had?.base === given) {
			return had.name;
		}
		if (!had && given === id) {
			if (seen) {
				this._rows.set(id, { base: given, name: id });
			}
			return id;
		}
		let name = given === STRANGER_BASE ? this.freeLabel(STRANGER) : given;
		for (let n = 2; (this._names.get(name) ?? id) !== id; n++) {
			name = `${given}${n}`;
		}
		this._rows.set(id, { base: given, name });
		this._names.set(name, id);
		return name;
	}

	/** What `other` knows, and each name it gave that this book has none for, as `other` gave it (a drone of a shared mind takes the hive's). */
	public takeNames(other:NameBook):void {
		for (const [id, ways] of other._knows) {
			ways.forEach((way) => this.learn(id, [...way]));
		}
		for (const [id, row] of other._rows) {
			if (!this._rows.has(id)) {
				this.name(id, row.base, { character: other._characters.get(id) ?? false });
			}
		}
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
		const label = this.freeLabel(kind);
		this._vague.set(id, label);
		this._names.set(label, id);
		return label;
	}

	/**
	 * Its persona heard `id` speak, as `heard` says. It learns the voice ({@link learn}), tied to their look where it saw
	 * their face, and to their name where they said it. Tied, the voice reads as `id` does, and its label goes (still
	 * resolving while its mind's words use it). Else the voice goes by a label of its own ({@link labelVoice}). What it
	 * learned anew.
	 */
	public hear(id:string, { face = false, named = false }:Heard = {}):Knows[] {
		const learned = this.learn(id, [Knows.Voice, ...face ? [Knows.Look] : [], ...named ? [Knows.Name] : []]);
		if (this.tied(id)) {
			this._rows.delete(voiceOf(id));
		}
		else {
			this.labelVoice(id);
		}
		return learned;
	}

	/**
	 * A label for `id`'s voice (`VoiceA`) while it cannot tie that voice to their look or name, apart from any name `id`
	 * has here: acted on, it is `id`, but nothing tells who it is.
	 */
	public labelVoice(id:string):void {
		const voice = voiceOf(id);
		if (!this._rows.has(voice)) {
			const label = this.freeLabel('Voice');
			this.note(voice, true);
			this._rows.set(voice, { base: label, name: label });
			this._names.set(label, voice);
		}
	}

	/** `kind` and the first letters, run as spreadsheet columns, that no name here holds: `FigureA`, `VoiceB`, `FigureAA`. */
	private freeLabel(kind:string):string {
		let label = `${kind}A`;
		for (let n = 2; this._names.has(label) || this._rows.has(label); n++) {
			label = kind + columnLetters(n);
		}
		return label;
	}

	/**
	 * The name shown for `id` now, if any: while it is vague (`vague`, default) its label, else the name given. A voice
	 * ({@link voiceOf}) tied to whose it is reads by their name where it knows it, else as their look does; else by its own
	 * label. A person it knows only by voice, or whom its mind last named by voice, by that voice's label. Never assigns.
	 */
	public peek(id:string, vague = true):string | undefined {
		const person = personOf(id);
		if (person !== id) {
			return !this.tied(person) ? this._rows.get(id)?.name
				// Its name heard in their own voice, their look not tied to it: the name is the voice's, the look a stranger's.
				: this.ties(person, Knows.Voice, Knows.Name) && !this.tells(person) ? this.knownName(person) : this.peek(person, false);
		}
		const voice = this.voiceLabel(id);
		if (voice !== undefined && ((!this._rows.has(id) && !this._vague.has(id)) || this._wrote.get(id) === voice)) {
			return voice;
		}
		return (vague ? this._vague.get(id) : undefined) ?? this._rows.get(id)?.name;
	}

	/**
	 * The id to name `id` by as heard: its voice's while it has a label of its own, or is tied to their name but not to
	 * their look (the name is the voice's, the look a stranger's); else `id`.
	 */
	public heardAs(id:string):string {
		return this.voiceLabel(id) !== undefined || (this.tied(id) && !this.tells(id)) ? voiceOf(id) : id;
	}

	/** The label of `id`'s voice while it cannot tie that voice to their look or their name. */
	private voiceLabel(id:string):string | undefined {
		return this.tied(id) ? undefined : this._rows.get(voiceOf(id))?.name;
	}

	/**
	 * The id behind `word`, a word its mind wrote, as {@link resolve} reads it; kept as the word it wrote for that id
	 * ({@link inCode}). Written by its vague label, an id is one it acts on without knowing who it is; written by any
	 * other name, one whose name it knows (from its goals, say). The real name of one it could not tell by it, where there
	 * are rules ({@link knowsByRule}), is kept as that name ({@link unknownName}): no one, until it can ({@link unmark}).
	 */
	public read(word:string):string {
		const id = this.resolve(word);
		if (id === word && this.knowsByRule && !this.knowsByName(id)) {
			return unknownName(id);
		}
		this._wrote.set(id, word);
		return id;
	}

	/**
	 * What `word` is, where it is a label of its own for a character: a stranger's (`StrangerA`), a voice's (`VoiceA`) or a
	 * figure's too far to make out (`FigureA`), with whom it stands for. A label it has put a name to since is a name.
	 */
	public labelOf(word:string):{ id:string; kind:'stranger' | 'voice' | 'figure' } | undefined {
		const id = this._names.get(word);
		if (id === undefined) {
			return undefined;
		}
		if (personOf(id) !== id) {
			return this._rows.get(id)?.name === word ? { id: personOf(id), kind: 'voice' } : undefined;
		}
		if (this._vague.get(id) === word) {
			return this._characters.get(id) ? { id, kind: 'figure' } : undefined;
		}
		const row = this._rows.get(id);
		return row?.base === STRANGER_BASE && row.name === word ? { id, kind: 'stranger' } : undefined;
	}

	/** Whether it would know `id` by their name: on sight or by voice. */
	public knowsByName(id:string):boolean {
		return this.ties(id, Knows.Name, Knows.Look) || this.ties(id, Knows.Name, Knows.Voice);
	}

	/** The one an {@link unknownName} `word` stands for, once it would know them by it; else undefined. */
	public unmark(word:string):string | undefined {
		const id = word.startsWith(UNKNOWN) ? word.slice(UNKNOWN.length) : undefined;
		return id !== undefined && this.knowsByName(id) ? id : undefined;
	}

	/**
	 * `id` as code shows it to its mind (arcs, laws, watches, whoever wrote them): its vague label while the mind last
	 * wrote that ({@link read}); else the name it gave; else, while vague, its label, unless the mind wrote the id itself
	 * (a name it knows, from its goals, say); else the id.
	 */
	public inCode(id:string):string {
		if (id.startsWith(UNKNOWN)) {
			return id.slice(UNKNOWN.length);
		}
		const wrote = this._wrote.get(id);
		const labels = [this._vague.get(id), this.voiceLabel(id)].filter((label) => label !== undefined);
		return labels.find((label) => label === wrote) ?? this._rows.get(id)?.name ?? (wrote === undefined ? labels[0] : undefined) ?? id;
	}

	private note(id:string, character:boolean):void {
		this._characters.set(id, character || this._characters.get(id) === true);
	}

	/** Whether `id` is a character, as the book recorded when it named it; `undefined` for an id it never named. */
	public isCharacter(id:string):boolean | undefined {
		return this._characters.get(id);
	}

	/** `id` as a screen shows this book's name for it, a vague label too: `Old Bram`, `silver trout`, `Figure A`, `book A` ({@link displayName}). */
	public display(id:string):string {
		return displayName(this.peek(id) ?? personOf(id), this.isCharacter(id));
	}

	/**
	 * The id a name this book gave (not a vague label) stands for, a voice's label its voice ({@link voiceOf}), or the id
	 * of one it made out under its own id (a learned name); `undefined` for any other word. What a mind's own words are
	 * kept by ({@link parseTextWithIDs}): a note of a voice reads as its person once it knows that voice.
	 */
	public idOf(name:string):string | undefined {
		const id = this._names.get(name);
		if (id !== undefined) {
			return this._vague.get(id) === name ? undefined : id;
		}
		return this.learned(name) ? name : undefined;
	}

	/**
	 * Drops each name whose id `used` lacks (nothing its mind still holds names it), so the book does not grow with every
	 * passer-by. Kept anyway: one whose look or name it learned ({@link learn}), and an unsuffixed name while a suffixed sibling
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
		const kept = new Set(rows.filter(([id]) => used.has(id) || this.lasting(id)).map(([id]) => id));
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
		// A voice it knows goes with the name of its person, and with its own label.
		for (const id of this._knows.keys()) {
			if (!this.lasting(id) && !this._rows.has(id) && !this._rows.has(voiceOf(id))) {
				this._knows.delete(id);
			}
		}
		for (const id of this._wrote.keys()) {
			if (!used.has(id)) {
				this._wrote.delete(id);
			}
		}
		for (const id of this._characters.keys()) {
			if (!this._rows.has(id) && !this._vague.has(id) && !used.has(id) && !this.lasting(id)) {
				this._characters.delete(id);
			}
		}
	}

	/**
	 * Whether it keeps `id` for good: it learned their name, or where there are rules ({@link knowsByRule}), their look.
	 * Without rules everyone's look is known, and a voice goes with its person.
	 */
	private lasting(id:string):boolean {
		return this.learned(id, Knows.Name) || (!!this.knowsByRule && this.learned(id, Knows.Look));
	}

	/** Every id this book has named. */
	public ids():string[] {
		return [...this._rows.keys()];
	}

	/** Real id for a name this book gave, its vague labels too unless `vague` is off, and a voice's: its person's. Anything else passes through. */
	public resolve(name:string, vague = true):string {
		const id = this._names.get(name);
		return id === undefined || (!vague && this._vague.get(id) === name) ? name : personOf(id);
	}

	public toJSON():NameBookJSON {
		return { rows: Object.fromEntries(this._rows), names: Object.fromEntries(this._names), vague: Object.fromEntries(this._vague), characters: [...this._characters].filter(([, character]) => character).map(([id]) => id), knows: Object.fromEntries([...this._knows].map(([id, ways]) => [id, ways.map((way) => [...way])])), wrote: Object.fromEntries(this._wrote) };
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
		for (const [id, ways] of Object.entries(json?.knows ?? {})) {
			this._knows.set(id, ways.map((way) => new Set(way)));
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
