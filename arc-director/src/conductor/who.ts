import type { Arc } from '../arc/types.js';
import { isArc } from '../arc/validate.js';
import { parseArc } from '../arc/parse.js';
import type { VerbRegistry } from '../arc/stock-verbs.js';
import { evaluate } from '../expr/eval.js';
import { dummyEntity, type HostKernels } from '../expr/natives.js';
import { buildCatalog } from '../expr/natives.js';
import type { Catalog, ExprEntity, ExprVal } from '../expr/types.js';
import { CrowdUnit } from './unit.js';
import { shortTag } from './tags.js';
import type { Crowd } from './crowd.js';

export function unitEntity(unit:CrowdUnit, conductorID:string):ExprEntity {
	const shorts = unit.tags
		.map((t) => shortTag(conductorID, t))
		.filter((t) => t.length > 0);
	return dummyEntity(unit.id, {
		tags: shorts,
		fields: {
			busy: { kind: 'bool', value: unit.busy },
			verb: { kind: 'string', value: unit.verb },
		},
	});
}

export function withUnitsCatalog(base:Catalog, units:ExprVal, listCap:number):Catalog {
	const names = new Map(base.names);
	names.set('units', units);
	return { ...base, names, listCap };
}

function asList(entities:ExprEntity[]):ExprVal {
	return {
		kind: 'list',
		value: entities.map((e) => ({ kind: 'entity' as const, value: e })),
	};
}

export function crowdKernels(
	base:HostKernels,
	crowd:Crowd,
	conductorID:string,
	commanderID?:string | null,
):HostKernels {
	const all = crowd.list();
	const commander = commanderID ? crowd.get(commanderID) : undefined;
	const troops = commanderID
		? all.filter((u) => u.id !== commanderID)
		: all;
	const allEntities = all.map((u) => unitEntity(u, conductorID));
	const troopEntities = troops.map((u) => unitEntity(u, conductorID));
	const me = commander
		? unitEntity(commander, conductorID)
		: (base.me ?? dummyEntity(conductorID, { tags: ['agent'] }));
	return {
		...base,
		me,
		listCap: Math.max(crowd.size, 1),
		bindings: {
			...base.bindings,
			me: { kind: 'entity', value: me },
			units: asList(troopEntities),
			allUnits: asList(allEntities),
		},
	};
}

export function unitsFromVal(value:ExprVal, crowd:Crowd):CrowdUnit[] {
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
	const out:CrowdUnit[] = [];
	const seen = new Set<string>();
	for (const id of ids) {
		if (seen.has(id)) {
			continue;
		}
		seen.add(id);
		const unit = crowd.get(id);
		if (unit) {
			out.push(unit);
		}
	}
	return out;
}

export function evaluateWho(who:string, catalog:Catalog, crowd:Crowd):CrowdUnit[] {
	const r = evaluate(who, catalog);
	if (r.error) {
		return [];
	}
	return unitsFromVal(r.value, crowd);
}

export function arcArg(raw:unknown, registry:VerbRegistry):Arc | undefined {
	if (isArc(raw)) {
		return raw;
	}
	if (typeof raw === 'string' && raw.trim()) {
		try {
			return parseArc(raw, registry);
		}
		catch {
			return undefined;
		}
	}
	return undefined;
}

export function buildCrowdCatalog(
	base:HostKernels,
	crowd:Crowd,
	conductorID:string,
	commanderID?:string | null,
):Catalog {
	return buildCatalog(crowdKernels(base, crowd, conductorID, commanderID));
}
