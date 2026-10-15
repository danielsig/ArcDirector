# Kindling

Kindling is a small, Unity-style game runtime built on Three.js. It uses Unity's nouns (`Game`, `World`, `GameObject`, `Transform`, `Component`) and a similar lifecycle, but it is not a Unity clone.

Kindling **owns** the canvas, the `Renderer`, the requestAnimationFrame loop and the Three.js scene (`world.native`). You **subclass** `Game`, `World` and `Component`, and tell Kindling about your own `World` and `Chunk` types through `KindlingTypes` (see [Subclassing](#subclassing)). The playground, or your own UI, only mounts the canvas; the simulation never lives in UI state. A GameObject is identified by its `id`.

```sh
pnpm dev     # playground at http://localhost:5174/
pnpm test
```

Without a `document` (headless, as in Node tests), `renderer` and `canvas` are null, but `tick(dt)` still runs the component loop and physics.

---

## Unity mapping

| Unity | Kindling |
|-------|----------|
| `MonoBehaviour` | `Component` (subclass it and override hooks) |
| `GameObject` | `GameObject` (`id`, `name`, always has a `Transform`) |
| `Transform` parent/child | `parent =`; the Three.js `Object3D` tree stays in sync |
| `Awake` / `OnEnable` / `Start` | `awake` / `onEnable` / `start` |
| `FixedUpdate` / `Update` / `LateUpdate` | `fixedUpdate` / `update` / `lateUpdate` |
| `OnDisable` / `OnDestroy` | `onDisable` / `onDestroy` |
| Script execution order | `static order` (lower runs first, per hook) |
| `Time.deltaTime` / `fixedDeltaTime` | The `Time` object (`fixedDeltaTime` defaults to 0.02) |
| `Rigidbody` + box collider | `Rigidbody` (XZ) + `BoxCollider` |
| Camera / light / mesh / audio | `Camera`, `Light`, `MeshRenderer`, `AudioSource` |

The differences that matter:

- There is no scene file and no inspector.
- `Transform.position`, `yaw`, `pitch` and `roll` are in **world** space. The local values are `localPosition` and `localYaw`.
- Physics is 2.5D: things move on XZ, with an optional Y snap to the terrain.
- Destroying an object is queued until the end of `simulate`.

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

game.start(); // each animation frame: tick, then render
```

`MeshRenderer.meshID` looks the mesh up in a registry. The built-in IDs are `cube` and `plane`. Procedural meshes and loaded glTF files are registered the same way: `register(id, () => cloneOrBuild())`.

---

## Core types

### `Game<W extends World>`

Creates a `World` (or uses the one you pass in) and, when there is a `document`, a `Renderer`.

| Method | What it does |
|--------|----------------|
| `mount(parent)` | Appends the canvas to `parent` and sizes it. |
| `start()` | Calls `onStart()`, then starts the animation frame loop. |
| `stop()` | Cancels the loop. |
| `tick(dt)` | Clamps `dt`, advances `Time` and calls `simulate`. Does nothing while `paused`. |
| `simulate(dt)` | Runs the component loop (protected). |
| `destroy(go)` | Queues `world.destroy(go)`. |
| `dispose()` | Stops the loop and disposes of the renderer. |

`unfocusedHz` (default `3`) caps how often the canvas is drawn while the page is not focused. Set it on your `Game` instance.

Set `paused` to freeze the simulation. Frames still tick and draw, but `Time` stands still and no component runs. To do extra work every frame, override `tick` and call `super.tick(dt)`. `resetTime(t)` restarts the clock at `t` (a loaded save's time, for example) with no fixed steps owed.

Override `onStart` for one-off setup when the loop begins.

### `World`

| | |
|--|--|
| `objects` | A flat list of every registered GameObject, children included. |
| `native` | The `THREE.Scene`. |
| `tileSize` | The side of one tile. `0` means no tile collision. If you use a grid, set it to your cell size. |
| `sampleTerrain(x, z)` | Override it to supply the height, and whether the ground is blocked or climbable, at a point. Returns `undefined` by default. |
| `chunkSize` / `chunks` | The number of tiles along a chunk's side (`0` means no chunks), and the loaded `Chunk`s. See [Chunks](#chunks). |
| `addChunk` / `removeChunk` / `chunkAt(cx, cz)` / `chunkAtWorld(x, z)` / `chunkCoordAt(x, z)` / `tileAtWorld(x, z)` / `chunkBounds()` | The chunk registry and its lookups. `chunkBounds` is the XZ box around every loaded chunk. |
| `add(go)` | Registers the whole tree, parents its root to the scene and runs `awakeAll`. |
| `remove(go)` | Unregisters **this** object right away. `onDestroy` is not called, and its children stay. |
| `destroy(go)` | Queues the object to be destroyed at the end of `simulate`. Its children go with it. |
| `findByID(id)` | The first object in `objects` with that ID. |
| `forEachComponent(ctor, fn)` | Calls `fn` with one component per object, disabled ones included. |
| `tileCoordAt(x, z)` / `tileCenter(tx, tz)` | Converts between world XZ and tile coordinates (using `tileSize`, or 1 when it is 0). |
| `objectsInTile(tx, tz)` | Spatial hash lookup: the objects whose position falls in that tile (using `tileSize`, or 1 when it is 0). |
| `forEachNear(minX, minZ, maxX, maxZ, fn)` | Broad phase: every object whose `BoxCollider` may overlap the XZ box. Check the exact overlap yourself. |
| `solidCover(tx, tz)` | How much of a tile (0–1) is covered by solid colliders that have no `Rigidbody`. Host path graphs block tiles above some threshold. |
| `reindex()` | Rebuilds the spatial hash. Physics does this once per step, after moving things, so queries see positions (and added or removed objects) as they were at that step. |

A GameObject can belong to only one World.

### `GameObject`

```ts
new GameObject(id?, name?)  // id defaults to allocID(); name defaults to id
```

Every GameObject has a `transform`. `addComponent` refuses a second `Transform`, and `removeComponent` never removes it. Components are only ever created by `addComponent`, so a component can never sit on two objects. `Component` itself is abstract.

| | |
|--|--|
| `addComponent(ctor, init?)` | Adds `new ctor()`, with the `init` fields set first. If the object is already in a world, `awake` and then `onEnable` run. Passing `{ enabled: false }` skips `onEnable`. |
| `removeComponent(c \| ctor)` | Removes a component right away: that instance, or every instance of that class (`Component` means all of them except the `Transform`). Calls `onDisable` (if it was enabled), then `onDestroy` (if it had awoken). |
| `getComponent(ctor)` | The first match, `Transform` included. |
| `getOrAddComponent(ctor)` | `getComponent`, or adds a `new ctor()` if there is none. |
| `getComponentsInChildren(ctor)` | Matches on this object, then on its descendants. |
| `parent` | Assigning it reparents the object in both Kindling and Three.js, keeping its world position and rotation. `null` unparents it. If the new parent is in a world and this object is not, this object is added to that world too. |
| `children` | The direct children (read-only), in the order they were parented. |
| `timeScale` | How fast time runs for this object (1 is normal, 0 is stopped). Its components' `update`, `fixedUpdate` and `lateUpdate` get `dt` scaled by `timeRate`, and its `Rigidbody` moves at that rate. `Time` and `world.after` are not affected. |
| `hitstop(seconds)` | Stops this object's time for that many seconds of game time, for example when a blow lands. Overlapping stops last until the latest one ends. `timeRate` is `timeScale`, or 0 while a stop is in effect. |

`allocID(prefix?)` and `resetAllocID()` are for tests and for objects without a name.

### `Transform`

A `Transform` wraps a `THREE.Object3D` (`transform.object3D`). `position` is a world-space `{ x, y, z }` with setters. The Euler order is **YXZ**.

| World | Local |
|-------|--------|
| `position`, `setWorldPosition` | `localPosition` |
| `yaw` / `pitch` / `roll` | `localYaw` |
| `forward` / `right` / `up` | world only |
| `scale` (uniform) | `localScale` |

`forward` is Kindling's forward, **−Z**. Assigning `parent` keeps the world position and rotation.

---

## Components

Subclass `Component` and override only the hooks you need. Hooks you leave alone are skipped entirely (dispatch checks `!== Component.prototype[hook]`).

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

| Hook | When it runs |
|------|------|
| `awake()` | Once: the first time the GameObject is in a world, or when the component is added to an object that already is. |
| `onEnable()` / `onDisable()` | After `awake`, whenever `enabled` becomes true or false. Also when the object is destroyed (`onDisable`, then `onDestroy`). |
| `start()` | Once: on the first `simulate` after `awake`, **after** any `fixedUpdate` that frame. Skipped while the component is disabled. |
| `fixedUpdate(dt)` | On every fixed step (`Time.fixedDeltaTime`). It may run any number of times in one frame, including zero. |
| `update(dt)` | Once per `simulate`, with the frame's `dt`. |
| `lateUpdate(dt)` | After `stepPhysics`. |
| `onDestroy()` | When the object is destroyed at the end of the frame, after `onDisable`. `World.remove` does not call it. |

`awoken` and `started` tell you whether `awake` and `start` have run. Setting `enabled` before the object is in a world does not fire `onEnable` or `onDisable` yet.

### Type-level dispatch

Components are grouped by **constructor**, and the groups are sorted by `static order` (default 0, lower runs first). That order applies to `fixedUpdate`, `update` and `lateUpdate`.

A class can also have optional **batch** hooks: static methods that run once per type, before each instance's own hook:

```ts
class Flock extends Component {
	static update(dt: number, list: Flock[]): void {
		// every Flock instance this frame
	}
	override update(dt: number): void { /* each instance */ }
}
```

A static hook is only used if the class **owns** that property (`Object.hasOwn`), so a subclass never inherits its parent's batch hook by accident.

Disabled components are left out of dispatch and of `start`.

---

## Frame loop

```text
start() → onStart()
every animation frame:
  tick(dt)          // clamp to MAX_DT (0.05), advance Time.deltaTime / Time.time
    simulate(dt)
      while a fixed step is due
        fixedUpdate(fixedDeltaTime)
      start() on enabled components that have not started
      world.runTimers()   // world.after(seconds, fn) calls that are due
      update(dt)
      stepPhysics(world, dt)
      lateUpdate(dt)
      updateEffects()     // effects from addEffect move on
      world.flushDestroy()
  renderer.render()
```

Instance hooks get `dt` multiplied by their object's `timeRate` (see `GameObject.timeScale`); type-level hooks get it unscaled. `world.after(seconds, fn)` calls `fn` once that much game time has passed (time spent paused does not count). `Time.fixedDeltaTime` defaults to `0.02`, and `resetTime()` restores the defaults, which is handy for tests and new sessions.

---

## Physics

`stepPhysics` moves things on XZ only, then can snap them to the ground on Y. Each step has three stages:

1. **Move.** Every enabled `Rigidbody` moves by `velocity * dt` on XZ, keeping its previous position in `prevX` / `prevZ`. Then `World.reindex()` runs, so collision pairs come from the spatial hash instead of testing every pair of objects.
2. **Collide.** Every enabled, solid, non-trigger `BoxCollider` on an object that also has a `Rigidbody` is checked against:
   - the tile grid, through `World.sampleTerrain`, when `tileSize > 0` (it cannot enter `blocked` cells);
   - other solid boxes (it is pushed out along X or Z);
   - static round obstacles: a `shape: 'cylinder'` collider (diameter `size.x`) pushes the box straight out from its axis, so bodies slide around barrels and wells instead of snapping to one side;
   - other padded bodies: when both colliders have `pad > 0`, they **shove** each other along the walking direction (`SHOVE_YIELD`) instead of blocking;
   - cliffs: `sampleTerrain`'s `height` and `climbable` decide whether the step was allowed, and if not, the body goes back to its previous XZ position.
3. **Ground.** A `Rigidbody` with `grounded` set eases its Y toward `sampleTerrain`'s `worldY`, unless the rise is taller than `stepHeight`.

`World.sampleTerrain` returns `{ height, worldY, blocked, climbable }` or `undefined`. Override it if you have a heightfield or a grid; by default there is no terrain.

`Rigidbody` has `kinematic` and `mass`, but `stepPhysics` does not use them yet.

---

## Chunks

A tile grid can be split into square `Chunk<T>`s. Each chunk holds `size` × `size` tiles, each `cellSize` meters wide, stored row by row, and sits at chunk coordinate `origin`. `T` is the host's own tile type: Kindling never looks inside a tile, and `sampleTerrain` is still up to the host.

```ts
world.tileSize = 1;
world.chunkSize = 16;
world.addChunk(new Chunk('meadow', { cx: 0, cz: 0 }, 16, 1, tiles)); // must match chunkSize / tileSize
world.tileAtWorld(3.5, 7.5); // tiles[7 * 16 + 3]
```

Chunk helpers: `tile(localX, localZ)`, `forEachTile((tile, localX, localZ) => …)`, `tileAtWorld`, `worldToLocal`, `worldCellCenter`, `worldOriginX/Z`, `distanceTo(x, z)`.

**Streaming.** Put a `ChunkStreamer` on one object and give it every chunk in the scene. On each `lateUpdate` it loads the chunks within `viewRadius` of an enabled `StreamingAnchor` (measured in meters to the chunk's edge), and unloads the ones farther away than `viewRadius + hysteresis`. Without any anchors, nothing changes.

```ts
class Stream extends ChunkStreamer<MyChunk> {
	override spawn(chunk: MyChunk): void { /* first load only: add its objects */ }
}
const stream = systems.addComponent(Stream, { chunks: allChunks });
stream.loadAll(); // load the whole scene, e.g. before captureWorld
```

Unloading a chunk **parks** every object whose `ChunkBound.chunkID` is that chunk's `id` (with `World.remove`). Loading the chunk again adds the same objects back exactly as they were, so `spawn` never runs twice for one chunk. Parked objects are not in `world.objects`, so call `loadAll()` before `captureWorld` or `restoreWorld`. The next `stream()` parks the far ones again.

---

## Saves

A save stores what changed since the scene was built, not a copy of the whole scene.

```ts
class Door extends Component {
	static override saved = ['open'];   // JSON fields only
	open = false;
}

const fresh = captureWorld(world);              // right after building the scene
const save = diffWorld(fresh, captureWorld(world)); // later: changed fields, removed IDs, the allocID counter
restoreWorld(rebuilt, save, (recipe) => spawn(rebuilt, recipe));
```

- **`static saved`** lists the fields a component keeps. `saveState()` and `loadState()` read and write them. Override those two for state that is not a plain field: `Transform` saves its world pose, and `BoxCollider` its `solid` and `isTrigger`.
- **Diffs.** Objects are matched by `id`, and components by class name (a second component of the same class on one object is `Name#1`). Only the fields that changed are stored. Class names must survive minification (`esbuild.keepNames`).
- **New objects.** An object that the fresh scene does not have is stored whole, along with its `GameObject.recipe`: plain data that the host's spawner builds the object from. `restoreWorld` calls `spawn(recipe)`, then applies the saved state.
- **IDs.** A fresh scene must mint the same IDs every time, so call `resetAllocID()` before building it. The save carries the `allocID` counter, so restored objects never collide with new ones.

---

## Rendering

`Renderer` creates the WebGL canvas, a hemisphere light with an ambient fill, an optional directional sun, fog and shadows. It renders through the first **enabled** `Camera` in `world.objects`. `detailMaps` (on by default) samples normal and metalness maps; turning it off frees them from the GPU.

**Shadows.** `shadows` is a `ShadowMode`, carried out by `ShadowCache`, which mixes cached shadow maps with live ones. Every light that casts shadows keeps a still map of the casters that are not moving. That map is only redrawn when a caster within the light's reach appears, moves or disappears, or when the light itself moves. Skinned meshes, whatever their bones hold, and anything in motion count as moving casters until they settle. The modes are:

- `off` frees the shadow maps.
- `static` uses the still maps only. Skinned models cast soft capsule shadows instead: one upright capsule each, taken from the bind pose, for the 16 models nearest the camera. These block every point and directional light on `ToonMaterial` surfaces.
- `dynamic` (the default) copies the still maps into live ones each frame and draws only the moving casters on top, for the sun and for the `maxMovingShadows` nearest point lights with moving casters.

The look's sun frames every still caster from a fixed direction. `pointShadowMapSize` (default 256) and `directionalShadowMapSize` (default 1024) set the size of the maps, clamped to the GPU's largest texture size.

**Stats.** `graphicsMemory()` estimates how many bytes of GPU memory are in use: `framebufferMemory()` (the drawing buffers, which grow with the window) plus `sceneMemory()` (shadow maps, geometry and textures). `stats()` returns the last frame's draw calls and triangles, the live geometry and texture counts, both memory figures, and `frameMS` (the average frame time over the last 30 s). `frameMS(windowMS)` on its own is cheap, since it does not walk the scene, so it suits an FPS readout.

| | |
|--|--|
| `Camera` | A perspective camera. Its `native` is parented to the GameObject's `Object3D`, and it syncs fov, near and far on each `update`. It also has effects for blows, timed in game time: `shake(m, s)`; `punch(m, s)`, a push toward where the camera looks that springs back; and `impact(at, s)`, a black-and-white impact frame. In an impact frame, anything standing off the ground within about 2 m of `at` (the middle of the body that was struck) becomes a white silhouette inked in black, and everything else turns black, with speed lines bursting out from the target. The colors invert for the second half. The `Renderer` passes `impactFrame` on to the `OutlinePass`. |
| `Light` | A `point` or `directional` light. `offsetX/Y/Z` is a local offset (Z runs along Kindling's forward). |
| `MeshRenderer` | Instantiates `meshID` from the registry, with an optional `color`, `shaderInserts` and `shaderUniforms`. |
| `applyLook(look)` | Sets the background, fog, exposure, hemisphere light, fill and optional sun. |
| `projectToCanvas` / `pickGround` | Projects a point onto the screen, and picks a point on the ground plane. |

`MeshRenderer` waits until `meshReady(meshID)` is true. Changing `meshID` rebuilds the mesh.

**Shader patches.** `insertAfterChunk` and `applyShaderFeatures` insert GLSL after one of Three.js's documented `#include <chunk>` lines (see the pulsing cube in the playground). `patchShader(material, key, edit)` stacks a raw edit on top of earlier ones and skips a key the material already has, so patches combine instead of replacing each other's `onBeforeCompile`.

**Toon look.** `ToonMaterial` is a `MeshToonMaterial` with:

- a hard-stepped light ramp (`bands`);
- a tint on the side facing away from the light (`shade`);
- a back-light `rim`;
- drawn `pattern`s (`brick`, `plank`, `thatch`, `stone`, `meadow`), computed from the world position, so they need no textures or UVs.

A pattern's `patternScale` is the height of one course in meters on the sides, and `topScale` is the same on faces that point up. `brickLength` is in meters, and `topAxis` is the direction the rows run on flat tops (stairs point it uphill). Together they let courses and joints line up with step heights and tread depths.

`outline: false` keeps a surface, such as grass or water, out of the ink pass. Opaque surfaces write alpha 0 as the mask; transparent ones keep their alpha for blending and leave the mask beneath them untouched (set `transparent` before `outline`).

The mesh kit (`lathe`, `bevelBox`, `tube`, `blob`, `ribbon`) builds prop geometry in meters, with Y up. The host supplies the materials and any instancing.

`Renderer.outline` (an `OutlinePass`) draws ink lines from the scene's depth in a single fullscreen pass, with no extra draw calls per object. Set its `color` per scene with `RendererLook.ink`, and its `width` in pixels at 1080p. Set `enabled = false` to render straight to the canvas. The ink is drawn after everything else, transparent objects included; `overInk(material)` lets an effect (a flame, a glow, a trail) wipe out the ink beneath it, in proportion to how much it covers.

**Effects** (`render/effects.ts`). `addEffect(scene, object, update, dispose)` adds a short-lived effect that is drawn over the ink and casts no shadow. Its `update(age)` runs once a frame in game time and returns false when the effect is done. `addMeshEffect` is the version for a mesh that owns its geometry and material, and `effectMaterial` makes an unlit, see-through shader. Each of these primitives takes its look as data:

- `streaks`: needles of light shooting out from their roots
- `sweep`: a crescent ribbon between two edges of a motion, such as a blade's swing
- `starburst`: inked spikes where a blow lands
- `puff`: a cloud of dust or smoke billowing out (`puffPicture(colors)` draws the cloud's picture)
- `shockwave`: a ring racing out across the ground
- `afterimage`: a fading, flat ghost of a posed model

**Moves** (`assets/move.ts`). `move(timing, windUp, t)` samples a slow–fast–slow move: it anticipates with a sink, strikes in a `snap`, holds the impact, carries through and settles. It returns the `phase`, `u` (from the ready pose to the strike pose) and the `weight` of the animation clip underneath. `ease` holds the easing functions.

---

## Audio

`world.audio` is a Web Audio mixer. Its music scores are procedural.

`playRecording` plays a finished audio file (a URL or an `ArrayBuffer`) on the music output, so music volume, mute and duck apply, but it plays dry, without the music bus's room reverb. By default it plays from 0 to the end of the file and then repeats. Pass `{ start, end }` in seconds to play from 0 until `end`, then jump back to `start` and repeat that span. Pause, seek and the beat clock work on a recording the same way they do on a score (at 60 BPM, so one beat is one second; the bar ends at `end`).

Without an `AudioContext` (in Node tests, or headless) the mixer does nothing and stays silent. While a score, recording or loop is playing, the mixer schedules itself, so you only call `update()` yourself when headless.

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

`playMusic` and `playLoop` throw on an invalid `Score` (they run the same checks as `piece()`). The first sound effect played before `resume` is queued and plays once audio unlocks; any others before then are dropped with a warning. Pass a **stable** object to `playLoop` (not a fresh patch or `piece()` every frame), or the sound restarts. A `Score` played at a position is spatialized with HRTF, like the sound of a river: it uses the SFX volume and has no music reverb, pause or duck. It can play at the same time as `playMusic`.

An `AudioSource` on a GameObject plays sound effects and loops at its `transform.position` (world x/y/z). A one-shot's `gain` is multiplied by the source's. A disabled source is silent. Other components play sounds through it:

```ts
const speaker = go.addComponent(AudioSource, { hear: 12 });
speaker.play(knock);     // one-shot
speaker.loop = radio;    // patch or score; follows the object
speaker.loop = null;     // stop
```

**Instruments.** These are built in (exported from `@arc-director/kindling/score`, and all defined in `src/audio/instruments.ts`): `pad`, `pluck` (guitar or harp), `lead`, `bass`, `bell`, `drum` (MIDI notes below 40 are a "dum", below 45 a "tek", and anything higher a "tap"), `air`, `piano`, `violin`, `cello`, `brass`, `flute`, `guitar`, `twelveString`, `koto` and `choir` (a wordless "oo" opening to "ah"). For anything else, call `registerInstrument` before `piece` or `playMusic`.

```ts
import { registerInstrument } from '@arc-director/kindling';
export const sitar = registerInstrument('sitar', 'percussive', (ctx, dest, noise, when, midi, dur, gain) => { /* oscillators */ });
```

A `percussive` instrument fixes a note's loudness when the note starts. A `sustaining` instrument lets a diminuendo or crescendo change the volume of a note that is already playing (pad, bass, lead, air, violin, cello, brass, flute and choir are sustaining). You can override this per track with `track(piano, { envelope: 'sustaining' })`.

**Filters** are inserts:

- `reverb({ mix, decay, tone, size })` adds a short room on top of the dry signal. `size` (0–1) adds reflections and spreads them out; 0.5 gives four stock taps.
- `overdrive({ drive, tone, level })` is a waveshaper followed by a lowpass tone control. A clipped sound comes out loud whatever goes in, so use `level` to turn it back down.

Filters go on a track (`track(lead, { filters: [overdrive()] })`), on a whole piece (`piece({ filters: [reverb()] })` or `score.filters`), or on a sound effect patch (`patch.filters`), and they run in series, first to last. Voice filters run first, then the score's filters, then the music bus's room, which `playMusic` always adds. A score or sound effect played at a position skips that room, so add `reverb()` to it when it should ring out.

### Scores (`@arc-director/kindling/score`)

You can pass a hand-built `{ bpm, loop, voices }` to `playMusic`, or compile one:

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

`piece({ loops: 1, ... })` plays once; `-1`, or leaving `loops` out, repeats forever. A `callback(fn)` between bars, or after the last one, runs when playback reaches that beat, so it can stop the music, swap the song, or anything else.

Notation:

- `c4:2` is C4 for 2 beats, and `r:4` is a rest of four beats.
- Notes without a duration share one beat between them (`g4 b4 d5 b4` is four sixteenth notes).
- `|` is only there for readability when notes have `:n` durations.
- `chord('C')` plays all of a chord's tones together, for `beats` if you pass it, or else for the whole bar. `D-`, `Bb2` and `C#7` work too.
- `.range('a2', 'a5')` or `.range(0, 3)` keeps every chord tone within that span. `.include(0, 3)` or `.include('c3', 'c4')` keeps just those tones, and `.exclude(1, 2)` drops them from the span.
- `root('C')` is the chord's lowest tone.
- `arpeggio('C')` plays the tones one after another (leave out `beats` to fill the bar).
- `changes(['D-', 4], ['C', 4])` is a list of chords. Pass it to `chord`, `arpeggio` or `root`, or call `ch.as(fn)` for any other voicing.

Each **part** in a `bar` starts on that bar's downbeat, so the parts play on top of each other. Notes that follow one another belong in **one** track call: `low('c2:4 g2:4')`. To start a second idea later, open it with a rest: `low('c2:4'), low('r:4 g2:4')`. Two `track(bass)` calls make two separate tracks, each with its own gain and cutoff.

The dynamics are `p`, `mp`, `mf`, `f` and `ff`. A mark comes right after the notes it applies to. `crescendo(f)` and `diminuendo(p)` shape `sustaining` instruments; on the others, a note's velocity is set when it starts.

`slot()` stores a phrase so it can be played again or varied with `.with` / `.without`. `start()` and `end()` trim the piece while you listen to it. `callback(fn)` fires when playback reaches that point.

### Sound effects

A sound effect patch is built from layers:

- `noise`, `thump`, `click`, `creak`, `pluck`, `fm` and `chirp`
- `bee` and `boo`: speech syllables modeled on recordings, each starting with a "b"
- `crackle`: random pops (`rate` per second) through a bandpass, for fire, sparks and grit; it loops too
- `metal`: the inharmonic partials of a struck bar, for clashes and clangs
- `formant`: a throat's buzz shaped into a `vowel`, for grunts, shouts and cries
- `rumble`: low rolling noise over a sub tone, for the tail of thunder or the ground cracking

`noise`, `crackle` and `rumble` layers take an `attack` (swell in, hold, then die away) and a `cutoffTo` (a filter sweep). `opts.dur` and `opts.freq` apply to **every** layer. A patch's `vary` (0–1) changes the pitch (by up to ±4 semitones × `vary`) and loudness each time it plays, so repeats never sound the same.

**Speech.** `speech(text, voice, seconds?)` builds an Animal Crossing–style babble patch from a spoken line. It plays one `bee` or `boo` per syllable on a pentatonic scale, with sentence intonation, and fits the line to exactly `seconds` when you pass it. Rounded vowels get a "boo" and the rest a "bee", read by ten English spelling rules (silent e, vowel teams, r-colored vowels, …). A `SpeechVoice` sets the `pitch`, `rate` and `range` (how much the intonation moves), and `voiceFor(seed, [lowHz, highHz])` makes a varied one. The `Speaker` component (an `AudioSource`) builds a line in its own voice with `line(text, seconds?)` and plays it at its transform with `say(line)`. Any `voice` fields you leave unset come from `voiceFor(id)`.

**Position.** Sound effects played at a position use HRTF; music is centered. Volume stays full up to 1 m away, drops steeply, then fades slowly, and is muted beyond `hear`. `falloff` scales both slopes.

---

## Meshes

```ts
register('crate', () => proceduralBox(0x886644));
// Clones the glTF scene; does not attach it.
await registerGltf('tri', '/triangle.gltf');
```

`MeshRenderer` uses `create(id)` and `meshReady(id)`. `registerGltf` is async, and the renderer keeps retrying until the factory exists.

**Toon models.** `scripts/buildModels.mjs` turns a folder of Tripo GLBs into slim game GLBs plus one shared library of animation clips (`clips.glb`). It also rigs bows and birds that come without a rig. `registerToonModel(id, url, { height, brightness, bands })` loads one model (a character or a prop), and `registerToonClips(url)` loads the clip library. Each `MeshRenderer` instance is a skinned clone with `ToonMaterial`s, facing −Z.

`Animator` plays clips on it, and `toonClip` fits library clips to each body. Every frame starts from the clip's pose, so bones you pose on top never pile up. After the clip, every frame, you can:

- put a prop in a hand with `holdInHand(mesh, 'right', prop, grip)`;
- turn the head with `lookAt(mesh, point, weight)`;
- bend an arm toward a point with `reach(mesh, 'right', point, weight)` (two-bone IK);
- turn the hand so a held prop points the right way (a sword's tip and its flat) with `aimHeld(mesh, 'right', prop, axis, side, point, facing, weight)`;
- draw a rigged bow's string with `drawBow(bow, nock)`.

`humanBone(mesh, 'head')` and `restTurn(mesh, bone)` give you the bones. `scripts/shoot.mjs <url> <out.png>` screenshots a page in headless Chrome once the page's title is `ready` (the playground's `character.html?shot=turnaround|faces` works this way).

---

## Subclassing

A typical host:

- `class MyGame extends Game<MyWorld>` passes in its own `World`, sets `paused` to pause, and overrides `tick` (calling `super.tick`) for extra work each frame.
- `class MyWorld extends World` sets `tileSize`, overrides `sampleTerrain` and adds its own queries.
- It fills in `KindlingTypes` once, and from then on `go.world`, `world.chunks`, `chunkAtWorld` and `tileAtWorld` return its own types everywhere. `GameObject` and `Component` need no subclass for that:

```ts
declare module '@arc-director/kindling' {
	interface KindlingTypes {
		world:MyWorld;
		chunk:MyChunk;
	}
}
```

**Input.** `world.input` (an `Input`) handles the keyboard, the mouse and pointer lock on the canvas. `Game` attaches it and clears its per-frame fields (`pressed` and the look and wheel deltas) after each frame. Keys are named by `KeyboardEvent.code`; the left button on the locked canvas is the key `MOUSE_LEFT`, so `key` holds it and `pressed` clicks it. Set `input.captures` to the keys whose browser default (scrolling, moving focus) the game should take over.

Kindling has no UI framework, no scene format, and no gameplay systems beyond the types above.

---

## Layout

```text
src/
  index.ts           public API
  core/              Game, World, GameObject, Transform, Time, physics
  render/            Renderer, Camera, Light, MeshRenderer, shader inserts, effects
  assets/            mesh registry, glTF
  audio/             procedural mixer, scores, SFX
playground/          Vite demos (cube, parenting, glTF, lights) and the character.html lineup
```
