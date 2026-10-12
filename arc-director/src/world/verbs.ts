import type { ArcResult, CountMap } from '../arc/types.js';
import type { StockVerbArgs, StockVerbName, VerbArgs, VerbCall, VerbHandler } from '../director/types.js';
import type { MindEvent } from '../mind/types.js';
import type { Mover } from './mover.js';
import { bundleText, isEmpty, offerText, type OfferBook } from './offers.js';
import { poseOf } from './lookup.js';
import { awayGoal, reachablePoints } from './route.js';
import type { HostWorld, Vec } from './types.js';
import { add, centroid, distance, dot, groundAxes, sub, unit } from './vec.js';

/** What the stock world verbs need besides the call itself. */
export type WorldVerbDeps<TCtx> = {
	world:HostWorld<unknown>;
	mover:Mover;
	now:()=>number;
	/** Ids the acting character sees right now. */
	seen:(call:VerbCall<TCtx>)=>string[];
	/** What counts as nearby for the acting character (its kernels' `nearRadius`), when the host says. */
	nearRadius:(call:VerbCall<TCtx>)=>number | undefined;
	/** Every open offer that still stands. */
	offers:()=>OfferBook;
	/** Whether character `fromID` may make an offer to `toID`. */
	canOffer:(fromID:string, toID:string)=>boolean;
	/** Tell the mind that thinks for character `id`. A major event wakes it. */
	tell:(id:string, event:MindEvent)=>void;
};

type WorldPart = Exclude<keyof HostWorld<unknown>, 'find' | 'getPose' | 'getReach' | 'canOffer' | 'up'>;

const MOVING:WorldPart[] = ['getPathGraph', 'steerToward'];

/** The `withWorld` parts each stock world verb runs on. */
export const WORLD_VERB_PARTS:Readonly<Record<string, readonly WorldPart[]>> = {
	go_to: MOVING,
	follow: MOVING,
	flee: MOVING,
	wander: MOVING,
	spread: MOVING,
	circle: MOVING,
	hold_line: MOVING,
	pick_up: ['moveItem'],
	drop: ['moveItem'],
	give: ['moveItem'],
	use: ['useItem'],
	examine: ['getDescription'],
	offer: ['exchange'],
};

/** Parts of `world` that `verb` needs and does not have. */
export function missingParts(verb:string, world:HostWorld<unknown> | undefined):readonly WorldPart[] {
	const parts = WORLD_VERB_PARTS[verb] ?? [];
	return world ? parts.filter((part) => !world[part]) : parts;
}

/** The acting character and the thing a verb is about. */
type Found = { character:unknown; target:unknown };

/** How close `a` and `b` must be before each is in the other's reach. Default 1. */
function reachOf(world:HostWorld<unknown>, a:string, b:string):number {
	const from = world.find(a);
	const to = world.find(b);
	const mine = from !== undefined && to !== undefined ? world.getReach?.(from, to) ?? 1 : 1;
	const theirs = from !== undefined && to !== undefined ? world.getReach?.(to, from) ?? 1 : 1;
	return Math.min(mine, theirs);
}

type Call<TCtx, TVerb extends StockVerbName> = VerbCall<TCtx, VerbArgs<StockVerbArgs<TVerb>>>;
type Handlers<TCtx> = { [TVerb in StockVerbName]?:VerbHandler<TCtx, VerbArgs<StockVerbArgs<TVerb>>> };

const SAW_CAP = 12;
const WANDER_SPREAD = 600;
const WANDER_SAMPLES = 24;
const WANDER_MISSES = 3;
const FORMATION_PACES = 2;
/** Seconds between looks while far enough away. */
const FLEE_LOOK = 0.5;
/** Seconds out of range before a flee counts as escaped. */
const FLEE_SAFE = 3;
/** Run this much past the distance asked, so a step toward you does not start the next run at once. */
const FLEE_MARGIN = 1.25;

/** Stock handlers for every world verb `deps.world` has the parts for. */
export function worldVerbs<TCtx>(deps:WorldVerbDeps<TCtx>):Handlers<TCtx> {
	const { world, mover } = deps;
	const nameOf = (call:VerbCall<TCtx>, id:string):string => call.character.mind?.nameOf(id) ?? id;
	const fail = (verb:string, reason:string):ArcResult => ({ ok: false, verb, reason });
	const outcome = (verb:string, done:{ ok:boolean; reason?:string }):ArcResult => ({ ok: done.ok, verb, reason: done.reason });
	const formation:VerbHandler<TCtx> = (call) => formationVerb(call, world);
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
	const offer = async (call:Call<TCtx, 'offer'>):Promise<ArcResult> => {
		const me = call.character.id;
		const { to, give = {}, get = {} } = call.args;
		const withdraw = isEmpty(give) && isEmpty(get);
		if (!to) {
			deps.offers().post({ from: me, give, get });
			return { ok: true, verb: 'offer', reason: withdraw ? 'withdrew your standing offers' : `offering ${offerText({ give, get })} to anyone` };
		}
		const found = resolve(call, to, 'person');
		if (failed(found)) {
			return found;
		}
		const name = nameOf(call, to);
		if (found.target === found.character) {
			return fail('offer', 'cannot trade with yourself');
		}
		if (withdraw) {
			deps.offers().post({ from: me, to, give, get });
			return { ok: true, verb: 'offer', reason: `withdrew your offer to ${name}` };
		}
		if (deps.offers().match(me, to, give, get)) {
			// Close enough to trade: each is within the other's reach, and an offer to them is allowed. Nearby is not enough.
			const within = reachOf(world, me, to);
			const together = ():string | undefined => {
				const a = poseOf(world, me)?.point;
				const b = poseOf(world, to)?.point;
				return a && b && distance(a, b) <= within && deps.canOffer(me, to) ? 'near' : undefined;
			};
			if (!together()) {
				const near = await (mover.canMove ? mover.go(me, { target: to }, 'offer', { within, check: together }) : call.goTo(to, within));
				if (!near.ok) {
					return { ...near, verb: 'offer' };
				}
			}
			if (!together()) {
				return fail('offer', deps.canOffer(me, to) ? `${name} is out of reach` : `${name} is out of sight`);
			}
			// Their offer may have changed on the way.
			const match = deps.offers().match(me, to, give, get);
			if (match) {
				const done = world.exchange!({ character: found.character, other: found.target, give: match.pay, get: match.receive });
				if (!done.ok) {
					return outcome('offer', done);
				}
				deps.offers().settle(me, match);
				deps.tell(to, { kind: 'Traded', text: `{0} took your offer: you gave ${bundleText(match.receive)} for ${bundleText(match.pay)}`, who: [me], tags: ['trade'] });
				return { ok: true, verb: 'offer', reason: done.reason ?? `traded ${bundleText(match.pay)} for ${bundleText(match.receive)} with ${name}` };
			}
		}
		if (!deps.canOffer(me, to)) {
			return fail('offer', `${name} is out of sight`);
		}
		deps.offers().post({ from: me, to, give, get });
		deps.tell(to, {
			kind: 'Offer',
			text: `{0} offers you ${offerText({ give, get })}. To accept: offer(to={0}, give=${terms(get)}, get=${terms(give)})`,
			who: [me],
			tags: ['offer'],
			major: true,
		});
		return { ok: true, verb: 'offer', reason: `offered ${offerText({ give, get })} to ${name}; waiting for their answer` };
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
		flee: async (call:Call<TCtx, 'flee'>) => {
			const found = resolve(call, call.args.from, 'person');
			if (failed(found)) {
				return found;
			}
			const keep = call.args.distance ?? deps.nearRadius(call);
			return keep === undefined ? fail('flee', 'say how far: flee(from, distance)') : flee(call, deps, keep);
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
			const done = world.moveItem!({ character: found.character, item, to: found.target, quantity: call.args.quantity });
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
		offer,
	};
}

/** A bundle as an arc writes it: `{"gold":5}`. */
function terms(bundle:CountMap):string {
	return JSON.stringify(Object.fromEntries(Object.entries(bundle).filter(([, count]) => count > 0)));
}

/**
 * Get and stay at least `keep` away from `call.args.from`: stand while far enough, else take the cheapest route out
 * of their range ({@link awayGoal}), which keeps wide of them. Ends once out of range for {@link FLEE_SAFE} seconds
 * in a row, or when they are gone; fails when cornered (no way out of range) or stuck.
 */
async function flee<TCtx>(call:Call<TCtx, 'flee'>, deps:WorldVerbDeps<TCtx>, keep:number):Promise<ArcResult> {
	const { world, mover } = deps;
	const { from } = call.args;
	const name = call.character.mind?.nameOf(from) ?? from;
	const threat = ():Vec | undefined => poseOf(world, from)?.point;
	const dest = {
		goal: () => {
			const at = threat();
			return at && awayGoal(at, keep * FLEE_MARGIN);
		},
		noWay: (why:string) => (why ? `cornered by ${name}, blocked on the way: ${why}` : `cornered by ${name}`),
	};
	let safeSince = deps.now();
	for (;;) {
		const me = poseOf(world, call.character.id)?.point;
		const at = threat();
		if (!me || !at) {
			return me ? { ok: true, verb: 'flee', reason: `${name} is gone` } : { ok: false, verb: 'flee', reason: 'not in this scene' };
		}
		if (distance(me, at) >= keep) {
			if (deps.now() - safeSince >= FLEE_SAFE) {
				return { ok: true, verb: 'flee', reason: `got away from ${name}` };
			}
			const look = await call.wait(FLEE_LOOK);
			if (!look.ok) {
				return { ...look, verb: 'flee' };
			}
			continue;
		}
		const leg = await mover.go(call.character.id, dest, 'flee');
		if (!leg.ok && threat()) {
			return { ...leg, verb: 'flee' };
		}
		safeSince = deps.now();
	}
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

/** This character's place in its squad's formation: every one of them works out the same slots and takes its own. */
function formationVerb<TCtx>(call:VerbCall<TCtx>, world:HostWorld<unknown>):Promise<ArcResult> | ArcResult {
	const units = call.character.squad.filter((id) => poseOf(world, id));
	const mine = units.indexOf(call.character.id);
	if (mine < 0) {
		return { ok: false, verb: call.verb, reason: 'not in this scene' };
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
	return call.goToPoint(slots[mine]);
}
