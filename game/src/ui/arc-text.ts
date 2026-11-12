/** What a run of an Arc's text is, for its color. A `wrong` one is a mistake the slate can see on its own: a closer with no opener of its kind, a quote never closed. */
export type ArcKind = 'plain' | 'verb' | 'fn' | 'name' | 'var' | 'number' | 'duration' | 'bool' | 'keyword' | 'declare' | 'key' | 'ending'
	| 'said' | 'mark' | 'op' | 'bracket' | 'wrong' | 'rune';

/** A run of an Arc's text and what it is. A bracket has its `level`: how many brackets around it are still open. */
export type ArcPiece = { text:string; kind:ArcKind; level?:number };

/** One line of an Arc, its indent apart so that it wraps at that same indent. */
export type ArcLine = { indent:number; pieces:ArcPiece[]; opens:boolean };

/** How far each level of an Arc's indent goes, in letters. */
export const ARC_INDENT = 2;

/** Where a long line of Arc may wrap besides its spaces: after these, each with a space too thin to see. */
const THIN_SPACE = String.fromCodePoint(0x200b);
const breakable = (text:string):string => text.replace(/[.(,]/g, (mark) => mark + THIN_SPACE);

/** A number, its `-` too where no value stands before it to take it away from. */
const NUMBER = String.raw`(?:(?<=(?:^|[-([{,=:<>!&|?+*/%])\s*)-)?\d+(?:\.\d+)?`;
/** Watch functions called bare (`some(…)`, `isHurt(me)`), which ask rather than act; any call after a `.` asks too. */
const QUERIES = 'some|all|none|count|nearby|reachable|approaching|departing|distance|doing|facing|manhattan|chebyshev|inSquare|not|clamp|softClamp|min|max|sum|avg';
/** What each part of an Arc is, the first that fits winning. A `var` is any other word, so no other part starts inside one. */
const PART = new RegExp([
	String.raw`(?<said>"[^"]*"?)`,
	String.raw`(?<duration>${NUMBER}(?:ms|min|s|m|h)\b)`,
	`(?<number>${NUMBER})`,
	String.raw`(?<bool>\b(?:true|false)\b)`,
	String.raw`(?<keyword>\b(?:if|else|loop|choose)\b)`,
	String.raw`(?<declare>\blet\b)`,
	String.raw`(?<ending>\b(?:until|within|unbreakable)\s*[=:](?![=>]))`,
	String.raw`(?<key>(?<!\blet\s+)\b\w+\s*[=:](?![=>]))`,
	String.raw`(?<fn>(?<=\.\s*)\w+(?=\()|\b(?:(?:is|has|was|can)[A-Z]\w*|${QUERIES})(?=\())`,
	String.raw`(?<verb>\b[a-z_]\w*(?=\())`,
	String.raw`(?<name>\b[A-Z]\w*)`,
	String.raw`(?<var>\w+)`,
	String.raw`(?<mark>&&|\|\||;)`,
	String.raw`(?<op>=>|[<>!=]=|[-<>!=+*/%])`,
	String.raw`(?<bracket>[()[\]{}])`,
].join('|'), 'g');
/** The keywords that are steps of their own, verbs written as keywords: a root one counts among `rootVerbs`. */
const STATEMENTS = new Set(['loop', 'choose']);
const OPENER:Record<string, string> = { ')': '(', ']': '[', '}': '{' };

/**
 * `text` in parts by what each is. `open` holds the brackets still open from the lines before, and is left holding those
 * still open after; `ended` says the text goes no further, so a quote still open at its end is never closed.
 */
function colored(text:string, open:string[], ended:boolean):ArcPiece[] {
	const out:ArcPiece[] = [];
	let from = 0;
	for (const m of text.matchAll(PART)) {
		const kind = Object.keys(m.groups!).find((group) => m.groups![group] !== undefined)!;
		if (m.index > from) {
			out.push({ text: breakable(text.slice(from, m.index)), kind: 'plain' });
		}
		out.push(part(m[0], kind as ArcKind, open, ended));
		from = m.index + m[0].length;
	}
	if (from < text.length) {
		out.push({ text: breakable(text.slice(from)), kind: 'plain' });
	}
	return out;
}

/** One part of `colored`'s, a bracket opening or closing one of `open`. */
function part(text:string, kind:ArcKind, open:string[], ended:boolean):ArcPiece {
	if (kind === 'said' && ended && (text.length < 2 || !text.endsWith('"'))) {
		return { text, kind: 'wrong' };
	}
	if (kind !== 'bracket') {
		return { text, kind };
	}
	if (!OPENER[text]) {
		open.push(text);
		return { text: breakable(text), kind, level: open.length - 1 };
	}
	if (open.at(-1) !== OPENER[text]) {
		return { text, kind: 'wrong' };
	}
	open.pop();
	return { text, kind, level: open.length };
}

/** `text` up to `end`, line by line. Past `settled` each letter is still a rune, whichever `rune` says for where it stands. */
export function arcLines(text:string, end = text.length, settled = end, rune:(i:number)=>string = () => ''):ArcLine[] {
	let at = 0;
	const open:string[] = [];
	return text.slice(0, end).split('\n').map((line) => {
		const indent = line.length - line.trimStart().length;
		const from = at + indent;
		const to = at + line.length;
		const pieces = colored(text.slice(from, Math.min(to, Math.max(from, settled))), open, settled > to || settled >= text.length);
		for (let i = Math.max(from, settled); i < to; i += 1) {
			pieces.push(/\s/.test(text[i]!) ? { text: text[i]!, kind: 'plain' } : { text: rune(i), kind: 'rune' });
		}
		at = to + 1;
		return { indent, pieces, opens: /[({[]$/.test(line.trimEnd()) };
	});
}

/** How far `piece` goes into brackets or out of them. Those in quoted words, and stray ones, do not count. */
export function bracketDepth(piece:ArcPiece):number {
	return piece.kind !== 'bracket' ? 0 : OPENER[piece.text] ? -1 : 1;
}

/** The verbs at the root of `lines` (in no bracket or block) whose calls close there, each with how many times it comes, in first-seen order. */
export function rootVerbs(lines:readonly ArcLine[]):[string, number][] {
	const counts = new Map<string, number>();
	let depth = 0;
	let open = '';
	for (const piece of lines.flatMap((line) => line.pieces)) {
		if ((piece.kind === 'verb' || STATEMENTS.has(piece.text)) && depth === 0) {
			open = piece.text;
			continue;
		}
		depth += bracketDepth(piece);
		if (depth <= 0 && open) {
			counts.set(open, (counts.get(open) ?? 0) + 1);
			open = '';
		}
	}
	return [...counts];
}

/** The last of a think's reasoning: a few lines' worth, whole words. */
export function thoughtTail(thought:string):string {
	const text = thought.replace(/\s+/g, ' ').trim();
	return text.length > 170 ? `…${text.slice(text.indexOf(' ', text.length - 170) + 1)}` : text;
}

export function thinkTime(ms:number):string {
	return `${Math.round(ms).toLocaleString('en-US')} ms`;
}
