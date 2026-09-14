# Shape, normal, and metallic maps

Albedo idle: **idle_06** and **idle_12** are solo gens; hours 2/3/4/8/9/10 come from **one** 2×4 8-cell POSE LOCK sheet that also draws 6 and 12 (those two cells are ignored). Walk albedo is **one 3×3 per hour** (framed idle + 8 walks; SKILL.md §5 — not `POSE LOCK.`, never 5×4 even/odd unless asked, never all eight hours in one albedo image, never eight-across). Take albedo is **one 3×3** like walk (framed `idle_06` + 8 takes; SKILL.md §6 — not `POSE LOCK.`, never a 2×4 take sheet).

**`_d` is a facing / clay volume map**, not a camera-Z buffer. The generator look is an uncolored white model lit by a camera flash (front planes light, rims darker). Filename `_d` is history. Walk hours may ship albedo-only (missing `_d` / `_n` / `_m` → flat normals); do not invent maps. Do not overwrite albedo when regenerating maps.

1. Metallic **and** shape are **idle 3×3 first**, then one 3×3 per walk/take hour. Copy each **locked prompt** below verbatim. All-matte (mannequin plastic): `bake-m DIR` instead of metallic gen.
2. Do not pack an 8-col atlas as the GenerateImage ref. Do not use the old facing-block / CAMERA LOCK 45° essay. ASCII only — unicode in the prompt can fail the JSON batch.
3. `fit-d` / `fit-m`: even-grid crop from the layout JSON, then **uniform height scale** onto the albedo silhouette (horizontally centered; no independent X stretch). Empty stays black. Dark back robes stay in the figure box (`r+g+b < 6` is background — a brighter cutoff bbox’s only hair/hands). Metal gens are too dark for occupancy bands; do not occupancy-crop them. Never stretch a tight figure box independently in X and Y. **Source is the unmasked gen sheet**, not `{kind}/*_d.png` / `*_m.png` (those are already masked — see Refit below).
4. After `fit-d`, run `levels-d.mjs` on the fitted `_d` dir if cells are blown-white, crushed-black, or flat (it skips keepers already in range). Then bake `_n` (`game/scripts/depth_to_normal.mjs --dir DIR`). If `_d` is already 384×512, the baker samples **1:1** — do not stretch that published cell to realign it. Recorrect from the unmasked raw sheet, then bake. Do not rebake unless `_d` changed. Do not bake from a flat Z pass. Do not FlipX maps if walk 8 / 9 / 10 were authored.
5. `maps-sheet.mjs check DIR` is silhouette offset + magenta only. Fill the **Map checklist** below. Stage in `{kind}/_gen/maps/…`, then copy-retry `_d` / `_n` / `_m` into `{kind}/` (Windows locks live PNGs). Then `artCachePack.mjs`.

**No magenta on map strips.** Unpack/fit paints leftover generator magenta to **black** (`_d` / `_m`) or **#8080FF** (`_n`). Empty shape/metallic cells are black. Empty normal cells are flat-forward `#8080FF`. Generator files labeled `.png` are often JPEG — re-encode with PIL and snap near-magenta before `fit-d` / `fit-m`.

**Do not re-fit a full atlas to fix two hours.** Repair is **re-roll that hour’s 3×3** (same locked prompt). Do not go back to an 8×10 sheet.

## SHINE line (before any `_m`)

Read `{kind}/idle_06.png` (front) and `{kind}/idle_12.png` (back). Name the actual materials: cloth, skin, hair, leather, plastic, metal, glass, wet, gems. Front and back can show different props — union them.

Do **not** copy albedo specular blobs (forehead glint, cheek shine, joint hotspots, light hem trim) as white. Those are lighting / identity paint. White is chrome / mirror / wet glass only. Hands are skin → matte black.

Write SHINE as a **sparse mask**, not a shaded copy of the albedo. Name only the parts that are not black.

Example (hero-like): `SHINE: hair light-gray highlight; eyes white; golden belt buckle white where visible (none on the back); belt and boots dark gray; tunic/pants/skin/hands/all else black.`

## Map checklist (fill before copy-retry; any NO junks that stem)

Gold-standard in-tree (when this kind has a good front idle): `{kind}/idle_06_d.png` / `_n.png` / `_m.png` — pose matches albedo; `_d` is uncolored clay / camera-flash (front planes light, rims darker, no albedo paint); `_m` matches SHINE (hair/eyes/buckle/belt/boots as named, everything else black).

`Read` the fitted `_d` / `_n` / `_m` and that stem’s albedo. Ignore GenerateImage auto-captions (they will call a 2×4 back walk “3×3 / faces”).

For each regenerated stem:

1. Pose matches that albedo (limbs, stride, yaw) — not sheared, not a ghost extra foot.
2. `_d` is uncolored clay / camera-flash, not a grayscale albedo (no painted face, no cloth staying dark just because the tunic is blue). Front planes light, rims / tops / sides darker. Head silhouette matches that stem’s albedo. Not a camera-Z fade (white head / dark feet). Not a blown hotspot that eats the chest. If the keeper is the right pose but the whole figure is chalk-white or mud-dark, `levels-d.mjs` then rebake — do not junk a good pose for luma.
3. `_n` was baked from this `_d`, not from an older 3D-character bake or a git-index file.
4. `_m` matches SHINE as a sparse mask. If SHINE names hair / eyes / buckle / belt / boots, those are the only non-black figure pixels. Cloth, skin, and hands stay black unless named. No hem chrome, no cuff chrome, no peach/metal hands. Buckle white only where the albedo shows it (hidden on 12 / 2).
5. No magenta. Background black (`_d` / `_m`) or `#8080FF` (`_n`).

`maps-sheet check` passing is not this list.

## Metallic cleanup

Do **not** paint `_m` in Python. Do **not** edit the locked prompt. If a seed is a grayscale albedo copy (light skin, painted face) or fabric stayed gray, junk it and re-roll the same prompt. `fit-m` onto the albedo silhouette; empty is black.

## Repair: one walk / take hour as a 3×3

Use this when one clip hour fails **pose** (wrong stride, albedo copy, junk gen). Do **not** GenerateImage a full atlas. Do not overwrite albedo. Do not overwrite other hours’ maps. If the gen pose is fine and only alignment is wrong (short Y, inset crown, dark cap), **do not re-roll** — [Refit / realign](#refit--realign-unmasked-only) from `raw/sheet_4x.png`.

1. Re-pack that hour’s 3×3 ref (`walk_HH_3x3_dref.png` / `mref.png`, or take). Idle map in the white top-left frame; albedo frames on **black**.
2. `GenerateImage` `3:4`. Copy the locked shape or metallic prompt plus that pipeline’s append line. 2–4 filenames. ASCII.
3. `Read` every gen. Keep the sheet whose poses match the albedo. Copy losers to this skill’s `junk/` (do not delete).
4. Re-encode JPEG→PNG. Snap leftover magenta to black. `fit-d` / `fit-m` with that hour’s 3×3 layout JSON. Discard gen cell `_0`.
5. If `_d` changed: `node .cursor/skills/anime-clock-character/scripts/levels-d.mjs {kind}/_gen/maps/mapfit_HH` then `node game/scripts/depth_to_normal.mjs --dir {kind}/_gen/maps/mapfit_HH`.
6. Fill the Map checklist vs albedo and vs `{kind}/idle_06_*`.
7. Copy-retry only those stems’ `_d.png` `_n.png` `_m.png` into `{kind}/`. Then `maps-sheet.mjs check` and `node game/scripts/artCachePack.mjs`.

Do not use a copy helper that prefers git-index 3D normals over this bake.

## Refit / realign (unmasked only)

`{kind}/idle_*_d.png`, `walk_*_*_d.png`, `take_*_*_d.png` and the matching `*_m.png` are **already stamped through the albedo**. Magenta-outside is black; the figure box already matches. Do **not** Y-stretch, AABB-fit, dilate, or “eat the outline” on those files to fix a short head, inset arm, or dark crown cap. Bounds will look correct and the tools will no-op — or they will resample the clipped dark rim onto the skull, which lights as a cap.

**Source of truth** (keep these; do not delete after copy-retry):

```
{kind}/_gen/maps/idle_3x3/raw/sheet_4x.png
{kind}/_gen/maps/walk_HH/raw/sheet_4x.png
{kind}/_gen/maps/take/raw/sheet_4x.png
```

(`sheet.png` if the gen was already large.) Even-grid crop from that hour’s `layout.json` (discard gen cell `_0`). Box the **clay / metal volume** on that crop — skip near-black and the dark outline spike at the crown/feet (those rows are “faces away,” not the top of the form). Then `fit-d` / `fit-m` onto the albedo silhouette. `levels-d.mjs` on `_d`. Bake `_n`. Copy-retry only `_d` / `_n` / `_m`.

Same rule for metallic: do not realign `{kind}/*_m.png`; crop the unmasked `raw` sheet and `fit-m` again.

A dark cap under the albedo ink after a “bounds already match” stretch means you used the masked file. Go back to `raw/sheet_4x.png`.

## Shape 3×3 (idle first, then clips)

Idle `_d` must pass before any walk or take `_d`. Same hour’s idle shape is the top-left reference for that hour’s animation sheet. `fit-d`, then `levels-d.mjs`, then bake `_n` — do not `GenerateImage` normals.

**Locked prompt — copy exactly, no edits.** `POSE LOCK.` is the last two words of this block. Do not prepend another `POSE LOCK.` Do not append CAMERA LOCK / facing-map essays.

```
Change to non-colored grayscale non-textured images as if a white model is lit with a camera flash. POSE LOCK.
```

`GenerateImage` `aspect_ratio` `3:4`. Multi-seed (new `filename` = new sample). `Read` each PNG. Junk grayscale-albedo copies (painted face, cloth remaining dark because it was blue) and blown flash hotspots that eat a chest. Keep uncolored clay: front planes light, rims darker, poses locked. Re-roll the **same** prompt until idle is good. Then `fit-d`. `levels-d.mjs` if the fitted cells are too bright, too dark, or flat. Bake `_n`.

**Backup prompt — only if the locked block already failed.** Multi-seed the locked flash line first. Switch only when those gens keep showing glossy plastic, reflections/glare, cast shadows, cartoon ink outlines, or mannequin joint rings. Do not start with this block. Do not invent a third prompt. If idle `_d` used the backup, walk/take `_d` use it too (same append line as the locked path). Copy exactly:

```
Change to shape map, where:
white = surface faces viewer
black = surface faces sideways

NO SHADOWS! Just surface form rendering.
NO REFLECTIONS NOR GLARE!
NO OUTLINES!
NO MANNEQUIN JOINTS!
```

Walk/take still append `example in top-left frame for reference`. Idle still appends nothing. Then `fit-d` / `levels-d` / bake `_n` as usual.

### Idle `_d`

Pack eight idle albedos as a **3×3**, cell 384×512, sheet 1152×1536. **Black `#000000` background on every cell**, including idle figures (flood magenta → black; do not leave `#FF00FF`). **Top-left cell empty** (black). Order:

```
[empty]    [idle_02] [idle_03]
[idle_04]  [idle_06] [idle_08]
[idle_09]  [idle_10] [idle_12]
```

Attach **only** that sheet (`{kind}/_gen/idle_3x3_dref.png`). Prompt = the locked block above, nothing else. Backup block only if the locked line already failed.

Discard gen cell `_0`. `_1`→`idle_02` … `_8`→`idle_12`. 4× the whole sheet if cells are under 768×1024, then `fit-d` without `--allow-lowres` on a postage stamp.

### Walk / take `_d`

Only after that hour’s `idle_HH_d.png` exists. Pack a **3×3**: top-left = that hour’s idle shape in a **white frame** (~16px, black gutter on the right and bottom, same as albedo walk). Cells 1–8 = this character’s **albedo** `walk_HH_0`…`_7` (take: `take_06_0`…`_7`) on **black** `#000000` (flood magenta → black). Not the mannequin. Not magenta.

```
[idle_HH_d in white frame] [walk_0] [walk_1]
[walk_2]                         [walk_3] [walk_4]
[walk_5]                         [walk_6] [walk_7]
```

Take uses `idle_06_d` and `take_06_*` albedo.

Attach **only** that sheet (`{kind}/_gen/walk_HH_3x3_dref.png` or `take_06_3x3_dref.png`). Prompt = locked block (or the backup, if idle `_d` used it), then exactly this new line:

```
example in top-left frame for reference
```

Discard gen cell `_0` (do not overwrite idle `_d`). Fit `_1`…`_8` → `walk_HH_0_d` … `_7` (or take). `levels-d.mjs` on that mapfit dir. Bake `_n`.

## Normal sheet (`{kind}_n.png`)

Do not `GenerateImage` normals. Bake from fitted `_d`.

POSE LOCK. THIS IMAGE IS A TANGENT-SPACE NORMAL MAP, not a photograph, not a shaded sprite, not a depth pass.

Copy the attached spritesheet EXACTLY: same grid, same cell order, same poses, same yaws. One figure per cell. Do not reorder. Do not clone A-B-A-B. Empty cells stay the flat-forward normal. Follow each attached figure’s limbs and pose EXACTLY.

CAMERA LOCK. Retain the attached figures’ **45° downward** camera. Tripod looks DOWN 45°, not eye-level, not a standing character sheet, not a flatter 3/4 portrait. Tops of the head, tops of shoulders, and boot tops stay visible. Legs stay foreshortened. Do not stand the camera up.

Typical game normal map: mostly blue-purple on the figure. Flat facing the camera is #8080FF (128,128,255) — pinkish blue. X = red (right vs left), Y = green (up vs down), Z = blue (toward camera). Smooth volumes (head matching the attached silhouette, limbs as tubes). No albedo color.

Background, gutters, and empty cells are ONLY that flat-forward normal #8080FF. No magenta. No pink holes. ONE sheet. No labels, no numbers, no UI.

## Metallic 3×3 (idle first, then clips)

Idle `_m` must pass before any walk or take `_m`. Same hour’s idle metallic is the top-left reference for that hour’s animation sheet.

**Locked prompt — copy exactly, no edits:**

```
Change to Metalness map (AKA Metal map, Reflection map, Specular map). Example: skin/fabric/outlines become black, eyes become white, hair becomes bright gray, metal becomes white, leather (e.g. boots and belts) becomes dark gray.
```

`GenerateImage` `aspect_ratio` `3:4`. Do **not** start with `POSE LOCK.` Multi-seed (new `filename` = new sample). `Read` each PNG. Junk grayscale-albedo copies (light skin, painted face). Keep a sparse mask: black skin/fabric/outlines, white eyes and metal, bright-gray hair, dark-gray leather (belt, boots). Re-roll the **same** prompt until idle is good. Then `fit-m`.

### Idle `_m`

Pack eight idle albedos as a **3×3**, cell 384×512, sheet 1152×1536. **Black `#000000` background on every cell**, including idle figures (flood magenta → black; do not leave `#FF00FF`). **Top-left cell empty** (black). Order:

```
[empty]    [idle_02] [idle_03]
[idle_04]  [idle_06] [idle_08]
[idle_09]  [idle_10] [idle_12]
```

Attach **only** that sheet. Prompt = the locked block above, nothing else.

Discard gen cell `_0`. `_1`→`idle_02` … `_8`→`idle_12`. 4× the whole sheet if cells are under 768×1024, then `fit-m` without `--allow-lowres` on a postage stamp.

### Walk / take `_m`

Only after that hour’s `idle_HH_m.png` exists. Pack a **3×3**: top-left = that hour’s idle metallic in a **white frame** (~16px, black gutter on the right and bottom, same as albedo walk). Cells 1–8 = this character’s **albedo** `walk_HH_0`…`_7` (take: `take_06_0`…`_7`) on **black** `#000000` (flood magenta → black). Not the mannequin. Not magenta.

```
[idle_HH_m in white frame] [walk_0] [walk_1]
[walk_2]                         [walk_3] [walk_4]
[walk_5]                         [walk_6] [walk_7]
```

Take uses `idle_06_m` and `take_06_*` albedo.

Attach **only** that sheet. Prompt = locked block, then exactly this new line:

```
metallic map in top-left frame for reference
```

Discard gen cell `_0` (do not overwrite idle `_m`). Fit `_1`…`_8` → `walk_HH_0_m` … `_7` (or take).

If SHINE is a single material (whole figure polished plastic, or whole figure matte cloth), skip this gen and run `maps-sheet.mjs bake-m DIR` instead.
