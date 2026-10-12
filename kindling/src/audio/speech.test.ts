import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { respell, speech, voiceFor, type SpeechVoice } from './speech.js';
import { patchSeconds } from './synth.js';
import type { SfxLayer } from './types.js';

const voice = { pitch: 150 };

/** Every syllable, with its time from the start of the line. */
function points(text:string, v:SpeechVoice = voice):{ at:number; freq:number; to:number; layer:SfxLayer }[] {
	return speech(text, v).layers.map((layer) => ({ at: layer.when!, freq: layer.freq!, to: layer.freqTo!, layer }));
}

describe('speech', () => {
	it('chirps once per spoken syllable, silent e and all', () => {
		assert.equal(points('Hello there, little one').length, 6);
		assert.equal(points('Here, where severe sales have named.').length, 7);
	});

	it('rises at a question and falls at a statement', () => {
		const asked = points('Is it yours?').at(-1)!;
		const told = points('It is yours.').at(-1)!;
		assert.ok(asked.to > asked.freq);
		assert.ok(told.to < told.freq);
	});

	it('speaks a rounded vowel as a lower "boo" and any other as a "bee"', () => {
		const v = { pitch: 200 };
		const [too, see, go, cat] = points('too see go cat now', v);
		assert.ok(see!.freq > too!.freq);
		assert.deepEqual([too, see, go, cat].map((p) => p!.layer.kind), ['boo', 'bee', 'boo', 'bee']);
		const kinds = (word:string):string => points(word).map((p) => p.layer.kind).join('-');
		assert.equal(kinds('beautiful'), 'boo-bee-boo');
		assert.equal(kinds('gorgeous'), 'boo-boo');
		assert.equal(kinds('interesting'), 'bee-boo-bee-bee');
	});

	it('bends each syllable toward the next one, so the same word rises or falls with what follows', () => {
		const [beforeLow] = points('see too', { pitch: 200 });
		const [beforeHigh] = points('see me', { pitch: 200 });
		assert.equal(beforeLow!.freq, beforeHigh!.freq);
		assert.ok(beforeLow!.to < beforeHigh!.to);
	});

	it('pauses longer at a comma than between words', () => {
		const [a, b, c] = points('one two, three');
		assert.ok(c!.at - b!.at > b!.at - a!.at);
	});

	it('fits a line to exactly the seconds asked, every syllable spoken', () => {
		for (const [text, seconds] of [[`${'la '.repeat(60)}la?`, 4], ['Hi.', 1.5], ['Well, is it yours?', 2]] as const) {
			const line = speech(text, voice, seconds);
			assert.ok(Math.abs(patchSeconds(line) - seconds) < 1e-9);
		}
		assert.equal(points(`${'la '.repeat(60)}la?`).length, 61);
	});

	it('keeps the voice\'s own rate when no length is asked', () => {
		// "la" ends its word open, so it runs a quarter longer than a plain syllable.
		const [a, b] = points('la la.');
		assert.ok(Math.abs(b!.at - a!.at - 1.25 / 5.5) < 1e-9);
	});

	/** Seconds from each syllable to the next. */
	const spans = (text:string):number[] => {
		const at = points(text).map((p) => p.at);
		return at.slice(1).map((t, i) => t - at[i]!);
	};

	it('rushes function words', () => {
		const [the, cat] = spans('the cat sat');
		assert.ok(the! < cat! * 0.7);
	});

	it('holds long vowels: vowel pairs and a silent e', () => {
		const [seat, sit] = spans('seat sit bit');
		const [time, tim] = spans('time tim bit');
		assert.ok(seat! > sit! * 1.4);
		assert.ok(time! > tim! * 1.4);
	});

	it('holds a vowel longer before a voiced consonant than a voiceless one', () => {
		const [bad, bat] = spans('bad bat cat');
		assert.ok(bad! > bat! * 1.3);
	});

	it('is the same every time', () => {
		assert.deepEqual(speech('Good morning!', voice), speech('Good morning!', voice));
	});

	it('speaks in a monotone at range 0', () => {
		for (const p of points('Well, is it yours?', { pitch: 140, range: 0 })) {
			assert.equal(p.freq, 280);
			assert.equal(p.to, 280);
		}
	});

	it('lands every syllable on the pentatonic scale', () => {
		for (const p of points('Over the river and down to the mill.', { pitch: 150 })) {
			const semis = ((Math.round(12 * Math.log2(p.freq / 150)) % 12) + 12) % 12;
			assert.ok([0, 2, 4, 7, 9].includes(semis), `${p.freq} Hz is ${semis} semitones up`);
		}
	});

});

describe('respell', () => {
	it('reads English by its common rules', () => {
		const heard:Record<string, string> = {
			here: 'hEr', mere: 'mEr', severe: 'sevEr', sale: 'sAl', makes: 'mAks', named: 'nAmd', races: 'rAses',
			there: 'ther', where: 'wer', have: 'hav', wanted: 'wanted', played: 'plAd', night: 'nIt', write: 'rIt',
			table: 'tabəl', happy: 'hapE', my: 'mI', car: 'cHr', her: 'hR', bird: 'bRd', see: 'sE', boat: 'bOt',
			about: 'əbWt', go: 'gO', page: 'pAj', city: 'sitE', all: 'Ql', large: 'lHrj', leave: 'lEv', nation: 'nashən',
			beautiful: 'bUtifəl', gorgeous: 'gQrjəs', delicious: 'delishəs', interesting: 'intəresting', every: 'evərE',
			general: 'genərəl', silence: 'siləns',
		};
		for (const [word, sounds] of Object.entries(heard)) {
			assert.equal(respell(word), sounds, word);
		}
	});
});

describe('voiceFor', () => {
	it('gives each seed its own steady voice', () => {
		assert.deepEqual(voiceFor('Forager'), voiceFor('Forager'));
		assert.notDeepEqual(voiceFor('Forager'), voiceFor('Angler'));
	});

	it('keeps the pitch inside the range it is given', () => {
		const high = voiceFor('Wren', [300, 420]);
		const low = voiceFor('Wren', [170, 240]);
		assert.ok(high.pitch >= 300 && high.pitch <= 420);
		assert.ok(low.pitch >= 170 && low.pitch <= 240);
	});
});
