export const AST_CAP = 400;
export const LIST_CAP = 32;
export const DIST_EPS = 0.05;
export const DEFAULT_TRUE_SCORE = 0.51;
export const DEFAULT_EPSILON = 0.05;
export const FACING_COS = 0.70710678118;

export type ScoldReason = 'typeError' | 'rawOverOne' | 'capTie' | 'fieldCall';

export class ExprError extends Error {
	readonly reason:ScoldReason;
	constructor(message:string, reason:ScoldReason = 'typeError') {
		super(message);
		this.name = 'ExprError';
		this.reason = reason;
	}
}

export type ExprEntity = {
	id:string;
	name?:string;
	tags:string[];
	fields?:Record<string, ExprVal>;
};

export type ExprVal =
	| { kind:'absent' }
	| { kind:'bool'; value:boolean }
	| { kind:'number'; value:number }
	| { kind:'string'; value:string }
	| { kind:'entity'; value:ExprEntity }
	| { kind:'list'; value:ExprVal[] }
	| { kind:'fn'; name:string }
	| { kind:'lambda'; params:string[]; body:Ast };

export const ABSENT:ExprVal = { kind: 'absent' };

export type Ast =
	| { type:'lit'; value:ExprVal }
	| { type:'ident'; name:string }
	| { type:'array'; items:Ast[] }
	| { type:'unary'; op:'!' | '-' | '+'; expr:Ast }
	| { type:'binary'; op:string; left:Ast; right:Ast }
	| { type:'ternary'; cond:Ast; then:Ast; else:Ast }
	| { type:'member'; recv:Ast; name:string }
	| { type:'call'; callee:Ast; args:Ast[] }
	| { type:'lambda'; params:string[]; body:Ast };

export const RESERVED = new Set([
	'me', 'others', 'items', 'prevThought', 'prevActions',
	'clamp', 'softClamp', 'map', 'find', 'findLast', 'filter', 'includes',
	'first', 'sortBy', 'max', 'min', 'maxBy', 'minBy', 'sum', 'avg', 'count',
	'reduce', 'some', 'all', 'matches', 'search', 'nearby', 'approaching', 'departing',
]);

export type StringifierKind = 'person' | 'item' | 'list' | 'number' | 'bool' | 'entity';

export type Stringifiers = Partial<Record<StringifierKind, (value:ExprVal)=>string>>;

export type NativeFn = (args:ExprVal[], ctx:EvalCtx)=>ExprVal;

export type Catalog = {
	names:Map<string, ExprVal>;
	fns:Map<string, NativeFn>;
	me:ExprEntity;
	cache:SampleCache;
	stringifiers?:Stringifiers;
	/** Host maps entity → stringifier key. Default is `entity`. */
	stringifierKind?:(entity:ExprEntity)=>StringifierKind;
};

export type EvalCtx = {
	catalog:Catalog;
	env:Map<string, ExprVal>;
	nodes:number;
};

export class SampleCache {
	private dist = new Map<string, number>();
	private nextDist = new Map<string, number>();
	private seen = new Map<string, boolean>();
	private nextSeen = new Map<string, boolean>();
	private facing = new Map<string, number | boolean>();
	private nextFacing = new Map<string, number | boolean>();
	private hp = new Map<string, number>();
	private nextHP = new Map<string, number>();
	private open = new Map<string, boolean>();
	private nextOpen = new Map<string, boolean>();

	static pair(a:string, b:string):string {
		return `${a}\0${b}`;
	}

	static undirected(a:string, b:string):string {
		return a < b ? `${a}\0${b}` : `${b}\0${a}`;
	}

	rememberDist(a:string, b:string, d:number):number | undefined {
		const k = SampleCache.undirected(a, b);
		this.nextDist.set(k, d);
		return this.dist.get(k);
	}

	rememberSeen(a:string, b:string, v:boolean):boolean | undefined {
		const k = SampleCache.pair(a, b);
		this.nextSeen.set(k, v);
		return this.seen.get(k);
	}

	rememberFacing(a:string, b:string, v:number | boolean):number | boolean | undefined {
		const k = SampleCache.pair(a, b);
		this.nextFacing.set(k, v);
		return this.facing.get(k);
	}

	rememberHP(id:string, v:number):number | undefined {
		this.nextHP.set(id, v);
		return this.hp.get(id);
	}

	rememberOpen(id:string, v:boolean):boolean | undefined {
		this.nextOpen.set(id, v);
		return this.open.get(id);
	}

	commit():void {
		for (const [k, v] of this.nextDist) {
			this.dist.set(k, v);
		}
		this.nextDist.clear();
		for (const [k, v] of this.nextSeen) {
			this.seen.set(k, v);
		}
		this.nextSeen.clear();
		for (const [k, v] of this.nextFacing) {
			this.facing.set(k, v);
		}
		this.nextFacing.clear();
		for (const [k, v] of this.nextHP) {
			this.hp.set(k, v);
		}
		this.nextHP.clear();
		for (const [k, v] of this.nextOpen) {
			this.open.set(k, v);
		}
		this.nextOpen.clear();
	}
}

export function entityName(e:ExprEntity):string {
	return e.name ?? e.id;
}

export function isTruthy(v:ExprVal):boolean {
	switch (v.kind) {
		case 'absent':
			return false;
		case 'bool':
			return v.value;
		case 'number':
			return v.value !== 0;
		case 'string':
			return v.value.length > 0;
		case 'list':
			return v.value.length > 0;
		case 'entity':
			return true;
		case 'fn':
		case 'lambda':
			return true;
	}
}

export function asBool(v:ExprVal):boolean {
	return isTruthy(v);
}

export function asNum(v:ExprVal | undefined):number | undefined {
	if (!v) {
		return undefined;
	}
	if (v.kind === 'number') {
		return v.value;
	}
	if (v.kind === 'bool') {
		return v.value ? 1 : 0;
	}
	return undefined;
}

export function needleMatch(e:ExprEntity, needle:string):boolean {
	if (e.id === needle || e.name === needle) {
		return true;
	}
	return e.tags.includes(needle);
}

export function capList(items:ExprVal[]):ExprVal {
	if (items.length > LIST_CAP) {
		throw new ExprError('list cap', 'capTie');
	}
	return { kind: 'list', value: items };
}
