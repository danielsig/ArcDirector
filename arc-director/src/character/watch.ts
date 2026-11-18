import { isRecord } from '../json.js';
import type { Watches } from './character-types.js';

function watchKey(name:string):string {
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

/** One `{ name, expr }` from a lone object or a dict value. `id` aliases `name`. */
function asWatch(raw:unknown, fallbackName?:string):{ name:string; expr:string } | undefined {
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

/** Dict name → expr. Also accepts a lone `{ name, expr }`. */
export function asWatches(raw:unknown):Watches {
	if (raw == null) {
		return {};
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

function formatWatch(name:string, expr:string):string {
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
