import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ActionPlan } from '../action/types.js';
import { buildCatalog, dummyEntity, SampleCache, type ExprEntity } from '../expr/index.js';
import { ACTION_THINK_SCORES, THINK_ABOUT_SCORE, THINK_BARE_SCORE, ThinkQueue, actionThinkScore, planActionScore, thinkRecencyScale } from './queue.js';
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
		const rows = q.tick(1, catalogs, 0);
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
		q.tick(1, new Map(), 0);
		q.enqueueMajor('A');
		const catalogs = new Map();
		const rows = q.tick(1, catalogs, 0);
		assert.equal(rows.filter((r) => r.npcID === 'A').length, 1);
		assert.ok(rows[0].score >= 0.99);
	});

	it('maxParallel minus HTTP inFlight; motor does not occupy a slot', () => {
		const q = new ThinkQueue({ watchInterval: 100, processInterval: 0, maxParallel: 2 });
		q.enqueueMajor('A');
		q.enqueueMajor('B');
		q.enqueueMajor('C');
		const rows = q.tick(1, new Map(), 1);
		assert.equal(rows.length, 1);
	});

	it('skipMajor drops enqueue unless forced', () => {
		const q = new ThinkQueue({ watchInterval: 100, processInterval: 0, maxParallel: 2 });
		q.ensure('A', { skipMajor: true, skipHeartbeat: true });
		q.enqueueMajor('A');
		assert.equal(q.tick(1, new Map(), 0).length, 0);
		q.enqueueMajor('A', true);
		assert.equal(q.tick(1, new Map(), 0).length, 1);
	});

	it('drop rows when think starts', () => {
		const q = new ThinkQueue({ watchInterval: 100, processInterval: 0, maxParallel: 2 });
		q.enqueueMajor('A');
		q.drop('A');
		const rows = q.tick(1, new Map(), 0);
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
		const first = q.tick(1, new Map(), 0);
		assert.equal(first.length, 1);
		assert.equal(first[0].npcID, 'Cold');
		q.enqueueMajor('Hot');
		const later = q.tick(60, new Map(), 0);
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
		assert.equal(ACTION_THINK_SCORES.go_to, 0.5);

		const q = new ThinkQueue({ watchInterval: 100, processInterval: 0, maxParallel: 2 });
		q.ensure('A', { skipHeartbeat: true });
		q.enqueueAction('A', 'wait');
		assert.equal(q.tick(1, new Map(), 0).length, 0);
		q.enqueueAction('A', 'follow');
		assert.equal(q.tick(1, new Map(), 0).length, 0);
		q.enqueueAction('A', 'follow', false);
		const lost = q.tick(1, new Map(), 0);
		assert.equal(lost.length, 1);
		assert.equal(lost[0].score, 0.3);
		q.enqueueAction('A', 'wander');
		const wander = q.tick(1, new Map(), 0);
		assert.equal(wander.length, 1);
		assert.equal(wander[0].reason, 'action');
		assert.equal(wander[0].score, ACTION_THINK_SCORES.wander);
		q.enqueueAction('A', 'wait', false);
		const failed = q.tick(1, new Map(), 0);
		assert.equal(failed.length, 1);
		assert.equal(failed[0].score, 0.3);
	});

	it('prunes action rows to the more serious verb; skipMajor does not drop them', () => {
		const q = new ThinkQueue({ watchInterval: 100, processInterval: 0, maxParallel: 2 });
		q.ensure('A', { skipHeartbeat: true, skipMajor: true });
		q.enqueueMajor('A');
		q.enqueueAction('A', 'wander');
		q.enqueueAction('A', 'go_to');
		const rows = q.tick(1, new Map(), 0);
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
		assert.equal(q.tick(1, new Map(), 0).length, 0);
		q.enqueueAction('A', 'inspect');
		const rows = q.tick(1, new Map(), 0);
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
		}), THINK_ABOUT_SCORE);
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
		const rows = q.tick(1, new Map(), 0);
		assert.equal(rows.length, 1);
		assert.equal(rows[0].score, THINK_ABOUT_SCORE);
		assert.equal(rows[0].reason, 'action');
	});

	it('wait(for) drops warrants before it; wait without for does not', () => {
		const stealThenGo:ActionPlan = {
			head: { verb: 'steal', args: { item: 'Loaf', from: 'Baker' } },
			then: {
				join: 'then',
				plan: {
					head: { verb: 'wait', args: { for: 'some(others.approaching())' } },
					then: { join: 'then', plan: { head: { verb: 'go_to', args: { name: 'EastGate' } } } },
				},
			},
		};
		assert.equal(planActionScore(stealThenGo), ACTION_THINK_SCORES.go_to);
		assert.equal(planActionScore({
			head: { verb: 'steal', args: { item: 'Loaf', from: 'Baker' } },
			then: { join: 'then', plan: { head: { verb: 'wait', args: { for: 'hasHeard' } } } },
		}), 0);
		assert.equal(planActionScore({
			head: { verb: 'steal', args: { item: 'Loaf', from: 'Baker' } },
			then: { join: 'then', plan: { head: { verb: 'wait', args: { seconds: 8 } } } },
		}), ACTION_THINK_SCORES.steal);
		assert.equal(planActionScore({
			head: { verb: 'steal', args: { item: 'Loaf', from: 'Baker' } },
			then: { join: 'then', plan: { head: { verb: 'wait', args: { for: 'hasHeard' } } } },
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
		const rows = q.tick(1, catalogs, 0);
		assert.equal(rows.length, 1);
		assert.equal(rows[0].reason, 'watch');
		q.clearOnce('Guard');
		assert.equal(q.tick(1, catalogs, 0).length, 0);
	});
});

