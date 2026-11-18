import { builtins } from './eval.js';
import {
	ABSENT,
	asNum,
	capList,
	DIST_EPS,
	entityName,
	ExprError,
	FACING_COS,
	LIST_CAP,
	Names,
	type Catalog,
	type ExprEntity,
	type ExprVal,
	type NativeFn,
	type SampleCache,
	type Stringifiers,
} from './expr-types.js';
import { bindCarry, bindRoster, asEntityVal } from './me.js';
import { bindPrev, cloneEntity, freezeMe, type PrevSpec } from './prev.js';
import type { Vec } from '../world/world-types.js';

/** Below this share of its health, someone is badly hurt. */
const BADLY_HURT = 0.35;

/**
 * What an expression catalog is built from ({@link buildCatalog}): the host's view (`withKernels`: who and what a
 * character sees, health, carried things), the geometry the director measures from `withWorld`, the host's own
 * functions and stringifiers (`withFunctions`, `withStringifiers`), each feature's, and the director's cache and
 * memory of the last think. Internal: hosts give its parts through those builder methods.
 */
export type CatalogInputs = {
	me:ExprEntity;
	others:ExprEntity[];
	items:ExprEntity[];
	bindings?:Record<string, ExprVal>;
	/**
	 * A name no binding gives, built the first time a watch reads it: the places and landmarks of a big world, which most
	 * watches never name. Absent: no such name.
	 */
	lookup?:(name:string)=>ExprVal | undefined;
	nearRadius?:number;
	inventory?:(who:ExprEntity)=>ExprEntity[];
	hp?:(who:ExprEntity)=>{ hp:number; maxHP:number } | undefined;
	isOpen?:(who:ExprEntity)=>boolean | undefined;
	/** Whether `who` may `verb` now, its cooldown over; undefined (ready) for a verb with none. A `choose` leaves out a choice whose first verb is not ready. */
	isReady?:(who:ExprEntity, verb:string)=>boolean | undefined;
	cache:SampleCache;
	/** Functions of the host's own (`withFunctions`) and of features (`feeling(u)`), over the built-in ones. */
	functions?:Record<string, NativeFn>;
	distance?:(a:ExprEntity, b:ExprEntity)=>number | undefined;
	/** Length of the route a character would take; undefined = no way there. */
	pathDistance?:(a:ExprEntity, b:ExprEntity)=>number | undefined;
	canSee?:(a:ExprEntity, b:ExprEntity)=>boolean;
	facing?:(a:ExprEntity, b:ExprEntity)=>number;
	/** Signed left/right of a's facing toward b (−1 left … +1 right). */
	side?:(a:ExprEntity, b:ExprEntity)=>number;
	/** Whether there is speech its mind has not taken in (`HeardSpeech`), as the director fills it; unset, no `hasHeard`. */
	hasHeard?:boolean;
	/** Last-think freeze, as the director fills it; unset, `prev.me` is this catalog's `me`. */
	prev?:PrevSpec;
	stringifiers?:Stringifiers;
	/** Position for manhattan / chebyshev / inSquare. */
	point?:(who:ExprEntity)=>Vec | undefined;
	/** Override watch LIST_CAP (a collective's `who` uses its roster size). */
	listCap?:number;
	/** The mind's watches by name, read as values where an expression names one (`Catalog.watches`). */
	watches?:Readonly<Record<string, string>>;
};

function hpFromFields(who:ExprEntity):{ hp:number; maxHP:number } | undefined {
	const hp = who.fields?.hp;
	const maxHP = who.fields?.maxHP;
	if (hp?.kind !== 'number' || maxHP?.kind !== 'number') {
		return undefined;
	}
	return { hp: hp.value, maxHP: maxHP.value };
}

/** The people or things `v` names: itself, or a list's. A bare name is a list, of everyone so called. */
function entitiesOf(v:ExprVal | undefined):ExprEntity[] {
	const items = v?.kind === 'list' ? v.value : v ? [v] : [];
	return items.flatMap((item) => (item.kind === 'entity' ? [item.value] : []));
}

/** The two people or things the first two args name, one each: `me` and `Player`, a bare name being a list of one. */
function twoEnt(args:ExprVal[]):[ExprEntity, ExprEntity] | undefined {
	const a = entitiesOf(args[0]);
	const b = entitiesOf(args[1]);
	return a.length === 1 && b.length === 1 ? [a[0], b[0]] : undefined;
}

/** Every pair of what the first two args name; lists expand. */
function pairsOf(args:ExprVal[]):[ExprEntity, ExprEntity][] {
	const right = entitiesOf(args[1]);
	return entitiesOf(args[0]).flatMap((x) => right.map((y):[ExprEntity, ExprEntity] => [x, y]));
}

/** True if pred holds for any entity pair; lists expand. */
function anyPair(args:ExprVal[], pred:(a:ExprEntity, b:ExprEntity)=>boolean):boolean {
	return pairsOf(args).some(([a, b]) => pred(a, b));
}

function distOf(inputs:CatalogInputs, a:ExprEntity, b:ExprEntity):number | undefined {
	if (!inputs.distance) {
		return undefined;
	}
	const d = inputs.distance(a, b);
	if (d === undefined || !Number.isFinite(d)) {
		return undefined;
	}
	return d;
}

function nearAny(inputs:CatalogInputs, a:ExprVal | undefined, b:ExprVal | undefined, r:number):boolean {
	if (!a || !b) {
		return false;
	}
	if (a.kind === 'list') {
		return a.value.some((row) => nearAny(inputs, row, b, r));
	}
	if (b.kind === 'list') {
		return b.value.some((row) => nearAny(inputs, a, row, r));
	}
	if (a.kind !== 'entity' || b.kind !== 'entity') {
		return false;
	}
	const d = distOf(inputs, a.value, b.value);
	return d !== undefined && d <= r;
}

function pathOf(inputs:CatalogInputs, a:ExprEntity, b:ExprEntity):number | undefined {
	const d = inputs.pathDistance?.(a, b);
	if (d === undefined || !Number.isFinite(d)) {
		return undefined;
	}
	inputs.cache.rememberPath(a.id, b.id, d);
	return d;
}

export function buildCatalog(inputs:CatalogInputs):Catalog {
	const names = new Names();
	const fns = new Map<string, NativeFn>(Object.entries(builtins));
	bindRoster(names, inputs);
	if (inputs.hasHeard !== undefined) {
		names.set('hasHeard', { kind: 'bool', value: inputs.hasHeard });
	}
	for (const [k, v] of Object.entries(inputs.bindings ?? {})) {
		if (!names.bound(k)) {
			names.set(k, v);
		}
	}

	if (inputs.inventory) {
		const pack = inputs.inventory;
		const prevMe = inputs.prev?.me ?? freezeMe(inputs);
		bindCarry({ me: inputs.me, inventory: pack }, prevMe, names, fns);
		bindPrev(names, {
			secondsAgo: inputs.prev?.secondsAgo,
			me: prevMe,
			verbs: inputs.prev?.verbs ?? [],
		});
	}
	else {
		bindPrev(names, {
			secondsAgo: inputs.prev?.secondsAgo,
			me: inputs.prev?.me ?? cloneEntity(inputs.me),
			verbs: inputs.prev?.verbs ?? [],
		});
	}

	if (inputs.hp) {
		const read = inputs.hp;
		const attach = (who:ExprEntity):void => {
			const v = read(who);
			if (!v) {
				return;
			}
			who.fields = {
				...who.fields,
				hp: { kind: 'number', value: v.hp },
				maxHP: { kind: 'number', value: v.maxHP },
			};
			inputs.cache.rememberHP(who.id, v.hp);
		};
		attach(inputs.me);
		// Whoever a binding holds too, unless it says its own: a collective's `units`, so `units.minBy(u => u.hp)` reads their health.
		const bound = Object.values(inputs.bindings ?? {}).flatMap(entitiesOf).filter((o) => !o.fields?.hp);
		for (const o of [...inputs.others, ...bound]) {
			attach(o);
		}
		names.set('me', asEntityVal(inputs.me));
		// Of whoever the arg names (a bare name or a list: any of them), else of `me`.
		const whoOf = (args:ExprVal[]):ExprEntity[] => (args[0] ? entitiesOf(args[0]) : [inputs.me]);
		fns.set('isHurt', (args) => ({ kind: 'bool', value: whoOf(args).some((who) => {
			const v = read(who) ?? hpFromFields(who);
			return !!v && v.hp > 0 && v.hp < v.maxHP;
		}) }));
		fns.set('isBadlyHurt', (args) => ({ kind: 'bool', value: whoOf(args).some((who) => {
			const v = read(who) ?? hpFromFields(who);
			return !!v && v.hp > 0 && v.hp < v.maxHP * BADLY_HURT;
		}) }));
		// Each one's health is remembered, so none is checked against an old reading next time.
		fns.set('isHPFalling', (args) => ({ kind: 'bool', value: whoOf(args).map((who) => {
			const v = read(who);
			const prev = v && inputs.cache.rememberHP(who.id, v.hp);
			return !!v && prev !== undefined && v.hp < prev - 0.0001;
		}).some(Boolean) }));
	}

	bindChange(inputs, fns);
	if (inputs.distance) {
		bindDistance(inputs, fns);
	}
	if (inputs.point) {
		bindGrid(inputs, fns);
	}
	if (inputs.pathDistance) {
		bindPath(inputs, fns);
	}
	if (inputs.canSee) {
		bindSight(inputs, fns);
	}
	if (inputs.facing) {
		bindFacingNumber(inputs, fns);
	}
	if (inputs.isOpen) {
		bindOpen(inputs, fns);
	}
	if (inputs.isReady) {
		bindReady(inputs, fns);
	}
	bindBusy(fns);
	for (const [k, fn] of Object.entries(inputs.functions ?? {})) {
		fns.set(k, fn);
	}

	names.lookup = inputs.lookup;
	return {
		names,
		fns,
		me: inputs.me,
		cache: inputs.cache,
		stringifiers: inputs.stringifiers,
		point: inputs.point,
		listCap: inputs.listCap,
		...inputs.watches ? { watches: inputs.watches } : {},
	};
}

function bindDistance(inputs:CatalogInputs, fns:Map<string, NativeFn>):void {
	// Between lists, how far the closest two are: distance(me, others.filter(o => o.foe)) is the nearest foe's.
	fns.set('distance', (args) => {
		const pairs = pairsOf(args);
		if (pairs.length === 0) {
			throw new ExprError('distance needs two people or things');
		}
		let best:number | undefined;
		for (const [a, b] of pairs) {
			const d = distOf(inputs, a, b);
			if (d !== undefined) {
				inputs.cache.rememberDist(a.id, b.id, d);
				best = Math.min(best ?? d, d);
			}
		}
		if (best === undefined) {
			throw new ExprError('distance missing');
		}
		return { kind: 'number', value: best };
	});
	/**
	 * How much nearer the first has come to the second since the last sample, by its own moves where the host gives
	 * positions: the second walking up to it is not it approaching.
	 */
	const closedIn = (args:ExprVal[]):number | undefined => {
		const pair = twoEnt(args);
		const d = pair && distOf(inputs, pair[0], pair[1]);
		if (!pair || d === undefined) {
			return undefined;
		}
		const before = inputs.cache.rememberDist(pair[0].id, pair[1].id, d);
		const at = inputs.point?.(pair[0]);
		const there = inputs.point?.(pair[1]);
		if (!at || !there) {
			return before === undefined ? undefined : before - d;
		}
		const was = inputs.cache.rememberPoint(pair[0].id, at);
		return was && Math.hypot(...was.map((v, i) => v - (there[i] ?? 0))) - d;
	};
	fns.set('isApproaching', (args) => ({ kind: 'bool', value: (closedIn(args) ?? 0) > DIST_EPS }));
	fns.set('isDeparting', (args) => ({ kind: 'bool', value: (closedIn(args) ?? 0) < -DIST_EPS }));
	fns.set('approaching', (args, ctx) => filterMotion(inputs, args, ctx.catalog.me, true, fns));
	fns.set('departing', (args, ctx) => filterMotion(inputs, args, ctx.catalog.me, false, fns));
	if (inputs.nearRadius !== undefined) {
		const r0 = inputs.nearRadius;
		fns.set('isNear', (args) => {
			const r = asNum(args[2]) ?? r0;
			return { kind: 'bool', value: nearAny(inputs, args[0], args[1], r) };
		});
		fns.set('nearby', (args, ctx) => nearbyList(inputs, args, ctx.catalog.me, r0));
	}
}

function filterMotion(
	inputs:CatalogInputs,
	args:ExprVal[],
	me:ExprEntity,
	closing:boolean,
	fns:Map<string, NativeFn>,
):ExprVal {
	const rows = args[0]?.kind === 'list' ? args[0].value : undefined;
	if (!rows) {
		throw new ExprError('approaching/departing needs a list');
	}
	const target = args[1]?.kind === 'entity' ? args[1].value : me;
	const pred = closing ? fns.get('isApproaching')! : fns.get('isDeparting')!;
	const out:ExprVal[] = [];
	for (const row of rows) {
		if (row.kind !== 'entity') {
			continue;
		}
		const hit = pred([row, { kind: 'entity', value: target }], { catalog: { names: new Map(), fns, me, cache: inputs.cache }, env: new Map(), nodes: 0 });
		if (hit.kind === 'bool' && hit.value) {
			out.push(row);
		}
	}
	return capList(out, inputs.listCap ?? LIST_CAP);
}

function nearbyList(inputs:CatalogInputs, args:ExprVal[], me:ExprEntity, defaultR:number):ExprVal {
	const rows = args[0]?.kind === 'list' ? args[0].value : undefined;
	if (!rows) {
		throw new ExprError('nearby needs a list');
	}
	let r = defaultR;
	let target = me;
	const a1 = args[1];
	const a2 = args[2];
	if (a1?.kind === 'number') {
		r = a1.value;
		if (a2?.kind === 'entity') {
			target = a2.value;
		}
	}
	else if (a1?.kind === 'entity') {
		target = a1.value;
	}
	if (r < 0) {
		return { kind: 'list', value: [] };
	}
	const out:ExprVal[] = [];
	for (const row of rows) {
		if (row.kind !== 'entity') {
			continue;
		}
		const d = distOf(inputs, target, row.value);
		if (d === undefined) {
			continue;
		}
		inputs.cache.rememberDist(target.id, row.value.id, d);
		if (d <= r && inSight(inputs, target, row.value)) {
			out.push(row);
		}
	}
	return capList(out, inputs.listCap ?? LIST_CAP);
}

/** No `canSee` means the host has no sight test, so distance is the whole check. */
function inSight(inputs:CatalogInputs, from:ExprEntity, to:ExprEntity):boolean {
	return inputs.canSee ? inputs.canSee(from, to) : true;
}

function bindPath(inputs:CatalogInputs, fns:Map<string, NativeFn>):void {
	fns.set('isReachable', (args) => {
		const pair = twoEnt(args);
		if (!pair) {
			return { kind: 'bool', value: false };
		}
		return { kind: 'bool', value: pathOf(inputs, pair[0], pair[1]) !== undefined };
	});
	fns.set('reachable', (args, ctx) => reachableList(inputs, args, ctx.catalog.me));
}

function reachableList(inputs:CatalogInputs, args:ExprVal[], me:ExprEntity):ExprVal {
	const rows = args[0]?.kind === 'list' ? args[0].value : undefined;
	if (!rows) {
		throw new ExprError('reachable needs a list');
	}
	const from = args[1]?.kind === 'entity' ? args[1].value : me;
	const ranked:{ row:ExprVal; d:number }[] = [];
	for (const row of rows) {
		if (row.kind !== 'entity') {
			continue;
		}
		const d = pathOf(inputs, from, row.value);
		if (d === undefined) {
			continue;
		}
		ranked.push({ row, d });
	}
	ranked.sort((a, b) => a.d - b.d);
	return { kind: 'list', value: ranked.slice(0, inputs.listCap ?? LIST_CAP).map((r) => r.row) };
}

function bindSight(inputs:CatalogInputs, fns:Map<string, NativeFn>):void {
	const see = inputs.canSee!;
	fns.set('hasSightline', (args) => {
		const pair = twoEnt(args);
		if (!pair) {
			return { kind: 'bool', value: false };
		}
		const v = !!see(pair[0], pair[1]);
		inputs.cache.rememberSeen(pair[0].id, pair[1].id, v);
		return { kind: 'bool', value: v };
	});
	fns.set('hasJustSeen', (args) => {
		const pair = twoEnt(args);
		if (!pair) {
			return { kind: 'bool', value: false };
		}
		const v = !!see(pair[0], pair[1]);
		const prev = inputs.cache.rememberSeen(pair[0].id, pair[1].id, v);
		return { kind: 'bool', value: v && prev === false };
	});
	fns.set('hasLostSight', (args) => {
		const pair = twoEnt(args);
		if (!pair) {
			return { kind: 'bool', value: false };
		}
		const v = !!see(pair[0], pair[1]);
		const prev = inputs.cache.rememberSeen(pair[0].id, pair[1].id, v);
		return { kind: 'bool', value: !v && prev === true };
	});
}

function bindFacingNumber(inputs:CatalogInputs, fns:Map<string, NativeFn>):void {
	const read = inputs.facing!;
	fns.set('facing', (args) => {
		const pair = twoEnt(args);
		if (!pair) {
			throw new ExprError('facing needs two people');
		}
		const v = read(pair[0], pair[1]);
		inputs.cache.rememberFacing(pair[0].id, pair[1].id, v);
		return { kind: 'number', value: v };
	});
	fns.set('isFacing', (args) => ({
		kind: 'bool',
		value: anyPair(args, (a, b) => {
			const v = read(a, b);
			inputs.cache.rememberFacing(a.id, b.id, v);
			return v > FACING_COS;
		}),
	}));
	fns.set('isBehind', (args) => ({
		kind: 'bool',
		value: anyPair(args, (a, b) => read(a, b) < 0),
	}));
	if (inputs.side) {
		const sideOf = inputs.side;
		fns.set('isLeft', (args) => ({
			kind: 'bool',
			value: anyPair(args, (a, b) => {
				const cross = sideOf(a, b);
				return cross < 0 && Math.abs(cross) > Math.abs(read(a, b));
			}),
		}));
		fns.set('isRight', (args) => ({
			kind: 'bool',
			value: anyPair(args, (a, b) => {
				const cross = sideOf(a, b);
				return cross > 0 && Math.abs(cross) > Math.abs(read(a, b));
			}),
		}));
	}
	fns.set('wasJustFacing', (args) => {
		const pair = twoEnt(args);
		if (!pair) {
			return { kind: 'bool', value: false };
		}
		const v = read(pair[0], pair[1]);
		const now = v > FACING_COS;
		const prev = inputs.cache.rememberFacing(pair[0].id, pair[1].id, v);
		const was = typeof prev === 'number' ? prev > FACING_COS : prev === true;
		return { kind: 'bool', value: now && !was && prev !== undefined };
	});
}

function bindGrid(inputs:CatalogInputs, fns:Map<string, NativeFn>):void {
	const atOf = inputs.point!;
	/** Per-axis gaps between two entities, or undefined when either has no position. */
	const gaps = (args:ExprVal[]):number[] | undefined => {
		const pair = twoEnt(args);
		const a = pair && atOf(pair[0]);
		const b = pair && atOf(pair[1]);
		return a && b ? a.map((v, i) => Math.abs(v - (b[i] ?? 0))) : undefined;
	};
	fns.set('manhattan', (args) => {
		const g = gaps(args);
		if (!g) {
			throw new ExprError('manhattan needs two people or things');
		}
		return { kind: 'number', value: g.reduce((sum, v) => sum + v, 0) };
	});
	fns.set('chebyshev', (args) => {
		const g = gaps(args);
		if (!g) {
			throw new ExprError('chebyshev needs two people or things');
		}
		return { kind: 'number', value: Math.max(0, ...g) };
	});
	fns.set('inSquare', (args) => {
		const g = gaps(args);
		if (!g) {
			return { kind: 'bool', value: false };
		}
		const r = asNum(args[2]) ?? inputs.nearRadius ?? 0;
		return { kind: 'bool', value: Math.max(0, ...g) <= r };
	});
}

/**
 * `hasRisen("name", n)` and `hasFallen("name", n)`. A watch stays true as long as what it reads does, and a true watch
 * keeps a mind thinking: these are true once, at the sample where the number they name changed.
 */
function bindChange(inputs:CatalogInputs, fns:Map<string, NativeFn>):void {
	const changed = (args:ExprVal[], by:(now:number, was:number)=>boolean):ExprVal => {
		const key = args[0]?.kind === 'string' ? args[0].value : '';
		const now = args[1]?.kind === 'number' ? args[1].value : Number.NaN;
		const was = inputs.cache.rememberCount(key, now);
		return { kind: 'bool', value: was !== undefined && by(now, was) };
	};
	fns.set('hasRisen', (args) => changed(args, (now, was) => now > was));
	fns.set('hasFallen', (args) => changed(args, (now, was) => now < was));
}

function bindBusy(fns:Map<string, NativeFn>):void {
	const busyOf = (who:ExprEntity):boolean => {
		const v = who.fields?.busy;
		return v?.kind === 'bool' && v.value;
	};
	const verbOf = (who:ExprEntity):string => {
		const v = who.fields?.verb;
		return v?.kind === 'string' ? v.value : '';
	};
	fns.set('isBusy', (args) => {
		const who = args[0]?.kind === 'entity' ? args[0].value : undefined;
		if (!who) {
			return { kind: 'bool', value: false };
		}
		return { kind: 'bool', value: busyOf(who) };
	});
	fns.set('doing', (args) => {
		const who = args[0]?.kind === 'entity' ? args[0].value : undefined;
		const verb = args[1]?.kind === 'string' ? args[1].value : '';
		if (!who || !verb) {
			return { kind: 'bool', value: false };
		}
		// Its verb (`gather`), or what it is at as the roster words it (`gathering Wood`).
		const work = who.fields?.doing;
		return { kind: 'bool', value: verbOf(who) === verb || (work?.kind === 'string' && work.value === verb) };
	});
}

function bindOpen(inputs:CatalogInputs, fns:Map<string, NativeFn>):void {
	const read = inputs.isOpen!;
	const whoOf = (args:ExprVal[]):ExprEntity | undefined => {
		if (args[0]?.kind === 'entity') {
			return args[0].value;
		}
		if (args[0]?.kind === 'string') {
			return { id: args[0].value, tags: [] };
		}
		return undefined;
	};
	fns.set('isOpen', (args) => {
		const who = whoOf(args);
		if (!who) {
			return { kind: 'bool', value: false };
		}
		const v = !!read(who);
		inputs.cache.rememberOpen(who.id, v);
		return { kind: 'bool', value: v };
	});
	fns.set('hasJustOpened', (args) => {
		const who = whoOf(args);
		if (!who) {
			return { kind: 'bool', value: false };
		}
		const v = !!read(who);
		const prev = inputs.cache.rememberOpen(who.id, v);
		return { kind: 'bool', value: v && prev === false };
	});
}

/** `isReady(me, "block")`, or `isReady("block")` for `me`: the verb's cooldown is over. */
function bindReady(inputs:CatalogInputs, fns:Map<string, NativeFn>):void {
	const read = inputs.isReady!;
	fns.set('isReady', (args) => {
		const who = args[0]?.kind === 'entity' ? args[0].value : inputs.me;
		const verb = args.at(-1);
		if (verb?.kind !== 'string') {
			throw new ExprError('isReady needs a verb, as isReady(me, "block")');
		}
		return { kind: 'bool', value: read(who, verb.value) ?? true };
	});
}

export function dummyEntity(id:string, extra:Omit<Partial<ExprEntity>, 'id'> = {}):ExprEntity {
	return { ...extra, id, tags: extra.tags ?? [] };
}

export { entityName, ABSENT };
