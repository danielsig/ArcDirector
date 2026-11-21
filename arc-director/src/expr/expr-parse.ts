import { AST_CAP, ABSENT, ExprError, type Ast, type ExprVal } from './expr-types.js';
import { lexAt, METERS_HINT, type Tok, type TokKind } from './lex.js';

/**
 * The one grammar of watches and arcs, as JavaScript writes it. Everything is an expression: a verb call acts and is
 * true if it worked; a query returns a value; `&&`, `||` and `;` (or a new line) join them with JavaScript's
 * precedence. A verb whose args hold an arc takes it as a body after its call, `{ … }` or one statement:
 * `command(Archers) { go_to(Wall) }`, `if (isHurt(Mira)) heal(Mira) else say("Fine")`. `A while B` runs B during A,
 * binding tighter than `&&`, `||` and `;`, and from the right: `A while B while C` is `A while (B while C)`. `else`
 * continues the call before it; `name: statement` labels a choice of `choose`; `let x = step` names a step's result. Named args take `=` or
 * `:`. Durations are numbers of game seconds: `5s`, `1.5min`, `2h`; `5m` is refused, as sight writes meters so. A
 * watch is one expression that does not act.
 */

/** Where a node was written: `src.slice(from, to)`. */
export type Span = { from:number; to:number };

/** One arg of a call: `name=value` or `name: value`, else positional. */
export type Arg = { name?:string; value:Syntax };

export type Syntax = Span & (
	| { type:'lit'; value:ExprVal }
	/** Prose a verb's `text` arg was given unquoted. */
	| { type:'text'; value:string }
	| { type:'ident'; name:string }
	| { type:'array'; items:Syntax[] }
	| { type:'object'; entries:{ key:string; value:Syntax }[] }
	| { type:'unary'; op:'!' | '-' | '+'; expr:Syntax }
	/** `;` joins statements as the lowest operator. */
	| { type:'binary'; op:string; left:Syntax; right:Syntax }
	| { type:'ternary'; cond:Syntax; then:Syntax; else:Syntax }
	| { type:'member'; recv:Syntax; name:string }
	| { type:'call'; callee:Syntax; args:Arg[]; body?:Syntax; else?:Syntax }
	| { type:'lambda'; params:string[]; body:Syntax }
	| { type:'paren'; expr:Syntax }
	/** `{ … }` where a statement goes. Empty: no body. */
	| { type:'block'; body?:Syntax }
	| { type:'let'; name:string; value:Syntax }
	| { type:'label'; name:string; body:Syntax }
);

/** What the parser asks of the verbs an arc may name. A watch names none. */
export type VerbHooks = {
	/** The arg kinds of verb `name` by key, in order; undefined when no verb is so called. */
	argsOf(name:string):Readonly<Record<string, string>> | undefined;
	/** Whether verb `name`, given `args`, still takes a body: an arc it has not been given. */
	takesBody(name:string, args:readonly Arg[]):boolean;
	/** Whether verb `name` takes named args of any name (`choose`'s choices), so any `, name=` ends its prose. */
	anyNamed(name:string):boolean;
};

const NO_VERBS:VerbHooks = { argsOf: () => undefined, takesBody: () => false, anyNamed: () => false };

/** Tokens that end a statement, or a body that was never written. */
const CLOSERS = new Set<TokKind>(['eof', 'rp', 'rbrace', 'semi', 'comma', 'amp', 'pipe', 'while']);

class Parser {
	private readonly _toks:Tok[] = [];
	private _i = 0;
	/** Reading an arc, where a join a reply ends on is dropped; a watch that ends on one is cut off. */
	private _program = false;
	public nodes = 0;

	constructor(private readonly _src:string, private readonly _verbs:VerbHooks) {}

	/** The token `ahead` places on, lexed as it is first asked for. */
	private peek(ahead = 0):Tok {
		while (this._toks.length <= this._i + ahead) {
			const last = this._toks.at(-1);
			this._toks.push(last?.kind === 'eof' ? last : lexAt(this._src, last?.end ?? 0, last?.kind));
		}
		return this._toks[this._i + ahead];
	}

	private eat(kind?:TokKind):Tok {
		const t = this.peek();
		if (t.hint) {
			throw new ExprError(t.hint);
		}
		if (kind && t.kind !== kind) {
			throw new ExprError(t.kind === 'eof' ? `cut off: expected ${kind}` : `expected ${kind}, got ${t.raw || t.kind}`);
		}
		if (t.kind === 'bad') {
			throw new ExprError(`unexpected '${t.raw}'`);
		}
		this._i += 1;
		return t;
	}

	/** Lex again from source offset `at`: what was lexed past it was read another way. */
	private resume(at:number):void {
		this._toks.length = this._i;
		this._toks.push(lexAt(this._src, at, this._toks.at(-1)?.kind));
	}

	private node<TNode extends Syntax>(n:TNode):TNode {
		this.nodes += 1;
		return n;
	}

	private span(from:number):Span {
		return { from, to: this._toks[this._i - 1]?.end ?? from };
	}

	/** A whole watch: one expression. */
	public expression():Syntax {
		const expr = this.ternary();
		if (this.peek().kind !== 'eof') {
			throw new ExprError(`unexpected ${this.peek().raw}`);
		}
		return expr;
	}

	/** A whole arc: statements to the end. Stray `)`, `.` and `,` between statements are dropped. */
	public program():Syntax | undefined {
		this._program = true;
		return this.sequence('eof');
	}

	/** Statements up to `end`, joined by `;`, a new line, or nothing between two verb calls. */
	private sequence(end:TokKind):Syntax | undefined {
		let out:Syntax | undefined;
		for (;;) {
			this.skipStrays(end);
			const t = this.peek();
			if (t.kind === end || t.kind === 'eof') {
				return out;
			}
			if (out && !t.nl && this._toks[this._i - 1]?.kind !== 'semi') {
				this.checkSameLine(t);
			}
			const stmt = this.statement();
			out = out ? this.node({ type: 'binary', op: ';', left: out, right: stmt, from: out.from, to: stmt.to }) : stmt;
			if (this.peek().kind === 'semi') {
				this.eat();
			}
		}
	}

	/** What a model leaves between statements: a closer too many, a copied period, a comma. Not inside `( … )`. */
	private skipStrays(end:TokKind):void {
		while (end !== 'rp' && ['rp', 'dot', 'comma', 'semi'].includes(this.peek().kind) && this.peek().kind !== end) {
			this.eat();
		}
	}

	/** Two statements on one line with nothing between: only verb calls may (`think(…)use(…)`). */
	private checkSameLine(t:Tok):void {
		if (t.kind === 'lp' || t.kind === 'lbrace' || (t.kind === 'ident' && (this.isVerb(t.raw) || t.raw === 'let'))) {
			return;
		}
		// Words after words are prose, not an arg that slipped out of its call.
		if (!['rp', 'rbrace'].includes(this._toks[this._i - 1]?.kind ?? '')) {
			throw new ExprError('expected verb');
		}
		if (t.kind === 'ident') {
			throw new ExprError(`${t.raw} is outside the parentheses. Put every argument inside its verb's parentheses, as in say(text=Hi, to=Name)`);
		}
		throw new ExprError(`unexpected ${t.raw || t.kind}`);
	}

	private isVerb(name:string):boolean {
		return this._verbs.argsOf(name) !== undefined;
	}

	private statement():Syntax {
		const t = this.peek();
		const from = t.i;
		if (t.kind === 'ident' && t.raw === 'let' && this.peek(1).kind === 'ident') {
			this.eat();
			const name = this.eat().raw;
			if (this.peek().kind !== 'eq' && this.peek().kind !== 'colon') {
				throw new ExprError(`let ${name} needs = and a step: let ${name} = pick_up(Key)`);
			}
			this.eat();
			const value = this.ternary();
			return this.node({ type: 'let', name, value, ...this.span(from) });
		}
		if (t.kind === 'ident' && this.peek(1).kind === 'colon') {
			this.eat();
			this.eat();
			const body = this.statement();
			return this.node({ type: 'label', name: t.raw, body, ...this.span(from) });
		}
		if (t.kind === 'while') {
			throw new ExprError('while joins two steps: A while B');
		}
		return t.kind === 'lbrace' ? this.whileClause(this.block()) : this.ternary();
	}

	/** `{ statements }`. End of input stands for the `}` a model left off. */
	private block():Syntax {
		const from = this.eat('lbrace').i;
		const body = this.sequence('rbrace');
		this.close('rbrace', true);
		return this.node({ type: 'block', body, ...this.span(from) });
	}

	/** Past `kind`. End of input stands for it where `lenient`: a verb's call or body, or a group of steps. */
	private close(kind:TokKind, lenient:boolean):void {
		if (this.peek().kind === 'eof' && lenient) {
			return;
		}
		if (this.peek().kind === 'eof') {
			throw new ExprError('expression cut off before its closing bracket');
		}
		this.eat(kind);
	}

	private ternary():Syntax {
		const cond = this.binary(0);
		if (this.peek().kind !== 'q') {
			return cond;
		}
		this.eat();
		const then = this.ternary();
		this.eat('colon');
		const els = this.ternary();
		return this.node({ type: 'ternary', cond, then, else: els, from: cond.from, to: els.to });
	}

	/** Binary operators by precedence, loosest first. A join with nothing after it is dropped. */
	private binary(level:number):Syntax {
		if (level === LEVELS.length) {
			return this.unary();
		}
		let left = this.binary(level + 1);
		for (;;) {
			const t = this.peek();
			const op = LEVELS[level][t.kind];
			if (!op) {
				return left;
			}
			if ((op === '&&' || op === '||') && this._program && this.peek(1).kind === 'eof') {
				this.eat();
				return left;
			}
			if (op === 'while') {
				return this.whileClause(left);
			}
			this.eat();
			// `a is not b` is `!(a is b)`, as models write it.
			const negated = op === 'is' && this.peek().kind === 'not';
			if (negated) {
				this.eat();
			}
			const right = this.binary(level + 1);
			const node = this.node({ type: 'binary', op, left, right, from: left.from, to: right.to });
			left = negated ? this.node({ type: 'unary', op: '!', expr: node, from: node.from, to: node.to }) : node;
		}
	}

	/** `left while B`, from the right: B is a step or a `{ … }` block, and may have a `while` of its own. */
	private whileClause(left:Syntax):Syntax {
		if (this.peek().kind !== 'while') {
			return left;
		}
		this.eat();
		const right = this.peek().kind === 'lbrace' ? this.whileClause(this.block()) : this.binary(WHILE_LEVEL);
		return this.node({ type: 'binary', op: 'while', left, right, from: left.from, to: right.to });
	}

	private unary():Syntax {
		const t = this.peek();
		const op = t.kind === 'not' ? '!' : t.kind === 'minus' ? '-' : t.kind === 'plus' ? '+' : undefined;
		if (op) {
			this.eat();
			const expr = this.unary();
			return this.node({ type: 'unary', op, expr, from: t.i, to: expr.to });
		}
		return this.postfix();
	}

	private postfix():Syntax {
		let expr = this.primary();
		for (;;) {
			const t = this.peek();
			if (t.kind === 'dot' || t.kind === 'qdot') {
				// `.` after a call on a new line, then a name: a method chain going on. Anything else: a stray period.
				if (this.peek(1).kind !== 'ident') {
					return expr;
				}
				this.eat();
				const name = this.eat('ident').raw;
				expr = this.node({ type: 'member', recv: expr, name, ...this.span(expr.from) });
				continue;
			}
			// A call: a name's or a method's, on the same line. `f(x)(y)` is two statements.
			if (t.kind === 'lp' && !t.nl && (expr.type === 'ident' || expr.type === 'member')) {
				expr = this.call(expr);
				continue;
			}
			return expr;
		}
	}

	/** `callee(args)`, a verb's body after it, and `else` after that. */
	private call(callee:Syntax & { type:'ident' | 'member' }):Syntax {
		this.eat('lp');
		const name = callee.name;
		const args = this.args(name);
		this.close('rp', this.isVerb(name));
		this.trailingArg(name, args);
		return this.bodyOf(name, { type: 'call', callee, args, ...this.span(callee.from) });
	}

	/**
	 * `say("Hi") to Bram`, `pick_up(Bread) from Chest` (or `to=Bram`), as a model writes it: an arg name of the verb's
	 * after the call, on its line, and one plain value (a name or a string) that ends the statement, is that arg, where
	 * it was not given. A string alone there is its text arg not given: `say(to=Bram, as=whisper) "Quiet"`. Anything else
	 * stays outside the parentheses, an error.
	 */
	private trailingArg(name:string, args:Arg[]):void {
		const kinds = this._verbs.argsOf(name);
		const t = this.peek();
		const text = kinds && t.kind === 'str' && !t.nl && (CLOSERS.has(this.peek(1).kind) || this.peek(1).nl)
			? Object.keys(kinds).find((key) => isText(kinds[key]) && !argKeys(kinds, args).includes(key))
			: undefined;
		if (text) {
			this.eat();
			args.push({ name: text, value: this.node({ type: 'lit', value: { kind: 'string', value: t.raw }, from: t.i, to: t.end }) });
			return;
		}
		if (!kinds || t.kind !== 'ident' || t.nl || !Object.hasOwn(kinds, t.raw) || kinds[t.raw].startsWith('arc') || argKeys(kinds, args).includes(t.raw)) {
			return;
		}
		const keyed = this.namedAt(0) ? 2 : 1;
		const value = this.peek(keyed);
		const after = this.peek(keyed + 1);
		if (!['ident', 'str'].includes(value.kind) || value.nl || this.isVerb(value.raw) || !(CLOSERS.has(after.kind) || after.nl)) {
			return;
		}
		for (let n = 0; n < keyed; n++) {
			this.eat();
		}
		this.eat();
		const lit = value.kind === 'str' ? { type: 'lit' as const, value: { kind: 'string' as const, value: value.raw } } : { type: 'ident' as const, name: value.raw };
		args.push({ name: t.raw, value: this.node({ ...lit, from: value.i, to: value.end }) });
	}

	private bodyOf(name:string, call:Syntax & { type:'call' }):Syntax {
		if (!this.isVerb(name)) {
			return this.node(call);
		}
		if (!this._verbs.takesBody(name, call.args) && this.peek().kind === 'lbrace' && !this.peek().nl) {
			const written = this._src.slice(call.from, call.to);
			throw new ExprError(`to run steps during it, write ${written} while { … }; for after it, put the block on the next line`);
		}
		const body = this._verbs.takesBody(name, call.args) ? this.body() : undefined;
		if (!body) {
			return this.node(call);
		}
		const out = { ...call, body, to: body.to };
		if (this.peek().kind === 'ident' && this.peek().raw === 'else') {
			this.eat();
			const els = this.body();
			if (!els) {
				throw new ExprError('else needs a body: else { … } or else one step');
			}
			return this.node({ ...out, else: els, to: els.to });
		}
		return this.node(out);
	}

	/** A body: `{ … }`, or one statement, on this line or the next. Undefined when none was written. */
	private body():Syntax | undefined {
		const t = this.peek();
		if (t.kind === 'lbrace') {
			return this.block();
		}
		if (CLOSERS.has(t.kind) || (t.kind === 'ident' && t.raw === 'else')) {
			return undefined;
		}
		return this.statement();
	}

	/** The args of a call up to its `)`. Inside a verb's, `;` before a named arg or `)` is a C-style comma. */
	private args(callee:string):Arg[] {
		const kinds = this._verbs.argsOf(callee);
		const args:Arg[] = [];
		while (!['rp', 'eof'].includes(this.peek().kind)) {
			const t = this.peek();
			let name = this.namedAt(0) ? t.raw : undefined;
			// Prose may hold `word=`: there only this verb's own arg names start a named arg.
			if (name !== undefined && kinds && !(name in kinds) && !this._verbs.anyNamed(callee) && isText(kinds[positionalKey(kinds, args) ?? ''])) {
				name = undefined;
			}
			if (name !== undefined) {
				this.eat();
				this.eat();
				// A key the model wrote twice: `say(text=text="Hi")`.
				if (this.peek().raw === name && this.namedAt(0)) {
					this.eat();
					this.eat();
				}
			}
			const key = name ?? (kinds && positionalKey(kinds, args));
			// A verb that takes any name (`choose`) takes an arc under each name it does not list.
			const kind = kinds && key !== undefined && key in kinds ? kinds[key] : kinds && this._verbs.anyNamed(callee) ? 'arc' : undefined;
			const value = !kinds ? this.argValue(false)
				: isText(kind) ? this.prose(callee, Object.keys(kinds).filter((other) => other !== key))
					: this.verbArg(kind);
			args.push(name === undefined ? { value } : { name, value });
			if (this.peek().kind === 'comma' || this.peek().kind === 'semi') {
				this.eat();
				continue;
			}
			if (!['rp', 'eof'].includes(this.peek().kind)) {
				throw new ExprError(`expected ',' or ')' in ${callee}(...)`);
			}
		}
		return args;
	}

	/** Whether a named arg starts `ahead` tokens on: a name (`in` and `is` too), then `=` or `:`. */
	private namedAt(ahead:number):boolean {
		const next = this.peek(ahead + 1);
		return /^[A-Za-z_]\w*$/.test(this.peek(ahead).raw) && this.peek(ahead).kind !== 'str'
			&& ((next.kind === 'eq' && next.raw === '=') || next.kind === 'colon');
	}

	/**
	 * A verb's arg as an expression; or, where it does not read as one up to its `,` or `)`, as written, as a model
	 * writes a name with a space (`set_identity(role=Waterfall scout)`). An arc is always read.
	 */
	private verbArg(kind:string | undefined):Syntax {
		if (kind === 'arc' || kind === 'arc?') {
			return this.argValue(true);
		}
		const save = this._i;
		try {
			const value = this.argValue(true);
			if (['comma', 'semi', 'rp', 'eof'].includes(this.peek().kind)) {
				return value;
			}
		}
		catch (err) {
			// Read as written, below; but a number in a unit that is no duration is no slip of the model's to keep.
			if (err instanceof ExprError && err.message.includes(METERS_HINT)) {
				throw err;
			}
		}
		this._i = save;
		return this.raw();
	}

	/** Text up to the `,`, `;` or `)` that ends an arg, brackets and quotes balanced. */
	private raw():Syntax {
		const from = this.peek().i;
		let depth = 0;
		let quote = '';
		let i = from;
		for (; i < this._src.length; i++) {
			const c = this._src[i];
			if (quote) {
				i += c === '\\' ? 1 : 0;
				quote = c === quote ? '' : quote;
				continue;
			}
			if (c === '"' || c === "'") {
				quote = c;
			}
			else if ('([{'.includes(c)) {
				depth += 1;
			}
			else if (')]}'.includes(c) && depth-- === 0) {
				break;
			}
			else if (depth === 0 && (c === ',' || c === ';')) {
				break;
			}
		}
		if (depth > 0) {
			throw new ExprError('expression cut off before its closing bracket');
		}
		this.resume(i);
		return this.node({ type: 'text', value: this._src.slice(from, i).trim(), from, to: i });
	}

	/** One arg's value. A verb's arg may run on with `;` into more steps, unless a named arg or `)` follows. */
	private argValue(verb:boolean):Syntax {
		let value = this.ternary();
		while (verb && this.peek().kind === 'semi' && !this.namedOrClose(1)) {
			this.eat();
			const right = this.ternary();
			value = this.node({ type: 'binary', op: ';', left: value, right, from: value.from, to: right.to });
		}
		return value;
	}

	private namedOrClose(ahead:number):boolean {
		return ['rp', 'eof'].includes(this.peek(ahead).kind) || this.namedAt(ahead);
	}

	/**
	 * Prose for a `text` arg: a double-quoted string, or raw up to the closing `)` or the next `, key=` of this verb, where
	 * commas and apostrophes are plain text and a `'…'` round it is dropped.
	 */
	private prose(callee:string, keys:readonly string[]):Syntax {
		const any = this._verbs.anyNamed(callee);
		const t = this.peek();
		if (t.kind === 'str' && this._src[t.i] === '"') {
			this.eat();
			return this.node({ type: 'lit', value: { kind: 'string', value: t.raw }, from: t.i, to: t.end });
		}
		let i = t.i;
		let depth = 0;
		for (; i < this._src.length; i++) {
			const c = this._src[i];
			if (c === ')' && depth === 0) {
				break;
			}
			depth += c === '(' ? 1 : c === ')' ? -1 : 0;
			const key = c === ',' && depth === 0 ? /^\s*([A-Za-z_]\w*)\s*[=:](?!=)/.exec(this._src.slice(i + 1, i + 65)) : null;
			if (key && (any || keys.includes(key[1]))) {
				break;
			}
		}
		const raw = this._src.slice(t.i, i).trim();
		const quoted = raw.length > 1 && raw.startsWith("'") && raw.endsWith("'");
		this.resume(i);
		return this.node({ type: 'text', value: quoted ? raw.slice(1, -1) : raw, from: t.i, to: i });
	}

	private primary():Syntax {
		const t = this.peek();
		const lit = (value:ExprVal):Syntax => {
			this.eat();
			return this.node({ type: 'lit', value, from: t.i, to: t.end });
		};
		switch (t.kind) {
			case 'num':
				return lit({ kind: 'number', value: t.n ?? 0 });
			case 'str':
				return lit({ kind: 'string', value: t.raw });
			case 'true':
			case 'false':
				return lit({ kind: 'bool', value: t.kind === 'true' });
			case 'null':
			case 'undefined':
				return lit(ABSENT);
			case 'ident':
				return this.name(t);
			case 'lp':
				return this.paren(t);
			case 'lb': {
				this.eat();
				const items:Syntax[] = [];
				while (!['rb', 'eof'].includes(this.peek().kind)) {
					items.push(this.ternary());
					if (this.peek().kind !== 'comma') {
						break;
					}
					this.eat();
				}
				this.close('rb', false);
				return this.node({ type: 'array', items, ...this.span(t.i) });
			}
			case 'lbrace':
				// `{ key: value }` is an object; any other braces hold steps, as a body does: `arc={ loop … }`.
				return this.peek(1).kind === 'rbrace' || (['str', 'ident'].includes(this.peek(1).kind) && this.peek(2).kind === 'colon') ? this.object(t) : this.block();
			default:
				throw new ExprError(t.hint ?? (t.kind === 'eof' ? 'expected a step or a value, got the end' : `unexpected ${t.raw || t.kind}`));
		}
	}

	/** A name, a lambda `u => …`, or a verb written without its parentheses. */
	private name(t:Tok):Syntax {
		if (t.raw === 'this' || t.raw === 'self') {
			throw new ExprError(`'${t.raw}' is not a name; use me`);
		}
		this.eat();
		if (this.peek().kind === 'arrow') {
			this.eat();
			const body = this.ternary();
			return this.node({ type: 'lambda', params: [t.raw], body, from: t.i, to: body.to });
		}
		const ident = this.node({ type: 'ident', name: t.raw, from: t.i, to: t.end }) as Syntax & { type:'ident' };
		if (!this.isVerb(t.raw) || (this.peek().kind === 'lp' && !this.peek().nl)) {
			return ident;
		}
		// `loop { … }`, `if isHurt(me) { … }`, `go_to Keep`, `say "Hold the line"`, or a bare `wander`.
		const next = this.peek();
		const args:Arg[] = [];
		if (this._verbs.takesBody(t.raw, args) && next.kind !== 'lbrace' && !next.nl && !CLOSERS.has(next.kind)) {
			args.push({ value: this.binary(0) });
		}
		else if (next.kind === 'str' && !next.nl) {
			this.eat();
			args.push({ value: this.node({ type: 'lit', value: { kind: 'string', value: next.raw }, from: next.i, to: next.end }) });
		}
		else if (next.kind === 'ident' && !next.nl && !this.isVerb(next.raw) && CLOSERS.has(this.peek(1).kind)) {
			this.eat();
			args.push({ value: this.node({ type: 'ident', name: next.raw, from: next.i, to: next.end }) });
		}
		this.trailingArg(t.raw, args);
		return this.bodyOf(t.raw, { type: 'call', callee: ident, args, ...this.span(t.i) });
	}

	/** `( … )`: a lambda's params, a group of steps, or an expression in brackets. */
	private paren(t:Tok):Syntax {
		this.eat();
		const save = this._i;
		if (this.peek().kind === 'ident') {
			const params = [this.eat().raw];
			while (this.peek().kind === 'comma' && this.peek(1).kind === 'ident') {
				this.eat();
				params.push(this.eat().raw);
			}
			if (this.peek().kind === 'rp' && this.peek(1).kind === 'arrow') {
				this.eat();
				this.eat();
				const body = this.ternary();
				return this.node({ type: 'lambda', params, body, from: t.i, to: body.to });
			}
			this._i = save;
		}
		const expr = this.sequence('rp');
		if (!expr) {
			throw new ExprError('empty ( )');
		}
		this.close('rp', hasVerbCall(expr, this._verbs));
		return this.node({ type: 'paren', expr, ...this.span(t.i) });
	}

	/** `{"Egg": 12, Milk: 3}`. */
	private object(t:Tok):Syntax {
		this.eat();
		const entries:{ key:string; value:Syntax }[] = [];
		while (!['rbrace', 'eof'].includes(this.peek().kind)) {
			const key = this.peek();
			if (key.kind !== 'str' && key.kind !== 'ident') {
				throw new ExprError(`expected a name before : in { }, got ${key.raw || key.kind}`);
			}
			this.eat();
			this.eat('colon');
			entries.push({ key: key.raw, value: this.ternary() });
			if (this.peek().kind !== 'comma') {
				break;
			}
			this.eat();
		}
		this.close('rbrace', false);
		return this.node({ type: 'object', entries, ...this.span(t.i) });
	}
}

/** Binary operators per precedence level, loosest first, as JavaScript ranks them. */
const LEVELS:Partial<Record<TokKind, string>>[] = [
	{ qq: '??' },
	{ pipe: '||' },
	{ amp: '&&' },
	{ while: 'while' },
	{ eq: '==', neq: '!=', is: 'is', in: 'in' },
	{ lt: '<', gt: '>', le: '<=', ge: '>=' },
	{ plus: '+', minus: '-' },
	{ star: '*', slash: '/' },
];

/** Where `while` binds: tighter than `&&`, looser than a comparison. */
const WHILE_LEVEL = LEVELS.findIndex((level) => level.while);

function isText(kind:string | undefined):boolean {
	return kind === 'text' || kind === 'text?';
}

/**
 * The key each of `args` fills: its name, or for a positional one the verb's next arg in order not yet given, then
 * the first not given at all (`law(who=units, watch=…, go_to(Keep))` puts the step in `arc`).
 */
export function argKeys(kinds:Readonly<Record<string, string>>, args:readonly Arg[]):(string | undefined)[] {
	const keys = Object.keys(kinds);
	const given = new Set<string>();
	let positional = 0;
	return args.map((arg) => {
		const key = arg.name ?? keys.slice(positional).find((k) => !given.has(k) && !args.some((other) => other.name === k))
			?? keys.find((k) => !given.has(k) && !args.some((other) => other.name === k));
		if (arg.name === undefined) {
			positional = key === undefined ? positional : keys.indexOf(key) + 1;
		}
		if (key !== undefined) {
			given.add(key);
		}
		return key;
	});
}

/** The key the next positional arg after `given` fills. */
function positionalKey(kinds:Readonly<Record<string, string>>, given:readonly Arg[]):string | undefined {
	return argKeys(kinds, [...given, { value: { type: 'block', from: 0, to: 0 } }]).at(-1);
}

/** Whether `node` calls a verb anywhere in it. */
export function hasVerbCall(node:Syntax, verbs:VerbHooks):boolean {
	switch (node.type) {
		case 'call':
			return (node.callee.type === 'ident' && verbs.argsOf(node.callee.name) !== undefined)
				|| (node.callee.type === 'member' && verbs.argsOf(node.callee.name) !== undefined)
				|| node.args.some((arg) => hasVerbCall(arg.value, verbs));
		case 'binary':
			return hasVerbCall(node.left, verbs) || hasVerbCall(node.right, verbs);
		case 'paren':
			return hasVerbCall(node.expr, verbs);
		case 'unary':
			return hasVerbCall(node.expr, verbs);
		case 'ternary':
			return hasVerbCall(node.cond, verbs) || hasVerbCall(node.then, verbs) || hasVerbCall(node.else, verbs);
		case 'block':
		case 'label':
			return !!node.body && hasVerbCall(node.body, verbs);
		case 'let':
			return true;
		default:
			return false;
	}
}

/** `src` read as a whole arc, with `verbs` saying which names are verbs. Undefined when it holds no statement. */
export function parseProgram(src:string, verbs:VerbHooks):Syntax | undefined {
	return new Parser(src, verbs).program();
}

/** The expression tree a watch evaluates: method calls as plain calls, `x in y` as `includes(y, x)`. */
export function toAst(node:Syntax):Ast {
	switch (node.type) {
		case 'lit':
			return { type: 'lit', value: node.value };
		case 'text':
			return { type: 'lit', value: { kind: 'string', value: node.value } };
		case 'ident':
			return { type: 'ident', name: node.name };
		case 'array':
			return { type: 'array', items: node.items.map(toAst) };
		case 'unary':
			return { type: 'unary', op: node.op, expr: toAst(node.expr) };
		case 'binary':
			if (node.op === ';') {
				throw new ExprError('a watch is one expression: no ; and no new statements');
			}
			return node.op === 'in'
				? { type: 'call', callee: { type: 'ident', name: 'includes' }, args: [toAst(node.right), toAst(node.left)] }
				: { type: 'binary', op: node.op, left: toAst(node.left), right: toAst(node.right) };
		case 'ternary':
			return { type: 'ternary', cond: toAst(node.cond), then: toAst(node.then), else: toAst(node.else) };
		case 'member':
			return { type: 'member', recv: toAst(node.recv), name: node.name };
		case 'lambda':
			return { type: 'lambda', params: node.params, body: toAst(node.body) };
		case 'paren':
			return toAst(node.expr);
		case 'call': {
			if (node.body || node.args.some((arg) => arg.name !== undefined)) {
				throw new ExprError('a watch only asks: name=value args and { } bodies are for verbs');
			}
			const args = node.args.map((arg) => toAst(arg.value));
			return node.callee.type === 'member'
				? { type: 'call', callee: { type: 'ident', name: node.callee.name }, args: [toAst(node.callee.recv), ...args] }
				: { type: 'call', callee: toAst(node.callee), args };
		}
		default:
			throw new ExprError(`a watch is one expression: no ${node.type === 'object' ? '{ } object' : node.type}`);
	}
}

export type ParseResult = { ast:Ast; nodes:number };

const cache = new Map<string, ParseResult>();

/** A watch: one expression that does not act. */
export function parse(src:string):ParseResult {
	const hit = cache.get(src);
	if (hit) {
		return hit;
	}
	const p = new Parser(src, NO_VERBS);
	const syntax = p.expression();
	if (p.nodes > AST_CAP) {
		throw new ExprError('expression too large', 'capTie');
	}
	const result = { ast: toAst(syntax), nodes: p.nodes };
	if (cache.size > 256) {
		cache.clear();
	}
	cache.set(src, result);
	return result;
}

export function lit(v:ExprVal):Ast {
	return { type: 'lit', value: v };
}
