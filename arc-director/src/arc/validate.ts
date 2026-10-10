import { isRecord } from '../json.js';
import {
	ArcError,
	JOINS,
	type Arc,
	type Join,
	type Step,
	type StepArg,
} from './types.js';
import { argBase, CHOOSE_VERB, type VerbRegistry } from './stock-verbs.js';
import { isChoiceName, MAX_CHOICES } from './choose.js';

const COORD_KEYS = new Set(['x', 'z', 'y', 'xz', 'xy', 'pos', 'position']);

export type { StepArg };

export function isArc(v:unknown):v is Arc {
	if (!isRecord(v)) {
		return false;
	}
	if (isRecord(v.head)) {
		return true;
	}
	if (v.group !== undefined) {
		return isArc(v.group);
	}
	return false;
}

/** Every `watch` and `expr` arg in `arc`, nested arcs and choices too, in the order written. */
export function exprArgs(arc:Arc, verbs:VerbRegistry):string[] {
	const out:string[] = [];
	const walk = (at:Arc, registry:VerbRegistry):void => {
		if (at.group) {
			walk(at.group, registry);
		}
		const kinds = registry.get(at.head.verb)?.args ?? {};
		for (const [key, value] of Object.entries(at.head.args)) {
			const kind = argBase(kinds[key]);
			if (isArc(value)) {
				walk(value, registry.nested());
			}
			else if ((kind === 'watch' || kind === 'expr') && typeof value === 'string' && value.trim()) {
				out.push(value);
			}
		}
		if (at.then) {
			walk(at.then.arc, registry);
		}
	};
	walk(arc, verbs);
	return out;
}

function isStepArg(v:unknown):v is StepArg {
	if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
		return true;
	}
	if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
		return true;
	}
	return isArc(v);
}


function rejectMigrationArgs(verb:string, args:Record<string, unknown>):void {
	const who = typeof args.who === 'string' ? args.who.trim() : '';
	const watch = typeof args.watch === 'string' ? args.watch.trim() : '';
	if (verb === 'when' && who) {
		throw new ArcError('when(who) is issue(who, arc); when is when(watch, arc)');
	}
	if (verb === 'issue' && watch) {
		throw new ArcError('issue(watch) is when(watch, arc); issue is issue(who, arc)');
	}
}

export function validateStep(step:Step, registry:VerbRegistry, inIssue = false):void {
	const spec = registry.get(step.verb);
	if (!spec) {
		throw new ArcError(`unknown verb '${step.verb}'`);
	}
	if (inIssue && step.verb === 'issue') {
		throw new ArcError('issue inside an issue arc; close each issue(...) before the next');
	}
	rejectMigrationArgs(step.verb, step.args);
	if (step.verb === CHOOSE_VERB) {
		validateChoose(step, registry, inIssue);
		return;
	}
	for (const key of Object.keys(step.args)) {
		if (COORD_KEYS.has(key.toLowerCase())) {
			throw new ArcError(`coordinate arg '${key}' is not allowed`);
		}
		if (!(key in spec.args)) {
			throw new ArcError(`verb '${step.verb}' has no arg '${key}'`);
		}
	}
	for (const [key, kind] of Object.entries(spec.args)) {
		const value = step.args[key];
		if (value === undefined) {
			if (!kind.endsWith('?')) {
				throw new ArcError(`verb '${step.verb}' missing required arg '${key}'`);
			}
			continue;
		}
		const base = argBase(kind);
		if (base === 'number' && typeof value !== 'number') {
			throw new ArcError(`verb '${step.verb}' arg '${key}' must be a number`);
		}
		if (base === 'string[]' && !(Array.isArray(value) && value.every((x) => typeof x === 'string'))) {
			throw new ArcError(`verb '${step.verb}' arg '${key}' must be string[]`);
		}
		if (['id', 'string', 'text', 'watch', 'expr', 'law'].includes(base) && typeof value !== 'string') {
			throw new ArcError(`verb '${step.verb}' arg '${key}' must be a string`);
		}
		if (base === 'arc') {
			if (!isArc(value)) {
				throw new ArcError(`verb '${step.verb}' arg '${key}' must be an arc`);
			}
			validateArc(value, registry.nested(), inIssue || step.verb === 'issue');
		}
		if (typeof value === 'string' && /^-?\d+(\.\d+)?\s*,\s*-?\d+/.test(value)) {
			throw new ArcError(`arg '${key}' looks like coordinates`);
		}
	}
}

/** A text `goal`, and 1 to {@link MAX_CHOICES} choices, each an arc under a name that is not reserved. */
function validateChoose(step:Step, registry:VerbRegistry, inIssue:boolean):void {
	const goal = step.args.goal;
	if (typeof goal !== 'string' || !goal.trim()) {
		throw new ArcError('choose needs a goal: choose("hold the gate", name=arc, …)');
	}
	const names = Object.keys(step.args).filter((key) => key !== 'goal');
	if (names.length === 0) {
		throw new ArcError('choose needs at least one name=arc choice');
	}
	if (names.length > MAX_CHOICES) {
		throw new ArcError(`choose takes at most ${MAX_CHOICES} choices`);
	}
	for (const name of names) {
		const value = step.args[name];
		if (!isChoiceName(name)) {
			throw new ArcError(`'${name}' cannot name a choice`);
		}
		if (!isArc(value)) {
			throw new ArcError(`choice '${name}' must be an arc`);
		}
		validateArc(value, registry.nested(), inIssue);
	}
}

export function validateArc(arc:Arc, registry:VerbRegistry, inIssue = false):void {
	if (arc.group) {
		validateArc(arc.group, registry, inIssue);
	}
	else {
		validateStep(arc.head, registry, inIssue);
	}
	if (arc.then) {
		if (!JOINS.includes(arc.then.join)) {
			throw new ArcError(`unknown join '${String(arc.then.join)}'`);
		}
		validateArc(arc.then.arc, registry, inIssue);
	}
}

export function asStep(raw:unknown, registry:VerbRegistry):Step {
	if (!isRecord(raw)) {
		throw new ArcError('step is not an object');
	}
	if (typeof raw.verb !== 'string') {
		throw new ArcError('step.verb must be a string');
	}
	const spec = registry.get(raw.verb);
	const argsRaw = raw.args;
	const args:Record<string, StepArg> = {};
	if (argsRaw !== undefined) {
		if (!isRecord(argsRaw)) {
			throw new ArcError('step.args must be an object');
		}
		for (const [k, v] of Object.entries(argsRaw)) {
			if (k === 'then' || v === undefined || v === null) {
				continue;
			}
			const base = raw.verb === CHOOSE_VERB && k !== 'goal' ? 'arc' : argBase(spec?.args[k]);
			if (base === 'arc') {
				args[k] = asArc(v, registry.nested());
				continue;
			}
			if (!isStepArg(v)) {
				throw new ArcError(`arg '${k}' has an unsupported type`);
			}
			args[k] = v;
		}
	}
	const step:Step = { verb: raw.verb, args };
	validateStep(step, registry);
	return step;
}

function thenRow(raw:unknown):unknown {
	if (isRecord(raw) && raw.then !== undefined && raw.then !== null) {
		return raw.then;
	}
	if (!isRecord(raw) || !isRecord(raw.head)) {
		return undefined;
	}
	if (raw.head.then !== undefined && raw.head.then !== null) {
		return raw.head.then;
	}
	if (isRecord(raw.head.args) && raw.head.args.then !== undefined && raw.head.args.then !== null) {
		return raw.head.args.then;
	}
	return undefined;
}

export function asArc(raw:unknown, registry:VerbRegistry):Arc {
	if (!isRecord(raw)) {
		throw new ArcError('arc is not an object');
	}
	if (raw.head === undefined && raw.group === undefined) {
		const nested = raw.arc;
		if (nested !== undefined) {
			return asArc(nested, registry);
		}
	}
	const thenRaw = thenRow(raw);
	let arc:Arc;
	if (raw.group !== undefined) {
		arc = { head: { verb: 'group', args: {} }, group: asArc(raw.group, registry) };
	}
	else if (raw.head !== undefined) {
		arc = { head: asStep(raw.head, registry) };
	}
	else {
		throw new ArcError('arc is not an object');
	}
	if (thenRaw !== undefined) {
		if (!isRecord(thenRaw)) {
			throw new ArcError('then is not an object');
		}
		if (typeof thenRaw.join !== 'string') {
			throw new ArcError('then.join must be a string');
		}
		arc.then = {
			join: thenRaw.join as Join,
			arc: asArc(thenRaw.arc, registry),
		};
	}
	validateArc(arc, registry);
	return arc;
}
