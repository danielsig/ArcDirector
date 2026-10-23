/** What a mind knows about the world: host-authored articles, which `recall` searches beside memory. Leftover sight English is not a name. */

import { DEFAULT_SIGHT, formatSight } from '../perception/sight.js';
import { basicPluralize } from '../perception/stringifiers.js';
import type { SeenObject } from '../perception/types.js';

export type KnowledgeEntry = {
	/** Capitalized name used in arcs (`Tree`, `Cottage`). */
	name:string;
	/** Leftover or spoken English (`trees`, `house`, `forest`). */
	aliases?:string[];
	text:string;
	/**
	 * A thing a character carries. When the article comes up for being said or heard, it also says whether this
	 * mind carries one, so talk ("take this FireMushroom") sits next to the truth.
	 */
	item?:boolean;
};

/** Leftover crowd type plus spoken names for being inside that crowd. */
export type CrowdKnowledgeSpec = {
	name:string;
	tag:string;
	inside:string[];
	unitName?:string;
};

export type KnowledgeSource<TCtx = unknown> =
	| readonly KnowledgeEntry[]
	| ((ctx:TCtx)=>readonly KnowledgeEntry[]);

/** Articles one `recall` returns, so they do not crowd out memories. */
export const KNOW_CAP = 2;
const INDEX_CAP = 48;
const MIN_TOKEN = 3;

type ItemLike = { id:string; tags?:readonly string[] };

/**
 * Whether one of `items` is what `entry` is about: its id equals the name or an alias, or a tag equals the name. A tag
 * is a kind many items share (`mushroom`), so it only matches an article named for that kind, never another item's
 * alias: a MoonMushroom tagged `mushroom` is not the FireMushroom whose alias is `mushroom`.
 */
export function isAboutItem(entry:KnowledgeEntry, items:readonly ItemLike[]):boolean {
	const name = entry.name.trim().toLowerCase();
	const keys = new Set([name, ...(entry.aliases ?? []).map((alias) => alias.trim().toLowerCase())]);
	return items.some((item) => keys.has(item.id.toLowerCase()) || (item.tags ?? []).some((tag) => tag.toLowerCase() === name));
}

/** `- Name: article` for each article whose name or alias equals an item id or tag. Empty when nothing matches. */
export function receivedArticles(entries:readonly KnowledgeEntry[], items:readonly ItemLike[]):string {
	return entries
		.filter((entry) => entry.text.trim() !== '' && isAboutItem(entry, items))
		.map((entry) => `- ${entry.name.trim()}: ${entry.text.trim()}`)
		.join('\n');
}

/**
 * `Name: article` for every article whose name `text` mentions as a whole word, so a failure explains
 * itself (`Bridge is raised` brings the Bridge article). Names only: aliases are plain English and
 * would match ordinary words. Empty when nothing matches.
 */
export function articlesNamedIn(entries:readonly KnowledgeEntry[], text:string):string {
	const words = new Set(text.split(/[^A-Za-z0-9_]+/));
	return entries
		.filter((entry) => words.has(entry.name.trim()) && entry.text.trim() !== '')
		.map((entry) => `${entry.name.trim()}: ${entry.text.trim()}`)
		.join('\n');
}

/** Lowercase words joined by single spaces, so names and multi-word aliases compare as phrases. */
function phrase(text:string):string {
	return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join(' ');
}

/**
 * Articles whose name or alias `text` mentions as a whole word or phrase, most mentions first, at most `cap`.
 * How talk brings up the facts behind it: "10 gold or items of equal value" brings the article aliased `10 gold`.
 */
export function mentionedArticles(entries:readonly KnowledgeEntry[], text:string, cap:number):KnowledgeEntry[] {
	const said = ` ${phrase(text)} `;
	return entries
		.map((entry) => ({
			entry,
			hits: [entry.name, ...(entry.aliases ?? [])].filter((key) => phrase(key) !== '' && said.includes(` ${phrase(key)} `)).length,
		}))
		.filter((row) => row.hits > 0 && row.entry.text.trim() !== '')
		.sort((a, b) => b.hits - a.hits)
		.slice(0, Math.max(0, cap))
		.map((row) => row.entry);
}

export function knowledgePages<TCtx>(
	src:KnowledgeSource<TCtx> | undefined,
	ctx:TCtx | undefined,
):KnowledgeEntry[] {
	if (!src) {
		return [];
	}
	if (typeof src === 'function') {
		if (ctx === undefined) {
			return [];
		}
		return [...src(ctx)];
	}
	return [...src];
}

/**
 * What `recall` knows for `query`: the best `cap` articles by name, alias, or word, each `Name (aliases)` over its
 * text. An empty query lists the topics instead, and one that matches nothing says a plain word is not a name.
 * `[]` when there is nothing to know.
 */
export function knowledgeFor(entries:readonly KnowledgeEntry[], query:string, cap = KNOW_CAP):string[] {
	const q = query.replace(/\s+/g, ' ').trim();
	if (!q || q === '*' || /^list$/i.test(q)) {
		const names = entries.map((e) => e.name.trim()).filter(Boolean);
		if (names.length === 0) {
			return [];
		}
		const more = names.length > INDEX_CAP ? '…' : '';
		return [`Topics: ${names.slice(0, INDEX_CAP).join(', ')}${more}. Recall one for more.`];
	}
	if (entries.length === 0) {
		return [];
	}
	const tokens = tokenize(q);
	const hits = entries
		.map((entry) => ({ entry, score: scoreEntry(entry, q, tokens) }))
		.filter((row) => row.score > 0)
		.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
		.slice(0, cap);
	if (hits.length === 0) {
		return [`Nothing you know is called "${q}". A plain word is not a name: call recall again with different words.`];
	}
	return hits.map((row) => formatEntry(row.entry));
}

function formatEntry(entry:KnowledgeEntry):string {
	const aka = (entry.aliases ?? []).map((a) => a.trim()).filter(Boolean);
	const head = aka.length > 0 ? `${entry.name} (${aka.join(', ')})` : entry.name;
	return `${head}\n${entry.text.trim()}`;
}

function tokenize(query:string):string[] {
	return query.toLowerCase().split(/[^a-z0-9]+/i).filter((t) => t.length >= MIN_TOKEN);
}

function scoreEntry(entry:KnowledgeEntry, query:string, tokens:string[]):number {
	const ql = query.toLowerCase();
	const name = entry.name.toLowerCase();
	const aliases = (entry.aliases ?? []).map((a) => a.toLowerCase());
	const text = entry.text.toLowerCase();
	let score = 0;
	if (name === ql) {
		score += 100;
	}
	if (aliases.includes(ql)) {
		score += 80;
	}
	if (name.includes(ql) || aliases.some((a) => a.includes(ql) || ql.includes(a))) {
		score += 25;
	}
	for (const token of tokens) {
		if (name === token || aliases.includes(token)) {
			score += 50;
		}
		else if (name.includes(token) || aliases.some((a) => a.includes(token))) {
			score += 20;
		}
		else if (text.includes(token)) {
			score += 4;
		}
	}
	return score;
}

const CARDINALS:[number, number][] = [
	[0, -6],
	[0, 6],
	[-6, 0],
	[6, 0],
];

/** Leftover crowd article from `formatSight` on a bunch around you. */
export function crowdKnowledge(spec:CrowdKnowledgeSpec):KnowledgeEntry {
	const name = spec.name.trim();
	const tag = spec.tag.trim();
	const inside = spec.inside.map((s) => s.trim()).filter(Boolean);
	const unitName = spec.unitName ?? DEFAULT_SIGHT.unitName;
	const objects = crowdAround(tag);
	const self = { id: 'You', point: [0, 0], facing: [0, -1] };
	const leftover = firstClause(formatSight({ self, objects }, { unitName }));
	const around = formatSight({ self, objects }, { unitName, relationships: [] }).trim();
	const y = inside[0] ?? leftover;
	const yRest = inside.slice(1);
	const yPhrase = yRest.length > 0 ? `${aPlace(y)} (${yRest.join(', ')})` : aPlace(y);
	const aliases = uniqueAliases(name, [basicPluralize(tag), leftover, ...inside]);
	return {
		name,
		aliases,
		text: [
			`Leftover sight for a bunch of ${name}: ${leftover}.`,
			`Sight leftover "${leftover}" is not a binding — watches use ${name} (${name}.nearby(), never ${leftover}.nearby()).`,
			`Being surrounded by a bunch of ${name} is being inside ${yPhrase}.`,
			`One is surrounded by ${name} when ${name} is in all directions, like leftover: ${around}`,
		].join(' '),
	};
}

function crowdAround(tag:string):SeenObject[] {
	return CARDINALS.map((point, i) => ({
		id: `${tag}_${i}`,
		point,
		tags: [tag],
		count: 2,
		label: tag,
		movable: true,
	}));
}

function firstClause(paragraph:string):string {
	const head = paragraph.split('.')[0]?.trim() ?? '';
	return head || paragraph.replace(/\.+$/g, '').trim();
}

function aPlace(name:string):string {
	if (/^(a|an|the)\b/i.test(name)) {
		return name;
	}
	return /^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`;
}

function uniqueAliases(name:string, words:string[]):string[] {
	const seen = new Set([name.toLowerCase()]);
	const out:string[] = [];
	for (const raw of words) {
		const w = raw.trim();
		if (!w) {
			continue;
		}
		const key = w.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push(w);
	}
	return out;
}
