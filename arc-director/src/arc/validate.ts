import { isRecord } from '../json.js';
import {
	ArcError,
	JOINS,
	type Arc,
	type Join,
	type Step,
	type StepArg,
} from './types.js';
import type { VerbRegistry } from './stock-verbs.js';

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

function isStepArg(v:unknown):v is StepArg {
	if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
		return true;
	}
	if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
		return true;
	}
	return isArc(v);
}

function argBase(kind:string):string {
	return kind.endsWith('?') ? kind.slice(0, -1) : kind;
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

export function validateStep(step:Step, registry:VerbRegistry):void {
	const spec = registry.get(step.verb);
	if (!spec) {
		throw new ArcError(`unknown verb '${step.verb}'`);
	}
	rejectMigrationArgs(step.verb, step.args);
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
		if ((base === 'id' || base === 'string') && typeof value !== 'string') {
			throw new ArcError(`verb '${step.verb}' arg '${key}' must be a string`);
		}
		if (base === 'arc') {
			if (!isArc(value)) {
				throw new ArcError(`verb '${step.verb}' arg '${key}' must be an arc`);
			}
			validateArc(value, registry.nested());
		}
		if (typeof value === 'string' && /^-?\d+(\.\d+)?\s*,\s*-?\d+/.test(value)) {
			throw new ArcError(`arg '${key}' looks like coordinates`);
		}
	}
}

export function validateArc(arc:Arc, registry:VerbRegistry):void {
	if (arc.group) {
		validateArc(arc.group, registry);
	}
	else {
		validateStep(arc.head, registry);
	}
	if (arc.then) {
		if (!JOINS.includes(arc.then.join)) {
			throw new ArcError(`unknown join '${String(arc.then.join)}'`);
		}
		validateArc(arc.then.arc, registry);
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
			const kind = spec?.args[k];
			const base = kind ? argBase(kind) : '';
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
