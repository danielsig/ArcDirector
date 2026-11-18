import { namedText, namingText, readTextWithIDs, type NamingText } from '../character/text-with-ids.js';
import type { JsonValue } from '../json.js';
import { isRecord } from '../json.js';
import { argKind, GROUP_VERB, IF_VERB, INSTEAD_VERB, WHILE_ARG, type VerbRegistry } from './stock-verbs.js';

/**
 * Whether the step after this one runs, judged by how this one went: `if_ok` (`&&`) only when it succeeded,
 * `always` (`;`) whatever happened, `if_failed` (`||`) only when it failed. Steps a join does not run are skipped as
 * JavaScript skips them: `&&` binds tighter than `||`, and `;` is lowest.
 */
export type Join = 'if_ok' | 'always' | 'if_failed';

/** How many of each item. The currency (`withMind({ currency })`) is an item like any other. */
export type CountMap = Record<string, number>;

export function isCountMap(v:unknown):v is CountMap {
	return isRecord(v) && Object.values(v).every((n) => typeof n === 'number' && Number.isFinite(n));
}

export type StepArg = string | number | boolean | string[] | CountMap | Arc;

export type Step = {
	verb:string;
	args:Record<string, StepArg>;
	/** How this step's result gates the next one. Missing: `if_ok`. Ignored on the last step. */
	then?:Join;
	/** Run this step even when the kit does not list its verb. */
	granted?:boolean;
	/**
	 * `let name = step`: the name later steps of its arc read its result by, as a watch would a binding: true or false,
	 * or a query's value. Given once in its arc and the arcs inside it, and gone when its arc ends.
	 */
	let?:string;
};

/** Steps in order. A group is the step `{ verb: 'group', args: { arc } }`, written `( … )`. */
export type Arc = Step[];

/**
 * How a step or an arc went. `ok`: done. `failed`: it did not happen. `stopped`: its program was replaced, or the
 * reaction it ran in was stopped; it ends every chain it is in. A step a reaction cuts short has no result: it is
 * suspended, and goes on once the reaction is done.
 */
export type ArcStatus = 'ok' | 'failed' | 'stopped';

export type ArcResult = {
	status:ArcStatus;
	/** Why, naming characters and things by id ({@link NamingText}): each mind reads it in its own names. */
	reason?:NamingText;
	verb?:string;
	/** The character, thing or place this step found no way to reach. */
	unreachable?:string;
	/** What stood in its way, by id, cheapest to get past first: the things a host named as blocking (`Passage.by`). */
	blockedBy?:string[];
	/** It failed for now, and going round again may go otherwise (the target moved): a `loop` does not stop at it. */
	retry?:boolean;
};

/** An {@link ArcResult} as a save keeps it. */
export type ArcResultJSON = Omit<ArcResult, 'reason'> & { reason?:JsonValue };

/** `result` as a save keeps it: a reason that names anyone keeps them by id. */
export function resultToJSON(result:ArcResult):ArcResultJSON {
	return { ...result, reason: typeof result.reason === 'function' ? namedText(result.reason) : result.reason };
}

/** A saved result read back. */
export function resultFromJSON({ reason, ...result }:ArcResultJSON):ArcResult {
	const text = reason === undefined ? undefined : readTextWithIDs(reason);
	return { ...result, ...text ? { reason: text.length === 1 ? text[0] : namingText(text) } : {} };
}

/** Why an arc is refused, and the text of the reply it is about (`at`) when one piece of it is at fault. */
export class ArcError extends Error {
	constructor(message:string, public readonly at?:string) {
		super(message);
		this.name = 'ArcError';
	}
}

/** A well-formed arc the world rules out: a step that already failed and still would, or speech no one is near enough to hear. */
export class BlockedArcError extends ArcError {
	constructor(message:string, at?:string) {
		super(message, at);
		this.name = 'BlockedArcError';
	}
}

export const JOINS:readonly Join[] = ['if_ok', 'always', 'if_failed'];

export const JOIN_SYMBOL:Record<Join, string> = {
	'if_ok': '&&',
	always: ';',
	'if_failed': '||',
};

export const SYMBOL_JOIN:Record<string, Join> = {
	'&&': 'if_ok',
	';': 'always',
	'||': 'if_failed',
};

/** A non-empty list of steps. `[]` and `string[]` are not arcs. */
export function isArc(v:unknown):v is Arc {
	return Array.isArray(v) && v.length > 0 && v.every((step) => isRecord(step) && typeof step.verb === 'string' && isRecord(step.args));
}

/** The arc a group step holds, or undefined for any other step. */
export function groupArc(step:Step):Arc | undefined {
	return step.verb === GROUP_VERB && isArc(step.args.arc) ? step.args.arc : undefined;
}

/**
 * Whether `step`'s arc arg `key` (any, without one) is part of the program it is in, as a group's, an `if`'s, an
 * `instead`'s and a `while`'s are, not handed on (a loop, a law, an order).
 */
export function opensArc(step:Step, key?:string):boolean {
	return step.verb === GROUP_VERB || step.verb === IF_VERB || step.verb === INSTEAD_VERB || key === WHILE_ARG;
}

/** The first step to run, looking inside a leading group. */
export function firstStep(arc:Arc):Step | undefined {
	const first = arc[0];
	const inner = first && groupArc(first);
	return inner ? firstStep(inner) : first;
}

/**
 * `arc` with each `instead { … }` at its root opened in place, its steps where it stood, the last joined to the next as
 * it was, or undefined when it has none: a reply that replaces its writer's own program under way.
 */
export function insteadOf(arc:Arc):Arc | undefined {
	if (!arc.some((step) => step.verb === INSTEAD_VERB)) {
		return undefined;
	}
	return arc.flatMap((step) => {
		if (step.verb !== INSTEAD_VERB || !isArc(step.args.arc)) {
			return [step];
		}
		const inner = step.args.arc;
		return step.then === undefined ? inner : [...inner.slice(0, -1), { ...inner.at(-1)!, then: step.then }];
	});
}

/** Every step in order, groups opened. Arcs held in args (`loop`, `when`, a choice) stay closed. */
export function arcSteps(arc:Arc):Step[] {
	return arc.flatMap((step) => {
		const inner = groupArc(step);
		return inner ? arcSteps(inner) : [step];
	});
}

/** The verbs `step`'s arc arg `key` may name: a group's, an `if`'s and a `while`'s are this registry's, any other arc arg's or choice's the full catalog's. */
export function verbsInside(step:Step, verbs:VerbRegistry, key?:string):VerbRegistry {
	return opensArc(step, key) ? verbs : verbs.nested();
}

/**
 * What a step does, without what its `choose` only says: a goal reworded, or a choice renamed, is the same program. The
 * last step's `then` joins nothing, so it says nothing.
 */
function programKey(arc:Arc):unknown {
	return arc.map((step, i) => {
		const choose = step.verb === 'choose';
		const args = Object.entries(step.args)
			.filter(([key]) => !(choose && key === 'goal'))
			.map(([key, value]) => [choose ? '' : key, isArc(value) ? programKey(value) : value]);
		return [step.verb, i < arc.length - 1 ? step.then : undefined, step.let, choose ? args.map((arg) => JSON.stringify(arg)).sort() : args];
	});
}

/** Whether two arcs are the same program, for all their wording. */
export function sameProgram(a:Arc, b:Arc):boolean {
	return JSON.stringify(programKey(a)) === JSON.stringify(programKey(b));
}

/** `visit` each step of `arc` and of every arc inside it, with the registry that step's verb is read from. A group is visited too. */
export function eachStep(arc:Arc, verbs:VerbRegistry, visit:(step:Step, verbs:VerbRegistry)=>void):void {
	for (const step of arc) {
		visit(step, verbs);
		for (const [key, value] of Object.entries(step.args)) {
			if (isArc(value)) {
				eachStep(value, verbsInside(step, verbs, key), visit);
			}
		}
	}
}

function mapCountMap(row:CountMap, map:(text:string, kind:string)=>string):CountMap {
	const out:CountMap = {};
	for (const [name, count] of Object.entries(row)) {
		const id = map(name, 'id');
		out[id] = (out[id] ?? 0) + count;
	}
	return out;
}

/** `arc` with each text arg rewritten by `map(text, kind)`, `kind` being the arg's kind without its `?`. Arcs inside are walked, never rewritten whole. Bundle keys are item ids. */
export function mapArgs(arc:Arc, verbs:VerbRegistry, map:(text:string, kind:string)=>string):Arc {
	return arc.map((step) => {
		const spec = verbs.get(step.verb);
		const args = { ...step.args };
		for (const [key, value] of Object.entries(args)) {
			if (isArc(value)) {
				args[key] = mapArgs(value, verbsInside(step, verbs, key), map);
			}
			else if (typeof value === 'string') {
				args[key] = map(value, argKind(spec, key));
			}
			else if (isCountMap(value)) {
				args[key] = mapCountMap(value, map);
			}
		}
		return { ...step, args };
	});
}
