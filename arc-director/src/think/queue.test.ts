import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCatalog, dummyEntity, SampleCache, type ExprEntity } from '../expr/index.js';
import { ThinkQueue, thinkRecencyScale } from './queue.js';
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
});
