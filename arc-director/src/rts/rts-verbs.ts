import type { VerbDef, VerbRegistry } from '../arc/stock-verbs.js';

/**
 * Economy verbs: a commander calls them and names who does the work (`by` workers, `at` buildings), and they finish
 * once the work is handed out. Inside a unit's own program the unit does the work itself, and they finish when it is done.
 */
export const STOCK_ECONOMY_VERBS = ['gather', 'build', 'wall', 'bridge', 'repair', 'train', 'research', 'cancel', 'rally'] as const;
/** Unit verbs: given to units with `issue` or `law`. */
export const STOCK_UNIT_VERBS = ['attack', 'attack_move', 'hold', 'patrol', 'garrison', 'unload'] as const;
/** Verbs a commander runs for its side as a whole. */
export const STOCK_SIDE_VERBS = ['tribute'] as const;
/** City-builder verbs: stock, for games with jobs, goods and policies. */
export const STOCK_CITY_VERBS = ['staff', 'haul', 'set_policy'] as const;

export const STOCK_RTS_VERBS = [...STOCK_ECONOMY_VERBS, ...STOCK_UNIT_VERBS, ...STOCK_SIDE_VERBS, ...STOCK_CITY_VERBS] as const;
export type StockRTSVerb = (typeof STOCK_RTS_VERBS)[number];

export const STOCK_RTS_VERB_DEFS = {
	gather: { args: { from: 'string', by: 'expr?', workers: 'number?', drop_at: 'id?' }, help: 'from a node, or a resource (Wood) for the nearest of it; they carry it back until told otherwise' },
	build: { args: { what: 'string', near: 'id?', count: 'number?', by: 'expr?', workers: 'number?' }, help: 'pays up front; near an unfinished one of it: helps build that' },
	wall: { args: { from: 'id', to: 'id', what: 'string?', gates: 'number?', by: 'expr?', workers: 'number?' }, help: 'a line of wall from one place to the other, paid up front; gates: how many in it your side walks through' },
	bridge: { args: { from: 'id', to: 'id', what: 'string?', by: 'expr?', workers: 'number?' }, help: 'a bridge over the water from one shore to the other, paid up front; it is built out from the near shore' },
	repair: { args: { target: 'id', by: 'expr?', workers: 'number?' }, help: 'pays as it goes' },
	train: { args: { what: 'string', count: 'number?', at: 'expr?', rally: 'id?' }, help: 'count in total, split so they finish soonest; waits for a building still being built' },
	research: { args: { what: 'string', at: 'expr?' } },
	cancel: { args: { what: 'string?', at: 'expr?' }, help: 'refunds it; an unfinished building: part of its cost' },
	rally: { args: { to: 'id', at: 'expr?' }, help: 'where new units go' },
	attack: { args: { target: 'expr' }, help: 'one foe or a list, killed in order' },
	attack_move: { args: { to: 'id', focus: 'expr?' }, help: 'fights what it meets on the way; focus: foes it prefers', seen: 'advancing on {to}' },
	hold: { args: { at: 'id?', fire_within: 'number?', focus: 'expr?' }, help: 'stays and never chases; fire_within: holds fire until a foe is that close' },
	patrol: { args: { to: 'id', focus: 'expr?' }, help: 'back and forth from here, fighting what it meets' },
	garrison: { args: { in: 'id' }, help: 'a building or transport; stays inside until let out' },
	unload: { args: { at: 'id?' }, help: 'a building or transport lets everyone out, at a place first if it moves' },
	tribute: { args: { to: 'id', give: 'bundle' }, help: 'to an ally, as {"Gold":100}' },
	staff: { args: { at: 'expr', workers: 'number?', by: 'expr?' }, help: 'puts workers on its jobs; workers=0 frees them' },
	haul: { args: { what: 'string', from: 'id', to: 'id', by: 'expr?', workers: 'number?', keep: 'number?' }, help: 'carries it over and over; keep: stops once there are that many there' },
	set_policy: { args: { name: 'string', to: 'string' }, seen: 'setting a policy' },
} as const satisfies Record<StockRTSVerb, VerbDef>;

/** Schema-only. Omit `verbs` to register them all. Already-registered names are skipped. */
export function registerStockRTSVerbs(registry:VerbRegistry, ...verbs:StockRTSVerb[]):VerbRegistry {
	const list = verbs.length > 0 ? verbs : STOCK_RTS_VERBS;
	for (const name of list) {
		if (!(name in STOCK_RTS_VERB_DEFS)) {
			throw new Error(`ArcDirector: '${name}' is not a stock RTS verb`);
		}
		if (!registry.has(name)) {
			registry.add(name, STOCK_RTS_VERB_DEFS[name]);
		}
	}
	return registry;
}
