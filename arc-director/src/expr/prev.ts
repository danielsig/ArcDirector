import { ABSENT, type ExprEntity, type ExprVal } from './types.js';

export type PrevAction = {
	secondsAgo:number;
	isOk:boolean;
	reason:string;
	verb:string;
};

export type PrevSpec = {
	/** Absent until the first tactical think. */
	secondsAgo?:number;
	me:ExprEntity;
	actions?:PrevAction[];
};

export type MeFreezeHost = {
	me:ExprEntity;
	inventory?:(who:ExprEntity)=>ExprEntity[];
	hp?:(who:ExprEntity)=>{ hp:number; maxHP:number } | undefined;
};

export function cloneVal(v:ExprVal):ExprVal {
	switch (v.kind) {
		case 'absent':
			return ABSENT;
		case 'bool':
			return { kind: 'bool', value: v.value };
		case 'number':
			return { kind: 'number', value: v.value };
		case 'string':
			return { kind: 'string', value: v.value };
		case 'entity':
			return { kind: 'entity', value: cloneEntity(v.value) };
		case 'list':
			return { kind: 'list', value: v.value.map(cloneVal) };
		case 'fn':
			return { kind: 'fn', name: v.name };
		case 'lambda':
			return { kind: 'lambda', params: [...v.params], body: v.body };
	}
}

export function cloneEntity(e:ExprEntity):ExprEntity {
	const fields = e.fields;
	const next:ExprEntity = { id: e.id, tags: [...e.tags] };
	if (e.name !== undefined) {
		next.name = e.name;
	}
	if (fields) {
		const copy:Record<string, ExprVal> = {};
		for (const [k, v] of Object.entries(fields)) {
			copy[k] = cloneVal(v);
		}
		next.fields = copy;
	}
	return next;
}

function asEntityList(rows:ExprEntity[]):ExprVal {
	return { kind: 'list', value: rows.map((row) => ({ kind: 'entity' as const, value: cloneEntity(row) })) };
}

/** Frozen self: bag and hp copied onto fields. Do not later `inventory(prev.me)` / `hp(prev.me)`. */
export function freezeMe(host:MeFreezeHost):ExprEntity {
	const frozen = cloneEntity(host.me);
	const fields = frozen.fields ?? {};
	if (host.inventory) {
		fields.inventory = asEntityList(host.inventory(host.me));
	}
	if (host.hp) {
		const v = host.hp(host.me);
		if (v) {
			fields.hp = { kind: 'number', value: v.hp };
			fields.maxHP = { kind: 'number', value: v.maxHP };
		}
	}
	frozen.fields = fields;
	return frozen;
}

function actionEntity(a:PrevAction, i:number):ExprVal {
	return {
		kind: 'entity',
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
	};
}

export function bindPrev(names:Map<string, ExprVal>, prev:PrevSpec):void {
	const fields:Record<string, ExprVal> = {
		me: { kind: 'entity', value: cloneEntity(prev.me) },
		actions: {
			kind: 'list',
			value: (prev.actions ?? []).map(actionEntity),
		},
	};
	if (prev.secondsAgo !== undefined && Number.isFinite(prev.secondsAgo)) {
		fields.secondsAgo = { kind: 'number', value: prev.secondsAgo };
	}
	names.set('prev', {
		kind: 'entity',
		value: { id: 'prev', tags: [], fields },
	});
}

export function bagOf(who:ExprEntity):ExprEntity[] {
	const bag = who.fields?.inventory;
	if (bag?.kind !== 'list') {
		return [];
	}
	const out:ExprEntity[] = [];
	for (const row of bag.value) {
		if (row.kind === 'entity') {
			out.push(row.value);
		}
	}
	return out;
}

export function prevMeFromJSON(raw:unknown):ExprEntity | undefined {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return undefined;
	}
	const o = raw as { id?:unknown; name?:unknown; tags?:unknown; fields?:unknown };
	if (typeof o.id !== 'string' || !o.id) {
		return undefined;
	}
	const tags = Array.isArray(o.tags)
		? o.tags.filter((t):t is string => typeof t === 'string')
		: [];
	const e:ExprEntity = { id: o.id, tags };
	if (typeof o.name === 'string') {
		e.name = o.name;
	}
	if (o.fields && typeof o.fields === 'object' && !Array.isArray(o.fields)) {
		e.fields = o.fields as Record<string, ExprVal>;
		return cloneEntity(e);
	}
	return e;
}
