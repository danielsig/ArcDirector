import { AST_CAP, ABSENT, ExprError, type Ast, type ExprVal } from './types.js';
import { lex, type Tok, type TokKind } from './lex.js';

export type ParseResult = { ast:Ast; nodes:number };

class Parser {
	private _i = 0;
	public nodes = 0;
	public constructor(private readonly _toks:Tok[]) {}

	private peek():Tok {
		return this._toks[this._i];
	}

	private eat(kind?:TokKind):Tok {
		const t = this.peek();
		if (kind && t.kind !== kind) {
			throw new ExprError(`expected ${kind}, got ${t.kind}`);
		}
		this._i += 1;
		return t;
	}

	private node<TNode extends Ast>(n:TNode):TNode {
		this.nodes += 1;
		if (this.nodes > AST_CAP) {
			throw new ExprError('expression too large', 'capTie');
		}
		return n;
	}

	public parse():Ast {
		const ast = this.ternary();
		if (this.peek().kind !== 'eof') {
			throw new ExprError(`unexpected ${this.peek().raw}`);
		}
		return desugar(ast);
	}

	private ternary():Ast {
		const cond = this.coalesce();
		if (this.peek().kind === 'q') {
			this.eat();
			const then = this.ternary();
			this.eat('colon');
			const els = this.ternary();
			return this.node({ type: 'ternary', cond, then, else: els });
		}
		return cond;
	}

	private coalesce():Ast {
		let left = this.or();
		while (this.peek().kind === 'qq') {
			this.eat();
			const right = this.or();
			left = this.node({ type: 'binary', op: '??', left, right });
		}
		return left;
	}

	private or():Ast {
		let left = this.and();
		while (this.peek().kind === 'pipe') {
			this.eat();
			const right = this.and();
			left = this.node({ type: 'binary', op: '||', left, right });
		}
		return left;
	}

	private and():Ast {
		let left = this.eq();
		while (this.peek().kind === 'amp') {
			this.eat();
			const right = this.eq();
			left = this.node({ type: 'binary', op: '&&', left, right });
		}
		return left;
	}

	private eq():Ast {
		let left = this.rel();
		while (true) {
			const k = this.peek().kind;
			if (k === 'eq' || k === 'neq' || k === 'is' || k === 'in') {
				this.eat();
				const right = this.rel();
				const op = k === 'eq' ? '==' : k === 'neq' ? '!=' : k === 'is' ? 'is' : 'in';
				left = this.node({ type: 'binary', op, left, right });
				continue;
			}
			break;
		}
		return left;
	}

	private rel():Ast {
		let left = this.add();
		while (true) {
			const k = this.peek().kind;
			if (k === 'lt' || k === 'gt' || k === 'le' || k === 'ge') {
				this.eat();
				const right = this.add();
				const op = k === 'lt' ? '<' : k === 'gt' ? '>' : k === 'le' ? '<=' : '>=';
				left = this.node({ type: 'binary', op, left, right });
				continue;
			}
			break;
		}
		return left;
	}

	private add():Ast {
		let left = this.mul();
		while (this.peek().kind === 'plus' || this.peek().kind === 'minus') {
			const op = this.eat().kind === 'plus' ? '+' : '-';
			const right = this.mul();
			left = this.node({ type: 'binary', op, left, right });
		}
		return left;
	}

	private mul():Ast {
		let left = this.unary();
		while (this.peek().kind === 'star' || this.peek().kind === 'slash') {
			const op = this.eat().kind === 'star' ? '*' : '/';
			const right = this.unary();
			left = this.node({ type: 'binary', op, left, right });
		}
		return left;
	}

	private unary():Ast {
		if (this.peek().kind === 'not' || this.peek().kind === 'minus' || this.peek().kind === 'plus') {
			const t = this.eat();
			const op = t.kind === 'not' ? '!' : t.kind === 'minus' ? '-' : '+';
			return this.node({ type: 'unary', op, expr: this.unary() });
		}
		return this.postfix();
	}

	private postfix():Ast {
		let expr = this.primary();
		while (true) {
			const k = this.peek().kind;
			if (k === 'dot' || k === 'qdot') {
				this.eat();
				const name = this.eat('ident').raw;
				expr = this.node({ type: 'member', recv: expr, name });
				continue;
			}
			if (k === 'lp') {
				this.eat();
				const args = this.args('rp');
				expr = this.node({ type: 'call', callee: expr, args });
				continue;
			}
			break;
		}
		return expr;
	}

	private args(end:TokKind):Ast[] {
		const items:Ast[] = [];
		if (this.peek().kind === end) {
			this.eat();
			return items;
		}
		items.push(this.ternary());
		while (this.peek().kind === 'comma') {
			this.eat();
			items.push(this.ternary());
		}
		this.eat(end);
		return items;
	}

	private primary():Ast {
		const t = this.peek();
		if (t.kind === 'num') {
			this.eat();
			return this.node({ type: 'lit', value: { kind: 'number', value: t.n ?? 0 } });
		}
		if (t.kind === 'str') {
			this.eat();
			return this.node({ type: 'lit', value: { kind: 'string', value: t.raw } });
		}
		if (t.kind === 'true' || t.kind === 'false') {
			this.eat();
			return this.node({ type: 'lit', value: { kind: 'bool', value: t.kind === 'true' } });
		}
		if (t.kind === 'null' || t.kind === 'undefined') {
			this.eat();
			return this.node({ type: 'lit', value: ABSENT });
		}
		if (t.kind === 'ident') {
			if (t.raw === 'this' || t.raw === 'self') {
				throw new ExprError(`'${t.raw}' is not a name; use me`);
			}
			this.eat();
			if (this.peek().kind === 'arrow') {
				this.eat();
				const body = this.ternary();
				return this.node({ type: 'lambda', params: [t.raw], body });
			}
			return this.node({ type: 'ident', name: t.raw });
		}
		if (t.kind === 'lp') {
			this.eat();
			if (this.peek().kind === 'ident') {
				const save = this._i;
				const params = [this.eat().raw];
				while (this.peek().kind === 'comma') {
					this.eat();
					params.push(this.eat('ident').raw);
				}
				if (this.peek().kind === 'rp') {
					this.eat();
					if (this.peek().kind === 'arrow') {
						this.eat();
						const body = this.ternary();
						return this.node({ type: 'lambda', params, body });
					}
				}
				this._i = save;
			}
			const inner = this.ternary();
			this.eat('rp');
			return inner;
		}
		if (t.kind === 'lb') {
			this.eat();
			const items = this.peek().kind === 'rb' ? (this.eat(), [] as Ast[]) : this.args('rb');
			return this.node({ type: 'array', items });
		}
		throw new ExprError(`unexpected ${t.raw || t.kind}`);
	}
}

function desugar(ast:Ast):Ast {
	switch (ast.type) {
		case 'unary':
			return { ...ast, expr: desugar(ast.expr) };
		case 'binary': {
			const left = desugar(ast.left);
			const right = desugar(ast.right);
			if (ast.op === 'in') {
				return { type: 'call', callee: { type: 'ident', name: 'includes' }, args: [right, left] };
			}
			return { ...ast, left, right };
		}
		case 'ternary':
			return {
				...ast,
				cond: desugar(ast.cond),
				then: desugar(ast.then),
				else: desugar(ast.else),
			};
		case 'array':
			return { ...ast, items: ast.items.map(desugar) };
		case 'lambda':
			return { ...ast, body: desugar(ast.body) };
		case 'member':
			return { ...ast, recv: desugar(ast.recv) };
		case 'call': {
			const callee = desugar(ast.callee);
			const args = ast.args.map(desugar);
			if (callee.type === 'member') {
				return {
					type: 'call',
					callee: { type: 'ident', name: callee.name },
					args: [callee.recv, ...args],
				};
			}
			return { type: 'call', callee, args };
		}
		default:
			return ast;
	}
}

const cache = new Map<string, ParseResult>();

export function parse(src:string):ParseResult {
	const hit = cache.get(src);
	if (hit) {
		return hit;
	}
	const p = new Parser(lex(src));
	const ast = p.parse();
	const result = { ast, nodes: p.nodes };
	if (cache.size > 256) {
		cache.clear();
	}
	cache.set(src, result);
	return result;
}

export function lit(v:ExprVal):Ast {
	return { type: 'lit', value: v };
}
