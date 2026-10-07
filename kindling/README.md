# Kindling

Unity-shaped runtime on Three.js. Same nouns (`Game`, `World`, `GameObject`, `Transform`, `Component`) and a similar lifecycle, but it is not Unity.

Kindling **owns** the canvas, `Renderer`, requestAnimationFrame loop, and the Three.js scene (`world.native`). You **subclass** `Game` / `World` / `GameObject` / `Component`. The playground (or your UI) only mounts that canvas. Simulation is not UI state. Identity on a GameObject is `id`.

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
| `tick(dt)` | Clamps dt, advances `Time`, calls `simulate`. |
| `simulate(dt)` | Component loop (protected). |
| `destroy(go)` | Queues `world.destroy`. |
| `dispose()` | Stop + renderer dispose. |

`unfocusedHz` (default `3`) caps canvas draws while the document is unfocused. Hosts set it on the `Game` instance.

If you own pause, override `tick` and **do not** call `super.tick` (that advances `Time` again). Set `Time.deltaTime` / `Time.time`, then `this.simulate(dt)`.

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
      update(dt)
      stepPhysics(world, dt)
      lateUpdate(dt)
      world.flushDestroy()
  renderer.render()
```

`Time.fixedDeltaTime` defaults to `0.02`. `resetTime()` restores the defaults (tests / new sessions).

---

## Physics

`stepPhysics` is XZ only, then optional Y snap.

1. **Integrate.** Every enabled `Rigidbody`: `position.xz += velocity.xz * dt` (stores `prevX` / `prevZ`). Then `World.reindex()`, so collision pairs come from the spatial hash, not every pair of objects.
2. **Collide.** Enabled, solid, non-trigger `BoxCollider` on an object that also has a `Rigidbody`:
   - tile AABB vs `World.sampleTerrain` when `tileSize > 0` (`blocked` cells)
   - other solid boxes (minimum translation on X or Z)
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

`Renderer` creates the WebGL canvas, hemisphere + ambient fill, optional directional sun, fog, and shadows. It renders with the first **enabled** `Camera` in `world.objects`. `detailMaps` (default on) samples normal and metalness maps; off disposes them from the GPU. `shadows` (default on) is realtime shadow maps. `graphicsMemory()` estimates GPU bytes in use.

| | |
|--|--|
| `Camera` | Perspective; `native` is parented to the GameObject’s `Object3D`. Syncs fov/near/far each `update`. |
| `Light` | `point` or `directional`. Local `offsetX/Y/Z` (Z along Kindling forward). |
| `MeshRenderer` | Instantiates `meshID` from the registry; optional `color`, `shaderInserts`, `shaderUniforms`. |
| `applyLook(look)` | Background, fog, exposure, hemi, fill, optional sun. |
| `aimSun(x, z)` | Positions the look-sun over a ground point. |
| `projectToCanvas` / `pickGround` | Screen projection and ground-plane picking. |

`MeshRenderer` waits until `meshReady(meshID)`. Changing `meshID` rebuilds the mesh.

Shader patches: `insertAfterChunk` / `applyShaderFeatures` insert GLSL after a documented Three.js `#include <chunk>` (see playground pulse cube).

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

`AudioSource` on a GameObject poses SFX/loops at `transform.position` (world x/y/z). Other components play by ref:

```ts
const speaker = go.addComponent(AudioSource, { hear: 12 });
speaker.play(knock);     // one-shot
speaker.loop = radio;    // patch or score; follows the object
speaker.loop = null;     // stop
```

Built-in voice instruments: `pad`, `pluck` (guitar / harp), `lead`, `bass`, `bell`, `drum` (MIDI `<40` dum, `<45` tek, else tap), `air`, `piano`. Anything else is `registerInstrument` before `piece` / `playMusic`.

```ts
import { registerInstrument } from '@arc-director/kindling';
export const violin = registerInstrument('violin', 'sustaining', (ctx, dest, noise, when, midi, dur, gain) => { /* oscillators */ });
```

`percussive` locks loudness when the note starts. `sustaining` lets a dim/cres turn the volume on a note that is already playing (pad, bass, lead, air, violin, brass, flute). Override a track with `track(piano, { envelope: 'sustaining' })`.

Sound filters are inserts: `reverb({ mix, decay, tone })` adds a short room on top of the dry signal, `overdrive({ drive, tone })` is a waveshaper plus a tone lowpass. Put them on a track (`track(lead, { filters: [overdrive()] })`), the whole piece (`piece({ filters: [reverb()] })` or `score.filters`), or an SFX patch (`patch.filters`). Series, first to last. Voice filters run, then the score filters, then the music-bus room (that room is always there for `playMusic`). A posed score or SFX does not use the music-bus room, so add `reverb()` on it when it should bloom.

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

SFX layers: `noise`, `thump`, `click`, `creak`, `pluck`, `fm`, `chirp`, `murmur`. Posed SFX use HRTF. `opts.dur` / `opts.freq` apply to **every** layer. Music is centered. Distance is `1 / (1 + (dist * falloff)²)`; mute past `hear`.

---

## Meshes

```ts
register('crate', () => proceduralBox(0x886644));
// Clone of the glTF scene; does not attach.
await registerGltf('tri', '/triangle.gltf');
```

`create(id)` / `meshReady(id)` are what `MeshRenderer` uses. `registerGltf` is async; the renderer retries until the factory exists.

---

## Subclassing

Typical host:

- `class MyGame extends Game<MyWorld>`: inject a custom `World`, override `tick` if you own pause or extra frame work.
- `class MyWorld extends World`: set `tileSize`, override `sampleTerrain`, add queries.
- Optionally subclass `GameObject` / `Component` so `world` / `gameObject` are your types.

Kindling has no UI framework, no scene format, and no gameplay systems beyond the types above.

---

## Layout

```
src/
  index.ts           public API
  core/              Game, World, GameObject, Transform, Time, physics
  render/            Renderer, Camera, Light, MeshRenderer, shader inserts
  assets/            mesh registry, glTF
  audio/             procedural mixer, scores, SFX
playground/          Vite cube / parent / glTF / light demo
```
