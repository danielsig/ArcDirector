import { extractJson, isRecord } from '../json.js';
import { asArc, isArc, validateArc } from './validate.js';
import { ArcError, JOIN_SYMBOL, SYMBOL_JOIN, firstStep, type Arc, type Join, type Step } from './types.js';
import { argBase, type VerbRegistry, type VerbSpec } from './stock-verbs.js';
import type { StepArg } from './validate.js';

/** Watch / who exprs: `some(...)`, `isNear(me, BridgeKeeper)`, `units.filter("Guard")`. */
function isCallExpr(s:string):boolean {
	return /[A-Za-z_][\w.]*\(/.test(s);
}

function formatArg(v:StepArg, verbs?:VerbRegistry):string {
	if (Array.isArray(v)) {
		return v.join(',');
	}
	if (isArc(v)) {
		return formatArc(v, verbs?.nested());
	}
	if (typeof v === 'string') {
		if (isCallExpr(v)) {
			return v;
		}
		if (/[\s,"()]/.test(v)) {
			return JSON.stringify(v);
		}
		return v;
	}
	return String(v);
}

function isBareArg(formatted:string):boolean {
	return /^-?\d+(\.\d+)?$/.test(formatted)
		|| /^[A-Za-z][A-Za-z0-9_.]*$/.test(formatted)
		|| ((formatted.startsWith('"') || formatted.startsWith("'")) && formatted.endsWith(formatted[0]));
}

/**
 * Arc text that parses back to the same step. A lone arg drops its `key=` only when it is the verb's
 * first arg, which is where the parser puts a positional value; without `verbs` every arg keeps its key.
 */
export function formatStep(step:Step, verbs?:VerbRegistry):string {
	const keys = Object.keys(step.args);
	if (keys.length === 0) {
		return `${step.verb}()`;
	}
	const first = Object.keys(verbs?.get(step.verb)?.args ?? {})[0];
	const inner = keys.map((k) => {
		const value = step.args[k];
		const formatted = formatArg(value, verbs);
		if (keys.length === 1 && k === first && (isBareArg(formatted) || isArc(value))) {
			return formatted;
		}
		return `${k}=${formatted}`;
	}).join(', ');
	return `${step.verb}(${inner})`;
}

function formatNode(arc:Arc, verbs?:VerbRegistry):string {
	if (arc.group) {
		return `(${formatArc(arc.group, verbs)})`;
	}
	if (arc.head) {
		return formatStep(arc.head, verbs);
	}
	return 'think()';
}

export function formatArc(arc:Arc, verbs?:VerbRegistry):string {
	let out = formatNode(arc, verbs);
	let cur:Arc | undefined = arc;
	while (cur.then) {
		out += ` ${JOIN_SYMBOL[cur.then.join]} ${formatNode(cur.then.arc, verbs)}`;
		cur = cur.then.arc;
	}
	return out;
}

function skipWs(s:string, i:number):number {
	while (i < s.length && /\s/.test(s[i])) {
		i += 1;
	}
	return i;
}

function parseQuoted(s:string, i:number):{ value:string; next:number } {
	const q = s[i];
	i += 1;
	let out = '';
	while (i < s.length) {
		if (s[i] === '\\' && i + 1 < s.length) {
			out += s[i + 1];
			i += 2;
			continue;
		}
		if (s[i] === q) {
			return { value: out, next: i + 1 };
		}
		out += s[i];
		i += 1;
	}
	return { value: out, next: i };
}

/** Index past the `)` at `i`. End of input stands in for every closer the model left off. */
function closeAt(s:string, i:number, missing:string):number {
	if (i >= s.length) {
		return i;
	}
	if (s[i] !== ')') {
		throw new ArcError(missing);
	}
	return i + 1;
}

/** True when `, key=` at `i` starts another arg of this verb. */
function namedArgAt(s:string, i:number, keys:string[]):boolean {
	const m = /^\s*([A-Za-z_]\w*)\s*=(?!=)/.exec(s.slice(i, i + 64));
	return !!m && keys.includes(m[1]);
}

/**
 * Prose arg (`text` kind). Double-quoted, or raw up to the closing `)` or the next
 * `, key=` of this verb. Commas and apostrophes are plain text.
 */
function parseText(s:string, i:number, keys:string[]):{ value:string; next:number } {
	i = skipWs(s, i);
	if (s[i] === '"') {
		return parseQuoted(s, i);
	}
	const start = i;
	let depth = 0;
	while (i < s.length) {
		const c = s[i];
		if (c === '(') {
			depth += 1;
		}
		else if (c === ')') {
			if (depth === 0) {
				break;
			}
			depth -= 1;
		}
		else if (c === ',' && depth === 0 && namedArgAt(s, i + 1, keys)) {
			break;
		}
		i += 1;
	}
	const raw = s.slice(start, i).trim();
	const quoted = raw.length > 1 && raw.startsWith("'") && raw.endsWith("'");
	return { value: quoted ? raw.slice(1, -1) : raw, next: i };
}

function parseBalanced(s:string, i:number):{ value:string; next:number } {
	i = skipWs(s, i);
	const start = i;
	let depth = 0;
	let quote:string | null = null;
	let escape = false;
	while (i < s.length) {
		const c = s[i];
		if (quote) {
			if (escape) {
				escape = false;
				i += 1;
				continue;
			}
			if (c === '\\') {
				escape = true;
				i += 1;
				continue;
			}
			if (c === quote) {
				quote = null;
			}
			i += 1;
			continue;
		}
		if (c === '"' || c === "'") {
			quote = c;
			i += 1;
			continue;
		}
		if (c === '(' || c === '[' || c === '{') {
			depth += 1;
			i += 1;
			continue;
		}
		if (c === ')' || c === ']' || c === '}') {
			if (depth === 0) {
				break;
			}
			depth -= 1;
			i += 1;
			continue;
		}
		if (depth === 0 && c === ',') {
			break;
		}
		i += 1;
	}
	if (depth > 0) {
		throw new ArcError('expression cut off before its closing bracket');
	}
	return { value: s.slice(start, i).trim(), next: i };
}

function parseValue(s:string, i:number):{ value:StepArg; next:number } {
	i = skipWs(s, i);
	if (s[i] === '"' || s[i] === "'") {
		return parseQuoted(s, i);
	}
	const parsed = parseBalanced(s, i);
	const raw = parsed.value;
	if (raw === 'true' || raw === 'false') {
		return { value: raw === 'true', next: parsed.next };
	}
	if (/^-?\d+(\.\d+)?$/.test(raw)) {
		return { value: Number(raw), next: parsed.next };
	}
	return { value: raw, next: parsed.next };
}


function parseArcAtom(s:string, i:number, registry:VerbRegistry):{ value:Arc; next:number } {
	i = skipWs(s, i);
	if (s[i] === '(') {
		const inner = parseNestedArc(s, i + 1, registry);
		const next = closeAt(s, skipWs(s, inner.next), 'missing ) for grouped arc');
		return { value: { head: { verb: 'group', args: {} }, group: inner.value }, next };
	}
	const step = parseStepText(s, i, registry);
	return { value: { head: step.step }, next: step.next };
}

function parseNestedArc(s:string, i:number, registry:VerbRegistry):{ value:Arc; next:number } {
	const first = parseArcAtom(s, i, registry);
	const arc:Arc = first.value;
	let pos = first.next;
	let tail = arc;
	while (true) {
		const j = skipWs(s, pos);
		if (j >= s.length || s[j] === ',' || s[j] === ')') {
			break;
		}
		const join = joinAt(s, pos);
		if (!join) {
			break;
		}
		const nxt = parseArcAtom(s, join.next, registry);
		tail.then = { join: join.join, arc: nxt.value };
		tail = tail.then.arc;
		pos = nxt.next;
	}
	return { value: arc, next: pos };
}

/** Index past a stuttered `key=` the model repeated after `key=`, as in `say(text=text="Hi")`. */
function skipRepeatedKey(s:string, i:number, key:string):number {
	const m = new RegExp(`^\\s*${key}\\s*=(?!=)`).exec(s.slice(i, i + key.length + 16));
	return m ? i + m[0].length : i;
}

function parseStepText(s:string, i:number, registry:VerbRegistry):{ step:Step; next:number } {
	i = skipWs(s, i);
	const start = i;
	while (i < s.length && /[A-Za-z0-9_]/.test(s[i])) {
		i += 1;
	}
	const verb = s.slice(start, i);
	if (!verb) {
		throw new ArcError('expected verb');
	}
	i = skipWs(s, i);
	const spec = registry.get(verb);
	if (!spec) {
		// A bare word is an argument that slipped out of its verb: `say(text=Hi) to=Guard`, `say(Hi) to Guard`.
		if (start > 0 && s[i] !== '(') {
			throw new ArcError(`${verb} is outside the parentheses. Put every argument inside its verb's parentheses, as in say(text=Hi, to=Name)`);
		}
		throw new ArcError(`unknown verb '${verb}'`);
	}
	const args:Record<string, StepArg> = {};
	const read = (key:string, at:number):{ value:StepArg; next:number } => {
		const base = argBase(spec.args[key]);
		if (base === 'arc') {
			return parseNestedArc(s, at, registry.nested());
		}
		if (base === 'text') {
			return parseText(s, at, Object.keys(spec.args).filter((k) => k !== key));
		}
		return parseValue(s, at);
	};
	if (s[i] === '(') {
		i += 1;
		i = skipWs(s, i);
		if (i < s.length && s[i] !== ')') {
			let positional = 0;
			while (true) {
				i = skipWs(s, i);
				const nameStart = i;
				while (i < s.length && /[A-Za-z0-9_]/.test(s[i])) {
					i += 1;
				}
				const ident = s.slice(nameStart, i);
				i = skipWs(s, i);
				const key = nextPositionalKey(spec, args, positional);
				// Prose may hold `=`: only this verb's own arg names start a named arg there.
				const prose = !!key && argBase(spec.args[key]) === 'text' && !(ident in spec.args);
				if (s[i] === '=' && !prose) {
					const parsed = read(ident, skipRepeatedKey(s, i + 1, ident));
					args[ident] = parsed.value;
					i = parsed.next;
				}
				else {
					if (!key) {
						throw new ArcError(`verb '${verb}' got an unexpected positional arg`);
					}
					const parsed = read(key, nameStart);
					args[key] = parsed.value;
					i = parsed.next;
					positional += 1;
				}
				i = skipWs(s, i);
				if (s[i] === ',') {
					i += 1;
					continue;
				}
				if (i >= s.length || s[i] === ')') {
					break;
				}
				throw new ArcError(`expected ',' or ')' in ${verb}(...)`);
			}
		}
		i = closeAt(s, i, `missing ')' for ${verb}`);
	}
	return { step: { verb, args }, next: i };
}

function parseJoin(s:string, i:number):{ join:Join; next:number } | null {
	i = skipWs(s, i);
	if (s.startsWith('&&', i)) {
		return { join: SYMBOL_JOIN['&&'], next: i + 2 };
	}
	if (s.startsWith('||', i)) {
		return { join: SYMBOL_JOIN['||'], next: i + 2 };
	}
	if (s[i] === ';') {
		return { join: SYMBOL_JOIN[';'], next: i + 1 };
	}
	return null;
}

/** A join, or `;` when the next atom follows with none (`think(...)use(...)`). A join with nothing after it is dropped. */
function joinAt(s:string, i:number):{ join:Join; next:number } | null {
	const join = parseJoin(s, i);
	if (join) {
		return skipWs(s, join.next) < s.length ? join : null;
	}
	const j = skipWs(s, i);
	return /[A-Za-z_(]/.test(s[j] ?? '') ? { join: SYMBOL_JOIN[';'], next: j } : null;
}

function nextPositionalKey(
	spec:VerbSpec,
	args:Record<string, StepArg>,
	from:number,
):string | undefined {
	const keys = Object.keys(spec.args);
	for (let i = from; i < keys.length; i++) {
		if (!(keys[i] in args)) {
			return keys[i];
		}
	}
	for (const key of keys) {
		if (!(key in args)) {
			return key;
		}
	}
	return undefined;
}

function lastArc(arc:Arc):Arc {
	let cur = arc;
	while (cur.then) {
		cur = cur.then.arc;
	}
	return cur;
}

/** Gemma copies the Example including a trailing period, and adds `)` or `,` between issue(). */
function fixTrail(s:string, i:number):number {
	i = skipWs(s, i);
	while (i < s.length && (s[i] === ')' || s[i] === '.' || s[i] === ',')) {
		i = skipWs(s, i + 1);
	}
	return i;
}

export function parseArcText(text:string, registry:VerbRegistry):Arc {
	const parsed = parseNestedArc(text, 0, registry);
	const arc = parsed.value;
	let i = fixTrail(text, parsed.next);
	let tail = lastArc(arc);
	while (i < text.length) {
		const join = joinAt(text, i);
		if (!join) {
			if (parseJoin(text, i)) {
				break;
			}
			throw new ArcError(`unexpected trailing text: ${text.slice(i)}`);
		}
		const nxt = parseNestedArc(text, join.next, registry);
		tail.then = { join: join.join, arc: nxt.value };
		tail = lastArc(nxt.value);
		i = fixTrail(text, nxt.next);
	}
	validateArc(arc, registry);
	return arc;
}

export function parseArc(input:string | unknown, registry:VerbRegistry):Arc {
	if (typeof input !== 'string') {
		return parseArcValue(input, registry);
	}
	const trimmed = input.trim();
	const json = lastHeadJson(trimmed);
	if (json !== undefined) {
		return parseArcValue(extractJson(json), registry);
	}
	if (trimmed.startsWith('{') || trimmed.startsWith('```')) {
		return parseArcValue(extractJson(trimmed), registry);
	}
	return parseArcText(trimmed, registry);
}

/** An `arc` argument as an `Arc`: already parsed, or text to parse. Undefined when it does not parse. */
export function arcArg(raw:unknown, registry:VerbRegistry):Arc | undefined {
	if (isArc(raw)) {
		return raw;
	}
	if (typeof raw !== 'string' || !raw.trim()) {
		return undefined;
	}
	try {
		return parseArc(raw, registry);
	}
	catch {
		return undefined;
	}
}

function parseArcValue(raw:unknown, registry:VerbRegistry):Arc {
	const bag = joinArcTextParts(raw);
	if (bag) {
		return parseArcText(bag, registry);
	}
	return asArc(raw, registry);
}

/** `{issue:"issue(...)", when:"when(...)"}` or `{commands:["issue(...)"]}`. */
function joinArcTextParts(raw:unknown):string | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}
	if (isRecord(raw.head) || raw.group !== undefined || isRecord(raw.arc)) {
		return undefined;
	}
	const parts:string[] = [];
	const take = (v:unknown):void => {
		if (typeof v === 'string') {
			const s = v.trim();
			if (/^[A-Za-z_][\w]*\s*\(/.test(s)) {
				parts.push(s.replace(/[;\s]+$/, ''));
			}
			return;
		}
		if (Array.isArray(v)) {
			for (const item of v) {
				take(item);
			}
		}
	};
	take(raw.arc);
	if (parts.length === 0) {
		for (const [key, value] of Object.entries(raw)) {
			if (MIND_KEYS.has(key)) {
				continue;
			}
			take(value);
		}
	}
	if (parts.length === 0) {
		return undefined;
	}
	return parts.join(' ; ');
}

const MIND_KEYS = new Set(['goals', 'identity']);

/** Last root `{"head"` / `{"group"` in CoT. Nested `then.arc.head` is skipped. */
function lastHeadJson(text:string):string | undefined {
	let at = -1;
	const re = /\{\s*"(?:head|group)"/g;
	let m:RegExpExecArray | null;
	while ((m = re.exec(text))) {
		const before = text.slice(Math.max(0, m.index - 16), m.index);
		if (/"arc"\s*:\s*$/.test(before)) {
			continue;
		}
		at = m.index;
	}
	return at >= 0 ? text.slice(at) : undefined;
}

export { firstStep };
