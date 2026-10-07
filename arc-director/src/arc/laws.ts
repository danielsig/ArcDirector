import type { Arc } from './types.js';
import { arcArg } from './parse.js';
import type { VerbRegistry } from './stock-verbs.js';

/** A standing reaction: while `watch` holds, the runner drops what it is doing and runs `arc`. */
export type Law = {
	name:string;
	who:string;
	watch:string;
	arc:Arc;
	pinned?:boolean;
};

export type LawSpec = {
	name?:string;
	who?:string;
	watch:string;
	arc:Arc | string;
	pinned?:boolean;
};

/** Most laws per group: a collective's own laws, and each member's. */
export const DEFAULT_MAX_LAWS = 8;

/** A member's law is `Tom.flee`, in group `Tom`; ids may hold dots, so the group ends at the last one. Own laws: `''`. */
export function lawGroup(name:string):string {
	const dot = name.lastIndexOf('.');
	return dot < 0 ? '' : name.slice(0, dot);
}

export function lawFromSpec(
	spec:LawSpec,
	registry:VerbRegistry,
	fallbackName:string,
	defaultWho = 'units',
):Law | undefined {
	const arc = arcArg(spec.arc, registry);
	const who = (spec.who ?? defaultWho).trim() || defaultWho;
	const watch = spec.watch.trim();
	if (!arc || !watch) {
		return undefined;
	}
	const name = (spec.name ?? fallbackName).trim();
	if (!name) {
		return undefined;
	}
	return { name, who, watch, arc, pinned: spec.pinned };
}

/**
 * Add `next`, or update the law of that name in place. Running handlers hold the law itself, so an
 * edited law still counts as running. A pinned law only takes pinned edits. Each group holds at most `max`;
 * own laws stay ahead of members' laws, so they outrank them.
 */
export function upsertLaw(laws:Law[], next:Law, max:number):Law[] {
	const old = laws.find((s) => s.name === next.name);
	if (old) {
		if (!old.pinned || next.pinned) {
			Object.assign(old, next);
		}
		return laws;
	}
	const group = lawGroup(next.name);
	if (laws.filter((s) => lawGroup(s.name) === group).length >= max) {
		return laws;
	}
	const firstMember = laws.findIndex((s) => lawGroup(s.name) !== '');
	if (group !== '' || firstMember < 0) {
		return [...laws, next];
	}
	return [...laws.slice(0, firstMember), next, ...laws.slice(firstMember)];
}

export function dropLaw(laws:Law[], name:string):Law[] {
	return laws.filter((s) => s.name !== name || s.pinned);
}
