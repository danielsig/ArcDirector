import type { Law } from '../arc/laws.js';
import type { VerbRegistry } from '../arc/stock-verbs.js';
import { mapArc, mapExpr } from '../mind/ids.js';
import { evaluate } from '../expr/eval.js';
import { buildCatalog, dummyEntity, type HostKernels } from '../expr/natives.js';
import { LIST_CAP, type Catalog, type ExprEntity, type ExprVal } from '../expr/types.js';
import { RESERVED_TAGS } from '../world/types.js';
import type { Character } from '../character/character.js';
import type { Collective } from './collective.js';
import { shortTags } from './tags.js';

/**
 * What a character is at, as `isBusy` and `doing` read it: `busy`, its verb, and what it is at in a kit's words where one
 * says (`gathering Wood`).
 */
export function doingFields<TCtx>(character:Character<TCtx>):NonNullable<ExprEntity['fields']> {
	return {
		busy: { kind: 'bool', value: character.busy },
		verb: { kind: 'string', value: character.verb },
		...character.work ? { doing: { kind: 'string', value: character.work } as const } : {},
	};
}

/** A character as its collective sees it in `units`: its tags (the collective's own shortened), and what it is at. */
export function memberEntity<TCtx>(character:Character<TCtx>, collectiveID:string):ExprEntity {
	return dummyEntity(character.id, {
		tags: shortTags(collectiveID, character.tags),
		fields: doingFields(character),
	});
}

function asList(entities:ExprEntity[]):ExprVal {
	return {
		kind: 'list',
		value: entities.map((e) => ({ kind: 'entity' as const, value: e })),
	};
}

/**
 * `base` plus `units` (every member still standing but the commander) and `allUnits`. `me` is whom `base` was built for, as a
 * member, so a unit's own law or arc reads itself; or `as`, when the view is someone else's (its mind's, through a
 * member's eyes, is its commander's).
 */
export function collectiveKernels<TCtx>(base:HostKernels, collective:Collective<TCtx>, as?:Character<TCtx>):HostKernels {
	const all = collective.standing;
	const commander = collective.commander;
	const troops = commander ? all.filter((c) => c !== commander) : all;
	const self = as ?? all.find((c) => c.id === base.me?.id);
	const member = self && memberEntity(self, collective.id);
	const me = member && base.me?.id === self.id
		? { ...base.me, tags: [...new Set([...base.me.tags, ...member.tags])], fields: { ...base.me.fields, ...member.fields } }
		: member ?? base.me ?? dummyEntity(collective.id, { tags: [RESERVED_TAGS.character] });
	return {
		...base,
		me,
		// Room for every member in `units`, never less than any other list gets: a squad of two still sees four foes.
		listCap: Math.max(all.length, base.listCap ?? LIST_CAP),
		bindings: {
			...base.bindings,
			me: { kind: 'entity', value: me },
			units: asList(troops.map((c) => memberEntity(c, collective.id))),
			allUnits: asList(all.map((c) => memberEntity(c, collective.id))),
		},
	};
}

export function buildCollectiveCatalog<TCtx>(base:HostKernels, collective:Collective<TCtx>, as?:Character<TCtx>):Catalog {
	return buildCatalog(collectiveKernels(base, collective, as));
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
