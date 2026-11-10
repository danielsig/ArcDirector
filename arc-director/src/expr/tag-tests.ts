import { lambdaParams, lex, type Tok } from './lex.js';

/** Fields a model reaches for to ask what something is, which only its tags answer. */
const TAG_FIELDS = new Set(['kind', 'role', 'type', 'class', 'name']);

/**
 * `expr` with what a model writes for "is this a Witch" as the language writes it: `u.is("Witch")`, `u.kind == "Witch"`,
 * and `u == "Witch"` of a lambda's own `u` all become `u is "Witch"`, and `!=` its opposite. Each otherwise matches no one,
 * without a word. Stored so, it is also shown back that way, so the model reads the real form. A field the host really
 * gives (`hasField`) is left alone. Text that does not lex comes back as it was.
 */
export function plainTagTests(expr:string, hasField:(name:string)=>boolean):string {
	let toks:Tok[];
	try {
		toks = lex(expr);
	}
	catch {
		return expr;
	}
	const endOf = (tok:Tok):number => tok.end ?? tok.i + tok.raw.length;
	const params = lambdaParams(toks);
	let out = '';
	let at = 0;
	for (let n = 0; n < toks.length; n++) {
		const who = toks[n];
		if (who.kind !== 'ident' || toks[n - 1]?.kind === 'dot' || toks[n - 1]?.kind === 'qdot' || who.i < at) {
			continue;
		}
		const [a, b, c, d, e] = toks.slice(n + 1, n + 6);
		let needle:Tok | undefined;
		let last:Tok | undefined;
		let negate = false;
		if (a?.kind === 'dot' && b?.kind === 'is' && c?.kind === 'lp' && d?.kind === 'str' && e?.kind === 'rp') {
			needle = d;
			last = e;
		}
		else if (a?.kind === 'dot' && b?.kind === 'ident' && TAG_FIELDS.has(b.raw) && (b.raw === 'name' || !hasField(b.raw)) && (c?.kind === 'eq' || c?.kind === 'neq') && d?.kind === 'str') {
			needle = d;
			last = d;
			negate = c.kind === 'neq';
		}
		else if (params.has(who.raw) && (a?.kind === 'eq' || a?.kind === 'neq') && b?.kind === 'str') {
			needle = b;
			last = b;
			negate = a.kind === 'neq';
		}
		if (needle && last) {
			const test = `${who.raw} is ${expr.slice(needle.i, endOf(needle))}`;
			out += expr.slice(at, who.i) + (negate ? `!(${test})` : test);
			at = endOf(last);
		}
	}
	return out + expr.slice(at);
}
