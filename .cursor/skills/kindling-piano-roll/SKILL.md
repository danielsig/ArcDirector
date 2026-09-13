---
name: kindling-piano-roll
description: >-
  Renders Kindling score authoring (`c4:2`, `|` cells, `chord`, `stack`, `bar`)
  as a zero-dependency piano-roll SVG: one column per piano key, time running
  down, keyboard sticky at the top of the HTML. Use when generating sheet notes,
  a piano roll, a score diagram, or anything a pianist can read from Kindling
  tokens.
---

# Kindling piano roll

Piano-roll diagram, not staff. Staff needs clefs, accidentals, and beams; crude staff looks wrong. One column per piano key (low left, high right); time runs down; rectangle length = duration. The HTML keeps the keyboard sticky at the top.

Run the script. Do not reimplement pitch math, `line` cells, or SVG layout. No npm, LilyPond, VexFlow, abcjs, or extra fonts.

## Run

From the repo root:

```
node .cursor/skills/kindling-piano-roll/scripts/roll.mjs INPUT -o OUT.svg
```

`INPUT` is a `.score.txt` path or a quoted token string. Writes `OUT.svg` and `OUT.html`. Open the **HTML** (sticky keyboard). `--beats 4` (default) sets barlines when the snippet has no `bar N`. `--title` sets the heading.

```
node .cursor/skills/kindling-piano-roll/scripts/roll.mjs "c4:2 e4:2 | g4:4" -o roll.svg
```

## Input (Kindling, not LilyPond)

- `c4:2` = pitch C4 for **2 beats**. `r` / `.` rest.
- `|` cells: durationless tokens in one cell split one beat equally. Do not mix `:n` and durationless in the same cell.
- `bar 4` (or `bar(4, …)`) starts a measure. Later parts in that measure **overlay** (same downbeat, different keys).
- `stack a3 c#4 e4` or `stack(['a3','c#4','e4'], 4)` — simultaneous pitches. Bare `a3 c#4 e4` without `stack` is sequential (splits the cell).
- `chord A` / `chord('D-')` / `chord('A', 4)` — same suffixes as Kindling (`m`/`-`/`min`, `dim`, `aug`/`+`, `sus2`/`sus4`, `7`, `maj7`, `m7`/`-7`, `m7b5`). Default octave 3; `Bb2` puts the octave in the symbol (the number after `chord('A', 4)` is **beats**, not octave).
- Accidentals: `c#4`, `bb2`, `eb3`.

Each non-`bar` line is one overlay part. A `#` at the **start of a line** is a comment (`c#4` is a pitch, not a comment).

## After

Open the `.html`. Keyboard along the top (low left, high right) stays put while time scrolls down. C columns are stronger; C4 is strongest. Notes that share a beat sit on one horizontal line; duration is vertical. Barlines match `bar N`.
