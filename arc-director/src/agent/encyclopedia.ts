/** Host-authored world types. Leftover sight English is not a name. */

import { DEFAULT_SIGHT, formatSight } from '../perception/sight.js';
import { basicPluralize } from '../perception/stringifiers.js';
import type { SeenObject } from '../perception/types.js';

export const GREP_WORLD_ENCYCLOPEDIA = 'grep_world_encyclopedia';

export type EncyclopediaEntry = {
	/** Capitalized name used in plans (`Tree`, `Cottage`). */
	name:string;
	/** Leftover or spoken English (`trees`, `house`, `forest`). */
	aliases?:string[];
	text:string;
};

/** Leftover crowd type plus spoken names for being inside that crowd. */
export type CrowdEncyclopediaSpec = {
	name:string;
	tag:string;
	inside:string[];
	unitName?:string;
};

export type EncyclopediaSource<HostCtx = unknown> =
	| readonly EncyclopediaEntry[]
	| ((ctx:HostCtx)=>readonly EncyclopediaEntry[]);

const HIT_CAP = 8;
const INDEX_CAP = 48;
const MIN_TOKEN = 3;

export function encyclopediaPages<HostCtx>(
	src:EncyclopediaSource<HostCtx> | undefined,
	ctx:HostCtx | undefined,
):EncyclopediaEntry[] {
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

export function grepEncyclopedia(entries:readonly EncyclopediaEntry[], query:string):string {
	const q = query.replace(/\s+/g, ' ').trim();
	if (!q || q === '*' || /^list$/i.test(q)) {
		const names = entries.map((e) => e.name.trim()).filter(Boolean);
		if (names.length === 0) {
			return 'Encyclopedia is empty.';
		}
		const shown = names.slice(0, INDEX_CAP);
		const more = names.length > INDEX_CAP ? '…' : '';
		return `Names: ${shown.join(', ')}${more}. Query one for the article.`;
	}
	const tokens = tokenize(q);
	const scored = entries
		.map((entry) => ({ entry, score: scoreEntry(entry, q, tokens) }))
		.filter((row) => row.score > 0)
		.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
	const hits = scored.slice(0, HIT_CAP);
	if (hits.length === 0) {
		return `No encyclopedia match for "${q}". Leftover English is not a name. Try another word, see_map, ask, or wander(until).`;
	}
	return hits.map((row) => formatEntry(row.entry)).join('\n\n');
}

function formatEntry(entry:EncyclopediaEntry):string {
	const aka = (entry.aliases ?? []).map((a) => a.trim()).filter(Boolean);
	const head = aka.length > 0 ? `${entry.name} (${aka.join(', ')})` : entry.name;
	return `${head}\n${entry.text.trim()}`;
}

function tokenize(query:string):string[] {
	return query.toLowerCase().split(/[^a-z0-9]+/i).filter((t) => t.length >= MIN_TOKEN);
}

function scoreEntry(entry:EncyclopediaEntry, query:string, tokens:string[]):number {
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
export function crowdEncyclopedia(spec:CrowdEncyclopediaSpec):EncyclopediaEntry {
	const name = spec.name.trim();
	const tag = spec.tag.trim();
	const inside = spec.inside.map((s) => s.trim()).filter(Boolean);
	const unitName = spec.unitName ?? DEFAULT_SIGHT.unitName;
	const objects = crowdAround(tag);
	const self = { id: 'You', at: [0, 0], facing: [0, -1] };
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
			'Cannot be reached with go_to.',
		].join(' '),
	};
}

function crowdAround(tag:string):SeenObject[] {
	return CARDINALS.map((at, i) => ({
		id: `${tag}_${i}`,
		at,
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
