import { entityName, type Catalog, type ExprVal } from './expr-types.js';

export function stringifyVal(value:ExprVal, catalog?:Catalog):string {
	if (value.kind === 'absent') {
		const host = catalog?.stringifiers?.entity?.({ kind: 'absent' });
		return host ?? '';
	}
	if (value.kind === 'bool') {
		return catalog?.stringifiers?.bool?.(value) ?? (value.value ? 'true' : 'false');
	}
	if (value.kind === 'number') {
		return catalog?.stringifiers?.number?.(value)
			?? (Number.isInteger(value.value) ? String(value.value) : value.value.toFixed(2));
	}
	if (value.kind === 'string') {
		return value.value;
	}
	if (value.kind === 'entity') {
		return catalog?.stringifiers?.entity?.(value) ?? entityName(value.value);
	}
	if (value.kind === 'list') {
		const host = catalog?.stringifiers?.list?.(value);
		if (host !== undefined) {
			return host;
		}
		return value.value.map((x) => stringifyVal(x, catalog)).filter(Boolean).join(', ');
	}
	return '';
}

/**
 * What `observe` answers for `expr` in `catalog`, without coordinates. Never empty: where nothing matches it says so,
 * `No one here matches …` when it asks of others (or units), else `Nothing here matches …`, and that asking the same
 * again will not change it.
 */
export function observeExpr(expr:string, catalog:Catalog, evaluateFn:(e:string, c:Catalog)=>{ value:ExprVal; error?:Error }):string | { error:string } {
	const r = evaluateFn(expr, catalog);
	if (r.error) {
		return { error: r.error.message };
	}
	const said = stringifyVal(r.value, catalog);
	const text = /-?\d+\.\d+,\s*-?\d+/.test(said) || /\bx\s*[:=]\s*-?\d/.test(said) ? said.replace(/-?\d+\.\d+,\s*-?\d+\.\d+/g, '').trim() : said;
	if (text.trim()) {
		return text;
	}
	const asked = expr.replace(/\s+/g, ' ').trim();
	return `${/\b(others|units)\b/.test(expr) ? 'No one' : 'Nothing'} here matches ${asked}. Asking again will not change that: move, look, or act.`;
}
