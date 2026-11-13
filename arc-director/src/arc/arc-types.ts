import { isRecord } from '../json.js';
import { argKind, GROUP_VERB, IF_VERB, type VerbRegistry } from './stock-verbs.js';

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
	reason?:string;
	verb?:string;
	/** The character, thing or place this step found no way to reach. */
	unreachable?:string;
	/** What stood in its way, by id, cheapest to get past first: the things a host named as blocking (`PathStep.by`). */
	blockedBy?:string[];
	/** It failed for now, and going round again may go otherwise (the target moved): a `loop` does not stop at it. */
	retry?:boolean;
};

export class ArcError extends Error {
	constructor(message:string) {
		super(message);
		this.name = 'ArcError';
	}
}

/** A well-formed arc the world rules out: a step that already failed and still would, or speech no one is near enough to hear. */
export class BlockedArcError extends ArcError {
	constructor(message:string) {
		super(message);
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

/** Whether `step`'s arcs are part of the program it is in, as a group's and an `if`'s are, not handed on (a loop, a law, an order). */
export function opensArc(step:Step):boolean {
	return step.verb === GROUP_VERB || step.verb === IF_VERB;
}

/** The first step to run, looking inside a leading group. */
export function firstStep(arc:Arc):Step | undefined {
	const first = arc[0];
	const inner = first && groupArc(first);
	return inner ? firstStep(inner) : first;
}

/** Every step in order, groups opened. Arcs held in args (`loop`, `when`, a choice) stay closed. */
export function arcSteps(arc:Arc):Step[] {
	return arc.flatMap((step) => {
		const inner = groupArc(step);
		return inner ? arcSteps(inner) : [step];
	});
}

/** The verbs the arcs inside `step` may name: a group's and an `if`'s are this registry's, any other arc arg's or choice's the full catalog's. */
export function verbsInside(step:Step, verbs:VerbRegistry):VerbRegistry {
	return opensArc(step) ? verbs : verbs.nested();
}

/** What a step does, without what its `choose` only says: a goal reworded, or a choice renamed, is the same program. */
function programKey(arc:Arc):unknown {
	return arc.map((step) => {
		const choose = step.verb === 'choose';
		const args = Object.entries(step.args)
			.filter(([key]) => !(choose && key === 'goal'))
			.map(([key, value]) => [choose ? '' : key, isArc(value) ? programKey(value) : value]);
		return [step.verb, step.then, step.let, choose ? args.map((arg) => JSON.stringify(arg)).sort() : args];
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
		const inside = verbsInside(step, verbs);
		for (const value of Object.values(step.args)) {
			if (isArc(value)) {
				eachStep(value, inside, visit);
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
		const inside = verbsInside(step, verbs);
		const args = { ...step.args };
		for (const [key, value] of Object.entries(args)) {
			if (isArc(value)) {
				args[key] = mapArgs(value, inside, map);
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
