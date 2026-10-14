# Kindling

Unity-shaped runtime on Three.js. Same nouns (`Game`, `World`, `GameObject`, `Transform`, `Component`) and a similar lifecycle, but it is not Unity.

Kindling **owns** the canvas, `Renderer`, requestAnimationFrame loop, and the Three.js scene (`world.native`). You **subclass** `Game` / `World` / `Component`, and type Kindling with your own `World` and `Chunk` through `KindlingTypes` (see Subclassing). The playground (or your UI) only mounts that canvas. Simulation is not UI state. Identity on a GameObject is `id`.

```
pnpm dev     # playground http://localhost:5174/
pnpm test
```

Headless (no `document`): `renderer` / `canvas` are null. `tick(dt)` still runs the component loop and physics.

---

## Unity mapping

| Unity | Kindling |
|-------|----------|
| `MonoBehaviour` | `Component` (subclass, override hooks) |
| `GameObject` | `GameObject` (`id`, `name`, always has `Transform`) |
| `Transform` parent/child | `parent =`; Three.js `Object3D` tree stays in sync |
| `Awake` / `OnEnable` / `Start` | `awake` / `onEnable` / `start` |
| `FixedUpdate` / `Update` / `LateUpdate` | `fixedUpdate` / `update` / `lateUpdate` |
| `OnDisable` / `OnDestroy` | `onDisable` / `onDestroy` |
| `Script execution order` | `static order` (lower first, per hook) |
| `Time.deltaTime` / `fixedDeltaTime` | `Time` object (`fixedDeltaTime` default 0.02) |
| `Rigidbody` + box collider | `Rigidbody` (XZ) + `BoxCollider` |
| Camera / light / mesh / audio | `Camera`, `Light`, `MeshRenderer`, `AudioSource` |

Differences that matter: there is no scene file or inspector. `Transform.position` / `yaw` / `pitch` / `roll` are **world** space (local is `localPosition` / `localYaw`). Physics is 2.5D (XZ motion, optional Y snap to terrain). Destroy is queued until the end of `simulate`.

---

## Quick start

```ts
const game = new Game(); // or `new Game(new MyWorld())`
game.mount(document.body);

const cube = new GameObject('cube');
cube.addComponent(MeshRenderer, { meshID: 'cube' });
game.world.add(cube);

const camGo = new GameObject('camera');
camGo.transform.position.y = 4;
camGo.transform.position.z = 8;
camGo.addComponent(Camera);
game.world.add(camGo);

game.start(); // RAF: tick → render
```

`MeshRenderer.meshID` looks up a registry. Built-in ids: `cube`, `plane`. Procedural factories and loaded glTF both `register(id, () => cloneOrBuild())`.

---

## Core types

### `Game<W extends World>`

Creates a `World` (or takes one), and a `Renderer` when `document` exists.

| Method | What it does |
|--------|----------------|
| `mount(parent)` | Appends the canvas, resizes. |
| `start()` | `onStart()`, then RAF. |
| `stop()` | Cancels RAF. |
| `tick(dt)` | Clamps dt, advances `Time`, calls `simulate`. Does nothing while `paused`. |
| `simulate(dt)` | Component loop (protected). |
| `destroy(go)` | Queues `world.destroy`. |
| `dispose()` | Stop + renderer dispose. |

`unfocusedHz` (default `3`) caps canvas draws while the document is unfocused. Hosts set it on the `Game` instance.

Set `paused` to freeze the simulation: frames still tick and draw, but `Time` stands still and no component runs. For extra frame work, override `tick` and call `super.tick(dt)`. `resetTime(t)` restarts the clock at `t` (a loaded save's time) with no fixed steps owed.

Override `onStart` for one-shot setup when the loop begins.

### `World`

| | |
|--|--|
| `objects` | Flat list of every registered GameObject (including children). |
| `native` | `THREE.Scene`. |
| `tileSize` | `0` = no tile collision. Set this to your cell size if you use a grid. |
| `sampleTerrain(x, z)` | Override to supply height / blocked / climbable. Default `undefined`. |
| `chunkSize` / `chunks` | Tiles per chunk side (`0` = no chunks) and the loaded `Chunk`s. See [Chunks](#chunks). |
| `addChunk` / `removeChunk` / `chunkAt(cx, cz)` / `chunkAtWorld(x, z)` / `chunkCoordAt(x, z)` / `tileAtWorld(x, z)` / `chunkBounds()` | Chunk registry and lookups. `chunkBounds` is the XZ box around every loaded chunk. |
| `add(go)` | Registers the tree, parents roots to the scene, runs `awakeAll`. |
| `remove(go)` | Unregisters **this** object now. No `onDestroy`; children stay. |
| `destroy(go)` | Queue; flushed at end of `simulate`. Children follow. |
| `findByID(id)` | First match in `objects`. |
| `forEachComponent(ctor, fn)` | One component per object (does not skip `enabled === false`). |
| `tileCoordAt(x, z)` / `tileCenter(tx, tz)` | World XZ ↔ tile coordinate (`tileSize`, or 1 when 0). |
| `objectsInTile(tx, tz)` | Spatial hash: objects whose position is in that tile (`tileSize`, or 1 when 0). |
| `forEachNear(minX, minZ, maxX, maxZ, fn)` | Broadphase: every object whose `BoxCollider` may overlap the XZ box. Check exactly. |
| `solidCover(tx, tz)` | Fraction (0–1) of a tile under solid colliders with no `Rigidbody`. Hosts' path graphs block tiles above a threshold. |
| `reindex()` | Rebuild the hash. Physics does this once per step, after integrating, so queries see positions (and adds / removes) as of that step. |

A GameObject may belong to only one World.

### `GameObject`

```ts
new GameObject(id?, name?)  // id defaults to allocID(); name defaults to id
```

Always has `transform`. `addComponent` rejects a second `Transform`; `removeComponent` never removes it. Components are only made by `addComponent`, so one never sits on two objects. `Component` is abstract.

| | |
|--|--|
| `addComponent(ctor, init?)` | Adds `new ctor()` with `init` fields set first. If already in a world: `awake` then `onEnable`. `{ enabled: false }` skips `onEnable`. |
| `removeComponent(c \| ctor)` | Removes now: that instance, or every instance of the class (`Component` = all but `Transform`). Fires `onDisable` (if enabled) then `onDestroy` once awoken. |
| `getComponent(ctor)` | First match, including `Transform`. |
| `getOrAddComponent(ctor)` | `getComponent`, else adds `new ctor()`. |
| `getComponentsInChildren(ctor)` | This object then descendants. |
| `parent` | Assigning reparents Kindling + Three.js and keeps world position and rotation. `null` unparents. If the new parent is in a world and this is not, `world.add(this)`. |
| `children` | Readonly direct children, in parenting order. |
| `timeScale` | How fast time runs for this object (1 as usual, 0 stopped). Its components' instance `update` / `fixedUpdate` / `lateUpdate` get `dt` scaled by `timeRate`, and its `Rigidbody` moves at that rate. `Time` and `world.after` run on regardless. |
| `hitstop(seconds)` | Stops this object's time for that much game time (a blow landing); overlapping stops last until the latest ends. `timeRate` is `timeScale`, or 0 while one holds. |

`allocID(prefix?)` / `resetAllocID()` are for tests and unnamed objects.

### `Transform`

Wraps `THREE.Object3D` (`transform.object3D`). `position` is a world `{ x, y, z }` with setters. Euler order is **YXZ**.

| World | Local |
|-------|--------|
| `position`, `setWorldPosition` | `localPosition` |
| `yaw` / `pitch` / `roll` | `localYaw` |
| `forward` / `right` / `up` | world only |
| `scale` (uniform) | `localScale` |

`forward` is Kindling forward: **−Z**. Assigning `parent` keeps world position and rotation.

---

## Components

Subclass `Component` and override only the hooks you need. Empty base methods are skipped (dispatch checks `!== Component.prototype[hook]`).

```ts
class Spin extends Component {
	static order = 10;
	speed = 0.35;

	override update(dt: number): void {
		this.gameObject.transform.yaw += dt * this.speed;
	}
}
```

### Instance callbacks

| Hook | When |
|------|------|
| `awake()` | First time the GameObject is in a world (or when the component is added to an in-world object). Once. |
| `onEnable()` / `onDisable()` | After `awake`, when `enabled` becomes true/false. Also on destroy (`onDisable` then `onDestroy`). |
| `start()` | First `simulate` after awake, **after** any `fixedUpdate` that frame. Once. Skipped while disabled. |
| `fixedUpdate(dt)` | Fixed step (`Time.fixedDeltaTime`). May run 0–N times per frame. |
| `update(dt)` | Once per `simulate`, frame dt. |
| `lateUpdate(dt)` | After `stepPhysics`. |
| `onDestroy()` | End-of-frame destroy, after `onDisable`. Not called by `World.remove`. |

`awoken` / `started` track whether `awake` / `start` have run. Setting `enabled` before the object is in a world does not fire enable/disable yet.

### Type-level dispatch

Components are grouped by **constructor**, then sorted by `static order` (default 0, lower first). That order applies to `fixedUpdate`, `update`, and `lateUpdate`.

Optional **batch** hooks on the class run once per type, then each instance:

```ts
class Flock extends Component {
	static update(dt: number, list: Flock[]): void {
		// all Flock instances this frame
	}
	override update(dt: number): void { /* each instance */ }
}
```

The static hook is used only if the class **owns** that property (`Object.hasOwn`), so subclasses do not accidentally inherit a parent batch.

Disabled components are omitted from dispatch and from `start`.

---

## Frame loop

```
start() → onStart()
RAF:
  tick(dt)          // clamp MAX_DT (0.05), Time.deltaTime / Time.time
    simulate(dt)
      while (fixed accumulator)
        fixedUpdate(fixedDeltaTime)
      start() on not-yet-started enabled components
      world.runTimers()   // due world.after(seconds, fn) calls
      update(dt)
      stepPhysics(world, dt)
      lateUpdate(dt)
      updateEffects()     // effects from addEffect move on
      world.flushDestroy()
  renderer.render()
```

Instance hooks get `dt` times their object's `timeRate` (see `GameObject.timeScale`); type-level hooks get it unscaled. `world.after(seconds, fn)` calls `fn` once that much game time has passed (paused time does not count). `Time.fixedDeltaTime` defaults to `0.02`. `resetTime()` restores the defaults (tests / new sessions).

---

## Physics

`stepPhysics` is XZ only, then optional Y snap.

1. **Integrate.** Every enabled `Rigidbody`: `position.xz += velocity.xz * dt` (stores `prevX` / `prevZ`). Then `World.reindex()`, so collision pairs come from the spatial hash, not every pair of objects.
2. **Collide.** Enabled, solid, non-trigger `BoxCollider` on an object that also has a `Rigidbody`:
   - tile AABB vs `World.sampleTerrain` when `tileSize > 0` (`blocked` cells)
   - other solid boxes (minimum translation on X or Z)
   - static round obstacles: `shape: 'cylinder'` (diameter `size.x`) pushes the box out away from the axis, so bodies slide around barrels and wells instead of snapping to an axis
   - **shove**: both colliders `pad > 0` → shove along walk velocity (`SHOVE_YIELD`), not a hard block
   - cliffs: `sampleTerrain` height / `climbable`; revert to previous XZ if the step is illegal
3. **Ground.** `Rigidbody.grounded`: lerp Y toward `sampleTerrain.worldY` (skip if the rise exceeds `stepHeight`).

`World.sampleTerrain` returns `{ height, worldY, blocked, climbable }` or `undefined`. Override it if you have a heightfield or grid; the default is no terrain.

`kinematic` and `mass` exist on `Rigidbody` but are not used by `stepPhysics` yet.

---

## Chunks

A tile grid split into square `Chunk<T>`s: `size` × `size` tiles of `cellSize` meters, row-major, at chunk coordinate `origin`. `T` is the host's tile type. Kindling does not interpret tiles; `sampleTerrain` is still the host's.

```ts
world.tileSize = 1;
world.chunkSize = 16;
world.addChunk(new Chunk('meadow', { cx: 0, cz: 0 }, 16, 1, tiles)); // must match chunkSize / tileSize
world.tileAtWorld(3.5, 7.5); // tiles[7 * 16 + 3]
```

Chunk helpers: `tile(localX, localZ)`, `forEachTile((tile, localX, localZ) => …)`, `tileAtWorld`, `worldToLocal`, `worldCellCenter`, `worldOriginX/Z`, `distanceTo(x, z)`.

**Streaming.** Put a `ChunkStreamer` on one object and give it every chunk of the scene. Each `lateUpdate` it loads chunks within an enabled `StreamingAnchor`'s `viewRadius` (meters to the chunk edge) and unloads them past `viewRadius + hysteresis`. With no anchors, nothing changes.

```ts
class Stream extends ChunkStreamer<MyChunk> {
	override spawn(chunk: MyChunk): void { /* first load only: add its objects */ }
}
const stream = systems.addComponent(Stream, { chunks: allChunks });
stream.loadAll(); // whole scene in, e.g. before captureWorld
```

Unloading **parks** every object whose `ChunkBound.chunkID` is the chunk's `id` (`World.remove`). Loading adds the same objects back as they were; `spawn` never runs twice for a chunk. Parked objects are not in `world.objects`, so call `loadAll()` before `captureWorld` / `restoreWorld`; the next `stream()` parks the far ones again.

---

## Saves

A save is what changed since the scene was built, not a dump of it.

```ts
class Door extends Component {
	static override saved = ['open'];   // JSON fields only
	open = false;
}

const fresh = captureWorld(world);              // right after building the scene
const save = diffWorld(fresh, captureWorld(world)); // later: changed fields, removed ids, allocID serial
restoreWorld(rebuilt, save, (recipe) => spawn(rebuilt, recipe));
```

- **`static saved`** lists the fields a component keeps. `saveState()` / `loadState()` read and write them; override for state that is not a plain field (`Transform` saves its world pose, `BoxCollider` its `solid` / `isTrigger`).
- **Diff.** Objects are matched by `id`; components by class name, then `Name#1` for a second one on the same object. Only changed fields are stored. Keep class names through minify (`esbuild.keepNames`).
- **New objects.** An object the fresh scene does not have is stored whole with its `GameObject.recipe` (plain data the host's spawner stamps). `restoreWorld` calls `spawn(recipe)`, then applies its state.
- **Ids.** A fresh scene must mint the same ids every time: `resetAllocID()` before building it. The save carries the `allocID` serial so restored objects never collide with new ones.

---

## Rendering

`Renderer` creates the WebGL canvas, hemisphere + ambient fill, optional directional sun, fog, and shadows. It renders with the first **enabled** `Camera` in `world.objects`. `detailMaps` (default on) samples normal and metalness maps; off disposes them from the GPU. `shadows` is a `ShadowMode` run by `ShadowCache` (mixed cached shadow maps): every shadowed light keeps a still map of casters that hold still, rebaked only when one in its reach appears, moves, or goes, or when the light moves. Skinned meshes, what their bones hold, and anything in motion are moving casters until they settle. `off` disposes the maps; `static` samples the still maps, and skinned models cast soft capsule shadows instead (one upright capsule each from the bind pose, the 16 nearest the camera, blocking every point and directional light on `ToonMaterial` surfaces); `dynamic` (default) copies them into live maps each frame and draws only the moving casters on top, in the sun and the nearest `maxMovingShadows` busy point lights. The look-sun frames every still caster from a fixed direction. `pointShadowMapSize` (default 256) and `directionalShadowMapSize` (default 1024) are the map sides, clamped to the GPU's max texture size. `graphicsMemory()` estimates GPU bytes in use: `framebufferMemory()` (drawing buffers, scales with window size) plus `sceneMemory()` (shadow maps, geometry, textures). `stats()` returns the last frame's draw calls and triangles, live geometry and texture counts, both memory parts, and `frameMS` (average over the last 30 s). `frameMS(windowMS)` alone is cheap (no scene walk), for an FPS readout.

| | |
|--|--|
| `Camera` | Perspective; `native` is parented to the GameObject’s `Object3D`. Syncs fov/near/far each `update`. What blows do to the view, in game time: `shake(m, s)`, `punch(m, s)` (in toward where it looks, springing back), and `impact(at, s)`, a black-and-white impact frame: whatever stands off the ground within about 2 m of `at` (the middle of the body struck) a white silhouette inked black, the rest black with speed lines bursting out from it, inverted for its second half. The `Renderer` hands `impactFrame` to the `OutlinePass`. |
| `Light` | `point` or `directional`. Local `offsetX/Y/Z` (Z along Kindling forward). |
| `MeshRenderer` | Instantiates `meshID` from the registry; optional `color`, `shaderInserts`, `shaderUniforms`. |
| `applyLook(look)` | Background, fog, exposure, hemi, fill, optional sun. |
| `projectToCanvas` / `pickGround` | Screen projection and ground-plane picking. |

`MeshRenderer` waits until `meshReady(meshID)`. Changing `meshID` rebuilds the mesh.

Shader patches: `insertAfterChunk` / `applyShaderFeatures` insert GLSL after a documented Three.js `#include <chunk>` (see playground pulse cube). `patchShader(material, key, edit)` stacks a raw edit on top of earlier ones (a key already on the material is skipped), so patches compose instead of replacing `onBeforeCompile`.

Toon look: `ToonMaterial` is `MeshToonMaterial` with a hard-stepped ramp (`bands`), a tint on the unlit side (`shade`), a back-light `rim`, and drawn `pattern`s (`brick`, `plank`, `thatch`, `stone`, `meadow`) computed from world position, so no textures or UVs. `patternScale` is meters per course on sides, `topScale` on upward faces, `brickLength` in meters, and `topAxis` (the way rows count on flat tops; stairs point it uphill), so courses and joints can match step heights and tread depths. `outline: false` keeps a surface (grass, water) out of the ink pass: opaque surfaces write alpha 0 as the mask, transparent ones keep their alpha for blending and leave the mask beneath untouched (set `transparent` before `outline`). Mesh kit (`lathe`, `bevelBox`, `tube`, `blob`, `ribbon`) builds prop geometry in meters, Y up; the host supplies materials and instancing. `Renderer.outline` (`OutlinePass`) draws ink from scene depth in one fullscreen pass: no per-object draw calls. Set its `color` per scene with `RendererLook.ink` and its `width` in pixels at 1080p; `enabled = false` renders straight to the canvas. The ink comes after everything, see-through things too; `overInk(material)` makes an effect (a flame, a glow, a trail) wipe the ink beneath it as much as it covers it.

Effects (`render/effects.ts`): `addEffect(scene, object, update, dispose)` adds a short-lived effect, drawn over the ink, casting no shadow; `update(age)` runs once a frame in game time and returns false when it is done (`addMeshEffect` for a mesh that owns its geometry and material, `effectMaterial` for an unlit see-through shader). Primitives, each taking its look as data: `streaks` (needles of light shooting from roots), `sweep` (a crescent ribbon between two edges of a motion, a blade's swing), `starburst` (inked spikes where a blow lands), `puff` (a dust or smoke cloud billowing out, with `puffPicture(colors)`), `shockwave` (a ring racing out across the ground), `afterimage` (a fading flat ghost of a posed model). Moves (`assets/move.ts`): `move(timing, windUp, t)` samples a slow–fast–slow move (anticipate with a sink, strike in `snap`, hold the impact, carry through, settle) as its `phase`, `u` from the ready pose to the strike pose and `weight` over the clip under it; `ease` has the easings.

---

## Audio

`world.audio` is a Web Audio mixer. Scores are procedural. `playRecording` loops a finished file (URL or `ArrayBuffer`) on the music output — volume, mute, and duck — without the synth room. Omit the loop and it runs from 0 to the end of the file, then repeats. Pass `{ start, end }` in seconds to play from 0 until `end`, then jump to `start` and repeat that span. Pause, seek, and the beat clock drive that file the same way they drive a score (60 BPM, so one beat is one second; the bar ends at `end`). Missing `AudioContext` (Node tests, headless) is a silent no-op. While a score, recording, or loop is playing, the mixer schedules itself — you do not call `update()` unless you are headless.

```ts
world.audio.connectUnlock(canvas); // click / key / touch → resume
await world.audio.resume();
world.audio.playMusic(score);
await world.audio.playRecording('/theme.mp3'); // finished file, dry, loops
world.audio.playSfx(patch, { x, z }); // optional world position
world.audio.playLoop('river', patch, { x, z, hear: 16 });
world.audio.stopLoop('river');
world.audio.playLoop('radio', score, { x, z, hear: 12 });
world.audio.setListener(x, y, z, yaw); // HRTF stereo; yaw 0 faces Kindling −Z
world.audio.musicVolume = 0.5;
world.audio.sfxVolume = 0.8;
world.audio.muted = false;
world.audio.duck = 0.2; // pause menu
world.audio.warnDropped = true; // one console.warn per drop reason
world.audio.pauseMusic();
world.audio.unpauseMusic();
world.audio.seekMusic(8);
world.audio.stopMusic();
```

Invalid `Score` throws from `playMusic` / `playLoop` (same checks as `piece()`). The first SFX before `resume` is queued and played on unlock; later ones before resume are dropped and warned. Pass a **stable** object into `playLoop` (not a fresh patch or `piece()` every frame) or the source restarts. A posed `Score` is HRTF like a river bed: SFX volume, no music reverb / pause / duck. `playMusic` can run at the same time.

`AudioSource` on a GameObject poses SFX/loops at `transform.position` (world x/y/z). A one-shot's `gain` scales the source's. Disabled, it is silent. Other components play by ref:

```ts
const speaker = go.addComponent(AudioSource, { hear: 12 });
speaker.play(knock);     // one-shot
speaker.loop = radio;    // patch or score; follows the object
speaker.loop = null;     // stop
```

Built-in instruments (from `@arc-director/kindling/score`, all in `src/audio/instruments.ts`): `pad`, `pluck` (guitar / harp), `lead`, `bass`, `bell`, `drum` (MIDI `<40` dum, `<45` tek, else tap), `air`, `piano`, `violin`, `cello`, `brass`, `flute`, `guitar`, `twelveString`, `koto`, `choir` (a wordless oo-to-ah). Anything else is `registerInstrument` before `piece` / `playMusic`.

```ts
import { registerInstrument } from '@arc-director/kindling';
export const sitar = registerInstrument('sitar', 'percussive', (ctx, dest, noise, when, midi, dur, gain) => { /* oscillators */ });
```

`percussive` locks loudness when the note starts. `sustaining` lets a dim/cres turn the volume on a note that is already playing (pad, bass, lead, air, violin, cello, brass, flute, choir). Override a track with `track(piano, { envelope: 'sustaining' })`.

Sound filters are inserts: `reverb({ mix, decay, tone, size })` adds a short room on top of the dry signal (`size` 0–1 adds reflections and spaces them; 0.5 is four stock taps), `overdrive({ drive, tone, level })` is a waveshaper plus a tone lowpass; a clipped sound comes out loud whatever goes in, so `level` turns it back down. Put them on a track (`track(lead, { filters: [overdrive()] })`), the whole piece (`piece({ filters: [reverb()] })` or `score.filters`), or an SFX patch (`patch.filters`). Series, first to last. Voice filters run, then the score filters, then the music-bus room (that room is always there for `playMusic`). A posed score or SFX does not use the music-bus room, so add `reverb()` on it when it should bloom.

### Score (`@arc-director/kindling/score`)

You can pass a hand-built `{ bpm, loop, voices }` into `playMusic`. Or compile:

```ts
import { arpeggio, bar, chord, root, track, pad, pluck, bass, piece } from '@arc-director/kindling/score';

const bed = track(pad, { cutoff: 640 });
const harp = track(pluck);
const low = track(bass, { transpose: -12 });
const score = piece({ bpm: 96, id: 'hi' }, [
	bar(8, bed(chord('C')), harp(arpeggio('C')), low(root('C'))),
	bar(8, bed(chord('G')), harp(arpeggio('G')), low(root('G'))),
]);
```

`piece({ loops: 1, ...})` plays once (`-1` / omit is forever). `callback(fn)` between bars (or after the last) runs when playback reaches that beat — stop, swap the song, whatever.

`c4:2` is C4 for 2 beats. `r:4` is four beats of rest. Durationless cells split one beat (`g4 b4 d5 b4` = sixteenths). `|` is visual when notes have `:n`. `chord('C')` is all tones together (optional `beats`, else the bar; `D-`, `Bb2`, `C#7`). `.range('a2', 'a5')` or `.range(0, 3)` keeps every chord tone in that span. `.include(0, 3)` or `.include('c3', 'c4')` keeps those tones. `.exclude(1, 2)` drops them from the span. `root('C')` is the lowest tone. `arpeggio('C')` plays those tones one after another (omit `beats` and it fills the bar). `changes(['D-', 4], ['C', 4])` is a chord list; pass it to `chord` / `arpeggio` / `root`, or `ch.as(fn)` for any voicing.

Each **part** in a `bar` starts at that bar’s downbeat (overlay). Sequential notes belong in **one** track call: `low('c2:4 g2:4')`. Offset a second idea with rest: `low('c2:4'), low('r:4 g2:4')`. Two `track(bass)` calls are two tracks (different gain / cutoff).

Dynamics: `p`, `mp`, `mf`, `f`, `ff`. Marks follow the notes they apply to. `crescendo(f)` / `diminuendo(p)` ride `sustaining` instruments; otherwise velocity is taken at note start.

`slot()` stores a phrase for replay / `.with` / `.without`. `start()` / `end()` trim while listening. `callback(fn)` fires when playback reaches that point.

SFX layers: `noise`, `thump`, `click`, `creak`, `pluck`, `fm`, `chirp`, `bee`, `boo` (speech syllables modeled on recordings, each opening with a "b"), `crackle` (random pops, `rate` a second, through a bandpass: fire, sparks, grit; loops too), `metal` (a struck bar's inharmonic partials: clash, clang), `formant` (a throat's buzz shaped into a `vowel`: grunts, shouts, cries) and `rumble` (low rolling noise over a sub tone: thunder's tail, a ground crack). Noise, `crackle` and `rumble` layers take `attack` (swell in, hold, die away) and `cutoffTo` (a filter sweep). A patch's `vary` (0–1) moves each play's pitch (up to ±4 semitones × `vary`) and loudness, so repeats never sound the same. `speech(text, voice, seconds?)` builds an Animal Crossing–style babble patch from a spoken line: one `bee` or `boo` per syllable on a pentatonic scale, a "boo" for rounded vowels and a "bee" for the rest as ten English spelling rules read them (silent e, vowel teams, r-colored vowels, …), with sentence intonation, fitted to exactly `seconds` when given. A `SpeechVoice` sets `pitch`, `rate` and `range` (intonation); `voiceFor(seed, [lowHz, highHz])` makes a varied one. The `Speaker` component (an `AudioSource`) builds a line in its voice with `line(text, seconds?)` and plays it at its transform with `say(line)`, filling unset `voice` fields from `voiceFor(id)`. Posed SFX use HRTF. `opts.dur` / `opts.freq` apply to **every** layer. Music is centered. Distance stays full through 1m, drops steeply, then keeps a shallow tail; mute past `hear`. `falloff` scales both slopes.

---

## Meshes

```ts
register('crate', () => proceduralBox(0x886644));
// Clone of the glTF scene; does not attach.
await registerGltf('tri', '/triangle.gltf');
```

`create(id)` / `meshReady(id)` are what `MeshRenderer` uses. `registerGltf` is async; the renderer retries until the factory exists.

Toon models: `scripts/buildModels.mjs` turns a folder of Tripo GLBs into slim game GLBs plus one shared clip library (`clips.glb`); it also rigs bows and birds that come unrigged. `registerToonModel(id, url, { height, brightness, bands })` loads one (characters and props alike) and `registerToonClips(url)` the library; each `MeshRenderer` instance is a skinned clone with `ToonMaterial`s, facing −Z. `Animator` plays clips on it (`toonClip` fits library clips to each body); each frame starts from the clip's pose, so posing bones after it never piles up. On top of the clip, every frame after it: `holdInHand(mesh, 'right', prop, grip)` puts a prop in a hand, `lookAt(mesh, point, weight)` turns the head, `reach(mesh, 'right', point, weight)` bends an arm to a point (two-bone IK), `aimHeld(mesh, 'right', prop, axis, side, point, facing, weight)` turns the hand so a held prop points where it should (a sword's tip and flat), and `drawBow(bow, nock)` draws a rigged bow's string. `humanBone(mesh, 'head')` and `restTurn(mesh, bone)` give the bones. `scripts/shoot.mjs <url> <out.png>` screenshots a page in headless Chrome once its title is `ready` (the playground's `character.html?shot=turnaround|faces` does this).

---

## Subclassing

Typical host:

- `class MyGame extends Game<MyWorld>`: inject a custom `World`, set `paused` to pause, override `tick` (calling `super.tick`) for extra frame work.
- `class MyWorld extends World`: set `tileSize`, override `sampleTerrain`, add queries.
- Fill in `KindlingTypes` once, and `go.world`, `world.chunks`, `chunkAtWorld` and `tileAtWorld` are your types everywhere. `GameObject` and `Component` need no subclass for that:

```ts
declare module '@arc-director/kindling' {
	interface KindlingTypes {
		world:MyWorld;
		chunk:MyChunk;
	}
}
```

Input: `world.input` (`Input`) is the keyboard, mouse and pointer lock on the canvas. `Game` attaches it and clears its per-frame fields (`pressed`, `justClick`, look and wheel deltas) after each frame. Keys are `KeyboardEvent.code`; set `input.captures` to the keys whose browser default (scrolling, focus moves) the game takes over.

Kindling has no UI framework, no scene format, and no gameplay systems beyond the types above.

---

## Layout

```
src/
  index.ts           public API
  core/              Game, World, GameObject, Transform, Time, physics
  render/            Renderer, Camera, Light, MeshRenderer, shader inserts, effects
  assets/            mesh registry, glTF
  audio/             procedural mixer, scores, SFX
playground/          Vite cube / parent / glTF / light demo; character.html sheet
```
