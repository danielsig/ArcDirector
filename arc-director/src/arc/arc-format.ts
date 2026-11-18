import { JOIN_SYMBOL, groupArc, isArc, isCountMap, verbsInside, type Arc, type Step, type StepArg } from './arc-types.js';
import { argBase, argKinds, CHOOSE_VERB, IF_VERB, TEST_VERB, WHILE_ARG, type VerbRegistry } from './stock-verbs.js';
import { choicesOf, deriveChoiceName } from './choose.js';

/** Steps written back as Arc text that parses to the same steps (`arc-parse.ts` reads it): on one line, or in blocks. */

/** Arg kinds whose value is an expression, written as it reads. */
const EXPR_KINDS = new Set(['watch', 'expr']);

/** One line where `depth` is undefined, else block layout at that depth. */
type Depth = number | undefined;

function isBareArg(formatted:string):boolean {
	return /^-?\d+(\.\d+)?$/.test(formatted)
		|| /^[A-Za-z][A-Za-z0-9_.]*$/.test(formatted)
		|| ((formatted.startsWith('"') || formatted.startsWith("'")) && formatted.endsWith(formatted[0]));
}

/** `kind` is the arg's kind from the verb's spec: a `watch` or `expr` is written as it reads, never quoted. */
function formatArg(v:StepArg, kind:string | undefined):string {
	if (isCountMap(v)) {
		return JSON.stringify(v);
	}
	if (Array.isArray(v)) {
		return argBase(kind) === 'string[]' ? JSON.stringify(v) : v.join(',');
	}
	if (typeof v === 'string') {
		if (/[A-Za-z_][\w.]*\(/.test(v) || EXPR_KINDS.has(argBase(kind))) {
			return v;
		}
		return /[\s,"(){}:;=]/.test(v) ? JSON.stringify(v) : v;
	}
	return String(v);
}

/**
 * Arc text that parses back to the same step. A lone arg drops its `key=` only when it is the verb's first arg, which
 * is where the parser puts a positional value; without `verbs` every arg keeps its key. A verb's arc is its body; its
 * {@link WHILE_ARG} arc follows it: `go_to(Well) while say("Follow me")`, a `{ }` block for more than one step.
 */
export function formatStep(step:Step, verbs?:VerbRegistry, depth?:number):string {
	const whileArc = step.args[WHILE_ARG];
	if (isArc(whileArc)) {
		const alone = formatStep({ ...step, args: Object.fromEntries(Object.entries(step.args).filter(([key]) => key !== WHILE_ARG)) }, verbs, depth);
		const inside = verbs && verbsInside(step, verbs, WHILE_ARG);
		return `${alone} while ${whileArc.length === 1 && !whileArc[0].let ? formatStep(whileArc[0], inside, depth) : body(whileArc, inside, depth)}`;
	}
	const named = step.let ? `let ${step.let} = ` : '';
	const inner = groupArc(step);
	if (inner) {
		return `${named}(${formatAt(inner, verbs, undefined)})`;
	}
	if (step.verb === TEST_VERB) {
		return `${named}${String(step.args.watch ?? '')}`;
	}
	if (step.verb === CHOOSE_VERB) {
		return named + formatChoose(step, verbs, depth);
	}
	const spec = verbs?.get(step.verb);
	const kinds:Record<string, string> = spec ? argKinds(spec) : {};
	const inside = (key:string):VerbRegistry | undefined => verbs && verbsInside(step, verbs, key);
	const arcs = Object.keys(step.args).filter((key) => isArc(step.args[key]));
	if (step.verb === IF_VERB && isArc(step.args.cond) && isArc(step.args.arc)) {
		const els = isArc(step.args.else) ? ` else ${body(step.args.else, verbs, depth)}` : '';
		return `${named}if (${formatAt(step.args.cond, verbs, undefined)}) ${body(step.args.arc, verbs, depth)}${els}`;
	}
	const bodyKey = arcs[0];
	const keys = Object.keys(step.args).filter((key) => key !== bodyKey);
	const first = Object.keys(kinds)[0];
	const parts = keys.map((key) => {
		const value = step.args[key];
		const formatted = isArc(value) ? `(${formatAt(value, inside(key), undefined)})` : formatArg(value, kinds[key]);
		// The one arg of a verb with a body reads best bare: `command(units.filter("Guard")) { … }`.
		const bare = isBareArg(formatted) || (bodyKey !== undefined && (EXPR_KINDS.has(argBase(kinds[key])) || /^[\w.]+\(/.test(formatted)));
		return keys.length === 1 && key === first && !isArc(value) && bare ? formatted : `${key}=${formatted}`;
	});
	const call = parts.length > 0 ? `${step.verb}(${parts.join(', ')})` : bodyKey ? step.verb : `${step.verb}()`;
	return `${named}${call}${bodyKey ? ` ${body(step.args[bodyKey] as Arc, inside(bodyKey), depth)}` : ''}`;
}

/** `{ … }`: on one line, or its steps a tab deeper, one statement per line, and `}` alone at the opener's depth. */
function body(arc:Arc, verbs:VerbRegistry | undefined, depth:Depth):string {
	if (depth === undefined) {
		return `{ ${formatAt(arc, verbs, undefined)} }`;
	}
	const pad = '\t'.repeat(depth);
	return `{\n${pad}\t${formatAt(arc, verbs, depth + 1)}\n${pad}}`;
}

/** `choose("goal") { name: step … }`. On one line, a choice named as its arc would be is written bare. */
function formatChoose(step:Step, verbs:VerbRegistry | undefined, depth:Depth):string {
	const head = typeof step.args.goal === 'string' ? `choose(${JSON.stringify(step.args.goal)})` : 'choose';
	const inside = verbs?.nested();
	const choices = Object.entries(choicesOf(step)).map(([name, arc]) => {
		const statement = arc.some((s, i) => i < arc.length - 1 && s.then === 'always') ? body(arc, inside, depth === undefined ? undefined : depth + 1) : formatAt(arc, inside, depth === undefined ? undefined : depth + 1);
		// Block layout is what prompts show, and they ask for every choice named.
		return depth === undefined && name === deriveChoiceName(arc) ? statement : `${name}: ${statement}`;
	});
	if (depth === undefined) {
		return `${head} { ${choices.join(' ; ')} }`;
	}
	const pad = '\t'.repeat(depth);
	return `${head} {\n${choices.map((choice) => `${pad}\t${choice}\n`).join('')}${pad}}`;
}

export function formatArc(arc:Arc, verbs?:VerbRegistry):string {
	return formatAt(arc, verbs, undefined);
}

/**
 * Arc text in block layout: a verb's body opens `{` on its line, its steps go a tab deeper, one statement per line, and
 * its `}` stands alone at the opener's depth. Prompts show arcs this way, so a model copies a layout whose indentation
 * follows its nesting.
 */
export function formatArcBlocks(arc:Arc, verbs?:VerbRegistry):string {
	return formatAt(arc, verbs, 0);
}

function formatAt(arc:Arc, verbs:VerbRegistry | undefined, depth:Depth):string {
	return arc.map((step, i) => {
		const text = formatStep(step, verbs, depth);
		if (i === arc.length - 1) {
			return text;
		}
		const join = step.then ?? 'if_ok';
		return `${text}${depth !== undefined && join === 'always' ? `\n${'\t'.repeat(depth)}` : ` ${JOIN_SYMBOL[join]} `}`;
	}).join('');
}
