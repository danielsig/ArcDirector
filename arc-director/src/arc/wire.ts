import { extractJson, isRecord } from '../json.js';
import { ArcError, JOINS, SYMBOL_JOIN, isArc, isCountMap, opensArc, verbsInside, type Arc, type Join, type Step, type StepArg } from './arc-types.js';
import { argBase, argKind, argKinds, CHOOSE_VERB, GROUP_VERB, TEXT_ARG_KINDS, type VerbRegistry } from './stock-verbs.js';
import { choicesOf } from './choose.js';
import { parseArcText } from './arc-parse.js';
import { formatArcBlocks } from './arc-format.js';
import { MAX_ARC_DEPTH, validateArc } from './validate.js';

/**
 * An Arc as JSON, the way a model writes it: `{"steps":[{"verb":"go_to","target":"Lever"},{"verb":"say","text":"Hi",
 * "then":"always"}]}`. Args are inline, `verb` first (after a `let`) and `then` last; a nested arc is a bare array of
 * steps; a group is `{"verb":"group","arc":[…]}`, a query `{"verb":"test","watch":"…"}`, and `choose` is
 * `{"verb":"choose","goal":"…","choices":{"name":[…]}}`.
 */

/** The JSON values of `arc`'s steps. With `verbs`, expression args read their string literals in single quotes. */
function stepsJSON(arc:Arc, verbs:VerbRegistry | undefined):unknown[] {
	return arc.map((step) => stepJSON(step, verbs));
}

function stepJSON(step:Step, verbs:VerbRegistry | undefined):Record<string, unknown> {
	const out:Record<string, unknown> = { ...step.let ? { let: step.let } : {}, verb: step.verb };
	if (step.verb === CHOOSE_VERB) {
		if (step.args.goal !== undefined) {
			out.goal = step.args.goal;
		}
		out.choices = Object.fromEntries(Object.entries(choicesOf(step)).map(([name, arc]) => [name, stepsJSON(arc, verbs?.nested())]));
	}
	else {
		const spec = verbs?.get(step.verb);
		for (const [key, value] of Object.entries(step.args)) {
			out[key] = isArc(value) ? stepsJSON(value, verbs && verbsInside(step, verbs, key)) : typeof value === 'string' ? singleQuoted(value, argKind(spec, key)) : value;
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
	// A step's arcs (an if's cond, arc and else; a choose's choices) each go on a line of their own, a tab deeper, the
	// args after them on one more, and its } alone: on one line a small model loses the nesting, and recites the run of
	// closing brackets it ends in. The args keep their order, as the step is compared by it.
	const holdsArc = (key:string, arg:unknown):boolean => (Array.isArray(arg) && isRecord(arg[0])) || (key === 'choices' && isRecord(arg));
	const lines:string[][] = [[]];
	let nested = false;
	for (const [key, arg] of Object.entries(value)) {
		const arc = holdsArc(key, arg);
		if (arc || nested !== arc) {
			lines.push([]);
		}
		nested = arc;
		const deeper = '\t'.repeat(depth + 2);
		const shown = !arc ? JSON.stringify(arg)
			: key === 'choices' && isRecord(arg)
				? `{\n${Object.entries(arg).map(([name, choice]) => `${deeper}${JSON.stringify(name)}:${blockJSON(choice, depth + 2)}`).join(',\n')}\n${inner}}`
				: blockJSON(arg, depth + 1);
		lines.at(-1)!.push(`${JSON.stringify(key)}:${shown}`);
	}
	const [head, ...rest] = lines.filter((line) => line.length > 0);
	return rest.length === 0 ? `{${head.join(',')}}` : `{${head.join(',')},\n${rest.map((line) => inner + line.join(',')).join(',\n')}\n${close}}`;
}

/** What a step's JSON holds beside its args. */
const STEP_KEYS:readonly string[] = ['verb', 'then', 'let'];

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
	if (typeof raw.let === 'string' && raw.let.trim()) {
		step.let = raw.let.trim();
	}
	const spec = verbs.get(raw.verb);
	const inside = (key:string):VerbRegistry => verbsInside(step, verbs, key);
	const only = (...keys:string[]):void => {
		const extra = Object.keys(raw).find((key) => !STEP_KEYS.includes(key) && !keys.includes(key));
		if (extra) {
			throw new ArcError(`'${raw.verb as string}' takes ${keys.join(' and ')}, not '${extra}'`);
		}
	};
	if (raw.verb === GROUP_VERB) {
		only('arc');
		step.args.arc = readSteps(raw.arc, inside('arc'));
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
			step.args[name] = readSteps(choice, inside(name));
		}
	}
	else {
		// Its args cannot be read without its spec: the verb is what is wrong.
		if (!verbs.get(raw.verb)) {
			throw new ArcError(`unknown verb '${raw.verb}'`, String(raw.verb));
		}
		for (const [key, value] of Object.entries(raw)) {
			if (STEP_KEYS.includes(key) || value === undefined || value === null) {
				continue;
			}
			if (argKind(spec, key) === 'arc') {
				step.args[key] = readSteps(value, inside(key));
			}
			else if (isStepArg(value)) {
				// A number or a yes written for a text arg is its text: `"code": 417`.
				step.args[key] = TEXT_ARG_KINDS.includes(argKind(spec, key)) && (typeof value === 'number' || typeof value === 'boolean') ? String(value) : value;
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
	return parseWrappedArc(trimmed, registry);
}

/** A think tag a model leaves in its answer: `</think>`, `<redacted_thinking>`, … */
const THINK_TAG = /<\/?(?:think|thinking|thought|reasoning|redacted_thinking)>/gi;

/**
 * Arc text, or where it does not parse, the Arc a reply wraps: its pieces between think tags, the last first, each
 * without the lines of prose before and after its steps. The first piece that parses; the whole reply's error when none
 * does. Nothing is cut out of the middle of an arc: that is the longest valid prefix's to do.
 */
function parseWrappedArc(text:string, registry:VerbRegistry):Arc {
	try {
		return parseArcText(text, registry);
	}
	catch (err) {
		const pieces = text.split(THINK_TAG).map((piece) => withoutProse(piece, registry)).filter((piece) => piece && piece !== text);
		for (const piece of pieces.reverse()) {
			try {
				return parseArcText(piece, registry);
			}
			catch {
				// The next piece, or the whole reply's error.
			}
		}
		throw err;
	}
}

/**
 * `text` from its first line that starts a step (a verb, `let`) to its last that can belong to one (indented, a closer, a
 * join, `else`, or a step's own start). Empty when no line starts a step.
 */
function withoutProse(text:string, registry:VerbRegistry):string {
	const lines = text.split('\n');
	const word = (line:string):string => /^\s*([A-Za-z_]\w*)/.exec(line)?.[1] ?? '';
	const starts = (line:string):boolean => word(line) === 'let' || !!registry.find(word(line));
	const first = lines.findIndex(starts);
	if (first < 0) {
		return '';
	}
	let last = lines.length - 1;
	while (last > first && !(starts(lines[last]) || /^\s+\S|^\s*[)}&|;]|^\s*else\b/.test(lines[last]))) {
		last -= 1;
	}
	return lines.slice(first, last + 1).join('\n').trim();
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
 * with the Arc's closing brackets in it, or past any length a real one has, or arcs nested past {@link MAX_ARC_DEPTH}.
 * A model that forgets one closing quote, or loses its way in its nesting, otherwise writes on to its token limit,
 * since a reply schema lets a string hold anything and an arc nest without end.
 */
export function replyBreakdown(verbs:VerbRegistry):(piece:string)=>string | undefined {
	const specs = [...verbs.list(), ...verbs.nested().list()];
	const strict = new Set(specs.flatMap((spec) => Object.entries(argKinds(spec)).filter(([, kind]) => ['watch', 'expr', 'id'].includes(argBase(kind))).map(([key]) => key)));
	let json:boolean | undefined;
	let inString = false;
	let escaped = false;
	let current = '';
	let lastString = '';
	let afterColon = false;
	let key = '';
	let depth = 0;
	// Each bracket open: a step's verb once written, and how many arcs deep it is, as the validator counts them.
	const open:{ verb?:string; choices?:boolean; arcs:number }[] = [];
	const nests = (char:string):string | undefined => {
		const outer = open.at(-1);
		if (char === '{') {
			open.push({ arcs: outer?.arcs ?? 0, choices: afterColon && key === 'choices' });
			return undefined;
		}
		// A step's arc arg, or a choice; not one that is where its step is (`if`, `while`, a group).
		const spec = specs.find((verb) => verb.name === outer?.verb);
		const arc = !!outer?.choices || (!!spec && argKind(spec, key) === 'arc' && !opensArc({ verb: spec.name, args: {} }, key));
		const arcs = (outer?.arcs ?? 0) + (arc ? 1 : 0);
		open.push({ arcs });
		return arcs > MAX_ARC_DEPTH ? `arcs nest at most ${MAX_ARC_DEPTH} deep: write it flatter` : undefined;
	};
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
				const why = char === '{' || char === '[' ? nests(char) : undefined;
				if (why) {
					return why;
				}
				if (char === '}' || char === ']') {
					open.pop();
				}
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
				const step = open.at(-1);
				if (afterColon && key === 'verb' && step) {
					step.verb = current;
				}
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

/**
 * The root statements of an Arc text reply written to their end so far, as a reply of their own: each ends at the `)` or
 * `}` that closes it, once the token after it is written and goes on no statement: not its body, an `else`, a `while`
 * or a member.
 */
export function finishedText(reply:string):string | undefined {
	let depth = 0;
	let quote = false;
	let end:number | undefined;
	for (let i = 0; i < reply.length; i++) {
		const char = reply[i];
		if (quote) {
			quote = char !== '"' || reply[i - 1] === '\\';
			continue;
		}
		if (char === '/' && reply[i + 1] === '/') {
			i = reply.indexOf('\n', i) < 0 ? reply.length : reply.indexOf('\n', i);
			continue;
		}
		quote = char === '"';
		depth += '([{'.includes(char) ? 1 : ')]}'.includes(char) ? -1 : 0;
		if (depth !== 0 || !')}'.includes(char)) {
			continue;
		}
		const after = reply.slice(i + 1).trimStart();
		// Still the same statement: its body, an `else`, a `while`, a member, or a word yet to be written in full.
		if (/^(else\b|while\b|\.|\{)/.test(after) || (/^\w*$/.test(after) && ['else', 'while'].some((word) => word.startsWith(after)))) {
			continue;
		}
		end = i + 1;
	}
	return end === undefined ? undefined : reply.slice(0, end);
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
