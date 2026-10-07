import type { ArcResult } from '../arc/types.js';
import type { StockVerbArgs, StockVerbName, VerbArgs, VerbCall, VerbHandler } from '../director/types.js';
import type { Mover } from './mover.js';
import { poseOf } from './lookup.js';
import { reachablePoints } from './route.js';
import type { HostWorld, Vec } from './types.js';
import { add, centroid, dot, groundAxes, sub, unit } from './vec.js';

/** What the stock world verbs need besides the call itself. */
export type WorldVerbDeps<TCtx> = {
	world:HostWorld<unknown>;
	mover:Mover;
	now:()=>number;
	/** Ids the acting character sees right now. */
	seen:(call:VerbCall<TCtx>)=>string[];
};

type WorldPart = Exclude<keyof HostWorld<unknown>, 'find' | 'getPose' | 'getReach' | 'up'>;

const MOVING:WorldPart[] = ['getPathGraph', 'steerToward'];

/** The `withWorld` parts each stock world verb runs on. */
export const WORLD_VERB_PARTS:Readonly<Record<string, readonly WorldPart[]>> = {
	go_to: MOVING,
	follow: MOVING,
	wander: MOVING,
	spread: MOVING,
	circle: MOVING,
	hold_line: MOVING,
	pick_up: ['moveItem'],
	drop: ['moveItem'],
	give: ['moveItem'],
	use: ['useItem'],
	examine: ['getDescription'],
	buy: ['trade'],
	sell: ['trade'],
};

/** Parts of `world` that `verb` needs and does not have. */
export function missingParts(verb:string, world:HostWorld<unknown> | undefined):readonly WorldPart[] {
	const parts = WORLD_VERB_PARTS[verb] ?? [];
	return world ? parts.filter((part) => !world[part]) : parts;
}

/** The acting character and the thing a verb is about. */
type Found = { character:unknown; target:unknown };

type Call<TCtx, TVerb extends StockVerbName> = VerbCall<TCtx, VerbArgs<StockVerbArgs<TVerb>>>;
type Handlers<TCtx> = { [TVerb in StockVerbName]?:VerbHandler<TCtx, VerbArgs<StockVerbArgs<TVerb>>> };

const SAW_CAP = 12;
const WANDER_SPREAD = 600;
const WANDER_SAMPLES = 24;
const WANDER_MISSES = 3;
const FORMATION_PACES = 2;

/** Stock handlers for every world verb `deps.world` has the parts for. */
export function worldVerbs<TCtx>(deps:WorldVerbDeps<TCtx>):Handlers<TCtx> {
	const { world, mover } = deps;
	const nameOf = (call:VerbCall<TCtx>, id:string):string => call.character.mind?.nameOf(id) ?? id;
	const fail = (verb:string, reason:string):ArcResult => ({ ok: false, verb, reason });
	const outcome = (verb:string, done:{ ok:boolean; reason?:string }):ArcResult => ({ ok: done.ok, verb, reason: done.reason });
	const formation:VerbHandler<TCtx> = (call) => formationVerb(call, world, mover);
	/** The acting character and the thing `id` names (when given), or why the verb fails. `what` names it in the failure. */
	const resolve = (call:VerbCall<TCtx>, id?:string, what = 'thing'):Found | ArcResult => {
		const character = world.find(call.character.id);
		if (character === undefined) {
			return fail(call.verb, 'not in this scene');
		}
		const target = id ? world.find(id) : undefined;
		if (id && target === undefined) {
			return fail(call.verb, `no such ${what} ${nameOf(call, id)}`);
		}
		return { character, target };
	};
	const failed = (found:Found | ArcResult):found is ArcResult => 'ok' in found;
	const trade = async (call:VerbCall<TCtx>, side:'buy' | 'sell', other:string, item:string, quantity?:number, price?:number):Promise<ArcResult> => {
		const found = resolve(call, other, 'person');
		if (failed(found)) {
			return found;
		}
		const near = await call.goTo(other);
		if (!near.ok) {
			return near;
		}
		return outcome(side, world.trade!({ character: found.character, side, other: found.target, item, quantity: countOf(quantity), price }));
	};
	return {
		go_to: (call:Call<TCtx, 'go_to'>) => {
			const found = resolve(call, call.args.target, 'place');
			return failed(found) ? found : call.goTo(call.args.target);
		},
		follow: (call:Call<TCtx, 'follow'>) => {
			const found = resolve(call, call.args.target, 'person');
			return failed(found) ? found : mover.go(call.character.id, { target: call.args.target }, 'follow', { sticky: true });
		},
		wander: (call:Call<TCtx, 'wander'>) => wander(call, deps),
		spread: formation,
		circle: formation,
		hold_line: formation,
		pick_up: async (call:Call<TCtx, 'pick_up'>) => {
			const { item } = call.args;
			const found = resolve(call, item, 'item');
			if (failed(found)) {
				return found;
			}
			const near = await call.goTo(item);
			return near.ok ? outcome('pick_up', world.moveItem!({ character: found.character, item, to: found.character })) : near;
		},
		drop: (call:Call<TCtx, 'drop'>) => {
			const found = resolve(call);
			return failed(found) ? found : outcome('drop', world.moveItem!({ character: found.character, item: call.args.item }));
		},
		give: async (call:Call<TCtx, 'give'>) => {
			const { item, to } = call.args;
			const found = resolve(call, to, 'person');
			if (failed(found)) {
				return found;
			}
			const near = await call.goTo(to);
			if (!near.ok) {
				return near;
			}
			const done = world.moveItem!({ character: found.character, item, to: found.target });
			return outcome('give', done.ok ? { ok: true, reason: done.reason ?? `gave ${item} to ${nameOf(call, to)}` } : done);
		},
		use: async (call:Call<TCtx, 'use'>) => {
			const { item, target } = call.args;
			const found = resolve(call, target);
			if (failed(found)) {
				return found;
			}
			if (target) {
				const near = await call.goTo(target);
				if (!near.ok) {
					return near;
				}
			}
			return outcome('use', world.useItem!(found.character, item, found.target));
		},
		examine: (call:Call<TCtx, 'examine'>) => {
			const found = resolve(call, call.args.target);
			if (failed(found)) {
				return found;
			}
			const text = world.getDescription!(found.character, call.args.target);
			return text === undefined
				? fail('examine', `${nameOf(call, call.args.target)} cannot be examined from here`)
				: { ok: true, verb: 'examine', reason: text };
		},
		buy: (call:Call<TCtx, 'buy'>) => trade(call, 'buy', call.args.from, call.args.item, call.args.quantity, call.args.offer),
		sell: (call:Call<TCtx, 'sell'>) => trade(call, 'sell', call.args.to, call.args.item, call.args.quantity, call.args.ask),
	};
}

/** A whole number of items, at least 1. */
function countOf(quantity:number | undefined):number {
	return Math.max(1, Math.floor(quantity ?? 1));
}

/**
 * Roam for `seconds`, one leg at a time. With `until`, each leg heads for the reachable spot where the
 * watch would fit best, and the wander ends as soon as it holds. The result lists what came into sight.
 */
async function wander<TCtx>(call:Call<TCtx, 'wander'>, deps:WorldVerbDeps<TCtx>):Promise<ArcResult> {
	const until = !!call.args.until?.trim();
	const end = deps.now() + (call.args.seconds ?? (until ? 20 : 6));
	const saw = new Set<string>();
	const report = (met:boolean):ArcResult => {
		const names = [...saw].slice(0, SAW_CAP).map((id) => call.character.mind?.nameOf(id) ?? id);
		const seen = names.length > 0 ? `saw ${names.join(', ')}` : '';
		return { ok: true, verb: 'wander', reason: met ? (seen ? `until — ${seen}` : 'until') : seen || undefined };
	};
	const check = ():string | undefined => {
		for (const id of deps.seen(call)) {
			saw.add(id);
		}
		if (until && call.holds('until')) {
			return 'until';
		}
		return deps.now() >= end ? 'time' : undefined;
	};
	for (let misses = 0; misses < WANDER_MISSES;) {
		const done = check();
		if (done) {
			return report(done === 'until');
		}
		const dest = wanderPoint(call, deps.world, until);
		if (!dest) {
			break;
		}
		const leg = await deps.mover.go(call.character.id, { point: dest }, 'wander', { check });
		if (leg.interrupted) {
			return { ...leg, verb: 'wander' };
		}
		if (leg.ok && leg.reason) {
			return report(leg.reason === 'until');
		}
		misses += leg.ok ? 0 : 1;
	}
	return report(false);
}

/** A reachable spot away from here: the best fit for `until` among a spread of samples, or any of them. */
function wanderPoint<TCtx>(call:Call<TCtx, 'wander'>, world:HostWorld<unknown>, until:boolean):Vec | undefined {
	const character = world.find(call.character.id);
	const me = character === undefined ? undefined : world.getPose(character)?.point;
	if (!me) {
		return undefined;
	}
	const spots = reachablePoints(world.getPathGraph!(character), me, WANDER_SPREAD);
	const away = spots.slice(Math.floor(spots.length / 3));
	if (away.length === 0) {
		return undefined;
	}
	const samples = Array.from({ length: Math.min(WANDER_SAMPLES, away.length) }, () => away[Math.floor(Math.random() * away.length)].point);
	if (!until) {
		return samples[0];
	}
	let best = samples[0];
	let bestFit = -Infinity;
	for (const point of samples) {
		const fit = call.score('until', point) + Math.random() * 0.02;
		if (fit > bestFit) {
			bestFit = fit;
			best = point;
		}
	}
	return best;
}

/** Send each unit to its slot in a line or a ring. Units move on their own; the step itself is done at once. */
function formationVerb<TCtx>(call:VerbCall<TCtx>, world:HostWorld<unknown>, mover:Mover):ArcResult {
	const units = (call.units ?? []).filter((id) => poseOf(world, id));
	if (units.length === 0) {
		return { ok: false, verb: call.verb, reason: 'no units' };
	}
	const placeOf = (key:string):Vec | undefined => {
		const id = call.args[key];
		return typeof id === 'string' && id ? poseOf(world, id)?.point : undefined;
	};
	const paces = typeof call.args.paces === 'number' && call.args.paces > 0 ? call.args.paces : FORMATION_PACES;
	const center = placeOf('around') ?? placeOf('at') ?? centroid(units.map((id) => poseOf(world, id)!.point));
	if (!center) {
		return { ok: false, verb: call.verb, reason: 'no place' };
	}
	const [e1, e2] = groundAxes(center.length, world.up);
	const ground = (a:number, b:number):Vec => add(e1.map((v) => v * a), e2, b);
	const slots:Vec[] = [];
	if (call.verb === 'hold_line') {
		const facing = placeOf('facing');
		const way = facing ? sub(facing, center) : undefined;
		const across = way ? unit(ground(-dot(way, e2), dot(way, e1))) : undefined;
		const mid = (units.length - 1) / 2;
		for (let i = 0; i < units.length; i++) {
			slots.push(add(center, across ?? e1, (i - mid) * paces));
		}
	}
	else {
		const radius = call.verb === 'spread' ? Math.max(paces, (paces * units.length) / (2 * Math.PI)) : paces;
		for (let i = 0; i < units.length; i++) {
			const a = (i / units.length) * Math.PI * 2;
			slots.push(add(center, ground(Math.cos(a), Math.sin(a)), radius));
		}
	}
	units.forEach((id, i) => void mover.go(id, { point: slots[i] }, call.verb));
	return { ok: true, verb: call.verb };
}
