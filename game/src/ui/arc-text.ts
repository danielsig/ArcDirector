/** A run of an Arc's text and what it is, for its color. */
export type ArcPiece = { text:string; kind:'plain' | 'verb' | 'mark' | 'said' | 'rune' };

/** One line of an Arc, its indent apart so that it wraps at that same indent. */
export type ArcLine = { indent:number; pieces:ArcPiece[]; opens:boolean };

/** How far each level of an Arc's indent goes, in letters. */
export const ARC_INDENT = 2;

/** Where a long line of Arc may wrap besides its spaces: after these, each with a space too thin to see. */
const THIN_SPACE = String.fromCodePoint(0x200b);
const breakable = (text:string):string => text.replace(/[.(,]/g, (mark) => mark + THIN_SPACE);

/** Arc text colored by what each part of it is: the verbs, the quoted words, and the marks that join steps. */
function colored(text:string):ArcPiece[] {
	const out:ArcPiece[] = [];
	const part = /([A-Za-z_]\w*)(?=\()|"[^"]*"?|&&|\|\||;/g;
	let from = 0;
	for (let m = part.exec(text); m; m = part.exec(text)) {
		if (m.index > from) {
			out.push({ text: breakable(text.slice(from, m.index)), kind: 'plain' });
		}
		out.push({ text: m[0], kind: m[1] ? 'verb' : m[0].startsWith('"') ? 'said' : 'mark' });
		from = m.index + m[0].length;
	}
	if (from < text.length) {
		out.push({ text: breakable(text.slice(from)), kind: 'plain' });
	}
	return out;
}

/** `text` up to `end`, line by line. Past `settled` each letter is still a rune, whichever `rune` says for where it stands. */
export function arcLines(text:string, end = text.length, settled = end, rune:(i:number)=>string = () => ''):ArcLine[] {
	let at = 0;
	return text.slice(0, end).split('\n').map((line) => {
		const indent = line.length - line.trimStart().length;
		const from = at + indent;
		const to = at + line.length;
		const pieces = colored(text.slice(from, Math.min(to, Math.max(from, settled))));
		for (let i = Math.max(from, settled); i < to; i += 1) {
			pieces.push(/\s/.test(text[i]!) ? { text: text[i]!, kind: 'plain' } : { text: rune(i), kind: 'rune' });
		}
		at = to + 1;
		return { indent, pieces, opens: line.trimEnd().endsWith('(') };
	});
}

/** How far brackets in `piece` go in or out. Those in quoted words do not count. */
export function bracketDepth(piece:ArcPiece):number {
	return piece.kind === 'said' ? 0 : piece.text.split('(').length - piece.text.split(')').length;
}

/** The verbs at the root of `lines` whose calls close there, each with how many times it comes, in first-seen order. */
export function rootVerbs(lines:readonly ArcLine[]):[string, number][] {
	const counts = new Map<string, number>();
	let depth = 0;
	let open = '';
	for (const piece of lines.flatMap((line) => line.pieces)) {
		if (piece.kind === 'verb' && depth === 0) {
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
