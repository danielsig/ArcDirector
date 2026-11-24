import { namesWord } from '../text.js';
import { idsIn, joinTextWithIDs, namedText, readTextWithIDs, showTextWithIDs, textSegments, voiceOf, type NamingText, type TextSegment, type TextWithIDs } from '../character/text-with-ids.js';
import { hand, internalsOf } from '../internals.js';
import { writerToID } from '../character/person.js';
import type { JsonValue } from '../json.js';
import type { Vec } from '../world/world-types.js';
import { feelingsIn, type FeelingLevels } from '../character/feeling.js';

export type MemoryCategory = 'episodic' | 'semantic' | 'identity';

/** A fact the library tracks that a memory is true only while it is so: the code that ends the fact drops the memory. */
export interface RestsOn {
	/** Its holder cannot tell this one (an id) by name: learning the name ends it (`withAcquaintance`). */
	unknown:string;
}

/** Whether `held` (a memory, a line, a result) rests on `fact`. */
export function restsOnFact(held:{ restsOn?:RestsOn }, fact:RestsOn):boolean {
	return held.restsOn?.unknown === fact.unknown;
}

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
	/**
	 * When what it tells happened, in game time: a sighting's, when it was last seen. A rewrite of its text keeps it.
	 * `-Infinity` for what was always so, a backstory: recall shows it with no age.
	 */
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
	/** A sighting's of a thing that is no character: where it was seen (`SeenObject.point`), so a look there can find it gone. */
	at?:Vec;
	/**
	 * How lasting it is, in days of memory (a day of `director.time` over its holder's forgetfulness: 24 minutes by default):
	 * how long after its last use ({@link usedAt}) it is still 90% likely to come back
	 * ({@link recallChance}). Unset: a day for an episode, four for a fact, times its weight. Each use makes it last longer,
	 * the more so the further it had faded.
	 */
	stability?:number;
	/** The game time it was last used: shown in a prompt, recalled, or come to mind unbidden. Unset: when it was kept. */
	usedAt?:number;
	/** The fact it is true only while it is so; once it is not, its holders forget it ({@link MemoryStore.forgetRestingOn}). */
	restsOn?:RestsOn;
	/**
	 * What each holder felt as it kept it, by holder: the feelings it was stirred to then, the strong ones (`withFeelings`),
	 * or what its draft is steeped in. It stirs them again when it comes back, and comes back more readily in a mood like
	 * them: the eggs one dropped in tears bring the tears back.
	 */
	felt?:Readonly<Record<string, FeelingLevels>>;
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
	/** How lasting it starts, in days of memory ({@link MemoryRecord.stability}): a marriage, a name, a vow last years. */
	stability?:number;
	/** The fact it is true only while it is so ({@link MemoryRecord.restsOn}). */
	restsOn?:RestsOn;
	/** What it is steeped in, for every holder (`{ sad: 0.8 }`); unset, what each felt as it kept it ({@link MemoryRecord.felt}). */
	feelings?:FeelingLevels;
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
function textFields(text:TextWithIDs):Pick<MemoryRecord, 'text' | 'segments'> {
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
 * How many times as fast time passes for memories as for `director.time`, by default: a day of memory is 24 minutes of
 * it, as a day lasts in games with days and nights at their most common and median pace. 1 is a day of memory per day of
 * play.
 */
export const FORGETFULNESS = 60;
/** The most plain episodic memories a holder keeps, by default. */
export const MAX_EPISODIC = 256;
/** A feeling its holder feels at least this strongly as it keeps a memory is kept with it ({@link MemoryRecord.felt}). */
const FELT = 0.2;

/** `levels` of at least {@link FELT}, to two places; none when none is. */
function strongOf(levels:FeelingLevels | undefined):FeelingLevels | undefined {
	const strong = feelingsIn(levels).filter(([, level]) => level >= FELT).map(([feeling, level]) => [feeling, Math.round(level * 100) / 100] as const);
	return strong.length > 0 ? Object.fromEntries(strong) : undefined;
}
const DAY = 86_400;
/** How many times more lasting a fact (`semantic`: a note, a sighting) starts than an episode. */
const FACT_FADES = 4;
/**
 * The forgetting curve, as people forget: `(1 + CURVE × days / stability) ^ DECAY`, 90% at `stability` days, then slower
 * and slower, never all at once (a power function fits forgetting better than linear or exponential ones; this one is a
 * spaced-repetition scheduler's, fitted on millions of reviews).
 */
const CURVE = 19 / 81;
const DECAY = -0.5;
/**
 * A use multiplies a memory's stability by 1 plus this times how far it had faded: by 2.5 when it was 90% likely to come
 * back, by next to nothing when used again at once (spacing: a mind that thinks often does not out-remember one that
 * thinks seldom). A memory used now and then, days apart, lasts years.
 */
const GROWTH = 15;
/** Below this chance of coming back, a memory is forgotten at its holder's next {@link MemoryStore.forgetFaded}. */
export const FORGOTTEN = 0.25;

/** When `record` was last used, or seen again (a sighting's `timestamp`), whichever is later. */
function lastUse(record:MemoryRecord):number {
	return Math.max(record.usedAt ?? record.timestamp, record.timestamp);
}

/** How lasting `record` is ({@link MemoryRecord.stability}), its own or its kind's. */
function stabilityOf(record:MemoryRecord):number {
	return record.stability ?? weightOf(record) * (record.category === 'episodic' ? 1 : FACT_FADES);
}

/**
 * How likely `record` is to come back at `now`, 0 to 1, for a holder that forgets at `forgetfulness` (time passes that
 * many times as fast for it): 90% at its {@link MemoryRecord.stability} days since its last use, falling ever more
 * slowly after; always for a pinned one. Below {@link FORGOTTEN} it is forgotten at its holder's next
 * {@link MemoryStore.forgetFaded}.
 */
export function recallChance(record:MemoryRecord, now:number, forgetfulness = FORGETFULNESS):number {
	if (record.pinned || forgetfulness <= 0) {
		return 1;
	}
	const stability = stabilityOf(record);
	return stability > 0 ? (1 + CURVE * Math.max(0, now - lastUse(record)) * forgetfulness / DAY / stability) ** DECAY : 0;
}

/**
 * How much closer `record`'s meaning comes to what is asked than a plain memory's ({@link Meaning}): 0 without both, or
 * below {@link MEANING_ALONE}.
 */
function closeness(record:MemoryRecord, { embedding, baseline = 0 }:Meaning):number {
	const closer = embedding && record.embedding ? cosine(embedding, record.embedding) - baseline : 0;
	return closer >= MEANING_ALONE ? closer : 0;
}

/** The most `weights` gives any one `record` names or is tagged with, at least `none`. */
function mostNamed(record:MemoryRecord, weights:Iterable<readonly [string, number]>, none:number):number {
	let best = none;
	for (const [name, weight] of weights) {
		const lower = name.toLowerCase();
		if (weight > best && (record.tags.some((t) => t.toLowerCase() === lower) || namesWord(record.text, name))) {
			best = weight;
		}
	}
	return best;
}

/**
 * How relevant `record` is to what is asked: how near its meaning comes, a tag shared, words shared, times its weight and
 * how much whom it names matters (`bonds`).
 */
function relevance(record:MemoryRecord, meaning:Meaning, hits:number, lex:number, more = 0, bonds?:Readonly<Record<string, number>>):number {
	return weightOf(record) * mostNamed(record, Object.entries(bonds ?? {}), 1) * (TAG_HIT * closeness(record, meaning) / MEANING + (hits > 0 ? TAG_HIT : 0) + WORDS * lex + more);
}

/**
 * Game seconds a memory takes after its last use (shown, recalled, come to mind) to come to mind unbidden as readily as
 * before: at first not at all, then more and more, so what stays before a mind brings back one memory after another, not
 * the strongest every time.
 */
const RECOVERS = 300;

/** How readily `record` comes to mind unbidden again at `now`, 0 to 1 ({@link RECOVERS}): fully if never used. */
function recovered(record:MemoryRecord, now:number | undefined):number {
	return now === undefined || record.usedAt === undefined ? 1 : Math.min(1, Math.max(0, now - record.usedAt) / RECOVERS);
}

/** The most a name's salience adds to a memory about it: more than a tag hit, so what stands before you comes to mind. */
const SALIENCE_BOOST = 0.6;

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

/**
 * How each holder of a pool keeps memories: its cap and how fast it forgets (its mind's settings, layered as every setting
 * is), and what it feels as it keeps one. A cast's pool asks its characters and collectives; any other, the defaults.
 */
export interface MemoryHolding {
	/** The most plain episodic memories it keeps (`MindSettings.maxEpisodic`). */
	maxEpisodic(holder:string):number;
	/** How fast it forgets (`MindSettings.forgetfulness`, {@link recallChance}). */
	forgetfulness(holder:string):number;
	/** What it feels now, kept with each memory it takes in ({@link MemoryRecord.felt}). */
	feelings(holder:string):FeelingLevels | undefined;
}

const DEFAULT_HOLDING:MemoryHolding = { maxEpisodic: () => MAX_EPISODIC, forgetfulness: () => FORGETFULNESS, feelings: () => undefined };

/** What a pool's constructor hands its views (`internalsOf`): its records, a new record's id, and how each holder keeps them. */
export interface MemoryPoolFields {
	records():MemoryRecord[];
	nextID():string;
	drop(record:MemoryRecord):void;
	holding():MemoryHolding;
}

/**
 * Of `records`, each holder `holds` says forgets what has faded for it (below {@link FORGOTTEN}), and the memories told
 * the same way more than once, known by the same holders, become one: the newest, as lasting as all of them together.
 */
function forgetFadedIn(pool:MemoryPoolFields, records:readonly MemoryRecord[], holds:(holder:string)=>boolean, now:number):void {
	const left:MemoryRecord[] = [];
	for (const record of records) {
		record.knownBy = record.knownBy.filter((who) => !holds(who) || recallChance(record, now, pool.holding().forgetfulness(who)) >= FORGOTTEN);
		if (record.knownBy.length === 0) {
			pool.drop(record);
		}
		else {
			left.push(record);
		}
	}
	const kept = new Map<string, MemoryRecord>();
	for (const record of left.filter((r) => !r.pinned)) {
		const key = [record.category, record.writer ?? '', [...record.knownBy].sort().join(' '), record.text].join('\n');
		const had = kept.get(key);
		if (!had) {
			kept.set(key, record);
			continue;
		}
		const [older, newer] = had.timestamp <= record.timestamp ? [had, record] : [record, had];
		newer.stability = stabilityOf(newer) + stabilityOf(older);
		newer.tags = mergeTags(newer.tags, older.tags);
		newer.felt = { ...older.felt, ...newer.felt };
		const weight = Math.max(weightOf(newer), weightOf(older));
		newer.weight = weight === 1 ? undefined : weight;
		pool.drop(older);
		kept.set(key, newer);
	}
}

/**
 * Every memory of a cast, each once, with who knows it ({@link MemoryRecord.knownBy}). A persona's memory is a view of
 * it ({@link view}), so a character and the collective that thinks for it read the same records, and nothing is copied
 * when one leaves or joins.
 */
export class MemoryPool {
	private _records:MemoryRecord[] = [];
	private _next = 1;
	private readonly _holding:MemoryHolding;

	/** `holding`: how each holder keeps memories, the defaults where it says nothing. */
	constructor(holding:Partial<MemoryHolding> = {}) {
		this._holding = { ...DEFAULT_HOLDING, ...holding };
		hand(this, {
			records: () => this._records,
			nextID: () => `mem_${this._next++}`,
			drop: (record) => {
				this._records = this._records.filter((r) => r !== record);
			},
			holding: () => this._holding,
		} satisfies MemoryPoolFields);
	}

	/**
	 * What sleep does, for every holder of every memory, a character's that is far off and thinks no more too: each
	 * forgets what has faded for it, and memories told alike fold into one ({@link MemoryStore.forgetFaded}).
	 */
	public forgetFaded(now:number):void {
		forgetFadedIn(internalsOf(this), [...this._records], () => true, now);
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

	/** A saved pool, its holders keeping memories as `holding` says. */
	public static fromJSON(rows:readonly MemoryJSON[], holding?:Partial<MemoryHolding>):MemoryPool {
		const pool = new MemoryPool(holding);
		for (const { text, ...row } of rows) {
			pool._records.push({
				...row,
				knownBy: [...row.knownBy],
				tags: [...row.tags],
				...textFields(readTextWithIDs(text)),
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

	/**
	 * The most plain episodic memories its owner keeps (`MindSettings.maxEpisodic`): past it the least likely to come back
	 * go ({@link recallChance}), the least lasting, then the oldest, of as likely first.
	 */
	public get maxEpisodic():number {
		return internalsOf(this._pool).holding().maxEpisodic(this.owner);
	}

	/** How fast its owner forgets (`MindSettings.forgetfulness`): how many times as fast time passes for its memories. */
	public get forgetfulness():number {
		return internalsOf(this._pool).holding().forgetfulness(this.owner);
	}

	/** How likely `record` is to come back to its owner at `now` ({@link recallChance}). */
	public recallChanceOf(record:MemoryRecord, now:number):number {
		return recallChance(record, now, this.forgetfulness);
	}

	/**
	 * Its owner used `records` at `now`: shown in a prompt, recalled, or come to mind unbidden. Each lasts longer, the
	 * more so the further it had faded ({@link GROWTH}).
	 */
	public used(records:readonly MemoryRecord[], now:number):void {
		for (const record of records) {
			record.stability = stabilityOf(record) * (1 + GROWTH * (1 - this.recallChanceOf(record, now)));
			record.usedAt = now;
		}
	}

	/**
	 * What sleep does for memory (`Mind.forgetFaded`): each of its holders forgets what has faded for it (below
	 * {@link FORGOTTEN}), and the memories told the same way more than once, known by the same holders, become one: the
	 * newest, as lasting as all of them together (`Sold 2 Turnips to Aldous` twenty times).
	 */
	public forgetFaded(now:number):void {
		const holders = this._holders();
		forgetFadedIn(internalsOf(this._pool), this.all(), (who) => holders.includes(who), now);
	}

	public add(draft:MemoryDraft, now = draft.timestamp ?? 0):MemoryRecord {
		return this.keep({ ...draft, text: namedText(draft.text) }, now);
	}

	/** `draft` as a record; with `perceived`, the record of the same text at the same time, if there is one, known by more. */
	private keep(draft:KeptDraft, now = draft.timestamp ?? 0, perceived = false):MemoryRecord {
		const pool = internalsOf(this._pool);
		// A note: its words for its writer are kept as the writer's id.
		const fields = textFields(draft.writer === undefined ? draft.text : writerToID(draft.text, draft.writer));
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
			...draft.stability === undefined ? {} : { stability: draft.stability },
			...now > timestamp ? { usedAt: now } : {},
			...draft.restsOn ? { restsOn: { ...draft.restsOn } } : {},
			...fields,
		};
		// What each who takes it in now feels as it does: its draft's feelings, else its own.
		const felt = knownBy.filter((who) => !rec.felt?.[who]).flatMap((who) => {
			const levels = strongOf(draft.feelings ?? pool.holding().feelings(who));
			return levels ? [[who, levels] as const] : [];
		});
		if (felt.length > 0) {
			rec.felt = { ...rec.felt, ...Object.fromEntries(felt) };
		}
		rec.knownBy = union(rec.knownBy, knownBy);
		if (!same) {
			pool.records().push(rec);
		}
		this.evict(knownBy, now, rec);
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

	/**
	 * The pinned memories of `of`, its owner by default: a collective pins its own, never its characters', and its mind
	 * adds its commander's own, whose voice it speaks with.
	 */
	public pinned(of:readonly string[] = [this.owner]):MemoryRecord[] {
		return this.all().filter((r) => r.pinned && r.knownBy.some((id) => of.includes(id)));
	}

	/** A think read the pins of `of`: those pinned for some thinks count down, and any run out become plain memories. */
	public agePins(of?:readonly string[]):void {
		for (const record of this.pinned(of)) {
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
		/** How much each one matters to the mind, by id (what it feels toward them): a memory naming them scores that many times more. */
		bonds?:Readonly<Record<string, number>>;
	}):MemoryRecord[] {
		const k = opts.k ?? 5;
		const tags = opts.tags ?? [];
		const scored = this.recallable()
			.filter((r) => (opts.category === undefined || r.category === opts.category) && !opts.skip?.(r))
			.map((record) => ({
				record,
				value: relevance(record, opts, tagHits(record, tags, opts.query), lexicalOverlap(opts.query, record.text), SALIENCE_BOOST * mostNamed(record, opts.salience ?? [], 0), opts.bonds),
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
		/** How much more readily the mind's mood and interests bring `record` to mind (1: no more): mood-congruent recall. */
		boost?:(record:MemoryRecord)=>number;
		/** How much each one matters to the mind, by id, as in {@link recall}. */
		bonds?:Readonly<Record<string, number>>;
		/** The game time now: a memory used lately comes less readily ({@link RECOVERS}). Unset: as if long ago. */
		now?:number;
		threshold?:number;
		/** Records that may not come: shown already, or not the one remembering's. */
		skip?:(record:MemoryRecord)=>boolean;
	}):MemoryRecord | null {
		let best:MemoryRecord | null = null;
		let bestScore = opts.threshold ?? 0.55;
		for (const record of this.recallable()) {
			// A pinned memory is in every prompt already.
			if (record.pinned || opts.skip?.(record)) {
				continue;
			}
			const lex = lexicalOverlap(opts.query, record.text);
			const hits = tagHits(record, opts.tags ?? [], opts.query);
			if (hits === 0 && lex < UNBIDDEN_WORDS && closeness(record, opts) === 0) {
				continue;
			}
			const value = relevance(record, opts, hits, lex, 0, opts.bonds) * (opts.boost?.(record) ?? 1) * recovered(record, opts.now);
			if (value > bestScore) {
				bestScore = value;
				best = record;
			}
		}
		return best;
	}

	/**
	 * How `holder` (its owner by default) feels toward each one its memories name in their text, by id. Per feeling, what
	 * it felt as it kept them ({@link MemoryRecord.felt}), averaged over those it felt
	 * anything in, each counting its weight times its chance of coming back at `now`, over at least one memory's worth: so a
	 * lone memory's feeling fades as the memory does, and a feeling for someone goes once its memories are forgotten. Only
	 * `holder`'s own: it loves Bram, whatever Bram feels. A host seeds it with a memory whose text names them
	 * (`(name) => \`${name('Bram')} saved my life.\``), with `feelings: { loving: 1 }` (or hate: `{ angry: 0.8, disgusted: 0.5 }`).
	 */
	public feelingsToward(now:number, holder = this.owner):Map<string, FeelingLevels> {
		const forgetfulness = internalsOf(this._pool).holding().forgetfulness(holder);
		const sums = new Map<string, { counted:number; levels:Record<string, number> }>();
		for (const record of this.all()) {
			const felt = record.felt?.[holder];
			if (!felt) {
				continue;
			}
			const counts = weightOf(record) * recallChance(record, now, forgetfulness);
			for (const id of new Set(idsIn(keptText(record)).filter((id) => id !== holder))) {
				const sum = sums.get(id) ?? { counted: 0, levels: {} };
				sum.counted += counts;
				for (const [feeling, level] of feelingsIn(felt)) {
					sum.levels[feeling] = (sum.levels[feeling] ?? 0) + counts * level;
				}
				sums.set(id, sum);
			}
		}
		return new Map([...sums].map(([id, { counted, levels }]) => [id, Object.fromEntries(Object.entries(levels).map(([feeling, level]) => [feeling, level / Math.max(1, counted)]))]));
	}

	/** Its holders forget each memory that rests on `fact` ({@link MemoryRecord.restsOn}), now that it is so no more. */
	public forgetRestingOn(fact:RestsOn):void {
		for (const record of this.all().filter((r) => restsOnFact(r, fact))) {
			this.remove(record.id);
		}
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
		Object.assign(own, textFields(own.writer === undefined ? text : writerToID(text, own.writer)));
		own.embedding = undefined;
		return own;
	}

	/**
	 * Each of `holders` keeps at most its cap of plain episodic memories: past it, it forgets those least likely to come
	 * back at `now` (the least lasting, then the oldest, of as likely first), never `added`, the one just kept.
	 */
	private evict(holders:readonly string[], now:number, added:MemoryRecord):void {
		const pool = internalsOf(this._pool);
		// One pass over the pool: each holder's plain episodic memories.
		const held = new Map(holders.map((holder) => [holder, [] as MemoryRecord[]]));
		for (const record of pool.records()) {
			if (record.category === 'episodic' && !record.pinned) {
				record.knownBy.forEach((who) => held.get(who)?.push(record));
			}
		}
		for (const [holder, episodic] of held) {
			const overflow = episodic.length - pool.holding().maxEpisodic(holder);
			if (overflow <= 0) {
				continue;
			}
			const forgetfulness = pool.holding().forgetfulness(holder);
			const weakest = episodic.filter((record) => record !== added)
				.map((record) => ({ record, chance: recallChance(record, now, forgetfulness) }))
				.sort((a, b) => a.chance - b.chance || stabilityOf(a.record) - stabilityOf(b.record) || a.record.timestamp - b.record.timestamp)
				.slice(0, overflow)
				.map(({ record }) => record);
			for (const record of weakest) {
				record.knownBy = record.knownBy.filter((who) => who !== holder);
				if (record.knownBy.length === 0) {
					pool.drop(record);
				}
			}
		}
	}
}
