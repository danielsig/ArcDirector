import { showNamingText, type NamingText } from '../character/text-with-ids.js';
import type { ArcResult, CountMap } from '../arc/arc-types.js';
import type { StockVerbArgs, StockVerbName, VerbArgs, VerbCall, VerbHandler } from '../director/director-types.js';
import type { SeenObject } from '../perception/perception-types.js';
import type { MindEvent } from '../mind/mind-types.js';
import type { ArcDirector } from '../director/ArcDirector.js';
import { internalsOf } from '../internals.js';
import { SightFeature } from '../perception/SightFeature.js';
import { dummyEntity } from '../expr/natives.js';
import type { Mover } from './mover.js';
import { bundleText, isEmpty, offerText } from './offers.js';
import { axesOf, inLineOfSight, inReach, poseOf, reachTo } from './lookup.js';
import { awayGoal, scout, type Scouted } from './route.js';
import { checkDeal, settleDeal } from './deal.js';
import { RESERVED_TAGS, type HostWorld, type Transfer, type Vec } from './world-types.js';
import { groundAxes } from './axes.js';
import { add, centroid, distance, dot, sub, unit } from './vec.js';

/**
 * What the stock world verbs run on: the director, the world they were made for, the mover every walk takes, and the
 * world verbs features made of their tools (`WorldVerbsFeature.add`).
 */
type On<TCtx> = { director:ArcDirector<TCtx>; world:HostWorld<unknown>; mover:Mover; more:ReadonlyMap<string, (tools:WorldVerbTools<TCtx>)=>VerbHandler<TCtx>> };

/** What the acting character sees right now; none without sight. */
function seenBy<TCtx>(director:ArcDirector<TCtx>, call:VerbCall<TCtx>):SeenObject[] | undefined {
	return director.getFeature(SightFeature)?.seenBy(call.ctx)?.objects;
}

/** A part of a {@link HostWorld} that unlocks verbs. */
export type WorldPart = 'geometry' | 'routes' | 'transfers' | 'useItem' | 'getDescription';

/** The `withWorld` part each stock world verb runs on. */
export const WORLD_VERB_PART:Readonly<Record<string, WorldPart>> = {
	go_to: 'routes', follow: 'routes', flee: 'routes', wander: 'routes', spread: 'routes', circle: 'routes', hold_line: 'routes',
	pick_up: 'transfers', drop: 'transfers', give: 'transfers', offer: 'transfers', steal: 'transfers',
	use: 'useItem',
	examine: 'getDescription',
};

/** The part of `world` that `verb` needs and it does not have, if any: `routes` and `transfers` need `geometry` too. */
export function missingPart(verb:string, world:HostWorld<unknown> | undefined):WorldPart | undefined {
	const part = WORLD_VERB_PART[verb];
	return !part ? undefined
		: !world?.[part] ? part
			: (part === 'routes' || part === 'transfers') && !world.geometry ? 'geometry' : undefined;
}

/** The acting character and the thing a verb is about. */
export type Found = { character:unknown; target:unknown };

/** The stock world verbs' own steps, for a feature's world verb (`WorldVerbsFeature.add`). */
export type WorldVerbTools<TCtx> = {
	/** `verb` failed, for `reason`. */
	fail(verb:string, reason:NamingText):ArcResult;
	/** Whether finding failed. */
	failed(found:Found | ArcResult):found is ArcResult;
	/** The acting character and the character `id` names, or why the verb fails: a thing or a place is refused. */
	resolveCharacter(call:VerbCall<TCtx>, id:string):Found | ArcResult;
	/**
	 * `found.character` takes `item` from `fromID` (`found.target`) by `call`'s verb: unless it may not (the host's
	 * `canPickUp`, else it sees `item` there; saying `unseen`) or the game refuses the move, it goes there and the move
	 * is made. Undefined once made, else how it failed.
	 */
	take(call:VerbCall<TCtx>, item:string, fromID:string, found:Found, unseen:NamingText):Promise<ArcResult | undefined>;
};

type Call<TCtx, TVerb extends StockVerbName> = VerbCall<TCtx, VerbArgs<StockVerbArgs<TVerb>>>;
type Handlers<TCtx> = { [TVerb in StockVerbName]?:VerbHandler<TCtx, VerbArgs<StockVerbArgs<TVerb>>> };

const SAW_CAP = 12;
/** A wander leg: scout length, least length, headings tried (a graded `until`: ends picked from), lean of the first. */
const WANDER_LEG = 16;
const WANDER_MIN = 4;
const WANDER_TRIES = 6;
const WANDER_GRADED = 6;
const WANDER_AWAY = 0.5;
/** The share of legs that drift to something in sight, how near counts as been to it, and how far short they stop. */
const WANDER_LURE = 1 / 3;
const WANDER_NEAR = 4;
const WANDER_SHORT = 1.5;
const WANDER_MISSES = 3;
const FORMATION_PACES = 2;
/** Seconds between looks while far enough away. */
const FLEE_LOOK = 0.5;
/** Seconds out of range before a flee counts as escaped. */
const FLEE_SAFE = 3;
/** Run this much past the distance asked, so a step toward you does not start the next run at once. */
const FLEE_MARGIN = 1.25;

/** Stock handlers for every world verb `on.world` has the parts for. */
export function worldVerbs<TCtx>(on:On<TCtx>):Handlers<TCtx> {
	const { director, world, mover } = on;
	const fail = (verb:string, reason:NamingText):ArcResult => ({ status: 'failed', verb, reason });
	const outcome = (verb:string, done:{ ok:boolean; reason?:NamingText }):ArcResult => ({ status: done.ok ? 'ok' : 'failed', verb, reason: done.reason });
	const formation:VerbHandler<TCtx> = (call) => formationVerb(call, world);
	/**
	 * Whether the acting character may pick up or steal `item` from `fromID` (the item where it lies, what holds it, or
	 * whom it steals from): the host's `canPickUp` where it rules, else it sees `item` there (loose where it lies, else
	 * on or in `fromID`, or carried by them as a thief sees it), else `fromID` is in its line of sight, else yes.
	 */
	const canPickUp = (call:VerbCall<TCtx>, item:string, fromID:string):boolean => {
		const [character, from] = [world.find(call.character.id), world.find(fromID)];
		const verdict = world.transfers?.canPickUp && (character === undefined || from === undefined ? false : world.transfers.canPickUp(character, item, from));
		const seen = verdict === undefined ? seenBy(director, call) : undefined;
		return verdict ?? (seen
			? seen.some((o) => (o.id === item && (fromID === item ? o.attachMode !== 'in' : o.attachedTo === fromID)) || (o.id === fromID && o.carrying?.includes(item)))
			: inLineOfSight(world, call.character.id, fromID));
	};
	/** The acting character and the thing `id` names (when given), or why the verb fails. `what` names it in the failure. */
	const resolve = (call:VerbCall<TCtx>, id?:string, what = 'thing'):Found | ArcResult => {
		const character = world.find(call.character.id);
		if (character === undefined) {
			return fail(call.verb, 'not in this scene');
		}
		const target = id ? world.find(id) : undefined;
		if (id && target === undefined) {
			return fail(call.verb, (name) => `no such ${what} ${name(id)}`);
		}
		return { character, target };
	};
	const failed = (found:Found | ArcResult):found is ArcResult => 'status' in found;
	/** As `resolve`, for a character to give to or trade with: a thing or a place is refused. */
	const resolveCharacter = (call:VerbCall<TCtx>, id:string):Found | ArcResult => {
		const found = resolve(call, id, 'character');
		return failed(found) || director.character(id) ? found : fail(call.verb, (name) => `${name(id)} is not a character`);
	};
	const take = async (call:VerbCall<TCtx>, item:string, fromID:string, found:Found, unseen:NamingText):Promise<ArcResult | undefined> => {
		if (!canPickUp(call, item, fromID)) {
			return fail(call.verb, unseen);
		}
		const move = [{ verb: call.verb, thing: item, from: found.target, to: found.character }];
		const refused = checkDeal(world, move);
		if (refused) {
			return fail(call.verb, refused);
		}
		const near = await call.goTo(fromID);
		if (near.status !== 'ok') {
			return near;
		}
		const done = settleDeal(world, move);
		return done.ok ? undefined : outcome(call.verb, done);
	};
	/** One trade, gift or payment, remembered by every mind. Recall is how they read this ledger. */
	const ledger = (text:(name:(id:string)=>string)=>string, tags:string[]):void => {
		director.pushEvent({ kind: 'Ledger', text, tags: ['ledger', ...tags], remember: true });
	};
	/** `bundle` handed from `from` to `to` in a trade, one move per thing. */
	const handOver = (from:unknown, to:unknown, bundle:CountMap):Transfer<unknown>[] => Object.entries(bundle)
		.filter(([, quantity]) => quantity > 0)
		.map(([thing, quantity]) => ({ verb: 'offer', thing, from, to, quantity }));
	const offer = async (call:Call<TCtx, 'offer'>):Promise<ArcResult> => {
		const me = call.character.id;
		const { to, give = {}, get = {} } = call.args;
		const withdraw = isEmpty(give) && isEmpty(get);
		if (!to) {
			// No taker yet: only the offerer's half can be checked.
			const character = withdraw ? undefined : world.find(me);
			const refused = character === undefined ? undefined : checkDeal(world, handOver(character, undefined, give));
			if (refused) {
				return fail('offer', refused);
			}
			director.offers.live().post({ from: me, give, get });
			if (!withdraw) {
				director.getTalk()?.offered(me, undefined, { kind: 'Offer', text: (who) => `${who(me)} offers ${offerText({ give, get })} to anyone. To accept: offer(to=${who(me)}, give=${terms(get)}, get=${terms(give)})`, tags: ['offer'] }, director.time);
			}
			return { status: 'ok', verb: 'offer', reason: withdraw ? 'withdrew your standing offers' : `offering ${offerText({ give, get })} to anyone` };
		}
		const found = resolveCharacter(call, to);
		if (failed(found)) {
			return found;
		}
		if (found.target === found.character) {
			return fail('offer', 'cannot trade with yourself');
		}
		if (withdraw) {
			director.offers.live().post({ from: me, to, give, get });
			return { status: 'ok', verb: 'offer', reason: (name) => `withdrew your offer to ${name(to)}` };
		}
		// Terms the game rules out are refused now, before anyone hears them.
		const refused = checkDeal(world, [...handOver(found.character, found.target, give), ...handOver(found.target, found.character, get)]);
		if (refused) {
			return fail('offer', refused);
		}
		if (director.offers.live().match(me, to, give, get)) {
			// Close enough to trade: each is within the other's reach, and an offer to them is allowed. Nearby is not enough.
			const within = Math.min(reachTo(world, found.character, found.target), reachTo(world, found.target, found.character));
			const together = ():string | undefined => (inReach(world, me, to) && inReach(world, to, me) && director.offers.canOffer(me, to) ? 'near' : undefined);
			if (!together()) {
				const near = await call.goTo(to, { within, check: together });
				if (near.status !== 'ok') {
					return { ...near, verb: 'offer' };
				}
			}
			if (!together()) {
				return fail('offer', (name) => (director.offers.canOffer(me, to) ? `${name(to)} is out of reach` : director.offers.outOfRange(name(to))));
			}
			// Their offer may have changed on the way.
			const match = director.offers.live().match(me, to, give, get);
			if (match) {
				const done = settleDeal(world, [...handOver(found.character, found.target, match.pay), ...handOver(found.target, found.character, match.receive)]);
				if (!done.ok) {
					return outcome('offer', done);
				}
				director.offers.live().settle(me, match);
				ledger((who) => `${who(me)} traded ${bundleText(match.pay)} to ${who(to)} for ${bundleText(match.receive)}.`, ['trade', tradeLabel(director.mindDefaults.currency, match.receive, match.pay)]);
				director.character(to)?.tell({ kind: 'Traded', text: (who) => `${who(me)} took your offer: you gave ${bundleText(match.receive)} for ${bundleText(match.pay)}`, tags: ['trade'] });
				return { status: 'ok', verb: 'offer', reason: (name) => `traded ${bundleText(match.pay)} for ${bundleText(match.receive)} with ${name(to)}` };
			}
		}
		// Out of earshot, it goes to them first, as a gift does.
		if (!director.offers.canOffer(me, to)) {
			const near = await call.goTo(to, { check: () => (director.offers.canOffer(me, to) ? 'near' : undefined) });
			if (near.status !== 'ok') {
				return { ...near, verb: 'offer' };
			}
		}
		if (!director.offers.canOffer(me, to)) {
			return fail('offer', (name) => director.offers.outOfRange(name(to)));
		}
		director.offers.live().post({ from: me, to, give, get });
		const told:MindEvent = { kind: 'Offer', text: (who) => `${who(me)} offers you ${offerText({ give, get })}. To accept: offer(to=${who(me)}, give=${terms(get)}, get=${terms(give)})`, tags: ['offer'], major: true };
		// Heard as a line to them is, where there is talk.
		const talk = director.getTalk();
		if (talk) {
			talk.offered(me, to, told, director.time);
		}
		else {
			director.character(to)?.tell(told);
		}
		return { status: 'ok', verb: 'offer', reason: (name) => `offered ${offerText({ give, get })} to ${name(to)}; it stands until they answer, so do not offer it again` };
	};
	return {
		go_to: (call:Call<TCtx, 'go_to'>) => {
			const found = resolve(call, call.args.target, 'place');
			if (failed(found)) {
				return found;
			}
			return call.goTo(call.args.target);
		},
		follow: (call:Call<TCtx, 'follow'>) => {
			const found = resolve(call, call.args.target, 'character');
			if (failed(found)) {
				return found;
			}
			// How far behind to keep: it closes in again whenever they get farther than that.
			const within = call.args.distance !== undefined && call.args.distance > 0 ? call.args.distance : undefined;
			return mover.go(call.character.id, { target: call.args.target }, 'follow', { sticky: true, within });
		},
		flee: async (call:Call<TCtx, 'flee'>) => {
			const found = resolve(call, call.args.from, 'character');
			if (failed(found)) {
				return found;
			}
			const keep = call.args.distance ?? internalsOf(director).watches.kernelsFor(call.character, call.ctx)?.nearRadius;
			return keep === undefined ? fail('flee', 'say how far: flee(from, distance)') : flee(call, on, keep);
		},
		wander: (call:Call<TCtx, 'wander'>) => wander(call, on),
		spread: formation,
		circle: formation,
		hold_line: formation,
		pick_up: async (call:Call<TCtx, 'pick_up'>) => {
			const { item } = call.args;
			// Wherever it says to take it from, one it carries is had already.
			if (internalsOf(director).watches.kernels?.(call.ctx).inventory?.(dummyEntity(call.character.id)).some((held) => held.id === item)) {
				return { status: 'ok', verb: 'pick_up', reason: `${item} already carried` };
			}
			// A `from` that names nothing is left out: it is looked for where it lies, and told so.
			const unknown = call.args.from && world.find(call.args.from) === undefined ? call.args.from : undefined;
			const from = unknown ? undefined : call.args.from;
			if (from && director.character(from)) {
				return fail('pick_up', (name) => `${name(from)} carries it; only they can give it to you`);
			}
			// Where it lies, or what holds it: as named, else as seen, loose before held.
			const seen = (seenBy(director, call) ?? []).filter((o) => o.id === item);
			const source = from ?? (seen.some((o) => o.attachMode !== 'in') ? item : seen[0]?.attachedTo ?? item);
			const found = resolve(call, source, from ? 'thing' : 'item');
			if (failed(found)) {
				return found;
			}
			const unseen:NamingText = from ? (name) => `you see no ${item} in ${name(from)}` : `you see no ${item}; go where it is first`;
			return await take(call, item, source, found, unseen)
				?? outcome('pick_up', { ok: true, reason: from ? (name) => `took ${item} from ${name(from)}` : unknown ? (name) => `no ${name(unknown)}; took ${item} from where it lay` : `picked up ${item}` });
		},
		drop: async (call:Call<TCtx, 'drop'>) => {
			const { item, to } = call.args;
			if (to && director.character(to)) {
				return fail('drop', (name) => `to hand ${item} to ${name(to)}, use give`);
			}
			const found = resolve(call, to);
			if (failed(found)) {
				return found;
			}
			const put = [{ verb: 'drop', thing: item, from: found.character, to: found.target }];
			if (to) {
				const refused = checkDeal(world, put);
				if (refused) {
					return fail('drop', refused);
				}
				const near = await call.goTo(to);
				if (near.status !== 'ok') {
					return near;
				}
			}
			const done = settleDeal(world, put);
			return outcome('drop', done.ok ? { ok: true, reason: to ? (name) => `put ${item} in ${name(to)}` : `dropped ${item}` } : done);
		},
		give: async (call:Call<TCtx, 'give'>) => {
			const { item, to } = call.args;
			const found = resolveCharacter(call, to);
			if (failed(found)) {
				return found;
			}
			const hand = [{ verb: 'give', thing: item, from: found.character, to: found.target, quantity: call.args.quantity }];
			const refused = checkDeal(world, hand);
			if (refused) {
				return fail('give', refused);
			}
			const near = await call.goTo(to);
			if (near.status !== 'ok') {
				return near;
			}
			const done = settleDeal(world, hand);
			if (!done.ok) {
				return outcome('give', done);
			}
			const pays = isCurrency(item, director.mindDefaults.currency);
			ledger((who) => `${who(call.character.id)} ${pays ? 'paid' : 'gave'} ${bundleText({ [item]: call.args.quantity ?? 1 })} to ${who(to)}.`, [pays ? 'pay' : 'give', item]);
			return outcome('give', { ok: true, reason: (name) => `${pays ? 'paid' : 'gave'} ${call.args.quantity ? bundleText({ [item]: call.args.quantity }) : item} to ${name(to)}` });
		},
		use: async (call:Call<TCtx, 'use'>) => {
			const { item } = call.args;
			// A model that eats or drinks something often names itself as what it is used on.
			const target = call.args.target === 'me' ? call.character.id : call.args.target;
			const found = resolve(call, target);
			if (failed(found)) {
				return found;
			}
			// Used on yourself, it is already in reach.
			if (target && target !== call.character.id) {
				const near = await call.goTo(target);
				if (near.status !== 'ok') {
					return near;
				}
			}
			return outcome('use', world.useItem!(found.character, item, target));
		},
		examine: async (call:Call<TCtx, 'examine'>) => {
			const found = resolve(call, call.args.target);
			if (failed(found)) {
				return found;
			}
			const look = ():NamingText | undefined => world.getDescription!(found.character, call.args.target);
			// Out of sight, it goes only as far as it takes to see it, as an offer does to be heard.
			if (look() === undefined) {
				const near = await call.goTo(call.args.target, { check: () => (look() === undefined ? undefined : 'in sight') });
				if (near.status !== 'ok') {
					return { ...near, verb: 'examine' };
				}
			}
			const text = look();
			// What it carries or holds, as far as the character knows (`canSeeInventoryOf`).
			const items = text === undefined ? [] : internalsOf(director).worldVerbs.inventorySeenBy(call.character.id, call.args.target);
			return text === undefined
				? fail('examine', (name) => `${name(call.args.target)} cannot be examined from here`)
				: { status: 'ok', verb: 'examine', reason: items.length === 0 ? text : (name) => `${showNamingText(text, name)} ${name(call.args.target)} has ${items.map(name).join(', ')}.` };
		},
		offer,
		...Object.fromEntries([...on.more].map(([name, make]) => [name, make({ fail, failed, resolveCharacter, take })])),
	};
}

/** Whether `name` is the host's currency, in any case. */
function isCurrency(name:string, currency:string | undefined):boolean {
	return currency !== undefined && name.toLowerCase() === currency.toLowerCase();
}

/** What a trade is remembered by: its first goods that are not money. */
function tradeLabel(currency:string | undefined, ...bundles:CountMap[]):string {
	const names = bundles.flatMap((b) => Object.keys(b));
	return names.find((n) => !isCurrency(n, currency)) ?? names[0] ?? '';
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
async function flee<TCtx>(call:Call<TCtx, 'flee'>, { director, world, mover }:On<TCtx>, keep:number):Promise<ArcResult> {
	const { from } = call.args;
	const threat = ():Vec | undefined => poseOf(world, from)?.point;
	const dest = {
		goal: () => {
			const at = threat();
			return at && awayGoal(at, keep * FLEE_MARGIN);
		},
		noWay: (why:NamingText):NamingText => (name) => {
			const blocked = showNamingText(why, name);
			return blocked ? `cornered by ${name(from)}, blocked on the way: ${blocked}` : `cornered by ${name(from)}`;
		},
	};
	let safeSince = director.time;
	for (;;) {
		const me = poseOf(world, call.character.id)?.point;
		const at = threat();
		if (!me || !at) {
			return me ? { status: 'ok', verb: 'flee', reason: (name) => `${name(from)} ${world.hasFallen?.(from) ? 'has fallen' : 'is gone'}` } : { status: 'failed', verb: 'flee', reason: 'not in this scene' };
		}
		if (distance(me, at) >= keep) {
			if (director.time - safeSince >= FLEE_SAFE) {
				return { status: 'ok', verb: 'flee', reason: (name) => `got away from ${name(from)}` };
			}
			const look = await call.wait(FLEE_LOOK);
			if (look.status !== 'ok') {
				return { ...look, verb: 'flee' };
			}
			continue;
		}
		const leg = await mover.go(call.character.id, dest, 'flee');
		if (leg.status !== 'ok' && threat()) {
			return { ...leg, verb: 'flee' };
		}
		safeSince = director.time;
	}
}

/**
 * Roam for `seconds`, one leg at a time ({@link wanderLeg}), toward ground it has not covered. A graded `until` steers
 * each leg toward where it would fit best; the runtime ends the wander as soon as it holds. The result lists what came into sight.
 */
async function wander<TCtx>(call:Call<TCtx, 'wander'>, { director, world, mover }:On<TCtx>):Promise<ArcResult> {
	const until = !!call.args.until?.trim();
	const end = director.time + (call.args.seconds ?? (until ? 20 : 6));
	const saw = new Set<string>();
	const report = (met:boolean):ArcResult => {
		const found = met ? 'found what it looked for' : '';
		const seen = [...saw].slice(0, SAW_CAP);
		return { status: 'ok', verb: 'wander', reason: (found || seen.length > 0) ? (name) => [found, seen.length > 0 ? `saw ${seen.map(name).join(', ')}` : ''].filter(Boolean).join('; ') : undefined };
	};
	const check = ():string | undefined => {
		for (const seen of seenBy(director, call) ?? []) {
			saw.add(seen.id);
		}
		return director.time >= end ? 'time' : undefined;
	};
	const start = poseOf(world, call.character.id)?.point;
	const been = start ? [start] : [];
	for (let misses = 0; misses < WANDER_MISSES;) {
		if (check()) {
			return report(false);
		}
		const dest = wanderLeg(call, world, been, seenBy(director, call) ?? []);
		if (!dest) {
			break;
		}
		const leg = await mover.go(call.character.id, { point: dest }, 'wander', { check });
		if (leg.status === 'stopped') {
			return call.signal.aborted && call.signal.reason !== 'stopped' ? report(call.signal.reason === 'until') : { ...leg, verb: 'wander' };
		}
		if (leg.status === 'ok' && leg.reason) {
			return report(false);
		}
		misses += leg.status === 'ok' ? 0 : 1;
	}
	return report(false);
}

/**
 * Where the next leg ends, added to `been` (where this wander has been). Each try scouts a heading over the routes
 * ({@link scout}) to the roomiest spot it passes past {@link WANDER_MIN}, never against a wall; the first leans away
 * from `been`. A graded `until` picks the best fit of several ends. In a cramped spot, the roomiest one near.
 */
export function wanderLeg<TCtx>(call:Call<TCtx, 'wander'>, world:HostWorld<unknown>, been:Vec[], seen:readonly SeenObject[]):Vec | undefined {
	const character = world.find(call.character.id);
	const me = character === undefined ? undefined : world.geometry?.getPose(character)?.point;
	if (!me) {
		return undefined;
	}
	const grade = call.grader('until');
	const look = scout(world.routes!, character, me);
	const [e1, e2] = groundAxes(axesOf(world)!);
	const back = unit(sub(me, centroid(been) ?? me)) ?? e1.map(() => 0);
	// About one leg in three drifts toward something in sight not yet been near, stopping a short way before it.
	const lure = Math.random() < WANDER_LURE ? seen.filter((o) => (o.tags.includes(RESERVED_TAGS.landmark) || o.tags.includes(RESERVED_TAGS.item)) && !o.attachMode
		&& been.every((point) => distance(point, o.point) > WANDER_NEAR)).sort((a, b) => distance(me, a.point) - distance(me, b.point))[0]?.point : undefined;
	const drift = lure && look(unit(sub(lure, me)) ?? e1, distance(me, lure) - WANDER_SHORT).at(-1)?.point;
	if (drift) {
		been.push(drift, lure!);
		return drift;
	}
	// The share of open steps around it first, then past WANDER_MIN: 3 is clear of walls and far enough.
	const room = (node:Scouted):number => 2 * node.openness + (node.gone >= WANDER_MIN ? 1 : 0);
	const ends:Scouted[] = [];
	const first = Math.random() * Math.PI * 2;
	// Until one is clear and far enough (a graded `until` tries them all), or three get somewhere, none far: a cramped spot.
	const done = (i:number):boolean => i >= (grade ? WANDER_GRADED : WANDER_TRIES) || (!grade && ends.some((end) => room(end) === 3))
		|| (i >= 3 && ends.length > 0 && ends.every((end) => end.gone < WANDER_MIN));
	for (let i = 0; !done(i); i++) {
		// The golden angle (2.4) apart, so a few tries face every way; each keeps the roomiest spot it passed, the farthest on a tie.
		const way = add(add(e1.map((v) => v * Math.cos(first + i * 2.4)), e2, Math.sin(first + i * 2.4)), back, i === 0 ? WANDER_AWAY : 0);
		ends.push(...look(unit(way) ?? e1, WANDER_LEG).reduce<Scouted[]>((best, node) => (!best[0] || room(node) >= room(best[0]) ? [node] : best), []));
	}
	// A graded `until` tells far spots apart; near ones, in a cramped spot, are much the same.
	const dest = ends.map((end) => ({ ...end, fit: grade && end.gone >= WANDER_MIN ? grade(end.point) : 0 })).sort((a, b) => b.fit - a.fit || room(b) - room(a))[0]?.point;
	been.push(...dest ? [dest] : []);
	return dest;
}

/** This character's place in its squad's formation: every one of them works out the same slots and takes its own. */
function formationVerb<TCtx>(call:VerbCall<TCtx>, world:HostWorld<unknown>):Promise<ArcResult> | ArcResult {
	const units = call.character.squad.filter((id) => poseOf(world, id));
	const mine = units.indexOf(call.character.id);
	if (mine < 0) {
		return { status: 'failed', verb: call.verb, reason: 'not in this scene' };
	}
	const placeOf = (key:string):Vec | undefined => {
		const id = call.args[key];
		return typeof id === 'string' && id ? poseOf(world, id)?.point : undefined;
	};
	const paces = typeof call.args.paces === 'number' && call.args.paces > 0 ? call.args.paces : FORMATION_PACES;
	const center = placeOf('around') ?? placeOf('at') ?? centroid(units.map((id) => poseOf(world, id)!.point));
	if (!center) {
		return { status: 'failed', verb: call.verb, reason: 'no place' };
	}
	const [e1, e2] = groundAxes(axesOf(world)!);
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
