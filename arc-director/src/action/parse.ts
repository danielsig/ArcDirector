import { extractJson } from '../json.js';
import { asPlan, isActionPlan, validatePlan } from './validate.js';
import { ActionError, JOIN_SYMBOL, SYMBOL_JOIN, firstStep, type ActionPlan, type Join, type Step } from './types.js';
import type { VerbRegistry } from './registry.js';
import type { StepArg } from './validate.js';

/** Watch / who exprs: `some(...)`, `isNear(me, Miller)`, `units.filter("Guard")`. */
function isCallExpr(s:string):boolean {
	return /[A-Za-z_][\w.]*\(/.test(s);
}

function formatArg(v:StepArg):string {
	if (Array.isArray(v)) {
		return v.join(',');
	}
	if (isActionPlan(v)) {
		return formatPlan(v);
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

export function formatStep(step:Step):string {
	const keys = Object.keys(step.args);
	if (keys.length === 0) {
		return `${step.verb}()`;
	}
	const inner = keys.map((k) => {
		const value = step.args[k];
		const formatted = formatArg(value);
		if (keys.length === 1 && (isBareArg(formatted) || isActionPlan(value))) {
			return formatted;
		}
		return `${k}=${formatted}`;
	}).join(', ');
	return `${step.verb}(${inner})`;
}

function formatNode(plan:ActionPlan):string {
	if (plan.group) {
		return `(${formatPlan(plan.group)})`;
	}
	if (plan.head) {
		return formatStep(plan.head);
	}
	return 'think()';
}

export function formatPlan(plan:ActionPlan):string {
	let out = formatNode(plan);
	let cur:ActionPlan | undefined = plan;
	while (cur.then) {
		out += ` ${JOIN_SYMBOL[cur.then.join]} ${formatNode(cur.then.plan)}`;
		cur = cur.then.plan;
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
	throw new ActionError('unterminated string in plan text');
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

function argBase(kind:string | undefined):string {
	if (!kind) {
		return '';
	}
	return kind.endsWith('?') ? kind.slice(0, -1) : kind;
}

function parsePlanAtom(s:string, i:number, registry:VerbRegistry):{ value:ActionPlan; next:number } {
	i = skipWs(s, i);
	if (s[i] === '(') {
		const inner = parseNestedPlan(s, i + 1, registry);
		const j = skipWs(s, inner.next);
		if (s[j] !== ')') {
			throw new ActionError('missing ) for grouped plan');
		}
		return { value: { head: { verb: 'group', args: {} }, group: inner.value }, next: j + 1 };
	}
	const step = parseStepText(s, i, registry);
	return { value: { head: step.step }, next: step.next };
}

function parseNestedPlan(s:string, i:number, registry:VerbRegistry):{ value:ActionPlan; next:number } {
	const first = parsePlanAtom(s, i, registry);
	const plan:ActionPlan = first.value;
	let pos = first.next;
	let tail = plan;
	while (true) {
		const j = skipWs(s, pos);
		if (j >= s.length || s[j] === ',' || s[j] === ')') {
			break;
		}
		const join = parseJoin(s, pos);
		if (!join) {
			break;
		}
		const nxt = parsePlanAtom(s, join.next, registry);
		tail.then = { join: join.join, plan: nxt.value };
		tail = tail.then.plan;
		pos = nxt.next;
	}
	return { value: plan, next: pos };
}

function parseStepText(s:string, i:number, registry:VerbRegistry):{ step:Step; next:number } {
	i = skipWs(s, i);
	const start = i;
	while (i < s.length && /[A-Za-z0-9_]/.test(s[i])) {
		i += 1;
	}
	const verb = s.slice(start, i);
	if (!verb) {
		throw new ActionError('expected verb');
	}
	i = skipWs(s, i);
	const spec = registry.get(verb);
	if (!spec) {
		throw new ActionError(`unknown verb '${verb}'`);
	}
	const args:Record<string, StepArg> = {};
	if (s[i] === '(') {
		i += 1;
		i = skipWs(s, i);
		if (s[i] !== ')') {
			let positional = 0;
			while (true) {
				i = skipWs(s, i);
				const nameStart = i;
				while (i < s.length && /[A-Za-z0-9_]/.test(s[i])) {
					i += 1;
				}
				const ident = s.slice(nameStart, i);
				i = skipWs(s, i);
				if (s[i] === '=') {
					i += 1;
					if (argBase(spec.args[ident]) === 'plan') {
						const parsed = parseNestedPlan(s, i, registry.nested());
						args[ident] = parsed.value;
						i = parsed.next;
					}
					else {
						const parsed = parseValue(s, i);
						args[ident] = parsed.value;
						i = parsed.next;
					}
				}
				else {
					i = nameStart;
					const keys = Object.keys(spec.args);
					const key = keys[positional] ?? registry.firstRequiredArg(spec);
					if (!key) {
						throw new ActionError(`verb '${verb}' got an unexpected positional arg`);
					}
					if (argBase(spec.args[key]) === 'plan') {
						const parsed = parseNestedPlan(s, i, registry.nested());
						args[key] = parsed.value;
						i = parsed.next;
					}
					else {
						const parsed = parseValue(s, i);
						args[key] = parsed.value;
						i = parsed.next;
					}
					positional += 1;
				}
				i = skipWs(s, i);
				if (s[i] === ',') {
					i += 1;
					continue;
				}
				if (s[i] === ')') {
					break;
				}
				throw new ActionError(`expected ',' or ')' in ${verb}(...)`);
			}
		}
		if (s[i] !== ')') {
			throw new ActionError(`missing ')' for ${verb}`);
		}
		i += 1;
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

export function parsePlanText(text:string, registry:VerbRegistry):ActionPlan {
	const parsed = parseNestedPlan(text, 0, registry);
	const i = skipWs(text, parsed.next);
	if (i < text.length) {
		throw new ActionError(`unexpected trailing text: ${text.slice(i)}`);
	}
	validatePlan(parsed.value, registry);
	return parsed.value;
}

export function parsePlan(input:string | unknown, registry:VerbRegistry):ActionPlan {
	if (typeof input !== 'string') {
		return asPlan(input, registry);
	}
	const trimmed = input.trim();
	const json = lastHeadJson(trimmed);
	if (json !== undefined) {
		return asPlan(extractJson(json), registry);
	}
	if (trimmed.startsWith('```')) {
		return asPlan(extractJson(trimmed), registry);
	}
	return parsePlanText(trimmed, registry);
}

/** Last root `{"head"` / `{"group"` in CoT. Nested `then.plan.head` is skipped. */
function lastHeadJson(text:string):string | undefined {
	let at = -1;
	const re = /\{\s*"(?:head|group)"/g;
	let m:RegExpExecArray | null;
	while ((m = re.exec(text))) {
		const before = text.slice(Math.max(0, m.index - 16), m.index);
		if (/"plan"\s*:\s*$/.test(before)) {
			continue;
		}
		at = m.index;
	}
	return at >= 0 ? text.slice(at) : undefined;
}

export { firstStep };
