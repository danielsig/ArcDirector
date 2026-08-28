import { parse } from './parse.js';
import {
	ABSENT,
	asBool,
	asNum,
	capList,
	entityName,
	ExprError,
	isTruthy,
	LIST_CAP,
	needleMatch,
	type Ast,
	type Catalog,
	type EvalCtx,
	type ExprEntity,
	type ExprVal,
	type NativeFn,
} from './types.js';

const RELATIONS = new Set([
	'distance', 'isNear', 'isApproaching', 'isDeparting', 'hasSightline',
	'isFacing', 'isBehind', 'facing', 'wasJustFacing', 'hasJustSeen', 'hasLostSight',
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
	return ABSENT;
}

function asEntity(v:ExprVal):ExprEntity | undefined {
	return v.kind === 'entity' ? v.value : undefined;
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

function fieldOf(recv:ExprVal, name:string, ctx:EvalCtx):ExprVal {
	if (recv.kind === 'absent') {
		return ABSENT;
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
			return capList(items);
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
			throw new ExprError('not a function');
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

function logic(op:'&&' | '||', left:ExprVal, right:ExprVal):ExprVal {
	const ln = left.kind === 'number' || left.kind === 'bool';
	const rn = right.kind === 'number' || right.kind === 'bool';
	if (!ln || !rn) {
		throw new ExprError('&& / || need bools or numbers');
	}
	const lb = left.kind === 'bool';
	const rb = right.kind === 'bool';
	if (lb !== rb) {
		throw new ExprError('mixed && / ||');
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

export function applyLambda(fn:Extract<ExprVal, { kind:'lambda' }>, args:ExprVal[], ctx:EvalCtx):ExprVal {
	const env = new Map(ctx.env);
	for (let i = 0; i < fn.params.length; i++) {
		env.set(fn.params[i], args[i] ?? ABSENT);
	}
	return evalAst(fn.body, { ...ctx, env });
}

export function predOrNeedle(list:ExprVal[], arg:ExprVal | undefined, ctx:EvalCtx):ExprVal[] {
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

function foldPred(list:ExprVal[], arg:ExprVal | undefined, all:boolean, ctx:EvalCtx):boolean {
	const rows = arg ? predOrNeedle(list, arg, ctx) : list.filter((x) => {
		if (x.kind === 'number') {
			return x.value > 0;
		}
		return isTruthy(x);
	});
	if (!arg && list.length === 0) {
		return all;
	}
	if (!arg) {
		return all ? rows.length === list.length : rows.length > 0;
	}
	if (arg.kind === 'string' || arg.kind === 'lambda') {
		return all ? rows.length === list.length : rows.length > 0;
	}
	return all ? rows.length === list.length : rows.length > 0;
}

export const builtins:Record<string, NativeFn> = {
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
		return capList(list.map((x) => applyLambda(fn, [x], ctx)));
	},
	filter(args, ctx) {
		const list = asList(args[0]);
		if (!list) {
			throw new ExprError('filter needs a list');
		}
		return capList(predOrNeedle(list, args[1], ctx));
	},
	find(args, ctx) {
		const list = asList(args[0]);
		if (!list) {
			throw new ExprError('find needs a list');
		}
		const hit = predOrNeedle(list, args[1], ctx)[0];
		return hit ?? ABSENT;
	},
	findLast(args, ctx) {
		const list = asList(args[0]);
		if (!list) {
			throw new ExprError('findLast needs a list');
		}
		const rows = predOrNeedle(list, args[1], ctx);
		return rows[rows.length - 1] ?? ABSENT;
	},
	includes(args) {
		const list = asList(args[0]);
		const x = args[1];
		if (!list) {
			throw new ExprError('includes needs a list');
		}
		if (x.kind === 'string' && list.every((i) => i.kind === 'entity' || i.kind === 'absent')) {
			return { kind: 'bool', value: list.some((i) => i.kind === 'entity' && needleMatch(i.value, x.value)) };
		}
		return { kind: 'bool', value: list.some((i) => sameVal(i, x)) };
	},
	first(args) {
		const list = asList(args[0]);
		if (!list) {
			throw new ExprError('first needs a list');
		}
		return list[0] ?? ABSENT;
	},
	sortBy(args, ctx) {
		const list = asList(args[0]);
		const fn = args[1];
		if (!list || fn?.kind !== 'lambda') {
			throw new ExprError('sortBy(list, fn)');
		}
		const keyed = list.map((x) => ({ x, k: asNum(applyLambda(fn, [x], ctx)) ?? 0 }));
		keyed.sort((a, b) => a.k - b.k);
		return capList(keyed.map((r) => r.x));
	},
	max(args) {
		return extrema(args, true);
	},
	min(args) {
		return extrema(args, false);
	},
	maxBy(args, ctx) {
		return byExtrema(args, ctx, true);
	},
	minBy(args, ctx) {
		return byExtrema(args, ctx, false);
	},
	sum(args) {
		const nums = numsOf(args);
		return { kind: 'number', value: nums.reduce((a, b) => a + b, 0) };
	},
	avg(args) {
		const nums = numsOf(args);
		if (nums.length === 0) {
			throw new ExprError('avg of empty');
		}
		return { kind: 'number', value: nums.reduce((a, b) => a + b, 0) / nums.length };
	},
	count(args, ctx) {
		const list = asList(args[0]);
		if (!list) {
			throw new ExprError('count needs a list');
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
			throw new ExprError('some needs a list');
		}
		return { kind: 'bool', value: foldPred(list, args[1], false, ctx) };
	},
	all(args, ctx) {
		const list = asList(args[0]);
		if (!list) {
			throw new ExprError('all needs a list');
		}
		return { kind: 'bool', value: foldPred(list, args[1], true, ctx) };
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

function extrema(args:ExprVal[], hi:boolean):ExprVal {
	const nums = numsOf(args);
	if (nums.length === 0) {
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
	let best = list[0];
	let bestK = asNum(applyLambda(fn, [best], ctx));
	if (bestK === undefined) {
		throw new ExprError('key is not a number');
	}
	for (let i = 1; i < list.length; i++) {
		const k = asNum(applyLambda(fn, [list[i]], ctx));
		if (k === undefined) {
			throw new ExprError('key is not a number');
		}
		if (hi ? k > bestK : k < bestK) {
			best = list[i];
			bestK = k;
		}
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
		if (value.kind === 'list' && value.value.length > LIST_CAP) {
			throw new ExprError('list cap', 'capTie');
		}
		return { value };
	}
	catch (err) {
		const error = err instanceof ExprError ? err : new ExprError(err instanceof Error ? err.message : String(err));
		return { value: ABSENT, error };
	}
}

export { predOrNeedle as matchPred };
