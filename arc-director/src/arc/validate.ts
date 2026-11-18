import {
	ArcError,
	JOINS,
	eachStep,
	groupArc,
	isArc,
	opensArc,
	verbsInside,
	isCountMap,
	type Arc,
	type CountMap,
	type Step,
} from './arc-types.js';
import { argBase, argKind, argKinds, CHOOSE_VERB, GROUP_VERB, INSTEAD_VERB, TEST_VERB, TEXT_ARG_KINDS, WHILE_ARG, type VerbRegistry, type VerbSpec } from './stock-verbs.js';
import { argProblem, constraintAt, insideOf, meet, within, type ArgConstraint, type ArgPath } from './constraints.js';
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

/**
 * Where a step is: inside the nearest enclosing verb's arc arg (none at the root), and what that arc lets its steps be.
 * `opened`: in a group, an `if` or a `while` at the root, so no longer one of the Arc's own root steps.
 */
type Place = { path?:ArgPath; arc:ArgConstraint; opened?:boolean };

/**
 * How many arcs deep an Arc's steps may nest, whatever its verbs say: one more than the deepest a real Arc needs (a
 * law's loop of a choose, whose choices hold steps of their own, is 3). Groups, an `if`'s arcs and a `while` are where
 * their step is, and do not count. A model that loses its way nests on to its token limit; past this it is stopped.
 */
export const MAX_ARC_DEPTH = 4;

const ROOT:Place = { arc: { depth: MAX_ARC_DEPTH } };

/** `law's arc` for `law.arc`. */
function arcOf(at:Place):string {
	return at.path?.replace('.', '\'s ') ?? 'the arc';
}

/**
 * Where the steps of `step`'s arc arg `key` are: where `step` is for a group's, an `if`'s or a `while`'s, else inside it, under its
 * own constraint and what the arc `step` is in says of every step inside it.
 */
function into(step:Step, spec:VerbSpec, key:string, at:Place):Place {
	if (opensArc(step, key)) {
		return { ...at, opened: true };
	}
	if (at.arc.depth === 0) {
		throw new ArcError(`${arcOf(at)} may hold no arc inside it; ${step.verb} holds one`);
	}
	const { subverbs, not, depth } = at.arc;
	return { path: `${step.verb}.${key}`, arc: meet(constraintAt(spec, key, at.path), { subverbs, not, depth: depth === undefined ? undefined : depth - 1 }) };
}

function validateStep(step:Step, registry:VerbRegistry, at:Place):void {
	if (step.verb === GROUP_VERB) {
		const inner = groupArc(step);
		if (!inner) {
			throw new ArcError('a group needs an arc');
		}
		validateArc(inner, registry, { ...at, opened: true });
		return;
	}
	// Only the reply's own root steps are its writer's program; a unit's orders already replace what it does.
	if (step.verb === INSTEAD_VERB && (at.path || at.opened)) {
		throw new ArcError(at.path?.startsWith('command.') ? 'orders already replace what units do: write command(Archers) { … } without instead' : 'instead goes at the root of a reply, never inside another step', step.verb);
	}
	const spec = registry.get(step.verb);
	if (!spec) {
		throw new ArcError(`unknown verb '${step.verb}'`, step.verb);
	}
	// Only the Arc's own root gives orders: a loop of them, or a law's, re-orders the units for as long as it runs.
	if (at.path && step.verb === 'command') {
		throw new ArcError('command goes at the root of an Arc, never inside another verb; close each command(...) before the next');
	}
	const { subverbs, not } = at.arc;
	if (step.verb !== TEST_VERB && subverbs && !subverbs.includes(step.verb)) {
		throw new ArcError(`${arcOf(at)} may hold only ${subverbs.join(', ')}; not ${step.verb}`, step.verb);
	}
	if (not?.includes(step.verb)) {
		throw new ArcError(`${arcOf(at)} may not hold ${step.verb}`, step.verb);
	}
	rejectMigrationArgs(step.verb, step.args);
	if (step.verb === CHOOSE_VERB) {
		validateChoose(step, registry, into(step, spec, 'arc', at));
		return;
	}
	const kinds = argKinds(spec);
	for (const key of Object.keys(step.args)) {
		if (COORD_KEYS.has(key.toLowerCase())) {
			throw new ArcError(`coordinate arg '${key}' is not allowed`);
		}
		if (!(key in kinds)) {
			throw new ArcError(`verb '${step.verb}' has no arg '${key}'`, key);
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
		if (base === 'bool' && typeof value !== 'boolean') {
			throw new ArcError(`verb '${step.verb}' arg '${key}' is true or false`);
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
			validateArc(value, verbsInside(step, registry, key), into(step, spec, key, at));
		}
		if (typeof value === 'string' && /^-?\d+(\.\d+)?\s*,\s*-?\d+/.test(value)) {
			throw new ArcError(`arg '${key}' looks like coordinates`);
		}
		const problem = argProblem(key, value, constraintAt(spec, key, at.path));
		if (problem) {
			throw new ArcError(`${step.verb}${at.path ? ` ${insideOf(at.path)}` : ''}: ${problem}`);
		}
	}
}

/** A text `goal`, and 1 to {@link MAX_CHOICES} choices, each an arc under a name that is not reserved, written `inside`. */
function validateChoose(step:Step, registry:VerbRegistry, inside:Place):void {
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
		validateArc(value, registry.nested(), inside);
	}
}

/** `at`: where this arc is; the Arc's own root unless it is held inside another verb's step. */
export function validateArc(arc:Arc, registry:VerbRegistry, at = ROOT):void {
	if (arc.length === 0) {
		throw new ArcError('the arc is empty: give it at least one step');
	}
	if (arc.length > (at.arc.maxSteps ?? arc.length)) {
		throw new ArcError(`${arcOf(at)} may hold at most ${at.arc.maxSteps} steps; it has ${arc.length}`);
	}
	for (const step of arc) {
		if (step.then !== undefined && !JOINS.includes(step.then)) {
			throw new ArcError(`unknown join '${String(step.then)}'`);
		}
		validateStep(step, registry, at);
	}
	if (!at.path) {
		checkLets(arc, new Set());
		const endless = endlessProblem(arc, registry);
		if (endless) {
			throw endless;
		}
	}
}

/** Why a step of `arc`, an Arc's root steps, never runs, after one that never ends ({@link checkEndless}); none when every step can. */
export function endlessProblem(arc:Arc, registry:VerbRegistry):ArcError | undefined {
	return checkEndless(arc, registry.nested(), registry.has('command'));
}

/** Whether `step`, at the root of an Arc, never ends ({@link checkEndless}), so it may only be the Arc's last. */
export function onlyLast(step:Step, registry:VerbRegistry):boolean {
	return !!endlessIn(step, registry.nested(), registry.has('command'));
}

/** Whether `step` never ends of its own, without an `until` or `within`: an endless verb, or a loop with no `times` or `through`. */
export function neverEnds(step:Step, verbs:VerbRegistry | undefined):boolean {
	const { until, within, times, through } = step.args;
	return until === undefined && within === undefined && (!!verbs?.get(step.verb)?.endless || (step.verb === 'loop' && times === undefined && !through));
}

/**
 * Nothing is chained after a step that never ends ({@link neverEnds}), unless its `until=` or `within=` ends it, or,
 * in a reaction's body, the trigger: then what follows it runs once the trigger is gone, though not after one that is
 * `unbreakable=true`. A commander's own steps are orders that end at once (its `gather` hands the work out), so
 * only what its units run is checked. The repair turns the chain around: to the target, what came after, and the
 * endless step last, with an end of its own.
 */
function checkEndless(arc:Arc, verbs:VerbRegistry, exempt:boolean):ArcError | undefined {
	for (const [i, step] of arc.entries()) {
		const after = arc.slice(i + 1);
		const endless = endlessIn(step, verbs, exempt);
		if (after.length > 0 && endless) {
			const steps = after.map((next) => `${next.verb}(…)`).join(' && ');
			const target = typeof step.args.target === 'string' && verbs.has('go_to') ? `go_to(${step.args.target}) && ` : '';
			const last = step.verb === 'loop' ? 'loop' : formatStep({ verb: step.verb, args: { ...step.args, until: '…' } }, verbs);
			const ends = step.verb === 'loop' ? 'an until=, within= or times=' : 'an until= or within=';
			return new ArcError(`${endless} never ends, so ${steps} after it never runs. Write ${target}${steps} && ${last} — ${step.verb} last, with ${ends} to end it.`);
		}
		const inner = Object.values(step.args).map((value) => (isArc(value) ? checkEndless(value, verbs, step.verb === 'when' || step.verb === 'law' || (exempt && step.verb !== 'command')) : undefined)).find(Boolean);
		if (inner) {
			return inner;
		}
	}
	return undefined;
}

/**
 * The step that keeps `step` from ending, itself or one in its `while`, unless its own `until=` or `within=` ends it.
 * `exits`: in a reaction's body, where only a step that is `unbreakable=true` outlasts the trigger (`unbreakable=10s`
 * or `=N` rounds only hold it a while).
 */
function endlessIn(step:Step, verbs:VerbRegistry, exits:boolean):string | undefined {
	if (neverEnds(step, verbs) && (!exits || step.args.unbreakable === true)) {
		return step.verb;
	}
	if (step.args.until !== undefined || step.args.within !== undefined) {
		return undefined;
	}
	const whileArc = step.args[WHILE_ARG];
	return isArc(whileArc) ? whileArc.map((part) => endlessIn(part, verbs, exits)).find(Boolean) : undefined;
}

/** The arcs an explicit `think` may be written directly in, unless a mind's `explicitThinkAllowedInside` says: if/else and a choice. */
export const DEFAULT_EXPLICIT_THINK_ALLOWED_INSIDE:readonly ArgPath[] = ['if.arc', 'if.else', `${CHOOSE_VERB}.arc`];

/**
 * Why a `think` in `arc` is where it may not be: anywhere but directly in one of the arc args `inside` (`if.arc`; a
 * choice is `choose.arc`). Not at the root, in a group, or in a `when` or a law unless listed.
 */
export function misplacedThink(arc:Arc, inside:readonly ArgPath[], here?:ArgPath):ArcError | undefined {
	for (const step of arc) {
		if (step.verb === 'think' && !within(inside, here)) {
			return new ArcError(`think() ${placesHelp(inside)}: if (…) { think("…") }`, step.verb);
		}
		for (const [key, value] of Object.entries(step.args)) {
			const found = isArc(value) ? misplacedThink(value, inside, `${step.verb}.${step.verb === CHOOSE_VERB ? 'arc' : key}`) : undefined;
			if (found) {
				return found;
			}
		}
	}
	return undefined;
}

/** `only inside if/else or a choose choice` for `['if.arc', 'if.else', 'choose.arc']`: those of verbs `kit` has, when given. */
export function placesHelp(paths:readonly ArgPath[], kit?:{ has(verb:string):boolean }):string {
	const verbs = [...new Set(paths.map((path) => path.slice(0, path.indexOf('.'))))].filter((verb) => !kit || verb === '*' || kit.has(verb));
	const names = verbs.map((verb) => (verb === CHOOSE_VERB ? 'a choose choice' : [verb, ...paths.filter((path) => path.startsWith(`${verb}.`) && !path.endsWith('.arc')).map((path) => path.slice(verb.length + 1))].join('/')));
	return `only inside ${names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0] ?? 'nothing'}`;
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
