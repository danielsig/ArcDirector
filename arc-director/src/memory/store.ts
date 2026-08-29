import { readID } from '../json.js';

export type MemoryCategory = 'episodic' | 'semantic' | 'identity';

export type MemoryRecord = {
	id:string;
	category:MemoryCategory;
	text:string;
	tags:string[];
	createdAt:number;
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
	createdAt?:number;
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

function recencyBonus(createdAt:number, now:number):number {
	const age = Math.max(0, now - createdAt);
	return 1 / (1 + age);
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
	maxEpisodic = 256;
	score:RecallScoreFn = defaultRecallScore;
	private records:MemoryRecord[] = [];
	private next = 1;

	add(draft:MemoryDraft, now = draft.createdAt ?? 0):MemoryRecord {
		const rec:MemoryRecord = {
			id: draft.id ?? `mem_${this.next++}`,
			category: draft.category ?? 'episodic',
			text: draft.text,
			tags: draft.tags ? [...draft.tags] : [],
			createdAt: draft.createdAt ?? now,
			lastAccessed: draft.createdAt ?? now,
			pinned: draft.pinned,
			emotional: draft.emotional,
			embedding: draft.embedding ? [...draft.embedding] : undefined,
			weight: draft.weight ?? 1,
		};
		this.records.push(rec);
		this.evict();
		return rec;
	}

	all():MemoryRecord[] {
		return this.records;
	}

	pinned():MemoryRecord[] {
		return this.records.filter((r) => r.pinned);
	}

	recall(opts:{
		query:string;
		k?:number;
		now?:number;
		embedding?:number[];
		tags?:string[];
		category?:MemoryCategory;
	}):MemoryRecord[] {
		const now = opts.now ?? 0;
		const k = opts.k ?? 5;
		const tags = opts.tags ?? [];
		const scored = this.records
			.filter((r) => opts.category === undefined || r.category === opts.category)
			.map((record) => {
				const cos = opts.embedding && record.embedding
					? cosine(opts.embedding, record.embedding)
					: 0;
				const hits = tagHits(record, tags, opts.query);
				const recency = recencyBonus(record.createdAt, now);
				return {
					record,
					value: this.score({
						cosine: cos,
						recency,
						tagHits: hits,
						record,
						now,
					}),
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

	intrusion(opts:{
		query:string;
		now:number;
		embedding?:number[];
		tags?:string[];
		threshold?:number;
	}):MemoryRecord | null {
		const threshold = opts.threshold ?? 0.55;
		let best:MemoryRecord | null = null;
		let bestScore = threshold;
		for (const record of this.records) {
			if (!record.emotional && record.tags.length === 0) {
				continue;
			}
			const hits = tagHits(record, opts.tags ?? [], opts.query);
			if (!record.emotional && hits === 0) {
				continue;
			}
			const cos = opts.embedding && record.embedding
				? cosine(opts.embedding, record.embedding)
				: 0;
			const value = this.score({
				cosine: cos,
				recency: recencyBonus(record.createdAt, opts.now),
				tagHits: hits,
				record,
				now: opts.now,
			});
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

	toJSON():MemoryRecord[] {
		return this.records.map((r) => ({
			...r,
			tags: [...r.tags],
			embedding: r.embedding ? [...r.embedding] : undefined,
		}));
	}

	static fromJSON(rows:MemoryRecord[]):MemoryStore {
		const store = new MemoryStore();
		let max = 0;
		for (const row of rows) {
			const id = readID(row) ?? '';
			store.records.push({
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
		store.next = max + 1;
		return store;
	}

	private evict():void {
		const episodic = this.records.filter((r) => r.category === 'episodic' && !r.pinned);
		const overflow = episodic.length - this.maxEpisodic;
		if (overflow <= 0) {
			return;
		}
		episodic.sort((a, b) => a.createdAt - b.createdAt);
		const drop = new Set(episodic.slice(0, overflow).map((r) => r.id));
		this.records = this.records.filter((r) => !drop.has(r.id));
	}
}
