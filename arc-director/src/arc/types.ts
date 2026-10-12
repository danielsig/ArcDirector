import { isRecord } from '../json.js';
import { argBase, GROUP_VERB, type VerbRegistry } from './stock-verbs.js';

/**
 * Whether the step after this one runs, judged by how this one went: `if_ok` (`&&`) only when it succeeded,
 * `always` (`;`) whatever happened, `if_failed` (`||`) only when it failed, the rest of the arc as its fallback.
 */
export type Join = 'if_ok' | 'always' | 'if_failed';

/** How many of each item. `gold` is purse gold. */
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
};

/** Steps in order. A group is the step `{ verb: 'group', args: { arc } }`, written `( … )`. */
export type Arc = Step[];

export type ArcResult = {
	ok:boolean;
	interrupted?:boolean;
	/** Handler watch went false or a higher-rank handler stole the step. Not a fail. */
	preempted?:boolean;
	reason?:string;
	verb?:string;
	/** The character, thing or place this step found no way to reach. */
	unreachable?:string;
};

export class ArcError extends Error {
	constructor(message:string) {
		super(message);
		this.name = 'ArcError';
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

/** The verbs the arcs inside `step` may name: a group's are this registry's, any other arc arg's or choice's the full catalog's. */
export function verbsInside(step:Step, verbs:VerbRegistry):VerbRegistry {
	return step.verb === GROUP_VERB ? verbs : verbs.nested();
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
		const kinds = verbs.get(step.verb)?.args ?? {};
		const inside = verbsInside(step, verbs);
		const args = { ...step.args };
		for (const [key, value] of Object.entries(args)) {
			if (isArc(value)) {
				args[key] = mapArgs(value, inside, map);
			}
			else if (typeof value === 'string') {
				args[key] = map(value, argBase(kinds[key]));
			}
			else if (isCountMap(value)) {
				args[key] = mapCountMap(value, map);
			}
		}
		return { ...step, args };
	});
}

export function isHoistedWhen(step:Step):boolean {
	const watch = typeof step.args.watch === 'string' ? step.args.watch.trim() : '';
	return step.verb === 'when' && watch.length > 0;
}

export function isIssue(step:Step):boolean {
	return step.verb === 'issue';
}
