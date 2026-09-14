---
name: anime-clock-character
description: >-
  Generate ArcDirector human clock-character art (idle, walk, take/give) as
  magenta-keyed anime sprites from identity refs plus the skill's grayscale
  anime mannequin pose guides (45° downward camera). Solo albedo is idle_06
  and idle_12 only; other idles are one pose-locked strip; each walk hour
  (12/3/6/9 and 2/4/8/10) is one 3x3 mixed-idle sheet (framed idle + 8 walks);
  take/give is the same 3x3 method (framed idle_06 + 8 takes).
  Shape (`_d`: idle 3x3 first with the locked clay/flash prompt, then each
  walk/take 3x3 using that hour's idle `_d` in the top-left frame; normals
  baked from `_d`), and a metallic map (`_m`: idle 3x3 first with the locked
  metalness prompt, then each walk/take 3x3 using that hour's idle metallic
  in the top-left frame). Do not pack an 8-col `_d` atlas.
  Use when creating a new NPC/player look, clock-hour sprites, walk cycles,
  take/give strips, or character depth/normal/metallic maps.
---

# Anime clock character

Read [style.md](style.md), [poses.md](poses.md), and [maps.md](maps.md) before any `GenerateImage`. Solo albedo (idle_06 / idle_12): copy **Style** + **Camera** verbatim. Idle strip: the description **must start with `POSE LOCK.`** Walks, take/give, and **metallic 3×3** use the recipes below — **do not** start those with `POSE LOCK.` Metallic copies the locked metalness prompt in [maps.md](maps.md) verbatim. Shape `_d` 3×3 copies the locked clay/flash prompt verbatim (`POSE LOCK.` is already the last two words — do not prepend another).

Work dir: `game/public/characters/{folder}/`. Final stems live there. Intermediates in `{folder}/_gen/` or this skill’s `junk/` (failed gens only). Do not invent hours 7 or 11. Do not FlipX authored walk 8 / 9 / 10. Do not overwrite `guides/`. Player kind → folder is `PLAYER_FOLDER` in `game/scripts/characters.mjs`.

## Clock hours

Stems are numbered like a clock facing the camera: **6** is face-on, **12** is the back. **2 / 4 / 8 / 10 are 45° diagonals**, not analog 2:00 / 4:00. We write `2` because “1:30 o’clock” is pedantic.

| Stem | Means | From 12 (back, clockwise) | From 6 (camera; + = screen-right) |
|------|--------|---------------------------|-------------------------------------|
| 12 | 12:00 | 0° | ±180° |
| **2** | **1:30** | **45°** | **+135°** |
| 3 | 3:00 | 90° | +90° |
| **4** | **4:30** | **135°** | **+45°** |
| 6 | 6:00 | 180° | 0° |
| **8** | **7:30** | **225°** | **−45°** |
| 9 | 9:00 | 270° | −90° |
| **10** | **10:30** | **315°** | **−135°** |

Do not author 7 or 11. Idle 8 / 9 / 10 come from the pose-locked idle strip (not FlipX). Walk 8 / 9 / 10 are their own 3×3 sheets (not FlipX of 4 / 3 / 2). Do not FlipX maps either. `idle_01` / `idle_05` are leftover 30° extras — the engine’s facing never picks them.

**3 o'clock and 9 o'clock (true profiles) are where the 45° downward tilt is most likely to go wrong.** Idle `03` / `09` and walk hours **3** / **9** often come back as eye-level side-scrollers. Be most careful there: crown disc, shoulder tops, boot-top planes, foreshortened legs vs `guides/idle_03.png` / `idle_09.png` and that hour’s walk guides. Regen if the camera stood up.

## Pose guides

`guides/{stem}.png` is a 2× copy of the albedo cels in `game/public/characters/mannequin/` (384×512 → 768×1024, 3:4, magenta `#FF00FF`). Camera, yaw, and limb layout. Take `take_06_2`…`_6` also show a tiny brown neck-held purse — that purse is part of the pose lock. **Do not GenerateImage new guides.** Publish from that folder:

```
node .cursor/skills/anime-clock-character/scripts/publish-guides.mjs
node .cursor/skills/anime-clock-character/scripts/sheet.mjs check-guides
```

Do not overwrite `junk/wooden-female-mannequin/idle_2x4.png` (photoreal lock). Wireframe dummy output is junk — do not attach it. `idle_01` and `idle_05` have no mannequin cel.

## What used to fail (do not repeat)

- Generating idle_02 / 03 / 04 / 08 / 09 / 10 as **separate** images (yaw and camera drift). After idle_06 and idle_12 exist, the other idle hours are **one** 8-cell POSE LOCK strip. Do not GenerateImage those hours one-at-a-time.
- Generating `walk_HH_i` as **separate** images (stride drift). Walk is **one 3×3 per hour**: framed `idle_HH` + mannequin `_0`…`_7`. Not per-frame, not 5×4 even/odd, not all eight hours on one albedo.
- Putting **all eight** walk hours on one sheet (cells too small; hour 6 steals yaw). **9×4 / 9×2 on 16:9** lands ~720p and the same yaw steal.
- **Walk or take 3×3 / 2×4 `POSE LOCK.`** That stands the camera up and faces fronts (take also invents hands-on-hips / waves). The working 3×3 does **not** use `POSE LOCK.`
- **Take as a 2×4 POSE LOCK sheet.** Same fail as walk 2×4. Take is **one 3×3**: framed `idle_06` + mannequin `take_06_0`…`_7`.
- **Redrawing the take purse.** The dummy’s brown pouch on `take_06_2`…`_6` is locked: same size, same brown, pinched at the neck, bag hanging. Do not drop it, enlarge it, recolor it, palm it from below, or replace it with coins / gold / a sack. `_0` / `_1` / `_7` stay empty-handed.
- **Walk 5×4 even/odd mixed-idle** (footnote). Pose can hold, but two sheets = two hair/clothes rolls and flicker every other frame. Do not use unless asked.
- **Eight-across / 1×8 on 16:9.** 192px muddy cells, dropped frames (6 instead of 8), stolen yaw. Never.
- Extra refs (neighbors, other hours, a contact cell while asking for a passing) steal yaw and copy the wrong stride.
- Attaching photoreal wood or the wireframe dummy as the pose guide. Attach the grayscale anime mannequin.
- **Pasting the grey dummy into a cell** (hour 8 `_0`, hour 2 high-knee cells). Every occupied cell is this character. Dummy in any cell = junk the whole sheet.
- Whole-strip FlipX reverses frame order. Flip **each cell**.
- Attaching a contact as identity when generating a passing copies the contact.
- Magenta **outlines** (halo, rim, pink fringe on hair/hat/robe/skin). Magenta is the keyed background only. `fit` eats those pixels and leaves holes. Outlines are black/dark ink.
- Fitting a large gen down to **192×256** (or any card smaller than 384×512). That is a pixel-art stamp. The lock looks tiny and muddy in-world.
- **`fit --allow-lowres` on a small walk sheet.** A 3:4 3×3 often lands ~864×1152 (cells ~288×384). `--allow-lowres` keeps `s=1` and plants a postage-stamp figure. 4× nearest the **whole sheet** first, then `fit` **without** `--allow-lowres`. Same trap on a 1024² 5×4 (~204×256 cells).
- **Walk prompt fails (do not repeat):** `POSE LOCK.` / `LOCK POSE.` / ALL-CAPS `DO NOT CHANGE THE CAMERA` stand the camera up and face-front every cell. “Dress up / reskin / change only clothes” invents a walk or drops cells. Attaching **two** refs (mannequin sheet + mixed idle) fights itself. Attaching a prior gen as the main replace-dummy ref (except the optional above-neck pass) copies that gen’s mistakes. Explaining every walk cell or naming columns collapses yaw.
- Shipping an **idle_06 needle** (bboxA < 0.45). Front idle must read as a person, elbows slightly out.
- **Chibi on diagonals.** Walk 2/4/8/10 came back with a head ~1/3 of the figure. The lock is teen/adult JRPG: head about **one-fifth**. Compare every walk cell to `idle_06`. Super-deformed = junk.
- Copying the pose dummy's body onto the character (hourglass, bust, hip flare, glute mass, jointed plastic). The guide is pose only; body comes from the lock.
- Standing the camera up. Eye-level, fashion-plate, or "slight 3/4 down" is FAIL. The tripod stays **45° down** on every gen (lock, idle_12, idle strip, walk, take, maps). Crown disc, shoulder tops, boot tops must be visible. Legs stay foreshortened. **Most careful on 3 o'clock and 9 o'clock idle and walk** — true profile is the usual side-scroller / eye-level fail.
- Letting a one-sided detail jump sides (eyepatch, hair part, ponytail, sword sheath, scar, earring). Lock laterality from `idle_06`. FlipX of hour 6/12 walk contacts swaps those props — author both contacts when the character is asymmetric.
- **Growing a back copy of a front-only detail.** If `idle_06` shows something on the chest that `idle_12` does not show on the back, walk 12 / 2 / 10 must match that back. A hanging spine copy is FAIL. Example (witch): chest braid body-left; `idle_12` / `idle_10` / `idle_02` are a smooth back.
- **Missing lower clothes / bare skin.** If `idle_HH` shows pants/leggings/skirt between clothes and boots, every walk cell of that hour must too. A slit that opens on a stride still shows those clothes — not skin.
- **Invented headgear trim.** Everything above the neck matches `idle_HH`. Do not add a band or brim the idle lacks.
- **Frozen walk limbs.** `check` xor only tests `_0` vs `_4`. That is not enough. Hours 4 and 8 shipped with both arms idle-hanging and the same leading boot on almost every cell (one kick frame is not a cycle). Hours 2 and 10 shipped with only the **far** arm swinging. Read all eight cells vs the mannequin before fit. Both arms move. Leading foot swaps when the guide’s does.
- **Bare feet / white socks / missing boots** on a lifted foot. Always the lock’s boots.
- **Hour 2 drawing a face.** Back-right is a back. `idle_06` as identity must not steal yaw. If you see eyes on 2 / 10 / 12, junk.
- **JPEG labeled `.png`.** Generator files can be JFIF (`FF D8`). `pngjs` then throws `unrecognised content at end of stream`. Re-encode to PNG and snap near-magenta to `#FF00FF` before `stitch` / `fit` / `fit-d` / `fit-m`. Same trap on map gens.
- **Shipping because “max 3.”** A retry cap is not a pass. If the sheet is still chibi, wrong-yaw, dummy, frozen-limb, or missing the idle’s clothes, do not `fit` it into the character folder.
- **Re-fitting a full 8×10 map atlas to fix two walk hours.** Even-grid stretch pancakes back hats (12 / 2) and shears limbs. If only some hours are wrong, re-roll that hour’s **3×3** `_d` / `_m` — [maps.md](maps.md) repair path. Do not overwrite albedo.
- **Shape `_d` “head is a dome” / “crown disc” / “pointed hat is a cone plus brim.”** Those phrases paint a smooth shell even when the albedo is hair. Follow the attached head silhouette as volume. Do not name dome / brim / cone unless that albedo actually has a hat.
- **Independent X/Y stretch** of a shape cell onto the albedo box. Hats go pancake. `fit-d` is **uniform height scale**, horizontally centered.
- **Treating a dark back robe as empty** in `fit-d` (bbox becomes hair/hands). Figure pixels stay in the box down to near-black; only `r+g+b < 6` is background.
- **Occupancy-band crop on metallic gens.** Metal sheets are too dark to find cells. `fit-d` / `fit-m` use even-grid bands from the layout JSON.
- **Magenta on a metallic or shape 3×3 ref.** Albedo walk/take 3×3 stays magenta. Map refs (`mref` / `dref`) are **black** behind every idle and walk/take albedo cell (empty idle top-left is black too). Magenta on that stitch is FAIL — flood to black before `GenerateImage`.
- **Trusting GenerateImage auto-captions.** They will call a 2×4 back walk “3×3 / faces.” `Read` the PNG.
- **Editing the locked metallic or shape prompt.** Copy each from [maps.md](maps.md) verbatim. Metallic: do not prepend `POSE LOCK.`, do not append SHINE, do not paint `_m` in Python. Idle `_m` 3×3 first; walk/take `_m` only add `metallic map in top-left frame for reference`. Shape: the locked clay/flash block already ends with `POSE LOCK.` — do not prepend another, do not append facing-map essays. Idle `_d` 3×3 first; walk/take `_d` only add `example in top-left frame for reference`. The shape **backup** block in [maps.md](maps.md) is the only allowed substitute, and only after the locked flash line already failed (gloss / glare / cast shadows / outlines / dummy joints). Do not start `_d` with the backup. Do not write a third prompt.
- **8-col first-pass `_d` sheet / 2×4 magenta-gutter shape repair.** Shape is idle 3×3 then per-hour 3×3, same layout as metallic. Do not attach packed `albedo.png` as the shape ref.
- **Baking `_n` from a blown-white or crushed-black `_d`.** Sobel goes flat (or noisy). After `fit-d`, run `levels-d.mjs` on the mapfit dir — it stretches too-bright / too-dark / flat figure luma into a facing range. Then bake. Do not paint `_d` in Python. `--force` if a keeper is still too even after the default skip.
- **Baking `_n` from a second stretch** when `_d` is already 384×512. `depth_to_normal.mjs` samples 1:1 in that case. Do not rebake unless `_d` changed.
- **Refitting published `{kind}/*_d.png` / `*_m.png`.** Those are already stamped through the albedo. Silhouette Y (and often X) already matches, so a second Y-stretch / AABB-fit / outline-eat is a no-op or paints the clipped rim onto the skull (dark crown cap in-game). Recorrect / realign / refit from the **unmasked** gen: `{kind}/_gen/maps/{idle_3x3|walk_HH|take}/raw/sheet_4x.png` (or `sheet.png`), even-grid crop, then `fit-d` / `fit-m`. Skip the dark outline when boxing clay. Same for metallic. Do not use git-index or `{kind}/` maps as the source volume.

## Trial and error (required)

`GenerateImage` is a sampler. One prompt is not a deliverable. **Do not pack a sheet you already called FAIL.**

1. **QC by filling the Walk checklist** (albedo) or the **Map checklist** in [maps.md](maps.md), not by “looking if it is fine.” After every gen, `Read` the image. Ignore GenerateImage auto-captions. Compare each **walk** cell to that hour’s mannequin **and** to `{kind}/idle_HH.png` (this hour) plus the identity card. Back hours also vs `idle_12`. Map gens: compare to that stem’s albedo and to `{kind}/idle_06_d.png` / `_n.png` / `_m.png`.
2. **Multi-seed.** `GenerateImage` has no seed argument — a new `filename` is a new sample. Walk: 2–4 gens per **hour** (`{kind}_walk_HH_3x3_s1.png`, …). Read all. Keep the best. Copy losers to this skill’s `junk/` (do not delete).
3. **Change the prompt when the same fail repeats.** Do **not** “fix” a walk 3×3 by adding `POSE LOCK.` or extra refs — that stands the camera up. Re-roll the same small prompt, or do an **above-neck** second pass on a keeper (hair / headgear vs the framed idle). **IFF** the result looks like it has mannequin joints, refeed that posed sheet (skin pass below) — do not paint joints in Python, and do not full-regen the walk.
4. **Walk layout is one 3×3 per hour** (workflow §5): framed `idle_HH` + eight mannequin walks. **Take is the same 3×3** (workflow §6): framed `idle_06` + eight mannequin takes. Do not fall back to 5×4 even/odd (flicker) or 3×3 / 2×4 `POSE LOCK.` (faces the camera). **Never 1×8 / eight-across / 9×4 on 16:9.** Attach a sheet in the **same grid** you ask the model to draw.
5. **Keep going until a candidate passes the written checklist** (below), then `fit`. If a batch is all junk, junk it, change one thing (prompt or layout), batch again. Tell the user **which checklist rows failed** instead of packing a known-bad cycle.
6. Generator PNGs may actually be JPEG. If `stitch`/`fit` chokes, convert with PIL, snap magenta, write a real PNG.

## Identity card (write this before any walk gen)

Read `{kind}/idle_06.png`, `{kind}/idle_12.png`, and `{kind}/idle_HH.png` for the hour you are about to draw. Write a **card** of pieces that must appear in every walk cell. Example (witch):

- Cloak/robe dusty purple-grey, light trim on opening + hem. **No extra hat band** unless that idle has one. Never call this garment a coat.
- Black **pants/leggings** between hem and boots. If the robe slits, the slit shows those pants — **not bare thigh**.
- Black boots on both feet.
- Black belt (silver buckle from the front).
- **Braid: chest, body-left, draped forward.** `idle_12` / `idle_10` / `idle_02` = smooth robe back, hair may tuck at the neck, **no braid down the spine.**
- Head ~1/5 of the figure, same as `idle_HH` — not chibi.

Use this card for the Walk checklist. **Do not dump it into the short walk prompt** — the framed idle is identity. A walk cell that drops clothes the idle shows, invents a spine copy of a front-only detail, or grows trim the idle lacks is FAIL.

**Do not attach adjacent idles.** The framed top-left idle is identity. Extra refs fight the dummy yaw.

## Walk checklist (fill before fit; any NO junks the hour)

Do not “eyeball if it looks fine.” After `Read`ing the gen, copy this table and mark **YES / NO** per walk cell (the eight walk poses, **not** the framed top-left idle). One 3×3 has all eight. Compare outfit to `idle_HH` + the identity card. Compare limbs to that hour’s mannequin `_0`…`_7`.

For each of `_0`…`_7`:

1. Same person as `idle_HH` (not the grey dummy, not a different outfit).
2. **Not chibi** — head (and whatever sits on it) vs `idle_HH` is about the same, not a bigger head on a shorter body.
3. Everything **above the neck** matches idle (hair, hat, helm, or bare head — **no invented trim/band**).
4. **Clothes** match (color, trim). Belt matches if the idle has one.
5. **Lower body matches idle.** If the idle shows pants/leggings/skirt under or through the clothes, the walk cell does too — not bare skin.
6. Footwear on **both** feet if the idle has it (lifted foot too). No bare feet, no white socks.
7. **Hair / above-neck details match that yaw’s idle.** Front-only details stay on the front. Back hours (12 / 2 / 10) match `idle_12` / `idle_HH` — no invented spine copy.
8. Yaw matches the mannequin (no face on 2/10/12; 8 is 7:30 not 6). **Hours 3 and 9:** still **45° down** (crown disc, boot-top planes, foreshortened legs) — not an eye-level side-scroller.
9. **Left foot** planted/forward/lifted matches that mannequin cell.
10. **Right foot** matches that mannequin cell.
11. **Left fist** forward/back/hang matches that mannequin cell (not idle-glued).
12. **Right fist** matches that mannequin cell.
13. Empty fists. Magenta is background only.

Also for the whole strip:

14. `_0` vs `_4` are opposite contacts (not clones).
15. `_1` vs `_5` swap leading boot when the mannequin does.
16. **Both** arms move across the eight. Far-arm-only on 2/10 is NO.
17. Eight walk figures present. Framed idle cell is discarded.

If any row is NO, do not `fit`. Junk the sheet, seed-batch or change the prompt. `sheet.mjs check` xor is item 14 only — it will not catch missing clothes or a spine copy of a front-only detail.

## Hard rules

1. **Albedo idle: only `idle_06` and `idle_12` are solo 3:4 gens.** Never GenerateImage idle_02 / 03 / 04 / 08 / 09 / 10 one-at-a-time. After those two exist, **one** 8-cell idle strip (workflow step 4). **Walk is one 3×3 per hour** (workflow step 5) — never per-frame, never 5×4 even/odd unless asked, never all-eight-hours-in-one-sheet. **Take is one 3×3** like walk (workflow step 6) — framed `idle_06` + eight mannequin takes; never `POSE LOCK.` 2×4. **Metallic and shape `_d`: idle 3×3 first, then one 3×3 per walk/take hour** (rule 11, [maps.md](maps.md)).
2. **Solo stems** (idle_06, idle_12 only) attach `guides/{stem}.png` plus, after it exists, this character’s `_gen/locks/idle_06.png`. Idle sheet attaches the mannequin idle **2×4** + this character’s idle_06 + idle_12. Walk 3×3 attaches **only** that hour’s mixed stitch (`walk_HH_3x3_idleframe.png`) — not a mannequin-only twin, not adjacent idles, not a prior gen (except an explicit above-neck pass or a mannequin-joints skin refeed). Take 3×3 attaches **only** `take_06_3x3_idleframe.png` (same exceptions). Metallic idle attaches **only** `idle_3x3_mref.png`. Shape idle attaches **only** `idle_3x3_dref.png`. Clip maps attach that hour’s `walk_HH_3x3_mref.png` / `dref.png` (or take). Not wood. Not a wireframe dummy. Not packed 8-col `albedo.png`.
3. **Head yaw = body yaw.** The mannequin’s facing is the facing. No glance at camera on hours 1–5 or 12. **Tilt = 45° down** on every gen, matching the guide. Regen if the camera stood up or went bird’s-eye. **Be most careful on 3 o'clock and 9 o'clock idle and walk** — that tilt is most likely to go wrong on true profile.
4. **Idle feet** match this character’s `idle_06` gap. Only the whole body yaws.
5. **Walk is 8 frames per hour** (`_0`…`_7`) in both `guides/` and the character folder. `_0` / `_4` opposite contacts (wide step). `_2` / `_6` opposite passings (feet close, low lift, not a stork). `_1` / `_3` / `_5` / `_7` inbetweens halfway to the next even frame (`_7` wraps toward `_0`). Guide `_0` is a **high lifted right knee**, not idle and not a standing step. Guide `_2` lifts the left foot; guide `_6` lifts the right. Hour 12: far foot higher in the frame. Hour 6: forward foot lower. **Trace the attached mannequin when it disagrees with this table.** Both arms must move. Clothes do not excuse idle-hang fists. The far-arm-only cheat on back-diagonals is FAIL.
6. **Take** is hour 6 only, **one 3×3** like walk (workflow §6). Image-right arm. The dummy already holds a **tiny brown drawstring purse** (pinched at the neck, bag hanging) on `_2`…`_6`. `_0` / `_1` / `_7` are empty-handed. **Do not modify that purse** when replacing the dummy with this character — copy it. Give is this strip reversed. Do not bake the purse into idle or walk. The fist must not grow toward the camera.
7. **Palette** from the lock in every later prompt. Hair hex drift fails the cell.
8. **Do not author hours 7 or 11.** Idle 8 / 9 / 10 come from the pose-locked idle strip (not FlipX). Walk 8 / 9 / 10 are their own 3×3 sheets (not FlipX of 4 / 3 / 2). Hours 6 and 12: both contacts are in that hour’s 3×3 — do not FlipX `_0`→`_4` when laterality is one-sided.
9. **Magenta is background only.** Flat `#FF00FF` behind the figure. Character outlines, rims, and interior lines are black/dark — never magenta, never pink. Regen if the figure is traced in magenta.
10. **High res, full card.** Solo albedo `GenerateImage` must come back ≥ **768×1024**. `fit` lands **384×512**. Do not upscale solo gens. Do not ship 192×256. Idle strips are a **2×4 grid** on `16:9` — `fit --allow-lowres` on those cells (already ~384×512). Walk **and take** are **3×3 / 3:4**. Never 1×8. **Do** 4× nearest the **whole 3×3 sheet** before split if cells are under 768×1024, then `fit` those cells **without** `--allow-lowres` (an 864×1152 3×3 cell is ~288×384; `--allow-lowres` plants a postage stamp). `idle_06` lock bboxA **0.50–0.85** (check floor 0.45). fillH ≥ 0.90. Chibi (head a third of the figure vs `idle_HH`) is FAIL even if the card is full. Missing clothes the idle shows, or a new spine copy of a front-only detail, is FAIL.
11. **Maps are `_d` / `_n` / `_m`.** `_d` is uncolored clay / camera-flash (front planes light, rims darker), not a camera-Z fade and not a grayscale albedo. Metallic **and** shape are **idle 3×3 first** (empty top-left + eight idle albedos on black), then one 3×3 per walk/take hour (that hour’s idle map in a white frame + eight albedo frames on black). Copy each locked prompt in [maps.md](maps.md) **verbatim**. Metallic animations append only `metallic map in top-left frame for reference`. Shape animations append only `example in top-left frame for reference`. Do not prepend `POSE LOCK.` to metallic. Shape’s locked block already ends with `POSE LOCK.` — do not prepend another. Do not paint `_m` in Python. Multi-seed until the idle map is good before any clip of that type. `fit-m` / `fit-d` onto the albedo silhouette. Bake `_n` from fitted `_d`. **No magenta** on shipped maps (empty is black; normal empty is `#8080FF`). Do not FlipX maps if walk 8 / 9 / 10 were authored. Copy-retry `_d` / `_n` / `_m` only — never overwrite albedo. If a shipped map is short, sheared, or capped at the crown, **do not stretch the file in `{kind}/`** — that file is already masked; go back to the unmasked `raw/sheet_4x.png` ([maps.md](maps.md) refit).
12. **Laterality.** Image-left = character left; image-right = character right (sword hand). From `idle_06`, write which side owns every one-sided detail (hair part, ponytail, eyepatch, sheath, scar, earring, pauldron). That side is **body-left or body-right**, not screen-left. Keep it on that body side in every idle, walk, and take. Yaw hides or reveals it; it does not hop. **Front-only details** (chest hair, a necklace, a chest jewel): read `idle_12` and `idle_HH`. If the back idle does not show it, back hours (12 / 2 / 10) must not grow it on the spine. **Outfit lock from `idle_HH`:** whatever that idle wears (clothes, lower body, above-neck). FAIL and regen if a one-sided detail hops sides — or appears on the back when the lock keeps it on the front — or if clothes the idle shows vanish.

## Tools

```
node .cursor/skills/anime-clock-character/scripts/publish-guides.mjs
node .cursor/skills/anime-clock-character/scripts/sheet.mjs check-guides
node .cursor/skills/anime-clock-character/scripts/sheet.mjs fit FILE.png --out FILE.png [--allow-lowres]
node .cursor/skills/anime-clock-character/scripts/sheet.mjs lock-head DIR walk_04
node .cursor/skills/anime-clock-character/scripts/sheet.mjs check DIR --clip idle|walk|take|all
node .cursor/skills/anime-clock-character/scripts/stitch.mjs flipx-cells STRIP.png --out STRIP_FLIP.png
node .cursor/skills/anime-clock-character/scripts/stitch.mjs xor-cells a.png b.png
node .cursor/skills/anime-clock-character/scripts/stitch.mjs split STRIP.png --cells 4 --out prefix
node .cursor/skills/anime-clock-character/scripts/stitch.mjs split STRIP.png --grid 2x4 --out prefix
node .cursor/skills/anime-clock-character/scripts/stitch.mjs split STRIP.png --grid 3x3 --out prefix
node .cursor/skills/anime-clock-character/scripts/stitch.mjs split STRIP.png --grid 4x5 --out prefix
node .cursor/skills/anime-clock-character/scripts/stitch.mjs grid-pack c0.png … c7.png --grid 2x4 --out sheet.png
node .cursor/skills/anime-clock-character/scripts/stitch.mjs grid-pack idle_HH_magenta.png walk_0.png … walk_7.png --grid 3x3 --out walk_HH_3x3_ref.png
node .cursor/skills/anime-clock-character/scripts/maps-sheet.mjs pack DIR --out albedo.png --json layout.json
node .cursor/skills/anime-clock-character/scripts/maps-sheet.mjs fit-d DEPTH.png --json layout.json --out DIR [--albedo albedo.png] [--sheet fitted_d.png]
node .cursor/skills/anime-clock-character/scripts/levels-d.mjs DIR [--force] [--dry]
node .cursor/skills/anime-clock-character/scripts/maps-sheet.mjs fit-m METAL.png --json layout.json --out DIR [--albedo albedo.png] [--sheet fitted_m.png]
node .cursor/skills/anime-clock-character/scripts/maps-sheet.mjs bake-m DIR [--shine 128] [--sheet fitted_m.png]
node .cursor/skills/anime-clock-character/scripts/maps-sheet.mjs unpack SHEET.png --json layout.json --suffix _d|_n|_m --out DIR
node .cursor/skills/anime-clock-character/scripts/maps-sheet.mjs flipx-n SRC.png --out DST.png
node .cursor/skills/anime-clock-character/scripts/maps-sheet.mjs check DIR
node .cursor/skills/anime-clock-character/scripts/maps-sheet.mjs selftest
```

`fit` flood-keys magenta, zeros keyed RGB (so scale cannot bleed #FF00FF back in), drops orphan edge bars (leaked idle-frame white into `walk_HH_2` / `take_06_2`), despills pink AA on the silhouette, and uniform-scales into **384×512**. Never stretch. Solo albedo (idle_06, idle_12) must be ≥ 768×1024 or `fit` exits 1 — do not upscale. Idle strip cells come from a **2×4** `16:9` sheet (`stitch.mjs split … --grid 2x4`); each cell should already be ~384×512. `fit --allow-lowres` on those cells. Do **not** 4× nearest-neighbor a 192px eight-across split. **Walk and take 3×3:** `GenerateImage` `3:4` sheets are often ~864×1152 JPEG. Re-encode to PNG, snap magenta, 4× nearest the **whole sheet**, split `--grid 3x3` (rows×cols), **discard cell `_0`** (framed idle — do not overwrite `idle_HH`), then `fit` cells `_1`…`_8` **without** `--allow-lowres` (`_1`→`walk_HH_0` / `take_06_0` … `_8`→`_7`). `--allow-lowres` on a ~288×384 cell keeps `s=1` and ships a postage stamp. After `fit` on a walk or take cycle, `lock-head DIR walk_HH` (or `take_06`) translates the eight cells so head centroid stays put; it also shifts `_d` / `_n` / `_m` by the same offset. `fit` plants feet on the bottom pad — that is not a head lock. `fit` prints `magHalo=N` and exits 1 if any magenta/pink remains on the figure. Generator output labeled `.png` may be JPEG — re-encode before `stitch`. If the game has character PNGs mapped (Windows `UNKNOWN` / file lock), `fit` and `lock-head` into `{kind}/_gen/walk_HH_3x3_fit/` then copy-retry into `{kind}/`.

`check` (character dir) asserts **384×512**, fillH ≥ 0.90, bboxA 0.28–0.85, **idle_06 bboxA ≥ 0.45**, **magHalo=0**, **tilt** vs `guides/{stem}.png` (leg-mass / y-centroid — camera dropped if the figure is too bottom-heavy vs the guide), **eight walk cells per hour**, and **motion**: walk `_0` vs `_4` silhouettes must differ; `take_06_0` vs `take_06_7` must differ. `magHalo` is leftover magenta/pink on opaque pixels — regen, do not ship. **Xor is not the Walk checklist:** frozen arms, far-arm-only, same leading boot, chibi, missing clothes, and spine copies of front-only details can still xor-pass. `--clip all` also runs `maps-sheet.mjs check`. `check-guides` requires the same eight walk cells per hour.

`maps-sheet check` (after unpack / `fit-d` / `fit-m`): `_d` / `_n` / `_m` must match albedo size; **zero magenta**; shape/metallic empty is black; normal empty is `#8080FF`; `_d` / `_n` silhouette offset ≤ 12px. That is **not** the Map checklist — pancake hats, sheared walks, hem-chrome `_m`, and ghost feet can still pass. `selftest` packs a dummy, `fit-d`s shape, unpacks normals, and runs that check.

`levels-d` (after `fit-d`, before bake `_n`): figure-only luma. Too bright (mean ≥ 185 or p10 ≥ 165), too dark (mean ≤ 90 or p90 ≤ 140), or flat (p90−p10 < 40) → stretch p8–p98 into 48–210. Already in range → skip. `--force` always stretches. `--dry` reports. Black stays black. Do not use this to rescue a wrong pose — junk and re-roll. Then `depth_to_normal.mjs`.

`GenerateImage` solo albedo (idle_06, idle_12 only): `filename` only. `aspect_ratio` `3:4`. Two `reference_image_paths` after the lock exists. After the file lands, read it: if width < 768 or height < 1024, discard and regen. Do not `fit` a small solo image.

`GenerateImage` idle turntable: `aspect_ratio` `16:9`. Three refs: mannequin idle **2×4** sheet, this character’s idle_06, this character’s idle_12. Description starts with `POSE LOCK.`

`GenerateImage` walk: `aspect_ratio` `3:4`. `filename` only (no directory — gens land in Cursor `assets/`). Attach **only** `{kind}/_gen/walk_HH_3x3_idleframe.png`. Do **not** start with `POSE LOCK.` Copy the 3×3 block in Prompt shape. 2–4 filenames per hour. Above-neck pass attaches **only** the winning posed sheet.

`GenerateImage` take: `aspect_ratio` `3:4`. `filename` only. Attach **only** `{kind}/_gen/take_06_3x3_idleframe.png`. Do **not** start with `POSE LOCK.` Copy the take 3×3 block in Prompt shape. Same above-neck / joints skin passes as walk.

`GenerateImage` metallic idle: `aspect_ratio` `3:4`. Attach **only** `{kind}/_gen/idle_3x3_mref.png` (empty top-left + eight idle albedos, **black** backgrounds). Copy the locked prompt in [maps.md](maps.md) **verbatim**. No `POSE LOCK.` Multi-seed until the mask is good.

`GenerateImage` metallic walk/take: `aspect_ratio` `3:4`. Attach **only** that hour’s `{kind}/_gen/walk_HH_3x3_mref.png` (or `take_06_3x3_mref.png`): idle `_m` in the white top-left frame + eight albedo frames on **black**. Locked prompt plus the line `metallic map in top-left frame for reference`. No `POSE LOCK.`

`GenerateImage` shape idle: `aspect_ratio` `3:4`. Attach **only** `{kind}/_gen/idle_3x3_dref.png` (empty top-left + eight idle albedos, **black** backgrounds). Copy the locked clay/flash prompt in [maps.md](maps.md) **verbatim**. Multi-seed until idle clay is good. If those gens stay glossy, shadowed, outlined, or jointed, switch to the **backup** shape prompt in [maps.md](maps.md) — not a new essay.

`GenerateImage` shape walk/take: `aspect_ratio` `3:4`. Attach **only** that hour’s `{kind}/_gen/walk_HH_3x3_dref.png` (or `take_06_3x3_dref.png`): idle `_d` in the white top-left frame + eight albedo frames on **black**. Locked clay/flash prompt (or the backup, if idle `_d` used it) plus the line `example in top-left frame for reference`.

## Workflow

```
- [ ] 1. Kind + refs
- [ ] 2. idle_06 lock → fit → lock palette (solo 3:4)
- [ ] 3. idle_12 (solo 3:4) — stop. Do not GenerateImage idle_02/03/04/08/09/10 one-at-a-time.
- [ ] 4. Idle turntable: ONE **2×4** 8-cell sheet with POSE LOCK (includes 6 and 12). Unpack 02/03/04/08/09/10 only. Ignore strip cells 6 and 12. check --clip idle
- [ ] 5. Walk: one 3×3 per hour (framed idle + 8 walks). One ref. No `POSE LOCK.` 4× sheet then fit. check --clip walk
- [ ] 6. Take: one 3×3 (framed idle_06 + 8 takes). One ref. No `POSE LOCK.` 4× sheet then fit. check --clip take
- [ ] 7. Maps: idle `_m` 3×3 and idle `_d` 3×3 (locked prompts, until good) → walk/take `_m` / `_d` 3×3 (same prompts + top-left reference lines). Bake `_n`. Map checklist. `maps-sheet.mjs check` → `artCachePack` if wired
```

### 1. Kind + refs

`{kind}/_gen/locks/` and `_refs/`. Copy 1–3 user frames into `_refs/`. Identity = outfit, face, colors. Ignore a ref’s camera and any brim wider than the shoulders.

### 2. idle_06 lock — first image, and the only identity from then on

`GenerateImage` one 3:4 `idle_06.png`. Attach **`guides/idle_06.png` plus the user refs**. No other guides.

`fit` into `_gen/locks/idle_06.png` and `{kind}/idle_06.png`. Card **384×512**. fillH ≥ 0.90, bboxA **0.50–0.85** (fail under 0.45). Face toward camera, feet slightly apart, both arms hanging, elbows slightly out, **head looking with the chest**, **45° down like `guides/idle_06.png`**. If the silhouette is a skinny tube, regen with a wider stance and normal arm thickness — do not ship a needle. If the camera is eye-level or the legs look standing-sheet long, regen.

Read the lock and write a one-line palette: hair, clothes, belt, boots, skin. Reuse it verbatim. If anything is one-sided, write a second line: **laterality** (e.g. eyepatch character-left, sheath character-right, hair part character-left). If a detail sits on the **chest** in `idle_06` and is **absent from `idle_12`**, write **front-only** (never a spine copy). Reuse those lines in later **idle / maps** prompts — not in the short walk or take prompt.

After **idle_12** exists, metallic uses the **locked prompt** in [maps.md](maps.md) — do not write a per-character SHINE into the GenerateImage text.

### 3. idle_12 — second (and last) solo idle

`GenerateImage` one 3:4 `idle_12.png`. Attach **only** `guides/idle_12.png` and `_gen/locks/idle_06.png`. Same 45° camera. `fit` over `{kind}/idle_12.png`. Do **not** start idle_02 / 03 / 04 / 08 / 09 / 10 as separate gens.

### 4. Idle turntable strip — remaining idle hours

**One** `GenerateImage`, `16:9`. The description **must begin with the words `POSE LOCK.`** — first characters of the prompt, before Style, Camera, or IDENTITY. Draw all eight hours so yaw and camera stay consistent. **Idle_06 and idle_12 cells are drawn for pose lock, then ignored.** Layout is **2 rows × 4 columns**, not eight-across (eight-across on 16:9 is 192px cells).

Attach, in this order:
1. Mannequin idle **2×4** `game/public/characters/mannequin/_gen/idle_2x4.png` (pose + yaw order)
2. This character’s `_gen/locks/idle_06.png` (identity + 45° camera)
3. This character’s `{kind}/idle_12.png` (back identity)

Cell order, matching the mannequin sheet: top **idle_02, 03, 04, 06**; bottom **idle_08, 09, 10, 12**. Include 6 and 12 in the drawing. CAMERA LOCK: **45° downward** on every cell — same tripod as the lock, not eye-level, not bird’s-eye. **Be most careful on idle_03 and idle_09** (true profile is where that tilt usually fails). Each figure fills its 3:4 cell.

```
node .cursor/skills/anime-clock-character/scripts/stitch.mjs split STRIP.png --grid 2x4 --out {kind}/_gen/idle_cell
```

Cells: `idle_cell_0` = 02, `_1` = 03, `_2` = 04, `_3` = 06 (**discard**), `_4` = 08, `_5` = 09, `_6` = 10, `_7` = 12 (**discard**). Do not overwrite `{kind}/idle_06.png` or `{kind}/idle_12.png`.

```
node .cursor/skills/anime-clock-character/scripts/sheet.mjs fit {kind}/_gen/idle_cell_N.png --out {kind}/idle_XX.png --allow-lowres
```

Fit **02, 03, 04, 08, 09, 10** only. If yaw order is wrong, camera stood up or went overhead, laterality hops, A-B-A-B clones, eight-across tiny figures, chibi vs the lock, or magenta halo: junk the sheet, change prompt or seed-batch, regen. Then `check --clip idle`.

If laterality is one-sided, 08 / 09 / 10 still come from this strip (do not FlipX 04 / 03 / 02 for idle).

EXTREMELY IMPORTANT! VERIFY THAT IDLE FRAMES ARE INDEED FACING IN THE DIRECTION THEY CLAIM TO BE FACING, E.G. 3 O'CLOCK MUST FACE RIGHT, 9 O'CLOCK MUST FACE LEFT, 10 O'CLOCK MUST FACE LEFT AWAY FROM THE VIEWER. READ EVERY FITTED `{kind}/idle_XX.png` (INCLUDING SOLO IDLE_06 AND IDLE_12, NOT ONLY THE STRIP). COMPARE EACH CELL TO `guides/idle_XX.png` AND TO THAT HOUR'S WALK (`walk_XX_0` YAW IS THE TRUTH). A PROFILE THAT FACES THE WRONG WAY IS NOT CLOSE ENOUGH. DO NOT FLIPX A WRONG 9 INTO A 3 (LATERALITY HOPS). IF ANY HOUR FAILS, JUNK THE STRIP (OR THAT SOLO), REGEN, AND VERIFY AGAIN. DO NOT PACK. DO NOT START WALKS.

- 12 O'CLOCK MUST FACE FULLY AWAY FROM THE VIEWER. FULL BACK. BACK OF THE HEAD. NO FACE. NO EYES. NOSE AND TOES POINT AWAY FROM CAMERA.
- 2 O'CLOCK (1:30) MUST FACE RIGHT AND AWAY FROM THE VIEWER. BACK-RIGHT DIAGONAL. MOSTLY THE BACK. NO FACE. NOSE AND TOES POINT SCREEN-RIGHT-AWAY. NOT 12. NOT 3. NOT 10.
- 3 O'CLOCK MUST FACE RIGHT. TRUE PROFILE. NOSE AND TOES POINT SCREEN-RIGHT. CHEST ON THE RIGHT OF THE CELL. NOT LEFT. NOT A COPY OF 9.
- 4 O'CLOCK (4:30) MUST FACE FRONT-RIGHT. FACE VISIBLE. BODY YAWED 45° TOWARD SCREEN-RIGHT. NOT FACE-ON 6. NOT FRONT-LEFT 8. NOT PROFILE 3.
- 6 O'CLOCK MUST FACE THE VIEWER. FACE-ON. CHEST AND FACE TOWARD CAMERA. NOSE AND TOES POINT AT THE VIEWER. NOT A 4. NOT AN 8.
- 8 O'CLOCK (7:30) MUST FACE FRONT-LEFT. FACE VISIBLE. BODY YAWED 45° TOWARD SCREEN-LEFT. NOT FACE-ON 6. NOT FRONT-RIGHT 4. NOT PROFILE 9.
- 9 O'CLOCK MUST FACE LEFT. TRUE PROFILE. NOSE AND TOES POINT SCREEN-LEFT. CHEST ON THE LEFT OF THE CELL. NOT RIGHT. NOT A COPY OF 3.
- 10 O'CLOCK (10:30) MUST FACE LEFT AND AWAY FROM THE VIEWER. BACK-LEFT DIAGONAL. MOSTLY THE BACK. NO FACE. NOSE AND TOES POINT SCREEN-LEFT-AWAY. NOT 12. NOT 9. NOT 2.

DO NOT AUTHOR 7 O'CLOCK OR 11 O'CLOCK. IDLE 1 AND IDLE 5 ARE NOT ENGINE FACINGS — DO NOT VERIFY THEM AS CLOCK HOURS.

### 5. Walk — one 3×3 per hour (framed idle + 8 walks)

**Never** `GenerateImage` `walk_HH_i` one frame at a time. **Never** put all eight walk hours on one albedo image. **Never** eight-across / 1×8 / 9×4 on 16:9. **Never 3×3 or 2×4 `POSE LOCK.`** — that stands the camera up. **Never 5×4 even/odd** unless asked (two sheets flicker). Do not FlipX 4→8, 3→9, or 2→10. Author each of **12 / 2 / 3 / 4 / 6 / 8 / 9 / 10** as its own 3×3. **Be most careful on walk hours 3 and 9:** true profile is where the dummy’s **45° downward** tilt is most likely to stand up into an eye-level side-scroller.

**Layout.** Cell size 384×512. Sheet **1152×1536** (3:4). Top-left cell 0 = this character’s `{kind}/idle_HH.png` on magenta `#FF00FF` (do not flood-fill black hair/boots), **encased in a white frame** (~16px inside the cell, with a ~6px magenta gutter on the right and bottom so white does not sit on the seam with `walk_0` / `walk_2` — not a vertical separator line). Cells 1–8 = mannequin `walk_HH_0`…`walk_HH_7` from `game/public/characters/mannequin/`.

```
[idle_HH in white frame] [walk_0] [walk_1]
[walk_2]                       [walk_3] [walk_4]
[walk_5]                       [walk_6] [walk_7]
```

`stitch.mjs grid-pack` cannot draw the white frame — composite in PIL after packing, or draw the frame on cell 0 then pack. Empty/black idle padding → magenta. Frame is solid white, inset from the two inner seams (a 24px bar flush with the cell edge smears into `walk_HH_2` and `fit` shrinks that figure).

Also pack a mannequin-only twin for your own QC — **do not attach it** to `GenerateImage`.

Skill-fixed vs per-character: **pose, camera, white frame, and “only two changes” are generic.** Clothes color, garment kind, and everything above the neck come from the **framed idle**. Do not paste another character’s palette onto this lock. `{character}` is this folder’s person; `{clothes color}` is a color from the framed idle; `{garment}` is what that idle actually wears (cloak, robe, tunic, …). **Never write “coat”** unless the framed idle is a coat — that word makes a modern trench/pockets.

**One ref.** Attach **only** that hour’s mixed stitch (`walk_HH_3x3_idleframe.png`). Two refs compete. Do not attach a prior gen as the main replace (except the optional above-neck pass, or a mannequin-joints skin refeed of that posed sheet). `GenerateImage`: `filename` only, `aspect_ratio` `3:4`. **Do not** start the prompt with `POSE LOCK.` / `LOCK POSE.` / ALL-CAPS `DO NOT CHANGE THE CAMERA`.

The “ONLY two changes” line is a **small-edit frame**. Lucky rolls paint a full character and keep dummy yaw/knees — that is the keeper. Multi-seed: a new filename is a new sample. Re-roll the same short prompt; do not pile on cell-by-cell walk notes.

**Above-neck pass (optional, second step).** If the keeper’s walk is good but hair or headgear is wrong vs the framed idle, attach **only** that posed sheet. Do not rotate. Only fix what is above the neck outside the white frame to match the framed idle. Back hours: match that hour’s idle back — do not invent a spine copy of a front-only detail.

**Mannequin-joints skin pass.** IFF the result looks like it has mannequin joints, refeed that posed 3×3 back into `GenerateImage` (attach **only** that sheet). Copy the skin-pass block in **Prompt shape**. Do not rotate. Do not paint joints in Python. Then 4× / split / fit / lock-head that hour only.

Fill the Walk checklist on all eight walk cells. Any NO → junk that hour’s sheet.

**Fit (postage-stamp trap).** `fitCanvas` will not upscale. A raw ~864×1152 3×3 cell is ~288×384; `fit --allow-lowres` ships a tiny figure on the floor.

```
# re-encode JPEG→PNG, snap near-magenta to #FF00FF
# 4× nearest the whole sheet if cells < 768×1024
# split --grid 3x3
# discard cell_0 (do not overwrite idle_HH)
# fit cell_1…8 → walk_HH_0…_7   (NO --allow-lowres)
# lock-head DIR walk_HH
# copy-retry into {kind}/   (Windows locks if the game has the PNGs mapped)
node game/scripts/artCachePack.mjs
```

Do **not** overwrite `idle_*` or `guides/`. Do not run `publish-guides.mjs`. When fitting one hour, do not overwrite other hours’ `walk_*` files. Walk hours may ship albedo-only (no `_d` / `_n` / `_m` → flat normals) if silhouette changed; do not invent maps. After all eight hours exist: `check --clip walk`.

### 6. Take — one 3×3 (framed idle_06 + 8 takes)

**Same method as walk (§5).** **Never** `GenerateImage` `take_06_i` one frame at a time. **Never** a 2×4 / 16:9 `POSE LOCK.` sheet — that invents hands-on-hips, waves, and dummy paste. Take is hour 6 only: **one** 3×3 mixed stitch.

**Layout.** Cell size 384×512. Sheet **1152×1536** (3:4). Top-left cell 0 = this character’s `{kind}/idle_06.png` on magenta `#FF00FF`, **encased in a white frame** (~16px, magenta gutter on the right and bottom like walk). Cells 1–8 = mannequin `take_06_0`…`take_06_7` from `game/public/characters/mannequin/`.

```
[idle_06 in white frame] [take_0] [take_1]
[take_2]                       [take_3] [take_4]
[take_5]                       [take_6] [take_7]
```

Pack like walk (`idle_06` framed + eight take mannequins) to `{kind}/_gen/take_06_3x3_idleframe.png`. Mannequin-only twin for QC — **do not attach it**.

**One ref.** Attach **only** `take_06_3x3_idleframe.png`. `GenerateImage`: `filename` only, `aspect_ratio` `3:4`. **Do not** start with `POSE LOCK.` Copy the take 3×3 block in **Prompt shape**. 2–4 filenames. Re-roll the same short prompt. Above-neck and mannequin-joints skin passes: same as walk (attach **only** that posed sheet).

Fill the Take checklist (poses.md pocket-lift table) on all eight take cells. Image-right arm does the work; image-left hangs. **Purse lock:** `_2`…`_6` keep the dummy’s tiny brown neck-held purse (do not modify). `_0` / `_1` / `_7` stay empty-handed. `_7` is a pocket-present, in-plane, not a lens reach. Any NO → junk the sheet.

**Fit** — same postage-stamp trap as walk:

```
# re-encode JPEG→PNG, snap near-magenta to #FF00FF
# 4× nearest the whole sheet if cells < 768×1024
# split --grid 3x3
# discard cell_0 (do not overwrite idle_06)
# fit cell_1…8 → take_06_0…_7   (NO --allow-lowres)
# lock-head DIR take_06
# ship all eight if the purse lock holds. Junk the sheet if _2…_6
# dropped/redraw the purse or if _0 / _1 / _7 grew one.
node game/scripts/artCachePack.mjs
```

Then `check --clip take`.

### 7. Shape, normal, and metallic maps

Do this only after authored albedos are in `{kind}/`. Missing `idle_01` / `idle_05` stay empty albedo cells. `_d` is uncolored clay / camera-flash, not camera-Z. Metallic **and** shape are **idle 3×3 first**, then clips. Copy each locked prompt and layout from [maps.md](maps.md). **Do not edit those prompts.**

**Metallic idle.** Pack empty top-left + `idle_02`…`idle_12` to `{kind}/_gen/idle_3x3_mref.png` with **black** backgrounds (idle cells too). `GenerateImage` `3:4`, attach **only** that sheet, locked metalness prompt verbatim. Multi-seed until a sparse mask (not a grayscale albedo). `fit-m`. Do not start walk `_m` until idle `_m` is good.

**Metallic walk / take.** Pack `{kind}/idle_HH_m.png` in a white frame (~16px, black gutter on the right and bottom) + that hour’s **albedo** `walk_HH_0`…`_7` on **black** (take: `idle_06_m` + `take_06_*`) to `{kind}/_gen/walk_HH_3x3_mref.png`. Attach **only** that sheet. Locked prompt plus the line `metallic map in top-left frame for reference`. Discard gen cell `_0`. `fit-m` cells `_1`…`_8`.

**Shape idle.** Pack empty top-left + `idle_02`…`idle_12` to `{kind}/_gen/idle_3x3_dref.png` with **black** backgrounds. `GenerateImage` `3:4`, attach **only** that sheet, locked clay/flash prompt verbatim. Multi-seed until uncolored clay (not a grayscale albedo, not a blown hotspot). If those gens stay glossy, shadowed, outlined, or jointed, use the backup shape prompt in [maps.md](maps.md). `fit-d`. `levels-d.mjs` on that mapfit dir (too bright / too dark / flat). Bake `_n`. Do not start walk `_d` until idle `_d` is good.

**Shape walk / take.** Pack `{kind}/idle_HH_d.png` in a white frame (~16px, black gutter on the right and bottom) + that hour’s **albedo** `walk_HH_0`…`_7` on **black** (take: `idle_06_d` + `take_06_*`) to `{kind}/_gen/walk_HH_3x3_dref.png`. Attach **only** that sheet. Locked prompt (or the backup, if idle `_d` used it) plus the line `example in top-left frame for reference`. Discard gen cell `_0`. `fit-d` cells `_1`…`_8`. `levels-d.mjs`. Bake `_n`.

```
node .cursor/skills/anime-clock-character/scripts/maps-sheet.mjs pack game/public/characters/{kind} --out game/public/characters/{kind}/_gen/maps/albedo.png --json game/public/characters/{kind}/_gen/maps/layout.json
node .cursor/skills/anime-clock-character/scripts/maps-sheet.mjs fit-m METAL.png --json …/layout.json --out game/public/characters/{kind}/_gen/maps/mapfit --albedo …/albedo.png --sheet …/fitted_m.png
node .cursor/skills/anime-clock-character/scripts/maps-sheet.mjs fit-d DEPTH.png --json …/layout.json --out game/public/characters/{kind}/_gen/maps/mapfit --albedo …/albedo.png --sheet …/fitted_d.png
node .cursor/skills/anime-clock-character/scripts/levels-d.mjs game/public/characters/{kind}/_gen/maps/mapfit
node game/scripts/depth_to_normal.mjs --dir game/public/characters/{kind}/_gen/maps/mapfit
node .cursor/skills/anime-clock-character/scripts/maps-sheet.mjs check game/public/characters/{kind}
```

Stage into `{kind}/_gen/maps/…` then **copy-retry** `_d` / `_n` / `_m` — Windows locks live PNGs. Do not overwrite albedo. Do not copy from git-index 3D normals. Do not paint `_m` in Python.

After `fit-d`, run `levels-d.mjs` on the fitted `_d` dir, then bake `_n` with `depth_to_normal.mjs`. `levels-d` skips cells already in a usable facing range; it stretches blown-white, crushed-black, or flat luma. `--force` to stretch anyway. If `_d` is already 384×512, the baker samples **1:1** — do not stretch that published cell to “fix” alignment. Recorrect from the unmasked raw sheet ([maps.md](maps.md) refit), then bake. Do not bake from a camera-Z fade. Do not rebake `_n` unless `_d` changed. Do not FlipX maps if walk 8 / 9 / 10 were authored. Keep `{kind}/_gen/maps/…/raw/sheet_4x.png` — that is the unmasked source.

### 8. Publish

`check … --clip all` must be OK, including all **eight** walk cells per hour and motion. Do not FlipX albedo or maps for 8 / 9 / 10 when those hours were authored. Player art folder is `PLAYER_FOLDER` in `game/scripts/characters.mjs`. Run `node game/scripts/artCachePack.mjs`. Do not list character folders in scripts — they are scanned from `public/characters/*/character.json`.

## Prompt shape

```
{Style verbatim}

{Camera verbatim}

IDENTITY: same person as the attached idle_06 lock — outfit, face, palette, and this character's body. Palette: {hair} {clothes} {belt} {boots} {skin}. Laterality (body-left / body-right, from the lock): {eyepatch/sheath/hair-part/none}. Front-only: {chest detail / none} — if the lock keeps it on the chest, idle_12 and walk 12/2/10 have a smooth back, never a spine copy. One-sided details stay on that body side in this frame. Empty fists, no sword. No brim wider than the shoulders. Head about one-fifth of the figure like the lock, NOT chibi. The lock is NOT the pose. Do not copy the lock’s hanging idle arms or planted idle feet.

POSE GUIDE: the attached grayscale mannequin is camera, yaw, **45° downward tilt**, and which limb is forward/back. Copy that pose and that tilt. Draw this character wearing the identity outfit, with the lock's body. Do not draw a blank mannequin. Do not copy the mannequin’s hourglass, bust, hip flare, glute mass, or jointed plastic surface. Do not copy a flatter camera from the lock or from user refs. If this comes back eye-level or as a standing character sheet, FAIL.

This image is ONE figure, 3:4, at least 768×1024, magenta #FF00FF background ONLY. The figure is a full-height human on the card — boots near the bottom, crown near the top. The figure is sealed by a 1px black/dark ink outline. Outlines are black/dark ink, never magenta, never pink. No magenta halo. No sheet, no labels, no second character. NOT a tiny pixel stamp.
```

Idle turntable. **The GenerateImage `description` MUST start with `POSE LOCK.`** Do not put Style/Camera first.

```
POSE LOCK. THIS IMAGE IS an 8-cell idle albedo turntable of the FIRST attached 2×4 grid. Trace that grid. Do not invent poses.

TWO ROWS of FOUR full-body figures, each cell 3:4 filling the cell. Top: idle_02, 03, 04, 06. Bottom: idle_08, 09, 10, 12. Draw 6 and 12 too (pose lock) — those two cells will be discarded after split. NOT eight tiny figures in one row.

CAMERA LOCK. Tripod FIXED **45°** above the ground looking DOWN on EVERY cell. Same tilt as the attached idle_06 lock. Crown disc, shoulder tops, boot-top planes, foreshortened legs. Not eye-level. Not bird’s-eye. Spine vertical; only yaw. No body lean on diagonals.

IDENTITY from the attached idle_06 and idle_12. Laterality stays on the lock’s body side in every cell (do not FlipX). Magenta #FF00FF background. Black ink outlines. No labels. Each figure is full height in its cell (boots near the bottom, crown near the top).
```

Walk 3×3 (`aspect_ratio` `3:4`). **Do not start with `POSE LOCK.`** Attach **only** that hour’s `walk_HH_3x3_idleframe.png`. `{character}` is this folder’s person; `{clothes color}` / `{garment}` are from the framed idle — do not hardcode another lock’s palette. Keep the high-knee sentence on every hour (`_0` is top-center). 2–4 filenames per hour.

```
Replace the mannequin with the {character} without rotating anything. The camera is already in the dummy: 45° down, one yaw, one walk frame per column and row. Keep this yaw. Keep those lifted legs. Keep those arm swings. Do not straighten {her/him/them} to face the camera.

The first cell at top-center is a high lifted knee, not a standing step and not idle. Copy that dummy knee height.
Do not edit anything inside the white frame in the top-left corner.

ONLY two changes outside the white frame: dummy head becomes the framed {character}'s head, including everything above the neck from that framed cell; dummy wood is recolored {clothes color from the framed idle} like the {garment from that idle: cloak, robe, tunic, … — never "coat" unless the idle is a coat}. Keep the dummy's body pose. Magenta. No floor shadows. Fully clothed.
```

Above-neck pass on a keeper. Attach **only** that posed sheet.

```
This sheet is already posed. Do not rotate. Do not change camera, knees, arms, or feet.

Only fix what is above the neck outside the white frame to match the framed top-left idle. Back views: match that idle's back — do not invent a spine copy of a front-only detail.

Do not edit anything inside the white frame in the top-left corner. Magenta. No floor shadows.
```

Mannequin-joints skin pass. IFF the result looks like it has mannequin joints, refeed that posed sheet. Attach **only** that image. `aspect_ratio` `3:4`.

```
This sheet is already posed. Do not rotate. Do not change camera, knees, arms, or feet.

Only fix the skin. Arms and legs still show wooden mannequin joint rings (elbows, wrists, knees). Paint continuous peach skin over those joints so each limb is smooth flesh, same skintone as the idle in the white frame. No wood grain, no ball joints, no segmentation rings.

Do not change clothes, hair, boots, belt, or pose. Do not edit anything inside the white frame in the top-left corner. Magenta. No floor shadows.
```

Take 3×3 (`aspect_ratio` `3:4`). **Do not start with `POSE LOCK.`** Attach **only** `take_06_3x3_idleframe.png`. Same `{character}` / `{clothes color}` / `{garment}` as walk. 2–4 filenames. The dummy’s brown purse is locked — not a third “change.”

```
Replace the mannequin with the {character} without rotating anything. The camera is already in the dummy: 45° down, one yaw, one take frame per column and row. Keep this yaw. Keep those image-right pocket lifts. Keep the hanging image-left arm. Do not straighten {her/him/them} to face a different pose.

The first cell at top-center is take rest: both fists hanging at the hips, not a chest hold. Copy that dummy hang. No purse in that rest cell.
Keep the dummy's tiny brown drawstring purse EXACTLY on the cells that already have it: same size, same brown, pinched at the neck, bag hanging below the hand. Do not drop it. Do not enlarge it. Do not recolor it. Do not replace it with coins, gold, or a sack. Cells where the dummy has empty hands stay empty-handed.
Do not edit anything inside the white frame in the top-left corner.

ONLY two changes outside the white frame: dummy head becomes the framed {character}'s head, including everything above the neck from that framed cell; dummy wood is recolored {clothes color from the framed idle} like the {garment from that idle: cloak, robe, tunic, … — never "coat" unless the idle is a coat}. Keep the dummy's body pose and the dummy's purse. Magenta. No floor shadows. Fully clothed.
```

Metallic idle 3×3 (`aspect_ratio` `3:4`). Attach **only** `idle_3x3_mref.png`. **Copy exactly — do not edit. Do not append a reference line** (there is no metallic frame yet):

```
Change to Metalness map (AKA Metal map, Reflection map, Specular map). Example: skin/fabric/outlines become black, eyes become white, hair becomes bright gray, metal becomes white, leather (e.g. boots and belts) becomes dark gray.
```

Metallic walk/take 3×3 (`aspect_ratio` `3:4`). Attach **only** `walk_HH_3x3_mref.png` (or take). Locked block, then this line (**animations only**):

```
metallic map in top-left frame for reference
```

Shape idle 3×3 (`aspect_ratio` `3:4`). Attach **only** `idle_3x3_dref.png`. **Copy exactly — do not edit. Do not append a reference line** (there is no shape frame yet):

```
Change to non-colored grayscale non-textured images as if a white model is lit with a camera flash. POSE LOCK.
```

**Backup** (idle `_d` only after the locked flash line already failed — glossy, glare, cast shadows, cartoon outlines, or mannequin joints). Copy exactly. Do not prepend `POSE LOCK.` Do not append a reference line:

```
Change to shape map, where:
white = surface faces viewer
black = surface faces sideways

NO SHADOWS! Just surface form rendering.
NO REFLECTIONS NOR GLARE!
NO OUTLINES!
NO MANNEQUIN JOINTS!
```

Shape walk/take 3×3 (`aspect_ratio` `3:4`). Attach **only** `walk_HH_3x3_dref.png` (or take). Locked block (or the backup block if idle `_d` used it), then this line (**animations only**):

```
example in top-left frame for reference
```

## Hand attach poses

After the kind folder has published `idle_HH` and `walk_HH_0`…`_7` albedos, write fist poses into `{kind}/character.json` so held items (torch, etc.) can sit on the hands. Keys are **body-left / body-right**, not image-left / image-right.

```json
"left": { "6": [ { "x": 0, "y": 0, "r": 0 } ] },
"right": { "6": [ { "x": 0, "y": 0, "r": 0 } ] }
```

Each hour (`2` `3` `4` `6` `8` `9` `10` `12`, unpadded strings) is an array of **9** poses: index `0` = that hour’s idle, `1`…`8` = `walk_HH_0`…`_7`. Do not put take/give in this map (pocket clips keep using hour-6 idle hands unless a separate take array is added later). Skip hours that have no albedo.

- **`x`, `y`:** pixels on that frame’s card, origin **top-left**, same size as the albedo (384×512). Fist centroid, not the elbow.
- **`r`:** screen-space heading in radians. `0` = up, `π/2` = right, `π` = down, clockwise on the card (the sprite faces the camera). Texture-up of the held sprite (torch flame, sword tip) points **the way the character is facing** at idle, then **swings with the forearm** on walk frames (idle `r` plus the change in sleeve heading from that hour’s idle). Face-on (6) idle is down (`π`); back (12) idle is up (`0`); 3 is right (`π/2`); 9 is left (`−π/2`). Do not aim it up the sleeve. Do not use Three.js `rotation.z` as the stored value (that axis is counter-clockwise).

`left` / `right` are the character’s own hands. **They do not swap when the figure turns.** Do not label by image-x: at 3 and 9 (and on the 2 / 4 / 8 / 10 diagonals) the arms swing across the body, so the same fist is image-left on one walk frame and image-right on the next.

**Laterality is a sagittal-plane normal, then a dot product.** World is Y-up right-handed. Clock yaw `θ` is from hour 6, positive toward screen-right (6 = 0, 4 = +π/4, 3 = +π/2, 2 = +3π/4, 12 = π, 10 = −3π/4, 9 = −π/2, 8 = −π/4). In camera-azimuth (+X screen-right, +Z toward camera) `forward = (sin θ, 0, cos θ)` and the right-pointing normal is `R = forward × up = (−cos θ, 0, sin θ)`. Squash the 45° camera onto the card: screen-right → `+x`, toward-camera → down-`y`. Card axis `v = (−cos θ, sin θ)`. For two fist centroids, **body-right is the larger `p · v`**. Formula lives in `junk/_laterality.mjs`. After any nudge, run `node junk/_assign_laterality.mjs {folder}` so labels match the dots; keep each fist’s `r` with that fist. Do not FlipX another hour’s arrays. Do not swap because a fist crossed image-x.

| Hour | `v` on the card | Body-right is the fist that is more… |
|------|-----------------|--------------------------------------|
| 6 | `(−1, 0)` | image-left |
| 4 | `(−√2/2, √2/2)` | down-left |
| 3 | `(0, 1)` | down (toward camera / near) |
| 2 | `(√2/2, √2/2)` | down-right |
| 12 | `(1, 0)` | image-right |
| 10 | `(√2/2, −√2/2)` | up-right |
| 9 | `(0, −1)` | up (away / far) |
| 8 | `(−√2/2, −√2/2)` | up-left |

Run the pixel detector first. It writes overlays + a `hands.json` you can merge into `character.json`:

```
node .cursor/skills/anime-clock-character/junk/_hands.mjs {folder}
node .cursor/skills/anime-clock-character/junk/_assign_laterality.mjs {folder}
```

Output is `junk/_hands_out/{folder}/` (`idle_*.png` / `walk_*.png` overlays, `hands.json`). Read every overlay before copying: a mark on each fist and a short tick along `r` (green = character’s left, yellow = right). Two fists per frame. Occluded back-diagonal fists are the usual miss — a sleeve or cloak centroid is FAIL. Keep cells that land on the fists. The art cache reads `left` / `right` from `character.json` (Vite watches that file).

**Image-gen only if the detector fails** (missing fist, one blob, elbow/sleeve/cloak instead of the fist, or swapped laterality that you cannot nudge). Pack that hour’s published cells as a 3×3 (idle top-left, then `walk_HH_0`…`_7`). Attach **only** that sheet. `aspect_ratio` `3:4`. Copy the **already-posed** walk pass (not the replace-mannequin block). Recolor **only the two fists** green in place — wrist to fingertips, not arms, legs, neck, or face. `Read` the gen: each green blob must be a fist. Green anywhere else is FAIL; re-roll. Assign `left` / `right` with the sagittal-normal dot (`junk/_laterality.mjs`), not image-x. Keep detector `x,y,r` on hours that passed. On painted hours, take `x,y` from the fist blobs; `r` is still facing + forearm swing as above (the paint pass does not encode heading). Do not image-gen hours the overlays already got right.

Then pack that failing hour (cell size 384×512 → sheet 1152×1536):

```
node .cursor/skills/anime-clock-character/scripts/stitch.mjs grid-pack {kind}/idle_HH.png {kind}/walk_HH_0.png … {kind}/walk_HH_7.png --grid 3x3 --out {kind}/_gen/walk_HH_3x3_hands.png
```

```
[idle_HH] [walk_0] [walk_1]
[walk_2]  [walk_3] [walk_4]
[walk_5]  [walk_6] [walk_7]
```

`GenerateImage`: `filename` only, attach **only** `walk_HH_3x3_hands.png`. Copy the block. Multi-seed if fists move, a cell has one green blob, the camera stands up, or any non-fist skin is green.

```
POSE LOCK. THIS IMAGE IS a 3×3 sprite sheet of the attached grid. Trace that grid. Do not invent poses.

This sheet is already posed. Do not rotate. Do not change camera, knees, arms, or feet.

ONLY the two fists. Recolor each fist solid green #00FF00. Wrist to fingertips only. Stop at the cuff / wrist bone. Same pixels, same positions.

Do not recolor arms. Do not recolor legs. Do not recolor neck. Do not recolor face. Do not recolor any other skin. Do not recolor clothes, hair, boots, or belt. Do not move the hands. Do not change their positions. Do not redraw the figure.

Keep the magenta background exactly #FF00FF. Do not replace it with black or any other color. No floor shadows. No labels.
```

| Hour | Idle `r` on the card |
|------|----------------------|
| 6 | down (`π`, toward camera) |
| 4 | down-right (`3π/4`) |
| 3 | right (`π/2`) |
| 2 | up-right (`π/4`) |
| 12 | up (`0`, away) |
| 10 | up-left (`−π/4`) |
| 9 | left (`−π/2`) |
| 8 | down-left (`−3π/4`) |

Face-on (6): body-right is image-left. Back (12): body-left is image-left. Other hours (including 2 / 3 / 4 / 8 / 9 / 10 walks): laterality from `p · v` (table above), not image-x.
