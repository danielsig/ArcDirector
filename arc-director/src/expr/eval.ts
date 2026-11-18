import { parse } from './expr-parse.js';
import {
	ABSENT,
	asBool,
	asNum,
	capList,
	entityName,
	ExprError,
	isTruthy,
	LIST_CAP,
	leftoverEnglishHint,
	needleMatch,
	type Ast,
	type Catalog,
	type EvalCtx,
	type ExprEntity,
	type ExprVal,
	type NativeFn,
} from './expr-types.js';

function listCapOf(ctx:EvalCtx):number {
	return ctx.catalog.listCap ?? LIST_CAP;
}

const RELATIONS = new Set([
	'distance', 'isNear', 'isReachable', 'isApproaching', 'isDeparting', 'hasSightline',
	'isFacing', 'isBehind', 'isLeft', 'isRight', 'facing', 'wasJustFacing', 'hasJustSeen', 'hasLostSight',
	'manhattan', 'chebyshev', 'inSquare',
]);

function identLookup(name:string, ctx:EvalCtx):ExprVal {
	const local = ctx.env.get(name);
	if (local) {
		return local;
	}
	const bound = ctx.catalog.names.get(name);
	if (bound) {
		return bound;
	}
	if (ctx.catalog.fns.has(name)) {
		return { kind: 'fn', name };
	}
	const watched = watchValue(name, ctx.catalog);
	if (watched) {
		return watched;
	}
	const leftover = leftoverEnglishHint(name, catalogEntities(ctx.catalog));
	if (leftover) {
		throw new ExprError(leftover);
	}
	return inferTypeList(name, ctx) ?? ABSENT;
}

/**
 * A watch's current value, where `name` is a watch's and no entity's: an entity's name means that entity in every
 * expression and verb arg, so a watch cannot take it over. Read without its own name, so a watch that names itself, or
 * two that name each other, end there. Absent from a watch that does not evaluate.
 */
function watchValue(name:string, catalog:Catalog):ExprVal | undefined {
	const expr = catalog.watches && Object.hasOwn(catalog.watches, name) ? catalog.watches[name] : undefined;
	if (expr === undefined || catalogEntities(catalog).some((e) => needleMatch(e, name))) {
		return undefined;
	}
	const rest = { ...catalog.watches };
	delete rest[name];
	const r = evaluate(expr, { ...catalog, watches: rest });
	return r.error ? ABSENT : r.value;
}

/** Every entity in the catalog's landmarks, items, others, and units. */
export function catalogEntities(catalog:Catalog):ExprEntity[] {
	const out:ExprEntity[] = [];
	const seen = new Set<string>();
	for (const key of ['landmarks', 'items', 'others', 'units'] as const) {
		const bound = catalog.names.get(key);
		if (bound?.kind !== 'list') {
			continue;
		}
		for (const row of bound.value) {
			if (row.kind !== 'entity' || seen.has(row.value.id)) {
				continue;
			}
			seen.add(row.value.id);
			out.push(row.value);
		}
	}
	return out;
}

/** Unbound `Tree` is the landmark/item list that matches that type, not reachable with go_to. */
function inferTypeList(name:string, ctx:EvalCtx):ExprVal | undefined {
	if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
		return undefined;
	}
	const lower = name.charAt(0).toLowerCase() + name.slice(1);
	const needles = lower === name ? [name] : [name, lower];
	const out:ExprVal[] = [];
	const seen = new Set<string>();
	// Its own name is `me`, with every field it has, not its bare line in `units`.
	const me = ctx.catalog.me;
	if (me && needles.some((n) => needleMatch(me, n))) {
		seen.add(me.id);
		out.push({ kind: 'entity', value: me });
	}
	for (const key of ['landmarks', 'items', 'others', 'units'] as const) {
		const bound = ctx.catalog.names.get(key);
		if (bound?.kind !== 'list') {
			continue;
		}
		for (const row of bound.value) {
			if (row.kind !== 'entity') {
				continue;
			}
			const e = row.value;
			if (seen.has(e.id)) {
				continue;
			}
			if (needles.some((n) => needleMatch(e, n))) {
				seen.add(e.id);
				out.push(row);
			}
		}
	}
	if (out.length === 0) {
		return undefined;
	}
	const cap = listCapOf(ctx);
	return { kind: 'list', value: out.length > cap ? out.slice(0, cap) : out };
}

function asEntity(v:ExprVal):ExprEntity | undefined {
	return v.kind === 'entity' ? v.value : undefined;
}

/** `fn` was not given a list. A value that is not there now may be one later; anything else never will. */
function needsList(fn:string, arg:ExprVal | undefined):ExprError {
	return new ExprError(`${fn} needs a list`, !arg || arg.kind === 'absent' ? 'typeError' : 'misuse');
}

function asList(v:ExprVal):ExprVal[] | undefined {
	return v.kind === 'list' ? v.value : undefined;
}

function sameVal(a:ExprVal, b:ExprVal):boolean {
	if (a.kind === 'absent' && b.kind === 'absent') {
		return true;
	}
	if (a.kind === 'bool' && b.kind === 'bool') {
		return a.value === b.value;
	}
	if (a.kind === 'number' && b.kind === 'number') {
		return a.value === b.value;
	}
	if (a.kind === 'string' && b.kind === 'string') {
		return a.value === b.value;
	}
	if (a.kind === 'entity' && b.kind === 'entity') {
		return a.value.id === b.value.id;
	}
	return false;
}

function isNeedle(e:ExprEntity, v:ExprVal):boolean {
	if (v.kind === 'string') {
		return needleMatch(e, v.value);
	}
	if (v.kind === 'entity') {
		return e.id === v.value.id;
	}
	return false;
}

/** `recv.name`. A name picks a list, so a list of one entity reads as that entity: `Tom.hp` is Tom's hp. */
function fieldOf(recv:ExprVal, name:string, ctx:EvalCtx):ExprVal {
	if (recv.kind === 'absent') {
		return ABSENT;
	}
	if (recv.kind === 'list' && recv.value.length === 1 && recv.value[0].kind === 'entity') {
		return fieldOf(recv.value[0], name, ctx);
	}
	if (recv.kind === 'entity') {
		const f = recv.value.fields?.[name];
		if (f) {
			return f;
		}
		if (name === 'id') {
			return { kind: 'string', value: recv.value.id };
		}
		if (name === 'name') {
			return { kind: 'string', value: entityName(recv.value) };
		}
		if (name === 'tags') {
			return {
				kind: 'list',
				value: recv.value.tags.map((t) => ({ kind: 'string' as const, value: t })),
			};
		}
		if (ctx.catalog.fns.has(name)) {
			throw new ExprError(`'${name}' needs a call`, 'fieldCall');
		}
		return ABSENT;
	}
	if (recv.kind === 'list' && ctx.catalog.fns.has(name)) {
		throw new ExprError(`'${name}' needs a call`, 'fieldCall');
	}
	return ABSENT;
}

/**
 * Functions `src` calls by name that `catalog` does not have. A call to one throws whenever it is reached, so a watch
 * holding one can never hold. Methods (`others.filter(...)`) are not names. `[]` when `src` does not parse.
 */
export function unboundCalls(src:string, catalog:Catalog):string[] {
	const out = new Set<string>();
	const walk = (ast:Ast):void => {
		switch (ast.type) {
			case 'call':
				if (ast.callee.type === 'ident' && !catalog.fns.has(ast.callee.name)) {
					out.add(ast.callee.name);
				}
				walk(ast.callee);
				ast.args.forEach(walk);
				return;
			case 'array':
				ast.items.forEach(walk);
				return;
			case 'unary':
				walk(ast.expr);
				return;
			case 'binary':
				walk(ast.left);
				walk(ast.right);
				return;
			case 'ternary':
				[ast.cond, ast.then, ast.else].forEach(walk);
				return;
			case 'member':
				walk(ast.recv);
				return;
			case 'lambda':
				walk(ast.body);
		}
	};
	try {
		walk(parse(src).ast);
	}
	catch {
		return [];
	}
	return [...out];
}

function callFn(name:string, args:ExprVal[], ctx:EvalCtx):ExprVal {
	const fn = ctx.catalog.fns.get(name);
	if (!fn) {
		throw new ExprError(`unbound '${name}'`);
	}
	let use = args;
	if (RELATIONS.has(name) && args.length === 1) {
		use = [args[0], { kind: 'entity', value: ctx.catalog.me }];
	}
	if (name === 'isCarrying' && args.length === 2 && asEntity(args[1])?.id === ctx.catalog.me.id) {
		use = [args[0]];
	}
	return fn(use, ctx);
}

function evalAst(ast:Ast, ctx:EvalCtx):ExprVal {
	switch (ast.type) {
		case 'lit':
			return ast.value;
		case 'ident':
			return identLookup(ast.name, ctx);
		case 'array': {
			const items = ast.items.map((x) => evalAst(x, ctx));
			return capList(items, listCapOf(ctx));
		}
		case 'lambda':
			return { kind: 'lambda', params: ast.params, body: ast.body };
		case 'unary': {
			const v = evalAst(ast.expr, ctx);
			if (ast.op === '!') {
				return { kind: 'bool', value: !asBool(v) };
			}
			const n = asNum(v);
			if (n === undefined) {
				throw new ExprError('unary needs a number');
			}
			return { kind: 'number', value: ast.op === '-' ? -n : n };
		}
		case 'binary':
			return evalBinary(ast.op, ast.left, ast.right, ctx);
		case 'ternary':
			return asBool(evalAst(ast.cond, ctx)) ? evalAst(ast.then, ctx) : evalAst(ast.else, ctx);
		case 'member': {
			const recv = evalAst(ast.recv, ctx);
			if (recv.kind === 'absent') {
				return ABSENT;
			}
			return fieldOf(recv, ast.name, ctx);
		}
		case 'call': {
			if (ast.callee.type === 'ident') {
				const args = ast.args.map((a) => evalAst(a, ctx));
				return callFn(ast.callee.name, args, ctx);
			}
			const callee = evalAst(ast.callee, ctx);
			if (callee.kind === 'fn') {
				const args = ast.args.map((a) => evalAst(a, ctx));
				return callFn(callee.name, args, ctx);
			}
			if (callee.kind === 'lambda') {
				return applyLambda(callee, ast.args.map((a) => evalAst(a, ctx)), ctx);
			}
			if (callee.kind === 'absent') {
				throw new ExprError('unbound call');
			}
			throw new ExprError('not a function', 'misuse');
		}
	}
}

function evalBinary(op:string, leftAst:Ast, rightAst:Ast, ctx:EvalCtx):ExprVal {
	if (op === '??') {
		const left = evalAst(leftAst, ctx);
		return left.kind === 'absent' ? evalAst(rightAst, ctx) : left;
	}
	const left = evalAst(leftAst, ctx);
	const right = evalAst(rightAst, ctx);
	if (op === '==') {
		if (left.kind === 'absent' || right.kind === 'absent') {
			return { kind: 'bool', value: left.kind === 'absent' && right.kind === 'absent' };
		}
		return { kind: 'bool', value: sameVal(left, right) };
	}
	if (op === '!=') {
		if (left.kind === 'absent' || right.kind === 'absent') {
			return { kind: 'bool', value: !(left.kind === 'absent' && right.kind === 'absent') };
		}
		return { kind: 'bool', value: !sameVal(left, right) };
	}
	if (op === 'is') {
		const e = asEntity(left);
		if (!e) {
			return { kind: 'bool', value: false };
		}
		return { kind: 'bool', value: isNeedle(e, right) };
	}
	if (op === '&&' || op === '||') {
		return logic(op, left, right);
	}
	if (op === '+' || op === '-' || op === '*' || op === '/' || op === '<' || op === '>' || op === '<=' || op === '>=') {
		const a = asNum(left);
		const b = asNum(right);
		if (a === undefined || b === undefined) {
			throw new ExprError('arithmetic needs numbers');
		}
		if (op === '/') {
			if (b === 0) {
				throw new ExprError('division by zero');
			}
			const q = a / b;
			if (!Number.isFinite(q)) {
				throw new ExprError('division overflow');
			}
			return { kind: 'number', value: q };
		}
		if (op === '+') {
			return { kind: 'number', value: a + b };
		}
		if (op === '-') {
			return { kind: 'number', value: a - b };
		}
		if (op === '*') {
			return { kind: 'number', value: a * b };
		}
		if (op === '<') {
			return { kind: 'bool', value: a < b };
		}
		if (op === '>') {
			return { kind: 'bool', value: a > b };
		}
		if (op === '<=') {
			return { kind: 'bool', value: a <= b };
		}
		return { kind: 'bool', value: a >= b };
	}
	throw new ExprError(`unknown op ${op}`);
}

/** A thing found holds, and nothing found does not (`some(others) && …`); any other value is itself. */
function asLogic(v:ExprVal):ExprVal {
	return v.kind === 'entity' || v.kind === 'absent' ? { kind: 'bool', value: isTruthy(v) } : v;
}

function logic(op:'&&' | '||', l:ExprVal, r:ExprVal):ExprVal {
	const [left, right] = [asLogic(l), asLogic(r)];
	const ln = left.kind === 'number' || left.kind === 'bool';
	const rn = right.kind === 'number' || right.kind === 'bool';
	if (!ln || !rn) {
		throw new ExprError('&& / || need bools or numbers');
	}
	const lb = left.kind === 'bool';
	const rb = right.kind === 'bool';
	if (lb !== rb) {
		throw new ExprError('mixed && / ||', 'misuse');
	}
	if (lb && rb) {
		const a = (left as { kind:'bool'; value:boolean }).value;
		const b = (right as { kind:'bool'; value:boolean }).value;
		return { kind: 'bool', value: op === '&&' ? a && b : a || b };
	}
	const a = asNum(left)!;
	const b = asNum(right)!;
	return { kind: 'number', value: op === '&&' ? Math.min(a, b) : Math.max(a, b) };
}

function applyLambda(fn:Extract<ExprVal, { kind:'lambda' }>, args:ExprVal[], ctx:EvalCtx):ExprVal {
	const env = new Map(ctx.env);
	for (let i = 0; i < fn.params.length; i++) {
		env.set(fn.params[i], args[i] ?? ABSENT);
	}
	return evalAst(fn.body, { ...ctx, env });
}

function predOrNeedle(list:ExprVal[], arg:ExprVal | undefined, ctx:EvalCtx):ExprVal[] {
	if (!arg) {
		return list.filter(isTruthy);
	}
	if (arg.kind === 'string') {
		return list.filter((x) => x.kind === 'entity' && needleMatch(x.value, arg.value));
	}
	if (arg.kind === 'lambda') {
		return list.filter((x) => {
			const r = applyLambda(arg, [x], ctx);
			if (r.kind === 'number') {
				return r.value > 0;
			}
			return asBool(r);
		});
	}
	throw new ExprError('predicate or needle expected');
}

/** The rows of `list` that `arg` picks, a predicate or a needle; without one, those that hold (a number above 0). */
function picked(list:ExprVal[], arg:ExprVal | undefined, ctx:EvalCtx):ExprVal[] {
	return arg ? predOrNeedle(list, arg, ctx) : list.filter((x) => (x.kind === 'number' ? x.value > 0 : isTruthy(x)));
}

export const builtins:Record<string, NativeFn> = {
	/** `!x`, for models that write it as a word. */
	not(args) {
		return { kind: 'bool', value: !asBool(args[0] ?? ABSENT) };
	},
	clamp(args) {
		const n = asNum(args[0]);
		if (n === undefined) {
			throw new ExprError('clamp needs a number');
		}
		return { kind: 'number', value: Math.min(1, Math.max(0, n)) };
	},
	softClamp(args) {
		const n = asNum(args[0]);
		if (n === undefined) {
			throw new ExprError('softClamp needs a number');
		}
		if (n <= 0) {
			return { kind: 'number', value: 0 };
		}
		return { kind: 'number', value: n / (n + 0.5) };
	},
	map(args, ctx) {
		const list = asList(args[0]);
		const fn = args[1];
		if (!list || fn?.kind !== 'lambda') {
			throw new ExprError('map(list, fn)');
		}
		return capList(list.map((x) => applyLambda(fn, [x], ctx)), listCapOf(ctx));
	},
	filter(args, ctx) {
		const list = asList(args[0]);
		if (!list) {
			throw needsList('filter', args[0]);
		}
		return capList(predOrNeedle(list, args[1], ctx), listCapOf(ctx));
	},
	find(args, ctx) {
		const list = asList(args[0]);
		if (!list) {
			throw needsList('find', args[0]);
		}
		const hit = predOrNeedle(list, args[1], ctx)[0];
		return hit ?? ABSENT;
	},
	findLast(args, ctx) {
		const list = asList(args[0]);
		if (!list) {
			throw needsList('findLast', args[0]);
		}
		const rows = predOrNeedle(list, args[1], ctx);
		return rows[rows.length - 1] ?? ABSENT;
	},
	includes(args) {
		const list = asList(args[0]);
		const x = args[1];
		if (!list) {
			throw needsList('includes', args[0]);
		}
		if (x.kind === 'string' && list.every((i) => i.kind === 'entity' || i.kind === 'absent')) {
			return { kind: 'bool', value: list.some((i) => i.kind === 'entity' && needleMatch(i.value, x.value)) };
		}
		return { kind: 'bool', value: list.some((i) => sameVal(i, x)) };
	},
	first(args) {
		const list = asList(args[0]);
		if (!list) {
			throw needsList('first', args[0]);
		}
		return list[0] ?? ABSENT;
	},
	/** The first `n` of a list: `units.filter("Worker").take(5)`. */
	take(args) {
		const list = asList(args[0]);
		const n = asNum(args[1]);
		if (!list || n === undefined) {
			throw new ExprError('take(list, n)');
		}
		return { kind: 'list', value: list.slice(0, Math.max(0, Math.floor(n))) };
	},
	sortBy(args, ctx) {
		const list = asList(args[0]);
		const fn = args[1];
		if (!list || fn?.kind !== 'lambda') {
			throw new ExprError('sortBy(list, fn)');
		}
		const keyed = list.map((x) => ({ x, k: asNum(applyLambda(fn, [x], ctx)) ?? 0 }));
		keyed.sort((a, b) => a.k - b.k);
		return capList(keyed.map((r) => r.x), listCapOf(ctx));
	},
	max(args, ctx) {
		return extrema(keyed(args, ctx), true);
	},
	min(args, ctx) {
		return extrema(keyed(args, ctx), false);
	},
	maxBy(args, ctx) {
		return byExtrema(args, ctx, true);
	},
	minBy(args, ctx) {
		return byExtrema(args, ctx, false);
	},
	sum(args, ctx) {
		const nums = numsOf(keyed(args, ctx));
		return { kind: 'number', value: nums.reduce((a, b) => a + b, 0) };
	},
	avg(args, ctx) {
		const nums = numsOf(keyed(args, ctx));
		if (nums.length === 0) {
			throw new ExprError('avg of empty');
		}
		return { kind: 'number', value: nums.reduce((a, b) => a + b, 0) / nums.length };
	},
	count(args, ctx) {
		const list = asList(args[0]);
		if (!list) {
			throw needsList('count', args[0]);
		}
		if (!args[1]) {
			return { kind: 'number', value: list.length };
		}
		return { kind: 'number', value: predOrNeedle(list, args[1], ctx).length };
	},
	reduce(args, ctx) {
		const list = asList(args[0]);
		const fn = args[2];
		if (!list || fn?.kind !== 'lambda') {
			throw new ExprError('reduce(list, init, fn)');
		}
		let acc = args[1] ?? ABSENT;
		for (const x of list) {
			acc = applyLambda(fn, [acc, x], ctx);
		}
		return acc;
	},
	some(args, ctx) {
		const list = asList(args[0]);
		if (!list) {
			throw needsList('some', args[0]);
		}
		// The first thing that matches, nearest first in a list that is, so it names a thing as well as it tests.
		const hit = picked(list, args[1], ctx)[0];
		return !hit ? ABSENT : hit.kind === 'entity' ? hit : { kind: 'bool', value: true };
	},
	all(args, ctx) {
		const list = asList(args[0]);
		if (!list) {
			throw needsList('all', args[0]);
		}
		return { kind: 'bool', value: picked(list, args[1], ctx).length === list.length };
	},
	matches(args) {
		const text = stringOf(args[0]);
		const pat = stringOf(args[1]);
		if (text === undefined || pat === undefined) {
			throw new ExprError('matches(text, pattern)');
		}
		return { kind: 'bool', value: new RegExp(pat, 'i').test(text) };
	},
	search(args) {
		const text = stringOf(args[0]);
		const pat = stringOf(args[1]);
		if (text === undefined || pat === undefined) {
			throw new ExprError('search(text, pattern)');
		}
		return { kind: 'number', value: text.search(new RegExp(pat, 'i')) };
	},
};

function stringOf(v:ExprVal | undefined):string | undefined {
	if (!v) {
		return undefined;
	}
	if (v.kind === 'string') {
		return v.value;
	}
	if (v.kind === 'entity') {
		return entityName(v.value);
	}
	return undefined;
}

function numsOf(args:ExprVal[]):number[] {
	if (args.length === 1 && args[0].kind === 'list') {
		return args[0].value.map((x) => {
			const n = asNum(x);
			if (n === undefined) {
				throw new ExprError('numeric list');
			}
			return n;
		});
	}
	return args.map((x) => {
		const n = asNum(x);
		if (n === undefined) {
			throw new ExprError('numeric args');
		}
		return n;
	});
}

/**
 * `list.min(u => u.hp)` as the numbers it picks from: with a function, the list's items through it; else the args as
 * they are. An empty list through a function is nothing, not an error: no one there has a lowest.
 */
function keyed(args:ExprVal[], ctx:EvalCtx):ExprVal[] {
	const list = args.length === 2 && args[1].kind === 'lambda' ? asList(args[0]) : undefined;
	if (!list) {
		return args;
	}
	const fn = args[1];
	return [{ kind: 'list', value: list.map((x) => applyLambda(fn as Extract<ExprVal, { kind:'lambda' }>, [x], ctx)) }];
}

function extrema(args:ExprVal[], hi:boolean):ExprVal {
	const nums = numsOf(args);
	if (nums.length === 0) {
		if (args.length === 1 && args[0].kind === 'list') {
			return ABSENT;
		}
		throw new ExprError('empty extrema');
	}
	return { kind: 'number', value: hi ? Math.max(...nums) : Math.min(...nums) };
}

function byExtrema(args:ExprVal[], ctx:EvalCtx, hi:boolean):ExprVal {
	const list = asList(args[0]);
	const fn = args[1];
	if (!list || fn?.kind !== 'lambda') {
		throw new ExprError('maxBy/minBy(list, fn)');
	}
	if (list.length === 0) {
		return ABSENT;
	}
	// What has no such number is passed over, as a door among the foes has no hp; only a key nothing has is an error.
	let best:ExprVal | undefined;
	let bestK = 0;
	for (const item of list) {
		const k = asNum(applyLambda(fn, [item], ctx));
		if (k !== undefined && (best === undefined || (hi ? k > bestK : k < bestK))) {
			best = item;
			bestK = k;
		}
	}
	if (best === undefined) {
		throw new ExprError('key is not a number');
	}
	return best;
}

export type EvalResult = {
	value:ExprVal;
	error?:ExprError;
};

export function evaluate(expr:string, catalog:Catalog):EvalResult {
	try {
		const { ast } = parse(expr);
		const ctx:EvalCtx = { catalog, env: new Map(), nodes: 0 };
		const value = evalAst(ast, ctx);
		if (value.kind === 'list' && value.value.length > (catalog.listCap ?? LIST_CAP)) {
			throw new ExprError('list cap', 'capTie');
		}
		return { value };
	}
	catch (err) {
		const error = err instanceof ExprError ? err : new ExprError(err instanceof Error ? err.message : String(err));
		return { value: ABSENT, error };
	}
}
