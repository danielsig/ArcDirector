import { isRecord } from '../json.js';
import {
	ActionError,
	JOINS,
	type ActionPlan,
	type Join,
	type Step,
	type StepArg,
} from './types.js';
import type { VerbRegistry } from './registry.js';

const COORD_KEYS = new Set(['x', 'z', 'y', 'xz', 'xy', 'pos', 'position']);

export type { StepArg };

export function isActionPlan(v:unknown):v is ActionPlan {
	if (!isRecord(v)) {
		return false;
	}
	if (isRecord(v.head)) {
		return true;
	}
	if (v.group !== undefined) {
		return isActionPlan(v.group);
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
	return isActionPlan(v);
}

function argBase(kind:string):string {
	return kind.endsWith('?') ? kind.slice(0, -1) : kind;
}

function rejectMigrationArgs(verb:string, args:Record<string, unknown>):void {
	const who = typeof args.who === 'string' ? args.who.trim() : '';
	const watch = typeof args.watch === 'string' ? args.watch.trim() : '';
	if (verb === 'when' && who) {
		throw new ActionError('when(who) is issue(who, plan); when is when(watch, plan)');
	}
	if (verb === 'issue' && watch) {
		throw new ActionError('issue(watch) is when(watch, plan); issue is issue(who, plan)');
	}
}

export function validateStep(step:Step, registry:VerbRegistry):void {
	const spec = registry.get(step.verb);
	if (!spec) {
		throw new ActionError(`unknown verb '${step.verb}'`);
	}
	rejectMigrationArgs(step.verb, step.args);
	for (const key of Object.keys(step.args)) {
		if (COORD_KEYS.has(key.toLowerCase())) {
			throw new ActionError(`coordinate arg '${key}' is not allowed`);
		}
		if (!(key in spec.args)) {
			throw new ActionError(`verb '${step.verb}' has no arg '${key}'`);
		}
	}
	for (const [key, kind] of Object.entries(spec.args)) {
		const value = step.args[key];
		if (value === undefined) {
			if (!kind.endsWith('?')) {
				throw new ActionError(`verb '${step.verb}' missing required arg '${key}'`);
			}
			continue;
		}
		const base = argBase(kind);
		if (base === 'number' && typeof value !== 'number') {
			throw new ActionError(`verb '${step.verb}' arg '${key}' must be a number`);
		}
		if (base === 'string[]' && !(Array.isArray(value) && value.every((x) => typeof x === 'string'))) {
			throw new ActionError(`verb '${step.verb}' arg '${key}' must be string[]`);
		}
		if ((base === 'id' || base === 'string') && typeof value !== 'string') {
			throw new ActionError(`verb '${step.verb}' arg '${key}' must be a string`);
		}
		if (base === 'plan') {
			if (!isActionPlan(value)) {
				throw new ActionError(`verb '${step.verb}' arg '${key}' must be a plan`);
			}
			validatePlan(value, registry.nested());
		}
		if (typeof value === 'string' && /^-?\d+(\.\d+)?\s*,\s*-?\d+/.test(value)) {
			throw new ActionError(`arg '${key}' looks like coordinates`);
		}
	}
}

export function validatePlan(plan:ActionPlan, registry:VerbRegistry):void {
	if (plan.group) {
		validatePlan(plan.group, registry);
	}
	else {
		validateStep(plan.head, registry);
	}
	if (plan.then) {
		if (!JOINS.includes(plan.then.join)) {
			throw new ActionError(`unknown join '${String(plan.then.join)}'`);
		}
		validatePlan(plan.then.plan, registry);
	}
}

export function asStep(raw:unknown, registry:VerbRegistry):Step {
	if (!isRecord(raw)) {
		throw new ActionError('step is not an object');
	}
	if (typeof raw.verb !== 'string') {
		throw new ActionError('step.verb must be a string');
	}
	const spec = registry.get(raw.verb);
	const argsRaw = raw.args;
	const args:Record<string, StepArg> = {};
	if (argsRaw !== undefined) {
		if (!isRecord(argsRaw)) {
			throw new ActionError('step.args must be an object');
		}
		for (const [k, v] of Object.entries(argsRaw)) {
			if (k === 'then' || v === undefined || v === null) {
				continue;
			}
			const kind = spec?.args[k];
			const base = kind ? argBase(kind) : '';
			if (base === 'plan') {
				args[k] = asPlan(v, registry.nested());
				continue;
			}
			if (!isStepArg(v)) {
				throw new ActionError(`arg '${k}' has an unsupported type`);
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

export function asPlan(raw:unknown, registry:VerbRegistry):ActionPlan {
	if (!isRecord(raw)) {
		throw new ActionError('plan is not an object');
	}
	if (raw.head === undefined && raw.group === undefined) {
		const nested = raw['action_plan'] ?? raw.plan;
		if (nested !== undefined) {
			return asPlan(nested, registry);
		}
	}
	const thenRaw = thenRow(raw);
	let plan:ActionPlan;
	if (raw.group !== undefined) {
		plan = { head: { verb: 'group', args: {} }, group: asPlan(raw.group, registry) };
	}
	else if (raw.head !== undefined) {
		plan = { head: asStep(raw.head, registry) };
	}
	else {
		throw new ActionError('plan is not an object');
	}
	if (thenRaw !== undefined) {
		if (!isRecord(thenRaw)) {
			throw new ActionError('then is not an object');
		}
		if (typeof thenRaw.join !== 'string') {
			throw new ActionError('then.join must be a string');
		}
		plan.then = {
			join: thenRaw.join as Join,
			plan: asPlan(thenRaw.plan, registry),
		};
	}
	validatePlan(plan, registry);
	return plan;
}
