import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AgentEvent } from './types.js';
import { TalkNet, type TalkMind } from './talk.js';

function mind(id:string):TalkMind & { events:AgentEvent[] } {
	const events:AgentEvent[] = [];
	return {
		id,
		events,
		pushEvent(event) {
			events.push(event);
		},
	};
}

function net(
	range:Set<string>,
	roster:string[],
	onSpoke?:(u:{ text:string; heardBy:string[] })=>void,
):TalkNet {
	return new TalkNet({
		inRange: (a, b) => a !== b && (range.has(`${a}:${b}`) || range.has(`${b}:${a}`)),
		others: (speaker) => roster.filter((id) => id !== speaker),
	}, onSpoke);
}

describe('TalkNet', () => {
	it('delivers speech only to listeners the host says are in range', () => {
		const guard = mind('Guard');
		const acolyte = mind('Acolyte');
		const far = mind('Ghost');
		const spoke:{ text:string; heardBy:string[] }[] = [];
		const talk = net(new Set(['Acolyte:Guard']), ['Guard', 'Acolyte', 'Ghost'], (u) => {
			spoke.push({ text: u.text, heardBy: u.heardBy });
		});
		talk.attach(guard);
		talk.attach(acolyte);
		talk.attach(far);

		assert.deepEqual(talk.nearby('Acolyte'), ['Guard']);

		const ok = talk.say('Acolyte', 'Open the gate.', 'Guard', 3);
		assert.equal(ok.ok, true);
		assert.equal(ok.reason, 'to Guard');
		assert.equal(guard.events.length, 1);
		assert.equal(guard.events[0].kind, 'HeardSpeech');
		assert.match(guard.events[0].text, /says to you/);
		assert.equal(far.events.length, 0);
		assert.deepEqual(spoke[0].heardBy, ['Guard']);
	});

	it('rejects say(to) when the host reports out of range', () => {
		const talk = net(new Set(), ['Guard', 'Acolyte']);
		const result = talk.say('Acolyte', 'Hello.', 'Guard');
		assert.equal(result.ok, false);
		assert.equal(result.reason, 'Guard is not in earshot');
		assert.equal(talk.canSay('Acolyte', 'Guard').ok, false);
	});

	it('does not start a broadcast when nobody is in range', () => {
		const spoke:{ text:string }[] = [];
		const talk = net(new Set(), ['Guard'], (u) => {
			spoke.push({ text: u.text });
		});
		const result = talk.say('Acolyte', 'Make way.');
		assert.equal(result.ok, false);
		assert.equal(result.reason, 'no one in earshot');
		assert.equal(spoke.length, 0);
		assert.equal(talk.canSay('Acolyte').ok, false);
	});

	it('addresses several names at once so each hears "to you"', () => {
		const guard = mind('Guard');
		const baker = mind('Baker');
		const far = mind('Ghost');
		const talk = net(
			new Set(['Player:Guard', 'Player:Baker']),
			['Guard', 'Baker', 'Ghost'],
		);
		talk.attach(guard);
		talk.attach(baker);
		talk.attach(far);
		const ok = talk.say('Player', 'Which of you sells swords?', ['Guard', 'Baker']);
		assert.equal(ok.ok, true);
		assert.equal(ok.reason, 'to Guard, Baker');
		assert.match(guard.events[0].text, /says to you/);
		assert.match(baker.events[0].text, /says to you/);
		assert.equal(far.events.length, 0);
	});

	it('broadcasts to every nearby name, including mute bodies', () => {
		const guard = mind('Guard');
		const talk = net(new Set(['Acolyte:Guard', 'Acolyte:Player']), ['Guard', 'Player']);
		talk.attach(guard);
		const result = talk.say('Acolyte', 'Make way.');
		assert.equal(result.ok, true);
		assert.equal(result.reason, 'heard by Guard, Player');
		assert.equal(guard.events.length, 1);
		assert.match(guard.events[0].text, /Make way/);
	});

	it('lets an unattached name hear if the host says they are in range', () => {
		const talk = net(new Set(['Acolyte:Player']), ['Player']);
		const result = talk.say('Acolyte', 'After you.', 'Player');
		assert.equal(result.ok, true);
		assert.equal(result.reason, 'to Player');
	});

	it('asks the host to face and approach speaker and listener', () => {
		const faces:[string, string][] = [];
		const steps:[string, string][] = [];
		const talk = new TalkNet({
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
		assert.equal(ok.ok, true);
		assert.deepEqual(faces, [['Acolyte', 'Guard'], ['Guard', 'Acolyte']]);
		assert.deepEqual(steps, [['Acolyte', 'Guard'], ['Guard', 'Acolyte']]);
	});

	it('faces even without line of sight and still approaches', () => {
		const faces:[string, string][] = [];
		const steps:[string, string][] = [];
		const talk = new TalkNet({
			inRange: () => true,
			others: () => ['Guard'],
			canSee: () => false,
			face: (who, toward) => {
				faces.push([who, toward]);
			},
			approach: (who, toward) => {
				steps.push([who, toward]);
			},
		});
		talk.say('Acolyte', 'This way.', 'Guard');
		assert.deepEqual(faces, [['Acolyte', 'Guard'], ['Guard', 'Acolyte']]);
		assert.deepEqual(steps, [['Acolyte', 'Guard'], ['Guard', 'Acolyte']]);
	});

	it('can disable face and approach', () => {
		let faced = 0;
		let stepped = 0;
		const talk = new TalkNet({
			inRange: () => true,
			others: () => ['Guard'],
			face: () => {
				faced += 1;
			},
			approach: () => {
				stepped += 1;
			},
		}, undefined, { face: false, approach: false });
		talk.say('Acolyte', 'Hold.', 'Guard');
		assert.equal(faced, 0);
		assert.equal(stepped, 0);
	});

	it('turns eavesdroppers toward the speaker', () => {
		const faces:[string, string][] = [];
		const talk = new TalkNet({
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
		const guard = mind('Guard');
		const talk = new TalkNet({
			inRange: () => true,
			others: () => ['Guard'],
			clearHear: () => false,
		});
		talk.attach(guard);
		const ok = talk.say('Baker', 'Which of you sells swords?', 'Guard');
		assert.equal(ok.ok, true);
		assert.match(guard.events[0].text, /only catch/);
		assert.match(guard.events[0].text, /Get closer to Baker to hear clearly/);
		assert.match(guard.events[0].text, /Wh—/);
		assert.equal(guard.events[0].major, true);
	});

	it('does not treat muffled eavesdropping as an interrupting event', () => {
		const captain = mind('Captain');
		const talk = new TalkNet({
			inRange: () => true,
			others: () => ['Guard', 'Captain'],
			clearHear: (speaker, listener) => listener === 'Guard',
		});
		talk.attach(captain);
		talk.say('Baker', 'The loaf is two gold.', 'Guard');
		assert.equal(captain.events.length, 1);
		assert.equal(captain.events[0].major, false);
		assert.match(captain.events[0].text, /talking nearby/);
	});

	it('makes a muffled name-drop major for the named listener', () => {
		const captain = mind('Captain');
		const talk = new TalkNet({
			inRange: () => true,
			others: () => ['Guard', 'Captain'],
			clearHear: () => false,
		});
		talk.attach(captain);
		talk.say('Baker', 'Ask Captain for the key.', 'Guard');
		assert.equal(captain.events[0].major, true);
		assert.match(captain.events[0].text, /spoken of/);
	});

	it('treats host aliases as a name mention', () => {
		const fern = mind('Fern');
		const talk = new TalkNet({
			inRange: () => true,
			others: () => ['Fern', 'Guard'],
			clearHear: () => false,
			names: (id) => (id === 'Fern' ? ['Fern', 'Herbalist'] : [id]),
		});
		talk.attach(fern);
		talk.say('Player', 'Herbalist, stay inside.', 'Guard');
		assert.equal(fern.events[0].major, true);
	});

	it('delivers to an attached id when the host lists its role', () => {
		const fern = mind('Fern');
		const talk = new TalkNet({
			inRange: () => true,
			others: () => ['Herbalist', 'Lys'],
			clearHear: () => true,
			names: (id) => (id === 'Fern' ? ['Fern', 'Herbalist'] : [id]),
		});
		talk.attach(fern);
		const ok = talk.say('Player', 'Herbalist, save your friends.');
		assert.equal(ok.ok, true);
		assert.equal(fern.events.length, 1);
		assert.equal(fern.events[0].kind, 'HeardSpeech');
		assert.equal(fern.events[0].major, true);
		assert.match(fern.events[0].text, /save your friends/);
	});

	it('makes a muffled role mention major', () => {
		const fern = mind('Fern');
		const talk = new TalkNet({
			inRange: () => true,
			others: () => ['Fern', 'Guard'],
			clearHear: () => false,
			names: (id) => (id === 'Fern' ? ['Fern', 'Herbalist'] : [id]),
		});
		talk.attach(fern);
		talk.say('Player', 'Send the herbalist outside.', 'Guard');
		assert.equal(fern.events[0].major, true);
	});
});

describe('TalkNet muffled speech', () => {
	it('delivers a muffled line in full once the listener comes close, within the rehear window', () => {
		const guard = mind('Guard');
		let close = false;
		const talk = new TalkNet({
			inRange: () => true,
			others: (speaker) => ['Guard', 'BridgeKeeper'].filter((id) => id !== speaker),
			clearHear: () => close,
		}, undefined, { face: false, approach: false, rehear: 5 });
		talk.attach(guard);
		talk.say('BridgeKeeper', 'The bridge is down', undefined, 10);
		assert.match(guard.events[0]?.text ?? '', /You catch/);
		talk.tick(12);
		assert.equal(guard.events.length, 1);
		close = true;
		talk.tick(13);
		assert.equal(guard.events[1]?.text, 'BridgeKeeper says, now clear: "The bridge is down"');
		assert.equal(guard.events[1]?.remember, true);
		talk.tick(14);
		assert.equal(guard.events.length, 2);
	});
});
