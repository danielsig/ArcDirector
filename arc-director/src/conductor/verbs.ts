import { VerbRegistry, type VerbArgMap } from '../action/registry.js';

export const STOCK_CROWD_VERBS = [
	'when',
	'law',
	'unlaw',
	'tag',
	'untag',
	'spread',
	'circle',
	'hold_line',
] as const;

export type StockCrowdVerb = (typeof STOCK_CROWD_VERBS)[number];

export const FORMATION_VERBS = new Set(['spread', 'circle', 'hold_line']);

export const STOCK_CROWD_VERB_ARGS:Record<StockCrowdVerb, VerbArgMap> = {
	when: { who: 'string?', watch: 'string?', plan: 'plan', name: 'string?' },
	law: { who: 'string?', watch: 'string', plan: 'plan', name: 'string?' },
	unlaw: { name: 'string' },
	tag: { who: 'string', name: 'string' },
	untag: { who: 'string', name: 'string' },
	spread: { around: 'id?', paces: 'number?' },
	circle: { around: 'id?', paces: 'number?' },
	hold_line: { at: 'id?', facing: 'id?', paces: 'number?' },
};

export function registerStockCrowdVerbs(registry:VerbRegistry, ...verbs:StockCrowdVerb[]):VerbRegistry {
	const list = verbs.length > 0 ? verbs : STOCK_CROWD_VERBS;
	for (const name of list) {
		if (!(name in STOCK_CROWD_VERB_ARGS)) {
			throw new Error(`ArcDirector: '${name}' is not a stock crowd verb`);
		}
		if (!registry.has(name)) {
			registry.add(name, STOCK_CROWD_VERB_ARGS[name]);
		}
	}
	return registry;
}
