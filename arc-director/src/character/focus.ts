const DEFAULT_MAX_SIGHT_FOCUS = 8;

export function asFocusList(raw:unknown, cap = DEFAULT_MAX_SIGHT_FOCUS):string[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const out:string[] = [];
	const seen = new Set<string>();
	for (const row of raw) {
		const expr = typeof row === 'string' ? row.trim() : '';
		if (!expr || seen.has(expr)) {
			continue;
		}
		seen.add(expr);
		out.push(expr);
		if (out.length >= cap) {
			break;
		}
	}
	return out;
}

export function extrasWithoutPinnedFocus(extras:string[], pins:string[]):string[] {
	const pinned = new Set(pins);
	return extras.filter((expr) => !pinned.has(expr));
}

/** Host pins first; skip saved pins that reuse a host expr. */
export function mergePinnedFocus(host:string[], saved:string[]):string[] {
	const out = [...host];
	const seen = new Set(out);
	for (const expr of saved) {
		if (!expr || seen.has(expr)) {
			continue;
		}
		seen.add(expr);
		out.push(expr);
	}
	return out;
}

export function effectiveSightFocus(pins:string[], extras:string[]):string[] {
	return [...pins, ...extrasWithoutPinnedFocus(extras, pins)];
}

export { DEFAULT_MAX_SIGHT_FOCUS };
