import { extractJson, isRecord } from '../json.js';
import { ArcError, JOINS, SYMBOL_JOIN, isArc, isCountMap, type Arc, type Join, type Step, type StepArg } from './types.js';
import { argBase, CHOOSE_VERB, GROUP_VERB, TEXT_ARG_KINDS, type VerbRegistry } from './stock-verbs.js';
import { choicesOf } from './choose.js';
import { formatArcBlocks, parseArcText } from './parse.js';
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

/**
 * The Arc JSON laid out as Arc text's blocks are, for a prompt's examples: what holds an arc opens on its line, what is in
 * it goes a tab deeper, and it closes at its opener's depth. A small model needs the indent to follow the nesting, and
 * no line ends on a long run of closing brackets for it to recite.
 */
export function arcJSONBlocks(arc:Arc, verbs:VerbRegistry):string {
	return `{"steps":${blockJSON(stepsJSON(arc, verbs), 0)}}`;
}

function blockJSON(value:unknown, depth:number):string {
	const inner = '\t'.repeat(depth + 1);
	const close = '\t'.repeat(depth);
	if (Array.isArray(value) && isRecord(value[0])) {
		// One step with no arc inside stays on the line that holds it, as a call does in Arc text.
		const flat = value.length === 1 && !Object.values(value[0]).some((v) => Array.isArray(v) || (isRecord(v) && Object.values(v).some(Array.isArray)));
		return flat ? JSON.stringify(value) : `[\n${value.map((step) => inner + blockJSON(step, depth + 1)).join(',\n')}\n${close}]`;
	}
	if (!isRecord(value)) {
		return JSON.stringify(value);
	}
	const args = Object.entries(value).map(([key, arg]) => {
		const shown = key === 'choices' && isRecord(arg)
			? `{\n${Object.entries(arg).map(([name, choice]) => `${inner}${JSON.stringify(name)}:${blockJSON(choice, depth + 1)}`).join(',\n')}\n${close}}`
			: blockJSON(arg, depth);
		return `${JSON.stringify(key)}:${shown}`;
	});
	return `{${args.join(',')}}`;
}

function isStepArg(v:unknown):v is StepArg {
	return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || isCountMap(v)
		|| (Array.isArray(v) && v.every((x) => typeof x === 'string'));
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
	// An empty {} a model leaves between two steps is no step.
	const steps = Array.isArray(raw) ? raw.filter((step) => !isRecord(step) || Object.keys(step).length > 0) : [];
	if (steps.length === 0) {
		throw new ArcError('the arc is empty: give it at least one step');
	}
	const arc = steps.map((step) => readStep(step, verbs));
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
		// Its args cannot be read without its spec: the verb is what is wrong.
		if (!verbs.has(raw.verb)) {
			throw new ArcError(`unknown verb '${raw.verb}'`);
		}
		for (const [key, value] of Object.entries(raw)) {
			if (key === 'verb' || key === 'then' || value === undefined || value === null) {
				continue;
			}
			if (argBase(kinds[key]) === 'arc') {
				step.args[key] = readSteps(value, verbs.nested());
			}
			else if (isStepArg(value)) {
				// A number or a yes written for a text arg is its text: `"code": 417`.
				step.args[key] = TEXT_ARG_KINDS.includes(argBase(kinds[key])) && (typeof value === 'number' || typeof value === 'boolean') ? String(value) : value;
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

/**
 * What has been written of an Arc in a reply still coming in, as Arc text in block layout, whatever its wire format;
 * undefined while nothing reads as one (a reply that calls a tool never does). Nothing is checked: it is for showing,
 * and its last step may still lack what it needs.
 */
export function arcSoFar(reply:string, verbs:VerbRegistry):string | undefined {
	const text = reply.trim();
	const json = lastStepsJSON(text) ?? (/^[{[`]/.test(text) ? text : undefined);
	if (json === undefined) {
		return text || undefined;
	}
	try {
		const raw = extractJson(json);
		return isRecord(raw) && 'steps' in raw ? formatArcBlocks(readSteps(raw.steps, verbs), verbs) : undefined;
	}
	catch {
		return undefined;
	}
}

/** Longest a written expression or name may run, and any other text, in letters: well past any a model has written. */
const MAX_EXPR = 300;
const MAX_TEXT = 800;
/** What a closing run of an Arc's JSON looks like. In a string it means the quote was never closed. */
const CLOSERS = /[}\]][}\]]|```/;

/**
 * Follows a reply as its pieces come in, and says why as soon as it can no longer become an Arc: a string that ran on
 * with the Arc's closing brackets in it, or past any length a real one has. A model that forgets one closing quote
 * otherwise writes on to its token limit, since a reply schema lets a string hold anything.
 */
export function replyBreakdown(verbs:VerbRegistry):(piece:string)=>string | undefined {
	const specs = [...verbs.list(), ...verbs.nested().list()];
	const strict = new Set(specs.flatMap((spec) => Object.entries(spec.args).filter(([, kind]) => ['watch', 'expr', 'id'].includes(argBase(kind))).map(([key]) => key)));
	let json:boolean | undefined;
	let inString = false;
	let escaped = false;
	let current = '';
	let lastString = '';
	let afterColon = false;
	let key = '';
	let depth = 0;
	const broken = (char:string):string | undefined => {
		const isExpr = strict.has(key);
		if (current.length > (isExpr ? MAX_EXPR : MAX_TEXT)) {
			return `"${key}" ran on past any real value: close its quote`;
		}
		if (CLOSERS.test(current.slice(-3))) {
			return `"${key}" never closed its quote: the closing brackets went inside it`;
		}
		depth += char === '(' ? 1 : char === ')' ? -1 : 0;
		return isExpr && depth < 0 ? `"${key}" closes a bracket it never opened` : undefined;
	};
	return (piece) => {
		for (const char of piece) {
			json ??= /\s/.test(char) ? undefined : char === '{' || char === '[' || char === '`';
			if (json !== true) {
				continue;
			}
			if (!inString) {
				if (char === ':') {
					key = lastString;
					afterColon = true;
				}
				else if (char === '"') {
					inString = true;
					current = '';
					depth = 0;
				}
				else if (!/\s/.test(char)) {
					afterColon = false;
				}
				continue;
			}
			if (escaped) {
				escaped = false;
			}
			else if (char === '\\') {
				escaped = true;
			}
			else if (char === '"') {
				inString = false;
				lastString = current;
				afterColon = false;
			}
			else {
				current += char;
				const why = afterColon ? broken(char) : undefined;
				if (why) {
					return why;
				}
			}
		}
		return undefined;
	};
}

/** The root steps of a JSON reply that were written to their end before it broke down, as a reply of their own. */
export function finishedSteps(reply:string):string | undefined {
	const list = reply.indexOf('[', reply.indexOf('"steps"'));
	if (!reply.includes('"steps"') || list < 0) {
		return undefined;
	}
	const steps:string[] = [];
	let depth = 0;
	let inString = false;
	let escaped = false;
	let start = 0;
	for (let i = list + 1; i < reply.length; i++) {
		const char = reply[i];
		if (inString) {
			inString = escaped || char !== '"';
			escaped = !escaped && char === '\\';
		}
		else if (char === '"') {
			inString = true;
		}
		else if (char === '{' || char === '[') {
			start = depth === 0 ? i : start;
			depth += 1;
		}
		else if (char === '}' || char === ']') {
			depth -= 1;
			if (depth < 0) {
				break;
			}
			if (depth === 0) {
				steps.push(reply.slice(start, i + 1));
			}
		}
	}
	return steps.length > 0 ? `{"steps":[${steps.join(',')}]}` : undefined;
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
