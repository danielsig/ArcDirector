# Style lock

Paste **Style** + **Camera** into every `GenerateImage` description. Do not rewrite them. Identity comes from the 1–3 reference frames, not from this file.

## Style

Cel-shaded JRPG game sprite (bold outlines, flat two-tone shade). Teen/adult JRPG body: head is about one-fifth of the figure, not a chibi third. NOT super-deformed, NOT realistic adult anatomy, NOT pixel art, NOT a tiny 200px stamp, NOT painterly Ghibli, NOT photoreal. Paint at high resolution so faces, folds, and outlines stay crisp after fit to 384×512.

## Camera

Tripod is FIXED **45°** above the ground looking DOWN (A Link to the Past / Stardew / Chrono Trigger). Match the attached pose guide's tilt exactly. Never eye-level. Never a standing character sheet. Never a 3/4 fashion portrait with "a little down angle." If the legs look as long as a standing reference, the camera dropped and the image is FAIL.

You ALWAYS see TOP surfaces from above: the disc of the hair/hat crown, the top of both shoulders, the belt/waist rim, the TOP planes of both boots. The head is large in the frame because you are looking down onto it. Legs are foreshortened under the torso — short in the image, not stretched. If a hairline is a thin side-on line, FAIL. If you cannot see boot tops as ellipses/planes, FAIL.

ONLY the character's YAW around the vertical axis changes. The camera does not orbit or lower. Do not stand the tripod up to match a flatter user ref. The head yaws with the chest — eyes look along the facing direction. Do not turn the face toward the camera on hours 1–5 or 12.

Idle / walk / take: full body. Solo gens are **only** idle_06 and idle_12 (ONE figure per image). Idle hours 2/3/4/8/9/10 are **one** 2×4 8-cell sheet that also draws 6 and 12 (those two cells are discarded). **Each walk hour is one 3×3 mixed-idle sheet** on 3:4 (SKILL.md §5): framed `idle_HH` + eight mannequin walks. **Take/give is the same 3×3** (SKILL.md §6): framed `idle_06` + eight mannequin takes. Do **not** start walk or take gens with `POSE LOCK.` Never 5×4 even/odd unless asked. Never all eight hours on one albedo image. Never eight-across / 1×8 / 9×4 on 16:9. Shape (`_d`) and metallic maps: first pass may be one sheet for all frames; if specific hours fail, regen those hours as a 2×4 (maps.md). Flat MAGENTA #FF00FF background ONLY — never on the character. The figure is sealed by a 1px black/dark ink outline so anti-alias never mixes into the magenta field. Outlines are black/dark ink. No magenta halo, rim, fringe, or pink edge on hair, hat, robe, skin, or boots. No ground, no scenery, no text, no labels, no numbers, no UI.

Empty hands (loose fists) on idle and walk. No sword, no baked held item on those clips — the engine overlays those. **Take/give:** copy the dummy’s tiny brown neck-held purse on `take_06_2`…`_6` — do not modify it. `_0` / `_1` / `_7` stay empty-handed. Give is that strip reversed.

## Proportions (every sheet and every cell)

The figure is a **full-height human on the card**. After `fit` onto **384×512**, boots sit on the bottom pad and the crown nearly reaches the top pad. Do not leave a band of empty canvas above the head. Do not draw a miniature in the middle of a tall magenta field.

Head is about one-fifth of the figure. **Compare every walk cell to that hour’s `idle_HH`, not a vague “looks ok.”** If the head (and whatever sits on it) is about a third of the figure, that cell is chibi — FAIL the sheet, do not ship. Hair (or headgear, if the identity has it) sits on that head and **must not be wider than the shoulders**. A brim or crown that forces `fit` to shrink the whole body is wrong — drop or shrink it so the torso and legs can fill the frame.

Outfit pieces visible on `idle_HH` stay on every walk cell of that hour (whatever sits above the neck, clothes, belt, lower body, boots). Do not invent trim the idle lacks. Do not drop clothes into bare skin.

One-sided details (hair part, ponytail, eyepatch, sword sheath, scar, earring) are locked to **character left or character right** from `idle_06`. Image-left = character left. They stay on that body side in every idle and every animation frame. Yaw may hide them; they must not appear on the other side. **Front-only** details (chest hair, necklace): if `idle_12` / `idle_HH` does not show them on the back, walk 12 / 2 / 10 must not grow a spine copy.

Each figure keeps natural 3:4 body proportions (about as wide as the attached 3:4 lock). Do not squash or stretch to fill the cell. Magenta padding around every figure. Arms have normal thickness.

## Yaw (append one line per cell; do not rewrite Camera)

Clock is camera-relative. 6 = facing camera. **2 / 4 / 8 / 10 are 45° yaw diagonals** (1:30 / 4:30 / 7:30 / 10:30), not analog 2:00 / 4:00. Idle 8 / 9 / 10 come from the pose-locked idle strip (not FlipX). Walk 8 / 9 / 10 are their own 3×3 sheets (not FlipX of 4 / 3 / 2). `idle_01` / `idle_05` are unused extras.

- **6:** Yaw 0° from camera (6:00). Chest and face toward camera. Looking slightly up at the lens.
- **4:** Yaw **45°** toward screen-right (4:30). Front-right diagonal. Face still visible. NOT left, NOT 8 o'clock.
- **3:** Yaw 90° toward screen-right (3:00). Nose and toes point right. Still look DOWN onto the head. Not a side-scroller. Not an eye-level profile.
- **9:** Yaw 90° toward screen-left (9:00). Nose and toes point left. Same **45° down** as 3. Not a side-scroller. Not an eye-level profile.
- **2:** Yaw **135°** toward screen-right (1:30). Back-right diagonal. Mostly the back of the head and the right shoulder.
- **12:** Yaw 180° (12:00). Back toward camera. No face.

Walk uses **12 / 2 / 3 / 4 / 6 / 8 / 9 / 10**, **eight frames `_0`…`_7` per hour**. One 3×3 per hour (SKILL.md §5). Take/give is **hour 6 only**, one 3×3 mixed-idle sheet like walk (SKILL.md §6).

## References

- Attach **only** the pose guide `guides/{stem}.png` (grayscale feminine mannequin) plus, after it exists, this character’s `idle_06` lock. Two images. Walk stems attach that same stem’s guide (`walk_06_5` → `guides/walk_06_5.png`). Idle turntable: mannequin `idle_2x4.png` + this character’s idle_06 + idle_12. Walk 3×3: **only** `{kind}/_gen/walk_HH_3x3_idleframe.png`. Take 3×3: **only** `{kind}/_gen/take_06_3x3_idleframe.png`. Not a mannequin-only sheet, not adjacent idles, not a prior gen except an above-neck or joints-skin pass. Not a neighbor character cell. Not a second hour’s walk. Not photoreal wood. Not the wireframe dummy. The framed idle is identity (outfit, above-neck, body as on that yaw). The mannequin cells are camera, yaw, and limb layout — not the dummy's figure. Take mannequin cells `_2`…`_6` also lock a tiny brown purse; copy it, do not redraw it.
- User refs are for the **idle_06 lock only**. After that lock exists, stop attaching them (they fight the mannequin’s yaw and recolor the hair).
- If a ref is flatter than this camera, ignore its camera. User photos and the idle_06 lock are identity, not a new tripod height.
- Hours **3** and **9** (idle strip cells and walk 3×3): **45° down is most likely to go wrong** on true profile. Pose guides `guides/idle_03.png` / `idle_09.png` and that hour’s walk guides. Crown, near shoulder top, hip rim, boot tops. Not an eye-level side-scroller.
