import { extractJson } from '../json.js';
import { asPlan } from './validate.js';
import { ActionError, JOIN_SYMBOL, SYMBOL_JOIN, type ActionPlan, type Join, type Step } from './types.js';
import type { VerbRegistry } from './registry.js';
import type { StepArg } from './validate.js';

function formatArg(v:StepArg):string {
	if (Array.isArray(v)) {
		return v.join(',');
	}
	if (typeof v === 'string') {
		if (/[\s,"()]/.test(v)) {
			return JSON.stringify(v);
		}
		return v;
	}
	return String(v);
}

export function formatStep(step:Step):string {
	const keys = Object.keys(step.args);
	if (keys.length === 0) {
		return `${step.verb}()`;
	}
	if (keys.length === 1) {
		return `${step.verb}(${formatArg(step.args[keys[0]])})`;
	}
	const inner = keys.map((k) => `${k}=${formatArg(step.args[k])}`).join(', ');
	return `${step.verb}(${inner})`;
}

export function formatPlan(plan:ActionPlan):string {
	let out = formatStep(plan.head);
	let cur:ActionPlan | undefined = plan;
	while (cur.then) {
		out += ` ${JOIN_SYMBOL[cur.then.join]} ${formatStep(cur.then.plan.head)}`;
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

function parseValue(s:string, i:number):{ value:StepArg; next:number } {
	i = skipWs(s, i);
	if (s[i] === '"' || s[i] === "'") {
		return parseQuoted(s, i);
	}
	let j = i;
	while (j < s.length && !/[\s,)=]/.test(s[j])) {
		j += 1;
	}
	const raw = s.slice(i, j);
	if (raw === 'true' || raw === 'false') {
		return { value: raw === 'true', next: j };
	}
	if (/^-?\d+(\.\d+)?$/.test(raw)) {
		return { value: Number(raw), next: j };
	}
	return { value: raw, next: j };
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
					const parsed = parseValue(s, i);
					args[ident] = parsed.value;
					i = parsed.next;
				}
				else {
					i = nameStart;
					const parsed = parseValue(s, i);
					const keys = Object.keys(spec.args);
					const key = keys[positional] ?? registry.firstRequiredArg(spec);
					if (!key) {
						throw new ActionError(`verb '${verb}' got an unexpected positional arg`);
					}
					args[key] = parsed.value;
					positional += 1;
					i = parsed.next;
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
	const { step, next } = parseStepText(text, 0, registry);
	const plan:ActionPlan = { head: step };
	let i = next;
	let tail = plan;
	while (true) {
		const join = parseJoin(text, i);
		if (!join) {
			break;
		}
		const nxt = parseStepText(text, join.next, registry);
		tail.then = { join: join.join, plan: { head: nxt.step } };
		tail = tail.then.plan;
		i = nxt.next;
	}
	i = skipWs(text, i);
	if (i < text.length) {
		throw new ActionError(`unexpected trailing text: ${text.slice(i)}`);
	}
	return plan;
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

/** Last root `{"head"` in CoT. Nested `then.plan.head` is skipped. */
function lastHeadJson(text:string):string | undefined {
	let at = -1;
	const re = /\{\s*"head"/g;
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
