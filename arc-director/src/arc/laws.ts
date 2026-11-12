import type { Arc } from './arc-types.js';
import { reactionArm, reactionFinished, type ArcHandler, type Reaction, type ReactionProgress } from './run.js';
import { arcArg } from './wire.js';
import type { VerbRegistry } from './stock-verbs.js';

/**
 * A standing reaction of a runner, until `unlaw`: when `watch` becomes true for a character it reaches, that character
 * drops what it is doing and runs `arc` to its end. Its `times` and `until` count for each character on its own.
 */
export type Law = Reaction & {
	name:string;
	who:string;
	pinned?:boolean;
	/** How far it has got for each character it has reached, by id. Only with `times` or `until`. */
	progress?:Record<string, ReactionProgress>;
};

export type LawSpec = Omit<Reaction, 'arc'> & {
	name?:string;
	who?:string;
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
	return {
		name,
		who,
		watch,
		arc,
		pinned: spec.pinned,
		times: spec.times,
		until: spec.until?.trim() || undefined,
		...spec.rearm === undefined ? {} : { rearm: spec.rearm },
	};
}

/** `law` as a reaction of the character `id`, at `rank`. */
export function lawHandler(law:Law, rank:number, id:string):ArcHandler {
	const progress = law.times !== undefined || law.until ? (law.progress ??= {})[id] ??= { runs: 0 } : undefined;
	return { source: law, watch: law.watch, arc: law.arc, times: law.times, until: law.until, rearm: law.rearm, rank, progress, arm: reactionArm(law, id) };
}

/** Whether `law` has finished for someone and for all `reached` says it reaches now, so it can go. */
export function lawFinished(law:Law, reached:()=>readonly string[]):boolean {
	const done = (id:string):boolean => reactionFinished(law.times, law.progress?.[id]);
	return Object.keys(law.progress ?? {}).some(done) && reached().every(done);
}

/**
 * Add `next`, or update the law of that name in place. Running handlers hold the law itself, so an
 * edited law still counts as running, and one written again with the same `times` and `until` keeps its count. A
 * pinned law only takes pinned edits. Each group holds at most `max`; own laws stay ahead of members' laws, so they
 * outrank them.
 */
export function upsertLaw(laws:Law[], next:Law, max:number):Law[] {
	const old = laws.find((s) => s.name === next.name);
	if (old) {
		if (!old.pinned || next.pinned) {
			if (old.times !== next.times || old.until !== next.until) {
				old.progress = undefined;
			}
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
