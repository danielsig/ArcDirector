import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ActionPlan, ActionResult, Step } from '../action/types.js';
import { parsePlanText } from '../action/parse.js';
import { VerbRegistry, registerStockVerbs } from '../action/registry.js';
import { dummyEntity, buildCatalog } from '../expr/natives.js';
import { SampleCache } from '../expr/types.js';
import { createPlanSession, deferThinks, planSteps, pollPlanSession, runPlan, THINK_ABOUT_CAP } from './run.js';

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

describe('groups, fail, loop, when(watch)', () => {
	it('runs (A && B) || C and interpolates fail.reason', async () => {
		const seen:string[] = [];
		const plan = parsePlanText('(go_to(Keep) && wait(seconds=1)) || say(fail.reason)', registerStockVerbs(new VerbRegistry()));
		const result = await runPlan(plan, async (step) => {
			seen.push(`${step.verb}:${String(step.args.text ?? step.args.name ?? '')}`);
			if (step.verb === 'go_to') {
				return { ok: false, verb: 'go_to', reason: 'locked' };
			}
			return { ok: true, verb: step.verb };
		});
		assert.equal(result.ok, true);
		assert.deepEqual(seen, ['go_to:Keep', 'say:locked']);
	});

	it('loop times and until-fail', async () => {
		const n:string[] = [];
		const plan = parsePlanText('loop(times=3, plan=go_to(Keep))', registerStockVerbs(new VerbRegistry()));
		await runPlan(plan, async (step) => {
			n.push(step.verb);
			return { ok: true, verb: step.verb };
		});
		assert.deepEqual(n, ['go_to', 'go_to', 'go_to']);
		const failAt:string[] = [];
		await runPlan(parsePlanText('loop(plan=go_to(Keep))', registerStockVerbs(new VerbRegistry())), async (step) => {
			failAt.push(step.verb);
			return { ok: failAt.length < 2, verb: step.verb };
		});
		assert.equal(failAt.length, 2);
	});

	it('loop through=x in expr binds x', async () => {
		const names:string[] = [];
		const catalog = buildCatalog({
			me: dummyEntity('Mira'),
			others: [dummyEntity('Able'), dummyEntity('Baker')],
			items: [],
			cache: new SampleCache(),
		});
		const session = createPlanSession({
			catalog: () => catalog,
			cooldown: 0,
		});
		const plan = parsePlanText('loop(through=x in others, plan=follow(x))', registerStockVerbs(new VerbRegistry()));
		await runPlan(plan, async (step) => {
			names.push(String(step.args.name ?? ''));
			return { ok: true, verb: step.verb };
		}, { session });
		assert.deepEqual(names, ['Able', 'Baker']);
	});

	it('watch false aborts a handler and resumes the parent', async () => {
		const verbs:string[] = [];
		let heard = true;
		const catalog = ():ReturnType<typeof buildCatalog> => buildCatalog({
			me: dummyEntity('Mira'),
			others: [],
			items: [],
			cache: new SampleCache(),
			hasHeard: heard,
		});
		const session = createPlanSession({ catalog, cooldown: 0, now: () => 0 });
		const execute = async (step:Step):Promise<ActionResult> => {
			verbs.push(step.verb);
			if (step.verb === 'go_to' && step.args.name === 'Keep') {
				heard = false;
				pollPlanSession(session);
				return { ok: false, interrupted: true, verb: step.verb };
			}
			return { ok: true, verb: step.verb };
		};
		const plan = parsePlanText(
			'when(watch=hasHeard, plan=go_to(Keep)) ; wander()',
			registerStockVerbs(new VerbRegistry()),
		);
		const result = await runPlan(plan, execute, { session });
		assert.equal(result.ok, true);
		assert.ok(verbs.includes('go_to'));
		assert.ok(verbs.includes('wander'));
	});

	it('earlier when(watch) runs before later; later waits while earlier watch is true', async () => {
		const seen:string[] = [];
		let first = true;
		let second = true;
		const catalog = ():ReturnType<typeof buildCatalog> => buildCatalog({
			me: dummyEntity('Mira'),
			others: [],
			items: [],
			cache: new SampleCache(),
			bindings: {
				first: { kind: 'bool', value: first },
				second: { kind: 'bool', value: second },
			},
		});
		const session = createPlanSession({ catalog, cooldown: 0, now: () => 0 });
		const execute = async (step:Step):Promise<ActionResult> => {
			seen.push(`${step.verb}:${String(step.args.text ?? '')}`);
			if (step.verb === 'say' && step.args.text === 'A') {
				pollPlanSession(session);
				assert.equal(seen.includes('say:B'), false);
				first = false;
				pollPlanSession(session);
				return { ok: false, interrupted: true, verb: step.verb };
			}
			if (step.verb === 'say' && step.args.text === 'B') {
				second = false;
			}
			return { ok: true, verb: step.verb };
		};
		const plan = parsePlanText(
			'when(watch=first, plan=say("A")) ; when(watch=second, plan=say("B")) ; wait()',
			registerStockVerbs(new VerbRegistry()),
		);
		const result = await runPlan(plan, execute, { session });
		assert.equal(result.ok, true);
		assert.deepEqual(seen, ['say:A', 'say:B', 'wait:']);
	});
});
