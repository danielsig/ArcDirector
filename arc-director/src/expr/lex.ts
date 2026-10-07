export type TokKind =
	| 'num' | 'str' | 'ident'
	| 'true' | 'false' | 'null' | 'undefined'
	| 'and' | 'or' | 'eq' | 'neq' | 'is' | 'in'
	| 'lt' | 'gt' | 'le' | 'ge'
	| 'plus' | 'minus' | 'star' | 'slash'
	| 'amp' | 'pipe' | 'qq' | 'not'
	| 'dot' | 'qdot'
	| 'lp' | 'rp' | 'lb' | 'rb' | 'comma' | 'colon' | 'q' | 'arrow'
	| 'eof';

/** `i` is where the token starts in the source. A `str` token's `raw` drops its quotes, so it also has `end`. */
export type Tok = { kind:TokKind; raw:string; n?:number; i:number; end?:number };

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
	'===': 'eq',
};

export function lex(src:string):Tok[] {
	const out:Tok[] = [];
	let i = 0;
	while (i < src.length) {
		const c = src[i];
		if (/\s/.test(c)) {
			i += 1;
			continue;
		}
		if (src.startsWith('===', i)) {
			out.push({ kind: 'eq', raw: '===', i });
			i += 3;
			continue;
		}
		const two = src.slice(i, i + 2);
		if (TWO[two]) {
			out.push({ kind: TWO[two], raw: two, i });
			i += 2;
			continue;
		}
		if (c === '"' || c === "'") {
			const q = c;
			const start = i;
			i += 1;
			let s = '';
			while (i < src.length) {
				if (src[i] === '\\' && i + 1 < src.length) {
					s += src[i + 1];
					i += 2;
					continue;
				}
				if (src[i] === q) {
					i += 1;
					break;
				}
				s += src[i];
				i += 1;
			}
			out.push({ kind: 'str', raw: s, i: start, end: i });
			continue;
		}
		if (/[0-9]/.test(c) || (c === '.' && i + 1 < src.length && /[0-9]/.test(src[i + 1]))) {
			const start = i;
			while (i < src.length && /[0-9.]/.test(src[i])) {
				i += 1;
			}
			const raw = src.slice(start, i);
			out.push({ kind: 'num', raw, n: Number(raw), i: start });
			continue;
		}
		if (/[A-Za-z_$]/.test(c)) {
			const start = i;
			while (i < src.length && /[A-Za-z0-9_$]/.test(src[i])) {
				i += 1;
			}
			const raw = src.slice(start, i);
			const low = raw.toLowerCase();
			if (raw === 'true') {
				out.push({ kind: 'true', raw, i: start });
			}
			else if (raw === 'false') {
				out.push({ kind: 'false', raw, i: start });
			}
			else if (raw === 'null' || raw === 'undefined') {
				out.push({ kind: raw === 'null' ? 'null' : 'undefined', raw, i: start });
			}
			else if (raw === 'is') {
				out.push({ kind: 'is', raw, i: start });
			}
			else if (raw === 'in') {
				out.push({ kind: 'in', raw, i: start });
			}
			else if (low === 'and') {
				out.push({ kind: 'amp', raw, i: start });
			}
			else if (low === 'or') {
				out.push({ kind: 'pipe', raw, i: start });
			}
			else if (low === 'equals') {
				out.push({ kind: 'eq', raw, i: start });
			}
			else {
				out.push({ kind: 'ident', raw, i: start });
			}
			continue;
		}
		const singles:Record<string, TokKind> = {
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
			',': 'comma',
			':': 'colon',
			'?': 'q',
			'<': 'lt',
			'>': 'gt',
			'=': 'eq',
		};
		const k = singles[c];
		if (k) {
			out.push({ kind: k, raw: c, i });
			i += 1;
			continue;
		}
		throw new Error(`unexpected '${c}' in expression`);
	}
	out.push({ kind: 'eof', raw: '', i });
	return out;
}
