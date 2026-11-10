/** Player slash commands in the say box. Names only — no coordinates. */

export const SAY_COMMANDS = [
	{ verb: 'give', usage: '/give [amount] <item|gold> [to] <person>', hint: 'Hand over an item, or gold from your purse' },
	{ verb: 'offer', usage: '/offer <person> <item|gold|nothing> for <item|gold|nothing>', hint: 'Trade; it happens once they offer the reverse' },
	{ verb: 'clear', usage: '/clear', hint: 'Clear say history' },
] as const;

const SKIP = new Set(['to', 'from', 'with']);
const SUGGEST_CAP = 8;

export type SayCatalog = {
	peers:string[];
	items:string[];
	gold:number;
	/** What each person offers the player, by lowercase name: what they give, and what they want for it. */
	offers:Record<string, { give:Record<string, number>; get:Record<string, number> }>;
};

export type SaySuggestion = {
	insert:string;
	label:string;
	hint:string;
};

/** A command the player's character runs as an arc. */
export type ParsedSlash =
	| { ok:true; verb:'give' | 'offer'; arc:string }
	| { ok:false; reason:string };

function compact(s:string):string {
	return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isAmount(raw:string):boolean {
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 && /^\d+(\.\d+)?$/.test(raw);
}

function prefixMatch(name:string, partial:string):boolean {
	if (!partial) {
		return true;
	}
	const want = partial.toLowerCase();
	const cwant = compact(partial);
	return name.toLowerCase().startsWith(want) || compact(name).startsWith(cwant);
}

function skipOptional(words:string[], typing:boolean):string[] {
	const out:string[] = [];
	for (let i = 0; i < words.length; i++) {
		const last = i === words.length - 1;
		if (SKIP.has(words[i].toLowerCase()) && !(last && typing)) {
			continue;
		}
		out.push(words[i]);
	}
	return out;
}

function splitLine(line:string):string[] {
	return line.trim().split(/\s+/).filter(Boolean);
}

export function parseSlash(line:string):ParsedSlash | null {
	const raw = line.trim();
	if (!raw.startsWith('/')) {
		return null;
	}
	const words = splitLine(raw.slice(1));
	if (words.length === 0) {
		return { ok: false, reason: 'which command?' };
	}
	const verb = words[0].toLowerCase();
	const args = skipOptional(words.slice(1), false);
	if (verb === 'give') {
		return parseGive(args);
	}
	if (verb === 'offer') {
		return parseOffer(args);
	}
	return { ok: false, reason: `unknown /${verb}` };
}

/** `5 gold Baker`, `gold 5 Baker`, `2 Loaf Baker`, `Loaf Baker`: one good, then whom. */
function parseGive(args:string[]):ParsedSlash {
	if (args.length < 2) {
		return { ok: false, reason: 'give what to whom?  /give [amount] <item|gold> <person>' };
	}
	const bundle = phrase(args.slice(0, -1).join(' '));
	if (typeof bundle === 'string') {
		return { ok: false, reason: bundle };
	}
	const goods = Object.entries(bundle);
	if (goods.length !== 1) {
		return { ok: false, reason: 'give one thing at a time' };
	}
	const [[item, quantity]] = goods;
	return { ok: true, verb: 'give', arc: `give(item=${item}, to=${args.at(-1)}, quantity=${quantity})` };
}

const OFFER_USAGE = '/offer <person> <item|gold|nothing> for <item|gold|nothing>';

/** `5`, `5 gold`, `gold 5`, `12 Egg and Milk 3`, `Loaf`, or `nothing`. */
function phrase(text:string):Record<string, number> | string {
	const bundle:Record<string, number> = {};
	if (/^nothing$/i.test(text.trim())) {
		return bundle;
	}
	for (const bit of text.split(/\s+and\s+/i)) {
		const part = bit.trim();
		if (!part) {
			continue;
		}
		const gold = /^(?:(\d+)\s+gold|gold(?:\s+(\d+))?)$/i.exec(part);
		if (gold || /^\d+$/.test(part)) {
			const n = Math.floor(Number(gold ? (gold[1] || gold[2] || 0) : part));
			if (n <= 0) {
				return 'how much gold?';
			}
			bundle.gold = (bundle.gold ?? 0) + n;
			continue;
		}
		const counted = /^(\d+)\s+([A-Za-z]\w*)$/.exec(part);
		const after = /^([A-Za-z]\w*)\s+(\d+)$/.exec(part);
		const [name, count] = counted ? [counted[2], counted[1]] : after ? [after[1], after[2]] : [];
		if (name) {
			bundle[name] = (bundle[name] ?? 0) + Math.floor(Number(count));
			continue;
		}
		if (/^[A-Za-z][\w]*$/.test(part) && !/^gold$/i.test(part)) {
			bundle[part] = (bundle[part] ?? 0) + 1;
			continue;
		}
		return `cannot read "${part}"`;
	}
	return Object.keys(bundle).length > 0 ? bundle : 'what, or nothing?';
}

function parseOffer(args:string[]):ParsedSlash {
	const person = args[0] ?? '';
	if (!person) {
		return { ok: false, reason: `offer to whom?  ${OFFER_USAGE}` };
	}
	const forAt = args.findIndex((word) => word.toLowerCase() === 'for');
	if (forAt < 0) {
		return { ok: false, reason: `for what?  ${OFFER_USAGE}` };
	}
	const give = phrase(args.slice(1, forAt).join(' '));
	if (typeof give === 'string') {
		return { ok: false, reason: give };
	}
	const get = phrase(args.slice(forAt + 1).join(' '));
	if (typeof get === 'string') {
		return { ok: false, reason: get };
	}
	return { ok: true, verb: 'offer', arc: `offer(to=${person}, give=${JSON.stringify(give)}, get=${JSON.stringify(get)})` };
}

function take(names:string[], partial:string, cap = SUGGEST_CAP):string[] {
	return names.filter((n) => prefixMatch(n, partial)).slice(0, cap);
}

function finish(head:string, value:string, more:boolean):string {
	return `${head}${value}${more ? ' ' : ''}`;
}

function commandInserts(partial:string):SaySuggestion[] {
	const hits = SAY_COMMANDS.filter((c) => c.verb.startsWith(partial.toLowerCase()));
	return hits.slice(0, SUGGEST_CAP).map((c) => ({
		insert: finish('/', c.verb, c.usage.includes(' ')),
		label: `/${c.verb}`,
		hint: c.hint,
	}));
}

function namedInserts(head:string, names:string[], partial:string, more:boolean, hint:string):SaySuggestion[] {
	return take(names, partial).map((name) => ({
		insert: finish(head, name, more),
		label: name,
		hint,
	}));
}

type DraftBits = {
	kind:'slash' | 'at' | 'plain';
	words:string[];
	typing:boolean;
	head:string;
	partial:string;
};

function readDraft(draft:string):DraftBits {
	if (draft.startsWith('@')) {
		const rest = draft.slice(1);
		const typing = rest !== '' && !rest.endsWith(' ');
		const bits = rest.trim().split(/\s+/).filter(Boolean);
		const partial = typing ? (bits[0] ?? '') : '';
		return {
			kind: 'at',
			words: bits,
			typing,
			head: '@',
			partial,
		};
	}
	if (!draft.startsWith('/')) {
		return { kind: 'plain', words: [], typing: false, head: '', partial: '' };
	}
	const rest = draft.slice(1);
	const typing = rest !== '' && !/\s$/.test(rest);
	const bits = rest.trim().split(/\s+/).filter(Boolean);
	const partial = typing ? (bits[bits.length - 1] ?? '') : '';
	const done = typing ? bits.slice(0, -1) : bits;
	const head = done.length === 0 ? '/' : `/${done.join(' ')} `;
	return { kind: 'slash', words: bits, typing, head, partial };
}

export function slashComplete(draft:string):boolean {
	const parsed = parseSlash(draft);
	return !!parsed?.ok;
}

export function suggestSay(draft:string, catalog:SayCatalog):SaySuggestion[] {
	const bits = readDraft(draft);
	if (bits.kind === 'at') {
		if (bits.words.length > 1 || (!bits.typing && bits.words.length === 1)) {
			return [];
		}
		return namedInserts('@', catalog.peers, bits.partial, true, 'address');
	}
	if (bits.kind !== 'slash') {
		return [];
	}

	const rawWords = bits.typing ? bits.words.slice(0, -1) : bits.words;
	const args = skipOptional(rawWords, false);
	const verb = (args[0] ?? '').toLowerCase();
	if (!verb) {
		return commandInserts(bits.partial);
	}

	const afterVerb = skipOptional(rawWords.slice(1), false);
	if (verb === 'give') {
		return suggestGive(bits.head, bits.partial, afterVerb, catalog);
	}
	if (verb === 'offer') {
		return suggestOffer(bits.head, bits.partial, afterVerb, catalog);
	}
	return [];
}

/** Goods to pick: `items`, then gold unless `purse` is null. With `amounts`, each is written with its amount (`4 gold`), else 1. */
function goodsInserts(head:string, partial:string, items:string[], purse:number | null, amounts:Record<string, number> | null, hint:string):SaySuggestion[] {
	const rows = [
		...namedInserts(head, items, partial, true, hint),
		...namedInserts(head, purse === null ? [] : ['gold'], partial, true, 'gold'),
	];
	if (!amounts) {
		return rows;
	}
	const count = (name:string):number => Object.entries(amounts).find(([key]) => compact(key) === compact(name))?.[1] ?? 1;
	return rows.map((row) => ({ ...row, insert: `${head}${count(row.label)} ${row.label} ` }));
}

/** One good, then whom. */
function suggestGive(
	head:string,
	partial:string,
	args:string[],
	catalog:SayCatalog,
):SaySuggestion[] {
	const purse = catalog.gold > 0 ? catalog.gold : null;
	if (args.length === 0) {
		return goodsInserts(head, partial, catalog.items, purse, {}, 'item').slice(0, SUGGEST_CAP);
	}
	if (args.length === 1 && compact(args[0]) === 'gold') {
		return namedInserts(head, purse ? [String(purse)] : [], partial, true, 'gold');
	}
	const goods = args.length === 1 && isAmount(args[0]) ? goodsInserts(head, partial, catalog.items, purse, null, 'item') : [];
	const named = typeof phrase(args.join(' ')) !== 'string';
	return [...goods, ...namedInserts(head, named ? catalog.peers : [], partial, false, 'person')].slice(0, SUGGEST_CAP);
}

function suggestOffer(
	head:string,
	partial:string,
	args:string[],
	catalog:SayCatalog,
):SaySuggestion[] {
	if (args.length === 0) {
		return namedInserts(head, catalog.peers, partial, true, 'person');
	}
	const forAt = args.findIndex((word) => word.toLowerCase() === 'for');
	// Their price and their goods are the amounts written by default.
	const theirs = catalog.offers[args[0].toLowerCase()] ?? { give: {}, get: {} };
	if (forAt < 0) {
		return suggestSide(head, partial, args.slice(1), catalog.items, catalog.gold > 0 ? catalog.gold : null, theirs.get, false);
	}
	const goods = Object.keys(theirs.give).filter((name) => compact(name) !== 'gold');
	return suggestSide(head, partial, args.slice(forAt + 1), goods, 0, theirs.give, true);
}

/** The next word of one side: `goods`, gold, nothing, and, or for. `wanted` is the side after `for`. */
function suggestSide(
	head:string,
	partial:string,
	side:string[],
	goods:string[],
	purse:number | null,
	amounts:Record<string, number>,
	wanted:boolean,
):SaySuggestion[] {
	const last = side.at(-1)?.toLowerCase();
	const prev = side.at(-2);
	const next = wanted ? ['and'] : ['for', 'and'];
	const hint = wanted ? 'offered' : 'item';
	if (side.length === 0 || last === 'and') {
		return [
			...goodsInserts(head, partial, goods, purse, amounts, hint),
			...namedInserts(head, side.length === 0 ? ['nothing'] : [], partial, !wanted, 'nothing'),
		].slice(0, SUGGEST_CAP);
	}
	if (last === 'nothing') {
		return wanted ? [] : namedInserts(head, ['for'], partial, true, 'in return');
	}
	if (last === 'gold' && !(prev && isAmount(prev))) {
		return namedInserts(head, purse ? [String(purse)] : [], partial, true, 'gold');
	}
	if (last && isAmount(last)) {
		return [
			...namedInserts(head, next.slice(0, -1), partial, true, 'in return'),
			...goodsInserts(head, partial, goods, purse, null, hint),
			...namedInserts(head, ['and'], partial, true, 'also'),
		].slice(0, SUGGEST_CAP);
	}
	return namedInserts(head, next, partial, true, 'in return');
}
