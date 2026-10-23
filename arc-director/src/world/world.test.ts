import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ArcDirector } from '../director/director.js';
import { dummyEntity } from '../expr/natives.js';
import { SampleCache } from '../expr/types.js';
import { buildCatalog } from '../expr/natives.js';
import { evaluate } from '../expr/eval.js';
import type { ArcResult } from '../arc/types.js';
import type { MindEvent } from '../mind/types.js';
import { geometryKernels } from './kernels.js';
import { Mover, type Crowd } from './mover.js';
import { awayGoal, findRoute, memoWorld, pointGoal, reachablePoints, type Blocked, type Route, type RouteWorld } from './route.js';
import type { Deal } from './deal.js';
import type { HostWorld, Transfer, Vec } from './types.js';
import { distance, groundAxes } from './vec.js';

type Ctx = { id:string };

function flush():Promise<void> {
	return new Promise((resolve) => {
		setImmediate(resolve);
	});
}

/**
 * A 2D grid, 17 cells deep, with walls and one door. Characters move toward where they are steered at `speed` cells a second.
 * `carry` is who holds which item; an item on the ground is at its own spot.
 */
class Grid {
	public readonly point = new Map<string, Vec>();
	public readonly carry = new Map<string, string>();
	public readonly steering = new Map<string, Vec | null>();
	public doorLocked = false;
	public canOffer:(character:string, other:string)=>boolean = () => true;
	public reach:(from:string, to:string)=>number = () => 1.2;
	/** The game's own rules, checked before the grid's. */
	public refuse:(move:Transfer<string>, deal:Deal<string>)=>string | undefined = () => undefined;
	public speed = 4;

	constructor(public readonly walls:Set<string> = new Set(), public readonly door?:string) {}

	public place(id:string, point:Vec):this {
		this.point.set(id, point);
		return this;
	}

	public step(dt:number):void {
		for (const [id, to] of this.steering) {
			const point = this.point.get(id);
			if (!to || !point) {
				continue;
			}
			const gap = distance(point, to);
			const move = Math.min(gap, this.speed * dt);
			this.point.set(id, gap > 1e-9 ? point.map((v, i) => v + ((to[i] - v) / gap) * move) : to);
		}
	}

	/** Entities are ids: anything placed or carried. */
	public readonly world:HostWorld<string> = {
		find: (id) => (this.point.has(id) || this.carry.has(id) ? id : undefined),
		getPose: (id) => {
			const holder = this.carry.get(id);
			const point = this.point.get(holder ?? id);
			return point ? { point, facing: [0, 1], right: [1, 0] } : undefined;
		},
		getNeighbors: (point) => {
			const cell = point.map(Math.round);
			return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => [cell[0] + dx, cell[1] + dz]);
		},
		canPass: (what, _from, to) => {
			const key = to.join(',');
			if (what === 'light' || what === 'sound') {
				return {};
			}
			if (this.walls.has(key) || Math.abs(to[1]) > 8) {
				return undefined;
			}
			return key === this.door && this.doorLocked ? { blocked: 'Door is locked' } : {};
		},
		steerToward: (character, to) => {
			this.steering.set(character, to);
			const point = this.point.get(character);
			return !!(to && point && distance(point, to) < 0.05);
		},
		getReach: (character, target) => this.reach(character, target),
		validateTransfer: (move, deal) => {
			const { verb, thing, from } = move;
			const refused = this.refuse(move, deal);
			if (refused) {
				return refused;
			}
			if (verb !== 'pick_up' && thing !== 'gold' && this.carry.get(thing) !== from) {
				return `${from} has no ${thing}`;
			}
			// Held, it is taken from its holder.
			const holder = this.carry.get(thing);
			return verb === 'pick_up' && holder !== undefined && holder !== from ? `${thing} is in ${holder}` : undefined;
		},
		transfer: ({ thing, from, to }) => {
			const before = { holder: this.carry.get(thing), point: this.point.get(thing) };
			if (thing !== 'gold') {
				if (to === undefined) {
					this.carry.delete(thing);
					this.point.set(thing, this.point.get(from)!);
				}
				else {
					this.carry.set(thing, to);
				}
			}
			return () => {
				if (before.holder === undefined) {
					this.carry.delete(thing);
				}
				else {
					this.carry.set(thing, before.holder);
				}
				if (before.point) {
					this.point.set(thing, before.point);
				}
			};
		},
		canOffer: (character, other) => this.canOffer(character, other),
	};
}

/**
 * Four waypoints on a 10×10 square. The west road (via [0, 10]) costs three times its length, so the cheap
 * way round is east. Off the network, the waypoints within 6 are in sight.
 */
const WAYPOINTS:Vec[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
const ROADS:[number, number, number][] = [[0, 1, 10], [1, 2, 10], [0, 3, 30], [3, 2, 10]];
const waypointAt = (point:Vec):number => WAYPOINTS.findIndex((p) => distance(p, point) < 1e-9);
const NETWORK:RouteWorld<string> = {
	getNeighbors: (point) => {
		const i = waypointAt(point);
		if (i < 0) {
			return WAYPOINTS.filter((p) => distance(p, point) <= 6);
		}
		return ROADS.filter(([a, b]) => a === i || b === i).map(([a, b]) => WAYPOINTS[a === i ? b : a]);
	},
	canPass: (_what, from, to) => {
		const ends = [waypointAt(from), waypointAt(to)].sort().join();
		const road = ROADS.find(([a, b]) => [a, b].sort().join() === ends);
		return road ? { cost: road[2] } : {};
	},
};

/** Every step open, onto `getNeighbors`. */
function openWays(getNeighbors:(point:Vec)=>Vec[]):RouteWorld<string> {
	return { getNeighbors, canPass: () => ({}) };
}

/** Collect what `director` tells every mind. */
function spyTellAll(director:ArcDirector<Ctx>, told:MindEvent[]):void {
	const pushEvent = director.pushEvent.bind(director);
	director.pushEvent = (event) => {
		told.push(event);
		pushEvent(event);
	};
}

const PEOPLE = ['Smith', 'Mira', 'Bo'];

async function run(
	grid:Grid,
	reply:string,
	opts:{ kit:string[]; seconds?:number; units?:string[]; nearRadius?:number; before?:(director:ArcDirector<Ctx>)=>void },
):Promise<{ director:ArcDirector<Ctx> }> {
	let sent = false;
	const director = new ArcDirector<Ctx>()
		.withPriorityQueue({ processInterval: 0, watchInterval: 0, heartbeatStart: 1000, heartbeatMin: 1000 })
		.addModel('fake', { maxParallel: 1 })
		.addFakeInference(() => {
			const content = sent ? 'wait(seconds=100)' : reply;
			sent = true;
			return { content, toolCalls: [] };
		})
		.withArcFormat('text')
		.addStockVerbs()
		.addStockCollectiveVerbs()
		.withWorld(grid.world)
		.withDefaultKit({ verbs: opts.kit })
		.withKernels((ctx) => ({ me: dummyEntity(ctx.id, { tags: ['character'] }), others: [], items: [], nearRadius: opts.nearRadius }))
		.withContext((id) => (grid.point.has(id) ? { id } : undefined));
	if (opts.units) {
		director.addCollective({ id: 'Hive', kit: { verbs: opts.kit }, identity: { role: 'Leads.' }, characters: opts.units.map((id) => ({ id })) });
	}
	else {
		director.addCharacter({ id: 'Ann', mind: {}, kit: { verbs: opts.kit }, identity: { role: 'Fetches.' } });
	}
	// The others on the grid are in the cast, without minds: only a character takes a gift or a trade.
	for (const id of PEOPLE.filter((p) => grid.point.has(p))) {
		director.addCharacter({ id });
	}
	opts.before?.(director);
	await director.start();
	director.mindQueue()!.enqueueMajor(opts.units ? 'Hive' : 'Ann');
	const dt = 0.1;
	for (let t = 0; t < (opts.seconds ?? 20) / dt; t++) {
		grid.step(dt);
		director.tick(dt, t * dt);
		await flush();
	}
	return { director };
}

describe('findRoute', () => {
	const lineNeighbors = ([x]:Vec):Vec[] => [[x + 1], [x - 1]];
	const line = openWays(lineNeighbors);
	const openRoute = (found:Route | Blocked | undefined):Route => {
		assert.ok(found && 'points' in found, 'an open route');
		return found;
	};

	it('finds the cheapest route on a 1D line and stops in reach', () => {
		const route = openRoute(findRoute(line, 'Ann', [0], pointGoal([5], 1)));
		assert.deepEqual(route.points, [[1], [2], [3], [4]]);
		assert.equal(route.cost, 4);
	});

	it('works in 3D and goes around a pricey step', () => {
		const world:RouteWorld<string> = {
			getNeighbors: (point) => [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1]].map((d) => point.map((v, i) => v + d[i])),
			canPass: (_what, _from, to) => (to.join() === '1,0,0' ? { cost: 50 } : {}),
		};
		const route = openRoute(findRoute(world, 'Ann', [0, 0, 0], pointGoal([2, 0, 0])));
		assert.equal(route.cost, 4);
		assert.equal(route.points.some((p) => p.join() === '1,0,0'), false);
	});

	it('names the blocker when a blocked step is the only way, and gives up past the cap', () => {
		const gated:RouteWorld<string> = { getNeighbors: lineNeighbors, canPass: (_what, _from, to) => (to[0] === 2 ? { blocked: 'Gate is shut' } : {}) };
		assert.deepEqual(findRoute(gated, 'Ann', [0], pointGoal([4])), { blockers: [{ reason: 'Gate is shut', cost: 4 }] });
		assert.equal(findRoute(line, 'Ann', [0], pointGoal([1e6]), 50), undefined);
	});

	it('names every locked way in, cheapest first, and only those that lead there', () => {
		const locks = new Map([['0,1', 'EastGate is locked'], ['0,3', 'WestGate is locked — you carry IronKey'], ['0,4', 'Closet is locked']]);
		const shed:Vec = [-10, -10];
		const gated:RouteWorld<string> = {
			getNeighbors: (point) => [...NETWORK.getNeighbors(point), ...waypointAt(point) === 0 ? [shed] : []],
			canPass: (what, from, to) => {
				const i = waypointAt(from);
				const reason = i >= 0 ? locks.get([i, to === shed ? 4 : waypointAt(to)].sort().join()) : undefined;
				return { ...NETWORK.canPass(what, from, to), ...reason ? { blocked: reason } : {} };
			},
		};
		const found = findRoute(gated, 'Ann', [1, 1], pointGoal([11, 9]));
		assert.ok(found && 'blockers' in found);
		assert.deepEqual(found.blockers.map((b) => b.reason), ['EastGate is locked', 'WestGate is locked — you carry IronKey']);
	});

	it('crosses a sparse weighted network between two points off it', () => {
		assert.deepEqual(openRoute(findRoute(NETWORK, 'Ann', [1, 1], pointGoal([11, 9]))).points, [[0, 0], [10, 0], [10, 10], [11, 9]]);
	});

	it('gets out of range the long way round rather than running past the threat', () => {
		// Two ways out of 5 from a threat at [1, 0]: past it (about 6.1 long), or wide of it (8 long).
		const roads:[Vec, Vec][] = [[[0, 0], [2, 0.5]], [[2, 0.5], [6, 0]], [[0, 0], [0, -3]], [[0, -3], [5, -3]]];
		const world = openWays((point) => roads.flatMap(([a, b]) => (distance(a, point) < 1e-9 ? [b] : distance(b, point) < 1e-9 ? [a] : [])));
		assert.deepEqual(openRoute(findRoute(world, 'Ann', [0, 0], awayGoal([1, 0], 5))).points, [[0, -3], [5, -3]]);
		assert.equal(findRoute(world, 'Ann', [0, 0], awayGoal([1, 0], 50)), undefined, 'cornered: no way that far');
	});

	it('does not treat range through a wall as arrived; it goes around', () => {
		const wall = new Set(['1,0']);
		const grid:RouteWorld<string> = {
			getNeighbors: (point) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => [Math.round(point[0]) + dx, Math.round(point[1]) + dz]),
			canPass: (_what, _from, to) => (wall.has(to.join(',')) || Math.abs(to[1]) > 4 ? undefined : {}),
		};
		const route = openRoute(findRoute(grid, 'Ann', [0, 0], pointGoal([2, 0], 2.5)));
		assert.equal(route.points.some((p) => p[0] === 1 && p[1] === 0), false);
		assert.ok(route.points.some((p) => Math.abs(p[1]) > 0), 'went around');
	});

	it('ends only through the steps into the goal: a ledge dropped off is no way up, a wall no way in', () => {
		// Cells 0 to 3 on a line. Cell 2 is a ledge: one drops off it to either side, but never climbs on.
		const ledge = 2;
		const grid:RouteWorld<string> = {
			getNeighbors: (point) => [Math.round(point[0]) - 1, Math.round(point[0]) + 1].filter((next) => next >= 0 && next <= 3).map((next) => [next]),
			canPass: (_what, _from, to) => (Math.round(to[0]) === ledge ? undefined : {}),
		};
		assert.equal(findRoute(grid, 'Ann', [0], pointGoal([2.2])), undefined, 'climbed the ledge on the last step');
		assert.deepEqual(openRoute(findRoute(grid, 'Ann', [2], pointGoal([0.2]))).points, [[1], [0.2]]);
	});

	it('lists reachable points without crossing a blocked step', () => {
		const gated:RouteWorld<string> = {
			getNeighbors: lineNeighbors,
			canPass: (_what, _from, to) => (to[0] < 0 ? undefined : to[0] === 3 ? { blocked: 'x' } : {}),
		};
		assert.deepEqual(reachablePoints(gated, 'Ann', [0], 99).map((p) => p.point[0]), [0, 1, 2]);
	});

	it('asks a shared world once per step, however many searches walk it', () => {
		let asked = 0;
		const counted = memoWorld<string>({ getNeighbors: lineNeighbors, canPass: () => {
			asked += 1;
			return {};
		} });
		findRoute(counted, 'Ann', [0], pointGoal([5]));
		const once = asked;
		findRoute(counted, 'Ann', [0], pointGoal([5]));
		assert.equal(asked, once);
	});
});

describe('Mover', () => {
	it('drives a character that starts beside a waypoint across a network, with a motor that stops short', async () => {
		let me:Vec = [0.05, 0];
		let to:Vec | null = null;
		let now = 0;
		let wentEast = false;
		const world:HostWorld<string> = {
			find: (id) => id,
			getPose: (id) => ({ point: id === 'Ann' ? me : [11, 9] }),
			...NETWORK,
			steerToward: (character, point) => {
				to = point;
				return !!point && distance(me, point) <= 0.35;
			},
		};
		const mover = new Mover(world, () => now);
		let result:ArcResult | undefined;
		void mover.go('Ann', { target: 'Chest' }, 'go_to').then((r) => {
			result = r;
		});
		for (; now < 20 && !result; now += 0.1) {
			mover.tick();
			const gap = to ? distance(me, to) : 0;
			if (to && gap > 0.35) {
				const t = to;
				me = me.map((v, i) => v + ((t[i] - v) / gap) * Math.min(gap - 0.35, 0.4));
			}
			wentEast ||= me[0] > 9 && me[1] < 1;
			await flush();
		}
		assert.deepEqual(result, { ok: true, verb: 'go_to' });
		assert.ok(wentEast, 'went the cheap way, east');
	});

	it('goes around a wall instead of steering through it', async () => {
		let me:Vec = [0, 5];
		let to:Vec | null = null;
		let now = 0;
		const walls = new Set(['1,-2', '1,-1', '1,0', '1,1', '1,2']);
		const world:HostWorld<string> = {
			find: (id) => id,
			getPose: (id) => ({ point: id === 'Ann' ? me : [2, 0] }),
			getReach: () => 2.5,
			getNeighbors: (point) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => [Math.round(point[0]) + dx, Math.round(point[1]) + dz]),
			canPass: (_what, _from, to) => (walls.has(to.join(',')) || Math.abs(to[0]) > 4 || Math.abs(to[1]) > 8 ? undefined : {}),
			steerToward: (_character, point) => {
				to = point;
				return !!point && distance(me, point) <= 0.05;
			},
		};
		const mover = new Mover(world, () => now);
		let result:ArcResult | undefined;
		void mover.go('Ann', { target: 'Bo' }, 'go_to').then((r) => {
			result = r;
		});
		for (; now < 20 && !result; now += 0.1) {
			mover.tick();
			if (to && distance(me, to) > 0.05) {
				const t = to;
				const gap = distance(me, t);
				me = me.map((v, i) => v + ((t[i] - v) / gap) * Math.min(gap, 0.5));
			}
			assert.equal(walls.has(me.map(Math.round).join(',')), false, `walked through the wall to ${me}`);
			await flush();
		}
		assert.equal(result?.ok, true);
		assert.equal(walls.has(me.map(Math.round).join(',')), false);
	});

	/** Walkers on an open plane, each sent to `target` in turn; ticks until all are done. Who finished in what order, where everyone was each tick. */
	async function crowdAt(target:Vec, walkers:Record<string, Vec>, crowd:Crowd, reach:number):Promise<{ order:string[]; ticks:Map<string, Vec>[]; points:Map<string, Vec> }> {
		const points = new Map(Object.entries(walkers));
		const steering = new Map<string, Vec | null>();
		let now = 0;
		const world:HostWorld<string> = {
			find: (id) => id,
			getPose: (id) => ({ point: points.get(id) ?? target, facing: [0, 1] }),
			getReach: () => reach,
			getNeighbors: (point) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => [Math.round(point[0]) + dx, Math.round(point[1]) + dz]),
			canPass: () => ({}),
			steerToward: (id, point) => {
				steering.set(id, point);
				return !!point && distance(points.get(id)!, point) <= 0.05;
			},
		};
		const mover = new Mover(world, () => now, () => crowd);
		const order:string[] = [];
		for (const id of points.keys()) {
			void mover.go(id, { target: 'Target' }, 'go_to').then((r) => {
				assert.equal(r.ok, true, `${id}: ${r.reason}`);
				order.push(id);
			});
		}
		const ticks:Map<string, Vec>[] = [];
		for (; now < 60 && order.length < points.size; now += 0.1) {
			mover.tick();
			for (const [id, to] of steering) {
				const me = points.get(id)!;
				const gap = to ? distance(me, to) : 0;
				if (to && gap > 0) {
					points.set(id, me.map((v, i) => v + ((to[i] - v) / gap) * Math.min(gap, 0.3)));
				}
			}
			ticks.push(new Map(points));
			await flush();
		}
		return { order, ticks, points };
	}

	it('lines up behind the first, out the way the target faces, and lets them in one by one', async () => {
		const { order, ticks } = await crowdAt([0, 0], { Ann: [14, 0], Bo: [-6, 1], Cy: [0, 9] }, 'line', 1.2);
		assert.deepEqual(order, ['Ann', 'Bo', 'Cy']);
		// Before Ann was served, Bo and Cy stood at the first and second place in line.
		const waiting = ticks.find((at) => distance(at.get('Bo')!, [0, 2.2]) < 0.1 && distance(at.get('Cy')!, [0, 3.2]) < 0.1);
		assert.ok(waiting, 'Bo and Cy queued behind Ann');
		assert.ok(distance(waiting.get('Ann')!, [0, 0]) > 1.2, 'while Ann was still on the way');
	});

	it('spreads round the target in a ring, each in its own place', async () => {
		const { points } = await crowdAt([0, 0], { Ann: [6, 0], Bo: [6, 0], Cy: [6, 0], Dee: [6, 0] }, 'ring', 2);
		const ids = [...points.keys()];
		for (const id of ids) {
			assert.ok(distance(points.get(id)!, [0, 0]) <= 2, `${id} in reach`);
		}
		for (const [i, a] of ids.entries()) {
			for (const b of ids.slice(i + 1)) {
				assert.ok(distance(points.get(a)!, points.get(b)!) >= 0.9, `${a} and ${b} apart`);
			}
		}
	});

	it('goes straight in with none, so walkers from one spot end on one spot', async () => {
		const { points } = await crowdAt([0, 0], { Ann: [6, 0], Bo: [6, 0] }, 'none', 2);
		assert.ok(distance(points.get('Ann')!, points.get('Bo')!) < 0.1);
	});
});

describe('groundAxes', () => {
	it('spans the plane across up in 3D', () => {
		const [a, b] = groundAxes(3, [0, 0, 1]);
		assert.ok(Math.abs(a[2]) < 1e-9 && Math.abs(b[2]) < 1e-9);
		assert.ok(Math.abs(a[0] * b[0] + a[1] * b[1]) < 1e-9);
	});
});

describe('geometryKernels', () => {
	it('measures distance, facing, side, and path length from poses, and moves me for what if', () => {
		const grid = new Grid(new Set(['1,0', '1,1', '1,-1'])).place('Ann', [0, 0]).place('Bo', [2, 0]);
		const geo = geometryKernels(grid.world, 'Ann');
		const ann = dummyEntity('Ann');
		const bo = dummyEntity('Bo');
		assert.equal(geo.distance!(ann, bo), 2);
		assert.equal(geo.facing!(ann, bo), 0);
		assert.equal(geo.side!(ann, bo), 1);
		assert.equal(geo.pathDistance!(ann, bo), 5);
		const moved = geometryKernels(grid.world, 'Ann', new Map([['Ann', { point: [2, 3] }]]));
		assert.equal(moved.distance!(ann, bo), 3);
		const catalog = buildCatalog({ me: ann, others: [bo], items: [], cache: new SampleCache(), nearRadius: 2.5, ...geo });
		const value = (expr:string):unknown => (evaluate(expr, catalog).value as { value?:unknown }).value;
		assert.equal(value('count(reachable(others))'), 1);
		assert.equal(value('count(others.nearby())'), 1);
		assert.equal(value('manhattan(me, others.find("Bo"))'), 2);
	});
});

describe('stock world verbs', () => {
	it('fetches: goes to the item, picks it up, takes it to someone, and gives it', async () => {
		const grid = new Grid().place('Ann', [0, 0]).place('Lantern', [6, 0]).place('Smith', [0, 6]);
		const told:MindEvent[] = [];
		const { director } = await run(grid, 'pick_up(Lantern) ; give(item=Lantern, to=Smith)', { kit: ['pick_up', 'give', 'wait'], before: (d) => spyTellAll(d, told) });
		assert.equal(grid.carry.get('Lantern'), 'Smith');
		assert.deepEqual(told, [{ kind: 'Ledger', text: '{0} gave 1 Lantern to {1}.', who: ['Ann', 'Smith'], tags: ['ledger', 'give', 'Lantern'], remember: true }]);
		assert.ok(distance(grid.point.get('Ann')!, [0, 6]) <= 1.3);
		assert.equal(director.character('Ann')!.lastResult?.reason, 'gave Lantern to Smith');
		director.dispose();
	});

	it('puts an item in what it is dropped to, after going there', async () => {
		const grid = new Grid().place('Ann', [0, 0]).place('Lantern', [0, 0]).place('Chest', [4, 0]);
		grid.carry.set('Lantern', 'Ann');
		const { director } = await run(grid, 'drop(item=Lantern, to=Chest)', { kit: ['drop', 'wait'] });
		assert.equal(grid.carry.get('Lantern'), 'Chest');
		assert.ok(distance(grid.point.get('Ann')!, [4, 0]) <= 1.3);
		assert.equal(director.character('Ann')!.lastResult?.reason, 'put Lantern in Chest');
		director.dispose();
	});

	it('takes an item from what it is picked up from', async () => {
		const grid = new Grid().place('Ann', [0, 0]).place('Lantern', [4, 0]).place('Chest', [4, 0]);
		grid.carry.set('Lantern', 'Chest');
		const { director } = await run(grid, 'pick_up(item=Lantern, from=Chest)', { kit: ['pick_up', 'wait'] });
		assert.equal(grid.carry.get('Lantern'), 'Ann');
		assert.equal(director.character('Ann')!.lastResult?.reason, 'took Lantern from Chest');
		director.dispose();
	});

	it('picks up from where it sees the item, when not told', async () => {
		const grid = new Grid().place('Ann', [0, 0]).place('Lantern', [4, 0]).place('Chest', [4, 0]);
		grid.carry.set('Lantern', 'Chest');
		const sight = (d:ArcDirector<Ctx>):void => {
			d.withSight({
				look: () => ({
					self: { id: 'Ann', point: grid.point.get('Ann')! },
					objects: [{ id: 'Chest', point: [4, 0], tags: [] }, { id: 'Lantern', point: [4, 0], tags: ['item'], attachedTo: 'Chest', attachMode: 'in' }],
				}),
			});
		};
		const { director } = await run(grid, 'pick_up(Lantern)', { kit: ['pick_up', 'wait'], before: sight });
		assert.equal(grid.carry.get('Lantern'), 'Ann');
		director.dispose();
	});

	it('picks up only what it sees, unless the world lets it fetch anything', async () => {
		const blind = (d:ArcDirector<Ctx>):void => {
			d.withSight({ look: () => ({ self: { id: 'Ann', point: [0, 0] }, objects: [] }) });
		};
		const unseen = new Grid().place('Ann', [0, 0]).place('Lantern', [4, 0]);
		const refused = await run(unseen, 'pick_up(Lantern)', { kit: ['pick_up', 'wait'], before: blind });
		assert.equal(refused.director.character('Ann')!.lastResult?.reason, 'you see no Lantern; go where it is first');
		assert.equal(unseen.carry.get('Lantern'), undefined);
		refused.director.dispose();
		const anywhere = new Grid().place('Ann', [0, 0]).place('Lantern', [4, 0]);
		anywhere.world.canPickUp = () => true;
		const fetched = await run(anywhere, 'pick_up(Lantern)', { kit: ['pick_up', 'wait'], before: blind });
		assert.equal(anywhere.carry.get('Lantern'), 'Ann');
		fetched.director.dispose();
	});

	it('neither takes from nor drops to a character', async () => {
		const grid = new Grid().place('Ann', [0, 0]).place('Lantern', [0, 0]).place('Smith', [2, 0]);
		grid.carry.set('Lantern', 'Ann');
		const dropped = await run(grid, 'drop(item=Lantern, to=Smith)', { kit: ['drop', 'wait'] });
		assert.equal(dropped.director.character('Ann')!.lastResult?.reason, 'to hand Lantern to Smith, use give');
		dropped.director.dispose();
		grid.carry.set('Lantern', 'Smith');
		const taken = await run(grid, 'pick_up(item=Lantern, from=Smith)', { kit: ['pick_up', 'wait'] });
		assert.equal(taken.director.character('Ann')!.lastResult?.reason, 'Smith carries it; only they can give it to you');
		assert.equal(grid.carry.get('Lantern'), 'Smith');
		taken.director.dispose();
	});

	it('gives only to a character, never to a thing', async () => {
		const grid = new Grid().place('Ann', [0, 0]).place('Lantern', [0, 0]).place('Mushroom', [2, 0]);
		grid.carry.set('Lantern', 'Ann');
		const { director } = await run(grid, 'give(item=Lantern, to=Mushroom)', { kit: ['give', 'wait'] });
		assert.equal(director.character('Ann')!.lastResult?.reason, 'Mushroom is not a character');
		assert.equal(grid.carry.get('Lantern'), 'Ann');
		director.dispose();
	});

	it('remembers handing over the currency as paying', async () => {
		const grid = new Grid().place('Ann', [0, 0]).place('Smith', [0, 2]);
		const told:MindEvent[] = [];
		const { director } = await run(grid, 'give(item=gold, to=Smith, quantity=5)', {
			kit: ['give', 'wait'],
			before: (d) => {
				d.withCurrency('gold');
				spyTellAll(d, told);
			},
		});
		assert.deepEqual(told.map((e) => [e.text, e.tags]), [['{0} paid 5 gold to {1}.', ['ledger', 'pay', 'gold']]]);
		director.dispose();
	});

	it('stops at a locked door and says so', async () => {
		const walls = new Set(Array.from({ length: 17 }, (element, i) => `3,${i - 8}`).filter((cell) => cell !== '3,0'));
		const grid = new Grid(walls, '3,0').place('Ann', [0, 0]).place('Well', [6, 0]);
		grid.doorLocked = true;
		const { director } = await run(grid, 'go_to(Well)', { kit: ['go_to', 'wait'], seconds: 2 });
		assert.equal(director.character('Ann')!.lastResult?.reason, 'no way to Well, blocked on the way: Door is locked');
		assert.deepEqual(grid.point.get('Ann'), [0, 0]);
		director.dispose();
	});

	describe('say walks up to whoever it is said to', () => {
		const talkOn = (grid:Grid, spoken:string[]) => (d:ArcDirector<Ctx>):void => {
			const gap = (a:string, b:string):number => distance(grid.point.get(a)!, grid.point.get(b)!);
			d.withTalk({ inRange: (a, b) => gap(a, b) <= 20, clearHear: (a, b) => gap(a, b) <= 3, others: () => ['Ann', 'Bo'] }, (u) => spoken.push(u.text));
		};

		it('until they make out every word, then says it', async () => {
			const grid = new Grid().place('Ann', [0, 0]).place('Bo', [10, 0]);
			const spoken:string[] = [];
			const { director } = await run(grid, 'say(text=Hello, to=Bo)', { kit: ['say', 'wait'], before: talkOn(grid, spoken) });
			assert.deepEqual(spoken, ['Hello']);
			assert.ok(distance(grid.point.get('Ann')!, [10, 0]) <= 3, 'close enough to be heard clearly');
			assert.ok(distance(grid.point.get('Ann')!, [10, 0]) > 1.3, 'and no closer: talking needs no reach');
			director.dispose();
		});

		it('and is refused only when there is no way to them', async () => {
			const walls = new Set(Array.from({ length: 41 }, (element, i) => `5,${i - 20}`));
			const grid = new Grid(walls).place('Ann', [0, 0]).place('Bo', [10, 0]);
			const spoken:string[] = [];
			const { director } = await run(grid, 'say(text=Hello, to=Bo)', { kit: ['say', 'wait'], before: talkOn(grid, spoken) });
			assert.deepEqual(spoken, []);
			assert.deepEqual(grid.point.get('Ann'), [0, 0]);
			director.dispose();
		});
	});

	it('takes a standing offer: walks over, and both sides move at once', async () => {
		const grid = new Grid().place('Ann', [0, 0]).place('Mira', [4, 0]).place('Bread', [4, 0]);
		grid.carry.set('Bread', 'Mira');
		const told:MindEvent[] = [];
		const { director } = await run(grid, 'offer(to=Mira, give={"gold":5}, get={"Bread":1})', {
			kit: ['offer', 'wait'],
			before: (d) => {
				d.offers.post({ from: 'Mira', give: { Bread: 1 }, get: { gold: 5 } });
				spyTellAll(d, told);
			},
		});
		assert.equal(grid.carry.get('Bread'), 'Ann');
		assert.deepEqual(told.map((e) => [e.text, e.who, e.tags]), [['{0} traded 5 gold to {1} for 1 Bread.', ['Ann', 'Mira'], ['ledger', 'trade', 'Bread']]]);
		assert.ok(distance(grid.point.get('Ann')!, [4, 0]) <= 1.3);
		assert.equal(director.character('Ann')!.lastResult?.reason, 'traded 5 gold for 1 Bread with Mira');
		assert.equal(director.offers.all.length, 1, 'a standing offer stays');
		director.dispose();
	});

	it('does not trade across a wall while farther than reach, even when nearby', async () => {
		const wall = new Set(Array.from({ length: 17 }, (element, i) => `1,${i - 8}`));
		const grid = new Grid(wall).place('Ann', [0, 0]).place('Mira', [2, 0]).place('Bread', [2, 0]);
		grid.carry.set('Bread', 'Mira');
		const { director } = await run(grid, 'offer(to=Mira, give={"gold":5}, get={"Bread":1})', {
			kit: ['offer', 'wait'],
			nearRadius: 8,
			before: (d) => d.offers.post({ from: 'Mira', give: { Bread: 1 }, get: { gold: 5 } }),
		});
		assert.equal(grid.carry.get('Bread'), 'Mira');
		assert.deepEqual(grid.point.get('Ann'), [0, 0]);
		assert.match(director.character('Ann')!.lastResult?.reason ?? '', /no way to Mira/);
		director.dispose();
	});

	it('walks into the shorter reach before a trade, ignoring a longer one', async () => {
		const grid = new Grid().place('Ann', [0, 0]).place('Mira', [4, 0]).place('Bread', [4, 0]);
		grid.carry.set('Bread', 'Mira');
		grid.reach = (from) => (from === 'Ann' ? 6 : 1.2);
		const { director } = await run(grid, 'offer(to=Mira, give={"gold":5}, get={"Bread":1})', {
			kit: ['offer', 'wait'],
			nearRadius: 8,
			before: (d) => d.offers.post({ from: 'Mira', give: { Bread: 1 }, get: { gold: 5 } }),
		});
		assert.equal(grid.carry.get('Bread'), 'Ann');
		assert.ok(distance(grid.point.get('Ann')!, [4, 0]) <= 1.2);
		director.dispose();
	});

	it('leaves a lowball waiting where it stands, and refuses one out of sight', async () => {
		const grid = new Grid().place('Ann', [0, 0]).place('Mira', [4, 0]).place('Bread', [4, 0]);
		grid.carry.set('Bread', 'Mira');
		const reply = 'offer(to=Mira, give={"gold":4}, get={"Bread":1})';
		const before = (d:ArcDirector<Ctx>):void => {
			d.offers.post({ from: 'Mira', give: { Bread: 1 }, get: { gold: 5 } });
		};
		const low = await run(grid, reply, { kit: ['offer', 'wait'], before });
		assert.equal(low.director.character('Ann')!.lastResult?.reason, 'offered 4 gold for 1 Bread to Mira; waiting for their answer');
		assert.deepEqual(grid.point.get('Ann'), [0, 0]);
		assert.deepEqual(low.director.offers.all.find((offer) => offer.from === 'Ann'), { from: 'Ann', to: 'Mira', give: { gold: 4 }, get: { Bread: 1 } });
		low.director.dispose();
		grid.canOffer = () => false;
		const hidden = await run(grid, reply, { kit: ['offer', 'wait'], before });
		assert.equal(hidden.director.character('Ann')!.lastResult?.reason, 'Mira is out of sight');
		hidden.director.dispose();
	});

	it('refuses terms the game rules out when they are offered, before anyone hears them', async () => {
		const grid = new Grid().place('Ann', [0, 0]).place('Mira', [4, 0]).place('Bridge', [2, 2]);
		grid.refuse = (move) => (move.thing === 'Bridge' ? 'Mira does not own Bridge' : undefined);
		const { director } = await run(grid, 'offer(to=Mira, give={"gold":10}, get={"Bridge":1})', { kit: ['offer', 'wait'] });
		assert.equal(director.character('Ann')!.lastResult?.reason, 'Mira does not own Bridge');
		assert.equal(director.offers.all.length, 0);
		director.dispose();
	});

	it('refuses an offer to anyone of what the offerer does not have', async () => {
		const grid = new Grid().place('Ann', [0, 0]);
		const { director } = await run(grid, 'offer(give={"item":3, "quantity":1}, get={"gold":2})', { kit: ['offer', 'wait'] });
		assert.equal(director.character('Ann')!.lastResult?.reason, 'Ann has no item');
		assert.equal(director.offers.all.length, 0);
		director.dispose();
	});

	it('takes back what moved when a later move in the trade is refused', async () => {
		const grid = new Grid().place('Ann', [0, 0]).place('Mira', [4, 0]).place('Apple', [0, 0]).place('Bread', [4, 0]);
		grid.carry.set('Apple', 'Ann');
		grid.carry.set('Bread', 'Mira');
		grid.refuse = (move, deal) => (!deal.dryRun && move.thing === 'Bread' ? "Ann's pack is full" : undefined);
		const { director } = await run(grid, 'offer(to=Mira, give={"Apple":1}, get={"Bread":1})', {
			kit: ['offer', 'wait'],
			before: (d) => d.offers.post({ from: 'Mira', give: { Bread: 1 }, get: { Apple: 1 } }),
		});
		assert.equal(director.character('Ann')!.lastResult?.reason, "Ann's pack is full");
		assert.equal(grid.carry.get('Apple'), 'Ann', 'the apple came back');
		assert.equal(grid.carry.get('Bread'), 'Mira');
		director.dispose();
	});

	it('wanders toward where until holds and reports what it saw', async () => {
		const grid = new Grid().place('Ann', [0, 0]);
		const { director } = await run(grid, 'wander(until=1 > 2, seconds=3)', { kit: ['wander', 'wait'], seconds: 4 });
		assert.ok(distance(grid.point.get('Ann')!, [0, 0]) > 1);
		assert.equal(director.character('Ann')!.lastResult?.verb, 'wander');
		director.dispose();
	});

	it('goes to a target but stops on the way once until holds', async () => {
		const grid = new Grid().place('Ann', [0, 0]).place('Well', [20, 0]);
		const { director } = await run(grid, 'go_to(target=Well, until=prev.secondsAgo > 1)', { kit: ['go_to', 'wait'], seconds: 6 });
		const ann = director.character('Ann')!;
		assert.deepEqual(ann.lastResult && { ok: ann.lastResult.ok, reason: ann.lastResult.reason }, { ok: true, reason: 'until' });
		const went = distance(grid.point.get('Ann')!, [0, 0]);
		assert.ok(went > 0.5 && went < 15, `walked ${went.toFixed(1)} of the 20 to the Well`);
		director.dispose();
	});

	it('follows until the next arc and keeps in reach as the target moves', async () => {
		const grid = new Grid().place('Ann', [0, 0]).place('Bo', [5, 0]);
		const { director } = await run(grid, 'follow(Bo)', { kit: ['follow', 'wait'], seconds: 4 });
		assert.ok(distance(grid.point.get('Ann')!, [5, 0]) <= 1.3);
		grid.place('Bo', [5, 6]);
		for (let t = 0; t < 40; t++) {
			grid.step(0.1);
			director.tick(0.1, 20 + t * 0.1);
			await flush();
		}
		assert.ok(distance(grid.point.get('Ann')!, [5, 6]) <= 1.3);
		director.dispose();
	});

	it('flees out of nearby, runs again when they close in, and ends once out of range a while', async () => {
		const grid = new Grid().place('Ann', [0, 0]).place('Bo', [2, 0]);
		const { director } = await run(grid, 'flee(Bo)', { kit: ['flee', 'wait'], seconds: 2, nearRadius: 4 });
		const ann = director.character('Ann')!;
		assert.ok(distance(grid.point.get('Ann')!, [2, 0]) >= 4, 'out of nearby');
		assert.equal(ann.arc?.[0].verb, 'flee', 'not safe for long enough yet');
		const at = grid.point.get('Ann')!;
		grid.place('Bo', [at[0] + 1, at[1]]);
		const tick = async (seconds:number, from:number):Promise<void> => {
			for (let t = 0; t < seconds * 10; t++) {
				grid.step(0.1);
				director.tick(0.1, from + t * 0.1);
				await flush();
			}
		};
		await tick(2, 20);
		assert.ok(distance(grid.point.get('Ann')!, grid.point.get('Bo')!) >= 4, 'ran again');
		assert.equal(ann.arc?.[0].verb, 'flee', 'the clock restarted when they closed in');
		await tick(3, 22);
		assert.deepEqual(ann.lastResult && { ok: ann.lastResult.ok, reason: ann.lastResult.reason }, { ok: true, reason: 'got away from Bo' });
		director.dispose();
	});

	it('flees as far as asked, and asks how far when the host has no nearby', async () => {
		const grid = new Grid().place('Ann', [0, 0]).place('Bo', [1, 0]);
		const { director } = await run(grid, 'flee(from=Bo, distance=7)', { kit: ['flee', 'wait'], seconds: 6 });
		assert.ok(distance(grid.point.get('Ann')!, [1, 0]) >= 7);
		director.dispose();
		const still = new Grid().place('Ann', [0, 0]).place('Bo', [1, 0]);
		const { director: asked } = await run(still, 'flee(Bo)', { kit: ['flee', 'wait'], seconds: 1 });
		assert.equal(asked.character('Ann')!.lastResult?.reason, 'say how far: flee(from, distance)');
		asked.dispose();
	});

	it('forms a line of units across the way to the foe', async () => {
		const grid = new Grid().place('A', [0, 0]).place('B', [1, 3]).place('C', [2, -3]).place('Gate', [0, 8]);
		const { director } = await run(grid, 'issue(who=units, arc=hold_line(at=A, facing=Gate, paces=2))', {
			kit: ['issue', 'hold_line', 'wait'],
			units: ['A', 'B', 'C'],
			seconds: 4,
		});
		const zs = ['A', 'B', 'C'].map((id) => grid.point.get(id)![1]);
		assert.ok(zs.every((z) => Math.abs(z - zs[0]) < 0.2), `line across: ${zs}`);
		director.dispose();
	});

	it('refuses to start a kit whose verbs the world cannot run', async () => {
		const director = new ArcDirector<Ctx>()
			.addFakeInference()
			.addStockVerbs()
			.withWorld({ find: () => undefined, getPose: () => undefined })
			.withContext((id) => ({ id }))
			.addCharacter({ id: 'Ann', mind: {}, kit: { verbs: ['go_to', 'examine'] }, identity: { role: 'Waits.' } });
		await assert.rejects(director.start(), /go_to' needs withWorld getNeighbors and canPass and steerToward.*examine' needs withWorld getDescription/);
	});
});
