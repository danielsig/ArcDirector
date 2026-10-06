import { VerbRegistry, type VerbDef } from '../arc/stock-verbs.js';

export const STOCK_FORMATION_VERBS = ['spread', 'circle', 'hold_line'] as const;

export const STOCK_CROWD_VERBS = [
	'issue',
	'tag',
	'untag',
	...STOCK_FORMATION_VERBS,
] as const;

export type StockCrowdVerb = (typeof STOCK_CROWD_VERBS)[number];

export const STOCK_CROWD_VERB_DEFS = {
	issue: { args: { who: 'string', arc: 'arc' }, help: 'assigns a sticky program to matching units, never the commander' },
	tag: { args: { who: 'string', name: 'string' }, help: 'assigns only' },
	untag: { args: { who: 'string', name: 'string' }, help: 'assigns only' },
	spread: { args: { around: 'id?', paces: 'number?' } },
	circle: { args: { around: 'id?', paces: 'number?' } },
	hold_line: { args: { at: 'id?', facing: 'id?', paces: 'number?' } },
} as const satisfies Record<StockCrowdVerb, VerbDef>;

export function isFormationVerb(name:string):boolean {
	return (STOCK_FORMATION_VERBS as readonly string[]).includes(name);
}

export function registerStockCrowdVerbs(registry:VerbRegistry, ...verbs:StockCrowdVerb[]):VerbRegistry {
	const list = verbs.length > 0 ? verbs : STOCK_CROWD_VERBS;
	for (const name of list) {
		if (!(name in STOCK_CROWD_VERB_DEFS)) {
			throw new Error(`ArcDirector: '${name}' is not a stock crowd verb`);
		}
		if (!registry.has(name)) {
			registry.add(name, STOCK_CROWD_VERB_DEFS[name]);
		}
	}
	return registry;
}
