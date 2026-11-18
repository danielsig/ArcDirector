import { showNamingText } from '../character/text-with-ids.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Arc, type ArcResult, type Join, type Step } from './arc-types.js';
import { parseArcText } from './arc-parse.js';
import { arcJSONText, parseArc } from './wire.js';
import { formatArc } from './arc-format.js';
import { VerbRegistry, STOCK_VERB_DEFS } from './stock-verbs.js';
import { dummyEntity, buildCatalog } from '../expr/natives.js';
import { SampleCache } from '../expr/expr-types.js';
import { createArcSession, firstStartable, handlerFinished, interruptArc, pollArcSession, reactionArm, type ArcHandler, type LastChoice } from './run.js';
import { DEFAULT_EXPLICIT_THINK_ALLOWED_INSIDE, misplacedThink, placesHelp } from './validate.js';
import { drive, restoreArc, runArc, startArc, type ArcMachine, type ArcMachineJSON } from './arc-machine.js';
import { lawFinished, lawFromSpec, lawHandler, upsertLaw, type Law } from './laws.js';

function go(name:string, then?:Join):Step {
	return { verb: 'go_to', args: { name }, ...(then ? { then } : {}) };
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
		return { status: failing.includes(step.verb) ? 'failed' : 'ok', verb: step.verb, reason: failing.includes(step.verb) ? 'no' : undefined };
	});
	return { verbs, result };
}

describe('misplacedThink', () => {
	const verbs = new VerbRegistry().addStock();
	const where = (text:string, inside = DEFAULT_EXPLICIT_THINK_ALLOWED_INSIDE):string | undefined => misplacedThink(parseArcText(text, verbs), inside)?.message;

	it('turns down a think at the root, in a plain chain, a group, a loop or a when', () => {
		for (const text of ['think("x")', 'go_to(Gate) ; think("x")', '(go_to(Gate) && think("x"))', 'loop(think("x"))', 'when(some(others)) { think("x") }', 'if (some(others)) { (think("x")) }']) {
			assert.equal(where(text), 'think() only inside if/else or a choose choice: if (…) { think("…") }', text);
		}
	});

	it('lets a think stand directly in an if, an else or a choice', () => {
		for (const text of ['if (some(others)) { think("x") }', 'if (pick_up(Key)) { go_to(Door) } else { think("x") }', 'loop(choose("g", a=think("x"), b=wait(), c=wander()))']) {
			assert.equal(where(text), undefined, text);
		}
	});

	it("lets a think stand in a host verb's arc once explicitThinkAllowedInside lists it", () => {
		const own = new VerbRegistry().addStock().add('maybe', { args: { chance: 'number', arc: 'arc' } });
		const arc = parseArcText('maybe(0.5) { think("x") }', own);
		assert.ok(misplacedThink(arc, DEFAULT_EXPLICIT_THINK_ALLOWED_INSIDE));
		assert.equal(misplacedThink(arc, [...DEFAULT_EXPLICIT_THINK_ALLOWED_INSIDE, 'maybe.arc']), undefined);
		assert.equal(placesHelp([...DEFAULT_EXPLICIT_THINK_ALLOWED_INSIDE, 'maybe.arc']), 'only inside if/else, a choose choice or maybe');
	});
});

describe('runArc', () => {
	it('a missing then is if_ok, and the last step then is ignored', async () => {
		assert.deepEqual((await ran([go('A'), wait(), pickUp('Key')], ['go_to'])).verbs, ['go_to']);
		assert.deepEqual((await ran([go('A'), wait(), pickUp('Key', 'if_failed')])).verbs, ['go_to', 'wait', 'pick_up']);
	});

	it('a && b || c runs c when a or b fails, as (a && b) || c', async () => {
		const arc = parseArcText('go_to(A) && wait() || say(Hi)', new VerbRegistry().addAll(STOCK_VERB_DEFS));
		assert.deepEqual((await ran(arc, ['go_to'])).verbs, ['go_to', 'say'], 'a failed, so b is skipped and c runs');
		assert.deepEqual((await ran(arc, ['wait'])).verbs, ['go_to', 'wait', 'say'], 'b failed, so c runs');
		assert.deepEqual((await ran(arc)).verbs, ['go_to', 'wait']);
	});

	it('a || b ; c runs c either way, as (a || b) ; c', async () => {
		const arc = parseArcText('go_to(A) || wait() ; say(Hi)', new VerbRegistry().addAll(STOCK_VERB_DEFS));
		assert.deepEqual((await ran(arc)).verbs, ['go_to', 'say'], 'a worked, so b is skipped and c runs');
		assert.deepEqual((await ran(arc, ['go_to'])).verbs, ['go_to', 'wait', 'say']);
	});

	it('a || b && c with a succeeding skips b and c, as a || (b && c)', async () => {
		const arc = parseArcText('go_to(A) || wait() && say(Hi) ; pick_up(Key)', new VerbRegistry().addAll(STOCK_VERB_DEFS));
		assert.deepEqual((await ran(arc)).verbs, ['go_to', 'pick_up']);
		assert.deepEqual((await ran(arc, ['go_to', 'wait'])).verbs, ['go_to', 'wait', 'pick_up']);
	});

	it('ends with the result of the last step it ran', async () => {
		const arc = parseArcText('go_to(A) && wait() || say(Hi)', new VerbRegistry().addAll(STOCK_VERB_DEFS));
		const { result } = await ran(arc, ['go_to', 'say']);
		assert.equal(result.status === 'ok', false);
		assert.equal(result.verb, 'say');
	});

	it('keeps fail through ; to the end of the chain', async () => {
		const verbs = new VerbRegistry().addAll(STOCK_VERB_DEFS);
		const arc = parseArcText('go_to(A) || wait() ; say(fail.reason)', verbs);
		const seen:string[] = [];
		await runArc(arc, async (step) => {
			seen.push(`${step.verb}:${String(step.args.text ?? '')}`);
			return step.verb === 'go_to' ? { status: 'failed', verb: 'go_to', reason: 'locked' } : { status: 'ok', verb: step.verb };
		}, { session: createArcSession({ verbs }) });
		assert.deepEqual(seen, ['go_to:', 'wait:', 'say:locked']);
	});

	it('a || b && c with a failing runs b and c with fail set, then cleared', async () => {
		const verbs = new VerbRegistry().addAll(STOCK_VERB_DEFS);
		const arc = parseArcText('go_to(A) || say(fail.reason) && wait()', verbs);
		const session = createArcSession({ verbs });
		const seen:string[] = [];
		const result = await runArc(arc, async (step) => {
			seen.push(`${step.verb}:${String(step.args.text ?? '')}`);
			return step.verb === 'go_to' ? { status: 'failed', verb: 'go_to', reason: 'locked' } : { status: 'ok', verb: step.verb };
		}, { session });
		assert.deepEqual(seen, ['go_to:', 'say:locked', 'wait:']);
		assert.equal(result.status === 'ok', true);
		assert.equal(session.fail, undefined);
	});

	it('nested || hands the latest reason on', async () => {
		const verbs = new VerbRegistry().addAll(STOCK_VERB_DEFS);
		const arc = parseArcText('go_to(A) || (wait() || say(fail.reason))', verbs);
		const seen:string[] = [];
		await runArc(arc, async (step) => {
			seen.push(`${step.verb}:${String(step.args.text ?? '')}`);
			return step.verb === 'say' ? { status: 'ok', verb: 'say' } : { status: 'failed', verb: step.verb, reason: `${step.verb} failed` };
		}, { session: createArcSession({ verbs }) });
		assert.deepEqual(seen, ['go_to:', 'wait:', 'say:wait failed']);
	});

	it('(a ; b) && c and (a || b) && c', async () => {
		const verbs = new VerbRegistry().addAll(STOCK_VERB_DEFS);
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
		const arc = parseArcText('(go_to(Keep) && wait(seconds=1)) || say(fail.reason)', new VerbRegistry().addAll(STOCK_VERB_DEFS));
		const result = await runArc(arc, async (step) => {
			seen.push(`${step.verb}:${String(step.args.text ?? step.args.target ?? '')}`);
			if (step.verb === 'go_to') {
				return { status: 'failed', verb: 'go_to', reason: 'locked' };
			}
			return { status: 'ok', verb: step.verb };
		});
		assert.equal(result.status === 'ok', true);
		assert.deepEqual(seen, ['go_to:Keep', 'say:locked']);
	});

	it('loop times and until-fail', async () => {
		const n:string[] = [];
		const arc = parseArcText('loop(times=3, arc=go_to(Keep))', new VerbRegistry().addAll(STOCK_VERB_DEFS));
		await runArc(arc, async (step) => {
			n.push(step.verb);
			return { status: 'ok', verb: step.verb };
		});
		assert.deepEqual(n, ['go_to', 'go_to', 'go_to']);
		const failAt:string[] = [];
		await runArc(parseArcText('loop(arc=go_to(Keep))', new VerbRegistry().addAll(STOCK_VERB_DEFS)), async (step) => {
			failAt.push(step.verb);
			return { status: failAt.length < 2 ? 'ok' : 'failed', verb: step.verb };
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
		const arc = parseArcText('loop(through=x in others, arc=follow(x))', new VerbRegistry().addAll(STOCK_VERB_DEFS));
		await runArc(arc, async (step) => {
			names.push(String(step.args.target ?? ''));
			return { status: 'ok', verb: step.verb };
		}, { session });
		assert.deepEqual(names, ['Able', 'Baker']);
	});

	it('loop through fills a character by id, and by name only in prose', async () => {
		const verbs = new VerbRegistry().addAll(STOCK_VERB_DEFS);
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
			return { status: 'ok', verb: step.verb };
		}, { session: createArcSession({ catalog: () => catalog, verbs }) });
		assert.deepEqual(args, ['Nyx', 'EnemyWitch']);
	});

	it('runs a reaction on though its watch turns false, then goes on with the program', async () => {
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
				assert.equal(session.pending, undefined, 'it is not stopped');
			}
			return { status: 'ok', verb: step.verb };
		};
		const arc = parseArcText(
			'when(watch=hasHeard, arc=go_to(Keep)) ; wander()',
			new VerbRegistry().addAll(STOCK_VERB_DEFS),
		);
		const result = await runArc(arc, execute, { session });
		assert.equal(result.status === 'ok', true);
		assert.ok(verbs.includes('go_to'));
		assert.ok(verbs.includes('wander'));
	});

	it('a loop goes on through failures that say going round again may help, but not forever', async () => {
		let now = 0;
		const verbs = new VerbRegistry().addAll(STOCK_VERB_DEFS);
		const stage = async (results:ArcResult[]):Promise<{ result:ArcResult; tries:number }> => {
			const session = createArcSession({ verbs, now: () => now, nextTime: async () => {
				now += 0.5;
			} });
			let tries = 0;
			const result = await runArc(parseArcText('loop(arc=go_to(Keep), times=9)', verbs), async () => results[tries++] ?? { status: 'ok', verb: 'go_to' }, { session });
			return { result, tries };
		};
		const miss:ArcResult = { status: 'failed', verb: 'go_to', reason: 'too far', retry: true };
		const through = await stage([miss, miss, { status: 'ok', verb: 'go_to' }]);
		assert.equal(through.result.status === 'ok', true);
		assert.equal(through.tries, 9, 'it carries on');
		const gaveUp = await stage(Array.from({ length: 20 }, () => miss));
		assert.equal(gaveUp.result.reason, 'too far');
		assert.equal(gaveUp.tries, 6, 'not forever');
		const final = await stage([{ status: 'failed', verb: 'go_to', reason: 'no such thing' }]);
		assert.equal(final.tries, 1, 'any other failure ends it, as ever');
	});

	it('starts a reaction when its watch becomes true, and again only once it has been false for its rearm', async () => {
		let danger = true;
		let now = 0;
		const verbs = new VerbRegistry().addAll(STOCK_VERB_DEFS);
		const catalog = ():ReturnType<typeof buildCatalog> => buildCatalog({ me: dummyEntity('Mira'), others: [], items: [], cache: new SampleCache(), hasHeard: danger });
		const session = createArcSession({ catalog, now: () => now, verbs });
		const handler = (arc:string, rearm?:number):ArcHandler => ({ source: {} as Step, watch: 'hasHeard', arc: parseArcText(arc, verbs), rank: 0, rearm, arm: {} });
		const ran = async (h:ArcHandler, ok:boolean):Promise<void> => {
			await runArc(h.arc, async (step) => ({ status: ok ? 'ok' : 'failed', verb: step.verb }), { session, asHandler: h });
		};
		const at = (h:ArcHandler, time:number, heard:boolean):ArcHandler | undefined => {
			now = time;
			danger = heard;
			session.extraHandlers = () => [h];
			return firstStartable(session);
		};

		const blow = handler('go_to(Keep)');
		assert.equal(at(blow, 0, true), blow, 'a new reaction is armed');
		await ran(blow, true);
		assert.equal(at(blow, 1, true), undefined, 'a watch that stays true starts it once');
		assert.equal(at(blow, 2, false), undefined);
		assert.equal(at(blow, 2.5, true), undefined, 'false for less than its rearm: still spent');
		assert.equal(at(blow, 3, false), undefined);
		assert.equal(at(blow, 4, false), undefined, 'false for its rearm: armed again');
		assert.equal(at(blow, 4, true), blow);
		await ran(blow, false);
		assert.equal(at(blow, 9, true), undefined, 'one that failed does not try again while its watch holds');

		const quick = handler('say("Curtain!")', 0);
		assert.equal(at(quick, 10, true), quick);
		await ran(quick, true);
		assert.equal(at(quick, 10, false), undefined);
		assert.equal(at(quick, 10, true), quick, 'rearm=0: false once is enough');
	});

	it('runs a reaction through its watch turning false, and stops it once its own until holds', async () => {
		let heard = true;
		let struck = false;
		const catalog = ():ReturnType<typeof buildCatalog> => buildCatalog({
			me: dummyEntity('Mira'),
			others: [],
			items: [],
			cache: new SampleCache(),
			hasHeard: heard,
			bindings: { struck: { kind: 'bool', value: struck } },
		});
		const session = createArcSession({ catalog, now: () => 1 });
		const law:ArcHandler = { source: { verb: 'law', args: {} }, watch: 'hasHeard', until: 'struck', arc: [], rank: 0, progress: { runs: 0 }, arm: {} };
		session.extraHandlers = () => [law];
		const pending:(string | undefined)[] = [];
		await runArc(parseArcText('wander()', new VerbRegistry().addAll(STOCK_VERB_DEFS)), async (step) => {
			heard = false;
			pollArcSession(session);
			pending.push(session.pending?.kind);
			struck = true;
			pollArcSession(session);
			pending.push(session.pending?.kind);
			return { status: 'ok', verb: step.verb };
		}, { session, asHandler: law });
		assert.deepEqual(pending, [undefined, 'abort']);
		assert.equal(handlerFinished(law), true, 'finished for good');
	});

	it('runs a step a reaction cut short again once the reaction is done, and only then the next', async () => {
		let danger = false;
		const catalog = ():ReturnType<typeof buildCatalog> => buildCatalog({
			me: dummyEntity('Mira'),
			others: [],
			items: [],
			cache: new SampleCache(),
			bindings: { danger: { kind: 'bool', value: danger } },
		});
		const session = createArcSession({ catalog, now: () => 0 });
		const seen:string[] = [];
		const arc = parseArcText('when(watch=danger, arc=go_to(Hut)) ; pick_up(Morel1) && pick_up(Morel2)', new VerbRegistry().addAll(STOCK_VERB_DEFS));
		const result = await runArc(arc, async (step) => {
			seen.push(String(step.args.item ?? step.args.target));
			if (seen.length === 1) {
				// The Bear comes while the first Morel is being picked.
				danger = true;
				pollArcSession(session);
				return { status: 'stopped', verb: step.verb };
			}
			if (step.verb === 'go_to') {
				danger = false;
			}
			return { status: 'ok', verb: step.verb };
		}, { session });
		assert.equal(result.status === 'ok', true);
		assert.deepEqual(seen, ['Morel1', 'Hut', 'Morel1', 'Morel2']);
	});

	it('does not run a step again when its program was replaced instead', async () => {
		const session = createArcSession({ now: () => 0 });
		const seen:string[] = [];
		const result = await runArc(parseArcText('pick_up(Morel1) && pick_up(Morel2)', new VerbRegistry().addAll(STOCK_VERB_DEFS)), async (step) => {
			seen.push(String(step.args.item));
			session.pending = { kind: 'abort' };
			session.token += 1;
			return { status: 'stopped', verb: step.verb };
		}, { session });
		assert.equal(result.status === 'ok', false);
		assert.deepEqual(seen, ['Morel1']);
	});

	it('a when outranks a later one, which starts once the first is done and the moment has passed', async () => {
		const seen:string[] = [];
		let now = 0;
		const catalog = ():ReturnType<typeof buildCatalog> => buildCatalog({ me: dummyEntity('Mira'), others: [], items: [], cache: new SampleCache(), hasHeard: true });
		const session = createArcSession({ catalog, now: () => now });
		const execute = async (step:Step):Promise<ArcResult> => {
			seen.push(`${step.verb}:${String(step.args.text ?? '')}`);
			if (step.args.text === 'A') {
				pollArcSession(session);
				assert.equal(session.pending, undefined, 'the later one waits: it is of lower rank');
				now = 1;
			}
			return { status: 'ok', verb: step.verb };
		};
		const arc = parseArcText('when(hasHeard) { say("A") } ; when(hasHeard) { say("B") } ; wait()', new VerbRegistry().addAll(STOCK_VERB_DEFS));
		const result = await runArc(arc, execute, { session });
		assert.equal(result.status === 'ok', true);
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
			new VerbRegistry().addAll(STOCK_VERB_DEFS),
		);
		const result = await runArc(arc, async (step) => {
			verbs.push(step.verb);
			return { status: 'ok', verb: step.verb };
		}, { session });
		assert.equal(result.status === 'ok', true);
		assert.equal(session.parked, true);
		assert.ok((session.frames[0]?.handlers.length ?? 0) > 0);
		assert.deepEqual(verbs, ['wait']);
	});

	it('does not park a finished body with no when', async () => {
		const session = createArcSession();
		const arc = parseArcText('wait()', new VerbRegistry().addAll(STOCK_VERB_DEFS));
		const result = await runArc(arc, async (step) => ({ status: 'ok', verb: step.verb }), { session });
		assert.equal(result.status === 'ok', true);
		assert.equal(session.parked, false);
	});
});

describe('handlers by reference', () => {
	const verbs = new VerbRegistry().addAll(STOCK_VERB_DEFS);
	const flagCatalog = (flags:Record<string, boolean>) => ():ReturnType<typeof buildCatalog> => buildCatalog({
		me: dummyEntity('Tom'),
		others: [],
		items: [],
		cache: new SampleCache(),
		bindings: Object.fromEntries(Object.entries(flags).map(([k, v]) => [k, { kind: 'bool' as const, value: v }])),
	});
	const handlerOf = (law:Law):ArcHandler => ({ source: law, watch: law.watch, arc: law.arc, rank: 0, arm: reactionArm(law) });

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
			return { status: 'ok', verb: step.verb };
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
			return { status: 'ok', verb: step.verb };
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
			return { status: 'ok', verb: step.verb };
		}, { session });
		assert.deepEqual(sources, [when, when]);
	});

	it('a when with times fires that many times over all the passes of a loop, and its program goes on', async () => {
		for (const [times, seen] of [[1, ['say', 'wait', 'wait', 'wait']], [2, ['say', 'wait', 'wait', 'say', 'wait']]] as const) {
			const flags = { danger: true };
			let now = 0;
			const session = createArcSession({ catalog: () => flagCatalog(flags)(), now: () => now, rearm: 0 });
			const ran:string[] = [];
			await runArc(parseArcText(`loop(times=3, arc=(when(watch=danger, arc=say("hi"), times=${times}) ; wait()))`, verbs), async (step) => {
				ran.push(step.verb);
				if (step.verb === 'wait') {
					flags.danger = !flags.danger;
					now += 1;
				}
				return { status: 'ok', verb: step.verb };
			}, { session });
			assert.deepEqual(ran, seen);
		}
	});

	it('a when stays finished once its until has held, even if it stops holding', async () => {
		const flags = { danger: false, over: false };
		const session = createArcSession({ catalog: () => flagCatalog(flags)() });
		const seen:string[] = [];
		await runArc(parseArcText('loop(times=3, arc=(when(watch=danger, arc=say("hi"), until=over) ; wait()))', verbs), async (step) => {
			seen.push(step.verb);
			flags.over = true;
			pollArcSession(session);
			flags.over = false;
			flags.danger = true;
			return { status: 'ok', verb: step.verb };
		}, { session });
		assert.deepEqual(seen, ['wait', 'wait', 'wait']);
	});

	it('an until coming true stops the run under way', async () => {
		const flags = { danger: true, over: false };
		const session = createArcSession({ catalog: () => flagCatalog(flags)() });
		const seen:string[] = [];
		await runArc(parseArcText('when(watch=danger, arc=say("hi") ; say("bye"), until=over) ; wait()', verbs), async (step) => {
			seen.push(step.verb === 'say' ? String(step.args.text) : step.verb);
			flags.over = true;
			return { status: 'ok', verb: step.verb };
		}, { session });
		assert.deepEqual(seen, ['hi', 'wait']);
	});

	it('a law with times=1 counts once started, however that run ends', async () => {
		const law = lawFromSpec({ name: 'cheer', watch: 'danger', arc: 'say("hi")', times: 1 }, verbs, 'x', 'me')!;
		const session = createArcSession({
			catalog: flagCatalog({ danger: true }),
			extraHandlers: () => [lawHandler(law, 0, 'Tom')],
		});
		await runArc(law.arc, async (step) => ({ status: 'stopped', verb: step.verb }), { session, asHandler: lawHandler(law, 0, 'Tom') });
		assert.deepEqual(law.progress, { Tom: { runs: 1 } });
		assert.equal(firstStartable(session), undefined);
		assert.ok(lawFinished(law, () => ['Tom']));
	});

	it('lawFinished waits for all it reaches, and for someone to have finished', () => {
		const law = lawFromSpec({ name: 'cheer', watch: 'danger', arc: 'say("hi")', times: 1 }, verbs, 'x', 'units')!;
		assert.ok(!lawFinished(law, () => []), 'reaching no one yet is not finished');
		law.progress = { Mira: { runs: 1 }, Tom: { runs: 0 } };
		assert.ok(!lawFinished(law, () => ['Mira', 'Tom']));
		assert.ok(lawFinished(law, () => ['Mira']));
	});

	it('upsertLaw keeps a law\'s count when it is written the same, and starts over when its exit changes', () => {
		const spec = { name: 'cheer', watch: 'danger', arc: 'say("hi")', times: 1 };
		const first = lawFromSpec(spec, verbs, 'x', 'me')!;
		first.progress = { Tom: { runs: 1 } };
		upsertLaw([first], lawFromSpec(spec, verbs, 'x', 'me')!, 8);
		assert.deepEqual(first.progress, { Tom: { runs: 1 } });
		upsertLaw([first], lawFromSpec({ ...spec, times: undefined }, verbs, 'x', 'me')!, 8);
		assert.equal(first.times, undefined);
		assert.equal(first.progress, undefined);
	});

	it('hoists a when out of the arc, and the step before it keeps its own join', async () => {
		const session = createArcSession({ catalog: flagCatalog({ danger: false }) });
		const when:Step = { verb: 'when', args: { watch: 'danger', arc: [{ verb: 'say', args: { text: 'hi' } }] } };
		const { verbs: failed } = await ran([go('A', 'if_failed'), when, wait()], ['go_to']);
		assert.deepEqual(failed, ['go_to', 'wait'], 'a failed, so its || runs what is left after the hoisted when');
		const seen:string[] = [];
		await runArc([go('A', 'if_failed'), when, wait()], async (step) => {
			seen.push(step.verb);
			return { status: 'ok', verb: step.verb };
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
			go('A', 'if_failed'),
			{ verb: 'group', args: { arc: [wait(1), go('B', 'always')] } },
			pickUp('Key'),
		]);
		const both = await Promise.all([ran(shared, ['go_to']), ran(shared)]);
		assert.deepEqual(both[0].verbs, ['go_to', 'wait', 'go_to'], 'a failed: the fallback runs the group, whose failed go_to skips pick_up');
		assert.deepEqual(both[1].verbs, ['go_to']);
	});
});

describe('choose', () => {
	const verbs = new VerbRegistry().addAll(STOCK_VERB_DEFS);
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
			return { status: 'ok', verb: step.verb };
		}, { session });
		assert.deepEqual(asked, [{ goal: 'hold', names: ['stand', 'chase'] }]);
		assert.deepEqual(ran, ['follow']);
		assert.equal(result.status === 'ok', true);
	});

	it('offers a half-second wait beside a lone choice', async () => {
		const asked:string[][] = [];
		const ran:Step[] = [];
		const session = createArcSession({
			now: ticking,
			pick: async (goal, choices) => {
				asked.push(Object.keys(choices));
				return 'wait';
			},
		});
		const result = await runArc(parseArcText('choose("hold", stand=go_to(Keep))', verbs), async (step) => {
			ran.push(step);
			return { status: 'ok', verb: step.verb };
		}, { session });
		assert.deepEqual(asked, [['stand', 'wait']]);
		assert.deepEqual(ran, [{ verb: 'wait', args: { seconds: 0.5 }, granted: true }]);
		assert.equal(result.status === 'ok', true);
	});

	it('fails on a name that is not among the choices', async () => {
		const ran:string[] = [];
		const session = createArcSession({ now: ticking, pick: async () => 'flee' });
		const result = await runArc(parseArcText('choose("hold", stand=wait())', verbs), async (step) => {
			ran.push(step.verb);
			return { status: 'ok', verb: step.verb };
		}, { session });
		assert.equal(result.status === 'ok', false);
		assert.match(showNamingText(result.reason ?? ''), /unknown choice 'flee'/);
		assert.deepEqual(ran, []);
	});

	it('fails without a System One model', async () => {
		const result = await runArc(parseArcText('choose("hold", stand=wait())', verbs), async (step) => ({ status: 'ok', verb: step.verb }));
		assert.equal(result.status === 'ok', false);
		assert.match(showNamingText(result.reason ?? ''), /no System One model/);
	});

	it('asks again on each loop pass and shows the last result', async () => {
		const lasts:(LastChoice | undefined)[] = [];
		const session = createArcSession({
			now: ticking,
			pick: async (goal, choices, last) => {
				lasts.push(last);
				return 'stand';
			},
		});
		await runArc(parseArcText('loop(times=2, arc=choose("hold", stand=wait()))', verbs), async (step) => ({ status: 'ok', verb: step.verb, reason: 'done' }), { session });
		assert.equal(lasts.length, 2);
		assert.equal(lasts[0], undefined);
		assert.deepEqual(lasts[1]?.name, 'stand');
		assert.equal(lasts[1]?.result.status === 'ok', true);
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
		const run = runArc(parseArcText('loop(times=2, arc=choose("hold", stand=wait()))', verbs), async (step) => ({ status: 'ok', verb: step.verb }), { session });
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
			return { status: 'ok', verb: step.verb };
		}, { session });
		assert.deepEqual(ran, []);
		assert.equal(result.status === 'ok', false);
	});
});

describe('if, let and queries as steps', () => {
	const stock = ():VerbRegistry => new VerbRegistry().addAll(STOCK_VERB_DEFS);
	const world = ():ReturnType<typeof buildCatalog> => buildCatalog({ me: dummyEntity('Mira'), others: [dummyEntity('Wolf')], items: [], cache: new SampleCache() });

	it('runs the branch its condition picks, a verb\'s result or a watch', async () => {
		const verbs = stock();
		const arc = parseArcText('if (pick_up(Key)) { go_to(Door) } else { say(fail.reason) } ; wait()', verbs);
		const run = async (failing:string[]):Promise<string[]> => {
			const seen:string[] = [];
			await runArc(arc, async (step) => {
				seen.push(`${step.verb}:${String(step.args.text ?? '')}`);
				return failing.includes(step.verb) ? { status: 'failed', verb: step.verb, reason: 'no key here' } : { status: 'ok', verb: step.verb };
			}, { session: createArcSession({ verbs }) });
			return seen;
		};
		assert.deepEqual(await run([]), ['pick_up:', 'go_to:', 'wait:']);
		assert.deepEqual(await run(['pick_up']), ['pick_up:', 'say:no key here', 'wait:'], 'else reads why the condition failed');
		const watched = parseArcText('if (some(others)) { go_to(Wolf) } else { wander() }', verbs);
		assert.deepEqual((await runIn(watched, world)).verbs, ['go_to']);
	});

	it('without an else, a condition that fails ends the if as done', async () => {
		const arc = parseArcText('if (pick_up(Key)) { go_to(Door) } && wait()', stock());
		const { verbs, result } = await ran(arc, ['pick_up']);
		assert.deepEqual(verbs, ['pick_up', 'wait']);
		assert.equal(result.status === 'ok', true);
	});

	it('a query step works while its watch holds', async () => {
		const arc = parseArcText('!some(others) && wander() || go_to(Wolf)', stock());
		assert.deepEqual((await runIn(arc, world)).verbs, ['go_to']);
	});

	it('let names a step\'s result, or a query\'s value, until its arc ends', async () => {
		const verbs = stock();
		const session = createArcSession({ verbs, catalog: world });
		const seen:string[] = [];
		const arc = parseArcText('let got = pick_up(Key) ; let foe = others.first() ; if (!got) { go_to(foe) }', verbs);
		await runArc(arc, async (step) => {
			seen.push(`${step.verb}:${String(step.args.target ?? '')}`);
			return { status: step.verb !== 'pick_up' ? 'ok' : 'failed', verb: step.verb };
		}, { session });
		assert.deepEqual(seen, ['pick_up:', 'go_to:Wolf'], 'a name of a thing reaches a step as its id');
		assert.equal(session.bindings.size, 0, 'the names are gone with their arc');
	});
});

/** Runs `arc` against `catalog`, every verb working. */
async function runIn(arc:Arc, catalog:()=>ReturnType<typeof buildCatalog>):Promise<{ verbs:string[] }> {
	const verbs:string[] = [];
	await runArc(arc, async (step) => {
		verbs.push(step.verb);
		return { status: 'ok', verb: step.verb };
	}, { session: createArcSession({ verbs: new VerbRegistry().addAll(STOCK_VERB_DEFS), catalog }) });
	return { verbs };
}

describe('until and within on any step', () => {
	const verbs = new VerbRegistry().addAll(STOCK_VERB_DEFS);
	/** A clock that moves a second on each wait for it, and a world where `hasHeard` is `heard()`. */
	const stage = (heard:()=>boolean):{ session:ReturnType<typeof createArcSession>; now:()=>number } => {
		let now = 0;
		const session = createArcSession({
			verbs,
			now: () => now,
			nextTime: async () => {
				now += 1;
			},
			catalog: () => buildCatalog({ me: dummyEntity('Mira'), others: [], items: [], cache: new SampleCache(), hasHeard: heard() }),
		});
		return { session, now: () => now };
	};
	/** A host step that runs until its signal aborts, then ends as the host's moves do: interrupted. */
	const endless = (step:Step, signal?:AbortSignal):Promise<ArcResult> => new Promise((done) => {
		signal?.addEventListener('abort', () => done({ status: 'stopped', verb: step.verb }), { once: true });
	});

	it('stops a step once its until holds, as done, through the signal its host was handed', async () => {
		const { session, now } = stage(() => now() >= 3);
		const stops:unknown[] = [];
		const result = await runArc(parseArcText('go_to(Keep, until=hasHeard) && say("there")', verbs), (step, signal) => {
			signal?.addEventListener('abort', () => stops.push([now(), signal.reason]), { once: true });
			return step.verb === 'say' ? Promise.resolve({ status: 'ok', verb: 'say' }) : endless(step, signal);
		}, { session });
		assert.deepEqual([result.status === 'ok', result.verb], [true, 'say']);
		assert.deepEqual(stops, [[3, 'until']]);
	});

	it('fails a step its within runs out on, and says why', async () => {
		const { session } = stage(() => false);
		const timed = await runArc(parseArcText('go_to(Keep, within=2s)', verbs), endless, { session });
		assert.deepEqual([timed.status === 'ok', timed.reason], [false, 'not done after 2s']);
		const watched = await runArc(parseArcText('follow(Tom, until=hasHeard, within=2s)', verbs), endless, { session: stage(() => false).session });
		assert.deepEqual([watched.status === 'ok', watched.reason], [false, 'until not met after 2s']);
	});

	it('keeps a verb\'s own word on how it went when it can still say', async () => {
		const { session } = stage(() => true);
		let seen:unknown;
		const result = await runArc(parseArcText('wander(until=hasHeard)', verbs), async (step, signal) => {
			seen = signal?.aborted;
			return { status: 'ok', verb: 'wander', reason: 'until' };
		}, { session });
		assert.equal(result.status === 'ok', true);
		assert.equal(seen, undefined, 'an until that holds from the start runs nothing');
		const late = stage(() => late.now() >= 2);
		const said = await runArc(parseArcText('wander(until=hasHeard)', verbs), (step, signal) => new Promise((done) => {
			signal?.addEventListener('abort', () => done({ status: 'ok', verb: 'wander', reason: `until — saw Lantern (${String(signal.reason)})` }), { once: true });
		}), { session: late.session });
		assert.equal(said.reason, 'until — saw Lantern (until)');
	});

	it('stops a loop part way round once its until holds, and goes on after it', async () => {
		const { session, now } = stage(() => now() >= 3);
		const ran:string[] = [];
		const result = await runArc(parseArcText('loop(until=hasHeard) { go_to(Keep) ; say("round") } ; say("after")', verbs), async (step, signal) => {
			ran.push(`${step.verb}${step.args.text ? ` ${String(step.args.text)}` : ''}`);
			return step.verb === 'go_to' ? endless(step, signal).then(() => ({ status: 'stopped', verb: 'go_to' })) : { status: 'ok', verb: 'say' };
		}, { session });
		assert.equal(result.status === 'ok', true);
		assert.deepEqual(ran, ['go_to', 'say after'], 'the round it was on stops where it was');
		assert.equal(now(), 3);
	});
});

describe('unbreakable', () => {
	const verbs = new VerbRegistry().addAll(STOCK_VERB_DEFS);
	/**
	 * Runs `arc` as the reaction to `danger`, gone from second 2, on a clock that moves a second each time it is waited
	 * on. `follow` runs until it is stopped; each says the second it stopped at.
	 */
	const react = async (arc:string, reaction = true):Promise<{ seen:string[]; result:ArcResult }> => {
		let now = 0;
		const catalog = ():ReturnType<typeof buildCatalog> => buildCatalog({
			me: dummyEntity('Mira'),
			others: [],
			items: [],
			cache: new SampleCache(),
			bindings: { danger: { kind: 'bool', value: now < 2 } },
		});
		const session = createArcSession({ catalog, verbs, now: () => now, nextTime: async () => {
			now += 1;
		} });
		const handler:ArcHandler = { source: {} as Step, watch: 'danger', arc: parseArcText(arc, verbs), rank: 0, arm: {} };
		const seen:string[] = [];
		const result = await runArc(handler.arc, (step, signal) => (step.verb !== 'follow' ? Promise.resolve({ status: 'ok', verb: step.verb }) : new Promise((done) => {
			signal?.addEventListener('abort', () => {
				seen.push(`follow ${now}`);
				done({ status: 'stopped', verb: 'follow' });
			}, { once: true });
		})), { session, asHandler: reaction ? handler : undefined });
		return { seen, result };
	};

	it('holds an endless verb its seconds whatever the trigger does, then stops it with the trigger', async () => {
		assert.deepEqual((await react('follow(Tom)')).seen, ['follow 2']);
		assert.deepEqual((await react('follow(Tom, unbreakable=5s)')).seen, ['follow 5']);
	});

	it('ends an endless verb ok when its within runs out', async () => {
		const { seen, result } = await react('follow(Tom, within=3s)', false);
		assert.deepEqual([seen, result.status, result.reason], [['follow 3'], 'ok', '3s']);
	});

	it('shields what runs in an unbreakable round of a loop, endless verbs too', async () => {
		assert.deepEqual((await react('loop(unbreakable=2) { follow(Tom, within=3s) }')).seen, ['follow 3', 'follow 6'], 'two rounds of 3 s');
		assert.deepEqual((await react('loop(unbreakable=4s) { follow(Tom, within=1s) }')).seen, ['follow 1', 'follow 2', 'follow 3', 'follow 4'], 'rounds for 4 s');
	});

	it('keeps seconds apart from rounds, and gives an endless verb seconds only', () => {
		const loop = (text:string) => parseArcText(text, verbs)[0].args.unbreakable;
		assert.deepEqual([loop('loop(unbreakable=10s) { wait() }'), loop('loop(unbreakable=2) { wait() }'), loop('loop(unbreakable=true) { wait() }')], ['10s', 2, true]);
		assert.equal(parseArcText('follow(Tom, unbreakable=1.5min)', verbs)[0].args.unbreakable, '1.5min');
		assert.throws(() => parseArcText('follow(Tom, unbreakable=true)', verbs), /follow holds for seconds: unbreakable=10s; true would never let it end/);
		assert.throws(() => parseArcText('follow(Tom, unbreakable=3)', verbs), /follow holds for seconds: unbreakable=10s$/);
		assert.throws(() => parseArcText('go_to(Keep, unbreakable=3s)', verbs), /no arg 'unbreakable'/);
		const json = '{"steps":[{"verb":"loop","arc":[{"verb":"wait"}],"times":3,"unbreakable":2},{"verb":"follow","target":"Tom","unbreakable":"10s"}]}';
		assert.deepEqual(parseArc(json, verbs).map((step) => step.args.unbreakable), [2, '10s'], 'Arc JSON writes both');
	});
});

describe('reactions commit', () => {
	const verbs = new VerbRegistry().addAll(STOCK_VERB_DEFS);
	/** Runs `arc` as the reaction to `danger`, with three guests in sight; `onStep` may turn `danger` off. */
	const react = async (arc:string, onStep:(step:Step, flags:{ danger:boolean })=>void):Promise<string[]> => {
		const flags = { danger: true };
		const catalog = ():ReturnType<typeof buildCatalog> => buildCatalog({
			me: dummyEntity('Mira'),
			others: ['Ann', 'Bo', 'Cy'].map((name) => dummyEntity(name)),
			items: [],
			cache: new SampleCache(),
			bindings: { danger: { kind: 'bool', value: flags.danger } },
		});
		const session = createArcSession({ catalog, verbs });
		const reaction:ArcHandler = { source: {} as Step, watch: 'danger', arc: parseArcText(arc, verbs), rank: 0, arm: {} };
		const seen:string[] = [];
		await runArc(reaction.arc, async (step) => {
			seen.push(step.verb === 'say' ? `say ${String(step.args.to ?? step.args.text)}` : step.verb);
			onStep(step, flags);
			return { status: 'ok', verb: step.verb };
		}, { session, asHandler: reaction });
		return seen;
	};
	const welcome = (loop:string):string => `go_to(Gate) ; loop(through=x in others${loop}) { say("Welcome", to=x) } ; say("Done")`;
	/** An event: true only as the reaction starts, gone by the time `go_to` is done. */
	const gone = (step:Step, flags:{ danger:boolean }):void => {
		if (step.verb === 'go_to') {
			flags.danger = false;
		}
	};

	it('stops a loop in a reaction before any round once its watch is false, and runs the steps after it', async () => {
		assert.deepEqual(await react(welcome(''), gone), ['go_to', 'say Done']);
	});

	it('finishes the round under way when the watch turns false in it, and goes no further', async () => {
		const midRound = (step:Step, flags:{ danger:boolean }):void => {
			if (step.args.to === 'Ann') {
				flags.danger = false;
			}
		};
		assert.deepEqual(await react(welcome(''), midRound), ['go_to', 'say Ann', 'say Done']);
	});

	it('runs an unbreakable loop to its own end, or the rounds it names first', async () => {
		assert.deepEqual(await react(welcome(', unbreakable=true'), gone), ['go_to', 'say Ann', 'say Bo', 'say Cy', 'say Done']);
		assert.deepEqual(await react(welcome(', unbreakable=1'), gone), ['go_to', 'say Ann', 'say Done']);
	});

	it('runs no round of a second loop once the watch turned false in the first', async () => {
		const midRound = (step:Step, flags:{ danger:boolean }):void => {
			if (step.args.to === 'Bo') {
				flags.danger = false;
			}
		};
		const seen = await react('loop(through=x in others) { say("Hi", to=x) } ; loop(times=3) { say("Again") } ; say("Done")', midRound);
		assert.deepEqual(seen, ['say Ann', 'say Bo', 'say Done']);
	});

	it('leaves a loop outside any reaction alone', async () => {
		const seen:string[] = [];
		await runArc(parseArcText('loop(times=2) { wait() }', verbs), async (step) => {
			seen.push(step.verb);
			return { status: 'ok', verb: step.verb };
		}, { session: createArcSession({ verbs, catalog: () => buildCatalog({ me: dummyEntity('Mira'), others: [], items: [], cache: new SampleCache() }) }) });
		assert.deepEqual(seen, ['wait', 'wait']);
	});

	it('guards from where a when is written, and only to the end of its group', async () => {
		const flags = { danger: true };
		let now = 0;
		const catalog = ():ReturnType<typeof buildCatalog> => buildCatalog({
			me: dummyEntity('Mira'),
			others: [],
			items: [],
			cache: new SampleCache(),
			bindings: { danger: { kind: 'bool', value: flags.danger } },
		});
		const run = async (arc:string):Promise<string[]> => {
			const seen:string[] = [];
			await runArc(parseArcText(arc, verbs), async (step) => {
				seen.push(step.verb === 'say' ? String(step.args.text) : step.verb);
				now += 1;
				return { status: 'ok', verb: step.verb };
			}, { session: createArcSession({ catalog, verbs, now: () => now }) });
			return seen;
		};
		assert.deepEqual(await run('go_to(Gate) ; when(danger) { say("ow") } ; wait()'), ['go_to', 'ow', 'wait'], 'not over the go_to before it');
		assert.deepEqual(await run('(wait() ; when(danger) { say("ow") }) ; go_to(Gate)'), ['wait', 'go_to'], 'gone with its group');
	});
});

describe('a running program saved', () => {
	const verbs = new VerbRegistry().addAll(STOCK_VERB_DEFS);
	const ARC = 'go_to(A) ; loop(times=3) { let x = say("round") ; follow(Tom, within=3s) } ; say("end")';

	/** A clock that moves a second each time it is waited on; `follow` runs until stopped. */
	const stage = (ran:string[]):{ session:ReturnType<typeof createArcSession>; execute:(step:Step, signal?:AbortSignal)=>Promise<ArcResult> } => {
		let now = 0;
		const session = createArcSession({ verbs, now: () => now, nextTime: async () => {
			now += 1;
		} });
		const execute = (step:Step, signal?:AbortSignal):Promise<ArcResult> => {
			ran.push(`${step.verb}${step.args.text ? ` ${String(step.args.text)}` : ''}`);
			return step.verb !== 'follow' ? Promise.resolve({ status: 'ok', verb: step.verb }) : new Promise((done) => {
				signal?.addEventListener('abort', () => done({ status: 'stopped', verb: 'follow' }), { once: true });
			});
		};
		return { session, execute };
	};

	it('goes on where it was once loaded: its loop round, its race, its let', async () => {
		const whole:string[] = [];
		const all = stage(whole);
		await runArc(parseArcText(ARC, verbs), all.execute, { session: all.session });
		const before:string[] = [];
		const first = stage(before);
		const machine = startArc(parseArcText(ARC, verbs), first.execute, { session: first.session });
		// Into the second round, its follow under way.
		let byTime = false;
		while (before.filter((verb) => verb === 'follow').length < 2) {
			const out = machine.advance(byTime);
			assert.ok('wake' in out, 'it is still running');
			byTime = await out.wake() === 'time';
		}
		const saved = JSON.parse(JSON.stringify(machine.toJSON())) as ArcMachineJSON;
		const after:string[] = [];
		const second = stage(after);
		const program = { work: parseArcText(ARC, verbs) };
		const result = await drive(restoreArc(saved, program, second.execute, second.session));
		assert.equal(result.status, 'ok');
		// The follow under way runs again; nothing before it does.
		assert.deepEqual([...before.slice(0, -1), ...after], whole);
		assert.equal(second.session.passes.get(program.work[1]), 3);
	});

	/**
	 * `text` run until it says "here" (a host call that never comes back), saved as JSON, loaded on a new session, and
	 * saved again: the two saves are alike. `examine` fails; `wait` calls in the law `duck` the first time.
	 */
	const roundTrip = async (text:string, opts:{ duck?:boolean; open?:Arc; parked?:boolean } = {}):Promise<ArcMachineJSON> => {
		const duck:Law = { name: 'duck', who: 'me', watch: 'true', arc: parseArcText('remember("ow") ; say("here")', verbs) };
		const laws = { duck: duck.arc };
		const law = ():ArcHandler => ({ source: duck, watch: duck.watch, arc: duck.arc, rank: 0, arm: reactionArm(duck) });
		let here = false;
		let ducked = !opts.duck;
		const { session } = stage([]);
		session.pick = async () => 'talk';
		const execute = (step:Step, signal?:AbortSignal):Promise<ArcResult> => {
			here ||= step.args.text === 'here';
			if (step.verb === 'wait' && !ducked) {
				ducked = true;
				interruptArc(session, { kind: 'preempt', handler: law() });
			}
			return step.args.text !== 'here' ? Promise.resolve({ status: step.verb === 'examine' ? 'failed' : 'ok', verb: step.verb, reason: 'no' }) : new Promise((done) => {
				signal?.addEventListener('abort', () => done({ status: 'stopped', verb: step.verb }), { once: true });
			});
		};
		const program = { work: parseArcText(text, verbs) };
		let machine:ArcMachine = startArc(program.work, execute, { session, open: !!opts.open });
		if (opts.open) {
			machine.advance();
			machine.root()!.append(opts.open);
			machine.root()!.close();
		}
		let byTime = false;
		while (!here) {
			const out = machine.advance(byTime);
			machine = machine.takeParked() ?? machine;
			if (!here && opts.parked && !('wake' in out)) {
				break;
			}
			assert.ok('wake' in out, `it is still running: ${JSON.stringify(out)}`);
			byTime = !here && await out.wake() === 'time';
		}
		const saved = JSON.parse(JSON.stringify(machine.toJSON(laws))) as ArcMachineJSON;
		const loaded = restoreArc(saved, program, execute, stage([]).session, laws, law);
		assert.deepEqual(JSON.parse(JSON.stringify(loaded.toJSON(laws))), saved);
		// Both stop, the parts of a `while` too.
		for (const running of [machine, loaded]) {
			running.session.ended = true;
			interruptArc(running.session, { kind: 'abort' });
			running.advance();
		}
		return saved;
	};

	it('saves every kind of frame as it is, and saves a loaded one alike', async () => {
		const kinds = async (text:string, opts?:Parameters<typeof roundTrip>[1]):Promise<string[]> => (await roundTrip(text, opts)).frames.map((frame) => frame.kind);
		assert.deepEqual(await kinds('loop(times=3) { wait(1) ; say("here", within=50) }'), ['root', 'chain', 'exec', 'loop', 'chain', 'exec', 'host']);
		assert.deepEqual(await kinds('examine(Y) ; if (examine(X)) { say("no") } else { say("here") }'), ['root', 'chain', 'exec', 'if', 'chain', 'exec', 'host']);
		assert.deepEqual(await kinds('choose("talk or stand", talk=say("here"), stand=wait())'), ['root', 'chain', 'exec', 'choose', 'chain', 'exec', 'host']);
		const parallel = await roundTrip('go_to(Gate) while { wait(1) ; say("here") }');
		assert.deepEqual(parallel.frames.map((frame) => frame.kind), ['root', 'chain', 'exec', 'parallel']);
		assert.ok(parallel.frames.some((frame) => frame.kind === 'parallel' && frame.parts[0]?.frames.some((part) => part.kind === 'host')), 'the part saves its step under way');
		const reaction = await roundTrip('when(danger, times=2) { remember("x") } ; wait(5)', { duck: true });
		assert.deepEqual(reaction.frames.map((frame) => frame.kind), ['root', 'chain', 'exec', 'host', 'reaction', 'chain', 'exec', 'host']);
		assert.deepEqual(reaction.handlers, [{ when: 'work.0', rank: 100 }, { law: 'duck' }]);
		assert.deepEqual(reaction.session.whens, [['work.0', { runs: 0 }]]);
		assert.deepEqual((await roundTrip('when(danger) { say("x") }', { parked: true })).frames.map((frame) => frame.kind), ['park']);
		const streamed = await roundTrip('wait(1)', { open: parseArcText('wait(2) ; say("here")', verbs) });
		assert.deepEqual(streamed.steps.map((step) => step.verb), ['wait', 'say'], 'steps streamed in are saved once');
		assert.deepEqual(streamed.frames.find((frame) => frame.kind === 'chain')?.arc, ['work.0', 'steps.0.0', 'steps.1.0']);
	});

	it('saves the shape it says, whatever its frames call their fields', async () => {
		const saved = await roundTrip('examine(X) ; say("here", within=50)');
		assert.deepEqual(saved, {
			frames: [
				{ kind: 'root', depth: 0, draining: false, open: false, started: true },
				{
					kind: 'chain', depth: 0, draining: false, arc: ['work.0', 'work.1'], open: false, started: true, i: 1,
					result: { status: 'failed', verb: 'examine', reason: 'no' }, named: [], handlers: [], outerFail: undefined,
				},
				{ kind: 'exec', depth: 0, draining: false, step: 'work.1', alone: false, rounds: 1, race: 0, above: 0, running: true },
				{ kind: 'host', depth: 0, draining: false, step: 'work.1', race: 0, token: 0, since: 0 },
			].map((frame) => JSON.parse(JSON.stringify(frame)) as unknown),
			session: { token: 0, fail: { verb: 'examine', reason: ['no'] }, shields: 0, parked: false, running: [], bindings: [], passes: [], whens: [] },
			races: [{ until: '', within: 50, deadline: 50, endless: false, holdUntil: 0 }],
			handlers: [],
			steps: [],
		});
	});
});

describe('A while B', () => {
	const verbs = new VerbRegistry().addAll(STOCK_VERB_DEFS);
	/**
	 * A clock that moves a second each time it is waited on. `go_to` takes `walk` seconds, `follow` and `wait` their time
	 * or until stopped; a verb named in `fails` fails at once.
	 */
	const stage = (walk:number, fails:readonly string[] = [], begun:(verb:string)=>void = () => undefined):{ session:ReturnType<typeof createArcSession>; log:string[]; execute:(step:Step, signal?:AbortSignal)=>Promise<ArcResult> } => {
		let now = 0;
		const log:string[] = [];
		const session = createArcSession({ verbs, now: () => now, nextTime: async () => {
			now += 1;
		} });
		const execute = async (step:Step, signal?:AbortSignal):Promise<ArcResult> => {
			const what = [step.verb, step.args.target, step.args.text].filter((part) => typeof part === 'string').join(' ');
			log.push(what);
			begun(step.verb);
			if (fails.includes(step.verb)) {
				return { status: 'failed', verb: step.verb, reason: `${step.verb} failed` };
			}
			const takes = step.verb === 'go_to' ? walk : step.verb === 'wait' ? Number(step.args.seconds) : step.verb === 'follow' ? Infinity : 0;
			const end = now + takes;
			while (now < end && !signal?.aborted) {
				await session.nextTime!();
			}
			if (takes > 0) {
				log.push(`${signal?.aborted ? 'stopped' : 'ended'} ${what}`);
			}
			return { status: signal?.aborted ? 'stopped' : 'ok', verb: step.verb };
		};
		return { session, log, execute };
	};
	const say = (text:string):Step => ({ verb: 'say', args: { text } });

	it('puts B in A\'s while, Arc text and JSON alike, and writes it back so', () => {
		const arc = parseArcText('go_to(Well) while say("Follow me")', verbs);
		assert.equal(arc.length, 1);
		assert.deepEqual(arc[0].args.while, [say('Follow me')]);
		assert.equal(formatArc(arc, verbs), 'go_to(Well) while say("Follow me")');
		assert.match(arcJSONText(arc, verbs), /"while":\[\{"verb":"say"/);
		assert.deepEqual(parseArc(arcJSONText(arc, verbs), verbs), arc);
		const block = parseArcText('go_to(Gate) while {\n\tsay("This way")\n\tsay("Nearly there")\n}\nsay("Here we are")', verbs);
		assert.deepEqual(block.map((step) => step.verb), ['go_to', 'say']);
		assert.deepEqual(block[0].args.while, [{ ...say('This way'), then: 'always' }, say('Nearly there')]);
		assert.equal(formatArc(block, verbs), 'go_to(Gate) while { say("This way") ; say("Nearly there") } ; say("Here we are")');
	});

	it('takes a block verb on either side, and on any verb in JSON', () => {
		const loop = parseArcText('loop {\n\tgo_to(Mill)\n\tgo_to(Barn)\n} while say("Off I go")', verbs)[0];
		assert.equal(loop.verb, 'loop');
		assert.equal((loop.args.arc as Arc).length, 2);
		assert.deepEqual(loop.args.while, [say('Off I go')]);
		const follow = parseArcText('follow(Bram) while {\n\tsay("Come")\n\tsay("Hurry")\n}', verbs)[0];
		assert.deepEqual((follow.args.while as Arc).map((step) => step.args.text), ['Come', 'Hurry']);
		const looped = parseArcText('say("Off") while loop { go_to(Mill) ; go_to(Barn) }', verbs)[0];
		assert.equal((looped.args.while as Arc)[0].verb, 'loop');
		assert.deepEqual(parseArc('{"steps":[{"verb":"loop","arc":[{"verb":"go_to","target":"Well"}],"while":[{"verb":"say","text":"hi"}]}]}', verbs)[0].args.while, [say('hi')]);
	});

	it('binds tighter than &&, || and ;', () => {
		const verbsOf = (text:string):string[] => parseArcText(text, verbs).map((step) => `${step.verb}${step.args.while ? '+' : ''}${step.then ? ` ${step.then}` : ''}`);
		assert.deepEqual(verbsOf('go_to(Well) while say("Follow me") && examine(Well)'), ['go_to+', 'examine']);
		assert.deepEqual(verbsOf('pick_up(Lantern) && go_to(Well) while say("hi")'), ['pick_up', 'go_to+']);
		assert.deepEqual(verbsOf('go_to(Bell) while say("Make way") || say("Help!")'), ['go_to+ if_failed', 'say']);
		assert.deepEqual(verbsOf('say("Ready") ; go_to(Well) while say("hi")'), ['say always', 'go_to+']);
	});

	it('repeats from the right, and is refused at a statement\'s start', () => {
		const arc = parseArcText('go_to(Well) while say("a") while remember("x")', verbs);
		assert.deepEqual(arc[0].args.while, [{ ...say('a'), args: { text: 'a', while: [{ verb: 'remember', args: { content: 'x' } }] } }]);
		assert.equal(formatArc(arc, verbs), 'go_to(Well) while say(a) while remember(x)');
		assert.throws(() => parseArcText('while (isHurt(me)) { say("ow") }', verbs), /while joins two steps: A while B/);
		// A { } on a verb's line is refused; on the next line it is a step of its own.
		assert.throws(() => parseArcText('go_to(Well) { say("hi") }', verbs), /to run steps during it, write go_to\(Well\) while \{ … \}; for after it, put the block on the next line/);
		assert.deepEqual(parseArcText('go_to(Well)\n{\n\tsay("hi")\n}', verbs).map((step) => step.verb), ['go_to', 'group']);
		assert.deepEqual(parseArcText('loop {\n\tgo_to(Well)\n}', verbs).map((step) => step.verb), ['loop'], 'a block verb keeps its body');
	});

	it('runs B during A, and the next step waits for both', async () => {
		const { session, log, execute } = stage(3);
		const result = await runArc(parseArcText('go_to(Gate) while say("This way") ; remember("led them")', verbs), execute, { session });
		assert.equal(result.status, 'ok');
		assert.ok(log.indexOf('say This way') < log.indexOf('ended go_to Gate'), 'spoken while walking');
		assert.equal(log.at(-1), 'remember', 'the next step waits for both');
	});

	it('ends once A and B have, whichever is last', async () => {
		const { session, log, execute } = stage(1);
		await runArc(parseArcText('go_to(Gate) while { wait(4) ; say("Here") } ; remember("x")', verbs), execute, { session });
		assert.ok(log.indexOf('ended go_to Gate') < log.indexOf('say Here'));
		assert.deepEqual(log.slice(-2), ['say Here', 'remember']);
	});

	it('runs A while B while C as three parts side by side', async () => {
		const { session, log, execute } = stage(4);
		let saved:ArcMachineJSON | undefined;
		const arc = parseArcText('go_to(Gate) while wait(2) while say("Hi") ; remember("x")', verbs);
		const machine = startArc(arc, async (step, signal) => {
			saved ??= step.verb === 'say' ? JSON.parse(JSON.stringify(machine.toJSON())) as ArcMachineJSON : undefined;
			return execute(step, signal);
		}, { session });
		assert.equal((await drive(machine)).status, 'ok');
		assert.ok(log.indexOf('say Hi') < Math.min(log.indexOf('ended wait'), log.indexOf('ended go_to Gate')), 'all three run at once: ' + log.join(', '));
		assert.equal(log.at(-1), 'remember');
		const frames = saved!.frames.flatMap((frame) => (frame.kind === 'parallel' ? [frame] : []));
		assert.equal(frames.length, 1, 'one frame, no nesting');
		assert.equal(frames[0].parts.length, 2);
	});

	it('queues a step on every channel the session says it needs', async () => {
		const { session, log, execute } = stage(3);
		session.extraLanes = (step) => (step.verb === 'say' ? ['body'] : []);
		await runArc(parseArcText('go_to(Well) while say("Wait for me")', verbs), execute, { session });
		assert.ok(log.indexOf('ended go_to Well') < log.indexOf('say Wait for me'), 'a line that walks first waits for the body');
	});

	it('queues a step behind a part that holds its channel', async () => {
		const { session, log, execute } = stage(3);
		await runArc(parseArcText('go_to(Well) while examine(Well)', verbs), execute, { session });
		assert.ok(log.indexOf('ended go_to Well') < log.indexOf('examine Well'), log.join(', '));
		const voices = stage(1);
		await runArc(parseArcText('loop(times=1) { say("a") ; go_to(Mill) } while say("b")', verbs), voices.execute, { session: voices.session });
		assert.deepEqual(voices.log.filter((line) => line.startsWith('say')), ['say a', 'say b'], 'the voice is one at a time');
	});

	it('fails as its first part to fail, once every part has ended', async () => {
		const { session, log, execute } = stage(5, ['go_to']);
		const result = await runArc(parseArcText('go_to(Gate) while { wait(3) ; say("Late") } && remember("x")', verbs), execute, { session });
		assert.equal(result.status, 'failed');
		assert.equal(result.reason, 'go_to failed');
		assert.ok(log.includes('say Late') && !log.includes('remember'), log.join(', '));
		const part = stage(3, ['say']);
		const failed = await runArc(parseArcText('go_to(Gate) while say("Hi") && remember("x")', verbs), part.execute, { session: part.session });
		assert.equal(failed.reason, 'say failed');
		assert.ok(part.log.includes('ended go_to Gate') && !part.log.includes('remember'));
	});

	it('ends every part at A\'s until or within, and is endless with an endless part', async () => {
		const { session, log, execute } = stage(1);
		const result = await runArc(parseArcText('follow(Bram, within=5) while say("Come") ; remember("x")', verbs), execute, { session });
		assert.equal(result.status, 'ok');
		assert.ok(log.indexOf('say Come') < log.indexOf('stopped follow Bram') && log.at(-1) === 'remember', log.join(', '));
		const part = stage(1);
		await runArc(parseArcText('say("Come", within=5) while follow(Bram)', verbs), part.execute, { session: part.session });
		assert.ok(part.log.includes('stopped follow Bram'), 'A\'s within ends B too');
		assert.throws(() => parseArcText('say("Come") while follow(Bram) ; remember("x")', verbs), /follow never ends/);
	});

	it('is held, every part, while a reaction runs over it, and goes on with it', async () => {
		const law:Law = { name: 'duck', who: 'me', watch: 'true', arc: parseArcText('remember("ow") ; wait(3)', verbs) };
		let fired = false;
		const { session, log, execute } = stage(20, [], (verb) => {
			if (verb === 'wait' && !fired) {
				fired = true;
				interruptArc(session, { kind: 'preempt', handler: { source: law, watch: law.watch, arc: law.arc, rank: 0, arm: reactionArm(law) } });
			}
		});
		const result = await runArc(parseArcText('go_to(Gate) while { say("a") ; wait(10) ; say("b") }', verbs), execute, { session });
		assert.equal(result.status, 'ok');
		const waits = log.flatMap((line, i) => (line === 'wait' ? [i] : []));
		assert.equal(waits.length, 3, `B's wait, the reaction's, B's again: ${log.join(', ')}`);
		assert.ok(log.indexOf('stopped wait') < waits[1], 'B\'s wait is cut short as the reaction begins');
		assert.ok(log.indexOf('ended wait') < waits[2], 'and runs again once the reaction is done');
		assert.ok(log.indexOf('say b') > log.indexOf('remember') && log.includes('ended go_to Gate'));
	});

	it('goes on where it was once loaded', async () => {
		const text = 'go_to(Gate) while { say("a") ; wait(100) ; say("b") } ; remember("x")';
		// Saved as B's wait begins, the walk under way.
		let reach:(json:ArcMachineJSON)=>void = () => undefined;
		const reached = new Promise<ArcMachineJSON>((resolve) => {
			reach = resolve;
		});
		const first = stage(500, [], (verb) => verb === 'wait' && reach(JSON.parse(JSON.stringify(machine.toJSON())) as ArcMachineJSON));
		const machine = startArc(parseArcText(text, verbs), first.execute, { session: first.session });
		void drive(machine);
		const saved = await reached;
		assert.ok(saved.frames.some((frame) => frame.kind === 'parallel' && frame.parts[0]), 'B is saved with its frame');
		const second = stage(2);
		const result = await drive(restoreArc(saved, { work: parseArcText(text, verbs) }, second.execute, second.session));
		assert.equal(result.status, 'ok');
		// The steps under way run again; B's first step does not.
		assert.ok(!second.log.includes('say a'));
		assert.ok(second.log.includes('go_to Gate') && second.log.includes('wait') && second.log.includes('say b'));
		assert.equal(second.log.at(-1), 'remember');
	});
});
