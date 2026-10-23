import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ArcDirector } from '../director/director.js';
import { FakeProvider } from '../inference/fake.js';
import { chatContentText, type ChatRequest } from '../inference/provider.js';
import type { SystemOne } from '../inference/systemone.js';
import type { SceneCtx } from '../scenario/play.js';
import { baselineArc, BASELINES, benchArcs, playArcCase, type ArcCase } from './arc.js';
import { ARC_BENCH } from './cases.js';
import { benchSystemOne, DECISION_BENCH, type DecisionCase } from './decision.js';
import { runBench, type BenchLevel, type BenchOutcome } from './score.js';

/** A model on its own server, writing Arc text; it can see, so `see_map` is offered. `chat` answers each request. */
function model(chat:(req:ChatRequest)=>string, spec:{ maxParallel?:number } = {}):(director:ArcDirector<SceneCtx>)=>unknown {
	return (director) => director
		.withArcFormat('text')
		.addInference('fake', new FakeProvider((req) => ({ content: chat(req), toolCalls: [] })), { vision: true })
		.addModel('main', { id: 'fake', ...spec });
}

/** A model that writes `arcs` in turn, one a think, the last again after; a request that is no think gets `OK`. */
function scripted(arcs:string | string[]):(director:ArcDirector<SceneCtx>)=>unknown {
	const list = [arcs].flat();
	let thinks = 0;
	return model((req) => (req.thread ? list[Math.min(thinks++, list.length - 1)] : 'OK'));
}

/** Every request's whole text, as the model reads it. */
function talk(req:ChatRequest):string {
	return req.messages.map((m) => chatContentText(m.content)).join('\n');
}

function arcCase(id:string):ArcCase {
	const found = ARC_BENCH.find((c) => c.me.id === id);
	assert.ok(found, id);
	return found;
}

/** The case `req` thinks for, by its character: a squad's commander thinks as `<id>Squad`. */
function caseOf(req:ChatRequest, cases:ArcCase[]):ArcCase | undefined {
	return cases.find((c) => [c.me.id, `${c.me.id}Squad`].includes(req.thread ?? ''));
}

/** How `c` ends when its arcs are `arcs`, one a think. */
function outcome(c:ArcCase, arcs:string | string[]):Promise<BenchOutcome> {
	return playArcCase(c, scripted(arcs));
}

describe('bench scoring', () => {
	it('scores the share of goals reached, with its standard error over repeats', async () => {
		const runs = new Map<string, number>();
		// Case a always succeeds, b every other time, c never.
		const trial = (name:string, every:number) => ({
			name,
			skill: name === 'c' ? 'hard' : 'easy',
			level: 1 as const,
			run: async ():Promise<BenchOutcome> => {
				const n = runs.get(name) ?? 0;
				runs.set(name, n + 1);
				return every > 0 && n % every === 0 ? 'success' : name === 'c' ? 'harmful' : 'neutral';
			},
		});
		const progress:number[] = [];
		let warmed = false;
		const score = await runBench([trial('a', 1), trial('b', 2), trial('c', 0)], {
			repeats: 4,
			onTrial: (done) => progress.push(done),
			warmUp: async () => {
				warmed = true;
			},
		});
		assert.ok(warmed);
		assert.equal(progress[0], 0, '0 once the warm-up is over');
		assert.equal(progress.at(-1), 12);
		assert.deepEqual(score.total, { right: 6, harmful: 4, total: 12, mean: 0.5, se: Math.sqrt(1 / 3 / 4) / 3 });
		assert.equal(score.skills.easy.mean, 0.75);
		assert.equal(score.skills.hard.mean, 0);
		assert.equal(score.repeats, 4);
		const once = await runBench([trial('d', 1)]);
		assert.equal(once.total.se, undefined, 'one repeat cannot tell its noise');
	});

	it('climbs each skill in a quick check: medium, then easy after a miss or hard after a success', async () => {
		const ran:string[] = [];
		// How far up each skill passes: nothing, easy only, up to medium, everything.
		const reach:Record<string, number> = { none: 0, easy: 1, medium: 2, all: 3 };
		const trials = Object.keys(reach).flatMap((skill) => ([1, 2, 3] as BenchLevel[]).map((level) => ({
			name: `${skill} ${level}`,
			skill,
			level,
			run: async ():Promise<BenchOutcome> => {
				ran.push(`${skill} ${level}`);
				return level <= reach[skill] ? 'success' : 'neutral';
			},
		})));
		const score = await runBench(trials, { quick: true, repeats: 5 });
		assert.deepEqual(Object.fromEntries(Object.entries(score.skills).map(([skill, s]) => [skill, s.mean])), { none: 0, easy: 1 / 3, medium: 2 / 3, all: 1 });
		assert.equal(score.total.mean, 0.5);
		assert.deepEqual(ran, ['none 2', 'none 1', 'easy 2', 'easy 1', 'medium 2', 'medium 3', 'all 2', 'all 3'], 'two each, whatever the repeats');
	});

	it('benches a System One per case in both orders, rated by the worse pick', async () => {
		const asked:[string, Record<string, string>][] = [];
		const first:SystemOne = { pick: async (state, _g, criteria) => {
			asked.push([state, criteria]);
			return Object.keys(criteria)[0];
		} };
		const scene = { me: { id: 'Ash', hp: [12, 12] as [number, number] }, doing: 'go_to', goal: 'g', things: { Keep: { away: 3, side: 'ahead' as const } } };
		const cases:DecisionCase[] = [
			{ ...scene, skill: 'tactics', level: 1, choices: { a: 'go_to(Keep)', b: 'wait()' }, ratings: { a: 1, b: 0 } },
			{ ...scene, skill: 'social', level: 3, choices: { a: 'go_to(Keep)', b: 'wait()' }, ratings: { a: 0, b: 1 } },
		];
		const score = await benchSystemOne(first, cases);
		assert.deepEqual(asked[0], ['You are Ash, 12/12 hp.\nDoing: go_to.', { a: 'go_to(Keep) — Keep 3 away, ahead', b: 'wait()' }], 'worded as the director words it');
		assert.equal(score.total.mean, 0, 'always the first slot scores nothing');
		const answer:SystemOne = { pick: async () => 'a' };
		assert.deepEqual((await benchSystemOne(answer, cases)).skills.tactics, { right: 1, harmful: 0, total: 1, mean: 1 });
		const broken = await benchSystemOne({ pick: async () => { throw new Error('down'); } }, cases);
		assert.equal(broken.failed, 2);
		assert.equal(broken.error, 'down');
		assert.equal((await benchSystemOne({ pick: async () => 'c' }, cases)).failed, 2, 'a pick that names no choice fails');
		// A pick that still helps earns its rating; a slot-favoring model gets only its worst choice's.
		const partial:DecisionCase[] = [{ ...scene, skill: 'tactics', level: 2, choices: { a: 'go_to(Keep)', b: 'wait()' }, ratings: { a: 1, b: 0.7 } }];
		const half = await benchSystemOne({ pick: async () => 'b' }, partial);
		assert.equal(half.total.mean, 0.7);
		assert.equal(half.total.right, 0);
		assert.equal(half.total.harmful, 0, 'a pick that helps is not harm');
		assert.equal((await benchSystemOne(first, partial)).total.mean, 0.7, 'the first slot each time: the worse of the two');
	});

	it('rates every choice of every decision case, with one best', () => {
		for (const c of DECISION_BENCH) {
			assert.deepEqual(Object.keys(c.ratings).sort(), Object.keys(c.choices).sort(), `${c.me.id}: every choice rated`);
			assert.ok(Object.values(c.ratings).every((r) => r >= 0 && r <= 1), `${c.me.id}: ratings from 0 to 1`);
			assert.equal(Object.values(c.ratings).filter((r) => r === 1).length, 1, `${c.me.id}: one best choice`);
		}
	});
});

describe('arc bench cases', () => {
	it('names every case by a character of its own, so a think finds its case', () => {
		assert.equal(new Set(ARC_BENCH.map((c) => c.me.id)).size, ARC_BENCH.length);
	});

	it('can win every case: its solution reaches the goal', async () => {
		for (const c of ARC_BENCH) {
			assert.equal(await outcome(c, c.solution), 'success', c.me.id);
		}
	});

	it('gives no points for free: doing nothing, attacking the nearest foe, the commander alone, or the naive move', async () => {
		for (const c of ARC_BENCH) {
			for (const baseline of BASELINES) {
				const arc = baselineArc(c, baseline);
				if (arc) {
					assert.notEqual(await outcome(c, arc), 'success', `${c.me.id} won by ${baseline}: ${arc}`);
				}
			}
		}
	});

	it('gives every squad case its commander-alone move, and every fight one to attack', () => {
		for (const c of ARC_BENCH.filter((c) => c.squad && Object.values(c.squad).some((spot) => spot.as))) {
			assert.ok(c.alone, c.me.id);
		}
		for (const c of ARC_BENCH.filter((c) => c.skill === 'fight' || c.skill === 'tactics')) {
			assert.ok(baselineArc(c, 'attack'), c.me.id);
		}
	});

	it('weighs a goal not reached against doing nothing: neutral when no worse off, harmful when worse', async () => {
		assert.equal(await outcome(arcCase('Bryn'), 'pick_up(Ladle)'), 'neutral', 'kept the Ladle: no help, no harm');
		assert.equal(await outcome(arcCase('Tarvos'), 'go_to(Anvilhall)'), 'neutral', 'went where Garrick used to be');
		assert.equal(await outcome(arcCase('Odda'), 'give(item=gold, to=Ysmay, quantity=3)'), 'harmful', 'paid, and got no Candle');
		assert.equal(await outcome(arcCase('Liesel'), arcCase('Liesel').naive!), 'harmful', 'gave the Wool again');
		assert.equal(await outcome(arcCase('Sabeth'), 'give(item=Letter, to=Ansel)'), 'harmful', 'gave the Letter to the wrong one');
		assert.equal(await outcome(arcCase('Wilmer'), 'offer(to=Maelis, give={"Scarf":1}, get={"gold":4})'), 'harmful', 'sold below its price: the case\'s own harm');
		assert.equal(await outcome(arcCase('Sigmar'), 'issue(who=units, arc=go_to(Gnasher1))'), 'harmful', 'sent the hurt unit at the raiders, and lost it');
	});

	it('scores where an arc gets, not what it says', async () => {
		const won:[string, string | string[]][] = [
			// What comes after the goal does not undo it.
			['Corvus', 'shoot(target=Grisk) ; shoot(target=Varga)'],
			// Read the Shed first, then took the right key.
			['Wulf', ['examine(Shed)', arcCase('Wulf').solution as string]],
			// Drank naming itself: used on itself is used on nothing.
			['Ysra', 'use(item=Elixir, target=Ysra) && hex(target=Brakk)'],
			// Wrote every trip out.
			['Hedda', Array(4).fill('use(item=Bucket, target=Spring) && use(item=Bucket, target=Cistern)').join(' && ')],
			// A law that spreads them holds them where they stand.
			['Elowen', 'law(name=spread, arc=spread_out(paces=6)) ; spread_out(paces=6)'],
			// Another line to 10.
			['Selka', 'infuse() && drain() && infuse() && amplify()'],
			// Tried the near key, read why it failed, and took the other.
			['Wulf', [arcCase('Wulf').naive!, arcCase('Wulf').solution as string]],
		];
		for (const [id, arcs] of won) {
			assert.equal(await outcome(arcCase(id), arcs), 'success', id);
		}
		const lost:[string, string | string[]][] = [
			// Guessed the code three times: jammed.
			['Petra', ['dial(target=Lockbox, code=111) ; dial(target=Lockbox, code=222) ; dial(target=Lockbox, code=333)', 'examine(Plaque)', 'dial(target=Lockbox, code=417)']],
			// Ran to the Hut at once, and picked nothing.
			['Halla', 'go_to(Hut)'],
			// Fed the Kiln once.
			['Brandr', `stoke(kiln=Kiln) ; ${arcCase('Brandr').naive}`],
			// Broke the first firestorm, not the second.
			['Vesna', 'bash(target=Morwen) ; cleave(target=Morwen)'],
			// Sold the Pelts, but offered too little for the Lute.
			['Fennick', 'offer(to=Thibault, give={"Pelt":3}, get={"gold":6}) && offer(to=Merrin, give={"gold":5}, get={"Lute":1})'],
			// Sent everyone to one tower.
			['Ottar', 'issue(who=units, arc=go_to(EastTower))'],
			// Took 1, then the wrong reply.
			['Fenwyn', ['take(stones=1)', 'take(stones=1)', 'take(stones=1)']],
		];
		for (const [id, arcs] of lost) {
			assert.notEqual(await outcome(arcCase(id), arcs), 'success', id);
		}
	});
});

describe('arc bench play', () => {
	it('thinks again after an arc that falls short, told how it went and seeing from where it stands', async () => {
		const prompts:string[] = [];
		const c = arcCase('Petra');
		const arcs = c.solution as string[];
		const won = await playArcCase(c, model((req) => {
			prompts.push(talk(req));
			return arcs[Math.min(prompts.length - 1, arcs.length - 1)];
		}));
		assert.equal(won, 'success');
		assert.equal(prompts.length, 2);
		assert.match(prompts[1], /4-1-7/, 'the second think reads what examine found');
	});

	it('offers a case its own verbs, alias verbs and look-ahead tool, and an RTS squad the stock RTS verbs', async () => {
		const promptOf = async (id:string):Promise<{ text:string; tools:string[] }> => {
			let seen:{ text:string; tools:string[] } | undefined;
			await playArcCase({ ...arcCase(id), thinks: 1 }, model((req) => {
				seen ??= { text: talk(req), tools: (req.tools ?? []).map((t) => t.name) };
				return 'wait(seconds=1)';
			}));
			return seen!;
		};
		assert.match((await promptOf('Wystan')).text, /quarry — breaks 2 Stone loose/);
		assert.match((await promptOf('Brandr')).text, /stoke\(kiln\) — feeds a Charcoal/);
		const stones = await promptOf('Fenwyn');
		assert.match(stones.text, /take\(stones\)/);
		assert.ok(stones.tools.includes('plan_stones'));
		const kite = (await promptOf('Ranulf')).text;
		assert.match(kite, /keep_distance\(from\?, keep\?\)/);
		assert.match(kite, /attack_move\(to, focus\?\)/);
		assert.match(kite, /Units: Rifleman ×3/, 'the commander reads its side at a glance');
		const village = (await promptOf('Corwen')).text;
		assert.match(village, /train\(what, count\?, at\?, rally\?\)/);
		assert.match(village, /Stock: 300 Gold, 200 Wood/);
	});

	it('answers a look-ahead call from where the case stands', async () => {
		const c = arcCase('Fenwyn');
		let answer = '';
		await playArcCase({ ...c, thinks: 1 }, (director) => director
			.withArcFormat('text')
			.addInference('fake', new FakeProvider((req) => {
				const tool = req.messages.find((m) => m.role === 'tool');
				if (!tool) {
					return { content: null, toolCalls: [{ id: '1', name: 'plan_stones', arguments: '{}' }] };
				}
				answer = chatContentText(tool.content);
				return { content: 'wait(seconds=1)', toolCalls: [] };
			}), { vision: true })
			.addModel('main', { id: 'fake' }));
		assert.match(answer, /^1\. take\(stones=2\): win \d+%/);
	});

	it('offers a squad only its own abilities, and tells its commander how idle fighters fight', async () => {
		let prompt = '';
		await playArcCase({ ...arcCase('Sigmar'), thinks: 1 }, model((req) => {
			prompt ||= talk(req);
			return 'wait(seconds=1)';
		}));
		assert.match(prompt, /fire\(target\)/);
		assert.doesNotMatch(prompt, /shoot\(target\)|Nested arc verbs/);
		assert.match(prompt, /strike back at any foe in reach on our own/);
	});

	it('hides what is out of sight from the prompt, so only a lookup finds it', async () => {
		for (const c of ARC_BENCH) {
			let prompt = '';
			await playArcCase({ ...c, thinks: 1 }, model((req) => {
				prompt ||= talk(req);
				return 'wait(seconds=1)';
			}));
			const said = [c.goal, ...(c.heard ?? []).map((line) => line.text), ...(c.memories ?? []).map((m) => m.text), ...(c.know ?? []).map((k) => k.text)].join(' ');
			const far = Object.entries({ ...c.others, ...c.things }).filter(([name, spot]) => spot.away > 24 && !said.includes(name));
			for (const [name] of far) {
				assert.equal(prompt.includes(name), false, `${c.me.id}'s prompt names ${name}`);
			}
		}
	});
});

describe('benchArcs', () => {
	/** A model that plays each of `cases` by its solution, by the case its think is for. */
	const solver = (cases:ArcCase[], maxParallel?:number) => {
		const thinks = new Map<ArcCase, number>();
		return model((req) => {
			const c = caseOf(req, cases);
			if (!c) {
				return 'OK';
			}
			const arcs = [c.solution].flat();
			const n = thinks.get(c) ?? 0;
			thinks.set(c, n + 1);
			return arcs[Math.min(n, arcs.length - 1)];
		}, { maxParallel });
	};

	it('warms the model up untimed, times only the think, and counts a think that throws as failed', async () => {
		const asked:(string | undefined)[] = [];
		const down = await benchArcs((director) => director
			.addInference('fake', new FakeProvider((req) => {
				asked.push(req.thread);
				throw new Error('down');
			}))
			.addModel('main', { id: 'fake' }), [arcCase('Vashti')]);
		assert.equal(asked[0], undefined, 'one warm-up request first, from no mind');
		assert.equal(down.failed, 1);
		assert.equal(down.error, 'down');
		assert.equal(down.levels[1].harmful, 1, 'a failed think counts as harmful');
		const slow = await benchArcs(solver([arcCase('Hedda')]), [arcCase('Hedda')]);
		assert.equal(slow.total.mean, 1);
		assert.ok(slow.msPerTrial < 1000, 'a minute and a half of play is not the model\'s time');
	});

	it('records how the model sampled: its makers\' settings unless its spec says', async () => {
		const gemma = await benchArcs((director) => director
			.withArcFormat('text')
			.addInference('fake', new FakeProvider(() => ({ content: 'wait(seconds=1)', toolCalls: [] })))
			.addModel('main', { id: 'google/gemma-4-e4b' }), [arcCase('Vashti')]);
		assert.deepEqual(gemma.sampling, { temperature: 1, topP: 0.95, topK: 64 });
		const own = await benchArcs((director) => director
			.withArcFormat('text')
			.addInference('fake', new FakeProvider(() => ({ content: 'wait(seconds=1)', toolCalls: [] })))
			.addModel('main', { id: 'google/gemma-4-e4b', sampling: { temperature: 0.3 } }), [arcCase('Vashti')]);
		assert.deepEqual(own.sampling, { temperature: 0.3, topP: 0.95, topK: 64 }, "its own setting over its makers' others");
	});

	it('runs repeats, and as many cases at once as the model thinks, or as asked, scoring the same', async () => {
		const cases = ARC_BENCH.filter((c) => c.level === 2);
		const together = await benchArcs(solver(cases, 3), cases);
		const alone = await benchArcs(solver(cases, 3), cases, { parallel: 1 });
		assert.equal(together.parallel, 3, 'the model\'s maxParallel');
		assert.equal(alone.parallel, 1);
		assert.deepEqual(together.skills, alone.skills);
		assert.equal(together.total.mean, 1);
		const twice = await benchArcs(solver(cases.slice(0, 2)), cases.slice(0, 2), { repeats: 2, parallel: 1 });
		assert.deepEqual(twice.total, { right: 4, harmful: 0, total: 4, mean: 1, se: 0 });
	});

	it('gives every skill an easy, a medium and a hard case, so a quick check climbs each', () => {
		for (const skill of new Set(ARC_BENCH.map((c) => c.skill))) {
			assert.deepEqual([...new Set(ARC_BENCH.filter((c) => c.skill === skill).map((c) => c.level))].sort(), [1, 2, 3], skill);
		}
	});
});

