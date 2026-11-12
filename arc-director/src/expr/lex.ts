export type TokKind =
	| 'num' | 'str' | 'ident'
	| 'true' | 'false' | 'null' | 'undefined'
	| 'eq' | 'neq' | 'is' | 'in'
	| 'lt' | 'gt' | 'le' | 'ge'
	| 'plus' | 'minus' | 'star' | 'slash'
	| 'amp' | 'pipe' | 'qq' | 'not'
	| 'dot' | 'qdot'
	| 'lp' | 'rp' | 'lb' | 'rb' | 'lbrace' | 'rbrace' | 'comma' | 'semi' | 'colon' | 'q' | 'arrow'
	| 'bad' | 'eof';

/**
 * `i` is where the token starts in the source and `end` where it stops (a `str` token's `raw` drops its quotes). `nl`: a
 * line break stands between it and the token before. `hint`: why a `bad` token is not one.
 */
export type Tok = { kind:TokKind; raw:string; n?:number; i:number; end:number; nl?:boolean; hint?:string };

const TWO:Record<string, TokKind> = {
	'&&': 'amp',
	'||': 'pipe',
	'??': 'qq',
	'==': 'eq',
	'!=': 'neq',
	'<=': 'le',
	'>=': 'ge',
	'=>': 'arrow',
	'?.': 'qdot',
};

const SINGLE:Record<string, TokKind> = {
	'+': 'plus',
	'-': 'minus',
	'*': 'star',
	'/': 'slash',
	'!': 'not',
	'.': 'dot',
	'(': 'lp',
	')': 'rp',
	'[': 'lb',
	']': 'rb',
	'{': 'lbrace',
	'}': 'rbrace',
	',': 'comma',
	';': 'semi',
	':': 'colon',
	'?': 'q',
	'<': 'lt',
	'>': 'gt',
	'=': 'eq',
};

const WORDS:Record<string, TokKind> = {
	true: 'true',
	false: 'false',
	null: 'null',
	undefined: 'undefined',
	is: 'is',
	in: 'in',
};

/** Words read as operators whatever their case. */
const LOOSE_WORDS:Record<string, TokKind> = { and: 'amp', or: 'pipe', equals: 'eq' };

/** Game seconds in one of each duration unit: `5s`, `1.5min`, `2h`. */
const DURATION:Record<string, number> = { s: 1, min: 60, h: 3600 };

/** The game seconds a duration such as `10s` or `1.5min` is; none for a bare number or anything else. */
export function durationSeconds(text:string):number | undefined {
	const tok = lexAt(text, 0);
	return tok.kind === 'num' && tok.end === text.length && /[a-z]$/.test(tok.raw) ? tok.n : undefined;
}

/** Why `5m` is no number: sight writes meters so, and a duration in minutes is `5min`. */
export const METERS_HINT = 'distances are plain numbers; minutes are min';

/**
 * Where the comment that starts at `i` in `src` stops: `//` at the end of its line (the line break stays), `/* … *\/`
 * after its close, either at the end of `src` when never closed. None when no comment starts at `i`. Arc text and Arc
 * JSON both read comments as space: small models write them, and they mean nothing.
 */
export function commentEnd(src:string, i:number):number | undefined {
	if (src.startsWith('//', i)) {
		const end = src.indexOf('\n', i);
		return end < 0 ? src.length : end;
	}
	if (src.startsWith('/*', i)) {
		const end = src.indexOf('*/', i + 2);
		return end < 0 ? src.length : end + 2;
	}
	return undefined;
}

/**
 * The token that starts at or after `i` in `src`. Never throws: a character no token starts with is a `bad` token.
 * Comments (`commentEnd`) are space.
 */
export function lexAt(src:string, i:number):Tok {
	let nl = false;
	for (let stop:number | undefined; ;) {
		if (i < src.length && /\s/.test(src[i])) {
			nl ||= src[i] === '\n';
			i += 1;
		}
		else if ((stop = commentEnd(src, i)) !== undefined) {
			nl ||= src.slice(i, stop).includes('\n');
			i = stop;
		}
		else {
			break;
		}
	}
	const tok = (kind:TokKind, raw:string, end:number, n?:number):Tok => ({ kind, raw, i: start, end, ...(n === undefined ? {} : { n }), ...(nl ? { nl } : {}) });
	const start = i;
	if (i >= src.length) {
		return tok('eof', '', i);
	}
	const c = src[i];
	for (const three of ['===', '!==']) {
		if (src.startsWith(three, i)) {
			return tok(three === '===' ? 'eq' : 'neq', three, i + 3);
		}
	}
	const two = src.slice(i, i + 2);
	if (TWO[two]) {
		return tok(TWO[two], two, i + 2);
	}
	if (c === '"' || c === "'") {
		let s = '';
		i += 1;
		while (i < src.length && src[i] !== c) {
			const escaped = src[i] === '\\' && i + 1 < src.length;
			s += src[escaped ? i + 1 : i];
			i += escaped ? 2 : 1;
		}
		return tok('str', s, Math.min(i + 1, src.length));
	}
	if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
		while (i < src.length && /[0-9.]/.test(src[i])) {
			i += 1;
		}
		const raw = src.slice(start, i);
		const unit = /^[A-Za-z_$][\w$]*/.exec(src.slice(i))?.[0] ?? '';
		if (unit === 'm') {
			return { ...tok('bad', raw + unit, i + 1), hint: `${raw + unit}: ${METERS_HINT}` };
		}
		const seconds = Object.hasOwn(DURATION, unit) ? DURATION[unit] : undefined;
		return seconds === undefined ? tok('num', raw, i, Number(raw)) : tok('num', raw + unit, i + unit.length, Number(raw) * seconds);
	}
	if (/[A-Za-z_$]/.test(c)) {
		while (i < src.length && /[A-Za-z0-9_$]/.test(src[i])) {
			i += 1;
		}
		const raw = src.slice(start, i);
		return tok(Object.hasOwn(WORDS, raw) ? WORDS[raw] : LOOSE_WORDS[raw.toLowerCase()] ?? 'ident', raw, i);
	}
	return tok(SINGLE[c] ?? 'bad', c, i + 1);
}

/** Every token of `src`, ending in `eof`. Throws at a character no token starts with. */
export function lex(src:string):Tok[] {
	const out:Tok[] = [];
	for (let at = 0; ;) {
		const tok = lexAt(src, at);
		if (tok.kind === 'bad') {
			throw new Error(tok.hint ?? `unexpected '${tok.raw}' in expression`);
		}
		out.push(tok);
		if (tok.kind === 'eof') {
			return out;
		}
		at = tok.end;
	}
}

/** The names `toks` binds as lambda params, both ways the language writes them: `u => …` and `(a, b) => …`. */
export function lambdaParams(toks:readonly Tok[]):Set<string> {
	const params = new Set<string>();
	toks.forEach((tok, n) => {
		const before = toks[n - 1];
		if (tok.kind === 'arrow' && before?.kind === 'ident') {
			params.add(before.raw);
		}
		else if (tok.kind === 'arrow' && before?.kind === 'rp') {
			for (let i = n - 2; toks[i]?.kind === 'ident' || toks[i]?.kind === 'comma'; i--) {
				if (toks[i].kind === 'ident') {
					params.add(toks[i].raw);
				}
			}
		}
	});
	return params;
}
