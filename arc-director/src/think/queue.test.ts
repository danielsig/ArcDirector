import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCatalog, dummyEntity, SampleCache, type ExprEntity } from '../expr/index.js';
import { SimpleThinkQueue, PriorityThinkQueue, thinkRecencyScale } from './queue.js';
import { DEFAULT_TRUE_SCORE } from '../expr/expr-types.js';

type Posed = ExprEntity & { x:number; z:number };

function posed(id:string, extra:Partial<ExprEntity> & { x:number; z:number }):Posed {
	return { ...dummyEntity(id, extra), x: extra.x, z: extra.z };
}

function xz(a:ExprEntity, b:ExprEntity):number {
	const pa = a as Partial<Posed>;
	const pb = b as Partial<Posed>;
	return Math.hypot((pa.x ?? 0) - (pb.x ?? 0), (pa.z ?? 0) - (pb.z ?? 0));
}

describe('PriorityThinkQueue', () => {
	it('coerces watch roots and triggers on max > ε; no sum', () => {
		const q = new PriorityThinkQueue({
			processInterval: 0,
			trueScore: 0.51,
			epsilon: 0.05,
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
		q.setWatches('Guard', { heard: 'hasHeard', near: 'isNear(me, Player)' });
		q.ensure('Guard');
		const catalogs = new Map([['Guard', cat]]);
		const rows = q.tick(1, catalogs);
		assert.equal(rows.length, 1);
		assert.equal(rows[0].mindID, 'Guard');
		assert.ok(rows[0].score <= 0.51 + 1e-9);
		assert.ok(rows[0].score > 0.05);
		assert.equal(rows[0].why, 'watch heard', 'the first watch that scored highest, by its name');
	});

	it('prunes to one row per NPC; rethink lowest; major ~1', () => {
		const q = new PriorityThinkQueue({
			processInterval: 0,
			rethinkInterval: 0.01,
		});
		q.ensure('A');
		q.ensure('B', { rethinks: false });
		q.enqueueMajor('A');
		q.tick(1, new Map());
		q.enqueueMajor('A');
		const catalogs = new Map();
		const rows = q.tick(1, catalogs);
		assert.equal(rows.filter((r) => r.mindID === 'A').length, 1);
		assert.ok(rows[0].score >= 0.99);
	});

	it('abortThink trips the inflight signal; drop and setAiOn(false) abort', () => {
		const q = new PriorityThinkQueue({ processInterval: 0 });
		q.ensure('A', { rethinks: false });
		const sig = q.beginThink('A');
		assert.equal(sig.aborted, false);
		q.abortThink('A');
		assert.equal(sig.aborted, true);
		q.endThink('A');
		const dropSig = q.beginThink('A');
		q.drop('A');
		assert.equal(dropSig.aborted, true);
		q.endThink('A');
		const offSig = q.beginThink('A');
		q.setAiOn('A', false);
		assert.equal(offSig.aborted, true);
	});

	it('never hands out a mind already thinking; a live arc does not hold it back', () => {
		const q = new PriorityThinkQueue({ processInterval: 0 });
		q.ensure('A', { rethinks: false });
		q.ensure('B', { rethinks: false });
		q.ensure('C', { rethinks: false });
		q.beginThink('A');
		q.enqueueMajor('A', true);
		q.enqueueMajor('B');
		q.enqueueMajor('C');
		assert.deepEqual(q.tick(1, new Map()).map((row) => row.mindID).sort(), ['B', 'C']);
		q.endThink('A');
		q.beginArc('A', [{ verb: 'go_to', args: { target: 'Gate' } }]);
		q.enqueueMajor('B');
		q.enqueueMajor('C');
		assert.deepEqual(q.tick(1, new Map()).map((row) => row.mindID).sort(), ['A', 'B', 'C']);
	});

	it('queues one opening think for a new mind, rethinking or not, below a major event', () => {
		const q = new PriorityThinkQueue({ processInterval: 0 });
		q.ensure('Quiet', { rethinks: false });
		q.ensure('Loud', { rethinks: false });
		q.enqueueMajor('Loud');
		const rows = q.tick(1, new Map());
		assert.deepEqual(rows.map((row) => [row.mindID, row.reason]), [['Loud', 'major'], ['Quiet', 'start']]);
		q.ensure('Quiet');
		assert.equal(q.tick(1, new Map()).length, 0, 'once: ensuring it again queues nothing');
		q.ensure('Waiter', { rethinks: false, skipStart: true });
		assert.equal(q.tick(1, new Map()).length, 0, 'skipStart: it waits for something to happen');
	});

	it('skipMajor drops enqueue unless forced', () => {
		const q = new PriorityThinkQueue({ processInterval: 0 });
		q.ensure('A', { skipMajor: true, rethinks: false });
		q.drop('A');
		q.enqueueMajor('A');
		assert.equal(q.tick(1, new Map()).length, 0);
		q.enqueueMajor('A', true);
		assert.equal(q.tick(1, new Map()).length, 1);
	});

	it('rethink is a low-priority row every 3s and does not stretch', () => {
		const q = new PriorityThinkQueue({ processInterval: 0 });
		q.ensure('A');
		const first = q.tick(0, new Map());
		assert.equal(first.length, 1);
		assert.equal(first[0].reason, 'start', 'the opening think, then the rethink');
		q.noteResult('A');
		assert.equal(q.rethinkSeconds('A'), 3);
		assert.equal(q.tick(2.9, new Map()).length, 0);
		const again = q.tick(0.2, new Map());
		assert.equal(again.length, 1);
		assert.equal(again[0].reason, 'rethink');
		assert.equal(again[0].score, 0.001);
	});

	it('drop rows when think starts', () => {
		const q = new PriorityThinkQueue({ processInterval: 0 });
		q.enqueueMajor('A');
		q.drop('A');
		const rows = q.tick(1, new Map());
		assert.equal(rows.length, 0);
	});

	it('scales score by trueScore after a think, recovering by half of rethinkInterval', () => {
		assert.equal(thinkRecencyScale(0, 120, DEFAULT_TRUE_SCORE), DEFAULT_TRUE_SCORE);
		assert.equal(thinkRecencyScale(60, 120, DEFAULT_TRUE_SCORE), 1);
		assert.equal(thinkRecencyScale(30, 120, DEFAULT_TRUE_SCORE), (DEFAULT_TRUE_SCORE + 1) / 2);
		assert.equal(thinkRecencyScale(120, 120, DEFAULT_TRUE_SCORE), 1);
		const q = new PriorityThinkQueue({
			processInterval: 0,
			rethinkInterval: 120,
		});
		q.ensure('Hot', { rethinks: false });
		q.ensure('Cold', { rethinks: false });
		q.noteResult('Hot');
		q.enqueueMajor('Hot');
		q.enqueueMajor('Cold');
		assert.deepEqual(q.tick(1, new Map()).map((row) => row.mindID), ['Cold', 'Hot']);
		q.enqueueMajor('Hot');
		const later = q.tick(60, new Map());
		assert.equal(later[0].mindID, 'Hot');
		assert.ok(Math.abs(q.recencyScale('Hot') - 1) < 1e-9);
	});

	it('an Arc that ends queues a think at the score it is given', () => {
		const q = new PriorityThinkQueue({ processInterval: 0 });
		q.ensure('Opening', { rethinks: false });
		q.ensure('Ended', { rethinks: false, skipStart: true });
		q.ensure('Loud', { rethinks: false, skipStart: true });
		q.enqueueArcEnd('Ended', 'arc ok at wait', 0.8);
		q.enqueueMajor('Loud');
		const rows = q.tick(1, new Map());
		assert.deepEqual(rows.map((row) => [row.mindID, row.reason]), [['Loud', 'major'], ['Ended', 'arc'], ['Opening', 'start']]);
		assert.equal(rows[1].why, 'arc ok at wait');
		q.setAiOn('Ended', false);
		q.enqueueArcEnd('Ended', 'arc failed at go_to', 0.5);
		assert.equal(q.tick(1, new Map()).length, 0, 'not while its AI is off');
	});

	it('armOnce is sampled like a watch and clearOnce drops it', () => {
		const q = new PriorityThinkQueue({
			processInterval: 0,
			trueScore: 0.51,
			epsilon: 0.05,
		});
		q.ensure('Guard', { rethinks: false });
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
		assert.equal(rows[0].why, 'until hasHeard');
		q.clearOnce('Guard');
		assert.equal(q.tick(1, catalogs).length, 0);
	});

	it('default mayThink allows while an arc is live; callback can block it', () => {
		const q = new PriorityThinkQueue({ processInterval: 0 });
		q.ensure('A', { rethinks: false });
		q.beginArc('A', [{ verb: 'go_to', args: { target: 'Gate' }, then: 'always' }, { verb: 'steal', args: { item: 'Loaf', from: 'Baker' } }]);
		q.enqueueMajor('A');
		assert.equal(q.tick(1, new Map()).length, 1);
		q.mayThink = (ctx) => {
			assert.deepEqual(ctx.verbs, ['go_to', 'steal']);
			assert.equal(ctx.arc?.[0].verb, 'go_to');
			return false;
		};
		q.enqueueMajor('A');
		assert.equal(q.tick(1, new Map()).length, 0);
	});

	it('mayThink lets a mind with no arc think', () => {
		const q = new PriorityThinkQueue({
			processInterval: 0,
			mayThink: ({ arc }) => !arc,
		});
		q.ensure('A', { rethinks: false });
		q.enqueueMajor('A');
		assert.equal(q.tick(1, new Map()).length, 1);
	});

	it('simple queue is first come, first served', () => {
		const q = new SimpleThinkQueue({ processInterval: 0 });
		q.ensure('Late', { rethinks: false });
		q.ensure('Early', { rethinks: false });
		q.drop('Late');
		q.drop('Early');
		q.enqueueMajor('Early');
		q.enqueueMajor('Late');
		assert.deepEqual(q.tick(1, new Map()).map((row) => row.mindID), ['Early', 'Late']);
	});

	it('simple queue does not let a later major jump the line', () => {
		const q = new SimpleThinkQueue({ processInterval: 0 });
		q.ensure('Early', { rethinks: false });
		q.ensure('Loud', { rethinks: false });
		q.enqueueArcEnd('Early', 'arc ok at wander', 0.1);
		q.enqueueMajor('Loud');
		assert.equal(q.tick(1, new Map())[0].mindID, 'Early');
	});
});

