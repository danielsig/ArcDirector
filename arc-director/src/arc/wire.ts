import { extractJson, isRecord } from '../json.js';
import { ArcError, JOINS, SYMBOL_JOIN, isArc, type Arc, type Join, type Step, type StepArg } from './types.js';
import { argBase, CHOOSE_VERB, GROUP_VERB, type VerbRegistry } from './stock-verbs.js';
import { choicesOf } from './choose.js';
import { parseArcText } from './parse.js';
import { validateArc } from './validate.js';

/**
 * An Arc as JSON, the way a model writes it: `{"steps":[{"verb":"go_to","target":"Lever"},{"verb":"say","text":"Hi",
 * "then":"always"}]}`. Args are inline, `verb` first and `then` last; a nested arc is a bare array of steps; a group
 * is `{"verb":"group","arc":[…]}` and `choose` is `{"verb":"choose","goal":"…","choices":{"name":[…]}}`.
 */

/** The JSON values of `arc`'s steps. With `verbs`, expression args read their string literals in single quotes. */
function stepsJSON(arc:Arc, verbs:VerbRegistry | undefined):unknown[] {
	return arc.map((step) => stepJSON(step, verbs));
}

function stepJSON(step:Step, verbs:VerbRegistry | undefined):Record<string, unknown> {
	const out:Record<string, unknown> = { verb: step.verb };
	const inside = verbs && (step.verb === GROUP_VERB ? verbs : verbs.nested());
	if (step.verb === CHOOSE_VERB) {
		if (step.args.goal !== undefined) {
			out.goal = step.args.goal;
		}
		out.choices = Object.fromEntries(Object.entries(choicesOf(step)).map(([name, arc]) => [name, stepsJSON(arc, inside)]));
	}
	else {
		const kinds = verbs?.get(step.verb)?.args ?? {};
		for (const [key, value] of Object.entries(step.args)) {
			out[key] = isArc(value) ? stepsJSON(value, inside) : typeof value === 'string' ? singleQuoted(value, argBase(kinds[key])) : value;
		}
	}
	if (step.then) {
		out.then = step.then;
	}
	return out;
}

/** An expression with its string literals in single quotes, so the JSON around it needs no escapes. */
function singleQuoted(text:string, kind:string):string {
	const expression = kind === 'watch' || kind === 'expr' || (kind === 'id' && /[(.]/.test(text));
	return expression && text.includes('"') && !text.includes("'") ? text.replaceAll('"', "'") : text;
}

export function arcToJSON(arc:Arc):{ steps:unknown[] } {
	return { steps: stepsJSON(arc, undefined) };
}

/** The Arc JSON as one line, for a prompt's examples. Expression args read in single quotes; prose is untouched. */
export function arcJSONText(arc:Arc, verbs:VerbRegistry):string {
	return JSON.stringify({ steps: stepsJSON(arc, verbs) });
}

function isStepArg(v:unknown):v is StepArg {
	return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
}

function readJoin(raw:unknown):Join | undefined {
	const join = typeof raw === 'string' ? (JOINS as readonly string[]).includes(raw) ? raw as Join : SYMBOL_JOIN[raw.trim()] : undefined;
	if (!join) {
		throw new ArcError(`unknown join '${String(raw)}'; then is if_ok, always or if_failed`);
	}
	return join === 'if_ok' ? undefined : join;
}

/** Steps as written, an arc being a list of steps. A string where an arc goes is Arc text. */
function readSteps(raw:unknown, verbs:VerbRegistry):Arc {
	if (typeof raw === 'string') {
		return parseArcText(raw, verbs);
	}
	if (!Array.isArray(raw) || raw.length === 0) {
		throw new ArcError('an arc is a non-empty list of steps');
	}
	const arc = raw.map((step) => readStep(step, verbs));
	delete arc[arc.length - 1].then;
	return arc;
}

function readStep(raw:unknown, verbs:VerbRegistry):Step {
	if (!isRecord(raw)) {
		throw new ArcError('a step is an object: {"verb":"go_to","target":"Name"}');
	}
	if (typeof raw.verb !== 'string') {
		throw new ArcError('step.verb must be a string');
	}
	const step:Step = { verb: raw.verb, args: {} };
	const kinds = verbs.get(raw.verb)?.args ?? {};
	const only = (...keys:string[]):void => {
		const extra = Object.keys(raw).find((key) => key !== 'verb' && key !== 'then' && !keys.includes(key));
		if (extra) {
			throw new ArcError(`'${raw.verb as string}' takes ${keys.join(' and ')}, not '${extra}'`);
		}
	};
	if (raw.verb === GROUP_VERB) {
		only('arc');
		step.args.arc = readSteps(raw.arc, verbs);
	}
	else if (raw.verb === CHOOSE_VERB) {
		only('goal', 'choices');
		if (raw.goal !== undefined) {
			step.args.goal = raw.goal as StepArg;
		}
		if (!isRecord(raw.choices)) {
			throw new ArcError('choose needs choices: {"name":[steps], …}');
		}
		for (const [name, choice] of Object.entries(raw.choices)) {
			step.args[name] = readSteps(choice, verbs.nested());
		}
	}
	else {
		for (const [key, value] of Object.entries(raw)) {
			if (key === 'verb' || key === 'then' || value === undefined || value === null) {
				continue;
			}
			if (argBase(kinds[key]) === 'arc') {
				step.args[key] = readSteps(value, verbs.nested());
			}
			else if (isStepArg(value)) {
				step.args[key] = value;
			}
			else {
				throw new ArcError(`arg '${key}' has an unsupported type`);
			}
		}
	}
	const join = raw.then === undefined || raw.then === null ? undefined : readJoin(raw.then);
	if (join) {
		step.then = join;
	}
	return step;
}

/** An Arc from its JSON: `{"steps":[…]}`, a bare list of steps, or one step. Checked against `verbs`. */
export function arcFromJSON(raw:unknown, verbs:VerbRegistry):Arc {
	let arc:Arc;
	if (isRecord(raw) && 'steps' in raw) {
		arc = readSteps(raw.steps, verbs);
	}
	else if (isRecord(raw) && typeof raw.verb === 'string') {
		arc = [readStep(raw, verbs)];
	}
	else if (typeof raw === 'string' || Array.isArray(raw)) {
		arc = readSteps(raw, verbs);
	}
	else {
		throw new ArcError('arc is not {"steps":[…]}, a list of steps or one step');
	}
	validateArc(arc, verbs);
	return arc;
}

/** The last `{"steps"` in a reply that reasons in front of its answer. */
function lastStepsJSON(text:string):string | undefined {
	let at = -1;
	const re = /\{\s*"steps"\s*:/g;
	let m:RegExpExecArray | null;
	while ((m = re.exec(text))) {
		at = m.index;
	}
	return at >= 0 ? text.slice(at) : undefined;
}

/** An Arc from a model's reply or a host's input: Arc JSON (fenced, or after some reasoning) or Arc text. */
export function parseArc(input:string | unknown, registry:VerbRegistry):Arc {
	if (typeof input !== 'string') {
		return arcFromJSON(input, registry);
	}
	const trimmed = input.trim();
	const steps = lastStepsJSON(trimmed);
	if (steps !== undefined) {
		return arcFromJSON(extractJson(steps), registry);
	}
	if (/^[{[`]/.test(trimmed)) {
		return arcFromJSON(extractJson(trimmed), registry);
	}
	return parseArcText(trimmed, registry);
}

/** An `arc` argument as an `Arc`: already parsed, or text to parse. Undefined when it does not parse. */
export function arcArg(raw:unknown, registry:VerbRegistry):Arc | undefined {
	if (isArc(raw)) {
		return raw;
	}
	if (typeof raw !== 'string' || !raw.trim()) {
		return undefined;
	}
	try {
		return parseArc(raw, registry);
	}
	catch {
		return undefined;
	}
}
