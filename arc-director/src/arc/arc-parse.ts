import { validateArc } from './validate.js';
import { ArcError, isCountMap, verbsInside, type Arc, type CountMap, type Join, type Step, type StepArg } from './arc-types.js';
import { argBase, argKinds, CHOOSE_VERB, GROUP_VERB, IF_VERB, TEST_VERB, WHILE_ARG, type VerbRegistry } from './stock-verbs.js';
import { deriveChoiceName, freeChoiceName } from './choose.js';
import { argKeys, hasVerbCall, parseProgram, type Arg, type Syntax, type VerbHooks } from '../expr/expr-parse.js';
import { ExprError, RESERVED } from '../expr/expr-types.js';

/**
 * Arc text: the one grammar (`expr/expr-parse.ts`) read into steps (`arc-format.ts` writes them back). `&&`, `||` and
 * `;` (or a new line) between statements are the steps' joins; a group `( … )` or `{ … }` is one step; a verb's body is
 * its arc arg; `A while B` is A with B as its {@link WHILE_ARG} arc; a statement that is a query, not a verb, is a
 * {@link TEST_VERB} step.
 */

/** Joins by operator, and how tightly each binds. */
const JOIN_OF:Record<string, Join> = { '&&': 'if_ok', '||': 'if_failed', ';': 'always' };

/** Query functions a statement may call though no verb has its name; any `is…`, `has…`, `was…` or `can…` too. */
const QUERY_NAMES = new Set([...RESERVED, 'distance', 'facing', 'manhattan', 'chebyshev', 'inSquare', 'doing', 'hp']);

function isQueryName(name:string):boolean {
	return QUERY_NAMES.has(name) || /^(is|has|was|can)[A-Z]/.test(name);
}

/** The args a call to `name` takes as written: its verb's, or for a shorthand ({@link VerbRegistry.findShorthand}), the rest of its verb's. */
function writtenKinds(registry:VerbRegistry, name:string):Record<string, string> | undefined {
	const spec = registry.find(name);
	if (spec) {
		return argKinds(spec);
	}
	const by = registry.findShorthand(name);
	const kinds = by && argKinds(by);
	delete kinds?.[by?.shorthandArg ?? ''];
	return kinds;
}

/** What the parser needs to know of `registry`'s verbs, nested arcs' included. */
function hooksOf(registry:VerbRegistry):VerbHooks {
	return {
		argsOf: (name) => writtenKinds(registry, name),
		takesBody: (name, args) => {
			if (name === CHOOSE_VERB) {
				return args.every((arg) => arg.name === 'goal' || (arg.name === undefined && (arg.value.type === 'lit' || arg.value.type === 'text')));
			}
			const kinds = writtenKinds(registry, name) ?? {};
			const given = new Set(argKeys(kinds, args));
			return Object.entries(kinds).some(([key, kind]) => kind === 'arc' && !given.has(key));
		},
		anyNamed: (name) => name === CHOOSE_VERB,
		isVerb: (name) => !!registry.find(name),
	};
}

export function parseArcText(text:string, registry:VerbRegistry):Arc {
	let syntax:Syntax | undefined;
	try {
		syntax = parseProgram(text, hooksOf(registry));
	}
	catch (err) {
		throw err instanceof ExprError ? new ArcError(err.message) : err;
	}
	if (!syntax) {
		throw new ArcError('expected verb');
	}
	const arc = new Reader(text).chain(syntax, registry);
	validateArc(arc, registry);
	return arc;
}

/** Steps from a parsed program. `cond`: a call to a name that is no verb is a query (an `if`'s condition). */
class Reader {
	constructor(private readonly _src:string) {}

	/** How `node` was written. */
	private text(node:Syntax):string {
		return this._src.slice(node.from, node.to).trim();
	}

	/** `node` as steps: `&&`, `||` and `;` are joins, as the parser ranked them. */
	public chain(node:Syntax, verbs:VerbRegistry, cond = false):Arc {
		const out:Step[] = [];
		this.flatten(node, verbs, cond, out);
		return out;
	}

	private flatten(node:Syntax, verbs:VerbRegistry, cond:boolean, out:Step[]):void {
		if (node.type === 'binary' && JOIN_OF[node.op]) {
			this.flatten(node.left, verbs, cond, out);
			const join = JOIN_OF[node.op];
			if (join !== 'if_ok') {
				out[out.length - 1].then = join;
			}
			this.flatten(node.right, verbs, cond, out);
			return;
		}
		out.push(this.step(node, verbs, cond));
	}

	private step(node:Syntax, verbs:VerbRegistry, cond:boolean):Step {
		switch (node.type) {
			case 'binary':
				return node.op === 'while' ? this.whileStep(node.left, node.right, verbs, cond) : this.test(node, verbs);
			case 'paren':
				return { verb: GROUP_VERB, args: { arc: this.chain(node.expr, verbs, cond) } };
			case 'block':
				if (!node.body) {
					throw new ArcError('{ } contains no step');
				}
				return { verb: GROUP_VERB, args: { arc: this.chain(node.body, verbs, cond) } };
			case 'let':
				return this.let(node.name, node.value, verbs);
			case 'label':
				throw new ArcError(`${node.name}: names a choice, inside choose("goal") { … } only`);
			case 'call': {
				const name = node.callee.type === 'ident' || node.callee.type === 'member' ? node.callee.name : '';
				if (verbs.find(name)) {
					return this.verb(node, name, verbs);
				}
				const by = verbs.findShorthand(name);
				if (by) {
					return this.verb(node, by.name, verbs, name);
				}
				if (!cond && !isQueryName(name)) {
					throw new ArcError(`unknown verb '${name}'`, name);
				}
				return this.test(node, verbs);
			}
			case 'lit':
			case 'text':
			case 'array':
			case 'object':
				if (cond) {
					return this.test(node, verbs);
				}
				throw new ArcError(`${this.text(node)} alone is not a step${node.type === 'lit' && node.value.kind === 'string' ? ': say("…") speaks a line' : ''}`);
			case 'ident':
				// A lone name is a test of a name this arc gave (`let picked`); a capitalized one is a thing, not a step.
				if (/^[A-Z]/.test(node.name) && !cond) {
					throw new ArcError(`${node.name} alone is not a step: give it to a verb, as in go_to(${node.name})`);
				}
				return this.test(node, verbs);
			default:
				return this.test(node, verbs);
		}
	}

	/** `A while B`: step A with B's steps as its {@link WHILE_ARG} arc. */
	private whileStep(a:Syntax, b:Syntax, verbs:VerbRegistry, cond:boolean):Step {
		const step = this.step(a, verbs, cond);
		if (WHILE_ARG in step.args) {
			throw new ArcError('a step takes one `while`: join more with `A while B while C`');
		}
		return { ...step, args: { ...step.args, [WHILE_ARG]: this.chain(b.type === 'block' ? b.body ?? b : b, verbs, cond) } };
	}

	/** A statement that asks rather than acts: it succeeds while it is true. */
	private test(node:Syntax, verbs:VerbRegistry):Step {
		if (hasVerbCall(node, hooksOf(verbs))) {
			throw new ArcError(`${this.text(node)}: a verb inside an expression; join steps with &&, || or ;, or branch with if`);
		}
		return { verb: TEST_VERB, args: { watch: this.text(node) } };
	}

	/** `let name = step`: the step, named. A chain is one step, its group. */
	private let(name:string, value:Syntax, verbs:VerbRegistry):Step {
		const arc = this.chain(value, verbs);
		const step = arc.length === 1 && !arc[0].let ? arc[0] : { verb: GROUP_VERB, args: { arc } };
		return { ...step, let: name };
	}

	/** Step `name` as `node` calls it; `shorthand`, the name it was called by in its stead ({@link VerbDef.shorthandArg}: `sob("…")`). */
	private verb(node:Syntax & { type:'call' }, name:string, verbs:VerbRegistry, shorthand?:string):Step {
		const spec = verbs.find(name)!;
		// Method syntax is call syntax: `Wolf.attack()` is `attack(Wolf)`.
		const written:Arg[] = node.callee.type === 'member' ? [{ value: node.callee.recv }, ...node.args] : node.args;
		if (name === CHOOSE_VERB) {
			return this.choose(written, node.body, verbs.nested());
		}
		const kinds = argKinds(spec);
		const keys = argKeys(writtenKinds(verbs, shorthand ?? name)!, written);
		const args:Record<string, StepArg> = shorthand === undefined ? {} : { [spec.shorthandArg!]: shorthand };
		const put = (key:string | undefined, value:Syntax, cond = false):void => {
			if (key === undefined) {
				throw new ArcError(`verb '${name}' got an unexpected positional arg`);
			}
			// `scream("Help!", as=scream)` says it twice alike: once.
			if (shorthand !== undefined && key === spec.shorthandArg && this.text(value).replace(/^["']|["']$/g, '') === shorthand) {
				return;
			}
			if (key in args) {
				throw new ArcError(`${name}(...) got ${key}= twice; give it once`);
			}
			args[key] = this.value(value, kinds[key], key, verbsInside({ verb: name, args }, verbs, key), cond || (name === IF_VERB && key === 'cond'));
		};
		written.forEach((arg, n) => put(keys[n], arg.value));
		// The body fills its first arc not given.
		if (node.body) {
			const key = Object.keys(kinds).find((k) => argBase(kinds[k]) === 'arc' && !(k in args));
			if (!key) {
				throw new ArcError(`${name} has its arc already: give it no { } body`);
			}
			put(key, node.body);
		}
		if (node.else) {
			put('else' in spec.args ? 'else' : undefined, node.else);
		}
		return { verb: name, args };
	}

	/** `choose("goal") { name: step … }`, or the old `choose("goal", name=arc, arc, …)`. Unnamed choices are named after their first verb. */
	private choose(written:readonly Arg[], body:Syntax | undefined, verbs:VerbRegistry):Step {
		let goal:string | undefined;
		const rows:{ name?:string; arc:Arc }[] = [];
		const add = (name:string | undefined, node:Syntax):void => {
			if (name !== undefined && rows.some((row) => row.name === name)) {
				throw new ArcError(`choose has two choices named '${name}'`);
			}
			rows.push({ name, arc: this.chain(node.type === 'block' ? node.body ?? node : node, verbs) });
		};
		for (const arg of written) {
			const prose = arg.value.type === 'text' || (arg.value.type === 'lit' && arg.value.value.kind === 'string');
			if (arg.name === 'goal' || (arg.name === undefined && prose && goal === undefined && rows.length === 0)) {
				if (goal !== undefined) {
					throw new ArcError('choose has two goals');
				}
				const value = arg.value.type === 'text' || arg.value.type === 'lit' ? this.value(arg.value, 'text', 'goal', verbs) : undefined;
				if (typeof value !== 'string') {
					throw new ArcError('choose goal must be text');
				}
				goal = value;
				continue;
			}
			add(arg.name, arg.value);
		}
		for (const statement of body?.type === 'block' ? statements(body.body) : statements(body)) {
			if (statement.type === 'label') {
				add(statement.name, statement.body);
			}
			else {
				add(undefined, statement);
			}
		}
		const taken = new Set(rows.flatMap((row) => (row.name ? [row.name] : [])));
		const args:Record<string, StepArg> = goal === undefined ? {} : { goal };
		for (const row of rows) {
			const name = row.name ?? freeChoiceName(deriveChoiceName(row.arc), taken);
			taken.add(name);
			args[name] = row.arc;
		}
		return { verb: CHOOSE_VERB, args };
	}

	/** One arg's value, read for its `kind`. */
	private value(node:Syntax, kind:string | undefined, key:string, inside:VerbRegistry, cond = false):StepArg {
		const base = argBase(kind);
		const literal = node.type === 'lit' ? node.value : undefined;
		if (base === 'arc') {
			return this.chain(node.type === 'paren' || node.type === 'block' ? (node.type === 'paren' ? node.expr : node.body ?? node) : node, inside, cond);
		}
		if (literal?.kind === 'string' || node.type === 'text') {
			const text = node.type === 'text' ? node.value : (literal as { value:string }).value;
			return base === 'string[]' ? asStringArray(text) : base === 'bundle' ? asBundle(readJson(text), key) : text;
		}
		const number = numberOf(node);
		if (base === 'number' && number !== undefined) {
			return number;
		}
		// A duration keeps its unit, so seconds and rounds stay apart: `10s`, `2`.
		if (base === 'duration' && number !== undefined) {
			const raw = this.text(node);
			return /\d$/.test(raw) ? number : raw;
		}
		if ((base === 'duration' || base === 'bool') && literal?.kind === 'bool') {
			return literal.value;
		}
		if (base === 'string[]') {
			return asStringArray(node.type === 'array' ? node.items.map((item) => (item.type === 'lit' && item.value.kind === 'string' ? item.value.value : this.text(item))) : this.text(node));
		}
		if (base === 'bundle') {
			return asBundle(node.type === 'object' ? this.counts(node.entries, key) : readJson(this.text(node)), key);
		}
		// What is not text by kind is read as its literal: an arg no verb has fails validation by its own name.
		if (!kind && literal && (literal.kind === 'number' || literal.kind === 'bool')) {
			return literal.value;
		}
		return this.text(node);
	}

	private counts(entries:readonly { key:string; value:Syntax }[], key:string):CountMap {
		const out:CountMap = {};
		for (const entry of entries) {
			const count = numberOf(entry.value);
			if (count === undefined) {
				throw new ArcError(`${key} is {"Egg":12, "Milk":3}`);
			}
			out[entry.key] = count;
		}
		return out;
	}
}

/** A number written as one: `5`, `-1`, `20s`. */
function numberOf(node:Syntax):number | undefined {
	if (node.type === 'lit' && node.value.kind === 'number') {
		return node.value.value;
	}
	const inner = node.type === 'unary' && node.op === '-' ? numberOf(node.expr) : undefined;
	return inner === undefined ? undefined : -inner;
}

/** The statements of a body joined by `;` or new lines. */
function statements(node:Syntax | undefined):Syntax[] {
	if (!node) {
		return [];
	}
	return node.type === 'binary' && node.op === ';' ? [...statements(node.left), ...statements(node.right)] : [node];
}

/** `{"Egg":12, "Milk":3}`. */
function asBundle(value:unknown, key:string):CountMap {
	if (isCountMap(value)) {
		return value;
	}
	throw new ArcError(`${key} is {"Egg":12, "Milk":3}`);
}

function readJson(raw:string):unknown {
	try {
		return JSON.parse(raw);
	}
	catch {
		throw new ArcError(`cannot read ${raw}`);
	}
}

/** `["5 Egg", "Loaf"]`, or one bare line such as `5 Egg`. */
function asStringArray(value:string | string[]):string[] {
	if (Array.isArray(value)) {
		return value;
	}
	const raw = value.trim();
	if (!raw.startsWith('[')) {
		return raw ? [raw] : [];
	}
	const parsed = readJson(raw);
	if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
		throw new ArcError('a list arg is strings, as ["5 Egg", "Loaf"]');
	}
	return parsed;
}
