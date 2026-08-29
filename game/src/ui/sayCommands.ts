/** Player slash commands in the say box. Names only — no coordinates. */

export const SAY_COMMANDS = [
	{ verb: 'give', usage: '/give <item|gold> [to] <person>', hint: 'Gift an item, or gold from your purse' },
	{ verb: 'pay', usage: '/pay <amount> [to] <person>', hint: 'Give gold from your purse' },
	{ verb: 'buy', usage: '/buy <item> [from] <person> [offer]', hint: 'Pay gold and take a good' },
	{ verb: 'sell', usage: '/sell <item> [to] <person> [ask]', hint: 'Take gold and give a good' },
	{ verb: 'help', usage: '/help', hint: 'List slash commands' },
] as const;

const SKIP = new Set(['to', 'from', 'with']);
const SUGGEST_CAP = 8;

export type SayCatalog = {
	peers:string[];
	items:string[];
	gold:number;
	goods:{ item:string; from:string }[];
};

export type SaySuggestion = {
	insert:string;
	label:string;
	hint:string;
};

export type ParsedSlash =
	| { ok:true; verb:'help' }
	| { ok:true; verb:'give'; item:string; to:string }
	| { ok:true; verb:'pay'; amount:number; to:string }
	| { ok:true; verb:'buy'; item:string; from:string; offer?:number }
	| { ok:true; verb:'sell'; item:string; to:string; ask?:number }
	| { ok:false; reason:string };

export const SLASH_HELP = SAY_COMMANDS.map((c) => c.usage).join('   ');

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
		return { ok: false, reason: 'try /help' };
	}
	const verb = words[0].toLowerCase();
	const args = skipOptional(words.slice(1), false);
	if (verb === 'help') {
		return { ok: true, verb: 'help' };
	}
	if (verb === 'give') {
		return parseGive(args);
	}
	if (verb === 'pay') {
		return parsePay(args);
	}
	if (verb === 'buy') {
		return parseBuy(args);
	}
	if (verb === 'sell') {
		return parseSell(args);
	}
	return { ok: false, reason: `unknown /${verb} — try /help` };
}

function parseGive(args:string[]):ParsedSlash {
	if (args.length === 0) {
		return { ok: false, reason: 'give what?  /give <item> <person>' };
	}
	const goldWord = compact(args[0]) === 'gold';
	if (goldWord || isAmount(args[0])) {
		let amount:number;
		let rest:string[];
		if (isAmount(args[0])) {
			amount = Math.floor(Number(args[0]));
			rest = args.slice(1);
		}
		else if (!isAmount(args[1] ?? '')) {
			return { ok: false, reason: 'how much gold?  /give gold <amount> <person>' };
		}
		else {
			amount = Math.floor(Number(args[1]));
			rest = args.slice(2);
		}
		const to = rest[0] ?? '';
		if (!to) {
			return { ok: false, reason: 'give gold to whom?' };
		}
		return { ok: true, verb: 'pay', amount, to };
	}
	if (args.length < 2) {
		return { ok: false, reason: 'give to whom?' };
	}
	return { ok: true, verb: 'give', item: args[0], to: args[1] };
}

function parsePay(args:string[]):ParsedSlash {
	if (!isAmount(args[0] ?? '')) {
		return { ok: false, reason: 'how much?  /pay <amount> <person>' };
	}
	const to = args[1] ?? '';
	if (!to) {
		return { ok: false, reason: 'pay whom?' };
	}
	return { ok: true, verb: 'pay', amount: Math.floor(Number(args[0])), to };
}

function parseBuy(args:string[]):ParsedSlash {
	if (args.length === 0) {
		return { ok: false, reason: 'buy what?  /buy <item> <person>' };
	}
	let offer:number | undefined;
	const body = [...args];
	const last = body[body.length - 1];
	if (body.length >= 3 && isAmount(last)) {
		offer = Math.floor(Number(last));
		body.pop();
	}
	if (body.length < 2) {
		return { ok: false, reason: 'buy from whom?' };
	}
	return { ok: true, verb: 'buy', item: body[0], from: body[1], offer };
}

function parseSell(args:string[]):ParsedSlash {
	if (args.length === 0) {
		return { ok: false, reason: 'sell what?  /sell <item> <person>' };
	}
	let ask:number | undefined;
	const body = [...args];
	const last = body[body.length - 1];
	if (body.length >= 3 && isAmount(last)) {
		ask = Math.floor(Number(last));
		body.pop();
	}
	if (body.length < 2) {
		return { ok: false, reason: 'sell to whom?' };
	}
	return { ok: true, verb: 'sell', item: body[0], to: body[1], ask };
}

function uniq(values:string[]):string[] {
	const seen = new Set<string>();
	const out:string[] = [];
	for (const v of values) {
		const key = compact(v);
		if (!key || seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push(v);
	}
	return out;
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
		insert: finish('/', c.verb, c.verb !== 'help'),
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

	if (verb === 'help') {
		return [];
	}

	if (verb === 'give') {
		return suggestGive(bits.head, bits.partial, afterVerb, catalog);
	}
	if (verb === 'pay') {
		return suggestPay(bits.head, bits.partial, afterVerb, catalog);
	}
	if (verb === 'buy') {
		return suggestBuy(bits.head, bits.partial, afterVerb, catalog);
	}
	if (verb === 'sell') {
		return suggestSell(bits.head, bits.partial, afterVerb, catalog);
	}
	return [];
}

function suggestGive(
	head:string,
	partial:string,
	args:string[],
	catalog:SayCatalog,
):SaySuggestion[] {
	const goldChoices = catalog.gold > 0 ? ['gold'] : [];
	if (args.length === 0) {
		return [
			...namedInserts(head, catalog.items, partial, true, 'item'),
			...namedInserts(head, goldChoices, partial, true, 'purse'),
		].slice(0, SUGGEST_CAP);
	}
	const goldPath = compact(args[0]) === 'gold' || isAmount(args[0]);
	if (goldPath) {
		if (compact(args[0]) === 'gold' && args.length === 1) {
			const amounts = catalog.gold > 0 ? [String(catalog.gold)] : [];
			return namedInserts(head, amounts, partial, true, 'gold');
		}
		if (args.length >= 2 && compact(args[0]) === 'gold') {
			return namedInserts(head, catalog.peers, partial, false, 'person');
		}
		if (isAmount(args[0]) && args.length === 1) {
			return namedInserts(head, catalog.peers, partial, false, 'person');
		}
		return [];
	}
	if (args.length === 1) {
		return namedInserts(head, catalog.peers, partial, false, 'person');
	}
	return [];
}

function suggestPay(
	head:string,
	partial:string,
	args:string[],
	catalog:SayCatalog,
):SaySuggestion[] {
	if (args.length === 0) {
		const amounts = catalog.gold > 0 ? [String(catalog.gold)] : [];
		return namedInserts(head, amounts, partial, true, 'gold');
	}
	if (args.length === 1) {
		return namedInserts(head, catalog.peers, partial, false, 'person');
	}
	return [];
}

function suggestBuy(
	head:string,
	partial:string,
	args:string[],
	catalog:SayCatalog,
):SaySuggestion[] {
	const goods = uniq(catalog.goods.map((g) => g.item));
	if (args.length === 0) {
		return namedInserts(head, goods, partial, true, 'for sale');
	}
	if (args.length === 1) {
		const sellers = uniq(
			catalog.goods.filter((g) => compact(g.item) === compact(args[0])).map((g) => g.from),
		);
		const names = sellers.length > 0 ? sellers : catalog.peers;
		return namedInserts(head, names, partial, false, 'seller');
	}
	return [];
}

function suggestSell(
	head:string,
	partial:string,
	args:string[],
	catalog:SayCatalog,
):SaySuggestion[] {
	if (args.length === 0) {
		return namedInserts(head, catalog.items, partial, true, 'item');
	}
	if (args.length === 1) {
		return namedInserts(head, catalog.peers, partial, false, 'person');
	}
	return [];
}
