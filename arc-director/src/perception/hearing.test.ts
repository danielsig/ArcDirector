import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Mind } from '../mind/mind.js';
import { AUDIBLE, clarityAt, heardText, loudnessAfter, loudnessFor, noiseHelp, reachOf } from './hearing.js';

describe('hearing', () => {
	const facing = [0, -1];
	const steps = { name: 'footsteps', loudness: 1 };

	it('words a sound as sight words where things are, louder with a ! and close to its source LOUDLY', () => {
		assert.equal(heardText(steps, 0.9, [0, 0], [0, 1], { facing }), 'You hear footsteps LOUDLY 1 pace behind you!');
		assert.equal(heardText(steps, 0.6, [0, 0], [-5, 0], { facing }), 'You hear footsteps 5 paces to your left!');
		assert.equal(heardText({ name: 'bush-thrashing sounds', loudness: 0.4 }, 0.2, [0, 0], [0, -10], { facing }), 'You hear bush-thrashing sounds 10 paces in front of you.');
		assert.equal(heardText(steps, 0.3, [0, 0], [0, -5], { facing, muffled: true }), 'You hear muffled footsteps 5 paces in front of you.');
		assert.equal(heardText({ name: 'something breaking', loudness: 1 }, 0.9, [0, 0, 0], [0, 2, 0], { facing: [0, 0, -1], up: [0, 1, 0], unitName: 'm' }), 'You hear something breaking LOUDLY 2m above you!');
	});

	it('carries a sound less the farther it goes, a sound of loudness 1 just as far as its max, and none past it', () => {
		assert.ok(clarityAt(1) > clarityAt(10) && clarityAt(10) > clarityAt(20));
		assert.ok(Math.abs(clarityAt(40) - AUDIBLE) < 1e-9);
		assert.equal(clarityAt(41), 0);
		assert.equal(clarityAt(20, { max: 40, falloff: 0 }), 1, 'no falloff: no drop');
	});

	it('works out how far a sound is heard, and the loudness a sound heard that far needs', () => {
		assert.equal(reachOf(1), 40);
		assert.equal(reachOf(0.25), 20, 'the inverse square: a quarter as loud, half as far');
		assert.ok(Math.abs(reachOf(loudnessFor(12)) - 12) < 1e-9);
		assert.ok(Math.abs(reachOf(loudnessFor(6)) - 6) < 1e-9, 'quiet sounds too');
	});

	it('dies away over its seconds as it fades, or holds steady', () => {
		assert.equal(loudnessAfter({ name: 'fire', loudness: 0.8, seconds: 10 }, 5), 0.8);
		assert.equal(loudnessAfter({ name: 'bell', loudness: 0.8, seconds: 10, fade: 1 }, 5), 0.4);
		assert.ok(loudnessAfter({ name: 'bell', loudness: 0.8, seconds: 10, fade: 2 }, 5) < 0.4, 'fades sooner');
	});

	it('tells in a verb\'s help how far it carries, or how loud with a game\'s own curve', () => {
		assert.equal(noiseHelp({ name: 'a jetpack roar', loudness: loudnessFor(30) }), 'heard as a jetpack roar up to 30 paces');
		assert.equal(noiseHelp({ name: 'reloading', loudness: 0.3 }, () => 1), 'heard as reloading, quiet');
	});
});

describe('a mind\'s waiting sounds', () => {
	it('keeps one line a sound, its latest, and only the loudest few', () => {
		const mind = new Mind();
		const heard = (key:string, weight:number):void => mind.pushEvent({ kind: 'sound', text: `${key} ${weight}`, key, cap: 2, weight });
		heard('steps', 0.2);
		heard('steps', 0.6);
		heard('bell', 0.3);
		heard('twig', 0.1);
		mind.pushEvent({ kind: 'Saw', text: 'not a sound' });
		assert.deepEqual(mind.events().map((e) => e.text), ['steps 0.6', 'bell 0.3', 'not a sound']);
	});
});
