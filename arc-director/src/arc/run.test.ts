import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { arcSteps, type Arc, type ArcResult, type Join, type Step } from './types.js';
import { parseArcText } from './parse.js';
import { VerbRegistry, registerStockVerbs } from './stock-verbs.js';
import { dummyEntity, buildCatalog } from '../expr/natives.js';
import { SampleCache } from '../expr/types.js';
import { createArcSession, deferThinks, firstStartable, pollArcSession, runArc, THINK_ABOUT_CAP, type ArcHandler, type LastChoice } from './run.js';
import { upsertLaw, type Law } from './laws.js';

function go(name:string, then?:Join):Step {
	return { verb: 'go_to', args: { name }, ...(then ? { then } : {}) };
}

function think(about?:string, then?:Join):Step {
	return { verb: 'think', args: about ? { about } : {}, ...(then ? { then } : {}) };
}

function wait(seconds = 1, then?:Join):Step {
	return { verb: 'wait', args: { seconds }, ...(then ? { then } : {}) };
}

function pickUp(item:string, then?:Join):Step {
	return { verb: 'pick_up', args: { item }, ...(then ? { then } : {}) };
}

/** Runs `arc` where each verb in `failing` fails, and says which verbs ran. */
async function ran(arc:Arc, failing:string[] = []):Promise<{ verbs:string[]; result:ArcResult }> {
	const verbs:string[] = [];
	const result = await runArc(arc, async (step) => {
		verbs.push(step.verb);
		return { ok: !failing.includes(step.verb), verb: step.verb, reason: failing.includes(step.verb) ? 'no' : undefined };
	});
	return { verbs, result };
}

describe('deferThinks', () => {
	it('leaves an arc without think unchanged', () => {
		const arc:Arc = [go('EastGate'), wait()];
		assert.equal(deferThinks(arc), arc);
	});

	it('moves think to the end even when the LLM put it first', () => {
		const ordered = deferThinks([think('the lock'), go('EastGate')]);
		assert.deepEqual(ordered.map((step) => step.verb), ['go_to', 'think']);
		assert.equal(ordered[0].then, 'always');
		assert.equal(ordered[1].args.about, 'the lock');
	});

	it('concatenates several abouts into one trailing think', () => {
		const ordered = deferThinks([think('the lock', 'always'), go('EastGate'), think('which key')]);
		const steps = arcSteps(ordered);
		assert.deepEqual(steps.map((s) => s.verb), ['go_to', 'think']);
		assert.equal(steps[1].args.about, 'the lock which key');
	});

	it('keeps a bare think when no about is set', () => {
		const ordered = deferThinks([wait(1), think()]);
		assert.equal(ordered[1].verb, 'think');
		assert.deepEqual(ordered[1].args, {});
	});

	it('caps concatenated abouts', () => {
		const a = 'a'.repeat(120);
		const b = 'b'.repeat(120);
		const ordered = deferThinks([think(a), think(b)]);
		const about = String(ordered[0].args.about ?? '');
		assert.equal(about.length, THINK_ABOUT_CAP);
		assert.equal(about.startsWith('a'), true);
	});

	it('copies only the step before the appended think, and keeps every other step', () => {
		const first = go('EastGate', 'if_failed');
		const second = wait(1);
		const arc:Arc = [first, think('x'), second];
		const ordered = deferThinks(arc);
		assert.equal(ordered[0], first, 'the step before a removed think keeps its own join');
		assert.notEqual(ordered[1], second, 'the step before the appended think is a copy that joins it');
		assert.equal(ordered[1].then, 'always');
		assert.equal(second.then, undefined, 'the original is not touched');
		assert.equal(arc.length, 3);
	});

	it('defers a think inside a later group too', () => {
		const inner:Arc = [think('inside'), go('Keep')];
		const group:Step = { verb: 'group', args: { arc: inner } };
		const arc:Arc = [wait(1), group];
		const ordered = deferThinks(arc);
		assert.notEqual(ordered, arc);
		assert.equal(ordered[0], arc[0]);
		const moved = ordered[1].args.arc as Arc;
		assert.deepEqual(moved.map((step) => step.verb), ['go_to', 'think']);
		assert.equal(group.args.arc, inner, 'the original group is not touched');
		const plain:Arc = [wait(1), { verb: 'group', args: { arc: [go('Keep')] } }];
		assert.equal(deferThinks(plain), plain);
	});
});

describe('runArc', () => {
	it('runs think last after the rest of the arc', async () => {
		const { verbs } = await ran([think('later'), go('EastGate'), pickUp('Key')]);
		assert.deepEqual(verbs, ['go_to', 'pick_up', 'think']);
	});

	it('still runs think when an earlier && fails', async () => {
		const { verbs, result } = await ran([think('anyway'), go('EastGate'), pickUp('Key')], ['go_to']);
		assert.deepEqual(verbs, ['go_to', 'think']);
		assert.equal(result.verb, 'think');
		assert.equal(result.ok, true);
	});

	it('skips think when the body is interrupted', async () => {
		const verbs:string[] = [];
		const result = await runArc([go('EastGate', 'always'), think('nope')], async (step) => {
			verbs.push(step.verb);
			return { ok: false, interrupted: true, verb: step.verb, reason: 'hurt' };
		});
		assert.deepEqual(verbs, ['go_to']);
		assert.equal(result.interrupted, true);
	});

	it('a missing then is if_ok, and the last step then is ignored', async () => {
		assert.deepEqual((await ran([go('A'), wait(), pickUp('Key')], ['go_to'])).verbs, ['go_to']);
		assert.deepEqual((await ran([go('A'), wait(), pickUp('Key', 'if_failed')])).verbs, ['go_to', 'wait', 'pick_up']);
	});

	it('a && b || c with a failing runs only a', async () => {
		const arc = parseArcText('go_to(A) && wait() || say(Hi)', registerStockVerbs(new VerbRegistry()));
		assert.deepEqual((await ran(arc, ['go_to'])).verbs, ['go_to'], 'a failed, so && ends the chain: c is a fallback for b, not for a');
		assert.deepEqual((await ran(arc, ['wait'])).verbs, ['go_to', 'wait', 'say'], 'b failed, so c runs');
	});

	it('a || b ; c with a succeeding runs only a', async () => {
		const arc = parseArcText('go_to(A) || wait() ; say(Hi)', registerStockVerbs(new VerbRegistry()));
		assert.deepEqual((await ran(arc)).verbs, ['go_to']);
		assert.deepEqual((await ran(arc, ['go_to'])).verbs, ['go_to', 'wait', 'say'], 'the fallback is everything after ||');
	});

	it('a || b && c with a failing runs b and c with fail set, then cleared', async () => {
		const verbs = registerStockVerbs(new VerbRegistry());
		const arc = parseArcText('go_to(A) || say(fail.reason) && wait()', verbs);
		const session = createArcSession({ verbs });
		const seen:string[] = [];
		const result = await runArc(arc, async (step) => {
			seen.push(`${step.verb}:${String(step.args.text ?? '')}`);
			return step.verb === 'go_to' ? { ok: false, verb: 'go_to', reason: 'locked' } : { ok: true, verb: step.verb };
		}, { session });
		assert.deepEqual(seen, ['go_to:', 'say:locked', 'wait:']);
		assert.equal(result.ok, true);
		assert.equal(session.fail, undefined);
	});

	it('nested || hands the latest reason on', async () => {
		const verbs = registerStockVerbs(new VerbRegistry());
		const arc = parseArcText('go_to(A) || (wait() || say(fail.reason))', verbs);
		const seen:string[] = [];
		await runArc(arc, async (step) => {
			seen.push(`${step.verb}:${String(step.args.text ?? '')}`);
			return step.verb === 'say' ? { ok: true, verb: 'say' } : { ok: false, verb: step.verb, reason: `${step.verb} failed` };
		}, { session: createArcSession({ verbs }) });
		assert.deepEqual(seen, ['go_to:', 'wait:', 'say:wait failed']);
	});

	it('(a ; b) && c and (a || b) && c', async () => {
		const verbs = registerStockVerbs(new VerbRegistry());
		const seq = parseArcText('(go_to(A) ; wait()) && say(Hi)', verbs);
		assert.deepEqual((await ran(seq, ['go_to'])).verbs, ['go_to', 'wait', 'say'], 'the group ran to its end and succeeded');
		assert.deepEqual((await ran(seq, ['wait'])).verbs, ['go_to', 'wait'], 'the group failed, so && stops');
		const either = parseArcText('(go_to(A) || wait()) && say(Hi)', verbs);
		assert.deepEqual((await ran(either, ['go_to'])).verbs, ['go_to', 'wait', 'say']);
		assert.deepEqual((await ran(either)).verbs, ['go_to', 'say']);
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

	it('loop through fills a character by id, and by name only in prose', async () => {
		const verbs = registerStockVerbs(new VerbRegistry());
		const catalog = buildCatalog({
			me: dummyEntity('Mira'),
			others: [dummyEntity('Nyx', { name: 'EnemyWitch' })],
			items: [],
			cache: new SampleCache(),
		});
		const args:unknown[] = [];
		const arc = parseArcText('loop(through=x in others, arc=(go_to(x) ; say(text=x)))', verbs);
		await runArc(arc, async (step) => {
			args.push(step.args.target ?? step.args.text);
			return { ok: true, verb: step.verb };
		}, { session: createArcSession({ catalog: () => catalog, verbs }) });
		assert.deepEqual(args, ['Nyx', 'EnemyWitch']);
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

describe('handlers by reference', () => {
	const verbs = registerStockVerbs(new VerbRegistry());
	const flagCatalog = (flags:Record<string, boolean>) => ():ReturnType<typeof buildCatalog> => buildCatalog({
		me: dummyEntity('Tom'),
		others: [],
		items: [],
		cache: new SampleCache(),
		bindings: Object.fromEntries(Object.entries(flags).map(([k, v]) => [k, { kind: 'bool' as const, value: v }])),
	});
	const handlerOf = (law:Law):ArcHandler => ({ source: law, watch: law.watch, arc: law.arc, rank: 0 });

	it('a law renamed while its arc runs still counts as running', async () => {
		const law:Law = { name: 'flee', who: 'me', watch: 'danger', arc: parseArcText('say("run")', verbs) };
		const session = createArcSession({
			catalog: flagCatalog({ danger: true }),
			extraHandlers: () => [handlerOf(law)],
		});
		const said:string[] = [];
		await runArc(law.arc, async (step) => {
			said.push(String(step.args.text));
			law.name = 'Tom.flee';
			pollArcSession(session);
			assert.equal(session.pending, undefined);
			assert.equal(firstStartable(session), undefined);
			return { ok: true, verb: step.verb };
		}, { session, asHandler: handlerOf(law) });
		assert.deepEqual(said, ['run']);
	});

	it('upsertLaw edits a law in place, so its handlers still match', () => {
		const first:Law = { name: 'flee', who: 'me', watch: 'danger', arc: parseArcText('say("run")', verbs) };
		const laws = upsertLaw([], first, 8);
		const next = upsertLaw(laws, { ...first, watch: 'fire' }, 8);
		assert.equal(next[0], first);
		assert.equal(first.watch, 'fire');
	});

	it('a when inside a loop does not re-trigger itself', async () => {
		const flags = { danger: true };
		const session = createArcSession({ catalog: () => flagCatalog(flags)() });
		const seen:string[] = [];
		const arc = parseArcText('loop(times=2, arc=(when(watch=danger, arc=say("hi")) ; wait()))', verbs);
		await runArc(arc, async (step) => {
			seen.push(step.verb);
			if (step.verb === 'say') {
				pollArcSession(session);
				assert.equal(session.pending, undefined);
				flags.danger = false;
			}
			return { ok: true, verb: step.verb };
		}, { session });
		assert.deepEqual(seen, ['say', 'wait', 'wait']);
	});

	it('keeps the same handler for a when step on every pass of a loop', async () => {
		const session = createArcSession({ catalog: flagCatalog({ danger: false }) });
		const when:Step = { verb: 'when', args: { watch: 'danger', arc: [{ verb: 'say', args: { text: 'hi' } }] } };
		const body:Arc = [when, { verb: 'wait', args: {} }];
		const sources:unknown[] = [];
		await runArc([{ verb: 'loop', args: { times: 2, arc: body } }], async (step) => {
			sources.push(...session.frames.flatMap((frame) => frame.handlers.map((handler) => handler.source)));
			return { ok: true, verb: step.verb };
		}, { session });
		assert.deepEqual(sources, [when, when]);
	});

	it('hoists a when out of the arc, and the step before it keeps its own join', async () => {
		const session = createArcSession({ catalog: flagCatalog({ danger: false }) });
		const when:Step = { verb: 'when', args: { watch: 'danger', arc: [{ verb: 'say', args: { text: 'hi' } }] } };
		const { verbs: failed } = await ran([go('A', 'if_failed'), when, wait()], ['go_to']);
		assert.deepEqual(failed, ['go_to', 'wait'], 'a failed, so its || runs what is left after the hoisted when');
		const seen:string[] = [];
		await runArc([go('A', 'if_failed'), when, wait()], async (step) => {
			seen.push(step.verb);
			return { ok: true, verb: step.verb };
		}, { session });
		assert.deepEqual(seen, ['go_to'], 'a succeeded, so its || skips the rest');
	});

	it('never mutates an arc, so one issued to two troops is safe to share', async () => {
		const freeze = <T>(value:T):T => {
			if (value && typeof value === 'object') {
				Object.values(value).forEach(freeze);
				Object.freeze(value);
			}
			return value;
		};
		const shared = freeze<Arc>([
			think('later', 'always'),
			go('A', 'if_failed'),
			{ verb: 'group', args: { arc: [think('inside'), wait(1), go('B', 'always')] } },
			pickUp('Key'),
		]);
		const both = await Promise.all([ran(shared, ['go_to']), ran(shared)]);
		assert.deepEqual(both[0].verbs, ['go_to', 'wait', 'go_to', 'think', 'pick_up', 'think'], 'a failed: the fallback runs the group (its own think last), pick_up, then the deferred think');
		assert.deepEqual(both[1].verbs, ['go_to', 'think']);
	});
});

describe('choose', () => {
	const verbs = registerStockVerbs(new VerbRegistry());
	let clock = 0;
	const ticking = ():number => {
		clock += 1;
		return clock;
	};

	it('runs the arc under the name the pick returns', async () => {
		const asked:{ goal:string; names:string[] }[] = [];
		const ran:string[] = [];
		const session = createArcSession({
			now: ticking,
			pick: async (goal, choices) => {
				asked.push({ goal, names: Object.keys(choices) });
				return 'chase';
			},
		});
		const result = await runArc(parseArcText('choose("hold", stand=wait(), chase=follow(Raider))', verbs), async (step) => {
			ran.push(step.verb);
			return { ok: true, verb: step.verb };
		}, { session });
		assert.deepEqual(asked, [{ goal: 'hold', names: ['stand', 'chase'] }]);
		assert.deepEqual(ran, ['follow']);
		assert.equal(result.ok, true);
	});

	it('fails on a name that is not among the choices', async () => {
		const ran:string[] = [];
		const session = createArcSession({ now: ticking, pick: async () => 'flee' });
		const result = await runArc(parseArcText('choose("hold", stand=wait())', verbs), async (step) => {
			ran.push(step.verb);
			return { ok: true, verb: step.verb };
		}, { session });
		assert.equal(result.ok, false);
		assert.match(result.reason ?? '', /unknown choice 'flee'/);
		assert.deepEqual(ran, []);
	});

	it('fails without a System One model', async () => {
		const result = await runArc(parseArcText('choose("hold", stand=wait())', verbs), async (step) => ({ ok: true, verb: step.verb }));
		assert.equal(result.ok, false);
		assert.match(result.reason ?? '', /no System One model/);
	});

	it('asks again on each loop pass and shows the last result', async () => {
		const lasts:(LastChoice | undefined)[] = [];
		const session = createArcSession({
			now: ticking,
			pick: async (_goal, _choices, last) => {
				lasts.push(last);
				return 'stand';
			},
		});
		await runArc(parseArcText('loop(times=2, arc=choose("hold", stand=wait()))', verbs), async (step) => ({ ok: true, verb: step.verb, reason: 'done' }), { session });
		assert.equal(lasts.length, 2);
		assert.equal(lasts[0], undefined);
		assert.deepEqual(lasts[1]?.name, 'stand');
		assert.equal(lasts[1]?.result.ok, true);
	});

	it('waits for the game clock before picking twice at one time', async () => {
		let now = 5;
		let picks = 0;
		const session = createArcSession({
			now: () => now,
			pick: async () => {
				picks += 1;
				return 'stand';
			},
		});
		const run = runArc(parseArcText('loop(times=2, arc=choose("hold", stand=wait()))', verbs), async (step) => ({ ok: true, verb: step.verb }), { session });
		await new Promise((resolve) => setTimeout(resolve, 20));
		assert.equal(picks, 1);
		now = 6;
		await run;
		assert.equal(picks, 2);
	});

	it('skips the chosen arc when the program was replaced during the pick', async () => {
		const ran:string[] = [];
		const session = createArcSession({
			now: ticking,
			pick: async () => {
				session.token += 1;
				session.pending = { kind: 'abort' };
				return 'stand';
			},
		});
		const result = await runArc(parseArcText('choose("hold", stand=wait())', verbs), async (step) => {
			ran.push(step.verb);
			return { ok: true, verb: step.verb };
		}, { session });
		assert.deepEqual(ran, []);
		assert.equal(result.ok, false);
	});
});
