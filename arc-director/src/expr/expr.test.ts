import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	buildCatalog,
	dummyEntity,
	evaluate,
	FACING_COS,
	parse,
	SampleCache,
	stringifyVal,
	watchScore,
	type ExprEntity,
	type HostKernels,
	type Stringifiers,
} from './index.js';

type Posed = ExprEntity & { x:number; z:number };

function posed(id:string, extra:Partial<ExprEntity> & { x:number; z:number }):Posed {
	return { ...dummyEntity(id, extra), x: extra.x, z: extra.z };
}

function xz(a:ExprEntity, b:ExprEntity):number {
	const pa = a as Partial<Posed>;
	const pb = b as Partial<Posed>;
	return Math.hypot((pa.x ?? 0) - (pb.x ?? 0), (pa.z ?? 0) - (pb.z ?? 0));
}

function world(extra:Partial<HostKernels> = {}):HostKernels {
	const me = posed('Guard', { x: 0, z: 0, tags: ['agent'] });
	const A = posed('A', { x: 5, z: 0, tags: ['agent'] });
	const B = posed('B', { x: 12, z: 0, tags: ['agent'] });
	const Player = posed('Player', { x: 5, z: 0, tags: ['agent'] });
	const lantern = posed('Lantern', { x: 3, z: 0, tags: ['item', 'key'] });
	const door = posed('CottageDoor', { x: 1, z: 0, tags: ['door'] });
	const theft = posed('Theft', { x: 5, z: 0, tags: ['theft'] });
	const cache = extra.cache ?? new SampleCache();
	return {
		me,
		others: [A, B, Player],
		items: [lantern, door],
		cache,
		nearRadius: 8,
		distance: xz,
		canSee: (a, b) => xz(a, b) < 20,
		facing: () => 1,
		inventory: (who) => who.id === 'Guard' ? [lantern] : [],
		hp: (who) => who.id === 'Guard' ? { hp: 3, maxHP: 5 } : { hp: 5, maxHP: 5 },
		isOpen: (who) => who.id === 'CottageDoor' || who.id === 'MillBridge',
		hasHeard: false,
		bindings: {
			Player: { kind: 'entity', value: Player },
			A: { kind: 'entity', value: A },
			B: { kind: 'entity', value: B },
			CottageDoor: { kind: 'entity', value: door },
			MillBridge: { kind: 'entity', value: dummyEntity('MillBridge', { tags: ['bridge'] }) },
			events: { kind: 'list', value: [{ kind: 'entity', value: theft }] },
			Lantern: { kind: 'entity', value: lantern },
		},
		...extra,
	};
}

function val(expr:string, host?:HostKernels) {
	const cat = buildCatalog(host ?? world());
	return evaluate(expr, cat);
}

function num(expr:string, host?:HostKernels):number {
	const r = val(expr, host);
	assert.equal(r.error, undefined, r.error?.message);
	assert.equal(r.value.kind, 'number');
	return r.value.kind === 'number' ? r.value.value : NaN;
}

function bool(expr:string, host?:HostKernels):boolean {
	const r = val(expr, host);
	assert.equal(r.error, undefined, r.error?.message);
	assert.equal(r.value.kind, 'bool', expr);
	return r.value.kind === 'bool' ? r.value.value : false;
}

describe('parse', () => {
	it('parses literals, arrays, infix is, ternary, ??', () => {
		assert.ok(parse('1 + 2'));
		assert.ok(parse('["key", "door"]'));
		assert.ok(parse('i is "door"'));
		assert.ok(parse('a ? b : c'));
		assert.ok(parse('x ?? y'));
		assert.ok(parse('p => p is "key"'));
		assert.ok(parse('matches(first(prevActions).reason, "locked|blocked")'));
	});

	it('desugars extension calls', () => {
		const a = parse('Player.isNear(me)');
		const b = parse('isNear(Player, me)');
		assert.deepEqual(a.ast, b.ast);
	});

	it('rejects this and self', () => {
		assert.throws(() => parse('this.hp'));
		assert.throws(() => parse('self'));
	});

	it('treats ?. as .', () => {
		assert.deepEqual(parse('me?.inventory').ast, parse('me.inventory').ast);
	});

	it('maps and/or/equals/===/in', () => {
		assert.deepEqual(parse('a and b').ast, parse('a && b').ast);
		assert.deepEqual(parse('a or b').ast, parse('a || b').ast);
		assert.deepEqual(parse('a equals b').ast, parse('a == b').ast);
		assert.deepEqual(parse('a === b').ast, parse('a == b').ast);
		assert.deepEqual(parse('x in y').ast, parse('y.includes(x)').ast);
	});

	it('does not treat is "key" or "door" as any-of', () => {
		const ast = parse('i is "key" or "door"');
		assert.equal(ast.ast.type, 'binary');
		if (ast.ast.type === 'binary') {
			assert.equal(ast.ast.op, '||');
		}
	});
});

describe('evaluate', () => {
	it('&& / || min/max on numbers; and/or on bools', () => {
		assert.equal(num('2 && 5'), 2);
		assert.equal(num('2 || 5'), 5);
		assert.equal(bool('true && false'), false);
		assert.equal(bool('true || false'), true);
		assert.ok(val('true && 1').error);
	});

	it('! / !! and > 0 in some predicates; bool gates 0/1', () => {
		assert.equal(bool('!false'), true);
		assert.equal(bool('!!1'), true);
		assert.equal(bool('!!0'), false);
		assert.equal(num('true * 4'), 4);
		assert.equal(bool('some([0, 2], x => x)'), true);
		assert.equal(bool('some([0, 0], x => x)'), false);
	});

	it('absent find, ??, == null; bool relations false; distance type error', () => {
		assert.equal(val('items.find("nope")').value.kind, 'absent');
		assert.equal(val('items.find("nope") ?? items.find("Lantern")').value.kind, 'entity');
		assert.equal(bool('items.find("nope") == null'), true);
		assert.equal(bool('isNear(items.find("nope"), me)'), false);
		assert.equal(bool('isReachable(items.find("nope"), me)', world({ walkDistance: xz })), false);
		assert.ok(val('distance(items.find("nope"), me)').error);
	});

	it('collection folds', () => {
		assert.equal(num('count(others)'), 3);
		assert.equal(num('sum([1, 2, 3])'), 6);
		assert.equal(num('avg([2, 4])'), 3);
		assert.equal(num('max([1, 9, 3])'), 9);
		assert.equal(num('min(1, 9, 3)'), 1);
		assert.equal(val('first(items)').value.kind, 'entity');
		assert.equal(bool('items.includes("Lantern")'), true);
		assert.equal(bool('all([true, true], x => x)'), true);
		assert.equal(bool('some(items, i => i is "key")'), true);
		assert.equal(val('items.find("Lantern")').value.kind, 'entity');
		assert.equal(val('["key", "door"].map(t => items.find(i => i is t))').value.kind, 'list');
		const sorted = val('sortBy([3, 1, 2], x => x)');
		assert.equal(sorted.value.kind, 'list');
		assert.equal(num('reduce([1, 2, 3], 0, (a, x) => a + x)'), 6);
		assert.equal(val('items.minBy(x => distance(me, x))').value.kind, 'entity');
	});

	it('isNear / nearby with and without radius', () => {
		assert.equal(bool('isNear(me, A)'), true);
		assert.equal(bool('isNear(me, B)'), false);
		const near = val('others.nearby()');
		assert.equal(near.value.kind, 'list');
		if (near.value.kind === 'list') {
			const ids = near.value.value.filter((x) => x.kind === 'entity').map((x) => x.value.id);
			assert.ok(ids.includes('A'));
			assert.ok(!ids.includes('B'));
		}
		assert.deepEqual(val('others.nearby()').value, val('nearby(others)').value);
		assert.equal(bool('isNear(me, B, 16)'), true);
		assert.equal(bool('isNear(me, A, 3)'), false);
		const wide = val('others.nearby(16)');
		const tight = val('others.nearby(4)');
		assert.equal(wide.value.kind, 'list');
		assert.equal(tight.value.kind, 'list');
		if (wide.value.kind === 'list' && tight.value.kind === 'list') {
			assert.ok(wide.value.value.length > tight.value.value.length);
		}
		assert.equal(bool('isNear(me, B, 16)'), true);
		const around = val('items.nearby(Player)');
		assert.equal(around.value.kind, 'list');
	});

	it('isNear / nearby unbound without nearRadius even with explicit 16', () => {
		const host = world({ nearRadius: undefined });
		delete (host as { nearRadius?:number }).nearRadius;
		const r = val('isNear(me, A, 16)', host);
		assert.ok(r.error);
		const n = val('others.nearby(16)', host);
		assert.ok(n.error);
	});

	it('distance 0 does not emit Infinity', () => {
		const me = dummyEntity('Guard');
		const host = world({
			me,
			distance: () => 0,
		});
		assert.ok(val('1 / distance(me, A)', host).error);
	});

	it('facing / isFacing / isBehind', () => {
		const host = world({ facing: () => 1 });
		assert.equal(num('facing(me, Player)', host), 1);
		assert.equal(bool('isFacing(me, Player)', host), true);
		assert.equal(bool('isBehind(me, Player)', host), false);
		assert.equal(bool('isFacing(me, Player)', world({ facing: () => FACING_COS })), false);
		assert.equal(bool('isFacing(me, Player)', world({ facing: () => FACING_COS + 0.001 })), true);
		assert.equal(bool('isFacing(me, Player)', world({ facing: () => 0 })), false);
		assert.equal(bool('isBehind(me, Player)', world({ facing: () => 0 })), false);
		assert.equal(bool('isBehind(me, Player)', world({ facing: () => -1 })), true);
		const onlyBool = world({ facing: undefined, isFacing: () => true });
		delete (onlyBool as { facing?:unknown }).facing;
		assert.ok(val('facing(me, Player)', onlyBool).error);
		assert.equal(bool('isFacing(me, Player)', onlyBool), true);
	});

	it('isReachable / reachable', () => {
		const island = posed('Island', { x: 99, z: 0, tags: ['place'] });
		const near = posed('NearTree', { x: 2, z: 0, tags: ['tree'] });
		const far = posed('FarTree', { x: 20, z: 0, tags: ['tree'] });
		const base = world();
		const host = world({
			walkDistance: (a, b) => {
				if (a.id === 'Island' || b.id === 'Island') {
					return undefined;
				}
				return xz(a, b);
			},
			bindings: {
				...base.bindings,
				Island: { kind: 'entity', value: island },
				NearTree: { kind: 'entity', value: near },
				FarTree: { kind: 'entity', value: far },
				landmarks: {
					kind: 'list',
					value: [
						{ kind: 'entity', value: far },
						{ kind: 'entity', value: island },
						{ kind: 'entity', value: near },
					],
				},
			},
		});
		assert.equal(bool('isReachable(me, A)', host), true);
		assert.equal(bool('isReachable(me, Island)', host), false);
		assert.equal(bool('isReachable(me, me)', host), true);
		assert.equal(bool('isReachable(A)', host), bool('isReachable(A, me)', host));
		assert.equal(bool('isReachable(items.find("nope"), me)', host), false);
		assert.equal(bool('isReachable("Angler")', host), false);
		assert.ok(val('pathTo(me, A)', host).error);
		assert.ok(val('pathLength(me, A)', host).error);
		const reached = val('landmarks.filter("tree").reachable()', host);
		assert.equal(reached.value.kind, 'list');
		if (reached.value.kind === 'list') {
			const ids = reached.value.value.filter((x) => x.kind === 'entity').map((x) => x.value.id);
			assert.deepEqual(ids, ['NearTree', 'FarTree']);
		}
		assert.deepEqual(
			val('landmarks.filter("tree").reachable()', host).value,
			val('reachable(landmarks.filter("tree"))', host).value,
		);
		assert.equal(bool('some(landmarks.filter("tree").reachable())', host), true);
		const none = val('reachable([Island])', host);
		assert.equal(none.value.kind, 'list');
		if (none.value.kind === 'list') {
			assert.equal(none.value.value.length, 0);
		}
		assert.equal(bool('some(reachable([Island]))', host), false);
		const fromA = val('landmarks.filter("tree").reachable(A)', host);
		assert.equal(fromA.value.kind, 'list');
		if (fromA.value.kind === 'list') {
			const ids = fromA.value.value.filter((x) => x.kind === 'entity').map((x) => x.value.id);
			assert.equal(ids[0], 'NearTree');
		}
	});

	it('isReachable / reachable unbound without walkDistance', () => {
		const r = val('isReachable(me, A)');
		assert.ok(r.error);
		const n = val('others.reachable()');
		assert.ok(n.error);
	});

	it('reachable silent LIST_CAP keeps nearest', () => {
		const rows:ExprEntity[] = [];
		for (let i = 0; i < 40; i++) {
			rows.push(posed(`N${i}`, { x: 40 - i, z: 0, tags: ['tree'] }));
		}
		const host = world({
			walkDistance: xz,
			bindings: {
				landmarks: {
					kind: 'list',
					value: rows.map((e) => ({ kind: 'entity' as const, value: e })),
				},
			},
		});
		const got = val('landmarks.reachable()', host);
		assert.equal(got.error, undefined, got.error?.message);
		assert.equal(got.value.kind, 'list');
		if (got.value.kind === 'list') {
			assert.equal(got.value.value.length, 32);
			const ids = got.value.value.filter((x) => x.kind === 'entity').map((x) => x.value.id);
			assert.equal(ids[0], 'N39');
			assert.equal(ids[31], 'N8');
			assert.ok(!ids.includes('N0'));
		}
	});

	it('hasSightline vs isFacing', () => {
		assert.equal(bool('hasSightline(me, Player)'), true);
		assert.equal(bool('hasSightline(Player, me)'), true);
		assert.equal(bool('isFacing(me, Player)'), true);
	});

	it('inventory needle same as is', () => {
		assert.equal(bool('isCarrying("key")'), true);
		assert.equal(bool('isCarrying("Lantern")'), true);
		assert.equal(bool('items.find("Lantern") is "key"'), true);
		assert.ok(val('isCarrying(Player, "key")').error);
	});

	it('hp / maxHP / isHurt', () => {
		assert.equal(num('me.hp'), 3);
		assert.equal(num('me.maxHP'), 5);
		assert.equal(bool('isHurt(me)'), true);
		const id = val('me.id');
		assert.equal(id.value.kind, 'string');
		assert.equal(id.value.kind === 'string' ? id.value.value : '', 'Guard');
	});

	it('host events filter theft', () => {
		assert.equal(bool('some(events.filter("theft"))'), true);
		assert.equal(bool('some(events.filter("theft").nearby(16))'), true);
	});

	it('safe dot on absent; Player.isNear needs a call', () => {
		assert.equal(val('items.find("nope").inventory').value.kind, 'absent');
		assert.ok(val('Player.isNear').error);
	});

	it('unary relation f(x) ≡ f(x, me)', () => {
		assert.equal(bool('isNear(A)'), bool('isNear(A, me)'));
		assert.equal(bool('isReachable(A)', world({ walkDistance: xz })), bool('isReachable(A, me)', world({ walkDistance: xz })));
	});

	it('approaching / departing list filters', () => {
		const cache = new SampleCache();
		const me = posed('Guard', { x: 0, z: 0, tags: ['agent'] });
		const A = posed('A', { x: 10, z: 0, tags: ['agent'] });
		const theft = posed('Theft', { x: 10, z: 0, tags: ['theft'] });
		const host = world({
			cache,
			me,
			others: [A],
			bindings: {
				A: { kind: 'entity', value: A },
				events: { kind: 'list', value: [{ kind: 'entity', value: theft }] },
			},
		});
		bool('isApproaching(A, me)', host);
		num('distance(me, events.find("theft"))', host);
		cache.commit();
		A.x = 6;
		theft.x = 6;
		assert.equal(bool('isApproaching(A, me)', host), true);
		assert.equal(bool('isDeparting(A, me)', host), false);
		const closing = val('others.approaching()', host);
		assert.equal(closing.value.kind, 'list');
		if (closing.value.kind === 'list') {
			assert.equal(closing.value.value.length, 1);
		}
		assert.deepEqual(val('others.approaching()', host).value, val('approaching(others)', host).value);
		const chain = val('events.filter("theft").nearby(16).approaching()', host);
		assert.equal(chain.value.kind, 'list');
		if (chain.value.kind === 'list') {
			assert.equal(chain.value.value.length, 1);
		}
		cache.commit();
		A.x = 6;
		assert.equal(bool('isApproaching(A, me)', host), false);
		A.x = 11;
		assert.equal(bool('isDeparting(A, me)', host), true);
	});

	it('clamp / softClamp; list as evaluate result', () => {
		assert.equal(num('clamp(4)'), 1);
		assert.equal(num('clamp(-1)'), 0);
		assert.ok(num('softClamp(1)') > 0 && num('softClamp(1)') < 1);
		assert.equal(val('others').value.kind, 'list');
	});
});

describe('watchScore', () => {
	it('absent 0; bool trueScore; number clamp; rawOverOne queues 1', () => {
		assert.equal(watchScore({ kind: 'absent' }).score, 0);
		assert.equal(watchScore({ kind: 'bool', value: true }).score, 0.51);
		assert.equal(watchScore({ kind: 'bool', value: true }, 0.7).score, 0.7);
		assert.equal(watchScore({ kind: 'number', value: 0.2 }).score, 0.2);
		const over = watchScore({ kind: 'number', value: 4 });
		assert.equal(over.score, 1);
		assert.equal(over.scold, 'rawOverOne');
		assert.equal(watchScore({ kind: 'list', value: [] }).scold, 'typeError');
	});
});

describe('stringify', () => {
	it('defaults: bool, number, name, list; absent empty', () => {
		const cat = buildCatalog(world());
		assert.equal(stringifyVal({ kind: 'absent' }, cat), '');
		assert.equal(stringifyVal({ kind: 'bool', value: true }, cat), 'true');
		assert.equal(stringifyVal({ kind: 'entity', value: dummyEntity('Lantern') }, cat), 'Lantern');
	});

	it('does not guess kind from tags; host stringifierKind picks the key', () => {
		const marked = dummyEntity('Latch', { tags: ['portal'] });
		const stringifiers:Stringifiers = {
			item: (v) => (v.kind === 'entity' ? `item:${v.value.name ?? v.value.id}` : ''),
			entity: (v) => (v.kind === 'entity' ? `ent:${v.value.id}` : ''),
		};
		const guessed = buildCatalog({ ...world(), stringifiers });
		assert.equal(stringifyVal({ kind: 'entity', value: marked }, guessed), 'ent:Latch');
		const hosted = buildCatalog({
			...world(),
			stringifiers,
			stringifierKind: (e) => (e.tags.includes('portal') ? 'item' : 'entity'),
		});
		assert.equal(stringifyVal({ kind: 'entity', value: marked }, hosted), 'item:Latch');
	});
});
