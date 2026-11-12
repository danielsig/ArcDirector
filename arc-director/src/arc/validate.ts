import {
	ArcError,
	JOINS,
	eachStep,
	groupArc,
	isArc,
	opensArc,
	isCountMap,
	type Arc,
	type CountMap,
	type Step,
} from './arc-types.js';
import { argBase, argKind, argKinds, CHOOSE_VERB, GROUP_VERB, TEXT_ARG_KINDS, type VerbRegistry } from './stock-verbs.js';
import { isChoiceName, MAX_CHOICES } from './choose.js';
import { RESERVED } from '../expr/expr-types.js';
import { durationSeconds } from '../expr/lex.js';
import { formatStep } from './arc-format.js';

const COORD_KEYS = new Set(['x', 'z', 'y', 'xz', 'xy', 'pos', 'position']);

/** Every `watch` and `expr` arg in `arc`, nested arcs and choices too, in the order written. */
export function exprArgs(arc:Arc, verbs:VerbRegistry):string[] {
	const out:string[] = [];
	eachStep(arc, verbs, (step, registry) => {
		const spec = registry.get(step.verb);
		for (const [key, value] of Object.entries(step.args)) {
			const kind = argKind(spec, key);
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
		throw new ArcError('when(who) is command(who, arc); when is when(watch, arc)');
	}
	if (verb === 'command' && watch) {
		throw new ArcError('command(watch) is when(watch, arc); command is command(who, arc)');
	}
}

function validateStep(step:Step, registry:VerbRegistry, nested = false):void {
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
	if (nested && step.verb === 'command') {
		throw new ArcError('command goes at the root of an Arc, never inside another verb; close each command(...) before the next');
	}
	rejectMigrationArgs(step.verb, step.args);
	if (step.verb === CHOOSE_VERB) {
		validateChoose(step, registry);
		return;
	}
	const kinds = argKinds(spec);
	for (const key of Object.keys(step.args)) {
		if (COORD_KEYS.has(key.toLowerCase())) {
			throw new ArcError(`coordinate arg '${key}' is not allowed`);
		}
		if (!(key in kinds)) {
			throw new ArcError(`verb '${step.verb}' has no arg '${key}'`);
		}
	}
	for (const [key, kind] of Object.entries(kinds)) {
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
		const seconds = base === 'hold' && typeof value === 'string' ? durationSeconds(value) : undefined;
		if (base === 'hold' && spec.endless && seconds === undefined) {
			throw new ArcError(`${step.verb} holds for seconds: unbreakable=10s${value === true ? '; true would never let it end' : ''}`);
		}
		if (base === 'hold' && seconds === undefined && value !== true && !(Number.isInteger(value) && (value as number) >= 0)) {
			throw new ArcError(`verb '${step.verb}' arg '${key}' is true, a whole number of rounds, or seconds (10s)`);
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
			validateArc(value, opensArc(step) ? registry : registry.nested(), nested || !opensArc(step));
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
	if (!nested) {
		checkLets(arc, new Set());
		checkEndless(arc, registry.nested(), registry.has('command'));
	}
}

/**
 * Nothing is chained after an endless verb (`follow`), which never ends unless its `until=` or `within=` ends it, or,
 * in a reaction's body, the trigger: then what follows it runs once the trigger is gone. A commander's own steps are
 * orders that end at once (its `gather` hands the work out), so only what its units run is checked. The repair turns
 * the chain around: to the target, what came after, and the endless verb last, with an end of its own.
 */
function checkEndless(arc:Arc, verbs:VerbRegistry, exempt:boolean):void {
	arc.forEach((step, i) => {
		const after = arc.slice(i + 1);
		if (after.length > 0 && !exempt && verbs.get(step.verb)?.endless && step.args.until === undefined && step.args.within === undefined) {
			const steps = after.map((next) => `${next.verb}(…)`).join(' && ');
			const target = typeof step.args.target === 'string' && verbs.has('go_to') ? `go_to(${step.args.target}) && ` : '';
			const last = formatStep({ verb: step.verb, args: { ...step.args, until: '…' } }, verbs);
			throw new ArcError(`${step.verb} never ends, so ${steps} after it never runs. Write ${target}${steps} && ${last} — ${step.verb} last, with an until= or within= to end it.`);
		}
		for (const value of Object.values(step.args)) {
			if (isArc(value)) {
				checkEndless(value, verbs, step.verb === 'when' || step.verb === 'law' || (exempt && step.verb !== 'command'));
			}
		}
	});
}

/** Names a `let` may not take: what every watch already reads by name. */
const BOUND = new Set([...RESERVED, 'landmarks', 'events', 'allUnits']);

/**
 * Each `let` name is given once: from its `let` to the end of its arc it is taken, in the arcs inside that arc too. A
 * name is a word, and not one a watch already reads (`me`, `fail`, …).
 */
function checkLets(arc:Arc, outer:ReadonlySet<string>):void {
	const scope = new Set(outer);
	for (const step of arc) {
		if (step.let !== undefined) {
			if (!/^[a-z_]\w*$/.test(step.let) || BOUND.has(step.let)) {
				throw new ArcError(`let ${step.let}: a name for a result is a new word starting in lowercase, not ${BOUND.has(step.let) ? 'one watches read' : 'that'}`);
			}
			if (scope.has(step.let)) {
				throw new ArcError(`let ${step.let} twice: a name is given once in its arc; pick another`);
			}
			scope.add(step.let);
		}
		for (const value of Object.values(step.args)) {
			if (isArc(value)) {
				checkLets(value, scope);
			}
		}
	}
}
