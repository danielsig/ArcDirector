import { showNamingText } from '../character/text-with-ids.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MindEvent } from './mind-types.js';
import { VerbRegistry } from '../arc/stock-verbs.js';
import { ArcDirector } from '../director/ArcDirector.js';
import '../director/shortcuts.js';
import { dummyEntity } from '../expr/natives.js';
import { FakeProvider } from '../inference/fake.js';
import { internalsOf } from '../internals.js';
import { OPEN_WORLD } from '../testing/open-world.js';
import { soloCharacter } from '../testing/solo.js';
import { Axes } from '../world/axes.js';
import { TalkFeature } from './TalkFeature.js';
import { TalkInstructions } from './talk.js';

/** A character listening through `talk`, whose mind never thinks: what it was told, as its mind reads it. */
function listener(talk:TalkFeature, id:string):{ readonly events:(MindEvent & { text:string })[] } {
	const mind = soloCharacter({ id, talk, provider: new FakeProvider(() => ({ content: '', toolCalls: [] })), verbs: new VerbRegistry(), kit: { verbs: [] }, context: () => undefined }).mind!;
	return {
		get events() {
			return mind.events();
		},
	};
}

function net(
	range:Set<string>,
	roster:string[],
	onSpoke?:(u:{ text:string; heardBy:string[] })=>void,
):TalkFeature {
	return new TalkFeature({
		inRange: (a, b) => a !== b && (range.has(`${a}:${b}`) || range.has(`${b}:${a}`)),
		others: (speaker) => roster.filter((id) => id !== speaker),
		onSpoke,
	});
}

describe('TalkFeature', () => {
	it('refuses a line said again and again in a row, or echoed word for word right after another said it', () => {
		const range = new Set(['Ann:Bo']);
		const talk = net(range, ['Ann', 'Bo']);
		assert.equal(talk.say('Ann', 'The way is clear, Bo.').status === 'ok', true);
		const again = talk.say('Ann', 'the way is clear Bo!');
		assert.equal(again.status === 'ok', false);
		assert.match(showNamingText(again.reason ?? ''), /you already said this, and it was heard/);
		assert.equal(talk.say('Ann', 'The way is clear, Bo.').status === 'ok', false);
		const echo = talk.say('Bo', 'The way is clear, Bo.');
		assert.equal(echo.status === 'ok', false);
		assert.match(showNamingText(echo.reason ?? ''), /Ann just said this, and it was heard/);
		assert.equal(talk.say('Bo', 'Then lead on.').status === 'ok', true);
		assert.equal(talk.say('Ann', 'Stay close.').status === 'ok', true);
		assert.equal(talk.say('Ann', 'The way is clear, Bo.').status === 'ok', true);
	});

	it('tells a line in the voice it was said in, and asks the host how each listener hears that voice', () => {
		const asked:string[] = [];
		const talk = new TalkFeature({
			inRange: () => true,
			others: (speaker) => ['Ann', 'Bo'].filter((id) => id !== speaker),
			heardAs: (speaker, listener, as) => {
				asked.push(as ?? 'plainly');
				return 'words';
			},
		});
		const bo = listener(talk, 'Bo');
		talk.say('Ann', 'Run!', 'Bo', 0, 'shout');
		assert.equal(bo.events[0]?.text, 'Ann shouts to you: "Run!"');
		assert.ok(asked.length > 0 && asked.every((as) => as === 'shout'));
	});

	it('tells a sob, a sigh and a tone the game added in their own verbs, keeps a muffled scream a scream, and hands the tone to onSpoke', () => {
		const spoken:(string | undefined)[] = [];
		const talk = new TalkFeature({
			inRange: () => true,
			others: (speaker) => ['Ann', 'Bo', 'Cy'].filter((id) => id !== speaker),
			heardAs: (speaker, who) => (who === 'Cy' ? 'muffled' : 'words'),
			onSpoke: (line) => spoken.push(line.as),
			tones: { growl: { says: 'growls', words: 0.6 } },
		});
		const bo = listener(talk, 'Bo');
		const cy = listener(talk, 'Cy');
		talk.say('Ann', 'He is gone.', 'Bo', 0, 'sob');
		talk.say('Ann', 'Fine, take it.', 'Bo', 1, 'sigh');
		talk.say('Ann', 'Behind you!', undefined, 2, 'scream');
		talk.say('Ann', 'All clear now.', 'Bo', 3);
		talk.say('Ann', 'Back off.', 'Bo', 4, 'growl');
		assert.deepEqual(bo.events.map((e) => e.text), ['Ann sobs to you: "He is gone."', 'Ann sighs to you: "Fine, take it."', 'Ann screams: "Behind you!"', 'Ann says to you: "All clear now."', 'Ann growls to you: "Back off."']);
		assert.match(cy.events[2]?.text ?? '', /^Ann screams nearby\. You catch: "Be—/);
		assert.match(cy.events[3]?.text ?? '', /^Ann is talking nearby\./);
		assert.deepEqual(spoken, ['sob', 'sigh', 'scream', undefined, 'growl']);
	});

	it('lets a game decide each repeat: allow it, refuse it, or refuse it in its own words', () => {
		const asked:string[] = [];
		const talk = new TalkFeature({
			inRange: () => true,
			others: (speaker) => ['Ann', 'Bo'].filter((id) => id !== speaker),
			repeats: (who, text) => {
				asked.push(`${who}: ${text}`);
				return text === 'Hail!' || (who === 'Bo' ? 'Find your own words.' : false);
			},
		});
		assert.equal(talk.say('Ann', 'Hail!').status === 'ok', true);
		assert.equal(talk.say('Ann', 'Hail!').status === 'ok', true);
		assert.equal(talk.say('Ann', 'Onward.').status === 'ok', true);
		assert.match(showNamingText(talk.say('Ann', 'Onward.').reason ?? ''), /not a parrot/);
		assert.equal(showNamingText(talk.say('Bo', 'Onward.').reason ?? ''), 'Find your own words.');
		assert.deepEqual(asked, ['Ann: Hail!', 'Ann: Onward.', 'Bo: Onward.']);
	});

	it('lets a game allow repeats', () => {
		const talk = new TalkFeature({ inRange: () => true, others: (speaker) => ['Ann', 'Bo'].filter((id) => id !== speaker), repeats: true });
		assert.equal(talk.say('Ann', 'Onward.').status === 'ok', true);
		assert.equal(talk.say('Ann', 'Onward.').status === 'ok', true);
		assert.equal(talk.say('Bo', 'Onward.').status === 'ok', true);
	});

	it('wakes a listener only for speech meant for them, never for talk between others', () => {
		const talk = net(new Set(['Acolyte:Guard', 'Acolyte:Baker']), ['Guard', 'Baker', 'Acolyte']);
		const guard = listener(talk, 'Guard');
		const baker = listener(talk, 'Baker');
		talk.say('Acolyte', 'Open the gate.', 'Guard');
		talk.say('Acolyte', 'Good morning, all.');
		talk.say('Acolyte', 'The Baker said it first.', 'Guard');
		assert.deepEqual(guard.events.map((e) => e.major), [true, true, true]);
		assert.deepEqual(baker.events.map((e) => e.major), [false, true, true]);
	});

	it('delivers speech only to listeners the host says are in range', () => {
		const spoke:{ text:string; heardBy:string[] }[] = [];
		const talk = net(new Set(['Acolyte:Guard']), ['Guard', 'Acolyte', 'Ghost'], (u) => {
			spoke.push({ text: u.text, heardBy: u.heardBy });
		});
		const guard = listener(talk, 'Guard');
		const acolyte = listener(talk, 'Acolyte');
		const far = listener(talk, 'Ghost');

		assert.deepEqual(talk.nearby('Acolyte'), ['Guard']);

		const ok = talk.say('Acolyte', 'Open the gate.', 'Guard', 3);
		assert.equal(ok.status === 'ok', true);
		assert.equal(showNamingText(ok.reason ?? ''), 'to Guard');
		assert.equal(guard.events.length, 1);
		assert.equal(guard.events[0].kind, 'HeardSpeech');
		assert.match(guard.events[0].text, /says to you/);
		assert.equal(far.events.length, 0);
		assert.deepEqual(spoke[0].heardBy, ['Guard']);
	});

	it('tells the speaker who was too far to make out the words', () => {
		const talk = new TalkFeature({
			inRange: (a, b) => a !== b,
			others: (speaker) => ['Guard', 'Baker', 'Acolyte'].filter((id) => id !== speaker),
			heardAs: (speaker, listener) => (listener !== 'Guard' ? 'words' : 'muffled'),
		});
		assert.equal(showNamingText(talk.say('Acolyte', 'Hello all.').reason ?? ''), 'heard by Baker; too far for Guard to make out the words: get closer');
		assert.equal(showNamingText(talk.say('Acolyte', 'Hello, Baker.', 'Baker').reason ?? ''), 'to Baker');
		assert.equal(showNamingText(talk.say('Acolyte', 'Hello, Guard.', 'Guard').reason ?? ''), 'to Guard; too far for Guard to make out the words: get closer');
		assert.equal(talk.clear('Acolyte', 'Guard'), false);
	});

	it('names among those too far to make out a line to no one only whom its speaker would talk to', () => {
		const talk = new TalkFeature({
			inRange: (a, b) => a !== b,
			others: (speaker) => ['Guard', 'Rat', 'Acolyte'].filter((id) => id !== speaker),
			heardAs: () => 'muffled',
			addresses: (speaker, listener) => listener !== 'Rat',
		});
		assert.equal(showNamingText(talk.say('Acolyte', 'Hello all.').reason ?? ''), 'no one made out the words; too far for Guard to make out the words: get closer');
		assert.equal(showNamingText(talk.say('Acolyte', 'Away, vermin!', 'Rat').reason ?? ''), 'to Rat; too far for Rat to make out the words: get closer', 'one said to a foe still is');
	});

	it('rejects say(to) when the host reports out of range', () => {
		const talk = net(new Set(), ['Guard', 'Acolyte']);
		const result = talk.say('Acolyte', 'Hello.', 'Guard');
		assert.equal(result.status === 'ok', false);
		assert.equal(showNamingText(result.reason ?? ''), 'Guard is not in earshot');
		assert.equal(talk.canSay('Acolyte', 'Guard').ok, false);
	});

	it('does not start a broadcast when nobody is in range', () => {
		const spoke:{ text:string }[] = [];
		const talk = net(new Set(), ['Guard'], (u) => {
			spoke.push({ text: u.text });
		});
		const result = talk.say('Acolyte', 'Make way.');
		assert.equal(result.status === 'ok', false);
		assert.equal(showNamingText(result.reason ?? ''), 'no one in earshot');
		assert.equal(spoke.length, 0);
		assert.equal(talk.canSay('Acolyte').ok, false);
	});

	it('addresses several names at once so each hears "to you"', () => {
		const talk = net(
			new Set(['Player:Guard', 'Player:Baker']),
			['Guard', 'Baker', 'Ghost'],
		);
		const guard = listener(talk, 'Guard');
		const baker = listener(talk, 'Baker');
		const far = listener(talk, 'Ghost');
		const ok = talk.say('Player', 'Which of you sells swords?', ['Guard', 'Baker']);
		assert.equal(ok.status === 'ok', true);
		assert.equal(showNamingText(ok.reason ?? ''), 'to Guard, Baker');
		assert.match(guard.events[0].text, /says to you, Baker:/);
		assert.match(baker.events[0].text, /says to Guard, you:/);
		assert.equal(far.events.length, 0);
	});

	it('broadcasts to every nearby name, including mute characters', () => {
		const talk = net(new Set(['Acolyte:Guard', 'Acolyte:Player']), ['Guard', 'Player']);
		const guard = listener(talk, 'Guard');
		const result = talk.say('Acolyte', 'Make way.');
		assert.equal(result.status === 'ok', true);
		assert.equal(showNamingText(result.reason ?? ''), 'heard by Guard, Player');
		assert.equal(guard.events.length, 1);
		assert.match(guard.events[0].text, /Make way/);
	});

	it('drops a listener the host says cannot hear, even when addressed', () => {
		const talk = new TalkFeature({
			inRange: (a, b) => a !== b,
			others: (speaker) => ['Guard', 'Player', 'Forager'].filter((id) => id !== speaker),
			hears: (speaker, listener) => listener !== 'Guard' || speaker === 'Player',
		});
		const guard = listener(talk, 'Guard');
		const player = listener(talk, 'Player');
		const fromForager = talk.say('Forager', 'Help me across.', 'Guard');
		const fromPlayer = talk.say('Player', 'Stay here.', 'Guard');
		assert.equal(fromForager.status === 'ok', true);
		assert.equal(guard.events.length, 1);
		assert.match(guard.events[0].text, /Stay here/);
		assert.equal(fromPlayer.heard?.includes('Guard'), true);
		assert.equal(player.events.length, 1);
		assert.match(player.events[0].text, /Help me across/);
	});

	it('lets an unattached name hear if the host says they are in range', () => {
		const talk = net(new Set(['Acolyte:Player']), ['Player']);
		const result = talk.say('Acolyte', 'After you.', 'Player');
		assert.equal(result.status === 'ok', true);
		assert.equal(showNamingText(result.reason ?? ''), 'to Player');
	});

	it('asks the host to face and approach speaker and listener', () => {
		const faces:[string, string][] = [];
		const steps:[string, string][] = [];
		const talk = new TalkFeature({
			inRange: () => true,
			others: () => ['Guard'],
			face: (who, toward) => {
				faces.push([who, toward]);
			},
			approach: (who, toward) => {
				steps.push([who, toward]);
			},
		});
		const ok = talk.say('Acolyte', 'Open the gate.', 'Guard');
		assert.equal(ok.status === 'ok', true);
		assert.deepEqual(faces, [['Acolyte', 'Guard'], ['Guard', 'Acolyte']]);
		assert.deepEqual(steps, [['Acolyte', 'Guard'], ['Guard', 'Acolyte']]);
	});

	it('turns eavesdroppers toward the speaker', () => {
		const faces:[string, string][] = [];
		const talk = new TalkFeature({
			inRange: () => true,
			others: () => ['Guard', 'Captain'],
			face: (who, toward) => {
				faces.push([who, toward]);
			},
		});
		talk.say('Acolyte', 'Pay her.', 'Guard');
		assert.deepEqual(faces, [
			['Acolyte', 'Guard'],
			['Guard', 'Acolyte'],
			['Captain', 'Acolyte'],
		]);
	});

	it('muffles far speech and asks the listener to come closer', () => {
		const talk = new TalkFeature({
			inRange: () => true,
			others: () => ['Guard'],
			heardAs: () => 'muffled',
		});
		const guard = listener(talk, 'Guard');
		const ok = talk.say('Baker', 'Which of you sells swords?', 'Guard');
		assert.equal(ok.status === 'ok', true);
		assert.match(guard.events[0].text, /only catch/);
		assert.match(guard.events[0].text, /Get closer to Baker to hear clearly/);
		assert.match(guard.events[0].text, /Wh—/);
		assert.equal(guard.events[0].major, true);
	});

	it('does not treat muffled eavesdropping as an interrupting event', () => {
		const talk = new TalkFeature({
			inRange: () => true,
			others: () => ['Guard', 'Captain'],
			heardAs: (speaker, listener) => (listener === 'Guard' ? 'words' : 'muffled'),
		});
		const captain = listener(talk, 'Captain');
		talk.say('Baker', 'The loaf is two gold.', 'Guard');
		assert.equal(captain.events.length, 1);
		assert.equal(captain.events[0].major, false);
		assert.match(captain.events[0].text, /talking nearby/);
	});

	it('makes a muffled name-drop major for the named listener', () => {
		const talk = new TalkFeature({
			inRange: () => true,
			others: () => ['Guard', 'Captain'],
			heardAs: () => 'muffled',
		});
		const captain = listener(talk, 'Captain');
		talk.say('Baker', 'Ask Captain for the key.', 'Guard');
		assert.equal(captain.events[0].major, true);
		assert.match(captain.events[0].text, /spoken of/);
	});

	it('treats host aliases as a name mention', () => {
		const talk = new TalkFeature({
			inRange: () => true,
			others: () => ['Fern', 'Guard'],
			heardAs: () => 'muffled',
			names: (id) => (id === 'Fern' ? ['Fern', 'Herbalist'] : [id]),
		});
		const fern = listener(talk, 'Fern');
		talk.say('Player', 'Herbalist, stay inside.', 'Guard');
		assert.equal(fern.events[0].major, true);
	});

	it('delivers to an attached id when the host lists its role', () => {
		const talk = new TalkFeature({
			inRange: () => true,
			others: () => ['Herbalist', 'Lys'],
			heardAs: () => 'words',
			names: (id) => (id === 'Fern' ? ['Fern', 'Herbalist'] : [id]),
		});
		const fern = listener(talk, 'Fern');
		const ok = talk.say('Player', 'Herbalist, save your friends.');
		assert.equal(ok.status === 'ok', true);
		assert.equal(fern.events.length, 1);
		assert.equal(fern.events[0].kind, 'HeardSpeech');
		assert.equal(fern.events[0].major, true);
		assert.match(fern.events[0].text, /save your friends/);
	});

	it('makes a muffled role mention major', () => {
		const talk = new TalkFeature({
			inRange: () => true,
			others: () => ['Fern', 'Guard'],
			heardAs: () => 'muffled',
			names: (id) => (id === 'Fern' ? ['Fern', 'Herbalist'] : [id]),
		});
		const fern = listener(talk, 'Fern');
		talk.say('Player', 'Send the herbalist outside.', 'Guard');
		assert.equal(fern.events[0].major, true);
	});
});

describe('TalkFeature muffled speech', () => {
	it('delivers a muffled line in full once the listener comes close, within the rehear window', () => {
		let close = false;
		const talk = new TalkFeature({
			inRange: () => true,
			others: (speaker) => ['Guard', 'BridgeKeeper'].filter((id) => id !== speaker),
			heardAs: () => (close ? 'words' : 'muffled'),
			rehear: 5,
		});
		const guard = listener(talk, 'Guard');
		// Said to no one, with only the Guard in earshot: to the Guard.
		talk.say('BridgeKeeper', 'The bridge is down', undefined, 10);
		assert.match(guard.events[0]?.text ?? '', /speaking to you, but you only catch/);
		talk.tick(12);
		assert.equal(guard.events.length, 1);
		close = true;
		talk.tick(13);
		assert.equal(guard.events[1]?.text, 'BridgeKeeper says to you, now clear: "The bridge is down"');
		assert.equal(guard.events[1]?.remember, true);
		talk.tick(14);
		assert.equal(guard.events.length, 2);
	});

	it('keeps a muffled line in short-term memory for two thinks, or until its speaker says another', () => {
		const talk = new TalkFeature({ inRange: () => true, others: (speaker) => ['Guard', 'BridgeKeeper'].filter((id) => id !== speaker), heardAs: () => 'muffled' });
		const mind = soloCharacter({ id: 'Guard', talk, provider: new FakeProvider(() => ({ content: '', toolCalls: [] })), verbs: new VerbRegistry(), kit: { verbs: [] }, context: () => undefined }).mind!;
		const caught = ():string[] => mind.memory.talkedOf().filter((line) => line.includes('catch'));
		talk.say('BridgeKeeper', 'The bridge is down', undefined, 10);
		internalsOf(mind.memory).absorb();
		assert.equal(caught().length, 1);
		mind.memory.thought();
		assert.equal(caught().length, 1, 'a second think still shows it');
		mind.memory.thought();
		assert.deepEqual(caught(), [], 'gone after two');
		talk.say('BridgeKeeper', 'The bridge is down', undefined, 20);
		internalsOf(mind.memory).absorb();
		talk.say('BridgeKeeper', 'Go round by the ford', undefined, 21);
		internalsOf(mind.memory).absorb();
		assert.equal(caught().length, 1, 'a newer line from its speaker takes its place');
	});
});

describe('TalkFeature: whom a line is to, and whom it wakes', () => {
	it('says a line to no one to whoever spoke to the speaker lately, else to the only one in earshot, else to no one', () => {
		const talk = net(new Set(['Ann:Bo', 'Ann:Cy', 'Bo:Cy']), ['Ann', 'Bo', 'Cy']);
		const bo = listener(talk, 'Bo');
		assert.deepEqual(talk.say('Ann', 'Morning, both.', undefined, 0).to, [], 'two in earshot, and no one spoke');
		assert.deepEqual(talk.say('Bo', 'Morning to you.', undefined, 1).to, ['Ann'], 'Ann spoke to Bo lately');
		assert.deepEqual(talk.say('Ann', 'Quiet day.', undefined, 30).to, [], 'past the reply window');
		assert.match(bo.events[1].text, /^Ann says: "Quiet day\."/);
		assert.deepEqual(net(new Set(['Ann:Bo']), ['Ann', 'Bo', 'Cy']).say('Ann', 'Hello.').to, ['Bo'], 'the only one in earshot');
	});

	it('wakes a listener at once for a line to it, naming it or shouted, never for one to another, and for one to no one once a cooldown', () => {
		const talk = net(new Set(['Ann:Bram', 'Ann:Cy', 'Bram:Cy']), ['Ann', 'Bram', 'Cy']);
		const bram = listener(talk, 'Bram');
		const said = (text:string, to:string | undefined, at:number, as?:string):boolean | undefined => {
			talk.say('Ann', text, to, at, as);
			return bram.events.at(-1)?.major;
		};
		assert.equal(said('Fetch water.', 'Bram', 0), true);
		assert.equal(said('Fetch the ropes.', 'Cy', 1), false);
		assert.equal(said('Ask Bram about it.', 'Cy', 2), true);
		assert.equal(said('Watch out!', 'Cy', 3, 'shout'), true);
		assert.equal(said('Lovely weather.', undefined, 4), true);
		assert.equal(said('Rain soon, maybe.', undefined, 10), false, 'within the cooldown');
		assert.equal(said('Or snow tonight.', undefined, 25), true);
	});

	it('wakes for an offer as for a line: one to it at once, an open one once a cooldown it shares with lines to no one', () => {
		const talk = net(new Set(['Ann:Bram', 'Ann:Cy', 'Bram:Cy']), ['Ann', 'Bram', 'Cy']);
		const bram = listener(talk, 'Bram');
		const cy = listener(talk, 'Cy');
		const offer = (to:string | undefined, at:number):void => talk.offered('Ann', to, { kind: 'Offer', text: 'Ann offers 1 Bread for 2 gold', tags: ['offer'] }, at);
		offer('Bram', 0);
		offer(undefined, 1);
		talk.say('Ann', 'Fresh bread here.', undefined, 5);
		offer(undefined, 30);
		const woke = (events:readonly MindEvent[]):[string, boolean | undefined][] => events.map((e) => [e.kind, e.major]);
		assert.deepEqual(woke(bram.events), [['Offer', true], ['Offer', true], ['HeardSpeech', false], ['Offer', true]]);
		assert.deepEqual(woke(cy.events), [['Offer', true], ['HeardSpeech', false], ['Offer', true]]);
	});

	it('wakes two facing each other close by at every line, cooldown or not', async () => {
		const poses:Record<string, { point:number[]; facing:number[] }> = { Ann: { point: [0, 0], facing: [0, 1] }, Bo: { point: [0, 2], facing: [0, -1] }, Cy: { point: [1, 0], facing: [0, 1] } };
		const director = await new ArcDirector<{ id:string }>()
			.addFake({ chat: () => ({ content: JSON.stringify({ steps: [{ verb: 'wait' }] }), toolCalls: [] }) })
			.withVerbs((v) => v.addStock())
			.withDefaultKit({ verbs: ['say', 'wait'] })
			.withContext((id) => ({ id }))
			.withWorld({ ...OPEN_WORLD, geometry: { axes: Axes.Plane, getPose: (id) => poses[String(id)] } })
			.withTalk({ inRange: () => true, others: (id) => ['Ann', 'Bo', 'Cy'].filter((o) => o !== id), untargetedWakeCooldown: 60 })
			.addCharacter({ id: 'Ann' })
			.addCharacter({ id: 'Bo', mind: { rethinkingThreshold: 0, skipStrategic: true } })
			.addCharacter({ id: 'Cy', mind: { rethinkingThreshold: 0, skipStrategic: true } })
			.connect();
		const woke = (id:string):boolean[] => director.character(id)!.mind!.events().filter((e) => e.kind === 'HeardSpeech').map((e) => !!e.major);
		director.getTalk()!.say('Ann', 'Nice and quiet.', undefined, 0);
		director.getTalk()!.say('Ann', 'Too quiet, maybe.', undefined, 5);
		assert.deepEqual(woke('Bo'), [true, true]);
		assert.deepEqual(woke('Cy'), [true, false]);
		director.dispose();
	});
});

describe('withTalk onHeard', () => {
	type Ctx = { id:string };
	type Heard = { id:string; text:string; clarity:string; segments:{ text:string; id?:string }[] };
	const CAST = ['Wolf', 'Ash', 'Player', 'Cy', 'Dee'];
	/** Wolf speaks; Ash, a mind, and Player, Cy and Dee, none, hear. Dee sees no one; Cy makes out no words. */
	async function staged(heard?:Heard[], named?:string[]):Promise<ArcDirector<Ctx>> {
		const director = await new ArcDirector<Ctx>()
			.addFake({ chat: () => ({ content: JSON.stringify({ steps: [{ verb: 'wait' }] }), toolCalls: [] }) })
			.withVerbs((v) => v.addStock())
			.withDefaultKit({ verbs: ['say', 'wait'] })
			.withContext((id) => ({ id }))
			.withKernels(({ id }) => ({ me: dummyEntity(id), others: CAST.filter((o) => o !== id).map((o) => dummyEntity(o)), items: [] }))
			.withSight({ look: ({ id }) => ({ self: { id, point: [0, 0] }, objects: id === 'Dee' ? [] : [{ id: 'Wolf', point: [3, 0], tags: ['character'] }] }) })
			.withTalk({
				inRange: () => true,
				others: (id) => CAST.filter((o) => o !== id),
				heardAs: (speaker, listener) => (listener === 'Cy' ? 'muffled' : 'words'),
				names: (id) => {
					named?.push(id);
					return [id];
				},
				...heard ? { onHeard: (id, line) => heard.push({ id, text: line.text, clarity: line.clarity, segments: line.segments() }) } : {},
			})
			.addCharacter({ id: 'Wolf' })
			.addCharacter({ id: 'Ash', mind: { rethinkingThreshold: 0, skipStrategic: true } })
			.addCharacter({ id: 'Player' })
			.addCharacter({ id: 'Cy' })
			.addCharacter({ id: 'Dee' })
			.connect();
		director.character('Ash')!.persona.names.name('Wolf', 'GreyWolf', { character: true });
		return director;
	}

	it('tells each character in earshot, minded or not, the line as it made it out', async () => {
		const heard:Heard[] = [];
		const director = await staged(heard);
		director.getTalk()!.say('Wolf', 'Run!', 'Ash', director.time, 'shout');
		const by = (id:string):Heard | undefined => heard.find((row) => row.id === id);
		assert.deepEqual(heard.map((row) => row.id).sort(), ['Ash', 'Cy', 'Dee', 'Player']);
		assert.deepEqual(by('Ash'), { id: 'Ash', text: 'Grey Wolf shouts to you: "Run!"', clarity: 'clear', segments: [{ text: 'Grey Wolf', id: 'Wolf', voice: true }, { text: ' shouts to ' }, { text: 'you', id: 'Ash' }, { text: ': "Run!"' }] });
		assert.equal(by('Player')?.text, 'Wolf shouts to Ash: "Run!"');
		assert.equal(by('Cy')?.clarity, 'muffled');
		assert.equal(by('Cy')?.text, 'Wolf shouts nearby. You catch: "R——!". Get closer to Wolf to hear clearly.');
		assert.equal(by('Dee')?.text, 'Someone shouts to Ash: "Run!"');
		assert.deepEqual(by('Dee')?.segments[0], { text: 'Someone', id: 'Wolf', voice: true });
		director.dispose();
	});

	it('works nothing out for a listener until onHeard is set', async () => {
		const named:string[] = [];
		const director = await staged(undefined, named);
		director.getTalk()!.say('Wolf', 'Run!', undefined, director.time);
		assert.deepEqual(named.filter((id) => id !== 'Ash'), []);
		director.dispose();
		const told = await staged([], named);
		told.getTalk()!.say('Wolf', 'Run!', undefined, told.time);
		assert.ok(named.includes('Player'));
		told.dispose();
	});
});

describe('talk instructions', () => {
	const QUIET = { rethinkingThreshold: 0, skipStrategic: true };
	/**
	 * The earshot sense each one reads, the director talking by `instructions`: Ann has no style of its own, Bo talks
	 * by a stock one, Cy by the game's own text and topics it avoids, and Dee only avoids one.
	 */
	async function earshot(instructions?:string):Promise<Record<string, string>> {
		const director = await new ArcDirector<{ id:string }>()
			.addFake({ chat: () => ({ content: JSON.stringify({ steps: [{ verb: 'wait' }] }), toolCalls: [] }) })
			.withVerbs((v) => v.addStock())
			.withDefaultKit({ verbs: ['say', 'wait'] })
			.withContext((id) => ({ id }))
			.withTalk({ inRange: () => true, others: (id) => ['Ann', 'Bo'].filter((o) => o !== id), ...instructions === undefined ? {} : { instructions } })
			.addCharacter({ id: 'Ann', mind: QUIET })
			.addCharacter({ id: 'Bo', mind: QUIET, talk: { instructions: TalkInstructions.Quiet } })
			.addCharacter({ id: 'Cy', mind: QUIET, talk: { instructions: 'Hum while you work.', avoid: ['the crown', 'the treasure', 'the quest'] } })
			.addCharacter({ id: 'Dee', mind: QUIET, talk: { avoid: ['the quest'] } })
			.connect();
		const talk = director.getTalk()!;
		const sensed = Object.fromEntries(['Ann', 'Bo', 'Cy', 'Dee'].map((id) => [id, String(talk.earshot({ id }, director.character(id)!.mind!))]));
		director.dispose();
		return sensed;
	}

	it('tells each character how it talks unasked, after who is in earshot: its own style, else the director\'s, with the topics it avoids', async () => {
		const sensed = await earshot(TalkInstructions.Banter);
		assert.equal(sensed.Ann, `In talking range: Bo. say(to) walks up to them first. Far-off speech is muffled.\n${TalkInstructions.Banter}`);
		assert.equal(sensed.Bo.split('\n')[1], TalkInstructions.Quiet);
		assert.equal(sensed.Cy.split('\n')[1], 'Hum while you work. Never mention the crown, the treasure or the quest.');
		assert.equal(sensed.Dee.split('\n')[1], `${TalkInstructions.Banter} Never mention the quest.`);
	});

	it('says nothing of talking unasked without an instruction, whatever it avoids', async () => {
		const sensed = await earshot();
		assert.equal(sensed.Ann, 'In talking range: Bo. say(to) walks up to them first. Far-off speech is muffled.');
		assert.equal(sensed.Dee.split('\n').length, 1);
		assert.equal(sensed.Bo.split('\n')[1], TalkInstructions.Quiet);
	});
});
