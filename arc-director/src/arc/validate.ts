import {
	ArcError,
	JOINS,
	eachStep,
	groupArc,
	isArc,
	isCountMap,
	type Arc,
	type CountMap,
	type Step,
} from './types.js';
import { argBase, CHOOSE_VERB, GROUP_VERB, TEXT_ARG_KINDS, type VerbRegistry } from './stock-verbs.js';
import { isChoiceName, MAX_CHOICES } from './choose.js';

const COORD_KEYS = new Set(['x', 'z', 'y', 'xz', 'xy', 'pos', 'position']);

/** Every `watch` and `expr` arg in `arc`, nested arcs and choices too, in the order written. */
export function exprArgs(arc:Arc, verbs:VerbRegistry):string[] {
	const out:string[] = [];
	eachStep(arc, verbs, (step, registry) => {
		const kinds = registry.get(step.verb)?.args ?? {};
		for (const [key, value] of Object.entries(step.args)) {
			const kind = argBase(kinds[key]);
			if ((kind === 'watch' || kind === 'expr') && typeof value === 'string' && value.trim()) {
				out.push(value);
			}
		}
	});
	return out;
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

export function validateStep(step:Step, registry:VerbRegistry, nested = false):void {
	if (step.verb === GROUP_VERB) {
		const inner = groupArc(step);
		if (!inner) {
			throw new ArcError('a group needs an arc');
		}
		validateArc(inner, registry, nested);
		return;
	}
	const spec = registry.get(step.verb);
	if (!spec) {
		throw new ArcError(`unknown verb '${step.verb}'`);
	}
	// Only the Arc's own root gives orders: a loop of them, or a law's, re-orders the units for as long as it runs.
	if (nested && step.verb === 'issue') {
		throw new ArcError('issue goes at the root of an Arc, never inside another verb; close each issue(...) before the next');
	}
	rejectMigrationArgs(step.verb, step.args);
	if (step.verb === CHOOSE_VERB) {
		validateChoose(step, registry);
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
		if (key === 'times' && (!Number.isInteger(value) || (value as number) < 1)) {
			throw new ArcError(`verb '${step.verb}' arg 'times' must be a whole number from 1 up`);
		}
		if (base === 'string[]' && !(Array.isArray(value) && value.every((x) => typeof x === 'string'))) {
			throw new ArcError(`verb '${step.verb}' arg '${key}' must be string[]`);
		}
		if (base === 'bundle' && !isCountMap(value)) {
			throw new ArcError(`verb '${step.verb}' arg '${key}' must be { [item: string]: number }`);
		}
		if (base === 'bundle') {
			const bad = Object.entries(value as CountMap).find(([, count]) => !Number.isInteger(count) || count <= 0);
			if (bad) {
				throw new ArcError(`verb '${step.verb}' arg '${key}': ${bad[1]} of '${bad[0]}'; each count is a whole number above 0`);
			}
		}
		if (TEXT_ARG_KINDS.includes(base) && typeof value !== 'string') {
			throw new ArcError(`verb '${step.verb}' arg '${key}' must be a string`);
		}
		if (base === 'arc') {
			if (!isArc(value)) {
				throw new ArcError(`verb '${step.verb}' arg '${key}' must be an arc`);
			}
			validateArc(value, registry.nested(), true);
		}
		if (typeof value === 'string' && /^-?\d+(\.\d+)?\s*,\s*-?\d+/.test(value)) {
			throw new ArcError(`arg '${key}' looks like coordinates`);
		}
	}
}

/** A text `goal`, and 1 to {@link MAX_CHOICES} choices, each an arc under a name that is not reserved. */
function validateChoose(step:Step, registry:VerbRegistry):void {
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
		validateArc(value, registry.nested(), true);
	}
}

/** `nested`: this arc is held inside another verb's step, not the Arc's own root. */
export function validateArc(arc:Arc, registry:VerbRegistry, nested = false):void {
	if (arc.length === 0) {
		throw new ArcError('the arc is empty: give it at least one step');
	}
	for (const step of arc) {
		if (step.then !== undefined && !JOINS.includes(step.then)) {
			throw new ArcError(`unknown join '${String(step.then)}'`);
		}
		validateStep(step, registry, nested);
	}
}
