export type JsonSchema = {
	type?:string | string[];
	properties?:Record<string, JsonSchema>;
	required?:string[];
	additionalProperties?:boolean | JsonSchema;
	enum?:Array<string | number | boolean | null>;
	const?:string | number | boolean | null;
	items?:JsonSchema;
	oneOf?:JsonSchema[];
	anyOf?:JsonSchema[];
	$ref?:string;
	$defs?:Record<string, JsonSchema>;
	description?:string;
	minimum?:number;
	maximum?:number;
	minItems?:number;
	title?:string;
};

export function extractJson(text:string):unknown {
	const trimmed = text.trim();
	const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
	// Repaired first: a late-closed string can still parse, into the wrong nesting.
	const body = repairJSON(fenced ? fenced[1].trim() : trimmed);
	try {
		return JSON.parse(body);
	}
	catch {
		return parseLooseObject(body);
	}
}

/**
 * `body` with the slips a model makes in long JSON undone: an expression closed late, after the brackets that end it
 * (`"minBy(u => u.hp)}]},"` for `"minBy(u => u.hp)"}]},`), then a comma left before a closing bracket.
 */
function repairJSON(body:string):string {
	const closed = eachPart(body, (text) => {
		const cut = lateClose(text);
		return cut === undefined ? `"${text}"` : `"${text.slice(0, cut)}"${text.slice(cut)}`;
	});
	return eachPart(closed, (text) => `"${text}"`, (structure) => structure.replace(/,(\s*[}\]])/g, '$1'));
}

/** `body` rebuilt from its strings' insides through `string` and the JSON between them through `structure`. */
function eachPart(body:string, string:(text:string)=>string, structure = (text:string):string => text):string {
	let out = '';
	let from = 0;
	for (let open = body.indexOf('"'); open >= 0; open = body.indexOf('"', from)) {
		const end = stringEnd(body, open);
		out += structure(body.slice(from, open)) + (end < body.length ? string(body.slice(open + 1, end)) : body.slice(open));
		from = end + 1;
	}
	return out + structure(body.slice(from));
}

/** The index of the quote that closes the string opening at `open`, or the end of `text`. */
function stringEnd(text:string, open:number):number {
	for (let i = open + 1; i < text.length; i++) {
		if (text[i] === '\\') {
			i++;
		}
		else if (text[i] === '"') {
			return i;
		}
	}
	return text.length;
}

/** Where an expression string should have closed: right after its parentheses balance, when only brackets follow. */
function lateClose(text:string):number | undefined {
	let depth = 0;
	let cut:number | undefined;
	for (let i = 0; i < text.length; i++) {
		if (text[i] === '(') {
			depth++;
		}
		else if (text[i] === ')' && --depth === 0) {
			cut = i + 1;
		}
	}
	return cut !== undefined && /^[\s,{]*[\]}][\s,\]}{]*$/.test(text.slice(cut)) ? cut : undefined;
}

type Frame = '{' | '[';

/** The object in `body`, or the list when `body` opens with one; closed where the model cut it off. */
function parseLooseObject(body:string):unknown {
	const start = body.startsWith('[') ? 0 : body.indexOf('{');
	if (start < 0) {
		throw new Error('no JSON object in model output');
	}
	const stack:Frame[] = [];
	let inStr = false;
	let esc = false;
	for (let i = start; i < body.length; i++) {
		const ch = body[i];
		if (inStr) {
			if (esc) {
				esc = false;
			}
			else if (ch === '\\') {
				esc = true;
			}
			else if (ch === '"') {
				inStr = false;
			}
			continue;
		}
		if (ch === '"') {
			inStr = true;
			continue;
		}
		if (ch === '{') {
			stack.push('{');
			continue;
		}
		if (ch === '[') {
			stack.push('[');
			continue;
		}
		if (ch === '}' || ch === ']') {
			const open = stack.pop();
			const expected:Frame = ch === '}' ? '{' : '[';
			if (open !== expected) {
				break;
			}
			if (stack.length === 0) {
				return JSON.parse(body.slice(start, i + 1));
			}
		}
	}
	let raw = body.slice(start).trimEnd();
	if (inStr) {
		raw += '"';
	}
	if (raw.endsWith(',')) {
		raw = raw.slice(0, -1);
	}
	for (let i = stack.length - 1; i >= 0; i--) {
		raw += stack[i] === '{' ? '}' : ']';
	}
	try {
		return JSON.parse(raw);
	}
	catch {
		throw new Error('unbalanced JSON object in model output');
	}
}

export function isRecord(v:unknown):v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Current `id`, or a saved blob that still uses `ID`. */
export function readID(row:unknown):string | undefined {
	if (!isRecord(row)) {
		return undefined;
	}
	if (typeof row.id === 'string') {
		return row.id;
	}
	const legacy = row['ID'];
	return typeof legacy === 'string' ? legacy : undefined;
}
