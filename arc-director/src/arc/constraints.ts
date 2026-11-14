import type { JsonSchema } from '../json.js';
import { parse } from '../expr/expr-parse.js';
import type { StepArg } from './arc-types.js';
import type { VerbSpec } from './stock-verbs.js';

/** A rule on one arg the fields of {@link ArgConstraint} cannot say. */
export type ArgCheck = {
	/** Why `value` breaks it, or `undefined` when it holds. */
	check:(value:StepArg)=>string | undefined;
	/** Its words in the verb's help line. */
	help?:string;
	/** Merged into the arg's reply schema, to enforce it there too; it must accept every value `check` does. */
	schema?:JsonSchema;
};

/** What one arg may hold beyond its kind. Declarations only narrow: where several apply, an arg holds what all of them allow. */
export type ArgConstraint = {
	/** `id`, `string`, `text`: the names it may be. */
	names?:readonly string[];
	/** `number` */
	min?:number;
	max?:number;
	integer?:boolean;
	/** `arc`: the only verbs its steps may be (`subverbs`), or every verb but `not`, in the arcs inside it too. */
	subverbs?:readonly string[];
	not?:readonly string[];
	/** `arc`: the most steps it holds; a group counts as one, and holds as many. */
	maxSteps?:number;
	/** `arc`: how many arcs deep its steps may nest more; 0, none of them holds an arc. */
	depth?:number;
	/** `watch`, `expr`: it must parse as an expression. */
	syntax?:'expr';
	/** Rules of the host's own; every one runs. */
	custom?:readonly ArgCheck[];
};

/** Where a step is: the nearest enclosing verb and its arc arg, `law.arc`. As a `whenInside` key, `*.arc` is any verb's. */
export type ArgPath = `${string}.${string}`;

type Meet = { [K in keyof ArgConstraint]-?:(a:NonNullable<ArgConstraint[K]>, b:NonNullable<ArgConstraint[K]>)=>ArgConstraint[K] };

const MEET:Meet = {
	names: (a, b) => a.filter((name) => b.includes(name)),
	min: Math.max,
	max: Math.min,
	integer: (a, b) => a || b,
	subverbs: (a, b) => a.filter((verb) => b.includes(verb)),
	not: (a, b) => [...new Set([...a, ...b])],
	maxSteps: Math.min,
	depth: Math.min,
	syntax: (a) => a,
	custom: (a, b) => [...a, ...b],
};

/** `a` narrowed by `b`, in any order: lists intersect, `not` and `custom` join, the tighter bound wins. */
export function meet<T extends ArgConstraint>(a:T, b:ArgConstraint | undefined):T {
	const out:Record<string, unknown> = { ...a };
	for (const [key, value] of Object.entries(b ?? {})) {
		const rule = MEET[key as keyof Meet] as ((x:unknown, y:unknown)=>unknown) | undefined;
		if (value !== undefined) {
			out[key] = out[key] === undefined || !rule ? value : rule(out[key], value);
		}
	}
	return out as T;
}

function matches(key:string, path:ArgPath):boolean {
	return key === path || key === `*${path.slice(path.indexOf('.'))}`;
}

/** What `spec`'s arg `key` may hold at `path`: its own constraint, met with each `whenInside` entry for there. */
export function constraintAt(spec:VerbSpec | undefined, key:string, path?:ArgPath):ArgConstraint {
	const inside = path ? Object.entries(spec?.whenInside ?? {}).filter(([at]) => matches(at, path)) : [];
	return inside.reduce<ArgConstraint>((out, [, args]) => meet(out, args[key]), spec?.args[key] ?? {});
}

/** Whether any of `verbs` narrows an arg when written at `path`. */
export function narrowsAt(verbs:readonly VerbSpec[], path:ArgPath):boolean {
	return verbs.some((spec) => Object.keys(spec.whenInside ?? {}).some((at) => matches(at, path)));
}

/** `inside a law` for `law.arc`, `inside any arc` for `*.arc`. */
export function insideOf(path:string):string {
	const verb = path.slice(0, path.indexOf('.'));
	return verb === '*' ? 'inside any arc' : `inside ${/^[aeiou]/.test(verb) ? 'an' : 'a'} ${verb}`;
}

/** What a number may be under `c`: `a whole number`, `at least 1`, `at most 10`. */
function bounds(c:ArgConstraint):string[] {
	return [c.integer && 'a whole number', c.min !== undefined && `at least ${c.min}`, c.max !== undefined && `at most ${c.max}`].filter((part):part is string => !!part);
}

/** Why `value` of arg `key` breaks `c`, said of the arg (`seconds is at most 10`); none when it holds. */
export function argProblem(key:string, value:StepArg, c:ArgConstraint):string | undefined {
	if (typeof value === 'string' && c.names && !c.names.includes(value)) {
		return `${key} is one of ${c.names.join(', ')}; ${value} is not`;
	}
	if (typeof value === 'number' && ((c.integer && !Number.isInteger(value)) || value < (c.min ?? value) || value > (c.max ?? value))) {
		return `${key} is ${bounds(c).join(' and ')}`;
	}
	if (typeof value === 'string' && c.syntax === 'expr') {
		try {
			parse(value);
		}
		catch (err) {
			return `${key}: ${(err as Error).message}`;
		}
	}
	return c.custom?.map((rule) => rule.check(value)).find(Boolean);
}

/** `c` in a verb's help line, after its arg's name (`seconds at most 10`); `''` when it says nothing. Verbs show only as `shown` keeps them. */
export function constraintHelp(key:string, c:ArgConstraint, shown:(verbs:readonly string[])=>readonly string[]):string {
	const only = shown(c.subverbs ?? []).join('/');
	const without = shown(c.not ?? []).join('/');
	const parts = [
		c.names && `one of ${c.names.join('/')}`,
		...bounds(c),
		only && `only ${only}`,
		without && `without ${without}`,
		c.maxSteps !== undefined && `at most ${c.maxSteps} steps`,
		c.depth !== undefined && (c.depth === 0 ? 'with no arc inside' : `nesting at most ${c.depth} deep`),
		...(c.custom ?? []).map((rule) => rule.help),
	].filter(Boolean);
	return parts.length > 0 ? `${key} ${parts.join(' and ')}` : '';
}
