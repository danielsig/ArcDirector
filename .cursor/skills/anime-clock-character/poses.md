# Pose templates

The **image** source of truth is the grayscale anime mannequin at [guides/{stem}.png](guides/). This table is the checklist after slicing. Yaw/tilt is in [style.md](style.md). Image-left = character left; image-right = character right (sword hand).

**2 / 4 / 8 / 10 are 45° diagonals:** `idle_02` / `walk_02` = 1:30 (45° from 12); `idle_04` / `walk_04` = 4:30 (135° from 12); 8 = 7:30 (mirror yaw of 4), 10 = 10:30 (mirror yaw of 2). Not analog 2:00 / 4:00. Do not FlipX albedo or maps for 8 / 9 / 10 — author those hours.

A cell fails if it does not match the attached pose guide’s yaw, **45° downward tilt**, and limb layout, even if this table is loosely satisfied.

Fail a cell if: the camera is eye-level or a standing sheet (no crown disc, long un-foreshortened legs, hairline a thin side-on stroke); **the figure is chibi vs `idle_HH` (head ~1/3 instead of ~1/5)**; both feet planted like idle during a stride frame; both arms hanging during a reach frame **or both arms idle-hanging on every walk cell**; **only the far arm moves on a back-diagonal walk**; left/right swapped vs the template; **a one-sided detail (eyepatch, hair part, ponytail, sheath, scar, earring) on the other body side than `idle_06`**; **a front-only detail hanging down the spine on hour 12 / 2 / 10**; **lower clothes missing / bare skin when `idle_HH` shows clothes there**; **invented trim above the neck**; hour-3/2/1/12 showing a full face; hour-6/5 showing a back; the head looking at the camera while the chest is in profile or turned away; idle feet a different gap than `idle_06`; hair a different color than `idle_06`; **bare feet or white socks**; **a grey dummy pasted into the cell**. Fill the SKILL.md Walk checklist — do not eyeball.

## Idle (all hours)

Standing. Weight even. Both feet planted, **same gap as `idle_06`**. Both arms hang, loose fists near hips. No stride. No reach. No one-arm lift. Head looks the way the chest faces. Hour 6 and hour 12 are left-right symmetric. Other hours only yaw the whole body toward screen-right.

| Stem | Extra |
|------|--------|
| `idle_06` | Both boots visible, toes toward camera. Fists at hips, elbows slightly out. |
| `idle_05` | Unused extra (engine facing skips it). Like 6, slight right yaw. |
| `idle_04` | 4:30 / 135° from 12. Front-right diagonal. Near (image-left) arm fully visible; far arm tucked. |
| `idle_03` | True profile right. Near arm hanging; far arm a sliver behind torso. Far boot slightly higher in frame than near boot. |
| `idle_02` | 1:30 / 45° from 12. Back-right diagonal. Arms hang; maybe a sliver of jaw. Heels more than toes. |
| `idle_01` | Unused extra (engine facing skips it). More back than 2. Almost no face. |
| `idle_12` | Full back. No face. Fists out from hips. Tops of both boot heels. |

## Walk (8 frames, hours 12 / 2 / 3 / 4 / 6 / 8 / 9 / 10)

2 = 1:30 (45° from 12), 4 = 4:30 (135° from 12). Same 45° octants as idle. **All walk albedo is one 3×3 per hour** (SKILL.md §5): framed `idle_HH` + eight mannequin walks. Do not GenerateImage walks with `POSE LOCK.` Do not FlipX 4→8, 3→9, or 2→10. Do not GenerateImage `walk_HH_i` one-at-a-time. Do not put all eight hours on one albedo sheet. Do not draw eight-across / 1×8 / 9×4 on 16:9. Guides remain `guides/walk_HH_i.png` for check.

Opposite arm vs opposite leg. **Forward** = in the facing direction (toward camera at 6; away at 12; screen-right at 2/3/4). Contact frames have a clear step. Passing frames have feet close and a slight down-bob. Inbetweens sit halfway between the neighboring keys — not a copy of either, not idle.

| Index | Role | Legs | Arms |
|-------|------|------|------|
| `_0` | Contact A | Right leg forward, **high lifted right knee** (not idle, not a standing step) | Left arm forward, right back |
| `_1` | Inbetween | Halfway `_0` → `_2` | Halfway `_0` → `_2` |
| `_2` | Passing A | Feet close, left foot lifted low | Arms passing the torso |
| `_3` | Inbetween | Halfway `_2` → `_4` | Halfway `_2` → `_4` |
| `_4` | Contact B | Left leg forward, right back | Right arm forward, left back |
| `_5` | Inbetween | Halfway `_4` → `_6` | Halfway `_4` → `_6` |
| `_6` | Passing B | Feet close, right foot lifted low | Arms passing the torso |
| `_7` | Inbetween | Halfway `_6` → `_0` (loop) | Halfway `_6` → `_0` |

Hours 6 and 12: both contacts are in that hour’s 3×3. Hours 8 / 9 / 10 are their own 3×3 sheets (do not FlipX 4 / 3 / 2).

Fail if any of the eight looks like idle, if `_0` and `_4` are the same stride, if a passing is a stork kick (knee tucked high behind the calf), if an inbetween is a duplicate of a key, **if both arms stay at the hips for the whole strip**, **if only one arm ever leaves the hip**, or **if `_1` and `_5` share the same leading boot when the mannequin swapped them**. `check` xor is not this list.

## Take / give (`take_06_0` … `_7`)

Hour 6 only. Same yaw as `idle_06`. Give plays this strip reversed — beat 0 is rest, beat 7 is the chest-present.

**Albedo is one 3×3** (SKILL.md §6): framed `idle_06` + mannequin `take_06_0`…`_7`. Do not GenerateImage takes with `POSE LOCK.` Do not GenerateImage `take_06_i` one-at-a-time. Do not use a 2×4 take sheet.

Image-right arm (viewer’s right) does the work. Image-left arm stays hanging. **Brown purse (locked):** the dummy already has a tiny slack brown drawstring pouch, pinched at the **neck** (bag hanging below the hand) on `_2`…`_6`. **Do not modify it** — same size, same brown, same grip. `_0` / `_1` / `_7` are empty-handed. Not a fat stuffed sack, not a shopping bag, not coins in the palm. Give is this strip reversed. Do not bake a purse into idle or walk. No orb, no other item.

This is a **pocket lift**, like the guard pulling a purse up from the belt: the working hand stays close to the torso and moves **up the front of the body**. The fist does **not** grow. Do not reach toward the camera.

| Stem | Image-right arm | Purse | Legs |
|------|-----------------|-------|------|
| `take_06_0` | Hang at hip (idle) | None | Idle stance |
| `take_06_1` | Moves inward toward the belt / pocket | None | Idle |
| `take_06_2` | Hand on belt / pocket at the hip | Tiny brown, neck-pinched | Idle |
| `take_06_3` | Pulls up from the pocket, fist at waist | Same locked purse | Idle |
| `take_06_4` | Fist rises along the belly | Same locked purse | Idle |
| `take_06_5` | Fist at lower chest, still against the body | Same locked purse | Idle |
| `take_06_6` | Fist at mid chest, in-plane | Same locked purse | Idle |
| `take_06_7` | Fist at upper chest (present) | None | Idle |

Fail if the **image-left** arm is the one moving, if the working arm never leaves the hip, if later beats drop the hand back down, if `_2`…`_6` drop or redraw the dummy’s purse, if `_0` / `_1` / `_7` grew a purse, or if any beat reaches **toward the camera** (giant fist, foreshortened punch). Guide `take_06_7` must stay a pocket-present, not a lens reach.
