import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ArcDirector } from '../director/director.js';
import { FakeProvider, type FakeChatFn } from '../inference/fake.js';
import { chatContentText, type ChatRequest } from '../inference/provider.js';
import type { SystemOne } from '../inference/systemone.js';
import { ARC_BENCH, benchArcs, type ArcCase, type SceneCtx } from './arc.js';
import { benchSystemOne, type DecisionCase } from './decision.js';

/** A model on its own server, as a host adds one to play; it can see, so `see_map` is offered. */
function fake(chat:FakeChatFn):(director:ArcDirector<SceneCtx>)=>unknown {
	return (director) => director.addInference('fake', new FakeProvider(chat), { vision: true }).addModel('main', { id: 'fake' });
}

type Steps = Record<string, unknown>[];

/** Writes `steps` as Arc JSON. */
function reply(...steps:Steps) {
	return { content: JSON.stringify({ steps }), toolCalls: [] };
}

function arcCase(skill:string, id:string):ArcCase {
	return ARC_BENCH.find((c) => c.skill === skill && c.me.id === id)!;
}

/** The case `req` thinks for: its character, with its goal. */
function caseOf<T extends ArcCase>(req:ChatRequest, cases:T[]):T {
	const prompt = chatContentText(req.messages.at(-1)?.content);
	return cases.find((c) => req.thread === c.me.id && prompt.includes(`- ${c.goal}\n`))!;
}

/** How many of `plays` reach their goal: each case, its arc written by a model that knows it by its prompt. */
async function reached(plays:[ArcCase, Steps][]):Promise<number> {
	const arcs = new Map(plays);
	const score = await benchArcs(fake((req) => reply(...arcs.get(caseOf(req, [...arcs.keys()]))!)), [...arcs.keys()]);
	return Object.values(score.levels).reduce((sum, level) => sum + level.right, 0);
}

/** An arc that reaches each case's goal, by its character. */
const GOOD:[string, string, Steps][] = [
	['chain', 'Ren', [{ verb: 'pick_up', item: 'RedKey' }, { verb: 'use', item: 'RedKey', target: 'VaultDoor' }]],
	['trade', 'Mia', [{ verb: 'offer', to: 'Baker', give: { gold: 5 }, get: { Loaf: 1 } }]],
	['social', 'Rook', [{ verb: 'say', text: 'I am Rook.', to: 'Wren' }]],
	['social', 'Lin', [{ verb: 'follow', target: 'Player' }]],
	['fight', 'Ash', [{ verb: 'shoot', target: 'EnemyHealer' }]],
	['lookup', 'Mia', [{ verb: 'go_to', target: 'Hilda' }, { verb: 'offer', to: 'Hilda', give: { gold: 3 }, get: { Bread: 1 } }]],
	['chain', 'Hob', [{ verb: 'pick_up', item: 'IronKey' }, { verb: 'use', item: 'IronKey', target: 'IronDoor' }]],
	['trade', 'Tam', [{ verb: 'offer', to: 'Grocer', give: { Egg: 3 }, get: { gold: 6 } }]],
	['social', 'Ada', [{ verb: 'pick_up', item: 'Lantern' }, { verb: 'give', item: 'Lantern', to: 'Player' }]],
	['social', 'Mia', [{ verb: 'flee', from: 'Thief' }]],
	['fight', 'Cinder', [{ verb: 'use', item: 'HealingPotion' }, { verb: 'hex', target: 'EnemyBlade' }]],
	['lookup', 'Ren', [{ verb: 'go_to', target: 'Mill' }]],
	['chain', 'Kip', [{ verb: 'use', item: 'Flint', target: 'Torch' }, { verb: 'pick_up', item: 'SilverRing' }]],
	['trade', 'Wil', [{ verb: 'offer', to: 'Pell', give: { Scarf: 1 }, get: { gold: 6 } }]],
	['social', 'Ned', [{ verb: 'go_to', target: 'Smith' }, { verb: 'say', text: 'The Captain needs 3 Swords by dusk.', to: 'Smith' }]],
	['social', 'Bo', [{ verb: 'offer', to: 'Smith', give: { gold: 5 }, get: { Sword: 1 } }, { verb: 'give', item: 'Sword', to: 'Player' }]],
	['social', 'Forager', [
		{ verb: 'pick_up', item: 'FireMushroom' },
		{ verb: 'give', item: 'FireMushroom', to: 'BridgeKeeper' },
		{ verb: 'wait', seconds: 2 },
		{ verb: 'offer', to: 'Angler', give: { gold: 5 }, get: { SilverTrout: 1 } },
	]],
	['fight', 'Wisp', [{ verb: 'go_to', target: 'Boulder' }, { verb: 'shoot', target: 'EnemyWitch' }]],
	['lookup', 'Pip', [{ verb: 'pick_up', item: 'Emberkap' }, { verb: 'give', item: 'Emberkap', to: 'Witch' }]],
];

describe('bench', () => {
	it('benches a System One per skill, each case in both orders, so a slot favorite scores half', async () => {
		const asked:[string, Record<string, string>][] = [];
		const first:SystemOne = { pick: async (state, _g, criteria) => {
			asked.push([state, criteria]);
			return Object.keys(criteria)[0];
		} };
		const scene = { me: { id: 'Ash', hp: [12, 12] as [number, number] }, doing: 'go_to', goal: 'g', things: { Keep: { away: 3, side: 'ahead' as const } } };
		const cases:DecisionCase[] = [
			{ ...scene, skill: 'tactics', level: 1, choices: { a: 'go_to(Keep)', b: 'wait()' }, answer: 'a' },
			{ ...scene, skill: 'social', level: 3, choices: { a: 'go_to(Keep)', b: 'wait()' }, answer: 'b' },
		];
		const progress:number[] = [];
		const score = await benchSystemOne(first, cases, (done) => progress.push(done));
		assert.deepEqual(asked[0], ['You are Ash, 12/12 hp.\nDoing: go_to.', { a: 'go_to(Keep) — Keep 3 away, ahead', b: 'wait()' }], 'worded as the director words it');
		assert.deepEqual(score.skills, { tactics: { right: 1, total: 2 }, social: { right: 1, total: 2 } });
		assert.deepEqual(score.levels, { 1: { right: 1, total: 2 }, 2: { right: 0, total: 0 }, 3: { right: 1, total: 2 } });
		assert.deepEqual(progress, [0, 1, 2, 3, 4], '0 once the warm-up (a model load) is over');
		assert.equal(asked.length, 5, 'one untimed warm-up pick first, so loading the model is not timed');
		assert.equal(score.failed, 0);
		const broken = await benchSystemOne({ pick: async () => { throw new Error('down'); } }, cases);
		assert.equal(broken.failed, 4);
		assert.equal(broken.error, 'down');
		const lost = await benchSystemOne({ pick: async () => 'c' }, cases);
		assert.equal(lost.failed, 4, 'a pick that names no choice fails');
	});

	it('every arc case can be won: a good arc reaches its goal, and doing nothing does not', async () => {
		const good = GOOD.map(([skill, id, steps]):[ArcCase, Steps] => [arcCase(skill, id), steps]);
		assert.equal(good.length, ARC_BENCH.length);
		assert.equal(await reached(good), ARC_BENCH.length);
		assert.equal(await reached(ARC_BENCH.map((c) => [c, [{ verb: 'wait', seconds: 1 }]])), 0);
	});

	it('scores where an arc gets, not what it says', async () => {
		const wrong:[ArcCase, Steps][] = [
			// Killed the wrong one first.
			[arcCase('fight', 'Ash'), [{ verb: 'shoot', target: 'EnemyBlade' }, { verb: 'shoot', target: 'EnemyHealer' }]],
			// Fought before drinking, and fell.
			[arcCase('fight', 'Cinder'), [{ verb: 'hex', target: 'EnemyBlade' }, { verb: 'use', item: 'HealingPotion' }]],
			// Shot through the cover.
			[arcCase('fight', 'Wisp'), [{ verb: 'shoot', target: 'EnemyWitch' }]],
			// Took the low price.
			[arcCase('trade', 'Wil'), [{ verb: 'offer', to: 'Pell', give: { Scarf: 1 }, get: { gold: 4 } }]],
			// Paid, but got no Loaf.
			[arcCase('trade', 'Mia'), [{ verb: 'give', item: 'gold', to: 'Baker', quantity: 5 }]],
			// Talked while robbed.
			[arcCase('social', 'Mia'), [{ verb: 'say', text: 'No!', to: 'Thief' }]],
			// Kept the Lantern.
			[arcCase('social', 'Ada'), [{ verb: 'pick_up', item: 'Lantern' }]],
			// Used a key it did not hold.
			[arcCase('chain', 'Ren'), [{ verb: 'use', item: 'RedKey', target: 'VaultDoor' }]],
			// Groped in the dark.
			[arcCase('chain', 'Kip'), [{ verb: 'pick_up', item: 'SilverRing' }]],
			// Walked to the river, and the bridge was up.
			[arcCase('social', 'Forager'), [{ verb: 'offer', to: 'Angler', give: { gold: 5 }, get: { SilverTrout: 1 } }]],
		];
		assert.equal(await reached(wrong), 0);
		assert.equal(await reached([
			// Paid the keeper the trout money, which lowers nothing.
			[arcCase('social', 'Forager'), [{ verb: 'give', item: 'gold', to: 'BridgeKeeper', quantity: 5 }, { verb: 'offer', to: 'Angler', give: { gold: 5 }, get: { SilverTrout: 1 } }]],
		]), 0);
		assert.equal(await reached([
			// What comes after the goal does not undo it.
			[arcCase('fight', 'Ash'), [{ verb: 'shoot', target: 'EnemyHealer' }, { verb: 'protect', target: 'EnemyBlade' }]],
			// The Guard keeps her gold as well as running does.
			[arcCase('social', 'Mia'), [{ verb: 'go_to', target: 'Guard' }]],
		]), 2);
	});

	it('thinks again after an arc that falls short, as in play', async () => {
		let thinks = 0;
		const prompts:string[] = [];
		const score = await benchArcs(fake((req) => {
			prompts.push(chatContentText(req.messages.at(-1)?.content));
			thinks += 1;
			return thinks % 2 === 1 ? reply({ verb: 'go_to', target: 'Boulder' }) : reply({ verb: 'shoot', target: 'EnemyWitch' });
		}), [arcCase('fight', 'Wisp')]);
		assert.equal(score.levels[3].right, 1, 'walked over, then shot');
		assert.equal(thinks, 4, 'two thinks, after a warm-up of two');
		assert.match(prompts[3] ?? '', /Last verb result: go_to ok/, 'told how the walk went');
		assert.match(prompts[3] ?? '', /Boulder 1 pace/, 'and sees from where it stands now');
	});

	it('hides what is out of sight from the prompt, so only a lookup finds it', async () => {
		const prompts = new Map<ArcCase, string>();
		await benchArcs(fake((req) => {
			const c = caseOf(req, ARC_BENCH);
			prompts.set(c, prompts.get(c) ?? req.messages.map((m) => chatContentText(m.content)).join('\n'));
			return reply({ verb: 'wait' });
		}), ARC_BENCH);
		for (const c of ARC_BENCH) {
			const said = [c.goal, ...(c.heard ?? []).map((line) => line.text), ...(c.memories ?? []).map((m) => m.text)].join(' ');
			const far = Object.entries({ ...c.others, ...c.things }).filter(([name, spot]) => spot.away > 24 && !said.includes(name));
			for (const [name] of far) {
				assert.equal(prompts.get(c)?.includes(name), false, `${c.me.id}'s prompt names ${name}`);
			}
		}
	});

	it('times only the think, and counts a think that throws as failed', async () => {
		const down = await benchArcs(fake(() => {
			throw new Error('down');
		}), [arcCase('chain', 'Ren')]);
		assert.equal(down.failed, 1);
		assert.equal(down.error, 'down');
		const slow = await benchArcs(fake(() => reply({ verb: 'follow', target: 'Player' })), [arcCase('social', 'Lin')]);
		assert.ok(slow.msPerTrial < 1000, 'a minute of play is not the model\'s time');
	});
});
