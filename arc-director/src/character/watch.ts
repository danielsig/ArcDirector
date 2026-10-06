import { isRecord } from '../json.js';
import type { Watches } from './types.js';

export function watchKey(name:string):string {
	return name.trim().toLowerCase();
}

export function watchCount(dict:Watches):number {
	return Object.keys(dict).length;
}

export function copyWatches(dict:Watches):Watches {
	return { ...dict };
}

/** Stored key for `name`, if any (case-insensitive). */
export function findWatchName(dict:Watches, name:string):string | undefined {
	const key = watchKey(name);
	if (!key) {
		return undefined;
	}
	for (const n of Object.keys(dict)) {
		if (watchKey(n) === key) {
			return n;
		}
	}
	return undefined;
}

export function hasWatch(dict:Watches, name:string):boolean {
	return findWatchName(dict, name) !== undefined;
}

function dropWatch(dict:Watches, name:string):Watches {
	const k = findWatchName(dict, name);
	if (!k) {
		return dict;
	}
	const next = { ...dict };
	delete next[k];
	return next;
}

function isLegacyWatchObject(raw:Record<string, unknown>):boolean {
	const expr = raw.expr ?? raw.watch;
	const name = raw.name ?? raw.id;
	return typeof expr === 'string' && typeof name === 'string';
}

/** One `{ name, expr }` from a list item or a lone object. `id` aliases `name`. */
export function asWatch(raw:unknown, fallbackName?:string):{ name:string; expr:string } | undefined {
	if (typeof raw === 'string') {
		const expr = raw.trim();
		const name = (fallbackName ?? '').trim();
		if (!expr || !name) {
			return undefined;
		}
		return { name, expr };
	}
	if (!isRecord(raw)) {
		return undefined;
	}
	const nameRaw = typeof raw.name === 'string'
		? raw.name
		: typeof raw.id === 'string'
			? raw.id
			: fallbackName ?? '';
	const exprRaw = typeof raw.expr === 'string'
		? raw.expr
		: typeof raw.watch === 'string'
			? raw.watch
			: '';
	const name = nameRaw.trim();
	const expr = exprRaw.trim();
	if (!name || !expr) {
		return undefined;
	}
	return { name, expr };
}

function putWatch(out:Watches, seen:Set<string>, name:string, expr:string):void {
	const key = watchKey(name);
	if (!key || seen.has(key)) {
		return;
	}
	seen.add(key);
	out[name] = expr;
}

/** Dict name → expr. Also accepts a list of `{ name, expr }` / strings, or a lone `{ name, expr }`. */
export function asWatches(raw:unknown):Watches {
	if (raw == null) {
		return {};
	}
	if (Array.isArray(raw)) {
		const out:Watches = {};
		const seen = new Set<string>();
		let n = 0;
		for (const row of raw) {
			n += 1;
			const fallback = typeof row === 'string' ? `watch_${n}` : undefined;
			const w = asWatch(row, fallback);
			if (w) {
				putWatch(out, seen, w.name, w.expr);
			}
		}
		return out;
	}
	if (!isRecord(raw)) {
		return {};
	}
	if (isLegacyWatchObject(raw)) {
		const w = asWatch(raw);
		return w ? { [w.name]: w.expr } : {};
	}
	const out:Watches = {};
	const seen = new Set<string>();
	for (const [k, v] of Object.entries(raw)) {
		if (typeof v === 'string') {
			const name = k.trim();
			const expr = v.trim();
			if (name && expr) {
				putWatch(out, seen, name, expr);
			}
			continue;
		}
		const w = asWatch(v, k);
		if (w) {
			putWatch(out, seen, w.name, w.expr);
		}
	}
	return out;
}

export type WatchOps = {
	add:Watches;
	edit:Watches;
	remove:string[];
};

/** Drop extras whose names collide with pins. Pins win. */
export function extrasWithoutPins(extras:Watches, pinned:Watches):Watches {
	const out:Watches = {};
	for (const [name, expr] of Object.entries(extras)) {
		if (!hasWatch(pinned, name)) {
			out[name] = expr;
		}
	}
	return out;
}

/** Host pins first; skip saved pins that reuse a host name or expr. */
export function mergePinnedWatches(host:Watches, saved:Watches):Watches {
	const out = copyWatches(host);
	const names = new Set(Object.keys(out).map(watchKey));
	const exprs = new Set(Object.values(out));
	for (const [name, expr] of Object.entries(saved)) {
		const key = watchKey(name);
		if (!key || names.has(key) || exprs.has(expr)) {
			continue;
		}
		names.add(key);
		exprs.add(expr);
		out[name] = expr;
	}
	return out;
}

/**
 * Apply LLM/host ops to extra watches. Pinned names cannot be added, edited, or removed.
 * Order: remove, then edit, then add.
 */
export function applyWatchOps(extras:Watches, pinned:Watches, ops:WatchOps):Watches {
	let next = copyWatches(extras);
	for (const name of ops.remove) {
		if (hasWatch(pinned, name)) {
			continue;
		}
		next = dropWatch(next, name);
	}
	for (const [name, expr] of Object.entries(ops.edit)) {
		if (hasWatch(pinned, name)) {
			continue;
		}
		const k = findWatchName(next, name);
		if (k) {
			next = { ...next, [k]: expr };
		}
	}
	for (const [name, expr] of Object.entries(ops.add)) {
		if (hasWatch(pinned, name) || hasWatch(next, name)) {
			continue;
		}
		next = { ...next, [name]: expr };
	}
	return next;
}

export function formatWatch(name:string, expr:string):string {
	return `- ${name}: ${expr}`;
}

export function formatWatches(dict:Watches):string {
	return Object.entries(dict).map(([name, expr]) => formatWatch(name, expr)).join('\n');
}

export function watchExprs(dict:Watches):string[] {
	return Object.values(dict);
}

export function watchNames(dict:Watches):string[] {
	return Object.keys(dict);
}
