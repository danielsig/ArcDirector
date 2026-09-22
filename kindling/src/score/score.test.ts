import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	arpeggio,
	bar,
	callback,
	changes,
	chord,
	crescendo,
	diminuendo,
	end,
	f,
	line,
	mf,
	track,
	p,
	pad,
	piano,
	overdrive,
	piece,
	pitch,
	reverb,
	registerInstrument,
	root,
	slot,
	start,
} from './index.js';

describe('score', () => {
	it('places overdrive on a track and reverb on the piece', () => {
		const horn = track(piano, { filters: [overdrive({ drive: 0.4, tone: 1800 })] });
		const score = piece({ bpm: 80, filters: [reverb({ mix: 0.2 })] }, [
			bar(4, horn('c4:4')),
		]);
		assert.equal(score.filters?.[0]?.kind, 'reverb');
		assert.equal(score.filters?.[0] && 'mix' in score.filters[0] ? score.filters[0].mix : 0, 0.2);
		assert.equal(score.voices[0]?.filters?.[0]?.kind, 'overdrive');
	});

	it('durationless cells split a beat', () => {
		const n = line('g4 b4 d5 b4 | c4');
		assert.equal(n.length, 5);
		assert.equal(n[0]?.dur, 0.25);
		assert.equal(n[4]?.dur, 1);
		assert.equal(n[4]?.beat, 1);
	});

	it('timed line still ignores |', () => {
		const n = line('f#4:4 | d4:2 b3:2');
		assert.equal(n.reduce((s, x) => s + x.dur, 0), 8);
	});

	it('throws on accent suffix', () => {
		assert.throws(() => line('c4:1!'));
		assert.throws(() => line('c4>'));
	});

	it('parses chord octaves and arpeggio adds the octave', () => {
		const bed = track(pad, { dynamic: p });
		const score = piece({ bpm: 80, id: 'ch' }, [
			bar(4, bed(chord('C-', 2), chord('G2', 2))),
		]);
		assert.equal(score.loop, 4);
		assert.equal(score.id, 'ch');
		assert.equal(score.voices[0]?.notes.length, 6);
		assert.ok((score.voices[0]?.notes.find((n) => n.beat >= 2)?.pitch ?? 99) < 60);
		assert.equal(arpeggio('D-', 8).pitches.length, 4);
	});

	it('compiles tracks and hairpins', () => {
		const bows = track(pad, { gain: 0.7, dynamic: p });
		const score = piece({ bpm: 110, id: 'h' }, [
			bar(4, bows('c4:4', crescendo(f))),
			bar(4, bows('e4:4', f)),
		]);
		const notes = score.voices[0]?.notes ?? [];
		assert.ok((notes[0]?.vel ?? 0) < (notes[notes.length - 1]?.vel ?? 0));
	});

	it('slot define, replay, with, without', () => {
		const bed = track(pad, { dynamic: mf });
		const bows = track(pad, { dynamic: mf });
		const verse = slot();
		const score = piece({ bpm: 90, id: 'v' }, [
			verse(bar(4, bed(chord('C')))),
			verse(),
			verse.with(bows('c4:4')),
			verse.with(bows('e4:4')).without(bed),
		]);
		assert.equal(score.loop, 16);
		assert.equal(score.voices.length, 2);
	});

	it('start/end trim', () => {
		const bed = track(pad, { dynamic: p });
		const score = piece({ bpm: 60, id: 'w' }, [
			bar(4, bed(chord('C'))),
			start(),
			bar(4, bed(chord('G'))),
			end(),
			bar(4, bed(chord('D'))),
		]);
		assert.equal(score.loop, 4);
	});

	it('callback and loops once', () => {
		const bed = track(pad, { dynamic: p });
		let hits = 0;
		const score = piece({ bpm: 60, id: 'cb', loops: 1 }, [
			bar(4, bed(chord('C'))),
			callback(() => {
				hits += 1;
			}),
		]);
		assert.equal(score.loops, 1);
		assert.equal(score.cues?.[0]?.beat, 4);
		assert.throws(() => piece({ bpm: 60, id: 'bad', loops: 0 }, [bar(1, bed('c4:1'))]));
	});

	it('look-ahead hairpin', () => {
		const bows = track(pad, { dynamic: p });
		const score = piece({ bpm: 80, id: 'la' }, [
			bar(2, bows('c4:2', crescendo)),
			bar(2, bows('e4:2', f)),
		]);
		const a = score.voices[0]?.notes[0]?.vel ?? 0;
		const b = score.voices[0]?.notes.at(-1)?.vel ?? 0;
		assert.ok(b > a);
	});

	it('arpeggio walks a named chord', () => {
		assert.ok(arpeggio('D-', 8).beats === 8);
	});

	it('root is the lowest chord tone', () => {
		assert.deepEqual(root('C').pitches, [pitch('c3')]);
		assert.deepEqual(root('Bbmaj72').pitches, [pitch('bb2')]);
	});

	it('changes is a chord list realized per track', () => {
		const ch = changes(['C', 4], ['G', 4]);
		const bed = track(pad, { dynamic: p });
		const fig = track(piano, { dynamic: p });
		const low = track(pad, { dynamic: p });
		const score = piece({ bpm: 80, id: 'chg' }, [
			bar(8, bed(chord(ch)), fig(arpeggio(ch)), low(root(ch))),
		]);
		assert.equal(score.voices.length, 3);
		const bassN = score.voices[2]?.notes ?? [];
		assert.equal(bassN.length, 2);
		assert.equal(bassN[0]?.pitch, pitch('c3'));
		assert.equal(bassN[1]?.pitch, pitch('g3'));
		assert.ok(Math.abs((bassN[1]?.beat ?? 0) - 4) < 1e-6);
		assert.deepEqual(ch.as(root).map((b) => b.pitches[0]), [pitch('c3'), pitch('g3')]);
		assert.throws(() => changes('C', 'G'));
	});

	it('includes and excludes ranged chord tones by index or note', () => {
		const a = chord('A', 4).range('c#4', 'c#5');
		assert.deepEqual(a.include(0, 3).pitches, [pitch('c#4'), pitch('c#5')]);
		assert.deepEqual(a.include(1, 2).pitches, [pitch('e4'), pitch('a4')]);
		assert.deepEqual(a.include('c#4', 'c#5').pitches, [pitch('c#4'), pitch('c#5')]);
		assert.deepEqual(a.exclude(1, 2).pitches, [pitch('c#4'), pitch('c#5')]);
		assert.deepEqual(a.exclude('e4', 'a4').pitches, [pitch('c#4'), pitch('c#5')]);
		assert.deepEqual(chord('C').range(0, 3).pitches, chord('C').range('c3', 'c4').pitches);
		const wide = chord('A', 4).range('a2', 'a5');
		assert.deepEqual(wide.include(0, 9).pitches, [pitch('a2'), pitch('a5')]);
		assert.deepEqual(wide.include(4, 5).pitches, [pitch('c#4'), pitch('e4')]);
		assert.deepEqual(chord('C').include(0, 2).pitches, [pitch('c3'), pitch('g3')]);
		assert.deepEqual(chord('C').include(1).pitches, [pitch('e3')]);
		assert.deepEqual(chord('C').include(3).pitches, [pitch('c4')]);
		assert.deepEqual(chord('C').include(-1).pitches, [pitch('g2')]);
	});

	it('diminuendo on a hold rides one note', () => {
		const bed = track(pad, { dynamic: f });
		const score = piece({ bpm: 80, id: 'dim' }, [bar(4, bed(chord('C'), diminuendo(p)))]);
		const notes = score.voices[0]?.notes ?? [];
		assert.equal(notes.length, 3);
		assert.ok((notes[0]?.vel ?? 0) > (notes[0]?.velTo ?? 1));
		assert.equal(notes[0]?.dur, 4);
	});

	it('ties a sustain diminuendo without retrigger', () => {
		const bows = track(pad, { dynamic: mf });
		const score = piece({ bpm: 80, id: 'tie' }, [
			bar(8, bows('c4:4', f, 'c4:4', diminuendo(p))),
		]);
		const notes = score.voices[0]?.notes ?? [];
		assert.equal(notes.length, 1);
		assert.equal(notes[0]?.dur, 8);
		assert.ok((notes[0]?.vel ?? 0) > (notes[0]?.velTo ?? 1));
		assert.ok(Math.abs((notes[0]?.velRampAt ?? 0) - 4) < 1e-6);
	});

	it('overlays the same track in one bar', () => {
		const bed = track(pad, { dynamic: mf });
		const score = piece({ bpm: 80, id: 'ov' }, [
			bar(4, bed('c4:4'), bed('e4:4')),
		]);
		const notes = score.voices[0]?.notes ?? [];
		assert.equal(notes.length, 2);
		assert.equal(notes[0]?.beat, 0);
		assert.equal(notes[1]?.beat, 0);
	});

	it('offsets an overlay part with a rest', () => {
		const bed = track(pad, { dynamic: mf });
		const score = piece({ bpm: 80, id: 'rest' }, [
			bar(4, bed('c4:2'), bed('r:2 e4:2')),
		]);
		const notes = score.voices[0]?.notes ?? [];
		assert.equal(notes.length, 2);
		assert.equal(notes[0]?.beat, 0);
		assert.ok(Math.abs((notes[1]?.beat ?? 0) - 2) < 1e-6);
	});

	it('percussive instruments do not swell a held note', () => {
		const keys = track(piano, { dynamic: f });
		const score = piece({ bpm: 80, id: 'atk' }, [bar(4, keys('c4:4', diminuendo(p)))]);
		assert.equal(score.voices[0]?.notes[0]?.velTo, undefined);
	});

	it('registerInstrument then piece', () => {
		const toy = track(registerInstrument('toy', 'percussive', () => undefined));
		const score = piece({ bpm: 80, id: 'toy' }, [bar(1, toy('c4:1'))]);
		assert.equal(score.voices[0]?.instrument, 'toy');
	});

	it('unknown instrument throws', () => {
		assert.throws(() => piece({ bpm: 80, id: 'x' }, [bar(1, track({ instrument: 'trombone' })('c4:1'))]));
	});
});
