export type LogEntry = {
	seq:number;
	name:string;
	message:string;
	image?:boolean;
};

/** First capture group, or the whole match. Empty string when nothing matches. */
export type Take = (re:RegExp, text?:string)=>string;

/**
 * Reduce each log row with a JavaScript expression. `entry` is the row; `take(re, text?)` is the first match in `text` (default `entry.message`).
 * A string becomes `{ seq, name, text }`. An object is kept as returned. `null`, `undefined`, and `false` drop the row.
 */
export function projectEntries(entries:LogEntry[], each:string | undefined):unknown {
	if (!each) {
		return entries;
	}
	let fn:(entry:LogEntry, take:Take)=>unknown;
	try {
		fn = new Function('entry', 'take', `"use strict"; return (${each});`) as (entry:LogEntry, take:Take)=>unknown;
	}
	catch (err) {
		throw new Error(`each: ${err instanceof Error ? err.message : String(err)}`);
	}
	const out:unknown[] = [];
	for (const entry of entries) {
		const take:Take = (re, text = entry.message) => {
			const found = text.match(re);
			if (!found) {
				return '';
			}
			return found[1] ?? found[0];
		};
		let value:unknown;
		try {
			value = fn(entry, take);
		}
		catch (err) {
			throw new Error(`each on #${entry.seq}: ${err instanceof Error ? err.message : String(err)}`);
		}
		if (value == null || value === false) {
			continue;
		}
		out.push(typeof value === 'string' ? { seq: entry.seq, name: entry.name, text: value } : value);
	}
	return out;
}
