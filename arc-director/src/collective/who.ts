import type { Law } from '../arc/laws.js';
import type { VerbRegistry } from '../arc/stock-verbs.js';
import { mapArc, mapExpr } from '../mind/ids.js';
import { evaluate } from '../expr/eval.js';
import { buildCatalog, dummyEntity, type HostKernels } from '../expr/natives.js';
import type { Catalog, ExprEntity, ExprVal } from '../expr/types.js';
import { RESERVED_TAGS } from '../world/types.js';
import type { Character } from '../character/character.js';
import type { Collective } from './collective.js';
import { shortTags } from './tags.js';

/** A character as its collective sees it in `units`: its tags (the collective's own shortened), `busy`, and its verb. */
export function memberEntity<TCtx>(character:Character<TCtx>, collectiveID:string):ExprEntity {
	return dummyEntity(character.id, {
		tags: shortTags(collectiveID, character.tags),
		fields: {
			busy: { kind: 'bool', value: character.busy },
			verb: { kind: 'string', value: character.verb },
		},
	});
}

function asList(entities:ExprEntity[]):ExprVal {
	return {
		kind: 'list',
		value: entities.map((e) => ({ kind: 'entity' as const, value: e })),
	};
}

/** `base` plus `units` (every member but the commander) and `allUnits`; `me` is the commander, if any. */
export function collectiveKernels<TCtx>(base:HostKernels, collective:Collective<TCtx>):HostKernels {
	const all = collective.characters;
	const commander = collective.commander;
	const troops = commander ? all.filter((c) => c !== commander) : all;
	const me = commander
		? memberEntity(commander, collective.id)
		: (base.me ?? dummyEntity(collective.id, { tags: [RESERVED_TAGS.character] }));
	return {
		...base,
		me,
		listCap: Math.max(all.length, 1),
		bindings: {
			...base.bindings,
			me: { kind: 'entity', value: me },
			units: asList(troops.map((c) => memberEntity(c, collective.id))),
			allUnits: asList(all.map((c) => memberEntity(c, collective.id))),
		},
	};
}

export function buildCollectiveCatalog<TCtx>(base:HostKernels, collective:Collective<TCtx>):Catalog {
	return buildCatalog(collectiveKernels(base, collective));
}

/** The members a `who` value names: entities, lists of them, or ids. */
export function membersFromVal<TCtx>(value:ExprVal, collective:Collective<TCtx>):Character<TCtx>[] {
	const ids:string[] = [];
	const take = (v:ExprVal):void => {
		if (v.kind === 'entity') {
			ids.push(v.value.id);
		}
		else if (v.kind === 'list') {
			for (const row of v.value) {
				take(row);
			}
		}
		else if (v.kind === 'string' && v.value) {
			ids.push(v.value);
		}
	};
	take(value);
	const out:Character<TCtx>[] = [];
	for (const id of new Set(ids)) {
		const member = collective.character(id);
		if (member) {
			out.push(member);
		}
	}
	return out;
}

export function evaluateWho<TCtx>(who:string, catalog:Catalog, collective:Collective<TCtx>):Character<TCtx>[] {
	const r = evaluate(who, catalog);
	if (r.error) {
		return [];
	}
	return membersFromVal(r.value, collective);
}

/** Whether a collective's own `law` reaches `member`: its `who` names that member. */
export function lawMatches<TCtx>(law:Law, member:Character<TCtx>, whoCatalog:Catalog, collective:Collective<TCtx>):boolean {
	return evaluateWho(law.who, whoCatalog, collective).includes(member);
}

/** Whether `law` needs a collective to make sense: it reads `units` or `allUnits`. */
export function usesCollective(law:Law, verbs:VerbRegistry):boolean {
	const words = new Set<string>();
	const note = (word:string):string => {
		words.add(word);
		return word;
	};
	mapExpr(law.who, note);
	mapExpr(law.watch, note);
	mapArc(law.arc, verbs, note);
	return words.has('units') || words.has('allUnits');
}
