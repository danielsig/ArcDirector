import type { VerbDef } from '../arc/stock-verbs.js';

export const STOCK_FORMATION_VERBS = ['spread', 'circle', 'hold_line'] as const;

export const STOCK_COLLECTIVE_VERBS = [
	'command',
	'tag',
	'untag',
	...STOCK_FORMATION_VERBS,
] as const;

export type StockCollectiveVerb = (typeof STOCK_COLLECTIVE_VERBS)[number];

export const STOCK_COLLECTIVE_VERB_DEFS = {
	command: { args: { who: 'expr', arc: 'arc', group: 'string?', append: 'bool?' }, help: 'assigns a sticky program to matching units, never the commander; two or more: name them, group=Name', channel: '' },
	tag: { args: { who: 'expr', name: 'string' }, help: 'assigns only', channel: '' },
	untag: { args: { who: 'expr', name: 'string' }, help: 'assigns only', channel: '' },
	spread: { args: { around: 'id?', paces: 'number?' } },
	circle: { args: { around: 'id?', paces: 'number?' } },
	hold_line: { args: { at: 'id?', facing: 'id?', paces: 'number?' }, seen: 'holding the line' },
} as const satisfies Record<StockCollectiveVerb, VerbDef>;

export function isFormationVerb(name:string):boolean {
	return (STOCK_FORMATION_VERBS as readonly string[]).includes(name);
}
