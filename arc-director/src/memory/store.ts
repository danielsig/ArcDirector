import { namesWord } from '../text.js';
import { joinTextWithIDs, namedText, readTextWithIDs, showTextWithIDs, textSegments, voiceOf, type NamingText, type TextSegment, type TextWithIDs } from '../character/text-with-ids.js';
import { hand, internalsOf } from '../internals.js';
import { writerToID } from '../character/person.js';
import type { JsonValue } from '../json.js';

export type MemoryCategory = 'episodic' | 'semantic' | 'identity';

export interface MemoryRecord {
	id:string;
	category:MemoryCategory;
	/** What it holds, each character and thing it names written as its id; recall searches it so. */
	readonly text:string;
	/**
	 * What it holds in pieces, each character or thing it names a piece with its id, so a host can name it its own way.
	 * The library reads its ids here, so a copy of the record keeps them.
	 */
	segments():TextSegment[];
	/** The characters that know it: who perceived what it tells, or whose note it is. A collective's own id: only its mind knows it. */
	knownBy:string[];
	/** Who wrote it, for a note: its words for itself are kept as its id, and anyone else reads its name in front of a note that names it nowhere. */
	writer?:string;
	tags:string[];
	/** When what it tells happened, in game time: a sighting's, when it was last seen. A rewrite of its text keeps it. */
	timestamp:number;
	pinned?:boolean;
	/** Thinks left before it stops being pinned and only `recall` finds it. Unset: pinned for good. */
	pinnedThinks?:number;
	/**
	 * Its meaning, from the director's one embedding model, once a think needs it (a sighting's never: it changes as it is
	 * seen). Not saved: a load embeds it again, with whatever model embeds then.
	 */
	embedding?:number[];
	/** How readily it comes to mind ({@link MemoryDraft.weight}); 1 when unset. */
	weight?:number;
	/** A sighting's: the state the thing was seen in (`SeenObject.state`). */
	state?:Readonly<Record<string, string>>;
}

export interface MemoryDraft {
	category?:MemoryCategory;
	/** What it holds; a function names characters and things by id, so each mind reads its own names for them. */
	text:NamingText;
	/** Who knows it. Default: the store's owner. */
	knownBy?:string[];
	/** Who wrote it, for a note ({@link MemoryRecord.writer}). */
	writer?:string;
	tags?:string[];
	timestamp?:number;
	pinned?:boolean;
	pinnedThinks?:number;
	embedding?:number[];
	/**
	 * How readily it comes to mind, 1 by default: how relevant it scores, in recall and unbidden, is multiplied by it. Where
	 * the director has an embedding model, any memory may come unbidden on meaning alone, sharing no word or tag with what
	 * is before the mind, and a heavy one far more readily: `The fire took my brother.` at the sight of flames.
	 */
	weight?:number;
	id?:string;
}

/** A memory as a save keeps it. */
export interface MemoryJSON extends Omit<MemoryRecord, 'text' | 'segments' | 'embedding'> {
	text:JsonValue;
}

/** A {@link MemoryDraft} as the library writes one: its text by id already. */
export interface KeptDraft extends Omit<MemoryDraft, 'text'> {
	text:TextWithIDs;
}

/** What a store's constructor hands the library (`internalsOf`): adding and rewriting text that is by id already. */
export interface MemoryFields {
	add(draft:KeptDraft, now?:number):MemoryRecord;
	/** One record per event: `draft` taken in by its holders, or the record of the same text at the same time, now known by them too. */
	perceive(draft:KeptDraft, now?:number):MemoryRecord;
	rewrite(id:string, text:TextWithIDs):MemoryRecord | undefined;
	/** The record `id`, one of the view's holders', leaves the pool: everyone forgets it, not only them (`remove`). Whether there was one. */
	drop(id:string):boolean;
}

/** What `record` holds, characters and things by id: its `segments()` read back. */
export function keptText(record:MemoryRecord):TextWithIDs {
	return joinTextWithIDs(...record.segments().map((piece) => (piece.id === undefined ? piece.text : ['', piece.voice ? voiceOf(piece.id) : piece.id, ''])));
}

/** The fields a record holds `text` in. */
function holding(text:TextWithIDs):Pick<MemoryRecord, 'text' | 'segments'> {
	return { text: showTextWithIDs(text), segments: () => textSegments(text, (id) => id) };
}

export function cosine(a:number[], b:number[]):number {
	const n = Math.min(a.length, b.length);
	if (n === 0) {
		return 0;
	}
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < n; i++) {
		dot += a[i] * b[i];
		na += a[i] * a[i];
		nb += b[i] * b[i];
	}
	const d = Math.sqrt(na) * Math.sqrt(nb);
	return d === 0 ? 0 : dot / d;
}

const NAME_RE = /[A-Z][a-z]+(?:[A-Z][a-z0-9]*)*/g;
const NOT_NAME = new Set([
	'The', 'And', 'For', 'But', 'Not', 'You', 'Your', 'They', 'Them', 'This', 'That',
	'With', 'From', 'Have', 'Were', 'Been', 'Will', 'When', 'What', 'Who', 'How',
	'Last', 'Near', 'Into', 'Then', 'Than',
]);
const STOP = new Set([
	'the', 'and', 'you', 'are', 'for', 'with', 'that', 'this', 'from', 'your',
	'have', 'was', 'were', 'not', 'but', 'they', 'them', 'then', 'than', 'into',
	'near', 'pace', 'paces', 'said', 'says',
]);

/** PascalCase names in English text (EastGate, FireMushroom). Skips sentence-case The/And. */
export function nameTags(text:string):string[] {
	const found = text.match(NAME_RE) ?? [];
	const out:string[] = [];
	const seen = new Set<string>();
	for (const n of found) {
		if (NOT_NAME.has(n) || seen.has(n)) {
			continue;
		}
		seen.add(n);
		out.push(n);
	}
	return out;
}

/** Each id of `lists` once, in the order first met: who knows either. */
export function union(...lists:readonly (readonly string[])[]):string[] {
	return [...new Set(lists.flat())];
}

export function mergeTags(...lists:Array<readonly string[] | undefined>):string[] {
	const out:string[] = [];
	const seen = new Set<string>();
	for (const list of lists) {
		for (const raw of list ?? []) {
			const t = raw.trim();
			if (!t || seen.has(t)) {
				continue;
			}
			seen.add(t);
			out.push(t);
		}
	}
	return out;
}

function lexicalTokens(text:string):string[] {
	const names = nameTags(text).map((n) => n.toLowerCase());
	const words = (text.toLowerCase().match(/[a-z][a-z0-9]{3,}/g) ?? [])
		.filter((w) => !STOP.has(w));
	return [...new Set([...names, ...words])];
}

/** Fraction of query tokens that appear in `text`. Used when embeddings are missing. */
function lexicalOverlap(query:string, text:string):number {
	const q = lexicalTokens(query);
	if (q.length === 0) {
		return 0;
	}
	const t = new Set(lexicalTokens(text));
	if (t.size === 0) {
		return 0;
	}
	let hit = 0;
	for (const w of q) {
		if (t.has(w)) {
			hit += 1;
		}
	}
	return hit / q.length;
}

/** What a tag of `record` shared with what is asked adds to how relevant it is. */
const TAG_HIT = 0.4;
/** What sharing every word asked adds (word overlap, 0–1, times this). */
const WORDS = 0.7;
/** Below this word overlap, and with no tag shared, a memory of weight 1 does not come unbidden. */
const UNBIDDEN_WORDS = 0.15;

/**
 * How much closer (in cosine) a memory that fits what is asked comes to it than a plain memory does: as relevant as a
 * tag shared. The same for small and large embedding models, measured against a baseline ({@link Meaning}).
 */
const MEANING = 0.15;
/**
 * Below this much closer than a plain memory, a memory's meaning counts for nothing, in recall and unbidden alike. Tuned
 * on six settings and checked on four others, with three embedding models: with no bar, recall's five were mostly
 * memories that did not fit (F1 0.30); at 0.18, 1 or 2 a goal, mostly ones that do (F1 0.47).
 */
const MEANING_ALONE = 0.18;

/**
 * What is asked, by meaning: its `embedding`, and its `baseline`, the cosine at which a memory's meaning is no closer
 * to it than a plain memory's (each embedding model has its own; 0 where unknown). Meaning counts only above it.
 */
export type Meaning = { embedding?:undefined; baseline?:undefined } | { embedding:number[]; baseline:number };

/** How readily `record` comes to mind ({@link MemoryDraft.weight}). */
function weightOf(record:MemoryRecord):number {
	return record.weight ?? 1;
}

/**
 * How much closer `record`'s meaning comes to what is asked than a plain memory's ({@link Meaning}): 0 without both, or
 * below {@link MEANING_ALONE}.
 */
function closeness(record:MemoryRecord, { embedding, baseline = 0 }:Meaning):number {
	const closer = embedding && record.embedding ? cosine(embedding, record.embedding) - baseline : 0;
	return closer >= MEANING_ALONE ? closer : 0;
}

/** How relevant `record` is to what is asked: how near its meaning comes, a tag shared, words shared, times its weight. */
function relevance(record:MemoryRecord, meaning:Meaning, hits:number, lex:number, more = 0):number {
	return weightOf(record) * (TAG_HIT * closeness(record, meaning) / MEANING + (hits > 0 ? TAG_HIT : 0) + WORDS * lex + more);
}

/** The most a name's salience adds to a memory about it: more than a tag hit, so what stands before you comes to mind. */
const SALIENCE_BOOST = 0.6;

/** How strongly `salience`'s names bring `record` to mind: the most salient one it is tagged with or names. */
function salienceOf(record:MemoryRecord, salience:ReadonlyMap<string, number> | undefined):number {
	let best = 0;
	for (const [name, weight] of salience ?? []) {
		const lower = name.toLowerCase();
		if (weight > best && (record.tags.some((t) => t.toLowerCase() === lower) || namesWord(record.text, name))) {
			best = weight;
		}
	}
	return best;
}

function tagHits(record:MemoryRecord, tags:string[], query:string):number {
	const q = query.toLowerCase();
	let hits = 0;
	for (const tag of record.tags) {
		const t = tag.toLowerCase();
		if (tags.some((x) => x.toLowerCase() === t) || (t.length > 0 && q.includes(t))) {
			hits += 1;
		}
	}
	return hits;
}

/** What a character of a collective reads while it thinks for itself (`CollectiveSpec.sharing`). */
export enum MemorySharing {
	/** Its own: what it witnessed. A street of people. */
	PerCharacter = 'perCharacter',
	/** The collective's: what any of its characters knows. The Borg. */
	Shared = 'shared',
}

/** What a pool's constructor hands its views (`internalsOf`): its records, a new record's id, and each holder's cap. */
export interface MemoryPoolFields {
	records():MemoryRecord[];
	nextID():string;
	drop(record:MemoryRecord):void;
	capOf(holder:string):number;
	setCap(holder:string, cap:number):void;
}

/**
 * Every memory of a cast, each once, with who knows it ({@link MemoryRecord.knownBy}). A persona's memory is a view of
 * it ({@link view}), so a character and the collective that thinks for it read the same records, and nothing is copied
 * when one leaves or joins.
 */
export class MemoryPool {
	/** The cap on each holder's plain episodic memories, unless one has its own ({@link MemoryStore.maxEpisodic}). */
	public maxEpisodic = 256;
	private _records:MemoryRecord[] = [];
	private _next = 1;
	private readonly _caps = new Map<string, number>();

	constructor() {
		hand(this, {
			records: () => this._records,
			nextID: () => `mem_${this._next++}`,
			drop: (record) => {
				this._records = this._records.filter((r) => r !== record);
			},
			capOf: (holder) => this._caps.get(holder) ?? this.maxEpisodic,
			setCap: (holder, cap) => this._caps.set(holder, cap),
		} satisfies MemoryPoolFields);
	}

	/**
	 * The memory of `owner`: what `holders()` know between them, asked each time it is read. What it keeps is `owner`'s
	 * unless a draft says who knows it.
	 */
	public view(owner:string, holders:()=>readonly string[] = () => [owner]):MemoryStore {
		return new MemoryStore(owner, this, holders);
	}

	public toJSON():MemoryJSON[] {
		return this._records.map((record) => {
			// Its meaning is not kept: a load embeds it again, with whatever model embeds then.
			const { text, segments, embedding, ...r } = record;
			return { ...r, text: [...keptText(record)], knownBy: [...r.knownBy], tags: [...r.tags] };
		});
	}

	/** A saved pool. */
	public static fromJSON(rows:readonly MemoryJSON[]):MemoryPool {
		const pool = new MemoryPool();
		for (const { text, ...row } of rows) {
			pool._records.push({
				...row,
				knownBy: [...row.knownBy],
				tags: [...row.tags],
				...holding(readTextWithIDs(text)),
			});
			const n = Number(row.id.replace(/^mem_/, ''));
			pool._next = Number.isFinite(n) && n >= pool._next ? n + 1 : pool._next;
		}
		return pool;
	}
}

/**
 * A persona's memory: what its holders know between them in its pool (a pool of its own unless given one). A
 * character's holders are itself; a collective's are itself and its characters, as they are when it is read. Pinned
 * memories are its owner's own.
 */
export class MemoryStore {
	/** Whose memory it is: who knows what it keeps unless a draft says otherwise. */
	public readonly owner:string;
	private readonly _pool:MemoryPool;
	private readonly _holders:()=>readonly string[];

	constructor(owner:string, pool = new MemoryPool(), holders:()=>readonly string[] = () => [owner]) {
		this.owner = owner;
		this._pool = pool;
		this._holders = holders;
		hand(this, {
			add: (draft, now) => this.keep(draft, now),
			perceive: (draft, now) => this.keep(draft, now, true),
			rewrite: (id, text) => this.retext(id, text),
			drop: (id) => {
				const record = this.all().find((r) => r.id === id);
				if (record) {
					internalsOf(this._pool).drop(record);
				}
				return !!record;
			},
		} satisfies MemoryFields);
	}

	/** The most plain episodic memories its owner keeps; past it the oldest it alone knew go. The pool's cap until set. */
	public get maxEpisodic():number {
		return internalsOf(this._pool).capOf(this.owner);
	}

	public set maxEpisodic(cap:number) {
		internalsOf(this._pool).setCap(this.owner, cap);
	}

	public add(draft:MemoryDraft, now = draft.timestamp ?? 0):MemoryRecord {
		return this.keep({ ...draft, text: namedText(draft.text) }, now);
	}

	/** `draft` as a record; with `perceived`, the record of the same text at the same time, if there is one, known by more. */
	private keep(draft:KeptDraft, now = draft.timestamp ?? 0, perceived = false):MemoryRecord {
		const pool = internalsOf(this._pool);
		// A note: its words for its writer are kept as the writer's id.
		const fields = holding(draft.writer === undefined ? draft.text : writerToID(draft.text, draft.writer));
		const timestamp = draft.timestamp ?? now;
		const category = draft.category ?? 'episodic';
		const knownBy = draft.knownBy ?? [this.owner];
		const last = perceived ? this.all().at(-1) : undefined;
		const same = last?.text === fields.text ? last : perceived ? pool.records().find((r) => r.text === fields.text && r.timestamp === timestamp) : undefined;
		const rec:MemoryRecord = same ?? {
			id: draft.id ?? pool.nextID(),
			category,
			knownBy: [],
			...draft.writer === undefined ? {} : { writer: draft.writer },
			tags: draft.tags ? [...draft.tags] : [],
			timestamp,
			pinned: draft.pinned,
			pinnedThinks: draft.pinnedThinks,
			embedding: draft.embedding ? [...draft.embedding] : undefined,
			...draft.weight === undefined || draft.weight === 1 ? {} : { weight: draft.weight },
			...fields,
		};
		rec.knownBy = union(rec.knownBy, knownBy);
		if (!same) {
			pool.records().push(rec);
		}
		this.evict(knownBy);
		return rec;
	}

	/** Whether one of its holders knows `record`. */
	private knows(record:MemoryRecord, holders = this._holders()):boolean {
		return record.knownBy.some((id) => holders.includes(id));
	}

	public all():MemoryRecord[] {
		const holders = this._holders();
		return internalsOf(this._pool).records().filter((r) => this.knows(r, holders));
	}

	/** Its owner's pinned memories: a collective pins its own, never its characters'. */
	public pinned():MemoryRecord[] {
		return this.all().filter((r) => r.pinned && r.knownBy.includes(this.owner));
	}

	/** A think read the pins: those pinned for some thinks count down, and any run out become plain memories. */
	public agePins():void {
		for (const record of this.pinned()) {
			if (record.pinnedThinks !== undefined && --record.pinnedThinks <= 0) {
				record.pinned = false;
				record.pinnedThinks = undefined;
			}
		}
	}

	/**
	 * What recall searches: every lasting fact its holders know, and of their plain episodic memories the newest its
	 * owner's cap allows, so a collective of many characters searches no more than one character does.
	 */
	private recallable():MemoryRecord[] {
		const all = this.all();
		const episodic = all.filter((r) => r.category === 'episodic' && !r.pinned);
		if (episodic.length <= this.maxEpisodic) {
			return all;
		}
		const older = new Set([...episodic].sort((a, b) => b.timestamp - a.timestamp).slice(this.maxEpisodic));
		return all.filter((r) => !older.has(r));
	}

	/** Its `k` memories most relevant to `query` (by its words, and by its {@link Meaning} where given), the newer of two as relevant, newest first. */
	public recall(opts:Meaning & {
		query:string;
		k?:number;
		tags?:string[];
		category?:MemoryCategory;
		/** Records the caller already shows; skipped before the top `k`, so they do not take its places. */
		skip?:(record:MemoryRecord)=>boolean;
		/**
		 * Names now before the mind, each with how much it should bring its memories to mind (0–1): what it sees close
		 * in front, what it carries. A memory tagged with one, or naming it, scores up to {@link SALIENCE_BOOST} more.
		 */
		salience?:ReadonlyMap<string, number>;
	}):MemoryRecord[] {
		const k = opts.k ?? 5;
		const tags = opts.tags ?? [];
		const scored = this.recallable()
			.filter((r) => (opts.category === undefined || r.category === opts.category) && !opts.skip?.(r))
			.map((record) => ({
				record,
				value: relevance(record, opts, tagHits(record, tags, opts.query), lexicalOverlap(opts.query, record.text), SALIENCE_BOOST * salienceOf(record, opts.salience)),
			}))
			.filter((s) => s.value > 0)
			// The newer of two as relevant: what is current wins a tie, not what came first.
			.sort((a, b) => b.value - a.value || b.record.timestamp - a.record.timestamp)
			.slice(0, k);
		// Newest first: a small model acts on the first it reads, so what is current comes first.
		return scored.map((s) => s.record).sort((a, b) => b.timestamp - a.timestamp);
	}

	/**
	 * The memory `query` (what is before the mind, and its {@link Meaning}) and `tags` (of what just happened) bring to mind
	 * unbidden: the most relevant above `threshold` that shares a tag or some words with them, or comes near them in
	 * meaning, a heavy one ({@link MemoryDraft.weight}) more readily.
	 */
	public intrusion(opts:Meaning & {
		query:string;
		tags?:string[];
		/** How much more readily the mind's mood brings `record` to mind (1: no more): mood-congruent recall. */
		mood?:(record:MemoryRecord)=>number;
		threshold?:number;
	}):MemoryRecord | null {
		let best:MemoryRecord | null = null;
		let bestScore = opts.threshold ?? 0.55;
		for (const record of this.recallable()) {
			// A pinned memory is in every prompt already.
			if (record.pinned) {
				continue;
			}
			const lex = lexicalOverlap(opts.query, record.text);
			const hits = tagHits(record, opts.tags ?? [], opts.query);
			if (hits === 0 && lex < UNBIDDEN_WORDS && closeness(record, opts) === 0) {
				continue;
			}
			const value = relevance(record, opts, hits, lex) * (opts.mood?.(record) ?? 1);
			if (value > bestScore) {
				bestScore = value;
				best = record;
			}
		}
		return best;
	}

	/** Its holders forget the record `id`; it goes with its last holder. False when it has none. */
	public remove(id:string):boolean {
		const holders = this._holders();
		const record = this.all().find((r) => r.id === id);
		if (!record) {
			return false;
		}
		record.knownBy = record.knownBy.filter((who) => !holders.includes(who));
		if (record.knownBy.length === 0) {
			internalsOf(this._pool).drop(record);
		}
		return true;
	}

	/**
	 * New text for the record `id`, for its holders. Known by others too, it is copied first, and they keep it as it
	 * was: the record returned is the one with the new text. Its embedding no longer fits the text, so it is dropped.
	 */
	public rewrite(id:string, text:NamingText):MemoryRecord | undefined {
		return this.retext(id, namedText(text));
	}

	private retext(id:string, text:TextWithIDs):MemoryRecord | undefined {
		const holders = this._holders();
		const record = this.all().find((r) => r.id === id);
		if (!record) {
			return undefined;
		}
		const others = record.knownBy.filter((who) => !holders.includes(who));
		const pool = internalsOf(this._pool);
		const own = others.length === 0 ? record : { ...record, id: pool.nextID(), knownBy: record.knownBy.filter((who) => holders.includes(who)), tags: [...record.tags] };
		if (own !== record) {
			record.knownBy = others;
			pool.records().push(own);
		}
		Object.assign(own, holding(own.writer === undefined ? text : writerToID(text, own.writer)));
		own.embedding = undefined;
		return own;
	}

	/** Each of `holders` keeps at most its cap of plain episodic memories: past it, it forgets its oldest. */
	private evict(holders:readonly string[]):void {
		const pool = internalsOf(this._pool);
		// One pass over the pool: each holder's plain episodic memories.
		const held = new Map(holders.map((holder) => [holder, [] as MemoryRecord[]]));
		for (const record of pool.records()) {
			if (record.category === 'episodic' && !record.pinned) {
				record.knownBy.forEach((who) => held.get(who)?.push(record));
			}
		}
		for (const [holder, episodic] of held) {
			const overflow = episodic.length - pool.capOf(holder);
			if (overflow <= 0) {
				continue;
			}
			for (const record of episodic.sort((a, b) => a.timestamp - b.timestamp).slice(0, overflow)) {
				record.knownBy = record.knownBy.filter((who) => who !== holder);
				if (record.knownBy.length === 0) {
					pool.drop(record);
				}
			}
		}
	}
}
