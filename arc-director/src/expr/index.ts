export { evaluate, builtins } from './eval.js';
export { parse } from './parse.js';
export { lex } from './lex.js';
export { buildCatalog, dummyEntity, type HostKernels } from './natives.js';
export { stringifyVal, observeExpr } from './stringify.js';
export { watchScore, clampTrueScore } from './score.js';
export {
	ABSENT,
	AST_CAP,
	DEFAULT_EPSILON,
	DEFAULT_TRUE_SCORE,
	DIST_EPS,
	ExprError,
	FACING_COS,
	LIST_CAP,
	RESERVED,
	SampleCache,
	type Catalog,
	type ExprEntity,
	type ExprVal,
	type NativeFn,
	type ScoldReason,
	type StringifierKind,
	type Stringifiers,
} from './types.js';
