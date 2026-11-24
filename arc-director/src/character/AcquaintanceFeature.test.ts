import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ArcDirector } from '../director/ArcDirector.js';
import '../director/shortcuts.js';
import type { CharacterSpec } from '../director/director-types.js';
import { dummyEntity } from '../expr/natives.js';
import type { FakeChatFn } from '../inference/fake.js';
import { OPEN_WORLD } from '../testing/open-world.js';
import { Axes } from '../world/axes.js';
import type { Vec } from '../world/world-types.js';
import { AcquaintanceFeature, type AcquaintanceOptions } from './AcquaintanceFeature.js';
import { Knows, NameBook } from './NameBook.js';
import { internalsOf } from '../internals.js';

type Ctx = { id:string };

/**
 * Ada at the origin, Bram 3 paces north of her and Cy beside him, everyone in earshot and facing `facing` (south, so
 * Bram and Cy face Ada, by default). `acquaintance` makes who knows whom the game's; `specs` adds to each one's spec;
 * Ada and Cy think.
 */
function scene(acquaintance:AcquaintanceOptions<Ctx> | undefined, specs:Record<string, Partial<CharacterSpec<Ctx>>> = {}, facing:Record<string, Vec> = {}, chat?:FakeChatFn) {
	const points:Record<string, Vec> = { Ada: [0, 0], Bram: [0, -3], Cy: [2, -3] };
	const face = (id:string):Vec => facing[id] ?? [0, 1];
	const others = (id:string):string[] => Object.keys(points).filter((other) => other !== id);
	return new ArcDirector<Ctx>()
		.addFake(chat ? { chat } : {})
		.withMind({ arcFormat: 'text', repairRetries: 2 })
		.withVerbs((v) => v.addStock())
		.withDefaultKit({ verbs: ['wait', 'say'] })
		.withWorld({ ...OPEN_WORLD, geometry: { axes: Axes.Plane, getPose: (id) => ({ point: points[String(id)] ?? [0, 0], facing: face(String(id)) }) } })
		.withContext((id) => (points[id] ? { id } : undefined))
		.withSight({ look: ({ id }) => ({ self: { id, point: points[id], facing: face(id) }, objects: others(id).map((other) => ({ id: other, point: points[other], facing: face(other), tags: ['character'] })) }) })
		.withKernels(({ id }) => ({ me: dummyEntity(id), others: others(id).map((other) => dummyEntity(other)), items: [], nearRadius: 5 }))
		.withTalk({ others, inRange: () => true })
		.if(acquaintance,
			(d) => d.withAcquaintance(acquaintance),
		)
		.addCharacter({ id: 'Ada', mind: { rethinkingThreshold: 0 }, ...specs.Ada })
		.addCharacter({ id: 'Bram', ...specs.Bram })
		.addCharacter({ id: 'Cy', mind: { rethinkingThreshold: 0 }, ...specs.Cy });
}

/** What `id`'s mind sees now. */
function sight(director:ArcDirector<Ctx>, id:string):string {
	return String(director.senses.all.sight({ id }, director.character(id)!.mind!));
}

describe('who knows whom', () => {
	it('sees a stranger under a label of its own until it hears the name said face on, and remembers learning it', async () => {
		const director = await scene({}).connect();
		const ada = director.character('Ada')!.mind!;
		assert.match(sight(director, 'Ada'), /StrangerA/);
		assert.doesNotMatch(sight(director, 'Ada'), /Bram/);
		director.getTalk()!.say('Bram', 'Well met. I\'m Bram.', 'Ada', 1);
		assert.match(sight(director, 'Ada'), /Bram/);
		assert.doesNotMatch(sight(director, 'Ada'), /StrangerA/);
		assert.ok(ada.events().some((e) => e.text === 'You learned that StrangerA is Bram.'), 'a name it learns, it remembers');
		assert.deepEqual(director.getAcquaintance()!.of('Ada', 'Bram').sort(), [Knows.Look, Knows.Name, Knows.Voice]);
		director.dispose();
	});

	it('ties a voice to a look only face on: a name said with its back turned is the voice\'s', async () => {
		const facing:Record<string, Vec> = { Bram: [0, -1] };
		const director = await scene({}, {}, facing).connect();
		const ada = director.character('Ada')!.mind!;
		const talk = director.getTalk()!;
		assert.match(sight(director, 'Ada'), /StrangerA/);
		talk.say('Bram', 'I am Bram, and I am leaving.', 'Ada', 1);
		assert.match(sight(director, 'Ada'), /StrangerA/, 'his face unseen: whose look that is, she does not know');
		talk.say('Bram', 'Still here.', 'Ada', 2);
		assert.equal(ada.events().at(-1)?.text, 'Bram says to you: "Still here."', 'the voice that said its name is his');
		facing.Bram = [0, 1];
		talk.say('Bram', 'Over here.', 'Ada', 3);
		assert.match(sight(director, 'Ada'), /Bram/, 'seen speaking face on: the voice she knows is that look');
		director.dispose();
	});

	it('keeps a name heard from behind for the voice, apart from a face it saw, until it sees that face speak', async () => {
		const facing:Record<string, Vec> = {};
		const director = await scene({}, {}, facing).connect();
		const ada = director.character('Ada')!.mind!;
		const talk = director.getTalk()!;
		assert.match(sight(director, 'Ada'), /StrangerA/, 'his face, seen: a look of its own');
		facing.Bram = [0, -1];
		talk.say('Bram', 'I am Bram.', 'Ada', 1);
		assert.equal(ada.events().at(-1)?.text, 'Bram says to you: "I am Bram."', 'the name is the voice\'s from its first word: no label stood for it');
		talk.say('Bram', 'Still here.', 'Ada', 2);
		assert.equal(ada.events().at(-1)?.text, 'Bram says to you: "Still here."');
		assert.match(sight(director, 'Ada'), /StrangerA/, 'the face is not yet tied to it');
		facing.Bram = [0, 1];
		talk.say('Bram', 'Look at me.', 'Ada', 3);
		assert.match(sight(director, 'Ada'), /Bram/);
		assert.ok(ada.events().some((e) => e.text === 'You learned that StrangerA is Bram.'), 'seen speaking: the face is his');
		director.dispose();
	});

	it('keeps a name it could not tell as that name: a watch finds no one by it until it learns who that is', async () => {
		const asked:string[] = [];
		const director = await scene({}, {}, {}, (req) => {
			asked.push(String(req.messages.at(-1)?.content));
			return { content: 'wait(until=isNear(me, Bram, 5))', toolCalls: [] };
		}).connect();
		sight(director, 'Ada');
		const arc = await director.character('Ada')!.mind!.thinkNow({ enact: false });
		assert.equal(asked.length, 1, 'no repair: it waits for Bram, whoever that is');
		assert.equal(arc?.[0]?.args.until, 'isNear(me, $Bram, 5)');
		for (const watch of ['isNear(me, $Bram, 5)', 'some(others.filter("$Bram"))']) {
			assert.equal(director.isMet('Ada', watch), false, `${watch}: Bram stands 3 paces off, but she does not know him`);
		}
		director.getTalk()!.say('Bram', 'I\'m Bram.', 'Ada', 1);
		for (const watch of ['isNear(me, $Bram, 5)', 'some(others.filter("$Bram"))']) {
			assert.equal(director.isMet('Ada', watch), true, `${watch}: now she does`);
		}
		director.dispose();
	});

	it('learns the name of one another points out, or speaks to by name, where it sees their face', async () => {
		// Bram faces east, toward Cy beside him; Ada knows him.
		const facing:Record<string, Vec> = { Bram: [1, 0] };
		const director = await scene({ circles: [['Ada', 'Bram']] }, {}, facing).connect();
		const cy = director.character('Cy')!.mind!;
		const talk = director.getTalk()!;
		// She points out whom she sees.
		sight(director, 'Ada');
		assert.match(sight(director, 'Cy'), /StrangerA/);
		talk.say('Ada', 'Bram is coming to the fair later.', 'Cy', 1);
		assert.match(sight(director, 'Cy'), /StrangerA/, 'a name in passing points at no one');
		talk.say('Ada', 'That is my friend Bram, the smith.', 'Cy', 2);
		assert.match(sight(director, 'Cy'), /Bram/);
		assert.ok(cy.events().some((e) => /^You learned that Stranger[AB] is Bram.$/.test(e.text)));
		director.dispose();
	});

	it('learns a name pointed out by one with no mind, whom the game speaks for', async () => {
		// Bram (no mind) knows Ada; she faces Cy.
		const director = await scene({ circles: [['Bram', 'Ada']] }, {}, { Ada: [1, -1] }).connect();
		assert.match(sight(director, 'Cy'), /StrangerA/);
		director.getTalk()!.say('Bram', 'That is my friend Ada.', 'Cy', 1);
		assert.match(sight(director, 'Cy'), /Ada/);
		director.dispose();
	});

	it('learns a name said to its owner, and none whose face it cannot see', async () => {
		const facing:Record<string, Vec> = { Bram: [1, 0] };
		const director = await scene({ circles: [['Ada', 'Bram']] }, {}, facing).connect();
		const talk = director.getTalk()!;
		sight(director, 'Ada');
		sight(director, 'Cy');
		facing.Bram = [-1, 0];
		talk.say('Ada', 'Meet Bram, our smith.', 'Cy', 1);
		assert.match(sight(director, 'Cy'), /StrangerA/, 'his back to her: which one is Bram, she cannot tell');
		facing.Bram = [1, 0];
		talk.say('Ada', 'Bram, come over here.', 'Bram', 2);
		assert.match(sight(director, 'Cy'), /Bram/, 'said to him, by name, face on');
		director.dispose();
	});

	it('says its labels aloud as what they are, never as names: no one else knows them', async () => {
		const director = await scene({}).connect();
		sight(director, 'Ada');
		const names = director.character('Ada')!.persona.names;
		const [bram, cy] = [names.peek('Bram')!, names.peek('Cy')!];
		assert.match(`${bram} ${cy}`, /^Stranger[AB] Stranger[AB]$/);
		director.getTalk()!.say('Ada', `${cy}, do you know ${bram}?`, 'Cy', 1);
		assert.match(director.character('Cy')!.mind!.events().at(-1)?.text ?? '', /: "Stranger, do you know that stranger\?"$/);
		director.dispose();
	});

	it('knows whom its circles, its collective and its spec say, one way', async () => {
		const director = await scene({ circles: [['Ada', 'Bram']] }, { Cy: { knows: { Ada: [Knows.Look] } } }).connect();
		assert.match(sight(director, 'Ada'), /Bram/);
		assert.match(sight(director, 'Ada'), /StrangerA/, 'Cy, in no circle with her');
		assert.match(sight(director, 'Cy'), /StrangerA/, 'her look alone');
		assert.deepEqual(director.getAcquaintance()!.of('Cy', 'Ada'), [Knows.Look]);
		assert.deepEqual(director.getAcquaintance()!.of('Bram', 'Cy'), []);
		director.dispose();
	});

	it('knows the voices its spec says, by rules of who knows whom or by none', async () => {
		for (const rules of [{}, undefined]) {
			for (const knows of [{ Bram: true as const }, undefined]) {
				// Bram speaks with his back to her: a voice she never saw speak is a stranger's.
				const director = await scene(rules, { Ada: { knows } }, { Bram: [0, -1] }).connect();
				director.getTalk()!.say('Bram', 'Still here.', 'Ada', 1);
				assert.equal(director.character('Ada')!.mind!.events().at(-1)?.text, `${knows ? 'Bram' : 'VoiceA'} says to you: "Still here."`, `rules: ${!!rules}`);
				director.dispose();
			}
		}
	});

	it('knows as a collective what its characters\' specs say, and by rules its characters know each other wholly', async () => {
		for (const rules of [{}, undefined]) {
			const director = await scene(rules, { Cy: { knows: { Ada: [Knows.Voice] } } }).addCollective({ id: 'Pair', mind: {} }).connect();
			const pair = director.collective('Pair')!;
			director.character('Bram')!.collective = pair;
			director.character('Cy')!.collective = pair;
			assert.deepEqual([...pair.persona.names.knows('Ada')].sort(), rules ? [Knows.Voice] : [Knows.Look, Knows.Name, Knows.Voice]);
			assert.deepEqual([...director.character('Bram')!.persona.names.knows('Cy')].sort(), rules ? [Knows.Look, Knows.Name, Knows.Voice] : [Knows.Look, Knows.Name]);
			director.dispose();
		}
	});

	it('learns what the host introduces', async () => {
		const director = await scene({}).connect();
		assert.match(sight(director, 'Ada'), /StrangerA/);
		director.getAcquaintance()!.introduce('Bram', 'Ada');
		assert.match(sight(director, 'Ada'), /Bram/);
		assert.ok(director.character('Ada')!.mind!.events().some((e) => e.text === 'You learned that StrangerA is Bram.'));
		director.dispose();
	});

	it('passes on a name said aloud as the word it was, never as whom the listener sees', async () => {
		const director = await scene({ circles: [['Ada', 'Bram'], ['Ada', 'Cy']] }).connect();
		assert.match(sight(director, 'Cy'), /StrangerA/);
		director.getTalk()!.say('Ada', 'Bram took the bread.', 'Cy', 1);
		assert.equal(director.character('Cy')!.mind!.events().at(-1)?.text, 'Ada says to you: "Bram took the bread."');
		assert.match(sight(director, 'Cy'), /StrangerA/, 'a name heard is no face');
		director.dispose();
	});

	it('runs a step aimed by a name it could not tell only once it can: who that is, it finds as the step starts', async () => {
		const waved:string[] = [];
		const director = await scene({}, {}, {}, () => ({ content: 'wave(Bram)', toolCalls: [] }))
			.withVerbs((v) => v.add('wave', { args: { target: 'id' } }))
			.withDefaultKit({ verbs: ['wait', 'say', 'wave'] })
			.onVerb((call) => {
				waved.push(String(call.args.target));
				return { status: 'ok', verb: call.verb };
			})
			.connect();
		const ada = director.character('Ada')!;
		sight(director, 'Ada');
		const arc = (await ada.mind!.thinkNow({ enact: false }))!;
		assert.equal(arc[0].args.target, '$Bram');
		const before = await ada.enact(arc);
		assert.match(String(before.reason), /you do not know which one is Bram yet: ask who people are/);
		director.getTalk()!.say('Bram', 'I\'m Bram.', 'Ada', 1);
		const after = await ada.enact(arc);
		assert.equal(after.status, 'ok');
		assert.deepEqual(waved, ['Bram'], 'once she knows him, the host gets him');
		director.dispose();
	});

	it('forgets that it could not tell someone by name once it can: its memory, recent lines, last result and waiting events', async () => {
		const director = await scene({}, {}, {}, () => ({ content: 'wave(Bram)', toolCalls: [] }))
			.withVerbs((v) => v.add('wave', { args: { target: 'id' } }))
			.withDefaultKit({ verbs: ['wait', 'say', 'wave'] })
			.onVerb((call) => ({ status: 'ok', verb: call.verb }))
			.connect();
		const ada = director.character('Ada')!;
		const mind = ada.mind!;
		sight(director, 'Ada');
		const failed = await ada.enact((await mind.thinkNow({ enact: false }))!);
		const notYet = /do not know which one is Bram yet/;
		const kept = ():string[] => ada.persona.memory.all().map((r) => r.text).filter((text) => notYet.test(text));
		mind.ingestResult(failed);
		internalsOf(mind.memory).absorb();
		assert.equal(kept().length, 1, 'a failure is kept');
		assert.ok(mind.memory.talkedOf().some((line) => notYet.test(line)));
		mind.ingestResult(failed);
		director.getTalk()!.say('Bram', 'I\'m Bram.', 'Ada', 1);
		assert.deepEqual(kept(), []);
		assert.ok(!mind.memory.talkedOf().some((line) => notYet.test(line)));
		assert.equal(mind.lastResult, undefined);
		assert.ok(!mind.events().some((e) => notYet.test(e.text)), 'the one it had yet to think over too');
		assert.ok(mind.events().some((e) => e.text === 'You learned that StrangerA is Bram.'));
		director.dispose();
	});
});

describe('introductions', () => {
	const acquaintance = new AcquaintanceFeature();

	it('hears a name said of oneself, in any of the ways people say it', () => {
		for (const line of ['I\'m Bram.', 'Name\'s Bram, and yours?', 'It\'s me, Bram!', 'Folks call me Bram', 'My name is Bram.', 'I am Bram']) {
			assert.equal(acquaintance.introduces('Bram', line), true, line);
		}
		assert.equal(acquaintance.introduces('JoeTheBaker', 'Hi! I\'m Joe the baker.'), true, 'a name of words, written apart');
	});

	it('reads a name another points out, in the ways models say it', async () => {
		const director = await scene({ circles: [['Ada', 'Bram']] }).connect();
		const introduced = (line:string, to:string[] = []):string[] => internalsOf(director.getAcquaintance()!).introduced('Ada', line, to);
		for (const line of ['That is my friend Bram, the blacksmith.', 'That over there is Bram.', 'This is Bram!', 'He\'s Bram.', 'Meet our friend Bram.', 'Welcome! I\'m Hilde, and this is Bram.']) {
			assert.deepEqual(introduced(line), ['Bram'], line);
		}
		for (const line of ['Bram is coming later.', 'Have you seen Bram?', 'That is not Bram.']) {
			assert.deepEqual(introduced(line), [], line);
		}
		assert.deepEqual(introduced('Bram, come here.', ['Bram']), ['Bram'], 'said to him, by name');
		director.dispose();
	});

	it('takes no other mention for one', () => {
		for (const line of ['The guard captain wants you.', 'Guard duty is dull.', 'I am the guard here.', '"I\'m Guard," he said.', 'Guard, I am.']) {
			assert.equal(acquaintance.introduces('Guard', line), false, line);
		}
	});
});

describe('NameBook acquaintance', () => {
	it('ties only what shares something with what it knew, and keeps what it learned in its save', () => {
		const book = new NameBook();
		book.knowsByRule = () => [];
		assert.deepEqual(book.learn('Bram', [Knows.Voice, Knows.Name]), [Knows.Voice, Knows.Name], 'knowing nothing, anything');
		assert.deepEqual(book.learn('Bram', [Knows.Look]), [], 'a look alone ties to neither: a way of its own');
		assert.equal(book.tells('Bram'), false);
		assert.deepEqual(book.learn('Bram', [Knows.Look, Knows.Voice]), [Knows.Look, Knows.Voice, Knows.Name], 'seen speaking: the voice ties the look to the name');
		assert.equal(book.tells('Bram'), true);
		const saved = new NameBook();
		saved.knowsByRule = () => [];
		saved.load(JSON.parse(JSON.stringify(book.toJSON())));
		assert.deepEqual([...saved.knows('Bram')].sort(), [Knows.Look, Knows.Name, Knows.Voice]);
	});
});
