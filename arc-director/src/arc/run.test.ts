import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Arc, ArcResult, Step } from '../arc/types.js';
import { parseArcText } from '../arc/parse.js';
import { VerbRegistry, registerStockVerbs } from '../arc/stock-verbs.js';
import { dummyEntity, buildCatalog } from '../expr/natives.js';
import { SampleCache } from '../expr/types.js';
import { createArcSession, deferThinks, arcSteps, pollArcSession, runArc, THINK_ABOUT_CAP } from './run.js';

function go(name:string):Step {
	return { verb: 'go_to', args: { name } };
}

function think(about?:string):Step {
	return { verb: 'think', args: about ? { about } : {} };
}

describe('deferThinks', () => {
	it('leaves an arc without think unchanged', () => {
		const arc:Arc = {
			head: go('EastGate'),
			then: { join: 'then_if_ok', arc: { head: { verb: 'wait', args: { seconds: 1 } } } },
		};
		assert.equal(deferThinks(arc), arc);
	});

	it('moves think to the end even when the LLM put it first', () => {
		const arc:Arc = {
			head: think('the lock'),
			then: { join: 'then_if_ok', arc: { head: go('EastGate') } },
		};
		const ordered = deferThinks(arc);
		assert.equal(ordered.head.verb, 'go_to');
		assert.equal(ordered.then?.join, 'then');
		assert.equal(ordered.then?.arc.head.verb, 'think');
		assert.equal(ordered.then?.arc.head.args.about, 'the lock');
	});

	it('concatenates several abouts into one trailing think', () => {
		const arc:Arc = {
			head: think('the lock'),
			then: {
				join: 'then',
				arc: {
					head: go('EastGate'),
					then: { join: 'then_if_ok', arc: { head: think('which key') } },
				},
			},
		};
		const ordered = deferThinks(arc);
		const steps = arcSteps(ordered);
		assert.deepEqual(steps.map((s) => s.verb), ['go_to', 'think']);
		assert.equal(steps[1].args.about, 'the lock which key');
	});

	it('keeps a bare think when no about is set', () => {
		const ordered = deferThinks({
			head: { verb: 'wait', args: {} },
			then: { join: 'then', arc: { head: think() } },
		});
		assert.equal(ordered.then?.arc.head.verb, 'think');
		assert.deepEqual(ordered.then?.arc.head.args, {});
	});

	it('caps concatenated abouts', () => {
		const a = 'a'.repeat(120);
		const b = 'b'.repeat(120);
		const ordered = deferThinks({
			head: think(a),
			then: { join: 'then', arc: { head: think(b) } },
		});
		const about = String(ordered.head.args.about ?? '');
		assert.equal(about.length, THINK_ABOUT_CAP);
		assert.equal(about.startsWith('a'), true);
	});
});

describe('runArc', () => {
	it('runs think last after the rest of the arc', async () => {
		const verbs:string[] = [];
		const arc:Arc = {
			head: think('later'),
			then: {
				join: 'then_if_ok',
				arc: {
					head: go('EastGate'),
					then: { join: 'then_if_ok', arc: { head: { verb: 'pick_up', args: { item: 'Key' } } } },
				},
			},
		};
		await runArc(arc, async (step) => {
			verbs.push(step.verb);
			return { ok: true, verb: step.verb };
		});
		assert.deepEqual(verbs, ['go_to', 'pick_up', 'think']);
	});

	it('still runs think when an earlier then_if_ok fails', async () => {
		const verbs:string[] = [];
		const arc:Arc = {
			head: think('anyway'),
			then: {
				join: 'then_if_ok',
				arc: {
					head: go('EastGate'),
					then: { join: 'then_if_ok', arc: { head: { verb: 'pick_up', args: { item: 'Key' } } } },
				},
			},
		};
		const result = await runArc(arc, async (step) => {
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
		const arc:Arc = {
			head: go('EastGate'),
			then: { join: 'then', arc: { head: think('nope') } },
		};
		const result = await runArc(arc, async (step) => {
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
		const arc = parseArcText('(go_to(Keep) && wait(seconds=1)) || say(fail.reason)', registerStockVerbs(new VerbRegistry()));
		const result = await runArc(arc, async (step) => {
			seen.push(`${step.verb}:${String(step.args.text ?? step.args.target ?? '')}`);
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
		const arc = parseArcText('loop(times=3, arc=go_to(Keep))', registerStockVerbs(new VerbRegistry()));
		await runArc(arc, async (step) => {
			n.push(step.verb);
			return { ok: true, verb: step.verb };
		});
		assert.deepEqual(n, ['go_to', 'go_to', 'go_to']);
		const failAt:string[] = [];
		await runArc(parseArcText('loop(arc=go_to(Keep))', registerStockVerbs(new VerbRegistry())), async (step) => {
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
		const session = createArcSession({
			catalog: () => catalog,
		});
		const arc = parseArcText('loop(through=x in others, arc=follow(x))', registerStockVerbs(new VerbRegistry()));
		await runArc(arc, async (step) => {
			names.push(String(step.args.target ?? ''));
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
		const session = createArcSession({ catalog, now: () => 0 });
		const execute = async (step:Step):Promise<ArcResult> => {
			verbs.push(step.verb);
			if (step.verb === 'go_to' && step.args.target === 'Keep') {
				heard = false;
				pollArcSession(session);
				return { ok: false, interrupted: true, verb: step.verb };
			}
			return { ok: true, verb: step.verb };
		};
		const arc = parseArcText(
			'when(watch=hasHeard, arc=go_to(Keep)) ; wander()',
			registerStockVerbs(new VerbRegistry()),
		);
		const result = await runArc(arc, execute, { session });
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
		const session = createArcSession({ catalog, now: () => 0 });
		const execute = async (step:Step):Promise<ArcResult> => {
			seen.push(`${step.verb}:${String(step.args.text ?? '')}`);
			if (step.verb === 'say' && step.args.text === 'A') {
				pollArcSession(session);
				assert.equal(seen.includes('say:B'), false);
				first = false;
				pollArcSession(session);
				return { ok: false, interrupted: true, verb: step.verb };
			}
			if (step.verb === 'say' && step.args.text === 'B') {
				second = false;
			}
			return { ok: true, verb: step.verb };
		};
		const arc = parseArcText(
			'when(watch=first, arc=say("A")) ; when(watch=second, arc=say("B")) ; wait()',
			registerStockVerbs(new VerbRegistry()),
		);
		const result = await runArc(arc, execute, { session });
		assert.equal(result.ok, true);
		assert.deepEqual(seen, ['say:A', 'say:B', 'wait:']);
	});

	it('parks when(watch) after the body so the session still polls', async () => {
		const verbs:string[] = [];
		const catalog = ():ReturnType<typeof buildCatalog> => buildCatalog({
			me: dummyEntity('Mira'),
			others: [],
			items: [],
			cache: new SampleCache(),
			hasHeard: false,
		});
		const session = createArcSession({ catalog, now: () => 0 });
		const arc = parseArcText(
			'when(watch=hasHeard, arc=say("ow")) ; wait()',
			registerStockVerbs(new VerbRegistry()),
		);
		const result = await runArc(arc, async (step) => {
			verbs.push(step.verb);
			return { ok: true, verb: step.verb };
		}, { session });
		assert.equal(result.ok, true);
		assert.equal(session.parked, true);
		assert.ok((session.frames[0]?.handlers.length ?? 0) > 0);
		assert.deepEqual(verbs, ['wait']);
	});

	it('does not park a finished body with no when', async () => {
		const session = createArcSession();
		const arc = parseArcText('wait()', registerStockVerbs(new VerbRegistry()));
		const result = await runArc(arc, async (step) => ({ ok: true, verb: step.verb }), { session });
		assert.equal(result.ok, true);
		assert.equal(session.parked, false);
	});
});
