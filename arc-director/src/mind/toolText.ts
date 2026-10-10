import type { ToolDef } from '../inference/provider.js';

/** A tool call a model wrote as text where the Arc goes, instead of calling the tool. */
export type WrittenToolCall = { name:string; args:Record<string, unknown> };

/** Opens a tool call at the start of the reply, a line, or after a join: `earshot(`, `call:observe{`, `tool:recall {`. */
const HEAD = /(^|\n|&&|\|\||;)(\s*)(?:(?:call|tool)\s*:\s*)?([A-Za-z_]\w*)\s*([({])/g;

/**
 * Tool calls written as text, in any of the shapes small models slip into: `earshot(to=Forager)`, `recall("Bread")`,
 * `earshot{to="Forager"}`, or a chat template's own syntax that reached the reply unparsed
 * (`call:observe{expr:<|"|>isNear(me, Forager)<|"|>}`). Only names in `firstArgs` count, and only at the start of
 * the reply, a line, or after a join, so prose and nested args are never read. `rest` is the reply without them;
 * `firstArgs` names the arg a lone value fills (`recall("Bread")` is `query`).
 */
export function writtenToolCalls(text:string, firstArgs:ReadonlyMap<string, string | undefined>):{ calls:WrittenToolCall[]; rest:string } {
	const src = text.replaceAll('<|"|>', '"');
	const calls:WrittenToolCall[] = [];
	let rest = '';
	let at = 0;
	for (const m of src.matchAll(HEAD)) {
		const start = m.index + m[1].length;
		if (start < at || !firstArgs.has(m[3])) {
			continue;
		}
		const open = m.index + m[0].length - 1;
		const close = closing(src, open);
		if (close < 0) {
			continue;
		}
		calls.push({ name: m[3], args: argsOf(src.slice(open + 1, close), m[4] === '{', firstArgs.get(m[3])) });
		rest += src.slice(at, start);
		at = close + 1;
	}
	rest += src.slice(at);
	return { calls, rest: calls.length > 0 ? tidyJoins(rest) : text };
}

/** Index of the bracket that closes the one at `open`, outside quotes; -1 when it never closes. */
function closing(s:string, open:number):number {
	let depth = 0;
	let quote = '';
	for (let i = open; i < s.length; i++) {
		const c = s[i];
		if (quote) {
			if (c === '\\') {
				i += 1;
			}
			else if (c === quote) {
				quote = '';
			}
		}
		else if (c === '"' || c === '\'') {
			quote = c;
		}
		else if (c === '(' || c === '{') {
			depth += 1;
		}
		else if ((c === ')' || c === '}') && --depth === 0) {
			return i;
		}
	}
	return -1;
}

/** `k=v, k2:v2`, or one lone value for `first`. Quoted values lose their quotes; numbers become numbers. */
function argsOf(body:string, braces:boolean, first:string | undefined):Record<string, unknown> {
	const text = body.trim();
	if (!text) {
		return {};
	}
	if (!braces && !/^[A-Za-z_]\w*\s*[:=](?!=)/.test(text)) {
		return first ? { [first]: valueOf(text) } : {};
	}
	const args:Record<string, unknown> = {};
	for (const part of splitTop(text)) {
		const m = /^\s*([A-Za-z_]\w*)\s*[:=](?!=)\s*([\s\S]*)$/.exec(part);
		if (m) {
			args[m[1]] = valueOf(m[2].trim());
		}
	}
	return args;
}

function valueOf(raw:string):unknown {
	const quoted = /^(["'])([\s\S]*)\1$/.exec(raw);
	if (quoted) {
		return quoted[2];
	}
	return /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
}

/** `s` split on commas outside quotes and brackets. */
function splitTop(s:string):string[] {
	const parts:string[] = [];
	let depth = 0;
	let quote = '';
	let from = 0;
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (quote) {
			if (c === '\\') {
				i += 1;
			}
			else if (c === quote) {
				quote = '';
			}
		}
		else if (c === '"' || c === '\'') {
			quote = c;
		}
		else if ('({['.includes(c)) {
			depth += 1;
		}
		else if (')}]'.includes(c)) {
			depth -= 1;
		}
		else if (c === ',' && depth === 0) {
			parts.push(s.slice(from, i));
			from = i + 1;
		}
	}
	parts.push(s.slice(from));
	return parts;
}

/** What is left once the calls are cut out: no join at either end, none doubled, no blank lines. */
function tidyJoins(s:string):string {
	return s
		.split('\n')
		.map((line) => line
			.replace(/(&&|\|\||;)\s*(?:(?:&&|\|\||;)\s*)+/g, '$1 ')
			.replace(/^\s*(?:&&|\|\||;)\s*/, '')
			.replace(/\s*(?:&&|\|\||;)\s*$/, '')
			.trim())
		.filter(Boolean)
		.join('\n');
}

/** Each tool by name, with the arg a lone written value fills: its first required one, else its first. */
export function toolFirstArgs(tools:readonly ToolDef[]):Map<string, string | undefined> {
	return new Map(tools.map((tool) => {
		const schema = tool.parameters as { required?:string[]; properties?:Record<string, unknown> };
		return [tool.name, schema.required?.[0] ?? Object.keys(schema.properties ?? {})[0]];
	}));
}
