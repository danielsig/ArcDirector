import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ActionPlan } from '../action/types.js';
import { buildCatalog, dummyEntity, SampleCache, type ExprEntity } from '../expr/index.js';
import { ACTION_THINK_SCORES, THINK_ABOUT_SCORE, THINK_BARE_SCORE, SimpleQueue, ThinkQueue, actionThinkScore, planActionScore, thinkRecencyScale, withPriorityQueue } from './queue.js';
import { DEFAULT_TRUE_SCORE } from '../expr/types.js';

type Posed = ExprEntity & { x:number; z:number };

function posed(id:string, extra:Partial<ExprEntity> & { x:number; z:number }):Posed {
	return { ...dummyEntity(id, extra), x: extra.x, z: extra.z };
}

function xz(a:ExprEntity, b:ExprEntity):number {
	const pa = a as Partial<Posed>;
	const pb = b as Partial<Posed>;
	return Math.hypot((pa.x ?? 0) - (pb.x ?? 0), (pa.z ?? 0) - (pb.z ?? 0));
}

describe('ThinkQueue', () => {
	it('coerces watch roots and triggers on max > ε; no sum', () => {
		const q = new ThinkQueue({
			watchInterval: 0,
			processInterval: 0,
			trueScore: 0.51,
			epsilon: 0.05,
			maxParallel: 2,
		});
		const me = posed('me', { x: 0, z: 0 });
		const Player = posed('Player', { x: 3, z: 0 });
		const cat = buildCatalog({
			me,
			others: [Player],
			items: [],
			cache: new SampleCache(),
			distance: xz,
			nearRadius: 8,
			bindings: { Player: { kind: 'entity', value: Player } },
			hasHeard: true,
		});
		q.setWatches('Guard', ['hasHeard', 'isNear(me, Player)']);
		q.ensure('Guard');
		const catalogs = new Map([['Guard', cat]]);
		const rows = q.tick(1, catalogs);
		assert.equal(rows.length, 1);
		assert.equal(rows[0].npcID, 'Guard');
		assert.ok(rows[0].score <= 0.51 + 1e-9);
		assert.ok(rows[0].score > 0.05);
	});

	it('prunes to one row per NPC; heartbeat lowest; major ~1', () => {
		const q = new ThinkQueue({
			watchInterval: 100,
			processInterval: 0,
			maxParallel: 2,
			heartbeatStart: 0.01,
			heartbeatMin: 0.01,
		});
		q.ensure('A');
		q.ensure('B', { skipHeartbeat: true });
		q.enqueueMajor('A');
		q.tick(1, new Map());
		q.enqueueMajor('A');
		const catalogs = new Map();
		const rows = q.tick(1, catalogs);
		assert.equal(rows.filter((r) => r.npcID === 'A').length, 1);
		assert.ok(rows[0].score >= 0.99);
	});

	it('HTTP beginThink occupies a slot; a live plan does not', () => {
		const q = new ThinkQueue({ watchInterval: 100, processInterval: 0, maxParallel: 2 });
		q.ensure('A', { skipHeartbeat: true });
		q.ensure('B', { skipHeartbeat: true });
		q.ensure('C', { skipHeartbeat: true });
		q.beginThink('A');
		q.enqueueMajor('B');
		q.enqueueMajor('C');
		assert.equal(q.tick(1, new Map()).length, 1);
		q.endThink('A');
		q.beginPlan('A', { head: { verb: 'go_to', args: { name: 'Gate' } } });
		q.enqueueMajor('B');
		q.enqueueMajor('C');
		assert.equal(q.tick(1, new Map()).length, 2);
	});

	it('skipMajor drops enqueue unless forced', () => {
		const q = new ThinkQueue({ watchInterval: 100, processInterval: 0, maxParallel: 2 });
		q.ensure('A', { skipMajor: true, skipHeartbeat: true });
		q.enqueueMajor('A');
		assert.equal(q.tick(1, new Map()).length, 0);
		q.enqueueMajor('A', true);
		assert.equal(q.tick(1, new Map()).length, 1);
	});

	it('heartbeat is a low-priority pulse every 3s and does not stretch', () => {
		const q = new ThinkQueue({ watchInterval: 100, processInterval: 0, maxParallel: 1 });
		q.ensure('A');
		const first = q.tick(0, new Map());
		assert.equal(first.length, 1);
		assert.equal(first[0].reason, 'heartbeat');
		assert.equal(first[0].score, 0.001);
		q.noteResult('A', true);
		assert.equal(q.heartbeatSeconds('A'), 3);
		assert.equal(q.tick(2.9, new Map()).length, 0);
		const again = q.tick(0.2, new Map());
		assert.equal(again.length, 1);
		assert.equal(again[0].reason, 'heartbeat');
		assert.equal(again[0].score, 0.001);
	});

	it('drop rows when think starts', () => {
		const q = new ThinkQueue({ watchInterval: 100, processInterval: 0, maxParallel: 2 });
		q.enqueueMajor('A');
		q.drop('A');
		const rows = q.tick(1, new Map());
		assert.equal(rows.length, 0);
	});

	it('scales score by trueScore after a think, recovering by half of heartbeatStart', () => {
		assert.equal(thinkRecencyScale(0, 120, DEFAULT_TRUE_SCORE), DEFAULT_TRUE_SCORE);
		assert.equal(thinkRecencyScale(60, 120, DEFAULT_TRUE_SCORE), 1);
		assert.equal(thinkRecencyScale(30, 120, DEFAULT_TRUE_SCORE), (DEFAULT_TRUE_SCORE + 1) / 2);
		assert.equal(thinkRecencyScale(120, 120, DEFAULT_TRUE_SCORE), 1);
		const q = new ThinkQueue({
			watchInterval: 100,
			processInterval: 0,
			maxParallel: 1,
			heartbeatStart: 120,
			heartbeatMin: 30,
			heartbeatAdjust: false,
		});
		q.ensure('Hot', { skipHeartbeat: true });
		q.ensure('Cold', { skipHeartbeat: true });
		q.noteResult('Hot', false);
		q.enqueueMajor('Hot');
		q.enqueueMajor('Cold');
		const first = q.tick(1, new Map());
		assert.equal(first.length, 1);
		assert.equal(first[0].npcID, 'Cold');
		q.enqueueMajor('Hot');
		const later = q.tick(60, new Map());
		assert.equal(later[0].npcID, 'Hot');
		assert.ok(Math.abs(q.recencyScale('Hot') - 1) < 1e-9);
	});

	it('enqueueAction uses seriousness; wait is silent; fail still wakes', () => {
		assert.ok(actionThinkScore('steal') > actionThinkScore('go_to'));
		assert.ok(actionThinkScore('go_to') > actionThinkScore('think'));
		assert.ok(actionThinkScore('think') > actionThinkScore('wander'));
		assert.ok(actionThinkScore('wander') > actionThinkScore('wait'));
		assert.equal(actionThinkScore('wait'), 0);
		assert.ok(actionThinkScore('wait', false) > 0);
		assert.equal(actionThinkScore('follow'), 0);
		assert.equal(actionThinkScore('follow', false), 0.3);
		assert.equal(actionThinkScore('wait', false), 0.3);
		assert.ok(actionThinkScore('steal', false) >= 0.3);
		assert.equal(ACTION_THINK_SCORES.go_to, 0.8);

		const q = new ThinkQueue({ watchInterval: 100, processInterval: 0, maxParallel: 2 });
		q.ensure('A', { skipHeartbeat: true });
		q.enqueueAction('A', 'wait');
		assert.equal(q.tick(1, new Map()).length, 0);
		q.enqueueAction('A', 'follow');
		assert.equal(q.tick(1, new Map()).length, 0);
		q.enqueueAction('A', 'follow', false);
		const lost = q.tick(1, new Map());
		assert.equal(lost.length, 1);
		assert.equal(lost[0].score, 0.3);
		q.enqueueAction('A', 'wander');
		const wander = q.tick(1, new Map());
		assert.equal(wander.length, 1);
		assert.equal(wander[0].reason, 'action');
		assert.equal(wander[0].score, ACTION_THINK_SCORES.wander);
		q.enqueueAction('A', 'wait', false);
		const failed = q.tick(1, new Map());
		assert.equal(failed.length, 1);
		assert.equal(failed[0].score, 0.3);
	});

	it('prunes action rows to the more serious verb; skipMajor does not drop them', () => {
		const q = new ThinkQueue({ watchInterval: 100, processInterval: 0, maxParallel: 2 });
		q.ensure('A', { skipHeartbeat: true, skipMajor: true });
		q.enqueueMajor('A');
		q.enqueueAction('A', 'wander');
		q.enqueueAction('A', 'go_to');
		const rows = q.tick(1, new Map());
		assert.equal(rows.length, 1);
		assert.equal(rows[0].reason, 'action');
		assert.equal(rows[0].score, ACTION_THINK_SCORES.go_to);
	});

	it('actionScores overrides defaults, including suppressing a verb', () => {
		const q = new ThinkQueue({
			watchInterval: 100,
			processInterval: 0,
			maxParallel: 2,
			actionScores: { wander: 0, inspect: 0.5 },
		});
		q.ensure('A', { skipHeartbeat: true });
		q.enqueueAction('A', 'wander');
		assert.equal(q.tick(1, new Map()).length, 0);
		q.enqueueAction('A', 'inspect');
		const rows = q.tick(1, new Map());
		assert.equal(rows.length, 1);
		assert.equal(rows[0].score, 0.5);
	});

	it('planActionScore is the max warrant; think(about) is 0.55', () => {
		assert.equal(THINK_BARE_SCORE, 0.35);
		assert.equal(THINK_ABOUT_SCORE, 0.55);
		assert.equal(planActionScore({
			head: { verb: 'wait', args: {} },
			then: { join: 'then', plan: { head: { verb: 'think', args: {} } } },
		}), THINK_BARE_SCORE);
		assert.equal(planActionScore({
			head: { verb: 'wait', args: {} },
			then: { join: 'then', plan: { head: { verb: 'think', args: { about: 'the lock' } } } },
		}), THINK_ABOUT_SCORE);
		assert.equal(planActionScore({
			head: { verb: 'go_to', args: { name: 'EastGate' } },
			then: { join: 'then', plan: { head: { verb: 'think', args: { about: 'the lock' } } } },
		}), ACTION_THINK_SCORES.go_to);
		assert.equal(planActionScore({
			head: { verb: 'go_to', args: { name: 'EastGate' } },
			then: { join: 'then', plan: { head: { verb: 'think', args: {} } } },
		}), ACTION_THINK_SCORES.go_to);

		const q = new ThinkQueue({ watchInterval: 100, processInterval: 0, maxParallel: 2 });
		q.ensure('A', { skipHeartbeat: true });
		q.enqueuePlan('A', {
			head: { verb: 'wait', args: {} },
			then: { join: 'then', plan: { head: { verb: 'think', args: { about: 'the lock' } } } },
		});
		const rows = q.tick(1, new Map());
		assert.equal(rows.length, 1);
		assert.equal(rows[0].score, THINK_ABOUT_SCORE);
		assert.equal(rows[0].reason, 'action');
	});

	it('wait(until) drops warrants before it; wait without until does not', () => {
		const stealThenGo:ActionPlan = {
			head: { verb: 'steal', args: { item: 'Loaf', from: 'Baker' } },
			then: {
				join: 'then',
				plan: {
					head: { verb: 'wait', args: { until: 'some(others.approaching())' } },
					then: { join: 'then', plan: { head: { verb: 'go_to', args: { name: 'EastGate' } } } },
				},
			},
		};
		assert.equal(planActionScore(stealThenGo), ACTION_THINK_SCORES.go_to);
		assert.equal(planActionScore({
			head: { verb: 'steal', args: { item: 'Loaf', from: 'Baker' } },
			then: { join: 'then', plan: { head: { verb: 'wait', args: { until: 'hasHeard' } } } },
		}), 0);
		assert.equal(planActionScore({
			head: { verb: 'steal', args: { item: 'Loaf', from: 'Baker' } },
			then: { join: 'then', plan: { head: { verb: 'wait', args: { seconds: 8 } } } },
		}), ACTION_THINK_SCORES.steal);
		assert.equal(planActionScore({
			head: { verb: 'steal', args: { item: 'Loaf', from: 'Baker' } },
			then: { join: 'then', plan: { head: { verb: 'wait', args: { until: 'hasHeard' } } } },
		}, false), 0.3);
	});

	it('armOnce is sampled like a watch and clearOnce drops it', () => {
		const q = new ThinkQueue({
			watchInterval: 0,
			processInterval: 0,
			trueScore: 0.51,
			epsilon: 0.05,
			maxParallel: 2,
		});
		q.ensure('Guard', { skipHeartbeat: true });
		q.armOnce('Guard', 'hasHeard');
		const me = posed('me', { x: 0, z: 0 });
		const cat = buildCatalog({
			me,
			others: [],
			items: [],
			cache: new SampleCache(),
			distance: xz,
			nearRadius: 8,
			hasHeard: true,
		});
		const catalogs = new Map([['Guard', cat]]);
		const rows = q.tick(1, catalogs);
		assert.equal(rows.length, 1);
		assert.equal(rows[0].reason, 'watch');
		q.clearOnce('Guard');
		assert.equal(q.tick(1, catalogs).length, 0);
	});

	it('default mayThink allows while a plan is live; callback can block it', () => {
		const q = new ThinkQueue({ watchInterval: 100, processInterval: 0, maxParallel: 2 });
		q.ensure('A', { skipHeartbeat: true });
		q.beginPlan('A', {
			head: { verb: 'go_to', args: { name: 'Gate' } },
			then: { join: 'then', plan: { head: { verb: 'steal', args: { item: 'Loaf', from: 'Baker' } } } },
		});
		q.enqueueMajor('A');
		assert.equal(q.tick(1, new Map()).length, 1);
		q.mayThink = (ctx) => {
			assert.deepEqual(ctx.verbs, ['go_to', 'steal']);
			assert.equal(ctx.plan?.head.verb, 'go_to');
			return false;
		};
		q.enqueueMajor('A');
		assert.equal(q.tick(1, new Map()).length, 0);
	});

	it('withPriorityQueue is one shared queue to spread into agents', () => {
		const think = withPriorityQueue({
			watchInterval: 100,
			processInterval: 0,
			maxParallel: 2,
			mayThink: ({ plan }) => !plan,
		});
		assert.equal(think.heartbeat, 0);
		think.queue.ensure('A', { skipHeartbeat: true });
		think.queue.enqueueMajor('A');
		assert.equal(think.queue.tick(1, new Map()).length, 1);
	});

	it('simple queue is first come, first served', () => {
		const q = new SimpleQueue({ watchInterval: 100, processInterval: 0, maxParallel: 1 });
		q.ensure('Late', { skipHeartbeat: true });
		q.ensure('Early', { skipHeartbeat: true });
		q.enqueueMajor('Early');
		q.enqueueMajor('Late');
		const first = q.tick(1, new Map());
		assert.equal(first.length, 1);
		assert.equal(first[0].npcID, 'Early');
		const second = q.tick(1, new Map());
		assert.equal(second[0].npcID, 'Late');
	});

	it('simple queue does not let a later major jump the line', () => {
		const q = new SimpleQueue({ watchInterval: 100, processInterval: 0, maxParallel: 1 });
		q.ensure('Early', { skipHeartbeat: true });
		q.ensure('Loud', { skipHeartbeat: true });
		q.enqueueAction('Early', 'wander');
		q.enqueueMajor('Loud');
		assert.equal(q.tick(1, new Map())[0].npcID, 'Early');
	});
});

