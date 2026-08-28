import { entityName, type Catalog, type ExprEntity, type ExprVal, type StringifierKind } from './types.js';

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
		const kind = entityKind(value.value, catalog);
		const host = catalog?.stringifiers?.[kind]?.(value) ?? catalog?.stringifiers?.entity?.(value);
		return host ?? entityName(value.value);
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

function entityKind(entity:ExprEntity, catalog?:Catalog):StringifierKind {
	return catalog?.stringifierKind?.(entity) ?? 'entity';
}

export function observeExpr(expr:string, catalog:Catalog, evaluateFn:(e:string, c:Catalog)=>{ value:ExprVal; error?:Error }):string | { error:string } {
	const r = evaluateFn(expr, catalog);
	if (r.error) {
		return { error: r.error.message };
	}
	const text = stringifyVal(r.value, catalog);
	if (/-?\d+\.\d+,\s*-?\d+/.test(text) || /\bx\s*[:=]\s*-?\d/.test(text)) {
		return text.replace(/-?\d+\.\d+,\s*-?\d+\.\d+/g, '').trim();
	}
	return text;
}
