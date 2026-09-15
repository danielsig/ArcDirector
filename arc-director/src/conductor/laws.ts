import type { ActionPlan } from '../action/types.js';
import { parsePlan } from '../action/parse.js';
import type { VerbRegistry } from '../action/registry.js';
import { isActionPlan } from '../action/validate.js';
import { evaluate } from '../expr/eval.js';
import type { Catalog } from '../expr/types.js';
import { watchScore } from '../expr/score.js';
import type { CrowdUnit } from './unit.js';
import { evaluateWho } from './select.js';
import type { Crowd } from './crowd.js';

export type CrowdLaw = {
	name:string;
	who:string;
	watch:string;
	plan:ActionPlan;
	pinned?:boolean;
};

export type CrowdLawSpec = {
	name?:string;
	who?:string;
	watch:string;
	plan:ActionPlan | string;
	pinned?:boolean;
};

export const DEFAULT_MAX_LAWS = 8;

export function asLawPlan(raw:ActionPlan | string, registry:VerbRegistry):ActionPlan | undefined {
	if (isActionPlan(raw)) {
		return raw;
	}
	if (typeof raw === 'string' && raw.trim()) {
		try {
			return parsePlan(raw, registry);
		}
		catch {
			return undefined;
		}
	}
	return undefined;
}

export function lawFromSpec(spec:CrowdLawSpec, registry:VerbRegistry, fallbackName:string):CrowdLaw | undefined {
	const plan = asLawPlan(spec.plan, registry);
	const who = (spec.who ?? 'units').trim() || 'units';
	const watch = spec.watch.trim();
	if (!plan || !watch) {
		return undefined;
	}
	const name = (spec.name ?? fallbackName).trim();
	if (!name) {
		return undefined;
	}
	return { name, who, watch, plan, pinned: spec.pinned };
}

export function upsertLaw(laws:CrowdLaw[], next:CrowdLaw, max:number):CrowdLaw[] {
	const i = laws.findIndex((s) => s.name === next.name);
	if (i >= 0) {
		if (laws[i].pinned && !next.pinned) {
			return laws;
		}
		const copy = [...laws];
		copy[i] = next;
		return copy;
	}
	if (laws.length >= max) {
		return laws;
	}
	return [...laws, next];
}

export function dropLaw(laws:CrowdLaw[], name:string):CrowdLaw[] {
	return laws.filter((s) => s.name !== name || s.pinned);
}

export function lawWatchTrue(watch:string, catalog:Catalog, trueScore?:number):boolean {
	const r = evaluate(watch, catalog);
	if (r.error) {
		return false;
	}
	return watchScore(r.value, trueScore).score > 0;
}

export function lawMatches(
	law:CrowdLaw,
	unit:CrowdUnit,
	whoCatalog:Catalog,
	crowd:Crowd,
):boolean {
	return evaluateWho(law.who, whoCatalog, crowd).some((u) => u.id === unit.id);
}
