import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ArcDirector } from '../director/director.js';
import { dummyEntity } from '../expr/natives.js';
import { SampleCache } from '../expr/types.js';
import { buildCatalog } from '../expr/natives.js';
import { evaluate } from '../expr/eval.js';
import type { ArcResult } from '../arc/types.js';
import { geometryKernels } from './kernels.js';
import { Mover } from './mover.js';
import { findRoute, reachablePoints, type Blocked, type Route } from './route.js';
import type { HostWorld, PathStep, Vec } from './types.js';
import { distance, groundAxes } from './vec.js';

type Ctx = { id:string };

function flush():Promise<void> {
	return new Promise((resolve) => {
		setImmediate(resolve);
	});
}

/**
 * A 2D grid, 17 cells deep, with walls and one door. Bodies move toward where they are steered at `speed` cells a second.
 * `carry` is who holds which item; an item on the ground is at its own spot.
 */
class Grid {
	readonly point = new Map<string, Vec>();
	readonly carry = new Map<string, string>();
	readonly steering = new Map<string, Vec | null>();
	doorLocked = false;
	speed = 4;

	constructor(readonly walls:Set<string> = new Set(), readonly door?:string) {}

	place(id:string, point:Vec):this {
		this.point.set(id, point);
		return this;
	}

	step(dt:number):void {
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
	readonly world:HostWorld<string> = {
		find: (id) => (this.point.has(id) || this.carry.has(id) ? id : undefined),
		getPose: (id) => {
			const holder = this.carry.get(id);
			const point = this.point.get(holder ?? id);
			return point ? { point, facing: [0, 1], right: [1, 0] } : undefined;
		},
		getPathGraph: () => (point) => {
			const cell = point.map(Math.round);
			const out:PathStep[] = [];
			for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
				const next = [cell[0] + dx, cell[1] + dz];
				const key = next.join(',');
				if (this.walls.has(key) || Math.abs(next[1]) > 8) {
					continue;
				}
				out.push(key === this.door && this.doorLocked ? { point: next, blocked: 'Door is locked' } : { point: next });
			}
			return out;
		},
		steerToward: (actor, to) => {
			this.steering.set(actor, to);
			const point = this.point.get(actor);
			return !!(to && point && distance(point, to) < 0.05);
		},
		getReach: () => 1.2,
		moveItem: ({ actor, item, to }) => {
			if (to === undefined) {
				this.carry.delete(item);
				this.point.set(item, this.point.get(actor)!);
				return { ok: true, reason: `dropped ${item}` };
			}
			this.carry.set(item, to);
			return { ok: true };
		},
		trade: ({ actor, side, other, item, quantity, price }) => {
			const floor = 5 * quantity;
			if ((price ?? floor) < floor) {
				return { ok: false, reason: `not below ${floor} gold` };
			}
			this.carry.set(item, side === 'buy' ? actor : other);
			return { ok: true, reason: `bought ${quantity} ${item} for ${price ?? floor} gold` };
		},
	};
}

/**
 * Four waypoints on a 10×10 square. The west road (via [0, 10]) costs three times its length, so the cheap
 * way round is east. Off the network, the waypoints within 6 are in sight.
 */
const WAYPOINTS:Vec[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
const ROADS:[number, number, number][] = [[0, 1, 10], [1, 2, 10], [0, 3, 30], [3, 2, 10]];
function network(point:Vec):PathStep[] {
	const i = WAYPOINTS.findIndex((p) => distance(p, point) < 1e-9);
	if (i < 0) {
		return WAYPOINTS.filter((p) => distance(p, point) <= 6).map((p) => ({ point: p }));
	}
	return ROADS.filter(([a, b]) => a === i || b === i).map(([a, b, cost]) => ({ point: WAYPOINTS[a === i ? b : a], cost }));
}

async function run(grid:Grid, reply:string, opts:{ kit:string[]; seconds?:number; units?:string[] }):Promise<{ director:ArcDirector<Ctx> }> {
	let sent = false;
	const director = new ArcDirector<Ctx>()
		.withPriorityQueue({ processInterval: 0, watchInterval: 0, heartbeatStart: 1000, heartbeatMin: 1000, maxParallel: 1 })
		.withFakeInference(() => {
			const content = sent ? 'wait(seconds=100)' : reply;
			sent = true;
			return { content, toolCalls: [] };
		})
		.withArcText(true)
		.addStockVerbs()
		.addStockCrowdVerbs()
		.withWorld(grid.world)
		.withKernels((ctx) => ({ me: dummyEntity(ctx.id, { tags: ['agent'] }), others: [], items: [] }))
		.withContext((id) => (grid.point.has(id) ? { id } : undefined));
	if (opts.units) {
		director.addCrowdConductor({ id: 'Hive', kit: { verbs: opts.kit }, identity: { role: 'Leads.' }, units: opts.units.map((id) => ({ id })) });
	}
	else {
		director.addAgent({ id: 'Ann', kit: { verbs: opts.kit }, identity: { role: 'Fetches.' } });
	}
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
	const line:(point:Vec)=>PathStep[] = (point) => [{ point: [point[0] + 1] }, { point: [point[0] - 1] }];
	const openRoute = (found:Route | Blocked | undefined):Route => {
		assert.ok(found && 'points' in found, 'an open route');
		return found;
	};

	it('finds the cheapest route on a 1D line and stops in reach', () => {
		const route = openRoute(findRoute(line, [0], [5], 1));
		assert.deepEqual(route.points, [[1], [2], [3], [4]]);
		assert.equal(route.cost, 4);
	});

	it('works in 3D and goes around a pricey step', () => {
		const graph = (point:Vec):PathStep[] => [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1]]
			.map((d) => ({ point: point.map((v, i) => v + d[i]) }))
			.map((step) => (step.point[0] === 1 && step.point[1] === 0 && step.point[2] === 0 ? { ...step, cost: 50 } : step));
		const route = openRoute(findRoute(graph, [0, 0, 0], [2, 0, 0]));
		assert.equal(route.cost, 4);
		assert.equal(route.points.some((p) => p.join() === '1,0,0'), false);
	});

	it('names the blocker when a blocked step is the only way, and gives up past the cap', () => {
		const gated = (point:Vec):PathStep[] => line(point).map((s) => (s.point[0] === 2 ? { ...s, blocked: 'Gate is shut' } : s));
		assert.deepEqual(findRoute(gated, [0], [4]), { blockers: [{ reason: 'Gate is shut', cost: 4 }] });
		assert.equal(findRoute(line, [0], [1e6], 0, 50), undefined);
	});

	it('names every locked way in, cheapest first, and only those that lead there', () => {
		const locks = new Map([['0,1', 'EastGate is locked'], ['0,3', 'WestGate is locked — you carry IronKey'], ['0,4', 'Closet is locked']]);
		const shed:Vec = [-10, -10];
		const gated = (point:Vec):PathStep[] => {
			const steps = network(point);
			const i = WAYPOINTS.findIndex((p) => distance(p, point) < 1e-9);
			if (i === 0) {
				steps.push({ point: shed });
			}
			return steps.map((s) => {
				const j = s.point === shed ? 4 : WAYPOINTS.indexOf(s.point);
				const reason = i >= 0 ? locks.get([i, j].sort().join()) : undefined;
				return reason ? { ...s, blocked: reason } : s;
			});
		};
		const found = findRoute(gated, [1, 1], [11, 9]);
		assert.ok(found && 'blockers' in found);
		assert.deepEqual(found.blockers.map((b) => b.reason), ['EastGate is locked', 'WestGate is locked — you carry IronKey']);
	});

	it('crosses a sparse weighted network between two points off it', () => {
		assert.deepEqual(openRoute(findRoute(network, [1, 1], [11, 9])).points, [[0, 0], [10, 0], [10, 10], [11, 9]]);
	});

	it('lists reachable points without crossing a blocked step', () => {
		const gated = (point:Vec):PathStep[] => line(point).filter((s) => s.point[0] >= 0).map((s) => (s.point[0] === 3 ? { ...s, blocked: 'x' } : s));
		assert.deepEqual(reachablePoints(gated, [0], 99).map((p) => p.point[0]), [0, 1, 2]);
	});
});

describe('Mover', () => {
	it('drives a body that starts beside a waypoint across a network, with a motor that stops short', async () => {
		let me:Vec = [0.05, 0];
		let to:Vec | null = null;
		let now = 0;
		let wentEast = false;
		const world:HostWorld<string> = {
			find: (id) => id,
			getPose: (id) => ({ point: id === 'Ann' ? me : [11, 9] }),
			getPathGraph: () => network,
			steerToward: (actor, point) => {
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
		const { director } = await run(grid, 'pick_up(Lantern) ; give(item=Lantern, to=Smith)', { kit: ['pick_up', 'give', 'wait'] });
		assert.equal(grid.carry.get('Lantern'), 'Smith');
		assert.ok(distance(grid.point.get('Ann')!, [0, 6]) <= 1.3);
		assert.equal(director.agent('Ann')!.lastResult?.reason, 'gave Lantern to Smith');
		director.dispose();
	});

	it('stops at a locked door and says so', async () => {
		const walls = new Set(Array.from({ length: 17 }, (element, i) => `3,${i - 8}`).filter((cell) => cell !== '3,0'));
		const grid = new Grid(walls, '3,0').place('Ann', [0, 0]).place('Well', [6, 0]);
		grid.doorLocked = true;
		const { director } = await run(grid, 'go_to(Well)', { kit: ['go_to', 'wait'], seconds: 2 });
		assert.equal(director.agent('Ann')!.lastResult?.reason, 'no way to Well, blocked on the way: Door is locked');
		assert.deepEqual(grid.point.get('Ann'), [0, 0]);
		director.dispose();
	});

	it('buys at the seller, a quantity for a total offer, and refuses a low offer', async () => {
		const grid = new Grid().place('Ann', [0, 0]).place('Mira', [4, 0]).place('Bread', [4, 0]);
		grid.carry.set('Bread', 'Mira');
		const low = await run(grid, 'buy(item=Bread, from=Mira, offer=12, quantity=3)', { kit: ['buy', 'wait'] });
		assert.equal(low.director.agent('Ann')!.lastResult?.reason, 'not below 15 gold');
		low.director.dispose();
		const { director } = await run(grid, 'buy(item=Bread, from=Mira)', { kit: ['buy', 'wait'] });
		assert.equal(grid.carry.get('Bread'), 'Ann');
		assert.equal(director.agent('Ann')!.lastResult?.reason, 'bought 1 Bread for 5 gold');
		director.dispose();
	});

	it('wanders toward where until holds and reports what it saw', async () => {
		const grid = new Grid().place('Ann', [0, 0]);
		const { director } = await run(grid, 'wander(until=1 > 2, seconds=3)', { kit: ['wander', 'wait'], seconds: 4 });
		assert.ok(distance(grid.point.get('Ann')!, [0, 0]) > 1);
		assert.equal(director.agent('Ann')!.lastResult?.verb, 'wander');
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

	it('forms a line of units across the way to the foe', async () => {
		const grid = new Grid().place('A', [0, 0]).place('B', [1, 0]).place('C', [2, 0]).place('Gate', [0, 8]);
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
			.withFakeInference()
			.addStockVerbs()
			.withWorld({ find: () => undefined, getPose: () => undefined })
			.withContext((id) => ({ id }))
			.addAgent({ id: 'Ann', kit: { verbs: ['go_to', 'examine'] }, identity: { role: 'Waits.' } });
		await assert.rejects(director.start(), /go_to' needs withWorld getPathGraph and steerToward.*examine' needs withWorld getDescription/);
	});
});
