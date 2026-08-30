import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ActionPlan, Step } from '../action/types.js';
import { deferThinks, planSteps, runPlan, THINK_ABOUT_CAP } from './run.js';

function go(name:string):Step {
	return { verb: 'go_to', args: { name } };
}

function think(about?:string):Step {
	return { verb: 'think', args: about ? { about } : {} };
}

describe('deferThinks', () => {
	it('leaves a plan without think unchanged', () => {
		const plan:ActionPlan = {
			head: go('EastGate'),
			then: { join: 'then_if_ok', plan: { head: { verb: 'wait', args: { seconds: 1 } } } },
		};
		assert.equal(deferThinks(plan), plan);
	});

	it('moves think to the end even when the LLM put it first', () => {
		const plan:ActionPlan = {
			head: think('the lock'),
			then: { join: 'then_if_ok', plan: { head: go('EastGate') } },
		};
		const ordered = deferThinks(plan);
		assert.equal(ordered.head.verb, 'go_to');
		assert.equal(ordered.then?.join, 'then');
		assert.equal(ordered.then?.plan.head.verb, 'think');
		assert.equal(ordered.then?.plan.head.args.about, 'the lock');
	});

	it('concatenates several abouts into one trailing think', () => {
		const plan:ActionPlan = {
			head: think('the lock'),
			then: {
				join: 'then',
				plan: {
					head: go('EastGate'),
					then: { join: 'then_if_ok', plan: { head: think('which key') } },
				},
			},
		};
		const ordered = deferThinks(plan);
		const steps = planSteps(ordered);
		assert.deepEqual(steps.map((s) => s.verb), ['go_to', 'think']);
		assert.equal(steps[1].args.about, 'the lock which key');
	});

	it('keeps a bare think when no about is set', () => {
		const ordered = deferThinks({
			head: { verb: 'wait', args: {} },
			then: { join: 'then', plan: { head: think() } },
		});
		assert.equal(ordered.then?.plan.head.verb, 'think');
		assert.deepEqual(ordered.then?.plan.head.args, {});
	});

	it('caps concatenated abouts', () => {
		const a = 'a'.repeat(120);
		const b = 'b'.repeat(120);
		const ordered = deferThinks({
			head: think(a),
			then: { join: 'then', plan: { head: think(b) } },
		});
		const about = String(ordered.head.args.about ?? '');
		assert.equal(about.length, THINK_ABOUT_CAP);
		assert.equal(about.startsWith('a'), true);
	});
});

describe('runPlan', () => {
	it('runs think last after the rest of the plan', async () => {
		const verbs:string[] = [];
		const plan:ActionPlan = {
			head: think('later'),
			then: {
				join: 'then_if_ok',
				plan: {
					head: go('EastGate'),
					then: { join: 'then_if_ok', plan: { head: { verb: 'pick_up', args: { name: 'Key' } } } },
				},
			},
		};
		await runPlan(plan, async (step) => {
			verbs.push(step.verb);
			return { ok: true, verb: step.verb };
		});
		assert.deepEqual(verbs, ['go_to', 'pick_up', 'think']);
	});

	it('still runs think when an earlier then_if_ok fails', async () => {
		const verbs:string[] = [];
		const plan:ActionPlan = {
			head: think('anyway'),
			then: {
				join: 'then_if_ok',
				plan: {
					head: go('EastGate'),
					then: { join: 'then_if_ok', plan: { head: { verb: 'pick_up', args: { name: 'Key' } } } },
				},
			},
		};
		const result = await runPlan(plan, async (step) => {
			verbs.push(step.verb);
			if (step.verb === 'go_to') {
				return { ok: false, verb: 'go_to', reason: 'locked' };
			}
			return { ok: true, verb: step.verb };
		});
		assert.deepEqual(verbs, ['go_to', 'think']);
		assert.equal(result.verb, 'think');
		assert.equal(result.ok, true);
	});

	it('skips think when the body is interrupted', async () => {
		const verbs:string[] = [];
		const plan:ActionPlan = {
			head: go('EastGate'),
			then: { join: 'then', plan: { head: think('nope') } },
		};
		const result = await runPlan(plan, async (step) => {
			verbs.push(step.verb);
			return { ok: false, interrupted: true, verb: step.verb, reason: 'hurt' };
		});
		assert.deepEqual(verbs, ['go_to']);
		assert.equal(result.interrupted, true);
	});
});
