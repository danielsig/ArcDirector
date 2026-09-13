---
name: procedural-game-audio
description: >-
  Compose Kindling Web Audio scores and SFX patches. Use when adding or
  changing songs, sound effects, AudioSource, looping beds, or
  @arc-director/kindling/score.
---

# Procedural game audio

Kindling owns the mixer (`world.audio`). The host owns scores, patches, and when they play. Mixer API: [`kindling/README.md`](kindling/README.md) (Audio). Author with `@arc-director/kindling/score`. Do not reimplement playback or import instruments from `.`.

## Score

`track()` an instrument. Bars **call** that track. Omit a track → tacet. Two `track(pad, …)` calls are two tracks. The same track twice in one bar **overlays**. Sequential notes are one call (`low('c2:4 g2:4')`) or a rest offset (`low('c2:4'), low('r:4 g2:4')`).

```ts
import { arpeggio, bar, chord, root, track, piece, slot } from '@arc-director/kindling/score';
import { bass, pad, piano, pluck } from '@arc-director/kindling/score';
import { crescendo, f, mf, p } from '@arc-director/kindling/score';

const bed = track(pad, { cutoff: 640, dynamic: p });
const harp = track(pluck, { dynamic: p });
const low = track(bass, { dynamic: mf, transpose: -12 });
const verse = slot();

piece({ bpm: 110, id: 'example' }, [
	verse(
		bar(8, bed(chord('B-')), harp(arpeggio('B-')), low(root('B-'))),
		bar(8, bed(chord('E-')), harp(arpeggio('E-')), low(root('E-'))),
	),
	bar(8, bed(chord('G')), harp(arpeggio('G')), low(root('G')), harp('g4 b4 d5 b4 | g5 d5 b5 g5', crescendo(f))),
	verse(),
	verse.with(track(piano)('f#4:4 | d4:2 b3:2')),
	verse.without(bed),
]);
```

`c4:2` is C4 for **2 beats** (not LilyPond). Durationless notes in one `|` cell share a beat. Do not mix `:n` and durationless in the same cell. Marks sit after the notes they apply to. Running dynamic persists. `crescendo` / `diminuendo` with no target looks ahead to the next absolute mark. Extra voices: `registerInstrument` (`percussive` or `sustaining`). Do not add `swell` / `taut` / `mist` / `veil` — a climb is a `line` string.

Tracks: `pad` body; `bass` roots; `pluck` guitar/harp (`arpeggio`); `lead` one melody; `piano` hammer; `bell` sparse hits; `drum` groove (MIDI `<40` dum, `<45` tek, else tap); `air` noise bed. Guitar is `pluck`.

After writing, unlock audio, listen through one loop. Loop click → shorten the last note or land the next chord on beat 0 only.

## SFX

A patch is a few layers (`noise`, `thump`, `click`, `creak`, `pluck`, `fm`, `chirp`, `murmur`) with short envelopes. Cue with `AudioSource.play` / `AudioSource.loop`, or `world.audio.playSfx` / `playLoop`. Prefer `AudioSource` so pose follows `transform`. `playLoop` every frame with a **stable** object (patch or `Score`); the mixer keeps the clock.

## Quality

Warm filtered saw pads, Karplus-Strong plucks, additive piano, sine flute, FM bells, lowpass drums. Reverb is already on the music bus. Do not stack five leads; add rests and at most one countermelody. Raw square/pulse is not the whole piece.
