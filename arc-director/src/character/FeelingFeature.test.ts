import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseArcText } from '../arc/arc-parse.js';
import { replySchema } from '../arc/schema.js';
import { validateArc } from '../arc/validate.js';
import { ArcDirector } from '../director/ArcDirector.js';
import '../director/shortcuts.js';
import { dummyEntity } from '../expr/natives.js';
import type { SpeechUtterance } from '../mind/talk.js';
import { sleep } from '../turn.js';
import { Feeling, type FeelingDef, type FeelingMap } from './feeling.js';

type Ctx = { id:string };

const CAST = ['Ash', 'Angler', 'Wolf'];

/** Ash, a mind that sees Angler (3/12 hp) and hears everyone; Angler and Wolf, no minds. Every prompt, line and feeling told is kept. */
async function staged(feelings?:FeelingMap<FeelingDef>):Promise<{
	director:ArcDirector<Ctx>;
	prompts:string[];
	spoken:SpeechUtterance[];
	told:[string, Feeling | undefined][];
}> {
	const prompts:string[] = [];
	const spoken:SpeechUtterance[] = [];
	const told:[string, Feeling | undefined][] = [];
	const director = await new ArcDirector<Ctx>()
		.withPriorityThinkQueue({ processInterval: 0, rethinkInterval: 0.01 })
		.withIntervals({ watch: 0, think: 0 })
		.addFake({ chat: (req) => {
			prompts.push(req.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n'));
			return { content: JSON.stringify({ steps: [{ verb: 'wait' }] }), toolCalls: [] };
		} })
		.withVerbs((v) => v.addStock())
		.withDefaultKit({ verbs: ['say', 'wait', 'express'] })
		.withContext((id) => ({ id }))
		.withKernels(({ id }) => ({ me: dummyEntity(id), others: CAST.filter((o) => o !== id).map((o) => dummyEntity(o)), items: [] }))
		.withSight({ look: ({ id }) => ({ self: { id, point: [0, 0] }, objects: id === 'Ash' ? [{ id: 'Angler', point: [3, 0], tags: ['character'], hp: 3, maxHP: 12 }] : [] }) })
		.withTalk({
			inRange: () => true,
			others: (id) => CAST.filter((o) => o !== id),
			tones: { growl: { says: 'growls', words: 0.6 } },
			onSpoke: (line) => spoken.push(line),
		})
		.withFeelings({ ...feelings ? { feelings } : {}, onFeeling: (id, feeling) => told.push([id, feeling]) })
		.addCharacter({ id: 'Angler' })
		.addCharacter({ id: 'Wolf' })
		.addCharacter({ id: 'Ash', mind: { rethinkingThreshold: 0, skipStrategic: true }, identity: { role: 'Watches.' } })
		.connect();
	return { director, prompts, spoken, told };
}

async function firstPrompt(prompts:string[]):Promise<string> {
	for (let t = 0; prompts.length === 0; t += 10) {
		assert.ok(t < 400, 'no think');
		await sleep(10);
	}
	return prompts[0];
}

describe('spoken lines', () => {
	it('hands the host a line for the screen in the names its speaker gave, in pieces when asked', async () => {
		const { director, spoken } = await staged();
		const names = director.character('Ash')!.persona.names;
		names.name('Angler', 'OldAngler', { character: true });
		names.name('Rod', 'FishingRod');
		director.getTalk()!.say('Ash', 'OldAngler, pass the FishingRod.', 'Angler', director.time);
		assert.equal(spoken[0]?.text, 'Old Angler, pass the fishing rod.');
		assert.deepEqual(spoken[0]?.segments(), [{ text: 'Old Angler', id: 'Angler' }, { text: ', pass the ' }, { text: 'fishing rod', id: 'Rod' }, { text: '.' }]);
		director.dispose();
	});
});

describe('FeelingFeature', () => {
	it('shows a feeling in sight, in a heard line and in the transcript beside the tone, and teaches express', async () => {
		const { director, prompts, spoken } = await staged();
		const feelings = director.getFeelings()!;
		feelings.express('Angler', 'angry');
		feelings.express('Wolf', 'angry');
		director.getTalk()!.say('Wolf', 'Leave my den.', 'Ash', director.time, 'growl');
		assert.equal(spoken[0]?.as, 'growl');
		assert.equal(spoken[0]?.feeling, 'angry');
		// Out of its sight: a voice it does not know yet.
		assert.deepEqual(director.character('Ash')!.mind!.events().map((e) => e.text), ['VoiceA growls angrily to you: "Leave my den."']);
		director.getTalk()!.say('Angler', 'Go away.', 'Ash', director.time);
		director.tick(1);
		const prompt = await firstPrompt(prompts);
		assert.match(prompt, /Angler \(3\/12 hp, looking angry\)/);
		assert.match(prompt, /VoiceA \(growls angrily, to you\): Leave my den\./);
		assert.match(prompt, /Angler \(says angrily, to you\): Go away\./, 'a feeling with no tone is said');
		assert.match(prompt, /When something moves you, show it: express\(feeling\)\./);
		assert.match(prompt, /one of happy\/sad\/angry\/afraid\/surprised\/disgusted/);
		director.dispose();
	});

	it('takes a game\'s own set in place of the stock one: express, its check and its schema list exactly those', async () => {
		const { director, prompts } = await staged({ calm: { looking: 'calm', adverb: 'calmly' }, furious: { looking: 'furious', adverb: 'furiously' } });
		const valid = (arc:string):boolean => validateArc(parseArcText(arc, director.verbs), director.verbs) === undefined;
		assert.deepEqual(director.verbs.get('express')!.args.feeling.names, ['calm', 'furious']);
		assert.ok(valid('express(feeling=furious)'));
		assert.throws(() => valid('express(feeling=happy)'), /feeling is one of calm, furious; happy is not/);
		const schema = JSON.stringify(replySchema(director.verbs));
		assert.ok(schema.includes('"furious"') && !schema.includes('"happy"'));
		assert.equal(director.getFeelings()!.express('Angler', 'happy'), false);
		director.getFeelings()!.express('Angler', 'furious');
		director.tick(1);
		const prompt = await firstPrompt(prompts);
		assert.match(prompt, /one of calm\/furious\b/);
		assert.match(prompt, /Angler \(3\/12 hp, looking furious\)/);
		director.dispose();
	});

	it('shows a feeling the host set until it fades or another replaces it, and feeling(u) reads it', async () => {
		const { director, told } = await staged();
		const feelings = director.getFeelings()!;
		feelings.express('Angler', 'afraid', 10);
		assert.equal(feelings.of('Angler'), 'afraid');
		assert.ok(director.isMet('Ash', 'feeling(Angler) == "afraid"'));
		director.tick(4);
		feelings.express('Angler', 'surprised', 10);
		director.tick(8);
		assert.equal(feelings.of('Angler'), 'surprised');
		director.tick(3);
		assert.equal(feelings.of('Angler'), undefined);
		assert.ok(director.isMet('Ash', 'feeling(Angler) == ""'));
		assert.deepEqual(told, [['Angler', 'afraid'], ['Angler', 'surprised'], ['Angler', undefined]]);
		director.dispose();
	});

	it('tells a mind first of all how its character feels, as feel words it, and nothing while it shows none', async () => {
		const { director, prompts } = await staged();
		director.getFeelings()!.express('Ash', 'sad');
		director.tick(1);
		assert.match(await firstPrompt(prompts), /\nYou feel sad: say what you would say in that mood, and do as you would anyway\.\n/);
		director.getFeelings()!.configure({ feel: (id, feeling) => (feeling === 'sad' ? undefined : `${id} is ${feeling}.`) });
		prompts.length = 0;
		await director.character('Ash')!.mind!.thinkNow({ enact: false });
		assert.doesNotMatch(prompts[0], /You feel/, 'spared');
		director.dispose();
	});

	it('shows the feeling a verb stirs as a character starts it, as when decides for each', async () => {
		const told:[string, Feeling | undefined][] = [];
		const director = await new ArcDirector<Ctx>()
			.addFake({ chat: () => ({ content: '', toolCalls: [] }) })
			.withVerbs((v) => v.addStock().add('read', { args: {} }))
			.withDefaultKit({ verbs: ['wait', 'read'] })
			.withContext((id) => ({ id }))
			.withFeelings({
				on: { read: Feeling.Happy },
				when: ({ character }, feeling) => ({ Ash: feeling, Wolf: Feeling.Disgusted })[character.id],
				onFeeling: (id, feeling) => told.push([id, feeling]),
			})
			.onVerb((call) => ({ status: 'ok', verb: call.verb }))
			.addCharacter({ id: 'Ash' })
			.addCharacter({ id: 'Wolf' })
			.addCharacter({ id: 'Angler' })
			.connect();
		for (const id of CAST) {
			assert.equal((await director.character(id)!.enact([{ verb: 'read', args: {} }])).status, 'ok');
		}
		assert.deepEqual(told, [['Ash', 'happy'], ['Wolf', 'disgusted']], 'Angler: when said none');
		director.dispose();
	});

	it('feels several feelings at once, shows the strongest stirred, and never fades below a standing one, which shows only once stirred', async () => {
		const director = await new ArcDirector<Ctx>()
			.addFake({ chat: () => ({ content: '', toolCalls: [] }) })
			.withVerbs((v) => v.addStock())
			.withDefaultKit({ verbs: ['wait'] })
			.withContext((id) => ({ id }))
			.withFeelings({ seconds: 10 })
			.addCharacter({ id: 'Ash', disposition: { afraid: 0.3, stressed: 0.3 } })
			.connect();
		const feelings = director.getFeelings()!;
		assert.deepEqual(feelings.levelsOf('Ash'), { afraid: 0.3, stressed: 0.3 });
		assert.equal(feelings.of('Ash'), undefined, 'a paranoid one does not look afraid all day');
		feelings.stir('Ash', { happy: 0.6, stressed: 0.4 });
		assert.deepEqual(feelings.levelsOf('Ash'), { happy: 0.6, stressed: 0.7, afraid: 0.3 });
		assert.equal(feelings.of('Ash'), 'stressed', 'the strongest');
		const stirred = feelings.stirredOf('Ash');
		assert.deepEqual(Object.keys(stirred), ['happy', 'stressed']);
		assert.ok(Math.abs(stirred.stressed! - 0.4) < 1e-9, 'what a memory kept now is kept with: not the standing part');
		director.tick(20);
		assert.deepEqual(feelings.levelsOf('Ash'), { afraid: 0.3, stressed: 0.3 }, 'faded back to standing');
		assert.equal(feelings.of('Ash'), undefined);
		director.dispose();
	});

	it('stirs each character as its temperament lets it, shows in full what it expresses, and stirs one with no feelings not at all', async () => {
		const director = await new ArcDirector<Ctx>()
			.addFake({ chat: () => ({ content: '', toolCalls: [] }) })
			.withVerbs((v) => v.addStock())
			.withDefaultKit({ verbs: ['wait'] })
			.withContext((id) => ({ id }))
			.withFeelings({ hasFeelings: (id) => id !== 'Golem' })
			.addCharacter({ id: 'Hot', temperament: { angry: 2 } })
			.addCharacter({ id: 'Stoic', temperament: 0.3 })
			.addCharacter({ id: 'Golem' })
			.connect();
		const feelings = director.getFeelings()!;
		for (const id of ['Hot', 'Stoic', 'Golem']) {
			feelings.stir(id, { angry: 0.3, sad: 0.5 });
		}
		assert.deepEqual(feelings.levelsOf('Hot'), { angry: 0.6, sad: 0.5 }, 'quick to anger');
		assert.ok(Math.abs(feelings.levelOf('Stoic', 'sad') - 0.15) < 1e-9, 'stoic');
		assert.deepEqual(feelings.levelsOf('Golem'), {});
		assert.equal(feelings.express('Golem', 'angry'), false);
		assert.equal(feelings.express('Stoic', 'angry'), true);
		assert.equal(feelings.levelOf('Stoic', 'angry'), 1, 'what it chooses to show, it shows in full');
		director.dispose();
	});

	it('drops every feeling when the cast is cleared, one on no character too, and tells the host', async () => {
		const { director, told } = await staged();
		const feelings = director.getFeelings()!;
		feelings.express('Bram', 'happy');
		director.dispose();
		assert.equal(feelings.of('Bram'), undefined);
		assert.deepEqual(told.at(-1), ['Bram', undefined]);
	});

	it('keeps a feeling over a save for the time it had left, and tells the host again', async () => {
		const first = await staged();
		first.director.getFeelings()!.express('Angler', 'afraid', 10);
		first.director.tick(4);
		const saved = JSON.parse(JSON.stringify(first.director.exportCast()));
		first.director.dispose();

		const { director, told } = await staged();
		director.getFeelings()!.express('Wolf', 'happy');
		told.length = 0;
		director.restoreCast(saved);
		const feelings = director.getFeelings()!;
		assert.equal(feelings.of('Angler'), 'afraid');
		assert.equal(feelings.of('Wolf'), undefined, 'not in the save');
		assert.deepEqual(told, [['Angler', 'afraid']]);
		director.tick(5);
		assert.equal(feelings.of('Angler'), 'afraid', '9 s of 10');
		director.tick(2);
		assert.equal(feelings.of('Angler'), undefined);
		director.dispose();
	});
});
