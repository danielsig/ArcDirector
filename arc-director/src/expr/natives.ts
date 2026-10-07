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
	type Catalog,
	type ExprEntity,
	type ExprVal,
	type NativeFn,
	type SampleCache,
	type Stringifiers,
} from './types.js';
import { bindCarry, bindRoster, asEntityVal } from './me.js';
import { bindPrev, cloneEntity, freezeMe, type PrevSpec } from './prev.js';

export type HostKernels = {
	me:ExprEntity;
	others:ExprEntity[];
	items:ExprEntity[];
	cache:SampleCache;
	bindings?:Record<string, ExprVal>;
	hostFns?:Record<string, NativeFn>;
	distance?:(a:ExprEntity, b:ExprEntity)=>number | undefined;
	nearRadius?:number;
	/** Length of the route a character would take; undefined = no way there. */
	pathDistance?:(a:ExprEntity, b:ExprEntity)=>number | undefined;
	canSee?:(a:ExprEntity, b:ExprEntity)=>boolean;
	facing?:(a:ExprEntity, b:ExprEntity)=>number;
	/** Signed left/right of a's facing toward b (−1 left … +1 right). */
	side?:(a:ExprEntity, b:ExprEntity)=>number;
	isFacing?:(a:ExprEntity, b:ExprEntity)=>boolean;
	inventory?:(who:ExprEntity)=>ExprEntity[];
	hp?:(who:ExprEntity)=>{ hp:number; maxHP:number } | undefined;
	isOpen?:(who:ExprEntity)=>boolean | undefined;
	/** Director fills from unabsorbed `HeardSpeech`. Standalone `buildCatalog` may set it. */
	hasHeard?:boolean;
	/** Last-think freeze. Director injects; standalone may omit (then `prev.me` is this catalog's `me`). */
	prev?:PrevSpec;
	stringifiers?:Stringifiers;
	/** Position for manhattan / chebyshev / inSquare. */
	point?:(who:ExprEntity)=>number[] | undefined;
	/** Override watch LIST_CAP (a collective's `who` uses its roster size). */
	listCap?:number;
};

function hpFromFields(who:ExprEntity):{ hp:number; maxHP:number } | undefined {
	const hp = who.fields?.hp;
	const maxHP = who.fields?.maxHP;
	if (hp?.kind !== 'number' || maxHP?.kind !== 'number') {
		return undefined;
	}
	return { hp: hp.value, maxHP: maxHP.value };
}

function twoEnt(args:ExprVal[]):[ExprEntity, ExprEntity] | undefined {
	const a = args[0]?.kind === 'entity' ? args[0].value : undefined;
	const b = args[1]?.kind === 'entity' ? args[1].value : undefined;
	if (!a || !b) {
		return undefined;
	}
	return [a, b];
}

/** True if pred holds for any entity pair; lists expand. */
function anyPair(args:ExprVal[], pred:(a:ExprEntity, b:ExprEntity)=>boolean):boolean {
	const a = args[0];
	const b = args[1];
	if (!a || !b) {
		return false;
	}
	const left = a.kind === 'list' ? a.value : [a];
	const right = b.kind === 'list' ? b.value : [b];
	for (const x of left) {
		if (x.kind !== 'entity') {
			continue;
		}
		for (const y of right) {
			if (y.kind !== 'entity') {
				continue;
			}
			if (pred(x.value, y.value)) {
				return true;
			}
		}
	}
	return false;
}

function distOf(host:HostKernels, a:ExprEntity, b:ExprEntity):number | undefined {
	if (!host.distance) {
		return undefined;
	}
	const d = host.distance(a, b);
	if (d === undefined || !Number.isFinite(d)) {
		return undefined;
	}
	return d;
}

function nearAny(host:HostKernels, a:ExprVal | undefined, b:ExprVal | undefined, r:number):boolean {
	if (!a || !b) {
		return false;
	}
	if (a.kind === 'list') {
		return a.value.some((row) => nearAny(host, row, b, r));
	}
	if (b.kind === 'list') {
		return b.value.some((row) => nearAny(host, a, row, r));
	}
	if (a.kind !== 'entity' || b.kind !== 'entity') {
		return false;
	}
	const d = distOf(host, a.value, b.value);
	return d !== undefined && d <= r;
}

function pathOf(host:HostKernels, a:ExprEntity, b:ExprEntity):number | undefined {
	const d = host.pathDistance?.(a, b);
	if (d === undefined || !Number.isFinite(d)) {
		return undefined;
	}
	host.cache.rememberPath(a.id, b.id, d);
	return d;
}

export function buildCatalog(host:HostKernels):Catalog {
	const names = new Map<string, ExprVal>();
	const fns = new Map<string, NativeFn>(Object.entries(builtins));
	bindRoster(names, host);
	if (host.hasHeard !== undefined) {
		names.set('hasHeard', { kind: 'bool', value: host.hasHeard });
	}
	for (const [k, v] of Object.entries(host.bindings ?? {})) {
		if (!names.has(k)) {
			names.set(k, v);
		}
	}

	if (host.inventory) {
		const pack = host.inventory;
		const prevMe = host.prev?.me ?? freezeMe(host);
		bindCarry({ me: host.me, inventory: pack }, prevMe, names, fns);
		bindPrev(names, {
			secondsAgo: host.prev?.secondsAgo,
			me: prevMe,
			verbs: host.prev?.verbs ?? [],
		});
	}
	else {
		bindPrev(names, {
			secondsAgo: host.prev?.secondsAgo,
			me: host.prev?.me ?? cloneEntity(host.me),
			verbs: host.prev?.verbs ?? [],
		});
	}

	if (host.hp) {
		const read = host.hp;
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
			host.cache.rememberHP(who.id, v.hp);
		};
		attach(host.me);
		for (const o of host.others) {
			attach(o);
		}
		names.set('me', asEntityVal(host.me));
		fns.set('isHurt', (args) => {
			const who = args[0]?.kind === 'entity' ? args[0].value : host.me;
			const v = read(who) ?? hpFromFields(who);
			if (!v) {
				return { kind: 'bool', value: false };
			}
			return { kind: 'bool', value: v.hp > 0 && v.hp < v.maxHP };
		});
		fns.set('isHPFalling', (args) => {
			const who = args[0]?.kind === 'entity' ? args[0].value : host.me;
			const v = read(who);
			if (!v) {
				return { kind: 'bool', value: false };
			}
			const prev = host.cache.rememberHP(who.id, v.hp);
			return { kind: 'bool', value: prev !== undefined && v.hp < prev - 0.0001 };
		});
	}

	if (host.distance) {
		bindDistance(host, fns);
	}
	if (host.point) {
		bindGrid(host, fns);
	}
	if (host.pathDistance) {
		bindPath(host, fns);
	}
	if (host.canSee) {
		bindSight(host, fns);
	}
	if (host.facing) {
		bindFacingNumber(host, fns);
	}
	else if (host.isFacing) {
		bindFacingBool(host, fns);
	}
	if (host.isOpen) {
		bindOpen(host, fns);
	}
	bindBusy(fns);
	for (const [k, fn] of Object.entries(host.hostFns ?? {})) {
		fns.set(k, fn);
	}

	return {
		names,
		fns,
		me: host.me,
		cache: host.cache,
		stringifiers: host.stringifiers,
		listCap: host.listCap,
	};
}

function bindDistance(host:HostKernels, fns:Map<string, NativeFn>):void {
	fns.set('distance', (args) => {
		const pair = twoEnt(args);
		if (!pair) {
			throw new ExprError('distance needs two people or things');
		}
		const d = distOf(host, pair[0], pair[1]);
		if (d === undefined) {
			throw new ExprError('distance missing');
		}
		host.cache.rememberDist(pair[0].id, pair[1].id, d);
		return { kind: 'number', value: d };
	});
	fns.set('isApproaching', (args) => {
		const pair = twoEnt(args);
		if (!pair) {
			return { kind: 'bool', value: false };
		}
		const d = distOf(host, pair[0], pair[1]);
		if (d === undefined) {
			return { kind: 'bool', value: false };
		}
		const prev = host.cache.rememberDist(pair[0].id, pair[1].id, d);
		return { kind: 'bool', value: prev !== undefined && d < prev - DIST_EPS };
	});
	fns.set('isDeparting', (args) => {
		const pair = twoEnt(args);
		if (!pair) {
			return { kind: 'bool', value: false };
		}
		const d = distOf(host, pair[0], pair[1]);
		if (d === undefined) {
			return { kind: 'bool', value: false };
		}
		const prev = host.cache.rememberDist(pair[0].id, pair[1].id, d);
		return { kind: 'bool', value: prev !== undefined && d > prev + DIST_EPS };
	});
	fns.set('approaching', (args, ctx) => filterMotion(host, args, ctx.catalog.me, true, fns));
	fns.set('departing', (args, ctx) => filterMotion(host, args, ctx.catalog.me, false, fns));
	if (host.nearRadius !== undefined) {
		const r0 = host.nearRadius;
		fns.set('isNear', (args) => {
			const r = asNum(args[2]) ?? r0;
			return { kind: 'bool', value: nearAny(host, args[0], args[1], r) };
		});
		fns.set('nearby', (args, ctx) => nearbyList(host, args, ctx.catalog.me, r0));
	}
}

function filterMotion(
	host:HostKernels,
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
		const hit = pred([row, { kind: 'entity', value: target }], { catalog: { names: new Map(), fns, me, cache: host.cache }, env: new Map(), nodes: 0 });
		if (hit.kind === 'bool' && hit.value) {
			out.push(row);
		}
	}
	return capList(out, host.listCap ?? LIST_CAP);
}

function nearbyList(host:HostKernels, args:ExprVal[], me:ExprEntity, defaultR:number):ExprVal {
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
		const d = distOf(host, target, row.value);
		if (d === undefined) {
			continue;
		}
		host.cache.rememberDist(target.id, row.value.id, d);
		if (d <= r && inSight(host, target, row.value)) {
			out.push(row);
		}
	}
	return capList(out, host.listCap ?? LIST_CAP);
}

/** No `canSee` means the host has no sight test, so distance is the whole check. */
function inSight(host:HostKernels, from:ExprEntity, to:ExprEntity):boolean {
	return host.canSee ? host.canSee(from, to) : true;
}

function bindPath(host:HostKernels, fns:Map<string, NativeFn>):void {
	fns.set('isReachable', (args) => {
		const pair = twoEnt(args);
		if (!pair) {
			return { kind: 'bool', value: false };
		}
		return { kind: 'bool', value: pathOf(host, pair[0], pair[1]) !== undefined };
	});
	fns.set('reachable', (args, ctx) => reachableList(host, args, ctx.catalog.me));
}

function reachableList(host:HostKernels, args:ExprVal[], me:ExprEntity):ExprVal {
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
		const d = pathOf(host, from, row.value);
		if (d === undefined) {
			continue;
		}
		ranked.push({ row, d });
	}
	ranked.sort((a, b) => a.d - b.d);
	return { kind: 'list', value: ranked.slice(0, host.listCap ?? LIST_CAP).map((r) => r.row) };
}

function bindSight(host:HostKernels, fns:Map<string, NativeFn>):void {
	const see = host.canSee!;
	fns.set('hasSightline', (args) => {
		const pair = twoEnt(args);
		if (!pair) {
			return { kind: 'bool', value: false };
		}
		const v = !!see(pair[0], pair[1]);
		host.cache.rememberSeen(pair[0].id, pair[1].id, v);
		return { kind: 'bool', value: v };
	});
	fns.set('hasJustSeen', (args) => {
		const pair = twoEnt(args);
		if (!pair) {
			return { kind: 'bool', value: false };
		}
		const v = !!see(pair[0], pair[1]);
		const prev = host.cache.rememberSeen(pair[0].id, pair[1].id, v);
		return { kind: 'bool', value: v && prev === false };
	});
	fns.set('hasLostSight', (args) => {
		const pair = twoEnt(args);
		if (!pair) {
			return { kind: 'bool', value: false };
		}
		const v = !!see(pair[0], pair[1]);
		const prev = host.cache.rememberSeen(pair[0].id, pair[1].id, v);
		return { kind: 'bool', value: !v && prev === true };
	});
}

function bindFacingNumber(host:HostKernels, fns:Map<string, NativeFn>):void {
	const read = host.facing!;
	fns.set('facing', (args) => {
		const pair = twoEnt(args);
		if (!pair) {
			throw new ExprError('facing needs two people');
		}
		const v = read(pair[0], pair[1]);
		host.cache.rememberFacing(pair[0].id, pair[1].id, v);
		return { kind: 'number', value: v };
	});
	fns.set('isFacing', (args) => ({
		kind: 'bool',
		value: anyPair(args, (a, b) => {
			const v = read(a, b);
			host.cache.rememberFacing(a.id, b.id, v);
			return v > FACING_COS;
		}),
	}));
	fns.set('isBehind', (args) => ({
		kind: 'bool',
		value: anyPair(args, (a, b) => read(a, b) < 0),
	}));
	if (host.side) {
		const sideOf = host.side;
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
		const prev = host.cache.rememberFacing(pair[0].id, pair[1].id, v);
		const was = typeof prev === 'number' ? prev > FACING_COS : prev === true;
		return { kind: 'bool', value: now && !was && prev !== undefined };
	});
}

function bindFacingBool(host:HostKernels, fns:Map<string, NativeFn>):void {
	const read = host.isFacing!;
	fns.set('isFacing', (args) => {
		const pair = twoEnt(args);
		if (!pair) {
			return { kind: 'bool', value: false };
		}
		const v = !!read(pair[0], pair[1]);
		host.cache.rememberFacing(pair[0].id, pair[1].id, v);
		return { kind: 'bool', value: v };
	});
	fns.set('isBehind', (args) => {
		const pair = twoEnt(args);
		if (!pair) {
			return { kind: 'bool', value: false };
		}
		return { kind: 'bool', value: !read(pair[0], pair[1]) };
	});
	fns.set('wasJustFacing', (args) => {
		const pair = twoEnt(args);
		if (!pair) {
			return { kind: 'bool', value: false };
		}
		const v = !!read(pair[0], pair[1]);
		const prev = host.cache.rememberFacing(pair[0].id, pair[1].id, v);
		return { kind: 'bool', value: v && prev === false };
	});
}

function bindGrid(host:HostKernels, fns:Map<string, NativeFn>):void {
	const atOf = host.point!;
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
		const r = asNum(args[2]) ?? host.nearRadius ?? 0;
		return { kind: 'bool', value: Math.max(0, ...g) <= r };
	});
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
		return { kind: 'bool', value: verbOf(who) === verb };
	});
}

function bindOpen(host:HostKernels, fns:Map<string, NativeFn>):void {
	const read = host.isOpen!;
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
		host.cache.rememberOpen(who.id, v);
		return { kind: 'bool', value: v };
	});
	fns.set('hasJustOpened', (args) => {
		const who = whoOf(args);
		if (!who) {
			return { kind: 'bool', value: false };
		}
		const v = !!read(who);
		const prev = host.cache.rememberOpen(who.id, v);
		return { kind: 'bool', value: v && prev === false };
	});
}

export function dummyEntity(id:string, extra:Omit<Partial<ExprEntity>, 'id'> = {}):ExprEntity {
	return { ...extra, id, tags: extra.tags ?? [] };
}

export { entityName, ABSENT };
