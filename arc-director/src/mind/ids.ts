import { mapArgs, type Arc } from '../arc/types.js';
import type { VerbRegistry } from '../arc/stock-verbs.js';
import { lex } from '../expr/lex.js';
import { lawGroup } from '../arc/laws.js';
import type { NameBook } from '../character/names.js';

/**
 * Arcs, laws, watches and sight focus are stored in ids. A mind's model reads and writes its own names
 * for characters, so each mind turns its model's replies into ids and its prompts back into names, through
 * the names its owner gave ({@link NameBook}).
 */

/** One word rewritten: a name to its id, or an id to a name. Any other word comes back unchanged. */
export type WordMap = (word:string)=>string;

/** The ids behind the names `book` gave. */
export function idsOf(book:NameBook):WordMap {
	return (word) => book.resolve(word);
}

/** `book`'s names for ids. An id it never named stays as it is. */
export function namesOf(book:NameBook):WordMap {
	return (word) => book.peek(word) ?? word;
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * `expr` with each identifier and string literal that `map` knows rewritten. Member names (`me.hp`) stay.
 * A word that is no identifier is written as a string literal. Text that does not lex is left alone.
 */
export function mapExpr(expr:string, map:WordMap):string {
	let toks;
	try {
		toks = lex(expr);
	}
	catch {
		return expr;
	}
	let out = '';
	let at = 0;
	toks.forEach((tok, n) => {
		const member = toks[n - 1]?.kind === 'dot' || toks[n - 1]?.kind === 'qdot';
		const word = tok.kind === 'str' || (tok.kind === 'ident' && !member) ? map(tok.raw) : tok.raw;
		if (word === tok.raw) {
			return;
		}
		const quote = tok.kind === 'str' ? expr[tok.i] : '"';
		const written = tok.kind === 'ident' && IDENT.test(word)
			? word
			: quote + word.replaceAll('\\', '\\\\').replaceAll(quote, `\\${quote}`) + quote;
		out += expr.slice(at, tok.i) + written;
		at = tok.end ?? tok.i + tok.raw.length;
	});
	return out + expr.slice(at);
}

/** `arc` with every character it names rewritten by `map`, read by each verb's arg kinds. Prose is never touched. */
export function mapArc(arc:Arc, verbs:VerbRegistry, map:WordMap):Arc {
	return mapArgs(arc, verbs, (text, kind) => mapArg(kind, text, map));
}

function mapArg(kind:string, value:string, map:WordMap):string {
	if (kind === 'id') {
		const word = value.trim();
		const whole = map(word);
		return whole !== word ? whole : mapExpr(value, map);
	}
	if (kind === 'watch' || kind === 'expr') {
		return mapExpr(value, map);
	}
	if (kind === 'law') {
		return mapLawName(value, map);
	}
	return value;
}

/** A member's law is `Tom.flee`: its group, before the last `.`, is that member. */
export function mapLawName(name:string, map:WordMap):string {
	const group = lawGroup(name);
	return group ? map(group) + name.slice(group.length) : name;
}
