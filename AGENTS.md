# Agent notes

This repo is an **LLM NPC framework** with a small 3D game attached so we can test it. The library is the product; the game is the host. No backwards compatiblity, library is still experimental, not released. We prioritize code quality and library easy-of-use and extendibility, and code simplicity. Do not simplify anything with large surface area (referenced a lot) without user confirmation for maximum future proofing while still avoiding overengineering. We follow SOLID and POLA principles and keep things DRY and prefer refactors that yield less code (especially less code for the game host) over solutions that look like afterthoughts. For every problem being solved, wheneever there's a more elegant solution that results in less overall code in the codebase, always propose it to the user with emphasis on the simplicity and extendability gains (if any). Push back on hacks. When asked to edits anything that reaches the context of any AI model (e.g. sight, verbs, prompt) then also check the AI log and report back those problems to the user after finishing the task with possible solutions.

| Folder | Package | Job |
|--------|---------|-----|
| `arc-director/` | `arc-director` | Engine-agnostic characters, minds and collectives: arcs, memory, perception, talk, HTTP inference. No Vue, no Three, no physics. |
| `kindling/` | `@arc-director/kindling` | GameObject runtime: `Game`, `World`, `Component`, tick, physics, Three.js view. Hosts subclass; they do not own this. |
| `game/` | `@arc-director/game` | Example host used for testing: walkable world, items, streaming chunks, Vue HUD, adapter into ArcDirector. Subclasses Kindling. |
| `brainstorming/` | none | Concept art and old notes. |

pnpm workspace at the repo root (`package.json`, `pnpm-workspace.yaml`).

## Stack

- **Language:** TypeScript (strict), pnpm workspaces, not a single root `src/`. 2–3 letter acronyms `ID` / `HP` / `NPC` / `URL` / `UTC` (`NPCDirector`, `npcID`; never `Id`, `Hp`, `Npc`, `Url`, `Utc`). Not units (`Mb` ≠ `MB`, `Ms` ≠ `MS`).
- **`arc-director`:** pure TS library. Local models over HTTP (LM Studio / Ollama).
- **`kindling`:** Unity-shaped runtime. Owns canvas, `Renderer`, frame loop, `GameObject` / `Transform` / physics. Three.js is the scene graph.
- **`game`:** Vue 3 (Composition API, one SFC per file) + Vite. Subclasses Kindling `Game` / `World` / `Component`, and registers its `World` / `Chunk` in `KindlingTypes` (`game/src/engine/World.ts`). Simulation is not Vue state; HUD is DOM over the canvas.

## Kindling (rough)

Unity-shaped, not Unity. `@arc-director/kindling` owns the canvas, `Renderer`, RAF loop, and scene (`world.native`). Hosts **subclass** `Game` / `World` / `Component` and fill in `KindlingTypes` so `go.world` and chunks come back as their own types; they do not own this package. Identity on a GameObject is `id`. Deeper API: `kindling/README.md`. Playground: `pnpm --filter @arc-director/kindling dev` → `http://localhost:5174/`.

### Types

| Type | Role |
|------|------|
| `Game` | Canvas, renderer, `start`/`stop`, `tick` → `simulate`. Generic over `World`. |
| `World` | Object list, Three.js `Scene`, `add` / `remove` / `destroy`, `sampleTerrain`. |
| `GameObject` | `id`, `name`, `parent`/`children`, component list. |
| `Transform` | Always present. Wraps `Object3D`. `position` / `yaw` / `pitch` / `roll` are world. |
| `Component` | Host logic. `enabled`, `static order`. |
| `Time` | `time`, `deltaTime`, `fixedDeltaTime` (0.02), `fixedTime`. Clamp `MAX_DT` = 0.05. |
| `Input` | Keyboard, mouse and pointer lock on `world.input`. `Game` attaches it and clears per-frame presses after each frame. |
| `Rigidbody` | XZ `velocity`; optional `grounded` Y snap. |
| `BoxCollider` | XZ AABB, or an upright cylinder (`shape: 'cylinder'`, diameter `size.x`) for static round obstacles; `solid` / `isTrigger` / `pad` (shove). |
| `Chunk` / `ChunkStreamer` | Square tile chunks on `World.chunks`. The streamer loads near `StreamingAnchor`s and parks far `ChunkBound` objects. |
| `Camera` / `Light` / `MeshRenderer` | View. Renderer finds the first enabled `Camera`. |
| `Renderer` | WebGL, fog/hemi/fill/sun look, resize. Null when headless. |
| `Audio` | Procedural mixer on `world.audio`. Scores + HRTF stereo SFX, no sample files. Silent when headless. |
| `captureWorld` / `diffWorld` / `restoreWorld` | Saves: fields listed in `static saved`, diffed against the freshly built scene. Objects the scene lacks rebuild from `GameObject.recipe`. |

### Hierarchy

Assigning `GameObject.parent` reparents in both Kindling and Three.js and keeps the world pose. `children` is the readonly direct-child list. Adding a parent to a world registers the whole tree. `World.destroy` / `Game.destroy` queues end-of-frame destroy (children follow, `onDestroy`). `World.remove` unregisters one object now (no `onDestroy`, children stay).

### Component callbacks

Lifecycle (Unity-like): `awake` + `onEnable` when the object joins a world → `fixedUpdate` (if a fixed step is due) → `start` once → `update` → physics → `lateUpdate` → end-of-frame destroy (`onDisable` then `onDestroy`). Toggle `enabled` fires `onEnable` / `onDisable`. Disabled components skip `start` and the tick hooks.

Per type: `static order` (lower first). Optional `static update` / `fixedUpdate` / `lateUpdate(dt, list)` run once per type, then instance overrides.

### Frame

`simulate(dt)`: drain `fixedUpdate` → `start` → `update` → `stepPhysics` → `lateUpdate` → `flushDestroy`. Pause with `Game.paused`: frames still tick and draw, `Time` stands still. Hosts that do extra frame work override `tick` and call `super.tick(dt)`. `Time.time` is the one game clock (`resetTime(t)` restarts it at a loaded save's time).

## Axes (Y-up, right-handed, Three.js)

Ground is **XZ**. **Y** is height (tile height underfoot). Yaw is around Y, in radians.

| Axis | Direction |
|------|-----------|
| **+X** | east (Dungeon `EastGate` / vault chunk) |
| **−X** | west |
| **+Y** | up |
| **−Y** | down |
| **−Z** | north (top of a glyph map; yaw `0` faces this way) |
| **+Z** | south |

WASD is camera-relative on XZ. NPCs never see these numbers; verbs and prompts use names only. URL `player`/`ai` (and agent-only `view`) are **testing-only** (see below).

## Characters

Every character is a 3D model generated in Tripo3D (GLB, Mixamo skeleton) by Daniel into `brainstorming/3Dmodels/` (gitignored), then built for the game with `node kindling/scripts/buildModels.mjs brainstorming/3Dmodels game/public/models game/models.json` (needs Kindling built). Mesh IDs are the file names (`Hero`, `KnightMale`, …), listed in `game/src/render/characterModels.ts` with the props (`Sword`, bows, staffs, arrows, `Raven`); clips are shared from `clips.glb`. Per-model build fixes live in `game/models.json`. What a held item looks like in the hand is `HELD` in `game/src/characters/HeldProps.ts`; NPCs get gear through `equip` in their scene entry. `CharacterAnimation` picks clips; `CharacterPose` adds look-at, give/take reach, the bow shot, the sword moves (stab, slice, guard) with their white trails (`render/swordFx.ts`), and spells cast from the staff's head (hex, smite, heal; `render/spellFx.ts`, pictures in `game/public/textures/vfx.png` and `fireball.png`, packed from `brainstorming/vfx-sprite-sheet.png` and `fireball-animation.png`). Blows land through `director/hitFeel.ts`: hitstop, a starburst and dust, a shockwave and view shake for heavy blows, and the black-and-white impact frame for one that downs (`render/fightFx.ts`). A blow that misses is dodged as it arrives (`CharacterPose.dodge`: a sidestep and lean away, a ghost where the body stood, a whoosh). All effects are built from Kindling's (`kindling/src/render/effects.ts`); sword moves time on Kindling `move()`. Lineup: `pnpm --filter @arc-director/kindling dev` → `http://localhost:5174/character.html` (`?right=Sword&left=ShamanBow&look=1`, more in `character.ts`).

## Dev server

From the repo root:

```
pnpm --filter @arc-director/game dev
```

The game is served at `http://localhost:5173/` (Vite default). There is no path router. All deep links are **query params** on `/`.

## URL query schema

`scene` is the real deep link. **`player` / `ai` are testing flags** kept in the address bar (and localStorage). **`view` is agent-only:** never add it when playing as a user. Player pose (position + camera yaw) autosaves to localStorage; `view` overrides that pose when present.

| Param | Kind | Meaning |
|-------|------|---------|
| `scene` | play | Scene id. `dungeon_vault` (the crypt crawl), `glen`, `marketplace`, or `ruins`. Omit (or unknown id) → the init screen (where NPCs think: LM Studio, or Gemma 4 E4B in the browser through transformers.js), then the scene picker. A `scene` link skips the init screen. |
| `player` | test | `participant` = NPCs can see, hear, and walk to the player. `observer` = the player is inperceivable by NPCs. `camera` = an observer with no body: not rendered, no collider (screenshots without the player character). |
| `ai` | test | `1` = ArcDirector runs (NPCs think and move). `0` = paused (no inference, NPC motors frozen). Also `true`/`false`. |
| `view` | agent | Full camera shot: `x,y,z,yaw`. All four numbers or the param is ignored (no partial pose). X/Z are meters on the ground; Y is height; yaw is radians. `0` yaw looks toward −Z (north); `1.5708` (π/2) toward −X (west); `3.1416` (π) toward +Z (south). Yaw also faces the player. Camera follows the player. |
| `focus` | agent | Watch expression (ArcDirector syntax) the camera follows: the player, as the camera's rig, glides to the middle of whom it picks, asked every 0.5 s as the player sees them. `others.filter(u => doing(u, "cleave"))`, `others.filter("Knight")`, `others.filter("Forager")`. Pair with `player=camera`. Also the `set_camera` MCP tool. |
| `zoom` | agent | Camera distance in meters (3–24, default about 13). Also `set_camera`. |
| `stats` | test | `1` = render stats overlay (draw calls, triangles, geometries, textures, scene and screen memory, 30 s frame time). Also readable over the control hub with the `render_stats` MCP tool. Kept when returning to Scenes. |
| `session` | test | Client id for the control MCP hub. The page installs `window.arcControl` always; it opens a WebSocket to the hub only when this is a non-empty value. A second live page with the same id is renamed (`alpha-2`, `alpha-3`, …) and the query is updated. Cursor: `.cursor/mcp.json`. Claude Code: `.mcp.json`. Both run `mcp/dist/main.js`, so build it first: `pnpm --filter @arc-director/mcp build`. |

**Defaults** (when the param is omitted and nothing is stored): **`player=observer`**, **`ai=1`**. Menu **Testing** settings write both to localStorage and the URL; they survive reloads. Query params override the stored values for the fields you set.

Pose comes from the last saved pose for that scene. **`view` overrides that pose as a whole.** World and the cast start fresh unless you press **Load** (Menu → Save): one save per scene in localStorage, a Kindling diff of the world plus `exportCast`. Every chunk loads at boot so the fresh scene is the same each time; far chunks park their objects instead of dropping them.

While a scene is running, the game `replaceState`s `player` and `ai`. It never injects `view` or `session` for a normal play session. If `view` or `session` is already in the query, it is kept. Returning to Scenes strips `view` / `player` / `ai` and leaves `session`.

### Examples

Init screen, then scene picker:

```
http://localhost:5173/
```

Play (autosave pose, default flags):

```
http://localhost:5173/?scene=dungeon_vault
```

Agent forced test view (prefer this when checking a specific place):

```
http://localhost:5173/?scene=glen&view=8,0,12,1.57
```

Marketplace (south bank by the main footbridge, looking north):

```
http://localhost:5173/?scene=marketplace&view=16,0,20,0
```

Dungeon crawl (the Gatehouse, looking north up the web passage):

```
http://localhost:5173/?scene=dungeon_vault&view=8,0,40,0
```

5v5 Combat (in the ruined sanctum, looking north):

```
http://localhost:5173/?scene=ruins&view=16,0,11,0
```

### Testing / screenshots

When the work is visual or location-specific, **agents must pass `view`**. Do not treat a default spawn / last-autosave glance as enough.

1. Open a `scene` + `view` URL (include `player`/`ai` as needed). After moving, copy the bar. `view` stays in sync only if it was already present.
2. Wait until the canvas has rendered (models load).
3. Take a screenshot. Open the pause menu only with the top-right **Menu** button. Esc does not toggle it.

Need a distant chunk: put that X/Z in `view` so the streaming anchor (the player) loads it.

Recommended flag values:

| What you are testing | Flags |
|----------------------|--------|
| World, meshes, lighting, HUD, streaming (no NPC motion or inference) | `player=observer&ai=0` |
| Watch NPCs act without them noticing you (default) | `player=observer&ai=1` |
| Talk, give, or otherwise interact as a visible player | `player=participant&ai=1` |
| Screenshots without the player character in them | `player=camera&ai=1` (add `focus` to follow the action) |

Example: glen screenshot with ArcDirector paused:

```
http://localhost:5173/?scene=glen&view=8,0,12,1.57&player=observer&ai=0
```

Example: marketplace with ArcDirector paused:

```
http://localhost:5173/?scene=marketplace&view=16,0,20,0&player=observer&ai=0
```

Example: 5v5 Combat with ArcDirector paused:

```
http://localhost:5173/?scene=ruins&view=16,0,11,0&player=observer&ai=0
```
