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
	needleMatch,
	type Catalog,
	type ExprEntity,
	type ExprVal,
	type NativeFn,
	type SampleCache,
	type StringifierKind,
	type Stringifiers,
} from './types.js';

export type HostKernels = {
	me:ExprEntity;
	others:ExprEntity[];
	items:ExprEntity[];
	cache:SampleCache;
	bindings?:Record<string, ExprVal>;
	hostFns?:Record<string, NativeFn>;
	distance?:(a:ExprEntity, b:ExprEntity)=>number | undefined;
	nearRadius?:number;
	/** Meters of walkable path; undefined = no path; 0 = same cell. */
	walkDistance?:(a:ExprEntity, b:ExprEntity)=>number | undefined;
	canSee?:(a:ExprEntity, b:ExprEntity)=>boolean;
	facing?:(a:ExprEntity, b:ExprEntity)=>number;
	isFacing?:(a:ExprEntity, b:ExprEntity)=>boolean;
	inventory?:(who:ExprEntity)=>ExprEntity[];
	hp?:(who:ExprEntity)=>{ hp:number; maxHP:number } | undefined;
	isOpen?:(who:ExprEntity)=>boolean | undefined;
	/** Director fills from unabsorbed `HeardSpeech`. Standalone `buildCatalog` may set it. */
	hasHeard?:boolean;
	/** Director fills from `lastTacticalAt`. */
	prevThought?:{ secondsAgo:number };
	/** Director fills from `lastResult`. */
	prevActions?:{ secondsAgo:number; isOk:boolean; reason:string; verb:string }[];
	stringifiers?:Stringifiers;
	/** Host picks the stringifier key. The library never inspects tags for doors/people/items. */
	stringifierKind?:(entity:ExprEntity)=>StringifierKind;
};

function ent(e:ExprEntity):ExprVal {
	return { kind: 'entity', value: e };
}

function list(rows:ExprEntity[]):ExprVal {
	return { kind: 'list', value: rows.map(ent) };
}

function twoEnt(args:ExprVal[]):[ExprEntity, ExprEntity] | undefined {
	const a = args[0]?.kind === 'entity' ? args[0].value : undefined;
	const b = args[1]?.kind === 'entity' ? args[1].value : undefined;
	if (!a || !b) {
		return undefined;
	}
	return [a, b];
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

function walkOf(host:HostKernels, a:ExprEntity, b:ExprEntity):number | undefined {
	if (!host.walkDistance) {
		return undefined;
	}
	const d = host.walkDistance(a, b);
	if (d === undefined || !Number.isFinite(d)) {
		return undefined;
	}
	host.cache.rememberWalk(a.id, b.id, d);
	return d;
}

export function buildCatalog(host:HostKernels):Catalog {
	const names = new Map<string, ExprVal>();
	const fns = new Map<string, NativeFn>(Object.entries(builtins));
	names.set('me', ent(host.me));
	names.set('others', list(host.others));
	names.set('items', list(host.items));
	if (host.hasHeard !== undefined) {
		names.set('hasHeard', { kind: 'bool', value: host.hasHeard });
	}
	if (host.prevThought) {
		names.set('prevThought', {
			kind: 'entity',
			value: {
				id: 'prevThought',
				tags: [],
				fields: { secondsAgo: { kind: 'number', value: host.prevThought.secondsAgo } },
			},
		});
	}
	if (host.prevActions) {
		names.set('prevActions', {
			kind: 'list',
			value: host.prevActions.map((a, i) => ({
				kind: 'entity' as const,
				value: {
					id: `action${i}`,
					tags: [],
					fields: {
						secondsAgo: { kind: 'number', value: a.secondsAgo },
						isOk: { kind: 'bool', value: a.isOk },
						reason: { kind: 'string', value: a.reason },
						verb: { kind: 'string', value: a.verb },
					},
				},
			})),
		});
	}
	for (const [k, v] of Object.entries(host.bindings ?? {})) {
		if (!names.has(k)) {
			names.set(k, v);
		}
	}

	if (host.inventory) {
		const pack = host.inventory;
		host.me.fields = {
			...host.me.fields,
			inventory: list(pack(host.me)),
		};
		names.set('me', ent(host.me));
		fns.set('isCarrying', (args) => {
			if (args.length > 1 && args[1]?.kind !== 'absent') {
				throw new ExprError('isCarrying takes one argument');
			}
			const bag = pack(host.me);
			const x = args[0];
			if (!x || x.kind === 'absent') {
				return { kind: 'bool', value: false };
			}
			if (x.kind === 'string') {
				return { kind: 'bool', value: bag.some((i) => needleMatch(i, x.value)) };
			}
			if (x.kind === 'entity') {
				return { kind: 'bool', value: bag.some((i) => i.id === x.value.id) };
			}
			throw new ExprError('isCarrying needle or entity');
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
		names.set('me', ent(host.me));
		fns.set('isHurt', (args) => {
			const who = args[0]?.kind === 'entity' ? args[0].value : host.me;
			const v = read(who);
			if (!v) {
				return { kind: 'bool', value: false };
			}
			return { kind: 'bool', value: v.hp < v.maxHP };
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
	if (host.walkDistance) {
		bindWalk(host, fns);
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
	for (const [k, fn] of Object.entries(host.hostFns ?? {})) {
		fns.set(k, fn);
	}

	return { names, fns, me: host.me, cache: host.cache, stringifiers: host.stringifiers, stringifierKind: host.stringifierKind };
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
			const pair = twoEnt(args);
			if (!pair) {
				return { kind: 'bool', value: false };
			}
			const r = asNum(args[2]) ?? r0;
			const d = distOf(host, pair[0], pair[1]);
			if (d === undefined) {
				return { kind: 'bool', value: false };
			}
			return { kind: 'bool', value: d <= r };
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
	return capList(out);
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
		if (d <= r) {
			out.push(row);
		}
	}
	return capList(out);
}

function bindWalk(host:HostKernels, fns:Map<string, NativeFn>):void {
	fns.set('isReachable', (args) => {
		const pair = twoEnt(args);
		if (!pair) {
			return { kind: 'bool', value: false };
		}
		return { kind: 'bool', value: walkOf(host, pair[0], pair[1]) !== undefined };
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
		const d = walkOf(host, from, row.value);
		if (d === undefined) {
			continue;
		}
		ranked.push({ row, d });
	}
	ranked.sort((a, b) => a.d - b.d);
	return { kind: 'list', value: ranked.slice(0, LIST_CAP).map((r) => r.row) };
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
	fns.set('isFacing', (args) => {
		const pair = twoEnt(args);
		if (!pair) {
			return { kind: 'bool', value: false };
		}
		const v = read(pair[0], pair[1]);
		host.cache.rememberFacing(pair[0].id, pair[1].id, v);
		return { kind: 'bool', value: v > FACING_COS };
	});
	fns.set('isBehind', (args) => {
		const pair = twoEnt(args);
		if (!pair) {
			return { kind: 'bool', value: false };
		}
		const v = read(pair[0], pair[1]);
		return { kind: 'bool', value: v < 0 };
	});
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

export function dummyEntity(id:string, extra:Partial<ExprEntity> = {}):ExprEntity {
	return { id, name: extra.name ?? id, tags: extra.tags ?? [], fields: extra.fields };
}

export { entityName, ABSENT };
