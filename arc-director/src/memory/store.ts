import { readID } from '../json.js';
import { namesWord } from '../text.js';

export type MemoryCategory = 'episodic' | 'semantic' | 'identity';

export type MemoryRecord = {
	id:string;
	category:MemoryCategory;
	text:string;
	tags:string[];
	timestamp:number;
	lastAccessed:number;
	pinned?:boolean;
	emotional?:boolean;
	embedding?:number[];
	weight?:number;
};

export type MemoryDraft = {
	category?:MemoryCategory;
	text:string;
	tags?:string[];
	timestamp?:number;
	pinned?:boolean;
	emotional?:boolean;
	embedding?:number[];
	weight?:number;
	id?:string;
};

export type RecallScoreFn = (args:{
	cosine:number;
	recency:number;
	tagHits:number;
	record:MemoryRecord;
	now:number;
})=>number;

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

export function lexicalTokens(text:string):string[] {
	const names = nameTags(text).map((n) => n.toLowerCase());
	const words = (text.toLowerCase().match(/[a-z][a-z0-9]{3,}/g) ?? [])
		.filter((w) => !STOP.has(w));
	return [...new Set([...names, ...words])];
}

/** Fraction of query tokens that appear in `text`. Used when embeddings are missing. */
export function lexicalOverlap(query:string, text:string):number {
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

export function defaultRecallScore(args:{
	cosine:number;
	recency:number;
	tagHits:number;
	record:MemoryRecord;
	now:number;
}):number {
	void args.record;
	void args.now;
	return args.cosine * (1 + 0.08 * args.recency) + (args.tagHits > 0 ? 0.4 : 0);
}

function recencyBonus(timestamp:number, now:number):number {
	const age = Math.max(0, now - timestamp);
	return 1 / (1 + age);
}

/** The most a name's salience adds to a memory about it: more than a tag hit, so what stands before you comes to mind. */
export const SALIENCE_BOOST = 0.6;

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

export class MemoryStore {
	public maxEpisodic = 256;
	public score:RecallScoreFn = defaultRecallScore;
	private _records:MemoryRecord[] = [];
	private _next = 1;

	public add(draft:MemoryDraft, now = draft.timestamp ?? 0):MemoryRecord {
		const rec:MemoryRecord = {
			id: draft.id ?? `mem_${this._next++}`,
			category: draft.category ?? 'episodic',
			text: draft.text,
			tags: draft.tags ? [...draft.tags] : [],
			timestamp: draft.timestamp ?? now,
			lastAccessed: draft.timestamp ?? now,
			pinned: draft.pinned,
			emotional: draft.emotional,
			embedding: draft.embedding ? [...draft.embedding] : undefined,
			weight: draft.weight ?? 1,
		};
		this._records.push(rec);
		this.evict();
		return rec;
	}

	public all():MemoryRecord[] {
		return this._records;
	}

	public pinned():MemoryRecord[] {
		return this._records.filter((r) => r.pinned);
	}

	public recall(opts:{
		query:string;
		k?:number;
		now?:number;
		embedding?:number[];
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
		const now = opts.now ?? 0;
		const k = opts.k ?? 5;
		const tags = opts.tags ?? [];
		const scored = this._records
			.filter((r) => (opts.category === undefined || r.category === opts.category) && !opts.skip?.(r))
			.map((record) => {
				const cos = opts.embedding && record.embedding
					? cosine(opts.embedding, record.embedding)
					: 0;
				const hits = tagHits(record, tags, opts.query);
				const recency = recencyBonus(record.timestamp, now);
				const lex = lexicalOverlap(opts.query, record.text);
				return {
					record,
					value: this.score({
						cosine: cos,
						recency,
						tagHits: hits,
						record,
						now,
					}) + 0.7 * lex + SALIENCE_BOOST * salienceOf(record, opts.salience),
				};
			})
			.filter((s) => s.value > 0)
			.sort((a, b) => b.value - a.value)
			.slice(0, k);
		for (const s of scored) {
			s.record.lastAccessed = now;
		}
		return scored.map((s) => s.record);
	}

	public intrusion(opts:{
		query:string;
		now:number;
		embedding?:number[];
		tags?:string[];
		threshold?:number;
	}):MemoryRecord | null {
		const threshold = opts.threshold ?? 0.55;
		let best:MemoryRecord | null = null;
		let bestScore = threshold;
		for (const record of this._records) {
			// A pinned memory is in every prompt already.
			if (record.pinned) {
				continue;
			}
			const lex = lexicalOverlap(opts.query, record.text);
			const hits = tagHits(record, opts.tags ?? [], opts.query);
			if (!record.emotional && record.tags.length === 0 && lex < 0.15) {
				continue;
			}
			if (!record.emotional && hits === 0 && lex < 0.15) {
				continue;
			}
			const cos = opts.embedding && record.embedding
				? cosine(opts.embedding, record.embedding)
				: 0;
			const value = this.score({
				cosine: cos,
				recency: recencyBonus(record.timestamp, opts.now),
				tagHits: hits,
				record,
				now: opts.now,
			}) + 0.7 * lex;
			if (value > bestScore) {
				bestScore = value;
				best = record;
			}
		}
		if (best) {
			best.lastAccessed = opts.now;
		}
		return best;
	}

	/** Forget the record `id`. False when there is none. */
	public remove(id:string):boolean {
		const count = this._records.length;
		this._records = this._records.filter((r) => r.id !== id);
		return this._records.length < count;
	}

	/** New text for the record `id`. Its embedding no longer fits the text, so it is dropped. */
	public rewrite(id:string, text:string):MemoryRecord | undefined {
		const record = this._records.find((r) => r.id === id);
		if (record) {
			record.text = text;
			record.embedding = undefined;
		}
		return record;
	}

	public toJSON():MemoryRecord[] {
		return this._records.map((r) => ({
			...r,
			tags: [...r.tags],
			embedding: r.embedding ? [...r.embedding] : undefined,
		}));
	}

	public static fromJSON(rows:MemoryRecord[]):MemoryStore {
		const store = new MemoryStore();
		let max = 0;
		for (const row of rows) {
			const id = readID(row) ?? '';
			store._records.push({
				...row,
				id,
				tags: [...row.tags],
				embedding: row.embedding ? [...row.embedding] : undefined,
			});
			const n = Number(String(id).replace(/^mem_/, ''));
			if (Number.isFinite(n) && n > max) {
				max = n;
			}
		}
		store._next = max + 1;
		return store;
	}

	private evict():void {
		const episodic = this._records.filter((r) => r.category === 'episodic' && !r.pinned);
		const overflow = episodic.length - this.maxEpisodic;
		if (overflow <= 0) {
			return;
		}
		episodic.sort((a, b) => a.timestamp - b.timestamp);
		const drop = new Set(episodic.slice(0, overflow).map((r) => r.id));
		this._records = this._records.filter((r) => !drop.has(r.id));
	}
}
