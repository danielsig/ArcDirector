import { bagOf } from './prev.js';
import { ExprError, needleMatch, type ExprEntity, type ExprVal, type NativeFn } from './types.js';

export function asEntityVal(e:ExprEntity):ExprVal {
	return { kind: 'entity', value: e };
}

export function asEntityList(rows:ExprEntity[]):ExprVal {
	return { kind: 'list', value: rows.map(asEntityVal) };
}

export function bindRoster(
	names:Map<string, ExprVal>,
	host:{ me:ExprEntity; others:ExprEntity[]; items:ExprEntity[] },
):void {
	names.set('me', asEntityVal(host.me));
	names.set('others', asEntityList(host.others));
	names.set('items', asEntityList(host.items));
}

function bagHas(bag:ExprEntity[], x:ExprVal | undefined):boolean {
	if (!x || x.kind === 'absent') {
		return false;
	}
	if (x.kind === 'string') {
		return bag.some((i) => needleMatch(i, x.value));
	}
	if (x.kind === 'entity') {
		return bag.some((i) => i.id === x.value.id);
	}
	throw new ExprError('carry needle or entity');
}

function addUnaryFunction(fns:Map<string, NativeFn>, fnName:string, fn:(x:ExprVal)=>ExprVal):void {
	fns.set(fnName, (args) => {
		if (args.length > 1 && args[1]?.kind !== 'absent') {
			throw new ExprError(`${fnName} takes one argument`);
		}
		const x = args[0];
		if (!x || x.kind === 'absent') {
			return { kind: 'bool', value: false };
		}
		return fn(x);
	});
}

export function bindCarry(
	host:{
		me:ExprEntity;
		inventory:(who:ExprEntity)=>ExprEntity[];
	},
	prevMe:ExprEntity,
	names:Map<string, ExprVal>,
	fns:Map<string, NativeFn>,
):void {
	const pack = host.inventory;
	host.me.fields = {
		...host.me.fields,
		inventory: asEntityList(pack(host.me)),
	};
	names.set('me', asEntityVal(host.me));
	addUnaryFunction(fns, 'isCarrying', (x) => (
		{ kind: 'bool', value: bagHas(pack(host.me), x) }
	));
	addUnaryFunction(fns, 'wasCarrying', (x) => (
		{ kind: 'bool', value: bagHas(bagOf(prevMe), x) }
	));
	addUnaryFunction(fns, 'hasJustReceived', (x) => (
		{ kind: 'bool', value: bagHas(pack(host.me), x) && !bagHas(bagOf(prevMe), x) }
	));
	addUnaryFunction(fns, 'hasJustLost', (x) => (
		{ kind: 'bool', value: !bagHas(pack(host.me), x) && bagHas(bagOf(prevMe), x) }
	));
}
