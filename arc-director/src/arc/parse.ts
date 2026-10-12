import { validateArc } from './validate.js';
import { ArcError, JOIN_SYMBOL, SYMBOL_JOIN, groupArc, isArc, isCountMap, type Arc, type Join, type Step, type StepArg } from './types.js';
import { argBase, CHOOSE_VERB, GROUP_VERB, type VerbRegistry, type VerbSpec } from './stock-verbs.js';
import { choicesOf, deriveChoiceName, freeChoiceName } from './choose.js';

/** Arg kinds whose value is an expression. */
const EXPR_KINDS = new Set(['watch', 'expr']);

/** Watch / who exprs: `some(...)`, `isNear(me, BridgeKeeper)`, `units.filter("Guard")`. */
function isCallExpr(s:string):boolean {
	return /[A-Za-z_][\w.]*\(/.test(s);
}

/** `kind` is the arg's kind from the verb's spec: a `watch` or `expr` is written as it reads, never quoted. */
function formatArg(v:StepArg, verbs:VerbRegistry | undefined, depth:Depth, kind?:string):string {
	if (isArc(v)) {
		return formatAt(v, verbs?.nested(), depth);
	}
	if (isCountMap(v)) {
		return JSON.stringify(v);
	}
	if (Array.isArray(v)) {
		return kind !== undefined && argBase(kind) === 'string[]' ? JSON.stringify(v) : v.join(',');
	}
	if (typeof v === 'string') {
		if (isCallExpr(v) || (kind !== undefined && EXPR_KINDS.has(argBase(kind)))) {
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
export function formatStep(step:Step, verbs?:VerbRegistry, depth?:number):string {
	const inner = groupArc(step);
	if (inner) {
		return `(${formatAt(inner, verbs, depth)})`;
	}
	if (step.verb === CHOOSE_VERB) {
		return formatChoose(step, verbs, depth);
	}
	const keys = Object.keys(step.args);
	if (keys.length === 0) {
		return `${step.verb}()`;
	}
	const kinds:Record<string, string> = verbs?.get(step.verb)?.args ?? {};
	const first = Object.keys(kinds)[0];
	const block = depth !== undefined && keys.some((k) => isArc(step.args[k]));
	const parts = keys.map((k) => {
		const value = step.args[k];
		const formatted = formatArg(value, verbs, block ? depth + 1 : undefined, kinds[k]);
		if (keys.length === 1 && k === first && (isBareArg(formatted) || isArc(value))) {
			return formatted;
		}
		return `${k}=${formatted}`;
	});
	return call(step.verb, parts, block ? depth : undefined);
}

/** `choose("goal", name=arc, …)`. A choice whose name is the one its arc would get is written bare. */
function formatChoose(step:Step, verbs:VerbRegistry | undefined, depth:Depth):string {
	const parts = typeof step.args.goal === 'string' ? [JSON.stringify(step.args.goal)] : [];
	const inner = depth === undefined ? undefined : depth + 1;
	for (const [name, arc] of Object.entries(choicesOf(step))) {
		const text = formatAt(arc, verbs?.nested(), inner);
		// Block layout is what prompts show, and they ask for every choice named.
		parts.push(depth === undefined && name === deriveChoiceName(arc) ? text : `${name}=${text}`);
	}
	return call(CHOOSE_VERB, parts, depth);
}

/** `verb(a, b)`, or at a block depth each part on its own line a tab deeper, ending in a comma, and `)` alone. */
function call(verb:string, parts:string[], depth:Depth):string {
	if (depth === undefined) {
		return `${verb}(${parts.join(', ')})`;
	}
	const pad = '\t'.repeat(depth);
	return `${verb}(\n${parts.map((part) => `${pad}\t${part},\n`).join('')}${pad})`;
}

export function formatArc(arc:Arc, verbs?:VerbRegistry):string {
	return formatAt(arc, verbs, undefined);
}

/**
 * Arc text in block layout: a call that holds an arc or choices opens on its own line, its args go one per line a
 * tab deeper, each ending in a comma, and its `)` stands alone. A top-level `;` is a new line. Prompts show
 * arcs this way, so a model copies a layout whose indentation counts its parens.
 */
export function formatArcBlocks(arc:Arc, verbs?:VerbRegistry):string {
	return formatAt(arc, verbs, 0);
}

/** One line where `depth` is undefined, else block layout at that depth. */
type Depth = number | undefined;

function formatAt(arc:Arc, verbs:VerbRegistry | undefined, depth:Depth):string {
	return arc.map((step, i) => {
		const text = formatStep(step, verbs, depth);
		if (i === arc.length - 1) {
			return text;
		}
		const join = step.then ?? 'if_ok';
		return `${text}${depth === 0 && join === 'always' ? '\n' : ` ${JOIN_SYMBOL[join]} `}`;
	}).join('');
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
		// No expression holds `;`: at depth 0 it ends the value, as a C-style arg separator.
		if (depth === 0 && (c === ',' || c === ';')) {
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


/** One step of a chain: a group `( … )` or a verb call. */
function parseStepAtom(s:string, i:number, registry:VerbRegistry):{ step:Step; next:number } {
	i = skipWs(s, i);
	if (s[i] === '(') {
		const inner = parseNestedArc(s, i + 1, registry);
		const next = closeAt(s, skipWs(s, inner.next), 'missing ) for grouped arc');
		return { step: { verb: GROUP_VERB, args: { arc: inner.value } }, next };
	}
	return parseStepText(s, i, registry);
}

/** Say how `step` joins the one after it. `&&` is the default and is not written down. */
function joinTo(step:Step, join:Join):void {
	if (join !== 'if_ok') {
		step.then = join;
	}
}

function parseNestedArc(s:string, i:number, registry:VerbRegistry):{ value:Arc; next:number } {
	const first = parseStepAtom(s, i, registry);
	const arc:Arc = [first.step];
	let pos = first.next;
	while (true) {
		const j = skipWs(s, pos);
		if (j >= s.length || s[j] === ',' || s[j] === ')') {
			break;
		}
		const join = joinAt(s, pos);
		if (!join) {
			break;
		}
		const nxt = parseStepAtom(s, join.next, registry);
		joinTo(arc[arc.length - 1], join.join);
		arc.push(nxt.step);
		pos = nxt.next;
	}
	return { value: arc, next: pos };
}

/** A lone name at `i` that is not a verb, with nothing after it but a join or the end: `BridgeKeeper` in `go_to BridgeKeeper`. */
function bareArgAt(s:string, i:number, registry:VerbRegistry):{ value:string; next:number } | undefined {
	const m = /^[A-Za-z_]\w*/.exec(s.slice(i, i + 128));
	if (!m || registry.has(m[0])) {
		return undefined;
	}
	const next = i + m[0].length;
	const after = skipWs(s, next);
	return after >= s.length || s[after] === ')' || joinAt(s, next) ? { value: m[0], next } : undefined;
}

/** Index past a stuttered `key=` the model repeated after `key=`, as in `say(text=text="Hi")`. */
function skipRepeatedKey(s:string, i:number, key:string):number {
	const m = new RegExp(`^\\s*${key}\\s*=(?!=)`).exec(s.slice(i, i + key.length + 16));
	return m ? i + m[0].length : i;
}

/** `{"gold":5}`. */
function asBundle(value:StepArg, key:string):StepArg {
	const parsed = typeof value === 'string' ? readJson(value) : value;
	if (isCountMap(parsed)) {
		return parsed;
	}
	throw new ArcError(`${key} is {"gold":5} or {"Egg":12, "Milk":3}`);
}

function readJson(raw:string):unknown {
	try {
		return JSON.parse(raw);
	}
	catch {
		throw new ArcError(`cannot read ${raw}`);
	}
}

/** `["5 gold", "Loaf"]`, or one bare line such as `5 gold`. */
function asStringArray(value:StepArg):string[] {
	if (Array.isArray(value) && value.every((item):item is string => typeof item === 'string')) {
		return value;
	}
	if (Array.isArray(value)) {
		throw new ArcError('a list arg is strings, as ["5 gold", "Loaf"]');
	}
	if (typeof value !== 'string') {
		throw new ArcError('a list arg is strings, as ["5 gold", "Loaf"]');
	}
	const raw = value.trim();
	if (!raw) {
		return [];
	}
	if (raw.startsWith('[')) {
		let parsed:unknown;
		try {
			parsed = JSON.parse(raw);
		}
		catch {
			throw new ArcError(`cannot read list ${raw}`);
		}
		if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
			throw new ArcError('a list arg is strings, as ["5 gold", "Loaf"]');
		}
		return parsed;
	}
	return [raw];
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
	if (verb === CHOOSE_VERB) {
		return parseChoose(s, i, registry);
	}
	const bare = bareArgAt(s, i, registry);
	const firstKey = nextPositionalKey(spec, {}, 0);
	if (bare && firstKey) {
		// `go_to BridgeKeeper`: one name with no parentheses is the verb's first arg.
		return { step: { verb, args: { [firstKey]: bare.value } }, next: bare.next };
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
		if (base === 'string[]') {
			const parsed = parseValue(s, at);
			return { value: asStringArray(parsed.value), next: parsed.next };
		}
		if (base === 'bundle') {
			const parsed = parseValue(s, at);
			return { value: asBundle(parsed.value, key), next: parsed.next };
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
					if (ident in args) {
						throw new ArcError(`${verb}(...) got ${ident}= twice; give it once`);
					}
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
				// Among args `;` is a comma a model wrote in C style: a `;` joining steps inside an arc arg was read with it.
				if (s[i] === ',' || s[i] === ';') {
					i = skipWs(s, i + 1);
					// A trailing comma, as block layout ends every arg line.
					if (s[i] === ')') {
						break;
					}
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

/**
 * The args of `choose("goal", name=arc, arc, …)` from its `(`. Every arg but `goal` is a choice. Bare ones are
 * named once every written name is known, so a written name always keeps its own.
 */
function parseChoose(s:string, i:number, registry:VerbRegistry):{ step:Step; next:number } {
	if (s[i] !== '(') {
		throw new ArcError('choose needs ("goal", name=arc, …)');
	}
	i += 1;
	let goal:string | undefined;
	const rows:{ name?:string; arc:Arc }[] = [];
	while (true) {
		i = skipWs(s, i);
		if (i >= s.length || s[i] === ')') {
			break;
		}
		const named = /^([A-Za-z_]\w*)\s*=(?!=)/.exec(s.slice(i, i + 64));
		const call = /^([A-Za-z_]\w*)\s*\(/.exec(s.slice(i, i + 64));
		// Unquoted prose first is the goal, unless it is a verb call: `choose(hold the gate, …)`.
		const leadingGoal = !named && goal === undefined && rows.length === 0 && s[i] !== '('
			&& !(call && registry.nested().has(call[1]));
		if (named?.[1] === 'goal' || leadingGoal) {
			if (goal !== undefined) {
				throw new ArcError('choose has two goals');
			}
			const parsed = parseValue(s, named ? i + named[0].length : i);
			if (typeof parsed.value !== 'string') {
				throw new ArcError('choose goal must be text');
			}
			goal = parsed.value;
			i = parsed.next;
		}
		else {
			const name = named?.[1];
			if (name !== undefined && rows.some((row) => row.name === name)) {
				throw new ArcError(`choose has two choices named '${name}'`);
			}
			const parsed = parseNestedArc(s, named ? i + named[0].length : i, registry.nested());
			rows.push({ name, arc: parsed.value });
			i = parsed.next;
		}
		i = skipWs(s, i);
		if (s[i] === ',') {
			i += 1;
			continue;
		}
		if (i >= s.length || s[i] === ')') {
			break;
		}
		throw new ArcError(`expected ',' or ')' in choose(...)`);
	}
	i = closeAt(s, i, `missing ')' for choose`);
	const taken = new Set(rows.flatMap((row) => (row.name ? [row.name] : [])));
	const args:Record<string, StepArg> = goal === undefined ? {} : { goal };
	for (const row of rows) {
		const name = row.name ?? freeChoiceName(deriveChoiceName(row.arc), taken);
		taken.add(name);
		args[name] = row.arc;
	}
	return { step: { verb: CHOOSE_VERB, args }, next: i };
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
	while (i < text.length) {
		const join = joinAt(text, i);
		if (!join) {
			if (parseJoin(text, i)) {
				break;
			}
			throw new ArcError(`unexpected trailing text: ${text.slice(i)}`);
		}
		const nxt = parseNestedArc(text, join.next, registry);
		joinTo(arc[arc.length - 1], join.join);
		arc.push(...nxt.value);
		i = fixTrail(text, nxt.next);
	}
	validateArc(arc, registry);
	return arc;
}
